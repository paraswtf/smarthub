/**
 * ESP Hub WebSocket + HTTP server
 *
 * Usage: npm run ws
 *
 * Port (WS_PORT, default 4001) handles:
 *   - WebSocket connections from ESP32 devices  →  ws://host:PORT/
 *   - WebSocket connections from browsers       →  ws://host:PORT/browser
 *   - Internal HTTP POST /push-relay            →  called by tRPC toggleRelay
 *
 * ─── ESP32 protocol ──────────────────────────────────────────
 *   ESP32 → Server
 *     { type: "auth",      apiKey, macAddress, deviceId? }
 *     { type: "heartbeat", deviceId, relayStates: [{id,state}] }
 *     { type: "relay_ack", relayId, state }
 *
 *   Server → ESP32
 *     { type: "auth_ok",   deviceId, relays: [{id,pin,label,state}] }
 *     { type: "auth_fail", reason }
 *     { type: "relay_cmd", relayId, pin, state }
 *     { type: "ping" }
 *
 * ─── Browser protocol ────────────────────────────────────────
 *   Browser → Server: { type: "subscribe", userId }
 *   Server → Browser: { type: "device_update", deviceId, lastSeenAt, relays: [{id,state}] }
 *                     { type: "relay_update",  deviceId, relayId, state }
 */

import { WebSocketServer, WebSocket } from "ws";
import { PrismaClient } from "@prisma/client";
import { createServer, type IncomingMessage } from "http";
import { parse as parseUrl } from "url";

const db = new PrismaClient();
const PORT = Number(process.env.WS_PORT ?? 4001);
const WS_SECRET = process.env.WS_SECRET ?? "";

// Map: deviceId → ESP32 WebSocket
const deviceSockets = new Map<string, WebSocket>();
// Map: userId   → Set of browser WebSocket connections
const browserSockets = new Map<string, Set<WebSocket>>();

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
	// Prune sockets that closed without firing the close event
	for (const ws of dead) sockets.delete(ws);
	if (sockets.size === 0) browserSockets.delete(userId);
	if ((payload as { type: string }).type === "relay_update") {
		console.log(`[WS] broadcast relay_update → userId=${userId} sent=${sent} dead_pruned=${dead.length}`);
	}
}

function removeBrowserSocket(userId: string, ws: WebSocket) {
	const sockets = browserSockets.get(userId);
	if (!sockets) return;
	sockets.delete(ws);
	if (sockets.size === 0) browserSockets.delete(userId);
}

function pushRelayCommand(deviceId: string, relayId: string, pin: number, state: boolean): boolean {
	const ws = deviceSockets.get(deviceId);
	if (!ws || ws.readyState !== WebSocket.OPEN) return false;
	ws.send(JSON.stringify({ type: "relay_cmd", relayId, pin, state }));
	return true;
}

// ─── Types ────────────────────────────────────────────────────

interface AuthMsg {
	type: "auth";
	apiKey: string;
	macAddress: string;
	deviceId?: string;
}
interface HeartbeatMsg {
	type: "heartbeat";
	deviceId: string;
	relayStates?: { id: string; state: boolean }[];
}
interface RelayAckMsg {
	type: "relay_ack";
	relayId: string;
	state: boolean;
}
interface DetectorTriggerMsg {
	type: "detector_trigger";
	linkedRelayId: string;
	desiredState: boolean;
	isToggle: boolean;
}
type EspMessage = AuthMsg | HeartbeatMsg | RelayAckMsg | DetectorTriggerMsg;

interface BrowserSubscribeMsg {
	type: "subscribe";
	userId: string;
}

// ─── HTTP server ──────────────────────────────────────────────
// Serves both WebSocket upgrades and the internal /push-relay endpoint.

