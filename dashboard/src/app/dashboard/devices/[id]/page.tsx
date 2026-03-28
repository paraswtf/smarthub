"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Trash2, Plus, Save, X, Loader2, Lightbulb, Fan, Plug, Wind, Tv, Coffee, Thermometer, Radio, Wifi, WifiOff, ServerCrash, CheckCircle2, AlertCircle } from "lucide-react";
import { api, type RouterOutputs } from "~/trpc/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";
import { Switch } from "~/components/ui/switch";
import { Skeleton } from "~/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "~/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import { cn } from "~/lib/utils";
import { useDeviceSocket } from "~/providers/DeviceSocketProvider";
import { appConfig } from "../../../../../globals.config";

const RELAY_ICONS: Record<string, React.ElementType> = {
	lightbulb: Lightbulb,
	fan: Fan,
	plug: Plug,
	wind: Wind,
	tv: Tv,
	coffee: Coffee,
	thermometer: Thermometer,
	radio: Radio
};

type SwitchTypeValue = "two_way" | "three_way" | "momentary";

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

const SWITCH_TYPES: { value: SwitchTypeValue; label: string; desc: string; icon: React.ReactNode }[] = [
	{ value: "two_way", label: "Two-way", desc: "Toggle switch (VCC \u2194 floating)", icon: <TwoWayIcon className="w-5 h-5" /> },
	{ value: "three_way", label: "Three-way", desc: "SPDT switch (VCC \u2194 GND)", icon: <ThreeWayIcon className="w-5 h-5" /> },
	{ value: "momentary", label: "Momentary", desc: "Push button (press to toggle)", icon: <MomentaryIcon className="w-5 h-5" /> }
];

const ICON_OPTIONS = Object.keys(RELAY_ICONS);

