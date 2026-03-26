/**
 * One-time migration: set emailVerified for all existing credential users.
 * Run BEFORE deploying email verification, otherwise existing users will be locked out.
 *
 * Usage: npx tsx dashboard/scripts/grandfather-users.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
	const result = await db.user.updateMany({
		where: {
			emailVerified: null,
			passwordHash: { not: null },
		},
		data: {
			emailVerified: new Date(),
		},
	});
	console.log(`Grandfathered ${result.count} existing user(s) — emailVerified set to now.`);
}

main()
	.then(() => db.$disconnect())
	.catch((e) => {
		console.error(e);
		db.$disconnect();
		process.exit(1);
	});
