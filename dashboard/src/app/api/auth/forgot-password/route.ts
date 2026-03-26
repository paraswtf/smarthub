import { type NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "~/server/db";
import { sendPasswordResetEmail } from "~/server/email";

const schema = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
	try {
		const body = schema.parse(await req.json());

		const user = await db.user.findUnique({ where: { email: body.email } });
		if (!user?.passwordHash) {
			// Don't reveal whether user exists or is OAuth-only
			return NextResponse.json({ ok: true });
		}

		// Delete any existing reset tokens for this email
		await db.verificationToken.deleteMany({
			where: { identifier: body.email },
		});

		const token = randomBytes(32).toString("hex");
		const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

		await db.verificationToken.create({
			data: { identifier: body.email, token, expires },
		});

		await sendPasswordResetEmail(body.email, token);

		return NextResponse.json({ ok: true });
	} catch {
		return NextResponse.json({ error: "Invalid request." }, { status: 400 });
	}
}
