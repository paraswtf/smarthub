"use client";

import { useEffect, useRef } from "react";

const STEPS = [
	{ n: "01", title: "Create an account", desc: "Sign up at SmartHUB and generate an API key from the dashboard. One key can be shared across multiple ESP32 boards." },
	{
		n: "02",
		title: "Flash & configure",
		desc: "Power on your ESP32. It starts in AP mode — connect to its WiFi hotspot and open the captive portal at 192.168.4.1. Enter your home WiFi, device name, and API key.",
	},
	{ n: "03", title: "Device comes online", desc: "The ESP32 reboots, connects to your home network, and opens a WebSocket connection to SmartHUB. It appears in your dashboard within seconds." },
	{ n: "04", title: "Configure & control", desc: "From the device detail page, assign GPIO pins to relays, name them, and start toggling them in real time from any browser." },
];

export default function HowItWorksSection() {
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
		<section
			id="how-it-works"
			ref={sectionRef}
			className="py-24 px-6 md:px-[60px]"
			style={{ background: "#071009", borderTop: "1px solid rgba(18,201,132,0.08)", borderBottom: "1px solid rgba(18,201,132,0.08)" }}
		>
			<div className="max-w-[1200px] mx-auto">
				<div className="text-center mb-16 reveal">
					<div className="land-label">How it works</div>
					<h2 className="land-title">
						Up and running in <span className="hl">four steps</span>
					</h2>
					<p className="text-[16px] max-w-[480px] mx-auto mt-5 leading-relaxed" style={{ color: "#7a9080" }}>
						From unboxing an ESP32 to controlling your first relay takes under ten minutes.
					</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
					{STEPS.map(({ n, title, desc }) => (
						<div key={n} className="reveal land-card p-7 h-full">
							<div className="font-['Sora'] font-extrabold text-[44px] leading-none mb-5 select-none" style={{ color: "rgba(18,201,132,0.18)" }}>
								{n}
							</div>
							<h3 className="font-['Sora'] font-bold text-[17px] mb-3" style={{ color: "#e8f0ea" }}>
								{title}
							</h3>
							<p className="text-[14px] leading-relaxed" style={{ color: "#7a9080" }}>
								{desc}
							</p>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
