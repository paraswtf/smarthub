"use client";

import { useEffect, useState } from "react";

interface Props {
	date: Date | string | null | undefined;
	/** If true, renders a compact "Xms ago" / "Xs ago" string inline */
	compact?: boolean;
}

function elapsed(date: Date | string | null | undefined): {
	ms: number;
	label: string;
	color: string;
} {
	if (!date) return { ms: -1, label: "Never", color: "text-muted-foreground" };
	const d = typeof date === "string" ? new Date(date) : date;
	const ms = Date.now() - d.getTime();

	let label: string;
	let color: string;

	if (ms < 1_000) {
		label = `${ms}ms ago`;
		color = "text-primary";
	} else if (ms < 10_000) {
		label = `${(ms / 1000).toFixed(1)}s ago`;
		color = "text-primary";
	} else if (ms < 60_000) {
		label = `${Math.floor(ms / 1000)}s ago`;
		color = "text-primary";
	} else if (ms < 3_600_000) {
		const m = Math.floor(ms / 60_000);
		const s = Math.floor((ms % 60_000) / 1000);
		label = `${m}m ${s}s ago`;
		color = "text-muted-foreground";
	} else {
		const h = Math.floor(ms / 3_600_000);
		const m = Math.floor((ms % 3_600_000) / 60_000);
		label = `${h}h ${m}m ago`;
		color = "text-muted-foreground";
	}

	return { ms, label, color };
}

export function LiveLastSeen({ date, compact = false }: Props) {
	const [tick, setTick] = useState(0);

	useEffect(() => {
		// Tick every 100ms for sub-second precision, slow down once > 10s
		let interval = 100;
		const id = setInterval(() => {
			setTick((t) => {
				const ms = date ? Date.now() - new Date(date).getTime() : Infinity;
				// Once we're past 10s accuracy of 1s is fine — reduce CPU
				const next = ms < 10_000 ? 100 : 1_000;
				if (next !== interval) {
					clearInterval(id);
					interval = next;
				}
				return t + 1;
			});
		}, interval);
		return () => clearInterval(id);
	}, [date]);

	const { label, color, ms } = elapsed(date);

	if (compact) {
		return <span className={color}>{label}</span>;
	}

	// Full display with absolute timestamp
	const absolute = date
		? new Date(typeof date === "string" ? date : date).toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit"
			})
		: "—";

	return (
		<div className="flex flex-col gap-0.5">
			<span className={`font-semibold mono text-sm ${color}`}>{label}</span>
			<span className="text-[11px] text-muted-foreground mono">{absolute}</span>
			{ms >= 0 && ms < 60_000 && <span className="text-[10px] text-muted-foreground mono">{ms.toLocaleString()} ms</span>}
		</div>
	);
}
