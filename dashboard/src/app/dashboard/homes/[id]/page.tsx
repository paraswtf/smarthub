"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
	Home, ArrowLeft, Cpu, Users, Plus, Trash2, Pencil, Share2,
	Wifi, WifiOff, ToggleRight, ChevronRight, Loader2, X
} from "lucide-react";
import { api, type RouterOutputs } from "~/trpc/react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import { useDeviceSocket } from "~/providers/DeviceSocketProvider";
import { timeAgo } from "~/lib/utils";

export default function HomeDetailPage() {
	const { id } = useParams<{ id: string }>();
	const router = useRouter();
	const utils = api.useUtils();

	const { connected: wsConnected, onDeviceUpdate, onRelayUpdate } = useDeviceSocket();

	const { data: home, isLoading } = api.home.get.useQuery({ id });
	const { data: unassigned } = api.home.unassignedDevices.useQuery();

	// ── Editing ────────────────────────────────────────────────
	const [editing, setEditing] = useState(false);
	const [editName, setEditName] = useState("");

	const updateHome = api.home.update.useMutation({
		onSuccess: () => {
			void utils.home.get.invalidate({ id });
			void utils.home.list.invalidate();
			setEditing(false);
		}
	});

	const deleteHome = api.home.delete.useMutation({
		onSuccess: () => {
			void utils.home.list.invalidate();
			router.push("/dashboard/homes");
		}
	});

	// ── Sharing ────────────────────────────────────────────────
	const [shareOpen, setShareOpen] = useState(false);
	const [shareEmail, setShareEmail] = useState("");
	const [shareError, setShareError] = useState("");

	const shareMutation = api.sharing.shareHome.useMutation({
		onSuccess: () => {
			void utils.home.get.invalidate({ id });
			void utils.home.list.invalidate();
			setShareOpen(false);
			setShareEmail("");
			setShareError("");
		},
		onError: (err) => setShareError(err.message)
	});

	const unshareMutation = api.sharing.unshareHome.useMutation({
		onSuccess: () => {
			void utils.home.get.invalidate({ id });
			void utils.home.list.invalidate();
		}
	});

	// ── Assign device ──────────────────────────────────────────
	const [assignOpen, setAssignOpen] = useState(false);

	const assignDevice = api.home.assignDevice.useMutation({
		onSuccess: () => {
			void utils.home.get.invalidate({ id });
			void utils.home.list.invalidate();
			void utils.home.unassignedDevices.invalidate();
		}
	});

	const unassignDevice = api.home.assignDevice.useMutation({
		onSuccess: () => {
			void utils.home.get.invalidate({ id });
			void utils.home.list.invalidate();
			void utils.home.unassignedDevices.invalidate();
		}
	});

	// ── Device online status ───────────────────────────────────
	const [onlineStatus, setOnlineStatus] = useState<Record<string, boolean>>({});
	const [pinging, setPinging] = useState<Record<string, boolean>>({});
	const [liveRelayStates, setLiveRelayStates] = useState<Record<string, boolean>>({});

	useEffect(() => {
		return onDeviceUpdate((msg) => {
			setOnlineStatus((p) => ({ ...p, [msg.deviceId]: true }));
			setLiveRelayStates((p) => {
				const next = { ...p };
				msg.relays.forEach((r) => { next[r.id] = r.state; });
				return next;
			});
		});
	}, [onDeviceUpdate]);

	useEffect(() => {
		return onRelayUpdate((msg) => {
			setLiveRelayStates((p) => ({ ...p, [msg.relayId]: msg.state }));
		});
	}, [onRelayUpdate]);

	const pingMutation = api.device.pingDevice.useMutation();

	const pingAll = useCallback(async (deviceList: { id: string }[]) => {
		const batch: Record<string, boolean> = {};
		for (const d of deviceList) batch[d.id] = true;
		setPinging(batch);
		await Promise.all(
			deviceList.map(async (d) => {
				try {
					const result = await pingMutation.mutateAsync({ deviceId: d.id });
					setOnlineStatus((p) => ({ ...p, [d.id]: result.online }));
				} catch {
					setOnlineStatus((p) => ({ ...p, [d.id]: false }));
				}
				setPinging((p) => ({ ...p, [d.id]: false }));
			})
		);
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		if (home?.devices.length) {
			void pingAll(home.devices);
		}
	}, [home?.devices.length]); // eslint-disable-line react-hooks/exhaustive-deps

	if (isLoading) {
		return (
			<div className="p-6 lg:p-8 space-y-6 mt-14 lg:mt-0">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-64 w-full" />
			</div>
		);
	}

	if (!home) {
		return (
			<div className="p-6 lg:p-8 mt-14 lg:mt-0">
				<p className="text-muted-foreground">Home not found.</p>
				<Button variant="ghost" asChild className="mt-4"><Link href="/dashboard/homes"><ArrowLeft className="w-4 h-4" /> Back</Link></Button>
			</div>
		);
	}

	type DeviceItem = RouterOutputs["home"]["get"]["devices"][number];

	return (
		<div className="p-6 lg:p-8 space-y-6 animate-fade-in mt-14 lg:mt-0">
			{/* Header */}
			<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
				<div className="flex items-center gap-3">
					<Button variant="ghost" size="icon" asChild>
						<Link href="/dashboard/homes"><ArrowLeft className="w-4 h-4" /></Link>
					</Button>
					{editing ? (
						<form
							onSubmit={(e) => {
								e.preventDefault();
								if (editName.trim()) updateHome.mutate({ id, name: editName.trim() });
							}}
							className="flex items-center gap-2"
						>
							<Input
								value={editName}
								onChange={(e) => setEditName(e.target.value)}
								className="h-9 w-48"
								autoFocus
							/>
							<Button size="sm" type="submit" disabled={updateHome.isPending}>Save</Button>
							<Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
						</form>
					) : (
						<div className="flex items-center gap-2">
							<Home className="w-5 h-5 text-primary" />
							<h1 className="font-sora font-extrabold text-2xl lg:text-3xl text-foreground">{home.name}</h1>
							<Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditName(home.name); setEditing(true); }}>
								<Pencil className="w-3.5 h-3.5" />
							</Button>
						</div>
					)}
				</div>

				<div className="flex items-center gap-2">
					{/* Share button */}
					<Dialog open={shareOpen} onOpenChange={(o) => { setShareOpen(o); setShareError(""); }}>
						<DialogTrigger asChild>
							<Button variant="outline"><Share2 className="w-4 h-4" /> Share</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Share "{home.name}"</DialogTitle>
							</DialogHeader>
							<form
								onSubmit={(e) => {
									e.preventDefault();
									setShareError("");
									if (shareEmail.trim()) shareMutation.mutate({ homeId: id, email: shareEmail.trim() });
								}}
								className="space-y-4"
							>
								<div className="space-y-2">
									<Label htmlFor="share-email">User email</Label>
									<Input
										id="share-email"
										type="email"
										placeholder="user@example.com"
										value={shareEmail}
										onChange={(e) => setShareEmail(e.target.value)}
									/>
									{shareError && <p className="text-sm text-destructive">{shareError}</p>}
								</div>
								<Button type="submit" disabled={!shareEmail.trim() || shareMutation.isPending} className="w-full">
									{shareMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Share"}
								</Button>
							</form>

							{/* Current shares */}
							{home.shares.length > 0 && (
								<div className="space-y-2 pt-2 border-t">
									<p className="text-sm font-medium">Shared with</p>
									{home.shares.map((share) => (
										<div key={share.id} className="flex items-center justify-between py-1">
											<div className="min-w-0">
												<p className="text-sm truncate">{share.user.name ?? share.user.email}</p>
												{share.user.name && <p className="text-xs text-muted-foreground truncate">{share.user.email}</p>}
											</div>
											<Button
												variant="ghost"
												size="icon"
												className="h-7 w-7 text-destructive"
												onClick={() => unshareMutation.mutate({ homeId: id, userId: share.user.id })}
												disabled={unshareMutation.isPending}
											>
												<X className="w-3.5 h-3.5" />
											</Button>
										</div>
									))}
								</div>
							)}
						</DialogContent>
					</Dialog>

					{/* Assign device */}
					<Dialog open={assignOpen} onOpenChange={setAssignOpen}>
						<DialogTrigger asChild>
							<Button variant="outline"><Plus className="w-4 h-4" /> Assign Device</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Assign device to "{home.name}"</DialogTitle>
							</DialogHeader>
							{(unassigned?.length ?? 0) === 0 ? (
								<p className="text-sm text-muted-foreground">No unassigned devices. All your devices are already in a home.</p>
							) : (
								<div className="space-y-2">
									{unassigned!.map((device) => (
										<button
											key={device.id}
											onClick={() => {
												assignDevice.mutate({ deviceId: device.id, homeId: id });
												setAssignOpen(false);
											}}
											className="w-full flex items-center gap-3 p-3 rounded-lg border hover:border-primary/40 hover:bg-accent transition-colors text-left"
										>
											<Cpu className="w-4 h-4 text-muted-foreground flex-shrink-0" />
											<div className="min-w-0">
												<p className="text-sm font-medium truncate">{device.name}</p>
												<p className="text-xs text-muted-foreground mono">{device.macAddress}</p>
											</div>
										</button>
									))}
								</div>
							)}
						</DialogContent>
					</Dialog>

					{/* Delete */}
					<Button
						variant="ghost"
						size="icon"
						className="text-destructive"
						onClick={() => {
							if (home.devices.length > 0) {
								alert("Remove all devices from this home before deleting it.");
								return;
							}
							if (confirm(`Delete "${home.name}"?`)) deleteHome.mutate({ id });
						}}
						disabled={deleteHome.isPending}
					>
						<Trash2 className="w-4 h-4" />
					</Button>
				</div>
			</div>

			{/* Stats */}
			<div className="flex gap-4">
				<Badge variant="outline" className="gap-1.5 px-3 py-1">
					<Cpu className="w-3.5 h-3.5" /> {home.devices.length} {home.devices.length === 1 ? "device" : "devices"}
				</Badge>
				{home.shares.length > 0 && (
					<Badge variant="outline" className="gap-1.5 px-3 py-1">
						<Users className="w-3.5 h-3.5" /> Shared with {home.shares.length}
					</Badge>
				)}
			</div>

			{/* Devices */}
			{home.devices.length === 0 ? (
				<Card className="border-dashed">
					<CardContent className="p-12 text-center">
						<Cpu className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
						<h3 className="font-semibold text-foreground mb-1">No devices in this home</h3>
						<p className="text-sm text-muted-foreground">Assign devices to this home to get started.</p>
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
					{home.devices.map((device: DeviceItem) => {
						const online = onlineStatus[device.id] ?? false;
						const checking = pinging[device.id] === true && onlineStatus[device.id] === undefined;
						const relays = device.relays.map((r) => ({ ...r, state: liveRelayStates[r.id] ?? r.state }));
						const activeRelays = relays.filter((r) => r.state).length;

						return (
							<div key={device.id} className="group relative">
								<Link href={`/dashboard/devices/${device.id}`} className="no-underline">
									<Card className="h-full transition-all duration-200 hover:border-primary/40 hover:shadow-md cursor-pointer">
										<CardHeader className="pb-3">
											<div className="flex items-start justify-between gap-2">
												<div className="flex items-center gap-2.5 min-w-0">
													<span className={`status-dot flex-shrink-0 ${checking ? "checking" : online ? "online" : "offline"}`} />
													<CardTitle className="text-base font-semibold truncate">{device.name}</CardTitle>
												</div>
												<Badge variant={online ? "online" : "offline"} className="flex-shrink-0">
													{checking ? "Pinging" : online ? "Online" : "Offline"}
												</Badge>
											</div>
											<p className="text-xs text-muted-foreground mono">{device.macAddress}</p>
										</CardHeader>
										<CardContent className="pb-4 space-y-3">
											<div className="flex items-center gap-2">
												<ToggleRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
												<span className="text-xs text-muted-foreground">
													{relays.length === 0 ? "No relays" : `${activeRelays} / ${relays.length} relays active`}
												</span>
											</div>
											{relays.length > 0 && (
												<div className="flex flex-wrap gap-1.5">
													{relays.slice(0, 4).map((relay) => (
														<span
															key={relay.id}
															className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${relay.state ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
														>
															<span className="w-1.5 h-1.5 rounded-full" style={{ background: relay.state ? "hsl(var(--status-online))" : "hsl(var(--status-offline))" }} />
															{relay.label}
														</span>
													))}
													{relays.length > 4 && <span className="text-xs text-muted-foreground px-1 self-center">+{relays.length - 4} more</span>}
												</div>
											)}
											<div className="flex items-center justify-between pt-1">
												<p className="text-[10px] text-muted-foreground flex items-center gap-1">
													{online ? <><Wifi className="w-3 h-3" /> Connected</> : <><WifiOff className="w-3 h-3" /> {timeAgo(device.lastSeenAt)}</>}
												</p>
												<ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
											</div>
										</CardContent>
									</Card>
								</Link>
								{/* Remove from home button */}
								<Button
									variant="ghost"
									size="icon"
									className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive z-10"
									onClick={(e) => {
										e.preventDefault();
										e.stopPropagation();
										unassignDevice.mutate({ deviceId: device.id, homeId: null });
									}}
									title="Remove from home"
								>
									<X className="w-3.5 h-3.5" />
								</Button>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
