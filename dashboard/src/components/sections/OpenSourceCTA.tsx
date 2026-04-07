"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export default function OpenSourceCTA() {
	const sectionRef = useRef<HTMLElement>(null);

	useEffect(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) {
						entry.target.querySelectorAll(".reveal").forEach((el, i) => {
							setTimeout(() => el.classList.add("visible"), i * 100);
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
		<section ref={sectionRef} className="py-24 px-6 md:px-[60px]">
			<div className="max-w-[900px] mx-auto">
				<div
					className="reveal rounded-3xl p-12 md:p-16 text-center relative overflow-hidden"
					style={{
						background: "linear-gradient(135deg, rgba(18,201,132,0.07) 0%, rgba(18,201,132,0.02) 60%, transparent 100%)",
						border: "1px solid rgba(18,201,132,0.2)",
					}}
				>
					<div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(circle at 80% 10%, rgba(18,201,132,0.1) 0%, transparent 60%)" }} />

					<div className="relative z-10">
						<div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[rgba(18,201,132,0.2)] bg-[rgba(18,201,132,0.07)] text-[12px] font-semibold text-[#12c984] tracking-[1px] uppercase mb-8">
							Free & Open Source
						</div>

						<h2 className="font-['Sora'] font-extrabold mb-5" style={{ fontSize: "clamp(28px, 4vw, 44px)", color: "#e8f0ea" }}>
							Self-host it. Fork it.
							<br />
							<span style={{ color: "#12c984" }}>Make it yours.</span>
						</h2>

						<p className="text-[16px] max-w-[520px] mx-auto leading-relaxed mb-10" style={{ color: "#7a9080" }}>
							SmartHUB is MIT licensed. Run it on your own server, contribute improvements, or adapt it for your own hardware projects.
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
					</div>
				</div>
			</div>
		</section>
	);
}