export default function DeviceDetailPage() {
	const { id } = useParams<{ id: string }>();
	const router = useRouter();
	const utils = api.useUtils();
	const utilsRef = useRef(utils);
	utilsRef.current = utils;

	// Data
	const { data: device, isLoading } = api.device.get.useQuery(
		{ id },
		{
			refetchInterval: 30_000 // fallback poll — WS handles real-time
		}
	);

	const { onDeviceUpdate, onRelayUpdate } = useDeviceSocket();

	// Online status — determined by on-demand ping, not DB field
	const [isOnline, setIsOnline] = useState<boolean | null>(null); // null = checking
	const pingDevice = api.device.pingDevice.useMutation();

	// Ping device on load to determine online status
	useEffect(() => {
		if (!device) return;
		setIsOnline(null);
		pingDevice.mutateAsync({ deviceId: id }).then(
			(r) => setIsOnline(r.online),
			() => setIsOnline(false)
		);
	}, [device?.id]); // eslint-disable-line react-hooks/exhaustive-deps

	// device_update from WS = device just authenticated → it's online
	useEffect(() => {
		return onDeviceUpdate(() => {
			setIsOnline(true);
			void utilsRef.current.device.get.invalidate({ id });
		});
	}, [onDeviceUpdate, id]); // eslint-disable-line react-hooks/exhaustive-deps

	type DeviceGetOutput = RouterOutputs["device"]["get"];
	type SwitchItem = RouterOutputs["switch"]["list"][number];
	type AllRelayItem = RouterOutputs["switch"]["listAllRelays"][number];

	useEffect(() => {
		return onRelayUpdate((update) => {
			utilsRef.current.device.get.setData({ id }, (old: DeviceGetOutput | undefined) => {
				if (!old) return old;
				return {
					...old,
					relays: old.relays.map((r: DeviceGetOutput["relays"][number]) => (r.id === update.relayId ? { ...r, state: update.state } : r))
				};
			});
			setRelayStatus((s) => {
				// Only show "confirmed" if this client initiated the toggle
				if (s[update.relayId] !== "pending") return s;
				setTimeout(() => clearRelayStatus(update.relayId), 1500);
				return { ...s, [update.relayId]: "confirmed" };
			});
		});
	}, [onRelayUpdate, id]); // eslint-disable-line react-hooks/exhaustive-deps

	// Device edit state
	const [editingDevice, setEditingDevice] = useState(false);
	const [deviceName, setDeviceName] = useState("");
	const [deviceNotes, setDeviceNotes] = useState("");

	// Add relay state
	const [addingRelay, setAddingRelay] = useState(false);
	const [newRelay, setNewRelay] = useState({ pin: 2, label: "", icon: "plug" });

	// Edit relay state
	const [editingRelayId, setEditingRelayId] = useState<string | null>(null);
	const [editRelay, setEditRelay] = useState({ label: "", icon: "plug", pin: 2 });

	// Per-relay confirmation state: null | "pending" | "confirmed" | "timeout"
	const [relayStatus, setRelayStatus] = useState<Record<string, "pending" | "confirmed" | "timeout">>({});
	const pendingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

	const setRelayPending = (relayId: string) => {
		if (pendingTimers.current[relayId]) clearTimeout(pendingTimers.current[relayId]);
		setRelayStatus((s) => ({ ...s, [relayId]: "pending" }));

		pendingTimers.current[relayId] = setTimeout(() => {
			setRelayStatus((s) => {
				if (s[relayId] === "pending") return { ...s, [relayId]: "timeout" };
				return s;
			});
			// Rollback optimistic update — fetch real DB state (which wasn't changed)
			void utils.device.get.invalidate({ id });
		}, 5000);
	};

	const clearRelayStatus = (relayId: string) => {
		if (pendingTimers.current[relayId]) {
			clearTimeout(pendingTimers.current[relayId]);
			delete pendingTimers.current[relayId];
		}
		setRelayStatus((s) => {
			const next = { ...s };
			delete next[relayId];
			return next;
		});
	};

	// Mutations
	const updateDevice = api.device.update.useMutation({
		onSuccess: () => {
			void utils.device.get.invalidate({ id });
			void utils.device.list.invalidate();
			if (device?.homeId) void utils.home.get.invalidate({ id: device.homeId });
			setEditingDevice(false);
		}
	});
	const deleteDevice = api.device.delete.useMutation({
		onSuccess: () => {
			void utils.device.list.invalidate();
			void utils.home.get.invalidate();
			void utils.home.list.invalidate();
			void utils.home.unassignedDevices.invalidate();
			void utils.room.get.invalidate();
			void utils.room.unassignedRelays.invalidate();
			void utils.switch.listAllRelays.invalidate();
			router.push("/dashboard/devices");
		}
	});

	// Optimistic relay toggle — update UI immediately, roll back on error
	const toggleRelay = api.device.toggleRelay.useMutation({
		onMutate: async ({ relayId, state }) => {
			await utils.device.get.cancel({ id });
			const prev = utils.device.get.getData({ id });
			utils.device.get.setData({ id }, (old: DeviceGetOutput | undefined) => {
				if (!old) return old;
				return {
					...old,
					relays: old.relays.map((r: DeviceGetOutput["relays"][number]) => (r.id === relayId ? { ...r, state } : r))
				};
			});
			return { prev };
		},
		onError: (_err, _vars, ctx) => {
			if (ctx?.prev) utilsRef.current.device.get.setData({ id }, ctx.prev);
			clearRelayStatus(_vars.relayId);
		},
		onSuccess: (result, { relayId, state }) => {
			if (result.state === state) {
				// DB was updated directly (device offline or WS push failed)
				// Confirm immediately — no relay_ack expected
				setRelayStatus((s) => ({ ...s, [relayId]: "confirmed" }));
				setTimeout(() => clearRelayStatus(relayId), 1500);
			} else {
				// Command was pushed to ESP32 — wait for relay_ack via WS
				setRelayPending(relayId);
			}
		}
	});

	const addRelay = api.device.addRelay.useMutation({
		onSuccess: () => {
			void utils.device.get.invalidate({ id });
			void utils.switch.listAllRelays.invalidate();
			void utils.room.unassignedRelays.invalidate();
			setAddingRelay(false);
			setNewRelay({ pin: 2, label: "", icon: "plug" });
		}
	});
	const updateRelay = api.device.updateRelay.useMutation({
		onSuccess: () => {
			void utils.device.get.invalidate({ id });
			void utils.switch.listAllRelays.invalidate();
			void utils.room.get.invalidate();
			setEditingRelayId(null);
		}
	});
	const deleteRelay = api.device.deleteRelay.useMutation({
		onSuccess: () => {
			void utils.device.get.invalidate({ id });
			void utils.switch.listAllRelays.invalidate();
			void utils.room.get.invalidate();
			void utils.room.unassignedRelays.invalidate();
			setDeleteRelayId(null);
		}
	});

	// ── Switch state & mutations ────────────────────────────
	const { data: switchList = [] } = api.switch.list.useQuery({ deviceId: id });
	const { data: allRelays = [] } = api.switch.listAllRelays.useQuery();
	const [addingSwitch, setAddingSwitch] = useState(false);
	const [newSwitch, setNewSwitch] = useState({ pin: 36, label: "Switch", switchType: "two_way" as "two_way" | "three_way" | "momentary", linkedRelayId: "" });
	const [editingSwitchId, setEditingSwitchId] = useState<string | null>(null);
	const [editSwitch, setEditSwitch] = useState({ pin: 36, label: "Switch", switchType: "two_way" as "two_way" | "three_way" | "momentary", linkedRelayId: "" });

	const addSwitch = api.switch.add.useMutation({
		onSuccess: () => {
			void utils.device.get.invalidate({ id });
			void utils.switch.list.invalidate({ deviceId: id });
			setAddingSwitch(false);
			setNewSwitch({ pin: 36, label: "Switch", switchType: "two_way", linkedRelayId: "" });
		}
	});
	const updateSwitch = api.switch.update.useMutation({
		onSuccess: () => {
			void utils.device.get.invalidate({ id });
			void utils.switch.list.invalidate({ deviceId: id });
			setEditingSwitchId(null);
		}
	});
	const deleteSwitch = api.switch.delete.useMutation({
		onSuccess: () => {
			void utils.device.get.invalidate({ id });
			void utils.switch.list.invalidate({ deviceId: id });
		}
	});

	// Delete confirm
	const [deleteDeviceOpen, setDeleteDeviceOpen] = useState(false);
	const [deleteRelayId, setDeleteRelayId] = useState<string | null>(null);


	if (isLoading)
		return (
			<div className="p-6 lg:p-8 space-y-6 mt-14 lg:mt-0">
				<Skeleton className="h-8 w-1/3" />
				<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
					{Array.from({ length: 4 }).map((_, i) => (
						<Skeleton
							key={i}
							className="h-24 rounded-xl"
						/>
					))}
				</div>
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{Array.from({ length: 4 }).map((_, i) => (
						<Skeleton
							key={i}
							className="h-36 rounded-xl"
						/>
					))}
				</div>
			</div>
		);

	if (!device)
		return (
			<div className="p-6 lg:p-8 text-center pt-20 mt-14 lg:mt-0">
				<ServerCrash className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
				<h2 className="font-sora font-bold text-xl text-foreground">Device not found</h2>
				<Button
					variant="outline"
					className="mt-4"
					onClick={() => router.back()}
				>
					Go back
				</Button>
			</div>
		);

	const isOwner = device.accessLevel === "owner";

	const startEditDevice = () => {
		setDeviceName(device.name);
		setDeviceNotes(device.notes ?? "");
		setEditingDevice(true);
	};

	const startEditRelay = (relay: (typeof device.relays)[0]) => {
		setEditRelay({ label: relay.label, icon: relay.icon, pin: relay.pin });
		setEditingRelayId(relay.id);
	};

	return (
		<div className="p-6 lg:p-8 space-y-6 animate-fade-in mt-14 lg:mt-0">
			{/* Breadcrumb + Header */}
			<div>
				<button
					onClick={() => router.back()}
					className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
				>
					<ArrowLeft className="w-3.5 h-3.5" /> Back
				</button>

				{editingDevice ? (
					<div className="flex flex-col sm:flex-row gap-3 items-start">
						<div className="flex-1 space-y-2">
							<Input
								value={deviceName}
								onChange={(e) => setDeviceName(e.target.value)}
								className="font-sora font-bold text-xl h-12 text-foreground"
								placeholder="Device name"
							/>
							<Input
								value={deviceNotes}
								onChange={(e) => setDeviceNotes(e.target.value)}
								placeholder="Notes (optional)"
							/>
						</div>
						<div className="flex gap-2">
							<Button
								onClick={() => updateDevice.mutate({ id, name: deviceName, notes: deviceNotes })}
								disabled={updateDevice.isPending || !deviceName}
							>
								{updateDevice.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
								Save
							</Button>
							<Button
								variant="ghost"
								onClick={() => setEditingDevice(false)}
							>
								<X className="w-4 h-4" /> Cancel
							</Button>
						</div>
					</div>
				) : (
					<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
						<div>
							<div className="flex items-center gap-3 flex-wrap">
								<h1 className="font-sora font-extrabold text-2xl lg:text-3xl text-foreground">{device.name}</h1>
								{!isOwner && <Badge variant="outline">Shared</Badge>}
								<Badge variant={isOnline ? "online" : "offline"}>{isOnline === null ? "Pinging…" : isOnline ? "Online" : "Offline"}</Badge>
							</div>
							<p className="text-sm text-muted-foreground mono mt-1 break-all">{device.macAddress}</p>
							{device.notes && <p className="text-sm text-muted-foreground mt-1">{device.notes}</p>}
						</div>
						{isOwner && (
							<div className="flex gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={startEditDevice}
								>
									<Pencil className="w-3.5 h-3.5" /> Edit
								</Button>
								<Button
									variant="outline"
									size="sm"
									className="text-destructive hover:text-destructive"
									onClick={() => setDeleteDeviceOpen(true)}
								>
									<Trash2 className="w-3.5 h-3.5" /> Delete
								</Button>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Info cards */}
			<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
				{[
					{ label: "Status", value: isOnline === null ? "Pinging…" : isOnline ? "Online" : "Offline", icon: isOnline ? Wifi : WifiOff, colored: !!isOnline },
					{ label: "Firmware", value: device.firmwareVersion ?? "Unknown", icon: Radio, colored: false },
					{ label: "Network", value: device.ssid ?? "Unknown", icon: Wifi, colored: false }
				].map(({ label, value, icon: Icon, colored }) => (
					<Card key={label}>
						<CardContent className="p-4 overflow-hidden">
							<Icon className={cn("w-4 h-4 mb-2", colored ? "text-primary" : "text-muted-foreground")} />
							<p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">{label}</p>
							<p className={cn("text-sm font-semibold mt-0.5 truncate", colored ? "text-primary" : "text-foreground")}>{value}</p>
						</CardContent>
					</Card>
				))}
			</div>

			{/* Tabs: Relays + Switches + Config */}
			<Tabs defaultValue="relays">
				<TabsList className="w-full">
					<TabsTrigger value="relays">
						Relays ({device.relays.length}/{appConfig.maxRelaysPerDevice})
					</TabsTrigger>
					<TabsTrigger value="switches">Switches ({switchList.length})</TabsTrigger>
					<TabsTrigger value="config">Device Config</TabsTrigger>
				</TabsList>

				{/* RELAYS TAB */}
				<TabsContent
					value="relays"
					className="mt-4"
				>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
						{device.relays.map((relay: DeviceGetOutput["relays"][number]) => {
							const IconComp = RELAY_ICONS[relay.icon] ?? Plug;
							const isEditing = editingRelayId === relay.id;

							return (
								<div
									key={relay.id}
									className={cn("relay-card p-4", relay.state && "active")}
								>
									{isEditing ? (
										<div className="space-y-2.5">
											<Input
												value={editRelay.label}
												onChange={(e) => setEditRelay((r) => ({ ...r, label: e.target.value }))}
												placeholder="Label"
												className="h-8 text-sm"
											/>
											<div className="flex gap-2">
												<div className="flex-1">
													<Label className="text-[10px]">GPIO Pin</Label>
													<Input
														type="number"
														value={editRelay.pin}
														onChange={(e) => setEditRelay((r) => ({ ...r, pin: Number(e.target.value) }))}
														className="h-8 text-sm mt-0.5"
														min={0}
														max={39}
													/>
												</div>
												<div className="flex-1">
													<Label className="text-[10px]">Icon</Label>
													<select
														value={editRelay.icon}
														onChange={(e) => setEditRelay((r) => ({ ...r, icon: e.target.value }))}
														className="h-8 w-full mt-0.5 text-sm rounded-md border border-input bg-background px-2 focus:outline-none focus:ring-2 focus:ring-ring"
													>
														{ICON_OPTIONS.map((o) => (
															<option
																key={o}
																value={o}
															>
																{o}
															</option>
														))}
													</select>
												</div>
											</div>
											<div className="flex gap-1.5">
												<Button
													size="sm"
													className="flex-1 h-7 text-xs"
													onClick={() => updateRelay.mutate({ relayId: relay.id, ...editRelay })}
													disabled={updateRelay.isPending}
												>
													{updateRelay.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
												</Button>
												<Button
													size="sm"
													variant="ghost"
													className="h-7 text-xs"
													onClick={() => setEditingRelayId(null)}
												>
													Cancel
												</Button>
												<Button
													size="sm"
													variant="ghost"
													className="h-7 text-xs text-destructive hover:text-destructive"
													onClick={() => setDeleteRelayId(relay.id)}
												>
													<Trash2 className="w-3 h-3" />
												</Button>
											</div>
										</div>
									) : (
										<>
											<div className="flex items-start justify-between mb-3">
												<div className={cn("w-10 h-10 rounded-xl flex items-center justify-center transition-colors", relay.state ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground")}>
													<IconComp className="w-5 h-5" />
												</div>
												<Switch
													checked={relay.state}
													onCheckedChange={(checked) => toggleRelay.mutate({ relayId: relay.id, state: checked })}
													disabled={!isOnline || relayStatus[relay.id] === "pending"}
												/>
											</div>
											<p className="font-semibold text-sm text-foreground leading-tight">{relay.label}</p>
											<p className="text-xs text-muted-foreground mono mt-0.5">GPIO {relay.pin}</p>
											<div className="flex items-center justify-between mt-3">
												{/* Status feedback */}
												{relayStatus[relay.id] === "pending" && (
													<span className="flex items-center gap-1 text-xs text-muted-foreground">
														<Loader2 className="w-3 h-3 animate-spin" />
														Waiting…
													</span>
												)}
												{relayStatus[relay.id] === "confirmed" && (
													<span className="flex items-center gap-1 text-xs text-primary animate-fade-in">
														<CheckCircle2 className="w-3 h-3" />
														Confirmed
													</span>
												)}
												{relayStatus[relay.id] === "timeout" && (
													<button
														onClick={() => clearRelayStatus(relay.id)}
														className="flex items-center gap-1 text-xs text-destructive hover:opacity-80 transition-opacity"
														title="Device did not confirm — click to dismiss"
													>
														<AlertCircle className="w-3 h-3" />
														Timed out
													</button>
												)}
												{!relayStatus[relay.id] && <span className={cn("text-xs font-semibold", relay.state ? "text-primary" : "text-muted-foreground")}>{relay.state ? "● ON" : "○ OFF"}</span>}
												{isOwner && (
													<button
														onClick={() => startEditRelay(relay)}
														className="text-muted-foreground hover:text-foreground transition-colors"
													>
														<Pencil className="w-3.5 h-3.5" />
													</button>
												)}
											</div>
										</>
									)}
								</div>
							);
						})}

						{/* Add relay card */}
						{isOwner && device.relays.length < appConfig.maxRelaysPerDevice && (
							<div
								className="relay-card p-4 border-dashed flex flex-col items-center justify-center min-h-[140px] hover:border-primary/50 hover:bg-primary/5"
								onClick={() => !addingRelay && setAddingRelay(true)}
							>
								{addingRelay ? (
									<div
										className="w-full space-y-2.5"
										onClick={(e) => e.stopPropagation()}
									>
										<Input
											value={newRelay.label}
											onChange={(e) => setNewRelay((r) => ({ ...r, label: e.target.value }))}
											placeholder="Relay label"
											className="h-8 text-sm"
											autoFocus
										/>
										<div className="flex gap-2">
											<div className="flex-1">
												<Label className="text-[10px]">GPIO Pin</Label>
												<Input
													type="number"
													value={newRelay.pin}
													onChange={(e) => setNewRelay((r) => ({ ...r, pin: Number(e.target.value) }))}
													className="h-8 text-sm mt-0.5"
													min={0}
													max={39}
												/>
											</div>
											<div className="flex-1">
												<Label className="text-[10px]">Icon</Label>
												<select
													value={newRelay.icon}
													onChange={(e) => setNewRelay((r) => ({ ...r, icon: e.target.value }))}
													className="h-8 w-full mt-0.5 text-sm rounded-md border border-input bg-background px-2 focus:outline-none focus:ring-2 focus:ring-ring"
												>
													{ICON_OPTIONS.map((o) => (
														<option
															key={o}
															value={o}
														>
															{o}
														</option>
													))}
												</select>
											</div>
										</div>
										<div className="flex gap-1.5">
											<Button
												size="sm"
												className="flex-1 h-7 text-xs"
												onClick={() => addRelay.mutate({ deviceId: device.id, ...newRelay })}
												disabled={addRelay.isPending || !newRelay.label}
											>
												{addRelay.isPending ? (
													<Loader2 className="w-3 h-3 animate-spin" />
												) : (
													<>
														<Plus className="w-3 h-3" /> Add
													</>
												)}
											</Button>
											<Button
												size="sm"
												variant="ghost"
												className="h-7 text-xs"
												onClick={() => setAddingRelay(false)}
											>
												Cancel
											</Button>
										</div>
									</div>
								) : (
									<>
										<div className="w-9 h-9 rounded-xl border-2 border-dashed border-muted-foreground/30 flex items-center justify-center mb-2">
											<Plus className="w-4 h-4 text-muted-foreground" />
										</div>
										<p className="text-xs text-muted-foreground font-medium">Add Relay</p>
									</>
								)}
							</div>
						)}
					</div>

					{!isOnline && device.relays.length > 0 && (
						<p className="text-xs text-muted-foreground mt-4 flex items-center gap-1.5 bg-muted/50 rounded-lg px-3 py-2 w-fit">
							<WifiOff className="w-3.5 h-3.5" />
							Device is offline — relay toggles will sync when it reconnects.
						</p>
					)}
				</TabsContent>

				{/* SWITCHES TAB */}
				<TabsContent
					value="switches"
					className="mt-4 space-y-3"
				>
					<p className="text-xs text-muted-foreground">
						Switches monitor input GPIO pins and toggle a linked relay when the switch state changes.
						Pins 34–39 are input-only and ideal for switches.
					</p>

					{switchList.map((det: SwitchItem) => (
						<div
							key={det.id}
							className="relay-card p-4"
						>
							{editingSwitchId === det.id ? (
								<div className="space-y-2.5">
									<Input
										value={editSwitch.label}
										onChange={(e) => setEditSwitch((d) => ({ ...d, label: e.target.value }))}
										placeholder="Label"
										className="h-8 text-sm"
									/>
									<div className="flex gap-2">
										<div className="flex-1">
											<Label className="text-[10px]">GPIO Pin</Label>
											<Input
												type="number"
												value={editSwitch.pin}
												onChange={(e) => setEditSwitch((d) => ({ ...d, pin: Number(e.target.value) }))}
												className="h-8 text-sm mt-0.5"
												min={0}
												max={39}
											/>
										</div>
										<div className="flex-1">
											<Label className="text-[10px]">Switch Type</Label>
											<div className="flex gap-1 mt-0.5">
												{SWITCH_TYPES.map((st) => (
													<button
														key={st.value}
														type="button"
														onClick={() => setEditSwitch((d) => ({ ...d, switchType: st.value }))}
														className={`flex-1 flex flex-col items-center gap-0.5 rounded-md border px-1.5 py-1.5 text-[10px] transition-colors ${editSwitch.switchType === st.value ? "border-primary bg-primary/10 text-primary" : "border-input bg-background text-muted-foreground hover:border-primary/40"}`}
														title={st.desc}
													>
														{st.icon}
														<span className="font-medium">{st.label}</span>
													</button>
												))}
											</div>
										</div>
									</div>
									<div className="flex gap-2">
										<div className="flex-1">
											<Label className="text-[10px]">Linked Relay</Label>
											<select
												value={editSwitch.linkedRelayId}
												onChange={(e) => setEditSwitch((d) => ({ ...d, linkedRelayId: e.target.value }))}
												className="h-8 w-full mt-0.5 text-sm rounded-md border border-input bg-background px-2"
											>
												<option value="">— select —</option>
												{allRelays.map((r: AllRelayItem) => (
													<option
														key={r.id}
														value={r.id}
													>
														{r.deviceName} — {r.label} (GPIO {r.pin})
													</option>
												))}
											</select>
										</div>
									</div>
									<div className="flex gap-1.5">
										<Button
											size="sm"
											className="flex-1 h-7 text-xs"
											onClick={() => updateSwitch.mutate({ switchId: det.id, ...editSwitch })}
											disabled={updateSwitch.isPending || !editSwitch.label || !editSwitch.linkedRelayId}
										>
											{updateSwitch.isPending ? (
												<Loader2 className="w-3 h-3 animate-spin" />
											) : (
												<>
													<Save className="w-3 h-3" /> Save
												</>
											)}
										</Button>
										<Button
											size="sm"
											variant="ghost"
											className="h-7 text-xs"
											onClick={() => setEditingSwitchId(null)}
										>
											Cancel
										</Button>
										<Button
											size="sm"
											variant="ghost"
											className="h-7 text-xs text-destructive hover:text-destructive"
											onClick={() => deleteSwitch.mutate({ switchId: det.id })}
										>
											<Trash2 className="w-3 h-3" />
										</Button>
									</div>
								</div>
							) : (
								<div className="flex items-center justify-between">
									<div>
										<div className="flex items-center gap-1.5">
											{(() => { const st = SWITCH_TYPES.find((s) => s.value === (det.switchType ?? "two_way")); return st ? <span className="text-muted-foreground">{st.icon}</span> : null; })()}
											<p className="font-semibold text-sm">{det.label}</p>
										</div>
										<p className="text-xs text-muted-foreground mono mt-0.5">
											GPIO {det.pin} · {SWITCH_TYPES.find((s) => s.value === (det.switchType ?? "two_way"))?.label ?? det.switchType} · →{" "}
											{(() => {
												const r = allRelays.find((x: AllRelayItem) => x.id === det.linkedRelayId);
												return r ? `${r.deviceName} — ${r.label}` : "unknown";
											})()}
										</p>
									</div>
									{isOwner && (
										<button
											onClick={() => {
												setEditingSwitchId(det.id);
												setEditSwitch({ pin: det.pin, label: det.label, switchType: (det.switchType ?? "two_way") as SwitchTypeValue, linkedRelayId: det.linkedRelayId });
											}}
											className="text-muted-foreground hover:text-foreground"
										>
											<Pencil className="w-3.5 h-3.5" />
										</button>
									)}
								</div>
							)}
						</div>
					))}

					{/* Add switch (owner only) */}
					{isOwner && (addingSwitch ? (
						<div className="relay-card p-4 space-y-2.5">
							<Input
								value={newSwitch.label}
								onChange={(e) => setNewSwitch((d) => ({ ...d, label: e.target.value }))}
								placeholder="Switch label"
								className="h-8 text-sm"
								autoFocus
							/>
							<div className="flex gap-2">
								<div className="flex-1">
									<Label className="text-[10px]">GPIO Pin</Label>
									<Input
										type="number"
										value={newSwitch.pin}
										onChange={(e) => setNewSwitch((d) => ({ ...d, pin: Number(e.target.value) }))}
										className="h-8 text-sm mt-0.5"
										min={0}
										max={39}
									/>
								</div>
								<div className="flex-1">
									<Label className="text-[10px]">Switch Type</Label>
									<div className="flex gap-1 mt-0.5">
										{SWITCH_TYPES.map((st) => (
											<button
												key={st.value}
												type="button"
												onClick={() => setNewSwitch((d) => ({ ...d, switchType: st.value }))}
												className={`flex-1 flex flex-col items-center gap-0.5 rounded-md border px-1.5 py-1.5 text-[10px] transition-colors ${newSwitch.switchType === st.value ? "border-primary bg-primary/10 text-primary" : "border-input bg-background text-muted-foreground hover:border-primary/40"}`}
												title={st.desc}
											>
												{st.icon}
												<span className="font-medium">{st.label}</span>
											</button>
										))}
									</div>
								</div>
							</div>
							<div className="flex gap-2">
								<div className="flex-1">
									<Label className="text-[10px]">Linked Relay</Label>
									<select
										value={newSwitch.linkedRelayId}
										onChange={(e) => setNewSwitch((d) => ({ ...d, linkedRelayId: e.target.value }))}
										className="h-8 w-full mt-0.5 text-sm rounded-md border border-input bg-background px-2"
									>
										<option value="">— select —</option>
										{allRelays.map((r: AllRelayItem) => (
											<option
												key={r.id}
												value={r.id}
											>
												{r.deviceName} — {r.label} (GPIO {r.pin})
											</option>
										))}
									</select>
								</div>
							</div>
							<div className="flex gap-1.5">
								<Button
									size="sm"
									className="flex-1 h-7 text-xs"
									onClick={() => addSwitch.mutate({ deviceId: device.id, ...newSwitch })}
									disabled={addSwitch.isPending || !newSwitch.label || !newSwitch.linkedRelayId}
								>
									{addSwitch.isPending ? (
										<Loader2 className="w-3 h-3 animate-spin" />
									) : (
										<>
											<Plus className="w-3 h-3" /> Add Switch
										</>
									)}
								</Button>
								<Button
									size="sm"
									variant="ghost"
									className="h-7 text-xs"
									onClick={() => setAddingSwitch(false)}
								>
									Cancel
								</Button>
							</div>
						</div>
					) : (
						<Button
							variant="outline"
							size="sm"
							className="w-full"
							onClick={() => setAddingSwitch(true)}
							disabled={allRelays.length === 0}
						>
							<Plus className="w-3.5 h-3.5" /> Add Switch
							{device.relays.length === 0 && <span className="ml-2 text-muted-foreground">(add a relay to any device first)</span>}
						</Button>
					))}
				</TabsContent>

				{/* CONFIG TAB */}
				<TabsContent
					value="config"
					className="mt-4"
				>
					<Card>
						<CardHeader>
							<CardTitle className="text-base">Device Information</CardTitle>
							<CardDescription>Details reported by the ESP32</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="space-y-3">
								{[
									{ label: "Device ID", value: device.id },
									{ label: "MAC Address", value: device.macAddress },
									{ label: "WiFi Network", value: device.ssid ?? "Unknown" },
									{ label: "Firmware", value: device.firmwareVersion ?? "Unknown" },
									{ label: "Registered", value: new Date(device.createdAt).toLocaleDateString() },
									{ label: "Last Updated", value: new Date(device.updatedAt).toLocaleString() }
								].map(({ label, value }) => (
									<div
										key={label}
										className="flex flex-col sm:flex-row sm:items-center gap-1 py-2 border-b border-border last:border-0"
									>
										<span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide min-w-[130px]">{label}</span>
										<span className="text-sm text-foreground mono break-all">{value}</span>
									</div>
								))}
							</div>
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>

			{/* Delete device dialog */}
			<Dialog
				open={deleteDeviceOpen}
				onOpenChange={setDeleteDeviceOpen}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Device</DialogTitle>
						<DialogDescription>
							This will permanently delete <strong>{device.name}</strong> and all its relay configurations. This cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setDeleteDeviceOpen(false)}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={() => deleteDevice.mutate({ id })}
							disabled={deleteDevice.isPending}
						>
							{deleteDevice.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
							Delete Device
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete relay dialog */}
			<Dialog
				open={!!deleteRelayId}
				onOpenChange={(o) => !o && setDeleteRelayId(null)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Relay</DialogTitle>
						<DialogDescription>Remove this relay from the device? The physical pin will no longer be controlled from the dashboard.</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setDeleteRelayId(null)}
						>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={() => deleteRelayId && deleteRelay.mutate({ relayId: deleteRelayId })}
							disabled={deleteRelay.isPending}
						>
							{deleteRelay.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

		</div>
	);
}
