import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";

export const roomRouter = createTRPCRouter({
	/** List rooms in a home (owner or shared user) */
	list: protectedProcedure.input(z.object({ homeId: z.string() })).query(async ({ ctx, input }) => {
		// Check access: owner or home share
		const home = await ctx.db.home.findFirst({ where: { id: input.homeId } });
		if (!home) throw new TRPCError({ code: "NOT_FOUND" });

		const isOwner = home.ownerId === ctx.session.user.id;
		if (!isOwner) {
			const share = await ctx.db.homeShare.findFirst({
				where: { homeId: input.homeId, userId: ctx.session.user.id },
			});
			if (!share) throw new TRPCError({ code: "FORBIDDEN" });
		}

		return ctx.db.room.findMany({
			where: { homeId: input.homeId },
			include: {
				relays: {
					orderBy: { order: "asc" },
					include: { device: { select: { id: true, name: true, lastSeenAt: true } } },
				},
				regulators: {
					orderBy: { order: "asc" },
					include: { device: { select: { id: true, name: true, lastSeenAt: true } } },
				},
				_count: { select: { relays: true, regulators: true, shares: true } },
			},
			orderBy: { order: "asc" },
		});
	}),

	/** Get a single room with relays */
	get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
		const room = await ctx.db.room.findFirst({
			where: { id: input.id },
			include: {
				home: { select: { id: true, name: true, ownerId: true } },
				relays: {
					orderBy: { order: "asc" },
					include: {
						device: { select: { id: true, name: true, lastSeenAt: true } },
						_count: { select: { schedules: { where: { enabled: true } } } },
					},
				},
				regulators: {
					orderBy: { order: "asc" },
					include: {
						device: { select: { id: true, name: true, lastSeenAt: true } },
					},
				},
				shares: {
					include: { user: { select: { id: true, name: true, email: true } } },
				},
			},
		});
		if (!room) throw new TRPCError({ code: "NOT_FOUND" });

		// Check access: owner, home share, or room share
		const isOwner = room.home.ownerId === ctx.session.user.id;
		if (!isOwner) {
			const homeShare = await ctx.db.homeShare.findFirst({
				where: { homeId: room.homeId, userId: ctx.session.user.id },
			});
			if (!homeShare) {
				const roomShare = await ctx.db.roomShare.findFirst({
					where: { roomId: input.id, userId: ctx.session.user.id },
				});
				if (!roomShare) throw new TRPCError({ code: "FORBIDDEN" });
			}
		}

		return { ...room, accessLevel: isOwner ? ("owner" as const) : ("shared" as const) };
	}),

	/** Create a room in a home */
	create: protectedProcedure.input(z.object({ homeId: z.string(), name: z.string().min(1).max(60) })).mutation(async ({ ctx, input }) => {
		const home = await ctx.db.home.findFirst({
			where: { id: input.homeId, ownerId: ctx.session.user.id },
		});
		if (!home) throw new TRPCError({ code: "FORBIDDEN" });

		const count = await ctx.db.room.count({ where: { homeId: input.homeId } });
		return ctx.db.room.create({
			data: { homeId: input.homeId, name: input.name, order: count },
		});
	}),

	/** Rename a room or update order */
	update: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				name: z.string().min(1).max(60).optional(),
				order: z.number().int().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const room = await ctx.db.room.findFirst({
				where: { id: input.id },
				include: { home: { select: { ownerId: true } } },
			});
			if (!room || room.home.ownerId !== ctx.session.user.id) {
				throw new TRPCError({ code: "FORBIDDEN" });
			}

			const { id, ...data } = input;
			return ctx.db.room.update({ where: { id }, data });
		}),

	/** Delete a room (relays become unassigned, not deleted) */
	delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		const room = await ctx.db.room.findFirst({
			where: { id: input.id },
			include: { home: { select: { ownerId: true } } },
		});
		if (!room || room.home.ownerId !== ctx.session.user.id) {
			throw new TRPCError({ code: "FORBIDDEN" });
		}

		// Unassign relays from this room
		await ctx.db.relay.updateMany({
			where: { roomId: input.id },
			data: { roomId: null },
		});

		// Unassign regulators from this room
		await ctx.db.regulator.updateMany({
			where: { roomId: input.id },
			data: { roomId: null },
		});

		return ctx.db.room.delete({ where: { id: input.id } });
	}),

	/** Assign a relay to a room */
	assignRelay: protectedProcedure.input(z.object({ relayId: z.string(), roomId: z.string() })).mutation(async ({ ctx, input }) => {
		// Verify relay ownership
		const relay = await ctx.db.relay.findFirst({
			where: { id: input.relayId },
			include: { device: { select: { id: true, homeId: true, apiKey: { select: { userId: true } } } } },
		});
		if (!relay || relay.device.apiKey.userId !== ctx.session.user.id) {
			throw new TRPCError({ code: "FORBIDDEN" });
		}

		// Verify room ownership and that device is in the same home
		const room = await ctx.db.room.findFirst({
			where: { id: input.roomId },
			include: { home: { select: { id: true, ownerId: true } } },
		});
		if (!room || room.home.ownerId !== ctx.session.user.id) {
			throw new TRPCError({ code: "FORBIDDEN" });
		}
		if (relay.device.homeId !== room.homeId) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "The relay's device must be assigned to the same home as the room",
			});
		}

		return ctx.db.relay.update({
			where: { id: input.relayId },
			data: { roomId: input.roomId },
		});
	}),

	/** Remove a relay from its room */
	unassignRelay: protectedProcedure.input(z.object({ relayId: z.string() })).mutation(async ({ ctx, input }) => {
		const relay = await ctx.db.relay.findFirst({
			where: { id: input.relayId },
			include: { device: { select: { apiKey: { select: { userId: true } } } } },
		});
		if (!relay || relay.device.apiKey.userId !== ctx.session.user.id) {
			throw new TRPCError({ code: "FORBIDDEN" });
		}

		return ctx.db.relay.update({
			where: { id: input.relayId },
			data: { roomId: null },
		});
	}),

	/** List relays not assigned to any room (for a given home) */
	unassignedRelays: protectedProcedure.input(z.object({ homeId: z.string() })).query(async ({ ctx, input }) => {
		const home = await ctx.db.home.findFirst({
			where: { id: input.homeId, ownerId: ctx.session.user.id },
		});
		if (!home) throw new TRPCError({ code: "FORBIDDEN" });

		return ctx.db.relay.findMany({
			where: {
				device: { homeId: input.homeId },
				OR: [{ roomId: null }, { roomId: { isSet: false } }],
			},
			include: { device: { select: { id: true, name: true } } },
			orderBy: { order: "asc" },
		});
	}),

	/** Assign a regulator to a room */
	assignRegulator: protectedProcedure.input(z.object({ regulatorId: z.string(), roomId: z.string() })).mutation(async ({ ctx, input }) => {
		const reg = await ctx.db.regulator.findFirst({
			where: { id: input.regulatorId },
			include: { device: { select: { id: true, homeId: true, apiKey: { select: { userId: true } } } } },
		});
		if (!reg || reg.device.apiKey.userId !== ctx.session.user.id) {
			throw new TRPCError({ code: "FORBIDDEN" });
		}

		const room = await ctx.db.room.findFirst({
			where: { id: input.roomId },
			include: { home: { select: { id: true, ownerId: true } } },
		});
		if (!room || room.home.ownerId !== ctx.session.user.id) {
			throw new TRPCError({ code: "FORBIDDEN" });
		}
		if (reg.device.homeId !== room.homeId) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "The regulator's device must be assigned to the same home as the room",
			});
		}

		return ctx.db.regulator.update({
			where: { id: input.regulatorId },
			data: { roomId: input.roomId },
		});
	}),

	/** Remove a regulator from its room */
	unassignRegulator: protectedProcedure.input(z.object({ regulatorId: z.string() })).mutation(async ({ ctx, input }) => {
		const reg = await ctx.db.regulator.findFirst({
			where: { id: input.regulatorId },
			include: { device: { select: { apiKey: { select: { userId: true } } } } },
		});
		if (!reg || reg.device.apiKey.userId !== ctx.session.user.id) {
			throw new TRPCError({ code: "FORBIDDEN" });
		}

		return ctx.db.regulator.update({
			where: { id: input.regulatorId },
			data: { roomId: null },
		});
	}),

	/** List regulators not assigned to any room (for a given home) */
	unassignedRegulators: protectedProcedure.input(z.object({ homeId: z.string() })).query(async ({ ctx, input }) => {
		const home = await ctx.db.home.findFirst({
			where: { id: input.homeId, ownerId: ctx.session.user.id },
		});
		if (!home) throw new TRPCError({ code: "FORBIDDEN" });

		return ctx.db.regulator.findMany({
			where: {
				device: { homeId: input.homeId },
				OR: [{ roomId: null }, { roomId: { isSet: false } }],
			},
			include: { device: { select: { id: true, name: true } } },
			orderBy: { order: "asc" },
		});
	}),
});
