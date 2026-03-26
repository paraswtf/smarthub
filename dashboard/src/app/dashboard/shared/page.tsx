"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Home, Cpu, Share2, Wifi, WifiOff, ToggleRight, ChevronRight, Loader2 } from "lucide-react";
import { api, type RouterOutputs } from "~/trpc/react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Skeleton } from "~/components/ui/skeleton";
import { useDeviceSocket } from "~/providers/DeviceSocketProvider";
import { timeAgo } from "~/lib/utils";

type SharedData = RouterOutputs["sharing"]["listSharedWithMe"];

function DeviceCard({ device, online, checking, liveRelayStates }: {
	device: SharedData["devices"][number] | SharedData["homes"][number]["devices"][number];
	online: boolean;
	checking: boolean;
	liveRelayStates: Record<string, boolean>;
}) {
	const relays = "relays" in device ? device.relays.map((r) => ({ ...r, state: liveRelayStates[r.id] ?? r.state })) : [];
	const activeRelays = relays.filter((r) => r.state).length;

	return (
		<Link href={`/dashboard/devices/${device.id}`} className="no-underline group">
			<Card className="h-full transition-all duration-200 hover:border-primary/40 hover:shadow-md cursor-pointer">
				<CardHeader className="pb-3">
					<div className="flex items-start justify-between gap-2">
						<div className="flex items-center gap-2.5 min-w-0">
							<span className={`status-dot flex-shrink-0 ${checking ? "checking" : online ? "online" : "offline"}`} />
							<CardTitle className="text-base font-semibold truncate">{device.name}</CardTitle>
						</div>
						<div className="flex items-center gap-1.5 flex-shrink-0">
							<Badge variant="outline" className="gap-1">
								<Share2 className="w-3 h-3" /> Shared
							</Badge>
							<Badge variant={online ? "online" : "offline"}>
								{checking ? "Pinging" : online ? "Online" : "Offline"}
							</Badge>
						</div>
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
	);
}

export default function SharedPage() {
	const { connected: wsConnected, onDeviceUpdate, onRelayUpdate } = useDeviceSocket();
	const { data, isLoading } = api.sharing.listSharedWithMe.useQuery();

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

	const pingAll = useCallback(async (deviceIds: string[]) => {
		const batch: Record<string, boolean> = {};
		for (const id of deviceIds) batch[id] = true;
		setPinging(batch);
		await Promise.all(
			deviceIds.map(async (id) => {
				try {
					const result = await pingMutation.mutateAsync({ deviceId: id });
					setOnlineStatus((p) => ({ ...p, [id]: result.online }));
				} catch {
					setOnlineStatus((p) => ({ ...p, [id]: false }));
				}
				setPinging((p) => ({ ...p, [id]: false }));
			})
		);
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		if (!data) return;
		const allDeviceIds = [
			...data.homes.flatMap((h) => h.devices.map((d) => d.id)),
			...data.devices.map((d) => d.id)
		];
		if (allDeviceIds.length) void pingAll(allDeviceIds);
	}, [data]); // eslint-disable-line react-hooks/exhaustive-deps

	const hasHomes = (data?.homes.length ?? 0) > 0;
	const hasDevices = (data?.devices.length ?? 0) > 0;
	const isEmpty = !hasHomes && !hasDevices;

	return (
		<div className="p-6 lg:p-8 space-y-6 animate-fade-in mt-14 lg:mt-0">
			<div>
				<h1 className="font-sora font-extrabold text-2xl lg:text-3xl text-foreground">Shared with me</h1>
				<p className="text-sm text-muted-foreground mt-1">Homes and devices others have shared with you</p>
			</div>

			{isLoading ? (
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
					{Array.from({ length: 2 }).map((_, i) => (
						<Card key={i}><CardContent className="p-5 space-y-3"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-1/2" /></CardContent></Card>
					))}
				</div>
			) : isEmpty ? (
				<Card className="border-dashed">
					<CardContent className="p-12 text-center">
						<Share2 className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
						<h3 className="font-semibold text-foreground mb-1">Nothing shared with you yet</h3>
						<p className="text-sm text-muted-foreground">When someone shares a home or device with you, it will appear here.</p>
					</CardContent>
				</Card>
			) : (
				<>
					{/* Shared Homes */}
					{hasHomes && (
						<div className="space-y-3">
							<h2 className="font-sora font-semibold text-lg text-foreground flex items-center gap-2">
								<Home className="w-5 h-5" /> Shared Homes
							</h2>
							<div className="space-y-6">
								{data!.homes.map((home) => (
									<div key={home.id} className="space-y-3">
										<div className="flex items-center gap-2">
											<h3 className="font-medium text-foreground">{home.name}</h3>
											<Badge variant="outline" className="gap-1">
												<Share2 className="w-3 h-3" /> Shared
											</Badge>
											<span className="text-xs text-muted-foreground">
												by {home.owner.name ?? home.owner.email}
											</span>
										</div>
										{home.devices.length === 0 ? (
											<p className="text-sm text-muted-foreground">No devices in this home.</p>
										) : (
											<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
												{home.devices.map((device) => (
													<DeviceCard
														key={device.id}
														device={device}
														online={onlineStatus[device.id] ?? false}
														checking={pinging[device.id] === true && onlineStatus[device.id] === undefined}
														liveRelayStates={liveRelayStates}
													/>
												))}
											</div>
										)}
									</div>
								))}
							</div>
						</div>
					)}

					{/* Individually shared devices */}
					{hasDevices && (
						<div className="space-y-3">
							<h2 className="font-sora font-semibold text-lg text-foreground flex items-center gap-2">
								<Cpu className="w-5 h-5" /> Shared Devices
							</h2>
							<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
								{data!.devices.map((device) => (
									<DeviceCard
										key={device.id}
										device={device}
										online={onlineStatus[device.id] ?? false}
										checking={pinging[device.id] === true && onlineStatus[device.id] === undefined}
										liveRelayStates={liveRelayStates}
									/>
								))}
							</div>
						</div>
					)}
				</>
			)}
		</div>
	);
}
