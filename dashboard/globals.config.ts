/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║              ESP HUB — GLOBAL CONFIGURATION              ║
 * ║  Edit this file to restyle the entire dashboard.         ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Colors are expressed as "H S% L%" HSL values so that
 * Tailwind / shadcn can consume them via CSS variables.
 *
 * To convert a hex color:
 *   https://colornames.org/white-or-black/  or any HSL converter
 */

// ─── App Identity ────────────────────────────────────────────
export const appConfig = {
	name: "ESP Hub",
	tagline: "Home Automation Control Center",
	/** Version shown in footer / settings */
	version: "1.0.0",
	/** Max relays the UI will render per device */
	maxRelaysPerDevice: 8,
	/** WebSocket reconnect interval in milliseconds */
	wsReconnectInterval: 5000,
	/** Milliseconds after last heartbeat before a device is considered offline (2.5× heartbeat) */
	deviceOnlineThresholdMs: 150_000,
	/** API base URL for ESP32 → server communication */
	apiBaseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000"
};

// ─── Light Theme ─────────────────────────────────────────────
export const lightTheme = {
	background: "0 0% 100%", // #ffffff — page bg
	foreground: "222 47% 11%", // #0f172a — body text
	card: "0 0% 100%", // #ffffff — card bg
	cardForeground: "222 47% 11%", // #0f172a
	popover: "0 0% 100%",
	popoverForeground: "222 47% 11%",
	primary: "161 94% 30%", // #059669 — emerald
	primaryForeground: "0 0% 100%", // #ffffff
	secondary: "210 40% 96%", // #f1f5f9
	secondaryForeground: "222 47% 11%",
	muted: "210 40% 96%", // #f1f5f9
	mutedForeground: "215 20% 47%", // #64748b
	accent: "161 94% 96%", // very light emerald tint
	accentForeground: "161 94% 20%", // dark emerald
	destructive: "0 84% 60%", // #ef4444
	destructiveForeground: "0 0% 100%",
	border: "214 32% 91%", // #e2e8f0
	input: "214 32% 91%",
	ring: "161 94% 30%", // emerald focus ring

	// Sidebar-specific (dark sidebar in light mode)
	sidebar: "210 40% 98%", // near-white
	sidebarForeground: "222 47% 11%", // dark text
	sidebarBorder: "214 32% 91%", // light border
	sidebarPrimary: "161 94% 30%", // emerald
	sidebarPrimaryFg: "0 0% 100%",
	sidebarAccent: "210 40% 94%", // light hover
	sidebarAccentFg: "222 47% 11%",
	sidebarMuted: "215 20% 47%", // medium grey

	// Status colors
	statusOnline: "161 94% 30%", // green
	statusOffline: "215 16% 55%", // muted slate
	statusRelay: "38 92% 50%" // amber for active relay
};

// ─── Dark Theme ──────────────────────────────────────────────
export const darkTheme = {
	background: "150 50% 4%", // #050f08 — near-black green
	foreground: "213 27% 90%", // #dde6f0 — off-white
	card: "148 45% 6%", // #071009 — dark card
	cardForeground: "213 27% 90%",
	popover: "148 45% 5%",
	popoverForeground: "213 27% 90%",
	primary: "161 69% 42%", // #12c984 — electric emerald
	primaryForeground: "148 60% 8%", // very dark green text on primary
	secondary: "148 32% 12%", // #0f2118
	secondaryForeground: "213 27% 90%",
	muted: "148 28% 12%", // #0f2017
	mutedForeground: "215 16% 55%", // #7c8fa3
	accent: "148 35% 15%", // #112819
	accentForeground: "161 69% 65%", // light emerald
	destructive: "0 63% 31%", // dark red
	destructiveForeground: "0 0% 90%",
	border: "148 28% 14%", // #0f2218
	input: "148 28% 14%",
	ring: "161 69% 42%",

	// Sidebar-specific
	sidebar: "150 60% 3%", // #040c06 — deepest black
	sidebarForeground: "213 27% 85%",
	sidebarBorder: "148 28% 10%",
	sidebarPrimary: "161 69% 42%",
	sidebarPrimaryFg: "148 60% 8%",
	sidebarAccent: "148 35% 9%",
	sidebarAccentFg: "213 27% 85%",
	sidebarMuted: "148 20% 40%",

	// Status colors
	statusOnline: "161 69% 42%", // electric green
	statusOffline: "148 20% 35%", // muted
	statusRelay: "38 92% 55%" // amber
};

// ─── Border Radius ───────────────────────────────────────────
export const radiusConfig = {
	/** Base radius used by shadcn components */
	base: "0.5rem"
};

// ─── Typography ──────────────────────────────────────────────
export const typographyConfig = {
	/** CSS variable for the display / heading font */
	fontDisplay: "var(--font-sora)",
	/** CSS variable for the body font */
	fontSans: "var(--font-dm-sans)",
	/** CSS variable for monospaced technical data */
	fontMono: "var(--font-jetbrains-mono)"
};
