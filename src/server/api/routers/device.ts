import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";

export const deviceRouter = createTRPCRouter({
  /** List all devices for the logged-in user */
  list: protectedProcedure.query(async ({ ctx }) => {
    const apiKeys = await ctx.db.apiKey.findMany({
      where: { userId: ctx.session.user.id, active: true },
      include: {
        devices: {
          include: { relays: { orderBy: { order: "asc" } } },
          orderBy: { updatedAt: "desc" },
        },
      },
    });
    return apiKeys.flatMap((k) => k.devices);
  }),

  /** Get a single device (must belong to current user) */
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const device = await ctx.db.device.findFirst({
        where: {
          id: input.id,
          apiKey: { userId: ctx.session.user.id },
        },
        include: { relays: { orderBy: { order: "asc" } } },
      });
      if (!device) throw new TRPCError({ code: "NOT_FOUND" });
      return device;
    }),

  /** Update device name / notes */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(60).optional(),
        notes: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const owned = await ctx.db.device.findFirst({
        where: { id, apiKey: { userId: ctx.session.user.id } },
      });
      if (!owned) throw new TRPCError({ code: "FORBIDDEN" });
      return ctx.db.device.update({ where: { id }, data });
    }),

  /** Delete a device */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.device.findFirst({
        where: { id: input.id, apiKey: { userId: ctx.session.user.id } },
      });
      if (!owned) throw new TRPCError({ code: "FORBIDDEN" });
      return ctx.db.device.delete({ where: { id: input.id } });
    }),

  /** Toggle a relay on/off */
  toggleRelay: protectedProcedure
    .input(z.object({ relayId: z.string(), state: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const relay = await ctx.db.relay.findFirst({
        where: {
          id: input.relayId,
          device: { apiKey: { userId: ctx.session.user.id } },
        },
        include: { device: true },
      });
      if (!relay) throw new TRPCError({ code: "FORBIDDEN" });
      return ctx.db.relay.update({
        where: { id: input.relayId },
        data: { state: input.state, updatedAt: new Date() },
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
        order: z.number().int().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { relayId, ...data } = input;
      const relay = await ctx.db.relay.findFirst({
        where: {
          id: relayId,
          device: { apiKey: { userId: ctx.session.user.id } },
        },
      });
      if (!relay) throw new TRPCError({ code: "FORBIDDEN" });
      return ctx.db.relay.update({ where: { id: relayId }, data });
    }),

  /** Add a relay to a device */
  addRelay: protectedProcedure
    .input(
      z.object({
        deviceId: z.string(),
        pin: z.number().int().min(0).max(39),
        label: z.string().min(1).max(40),
        icon: z.string().default("plug"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.device.findFirst({
        where: { id: input.deviceId, apiKey: { userId: ctx.session.user.id } },
        include: { _count: { select: { relays: true } } },
      });
      if (!owned) throw new TRPCError({ code: "FORBIDDEN" });
      if (owned._count.relays >= 8)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Maximum 8 relays per device" });
      return ctx.db.relay.create({
        data: {
          deviceId: input.deviceId,
          pin: input.pin,
          label: input.label,
          icon: input.icon,
          order: owned._count.relays,
        },
      });
    }),

  /** Delete a relay */
  deleteRelay: protectedProcedure
    .input(z.object({ relayId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const relay = await ctx.db.relay.findFirst({
        where: {
          id: input.relayId,
          device: { apiKey: { userId: ctx.session.user.id } },
        },
      });
      if (!relay) throw new TRPCError({ code: "FORBIDDEN" });
      return ctx.db.relay.delete({ where: { id: input.relayId } });
    }),
});
