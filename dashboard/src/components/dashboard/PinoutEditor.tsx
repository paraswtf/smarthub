"use client";

import { useState, useMemo, Fragment } from "react";
import { Lightbulb, Fan, Plug, Wind, Tv, Coffee, Thermometer, Radio, Trash2, Loader2, Zap } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "~/components/ui/dialog";
import { cn } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

// ─── Board definitions ────────────────────────────────────────────────────────

type PinType = "io" | "input-only" | "power" | "gnd" | "special";

interface PinDef {
	id: string;
	gpio: number | null;
	label: string;
	type: PinType;
}

// NodeMCU ESP32 DevKit V1 - 30-pin, USB port at top
const NODEMCU_LEFT: PinDef[] = [
	{ id: "L0", gpio: null, label: "3V3", type: "power" },
	{ id: "L1", gpio: null, label: "GND", type: "gnd" },
	{ id: "L2", gpio: 15, label: "D15", type: "io" },
	{ id: "L3", gpio: 2, label: "D2", type: "io" },
	{ id: "L4", gpio: 4, label: "D4", type: "io" },
	{ id: "L5", gpio: 16, label: "RX2", type: "io" },
	{ id: "L6", gpio: 17, label: "TX2", type: "io" },
	{ id: "L7", gpio: 5, label: "D5", type: "io" },
	{ id: "L8", gpio: 18, label: "D18", type: "io" },
	{ id: "L9", gpio: 19, label: "D19", type: "io" },
	{ id: "L10", gpio: 21, label: "D21", type: "io" },
	{ id: "L11", gpio: 3, label: "RX0", type: "io" },
	{ id: "L12", gpio: 1, label: "TX0", type: "io" },
	{ id: "L13", gpio: 22, label: "D22", type: "io" },
	{ id: "L14", gpio: 23, label: "D23", type: "io" },
];

const NODEMCU_RIGHT: PinDef[] = [
	{ id: "R0", gpio: null, label: "VIN", type: "power" },
	{ id: "R1", gpio: null, label: "GND", type: "gnd" },
	{ id: "R2", gpio: 13, label: "D13", type: "io" },
	{ id: "R3", gpio: 12, label: "D12", type: "io" },
	{ id: "R4", gpio: 14, label: "D14", type: "io" },
	{ id: "R5", gpio: 27, label: "D27", type: "io" },
	{ id: "R6", gpio: 26, label: "D26", type: "io" },
	{ id: "R7", gpio: 25, label: "D25", type: "io" },
	{ id: "R8", gpio: 33, label: "D33", type: "io" },
	{ id: "R9", gpio: 32, label: "D32", type: "io" },
	{ id: "R10", gpio: 35, label: "D35", type: "input-only" },
	{ id: "R11", gpio: 34, label: "D34", type: "input-only" },
	{ id: "R12", gpio: 39, label: "VN", type: "input-only" },
	{ id: "R13", gpio: 36, label: "VP", type: "input-only" },
	{ id: "R14", gpio: null, label: "EN", type: "special" },
];

const BOARDS: Record<string, { name: string; left: PinDef[]; right: PinDef[] }> = {
	nodemcu_esp32_devkit_v1: { name: "NodeMCU ESP32 DevKit V1", left: NODEMCU_LEFT, right: NODEMCU_RIGHT },
};

// ─── Palette ──────────────────────────────────────────────────────────────────

type DragPayload = { kind: "relay"; triggerType: "low" | "high" } | { kind: "switch"; switchType: "two_way" | "three_way" | "momentary" };

interface PaletteEntry {
	payload: DragPayload;
	label: string;
	cls: string;
	border: string;
}

const PALETTE: PaletteEntry[] = [
	{ payload: { kind: "relay", triggerType: "low" }, label: "Relay (Low Trig.)", cls: "text-sky-500 bg-sky-500/10", border: "border-sky-500/40" },
	{ payload: { kind: "relay", triggerType: "high" }, label: "Relay (High Trig.)", cls: "text-orange-500 bg-orange-500/10", border: "border-orange-500/40" },
	{ payload: { kind: "switch", switchType: "two_way" }, label: "Two-way", cls: "text-emerald-500 bg-emerald-500/10", border: "border-emerald-500/40" },
	{ payload: { kind: "switch", switchType: "three_way" }, label: "Three-way", cls: "text-teal-500 bg-teal-500/10", border: "border-teal-500/40" },
	{ payload: { kind: "switch", switchType: "momentary" }, label: "Momentary", cls: "text-violet-500 bg-violet-500/10", border: "border-violet-500/40" },
];

