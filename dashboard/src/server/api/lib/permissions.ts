import type { PrismaClient } from "@prisma/client";

export type AccessLevel = "owner" | "shared" | "none";

/** Check what access a user has to a device (owner, shared, or none) */
export async function getDeviceAccess(db: PrismaClient, deviceId: string, userId: string): Promise<AccessLevel> {
	// 1. Check ownership via apiKey chain
	const owned = await db.device.findFirst({
		where: { id: deviceId, apiKey: { userId } },
		select: { id: true }
	});
	if (owned) return "owner";

	// 2. Check direct device share
	const deviceShare = await db.deviceShare.findFirst({
		where: { deviceId, userId },
		select: { id: true }
	});
	if (deviceShare) return "shared";

	// 3. Check home share (device's home shared with this user)
	const device = await db.device.findFirst({
		where: { id: deviceId },
		select: { homeId: true }
	});
	if (device?.homeId) {
		const homeShare = await db.homeShare.findFirst({
			where: { homeId: device.homeId, userId },
			select: { id: true }
		});
		if (homeShare) return "shared";
	}

	return "none";
}
