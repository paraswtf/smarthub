import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { userRouter } from "./routers/user";
import { deviceRouter } from "./routers/device";
import { apiKeyRouter } from "./routers/apiKey";
import { switchRouter } from "./routers/switch";

export const appRouter = createTRPCRouter({
	user: userRouter,
	device: deviceRouter,
	apiKey: apiKeyRouter,
	switch: switchRouter
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
