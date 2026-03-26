"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Zap, Mail, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ThemeToggle } from "~/components/ThemeToggle";
import { appConfig } from "../../../../globals.config";

export default function ForgotPasswordPage() {
	const [email, setEmail] = useState("");
	const [sent, setSent] = useState(false);
	const [isPending, startTransition] = useTransition();

	const handleSubmit = () => {
		if (!email) return;
		startTransition(async () => {
			await fetch("/api/auth/forgot-password", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email }),
			});
			setSent(true);
		});
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

				<div className="rounded-2xl border bg-card p-8 shadow-sm">
					{sent ? (
						<div className="text-center">
							<Mail className="w-12 h-12 text-primary mx-auto mb-4" />
							<h1 className="font-sora font-extrabold text-xl text-foreground mb-2">Check your email</h1>
							<p className="text-sm text-muted-foreground mb-1">
								If an account exists for
							</p>
							<p className="text-sm font-medium text-foreground mb-4">{email}</p>
							<p className="text-xs text-muted-foreground mb-6">
								you&apos;ll receive a password reset link. The link expires in 1 hour.
							</p>
							<Button variant="ghost" asChild className="w-full">
								<Link href="/auth/login">Back to Sign In</Link>
							</Button>
						</div>
					) : (
						<>
							<h1 className="font-sora font-extrabold text-xl text-foreground mb-1">Forgot password?</h1>
							<p className="text-sm text-muted-foreground mb-6">
								Enter your email and we&apos;ll send you a reset link.
							</p>

							<div className="space-y-4">
								<div className="space-y-1.5">
									<Label htmlFor="email">Email</Label>
									<Input
										id="email"
										type="email"
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										placeholder="you@example.com"
										autoComplete="email"
										onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
									/>
								</div>

								<Button
									className="w-full"
									onClick={handleSubmit}
									disabled={isPending || !email}
								>
									{isPending ? (
										<><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
									) : (
										"Send reset link"
									)}
								</Button>
							</div>
						</>
					)}
				</div>

				{!sent && (
					<p className="text-center mt-4">
						<Link href="/auth/login" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
							← Back to Sign In
						</Link>
					</p>
				)}
			</div>
		</div>
	);
}
