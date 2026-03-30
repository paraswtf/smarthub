import { z } from "zod";
import bcrypt from "bcryptjs";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const userRouter = createTRPCRouter({
	updateSelf: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1).optional(),
				password: z.string().min(8).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { password, ...rest } = input;
			const data: Record<string, unknown> = { ...rest };
			if (password) data.passwordHash = await bcrypt.hash(password, 12);
			return ctx.db.user.update({
				where: { id: ctx.session.user.id },
				data,
				select: { id: true, name: true, email: true },
			});
		}),
});
