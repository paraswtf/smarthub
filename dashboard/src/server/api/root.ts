import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { userRouter } from "./routers/user";
import { deviceRouter } from "./routers/device";
import { apiKeyRouter } from "./routers/apiKey";
import { detectorRouter } from "./routers/detector";

export const appRouter = createTRPCRouter({
	user: userRouter,
	device: deviceRouter,
	apiKey: apiKeyRouter,
	detector: detectorRouter
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
