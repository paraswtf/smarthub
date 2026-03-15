"use client";

import { useEffect, useRef } from "react";

export default function CustomCursor() {
	const dotRef = useRef<HTMLDivElement>(null);
	const ringRef = useRef<HTMLDivElement>(null);
	const trailRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const dot = dotRef.current;
		const ring = ringRef.current;
		const trail = trailRef.current;
		if (!dot || !ring || !trail) return;

		let mx = -200,
			my = -200;
		let rx = -200,
			ry = -200; // ring (lagged)
		let tx = -200,
			ty = -200; // trail (more lagged)
		let isHover = false;
		let isClick = false;
		let rafId: number;

		const onMove = (e: MouseEvent) => {
			mx = e.clientX;
			my = e.clientY;
		};

		const onDown = () => {
			isClick = true;
			dot.style.transform = "translate(-50%,-50%) scale(0.5)";
			ring.style.transform = "translate(-50%,-50%) scale(1.6)";
		};
		const onUp = () => {
			isClick = false;
			dot.style.transform = isHover ? "translate(-50%,-50%) scale(0)" : "translate(-50%,-50%) scale(1)";
			ring.style.transform = "translate(-50%,-50%) scale(1)";
		};

		const onEnterLink = () => {
			isHover = true;
			dot.style.transform = "translate(-50%,-50%) scale(0)";
			ring.style.width = "44px";
			ring.style.height = "44px";
			ring.style.borderColor = "rgba(14,165,233,0.9)";
			ring.style.backgroundColor = "rgba(14,165,233,0.08)";
			ring.style.backdropFilter = "blur(2px)";
		};
		const onLeaveLink = () => {
			isHover = false;
			dot.style.transform = "translate(-50%,-50%) scale(1)";
			ring.style.width = "28px";
			ring.style.height = "28px";
			ring.style.borderColor = "rgba(29,107,212,0.55)";
			ring.style.backgroundColor = "transparent";
			ring.style.backdropFilter = "none";
		};

		// Attach hover listeners to interactive elements
		const interactiveSelector = "a, button, [role=button], input, textarea, select, label[for], [tabindex]";
		const attach = () => {
			document.querySelectorAll<HTMLElement>(interactiveSelector).forEach((el) => {
				el.addEventListener("mouseenter", onEnterLink);
				el.addEventListener("mouseleave", onLeaveLink);
			});
		};
		attach();

		// Re-attach on DOM mutations (e.g. modals opening)
		const observer = new MutationObserver(attach);
		observer.observe(document.body, { childList: true, subtree: true });

		window.addEventListener("mousemove", onMove);
		window.addEventListener("mousedown", onDown);
		window.addEventListener("mouseup", onUp);

		const tick = () => {
			rafId = requestAnimationFrame(tick);

			// Dot — instant
			dot.style.left = `${mx}px`;
			dot.style.top = `${my}px`;

			// Ring — slight lag
			rx += (mx - rx) * 0.18;
			ry += (my - ry) * 0.18;
			ring.style.left = `${rx}px`;
			ring.style.top = `${ry}px`;

			// Trail — more lag, pixel squares
			tx += (mx - tx) * 0.09;
			ty += (my - ty) * 0.09;
			trail.style.left = `${tx}px`;
			trail.style.top = `${ty}px`;

			// Trail opacity based on speed
			const speed = Math.hypot(mx - tx, my - ty);
			trail.style.opacity = String(Math.min(speed / 60, 0.5));
		};
		tick();

		return () => {
			cancelAnimationFrame(rafId);
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mousedown", onDown);
			window.removeEventListener("mouseup", onUp);
			observer.disconnect();
			document.querySelectorAll<HTMLElement>(interactiveSelector).forEach((el) => {
				el.removeEventListener("mouseenter", onEnterLink);
				el.removeEventListener("mouseleave", onLeaveLink);
			});
		};
	}, []);

	return (
		<>
			{/* Sharp pixel trail */}
			<div
				ref={trailRef}
				className="fixed z-[9998] pointer-events-none"
				style={{
					width: "6px",
					height: "6px",
					backgroundColor: "rgba(14,165,233,0.45)",
					transform: "translate(-50%,-50%)",
					imageRendering: "pixelated",
					transition: "opacity 0.1s"
				}}
			/>

			{/* Outer ring */}
			<div
				ref={ringRef}
				className="fixed z-[9999] pointer-events-none rounded-full"
				style={{
					width: "28px",
					height: "28px",
					border: "1.5px solid rgba(29,107,212,0.55)",
					transform: "translate(-50%,-50%)",
					transition: "width 0.25s cubic-bezier(.22,1,.36,1), height 0.25s cubic-bezier(.22,1,.36,1), border-color 0.2s, background-color 0.2s, transform 0.15s cubic-bezier(.22,1,.36,1)"
				}}
			/>

			{/* Inner dot — sharp square */}
			<div
				ref={dotRef}
				className="fixed z-[9999] pointer-events-none"
				style={{
					width: "4px",
					height: "4px",
					backgroundColor: "rgba(29,107,212,1)",
					transform: "translate(-50%,-50%) scale(1)",
					imageRendering: "pixelated",
					transition: "transform 0.12s cubic-bezier(.22,1,.36,1)"
				}}
			/>
		</>
	);
}
