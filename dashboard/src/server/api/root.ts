import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { userRouter } from "./routers/user";
import { deviceRouter } from "./routers/device";
import { apiKeyRouter } from "./routers/apiKey";
import { switchRouter } from "./routers/switch";
import { homeRouter } from "./routers/home";
import { sharingRouter } from "./routers/sharing";

export const appRouter = createTRPCRouter({
	user: userRouter,
	device: deviceRouter,
	apiKey: apiKeyRouter,
	switch: switchRouter,
	home: homeRouter,
	sharing: sharingRouter
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
