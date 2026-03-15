/**
 * POST /api/esp/register
 *
 * Called by ESP32 on boot after captive-portal config.
 * Body (JSON):
 *   { apiKey, macAddress, name, ssid, firmwareVersion? }
 *
 * Returns:
 *   { deviceId, relays: [{ id, pin, label, state }] }
 */
import { type NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { z } from "zod";

const schema = z.object({
  apiKey: z.string().min(1),
  macAddress: z.string().min(8).max(24),
  name: z.string().min(1).max(60).optional(),
  ssid: z.string().max(64).optional(),
  firmwareVersion: z.string().max(32).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as unknown;
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const { apiKey, macAddress, name, ssid, firmwareVersion } = parsed.data;

    // Validate API key
    const key = await db.apiKey.findFirst({
      where: { key: apiKey, active: true },
    });
    if (!key) {
      return NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 });
    }

    // Upsert device
    const device = await db.device.upsert({
      where: { macAddress },
      update: {
        online: true,
        lastSeenAt: new Date(),
        ...(ssid && { ssid }),
        ...(firmwareVersion && { firmwareVersion }),
        apiKeyId: key.id, // allow re-linking to new key
      },
      create: {
        macAddress,
        name: name ?? `ESP32 ${macAddress.slice(-5)}`,
        ssid: ssid ?? null,
        firmwareVersion: firmwareVersion ?? null,
        online: true,
        lastSeenAt: new Date(),
        apiKeyId: key.id,
      },
      include: {
        relays: { orderBy: { order: "asc" } },
      },
    });

    // Update API key lastUsedAt
    await db.apiKey.update({
      where: { id: key.id },
      data: { lastUsedAt: new Date() },
    });

    return NextResponse.json({
      deviceId: device.id,
      relays: device.relays.map((r) => ({
        id: r.id,
        pin: r.pin,
        label: r.label,
        state: r.state,
        icon: r.icon,
      })),
    });
  } catch (err) {
    console.error("[ESP Register]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
