/**
 * SmartHUB WebSocket + HTTP server
 *
 * Usage: npm run ws
 *
 * ─── ESP32 protocol ──────────────────────────────────────────
 *   ESP32 → Server
 *     { type: "auth",             apiKey, macAddress }
 *     { type: "ping_ack" }
 *     { type: "relay_ack",        relayId, state }
 *     { type: "switch_trigger", linkedRelayId, desiredState, isToggle }
 *
 *   Server → ESP32
 *     { type: "auth_ok",            deviceId, relays, switches }
 *     { type: "auth_fail",          reason }
 *     { type: "ping",               relays: [{id, pin, state}] }
 *     { type: "relay_cmd",          relayId, pin, state }
 *     { type: "relay_add",          relay }
 *     { type: "relay_update_config", relay }
 *     { type: "switch_add" | "switch_update_config" | "switch_delete", ... }
 *
 * ─── Browser protocol ────────────────────────────────────────
 *   Browser → Server: { type: "subscribe", userId }
 *   Server → Browser: { type: "device_update", deviceId, relays }
 *                     { type: "relay_update",  deviceId, relayId, state }
 */

import { WebSocketServer, WebSocket } from "ws";
import { PrismaClient } from "@prisma/client";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { parse as parseUrl } from "url";
import { randomBytes } from "crypto";

// Singleton - survives Next.js HMR reloads and prevents connection pool accumulation
const globalForWs = globalThis as unknown as { wsDb: PrismaClient | undefined };
const db = globalForWs.wsDb ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForWs.wsDb = db;

const PORT = Number(process.env.WS_PORT ?? 4001);
const WS_SECRET = process.env.WS_SECRET ?? "";
const PING_INTERVAL_MS = 30_000;

// ─── State ────────────────────────────────────────────────────

// Map: deviceId → ESP32 WebSocket
const deviceSockets = new Map<string, WebSocket>();

// Active reg-input calibration sessions per device. Only one input may calibrate
// at a time per device. Stale sessions are auto-stopped after CAL_TIMEOUT_MS.
interface CalibrationSession {
	regInputId: string;
	startedAt: number;
	timer: NodeJS.Timeout;
}
const calibrationSessions = new Map<string, CalibrationSession>();
const CAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
// Map: userId   → Set of browser WebSocket connections
const browserSockets = new Map<string, Set<WebSocket>>();
// Map: deviceId → pending on-demand ping resolve/timer
const pendingPings = new Map<string, { resolve: (online: boolean) => void; timer: ReturnType<typeof setTimeout> }>();
// Map: deviceId → Set of userIds who should receive updates (owner + shared users)
const deviceSubscribers = new Map<string, Set<string>>();
// Map: one-time OTA download token → { deviceId, expiresAt }
const otaTokens = new Map<string, { deviceId: string; expiresAt: number }>();

// ─── Types ────────────────────────────────────────────────────

interface AuthMsg {
	type: "auth";
	apiKey: string;
	macAddress: string;
	deviceId?: string;
}
interface RelayAckMsg {
	type: "relay_ack";
	relayId: string;
	state: boolean;
}
interface PingAckMsg {
	type: "ping_ack";
}
interface SwitchTriggerMsg {
	type: "switch_trigger";
	linkedRelayId?: string;
	linkedRegulatorId?: string;
	desiredState: boolean;
	isToggle: boolean;
}
interface OtaProgressMsg {
	type: "ota_progress";
	percent: number;
}
interface OtaResultMsg {
	type: "ota_result";
	success: boolean;
	error?: string;
}
interface RegulatorAckMsg {
	type: "regulator_ack";
	regulatorId: string;
	speed: number;
}
interface RegulatorInputTriggerMsg {
	type: "regulator_input_trigger";
	linkedRegulatorId: string;
	speed: number;
}
interface RegInputCalibrationSampleMsg {
	type: "reg_input_calibration_sample";
	id: string;
	pin: number;
	raw: number;
}
type EspMessage = AuthMsg | RelayAckMsg | PingAckMsg | SwitchTriggerMsg | OtaProgressMsg | OtaResultMsg | RegulatorAckMsg | RegulatorInputTriggerMsg | RegInputCalibrationSampleMsg;
interface BrowserSubscribeMsg {
	type: "subscribe";
	userId: string;
}

// ─── Helpers ──────────────────────────────────────────────────

function broadcastToUser(userId: string, payload: object) {
	const sockets = browserSockets.get(userId);
	if (!sockets?.size) return;
	const msg = JSON.stringify(payload);
	let sent = 0;
	const dead: WebSocket[] = [];
	for (const ws of sockets) {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(msg);
			sent++;
		} else {
			dead.push(ws);
		}
	}
	for (const ws of dead) sockets.delete(ws);
	if (sockets.size === 0) browserSockets.delete(userId);
	if ((payload as { type: string }).type === "relay_update") {
		console.log(`[WS] broadcast relay_update → userId=${userId} sent=${sent} dead_pruned=${dead.length}`);
	}
}

