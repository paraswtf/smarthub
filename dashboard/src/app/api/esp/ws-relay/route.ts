/**
 * POST /api/esp/ws-relay
 *
 * Called by the dashboard (via tRPC toggleRelay mutation) to push
 * a real-time relay command to a currently-connected ESP32.
 *
 * If the device is offline, the state is persisted in DB and will
 * be synced on the device's next heartbeat.
 *
 * Body: { deviceId, relayId, state, apiKey? }
 * Auth: dashboard session (NextAuth)
 */
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { z } from "zod";

const schema = z.object({
	deviceId: z.string().min(1),
	relayId: z.string().min(1),
	state: z.boolean(),
});

export async function POST(req: NextRequest) {
	const session = await auth();
	if (!session?.user?.id) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const body = (await req.json()) as unknown;
	const parsed = schema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
	}

	const { deviceId, relayId, state } = parsed.data;

	// Verify ownership
	const relay = await db.relay.findFirst({
		where: {
			id: relayId,
			deviceId,
			device: { apiKey: { userId: session.user.id } },
		},
		include: { device: true },
	});

	if (!relay) {
		return NextResponse.json({ error: "Not found or forbidden" }, { status: 403 });
	}

	// Always persist state in DB (source of truth)
	await db.relay.update({
		where: { id: relayId },
		data: { state, updatedAt: new Date() },
	});

	// Attempt real-time push via WebSocket server
	// The WS server runs on a different port - we call it via internal HTTP
	const wsApiUrl = process.env.WS_INTERNAL_URL ?? `http://localhost:${process.env.WS_PORT ?? 4001}`;
	let pushed = false;
	try {
		const res = await fetch(`${wsApiUrl}/push-relay`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-internal-secret": process.env.WS_SECRET ?? "" },
			body: JSON.stringify({ deviceId, relayId, pin: relay.pin, state }),
			signal: AbortSignal.timeout(2000),
		});
		pushed = res.ok;
	} catch {
		// WS server not reachable - state is in DB, device will sync on next heartbeat
	}

	return NextResponse.json({
		ok: true,
		synced: pushed,
		message: pushed ? "Command pushed to device in real-time" : "State saved - will sync on device's next heartbeat",
	});
}
