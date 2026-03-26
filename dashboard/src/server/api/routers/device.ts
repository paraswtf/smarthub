import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { getDeviceAccess } from "~/server/api/lib/permissions";

// GPIO 34–39 are input-only on ESP32 — cannot be used as relay outputs
const INPUT_ONLY_PINS = [34, 35, 36, 37, 38, 39];
function validateRelayPin(pin: number | undefined) {
	if (pin !== undefined && INPUT_ONLY_PINS.includes(pin)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `GPIO${pin} is input-only on ESP32 (pins 34–39 cannot drive outputs). Use pins 2, 4, 5, 12–27, or 32–33.`
		});
	}
}

export const deviceRouter = createTRPCRouter({
	/** List all devices for the logged-in user */
	list: protectedProcedure.query(async ({ ctx }) => {
		const apiKeys = await ctx.db.apiKey.findMany({
			where: { userId: ctx.session.user.id, active: true },
			include: {
				devices: {
					include: { relays: { orderBy: { order: "asc" } } },
					orderBy: { updatedAt: "desc" }
				}
			}
		});
		return apiKeys.flatMap((k: (typeof apiKeys)[number]) => k.devices);
	}),

	/** Get a single device (owner or shared user) */
	get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
		const accessLevel = await getDeviceAccess(ctx.db, input.id, ctx.session.user.id);
		if (accessLevel === "none") throw new TRPCError({ code: "NOT_FOUND" });

		const device = await ctx.db.device.findFirst({
			where: { id: input.id },
			include: { relays: { orderBy: { order: "asc" } } }
		});
		if (!device) throw new TRPCError({ code: "NOT_FOUND" });
		return { ...device, accessLevel };
	}),

	/** Ping a device to check if it's online (sends authoritative state, waits for ack) */
	pingDevice: protectedProcedure.input(z.object({ deviceId: z.string() })).mutation(async ({ ctx, input }) => {
		// Verify ownership or shared access
		const access = await getDeviceAccess(ctx.db, input.deviceId, ctx.session.user.id);
		if (access === "none") throw new TRPCError({ code: "NOT_FOUND" });

		const wsUrl = `${process.env.WS_INTERNAL_URL ?? `http://localhost:${process.env.WS_PORT ?? 4001}`}/ping-device`;
		try {
			const res = await fetch(wsUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json", "x-internal-secret": process.env.WS_SECRET ?? "" },
				body: JSON.stringify({ deviceId: input.deviceId, timeoutMs: 3000 }),
				signal: AbortSignal.timeout(5000) // outer timeout > inner ping timeout
			});
			const data = (await res.json()) as { online?: boolean };
			if (data.online === true) {
				await ctx.db.device.update({ where: { id: input.deviceId }, data: { lastSeenAt: new Date() } });
			}
			return { online: data.online === true };
		} catch {
			return { online: false };
		}
	}),

	/** Update device name / notes */
	update: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				name: z.string().min(1).max(60).optional(),
				notes: z.string().max(500).optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const { id, ...data } = input;
			const owned = await ctx.db.device.findFirst({
				where: { id, apiKey: { userId: ctx.session.user.id } }
			});
			if (!owned) throw new TRPCError({ code: "FORBIDDEN" });
			return ctx.db.device.update({ where: { id }, data });
		}),

	/** Delete a device */
	delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
		const owned = await ctx.db.device.findFirst({
			where: { id: input.id, apiKey: { userId: ctx.session.user.id } }
		});
		if (!owned) throw new TRPCError({ code: "FORBIDDEN" });
		return ctx.db.device.delete({ where: { id: input.id } });
	}),

	/** Toggle a relay on/off (owner or shared user) */
	toggleRelay: protectedProcedure.input(z.object({ relayId: z.string(), state: z.boolean() })).mutation(async ({ ctx, input }) => {
		const relay = await ctx.db.relay.findFirst({
			where: { id: input.relayId },
			select: { id: true, pin: true, deviceId: true, state: true }
		});
		if (!relay) throw new TRPCError({ code: "NOT_FOUND" });

		const access = await getDeviceAccess(ctx.db, relay.deviceId, ctx.session.user.id);
		if (access === "none") throw new TRPCError({ code: "FORBIDDEN" });

		// Always try to push to connected ESP32 first
		const wsUrl = `${process.env.WS_INTERNAL_URL ?? `http://localhost:${process.env.WS_PORT ?? 4001}`}/push-relay`;
		let pushed = false;
		try {
			const res = await fetch(wsUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-internal-secret": process.env.WS_SECRET ?? ""
				},
				body: JSON.stringify({
					deviceId: relay.deviceId,
					relayId: input.relayId,
					pin: relay.pin,
					state: input.state
				}),
				signal: AbortSignal.timeout(2000)
			});
			const data = (await res.json()) as { pushed?: boolean };
			pushed = data.pushed === true;
		} catch {
			// WS server unreachable
		}

		if (pushed) {
			// ESP32 received the command — relay_ack will confirm in DB
			return { ...relay, state: relay.state };
		}

		// Not connected — write DB so it syncs on next ping
		return ctx.db.relay.update({
			where: { id: input.relayId },
			data: { state: input.state, updatedAt: new Date() }
		});
	}),

	/** Update relay label / icon / pin */
	updateRelay: protectedProcedure
		.input(
			z.object({
				relayId: z.string(),
				label: z.string().min(1).max(40).optional(),
				icon: z.string().optional(),
				pin: z.number().int().min(0).max(39).optional(),
				order: z.number().int().optional()
			})
		)
		.mutation(async ({ ctx, input }) => {
			const { relayId, ...data } = input;
			validateRelayPin(data.pin);
			const relay = await ctx.db.relay.findFirst({
				where: {
					id: relayId,
					device: { apiKey: { userId: ctx.session.user.id } }
				}
			});
			if (!relay) throw new TRPCError({ code: "FORBIDDEN" });

			const updated = await ctx.db.relay.update({ where: { id: relayId }, data });

			// Notify connected ESP32 so it applies the new pin/label without rebooting
			const wsUrl = `${process.env.WS_INTERNAL_URL ?? `http://localhost:${process.env.WS_PORT ?? 4001}`}/push-relay-update`;
			try {
				await fetch(wsUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-internal-secret": process.env.WS_SECRET ?? ""
					},
					body: JSON.stringify({
						deviceId: relay.deviceId,
						relay: { id: updated.id, pin: updated.pin, label: updated.label, state: updated.state, icon: updated.icon }
					}),
					signal: AbortSignal.timeout(2000)
				});
			} catch {
				// WS server unreachable — ESP32 picks up changes on next reconnect
			}

			return updated;
		}),

	/** Add a relay to a device */
	addRelay: protectedProcedure
		.input(
			z.object({
				deviceId: z.string(),
				pin: z.number().int().min(0).max(39),
				label: z.string().min(1).max(40),
				icon: z.string().default("plug")
			})
		)
		.mutation(async ({ ctx, input }) => {
			validateRelayPin(input.pin);
			const owned = await ctx.db.device.findFirst({
				where: { id: input.deviceId, apiKey: { userId: ctx.session.user.id } },
				include: { _count: { select: { relays: true } } }
			});
			if (!owned) throw new TRPCError({ code: "FORBIDDEN" });
			if (owned._count.relays >= 8) throw new TRPCError({ code: "BAD_REQUEST", message: "Maximum 8 relays per device" });
			const relay = await ctx.db.relay.create({
				data: {
					deviceId: input.deviceId,
					pin: input.pin,
					label: input.label,
					icon: input.icon,
					order: owned._count.relays
				}
			});

			// Notify connected ESP32 so it can init the GPIO without rebooting
			const wsUrl = `${process.env.WS_INTERNAL_URL ?? `http://localhost:${process.env.WS_PORT ?? 4001}`}/push-relay-add`;
			try {
				await fetch(wsUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-internal-secret": process.env.WS_SECRET ?? ""
					},
					body: JSON.stringify({
						deviceId: input.deviceId,
						relay: { id: relay.id, pin: relay.pin, label: relay.label, state: relay.state, icon: relay.icon }
					}),
					signal: AbortSignal.timeout(2000)
				});
			} catch {
				// WS server unreachable — ESP32 will pick up new relay on next reconnect
			}

			return relay;
		}),

	/** Delete a relay */
	deleteRelay: protectedProcedure.input(z.object({ relayId: z.string() })).mutation(async ({ ctx, input }) => {
		const relay = await ctx.db.relay.findFirst({
			where: {
				id: input.relayId,
				device: { apiKey: { userId: ctx.session.user.id } }
			}
		});
		if (!relay) throw new TRPCError({ code: "FORBIDDEN" });
		return ctx.db.relay.delete({ where: { id: input.relayId } });
	})
});