function broadcastToDeviceSubscribers(deviceId: string, payload: object) {
	const subscribers = deviceSubscribers.get(deviceId);
	if (!subscribers) return;
	for (const userId of subscribers) broadcastToUser(userId, payload);
}

/** Build the subscriber set for a device (owner + relay/room/home shared users) - single query */
async function buildDeviceSubscribers(deviceId: string): Promise<Set<string>> {
	const device = await db.device.findFirst({
		where: { id: deviceId },
		select: {
			apiKey: { select: { userId: true } },
			relays: {
				select: {
					shares: { select: { userId: true } },
					room: { select: { shares: { select: { userId: true } } } },
				},
			},
			home: { select: { shares: { select: { userId: true } } } },
		},
	});
	if (!device) return new Set();

	const subscribers = new Set([device.apiKey.userId]);
	for (const relay of device.relays) {
		for (const s of relay.shares) subscribers.add(s.userId);
		for (const s of relay.room?.shares ?? []) subscribers.add(s.userId);
	}
	for (const s of device.home?.shares ?? []) subscribers.add(s.userId);
	return subscribers;
}

function pushRelayCommand(deviceId: string, relayId: string, pin: number, state: boolean): boolean {
	const ws = deviceSockets.get(deviceId);
	if (!ws || ws.readyState !== WebSocket.OPEN) return false;
	ws.send(JSON.stringify({ type: "relay_cmd", relayId, pin, state }));
	return true;
}

function stopCalibrationSession(deviceId: string, notifyDevice: boolean) {
	const session = calibrationSessions.get(deviceId);
	if (!session) return;
	clearTimeout(session.timer);
	calibrationSessions.delete(deviceId);
	if (notifyDevice) {
		const ws = deviceSockets.get(deviceId);
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: "reg_input_calibration_stop", id: session.regInputId }));
		}
	}
	console.log(`[WS] reg-input calibration stopped: device=${deviceId} id=${session.regInputId}`);
}

function pushToDevice(deviceId: string, payload: object): boolean {
	const ws = deviceSockets.get(deviceId);
	if (!ws || ws.readyState !== WebSocket.OPEN) return false;
	ws.send(JSON.stringify(payload));
	return true;
}

/** Send a ping carrying authoritative relay states to a device */
async function sendPingWithState(deviceId: string): Promise<boolean> {
	const ws = deviceSockets.get(deviceId);
	if (!ws || ws.readyState !== WebSocket.OPEN) return false;
	const [relays, regulators] = await Promise.all([db.relay.findMany({ where: { deviceId }, orderBy: { order: "asc" } }), db.regulator.findMany({ where: { deviceId }, orderBy: { order: "asc" } })]);
	ws.send(
		JSON.stringify({
			type: "ping",
			relays: relays.map((r) => ({ id: r.id, pin: r.pin, state: r.state })),
			regulators: regulators.map((g) => ({ id: g.id, speed: g.speed })),
		}),
	);
	return true;
}

/** Resolve or cancel a pending on-demand ping */
function settlePendingPing(deviceId: string, online: boolean) {
	const pending = pendingPings.get(deviceId);
	if (!pending) return;
	clearTimeout(pending.timer);
	pending.resolve(online);
	pendingPings.delete(deviceId);
}

// ─── HTTP handler helpers ─────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		req.on("data", (c: Buffer) => {
			body += c.toString();
		});
		req.on("end", () => resolve(body));
		req.on("error", reject);
	});
}

