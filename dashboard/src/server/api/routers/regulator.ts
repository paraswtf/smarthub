import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { getDeviceAccess } from "~/server/api/lib/permissions";
import { appConfig } from "~/../globals.config";

const INPUT_ONLY_PINS = [34, 35, 36, 37, 38, 39];

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

const speedComboSchema = z.object({
	speed: z.number().int().min(1).max(7),
	onPins: z.array(z.number().int().min(0).max(33)).max(8),
});

function assertDeviceOwned(deviceId: string, userId: string, ctx: { db: typeof import("~/server/db").db }) {
	return ctx.db.device.findFirst({
		where: { id: deviceId, apiKey: { userId } },
	});
}

function validateOutputPins(pins: number[]) {
	for (const pin of pins) {
		if (INPUT_ONLY_PINS.includes(pin)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `GPIO${pin} is input-only on ESP32 (pins 34–39 cannot drive outputs). Use pins 2, 4, 5, 12–27, or 32–33.`,
			});
		}
	}
}

export const regulatorRouter = createTRPCRouter({
	/** List all regulators for a device (owner or shared user) */
	list: protectedProcedure.input(z.object({ deviceId: z.string() })).query(async ({ ctx, input }) => {
		const access = await getDeviceAccess(ctx.db, input.deviceId, ctx.session.user.id);
		if (access === "none") throw new TRPCError({ code: "FORBIDDEN" });
		return ctx.db.regulator.findMany({
			where: { deviceId: input.deviceId },
			orderBy: { order: "asc" },
		});
	}),

	/** Add a regulator to a device */
	add: protectedProcedure
		.input(
			z.object({
				deviceId: z.string(),
				label: z.string().min(1).max(40).default("Fan Regulator"),
				outputPins: z.array(z.number().int().min(0).max(33)).min(1).max(8),
				speeds: z.array(speedComboSchema).min(1).max(7),
				icon: z.string().default("fan"),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const owned = await assertDeviceOwned(input.deviceId, ctx.session.user.id, ctx);
			if (!owned) throw new TRPCError({ code: "FORBIDDEN" });

			validateOutputPins(input.outputPins);

			const existing = await ctx.db.regulator.count({ where: { deviceId: input.deviceId } });
			if (existing >= appConfig.maxRegulatorsPerDevice) {
				throw new TRPCError({ code: "BAD_REQUEST", message: `Max ${appConfig.maxRegulatorsPerDevice} regulators per device` });
			}

			const reg = await ctx.db.regulator.create({
				data: {
					deviceId: input.deviceId,
					label: input.label,
					outputPins: input.outputPins,
					speeds: input.speeds,

					icon: input.icon,
					order: existing,
				},
			});

			try {
				await callWs("/push-regulator-add", {
					deviceId: input.deviceId,
					regulator: {
						id: reg.id,
						label: reg.label,
						outputPins: reg.outputPins,
						speeds: reg.speeds,

						speed: reg.speed,
					},
				});
			} catch {
				/* offline - picks up on reconnect */
			}

			return reg;
		}),

	/** Update a regulator */
	update: protectedProcedure
		.input(
			z.object({
				regulatorId: z.string(),
				label: z.string().min(1).max(40).optional(),
				outputPins: z.array(z.number().int().min(0).max(33)).min(1).max(8).optional(),
				speeds: z.array(speedComboSchema).min(1).max(7).optional(),

				icon: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { regulatorId, ...data } = input;
			const reg = await ctx.db.regulator.findFirst({
				where: { id: regulatorId, device: { apiKey: { userId: ctx.session.user.id } } },
			});
			if (!reg) throw new TRPCError({ code: "FORBIDDEN" });

			if (data.outputPins) validateOutputPins(data.outputPins);

			const updated = await ctx.db.regulator.update({ where: { id: regulatorId }, data });

			try {
				await callWs("/push-regulator-update", {
					deviceId: updated.deviceId,
					regulator: {
						id: updated.id,
						label: updated.label,
						outputPins: updated.outputPins,
						speeds: updated.speeds,

						speed: updated.speed,
					},
				});
			} catch {
				/* offline */
			}

			return updated;
		}),

	/** Delete a regulator */
	delete: protectedProcedure.input(z.object({ regulatorId: z.string() })).mutation(async ({ ctx, input }) => {
		const reg = await ctx.db.regulator.findFirst({
			where: { id: input.regulatorId, device: { apiKey: { userId: ctx.session.user.id } } },
		});
		if (!reg) throw new TRPCError({ code: "FORBIDDEN" });

		await ctx.db.regulator.delete({ where: { id: input.regulatorId } });

		try {
			await callWs("/push-regulator-delete", { deviceId: reg.deviceId, regulatorId: input.regulatorId });
		} catch {
			/* offline */
		}

		return { ok: true };
	}),

	/** Set regulator speed (owner or shared user) */
	setSpeed: protectedProcedure.input(z.object({ regulatorId: z.string(), speed: z.number().int().min(0).max(7) })).mutation(async ({ ctx, input }) => {
		const reg = await ctx.db.regulator.findFirst({
			where: { id: input.regulatorId },
			select: { id: true, speed: true, deviceId: true, speeds: true },
		});
		if (!reg) throw new TRPCError({ code: "NOT_FOUND" });

		const access = await getDeviceAccess(ctx.db, reg.deviceId, ctx.session.user.id);
		if (access === "none") throw new TRPCError({ code: "FORBIDDEN" });

		// Validate speed is within configured range
		const maxSpeed = reg.speeds.length > 0 ? Math.max(...reg.speeds.map((s) => s.speed)) : 0;
		if (input.speed > maxSpeed) {
			throw new TRPCError({ code: "BAD_REQUEST", message: `Speed ${input.speed} exceeds max configured speed ${maxSpeed}` });
		}

		let pushed = false;
		try {
			const res = await callWs("/push-regulator-speed", {
				deviceId: reg.deviceId,
				regulatorId: input.regulatorId,
				speed: input.speed,
			});
			const data = (await res.json()) as { pushed?: boolean };
			pushed = data.pushed === true;
		} catch {
			/* WS server unreachable */
		}

		if (pushed) {
			// ESP32 received the command - regulator_ack will confirm in DB
			return { ...reg, speed: reg.speed };
		}

		// Not connected - write DB so it syncs on next ping
		return ctx.db.regulator.update({ where: { id: input.regulatorId }, data: { speed: input.speed, updatedAt: new Date() } });
	}),
});
