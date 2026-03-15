import { type NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import bcrypt from "bcryptjs";
import { z } from "zod";

const schema = z.object({
	name: z.string().min(1).max(80),
	email: z.string().email(),
	password: z.string().min(8)
});

export async function POST(req: NextRequest) {
	try {
		const body = (await req.json()) as unknown;
		const parsed = schema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json({ error: "Invalid input." }, { status: 400 });
		}
		const { name, email, password } = parsed.data;

		const existing = await db.user.findUnique({ where: { email } });
		if (existing) {
			return NextResponse.json({ error: "Email already registered." }, { status: 409 });
		}

		const passwordHash = await bcrypt.hash(password, 12);
		await db.user.create({
			data: { name, email, passwordHash }
		});

		return NextResponse.json({ ok: true });
	} catch {
		return NextResponse.json({ error: "Internal server error." }, { status: 500 });
	}
}
