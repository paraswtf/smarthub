"use client";

import { useEffect, useRef } from "react";
import { Zap, Wifi, Key, ToggleRight, Cpu, Globe } from "lucide-react";

const FEATURES = [
	{ icon: Cpu, title: "Multi-device support", desc: "Link as many ESP32 boards as you need to a single account using a shared API key. Each board shows up independently in your dashboard." },
	{ icon: Zap, title: "Real-time WebSocket", desc: "Commands reach your ESP32 instantly over a persistent WebSocket connection. No polling, no delays — toggle a relay and it switches in milliseconds." },
	{ icon: ToggleRight, title: "Up to 8 relays per board", desc: "Assign GPIO pins, give each relay a friendly name and icon, and control them with a single tap. Offline state syncs automatically on reconnect." },
	{ icon: Key, title: "API key auth", desc: "Generate API keys from the dashboard and flash them to your ESP32 via the captive portal. Revoke a key to instantly disconnect all boards using it." },
	{ icon: Wifi, title: "Captive portal config", desc: "First boot puts the ESP32 in AP mode. Connect to its WiFi, open the portal, enter your home network credentials and API key — done." },
	{ icon: Globe, title: "Self-hostable", desc: "Run ESP Hub on any VPS or home server. All you need is Node.js and a MongoDB database. The WebSocket server is a single standalone process." }
];

export default function FeaturesSection() {
	const sectionRef = useRef<HTMLElement>(null);

	useEffect(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) {
						entry.target.querySelectorAll(".reveal").forEach((el, i) => {
							setTimeout(() => el.classList.add("visible"), i * 80);
						});
					}
				});
			},
			{ threshold: 0.1 }
		);
		if (sectionRef.current) observer.observe(sectionRef.current);
		return () => observer.disconnect();
	}, []);

	return (
		<section
			id="features"
			ref={sectionRef}
			className="py-24 px-6 md:px-[60px] max-w-[1200px] mx-auto"
		>
			<div className="text-center mb-16 reveal">
				<div className="land-label">Features</div>
				<h2 className="land-title">
					Everything you need to
					<br />
					<span className="hl">automate your home</span>
				</h2>
				<p
					className="text-[16px] max-w-[520px] mx-auto mt-5 leading-relaxed"
					style={{ color: "#7a9080" }}
				>
					ESP Hub handles the hard parts — device auth, real-time sync, and state persistence — so you can focus on building.
				</p>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
				{FEATURES.map(({ icon: Icon, title, desc }) => (
					<div
						key={title}
						className="reveal land-card group p-7"
					>
						<div
							className="w-10 h-10 rounded-xl flex items-center justify-center mb-5 transition-colors"
							style={{ background: "rgba(18,201,132,0.1)" }}
						>
							<Icon
								className="w-5 h-5"
								style={{ color: "#12c984" }}
							/>
						</div>
						<h3
							className="font-['Sora'] font-bold text-[17px] mb-2"
							style={{ color: "#e8f0ea" }}
						>
							{title}
						</h3>
						<p
							className="text-[14px] leading-relaxed"
							style={{ color: "#7a9080" }}
						>
							{desc}
						</p>
					</div>
				))}
			</div>
		</section>
	);
}
