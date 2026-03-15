"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
	src: string;
	alt: string;
	width?: number;
	height?: number;
	className?: string;
	style?: React.CSSProperties;
	/** When true, replaces white/near-white pixels with black. All other colours unchanged. */
	whiteToBlack?: boolean;
	/** 0-255: how close to white a pixel must be to be replaced. Default 80. */
	threshold?: number;
}

// ─── SVG: text-level replacement ────────────────────────────────────────────
// Replaces white colour values in SVG XML directly — no canvas needed,
// no CORS pixel-read restrictions, works even when naturalWidth=0.

const WHITE_PATTERNS: [RegExp, string | ((...args: string[]) => string)][] = [
	// fill/stroke="white" or fill/stroke="#fff" / "#ffffff"
	[/(fill|stroke)=["'](\s*#(?:fff|ffffff)\s*)["']/gi, '$1="#000000"'],
	[/(fill|stroke)=["'](\s*white\s*)["']/gi, '$1="black"'],
	[/(fill|stroke)=["'](\s*rgb\(\s*255\s*,\s*255\s*,\s*255\s*)\s*\)["']/gi, '$1="black"'],
	// fill/stroke inside style="..." attributes
	[/(fill|stroke)\s*:\s*(#(?:fff|ffffff)|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))/gi, "$1:#000000"],
	// stop-color for gradients
	[/(stop-color)\s*=\s*["'](\s*#(?:fff|ffffff)|white)["']/gi, '$1="black"'],
	[/(stop-color)\s*:\s*(#(?:fff|ffffff)|white)/gi, "$1:black"],
	// Light grey shorthands: #eee #ddd #ccc #bbb #aaa
	[/(fill|stroke)=["'](\s*#([e-f][e-f][e-f]|[d][d][d]|[c][c][c]|[b][b][b])\s*)["']/gi, '$1="#000000"'],
	// 6-digit light greys where all channels >= 170 and spread <= 30
	[
		/(fill|stroke)=["']\s*#([a-fA-F0-9]{6})\s*["']/g,
		(match: string, attr: string, hex: string) => {
			const r = parseInt(hex.slice(0, 2), 16);
			const g = parseInt(hex.slice(2, 4), 16);
			const b = parseInt(hex.slice(4, 6), 16);
			const min = Math.min(r, g, b);
			const spread = Math.max(r, g, b) - min;
			return min >= 170 && spread <= 30 ? `${attr}="#000000"` : match;
		}
	]
];

function processsvg(svgText: string): string {
	let out = svgText;
	for (const [pattern, replacement] of WHITE_PATTERNS) {
		out = out.replace(pattern as RegExp, replacement as string);
	}
	return out;
}

// ─── Raster (PNG / WebP / JPG): canvas pixel replacement ────────────────────

function processRaster(src: string, threshold: number, width: number | undefined, height: number | undefined): Promise<string> {
	return new Promise((resolve) => {
		const img = new Image();
		img.crossOrigin = "anonymous";

		img.onload = () => {
			try {
				const naturalW = img.naturalWidth || width || 300;
				const naturalH = img.naturalHeight || height || 150;

				const canvas = document.createElement("canvas");
				canvas.width = naturalW;
				canvas.height = naturalH;

				const ctx = canvas.getContext("2d");
				if (!ctx) {
					resolve(src);
					return;
				}

				ctx.drawImage(img, 0, 0, naturalW, naturalH);
				const imageData = ctx.getImageData(0, 0, naturalW, naturalH);
				const data = imageData.data;

				for (let i = 0; i < data.length; i += 4) {
					const r = data[i] as number;
					const g = data[i + 1] as number;
					const b = data[i + 2] as number;
					const a = data[i + 3] as number;

					if (a < 10) continue;

					const min = Math.min(r, g, b);
					const max = Math.max(r, g, b);
					const spread = max - min;

					if (min >= 255 - threshold && spread <= threshold) {
						data[i] = 0;
						data[i + 1] = 0;
						data[i + 2] = 0;
					}
				}

				ctx.putImageData(imageData, 0, 0);
				resolve(canvas.toDataURL("image/png"));
			} catch {
				resolve(src); // canvas tainted — fall back
			}
		};

		img.onerror = () => resolve(src);
		img.src = src.includes("?") ? `${src}&_cors=1` : `${src}?_cors=1`;
	});
}

// ────────────────────────────────────────────────────────────────────────────

export default function LogoImage({ src, alt, width, height, className, style, whiteToBlack = false, threshold = 80 }: Props) {
	const [displaySrc, setDisplaySrc] = useState(src);
	const processedCache = useRef<Map<string, string>>(new Map());

	useEffect(() => {
		setDisplaySrc(src);
		if (!whiteToBlack) return;

		const cacheKey = `${src}::${threshold}`;
		const cached = processedCache.current.get(cacheKey);
		if (cached) {
			setDisplaySrc(cached);
			return;
		}

		let cancelled = false;
		let blobUrl: string | null = null;

		const isSvg = src.toLowerCase().includes(".svg") || src.toLowerCase().includes("/svg") || src.toLowerCase().includes("image/svg");

		const run = async () => {
			try {
				if (isSvg) {
					const res = await fetch(src);
					if (!res.ok || cancelled) return;
					const text = await res.text();
					if (cancelled) return;
					const processed = processsvg(text);
					const blob = new Blob([processed], { type: "image/svg+xml" });
					blobUrl = URL.createObjectURL(blob);
					processedCache.current.set(cacheKey, blobUrl);
					if (!cancelled) setDisplaySrc(blobUrl);
				} else {
					const dataUrl = await processRaster(src, threshold, width, height);
					if (cancelled) return;
					processedCache.current.set(cacheKey, dataUrl);
					setDisplaySrc(dataUrl);
				}
			} catch {
				// any error — original already showing
			}
		};

		void run();

		return () => {
			cancelled = true;
			// Only revoke blob URLs when src changes, not on every cleanup
		};
	}, [src, whiteToBlack, threshold, width, height]);

	// eslint-disable-next-line @next/next/no-img-element
	return (
		<img
			src={displaySrc}
			alt={alt}
			width={width}
			height={height}
			className={className}
			style={style}
		/>
	);
}
