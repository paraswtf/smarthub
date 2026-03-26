import { type DefaultSession, type NextAuthConfig } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { randomBytes } from "crypto";
import { db } from "~/server/db";
import bcrypt from "bcryptjs";
import { sendVerificationEmail } from "~/server/email";

declare module "next-auth" {
	interface Session extends DefaultSession {
		user: {
			id: string;
		} & DefaultSession["user"];
	}
}

export const authConfig = {
	adapter: PrismaAdapter(db),
	providers: [
		GoogleProvider({
			clientId: process.env.AUTH_GOOGLE_CLIENT_ID!,
			clientSecret: process.env.AUTH_GOOGLE_CLIENT_SECRET!,
			allowDangerousEmailAccountLinking: true,
		}),
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
		async signIn({ user, account, profile }) {
			// Google users are always email-verified, save profile picture
			if (account?.provider === "google" && user.id) {
				await db.user.update({
					where: { id: user.id },
					data: {
						emailVerified: new Date(),
						...(profile?.picture ? { image: profile.picture as string } : {}),
					},
				});
				return true;
			}

			// Block unverified credential users and resend verification email
			if (account?.provider === "credentials" && user.email) {
				const dbUser = await db.user.findUnique({ where: { email: user.email } });
				if (dbUser && !dbUser.emailVerified) {
					// Delete old tokens and send a fresh verification email
					await db.verificationToken.deleteMany({ where: { identifier: user.email } });
					const token = randomBytes(32).toString("hex");
					const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
					await db.verificationToken.create({ data: { identifier: user.email, token, expires } });
					await sendVerificationEmail(user.email, token);

					return `/auth/verify?email=${encodeURIComponent(user.email)}`;
				}
			}

			return true;
		},
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
				select: { id: true, name: true, email: true, image: true }
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
					email: dbUser.email,
					image: dbUser.image
				}
			};
		}
	},
	pages: {
		signIn: "/auth/login"
	}
} satisfies NextAuthConfig;
