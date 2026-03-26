import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "~/server/db";

const schema = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
	try {
		const body = schema.parse(await req.json());
		const user = await db.user.findUnique({
			where: { email: body.email },
			select: { emailVerified: true, passwordHash: true },
		});

		// Only reveal verification status for credential users
		if (user?.passwordHash && !user.emailVerified) {
			return NextResponse.json({ verified: false });
		}

		return NextResponse.json({ verified: true });
	} catch {
		return NextResponse.json({ verified: true });
	}
}
