import { type NextRequest, NextResponse } from "next/server";
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { auth } from "~/server/auth";
import { db } from "~/server/db";

const FIRMWARE_DIR = process.env.FIRMWARE_DIR ?? "/data/firmware";
const WS_INTERNAL_URL = process.env.WS_INTERNAL_URL ?? `http://localhost:${process.env.WS_PORT ?? 4001}`;
const WS_SECRET = process.env.WS_SECRET ?? "";

/** POST — upload a firmware .bin file (session auth, owner only) */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const { id: deviceId } = await params;

	const session = await auth();
	if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const owned = await db.device.findFirst({ where: { id: deviceId, apiKey: { userId: session.user.id } } });
	if (!owned) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

	let formData: FormData;
	try {
		formData = await req.formData();
	} catch {
		return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
	}

	const file = formData.get("firmware");
	if (!(file instanceof File)) return NextResponse.json({ error: "Missing firmware file" }, { status: 400 });
	if (!file.name.endsWith(".bin")) return NextResponse.json({ error: "File must be a .bin" }, { status: 400 });

	const buffer = Buffer.from(await file.arrayBuffer());
	const dir = join(FIRMWARE_DIR, deviceId);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "latest.bin"), buffer);

	return NextResponse.json({ ok: true, size: buffer.length });
}

/** GET — download firmware binary (one-time OTA token auth) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	const { id: deviceId } = await params;
	const token = req.nextUrl.searchParams.get("token");

	if (!token) return new NextResponse("Missing token", { status: 401 });

	// Validate one-time token via WS server
	try {
		const res = await fetch(`${WS_INTERNAL_URL}/validate-ota-token`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-internal-secret": WS_SECRET },
			body: JSON.stringify({ token, deviceId }),
			signal: AbortSignal.timeout(3000),
		});
		const data = (await res.json()) as { valid?: boolean };
		if (!data.valid) return new NextResponse("Invalid or expired token", { status: 401 });
	} catch {
		return new NextResponse("Token validation failed", { status: 503 });
	}

	const firmwarePath = join(FIRMWARE_DIR, deviceId, "latest.bin");
	if (!existsSync(firmwarePath)) return new NextResponse("No firmware found", { status: 404 });

	const stat = statSync(firmwarePath);
	const buffer = readFileSync(firmwarePath);

	return new NextResponse(buffer, {
		status: 200,
		headers: {
			"Content-Type": "application/octet-stream",
			"Content-Length": stat.size.toString(),
			"Content-Disposition": `attachment; filename="firmware-${deviceId}.bin"`,
		},
	});
}
