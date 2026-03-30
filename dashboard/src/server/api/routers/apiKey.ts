import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import crypto from "crypto";

export const apiKeyRouter = createTRPCRouter({
	list: protectedProcedure.query(async ({ ctx }) => {
		return ctx.db.apiKey.findMany({
			where: { userId: ctx.session.user.id },
			include: { _count: { select: { devices: true } } },
			orderBy: { createdAt: "desc" },
		});
	}),

	create: protectedProcedure.input(z.object({ label: z.string().min(1).max(60) })).mutation(async ({ ctx, input }) => {
		const existing = await ctx.db.apiKey.count({
			where: { userId: ctx.session.user.id, active: true },
		});
		if (existing >= 10) throw new TRPCError({ code: "BAD_REQUEST", message: "Maximum 10 API keys per account" });

		const key = `ehk_${crypto.randomBytes(20).toString("hex")}`;
		return ctx.db.apiKey.create({
			data: { key, label: input.label, userId: ctx.session.user.id },
		});
	}),

	revoke: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		const owned = await ctx.db.apiKey.findFirst({
			where: { id: input.id, userId: ctx.session.user.id },
		});
		if (!owned) throw new TRPCError({ code: "FORBIDDEN" });
		return ctx.db.apiKey.update({
			where: { id: input.id },
			data: { active: false },
		});
	}),

	delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		const owned = await ctx.db.apiKey.findFirst({
			where: { id: input.id, userId: ctx.session.user.id },
		});
		if (!owned) throw new TRPCError({ code: "FORBIDDEN" });
		return ctx.db.apiKey.delete({ where: { id: input.id } });
	}),
});
