import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
	server: {
		AUTH_SECRET: process.env.NODE_ENV === "production" ? z.string() : z.string().optional(),
		AUTH_GOOGLE_CLIENT_ID: z.string().optional(),
		AUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),
		DATABASE_URL: z.string().min(1),
		NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
		// Brevo - transactional email (API)
		BREVO_API_KEY: z.string().optional(),
		BREVO_SENDER_EMAIL: z.string().email().optional(),
		// Redis - rate limiting (used when implemented)
		REDIS_URL: z.string().optional(),
		// WebSocket server
		WS_PORT: z.string().optional(),
		WS_SECRET: z.string().optional(),
		WS_INTERNAL_URL: z.string().url().optional(),
	},
	client: {},
	runtimeEnv: {
		AUTH_SECRET: process.env.AUTH_SECRET,
		AUTH_GOOGLE_CLIENT_ID: process.env.AUTH_GOOGLE_CLIENT_ID,
		AUTH_GOOGLE_CLIENT_SECRET: process.env.AUTH_GOOGLE_CLIENT_SECRET,
		DATABASE_URL: process.env.DATABASE_URL,
		NODE_ENV: process.env.NODE_ENV,
		BREVO_API_KEY: process.env.BREVO_API_KEY,
		BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL,
		REDIS_URL: process.env.REDIS_URL,
		WS_PORT: process.env.WS_PORT,
		WS_SECRET: process.env.WS_SECRET,
		WS_INTERNAL_URL: process.env.WS_INTERNAL_URL,
	},
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	emptyStringAsUndefined: true,
});
