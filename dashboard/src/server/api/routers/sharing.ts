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

export const sharingRouter = createTRPCRouter({
	/** Share a home with another user by email */
	shareHome: protectedProcedure
		.input(z.object({ homeId: z.string(), email: z.string().email() }))
		.mutation(async ({ ctx, input }) => {
			const home = await ctx.db.home.findFirst({
				where: { id: input.homeId, ownerId: ctx.session.user.id }
			});
			if (!home) throw new TRPCError({ code: "FORBIDDEN" });

			const target = await ctx.db.user.findUnique({ where: { email: input.email } });
			if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "No user found with that email" });
			if (target.id === ctx.session.user.id) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "You can't share with yourself" });
			}

			// Upsert to avoid duplicate errors
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

	/** Share a device with another user by email */
	shareDevice: protectedProcedure
		.input(z.object({ deviceId: z.string(), email: z.string().email() }))
		.mutation(async ({ ctx, input }) => {
			const device = await ctx.db.device.findFirst({
				where: { id: input.deviceId, apiKey: { userId: ctx.session.user.id } }
			});
			if (!device) throw new TRPCError({ code: "FORBIDDEN" });

			const target = await ctx.db.user.findUnique({ where: { email: input.email } });
			if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "No user found with that email" });
			if (target.id === ctx.session.user.id) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "You can't share with yourself" });
			}

			const share = await ctx.db.deviceShare.upsert({
				where: { deviceId_userId: { deviceId: input.deviceId, userId: target.id } },
				create: { deviceId: input.deviceId, userId: target.id },
				update: {}
			});

			await refreshDeviceSubscribers(input.deviceId);
			return share;
		}),

	/** Remove a device share */
	unshareDevice: protectedProcedure
		.input(z.object({ deviceId: z.string(), userId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const device = await ctx.db.device.findFirst({
				where: { id: input.deviceId, apiKey: { userId: ctx.session.user.id } }
			});
			if (!device) throw new TRPCError({ code: "FORBIDDEN" });

			const deleted = await ctx.db.deviceShare.delete({
				where: { deviceId_userId: { deviceId: input.deviceId, userId: input.userId } }
			});

			await refreshDeviceSubscribers(input.deviceId);
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

	/** List users a device is shared with */
	listDeviceShares: protectedProcedure
		.input(z.object({ deviceId: z.string() }))
		.query(async ({ ctx, input }) => {
			const device = await ctx.db.device.findFirst({
				where: { id: input.deviceId, apiKey: { userId: ctx.session.user.id } }
			});
			if (!device) throw new TRPCError({ code: "FORBIDDEN" });

			return ctx.db.deviceShare.findMany({
				where: { deviceId: input.deviceId },
				include: { user: { select: { id: true, name: true, email: true } } }
			});
		}),

	/** List everything shared with the current user */
	listSharedWithMe: protectedProcedure.query(async ({ ctx }) => {
		const [homeShares, deviceShares] = await Promise.all([
			ctx.db.homeShare.findMany({
				where: { userId: ctx.session.user.id },
				include: {
					home: {
						include: {
							owner: { select: { id: true, name: true, email: true } },
							devices: {
								include: { relays: { orderBy: { order: "asc" } } },
								orderBy: { updatedAt: "desc" }
							},
							_count: { select: { devices: true } }
						}
					}
				}
			}),
			ctx.db.deviceShare.findMany({
				where: { userId: ctx.session.user.id },
				include: {
					device: {
						include: {
							relays: { orderBy: { order: "asc" } },
							apiKey: { select: { user: { select: { id: true, name: true, email: true } } } }
						}
					}
				}
			})
		]);

		return {
			homes: homeShares.map((s: (typeof homeShares)[number]) => ({
				...s.home,
				sharedAt: s.createdAt
			})),
			devices: deviceShares.map((s: (typeof deviceShares)[number]) => ({
				...s.device,
				owner: s.device.apiKey.user,
				sharedAt: s.createdAt
			}))
		};
	})
});
