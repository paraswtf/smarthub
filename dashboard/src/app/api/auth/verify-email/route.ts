import { type NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";

export async function GET(req: NextRequest) {
	const token = req.nextUrl.searchParams.get("token");
	const email = req.nextUrl.searchParams.get("email");

	if (!token || !email) {
		return NextResponse.redirect(new URL("/auth/verify?error=invalid", req.url));
	}

	const record = await db.verificationToken.findFirst({
		where: { identifier: email, token },
	});

	if (!record) {
		return NextResponse.redirect(new URL("/auth/verify?error=invalid", req.url));
	}

	if (record.expires < new Date()) {
		await db.verificationToken.delete({ where: { id: record.id } });
		return NextResponse.redirect(new URL(`/auth/verify?error=expired&email=${encodeURIComponent(email)}`, req.url));
	}

	// Mark user as verified
	await db.user.update({
		where: { email },
		data: { emailVerified: new Date() },
	});

	// Delete the used token
	await db.verificationToken.delete({ where: { id: record.id } });

	return NextResponse.redirect(new URL("/auth/login?verified=true", req.url));
}
