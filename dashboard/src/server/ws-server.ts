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
import { createServer, type IncomingMessage } from "http";
import { parse as parseUrl } from "url";

const db = new PrismaClient();
const PORT = Number(process.env.WS_PORT ?? 4001);
const WS_SECRET = process.env.WS_SECRET ?? "";

// Map: deviceId → ESP32 WebSocket
const deviceSockets = new Map<string, WebSocket>();
// Map: userId   → Set of browser WebSocket connections
const browserSockets = new Map<string, Set<WebSocket>>();
// Map: deviceId → pending on-demand ping resolve/timer
const pendingPings = new Map<string, { resolve: (online: boolean) => void; timer: ReturnType<typeof setTimeout> }>();
// Map: deviceId → Set of userIds who should receive updates (owner + shared users)
const deviceSubscribers = new Map<string, Set<string>>();

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

/** Build the subscriber set for a device (owner + relay/room/home shared users) */
async function buildDeviceSubscribers(deviceId: string): Promise<Set<string>> {
	const device = await db.device.findFirst({
		where: { id: deviceId },
		select: {
			homeId: true,
			apiKey: { select: { userId: true } },
			relays: {
				select: {
					id: true,
					roomId: true,
					shares: { select: { userId: true } }
				}
			}
		}
	});
	if (!device) return new Set();

	const subscribers = new Set([device.apiKey.userId]);

	// 1. Direct relay shares on this device's relays
	for (const relay of device.relays) {
		for (const s of relay.shares) subscribers.add(s.userId);
	}

	// 2. Room shares for rooms that contain this device's relays
	const roomIds = [...new Set(device.relays.map((r) => r.roomId).filter(Boolean))] as string[];
	if (roomIds.length > 0) {
		const roomShares = await db.roomShare.findMany({
			where: { roomId: { in: roomIds } },
			select: { userId: true }
		});
		for (const s of roomShares) subscribers.add(s.userId);
	}

	// 3. Home share (device's home shared with user)
	if (device.homeId) {
		const homeShares = await db.homeShare.findMany({
			where: { homeId: device.homeId },
			select: { userId: true }
		});
		for (const s of homeShares) subscribers.add(s.userId);
	}

	return subscribers;
}

/** Broadcast a payload to all subscribers of a device */
function broadcastToDeviceSubscribers(deviceId: string, payload: object) {
	const subscribers = deviceSubscribers.get(deviceId);
	if (!subscribers) return;
	for (const userId of subscribers) {
		broadcastToUser(userId, payload);
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
	const relays = await db.relay.findMany({
		where: { deviceId },
		orderBy: { order: "asc" }
	});
	ws.send(
		JSON.stringify({
			type: "ping",
			relays: relays.map((r) => ({ id: r.id, pin: r.pin, state: r.state }))
		})
	);
	return true;
}

/** Resolve a pending on-demand ping */
function resolvePendingPing(deviceId: string) {
	const pending = pendingPings.get(deviceId);
	if (!pending) return;
	clearTimeout(pending.timer);
	pending.resolve(true);
	pendingPings.delete(deviceId);
}

/** Fail a pending on-demand ping */
function failPendingPing(deviceId: string) {
	const pending = pendingPings.get(deviceId);
	if (!pending) return;
	clearTimeout(pending.timer);
	pending.resolve(false);
	pendingPings.delete(deviceId);
}

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
	linkedRelayId: string;
	desiredState: boolean;
	isToggle: boolean;
}
type EspMessage = AuthMsg | RelayAckMsg | PingAckMsg | SwitchTriggerMsg;

interface BrowserSubscribeMsg {
	type: "subscribe";
	userId: string;
}

// ─── HTTP server ──────────────────────────────────────────────

