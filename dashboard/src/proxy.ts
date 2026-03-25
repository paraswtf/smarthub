import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { NextResponse } from "next/server";

const ALLOWED_ROLES = ["editor", "admin", "superadmin"];

// Lightweight auth instance for edge middleware — no Prisma/Node.js imports
const { auth } = NextAuth({
	providers: [
		CredentialsProvider({
			credentials: {
				email: { type: "email" },
				password: { type: "password" }
			},
			async authorize() {
				// Actual auth logic runs in the API route, not here.
				// Middleware only checks the JWT session cookie.
				return null;
			}
		})
	],
	session: { strategy: "jwt" },
	callbacks: {
		jwt: ({ token, user }) => {
			if (user) token.role = (user as { role?: string }).role ?? "editor";
			return token;
		},
		session: ({ session, token }) => ({
			...session,
			user: {
				...session.user,
				id: token.sub ?? "",
				role: (token.role as string) ?? "editor"
			}
		})
	},
	pages: { signIn: "/admin/login" }
});

export default auth((req) => {
	const isLoginPage = req.nextUrl.pathname === "/admin/login";
	const role = (req.auth?.user as { role?: string } | undefined)?.role ?? "";
	const isAuthenticated = !!req.auth && ALLOWED_ROLES.includes(role);

	if (isLoginPage) return NextResponse.next();

	if (!isAuthenticated) {
		return NextResponse.redirect(new URL("/admin/login", req.nextUrl.origin));
	}

	return NextResponse.next();
});

export const config = {
	matcher: ["/admin/:path*"]
};
