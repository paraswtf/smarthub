"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Cpu, Zap, Key, Wifi, WifiOff, ToggleRight, Home, DoorOpen, ChevronRight } from "lucide-react";
import Link from "next/link";
import { api, type RouterOutputs } from "~/trpc/react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { useDeviceSocket } from "~/providers/DeviceSocketProvider";
import { appConfig } from "../../../globals.config";

export default function DashboardOverviewClient({ userName }: { userName?: string | null }) {
	const utils = api.useUtils();
	const utilsRef = useRef(utils);
	utilsRef.current = utils;

	const { connected: wsConnected, onDeviceUpdate, onRelayUpdate } = useDeviceSocket();

	const [liveRelayStates, setLiveRelayStates] = useState<Record<string, boolean>>({});

	useEffect(() => {
		const unsub = onDeviceUpdate((msg) => {
			setLiveRelayStates((p) => {
				const next = { ...p };
				msg.relays.forEach((r) => {
					next[r.id] = r.state;
				});
				return next;
			});
		});
		return unsub;
	}, [onDeviceUpdate]);

	useEffect(() => {
		const unsub = onRelayUpdate((msg) => {
			setLiveRelayStates((p) => ({ ...p, [msg.relayId]: msg.state }));
		});
		return unsub;
	}, [onRelayUpdate]);

	// Online status per device
	const [onlineStatus, setOnlineStatus] = useState<Record<string, boolean>>({});

	// device_update = device just authenticated → it's online
	useEffect(() => {
		return onDeviceUpdate((msg) => {
			setOnlineStatus((p) => ({ ...p, [msg.deviceId]: true }));
		});
	}, [onDeviceUpdate]);

	const { data: devices, isLoading: devicesLoading } = api.device.list.useQuery(undefined, {
		refetchInterval: wsConnected ? false : 30_000,
	});
	const { data: homes, isLoading: homesLoading } = api.home.list.useQuery();

	const pingMutation = api.device.pingDevice.useMutation();

	// Ping all devices on initial load
	const pingAll = useCallback(async (deviceList: { id: string }[]) => {
		await Promise.all(
			deviceList.map(async (d) => {
				try {
					const result = await pingMutation.mutateAsync({ deviceId: d.id });
					setOnlineStatus((p) => ({ ...p, [d.id]: result.online }));
				} catch {
					setOnlineStatus((p) => ({ ...p, [d.id]: false }));
				}
			}),
		);
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		if (devices?.length) {
			void pingAll(devices);
		}
	}, [devices?.length]); // eslint-disable-line react-hooks/exhaustive-deps

	const greeting = () => {
		const h = new Date().getHours();
		if (h < 12) return "Good morning";
		if (h < 17) return "Good afternoon";
		return "Good evening";
	};

	type DeviceListItem = RouterOutputs["device"]["list"][number];
	type RelayItem = DeviceListItem["relays"][number];

	const mergedDevices = (devices ?? ([] as DeviceListItem[])).map((d: DeviceListItem) => ({
		...d,
		online: onlineStatus[d.id] ?? false,
		relays: d.relays.map((r: RelayItem) => ({
			...r,
			state: liveRelayStates[r.id] ?? r.state,
		})),
	}));

	const onlineCount = mergedDevices.filter((d) => d.online).length;
	const relayCount = mergedDevices.reduce((n, d) => n + d.relays.length, 0);
	const activeRelays = mergedDevices.reduce((n, d) => n + d.relays.filter((r) => r.state).length, 0);
	const deviceCount = mergedDevices.length;
	const homeCount = (homes ?? []).length;
	const roomCount = (homes ?? []).reduce((n, h) => n + (h._count?.rooms ?? 0), 0);

	const STAT_CARDS = [
		{ label: "Homes", value: homeCount, icon: Home, sub: `${roomCount} rooms` },
		{ label: "Rooms", value: roomCount, icon: DoorOpen, sub: `${relayCount} relays` },
		{ label: "Active Relays", value: activeRelays, icon: ToggleRight, sub: `of ${relayCount} configured` },
		{ label: "Devices Online", value: onlineCount, icon: Wifi, sub: deviceCount > 0 ? `${Math.round((onlineCount / deviceCount) * 100)}% uptime` : "—" },
	];

	return (
		<div className="p-6 lg:p-8 space-y-8 animate-fade-in mt-14 lg:mt-0">
			{/* Header */}
			<div>
				<h1 className="font-sora font-extrabold text-2xl lg:text-3xl text-foreground">
					{greeting()}, {userName?.split(" ")[0] ?? "there"} 👋
				</h1>
				<p className="text-muted-foreground mt-1 text-sm">Here&apos;s what&apos;s happening with your {appConfig.name} system.</p>
			</div>

			{/* Stat cards */}
			<div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
				{STAT_CARDS.map(({ label, value, icon: Icon, sub }) => (
					<Card key={label} className="relative overflow-hidden">
						<CardContent className="p-5">
							<div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
								<Icon className="w-4 h-4 text-primary" />
							</div>
							{devicesLoading || homesLoading ? <Skeleton className="h-8 w-12 mb-1" /> : <p className="font-sora font-extrabold text-3xl text-foreground">{value}</p>}
							<p className="text-xs font-semibold text-foreground mt-0.5">{label}</p>
							<p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
						</CardContent>
						<div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/30" />
					</Card>
				))}
			</div>

			{/* Empty state */}
			{!devicesLoading && deviceCount === 0 && (
				<Card className="border-dashed border-primary/40 bg-primary/5">
					<CardContent className="p-8 text-center">
						<div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
							<Cpu className="w-7 h-7 text-primary" />
						</div>
						<h3 className="font-sora font-bold text-lg text-foreground mb-2">No devices yet</h3>
						<p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">Create an API key, then flash it to your ESP32 via the captive portal to get started.</p>
						<div className="flex flex-wrap gap-3 justify-center">
							<Button asChild>
								<Link href="/dashboard/api-keys">Generate API Key</Link>
							</Button>
							<Button variant="outline" asChild>
								<Link href="/dashboard/homes">View Homes</Link>
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Homes grid */}
			{homesLoading ? (
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
					{Array.from({ length: 3 }).map((_, i) => (
						<Card key={i}>
							<CardContent className="p-5 space-y-3">
								<Skeleton className="h-5 w-2/3" />
								<Skeleton className="h-4 w-1/2" />
								<Skeleton className="h-4 w-1/3" />
							</CardContent>
						</Card>
					))}
				</div>
			) : (homes ?? []).length > 0 ? (
				<div>
					<div className="flex items-center justify-between mb-4">
						<h2 className="font-sora font-bold text-lg text-foreground">Your Homes</h2>
						<Button variant="outline" size="sm" asChild>
							<Link href="/dashboard/homes">View all</Link>
						</Button>
					</div>

					<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
						{(homes ?? []).slice(0, 6).map((home) => (
							<Link key={home.id} href={`/dashboard/homes/${home.id}`} className="no-underline group">
								<Card className="transition-all duration-200 hover:border-primary/40 hover:shadow-md cursor-pointer">
									<CardHeader className="pb-3">
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2.5">
												<Home className="w-4 h-4 text-primary" />
												<CardTitle className="text-base font-semibold">{home.name}</CardTitle>
											</div>
											<ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
										</div>
									</CardHeader>
									<CardContent className="pb-4">
										<div className="flex items-center gap-4 text-xs text-muted-foreground">
											<span className="flex items-center gap-1">
												<DoorOpen className="w-3.5 h-3.5" /> {home._count.rooms} {home._count.rooms === 1 ? "room" : "rooms"}
											</span>
											<span className="flex items-center gap-1">
												<Cpu className="w-3.5 h-3.5" /> {home._count.devices} {home._count.devices === 1 ? "device" : "devices"}
											</span>
										</div>
									</CardContent>
								</Card>
							</Link>
						))}
					</div>
				</div>
			) : null}

			{/* Setup guide */}
			<Card className="bg-card">
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<Zap className="w-4 h-4 text-primary" />
						Quick Setup Guide
					</CardTitle>
				</CardHeader>
				<CardContent>
					<ol className="space-y-3">
						{[
							{ n: 1, text: "Generate an API Key from the API Keys page" },
							{ n: 2, text: "Power on your ESP32 — it starts in Config Mode (AP: ESP-Hub-Setup)" },
							{ n: 3, text: "Connect to the ESP32 WiFi and open the captive portal (192.168.4.1)" },
							{ n: 4, text: "Enter your home WiFi credentials, give the device a name, and paste your API key" },
							{ n: 5, text: "Save — the ESP32 will reboot, connect, and appear in your dashboard" },
							{ n: 6, text: "Create a home, add rooms, and assign relays to organize your controls" },
						].map(({ n, text }) => (
							<li key={n} className="flex items-start gap-3">
								<span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-bold flex items-center justify-center mt-0.5">{n}</span>
								<span className="text-sm text-muted-foreground">{text}</span>
							</li>
						))}
					</ol>
				</CardContent>
			</Card>
		</div>
	);
}