// ─── Icons ────────────────────────────────────────────────────────────────────

const RELAY_ICONS: Record<string, React.ElementType> = {
	lightbulb: Lightbulb,
	fan: Fan,
	plug: Plug,
	wind: Wind,
	tv: Tv,
	coffee: Coffee,
	thermometer: Thermometer,
	radio: Radio,
};

const TwoWayIcon = ({ className }: { className?: string }) => (
	<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
		<circle cx="6" cy="12" r="2" />
		<circle cx="18" cy="7" r="2" />
		<line x1="8" y1="11" x2="16" y2="7.5" />
		<line x1="18" y1="9" x2="18" y2="17" strokeDasharray="2 2" opacity="0.4" />
	</svg>
);
const ThreeWayIcon = ({ className }: { className?: string }) => (
	<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
		<circle cx="6" cy="12" r="2" />
		<circle cx="18" cy="7" r="2" />
		<circle cx="18" cy="17" r="2" />
		<line x1="8" y1="11" x2="16" y2="7.5" />
	</svg>
);
const MomentaryIcon = ({ className }: { className?: string }) => (
	<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
		<line x1="4" y1="17" x2="9" y2="17" />
		<line x1="9" y1="17" x2="9" y2="9" />
		<line x1="9" y1="9" x2="15" y2="9" />
		<line x1="15" y1="9" x2="15" y2="17" />
		<line x1="15" y1="17" x2="20" y2="17" />
	</svg>
);

const SWITCH_ICONS: Record<string, React.ElementType> = {
	two_way: TwoWayIcon,
	three_way: ThreeWayIcon,
	momentary: MomentaryIcon,
};
const SWITCH_LABELS: Record<string, string> = {
	two_way: "Two-way",
	three_way: "Three-way",
	momentary: "Momentary",
};

// ─── Types ────────────────────────────────────────────────────────────────────

type RelayT = RouterOutputs["device"]["get"]["relays"][number];
type SwitchT = RouterOutputs["switch"]["list"][number];
type AllRelayT = RouterOutputs["switch"]["listAllRelays"][number];

interface Assignment {
	relay?: RelayT;
	sw?: SwitchT;
}

type ActiveAction =
	| { mode: "choose"; gpio: number; pinType: PinType }
	| { mode: "add-relay"; gpio: number; triggerType: "low" | "high" }
	| { mode: "add-switch"; gpio: number; initSwitchType: "two_way" | "three_way" | "momentary" }
	| { mode: "edit-relay"; relay: RelayT }
	| { mode: "edit-switch"; sw: SwitchT };

const MAX_RELAYS = 8;

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
	deviceId: string;
	relays: RelayT[];
	switches: SwitchT[];
	allRelays: AllRelayT[];
	isOwner: boolean;
}

