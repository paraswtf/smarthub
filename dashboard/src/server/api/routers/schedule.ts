import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";

const MAX_SCHEDULES_PER_RELAY = 10;

/** Verify the current user owns the relay (via device → apiKey chain) */
async function verifyRelayOwner(db: Parameters<Parameters<typeof protectedProcedure.query>[0]>[0]["ctx"]["db"], relayId: string, userId: string) {
	const relay = await db.relay.findFirst({
		where: { id: relayId },
		select: { device: { select: { apiKey: { select: { userId: true } } } } },
	});
	if (!relay) throw new TRPCError({ code: "NOT_FOUND", message: "Relay not found" });
	if (relay.device.apiKey.userId !== userId) {
		throw new TRPCError({ code: "FORBIDDEN", message: "Only the relay owner can manage schedules" });
	}
}

export const scheduleRouter = createTRPCRouter({
	/** List all schedules for a relay */
	list: protectedProcedure.input(z.object({ relayId: z.string() })).query(async ({ ctx, input }) => {
		await verifyRelayOwner(ctx.db, input.relayId, ctx.session.user.id);
		return ctx.db.relaySchedule.findMany({
			where: { relayId: input.relayId },
			orderBy: [{ hour: "asc" }, { minute: "asc" }],
		});
	}),

	/** Create a new schedule */
	create: protectedProcedure
		.input(
			z.object({
				relayId: z.string(),
				label: z.string().max(60).optional(),
				hour: z.number().int().min(0).max(23),
				minute: z.number().int().min(0).max(59),
				daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
				action: z.boolean(),
				timezone: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await verifyRelayOwner(ctx.db, input.relayId, ctx.session.user.id);

			const count = await ctx.db.relaySchedule.count({ where: { relayId: input.relayId } });
			if (count >= MAX_SCHEDULES_PER_RELAY) {
				throw new TRPCError({ code: "BAD_REQUEST", message: `Maximum ${MAX_SCHEDULES_PER_RELAY} schedules per relay` });
			}

			return ctx.db.relaySchedule.create({
				data: {
					relayId: input.relayId,
					label: input.label ?? "Schedule",
					hour: input.hour,
					minute: input.minute,
					daysOfWeek: input.daysOfWeek,
					action: input.action,
					timezone: input.timezone ?? "Asia/Kolkata",
					createdById: ctx.session.user.id,
				},
			});
		}),

	/** Update an existing schedule */
	update: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				label: z.string().max(60).optional(),
				hour: z.number().int().min(0).max(23).optional(),
				minute: z.number().int().min(0).max(59).optional(),
				daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).optional(),
				action: z.boolean().optional(),
				enabled: z.boolean().optional(),
				timezone: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const schedule = await ctx.db.relaySchedule.findFirst({ where: { id: input.id } });
			if (!schedule) throw new TRPCError({ code: "NOT_FOUND" });
			await verifyRelayOwner(ctx.db, schedule.relayId, ctx.session.user.id);

			const { id, ...data } = input;
			return ctx.db.relaySchedule.update({ where: { id }, data });
		}),

	/** Delete a schedule */
	delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		const schedule = await ctx.db.relaySchedule.findFirst({ where: { id: input.id } });
		if (!schedule) throw new TRPCError({ code: "NOT_FOUND" });
		await verifyRelayOwner(ctx.db, schedule.relayId, ctx.session.user.id);

		return ctx.db.relaySchedule.delete({ where: { id: input.id } });
	}),

	/** Quick toggle enabled/disabled */
	toggle: protectedProcedure.input(z.object({ id: z.string(), enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
		const schedule = await ctx.db.relaySchedule.findFirst({ where: { id: input.id } });
		if (!schedule) throw new TRPCError({ code: "NOT_FOUND" });
		await verifyRelayOwner(ctx.db, schedule.relayId, ctx.session.user.id);

		return ctx.db.relaySchedule.update({
			where: { id: input.id },
			data: { enabled: input.enabled },
		});
	}),
});
