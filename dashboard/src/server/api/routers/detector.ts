import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";

const INPUT_ONLY_PINS = [34, 35, 36, 37, 38, 39]; // these are INPUT-ONLY — ideal for detectors

function assertDeviceOwned(deviceId: string, userId: string, ctx: { db: typeof import("~/server/db").db }) {
	return ctx.db.device.findFirst({
		where: { id: deviceId, apiKey: { userId } }
	});
}

export const detectorRouter = createTRPCRouter({
	/** List all detectors for a device */
	list: protectedProcedure.input(z.object({ deviceId: z.string() })).query(async ({ ctx, input }) => {
		const owned = await assertDeviceOwned(input.deviceId, ctx.session.user.id, ctx);
		if (!owned) throw new TRPCError({ code: "FORBIDDEN" });
		return ctx.db.detector.findMany({
			where: { deviceId: input.deviceId },
			orderBy: { createdAt: "asc" }
		});
	}),

	/** List all relays across all user devices — for cross-device linking */
	listAllRelays: protectedProcedure.query(async ({ ctx }) => {
		const apiKeys = await ctx.db.apiKey.findMany({
			where: { userId: ctx.session.user.id, active: true },
			include: {
				devices: {
					include: { relays: { orderBy: { order: "asc" } } },
					orderBy: { name: "asc" }
				}
			}
		});
		return apiKeys.flatMap((k: (typeof apiKeys)[number]) => k.devices.flatMap((d: (typeof k.devices)[number]) => d.relays.map((r: (typeof d.relays)[number]) => ({ ...r, deviceName: d.name }))));
	}),

	/** Add a detector to a device */
	add: protectedProcedure
		.input(
			z.object({
				deviceId: z.string(),
				pin: z.number().int().min(0).max(39),
				label: z.string().min(1).max(40).default("Switch"),
				switchType: z.enum(["latching", "momentary"]).default("latching"),
				linkedRelayId: z.string()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const owned = await assertDeviceOwned(input.deviceId, ctx.session.user.id, ctx);
			if (!owned) throw new TRPCError({ code: "FORBIDDEN" });

			// Verify linked relay belongs to the same user (any of their devices)
			const relay = await ctx.db.relay.findFirst({
				where: { id: input.linkedRelayId, device: { apiKey: { userId: ctx.session.user.id } } }
			});
			if (!relay) throw new TRPCError({ code: "BAD_REQUEST", message: "Linked relay not found" });

			const detector = await ctx.db.detector.create({
				data: {
					deviceId: input.deviceId,
					pin: input.pin,
					label: input.label,
					switchType: input.switchType,
					linkedRelayId: input.linkedRelayId
				}
			});

			// Push to connected ESP32
			const wsUrl = `${process.env.WS_INTERNAL_URL ?? `http://localhost:${process.env.WS_PORT ?? 4001}`}/push-detector-add`;
			try {
				await fetch(wsUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json", "x-internal-secret": process.env.WS_SECRET ?? "" },
					body: JSON.stringify({ deviceId: input.deviceId, detector: { id: detector.id, pin: detector.pin, label: detector.label, switchType: detector.switchType, linkedRelayId: detector.linkedRelayId } }),
					signal: AbortSignal.timeout(2000)
				});
			} catch {
				/* offline — picks up on reconnect */
			}

			return detector;
		}),

	/** Update a detector */
	update: protectedProcedure
		.input(
			z.object({
				detectorId: z.string(),
				pin: z.number().int().min(0).max(39).optional(),
				label: z.string().min(1).max(40).optional(),
				switchType: z.enum(["latching", "momentary"]).optional(),
				linkedRelayId: z.string().optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const { detectorId, ...data } = input;
			const detector = await ctx.db.detector.findFirst({
				where: { id: detectorId, device: { apiKey: { userId: ctx.session.user.id } } }
			});
			if (!detector) throw new TRPCError({ code: "FORBIDDEN" });

			const updated = await ctx.db.detector.update({ where: { id: detectorId }, data });

			const wsUrl = `${process.env.WS_INTERNAL_URL ?? `http://localhost:${process.env.WS_PORT ?? 4001}`}/push-detector-update`;
			try {
				await fetch(wsUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json", "x-internal-secret": process.env.WS_SECRET ?? "" },
					body: JSON.stringify({ deviceId: updated.deviceId, detector: { id: updated.id, pin: updated.pin, label: updated.label, switchType: updated.switchType, linkedRelayId: updated.linkedRelayId } }),
					signal: AbortSignal.timeout(2000)
				});
			} catch {
				/* offline */
			}

			return updated;
		}),

	/** Delete a detector */
	delete: protectedProcedure.input(z.object({ detectorId: z.string() })).mutation(async ({ ctx, input }) => {
		const detector = await ctx.db.detector.findFirst({
			where: { id: input.detectorId, device: { apiKey: { userId: ctx.session.user.id } } }
		});
		if (!detector) throw new TRPCError({ code: "FORBIDDEN" });

		await ctx.db.detector.delete({ where: { id: input.detectorId } });

		const wsUrl = `${process.env.WS_INTERNAL_URL ?? `http://localhost:${process.env.WS_PORT ?? 4001}`}/push-detector-delete`;
		try {
			await fetch(wsUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json", "x-internal-secret": process.env.WS_SECRET ?? "" },
				body: JSON.stringify({ deviceId: detector.deviceId, detectorId: input.detectorId }),
				signal: AbortSignal.timeout(2000)
			});
		} catch {
			/* offline */
		}

		return { ok: true };
	})
});
