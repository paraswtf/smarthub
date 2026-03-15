"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Pencil, Trash2, Plus, Save, X, Loader2,
  Lightbulb, Fan, Plug, Wind, Tv, Coffee, Thermometer, Radio,
  Wifi, WifiOff, ServerCrash
} from "lucide-react";
import { api } from "~/trpc/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";
import { Switch } from "~/components/ui/switch";
import { Skeleton } from "~/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "~/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import { cn, timeAgo } from "~/lib/utils";
import { appConfig } from "../../../../../globals.config";

const RELAY_ICONS: Record<string, React.ElementType> = {
  lightbulb: Lightbulb, fan: Fan, plug: Plug, wind: Wind,
  tv: Tv, coffee: Coffee, thermometer: Thermometer, radio: Radio,
};

const ICON_OPTIONS = Object.keys(RELAY_ICONS);

export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const utils = api.useUtils();

  // Data
  const { data: device, isLoading } = api.device.get.useQuery({ id }, {
    refetchInterval: 8_000,
  });

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

  // Delete confirm
  const [deleteDeviceOpen, setDeleteDeviceOpen] = useState(false);
  const [deleteRelayId, setDeleteRelayId] = useState<string | null>(null);

  // Mutations
  const updateDevice = api.device.update.useMutation({ onSuccess: () => { void utils.device.get.invalidate({ id }); setEditingDevice(false); } });
  const deleteDevice = api.device.delete.useMutation({ onSuccess: () => router.push("/dashboard/devices") });
  const toggleRelay = api.device.toggleRelay.useMutation({ onSuccess: () => void utils.device.get.invalidate({ id }) });
  const addRelay = api.device.addRelay.useMutation({ onSuccess: () => { void utils.device.get.invalidate({ id }); setAddingRelay(false); setNewRelay({ pin: 2, label: "", icon: "plug" }); } });
  const updateRelay = api.device.updateRelay.useMutation({ onSuccess: () => { void utils.device.get.invalidate({ id }); setEditingRelayId(null); } });
  const deleteRelay = api.device.deleteRelay.useMutation({ onSuccess: () => { void utils.device.get.invalidate({ id }); setDeleteRelayId(null); } });

  if (isLoading) return (
    <div className="p-6 lg:p-8 space-y-6">
      <Skeleton className="h-8 w-1/3" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
      </div>
    </div>
  );

  if (!device) return (
    <div className="p-6 lg:p-8 text-center pt-20">
      <ServerCrash className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
      <h2 className="font-sora font-bold text-xl text-foreground">Device not found</h2>
      <Button variant="outline" className="mt-4" onClick={() => router.back()}>Go back</Button>
    </div>
  );

  const startEditDevice = () => {
    setDeviceName(device.name);
    setDeviceNotes(device.notes ?? "");
    setEditingDevice(true);
  };

  const startEditRelay = (relay: typeof device.relays[0]) => {
    setEditRelay({ label: relay.label, icon: relay.icon, pin: relay.pin });
    setEditingRelayId(relay.id);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 animate-fade-in">
      {/* Breadcrumb + Header */}
      <div className="pt-2 lg:pt-0">
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
              <Button variant="ghost" onClick={() => setEditingDevice(false)}>
                <X className="w-4 h-4" /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="font-sora font-extrabold text-2xl lg:text-3xl text-foreground">{device.name}</h1>
                <Badge variant={device.online ? "online" : "offline"}>
                  {device.online ? "Online" : "Offline"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mono mt-1">{device.macAddress}</p>
              {device.notes && <p className="text-sm text-muted-foreground mt-1">{device.notes}</p>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={startEditDevice}>
                <Pencil className="w-3.5 h-3.5" /> Edit
              </Button>
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteDeviceOpen(true)}>
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Status",       value: device.online ? "Online" : "Offline", icon: device.online ? Wifi : WifiOff, colored: device.online },
          { label: "Last Seen",    value: timeAgo(device.lastSeenAt),            icon: Radio, colored: false },
          { label: "Firmware",     value: device.firmwareVersion ?? "Unknown",   icon: Radio, colored: false },
          { label: "Network",      value: device.ssid ?? "Unknown",              icon: Wifi, colored: false },
        ].map(({ label, value, icon: Icon, colored }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <Icon className={cn("w-4 h-4 mb-2", colored ? "text-primary" : "text-muted-foreground")} />
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">{label}</p>
              <p className={cn("text-sm font-semibold mt-0.5", colored ? "text-primary" : "text-foreground")}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs: Relays + Config */}
      <Tabs defaultValue="relays">
        <TabsList>
          <TabsTrigger value="relays">Relays ({device.relays.length}/{appConfig.maxRelaysPerDevice})</TabsTrigger>
          <TabsTrigger value="config">Device Config</TabsTrigger>
        </TabsList>

        {/* RELAYS TAB */}
        <TabsContent value="relays" className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {device.relays.map((relay) => {
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
                            min={0} max={39}
                          />
                        </div>
                        <div className="flex-1">
                          <Label className="text-[10px]">Icon</Label>
                          <select
                            value={editRelay.icon}
                            onChange={(e) => setEditRelay((r) => ({ ...r, icon: e.target.value }))}
                            className="h-8 w-full mt-0.5 text-sm rounded-md border border-input bg-background px-2 focus:outline-none focus:ring-2 focus:ring-ring"
                          >
                            {ICON_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
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
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingRelayId(null)}>Cancel</Button>
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
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                          relay.state ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                        )}>
                          <IconComp className="w-5 h-5" />
                        </div>
                        <Switch
                          checked={relay.state}
                          onCheckedChange={(checked) =>
                            toggleRelay.mutate({ relayId: relay.id, state: checked })
                          }
                          disabled={!device.online || toggleRelay.isPending}
                        />
                      </div>
                      <p className="font-semibold text-sm text-foreground leading-tight">{relay.label}</p>
                      <p className="text-xs text-muted-foreground mono mt-0.5">GPIO {relay.pin}</p>
                      <div className="flex items-center justify-between mt-3">
                        <span className={cn(
                          "text-xs font-semibold",
                          relay.state ? "text-primary" : "text-muted-foreground"
                        )}>
                          {relay.state ? "● ON" : "○ OFF"}
                        </span>
                        <button
                          onClick={() => startEditRelay(relay)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            {/* Add relay card */}
            {device.relays.length < appConfig.maxRelaysPerDevice && (
              <div
                className="relay-card p-4 border-dashed flex flex-col items-center justify-center min-h-[140px] hover:border-primary/50 hover:bg-primary/5"
                onClick={() => !addingRelay && setAddingRelay(true)}
              >
                {addingRelay ? (
                  <div className="w-full space-y-2.5" onClick={(e) => e.stopPropagation()}>
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
                          min={0} max={39}
                        />
                      </div>
                      <div className="flex-1">
                        <Label className="text-[10px]">Icon</Label>
                        <select
                          value={newRelay.icon}
                          onChange={(e) => setNewRelay((r) => ({ ...r, icon: e.target.value }))}
                          className="h-8 w-full mt-0.5 text-sm rounded-md border border-input bg-background px-2 focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          {ICON_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
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
                        {addRelay.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Plus className="w-3 h-3" /> Add</>}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAddingRelay(false)}>Cancel</Button>
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

          {!device.online && device.relays.length > 0 && (
            <p className="text-xs text-muted-foreground mt-4 flex items-center gap-1.5 bg-muted/50 rounded-lg px-3 py-2 w-fit">
              <WifiOff className="w-3.5 h-3.5" />
              Device is offline — relay toggles will sync when it reconnects.
            </p>
          )}
        </TabsContent>

        {/* CONFIG TAB */}
        <TabsContent value="config" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Device Information</CardTitle>
              <CardDescription>Details reported by the ESP32</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { label: "Device ID",       value: device.id },
                  { label: "MAC Address",     value: device.macAddress },
                  { label: "WiFi Network",    value: device.ssid ?? "Unknown" },
                  { label: "Firmware",        value: device.firmwareVersion ?? "Unknown" },
                  { label: "Registered",      value: new Date(device.createdAt).toLocaleDateString() },
                  { label: "Last Updated",    value: new Date(device.updatedAt).toLocaleString() },
                ].map(({ label, value }) => (
                  <div key={label} className="flex flex-col sm:flex-row sm:items-center gap-1 py-2 border-b border-border last:border-0">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide min-w-[130px]">{label}</span>
                    <span className="text-sm text-foreground mono">{value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete device dialog */}
      <Dialog open={deleteDeviceOpen} onOpenChange={setDeleteDeviceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Device</DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{device.name}</strong> and all its relay configurations.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDeviceOpen(false)}>Cancel</Button>
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
      <Dialog open={!!deleteRelayId} onOpenChange={(o) => !o && setDeleteRelayId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Relay</DialogTitle>
            <DialogDescription>
              Remove this relay from the device? The physical pin will no longer be controlled from the dashboard.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteRelayId(null)}>Cancel</Button>
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