const httpServer = createServer((req, res) => {
	if (req.method === "POST" && req.url === "/push-relay") {
		const secret = req.headers["x-internal-secret"] ?? "";
		if (WS_SECRET && secret !== WS_SECRET) {
			res.writeHead(403, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Forbidden" }));
			return;
		}
		let body = "";
		req.on("data", (chunk: Buffer) => {
			body += chunk.toString();
		});
		req.on("end", () => {
			try {
				const { deviceId, relayId, pin, state } = JSON.parse(body) as {
					deviceId: string;
					relayId: string;
					pin: number;
					state: boolean;
				};
				const pushed = pushRelayCommand(deviceId, relayId, pin, state);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ ok: true, pushed }));
				console.log(`[HTTP] /push-relay → deviceId=${deviceId} relayId=${relayId} state=${state} pushed=${pushed} connectedDevices=[${[...deviceSockets.keys()].join(",")}]`);
			} catch {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Bad request" }));
			}
		});
		return;
	}

	// Internal endpoint: POST /push-relay-update
	// Called by tRPC updateRelay to notify a connected ESP32 of a changed relay
	if (req.method === "POST" && req.url === "/push-relay-update") {
		const secret = req.headers["x-internal-secret"] ?? "";
		if (WS_SECRET && secret !== WS_SECRET) {
			res.writeHead(403, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Forbidden" }));
			return;
		}
		let body = "";
		req.on("data", (chunk: Buffer) => {
			body += chunk.toString();
		});
		req.on("end", () => {
			try {
				const { deviceId, relay } = JSON.parse(body) as {
					deviceId: string;
					relay: { id: string; pin: number; label: string; state: boolean; icon: string };
				};
				const ws = deviceSockets.get(deviceId);
				let pushed = false;
				if (ws && ws.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify({ type: "relay_update_config", relay }));
					pushed = true;
				}
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ ok: true, pushed }));
				console.log(`[HTTP] /push-relay-update → deviceId=${deviceId} relayId=${relay.id} pin=${relay.pin} pushed=${pushed}`);
			} catch {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Bad request" }));
			}
		});
		return;
	}
	// Called by tRPC addRelay to notify a connected ESP32 of a new relay
	if (req.method === "POST" && req.url === "/push-relay-add") {
		const secret = req.headers["x-internal-secret"] ?? "";
		if (WS_SECRET && secret !== WS_SECRET) {
			res.writeHead(403, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Forbidden" }));
			return;
		}
		let body = "";
		req.on("data", (chunk: Buffer) => {
			body += chunk.toString();
		});
		req.on("end", () => {
			try {
				const { deviceId, relay } = JSON.parse(body) as {
					deviceId: string;
					relay: { id: string; pin: number; label: string; state: boolean; icon: string };
				};
				const ws = deviceSockets.get(deviceId);
				let pushed = false;
				if (ws && ws.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify({ type: "relay_add", relay }));
					pushed = true;
				}
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ ok: true, pushed }));
				console.log(`[HTTP] /push-relay-add → deviceId=${deviceId} relayId=${relay.id} pin=${relay.pin} pushed=${pushed}`);
			} catch {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Bad request" }));
			}
		});
		return;
	}
	// ── Detector push endpoints ───────────────────────────────
	for (const url of ["/push-detector-add", "/push-detector-update", "/push-detector-delete"]) {
		if (req.method === "POST" && req.url === url) {
			const secret = req.headers["x-internal-secret"] ?? "";
			if (WS_SECRET && secret !== WS_SECRET) {
				res.writeHead(403).end();
				return;
			}
			let body = "";
			req.on("data", (chunk: Buffer) => {
				body += chunk.toString();
			});
			req.on("end", () => {
				try {
					const data = JSON.parse(body) as { deviceId: string; [k: string]: unknown };
					const typeMap: Record<string, string> = {
						"/push-detector-add": "detector_add",
						"/push-detector-update": "detector_update_config",
						"/push-detector-delete": "detector_delete"
					};
					const pushed = pushToDevice(data.deviceId, { type: typeMap[url], ...data });
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ ok: true, pushed }));
					console.log(`[HTTP] ${url} → deviceId=${data.deviceId} pushed=${pushed}`);
				} catch {
					res.writeHead(400).end();
				}
			});
			return;
		}
	}

	res.writeHead(404).end();
});

// ─── Helper to push a message to a device ────────────────────