function jsonOk(res: ServerResponse, data: object) {
	res.writeHead(200, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

// ─── HTTP request handler (shared between standalone + embedded) ──

export async function wsRequestHandler(req: IncomingMessage, res: ServerResponse) {
	if (req.method !== "POST") {
		res.writeHead(405).end();
		return;
	}
	const secret = (req.headers["x-internal-secret"] ?? "") as string;
	if (WS_SECRET && secret !== WS_SECRET) {
		res.writeHead(403).end();
		return;
	}

	let body: Record<string, unknown>;
	try {
		body = JSON.parse(await readBody(req)) as Record<string, unknown>;
	} catch {
		res.writeHead(400).end();
		return;
	}

	try {
		switch (req.url) {
			case "/push-relay": {
				const { deviceId, relayId, pin, state } = body as { deviceId: string; relayId: string; pin: number; state: boolean };
				const pushed = pushRelayCommand(deviceId, relayId, pin, state);
				jsonOk(res, { ok: true, pushed });
				console.log(`[HTTP] /push-relay → device=${deviceId} relay=${relayId} state=${state} pushed=${pushed}`);
				break;
			}
			case "/push-relay-update": {
				const { deviceId, relay } = body as { deviceId: string; relay: { id: string } };
				const pushed = pushToDevice(deviceId, { type: "relay_update_config", relay });
				jsonOk(res, { ok: true, pushed });
				console.log(`[HTTP] /push-relay-update → device=${deviceId} relay=${relay.id} pushed=${pushed}`);
				break;
			}
			case "/push-relay-add": {
				const { deviceId, relay } = body as { deviceId: string; relay: { id: string } };
				const pushed = pushToDevice(deviceId, { type: "relay_add", relay });
				jsonOk(res, { ok: true, pushed });
				console.log(`[HTTP] /push-relay-add → device=${deviceId} relay=${relay.id} pushed=${pushed}`);
				break;
			}
			case "/push-switch-add":
			case "/push-switch-update":
			case "/push-switch-delete": {
				const { deviceId } = body as { deviceId: string };
				const typeMap: Record<string, string> = {
					"/push-switch-add": "switch_add",
					"/push-switch-update": "switch_update_config",
					"/push-switch-delete": "switch_delete",
				};
				const pushed = pushToDevice(deviceId, { type: typeMap[req.url!], ...body });
				jsonOk(res, { ok: true, pushed });
				console.log(`[HTTP] ${req.url} → device=${deviceId} pushed=${pushed}`);
				break;
			}
			case "/push-regulator-speed": {
				const { deviceId, regulatorId, speed } = body as { deviceId: string; regulatorId: string; speed: number };
				const pushed = pushToDevice(deviceId, { type: "regulator_cmd", regulatorId, speed });
				jsonOk(res, { ok: true, pushed });
				console.log(`[HTTP] /push-regulator-speed → device=${deviceId} regulator=${regulatorId} speed=${speed} pushed=${pushed}`);
				break;
			}
			case "/push-regulator-add":
			case "/push-regulator-update":
			case "/push-regulator-delete": {
				const { deviceId } = body as { deviceId: string };
				const regTypeMap: Record<string, string> = {
					"/push-regulator-add": "regulator_add",
					"/push-regulator-update": "regulator_update_config",
					"/push-regulator-delete": "regulator_delete",
				};
				const pushed = pushToDevice(deviceId, { type: regTypeMap[req.url!], ...body });
				jsonOk(res, { ok: true, pushed });
				console.log(`[HTTP] ${req.url} → device=${deviceId} pushed=${pushed}`);
				break;
			}
			case "/push-reg-input-add":
			case "/push-reg-input-update":
			case "/push-reg-input-delete": {
				const { deviceId } = body as { deviceId: string };
				const riTypeMap: Record<string, string> = {
					"/push-reg-input-add": "reg_input_add",
					"/push-reg-input-update": "reg_input_update_config",
					"/push-reg-input-delete": "reg_input_delete",
				};
				const pushed = pushToDevice(deviceId, { type: riTypeMap[req.url!], ...body });
				jsonOk(res, { ok: true, pushed });
				console.log(`[HTTP] ${req.url} → device=${deviceId} pushed=${pushed}`);
				break;
			}
			case "/start-reg-input-calibration": {
				const { deviceId, regInputId } = body as { deviceId: string; regInputId: string };
				const ws = deviceSockets.get(deviceId);
				if (!ws || ws.readyState !== WebSocket.OPEN) {
					res.statusCode = 503;
					res.end(JSON.stringify({ ok: false, error: "device offline" }));
					break;
				}
				const existing = calibrationSessions.get(deviceId);
				if (existing && existing.regInputId !== regInputId) {
					res.statusCode = 409;
					res.end(JSON.stringify({ ok: false, error: "another calibration is already running on this device" }));
					break;
				}
				if (existing) clearTimeout(existing.timer);
				const timer = setTimeout(() => stopCalibrationSession(deviceId, true), CAL_TIMEOUT_MS);
				calibrationSessions.set(deviceId, { regInputId, startedAt: Date.now(), timer });
				ws.send(JSON.stringify({ type: "reg_input_calibration_start", id: regInputId }));
				jsonOk(res, { ok: true });
				console.log(`[HTTP] /start-reg-input-calibration → device=${deviceId} id=${regInputId}`);
				break;
			}
			case "/stop-reg-input-calibration": {
				const { deviceId } = body as { deviceId: string };
				stopCalibrationSession(deviceId, true);
				jsonOk(res, { ok: true });
				console.log(`[HTTP] /stop-reg-input-calibration → device=${deviceId}`);
				break;
			}
			case "/ping-device": {
				const { deviceId, timeoutMs } = body as { deviceId: string; timeoutMs?: number };
				const ws = deviceSockets.get(deviceId);
				if (!ws || ws.readyState !== WebSocket.OPEN) {
					jsonOk(res, { online: false });
					break;
				}
				settlePendingPing(deviceId, false); // cancel any in-flight ping
				await sendPingWithState(deviceId);
				const online = await new Promise<boolean>((resolve) => {
					const timer = setTimeout(() => {
						pendingPings.delete(deviceId);
						resolve(false);
					}, timeoutMs ?? 3000);
					pendingPings.set(deviceId, { resolve, timer });
				});
				jsonOk(res, { online });
				console.log(`[HTTP] /ping-device → device=${deviceId} online=${online}`);
				break;
			}
			case "/refresh-device-subscribers": {
				const { deviceId } = body as { deviceId: string };
				const subscribers = await buildDeviceSubscribers(deviceId);
				deviceSubscribers.set(deviceId, subscribers);
				jsonOk(res, { ok: true, subscriberCount: subscribers.size });
				console.log(`[HTTP] /refresh-device-subscribers → device=${deviceId} subscribers=${subscribers.size}`);
				break;
			}
			case "/push-wifi-config": {
				const { deviceId, networks } = body as { deviceId: string; networks: Array<{ ssid: string; password: string }> };
				const pushed = pushToDevice(deviceId, { type: "wifi_config", networks });
				jsonOk(res, { ok: true, pushed });
				console.log(`[HTTP] /push-wifi-config → device=${deviceId} networks=${networks.length} pushed=${pushed}`);
				break;
			}
			case "/push-server-config": {
				const { deviceId, host, port, tls } = body as { deviceId: string; host: string; port: number; tls: boolean };
				const pushed = pushToDevice(deviceId, { type: "server_config", host, port, tls });
				jsonOk(res, { ok: true, pushed });
				console.log(`[HTTP] /push-server-config → device=${deviceId} host=${host}:${port} tls=${tls} pushed=${pushed}`);
				break;
			}
			case "/push-ota": {
				const { deviceId, downloadUrl } = body as { deviceId: string; downloadUrl: string };
				const token = randomBytes(20).toString("hex");
				otaTokens.set(token, { deviceId, expiresAt: Date.now() + 10 * 60 * 1000 }); // 10-minute expiry
				const fullUrl = `${downloadUrl}?token=${token}`;
				const pushed = pushToDevice(deviceId, { type: "ota_update", url: fullUrl });
				jsonOk(res, { ok: true, pushed });
				console.log(`[HTTP] /push-ota → device=${deviceId} pushed=${pushed}`);
				break;
			}
			case "/validate-ota-token": {
				const { token, deviceId } = body as { token: string; deviceId: string };
				const entry = otaTokens.get(token);
				const valid = !!entry && entry.deviceId === deviceId && entry.expiresAt > Date.now();
				if (valid) otaTokens.delete(token); // one-time use
				jsonOk(res, { valid });
				console.log(`[HTTP] /validate-ota-token → device=${deviceId} valid=${valid}`);
				break;
			}
			default:
				res.writeHead(404).end();
		}
	} catch (err) {
		console.error("[HTTP] Handler error:", err);
		res.writeHead(500).end();
	}
}

// ─── Browser connection handler ───────────────────────────────

function handleBrowserConnection(ws: WebSocket) {
	let subscribedUserId: string | null = null;

	ws.on("message", async (raw) => {
		let msg: BrowserSubscribeMsg;
		try {
			msg = JSON.parse(raw.toString()) as BrowserSubscribeMsg;
		} catch {
			return;
		}

		try {
			if (msg.type === "subscribe") {
				const user = await db.user.findUnique({ where: { id: msg.userId }, select: { id: true } });
				if (!user) {
					ws.close();
					return;
				}
				subscribedUserId = user.id;
				if (!browserSockets.has(user.id)) browserSockets.set(user.id, new Set());
				browserSockets.get(user.id)!.add(ws);
				console.log(`[WS] Browser subscribed: userId=${user.id} - total: ${browserSockets.get(user.id)!.size}`);
			}
		} catch (err) {
			console.error("[WS] Browser message handler error:", err);
		}
	});

	ws.on("close", () => {
		if (subscribedUserId) {
			const sockets = browserSockets.get(subscribedUserId);
			sockets?.delete(ws);
			if (sockets?.size === 0) browserSockets.delete(subscribedUserId);
			console.log(`[WS] Browser unsubscribed: userId=${subscribedUserId}`);
		}
	});

	ws.on("error", (err) => console.error("[WS] Browser error:", err.message));
}

// ─── ESP32 connection handler ─────────────────────────────────

function handleDeviceConnection(ws: WebSocket) {
	let authenticatedDeviceId: string | null = null;

	// Periodic ping: syncs authoritative relay states and keeps TCP alive
	const pingInterval = setInterval(() => {
		if (ws.readyState === WebSocket.OPEN && authenticatedDeviceId) {
			sendPingWithState(authenticatedDeviceId).catch((err) => console.error("[WS] pingInterval error:", err));
		}
	}, PING_INTERVAL_MS);

	ws.on("message", async (raw) => {
		let msg: EspMessage;
		try {
			msg = JSON.parse(raw.toString()) as EspMessage;
		} catch {
			return;
		}

		try {
			// ── AUTH ──────────────────────────────────────────────
			if (msg.type === "auth") {
				const { apiKey, macAddress } = msg;
				const key = await db.apiKey.findFirst({
					where: { key: apiKey, active: true },
					select: { id: true, userId: true },
				});
				if (!key) {
					ws.send(JSON.stringify({ type: "auth_fail", reason: "Invalid API key" }));
					ws.close();
					return;
				}

				const device = await db.device.upsert({
					where: { macAddress },
					update: { apiKeyId: key.id, lastSeenAt: new Date() },
					create: { macAddress, name: `ESP32 ${macAddress.slice(-5)}`, apiKeyId: key.id, lastSeenAt: new Date() },
					include: {
						relays: { orderBy: { order: "asc" } },
						switches: { orderBy: { createdAt: "asc" } },
						regulators: { orderBy: { order: "asc" } },
						regulatorInputs: { orderBy: { createdAt: "asc" } },
					},
				});
				// wifiNetworks, cfgServerHost/Port/TLS are scalar fields included automatically

				authenticatedDeviceId = device.id;
				deviceSockets.set(device.id, ws);
				deviceSubscribers.set(device.id, await buildDeviceSubscribers(device.id));

				await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });

				ws.send(
					JSON.stringify({
						type: "auth_ok",
						deviceId: device.id,
						relays: device.relays.map((r) => ({ id: r.id, pin: r.pin, label: r.label, state: r.state, icon: r.icon })),
						switches: device.switches.map((d) => ({
							id: d.id,
							pin: d.pin,
							label: d.label,
							switchType: d.switchType ?? "two_way",
							linkedRelayId: d.linkedRelayId ?? "",
							linkedRegulatorId: d.linkedRegulatorId ?? "",
						})),
						regulators: device.regulators.map((g) => ({ id: g.id, label: g.label, outputPins: g.outputPins, speeds: g.speeds, speed: g.speed })),
						regulatorInputs: device.regulatorInputs.map((ri) => ({ id: ri.id, label: ri.label, pins: ri.pins, linkedRegulatorId: ri.linkedRegulatorId })),
						wifiNetworks: device.wifiNetworks, // server-managed extra networks (wn1–wn4)
						serverConfig: device.cfgServerHost ? { host: device.cfgServerHost, port: device.cfgServerPort, tls: device.cfgServerTLS } : null,
					}),
				);

				broadcastToDeviceSubscribers(device.id, {
					type: "device_update",
					deviceId: device.id,
					lastSeenAt: new Date().toISOString(),
					relays: device.relays.map((r) => ({ id: r.id, state: r.state })),
				});

				console.log(`[WS] Device authenticated: ${device.name} (${macAddress}) id=${device.id} - sockets: ${deviceSockets.size}`);
				return;
			}

			// ── PING ACK ────────────────────────────────────────
			if (msg.type === "ping_ack" && authenticatedDeviceId) {
				settlePendingPing(authenticatedDeviceId, true);
				await db.device.update({ where: { id: authenticatedDeviceId }, data: { lastSeenAt: new Date() } });
				return;
			}

			// ── SWITCH TRIGGER ──────────────────────────────────
			if (msg.type === "switch_trigger" && authenticatedDeviceId) {
				const { linkedRelayId, linkedRegulatorId, desiredState, isToggle } = msg;

				const triggeringDevice = await db.device.findUnique({
					where: { id: authenticatedDeviceId },
					include: { apiKey: true },
				});
				if (!triggeringDevice) return;

				// Switch linked to a regulator → toggle between OFF and lastSpeed
				if (linkedRegulatorId) {
					const regulator = await db.regulator.findFirst({
						where: { id: linkedRegulatorId },
						include: { device: { include: { apiKey: true } } },
					});
					if (!regulator) {
						console.log(`[WS] switch_trigger: regulator ${linkedRegulatorId} not found`);
						return;
					}
					if (regulator.device.apiKey.userId !== triggeringDevice.apiKey.userId) {
						console.log(`[WS] switch_trigger: cross-user regulator access denied`);
						return;
					}

					const goingOff = regulator.speed > 0;
					const newSpeed = goingOff ? 0 : regulator.lastSpeed > 0 ? regulator.lastSpeed : 1;
					// Persist new speed and, when turning OFF, snapshot the just-departed speed as lastSpeed.
					await db.regulator.update({
						where: { id: regulator.id },
						data: {
							speed: newSpeed,
							...(goingOff ? { lastSpeed: regulator.speed } : {}),
							updatedAt: new Date(),
						},
					});
					await db.device.update({ where: { id: authenticatedDeviceId }, data: { lastSeenAt: new Date() } });

					const targetWs = deviceSockets.get(regulator.deviceId);
					if (targetWs?.readyState === WebSocket.OPEN) {
						targetWs.send(JSON.stringify({ type: "regulator_cmd", regulatorId: regulator.id, speed: newSpeed }));
						console.log(`[WS] switch_trigger: regulator_cmd → device ${regulator.deviceId} regulator ${regulator.id} → speed ${newSpeed}`);
					}
					broadcastToDeviceSubscribers(regulator.deviceId, {
						type: "regulator_update",
						deviceId: regulator.deviceId,
						regulatorId: regulator.id,
						speed: newSpeed,
					});
					return;
				}

				// Switch linked to a relay → existing toggle / setState path
				if (!linkedRelayId) return;
				const relay = await db.relay.findFirst({
					where: { id: linkedRelayId },
					include: { device: { include: { apiKey: true } } },
				});
				if (!relay) {
					console.log(`[WS] switch_trigger: relay ${linkedRelayId} not found`);
					return;
				}
				if (relay.device.apiKey.userId !== triggeringDevice.apiKey.userId) {
					console.log(`[WS] switch_trigger: cross-user relay access denied`);
					return;
				}

				const newState = isToggle ? !relay.state : desiredState;
				await db.relay.update({ where: { id: linkedRelayId }, data: { state: newState, updatedAt: new Date() } });
				await db.device.update({ where: { id: authenticatedDeviceId }, data: { lastSeenAt: new Date() } });

				const targetWs = deviceSockets.get(relay.deviceId);
				if (targetWs?.readyState === WebSocket.OPEN) {
					targetWs.send(JSON.stringify({ type: "relay_cmd", relayId: relay.id, pin: relay.pin, state: newState }));
					console.log(`[WS] switch_trigger: relay_cmd → device ${relay.deviceId} relay ${relay.id} → ${newState}`);
				}
				broadcastToDeviceSubscribers(relay.deviceId, { type: "relay_update", deviceId: relay.deviceId, relayId: relay.id, state: newState });
				return;
			}

			// ── RELAY ACK ────────────────────────────────────────
			if (msg.type === "relay_ack" && authenticatedDeviceId) {
				await db.relay.updateMany({
					where: { id: msg.relayId, deviceId: authenticatedDeviceId },
					data: { state: msg.state, updatedAt: new Date() },
				});
				await db.device.update({ where: { id: authenticatedDeviceId }, data: { lastSeenAt: new Date() } });
				broadcastToDeviceSubscribers(authenticatedDeviceId, {
					type: "relay_update",
					deviceId: authenticatedDeviceId,
					relayId: msg.relayId,
					state: msg.state,
				});
				console.log(`[WS] Relay ack: ${msg.relayId} → ${msg.state ? "ON" : "OFF"}`);
			}

			// ── REGULATOR ACK ────────────────────────────────────
			if (msg.type === "regulator_ack" && authenticatedDeviceId) {
				// Mirror non-zero speeds into lastSpeed so switch→regulator toggles can restore them later.
				await db.regulator.updateMany({
					where: { id: msg.regulatorId, deviceId: authenticatedDeviceId },
					data: { speed: msg.speed, ...(msg.speed > 0 ? { lastSpeed: msg.speed } : {}), updatedAt: new Date() },
				});
				await db.device.update({ where: { id: authenticatedDeviceId }, data: { lastSeenAt: new Date() } });
				broadcastToDeviceSubscribers(authenticatedDeviceId, {
					type: "regulator_update",
					deviceId: authenticatedDeviceId,
					regulatorId: msg.regulatorId,
					speed: msg.speed,
				});
				console.log(`[WS] Regulator ack: ${msg.regulatorId} → speed ${msg.speed}`);
			}

			// ── REGULATOR INPUT TRIGGER ─────────────────────────
			// Physical rotary switch detected speed → resolve cross-device regulator
			if (msg.type === "regulator_input_trigger" && authenticatedDeviceId) {
				const { linkedRegulatorId, speed } = msg;

				const regulator = await db.regulator.findFirst({
					where: { id: linkedRegulatorId },
					include: { device: { include: { apiKey: true } } },
				});
				if (!regulator) {
					console.log(`[WS] regulator_input_trigger: regulator ${linkedRegulatorId} not found`);
					return;
				}

				const triggeringDevice = await db.device.findUnique({
					where: { id: authenticatedDeviceId },
					include: { apiKey: true },
				});
				if (regulator.device.apiKey.userId !== triggeringDevice?.apiKey.userId) {
					console.log(`[WS] regulator_input_trigger: cross-user regulator access denied`);
					return;
				}

				await db.regulator.update({
					where: { id: linkedRegulatorId },
					data: { speed, ...(speed > 0 ? { lastSpeed: speed } : {}), updatedAt: new Date() },
				});
				await db.device.update({ where: { id: authenticatedDeviceId }, data: { lastSeenAt: new Date() } });

				const targetWs = deviceSockets.get(regulator.deviceId);
				if (targetWs?.readyState === WebSocket.OPEN) {
					targetWs.send(JSON.stringify({ type: "regulator_cmd", regulatorId: regulator.id, speed }));
					console.log(`[WS] regulator_input_trigger: regulator_cmd → device ${regulator.deviceId} regulator ${regulator.id} → speed ${speed}`);
				}
				broadcastToDeviceSubscribers(regulator.deviceId, { type: "regulator_update", deviceId: regulator.deviceId, regulatorId: regulator.id, speed });
			}

			// ── REG INPUT CALIBRATION SAMPLE ─────────────────────
			// Live ADC stream while a calibration session is active. Authorize by
			// confirming the session matches; drop stale samples silently.
			if (msg.type === "reg_input_calibration_sample" && authenticatedDeviceId) {
				const session = calibrationSessions.get(authenticatedDeviceId);
				if (!session || session.regInputId !== msg.id) return;
				broadcastToDeviceSubscribers(authenticatedDeviceId, {
					type: "reg_input_calibration_sample",
					deviceId: authenticatedDeviceId,
					regInputId: msg.id,
					pin: msg.pin,
					raw: msg.raw,
					ts: Date.now(),
				});
			}

			// ── OTA PROGRESS ─────────────────────────────────────
			if (msg.type === "ota_progress" && authenticatedDeviceId) {
				broadcastToDeviceSubscribers(authenticatedDeviceId, {
					type: "ota_progress",
					deviceId: authenticatedDeviceId,
					percent: (msg as OtaProgressMsg).percent,
				});
				console.log(`[WS] OTA progress: ${authenticatedDeviceId} → ${(msg as OtaProgressMsg).percent}%`);
			}

			// ── OTA RESULT ────────────────────────────────────────
			if (msg.type === "ota_result" && authenticatedDeviceId) {
				const m = msg as OtaResultMsg;
				broadcastToDeviceSubscribers(authenticatedDeviceId, {
					type: "ota_result",
					deviceId: authenticatedDeviceId,
					success: m.success,
					error: m.error,
				});
				console.log(`[WS] OTA result: ${authenticatedDeviceId} → ${m.success ? "success" : `failed: ${m.error}`}`);
			}
		} catch (err) {
			console.error("[WS] Device message handler error:", err);
		}
	});

	ws.on("close", () => {
		clearInterval(pingInterval);
		if (authenticatedDeviceId) {
			if (deviceSockets.get(authenticatedDeviceId) === ws) {
				deviceSockets.delete(authenticatedDeviceId);
				console.log(`[WS] Device disconnected: ${authenticatedDeviceId} - sockets: ${deviceSockets.size}`);
			} else {
				console.log(`[WS] Stale close for ${authenticatedDeviceId} - ignoring`);
			}
			settlePendingPing(authenticatedDeviceId, false);
			stopCalibrationSession(authenticatedDeviceId, false);
		}
	});

	ws.on("error", (err) => console.error("[WS] Device error:", err.message));
}

