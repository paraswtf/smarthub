import { BrevoClient } from "@getbrevo/brevo";

const brevo = new BrevoClient({
	apiKey: process.env.BREVO_API_KEY ?? "",
});

const senderEmail = process.env.BREVO_SENDER_EMAIL ?? "noreply@smarthub.app";

export async function sendVerificationEmail(email: string, token: string) {
	const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
	const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${token}&email=${encodeURIComponent(email)}`;

	await brevo.transactionalEmails.sendTransacEmail({
		sender: { email: senderEmail, name: "SmartHUB" },
		to: [{ email }],
		subject: "Verify your SmartHUB email",
		htmlContent: `
			<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#050f08;color:#dde6f0;border-radius:16px">
				<h1 style="font-size:22px;font-weight:700;color:#e8f0ea;margin:0 0 8px">Verify your email</h1>
				<p style="font-size:14px;color:#7a9080;margin:0 0 24px">Click the button below to verify your email address and activate your SmartHUB account.</p>
				<a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#12c984;color:#040c06;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none">Verify Email</a>
				<p style="font-size:12px;color:#4a6b58;margin:24px 0 0;line-height:1.5">This link expires in 24 hours. If you did not create an account, you can safely ignore this email.</p>
			</div>
		`,
	});
}

export async function sendPasswordResetEmail(email: string, token: string) {
	const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
	const resetUrl = `${baseUrl}/auth/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

	await brevo.transactionalEmails.sendTransacEmail({
		sender: { email: senderEmail, name: "SmartHUB" },
		to: [{ email }],
		subject: "Reset your SmartHUB password",
		htmlContent: `
			<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#050f08;color:#dde6f0;border-radius:16px">
				<h1 style="font-size:22px;font-weight:700;color:#e8f0ea;margin:0 0 8px">Reset your password</h1>
				<p style="font-size:14px;color:#7a9080;margin:0 0 24px">Click the button below to set a new password for your SmartHUB account.</p>
				<a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#12c984;color:#040c06;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none">Reset Password</a>
				<p style="font-size:12px;color:#4a6b58;margin:24px 0 0;line-height:1.5">This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
			</div>
		`,
	});
}