export function PinoutEditor({ deviceId, relays, switches, allRelays, isOwner }: Props) {
	const utils = api.useUtils();
	const [boardModel, setBoardModel] = useState("nodemcu_esp32_devkit_v1");
	const board = BOARDS[boardModel]!;

	const [dragging, setDragging] = useState<DragPayload | null>(null);
	const [hoverGpio, setHoverGpio] = useState<number | null>(null);
	const [activeAction, setActiveAction] = useState<ActiveAction | null>(null);

	// Form state
	const [relayLabel, setRelayLabel] = useState("");
	const [relayIcon, setRelayIcon] = useState("plug");
	const [swLabel, setSwLabel] = useState("");
	const [swType, setSwType] = useState<"two_way" | "three_way" | "momentary">("two_way");
	const [swLinkedId, setSwLinkedId] = useState("");

	const pinMap = useMemo(() => {
		const m = new Map<number, Assignment>();
		for (const r of relays) m.set(r.pin, { ...m.get(r.pin), relay: r });
		for (const s of switches) m.set(s.pin, { ...m.get(s.pin), sw: s });
		return m;
	}, [relays, switches]);

	const atMaxRelays = relays.length >= MAX_RELAYS;

	// Mutations
	const addRelayMut = api.device.addRelay.useMutation({
		onSuccess: () => {
			void utils.device.get.invalidate({ id: deviceId });
			void utils.switch.listAllRelays.invalidate();
			void utils.room.unassignedRelays.invalidate();
			setActiveAction(null);
		},
	});
	const updateRelayMut = api.device.updateRelay.useMutation({
		onSuccess: () => {
			void utils.device.get.invalidate({ id: deviceId });
			setActiveAction(null);
		},
	});
	const deleteRelayMut = api.device.deleteRelay.useMutation({
		onSuccess: () => {
			void utils.device.get.invalidate({ id: deviceId });
			void utils.switch.listAllRelays.invalidate();
			void utils.room.unassignedRelays.invalidate();
			setActiveAction(null);
		},
	});
	const addSwMut = api.switch.add.useMutation({
		onSuccess: () => {
			void utils.switch.list.invalidate({ deviceId });
			setActiveAction(null);
		},
	});
	const updateSwMut = api.switch.update.useMutation({
		onSuccess: () => {
			void utils.switch.list.invalidate({ deviceId });
			setActiveAction(null);
		},
	});
	const deleteSwMut = api.switch.delete.useMutation({
		onSuccess: () => {
			void utils.switch.list.invalidate({ deviceId });
			setActiveAction(null);
		},
	});

	const isPending = addRelayMut.isPending || updateRelayMut.isPending || deleteRelayMut.isPending || addSwMut.isPending || updateSwMut.isPending || deleteSwMut.isPending;

	const canAccept = (pin: PinDef, payload: DragPayload): boolean => {
		if (!pin.gpio) return false;
		if (pin.type === "power" || pin.type === "gnd" || pin.type === "special") return false;
		if (pinMap.has(pin.gpio)) return false;
		if (payload.kind === "relay" && (pin.type === "input-only" || atMaxRelays)) return false;
		return true;
	};

	const handleDrop = (pin: PinDef, payload: DragPayload) => {
		if (!canAccept(pin, payload)) return;
		const gpio = pin.gpio!;
		if (payload.kind === "relay") {
			setRelayLabel("");
			setRelayIcon("plug");
			setActiveAction({ mode: "add-relay", gpio, triggerType: payload.triggerType });
		} else {
			setSwLabel("");
			setSwType(payload.switchType);
			setSwLinkedId("");
			setActiveAction({ mode: "add-switch", gpio, initSwitchType: payload.switchType });
		}
	};

	const handlePinClick = (pin: PinDef) => {
		if (!pin.gpio) return;
		const a = pinMap.get(pin.gpio);
		if (a?.relay) {
			setRelayLabel(a.relay.label);
			setRelayIcon(a.relay.icon);
			setActiveAction({ mode: "edit-relay", relay: a.relay });
		} else if (a?.sw) {
			setSwLabel(a.sw.label);
			setSwType(a.sw.switchType as "two_way" | "three_way" | "momentary");
			setSwLinkedId(a.sw.linkedRelayId);
			setActiveAction({ mode: "edit-switch", sw: a.sw });
		} else if (isOwner && pin.type !== "power" && pin.type !== "gnd" && pin.type !== "special") {
			setActiveAction({ mode: "choose", gpio: pin.gpio, pinType: pin.type });
		}
	};

	const wireColor = (a: Assignment | null | undefined) => {
		if (a?.relay) return "hsl(var(--primary))";
		if (a?.sw) return "rgb(245 158 11)";
		return "transparent";
	};

	const dotCls = (pin: PinDef, a: Assignment | null | undefined) => {
		if (a?.relay) return "bg-primary ring-1 ring-primary/30";
		if (a?.sw) return "bg-amber-500 ring-1 ring-amber-500/30";
		if (pin.type === "power") return "bg-red-500";
		if (pin.type === "gnd") return "bg-neutral-500";
		if (pin.type === "special") return "bg-yellow-500";
		if (pin.type === "input-only") return "bg-emerald-500/50";
		return "bg-muted-foreground/20";
	};

	return (
		<div className="space-y-4">
			{/* Board selector */}
			<div className="flex items-center gap-2">
				<Label className="text-xs text-muted-foreground shrink-0">Board model</Label>
				<select
					value={boardModel}
					onChange={(e) => setBoardModel(e.target.value)}
					className="text-sm rounded-md border border-input bg-background px-2 h-8 focus:outline-none focus:ring-2 focus:ring-ring"
				>
					{Object.entries(BOARDS).map(([key, b]) => (
						<option key={key} value={key}>
							{b.name}
						</option>
					))}
				</select>
			</div>

			{/* Palette */}
			{isOwner && (
				<div className="space-y-1.5">
					<p className="text-[11px] text-muted-foreground">Drag a component onto a GPIO pin to wire it, or click any pin directly:</p>
					<div className="flex flex-wrap gap-1.5">
						{PALETTE.map((entry, idx) => {
							const isRelay = entry.payload.kind === "relay";
							const SwIcon = !isRelay && entry.payload.kind === "switch" ? SWITCH_ICONS[entry.payload.switchType] : null;
							const disabled = isRelay && atMaxRelays;
							return (
								<div
									key={idx}
									draggable={!disabled}
									onDragStart={(e) => {
										e.dataTransfer.effectAllowed = "copy";
										setDragging(entry.payload);
									}}
									onDragEnd={() => {
										setDragging(null);
										setHoverGpio(null);
									}}
									title={disabled ? "Maximum relays reached (8)" : undefined}
									className={cn(
										"flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium select-none",
										entry.cls,
										entry.border,
										disabled ? "opacity-40 cursor-not-allowed" : "cursor-grab active:cursor-grabbing",
									)}
								>
									{isRelay ? <Zap className="w-3 h-3" /> : SwIcon ? <SwIcon className="w-3 h-3" /> : null}
									{entry.label}
								</div>
							);
						})}
					</div>
				</div>
			)}

			{/* Board visualization */}
			<div className="overflow-x-auto pb-1">
				<div style={{ display: "inline-block" }}>
					{/* USB connector above board */}
					<div style={{ paddingLeft: "184px" }} className="mb-px">
						<div className="w-20 flex justify-center">
							<div className="w-10 h-3 bg-muted/60 rounded-t-sm border-x border-t border-border/60 flex items-center justify-center">
								<span className="text-[7px] text-muted-foreground font-mono leading-none">USB</span>
							</div>
						</div>
					</div>

					{/* Pin rows: [left-card][left-wire][left-dot][PCB][right-dot][right-wire][right-card] */}
					<div style={{ display: "grid", gridTemplateColumns: "140px 20px 24px 80px 24px 20px 140px" }}>
						{board.left.map((lp, row) => {
							const rp = board.right[row];
							if (!rp) return null;

							const la = lp.gpio !== null ? pinMap.get(lp.gpio) : null;
							const ra = rp.gpio !== null ? pinMap.get(rp.gpio) : null;
							const lDrop = dragging !== null ? canAccept(lp, dragging) : false;
							const rDrop = dragging !== null ? canAccept(rp, dragging) : false;
							const lHov = lp.gpio !== null && hoverGpio === lp.gpio;
							const rHov = rp.gpio !== null && hoverGpio === rp.gpio;

							const pcbCls = cn(
								"bg-[#0a3320] border-x border-green-900/80 h-8 flex items-center justify-between px-1.5 relative",
								row === 0 && "rounded-t-sm border-t",
								row === board.left.length - 1 && "rounded-b-sm border-b",
							);

							return (
								<Fragment key={row}>
									{/* Col 1 - left card */}
									<div className="flex items-center justify-end pr-1 h-8">
										{la?.relay && <RelayCard relay={la.relay} flip onClick={() => handlePinClick(lp)} />}
										{la?.sw && <SwitchCard sw={la.sw} allRelays={allRelays} flip onClick={() => handlePinClick(lp)} />}
									</div>

									{/* Col 2 - left wire */}
									<div className="flex items-center h-8">
										<div
											className="w-full transition-all"
											style={{
												height: la ? "2px" : "1px",
												background: la ? wireColor(la) : lHov && lDrop ? "hsl(var(--muted-foreground))" : "transparent",
											}}
										/>
									</div>

									{/* Col 3 - left pin */}
									<div
										className={cn("flex items-center justify-end h-8 pr-1", lp.gpio !== null && (!!la || isOwner) && "cursor-pointer")}
										onDragOver={(e) => {
											if (lDrop) {
												e.preventDefault();
												setHoverGpio(lp.gpio);
											}
										}}
										onDragLeave={() => {
											if (hoverGpio === lp.gpio) setHoverGpio(null);
										}}
										onDrop={(e) => {
											e.preventDefault();
											if (dragging) handleDrop(lp, dragging);
										}}
										onClick={() => handlePinClick(lp)}
									>
										<div
											className={cn(
												"rounded-full transition-all duration-100",
												la ? "w-3 h-3" : "w-2.5 h-2.5",
												dotCls(lp, la),
												lDrop && "ring-2 ring-primary/50",
												lHov && lDrop && "scale-150",
											)}
										/>
									</div>

									{/* Col 4 - PCB body */}
									<div className={pcbCls}>
										<span className="text-[9px] font-mono text-green-400/90">{lp.label}</span>
										{row === 7 && <span className="absolute left-1/2 -translate-x-1/2 text-[7px] text-green-700 font-bold tracking-widest pointer-events-none">ESP32</span>}
										<span className="text-[9px] font-mono text-green-400/90">{rp.label}</span>
									</div>

									{/* Col 5 - right pin */}
									<div
										className={cn("flex items-center justify-start h-8 pl-1", rp.gpio !== null && (!!ra || isOwner) && "cursor-pointer")}
										onDragOver={(e) => {
											if (rDrop) {
												e.preventDefault();
												setHoverGpio(rp.gpio);
											}
										}}
										onDragLeave={() => {
											if (hoverGpio === rp.gpio) setHoverGpio(null);
										}}
										onDrop={(e) => {
											e.preventDefault();
											if (dragging) handleDrop(rp, dragging);
										}}
										onClick={() => handlePinClick(rp)}
									>
										<div
											className={cn(
												"rounded-full transition-all duration-100",
												ra ? "w-3 h-3" : "w-2.5 h-2.5",
												dotCls(rp, ra),
												rDrop && "ring-2 ring-primary/50",
												rHov && rDrop && "scale-150",
											)}
										/>
									</div>

									{/* Col 6 - right wire */}
									<div className="flex items-center h-8">
										<div
											className="w-full transition-all"
											style={{
												height: ra ? "2px" : "1px",
												background: ra ? wireColor(ra) : rHov && rDrop ? "hsl(var(--muted-foreground))" : "transparent",
											}}
										/>
									</div>

									{/* Col 7 - right card */}
									<div className="flex items-center justify-start pl-1 h-8">
										{ra?.relay && <RelayCard relay={ra.relay} onClick={() => handlePinClick(rp)} />}
										{ra?.sw && <SwitchCard sw={ra.sw} allRelays={allRelays} onClick={() => handlePinClick(rp)} />}
									</div>
								</Fragment>
							);
						})}
					</div>
				</div>
			</div>

			{/* Legend */}
			<div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
				{(
					[
						{ cls: "bg-muted-foreground/20", label: "I/O pin" },
						{ cls: "bg-emerald-500/50", label: "Input-only (ideal for switches)" },
						{ cls: "bg-primary", label: "Relay assigned" },
						{ cls: "bg-amber-500", label: "Switch assigned" },
						{ cls: "bg-red-500", label: "Power" },
						{ cls: "bg-neutral-500", label: "GND" },
					] as const
				).map(({ cls, label }) => (
					<span key={label} className="flex items-center gap-1">
						<span className={cn("w-2 h-2 rounded-full inline-block", cls)} />
						{label}
					</span>
				))}
			</div>

			{/* Config dialog */}
			<Dialog open={!!activeAction} onOpenChange={(open) => !open && setActiveAction(null)}>
				<DialogContent className="max-w-sm">
					{/* ── Choose relay or switch ── */}
					{activeAction?.mode === "choose" && (
						<>
							<DialogHeader>
								<DialogTitle>GPIO {activeAction.gpio}</DialogTitle>
								<DialogDescription>
									{activeAction.pinType === "input-only" ? "Input-only - ideal for switches, cannot drive a relay output." : "General I/O - can drive a relay or read a switch."}
								</DialogDescription>
							</DialogHeader>
							<div className={cn("grid gap-2 pt-1", activeAction.pinType !== "input-only" && !atMaxRelays ? "grid-cols-2" : "grid-cols-1")}>
								{activeAction.pinType !== "input-only" && !atMaxRelays && (
									<button
										onClick={() => {
											setRelayLabel("");
											setRelayIcon("plug");
											setActiveAction({ mode: "add-relay", gpio: activeAction.gpio, triggerType: "low" });
										}}
										className="flex flex-col items-center gap-2 rounded-xl border-2 border-primary/30 bg-primary/5 text-primary p-4 hover:bg-primary/10 transition-colors"
									>
										<Zap className="w-5 h-5" />
										<span className="text-xs font-semibold">Relay Module</span>
									</button>
								)}
								<button
									onClick={() => {
										setSwLabel("");
										setSwType("two_way");
										setSwLinkedId("");
										setActiveAction({ mode: "add-switch", gpio: activeAction.gpio, initSwitchType: "two_way" });
									}}
									className="flex flex-col items-center gap-2 rounded-xl border-2 border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400 p-4 hover:bg-amber-500/10 transition-colors"
								>
									<TwoWayIcon className="w-5 h-5" />
									<span className="text-xs font-semibold">Switch / Button</span>
								</button>
							</div>
						</>
					)}

					{/* ── Add / Edit Relay ── */}
					{(activeAction?.mode === "add-relay" || activeAction?.mode === "edit-relay") && (
						<>
							<DialogHeader>
								<DialogTitle>{activeAction.mode === "add-relay" ? "Add Relay" : "Edit Relay"}</DialogTitle>
								<DialogDescription>GPIO {activeAction.mode === "add-relay" ? activeAction.gpio : activeAction.relay.pin}</DialogDescription>
							</DialogHeader>
							<div className="space-y-3 py-1">
								<div>
									<Label className="text-xs">Label</Label>
									<Input value={relayLabel} onChange={(e) => setRelayLabel(e.target.value)} placeholder="e.g. Living Room Light" className="mt-1 h-8 text-sm" autoFocus />
								</div>
								<div>
									<Label className="text-xs">Icon</Label>
									<select
										value={relayIcon}
										onChange={(e) => setRelayIcon(e.target.value)}
										className="mt-1 h-8 w-full text-sm rounded-md border border-input bg-background px-2 focus:outline-none focus:ring-2 focus:ring-ring"
									>
										{Object.keys(RELAY_ICONS).map((o) => (
											<option key={o} value={o}>
												{o}
											</option>
										))}
									</select>
								</div>
							</div>
							<DialogFooter className="gap-2 sm:gap-0">
								{activeAction.mode === "edit-relay" && (
									<Button
										variant="ghost"
										size="sm"
										className="text-destructive hover:text-destructive sm:mr-auto"
										onClick={() => {
											if (activeAction.mode === "edit-relay") deleteRelayMut.mutate({ relayId: activeAction.relay.id });
										}}
										disabled={isPending}
									>
										{deleteRelayMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
									</Button>
								)}
								<Button variant="outline" size="sm" onClick={() => setActiveAction(null)}>
									Cancel
								</Button>
								<Button
									size="sm"
									onClick={() => {
										if (activeAction.mode === "add-relay") addRelayMut.mutate({ deviceId, pin: activeAction.gpio, label: relayLabel, icon: relayIcon });
										else if (activeAction.mode === "edit-relay") updateRelayMut.mutate({ relayId: activeAction.relay.id, label: relayLabel, icon: relayIcon });
									}}
									disabled={isPending || !relayLabel.trim()}
								>
									{addRelayMut.isPending || updateRelayMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
								</Button>
							</DialogFooter>
						</>
					)}

					{/* ── Add / Edit Switch ── */}
					{(activeAction?.mode === "add-switch" || activeAction?.mode === "edit-switch") && (
						<>
							<DialogHeader>
								<DialogTitle>{activeAction.mode === "add-switch" ? "Add Switch" : "Edit Switch"}</DialogTitle>
								<DialogDescription>GPIO {activeAction.mode === "add-switch" ? activeAction.gpio : activeAction.sw.pin}</DialogDescription>
							</DialogHeader>
							<div className="space-y-3 py-1">
								<div>
									<Label className="text-xs">Label</Label>
									<Input value={swLabel} onChange={(e) => setSwLabel(e.target.value)} placeholder="e.g. Wall Switch" className="mt-1 h-8 text-sm" autoFocus />
								</div>
								<div>
									<Label className="text-xs">Switch Type</Label>
									<div className="flex gap-1 mt-1">
										{(["two_way", "three_way", "momentary"] as const).map((st) => {
											const Icon = SWITCH_ICONS[st];
											return (
												<button
													key={st}
													type="button"
													onClick={() => setSwType(st)}
													className={cn(
														"flex-1 flex flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 text-[10px] transition-colors",
														swType === st ? "border-primary bg-primary/10 text-primary" : "border-input bg-background text-muted-foreground hover:border-primary/40",
													)}
												>
													{Icon && <Icon className="w-4 h-4" />}
													<span className="font-medium">{SWITCH_LABELS[st]}</span>
												</button>
											);
										})}
									</div>
								</div>
								<div>
									<Label className="text-xs">Linked Relay</Label>
									<select value={swLinkedId} onChange={(e) => setSwLinkedId(e.target.value)} className="mt-1 h-8 w-full text-sm rounded-md border border-input bg-background px-2">
										<option value="">- select relay -</option>
										{allRelays.map((r) => (
											<option key={r.id} value={r.id}>
												{r.deviceName} - {r.label} (GPIO {r.pin})
											</option>
										))}
									</select>
								</div>
							</div>
							<DialogFooter className="gap-2 sm:gap-0">
								{activeAction.mode === "edit-switch" && (
									<Button
										variant="ghost"
										size="sm"
										className="text-destructive hover:text-destructive sm:mr-auto"
										onClick={() => {
											if (activeAction.mode === "edit-switch") deleteSwMut.mutate({ switchId: activeAction.sw.id });
										}}
										disabled={isPending}
									>
										{deleteSwMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
									</Button>
								)}
								<Button variant="outline" size="sm" onClick={() => setActiveAction(null)}>
									Cancel
								</Button>
								<Button
									size="sm"
									onClick={() => {
										if (activeAction.mode === "add-switch") addSwMut.mutate({ deviceId, pin: activeAction.gpio, label: swLabel, switchType: swType, linkedRelayId: swLinkedId });
										else if (activeAction.mode === "edit-switch")
											updateSwMut.mutate({ switchId: activeAction.sw.id, label: swLabel, switchType: swType, linkedRelayId: swLinkedId });
									}}
									disabled={isPending || !swLabel.trim() || !swLinkedId}
								>
									{addSwMut.isPending || updateSwMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
								</Button>
							</DialogFooter>
						</>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}

// ─── Pin cards ────────────────────────────────────────────────────────────────

function RelayCard({ relay, flip = false, onClick }: { relay: RelayT; flip?: boolean; onClick: () => void }) {
	const Icon = RELAY_ICONS[relay.icon] ?? Plug;
	return (
		<button
			onClick={onClick}
			className={cn(
				"flex items-center gap-1 rounded border border-primary/30 bg-primary/5 text-primary px-1.5 py-0.5 text-[11px] hover:bg-primary/10 transition-colors w-full max-w-[132px]",
				flip && "flex-row-reverse",
			)}
		>
			<Icon className="w-3 h-3 shrink-0" />
			<span className="truncate font-medium">{relay.label}</span>
		</button>
	);
}

function SwitchCard({ sw, allRelays, flip = false, onClick }: { sw: SwitchT; allRelays: AllRelayT[]; flip?: boolean; onClick: () => void }) {
	const Icon = SWITCH_ICONS[sw.switchType] ?? TwoWayIcon;
	const linked = allRelays.find((r) => r.id === sw.linkedRelayId);
	return (
		<button
			onClick={onClick}
			className={cn(
				"flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 text-[11px] hover:bg-amber-500/10 transition-colors w-full max-w-[132px]",
				flip && "flex-row-reverse",
			)}
		>
			<Icon className="w-3 h-3 shrink-0" />
			<div className={cn("min-w-0", flip ? "text-right" : "text-left")}>
				<div className="truncate font-medium leading-tight">{sw.label}</div>
				{linked && <div className="truncate text-[9px] opacity-60 leading-tight">→ {linked.label}</div>}
			</div>
		</button>
	);
}
