import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createTRPCRouter, publicProcedure, moduleProcedure } from "../trpc";
import { isAccelerate, db } from "~/server/db";

const tag = (s: string) => s.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 64);

const invalidateAccelerate = async (tags: string[]) => {
	if (!isAccelerate) return;
	try {
		await (db as any).$accelerate.invalidate({ tags });
	} catch (err) {
		console.warn("[Accelerate] cache invalidation failed (non-fatal):", err);
	}
};

export const caseStudyRouter = createTRPCRouter({
	getAll: publicProcedure.input(z.object({ published: z.boolean().optional() })).query(async ({ ctx, input }) => {
		return ctx.db.caseStudy.findMany({
			where: { published: input.published },
			select: {
				id: true,
				title: true,
				slug: true,
				client: true,
				industry: true,
				tags: true,
				excerpt: true,
				results: true,
				published: true,
				coverImage: true,
				createdAt: true,
				emailGated: true
			},
			orderBy: { createdAt: "desc" },
			...(isAccelerate && { cacheStrategy: { ttl: 60, swr: 300, tags: [tag("cs_list")] } })
		});
	}),

	getById: moduleProcedure("caseStudies")
		.input(z.object({ id: z.string() }))
		.query(async ({ ctx, input }) => {
			return ctx.db.caseStudy.findUnique({ where: { id: input.id } });
		}),

	getBySlug: publicProcedure.input(z.object({ slug: z.string() })).query(async ({ ctx, input }) => {
		return ctx.db.caseStudy.findUnique({
			where: { slug: input.slug },
			...(isAccelerate && {
				cacheStrategy: { ttl: 300, swr: 3600, tags: [tag("cs_list"), tag(`cs_${input.slug}`)] }
			})
		});
	}),

	requestAccess: publicProcedure.input(z.object({ slug: z.string(), email: z.string().email(), name: z.string().optional() })).mutation(async ({ ctx, input }) => {
		const cs = await ctx.db.caseStudy.findUnique({
			where: { slug: input.slug },
			select: { pdfUrl: true, emailGated: true, title: true }
		});
		if (!cs) throw new Error("Case study not found");
		return { pdfUrl: cs.pdfUrl };
	}),

	create: moduleProcedure("caseStudies")
		.input(
			z.object({
				title: z.string().min(1),
				slug: z.string().min(1),
				client: z.string().min(1),
				industry: z.string().min(1),
				tags: z.array(z.string()),
				excerpt: z.string().min(1),
				challenge: z.string().min(1),
				solution: z.string().min(1),
				results: z.array(z.string()),
				published: z.boolean().default(false),
				pdfUrl: z.string().optional(),
				coverImage: z.string().optional(),
				emailGated: z.boolean().default(false)
			})
		)
		.mutation(async ({ ctx, input }) => {
			const cs = await ctx.db.caseStudy.create({ data: input });
			await invalidateAccelerate([tag("cs_list")]);
			revalidatePath("/case-studies");
			revalidatePath("/case-studies/[slug]", "page");
			return cs;
		}),

	update: moduleProcedure("caseStudies")
		.input(
			z.object({
				id: z.string(),
				title: z.string().optional(),
				slug: z.string().optional(),
				client: z.string().optional(),
				industry: z.string().optional(),
				tags: z.array(z.string()).optional(),
				excerpt: z.string().optional(),
				challenge: z.string().optional(),
				solution: z.string().optional(),
				results: z.array(z.string()).optional(),
				published: z.boolean().optional(),
				pdfUrl: z.string().optional(),
				coverImage: z.string().optional(),
				emailGated: z.boolean().optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const { id, ...data } = input;
			const existing = await ctx.db.caseStudy.findUnique({ where: { id }, select: { slug: true } });
			const safeData = {
				...data,
				pdfUrl: data.pdfUrl || undefined,
				coverImage: data.coverImage || undefined
			};
			const cs = await ctx.db.caseStudy.update({ where: { id }, data: safeData });
			const slugToInvalidate = data.slug ?? existing?.slug;
			await invalidateAccelerate(slugToInvalidate ? [tag("cs_list"), tag(`cs_${slugToInvalidate}`)] : [tag("cs_list")]);
			revalidatePath("/case-studies");
			if (slugToInvalidate) revalidatePath(`/case-studies/${slugToInvalidate}`);
			revalidatePath("/case-studies/[slug]", "page");
			return cs;
		}),

	delete: moduleProcedure("caseStudies")
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const existing = await ctx.db.caseStudy.findUnique({
				where: { id: input.id },
				select: { slug: true }
			});
			const cs = await ctx.db.caseStudy.delete({ where: { id: input.id } });
			await invalidateAccelerate(existing?.slug ? [tag("cs_list"), tag(`cs_${existing.slug}`)] : [tag("cs_list")]);
			revalidatePath("/case-studies");
			if (existing?.slug) revalidatePath(`/case-studies/${existing.slug}`);
			revalidatePath("/case-studies/[slug]", "page");
			return cs;
		})
});
