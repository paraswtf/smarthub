"use client";

import { useState } from "react";
import { Plus, Copy, Trash2, Eye, EyeOff, Loader2, Key, Check, AlertTriangle } from "lucide-react";
import { api, type RouterOutputs } from "~/trpc/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";
import { Skeleton } from "~/components/ui/skeleton";
import { Separator } from "~/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "~/components/ui/dialog";
import { cn, timeAgo } from "~/lib/utils";

export default function ApiKeysPage() {
	const utils = api.useUtils();
	const { data: keys, isLoading } = api.apiKey.list.useQuery();

	const [createOpen, setCreateOpen] = useState(false);
	const [newLabel, setNewLabel] = useState("");
	const [createdKey, setCreatedKey] = useState<string | null>(null);
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const [revokeId, setRevokeId] = useState<string | null>(null);
	const [deleteId, setDeleteId] = useState<string | null>(null);
	const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());

	const createKey = api.apiKey.create.useMutation({
		onSuccess: (data) => {
			void utils.apiKey.list.invalidate();
			setCreatedKey(data.key);
			setNewLabel("");
		},
	});

	const revokeKey = api.apiKey.revoke.useMutation({
		onSuccess: () => {
			void utils.apiKey.list.invalidate();
			setRevokeId(null);
		},
	});

	const deleteKey = api.apiKey.delete.useMutation({
		onSuccess: () => {
			void utils.apiKey.list.invalidate();
			setDeleteId(null);
		},
	});

	const copyToClipboard = async (text: string, id: string) => {
		await navigator.clipboard.writeText(text);
		setCopiedId(id);
		setTimeout(() => setCopiedId(null), 2000);
	};

	const toggleReveal = (id: string) => {
		setRevealedIds((prev) => {
			const next = new Set(prev);
			next.has(id) ? next.delete(id) : next.add(id);
			return next;
		});
	};

	const maskKey = (key: string) => `${key.slice(0, 8)}${"•".repeat(28)}${key.slice(-4)}`;

	return (
		<div className="p-6 lg:p-8 space-y-6 animate-fade-in mt-14 lg:mt-0">
			{/* Header */}
			<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
				<div>
					<h1 className="font-sora font-extrabold text-2xl lg:text-3xl text-foreground">API Keys</h1>
					<p className="text-sm text-muted-foreground mt-1">Each key links ESP32 devices to your account. Flash the key via the captive portal.</p>
				</div>
				<Button onClick={() => setCreateOpen(true)}>
					<Plus className="w-4 h-4" /> New API Key
				</Button>
			</div>

			{/* Info banner */}
			<Card className="border-primary/30 bg-primary/5">
				<CardContent className="p-4 flex gap-3 items-start">
					<Key className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
					<div className="text-sm text-muted-foreground space-y-1">
						<p>
							<span className="font-semibold text-foreground">How it works:</span> Create an API key and give it a label. Enter it in your ESP32&apos;s captive portal. Multiple ESP32
							devices can share the same key — they&apos;ll all appear under your account.
						</p>
						<p>Keep your keys private. Revoking a key disconnects all devices using it.</p>
					</div>
				</CardContent>
			</Card>

			{/* Keys list */}
			{isLoading ? (
				<div className="space-y-3">
					{Array.from({ length: 2 }).map((_, i) => (
						<Card key={i}>
							<CardContent className="p-5 space-y-3">
								<Skeleton className="h-5 w-1/3" />
								<Skeleton className="h-4 w-2/3" />
								<Skeleton className="h-4 w-1/4" />
							</CardContent>
						</Card>
					))}
				</div>
			) : !keys?.length ? (
				<Card className="border-dashed">
					<CardContent className="p-12 text-center">
						<div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
							<Key className="w-7 h-7 text-primary" />
						</div>
						<h3 className="font-sora font-bold text-lg text-foreground mb-2">No API keys yet</h3>
						<p className="text-sm text-muted-foreground mb-6 max-w-xs mx-auto">Create your first API key to start connecting ESP32 devices.</p>
						<Button onClick={() => setCreateOpen(true)}>
							<Plus className="w-4 h-4" /> Create API Key
						</Button>
					</CardContent>
				</Card>
			) : (
				<div className="space-y-3">
					{keys.map((k: RouterOutputs["apiKey"]["list"][number]) => {
						const revealed = revealedIds.has(k.id);
						const copied = copiedId === k.id;
						return (
							<Card key={k.id} className={cn("transition-all duration-200", !k.active && "opacity-60")}>
								<CardContent className="p-5">
									<div className="flex flex-col sm:flex-row sm:items-start gap-4">
										{/* Key info */}
										<div className="flex-1 min-w-0 space-y-2">
											<div className="flex items-center gap-2 flex-wrap">
												<span className="font-semibold text-foreground">{k.label}</span>
												<Badge variant={k.active ? "online" : "offline"}>{k.active ? "Active" : "Revoked"}</Badge>
												<Badge variant="secondary" className="text-xs">
													{k._count.devices} device{k._count.devices !== 1 ? "s" : ""}
												</Badge>
											</div>

											{/* Key value row */}
											<div className="flex items-center gap-2">
												<code className="mono text-xs bg-muted px-2.5 py-1.5 rounded-md text-foreground flex-1 truncate">{revealed ? k.key : maskKey(k.key)}</code>
												<button
													onClick={() => toggleReveal(k.id)}
													className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 p-1"
													title={revealed ? "Hide key" : "Reveal key"}
												>
													{revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
												</button>
												<button
													onClick={() => copyToClipboard(k.key, k.id)}
													className={cn("flex-shrink-0 p-1 transition-colors", copied ? "text-primary" : "text-muted-foreground hover:text-foreground")}
													title="Copy to clipboard"
												>
													{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
												</button>
											</div>

											<p className="text-xs text-muted-foreground">
												Created {timeAgo(k.createdAt)}
												{k.lastUsedAt && ` · Last used ${timeAgo(k.lastUsedAt)}`}
											</p>
										</div>

										<Separator orientation="vertical" className="hidden sm:block h-auto self-stretch" />

										{/* Actions */}
										<div className="flex sm:flex-col gap-2 flex-shrink-0">
											{k.active && (
												<Button
													variant="outline"
													size="sm"
													className="text-amber-600 hover:text-amber-600 border-amber-500/30 hover:bg-amber-500/10"
													onClick={() => setRevokeId(k.id)}
												>
													<AlertTriangle className="w-3.5 h-3.5" />
													Revoke
												</Button>
											)}
											<Button variant="outline" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteId(k.id)}>
												<Trash2 className="w-3.5 h-3.5" />
												Delete
											</Button>
										</div>
									</div>
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}

			{/* Create key dialog */}
			<Dialog
				open={createOpen}
				onOpenChange={(o) => {
					if (!o) {
						setCreateOpen(false);
						setCreatedKey(null);
						setNewLabel("");
					}
				}}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Create API Key</DialogTitle>
						<DialogDescription>Give this key a descriptive label so you can identify it later.</DialogDescription>
					</DialogHeader>

					{createdKey ? (
						<div className="space-y-4">
							<div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
								<p className="text-xs font-semibold text-primary mb-2 flex items-center gap-1.5">
									<Check className="w-3.5 h-3.5" /> Key created — copy it now
								</p>
								<p className="text-xs text-muted-foreground mb-3">This is the only time you&apos;ll see the full key. Store it safely.</p>
								<div className="flex items-center gap-2">
									<code className="mono text-xs bg-background px-3 py-2 rounded-md border flex-1 break-all text-foreground">{createdKey}</code>
									<button
										onClick={() => copyToClipboard(createdKey, "new")}
										className={cn(
											"p-2 rounded-md transition-colors flex-shrink-0",
											copiedId === "new" ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted",
										)}
									>
										{copiedId === "new" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
									</button>
								</div>
							</div>
							<DialogFooter>
								<Button
									className="w-full"
									onClick={() => {
										setCreateOpen(false);
										setCreatedKey(null);
									}}
								>
									Done
								</Button>
							</DialogFooter>
						</div>
					) : (
						<div className="space-y-4">
							<div className="space-y-1.5">
								<Label htmlFor="key-label">Key Label</Label>
								<Input
									id="key-label"
									value={newLabel}
									onChange={(e) => setNewLabel(e.target.value)}
									placeholder="e.g. Living Room Board, Bedroom ESP32"
									onKeyDown={(e) => e.key === "Enter" && newLabel && createKey.mutate({ label: newLabel })}
									autoFocus
								/>
							</div>
							<DialogFooter>
								<Button variant="outline" onClick={() => setCreateOpen(false)}>
									Cancel
								</Button>
								<Button onClick={() => createKey.mutate({ label: newLabel })} disabled={createKey.isPending || !newLabel.trim()}>
									{createKey.isPending ? (
										<>
											<Loader2 className="w-4 h-4 animate-spin" /> Generating…
										</>
									) : (
										<>
											<Key className="w-4 h-4" /> Generate
										</>
									)}
								</Button>
							</DialogFooter>
						</div>
					)}
				</DialogContent>
			</Dialog>

			{/* Revoke dialog */}
			<Dialog open={!!revokeId} onOpenChange={(o) => !o && setRevokeId(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Revoke API Key</DialogTitle>
						<DialogDescription>
							This will immediately disconnect all ESP32 devices using this key. The key will be deactivated but kept for reference. You can delete it afterwards.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setRevokeId(null)}>
							Cancel
						</Button>
						<Button className="bg-amber-600 hover:bg-amber-500 text-white" onClick={() => revokeId && revokeKey.mutate({ id: revokeId })} disabled={revokeKey.isPending}>
							{revokeKey.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
							Revoke Key
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete dialog */}
			<Dialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete API Key</DialogTitle>
						<DialogDescription>This will permanently delete the key and unlink all devices associated with it. This cannot be undone.</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDeleteId(null)}>
							Cancel
						</Button>
						<Button variant="destructive" onClick={() => deleteId && deleteKey.mutate({ id: deleteId })} disabled={deleteKey.isPending}>
							{deleteKey.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
							Delete Key
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
