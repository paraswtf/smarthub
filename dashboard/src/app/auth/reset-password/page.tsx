"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Zap, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ThemeToggle } from "~/components/ThemeToggle";
import { appConfig } from "../../../../globals.config";

export default function ResetPasswordPage() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const token = searchParams.get("token");
	const email = searchParams.get("email");

	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState("");
	const [isPending, startTransition] = useTransition();

	if (!token || !email) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-background px-4">
				<div className="absolute top-4 right-4">
					<ThemeToggle />
				</div>
				<div className="w-full max-w-[420px] animate-slide-up">
					<div className="rounded-2xl border bg-card p-8 shadow-sm text-center">
						<AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-4" />
						<h1 className="font-sora font-extrabold text-xl text-foreground mb-2">Invalid reset link</h1>
						<p className="text-sm text-muted-foreground mb-6">
							This password reset link is invalid or incomplete.
						</p>
						<Button asChild className="w-full">
							<Link href="/auth/forgot-password">Request a new link</Link>
						</Button>
					</div>
				</div>
			</div>
		);
	}

	const handleReset = () => {
		if (password.length < 8) {
			setError("Password must be at least 8 characters.");
			return;
		}
		if (password !== confirm) {
			setError("Passwords do not match.");
			return;
		}
		setError("");
		startTransition(async () => {
			const res = await fetch("/api/auth/reset-password", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token, email, password }),
			});
			if (!res.ok) {
				const data = (await res.json()) as { error?: string };
				setError(data.error ?? "Something went wrong.");
				return;
			}
			router.push("/auth/login?reset=true");
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
					<h1 className="font-sora font-extrabold text-xl text-foreground mb-1">Set new password</h1>
					<p className="text-sm text-muted-foreground mb-6">
						Enter a new password for your account.
					</p>

					{error && (
						<div className="mb-5 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
							{error}
						</div>
					)}

					<div className="space-y-4">
						<div className="space-y-1.5">
							<Label htmlFor="password">New Password</Label>
							<Input
								id="password"
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder="Min. 8 characters"
								autoComplete="new-password"
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="confirm">Confirm Password</Label>
							<Input
								id="confirm"
								type="password"
								value={confirm}
								onChange={(e) => setConfirm(e.target.value)}
								placeholder="Repeat password"
								autoComplete="new-password"
								onKeyDown={(e) => e.key === "Enter" && handleReset()}
							/>
						</div>

						<Button
							className="w-full"
							onClick={handleReset}
							disabled={isPending || !password || !confirm}
						>
							{isPending ? (
								<><Loader2 className="w-4 h-4 animate-spin" /> Resetting...</>
							) : (
								"Reset Password"
							)}
						</Button>
					</div>
				</div>

				<p className="text-center mt-4">
					<Link href="/auth/login" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
						← Back to Sign In
					</Link>
				</p>
			</div>
		</div>
	);
}
