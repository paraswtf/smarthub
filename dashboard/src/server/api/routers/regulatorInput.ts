import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { getDeviceAccess } from "~/server/api/lib/permissions";

const speedPinSchema = z.object({
	speed: z.number().int().min(1).max(7),
	pin: z.number().int().min(0).max(39),
	minRaw: z.number().int().min(0).max(4095).default(3970),
	maxRaw: z.number().int().min(0).max(4095).default(4095),
});

function wsUrl(path: string) {
	return `${process.env.WS_INTERNAL_URL ?? `http://localhost:${process.env.WS_PORT ?? 4001}`}${path}`;
}

async function callWs(path: string, body: object) {
	return fetch(wsUrl(path), {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-internal-secret": process.env.WS_SECRET ?? "" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(2000),
	});
}

function assertDeviceOwned(deviceId: string, userId: string, ctx: { db: typeof import("~/server/db").db }) {
	return ctx.db.device.findFirst({
		where: { id: deviceId, apiKey: { userId } },
	});
}

export const regulatorInputRouter = createTRPCRouter({
	/** List all regulator inputs for a device (owner or shared user) */
	list: protectedProcedure.input(z.object({ deviceId: z.string() })).query(async ({ ctx, input }) => {
		const access = await getDeviceAccess(ctx.db, input.deviceId, ctx.session.user.id);
		if (access === "none") throw new TRPCError({ code: "FORBIDDEN" });
		return ctx.db.regulatorInput.findMany({
			where: { deviceId: input.deviceId },
			orderBy: { createdAt: "asc" },
		});
	}),

	/** List all regulators across all user devices - for cross-device linking */
	listAllRegulators: protectedProcedure.query(async ({ ctx }) => {
		const apiKeys = await ctx.db.apiKey.findMany({
			where: { userId: ctx.session.user.id, active: true },
			include: {
				devices: {
					include: { regulators: { orderBy: { order: "asc" } } },
					orderBy: { name: "asc" },
				},
			},
		});
		return apiKeys.flatMap((k) => k.devices.flatMap((d) => d.regulators.map((r) => ({ ...r, deviceName: d.name }))));
	}),

	/** Add a regulator input to a device */
	add: protectedProcedure
		.input(
			z.object({
				deviceId: z.string(),
				label: z.string().min(1).max(40).default("Regulator Input"),
				pins: z.array(speedPinSchema).min(1).max(7),
				linkedRegulatorId: z.string(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const owned = await assertDeviceOwned(input.deviceId, ctx.session.user.id, ctx);
			if (!owned) throw new TRPCError({ code: "FORBIDDEN" });

			// Verify linked regulator belongs to the same user
			const reg = await ctx.db.regulator.findFirst({
				where: { id: input.linkedRegulatorId, device: { apiKey: { userId: ctx.session.user.id } } },
			});
			if (!reg) throw new TRPCError({ code: "BAD_REQUEST", message: "Linked regulator not found" });

			const ri = await ctx.db.regulatorInput.create({
				data: {
					deviceId: input.deviceId,
					label: input.label,
					pins: input.pins,
					linkedRegulatorId: input.linkedRegulatorId,
				},
			});

			try {
				await callWs("/push-reg-input-add", {
					deviceId: input.deviceId,
					regInput: { id: ri.id, label: ri.label, pins: ri.pins, linkedRegulatorId: ri.linkedRegulatorId },
				});
			} catch {
				/* offline */
			}

			return ri;
		}),

	/** Update a regulator input */
	update: protectedProcedure
		.input(
			z.object({
				regulatorInputId: z.string(),
				label: z.string().min(1).max(40).optional(),
				pins: z.array(speedPinSchema).min(1).max(7).optional(),
				linkedRegulatorId: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { regulatorInputId, ...data } = input;
			const ri = await ctx.db.regulatorInput.findFirst({
				where: { id: regulatorInputId, device: { apiKey: { userId: ctx.session.user.id } } },
			});
			if (!ri) throw new TRPCError({ code: "FORBIDDEN" });

			const updated = await ctx.db.regulatorInput.update({ where: { id: regulatorInputId }, data });

			try {
				await callWs("/push-reg-input-update", {
					deviceId: updated.deviceId,
					regInput: { id: updated.id, label: updated.label, pins: updated.pins, linkedRegulatorId: updated.linkedRegulatorId },
				});
			} catch {
				/* offline */
			}

			return updated;
		}),

	/** Delete a regulator input */
	delete: protectedProcedure.input(z.object({ regulatorInputId: z.string() })).mutation(async ({ ctx, input }) => {
		const ri = await ctx.db.regulatorInput.findFirst({
			where: { id: input.regulatorInputId, device: { apiKey: { userId: ctx.session.user.id } } },
		});
		if (!ri) throw new TRPCError({ code: "FORBIDDEN" });

		await ctx.db.regulatorInput.delete({ where: { id: input.regulatorInputId } });

		try {
			await callWs("/push-reg-input-delete", { deviceId: ri.deviceId, regulatorInputId: input.regulatorInputId });
		} catch {
			/* offline */
		}

		return { ok: true };
	}),

	/** Start streaming raw ADC samples from the device for calibration (owner only) */
	startCalibration: protectedProcedure.input(z.object({ regulatorInputId: z.string() })).mutation(async ({ ctx, input }) => {
		const ri = await ctx.db.regulatorInput.findFirst({
			where: { id: input.regulatorInputId, device: { apiKey: { userId: ctx.session.user.id } } },
		});
		if (!ri) throw new TRPCError({ code: "FORBIDDEN" });

		const res = await callWs("/start-reg-input-calibration", {
			deviceId: ri.deviceId,
			regInputId: ri.id,
		}).catch(() => null);

		if (!res || !res.ok) {
			const message = res ? await res.text().catch(() => "device offline") : "device offline";
			throw new TRPCError({ code: "BAD_REQUEST", message: message || "device offline" });
		}

		return { ok: true };
	}),

	/** Stop the calibration stream */
	stopCalibration: protectedProcedure.input(z.object({ regulatorInputId: z.string() })).mutation(async ({ ctx, input }) => {
		const ri = await ctx.db.regulatorInput.findFirst({
			where: { id: input.regulatorInputId, device: { apiKey: { userId: ctx.session.user.id } } },
		});
		if (!ri) throw new TRPCError({ code: "FORBIDDEN" });

		await callWs("/stop-reg-input-calibration", {
			deviceId: ri.deviceId,
			regInputId: ri.id,
		}).catch(() => null);

		return { ok: true };
	}),
});