// ─── Schedule executor ────────────────────────────────────────

const SCHEDULE_CHECK_INTERVAL = 60_000;

/** Extract hour, minute, day-of-month, and weekday (0=Sun) in a given timezone */
function localTimeParts(timezone: string, date: Date) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		hour: "numeric",
		minute: "numeric",
		day: "numeric",
		weekday: "short",
		hour12: false,
	}).formatToParts(date);
	const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
	return {
		hour: n("hour"),
		minute: n("minute"),
		day: n("day"),
		weekday: weekdayMap[parts.find((p) => p.type === "weekday")?.value ?? ""] ?? -1,
	};
}

// Guard against duplicate intervals on HMR reloads
const globalForSchedule = globalThis as unknown as { scheduleStarted?: boolean };
if (!globalForSchedule.scheduleStarted) {
	globalForSchedule.scheduleStarted = true;

	setInterval(async () => {
		try {
			const schedules = await db.relaySchedule.findMany({
				where: { enabled: true },
				include: { relay: { select: { id: true, pin: true, deviceId: true, state: true } } },
			});
			if (schedules.length === 0) return;

			const now = new Date();
			for (const schedule of schedules) {
				const { hour, minute, day, weekday } = localTimeParts(schedule.timezone, now);

				if (hour !== schedule.hour || minute !== schedule.minute) continue;
				if (!schedule.daysOfWeek.includes(weekday)) continue;

				// Prevent double-fire within the same calendar minute
				if (schedule.lastFiredAt) {
					const last = localTimeParts(schedule.timezone, schedule.lastFiredAt);
					if (last.hour === hour && last.minute === minute && last.day === day) continue;
				}

				// Skip if relay is already in the desired state
				if (schedule.relay.state === schedule.action) {
					await db.relaySchedule.update({ where: { id: schedule.id }, data: { lastFiredAt: now } });
					continue;
				}

				await db.relay.update({ where: { id: schedule.relay.id }, data: { state: schedule.action } });
				pushRelayCommand(schedule.relay.deviceId, schedule.relay.id, schedule.relay.pin, schedule.action);
				broadcastToDeviceSubscribers(schedule.relay.deviceId, {
					type: "relay_update",
					deviceId: schedule.relay.deviceId,
					relayId: schedule.relay.id,
					state: schedule.action,
				});
				await db.relaySchedule.update({ where: { id: schedule.id }, data: { lastFiredAt: now } });
				console.log(`[SCHEDULE] Fired: "${schedule.label}" → relay ${schedule.relay.id} → ${schedule.action ? "ON" : "OFF"}`);
			}
		} catch (err) {
			console.error("[SCHEDULE] Error:", err);
		}
	}, SCHEDULE_CHECK_INTERVAL);

	console.log(`[SCHEDULE] Executor started - checking every ${SCHEDULE_CHECK_INTERVAL / 1000}s`);
}

