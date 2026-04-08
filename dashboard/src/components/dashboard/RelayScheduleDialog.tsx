"use client";

import { useState } from "react";
import { Clock, Plus, Pencil, Trash2, Loader2, Power, PowerOff } from "lucide-react";
import { api } from "~/trpc/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

interface Props {
	relayId: string;
	relayLabel: string;
	scheduleCount?: number;
}

export function RelayScheduleDialog({ relayId, relayLabel, scheduleCount }: Props) {
	const [open, setOpen] = useState(false);
	const [editing, setEditing] = useState<string | null>(null); // schedule ID or "new"

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				setOpen(o);
				if (!o) setEditing(null);
			}}
		>
			<DialogTrigger asChild>
				<Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary relative" title="Schedules">
					<Clock className="w-3.5 h-3.5" />
					{(scheduleCount ?? 0) > 0 && (
						<span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-primary text-[9px] text-primary-foreground flex items-center justify-center font-bold">
							{scheduleCount}
						</span>
					)}
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="text-base">Schedules - {relayLabel}</DialogTitle>
				</DialogHeader>
				{editing ? (
					<ScheduleForm relayId={relayId} scheduleId={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
				) : (
					<ScheduleList relayId={relayId} onEdit={(id) => setEditing(id)} onAdd={() => setEditing("new")} />
				)}
			</DialogContent>
		</Dialog>
	);
}