function pushToDevice(deviceId: string, payload: object): boolean {
	const ws = deviceSockets.get(deviceId);
	if (!ws || ws.readyState !== WebSocket.OPEN) return false;
	ws.send(JSON.stringify(payload));
	return true;
}

const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, () => {
	console.log(`[WS] ESP Hub server listening on port ${PORT}`);
});

// ─── WebSocket routing ────────────────────────────────────────

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
	const path = parseUrl(req.url ?? "/").pathname ?? "/";
	if (path === "/browser") {
		handleBrowserConnection(ws);
	} else {
		handleDeviceConnection(ws);
	}
});

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

		if (msg.type === "subscribe") {
			const user = await db.user.findUnique({ where: { id: msg.userId }, select: { id: true } });
			if (!user) {
				ws.close();
				return;
			}
			subscribedUserId = user.id;
			if (!browserSockets.has(user.id)) browserSockets.set(user.id, new Set());
			browserSockets.get(user.id)!.add(ws);
			const count = browserSockets.get(user.id)!.size;
			console.log(`[WS] Browser subscribed: userId=${user.id} — total browser sockets for user: ${count}`);
		}
	});

	ws.on("close", () => {
		if (subscribedUserId) {
			removeBrowserSocket(subscribedUserId, ws);
			console.log(`[WS] Browser unsubscribed: userId=${subscribedUserId}`);
		}
	});

	ws.on("error", (err) => console.error("[WS] Browser error:", err.message));
}

// ─── ESP32 connection handler ─────────────────────────────────

