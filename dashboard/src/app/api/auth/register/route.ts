import { type NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "~/server/db";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { sendVerificationEmail } from "~/server/email";

const schema = z.object({
	name: z.string().min(1).max(80),
	email: z.string().email(),
	password: z.string().min(8),
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
			data: { name, email, passwordHash },
		});

		// Generate verification token and send email
		const token = randomBytes(32).toString("hex");
		const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

		await db.verificationToken.create({
			data: { identifier: email, token, expires },
		});

		await sendVerificationEmail(email, token);

		return NextResponse.json({ ok: true, requiresVerification: true });
	} catch {
		return NextResponse.json({ error: "Internal server error." }, { status: 500 });
	}
}
