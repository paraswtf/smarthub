"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Zap } from "lucide-react";

export default function Nav() {
	const [scrolled, setScrolled] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);
	const pathname = usePathname();
	const isLanding = pathname === "/";

	useEffect(() => {
		const handleScroll = () => setScrolled(window.scrollY > 10);
		window.addEventListener("scroll", handleScroll, { passive: true });
		return () => window.removeEventListener("scroll", handleScroll);
	}, []);

	useEffect(() => {
		setMobileOpen(false);
	}, [pathname]);

	const navBg = isLanding ? (scrolled ? "bg-[#050f08]/95 backdrop-blur-[16px] border-b border-[rgba(18,201,132,0.1)] shadow-[0_4px_24px_rgba(0,0,0,0.4)]" : "bg-transparent border-b border-transparent") : "bg-white/90 backdrop-blur-[16px] border-b border-[rgba(10,22,40,0.08)]";

	const linkColor = isLanding ? "text-[#7a9080] hover:text-[#e8f0ea]" : "text-[#0a1628] opacity-65 hover:opacity-100";
	const textColor = isLanding ? "text-[#e8f0ea]" : "text-[#0a1628]";
	const hamBg = isLanding ? "hover:bg-[rgba(18,201,132,0.08)]" : "hover:bg-[#f0f5fb]";
	const hamBar = isLanding ? "bg-[#e8f0ea]" : "bg-[#0a1628]";

	return (
		<>
			<nav className={`fixed top-0 left-0 right-0 z-[100] flex items-center justify-between h-[72px] px-6 md:px-[60px] transition-all duration-300 ${navBg}`}>
				<Link
					href="/"
					className="flex items-center gap-2.5 no-underline"
				>
					<div className="w-8 h-8 rounded-lg bg-[#12c984] flex items-center justify-center">
						<Zap className="w-4 h-4 text-[#040c06]" />
					</div>
					<span className={`font-['Sora'] font-bold text-[18px] ${textColor}`}>SmartHUB</span>
				</Link>

				{/* Desktop */}
				<div className="hidden md:flex items-center gap-6">
					<a
						href="#features"
						className={`text-[14px] font-medium transition-colors no-underline ${linkColor}`}
					>
						Features
					</a>
					<a
						href="#how-it-works"
						className={`text-[14px] font-medium transition-colors no-underline ${linkColor}`}
					>
						How it works
					</a>
					<Link
						href="/auth/login"
						className={`text-[14px] font-medium transition-colors no-underline ${linkColor}`}
					>
						Sign In
					</Link>
					<Link
						href="/auth/register"
						className="text-[14px] font-semibold px-5 py-2.5 rounded-lg bg-[#12c984] text-[#040c06] hover:bg-[#0faa70] transition-colors no-underline"
					>
						Get Started
					</Link>
				</div>

				{/* Hamburger */}
				<button
					className={`md:hidden flex flex-col justify-center items-center gap-[5px] w-10 h-10 bg-transparent border-none p-1 rounded-lg transition-colors ${hamBg}`}
					onClick={() => setMobileOpen((v) => !v)}
					aria-label="Toggle navigation"
				>
					<span className={`block w-[22px] h-0.5 rounded transition-transform duration-300 ${hamBar} ${mobileOpen ? "translate-y-[7px] rotate-45" : ""}`} />
					<span className={`block h-0.5 rounded transition-all duration-300 ${hamBar} ${mobileOpen ? "opacity-0 w-0" : "w-[22px]"}`} />
					<span className={`block w-[22px] h-0.5 rounded transition-transform duration-300 ${hamBar} ${mobileOpen ? "-translate-y-[7px] -rotate-45" : ""}`} />
				</button>
			</nav>

			{mobileOpen && (
				<div
					className="md:hidden fixed inset-0 z-[98] bg-black/70 backdrop-blur-[4px]"
					onClick={() => setMobileOpen(false)}
				/>
			)}
			<div className={`md:hidden fixed top-0 right-0 z-[99] h-full w-[280px] bg-[#071009] border-l border-[rgba(18,201,132,0.1)] shadow-2xl transition-transform duration-300 pt-20 px-6 flex flex-col gap-2 ${mobileOpen ? "translate-x-0" : "translate-x-full"}`}>
				<a
					href="#features"
					onClick={() => setMobileOpen(false)}
					className="py-3 px-4 rounded-lg text-[15px] font-medium text-[#9ab8a4] hover:text-[#e8f0ea] hover:bg-[rgba(18,201,132,0.06)]"
				>
					Features
				</a>
				<a
					href="#how-it-works"
					onClick={() => setMobileOpen(false)}
					className="py-3 px-4 rounded-lg text-[15px] font-medium text-[#9ab8a4] hover:text-[#e8f0ea] hover:bg-[rgba(18,201,132,0.06)]"
				>
					How it works
				</a>
				<Link
					href="/auth/login"
					className="py-3 px-4 rounded-lg text-[15px] font-medium text-[#9ab8a4] hover:text-[#e8f0ea] hover:bg-[rgba(18,201,132,0.06)] no-underline"
				>
					Sign In
				</Link>
				<Link
					href="/auth/register"
					className="mt-2 py-3 px-4 rounded-lg text-[15px] font-semibold text-[#040c06] bg-[#12c984] text-center no-underline hover:bg-[#0faa70] transition-colors"
				>
					Get Started
				</Link>
			</div>
		</>
	);
}
