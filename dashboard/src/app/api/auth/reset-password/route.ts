import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "~/server/db";

const schema = z.object({
	token: z.string().min(1),
	email: z.string().email(),
	password: z.string().min(8),
});

export async function POST(req: NextRequest) {
	try {
		const body = schema.parse(await req.json());

		const record = await db.verificationToken.findFirst({
			where: { identifier: body.email, token: body.token },
		});

		if (!record) {
			return NextResponse.json({ error: "Invalid or expired reset link." }, { status: 400 });
		}

		if (record.expires < new Date()) {
			await db.verificationToken.delete({ where: { id: record.id } });
			return NextResponse.json({ error: "Reset link has expired." }, { status: 400 });
		}

		const passwordHash = await bcrypt.hash(body.password, 12);
		await db.user.update({
			where: { email: body.email },
			data: { passwordHash },
		});

		await db.verificationToken.delete({ where: { id: record.id } });

		return NextResponse.json({ ok: true });
	} catch (err) {
		if (err instanceof z.ZodError) {
			return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
		}
		return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
	}
}
