"use client";

import { useState } from "react";
import Link from "next/link";
import { Home, Plus, Cpu, Users, ChevronRight, Loader2, DoorOpen } from "lucide-react";
import { api } from "~/trpc/react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog";

export default function HomesPage() {
	const [createOpen, setCreateOpen] = useState(false);
	const [newName, setNewName] = useState("");

	const utils = api.useUtils();
	const { data: homes, isLoading } = api.home.list.useQuery();
	const { data: unassigned } = api.home.unassignedDevices.useQuery();

	const createHome = api.home.create.useMutation({
		onSuccess: () => {
			void utils.home.list.invalidate();
			setCreateOpen(false);
			setNewName("");
		},
	});

	return (
		<div className="p-6 lg:p-8 space-y-6 animate-fade-in mt-14 lg:mt-0">
			{/* Header */}
			<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
				<div>
					<h1 className="font-sora font-extrabold text-2xl lg:text-3xl text-foreground">Homes</h1>
					<p className="text-sm text-muted-foreground mt-1">Organize your devices into homes</p>
				</div>
				<Dialog open={createOpen} onOpenChange={setCreateOpen}>
					<DialogTrigger asChild>
						<Button>
							<Plus className="w-4 h-4" /> Create Home
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Create Home</DialogTitle>
						</DialogHeader>
						<form
							onSubmit={(e) => {
								e.preventDefault();
								if (newName.trim()) createHome.mutate({ name: newName.trim() });
							}}
							className="space-y-4"
						>
							<div className="space-y-2">
								<Label htmlFor="home-name">Name</Label>
								<Input id="home-name" placeholder="e.g. Main House" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} />
							</div>
							<Button type="submit" disabled={!newName.trim() || createHome.isPending} className="w-full">
								{createHome.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
							</Button>
						</form>
					</DialogContent>
				</Dialog>
			</div>

			{/* Home cards */}
			{isLoading ? (
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
					{Array.from({ length: 2 }).map((_, i) => (
						<Card key={i}>
							<CardContent className="p-5 space-y-3">
								<Skeleton className="h-5 w-2/3" />
								<Skeleton className="h-4 w-1/2" />
							</CardContent>
						</Card>
					))}
				</div>
			) : (homes?.length ?? 0) === 0 && (unassigned?.length ?? 0) === 0 ? (
				<Card className="border-dashed">
					<CardContent className="p-12 text-center">
						<Home className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
						<h3 className="font-semibold text-foreground mb-1">No homes yet</h3>
						<p className="text-sm text-muted-foreground">Create a home to organize your devices.</p>
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
					{homes?.map((home) => (
						<Link key={home.id} href={`/dashboard/homes/${home.id}`} className="no-underline group">
							<Card className="h-full transition-all duration-200 hover:border-primary/40 hover:shadow-md cursor-pointer">
								<CardHeader className="pb-3">
									<div className="flex items-start justify-between gap-2">
										<div className="flex items-center gap-2.5 min-w-0">
											<Home className="w-4 h-4 text-primary flex-shrink-0" />
											<CardTitle className="text-base font-semibold truncate">{home.name}</CardTitle>
										</div>
										{home._count.shares > 0 && (
											<Badge variant="outline" className="flex-shrink-0 gap-1">
												<Users className="w-3 h-3" /> {home._count.shares}
											</Badge>
										)}
									</div>
								</CardHeader>
								<CardContent className="pb-4">
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-4">
											<div className="flex items-center gap-1.5">
												<DoorOpen className="w-3.5 h-3.5 text-muted-foreground" />
												<span className="text-xs text-muted-foreground">
													{home._count.rooms} {home._count.rooms === 1 ? "room" : "rooms"}
												</span>
											</div>
											<div className="flex items-center gap-1.5">
												<Cpu className="w-3.5 h-3.5 text-muted-foreground" />
												<span className="text-xs text-muted-foreground">
													{home._count.devices} {home._count.devices === 1 ? "device" : "devices"}
												</span>
											</div>
										</div>
										<ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
									</div>
								</CardContent>
							</Card>
						</Link>
					))}
				</div>
			)}

			{/* Unassigned devices */}
			{(unassigned?.length ?? 0) > 0 && (
				<div className="space-y-3">
					<h2 className="font-sora font-semibold text-lg text-foreground">Unassigned Devices</h2>
					<p className="text-sm text-muted-foreground">These devices are not in any home. Open a home and assign them.</p>
					<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
						{unassigned!.map((device) => (
							<Link key={device.id} href={`/dashboard/devices/${device.id}`} className="no-underline group">
								<Card className="h-full transition-all duration-200 hover:border-primary/40 hover:shadow-md cursor-pointer border-dashed">
									<CardHeader className="pb-3">
										<div className="flex items-center gap-2.5">
											<Cpu className="w-4 h-4 text-muted-foreground flex-shrink-0" />
											<CardTitle className="text-base font-semibold truncate">{device.name}</CardTitle>
										</div>
										<p className="text-xs text-muted-foreground mono break-all">{device.macAddress}</p>
									</CardHeader>
									<CardContent className="pb-4">
										<div className="flex items-center justify-between">
											<span className="text-xs text-muted-foreground">
												{device.relays.length} {device.relays.length === 1 ? "relay" : "relays"}
											</span>
											<ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
										</div>
									</CardContent>
								</Card>
							</Link>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
