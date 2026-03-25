import { initTRPC, TRPCError, type TRPCDefaultErrorShape } from "@trpc/server";
import { type NextRequest } from "next/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { unstable_noStore as noStore } from "next/cache";

import { auth } from "~/server/auth";
import { db } from "~/server/db";

export const createTRPCContext = async (opts: { req: NextRequest }) => {
	noStore();
	const session = await auth();
	return { db, session, ...opts };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
	transformer: superjson,
	errorFormatter({ shape, error }: { shape: TRPCDefaultErrorShape; error: TRPCError }) {
		return {
			...shape,
			data: {
				...shape.data,
				zodError: error.cause instanceof ZodError ? error.cause.flatten() : null
			}
		};
	}
});

export const createCallerFactory = t.createCallerFactory;
export const createTRPCRouter = t.router;

const timingMiddleware = t.middleware(async (opts) => {
	const start = Date.now();
	if (t._config.isDev) {
		const waitMs = Math.floor(Math.random() * 400) + 100;
		await new Promise((resolve) => setTimeout(resolve, waitMs));
	}
	const result = await opts.next();
	console.log(`[TRPC] ${opts.path} took ${String(Date.now() - start)}ms to execute`);
	return result;
});

export const publicProcedure = t.procedure.use(timingMiddleware);

// Any authenticated user
export const protectedProcedure = t.procedure.use(timingMiddleware).use((opts) => {
	if (!opts.ctx.session?.user?.id) {
		throw new TRPCError({ code: "UNAUTHORIZED" });
	}
	return opts.next({ ctx: { ...opts.ctx, session: opts.ctx.session } });
});