const httpServer = createServer((req, res) => {
	const secret = req.headers["x-internal-secret"] ?? "";
	const authorized = !WS_SECRET || secret === WS_SECRET;

	// ── /push-relay ───────────────────────────────────────────
	if (req.method === "POST" && req.url === "/push-relay") {
		if (!authorized) {
			res.writeHead(403).end();
			return;
		}
		let body = "";
		req.on("data", (c: Buffer) => {
			body += c.toString();
		});
		req.on("end", () => {
			try {
				const { deviceId, relayId, pin, state } = JSON.parse(body);
				const pushed = pushRelayCommand(deviceId, relayId, pin, state);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ ok: true, pushed }));
				console.log(`[HTTP] /push-relay → device=${deviceId} relay=${relayId} state=${state} pushed=${pushed}`);
			} catch {
				res.writeHead(400).end();
			}
		});
		return;
	}

	// ── /push-relay-update ────────────────────────────────────
	if (req.method === "POST" && req.url === "/push-relay-update") {
		if (!authorized) {
			res.writeHead(403).end();
			return;
		}
		let body = "";
		req.on("data", (c: Buffer) => {
			body += c.toString();
		});
		req.on("end", () => {
			try {
				const { deviceId, relay } = JSON.parse(body);
				const pushed = pushToDevice(deviceId, { type: "relay_update_config", relay });
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ ok: true, pushed }));
				console.log(`[HTTP] /push-relay-update → device=${deviceId} relay=${relay.id} pushed=${pushed}`);
			} catch {
				res.writeHead(400).end();
			}
		});
		return;
	}

	// ── /push-relay-add ───────────────────────────────────────
	if (req.method === "POST" && req.url === "/push-relay-add") {
		if (!authorized) {
			res.writeHead(403).end();
			return;
		}
		let body = "";
		req.on("data", (c: Buffer) => {
			body += c.toString();
		});
		req.on("end", () => {
			try {
				const { deviceId, relay } = JSON.parse(body);
				const pushed = pushToDevice(deviceId, { type: "relay_add", relay });
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ ok: true, pushed }));
				console.log(`[HTTP] /push-relay-add → device=${deviceId} relay=${relay.id} pushed=${pushed}`);
			} catch {
				res.writeHead(400).end();
			}
		});
		return;
	}

	// ── Switch push endpoints ────────────────────────────────
	for (const url of ["/push-switch-add", "/push-switch-update", "/push-switch-delete"]) {
		if (req.method === "POST" && req.url === url) {
			if (!authorized) {
				res.writeHead(403).end();
				return;
			}
			let body = "";
			req.on("data", (c: Buffer) => {
				body += c.toString();
			});
			req.on("end", () => {
				try {
					const data = JSON.parse(body) as { deviceId: string; [k: string]: unknown };
					const typeMap: Record<string, string> = {
						"/push-switch-add": "switch_add",
						"/push-switch-update": "switch_update_config",
						"/push-switch-delete": "switch_delete"
					};
					const pushed = pushToDevice(data.deviceId, { type: typeMap[url], ...data });
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ ok: true, pushed }));
					console.log(`[HTTP] ${url} → device=${data.deviceId} pushed=${pushed}`);
				} catch {
					res.writeHead(400).end();
				}
			});
			return;
		}
	}

	// ── /ping-device — on-demand ping from tRPC ───────────────
	if (req.method === "POST" && req.url === "/ping-device") {
		if (!authorized) {
			res.writeHead(403).end();
			return;
		}
		let body = "";
		req.on("data", (c: Buffer) => {
			body += c.toString();
		});
		req.on("end", async () => {
			try {
				const { deviceId, timeoutMs } = JSON.parse(body) as { deviceId: string; timeoutMs?: number };
				const ws = deviceSockets.get(deviceId);

				// Not connected — fail fast
				if (!ws || ws.readyState !== WebSocket.OPEN) {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ online: false }));
					return;
				}

				// Cancel existing pending ping for this device
				failPendingPing(deviceId);

				// Send ping with authoritative relay states
				await sendPingWithState(deviceId);

				// Wait for ping_ack or timeout
				const timeout = timeoutMs ?? 3000;
				const online = await new Promise<boolean>((resolve) => {
					const timer = setTimeout(() => {
						pendingPings.delete(deviceId);
						resolve(false);
					}, timeout);
					pendingPings.set(deviceId, { resolve, timer });
				});

				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ online }));
				console.log(`[HTTP] /ping-device → device=${deviceId} online=${online}`);
			} catch {
				res.writeHead(400).end();
			}
		});
		return;
	}

	// ── /refresh-device-subscribers — called when shares change ──
	if (req.method === "POST" && req.url === "/refresh-device-subscribers") {
		if (!authorized) {
			res.writeHead(403).end();
			return;
		}
		let body = "";
		req.on("data", (c: Buffer) => {
			body += c.toString();
		});
		req.on("end", async () => {
			try {
				const { deviceId } = JSON.parse(body) as { deviceId: string };
				const subscribers = await buildDeviceSubscribers(deviceId);
				deviceSubscribers.set(deviceId, subscribers);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ ok: true, subscriberCount: subscribers.size }));
				console.log(`[HTTP] /refresh-device-subscribers → device=${deviceId} subscribers=${subscribers.size}`);
			} catch {
				res.writeHead(400).end();
			}
		});
		return;
	}

	res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, () => {
	console.log(`[WS] SmartHUB server listening on port ${PORT}`);
});

