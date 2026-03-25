import { type NextRequest, NextResponse } from "next/server";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { z } from "zod";

const schema = z.object({ name: z.string().min(1).max(80) });

export async function POST(req: NextRequest) {
	const session = await auth();
	if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const body = (await req.json()) as unknown;
	const parsed = schema.safeParse(body);
	if (!parsed.success) return NextResponse.json({ error: "Invalid name" }, { status: 400 });

	await db.user.update({ where: { id: session.user.id }, data: { name: parsed.data.name } });
	return NextResponse.json({ ok: true });
}
