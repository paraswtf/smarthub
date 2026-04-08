import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { userRouter } from "./routers/user";
import { deviceRouter } from "./routers/device";
import { apiKeyRouter } from "./routers/apiKey";
import { switchRouter } from "./routers/switch";
import { homeRouter } from "./routers/home";
import { roomRouter } from "./routers/room";
import { sharingRouter } from "./routers/sharing";
import { scheduleRouter } from "./routers/schedule";
import { regulatorRouter } from "./routers/regulator";

export const appRouter = createTRPCRouter({
	user: userRouter,
	device: deviceRouter,
	apiKey: apiKeyRouter,
	switch: switchRouter,
	home: homeRouter,
	room: roomRouter,
	sharing: sharingRouter,
	schedule: scheduleRouter,
	regulator: regulatorRouter,
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
