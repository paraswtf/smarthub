import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

import { env } from "~/env.js";

// Accelerate only works with prisma:// URLs. With a direct mongodb:// URL
// (local dev or non-Accelerate deployments) we fall back to plain Prisma so
// cacheStrategy options and $accelerate.invalidate() don't throw.
export const isAccelerate = env.DATABASE_URL.startsWith("prisma://");

const createPrismaClient = () => {
	const client = new PrismaClient({
		log: env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
	});
	return isAccelerate ? client.$extends(withAccelerate()) : client;
};

type PrismaClientWithAccelerate = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
	prisma: PrismaClientWithAccelerate | undefined;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") globalForPrisma.prisma = db;
