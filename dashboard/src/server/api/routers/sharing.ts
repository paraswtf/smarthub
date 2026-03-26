import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";

/** Notify WS server to rebuild device subscriber set */
async function refreshDeviceSubscribers(deviceId: string) {
	const wsUrl = `${process.env.WS_INTERNAL_URL ?? `http://localhost:${process.env.WS_PORT ?? 4001}`}/refresh-device-subscribers`;
	try {
		await fetch(wsUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-internal-secret": process.env.WS_SECRET ?? "" },
			body: JSON.stringify({ deviceId }),
			signal: AbortSignal.timeout(2000)
		});
	} catch {
		// WS server unreachable — subscribers will refresh on next device connect
	}
}

/** Find target user by email, validate not self */
async function findShareTarget(db: { user: { findUnique: (args: { where: { email: string } }) => Promise<{ id: string } | null> } }, email: string, currentUserId: string) {
	const target = await db.user.findUnique({ where: { email } });
	if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "No user found with that email" });
	if (target.id === currentUserId) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "You can't share with yourself" });
	}
	return target;
}

export const sharingRouter = createTRPCRouter({
	// ─── Home Sharing ─────────────────────────────────────────

	/** Share a home with another user by email */
	shareHome: protectedProcedure
		.input(z.object({ homeId: z.string(), email: z.string().email() }))
		.mutation(async ({ ctx, input }) => {
			const home = await ctx.db.home.findFirst({
				where: { id: input.homeId, ownerId: ctx.session.user.id }
			});
			if (!home) throw new TRPCError({ code: "FORBIDDEN" });

			const target = await findShareTarget(ctx.db, input.email, ctx.session.user.id);

			const share = await ctx.db.homeShare.upsert({
				where: { homeId_userId: { homeId: input.homeId, userId: target.id } },
				create: { homeId: input.homeId, userId: target.id },
				update: {}
			});

			// Refresh WS subscribers for all devices in this home
			const devices = await ctx.db.device.findMany({ where: { homeId: input.homeId }, select: { id: true } });
			await Promise.all(devices.map((d: { id: string }) => refreshDeviceSubscribers(d.id)));

			return share;
		}),

	/** Remove a home share */
	unshareHome: protectedProcedure
		.input(z.object({ homeId: z.string(), userId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const home = await ctx.db.home.findFirst({
				where: { id: input.homeId, ownerId: ctx.session.user.id }
			});
			if (!home) throw new TRPCError({ code: "FORBIDDEN" });

			const deleted = await ctx.db.homeShare.delete({
				where: { homeId_userId: { homeId: input.homeId, userId: input.userId } }
			});

			const devices = await ctx.db.device.findMany({ where: { homeId: input.homeId }, select: { id: true } });
			await Promise.all(devices.map((d: { id: string }) => refreshDeviceSubscribers(d.id)));

			return deleted;
		}),

	/** List users a home is shared with */
	listHomeShares: protectedProcedure
		.input(z.object({ homeId: z.string() }))
		.query(async ({ ctx, input }) => {
			const home = await ctx.db.home.findFirst({
				where: { id: input.homeId, ownerId: ctx.session.user.id }
			});
			if (!home) throw new TRPCError({ code: "FORBIDDEN" });

			return ctx.db.homeShare.findMany({
				where: { homeId: input.homeId },
				include: { user: { select: { id: true, name: true, email: true } } }
			});
		}),

	// ─── Room Sharing ─────────────────────────────────────────

	/** Share a room with another user by email */
	shareRoom: protectedProcedure
		.input(z.object({ roomId: z.string(), email: z.string().email() }))
		.mutation(async ({ ctx, input }) => {
			const room = await ctx.db.room.findFirst({
				where: { id: input.roomId },
				include: { home: { select: { ownerId: true } } }
			});
			if (!room || room.home.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "FORBIDDEN" });
			}

			const target = await findShareTarget(ctx.db, input.email, ctx.session.user.id);

			const share = await ctx.db.roomShare.upsert({
				where: { roomId_userId: { roomId: input.roomId, userId: target.id } },
				create: { roomId: input.roomId, userId: target.id },
				update: {}
			});

			// Refresh WS subscribers for all devices with relays in this room
			const relays = await ctx.db.relay.findMany({
				where: { roomId: input.roomId },
				select: { deviceId: true },
				distinct: ["deviceId"]
			});
			await Promise.all(relays.map((r: { deviceId: string }) => refreshDeviceSubscribers(r.deviceId)));

			return share;
		}),

	/** Remove a room share */
	unshareRoom: protectedProcedure
		.input(z.object({ roomId: z.string(), userId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const room = await ctx.db.room.findFirst({
				where: { id: input.roomId },
				include: { home: { select: { ownerId: true } } }
			});
			if (!room || room.home.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "FORBIDDEN" });
			}

			const deleted = await ctx.db.roomShare.delete({
				where: { roomId_userId: { roomId: input.roomId, userId: input.userId } }
			});

			const relays = await ctx.db.relay.findMany({
				where: { roomId: input.roomId },
				select: { deviceId: true },
				distinct: ["deviceId"]
			});
			await Promise.all(relays.map((r: { deviceId: string }) => refreshDeviceSubscribers(r.deviceId)));

			return deleted;
		}),

	/** List users a room is shared with */
	listRoomShares: protectedProcedure
		.input(z.object({ roomId: z.string() }))
		.query(async ({ ctx, input }) => {
			const room = await ctx.db.room.findFirst({
				where: { id: input.roomId },
				include: { home: { select: { ownerId: true } } }
			});
			if (!room || room.home.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "FORBIDDEN" });
			}

			return ctx.db.roomShare.findMany({
				where: { roomId: input.roomId },
				include: { user: { select: { id: true, name: true, email: true } } }
			});
		}),

	// ─── Relay Sharing ────────────────────────────────────────

	/** Share a relay with another user by email */
	shareRelay: protectedProcedure
		.input(z.object({ relayId: z.string(), email: z.string().email() }))
		.mutation(async ({ ctx, input }) => {
			const relay = await ctx.db.relay.findFirst({
				where: { id: input.relayId },
				include: { device: { select: { apiKey: { select: { userId: true } } } } }
			});
			if (!relay || relay.device.apiKey.userId !== ctx.session.user.id) {
				throw new TRPCError({ code: "FORBIDDEN" });
			}

			const target = await findShareTarget(ctx.db, input.email, ctx.session.user.id);

			const share = await ctx.db.relayShare.upsert({
				where: { relayId_userId: { relayId: input.relayId, userId: target.id } },
				create: { relayId: input.relayId, userId: target.id },
				update: {}
			});

			await refreshDeviceSubscribers(relay.deviceId);
			return share;
		}),

	/** Remove a relay share */
	unshareRelay: protectedProcedure
		.input(z.object({ relayId: z.string(), userId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const relay = await ctx.db.relay.findFirst({
				where: { id: input.relayId },
				include: { device: { select: { apiKey: { select: { userId: true } } } } }
			});
			if (!relay || relay.device.apiKey.userId !== ctx.session.user.id) {
				throw new TRPCError({ code: "FORBIDDEN" });
			}

			const deleted = await ctx.db.relayShare.delete({
				where: { relayId_userId: { relayId: input.relayId, userId: input.userId } }
			});

			await refreshDeviceSubscribers(relay.deviceId);
			return deleted;
		}),

	/** List users a relay is shared with */
	listRelayShares: protectedProcedure
		.input(z.object({ relayId: z.string() }))
		.query(async ({ ctx, input }) => {
			const relay = await ctx.db.relay.findFirst({
				where: { id: input.relayId },
				include: { device: { select: { apiKey: { select: { userId: true } } } } }
			});
			if (!relay || relay.device.apiKey.userId !== ctx.session.user.id) {
				throw new TRPCError({ code: "FORBIDDEN" });
			}

			return ctx.db.relayShare.findMany({
				where: { relayId: input.relayId },
				include: { user: { select: { id: true, name: true, email: true } } }
			});
		}),

	// ─── Shared With Me ───────────────────────────────────────

	/** List everything shared with the current user */
	listSharedWithMe: protectedProcedure.query(async ({ ctx }) => {
		const [homeShares, roomShares, relayShares] = await Promise.all([
			ctx.db.homeShare.findMany({
				where: { userId: ctx.session.user.id },
				include: {
					home: {
						include: {
							owner: { select: { id: true, name: true, email: true } },
							rooms: {
								include: {
									relays: {
										orderBy: { order: "asc" },
										include: { device: { select: { id: true, name: true, lastSeenAt: true } } }
									}
								},
								orderBy: { order: "asc" }
							},
							_count: { select: { rooms: true } }
						}
					}
				}
			}),
			ctx.db.roomShare.findMany({
				where: { userId: ctx.session.user.id },
				include: {
					room: {
						include: {
							home: { select: { id: true, name: true, ownerId: true, owner: { select: { id: true, name: true, email: true } } } },
							relays: {
								orderBy: { order: "asc" },
								include: { device: { select: { id: true, name: true, lastSeenAt: true } } }
							}
						}
					}
				}
			}),
			ctx.db.relayShare.findMany({
				where: { userId: ctx.session.user.id },
				include: {
					relay: {
						include: {
							device: {
								select: {
									id: true, name: true, lastSeenAt: true,
									apiKey: { select: { user: { select: { id: true, name: true, email: true } } } }
								}
							}
						}
					}
				}
			})
		]);

		return {
			homes: homeShares.map((s) => ({
				...s.home,
				sharedAt: s.createdAt
			})),
			rooms: roomShares.map((s) => ({
				...s.room,
				owner: s.room.home.owner,
				sharedAt: s.createdAt
			})),
			relays: relayShares.map((s) => ({
				...s.relay,
				owner: s.relay.device.apiKey.user,
				sharedAt: s.createdAt
			}))
		};
	})
});
