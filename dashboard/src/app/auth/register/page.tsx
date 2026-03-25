"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Zap, Loader2 } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ThemeToggle } from "~/components/ThemeToggle";
import { appConfig } from "../../../../globals.config";

export default function RegisterPage() {
	const router = useRouter();
	const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
	const [error, setError] = useState("");
	const [isPending, startTransition] = useTransition();

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
			// Auto sign-in after register
			await signIn("credentials", { email: form.email, password: form.password, redirect: false });
			router.push("/dashboard");
		});
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
