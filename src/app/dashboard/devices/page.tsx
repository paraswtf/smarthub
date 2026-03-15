"use client";

import { useState } from "react";
import Link from "next/link";
import { Cpu, Plus, Search, Wifi, WifiOff, ChevronRight, ToggleRight } from "lucide-react";
import { api } from "~/trpc/react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { timeAgo } from "~/lib/utils";

export default function DevicesPage() {
  const [search, setSearch] = useState("");
  const { data: devices, isLoading } = api.device.list.useQuery(undefined, {
    refetchInterval: 10_000,
  });

  const filtered = (devices ?? []).filter(
    (d) =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.macAddress.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 lg:p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-2 lg:pt-0">
        <div>
          <h1 className="font-sora font-extrabold text-2xl lg:text-3xl text-foreground">Devices</h1>
          <p className="text-sm text-muted-foreground mt-1">
            All ESP32 modules linked to your account
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/api-keys">
            <Plus className="w-4 h-4" /> Add Device via API Key
          </Link>
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by name or MAC…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* List */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5 space-y-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <div className="flex gap-2">
                  <Skeleton className="h-6 w-16 rounded-full" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-12 text-center">
            <Cpu className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold text-foreground mb-1">
              {search ? "No devices match your search" : "No devices yet"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {search
                ? "Try a different name or MAC address."
                : "Flash an ESP32 with your API key to get started."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((device) => {
            const activeRelays = device.relays.filter((r) => r.state).length;
            return (
              <Link key={device.id} href={`/dashboard/devices/${device.id}`} className="no-underline group">
                <Card className="h-full transition-all duration-200 hover:border-primary/40 hover:shadow-md cursor-pointer">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`status-dot flex-shrink-0 ${device.online ? "online" : "offline"}`} />
                        <CardTitle className="text-base font-semibold truncate">{device.name}</CardTitle>
                      </div>
                      <Badge variant={device.online ? "online" : "offline"} className="flex-shrink-0">
                        {device.online ? "Online" : "Offline"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mono">{device.macAddress}</p>
                  </CardHeader>

                  <CardContent className="pb-4 space-y-3">
                    {/* Relay summary */}
                    <div className="flex items-center gap-2">
                      <ToggleRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-xs text-muted-foreground">
                        {device.relays.length === 0
                          ? "No relays configured"
                          : `${activeRelays} / ${device.relays.length} relays active`}
                      </span>
                    </div>

                    {/* Relay pill preview */}
                    {device.relays.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {device.relays.slice(0, 4).map((relay) => (
                          <span
                            key={relay.id}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${
                              relay.state
                                ? "bg-primary/15 text-primary"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full"
                              style={{
                                background: relay.state
                                  ? "hsl(var(--status-online))"
                                  : "hsl(var(--status-offline))",
                              }}
                            />
                            {relay.label}
                          </span>
                        ))}
                        {device.relays.length > 4 && (
                          <span className="text-xs text-muted-foreground px-1 self-center">
                            +{device.relays.length - 4} more
                          </span>
                        )}
                      </div>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-1">
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                        {device.online ? (
                          <><Wifi className="w-3 h-3" /> Connected</>
                        ) : (
                          <><WifiOff className="w-3 h-3" /> {timeAgo(device.lastSeenAt)}</>
                        )}
                      </p>
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
