import { type NextRequest, NextResponse } from "next/server";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import bcrypt from "bcryptjs";
import { z } from "zod";

const schema = z.object({
	current: z.string().min(1),
	next: z.string().min(8)
});

export async function POST(req: NextRequest) {
	const session = await auth();
	if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const body = (await req.json()) as unknown;
	const parsed = schema.safeParse(body);
	if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

	const user = await db.user.findUnique({ where: { id: session.user.id } });
	if (!user?.passwordHash) return NextResponse.json({ error: "No password set on this account." }, { status: 400 });

	const valid = await bcrypt.compare(parsed.data.current, user.passwordHash);
	if (!valid) return NextResponse.json({ error: "Current password is incorrect." }, { status: 403 });

	const hash = await bcrypt.hash(parsed.data.next, 12);
	await db.user.update({ where: { id: session.user.id }, data: { passwordHash: hash } });
	return NextResponse.json({ ok: true });
}
