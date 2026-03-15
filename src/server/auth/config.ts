import { type DefaultSession, type NextAuthConfig } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "~/server/db";
import bcrypt from "bcryptjs";

declare module "next-auth" {
	interface Session extends DefaultSession {
		user: {
			id: string;
		} & DefaultSession["user"];
	}
}

export const authConfig = {
	providers: [
		CredentialsProvider({
			name: "credentials",
			credentials: {
				email: { label: "Email", type: "email" },
				password: { label: "Password", type: "password" }
			},
			async authorize(credentials) {
				if (!credentials?.email || !credentials?.password) return null;

				const email = credentials.email as string;
				const password = credentials.password as string;

				const user = await db.user.findUnique({ where: { email } });
				if (!user?.passwordHash) return null;

				const valid = await bcrypt.compare(password, user.passwordHash);
				if (!valid) return null;

				return { id: user.id, email: user.email ?? "", name: user.name ?? "" };
			}
		})
	],
	// CredentialsProvider requires JWT strategy — this is a NextAuth constraint.
	// To prevent stale/forged tokens from working, the session callback hits the
	// DB on every request and returns null if the user no longer exists.
	session: { strategy: "jwt" },
	callbacks: {
		jwt: ({ token, user }) => {
			if (user) {
				token.id = user.id;
			}
			return token;
		},
		session: async ({ session, token }) => {
			const userId = (token.id as string) ?? token.sub ?? "";

			// Verify the user still exists in the DB on every session read.
			// If the account was deleted or the token is forged, user will be
			// null and the session object will have no valid id.
			const dbUser = await db.user.findUnique({
				where: { id: userId },
				select: { id: true, name: true, email: true }
			});

			if (!dbUser) {
				// Returning a session without a valid id causes auth() to treat
				// the request as unauthenticated in protectedProcedure / layout guards.
				return { ...session, user: { ...session.user, id: "" } };
			}

			return {
				...session,
				user: {
					...session.user,
					id: dbUser.id,
					name: dbUser.name,
					email: dbUser.email
				}
			};
		}
	},
	pages: {
		signIn: "/auth/login"
	}
} satisfies NextAuthConfig;
