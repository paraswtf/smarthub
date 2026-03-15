/**
 * WebSocket server for real-time ESP32 ↔ dashboard communication.
 *
 * This file is meant to run as a standalone Node.js server alongside
 * the Next.js app (or as a separate service). It is NOT a Next.js route.
 *
 * Usage:
 *   npx ts-node --esm src/server/ws-server.ts
 *   # or add to package.json: "ws": "tsx src/server/ws-server.ts"
 *
 * Message protocol (JSON over WebSocket):
 *
 *   ESP32 → Server
 *   ──────────────
 *   { type: "auth",      apiKey, macAddress, deviceId? }
 *   { type: "heartbeat", deviceId, relayStates: [{id,state}] }
 *   { type: "relay_ack", relayId, state }   // after executing a command
 *
 *   Server → ESP32
 *   ──────────────
 *   { type: "auth_ok",   deviceId, relays: [{id,pin,label,state}] }
 *   { type: "auth_fail", reason }
 *   { type: "relay_cmd", relayId, pin, state }   // toggle command
 *   { type: "ping" }
 *
 *   Dashboard → Server (via POST /api/esp/ws-relay)
 *   ─────────────────────────────────────────────
 *   Triggers server to push relay_cmd to the target ESP32.
 */

import { WebSocketServer, WebSocket } from "ws";
import { PrismaClient } from "@prisma/client";
import type { IncomingMessage } from "http";

const db = new PrismaClient();
const PORT = Number(process.env.WS_PORT ?? 4001);

// Map: deviceId → WebSocket connection
const deviceSockets = new Map<string, WebSocket>();

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
type EspMessage = AuthMsg | HeartbeatMsg | RelayAckMsg;

// ─── Server ──────────────────────────────────────────────────

const wss = new WebSocketServer({ port: PORT });

console.log(`[WS] ESP Hub WebSocket server listening on ws://localhost:${PORT}`);

wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
  let authenticatedDeviceId: string | null = null;

  // Ping/pong keepalive
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "ping" }));
    }
  }, 30_000);

  ws.on("message", async (raw) => {
    let msg: EspMessage;
    try {
      msg = JSON.parse(raw.toString()) as EspMessage;
    } catch {
      return;
    }

    // ── AUTH ──────────────────────────────────────────────
    if (msg.type === "auth") {
      const { apiKey, macAddress } = msg;
      const key = await db.apiKey.findFirst({
        where: { key: apiKey, active: true },
      });

      if (!key) {
        ws.send(JSON.stringify({ type: "auth_fail", reason: "Invalid API key" }));
        ws.close();
        return;
      }

      // Upsert device
      const device = await db.device.upsert({
        where: { macAddress },
        update: { online: true, lastSeenAt: new Date(), apiKeyId: key.id },
        create: {
          macAddress,
          name: `ESP32 ${macAddress.slice(-5)}`,
          online: true,
          lastSeenAt: new Date(),
          apiKeyId: key.id,
        },
        include: { relays: { orderBy: { order: "asc" } } },
      });

      authenticatedDeviceId = device.id;
      deviceSockets.set(device.id, ws);

      // Update key last used
      await db.apiKey.update({
        where: { id: key.id },
        data: { lastUsedAt: new Date() },
      });

      ws.send(
        JSON.stringify({
          type: "auth_ok",
          deviceId: device.id,
          relays: device.relays.map((r) => ({
            id: r.id,
            pin: r.pin,
            label: r.label,
            state: r.state,
            icon: r.icon,
          })),
        })
      );

      console.log(`[WS] Device authenticated: ${device.name} (${macAddress})`);
      return;
    }

    // ── HEARTBEAT ─────────────────────────────────────────
    if (msg.type === "heartbeat" && authenticatedDeviceId) {
      const { relayStates } = msg;

      // Reconcile reported states
      if (relayStates?.length) {
        await Promise.all(
          relayStates.map(({ id, state }) =>
            db.relay.updateMany({
              where: { id, deviceId: authenticatedDeviceId! },
              data: { state },
            })
          )
        );
      }

      await db.device.update({
        where: { id: authenticatedDeviceId },
        data: { online: true, lastSeenAt: new Date() },
      });

      // Respond with authoritative relay states (dashboard may have changed them)
      const relays = await db.relay.findMany({
        where: { deviceId: authenticatedDeviceId },
        orderBy: { order: "asc" },
      });

      ws.send(
        JSON.stringify({
          type: "heartbeat_ack",
          relays: relays.map((r) => ({ id: r.id, pin: r.pin, state: r.state })),
        })
      );
      return;
    }

    // ── RELAY ACK ─────────────────────────────────────────
    if (msg.type === "relay_ack" && authenticatedDeviceId) {
      await db.relay.updateMany({
        where: { id: msg.relayId, deviceId: authenticatedDeviceId },
        data: { state: msg.state, updatedAt: new Date() },
      });
      console.log(`[WS] Relay ack: ${msg.relayId} → ${msg.state ? "ON" : "OFF"}`);
    }
  });

  ws.on("close", async () => {
    clearInterval(pingInterval);
    if (authenticatedDeviceId) {
      deviceSockets.delete(authenticatedDeviceId);
      await db.device
        .update({
          where: { id: authenticatedDeviceId },
          data: { online: false },
        })
        .catch(() => null);
      console.log(`[WS] Device disconnected: ${authenticatedDeviceId}`);
    }
  });

  ws.on("error", (err) => {
    console.error("[WS] Socket error:", err.message);
  });
});

/**
 * Push a relay command to a connected ESP32.
 * Call this from the API route that handles dashboard toggle actions.
 */
export async function pushRelayCommand(
  deviceId: string,
  relayId: string,
  pin: number,
  state: boolean
): Promise<boolean> {
  const ws = deviceSockets.get(deviceId);
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify({ type: "relay_cmd", relayId, pin, state }));
  return true;
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[WS] Shutting down…");
  await db.$disconnect();
  wss.close(() => process.exit(0));
});
