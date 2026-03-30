import { type Config } from "tailwindcss";
import { fontFamily } from "tailwindcss/defaultTheme";

export default {
	darkMode: ["class"],
	content: ["./src/**/*.tsx"],
	theme: {
		container: { center: true, padding: "2rem", screens: { "2xl": "1400px" } },
		extend: {
			fontFamily: {
				sans: ["var(--font-dm-sans)", "DM Sans", ...fontFamily.sans],
				"dm-sans": ["var(--font-dm-sans)", "DM Sans", ...fontFamily.sans],
				sora: ["var(--font-sora)", "Sora", ...fontFamily.sans],
				display: ["var(--font-sora)", "Sora", ...fontFamily.sans],
				mono: ["JetBrains Mono", "Fira Code", "ui-monospace", ...fontFamily.mono],
			},
			colors: {
				border: "hsl(var(--border))",
				input: "hsl(var(--input))",
				ring: "hsl(var(--ring))",
				background: "hsl(var(--background))",
				foreground: "hsl(var(--foreground))",
				primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
				secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
				destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
				muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
				accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
				popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
				card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
				sidebar: {
					DEFAULT: "hsl(var(--sidebar))",
					foreground: "hsl(var(--sidebar-foreground))",
					border: "hsl(var(--sidebar-border))",
					primary: "hsl(var(--sidebar-primary))",
					accent: "hsl(var(--sidebar-accent))",
					muted: "hsl(var(--sidebar-muted))",
				},
				navy: { DEFAULT: "#0a1628", mid: "#1a2e4a" },
			},
			borderRadius: {
				lg: "var(--radius)",
				md: "calc(var(--radius) - 2px)",
				sm: "calc(var(--radius) - 4px)",
				xl: "calc(var(--radius) + 4px)",
				"2xl": "calc(var(--radius) + 8px)",
			},
			animation: {
				"fade-in": "fadeIn 0.4s ease forwards",
				"slide-up": "slideUp 0.4s ease forwards",
				fadeUp: "fadeUp 0.65s ease forwards",
				float: "float 3s ease-in-out infinite",
				marquee: "marquee 30s linear infinite",
				marqueeRev: "marqueeRev 30s linear infinite",
			},
			keyframes: {
				fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
				slideUp: { from: { opacity: "0", transform: "translateY(16px)" }, to: { opacity: "1", transform: "translateY(0)" } },
				fadeUp: { from: { opacity: "0", transform: "translateY(24px)" }, to: { opacity: "1", transform: "translateY(0)" } },
				float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-12px)" } },
				marquee: { from: { transform: "translateX(0)" }, to: { transform: "translateX(-50%)" } },
				marqueeRev: { from: { transform: "translateX(-50%)" }, to: { transform: "translateX(0)" } },
			},
		},
	},
	plugins: [],
} satisfies Config;
