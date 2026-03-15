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

const resolveAuthorImage = async (authorId: string | null | undefined): Promise<string | null> => {
	if (!authorId || authorId === "superadmin") return null;
	try {
		const user = await db.user.findUnique({ where: { id: authorId }, select: { image: true } });
		return user?.image ?? null;
	} catch {
		return null;
	}
};

export const blogRouter = createTRPCRouter({
	getAll: publicProcedure.input(z.object({ category: z.string().optional(), published: z.boolean().optional() })).query(async ({ ctx, input }) => {
		type PostRow = { id: string; title: string; slug: string; excerpt: string; category: string; readTime: string; author: string; authorRole: string; authorId: string | null; coverImage: string | null; published: boolean; createdAt: Date };
		const posts = (await ctx.db.post.findMany({
			where: {
				...(input.published !== undefined && { published: input.published }),
				...(input.category && { category: input.category })
			},
			select: {
				id: true,
				title: true,
				slug: true,
				excerpt: true,
				category: true,
				readTime: true,
				author: true,
				authorRole: true,
				authorId: true,
				coverImage: true,
				published: true,
				createdAt: true
			},
			orderBy: { createdAt: "desc" },
			...(isAccelerate && { cacheStrategy: { ttl: 60, swr: 300, tags: [tag("blog_list")] } })
		})) as PostRow[];

		const uniqueAuthorIds = [...new Set(posts.map((p) => p.authorId).filter((id): id is string => !!id && id !== "superadmin"))];
		const users: { id: string; image: string | null }[] = uniqueAuthorIds.length ? await ctx.db.user.findMany({ where: { id: { in: uniqueAuthorIds } }, select: { id: true, image: true } }) : [];
		const imageMap: Record<string, string | null> = Object.fromEntries(users.map((u) => [u.id, u.image ?? null]));

		return posts.map((p) => ({ ...p, authorImage: p.authorId ? (imageMap[p.authorId] ?? null) : null }));
	}),

	getById: moduleProcedure("blog")
		.input(z.object({ id: z.string() }))
		.query(async ({ ctx, input }) => {
			return ctx.db.post.findUnique({ where: { id: input.id } });
		}),

	getBySlug: publicProcedure.input(z.object({ slug: z.string() })).query(async ({ ctx, input }) => {
		const post = await ctx.db.post.findUnique({
			where: { slug: input.slug },
			...(isAccelerate && { cacheStrategy: { ttl: 300, swr: 3600, tags: [tag("blog_list"), tag(`blog_${input.slug}`)] } })
		});
		if (!post) return null;
		const authorImage = await resolveAuthorImage(post.authorId);
		return { ...post, authorImage };
	}),

	create: moduleProcedure("blog")
		.input(
			z.object({
				title: z.string().min(1),
				slug: z.string().min(1),
				excerpt: z.string().min(1),
				content: z.string().min(1),
				category: z.string().min(1),
				readTime: z.string().min(1),
				published: z.boolean().default(false),
				author: z.string().optional(),
				authorRole: z.string().optional(),
				authorId: z.string().optional(),
				coverImage: z.string().optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const post = await ctx.db.post.create({ data: input });
			await invalidateAccelerate([tag("blog_list")]);
			revalidatePath("/blog");
			revalidatePath("/blog/[slug]", "page");
			return post;
		}),

	update: moduleProcedure("blog")
		.input(
			z.object({
				id: z.string(),
				title: z.string().optional(),
				slug: z.string().optional(),
				excerpt: z.string().optional(),
				content: z.string().optional(),
				category: z.string().optional(),
				readTime: z.string().optional(),
				published: z.boolean().optional(),
				author: z.string().optional(),
				authorRole: z.string().optional(),
				authorId: z.string().optional(),
				coverImage: z.string().optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const { id, ...data } = input;
			const existing = await ctx.db.post.findUnique({ where: { id }, select: { slug: true } });
			const safeData = {
				...data,
				// Empty string means "remove image"; undefined means "no change"
				coverImage: data.coverImage === undefined ? undefined : data.coverImage || null,
				author: data.author || undefined,
				authorRole: data.authorRole || undefined
			};
			const post = await ctx.db.post.update({ where: { id }, data: safeData });
			const slugToInvalidate = data.slug ?? existing?.slug;
			await invalidateAccelerate(slugToInvalidate ? [tag("blog_list"), tag(`blog_${slugToInvalidate}`)] : [tag("blog_list")]);
			revalidatePath("/blog");
			if (slugToInvalidate) revalidatePath(`/blog/${slugToInvalidate}`);
			revalidatePath("/blog/[slug]", "page");
			return post;
		}),

	delete: moduleProcedure("blog")
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const existing = await ctx.db.post.findUnique({ where: { id: input.id }, select: { slug: true } });
			const post = await ctx.db.post.delete({ where: { id: input.id } });
			await invalidateAccelerate(existing?.slug ? [tag("blog_list"), tag(`blog_${existing.slug}`)] : [tag("blog_list")]);
			revalidatePath("/blog");
			if (existing?.slug) revalidatePath(`/blog/${existing.slug}`);
			revalidatePath("/blog/[slug]", "page");
			return post;
		}),

	// One-time backfill: sets authorId on posts that have a matching user by name
	backfillAuthorIds: moduleProcedure("blog").mutation(async ({ ctx }) => {
		const users: { id: string; name: string | null }[] = await ctx.db.user.findMany({ select: { id: true, name: true } });
		const nameToId = Object.fromEntries(users.filter((u) => u.name).map((u) => [u.name!, u.id]));
		const posts = await ctx.db.post.findMany({ where: { authorId: null }, select: { id: true, author: true } });
		let updated = 0;
		for (const post of posts) {
			const userId = post.author ? nameToId[post.author] : undefined;
			if (userId) {
				await ctx.db.post.update({ where: { id: post.id }, data: { authorId: userId } });
				updated++;
			}
		}
		await invalidateAccelerate([tag("blog_list")]);
		revalidatePath("/blog");
		revalidatePath("/blog/[slug]", "page");
		return { updated, total: posts.length };
	})
});
