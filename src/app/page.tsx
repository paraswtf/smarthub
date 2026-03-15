import { type Metadata } from "next";
import HeroSection from "~/components/sections/Hero";
import FeaturesSection from "~/components/sections/Features";
import HowItWorksSection from "~/components/sections/HowItWorks";
import OpenSourceCTA from "~/components/sections/OpenSourceCTA";
import Footer from "~/components/Footer";

export const metadata: Metadata = {
	title: "ESP Hub | Open Source ESP32 Home Automation Dashboard",
	description: "Connect and control multiple ESP32 relay boards from a single web dashboard. Real-time WebSocket control, captive portal configuration, and API key authentication."
};

export default function HomePage() {
	return (
		<div className="landing-dark">
			<HeroSection />
			<FeaturesSection />
			<HowItWorksSection />
			<OpenSourceCTA />
			<Footer />
		</div>
	);
}