// ─── WSS factory ─────────────────────────────────────────────

export function createWss() {
	const wss = new WebSocketServer({ noServer: true });

	// WS-level heartbeat: detects dead connections that skip the TCP FIN
	// (e.g. sudden Wi-Fi drops). Browser connections have no other keepalive.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const heartbeat = setInterval(() => {
		for (const ws of wss.clients) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			if ((ws as any)._alive === false) {
				ws.terminate();
				continue;
			}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(ws as any)._alive = false;
			ws.ping();
		}
	}, PING_INTERVAL_MS);
	wss.on("close", () => clearInterval(heartbeat));

	wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(ws as any)._alive = true;
		ws.on("pong", () => {
			(ws as any)._alive = true;
		}); // eslint-disable-line @typescript-eslint/no-explicit-any
		const path = parseUrl(req.url ?? "/").pathname ?? "/";
		if (path === "/browser") handleBrowserConnection(ws);
		else handleDeviceConnection(ws);
	});

	return wss;
}

// ─── WSS attacher (used by server.ts in dev) ─────────────────

export function attachWss(server: import("http").Server) {
	const wss = createWss();

	// Collect all upgrade listeners that are NOT ours (Next.js HMR, etc.)
	// This list is dynamic - we intercept future server.on("upgrade") calls so that
	// any listeners Next.js adds lazily (after app.prepare()) also go through here
	// instead of directly onto the server, where they would fire after us and
	// potentially call socket.destroy() on already-upgraded WS connections.
	const externalUpgradeListeners: Function[] = []; // eslint-disable-line @typescript-eslint/no-unsafe-function-type

	// Capture listeners already registered by app.prepare()
	const alreadyRegistered = server.rawListeners("upgrade") as Function[]; // eslint-disable-line @typescript-eslint/no-unsafe-function-type
	externalUpgradeListeners.push(...alreadyRegistered);
	server.removeAllListeners("upgrade");

	// Intercept future registrations for the "upgrade" event
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const _origOn = server.on.bind(server) as (...args: any[]) => typeof server;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(server as any).on = (server as any).addListener = function (event: string, listener: (...args: unknown[]) => void) {
		if (event === "upgrade") {
			externalUpgradeListeners.push(listener);
			return this;
		}
		return _origOn(event, listener);
	};

	// Single combined upgrade router - our paths first, then delegate the rest
	_origOn("upgrade", (req: IncomingMessage, socket: import("net").Socket, head: Buffer) => {
		const path = parseUrl(req.url ?? "/").pathname ?? "/";
		if (path === "/" || path === "/browser") {
			wss.handleUpgrade(req, socket, head, (ws) => {
				wss.emit("connection", ws, req);
			});
		} else {
			for (const listener of externalUpgradeListeners) {
				listener.call(server, req, socket, head);
			}
		}
	});

	return wss;
}

// ─── Standalone mode (Docker / npm run ws) ────────────────────

const isMain = process.argv[1] === new URL(import.meta.url).pathname;
if (isMain) {
	const httpServer = createServer((req, res) => {
		void wsRequestHandler(req, res);
	});
	const wss = attachWss(httpServer);
	httpServer.listen(PORT, () => {
		console.log(`[WS] SmartHUB server listening on port ${PORT}`);
	});
	process.on("SIGTERM", async () => {
		console.log("[WS] Shutting down…");
		wss.close();
		await db.$disconnect();
		httpServer.close(() => process.exit(0));
	});
}
