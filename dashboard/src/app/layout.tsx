import { type Metadata, type Viewport } from "next";
import { Sora, DM_Sans, JetBrains_Mono } from "next/font/google";
import "~/styles/globals.css";
import { TRPCReactProvider } from "~/trpc/react";
import { ThemeProvider } from "~/providers/ThemeProvider";
import { SessionProvider } from "~/providers/SessionProvider";

const sora = Sora({
	subsets: ["latin"],
	weight: ["300", "400", "600", "700", "800"],
	variable: "--font-sora",
	display: "swap",
});

const dmSans = DM_Sans({
	subsets: ["latin"],
	weight: ["300", "400", "500", "600"],
	style: ["normal", "italic"],
	variable: "--font-dm-sans",
	display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
	subsets: ["latin"],
	weight: ["400", "500", "600"],
	variable: "--font-jetbrains-mono",
	display: "swap",
});

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	maximumScale: 1,
};

export const metadata: Metadata = {
	title: "SmartHUB | Home Automation Control Center",
	description: "Connect and control multiple ESP32 devices from a single dashboard.",
	robots: "index, follow",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" className={`${sora.variable} ${dmSans.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
			<body>
				<ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange={false}>
					<TRPCReactProvider>
						<SessionProvider>{children}</SessionProvider>
					</TRPCReactProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
