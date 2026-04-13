"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
	ArrowLeft,
	DoorOpen,
	Pencil,
	Trash2,
	Plus,
	Share2,
	Users,
	Loader2,
	X,
	ToggleRight,
	CheckCircle2,
	AlertCircle,
	Lightbulb,
	Fan,
	Plug,
	Wind,
	Tv,
	Coffee,
	Thermometer,
	Radio,
	Power,
} from "lucide-react";
import { api, type RouterOutputs } from "~/trpc/react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { Skeleton } from "~/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import { useDeviceSocket } from "~/providers/DeviceSocketProvider";
import { RelayScheduleDialog } from "~/components/dashboard/RelayScheduleDialog";

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

type RelayStatus = "idle" | "pending" | "confirmed" | "timeout";

export default function RoomDetailPage() {
	const { id } = useParams<{ id: string }>();
	const router = useRouter();
	const utils = api.useUtils();
	const utilsRef = useRef(utils);
	utilsRef.current = utils;

	const { data: room, isLoading } = api.room.get.useQuery({ id });
	const { data: unassignedRelays } = api.room.unassignedRelays.useQuery({ homeId: room?.homeId ?? "" }, { enabled: !!room && room.accessLevel === "owner" });
	const { data: unassignedRegulators } = api.room.unassignedRegulators.useQuery({ homeId: room?.homeId ?? "" }, { enabled: !!room && room.accessLevel === "owner" });
	const { onDeviceUpdate, onRelayUpdate, onRegulatorUpdate } = useDeviceSocket();

	// ── Live relay states ──────────────────────────────────────
	const [liveRelayStates, setLiveRelayStates] = useState<Record<string, boolean>>({});
	const [relayStatuses, setRelayStatuses] = useState<Record<string, RelayStatus>>({});
	const [onlineDevices, setOnlineDevices] = useState<Record<string, boolean>>({});

	useEffect(() => {
		return onDeviceUpdate((msg) => {
			setOnlineDevices((p) => ({ ...p, [msg.deviceId]: true }));
			setLiveRelayStates((p) => {
				const next = { ...p };
				msg.relays.forEach((r) => {
					next[r.id] = r.state;
				});
				return next;
			});
		});
	}, [onDeviceUpdate]);

	useEffect(() => {
		return onRelayUpdate((msg) => {
			setLiveRelayStates((p) => ({ ...p, [msg.relayId]: msg.state }));
			// If we were pending, mark confirmed
			setRelayStatuses((p) => {
				if (p[msg.relayId] === "pending") {
					setTimeout(() => setRelayStatuses((pp) => ({ ...pp, [msg.relayId]: "idle" })), 1500);
					return { ...p, [msg.relayId]: "confirmed" };
				}
				return p;
			});
		});
	}, [onRelayUpdate]);

	// ── Live regulator speeds ──────────────────────────────────
	const [liveRegSpeeds, setLiveRegSpeeds] = useState<Record<string, number>>({});

	useEffect(() => {
		return onRegulatorUpdate((msg) => {
			setLiveRegSpeeds((p) => ({ ...p, [msg.regulatorId]: msg.speed }));
		});
	}, [onRegulatorUpdate]);

	// Ping devices with relays or regulators in this room
	const pingMutation = api.device.pingDevice.useMutation();
	useEffect(() => {
		if (!room) return;
		const deviceIds = [...new Set([...room.relays.map((r) => r.device.id), ...room.regulators.map((r) => r.device.id)])];
		deviceIds.forEach((deviceId) => {
			pingMutation.mutateAsync({ deviceId }).then(
				(r) => setOnlineDevices((p) => ({ ...p, [deviceId]: r.online })),
				() => setOnlineDevices((p) => ({ ...p, [deviceId]: false })),
			);
		});
	}, [room?.id]); // eslint-disable-line react-hooks/exhaustive-deps

	// ── Editing ────────────────────────────────────────────────
	const [editing, setEditing] = useState(false);
	const [editName, setEditName] = useState("");

	const updateRoom = api.room.update.useMutation({
		onSuccess: () => {
			void utils.room.get.invalidate({ id });
			if (room?.homeId) void utils.home.get.invalidate({ id: room.homeId });
			setEditing(false);
		},
	});

	const deleteRoom = api.room.delete.useMutation({
		onSuccess: () => {
			if (room?.homeId) {
				void utils.home.get.invalidate({ id: room.homeId });
				void utils.room.unassignedRelays.invalidate({ homeId: room.homeId });
			}
			void utils.home.list.invalidate();
			if (room) router.push(`/dashboard/homes/${room.homeId}`);
		},
	});

	// ── Relay toggle ───────────────────────────────────────────
	const toggleRelay = api.device.toggleRelay.useMutation({
		onMutate: ({ relayId, state }) => {
			setLiveRelayStates((p) => ({ ...p, [relayId]: state }));
			setRelayStatuses((p) => ({ ...p, [relayId]: "pending" }));
			// Timeout after 5s
			setTimeout(() => {
				setRelayStatuses((p) => {
					if (p[relayId] === "pending") {
						setTimeout(() => setRelayStatuses((pp) => ({ ...pp, [relayId]: "idle" })), 3000);
						return { ...p, [relayId]: "timeout" };
					}
					return p;
				});
			}, 5000);
		},
		onError: (_, { relayId }) => {
			// Revert on error
			void utils.room.get.invalidate({ id });
			setRelayStatuses((p) => ({ ...p, [relayId]: "idle" }));
		},
	});

	// ── Sharing ────────────────────────────────────────────────
	const [shareOpen, setShareOpen] = useState(false);
	const [shareEmail, setShareEmail] = useState("");
	const [shareError, setShareError] = useState("");

	const shareRoomMutation = api.sharing.shareRoom.useMutation({
		onSuccess: () => {
			void utils.room.get.invalidate({ id });
			setShareOpen(false);
			setShareEmail("");
			setShareError("");
		},
		onError: (err) => setShareError(err.message),
	});

	const unshareRoomMutation = api.sharing.unshareRoom.useMutation({
		onSuccess: () => void utils.room.get.invalidate({ id }),
	});

	// ── Assign relay ───────────────────────────────────────────
	const [assignRelayOpen, setAssignRelayOpen] = useState(false);

	const assignRelay = api.room.assignRelay.useMutation({
		onSuccess: () => {
			void utils.room.get.invalidate({ id });
			void utils.room.unassignedRelays.invalidate({ homeId: room?.homeId ?? "" });
		},
	});

	const unassignRelay = api.room.unassignRelay.useMutation({
		onSuccess: () => {
			void utils.room.get.invalidate({ id });
			void utils.room.unassignedRelays.invalidate({ homeId: room?.homeId ?? "" });
		},
	});

	// ── Assign regulator ───────────────────────────────────────
	const [assignRegOpen, setAssignRegOpen] = useState(false);

	const assignRegulator = api.room.assignRegulator.useMutation({
		onSuccess: () => {
			void utils.room.get.invalidate({ id });
			void utils.room.unassignedRegulators.invalidate({ homeId: room?.homeId ?? "" });
		},
	});

	const unassignRegulator = api.room.unassignRegulator.useMutation({
		onSuccess: () => {
			void utils.room.get.invalidate({ id });
			void utils.room.unassignedRegulators.invalidate({ homeId: room?.homeId ?? "" });
		},
	});

	const setRegSpeed = api.regulator.setSpeed.useMutation({
		onMutate: ({ regulatorId, speed }) => {
			setLiveRegSpeeds((p) => ({ ...p, [regulatorId]: speed }));
		},
		onError: () => void utils.room.get.invalidate({ id }),
	});

	if (isLoading) {
		return (
			<div className="p-6 lg:p-8 space-y-6 mt-14 lg:mt-0">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-64 w-full" />
			</div>
		);
	}

	if (!room) {
		return (
			<div className="p-6 lg:p-8 mt-14 lg:mt-0">
				<p className="text-muted-foreground">Room not found.</p>
				<Button variant="ghost" asChild className="mt-4">
					<Link href="/dashboard/homes">
						<ArrowLeft className="w-4 h-4" /> Back
					</Link>
				</Button>
			</div>
		);
	}

	const isOwner = room.accessLevel === "owner";

	return (
		<div className="p-6 lg:p-8 space-y-6 animate-fade-in mt-14 lg:mt-0">
			{/* Header */}
			<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
				<div className="flex items-center gap-3">
					<Button variant="ghost" size="icon" asChild>
						<Link href={`/dashboard/homes/${room.homeId}`}>
							<ArrowLeft className="w-4 h-4" />
						</Link>
					</Button>
					{editing ? (
						<form
							onSubmit={(e) => {
								e.preventDefault();
								if (editName.trim()) updateRoom.mutate({ id, name: editName.trim() });
							}}
							className="flex items-center gap-2"
						>
							<Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-9 w-full sm:w-48" autoFocus />
							<Button size="sm" type="submit" disabled={updateRoom.isPending}>
								Save
							</Button>
							<Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
								Cancel
							</Button>
						</form>
					) : (
						<div className="flex items-center gap-2">
							<DoorOpen className="w-5 h-5 text-primary" />
							<h1 className="font-sora font-extrabold text-2xl lg:text-3xl text-foreground">{room.name}</h1>
							{isOwner && (
								<Button
									variant="ghost"
									size="icon"
									className="h-7 w-7"
									onClick={() => {
										setEditName(room.name);
										setEditing(true);
									}}
								>
									<Pencil className="w-3.5 h-3.5" />
								</Button>
							)}
							{!isOwner && (
								<Badge variant="outline" className="gap-1">
									<Share2 className="w-3 h-3" /> Shared
								</Badge>
							)}
						</div>
					)}
				</div>

				{isOwner && (
					<div className="flex items-center gap-2 flex-wrap">
						{/* Share room */}
						<Dialog
							open={shareOpen}
							onOpenChange={(o) => {
								setShareOpen(o);
								setShareError("");
							}}
						>
							<DialogTrigger asChild>
								<Button variant="outline">
									<Share2 className="w-4 h-4" /> Share
								</Button>
							</DialogTrigger>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>Share "{room.name}"</DialogTitle>
								</DialogHeader>
								<form
									onSubmit={(e) => {
										e.preventDefault();
										setShareError("");
										if (shareEmail.trim()) shareRoomMutation.mutate({ roomId: id, email: shareEmail.trim() });
									}}
									className="space-y-4"
								>
									<div className="space-y-2">
										<Label htmlFor="share-room-email">User email</Label>
										<Input id="share-room-email" type="email" placeholder="user@example.com" value={shareEmail} onChange={(e) => setShareEmail(e.target.value)} />
										{shareError && <p className="text-sm text-destructive">{shareError}</p>}
									</div>
									<Button type="submit" disabled={!shareEmail.trim() || shareRoomMutation.isPending} className="w-full">
										{shareRoomMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Share"}
									</Button>
								</form>

								{room.shares.length > 0 && (
									<div className="space-y-2 pt-2 border-t">
										<p className="text-sm font-medium">Shared with</p>
										{room.shares.map((share) => (
											<div key={share.id} className="flex items-center justify-between py-1">
												<div className="min-w-0">
													<p className="text-sm truncate">{share.user.name ?? share.user.email}</p>
													{share.user.name && <p className="text-xs text-muted-foreground truncate">{share.user.email}</p>}
												</div>
												<Button
													variant="ghost"
													size="icon"
													className="h-7 w-7 text-destructive"
													onClick={() => unshareRoomMutation.mutate({ roomId: id, userId: share.user.id })}
													disabled={unshareRoomMutation.isPending}
												>
													<X className="w-3.5 h-3.5" />
												</Button>
											</div>
										))}
									</div>
								)}
							</DialogContent>
						</Dialog>

						{/* Add regulator */}
						<Dialog open={assignRegOpen} onOpenChange={setAssignRegOpen}>
							<DialogTrigger asChild>
								<Button variant="outline">
									<Fan className="w-4 h-4" /> Add Regulator
								</Button>
							</DialogTrigger>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>Add regulator to "{room.name}"</DialogTitle>
								</DialogHeader>
								{(unassignedRegulators?.length ?? 0) === 0 ? (
									<p className="text-sm text-muted-foreground">No unassigned regulators available. Add regulators to devices in this home first.</p>
								) : (
									<div className="space-y-2 max-h-80 overflow-y-auto">
										{unassignedRegulators!.map((reg) => (
											<button
												key={reg.id}
												onClick={() => {
													assignRegulator.mutate({ regulatorId: reg.id, roomId: id });
													setAssignRegOpen(false);
												}}
												className="w-full flex items-center gap-3 p-3 rounded-lg border hover:border-primary/40 hover:bg-accent transition-colors text-left"
											>
												<Fan className="w-4 h-4 text-muted-foreground flex-shrink-0" />
												<div className="min-w-0">
													<p className="text-sm font-medium truncate">{reg.label}</p>
													<p className="text-xs text-muted-foreground">{reg.device.name}</p>
												</div>
											</button>
										))}
									</div>
								)}
							</DialogContent>
						</Dialog>

						{/* Add relay */}
						<Dialog open={assignRelayOpen} onOpenChange={setAssignRelayOpen}>
							<DialogTrigger asChild>
								<Button>
									<Plus className="w-4 h-4" /> Add Relay
								</Button>
							</DialogTrigger>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>Add relay to "{room.name}"</DialogTitle>
								</DialogHeader>
								{(unassignedRelays?.length ?? 0) === 0 ? (
									<p className="text-sm text-muted-foreground">No unassigned relays available. Add relays to devices in this home first.</p>
								) : (
									<div className="space-y-2 max-h-80 overflow-y-auto">
										{unassignedRelays!.map((relay) => (
											<button
												key={relay.id}
												onClick={() => {
													assignRelay.mutate({ relayId: relay.id, roomId: id });
													setAssignRelayOpen(false);
												}}
												className="w-full flex items-center gap-3 p-3 rounded-lg border hover:border-primary/40 hover:bg-accent transition-colors text-left"
											>
												<ToggleRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
												<div className="min-w-0">
													<p className="text-sm font-medium truncate">{relay.label}</p>
													<p className="text-xs text-muted-foreground">
														GPIO {relay.pin} &middot; {relay.device.name}
													</p>
												</div>
											</button>
										))}
									</div>
								)}
							</DialogContent>
						</Dialog>

						{/* Delete room */}
						<Button
							variant="ghost"
							size="icon"
							className="text-destructive"
							onClick={() => {
								if (confirm(`Delete "${room.name}"? Relays will be unassigned, not deleted.`)) {
									deleteRoom.mutate({ id });
								}
							}}
							disabled={deleteRoom.isPending}
						>
							<Trash2 className="w-4 h-4" />
						</Button>
					</div>
				)}
			</div>

			{/* Stats */}
			<div className="flex gap-4 flex-wrap">
				<Badge variant="outline" className="gap-1.5 px-3 py-1">
					<ToggleRight className="w-3.5 h-3.5" /> {room.relays.length} {room.relays.length === 1 ? "relay" : "relays"}
				</Badge>
				{room.regulators.length > 0 && (
					<Badge variant="outline" className="gap-1.5 px-3 py-1">
						<Fan className="w-3.5 h-3.5" /> {room.regulators.length} {room.regulators.length === 1 ? "regulator" : "regulators"}
					</Badge>
				)}
				{room.shares.length > 0 && (
					<Badge variant="outline" className="gap-1.5 px-3 py-1">
						<Users className="w-3.5 h-3.5" /> Shared with {room.shares.length}
					</Badge>
				)}
				<span className="text-xs text-muted-foreground self-center">
					in{" "}
					<Link href={`/dashboard/homes/${room.homeId}`} className="text-primary hover:underline">
						{room.home.name}
					</Link>
				</span>
			</div>

			{/* Relays */}
			{room.relays.length === 0 && room.regulators.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="p-12 text-center">
						<ToggleRight className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
						<h3 className="font-semibold text-foreground mb-1">No relays or regulators in this room</h3>
						<p className="text-sm text-muted-foreground">Add relays or fan regulators from devices assigned to this home.</p>
					</CardContent>
				</Card>
			) : room.relays.length === 0 ? null : (
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
					{room.relays.map((relay) => {
						const state = liveRelayStates[relay.id] ?? relay.state;
						const status = relayStatuses[relay.id] ?? "idle";
						const deviceOnline = onlineDevices[relay.device.id] ?? false;
						const Icon = RELAY_ICONS[relay.icon] ?? RELAY_ICONS.plug!;

						return (
							<Card key={relay.id} className={`transition-all duration-200 ${state ? "border-primary/30 shadow-sm" : ""}`}>
								<CardContent className="p-5">
									<div className="flex items-center justify-between mb-3">
										<div className="flex items-center gap-3">
											<div className={`w-10 h-10 rounded-xl flex items-center justify-center ${state ? "bg-primary/15" : "bg-muted"}`}>
												<Icon className={`w-5 h-5 ${state ? "text-primary" : "text-muted-foreground"}`} />
											</div>
											<div>
												<p className="font-semibold text-foreground">{relay.label}</p>
												<p className="text-xs text-muted-foreground">
													GPIO {relay.pin} &middot; {relay.device.name}
												</p>
											</div>
										</div>
										<Switch checked={state} onCheckedChange={(checked) => toggleRelay.mutate({ relayId: relay.id, state: checked })} disabled={!deviceOnline} />
									</div>
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											{status === "pending" && (
												<span className="text-xs text-muted-foreground flex items-center gap-1">
													<Loader2 className="w-3 h-3 animate-spin" /> Sending...
												</span>
											)}
											{status === "confirmed" && (
												<span className="text-xs text-primary flex items-center gap-1">
													<CheckCircle2 className="w-3 h-3" /> Done
												</span>
											)}
											{status === "timeout" && (
												<span className="text-xs text-destructive flex items-center gap-1">
													<AlertCircle className="w-3 h-3" /> No response
												</span>
											)}
											{status === "idle" && !deviceOnline && <span className="text-xs text-muted-foreground">Device offline</span>}
										</div>
										{isOwner && (
											<div className="flex items-center gap-0.5">
												<RelayScheduleDialog relayId={relay.id} relayLabel={relay.label} scheduleCount={relay._count.schedules} />
												<Button
													variant="ghost"
													size="icon"
													className="h-7 w-7 text-muted-foreground hover:text-destructive"
													onClick={() => unassignRelay.mutate({ relayId: relay.id })}
													title="Remove from room"
												>
													<X className="w-3.5 h-3.5" />
												</Button>
											</div>
										)}
									</div>
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}

			{/* Regulators */}
			{room.regulators.length > 0 && (
				<div className="space-y-3">
					<h2 className="font-sora font-semibold text-lg text-foreground">Regulators</h2>
					<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
						{room.regulators.map((reg) => {
							const speed = liveRegSpeeds[reg.id] ?? reg.speed;
							const maxSpeed = reg.speeds.length > 0 ? Math.max(...reg.speeds.map((s) => s.speed)) : 0;
							const deviceOnline = onlineDevices[reg.device.id] ?? false;

							return (
								<Card key={reg.id} className={`transition-all duration-200 ${speed > 0 ? "border-primary/30 shadow-sm" : ""}`}>
									<CardContent className="p-5">
										<div className="flex items-center justify-between mb-3">
											<div className="flex items-center gap-3">
												<div className={`w-10 h-10 rounded-xl flex items-center justify-center ${speed > 0 ? "bg-primary/15" : "bg-muted"}`}>
													<Fan className={`w-5 h-5 ${speed > 0 ? "text-primary" : "text-muted-foreground"}`} />
												</div>
												<div>
													<p className="font-semibold text-foreground">{reg.label}</p>
													<p className="text-xs text-muted-foreground">{reg.device.name}</p>
												</div>
											</div>
											{isOwner && (
												<Button
													variant="ghost"
													size="icon"
													className="h-7 w-7 text-muted-foreground hover:text-destructive"
													onClick={() => unassignRegulator.mutate({ regulatorId: reg.id })}
													title="Remove from room"
												>
													<X className="w-3.5 h-3.5" />
												</Button>
											)}
										</div>
										<div className="flex items-center gap-1.5 flex-wrap">
											<Button
												size="sm"
												variant={speed === 0 ? "default" : "outline"}
												className="h-8 px-2.5"
												disabled={!deviceOnline}
												onClick={() => setRegSpeed.mutate({ regulatorId: reg.id, speed: 0 })}
											>
												<Power className="w-3.5 h-3.5" />
											</Button>
											{Array.from({ length: maxSpeed }, (_, i) => i + 1).map((s) => (
												<Button
													key={s}
													size="sm"
													variant={speed === s ? "default" : "outline"}
													className="h-8 w-8 p-0"
													disabled={!deviceOnline}
													onClick={() => setRegSpeed.mutate({ regulatorId: reg.id, speed: s })}
												>
													{s}
												</Button>
											))}
										</div>
										{!deviceOnline && <p className="text-xs text-muted-foreground mt-2">Device offline</p>}
									</CardContent>
								</Card>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
