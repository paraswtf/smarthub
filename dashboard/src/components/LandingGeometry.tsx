"use client";

import { useEffect, useRef } from "react";

// ── Icosahedron geometry ──────────────────────────────────────────────────────
const PHI = (1 + Math.sqrt(5)) / 2;
const RAW_VERTS: [number, number, number][] = [
	[0, 1, PHI],
	[0, -1, PHI],
	[0, 1, -PHI],
	[0, -1, -PHI],
	[1, PHI, 0],
	[-1, PHI, 0],
	[1, -PHI, 0],
	[-1, -PHI, 0],
	[PHI, 0, 1],
	[-PHI, 0, 1],
	[PHI, 0, -1],
	[-PHI, 0, -1],
];
const VERTS: [number, number, number][] = RAW_VERTS.map(([x, y, z]) => {
	const l = Math.sqrt(x * x + y * y + z * z);
	return [x / l, y / l, z / l];
});
const EDGES: [number, number][] = [];
for (let i = 0; i < VERTS.length; i++) {
	for (let j = i + 1; j < VERTS.length; j++) {
		const [ax, ay, az] = VERTS[i]!;
		const [bx, by, bz] = VERTS[j]!;
		if (Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2) < 1.2) EDGES.push([i, j]);
	}
}

function rx3(x: number, y: number, z: number, a: number): [number, number, number] {
	return [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
}
function ry3(x: number, y: number, z: number, a: number): [number, number, number] {
	return [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
}

export default function LandingGeometry() {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const resize = () => {
			canvas.width = canvas.offsetWidth;
			canvas.height = canvas.offsetHeight;
		};
		resize();
		window.addEventListener("resize", resize);

		// Spring tilt from mouse
		const tilt = { rx: 0, ry: 0 };
		const tiltT = { rx: 0, ry: 0 };
		const tiltV = { rx: 0, ry: 0 };

		let autoRx = 0,
			autoRy = 0;
		let scrollVel = 0,
			lastSY = window.scrollY,
			lastST = performance.now();

		const onMouseMove = (e: MouseEvent) => {
			tiltT.ry = (e.clientX / window.innerWidth - 0.5) * 0.5;
			tiltT.rx = -(e.clientY / window.innerHeight - 0.5) * 0.3;
		};
		const onScroll = () => {
			const now = performance.now();
			scrollVel = ((window.scrollY - lastSY) / Math.max(1, now - lastST)) * 16;
			lastSY = window.scrollY;
			lastST = now;
		};
		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("scroll", onScroll, { passive: true });

		let rafId: number;
		const start = performance.now();

		const animate = (now: number) => {
			rafId = requestAnimationFrame(animate);
			const t = (now - start) / 1000;
			const w = canvas.width;
			const h = canvas.height;

			ctx.clearRect(0, 0, w, h);
			scrollVel *= 0.88;

			// Spring
			const K = 0.06,
				D = 0.78;
			tiltV.rx += (tiltT.rx - tilt.rx) * K;
			tiltV.rx *= D;
			tilt.rx += tiltV.rx;
			tiltV.ry += (tiltT.ry - tilt.ry) * K;
			tiltV.ry *= D;
			tilt.ry += tiltV.ry;

			autoRx += 0.0018 + scrollVel * 0.0005;
			autoRy += 0.0024;

			// Two shapes — sizes relative to canvas height to avoid stretching
			const R = h * 0.38;
			const shapes = [
				{ ox: w * 0.82, oy: h * 0.42, radius: R, offRx: 0.3, offRy: 0.6 },
				{ ox: w * 0.12, oy: h * 0.68, radius: R * 0.48, offRx: 1.1, offRy: 0.2 },
			];

			shapes.forEach(({ ox, oy, radius, offRx, offRy }) => {
				const transformed = VERTS.map(([vx, vy, vz]) => {
					let p: [number, number, number] = [vx, vy, vz];
					p = rx3(...p, autoRx + offRx + tilt.rx);
					p = ry3(...p, autoRy + offRy + tilt.ry);
					return p;
				});

				// Edges depth-sorted
				EDGES.map(([a, b]) => ({
					a,
					b,
					avgZ: (transformed[a]![2] + transformed[b]![2]) / 2,
				}))
					.sort((x, y) => x.avgZ - y.avgZ)
					.forEach(({ a, b, avgZ }) => {
						const [ax, ay, az] = transformed[a]!;
						const [bx, by, bz] = transformed[b]!;
						const fov = 3.2;
						const da = fov / (fov + az + 1);
						const db = fov / (fov + bz + 1);
						const depth = (avgZ + 1) / 2;
						ctx.beginPath();
						ctx.moveTo(ox + ax * radius * da, oy + ay * radius * da);
						ctx.lineTo(ox + bx * radius * db, oy + by * radius * db);
						ctx.strokeStyle = `rgba(29,107,212,${(0.02 + depth * 0.1).toFixed(3)})`;
						ctx.lineWidth = 0.5 + depth * 0.6;
						ctx.stroke();
					});

				// Front-facing vertex dots — sharp squares
				transformed.forEach(([vx, vy, vz]) => {
					const depth = (vz + 1) / 2;
					if (depth < 0.45) return;
					const fov = 3.2;
					const dv = fov / (fov + vz + 1);
					const sx = ox + vx * radius * dv;
					const sy = oy + vy * radius * dv;
					const pulse = 0.5 + 0.5 * Math.sin(t * 1.6 + vx * 3 + vy * 2);
					const dotA = 0.06 + depth * 0.2 * pulse;
					const dotR = 1.5 + depth * 2;

					ctx.fillStyle = `rgba(99,210,255,${dotA.toFixed(3)})`;
					ctx.fillRect(Math.round(sx - dotR / 2), Math.round(sy - dotR / 2), Math.round(dotR), Math.round(dotR));
				});
			});
		};

		rafId = requestAnimationFrame(animate);

		return () => {
			cancelAnimationFrame(rafId);
			window.removeEventListener("resize", resize);
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("scroll", onScroll);
		};
	}, []);

	return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden />;
}
