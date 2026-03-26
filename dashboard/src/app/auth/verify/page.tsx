"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Zap, Mail, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "~/components/ui/button";
import { ThemeToggle } from "~/components/ThemeToggle";
import { appConfig } from "../../../../globals.config";

export default function VerifyPage() {
	const searchParams = useSearchParams();
	const email = searchParams.get("email");
	const error = searchParams.get("error");

	const [resending, setResending] = useState(false);
	const [resent, setResent] = useState(false);

	const handleResend = async () => {
		if (!email || resending) return;
		setResending(true);
		try {
			await fetch("/api/auth/resend-verification", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email }),
			});
			setResent(true);
		} finally {
			setResending(false);
		}
	};

	return (
		<div className="min-h-screen flex items-center justify-center bg-background px-4">
			<div className="absolute top-4 right-4">
				<ThemeToggle />
			</div>

			<div className="w-full max-w-[420px] animate-slide-up">
				<div className="text-center mb-8">
					<Link href="/" className="inline-flex items-center gap-2 mb-6 no-underline">
						<div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
							<Zap className="w-5 h-5 text-primary-foreground" />
						</div>
						<span className="font-sora font-bold text-xl text-foreground">{appConfig.name}</span>
					</Link>
				</div>

				<div className="rounded-2xl border bg-card p-8 shadow-sm text-center">
					{error === "invalid" && (
						<>
							<AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-4" />
							<h1 className="font-sora font-extrabold text-xl text-foreground mb-2">Invalid verification link</h1>
							<p className="text-sm text-muted-foreground mb-6">
								This link is invalid or has already been used.
							</p>
							<Button asChild className="w-full">
								<Link href="/auth/login">Back to Sign In</Link>
							</Button>
						</>
					)}

					{error === "expired" && (
						<>
							<AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
							<h1 className="font-sora font-extrabold text-xl text-foreground mb-2">Link expired</h1>
							<p className="text-sm text-muted-foreground mb-6">
								This verification link has expired. Request a new one below.
							</p>
							{email && !resent && (
								<Button className="w-full" onClick={handleResend} disabled={resending}>
									{resending ? (
										<><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
									) : (
										"Resend verification email"
									)}
								</Button>
							)}
							{resent && (
								<div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-primary text-sm">
									<CheckCircle2 className="w-4 h-4 inline mr-1.5" />
									New verification email sent!
								</div>
							)}
						</>
					)}

					{!error && (
						<>
							<Mail className="w-12 h-12 text-primary mx-auto mb-4" />
							<h1 className="font-sora font-extrabold text-xl text-foreground mb-2">Check your email</h1>
							<p className="text-sm text-muted-foreground mb-1">
								We sent a verification link to
							</p>
							{email && (
								<p className="text-sm font-medium text-foreground mb-6">{email}</p>
							)}
							{!email && (
								<p className="text-sm text-muted-foreground mb-6">your email address.</p>
							)}
							<p className="text-xs text-muted-foreground mb-6">
								Click the link in the email to verify your account. The link expires in 24 hours.
							</p>

							{email && !resent && (
								<Button variant="outline" className="w-full mb-3" onClick={handleResend} disabled={resending}>
									{resending ? (
										<><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
									) : (
										"Resend verification email"
									)}
								</Button>
							)}
							{resent && (
								<div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-primary text-sm mb-3">
									<CheckCircle2 className="w-4 h-4 inline mr-1.5" />
									Verification email resent!
								</div>
							)}

							<Button variant="ghost" asChild className="w-full">
								<Link href="/auth/login">Back to Sign In</Link>
							</Button>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
