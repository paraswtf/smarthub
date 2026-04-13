import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { getDeviceAccess } from "~/server/api/lib/permissions";

const INPUT_ONLY_PINS = [34, 35, 36, 37, 38, 39]; // these are INPUT-ONLY - ideal for switches

function assertDeviceOwned(deviceId: string, userId: string, ctx: { db: typeof import("~/server/db").db }) {
	return ctx.db.device.findFirst({
		where: { id: deviceId, apiKey: { userId } },
	});
}

export const switchRouter = createTRPCRouter({
	/** List all switches for a device (owner or shared user) */
	list: protectedProcedure.input(z.object({ deviceId: z.string() })).query(async ({ ctx, input }) => {
		const access = await getDeviceAccess(ctx.db, input.deviceId, ctx.session.user.id);
		if (access === "none") throw new TRPCError({ code: "FORBIDDEN" });
		return ctx.db.switch.findMany({
			where: { deviceId: input.deviceId },
			orderBy: { createdAt: "asc" },
		});
	}),

	/** List all relays across all user devices - for cross-device linking */
	listAllRelays: protectedProcedure.query(async ({ ctx }) => {
		const apiKeys = await ctx.db.apiKey.findMany({
			where: { userId: ctx.session.user.id, active: true },
			include: {
				devices: {
					include: { relays: { orderBy: { order: "asc" } } },
					orderBy: { name: "asc" },
				},
			},
		});
		return apiKeys.flatMap((k: (typeof apiKeys)[number]) => k.devices.flatMap((d: (typeof k.devices)[number]) => d.relays.map((r: (typeof d.relays)[number]) => ({ ...r, deviceName: d.name }))));
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
		return apiKeys.flatMap((k: (typeof apiKeys)[number]) =>
			k.devices.flatMap((d: (typeof k.devices)[number]) => d.regulators.map((r: (typeof d.regulators)[number]) => ({ ...r, deviceName: d.name }))),
		);
	}),

	/** Add a switch to a device */
	add: protectedProcedure
		.input(
			z
				.object({
					deviceId: z.string(),
					pin: z.number().int().min(0).max(39),
					label: z.string().min(1).max(40).default("Switch"),
					switchType: z.enum(["two_way", "three_way", "momentary"]).default("two_way"),
					linkedRelayId: z.string().optional(),
					linkedRegulatorId: z.string().optional(),
				})
				.refine((d) => !!d.linkedRelayId !== !!d.linkedRegulatorId, {
					message: "Exactly one of linkedRelayId or linkedRegulatorId must be set",
				}),
		)
		.mutation(async ({ ctx, input }) => {
			const owned = await assertDeviceOwned(input.deviceId, ctx.session.user.id, ctx);
			if (!owned) throw new TRPCError({ code: "FORBIDDEN" });

			if (input.linkedRelayId) {
				const relay = await ctx.db.relay.findFirst({
					where: { id: input.linkedRelayId, device: { apiKey: { userId: ctx.session.user.id } } },
				});
				if (!relay) throw new TRPCError({ code: "BAD_REQUEST", message: "Linked relay not found" });
			} else if (input.linkedRegulatorId) {
				const reg = await ctx.db.regulator.findFirst({
					where: { id: input.linkedRegulatorId, device: { apiKey: { userId: ctx.session.user.id } } },
				});
				if (!reg) throw new TRPCError({ code: "BAD_REQUEST", message: "Linked regulator not found" });
			}

			const sw = await ctx.db.switch.create({
				data: {
					deviceId: input.deviceId,
					pin: input.pin,
					label: input.label,
					switchType: input.switchType,
					linkedRelayId: input.linkedRelayId ?? null,
					linkedRegulatorId: input.linkedRegulatorId ?? null,
				},
			});

			// Push to connected ESP32
			const wsUrl = `${process.env.WS_INTERNAL_URL ?? `http://localhost:${process.env.WS_PORT ?? 4001}`}/push-switch-add`;
			try {
				await fetch(wsUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json", "x-internal-secret": process.env.WS_SECRET ?? "" },
					body: JSON.stringify({
						deviceId: input.deviceId,
						switch: {
							id: sw.id,
							pin: sw.pin,
							label: sw.label,
							switchType: sw.switchType,
							linkedRelayId: sw.linkedRelayId ?? "",
							linkedRegulatorId: sw.linkedRegulatorId ?? "",
						},
					}),
					signal: AbortSignal.timeout(2000),
				});
			} catch {
				/* offline - picks up on reconnect */
			}

			return sw;
		}),

	/** Update a switch */
	update: protectedProcedure
		.input(
			z
				.object({
					switchId: z.string(),
					pin: z.number().int().min(0).max(39).optional(),
					label: z.string().min(1).max(40).optional(),
					switchType: z.enum(["two_way", "three_way", "momentary"]).optional(),
					linkedRelayId: z.string().nullable().optional(),
					linkedRegulatorId: z.string().nullable().optional(),
				})
				.refine(
					(d) => {
						// If neither field is being touched, accept (label/pin-only edits).
						// If either is set in the payload, exactly one must be a non-empty string.
						const touchingLink = d.linkedRelayId !== undefined || d.linkedRegulatorId !== undefined;
						if (!touchingLink) return true;
						const hasRelay = !!d.linkedRelayId;
						const hasReg = !!d.linkedRegulatorId;
						return hasRelay !== hasReg;
					},
					{ message: "Exactly one of linkedRelayId or linkedRegulatorId must be set" },
				),
		)
		.mutation(async ({ ctx, input }) => {
			const { switchId, linkedRelayId, linkedRegulatorId, ...rest } = input;
			const sw = await ctx.db.switch.findFirst({
				where: { id: switchId, device: { apiKey: { userId: ctx.session.user.id } } },
			});
			if (!sw) throw new TRPCError({ code: "FORBIDDEN" });

			// When the link target is being changed, force the unused side to null so we never
			// end up with both fields populated.
			const linkUpdate: { linkedRelayId?: string | null; linkedRegulatorId?: string | null } = {};
			if (linkedRelayId !== undefined || linkedRegulatorId !== undefined) {
				linkUpdate.linkedRelayId = linkedRelayId ?? null;
				linkUpdate.linkedRegulatorId = linkedRegulatorId ?? null;
			}

			const updated = await ctx.db.switch.update({ where: { id: switchId }, data: { ...rest, ...linkUpdate } });

			const wsUrl = `${process.env.WS_INTERNAL_URL ?? `http://localhost:${process.env.WS_PORT ?? 4001}`}/push-switch-update`;
			try {
				await fetch(wsUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json", "x-internal-secret": process.env.WS_SECRET ?? "" },
					body: JSON.stringify({
						deviceId: updated.deviceId,
						switch: {
							id: updated.id,
							pin: updated.pin,
							label: updated.label,
							switchType: updated.switchType,
							linkedRelayId: updated.linkedRelayId ?? "",
							linkedRegulatorId: updated.linkedRegulatorId ?? "",
						},
					}),
					signal: AbortSignal.timeout(2000),
				});
			} catch {
				/* offline */
			}

			return updated;
		}),

	/** Delete a switch */
	delete: protectedProcedure.input(z.object({ switchId: z.string() })).mutation(async ({ ctx, input }) => {
		const sw = await ctx.db.switch.findFirst({
			where: { id: input.switchId, device: { apiKey: { userId: ctx.session.user.id } } },
		});
		if (!sw) throw new TRPCError({ code: "FORBIDDEN" });

		await ctx.db.switch.delete({ where: { id: input.switchId } });

		const wsUrl = `${process.env.WS_INTERNAL_URL ?? `http://localhost:${process.env.WS_PORT ?? 4001}`}/push-switch-delete`;
		try {
			await fetch(wsUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json", "x-internal-secret": process.env.WS_SECRET ?? "" },
				body: JSON.stringify({ deviceId: sw.deviceId, switchId: input.switchId }),
				signal: AbortSignal.timeout(2000),
			});
		} catch {
			/* offline */
		}

		return { ok: true };
	}),
});
