import { z } from "zod";
import { createTRPCRouter, publicProcedure, moduleProcedure } from "../trpc";
import { isAccelerate } from "~/server/db";

export const partnerRouter = createTRPCRouter({
	getAll: publicProcedure.query(async ({ ctx }) => {
		return ctx.db.partner.findMany({
			...(isAccelerate && { cacheStrategy: { ttl: 120, swr: 600 } }),
			orderBy: { order: "asc" }
		});
	}),

	create: moduleProcedure("partners")
		.input(
			z.object({
				name: z.string().min(1),
				logoUrl: z.string().min(1),
				url: z.string().url().optional().or(z.literal("")),
				order: z.number().optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const count = await ctx.db.partner.count();
			return ctx.db.partner.create({
				data: {
					name: input.name,
					logoUrl: input.logoUrl,
					url: input.url || null,
					order: input.order ?? count
				}
			});
		}),

	update: moduleProcedure("partners")
		.input(
			z.object({
				id: z.string(),
				url: z.string().url().optional().or(z.literal("")),
				name: z.string().optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const { id, ...data } = input;
			return ctx.db.partner.update({
				where: { id },
				data: { ...data, url: data.url || null }
			});
		}),

	delete: moduleProcedure("partners")
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			return ctx.db.partner.delete({ where: { id: input.id } });
		}),

	reorder: moduleProcedure("partners")
		.input(z.array(z.object({ id: z.string(), order: z.number() })))
		.mutation(async ({ ctx, input }) => {
			await Promise.all(
				input.map((item) =>
					ctx.db.partner.update({
						where: { id: item.id },
						data: { order: item.order }
					})
				)
			);
			return { success: true };
		})
});
