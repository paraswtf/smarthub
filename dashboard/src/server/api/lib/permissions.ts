import type { PrismaClient } from "@prisma/client";

export type AccessLevel = "owner" | "shared" | "none";

/** Check what access a user has to a device (owner or home-shared) */
export async function getDeviceAccess(db: PrismaClient, deviceId: string, userId: string): Promise<AccessLevel> {
	// 1. Check ownership via apiKey chain
	const owned = await db.device.findFirst({
		where: { id: deviceId, apiKey: { userId } },
		select: { id: true },
	});
	if (owned) return "owner";

	// 2. Check home share (device's home shared with this user)
	const device = await db.device.findFirst({
		where: { id: deviceId },
		select: { homeId: true },
	});
	if (device?.homeId) {
		const homeShare = await db.homeShare.findFirst({
			where: { homeId: device.homeId, userId },
			select: { id: true },
		});
		if (homeShare) return "shared";
	}

	return "none";
}

/** Check what access a user has to a relay (owner, relay-shared, room-shared, or home-shared) */
export async function getRelayAccess(db: PrismaClient, relayId: string, userId: string): Promise<AccessLevel> {
	// 1. Check ownership via relay → device → apiKey chain
	const relay = await db.relay.findFirst({
		where: { id: relayId },
		select: {
			id: true,
			roomId: true,
			device: {
				select: {
					homeId: true,
					apiKey: { select: { userId: true } },
				},
			},
		},
	});
	if (!relay) return "none";
	if (relay.device.apiKey.userId === userId) return "owner";

	// 2. Direct relay share
	const relayShare = await db.relayShare.findFirst({
		where: { relayId, userId },
		select: { id: true },
	});
	if (relayShare) return "shared";

	// 3. Room share (relay's room shared with user)
	if (relay.roomId) {
		const roomShare = await db.roomShare.findFirst({
			where: { roomId: relay.roomId, userId },
			select: { id: true },
		});
		if (roomShare) return "shared";

		// 4. Home share via room's home
		const room = await db.room.findFirst({
			where: { id: relay.roomId },
			select: { homeId: true },
		});
		if (room) {
			const homeShare = await db.homeShare.findFirst({
				where: { homeId: room.homeId, userId },
				select: { id: true },
			});
			if (homeShare) return "shared";
		}
	}

	// 5. Home share via device's home (relay not in a room but device is in a home)
	if (relay.device.homeId) {
		const homeShare = await db.homeShare.findFirst({
			where: { homeId: relay.device.homeId, userId },
			select: { id: true },
		});
		if (homeShare) return "shared";
	}

	return "none";
}