function handleDeviceConnection(ws: WebSocket) {
	let authenticatedDeviceId: string | null = null;
	let deviceUserId: string | null = null;

	const pingInterval = setInterval(() => {
		if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
	}, 30_000);

	ws.on("message", async (raw) => {
		let msg: EspMessage;
		try {
			msg = JSON.parse(raw.toString()) as EspMessage;
		} catch {
			return;
		}

		// ── AUTH ────────────────────────────────────────────────
		if (msg.type === "auth") {
			const { apiKey, macAddress } = msg;
			const key = await db.apiKey.findFirst({
				where: { key: apiKey, active: true },
				select: { id: true, userId: true }
			});
			if (!key) {
				ws.send(JSON.stringify({ type: "auth_fail", reason: "Invalid API key" }));
				ws.close();
				return;
			}

			const now = new Date();
			const device = await db.device.upsert({
				where: { macAddress },
				update: { lastSeenAt: now, apiKeyId: key.id },
				create: { macAddress, name: `ESP32 ${macAddress.slice(-5)}`, lastSeenAt: now, apiKeyId: key.id },
				include: {
					relays: { orderBy: { order: "asc" } },
					detectors: { orderBy: { createdAt: "asc" } }
				}
			});

			authenticatedDeviceId = device.id;
			deviceUserId = key.userId;
			deviceSockets.set(device.id, ws);

			await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: now } });

			ws.send(
				JSON.stringify({
					type: "auth_ok",
					deviceId: device.id,
					relays: device.relays.map((r) => ({ id: r.id, pin: r.pin, label: r.label, state: r.state, icon: r.icon })),
					detectors: device.detectors.map((d) => ({ id: d.id, pin: d.pin, label: d.label, mode: d.mode, pullMode: d.pullMode, switchType: d.switchType ?? "latching", linkedRelayId: d.linkedRelayId }))
				})
			);

			broadcastToUser(key.userId, {
				type: "device_update",
				deviceId: device.id,
				lastSeenAt: now.toISOString(),
				relays: device.relays.map((r) => ({ id: r.id, state: r.state }))
			});

			console.log(`[WS] Device authenticated: ${device.name} (${macAddress}) id=${device.id} — sockets: ${deviceSockets.size}`);
			return;
		}

		// ── HEARTBEAT ──────────────────────────────────────────
		if (msg.type === "heartbeat" && authenticatedDeviceId) {
			const now = new Date();

			// Update lastSeenAt only — do NOT overwrite relay states from ESP32.
			// The DB is the source of truth for desired state. The ESP32 syncs
			// to the DB via heartbeat_ack, not the other way around.
			await db.device.update({
				where: { id: authenticatedDeviceId },
				data: { lastSeenAt: now }
			});

			// Fetch authoritative relay states from DB and send back to ESP32
			const relays = await db.relay.findMany({
				where: { deviceId: authenticatedDeviceId },
				orderBy: { order: "asc" }
			});

			ws.send(
				JSON.stringify({
					type: "heartbeat_ack",
					relays: relays.map((r) => ({ id: r.id, pin: r.pin, state: r.state }))
				})
			);

			if (deviceUserId) {
				broadcastToUser(deviceUserId, {
					type: "device_update",
					deviceId: authenticatedDeviceId,
					lastSeenAt: now.toISOString(),
					relays: relays.map((r) => ({ id: r.id, state: r.state }))
				});
			}
			return;
		}

		// ── DETECTOR TRIGGER ───────────────────────────────────
		if (msg.type === "detector_trigger" && authenticatedDeviceId) {
			const { linkedRelayId, desiredState, isToggle } = msg;

			// Find the relay — may be on a different device
			const relay = await db.relay.findFirst({
				where: { id: linkedRelayId },
				include: { device: { include: { apiKey: true } } }
			});

			if (!relay) {
				console.log(`[WS] detector_trigger: relay ${linkedRelayId} not found`);
				return;
			}

			// Security: relay must belong to same user as the triggering device
			const triggeringDevice = await db.device.findUnique({
				where: { id: authenticatedDeviceId },
				include: { apiKey: true }
			});
			if (relay.device.apiKey.userId !== triggeringDevice?.apiKey.userId) {
				console.log(`[WS] detector_trigger: cross-user relay access denied`);
				return;
			}

			const newState = isToggle ? !relay.state : desiredState;

			// Write DB
			await db.relay.update({
				where: { id: linkedRelayId },
				data: { state: newState, updatedAt: new Date() }
			});

			// Push relay_cmd to the relay's device (may be a different ESP32)
			const targetWs = deviceSockets.get(relay.deviceId);
			if (targetWs && targetWs.readyState === WebSocket.OPEN) {
				targetWs.send(JSON.stringify({ type: "relay_cmd", relayId: relay.id, pin: relay.pin, state: newState }));
				console.log(`[WS] detector_trigger: relay_cmd → device ${relay.deviceId} relay ${relay.id} → ${newState}`);
			}

			// Broadcast to browser
			if (deviceUserId) {
				broadcastToUser(deviceUserId, { type: "relay_update", deviceId: relay.deviceId, relayId: relay.id, state: newState });
			}
			return;
		}
		if (msg.type === "relay_ack" && authenticatedDeviceId) {
			// Confirm the actual GPIO state the ESP32 applied
			await db.relay.updateMany({
				where: { id: msg.relayId, deviceId: authenticatedDeviceId },
				data: { state: msg.state, updatedAt: new Date() }
			});

			if (deviceUserId) {
				broadcastToUser(deviceUserId, {
					type: "relay_update",
					deviceId: authenticatedDeviceId,
					relayId: msg.relayId,
					state: msg.state
				});
			}
			console.log(`[WS] Relay ack: ${msg.relayId} → ${msg.state ? "ON" : "OFF"}`);
		}
	});

	ws.on("close", async () => {
		clearInterval(pingInterval);
		if (authenticatedDeviceId) {
			// Only remove from map if THIS socket is still the active one.
			// If the device reconnected before this close event fired, a new socket
			// has already replaced this one in the map — don't delete it.
			if (deviceSockets.get(authenticatedDeviceId) === ws) {
				deviceSockets.delete(authenticatedDeviceId);
				console.log(`[WS] Device disconnected: ${authenticatedDeviceId} — sockets: ${deviceSockets.size}`);
			} else {
				console.log(`[WS] Stale close for ${authenticatedDeviceId} — new socket already registered, ignoring`);
			}
		}
	});

	ws.on("error", (err) => console.error("[WS] Device error:", err.message));
}

// ─── Graceful shutdown ────────────────────────────────────────

process.on("SIGTERM", async () => {
	console.log("[WS] Shutting down…");
	await db.$disconnect();
	httpServer.close(() => process.exit(0));
});
