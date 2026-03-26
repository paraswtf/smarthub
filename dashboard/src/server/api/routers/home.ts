import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";

export const homeRouter = createTRPCRouter({
	/** List all homes owned by current user */
	list: protectedProcedure.query(async ({ ctx }) => {
		return ctx.db.home.findMany({
			where: { ownerId: ctx.session.user.id },
			include: {
				_count: { select: { devices: true, rooms: true, shares: true } }
			},
			orderBy: { createdAt: "asc" }
		});
	}),

	/** Get a single home with its rooms and devices */
	get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
		const home = await ctx.db.home.findFirst({
			where: { id: input.id, ownerId: ctx.session.user.id },
			include: {
				rooms: {
					include: {
						relays: {
							orderBy: { order: "asc" },
							include: { device: { select: { id: true, name: true, lastSeenAt: true } } }
						},
						_count: { select: { relays: true, shares: true } }
					},
					orderBy: { order: "asc" }
				},
				devices: {
					include: { relays: { orderBy: { order: "asc" } } },
					orderBy: { updatedAt: "desc" }
				},
				shares: {
					include: { user: { select: { id: true, name: true, email: true } } }
				}
			}
		});
		if (!home) throw new TRPCError({ code: "NOT_FOUND" });
		return home;
	}),

	/** Create a new home */
	create: protectedProcedure
		.input(z.object({ name: z.string().min(1).max(60) }))
		.mutation(async ({ ctx, input }) => {
			return ctx.db.home.create({
				data: { name: input.name, ownerId: ctx.session.user.id }
			});
		}),

	/** Rename a home */
	update: protectedProcedure
		.input(z.object({ id: z.string(), name: z.string().min(1).max(60) }))
		.mutation(async ({ ctx, input }) => {
			const owned = await ctx.db.home.findFirst({
				where: { id: input.id, ownerId: ctx.session.user.id }
			});
			if (!owned) throw new TRPCError({ code: "FORBIDDEN" });
			return ctx.db.home.update({ where: { id: input.id }, data: { name: input.name } });
		}),

	/** Delete a home (must have no devices) */
	delete: protectedProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const home = await ctx.db.home.findFirst({
				where: { id: input.id, ownerId: ctx.session.user.id },
				include: { _count: { select: { devices: true } } }
			});
			if (!home) throw new TRPCError({ code: "FORBIDDEN" });
			if (home._count.devices > 0) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "Remove all devices from this home before deleting it" });
			}
			return ctx.db.home.delete({ where: { id: input.id } });
		}),

	/** Assign a device to a home (or remove from home with homeId=null) */
	assignDevice: protectedProcedure
		.input(z.object({ deviceId: z.string(), homeId: z.string().nullable() }))
		.mutation(async ({ ctx, input }) => {
			// Verify device ownership
			const device = await ctx.db.device.findFirst({
				where: { id: input.deviceId, apiKey: { userId: ctx.session.user.id } }
			});
			if (!device) throw new TRPCError({ code: "FORBIDDEN" });

			// Verify home ownership if assigning to a home
			if (input.homeId) {
				const home = await ctx.db.home.findFirst({
					where: { id: input.homeId, ownerId: ctx.session.user.id }
				});
				if (!home) throw new TRPCError({ code: "FORBIDDEN" });
			}

			// If unassigning from home, also unassign all relays from rooms
			if (!input.homeId) {
				await ctx.db.relay.updateMany({
					where: { deviceId: input.deviceId, roomId: { not: null } },
					data: { roomId: null }
				});
			}

			return ctx.db.device.update({
				where: { id: input.deviceId },
				data: { homeId: input.homeId }
			});
		}),

	/** List unassigned devices (no home) for current user */
	unassignedDevices: protectedProcedure.query(async ({ ctx }) => {
		const apiKeys = await ctx.db.apiKey.findMany({
			where: { userId: ctx.session.user.id, active: true },
			include: {
				devices: {
					where: { OR: [{ homeId: null }, { homeId: { isSet: false } }] },
					include: { relays: { orderBy: { order: "asc" } } },
					orderBy: { updatedAt: "desc" }
				}
			}
		});
		return apiKeys.flatMap((k: (typeof apiKeys)[number]) => k.devices);
	})
});
