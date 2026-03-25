import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/** Format a Date (or ISO string) as relative time with second precision */
export function timeAgo(date: Date | string | null | undefined): string {
	if (!date) return "Never";
	const d = typeof date === "string" ? new Date(date) : date;
	const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
	if (seconds < 5) return "Just now";
	if (seconds < 60) return `${seconds}s ago`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s ago`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ago`;
	return `${Math.floor(seconds / 86400)}d ago`;
}

/** Truncate an API key for display */
export function maskKey(key: string): string {
	if (key.length <= 12) return key;
	return `${key.slice(0, 6)}••••••••${key.slice(-4)}`;
}
