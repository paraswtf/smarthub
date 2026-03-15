import Link from "next/link";
import { Zap } from "lucide-react";

type FooterLink = { label: string; href: string; external?: boolean };

const SECTIONS: { heading: string; links: FooterLink[] }[] = [
	{
		heading: "Product",
		links: [
			{ label: "Features", href: "/#features" },
			{ label: "How it works", href: "/#how-it-works" },
			{ label: "Dashboard", href: "/dashboard" }
		]
	},
	{
		heading: "Account",
		links: [
			{ label: "Sign In", href: "/auth/login" },
			{ label: "Register", href: "/auth/register" }
		]
	},
	{
		heading: "Open Source",
		links: [
			{ label: "GitHub", href: "https://github.com/paraswtf/esp-hub", external: true },
			{ label: "Report an issue", href: "https://github.com/paraswtf/esp-hub/issues", external: true }
		]
	}
];

export default function Footer() {
	return (
		<footer style={{ background: "#040c06", borderTop: "1px solid rgba(18,201,132,0.08)" }}>
			<div className="max-w-[1200px] mx-auto px-6 md:px-[60px] py-12">
				<div
					className="flex flex-col md:flex-row items-start justify-between gap-10 pb-10"
					style={{ borderBottom: "1px solid rgba(18,201,132,0.08)" }}
				>
					{/* Brand */}
					<div className="max-w-[260px]">
						<Link
							href="/"
							className="flex items-center gap-2.5 no-underline mb-4"
						>
							<div className="w-8 h-8 rounded-lg bg-[#12c984] flex items-center justify-center">
								<Zap className="w-4 h-4 text-[#040c06]" />
							</div>
							<span className="font-['Sora'] font-bold text-[18px] text-[#e8f0ea]">ESP Hub</span>
						</Link>
						<p className="text-[14px] leading-relaxed text-[#4a6b58]">Open source home automation dashboard for ESP32 relay boards.</p>
					</div>

					{/* Link columns */}
					<div className="flex flex-wrap gap-12">
						{SECTIONS.map(({ heading, links }) => (
							<div key={heading}>
								<h4 className="font-['Sora'] font-bold text-[11px] uppercase tracking-[1.5px] mb-4 text-[#4a6b58]">{heading}</h4>
								<ul className="space-y-2.5">
									{links.map((item) => (
										<li key={item.href}>
											{item.external ? (
												<a
													href={item.href}
													target="_blank"
													rel="noopener noreferrer"
													className="text-[14px] no-underline text-[#7a9080] hover:text-[#e8f0ea] transition-colors"
												>
													{item.label}
												</a>
											) : (
												<Link
													href={item.href}
													className="text-[14px] no-underline text-[#7a9080] hover:text-[#e8f0ea] transition-colors"
												>
													{item.label}
												</Link>
											)}
										</li>
									))}
								</ul>
							</div>
						))}
					</div>
				</div>

				<div className="pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
					<p className="text-[13px] text-[#2e4a3a]">© {new Date().getFullYear()} ESP Hub. MIT License.</p>
					<p className="text-[13px] text-[#2e4a3a]">Built for makers &amp; tinkerers</p>
				</div>
			</div>
		</footer>
	);
}
