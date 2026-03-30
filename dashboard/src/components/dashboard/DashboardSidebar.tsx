"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Zap, LayoutDashboard, Home, Share2, Key, Settings, LogOut, ChevronRight, Menu, X } from "lucide-react";
import { useState } from "react";
import { cn } from "~/lib/utils";
import { ThemeToggle } from "~/components/ThemeToggle";
import { Avatar, AvatarImage, AvatarFallback } from "~/components/ui/avatar";
import { appConfig } from "../../../globals.config";

const NAV = [
	{ href: "/dashboard", label: "Overview", icon: LayoutDashboard },
	{ href: "/dashboard/homes", label: "Homes", icon: Home },
	{ href: "/dashboard/shared", label: "Shared with me", icon: Share2 },
	{ href: "/dashboard/api-keys", label: "API Keys", icon: Key },
	{ href: "/dashboard/settings", label: "Settings", icon: Settings },
];

interface Props {
	user: { name?: string | null; email?: string | null; image?: string | null; id: string };
}

export default function DashboardSidebar({ user }: Props) {
	const pathname = usePathname();
	const [mobileOpen, setMobileOpen] = useState(false);

	const initials = (user.name ?? user.email ?? "?")
		.split(" ")
		.slice(0, 2)
		.map((w) => w[0])
		.join("")
		.toUpperCase();

	const SidebarContent = () => (
		<div className="flex flex-col h-full">
			{/* Logo */}
			<div className="h-16 flex items-center px-4 border-b" style={{ borderColor: "hsl(var(--sidebar-border))" }}>
				<Link href="/dashboard" className="flex items-center gap-2.5 no-underline">
					<div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
						<Zap className="w-4 h-4 text-primary-foreground" />
					</div>
					<span className="font-sora font-bold text-base" style={{ color: "hsl(var(--sidebar-foreground))" }}>
						{appConfig.name}
					</span>
				</Link>
			</div>

			{/* Nav */}
			<nav className="flex-1 px-3 py-4 space-y-1">
				<p className="px-3 mb-2 text-[10px] font-semibold tracking-widest uppercase" style={{ color: "hsl(var(--sidebar-muted))" }}>
					Navigation
				</p>
				{NAV.map(({ href, label, icon: Icon }) => {
					const exact = href === "/dashboard";
					const active = exact ? pathname === href : pathname.startsWith(href);
					return (
						<Link key={href} href={href} onClick={() => setMobileOpen(false)} className={cn("dash-nav-item", active && "active")}>
							<Icon className="w-4 h-4 flex-shrink-0" />
							<span className="flex-1">{label}</span>
							{active && <ChevronRight className="w-3.5 h-3.5 opacity-60" />}
						</Link>
					);
				})}
			</nav>

			{/* Bottom: user + theme toggle */}
			<div className="p-3 border-t space-y-1" style={{ borderColor: "hsl(var(--sidebar-border))" }}>
				<div className="flex items-center justify-between px-2 py-1.5 rounded-lg">
					<div className="flex items-center gap-2 min-w-0">
						<Avatar className="w-7 h-7 flex-shrink-0">
							{user.image && <AvatarImage src={user.image} alt={user.name ?? "User"} />}
							<AvatarFallback className="text-xs bg-primary text-primary-foreground">{initials}</AvatarFallback>
						</Avatar>
						<div className="min-w-0">
							<p className="text-xs font-semibold truncate" style={{ color: "hsl(var(--sidebar-foreground))" }}>
								{user.name ?? "User"}
							</p>
							<p className="text-[10px] truncate" style={{ color: "hsl(var(--sidebar-muted))" }}>
								{user.email}
							</p>
						</div>
					</div>
					<ThemeToggle size="sm" className="flex-shrink-0 text-sidebar-muted" />
				</div>

				<button onClick={() => signOut({ callbackUrl: "/auth/login" })} className="dash-nav-item w-full text-left hover:text-destructive">
					<LogOut className="w-4 h-4" />
					<span>Sign out</span>
				</button>
			</div>
		</div>
	);

	return (
		<>
			{/* Desktop sidebar */}
			<aside className="hidden lg:flex flex-col w-60 flex-shrink-0 dash-sidebar">
				<SidebarContent />
			</aside>

			{/* Mobile hamburger button */}
			<button className="lg:hidden fixed top-4 left-4 z-50 w-9 h-9 rounded-lg flex items-center justify-center bg-card border border-border shadow-sm" onClick={() => setMobileOpen(true)}>
				<Menu className="w-4 h-4" />
			</button>

			{/* Mobile overlay */}
			{mobileOpen && <div className="lg:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />}

			{/* Mobile drawer */}
			<aside className={cn("lg:hidden fixed top-0 left-0 z-50 h-full w-64 dash-sidebar transition-transform duration-300", mobileOpen ? "translate-x-0" : "-translate-x-full")}>
				<button className="absolute top-4 right-4 text-sidebar-muted hover:text-sidebar-foreground transition-colors" onClick={() => setMobileOpen(false)}>
					<X className="w-5 h-5" />
				</button>
				<SidebarContent />
			</aside>
		</>
	);
}