// ─── WebSocket routing ────────────────────────────────────────

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
	const path = parseUrl(req.url ?? "/").pathname ?? "/";
	if (path === "/browser") handleBrowserConnection(ws);
	else handleDeviceConnection(ws);
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
			console.log(`[WS] Browser subscribed: userId=${user.id} — total: ${browserSockets.get(user.id)!.size}`);
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

	// Periodic ping: sends authoritative relay states, keeps TCP alive
	const pingInterval = setInterval(async () => {
		if (ws.readyState === WebSocket.OPEN && authenticatedDeviceId) {
			await sendPingWithState(authenticatedDeviceId);
		}
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

			const device = await db.device.upsert({
				where: { macAddress },
				update: { apiKeyId: key.id, lastSeenAt: new Date() },
				create: { macAddress, name: `ESP32 ${macAddress.slice(-5)}`, apiKeyId: key.id, lastSeenAt: new Date() },
				include: {
					relays: { orderBy: { order: "asc" } },
					switches: { orderBy: { createdAt: "asc" } }
				}
			});

			authenticatedDeviceId = device.id;
			deviceUserId = key.userId;
			deviceSockets.set(device.id, ws);

			// Build subscriber set (owner + shared users)
			const subscribers = await buildDeviceSubscribers(device.id);
			deviceSubscribers.set(device.id, subscribers);

			await db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });

			ws.send(
				JSON.stringify({
					type: "auth_ok",
					deviceId: device.id,
					relays: device.relays.map((r) => ({ id: r.id, pin: r.pin, label: r.label, state: r.state, icon: r.icon })),
					switches: device.switches.map((d) => ({ id: d.id, pin: d.pin, label: d.label, switchType: d.switchType ?? "two_way", linkedRelayId: d.linkedRelayId }))
				})
			);

			broadcastToDeviceSubscribers(device.id, {
				type: "device_update",
				deviceId: device.id,
				lastSeenAt: new Date().toISOString(),
				relays: device.relays.map((r) => ({ id: r.id, state: r.state }))
			});

			console.log(`[WS] Device authenticated: ${device.name} (${macAddress}) id=${device.id} — sockets: ${deviceSockets.size}`);
			return;
		}

		// ── PING ACK ──────────────────────────────────────────
		if (msg.type === "ping_ack" && authenticatedDeviceId) {
			resolvePendingPing(authenticatedDeviceId);
			await db.device.update({ where: { id: authenticatedDeviceId }, data: { lastSeenAt: new Date() } });
			return;
		}

		// ── SWITCH TRIGGER ────────────────────────────────────
		if (msg.type === "switch_trigger" && authenticatedDeviceId) {
			const { linkedRelayId, desiredState, isToggle } = msg;

			const relay = await db.relay.findFirst({
				where: { id: linkedRelayId },
				include: { device: { include: { apiKey: true } } }
			});
			if (!relay) {
				console.log(`[WS] switch_trigger: relay ${linkedRelayId} not found`);
				return;
			}

			const triggeringDevice = await db.device.findUnique({
				where: { id: authenticatedDeviceId },
				include: { apiKey: true }
			});
			if (relay.device.apiKey.userId !== triggeringDevice?.apiKey.userId) {
				console.log(`[WS] switch_trigger: cross-user relay access denied`);
				return;
			}

			const newState = isToggle ? !relay.state : desiredState;

			await db.relay.update({
				where: { id: linkedRelayId },
				data: { state: newState, updatedAt: new Date() }
			});
			await db.device.update({ where: { id: authenticatedDeviceId }, data: { lastSeenAt: new Date() } });

			const targetWs = deviceSockets.get(relay.deviceId);
			if (targetWs && targetWs.readyState === WebSocket.OPEN) {
				targetWs.send(JSON.stringify({ type: "relay_cmd", relayId: relay.id, pin: relay.pin, state: newState }));
				console.log(`[WS] switch_trigger: relay_cmd → device ${relay.deviceId} relay ${relay.id} → ${newState}`);
			}

			broadcastToDeviceSubscribers(relay.deviceId, { type: "relay_update", deviceId: relay.deviceId, relayId: relay.id, state: newState });
			return;
		}

		// ── RELAY ACK ──────────────────────────────────────────
		if (msg.type === "relay_ack" && authenticatedDeviceId) {
			await db.relay.updateMany({
				where: { id: msg.relayId, deviceId: authenticatedDeviceId },
				data: { state: msg.state, updatedAt: new Date() }
			});
			await db.device.update({ where: { id: authenticatedDeviceId }, data: { lastSeenAt: new Date() } });

			broadcastToDeviceSubscribers(authenticatedDeviceId, {
				type: "relay_update",
				deviceId: authenticatedDeviceId,
				relayId: msg.relayId,
				state: msg.state
			});
			console.log(`[WS] Relay ack: ${msg.relayId} → ${msg.state ? "ON" : "OFF"}`);
		}
	});

	ws.on("close", () => {
		clearInterval(pingInterval);
		if (authenticatedDeviceId) {
			if (deviceSockets.get(authenticatedDeviceId) === ws) {
				deviceSockets.delete(authenticatedDeviceId);
				console.log(`[WS] Device disconnected: ${authenticatedDeviceId} — sockets: ${deviceSockets.size}`);
			} else {
				console.log(`[WS] Stale close for ${authenticatedDeviceId} — ignoring`);
			}
			failPendingPing(authenticatedDeviceId);
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
