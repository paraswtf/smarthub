"use client";

import { useEffect, useRef } from "react";

// ── Tuning ───────────────────────────────────────────────────────────────────
const CONFIG = {
	GRID: 32, // column spacing (px)
	SPEED_MIN: 0.06, // slowest idle drift (px/frame)
	SPEED_MAX: 0.18, // fastest idle drift (px/frame)
	OPACITY_MIN: 0.1, // most transparent pixels
	OPACITY_MAX: 0.3, // most opaque pixels
	SCROLL_BOOST: 0.1, // scroll velocity → speed multiplier
	SCROLL_DECAY: 0.84, // how fast scroll boost fades (0–1, higher = longer tail)
	REPULSE_RADIUS: 90, // mouse repulsion radius (px)
	REPULSE_FORCE: 2.8, // repulsion strength
	REPULSE_DAMPING: 0.8, // velocity damping per frame
	SPRING_STRENGTH: 0.018, // how fast pixels snap back to column
	LIT_BOOST: 0.55, // opacity added when pixel is lit by cursor
	EDGE_FADE_PX: 60, // fade-in/out zone at top & bottom edges (px)
	PIXELS_PER_COL: [2, 2, 3], // randomly pick from this array per column
	SIZE_OPTIONS: [2, 2, 3, 3, 4] // randomly pick pixel size (px)
} as const;
// ─────────────────────────────────────────────────────────────────────────────

interface Pixel {
	x: number;
	y: number;
	col: number;
	baseSpeed: number;
	speed: number;
	opacity: number;
	baseOpacity: number;
	size: number;
	// mouse interaction
	vx: number; // horizontal push from cursor
	vy: number; // vertical push from cursor
	lit: number; // 0-1 brightness boost from proximity
}

