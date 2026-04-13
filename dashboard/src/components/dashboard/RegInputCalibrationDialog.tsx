"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "~/components/ui/dialog";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { useDeviceSocket } from "~/providers/DeviceSocketProvider";

interface PinRow {
	speed: number;
	pin: number;
	minRaw: number;
	maxRaw: number;
}

interface Props {
	open: boolean;
	onClose: () => void;
	deviceId: string;
	regInputId: string;
	label: string;
	pins: PinRow[];
	onApply: (pins: PinRow[]) => void;
}

const CAPTURE_WINDOW_MS = 1000;
const MARGIN = 10;
const RAW_MAX = 4095;

const rawToVolts = (raw: number) => ((raw * 3.3) / RAW_MAX).toFixed(2);

export function RegInputCalibrationDialog({ open, onClose, deviceId, regInputId, label, pins, onApply }: Props) {
	const { onRegInputCalibrationSample } = useDeviceSocket();
	const startMut = api.regulatorInput.startCalibration.useMutation();
	const stopMut = api.regulatorInput.stopCalibration.useMutation();

	// Steps: implicit OFF (speed 0) followed by each unique speed asc.
	const steps = useMemo(() => {
		const speeds = Array.from(new Set(pins.map((p) => p.speed))).sort((a, b) => a - b);
		return [{ speed: 0, label: "OFF" } as const, ...speeds.map((s) => ({ speed: s, label: `Speed ${s}` }) as const)];
	}, [pins]);

	const [activeIdx, setActiveIdx] = useState(0);
	const [captures, setCaptures] = useState<Record<number, { min: number; max: number }>>({});
	const [offReached, setOffReached] = useState(false);
	const [capturing, setCapturing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Live readings: latest raw value per GPIO pin
	const [liveReadings, setLiveReadings] = useState<Record<number, number>>({});

	// Per-pin sliding sample buffer for capture (last ~3s @ 10 Hz)
	const samplesRef = useRef<Record<number, number[]>>({});
	const recordingRef = useRef(false);
	const recordedRef = useRef<Record<number, number[]>>({});

	const uniquePins = useMemo(() => Array.from(new Set(pins.map((p) => p.pin))), [pins]);

	// Reset state whenever the dialog (re)opens
	useEffect(() => {
		if (!open) return;
		setActiveIdx(0);
		setCaptures({});
		setOffReached(false);
		setCapturing(false);
		setError(null);
		setLiveReadings({});
		samplesRef.current = {};
		recordedRef.current = {};
		recordingRef.current = false;
	}, [open]);

	// Start / stop the firmware stream
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		startMut.mutateAsync({ regulatorInputId: regInputId }).catch((e: { message?: string }) => {
			if (cancelled) return;
			setError(e?.message ?? "Failed to start calibration");
		});
		return () => {
			cancelled = true;
			stopMut.mutate({ regulatorInputId: regInputId });
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, regInputId]);

	// Subscribe to streaming samples
	useEffect(() => {
		if (!open) return;
		return onRegInputCalibrationSample((msg) => {
			if (msg.deviceId !== deviceId || msg.regInputId !== regInputId) return;
			setLiveReadings((prev) => (prev[msg.pin] === msg.raw ? prev : { ...prev, [msg.pin]: msg.raw }));
			const buf = samplesRef.current[msg.pin] ?? [];
			buf.push(msg.raw);
			if (buf.length > 30) buf.shift();
			samplesRef.current[msg.pin] = buf;
			if (recordingRef.current) {
				const rec = recordedRef.current[msg.pin] ?? [];
				rec.push(msg.raw);
				recordedRef.current[msg.pin] = rec;
			}
		});
	}, [open, onRegInputCalibrationSample, deviceId, regInputId]);

	const activeStep = steps[activeIdx];
	const activeRowIndices = useMemo(() => {
		if (!activeStep || activeStep.speed === 0) return [];
		return pins.map((p, i) => (p.speed === activeStep.speed ? i : -1)).filter((i) => i >= 0);
	}, [pins, activeStep]);

	const capture = () => {
		if (!activeStep) return;
		if (activeStep.speed === 0) {
			setOffReached(true);
			if (activeIdx < steps.length - 1) setActiveIdx(activeIdx + 1);
			return;
		}
		setCapturing(true);
		recordedRef.current = {};
		recordingRef.current = true;
		setTimeout(() => {
			recordingRef.current = false;
			setCapturing(false);
			const next = { ...captures };
			for (const idx of activeRowIndices) {
				const row = pins[idx];
				if (!row) continue;
				const samples = recordedRef.current[row.pin] ?? [];
				if (samples.length === 0) continue;
				next[idx] = { min: Math.min(...samples), max: Math.max(...samples) };
			}
			setCaptures(next);
			if (activeIdx < steps.length - 1) setActiveIdx(activeIdx + 1);
		}, CAPTURE_WINDOW_MS);
	};

	const recalibrate = () => {
		setCaptures({});
		setOffReached(false);
		setActiveIdx(0);
	};

	const computedPins = useMemo<PinRow[]>(() => {
		return pins.map((p, i) => {
			const c = captures[i];
			if (!c) return p;
			return {
				...p,
				minRaw: Math.max(0, c.min - MARGIN),
				maxRaw: Math.min(RAW_MAX, c.max + MARGIN),
			};
		});
	}, [pins, captures]);

	// Validation: no two rows on the same GPIO pin may have overlapping windows
	const overlap = useMemo(() => {
		const byPin: Record<number, { idx: number; min: number; max: number }[]> = {};
		computedPins.forEach((p, i) => {
			(byPin[p.pin] ??= []).push({ idx: i, min: p.minRaw, max: p.maxRaw });
		});
		for (const pin of Object.keys(byPin)) {
			const rows = byPin[Number(pin)]!;
			for (let i = 0; i < rows.length; i++) {
				for (let j = i + 1; j < rows.length; j++) {
					const a = rows[i]!;
					const b = rows[j]!;
					if (a.min <= b.max && b.min <= a.max) {
						return { pin: Number(pin), a: a.idx, b: b.idx };
					}
				}
			}
		}
		return null;
	}, [computedPins]);

	const capturedCount = Object.keys(captures).length;
	const hasAnyCapture = capturedCount > 0 || offReached;
	const allCaptured = pins.every((_, i) => captures[i]) && offReached;

	const apply = () => {
		if (overlap) return;
		onApply(computedPins);
		onClose();
	};

	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Auto Calibrate: {label}</DialogTitle>
					<DialogDescription className="text-xs">
						Rotate the regulator to each position and click <span className="font-semibold">Capture</span>. Captured ranges will be written into the form on Apply.
					</DialogDescription>
				</DialogHeader>

				{error ? (
					<div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive flex items-start gap-2">
						<AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
						<span>{error}</span>
					</div>
				) : (
					<div className="space-y-3">
						{/* Live readings */}
						<div className="space-y-1.5">
							<div className="text-[10px] uppercase tracking-wide text-muted-foreground">Live ADC</div>
							{uniquePins.map((pin) => {
								const raw = liveReadings[pin] ?? 0;
								const pct = (raw / RAW_MAX) * 100;
								return (
									<div key={pin} className="space-y-0.5">
										<div className="flex justify-between text-xs mono">
											<span>GPIO {pin}</span>
											<span>
												{raw} <span className="text-muted-foreground">({rawToVolts(raw)} V)</span>
											</span>
										</div>
										<div className="h-1.5 rounded-full bg-muted overflow-hidden">
											<div className="h-full bg-primary transition-[width] duration-75" style={{ width: `${pct}%` }} />
										</div>
									</div>
								);
							})}
							{uniquePins.length === 0 && <div className="text-xs text-muted-foreground italic">No samples yet…</div>}
						</div>

						{/* Step list */}
						<div className="space-y-1">
							<div className="text-[10px] uppercase tracking-wide text-muted-foreground">Steps</div>
							{steps.map((step, i) => {
								const isActive = i === activeIdx;
								const isOff = step.speed === 0;
								const captured = isOff ? offReached : pins.every((p, pi) => p.speed !== step.speed || captures[pi]);
								return (
									<button
										type="button"
										key={i}
										onClick={() => setActiveIdx(i)}
										className={cn(
											"w-full flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
											isActive ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
										)}
									>
										<div className="flex items-center gap-2">
											{captured ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <span className="w-3.5 h-3.5 rounded-full border border-muted-foreground/40" />}
											<span className="font-medium">{step.label}</span>
										</div>
										<span className="mono text-[10px] text-muted-foreground">
											{isOff
												? "no pin in window"
												: pins
														.map((p, pi) => (p.speed === step.speed ? (captures[pi] ? `${captures[pi]!.min}–${captures[pi]!.max}` : `GPIO${p.pin}`) : null))
														.filter(Boolean)
														.join(" · ")}
										</span>
									</button>
								);
							})}
						</div>

						{/* Capture button for active step */}
						<Button onClick={capture} disabled={capturing || !activeStep} className="w-full h-8 text-xs">
							{capturing ? (
								<>
									<Loader2 className="w-3 h-3 mr-1 animate-spin" /> Capturing…
								</>
							) : activeStep?.speed === 0 ? (
								"Mark OFF reached"
							) : (
								`Capture ${activeStep?.label}`
							)}
						</Button>

						{overlap && (
							<div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[11px] text-destructive flex items-start gap-2">
								<AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
								<span>
									Overlapping ranges on GPIO {overlap.pin} (rows {overlap.a + 1} & {overlap.b + 1}). Recalibrate the affected positions before applying.
								</span>
							</div>
						)}
					</div>
				)}

				<DialogFooter className="gap-1.5 sm:gap-1.5">
					<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>
						Cancel
					</Button>
					<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={recalibrate} disabled={!hasAnyCapture}>
						<RotateCcw className="w-3 h-3 mr-1" /> Recalibrate
					</Button>
					<Button size="sm" className="h-7 text-xs" onClick={apply} disabled={!allCaptured || !!overlap}>
						Apply
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
