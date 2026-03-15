/**
 * POST /api/esp/heartbeat
 *
 * Called periodically by ESP32 to report it's still alive
 * and to receive any pending relay-state changes from the dashboard.
 *
 * Body: { deviceId, apiKey, relayStates?: [{ id, state }] }
 * Returns: { relays: [{ id, pin, state }], pendingSync: boolean }
 */
import { type NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { z } from "zod";

const schema = z.object({
  deviceId: z.string().min(1),
  apiKey: z.string().min(1),
  relayStates: z
    .array(z.object({ id: z.string(), state: z.boolean() }))
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as unknown;
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const { deviceId, apiKey, relayStates } = parsed.data;

    // Validate key owns the device
    const device = await db.device.findFirst({
      where: { id: deviceId, apiKey: { key: apiKey, active: true } },
      include: { relays: { orderBy: { order: "asc" } } },
    });
    if (!device) {
      return NextResponse.json({ error: "Device not found or key invalid" }, { status: 401 });
    }

    // If ESP32 is reporting current relay states, reconcile them
    if (relayStates?.length) {
      await Promise.all(
        relayStates.map(({ id, state }) =>
          db.relay.updateMany({
            where: { id, deviceId },
            data: { state },
          })
        )
      );
    }

    // Mark device online + update lastSeen
    await db.device.update({
      where: { id: deviceId },
      data: { online: true, lastSeenAt: new Date() },
    });

    // Refresh relays after reconcile
    const freshRelays = await db.relay.findMany({
      where: { deviceId },
      orderBy: { order: "asc" },
    });

    return NextResponse.json({
      relays: freshRelays.map((r) => ({ id: r.id, pin: r.pin, state: r.state })),
      ok: true,
    });
  } catch (err) {
    console.error("[ESP Heartbeat]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
