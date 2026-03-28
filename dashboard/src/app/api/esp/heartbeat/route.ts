/**
 * POST /api/esp/heartbeat
 *
 * Called periodically by ESP32 to report it's still alive,
 * sync its physical relay states to DB (ESP32 is authoritative),
 * and receive the current desired relay states from the server.
 *
 * Body: { deviceId, apiKey, relayStates?: [{ id, state }] }
 * Returns: { relays: [{ id, pin, state }], ok: boolean }
 */
import { type NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { z } from "zod";

const schema = z.object({
	deviceId: z.string().min(1),
	apiKey: z.string().min(1),
	relayStates: z.array(z.object({ id: z.string(), state: z.boolean() })).optional()
});

const LAST_SEEN_THROTTLE_MS = 30_000;

export async function POST(req: NextRequest) {
	try {
		const body = (await req.json()) as unknown;
		const parsed = schema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
		}

		const { deviceId, apiKey, relayStates } = parsed.data;

		// Validate key owns the device
		const device = await db.device.findFirst({
			where: { id: deviceId, apiKey: { key: apiKey, active: true } },
			include: { relays: { orderBy: { order: "asc" } } }
		});
		if (!device) {
			return NextResponse.json({ error: "Device not found or key invalid" }, { status: 401 });
		}

		// ESP32 is authoritative for physical relay states — reconcile to DB
		if (relayStates?.length) {
			await Promise.all(
				relayStates.map(({ id, state }) =>
					db.relay.updateMany({
						where: { id, deviceId },
						data: { state }
					})
				)
			);
		}

		// Rate-limit lastSeenAt updates
		const shouldUpdateLastSeen = !device.lastSeenAt ||
			(Date.now() - device.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS);
		if (shouldUpdateLastSeen) {
			await db.device.update({
				where: { id: deviceId },
				data: { lastSeenAt: new Date() }
			});
		}

		// Return current desired relay states (includes any pending scheduled changes)
		const relays = relayStates?.length
			? await db.relay.findMany({ where: { deviceId }, orderBy: { order: "asc" } })
			: device.relays;

		return NextResponse.json({
			relays: relays.map((r) => ({ id: r.id, pin: r.pin, state: r.state })),
			ok: true
		});
	} catch (err) {
		console.error("[ESP Heartbeat]", err);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
