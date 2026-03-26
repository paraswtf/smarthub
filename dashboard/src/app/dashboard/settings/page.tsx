"use client";

import { useState, useTransition } from "react";
import { Save, Loader2, User, Lock, Info, Check, Zap } from "lucide-react";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { ThemeToggle } from "~/components/ThemeToggle";
import { appConfig } from "../../../../globals.config";

export default function SettingsPage() {
  const { data: session, update } = useSession();
  const [name, setName] = useState(session?.user?.name ?? "");
  const [nameSaved, setNameSaved] = useState(false);

  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwError, setPwError] = useState("");
  const [pwSaved, setPwSaved] = useState(false);

  const [namePending, startNameTransition] = useTransition();
  const [pwPending, startPwTransition] = useTransition();

  const saveName = () => {
    if (!name.trim()) return;
    startNameTransition(async () => {
      const res = await fetch("/api/user/update-name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        await update({ name });
        setNameSaved(true);
        setTimeout(() => setNameSaved(false), 3000);
      }
    });
  };

  const savePassword = () => {
    setPwError("");
    if (!pwForm.current || !pwForm.next || !pwForm.confirm) {
      setPwError("All fields are required.");
      return;
    }
    if (pwForm.next !== pwForm.confirm) {
      setPwError("New passwords do not match.");
      return;
    }
    if (pwForm.next.length < 8) {
      setPwError("Password must be at least 8 characters.");
      return;
    }
    startPwTransition(async () => {
      const res = await fetch("/api/user/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current: pwForm.current, next: pwForm.next }),
      });
      if (res.ok) {
        setPwForm({ current: "", next: "", confirm: "" });
        setPwSaved(true);
        setTimeout(() => setPwSaved(false), 3000);
      } else {
        const data = await res.json() as { error?: string };
        setPwError(data.error ?? "Failed to change password.");
      }
    });
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 animate-fade-in max-w-2xl mt-14 lg:mt-0">
      {/* Header */}
      <div>
        <h1 className="font-sora font-extrabold text-2xl lg:text-3xl text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account and preferences</p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4 text-primary" /> Profile
          </CardTitle>
          <CardDescription>Update your display name</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Display Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              onKeyDown={(e) => e.key === "Enter" && saveName()}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={session?.user?.email ?? ""} disabled className="opacity-60" />
            <p className="text-xs text-muted-foreground">Email cannot be changed.</p>
          </div>
          <Button onClick={saveName} disabled={namePending || !name.trim()}>
            {namePending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
            ) : nameSaved ? (
              <><Check className="w-4 h-4" /> Saved!</>
            ) : (
              <><Save className="w-4 h-4" /> Save Name</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Password */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="w-4 h-4 text-primary" /> Change Password
          </CardTitle>
          <CardDescription>Use a strong password of at least 8 characters</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {pwError && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {pwError}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="current-pw">Current Password</Label>
            <Input
              id="current-pw"
              type="password"
              value={pwForm.current}
              onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-pw">New Password</Label>
            <Input
              id="new-pw"
              type="password"
              value={pwForm.next}
              onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value }))}
              placeholder="Min. 8 characters"
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-pw">Confirm New Password</Label>
            <Input
              id="confirm-pw"
              type="password"
              value={pwForm.confirm}
              onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))}
              placeholder="Repeat new password"
              autoComplete="new-password"
              onKeyDown={(e) => e.key === "Enter" && savePassword()}
            />
          </div>
          <Button onClick={savePassword} disabled={pwPending}>
            {pwPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Updating…</>
            ) : pwSaved ? (
              <><Check className="w-4 h-4" /> Password Updated!</>
            ) : (
              <><Save className="w-4 h-4" /> Update Password</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" /> Appearance
          </CardTitle>
          <CardDescription>Toggle between light and dark theme</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Color Theme</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Switch between dark and light mode
              </p>
            </div>
            <ThemeToggle />
          </div>
        </CardContent>
      </Card>

      {/* About */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="w-4 h-4 text-primary" /> About
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { label: "Application",   value: appConfig.name },
              { label: "Version",       value: appConfig.version },
              { label: "Max Relays",    value: `${appConfig.maxRelaysPerDevice} per device` },
              { label: "WS Reconnect", value: `${appConfig.wsReconnectInterval / 1000}s interval` },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="text-sm font-medium text-foreground mono">{value}</span>
              </div>
            ))}
          </div>
          <Separator className="my-4" />
          <p className="text-xs text-muted-foreground">
            To change brand colors, relay limits, or WebSocket settings, edit{" "}
            <code className="mono bg-muted px-1 py-0.5 rounded text-[11px]">globals.config.ts</code>{" "}
            in the project root — all values cascade through the entire UI automatically.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
