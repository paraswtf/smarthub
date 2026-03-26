"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Zap, Loader2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { ThemeToggle } from "~/components/ThemeToggle";
import { appConfig } from "../../../../globals.config";

export default function RegisterPage() {
	const router = useRouter();
	const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
	const [error, setError] = useState("");
	const [isPending, startTransition] = useTransition();
	const [googlePending, setGooglePending] = useState(false);

	const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

	const handleRegister = () => {
		if (!form.name || !form.email || !form.password) {
			setError("All fields are required.");
			return;
		}
		if (form.password !== form.confirm) {
			setError("Passwords do not match.");
			return;
		}
		if (form.password.length < 8) {
			setError("Password must be at least 8 characters.");
			return;
		}
		setError("");
		startTransition(async () => {
			const res = await fetch("/api/auth/register", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: form.name, email: form.email, password: form.password })
			});
			if (!res.ok) {
				const data = (await res.json()) as { error?: string };
				setError(data.error ?? "Registration failed.");
				return;
			}
			// Redirect to verify page instead of auto-signing-in
			router.push(`/auth/verify?email=${encodeURIComponent(form.email)}`);
		});
	};

	const handleGoogle = () => {
		setGooglePending(true);
		void signIn("google", { callbackUrl: "/dashboard" });
	};

	return (
		<div className="min-h-screen flex items-center justify-center bg-background px-4">
			<div className="absolute top-4 right-4">
				<ThemeToggle />
			</div>

			<div className="w-full max-w-[420px] animate-slide-up">
				<div className="text-center mb-8">
					<Link
						href="/"
						className="inline-flex items-center gap-2 mb-6 no-underline"
					>
						<div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
							<Zap className="w-5 h-5 text-primary-foreground" />
						</div>
						<span className="font-sora font-bold text-xl text-foreground">{appConfig.name}</span>
					</Link>
					<h1 className="font-sora font-extrabold text-2xl text-foreground mb-1">Create account</h1>
					<p className="text-sm text-muted-foreground">Start automating your home today</p>
				</div>

				<div className="rounded-2xl border bg-card p-8 shadow-sm">
					{error && <div className="mb-5 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">{error}</div>}

					{/* Google sign-up */}
					<Button
						variant="outline"
						className="w-full"
						onClick={handleGoogle}
						disabled={googlePending}
					>
						{googlePending ? (
							<Loader2 className="w-4 h-4 animate-spin" />
						) : (
							<svg className="w-4 h-4" viewBox="0 0 24 24">
								<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
								<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
								<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
								<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
							</svg>
						)}
						Continue with Google
					</Button>

					<div className="relative my-5">
						<div className="absolute inset-0 flex items-center">
							<Separator />
						</div>
						<div className="relative flex justify-center text-xs uppercase">
							<span className="bg-card px-2 text-muted-foreground">or</span>
						</div>
					</div>

					<div className="space-y-4">
						<div className="space-y-1.5">
							<Label htmlFor="name">Name</Label>
							<Input
								id="name"
								value={form.name}
								onChange={set("name")}
								placeholder="Jane Smith"
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="email">Email</Label>
							<Input
								id="email"
								type="email"
								value={form.email}
								onChange={set("email")}
								placeholder="you@example.com"
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="password">Password</Label>
							<Input
								id="password"
								type="password"
								value={form.password}
								onChange={set("password")}
								placeholder="Min. 8 characters"
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="confirm">Confirm Password</Label>
							<Input
								id="confirm"
								type="password"
								value={form.confirm}
								onChange={set("confirm")}
								placeholder="Repeat password"
								onKeyDown={(e) => e.key === "Enter" && handleRegister()}
							/>
						</div>

						<Button
							className="w-full mt-2"
							onClick={handleRegister}
							disabled={isPending}
						>
							{isPending ? (
								<>
									<Loader2 className="w-4 h-4 animate-spin" /> Creating account…
								</>
							) : (
								"Create Account"
							)}
						</Button>
					</div>
				</div>

				<p className="text-center text-sm text-muted-foreground mt-6">
					Already have an account?{" "}
					<Link
						href="/auth/login"
						className="text-primary hover:underline font-medium"
					>
						Sign in
					</Link>
				</p>
			</div>
		</div>
	);
}
