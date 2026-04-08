"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Tag } from "lucide-react";
import { Button } from "~/components/ui/button";
import type { FirmwareRelease } from "~/app/api/firmware/releases/route";

interface Props {
	variant?: "default" | "outline" | "ghost";
	size?: "default" | "sm" | "lg";
	/** Show version tag next to the label */
	showVersion?: boolean;
	className?: string;
}

export function FirmwareDownloadButton({ variant = "outline", size = "sm", showVersion = true, className }: Props) {
	const [release, setRelease] = useState<FirmwareRelease | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		fetch("/api/firmware/releases")
			.then((r) => r.json())
			.then((data: FirmwareRelease[]) => {
				setRelease(data[0] ?? null);
			})
			.catch(() => setRelease(null))
			.finally(() => setLoading(false));
	}, []);

	if (loading) {
		return (
			<Button variant={variant} size={size} disabled className={className}>
				<Loader2 className="w-3.5 h-3.5 animate-spin" />
				Loading…
			</Button>
		);
	}

	if (!release?.asset) {
		return (
			<Button variant={variant} size={size} asChild className={className}>
				<a href="https://github.com/paraswtf/smarthub/releases" target="_blank" rel="noopener noreferrer">
					<Download className="w-3.5 h-3.5" />
					Firmware Releases
				</a>
			</Button>
		);
	}

	return (
		<Button variant={variant} size={size} asChild className={className}>
			<a href={release.asset.browser_download_url} download>
				<Download className="w-3.5 h-3.5" />
				Download Firmware
				{showVersion && (
					<span className="flex items-center gap-0.5 text-muted-foreground">
						<Tag className="w-3 h-3" />
						{release.tag_name.replace("firmware-", "")}
					</span>
				)}
			</a>
		</Button>
	);
}