export default function HeroPixelRain() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const mouseRef = useRef({ x: -9999, y: -9999 });

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.imageSmoothingEnabled = false;

		let w = (canvas.width = canvas.offsetWidth);
		let h = (canvas.height = canvas.offsetHeight);

		// ── Scroll velocity ──────────────────────────────────────────────
		let scrollVel = 0;
		let lastScrollY = window.scrollY;
		let lastScrollTime = performance.now();

		const onScroll = () => {
			const now = performance.now();
			const dt = Math.max(1, now - lastScrollTime);
			scrollVel = ((window.scrollY - lastScrollY) / dt) * 16;
			lastScrollY = window.scrollY;
			lastScrollTime = now;
		};
		window.addEventListener("scroll", onScroll, { passive: true });

		// ── Mouse tracking ───────────────────────────────────────────────
		const onMouseMove = (e: MouseEvent) => {
			const rect = canvas.getBoundingClientRect();
			mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
		};
		const onMouseLeave = () => {
			mouseRef.current = { x: -9999, y: -9999 };
		};
		canvas.parentElement?.addEventListener("mousemove", onMouseMove);
		canvas.parentElement?.addEventListener("mouseleave", onMouseLeave);

		const onResize = () => {
			w = canvas.width = canvas.offsetWidth;
			h = canvas.height = canvas.offsetHeight;
			init();
		};
		window.addEventListener("resize", onResize);

		// ── Pixel grid ───────────────────────────────────────────────────
		let pixels: Pixel[] = [];

		function makePixel(col: number, randomY: boolean): Pixel {
			const sizes = CONFIG.SIZE_OPTIONS;
			const size = sizes[Math.floor(Math.random() * sizes.length)]!;
			return {
				x: col * CONFIG.GRID + Math.floor(Math.random() * (CONFIG.GRID - size)),
				y: randomY ? Math.random() * h * 1.5 - h * 0.3 : -size - Math.random() * 60,
				col,
				baseSpeed: CONFIG.SPEED_MIN + Math.random() * (CONFIG.SPEED_MAX - CONFIG.SPEED_MIN),
				speed: 0,
				baseOpacity: CONFIG.OPACITY_MIN + Math.random() * (CONFIG.OPACITY_MAX - CONFIG.OPACITY_MIN),
				opacity: 0,
				size,
				vx: 0,
				vy: 0,
				lit: 0
			};
		}

		function init() {
			pixels = [];
			const cols = Math.ceil(w / CONFIG.GRID);
			for (let col = 0; col < cols; col++) {
				const countOpts = CONFIG.PIXELS_PER_COL;
				const count = countOpts[Math.floor(Math.random() * countOpts.length)]!;
				for (let k = 0; k < count; k++) pixels.push(makePixel(col, true));
			}
		}
		init();

		// ── Animation loop ───────────────────────────────────────────────
		let rafId: number;
		const cols = () => Math.ceil(w / CONFIG.GRID);

		const animate = () => {
			rafId = requestAnimationFrame(animate);
			ctx.clearRect(0, 0, w, h);

			scrollVel *= CONFIG.SCROLL_DECAY;
			const boost = Math.max(0, scrollVel * CONFIG.SCROLL_BOOST);
			const mx = mouseRef.current.x;
			const my = mouseRef.current.y;

			pixels.forEach((p, i) => {
				// ── Mouse repulsion ──────────────────────────────────────
				const dx = p.x - mx;
				const dy = p.y - my;
				const dist = Math.hypot(dx, dy);

				if (dist < CONFIG.REPULSE_RADIUS && dist > 0) {
					const force = ((CONFIG.REPULSE_RADIUS - dist) / CONFIG.REPULSE_RADIUS) ** 1.4 * CONFIG.REPULSE_FORCE;
					p.vx += (dx / dist) * force;
					p.vy += (dy / dist) * force;
					p.lit = Math.max(p.lit, 1 - dist / CONFIG.REPULSE_RADIUS);
				}

				// Apply velocity + damping + drift back
				p.x += p.vx;
				p.vx *= CONFIG.REPULSE_DAMPING;
				const homeX = p.col * CONFIG.GRID;
				p.vx += (homeX - p.x) * CONFIG.SPRING_STRENGTH;

				p.vy *= CONFIG.REPULSE_DAMPING;
				p.lit *= 0.9;

				// ── Fall speed ───────────────────────────────────────────
				p.speed = p.baseSpeed + boost + Math.max(0, p.vy);
				p.y += p.speed;

				// ── Reset ────────────────────────────────────────────────
				if (p.y > h + p.size + 4) {
					pixels[i] = makePixel(Math.floor(Math.random() * cols()), false);
					return;
				}

				// ── Opacity ──────────────────────────────────────────────
				const edgeFade = Math.min(p.y / CONFIG.EDGE_FADE_PX, 1) * Math.min((h - p.y) / CONFIG.EDGE_FADE_PX, 1);
				const a = Math.min(1, p.baseOpacity * edgeFade + p.lit * CONFIG.LIT_BOOST);
				if (a < 0.01) return;

				// ── Draw ─────────────────────────────────────────────────
				const px = Math.round(p.x);
				const py = Math.round(p.y);

				if (p.lit > 0.15) {
					const t = Math.min(p.lit, 1);
					const r = Math.round(29 + t * (200 - 29));
					const g = Math.round(107 + t * (230 - 107));
					const bv = Math.round(212 + t * (255 - 212));
					ctx.fillStyle = `rgba(${r},${g},${bv},${a.toFixed(3)})`;
				} else {
					ctx.fillStyle = `rgba(29,107,212,${a.toFixed(3)})`;
				}

				ctx.fillRect(px, py, p.size, p.size);
			});
		};

		rafId = requestAnimationFrame(animate);

		return () => {
			cancelAnimationFrame(rafId);
			window.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onResize);
			canvas.parentElement?.removeEventListener("mousemove", onMouseMove);
			canvas.parentElement?.removeEventListener("mouseleave", onMouseLeave);
		};
	}, []);

	return (
		<canvas
			ref={canvasRef}
			className="absolute inset-0 w-full h-full pointer-events-none"
			style={{ imageRendering: "pixelated" }}
			aria-hidden
		/>
	);
}
