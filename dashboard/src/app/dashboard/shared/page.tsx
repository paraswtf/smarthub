"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Home, DoorOpen, Share2, ToggleRight, ChevronRight, Loader2, Plug } from "lucide-react";
import { api, type RouterOutputs } from "~/trpc/react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Skeleton } from "~/components/ui/skeleton";
import { useDeviceSocket } from "~/providers/DeviceSocketProvider";

type SharedData = RouterOutputs["sharing"]["listSharedWithMe"];

export default function SharedPage() {
	const { onDeviceUpdate, onRelayUpdate } = useDeviceSocket();
	const { data, isLoading } = api.sharing.listSharedWithMe.useQuery();

	const [liveRelayStates, setLiveRelayStates] = useState<Record<string, boolean>>({});

	useEffect(() => {
		return onDeviceUpdate((msg) => {
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

	const hasHomes = (data?.homes.length ?? 0) > 0;
	const hasRooms = (data?.rooms.length ?? 0) > 0;
	const hasRelays = (data?.relays.length ?? 0) > 0;
	const isEmpty = !hasHomes && !hasRooms && !hasRelays;

	return (
		<div className="p-6 lg:p-8 space-y-6 animate-fade-in mt-14 lg:mt-0">
			<div>
				<h1 className="font-sora font-extrabold text-2xl lg:text-3xl text-foreground">Shared with me</h1>
				<p className="text-sm text-muted-foreground mt-1">Homes, rooms, and relays others have shared with you</p>
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
						<p className="text-sm text-muted-foreground">When someone shares a home, room, or relay with you, it will appear here.</p>
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
							<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
								{data!.homes.map((home) => (
									<div key={home.id} className="space-y-2">
										<Card className="transition-all duration-200 hover:border-primary/40 hover:shadow-md">
											<CardHeader className="pb-3">
												<div className="flex items-start justify-between gap-2">
													<div className="flex items-center gap-2.5 min-w-0">
														<Home className="w-4 h-4 text-primary flex-shrink-0" />
														<CardTitle className="text-base font-semibold truncate">{home.name}</CardTitle>
													</div>
													<Badge variant="outline" className="gap-1 flex-shrink-0">
														<Share2 className="w-3 h-3" /> Shared
													</Badge>
												</div>
												<p className="text-xs text-muted-foreground">by {home.owner.name ?? home.owner.email}</p>
											</CardHeader>
											<CardContent className="pb-4 space-y-2">
												{home.rooms.length === 0 ? (
													<p className="text-xs text-muted-foreground">No rooms</p>
												) : (
													home.rooms.map((room) => {
														const relays = room.relays.map((r) => ({
															...r,
															state: liveRelayStates[r.id] ?? r.state
														}));
														const active = relays.filter((r) => r.state).length;
														return (
															<Link key={room.id} href={`/dashboard/rooms/${room.id}`} className="flex items-center justify-between p-2 rounded-lg hover:bg-accent transition-colors no-underline">
																<div className="flex items-center gap-2">
																	<DoorOpen className="w-3.5 h-3.5 text-muted-foreground" />
																	<span className="text-sm">{room.name}</span>
																	<span className="text-xs text-muted-foreground">
																		{relays.length > 0 && `${active}/${relays.length} active`}
																	</span>
																</div>
																<ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
															</Link>
														);
													})
												)}
											</CardContent>
										</Card>
									</div>
								))}
							</div>
						</div>
					)}

					{/* Shared Rooms */}
					{hasRooms && (
						<div className="space-y-3">
							<h2 className="font-sora font-semibold text-lg text-foreground flex items-center gap-2">
								<DoorOpen className="w-5 h-5" /> Shared Rooms
							</h2>
							<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
								{data!.rooms.map((room) => {
									const relays = room.relays.map((r) => ({
										...r,
										state: liveRelayStates[r.id] ?? r.state
									}));
									const active = relays.filter((r) => r.state).length;
									return (
										<Link key={room.id} href={`/dashboard/rooms/${room.id}`} className="no-underline group">
											<Card className="h-full transition-all duration-200 hover:border-primary/40 hover:shadow-md cursor-pointer">
												<CardHeader className="pb-3">
													<div className="flex items-start justify-between gap-2">
														<div className="flex items-center gap-2.5 min-w-0">
															<DoorOpen className="w-4 h-4 text-primary flex-shrink-0" />
															<CardTitle className="text-base font-semibold truncate">{room.name}</CardTitle>
														</div>
														<Badge variant="outline" className="gap-1 flex-shrink-0">
															<Share2 className="w-3 h-3" /> Shared
														</Badge>
													</div>
													<p className="text-xs text-muted-foreground">
														in {room.home.name} &middot; by {room.owner.name ?? room.owner.email}
													</p>
												</CardHeader>
												<CardContent className="pb-4">
													<div className="flex items-center justify-between">
														<span className="text-xs text-muted-foreground">
															{relays.length === 0 ? "No relays" : `${active} / ${relays.length} relays active`}
														</span>
														<ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
													</div>
												</CardContent>
											</Card>
										</Link>
									);
								})}
							</div>
						</div>
					)}

					{/* Shared Relays */}
					{hasRelays && (
						<div className="space-y-3">
							<h2 className="font-sora font-semibold text-lg text-foreground flex items-center gap-2">
								<ToggleRight className="w-5 h-5" /> Shared Relays
							</h2>
							<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
								{data!.relays.map((relay) => {
									const state = liveRelayStates[relay.id] ?? relay.state;
									return (
										<Card key={relay.id} className={`transition-all duration-200 ${state ? "border-primary/30" : ""}`}>
											<CardContent className="p-5">
												<div className="flex items-center justify-between">
													<div className="flex items-center gap-3">
														<div className={`w-8 h-8 rounded-lg flex items-center justify-center ${state ? "bg-primary/15" : "bg-muted"}`}>
															<Plug className={`w-4 h-4 ${state ? "text-primary" : "text-muted-foreground"}`} />
														</div>
														<div>
															<p className="font-semibold text-sm">{relay.label}</p>
															<p className="text-xs text-muted-foreground">
																{relay.device.name} &middot; by {relay.owner.name ?? relay.owner.email}
															</p>
														</div>
													</div>
													<Badge variant="outline" className="gap-1">
														<Share2 className="w-3 h-3" /> Shared
													</Badge>
												</div>
												<div className="mt-2 flex items-center gap-2">
													<span className={`w-2 h-2 rounded-full ${state ? "bg-green-500" : "bg-gray-400"}`} />
													<span className="text-xs text-muted-foreground">{state ? "On" : "Off"}</span>
												</div>
											</CardContent>
										</Card>
									);
								})}
							</div>
						</div>
					)}
				</>
			)}
		</div>
	);
}
