"use client";

import { useState, useEffect } from "react";
import { timeAgo } from "~/lib/utils";

/**
 * Returns a live-updating relative time string (e.g. "42s ago").
 * Re-renders every second so the display always reflects current time.
 */
export function useRelativeTime(date: Date | string | null | undefined): string {
	const [display, setDisplay] = useState(() => timeAgo(date));

	useEffect(() => {
		setDisplay(timeAgo(date));
		if (!date) return;

		const id = setInterval(() => setDisplay(timeAgo(date)), 1000);
		return () => clearInterval(id);
	}, [date]);

	return display;
}
