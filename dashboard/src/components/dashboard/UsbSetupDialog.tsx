"use client";

import { useState, useRef, useCallback } from "react";
import { Usb, Loader2, CheckCircle2, AlertCircle, Info, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { api } from "~/trpc/react";

// Minimal Web Serial API types (Chrome/Edge only, not in TypeScript's default lib)
type Serial = { requestPort(): Promise<SerialPort_> };
type SerialPort_ = {
	open(options: { baudRate: number }): Promise<void>;
	close(): Promise<void>;
	readonly readable: ReadableStream<Uint8Array>;
	readonly writable: WritableStream<Uint8Array>;
};

type Step = "idle" | "connecting" | "pinging" | "form" | "sending" | "success" | "error";

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function UsbSetupDialog({ open, onOpenChange }: Props) {
	const [step, setStep] = useState<Step>("idle");
	const [error, setError] = useState("");
	const [form, setForm] = useState({ apiKey: "", ssid: "", password: "", name: "" });

	const portRef = useRef<SerialPort_ | null>(null);
	const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
	const pendingRef = useRef<{ resolve: (v: string | null) => void } | null>(null);

	const { data: apiKeys } = api.apiKey.list.useQuery(undefined, { enabled: open });

	const isSupported = typeof navigator !== "undefined" && "serial" in navigator;

	// ── Serial helpers ──────────────────────────────────────────────────────────

	const startReadLoop = useCallback((port: SerialPort_) => {
		const decoder = new TextDecoder();
		let buf = "";

		const processLine = (line: string) => {
			if (line.startsWith("SMARTHUB_") && pendingRef.current) {
				pendingRef.current.resolve(line);
				pendingRef.current = null;
			}
		};

		const loop = async () => {
			const reader = port.readable.getReader();
			readerRef.current = reader;
			try {
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					buf += decoder.decode(value, { stream: true });
					let nl: number;
					while ((nl = buf.indexOf("\n")) !== -1) {
						processLine(buf.slice(0, nl).trim());
						buf = buf.slice(nl + 1);
					}
				}
			} catch {
				/* port closed or cancelled */
			}
			reader.releaseLock();
			readerRef.current = null;

			// Drain any bytes that arrived just before the port closed
			buf += decoder.decode(); // flush decoder's internal state
			for (const raw of buf.split("\n")) processLine(raw.trim());

			pendingRef.current?.resolve(null);
			pendingRef.current = null;
		};

		void loop();
	}, []);

	const waitFor = useCallback(
		(ms: number): Promise<string | null> =>
			new Promise((resolve) => {
				const timer = setTimeout(() => {
					pendingRef.current = null;
					resolve(null);
				}, ms);
				pendingRef.current = {
					resolve: (v) => {
						clearTimeout(timer);
						resolve(v);
					},
				};
			}),
		[],
	);

	const send = useCallback(async (text: string) => {
		if (!portRef.current) return;
		const writer = portRef.current.writable.getWriter();
		await writer.write(new TextEncoder().encode(text + "\n"));
		writer.releaseLock();
	}, []);

	// Snapshot-and-clear refs synchronously before any await so concurrent calls
	// don't double-cancel the same reader/port.
	const closePort = useCallback(async () => {
		const reader = readerRef.current;
		const port = portRef.current;
		readerRef.current = null;
		portRef.current = null;
		if (reader)
			try {
				await reader.cancel();
			} catch {
				/* ignore */
			}
		if (port)
			try {
				await port.close();
			} catch {
				/* ignore */
			}
	}, []);

	// ── Flow ────────────────────────────────────────────────────────────────────

	const connect = useCallback(async () => {
		if (!isSupported) return;
		setStep("connecting");
		setError("");
		try {
			const serial = (navigator as unknown as { serial: Serial }).serial;
			const port = await serial.requestPort();
			await port.open({ baudRate: 115200 });
			portRef.current = port;
			startReadLoop(port);

			setStep("pinging");
			await new Promise((r) => setTimeout(r, 1500)); // let boot output clear
			await send("PING");
			const pong = await waitFor(8000);

			if (pong !== "SMARTHUB_PONG") {
				await closePort();
				setError("No response from device. Make sure the firmware is up to date (v1.4.0+) and no serial monitor is open.");
				setStep("error");
				return;
			}

			setStep("form");
		} catch (e) {
			if (e instanceof Error && e.name === "NotFoundError") {
				setStep("idle"); // user cancelled port picker
			} else {
				const msg = e instanceof Error ? e.message : "Failed to open port";
				const isLocked = msg.toLowerCase().includes("failed to open");
				setError(isLocked ? "Could not open the port — close any serial monitors (PlatformIO, Arduino IDE) and try again." : msg);
				setStep("error");
			}
		}
	}, [isSupported, startReadLoop, send, waitFor]);

	const configure = useCallback(async () => {
		if (!portRef.current) return;
		setStep("sending");

		const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

		const config = {
			apiKey: form.apiKey,
			ssid: form.ssid,
			password: form.password,
			name: form.name || "ESP32 Device",
			serverHost: window.location.hostname,
			serverPort: isLocal ? Number(window.location.port || 3000) : 443,
			devMode: isLocal,
		};

		try {
			await send(`CONFIG:${JSON.stringify(config)}`);
			const resp = await waitFor(8000);

			if (resp === "SMARTHUB_OK") {
				setStep("success");
				await closePort();
			} else if (resp?.startsWith("SMARTHUB_ERR:")) {
				setError(resp.slice(13));
				setStep("error");
			} else {
				setError("No response from device — check the USB connection and try again.");
				setStep("error");
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : "Communication error");
			setStep("error");
		}
	}, [form, send, waitFor, closePort]);

	const reset = useCallback(() => {
		void closePort();
		pendingRef.current?.resolve(null);
		pendingRef.current = null;
		setStep("idle");
		setError("");
	}, []);

	const canSubmit = form.apiKey.length > 0 && form.ssid.length > 0;

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				if (!o) reset();
				onOpenChange(o);
			}}
		>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Usb className="w-4 h-4 text-primary" />
						Configure via USB
					</DialogTitle>
					<DialogDescription>Push WiFi credentials and API key to an ESP32 over serial — no captive portal needed.</DialogDescription>
				</DialogHeader>

				{!isSupported ? (
					<div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-600 dark:text-amber-400">
						<Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
						<p>Web Serial requires Chrome or Edge. Firefox and Safari are not supported.</p>
					</div>
				) : step === "idle" ? (
					<div className="space-y-4">
						<ol className="space-y-2.5 text-sm text-muted-foreground">
							{[
								"Connect your ESP32 to this computer via USB",
								"Click Connect and select the serial port (CH340 / CP2102)",
								"Fill in WiFi credentials and an API key — the device saves and reboots",
							].map((t, i) => (
								<li key={i} className="flex items-start gap-2.5">
									<span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
									<span>{t}</span>
								</li>
							))}
						</ol>
						<Button onClick={connect} className="w-full">
							<Usb className="w-4 h-4" /> Connect to Device
						</Button>
					</div>
				) : step === "connecting" || step === "pinging" ? (
					<div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
						<Loader2 className="w-6 h-6 animate-spin text-primary" />
						<p>{step === "connecting" ? "Opening serial port…" : "Waiting for device…"}</p>
					</div>
				) : step === "form" ? (
					<div className="space-y-3">
						<div className="flex items-center gap-1.5 text-xs text-primary font-medium mb-1">
							<CheckCircle2 className="w-3.5 h-3.5" /> SmartHUB device detected
						</div>

						<div className="space-y-1">
							<Label className="text-xs text-muted-foreground">API Key</Label>
							{apiKeys && apiKeys.length > 0 ? (
								<select
									value={form.apiKey}
									onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
									className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
								>
									<option value="">Select a key…</option>
									{apiKeys.map((k) => (
										<option key={k.id} value={k.key}>
											{k.label} — {k.key.slice(0, 16)}…
										</option>
									))}
								</select>
							) : (
								<Input className="h-9" placeholder="ehk_…" value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} />
							)}
						</div>

						<div className="space-y-1">
							<Label className="text-xs text-muted-foreground">WiFi Network (SSID)</Label>
							<Input className="h-9" placeholder="Your WiFi name" value={form.ssid} onChange={(e) => setForm((f) => ({ ...f, ssid: e.target.value }))} />
						</div>

						<div className="space-y-1">
							<Label className="text-xs text-muted-foreground">WiFi Password</Label>
							<Input
								className="h-9"
								type="password"
								placeholder="Leave blank for open networks"
								value={form.password}
								onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
							/>
						</div>

						<div className="space-y-1">
							<Label className="text-xs text-muted-foreground">
								Device Name <span className="text-muted-foreground/60">(optional)</span>
							</Label>
							<Input className="h-9" placeholder="e.g. Living Room Board" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
						</div>

						<Button className="w-full mt-1" onClick={configure} disabled={!canSubmit}>
							<ChevronRight className="w-4 h-4" /> Configure Device
						</Button>
					</div>
				) : step === "sending" ? (
					<div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
						<Loader2 className="w-6 h-6 animate-spin text-primary" />
						<p>Sending config — device will reboot automatically…</p>
					</div>
				) : step === "success" ? (
					<div className="flex flex-col items-center gap-4 py-6 text-center">
						<div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
							<CheckCircle2 className="w-6 h-6 text-primary" />
						</div>
						<div>
							<p className="font-semibold text-foreground">Device configured!</p>
							<p className="text-sm text-muted-foreground mt-1">The ESP32 saved the config and is rebooting. It will connect to your WiFi and appear in the dashboard within seconds.</p>
						</div>
						<Button
							variant="outline"
							onClick={() => {
								reset();
								onOpenChange(false);
							}}
						>
							Done
						</Button>
					</div>
				) : (
					<div className="space-y-4">
						<div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
							<AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
							<p>{error}</p>
						</div>
						<Button variant="outline" className="w-full" onClick={reset}>
							Try Again
						</Button>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