function ScheduleList({ relayId, onEdit, onAdd }: { relayId: string; onEdit: (id: string) => void; onAdd: () => void }) {
	const utils = api.useUtils();
	const { data: schedules, isLoading } = api.schedule.list.useQuery({ relayId });

	const toggleMutation = api.schedule.toggle.useMutation({
		onSuccess: () => void utils.schedule.list.invalidate({ relayId }),
	});

	const deleteMutation = api.schedule.delete.useMutation({
		onSuccess: () => {
			void utils.schedule.list.invalidate({ relayId });
			void utils.room.get.invalidate();
		},
	});

	if (isLoading) {
		return (
			<div className="space-y-3">
				{Array.from({ length: 2 }).map((_, i) => (
					<div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
				))}
			</div>
		);
	}

	if (!schedules?.length) {
		return (
			<div className="text-center py-6">
				<Clock className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
				<p className="text-sm text-muted-foreground mb-4">No schedules yet</p>
				<Button onClick={onAdd} size="sm">
					<Plus className="w-3.5 h-3.5" /> Add Schedule
				</Button>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{schedules.map((s) => (
				<div key={s.id} className={cn("flex items-center gap-3 p-3 rounded-lg border transition-colors", s.enabled ? "" : "opacity-50")}>
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2 mb-1">
							<span className="font-mono font-bold text-lg text-foreground">
								{String(s.hour).padStart(2, "0")}:{String(s.minute).padStart(2, "0")}
							</span>
							<Badge variant={s.action ? "default" : "outline"} className="text-[10px] px-1.5 py-0">
								{s.action ? "ON" : "OFF"}
							</Badge>
						</div>
						<div className="flex items-center gap-1">
							{DAY_LABELS.map((label, i) => (
								<span
									key={i}
									className={cn(
										"w-5 h-5 rounded-full text-[10px] font-semibold flex items-center justify-center",
										s.daysOfWeek.includes(i) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
									)}
								>
									{label}
								</span>
							))}
							{s.label !== "Schedule" && <span className="text-xs text-muted-foreground ml-2 truncate">{s.label}</span>}
						</div>
					</div>
					<Switch checked={s.enabled} onCheckedChange={(enabled) => toggleMutation.mutate({ id: s.id, enabled })} className="flex-shrink-0" />
					<Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={() => onEdit(s.id)}>
						<Pencil className="w-3 h-3" />
					</Button>
					<Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0 text-destructive" onClick={() => deleteMutation.mutate({ id: s.id })} disabled={deleteMutation.isPending}>
						<Trash2 className="w-3 h-3" />
					</Button>
				</div>
			))}
			<Button onClick={onAdd} variant="outline" className="w-full" size="sm">
				<Plus className="w-3.5 h-3.5" /> Add Schedule
			</Button>
		</div>
	);
}

function ScheduleForm({ relayId, scheduleId, onDone }: { relayId: string; scheduleId: string | null; onDone: () => void }) {
	const utils = api.useUtils();
	const { data: schedules } = api.schedule.list.useQuery({ relayId });
	const existing = scheduleId ? schedules?.find((s) => s.id === scheduleId) : null;

	const [label, setLabel] = useState(existing?.label ?? "");
	const [hour, setHour] = useState(existing?.hour ?? 8);
	const [minute, setMinute] = useState(existing?.minute ?? 0);
	const [days, setDays] = useState<number[]>(existing?.daysOfWeek ?? [1, 2, 3, 4, 5]); // default weekdays
	const [action, setAction] = useState(existing?.action ?? true);

	const toggleDay = (d: number) => {
		setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
	};

	const createMutation = api.schedule.create.useMutation({
		onSuccess: () => {
			void utils.schedule.list.invalidate({ relayId });
			void utils.room.get.invalidate();
			onDone();
		},
	});

	const updateMutation = api.schedule.update.useMutation({
		onSuccess: () => {
			void utils.schedule.list.invalidate({ relayId });
			onDone();
		},
	});

	const isPending = createMutation.isPending || updateMutation.isPending;

	const handleSubmit = () => {
		if (days.length === 0) return;
		if (scheduleId) {
			updateMutation.mutate({ id: scheduleId, label: label || "Schedule", hour, minute, daysOfWeek: days, action });
		} else {
			createMutation.mutate({ relayId, label: label || undefined, hour, minute, daysOfWeek: days, action });
		}
	};

	return (
		<div className="space-y-4">
			{/* Time */}
			<div className="space-y-2">
				<Label>Time</Label>
				<div className="flex items-center gap-2">
					<select
						value={hour}
						onChange={(e) => setHour(Number(e.target.value))}
						className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono"
					>
						{Array.from({ length: 24 }, (_, i) => (
							<option key={i} value={i}>
								{String(i).padStart(2, "0")}
							</option>
						))}
					</select>
					<span className="text-lg font-bold text-muted-foreground">:</span>
					<select
						value={minute}
						onChange={(e) => setMinute(Number(e.target.value))}
						className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono"
					>
						{Array.from({ length: 60 }, (_, i) => (
							<option key={i} value={i}>
								{String(i).padStart(2, "0")}
							</option>
						))}
					</select>
				</div>
			</div>

			{/* Days */}
			<div className="space-y-2">
				<Label>Repeat on</Label>
				<div className="flex gap-1.5">
					{DAY_NAMES.map((name, i) => (
						<button
							key={i}
							type="button"
							onClick={() => toggleDay(i)}
							className={cn(
								"w-9 h-9 rounded-full text-xs font-semibold transition-colors",
								days.includes(i) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent",
							)}
						>
							{DAY_LABELS[i]}
						</button>
					))}
				</div>
				{days.length === 0 && <p className="text-xs text-destructive">Select at least one day</p>}
			</div>

			{/* Action */}
			<div className="space-y-2">
				<Label>Action</Label>
				<div className="flex gap-2">
					<Button type="button" variant={action ? "default" : "outline"} size="sm" onClick={() => setAction(true)} className="flex-1">
						<Power className="w-3.5 h-3.5" /> Turn ON
					</Button>
					<Button type="button" variant={!action ? "default" : "outline"} size="sm" onClick={() => setAction(false)} className="flex-1">
						<PowerOff className="w-3.5 h-3.5" /> Turn OFF
					</Button>
				</div>
			</div>

			{/* Label */}
			<div className="space-y-2">
				<Label>Label (optional)</Label>
				<Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Morning lights" maxLength={60} />
			</div>

			{/* Actions */}
			<div className="flex gap-2">
				<Button onClick={handleSubmit} disabled={isPending || days.length === 0} className="flex-1">
					{isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : scheduleId ? "Save" : "Create"}
				</Button>
				<Button variant="outline" onClick={onDone} className="flex-1">
					Cancel
				</Button>
			</div>
		</div>
	);
}
