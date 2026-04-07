"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import HeroPixelRain from "~/components/HeroPixelRain";
import LandingGeometry from "~/components/LandingGeometry";

export default function HeroSection() {
	const sectionRef = useRef<HTMLElement>(null);

	useEffect(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) {
						entry.target.querySelectorAll(".reveal").forEach((el, i) => {
							setTimeout(() => el.classList.add("visible"), i * 120);
						});
					}
				});
			},
			{ threshold: 0.1 },
		);
		if (sectionRef.current) observer.observe(sectionRef.current);
		return () => observer.disconnect();
	}, []);

	return (
		<section ref={sectionRef} className="min-h-screen flex flex-col items-center justify-center text-center px-6 md:px-10 pt-[120px] pb-20 relative overflow-hidden">
			{/* Deep green glow */}
			<div
				className="absolute pointer-events-none"
				style={{
					top: "-200px",
					left: "50%",
					transform: "translateX(-50%)",
					width: "1000px",
					height: "700px",
					background: "radial-gradient(ellipse at 50% 20%, rgba(18,201,132,0.18) 0%, rgba(5,150,105,0.06) 50%, transparent 75%)",
				}}
			/>

			{/* Subtle grid */}
			<div
				className="absolute inset-0 pointer-events-none"
				style={{
					backgroundImage: "linear-gradient(rgba(18,201,132,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(18,201,132,0.04) 1px, transparent 1px)",
					backgroundSize: "60px 60px",
				}}
			/>

			<HeroPixelRain />

			{/* Diagonal accent lines */}
			<div className="absolute inset-0 pointer-events-none overflow-hidden">
				{[
					{ left: "12%", rotate: "18deg", height: "320px" },
					{ left: "28%", rotate: "12deg", height: "260px" },
					{ right: "18%", rotate: "-22deg", height: "290px" },
					{ right: "8%", rotate: "-14deg", height: "230px" },
					{ left: "52%", rotate: "4deg", height: "380px" },
					{ right: "38%", rotate: "-7deg", height: "210px" },
				].map((style, i) => (
					<div key={i} className="absolute top-0 w-px" style={{ ...style, background: "linear-gradient(to bottom, rgba(18,201,132,0.2), transparent)" }} />
				))}
			</div>

			<div className="relative z-10 max-w-[860px] reveal">
				{/* Badge */}
				<div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[rgba(18,201,132,0.25)] bg-[rgba(18,201,132,0.07)] text-[12px] font-semibold text-[#12c984] tracking-[1px] uppercase mb-8">
					Open Source · ESP32 · Home Automation
				</div>

				<h1 className="font-['Sora'] font-extrabold leading-[1.06] mb-6" style={{ fontSize: "clamp(40px, 7vw, 78px)", color: "#e8f0ea" }}>
					Control all your <span style={{ color: "#12c984" }}>ESP32 devices</span>
					<br />
					<span style={{ color: "#9ab8a4" }}>from one dashboard</span>
				</h1>

				<p className="text-[17px] leading-[1.75] max-w-[600px] mx-auto mb-10 font-normal" style={{ color: "#7a9080" }}>
					SmartHUB connects multiple ESP32 relay boards to a single web dashboard over WebSocket. Configure pins via a captive portal, name your switches, and control them from anywhere.
				</p>

				<div className="flex flex-wrap gap-4 justify-center">
					<Link href="/auth/register" className="land-btn land-btn-primary">
						Start for free →
					</Link>
					<a href="https://github.com/paraswtf/smarthub" target="_blank" rel="noopener noreferrer" className="land-btn land-btn-ghost">
						<svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
							<path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
						</svg>
						View on GitHub
					</a>
				</div>

				{/* Stats row */}
				<div className="flex flex-wrap items-center justify-center gap-8 mt-14 pt-10" style={{ borderTop: "1px solid rgba(18,201,132,0.12)" }}>
					{[
						{ value: "8", label: "Relays per device" },
						{ value: "∞", label: "Devices per account" },
						{ value: "WS", label: "Real-time control" },
						{ value: "MIT", label: "Open source" },
					].map(({ value, label }) => (
						<div key={label} className="text-center">
							<p className="font-['Sora'] font-extrabold text-[28px] leading-none" style={{ color: "#12c984" }}>
								{value}
							</p>
							<p className="text-[12px] mt-1 font-medium" style={{ color: "#4a6b58" }}>
								{label}
							</p>
						</div>
					))}
				</div>
			</div>

			<LandingGeometry />
		</section>
	);
}
