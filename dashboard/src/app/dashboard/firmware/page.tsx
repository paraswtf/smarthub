import { Download, ExternalLink, Tag, Calendar, HardDrive, Terminal, Cpu } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import type { FirmwareRelease } from "~/app/api/firmware/releases/route";

const REPO = "paraswtf/smarthub";

async function getReleases(): Promise<FirmwareRelease[]> {
	try {
		const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
			headers: { Accept: "application/vnd.github.v3+json" },
			next: { revalidate: 3600 },
		});
		if (!res.ok) return [];

		const all = (await res.json()) as Array<{
			id: number;
			tag_name: string;
			name: string;
			published_at: string;
			html_url: string;
			assets: Array<{ name: string; browser_download_url: string; size: number }>;
		}>;

		return all
			.filter((r) => r.tag_name.startsWith("firmware-"))
			.map((r) => ({
				id: r.id,
				tag_name: r.tag_name,
				name: r.name,
				published_at: r.published_at,
				html_url: r.html_url,
				asset: r.assets.find((a) => a.name.endsWith(".bin")) ?? null,
			}));
	} catch {
		return [];
	}
}

function formatSize(bytes: number) {
	return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatDate(iso: string) {
	return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function FirmwarePage() {
	const releases = await getReleases();
	const latest = releases[0] ?? null;

	return (
		<div className="p-6 lg:p-8 space-y-6 mt-14 lg:mt-0">
			<div>
				<h1 className="font-sora font-extrabold text-2xl lg:text-3xl text-foreground flex items-center gap-3">
					<Cpu className="w-7 h-7 text-primary" />
					Firmware Releases
				</h1>
				<p className="text-sm text-muted-foreground mt-1">ESP32 firmware builds - published automatically by CI when the version is bumped.</p>
			</div>

			{/* Latest release hero */}
			{latest ? (
				<Card className="border-primary/30 bg-primary/5">
					<CardHeader>
						<div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
							<div>
								<div className="flex items-center gap-2 mb-1">
									<CardTitle className="text-lg">{latest.name}</CardTitle>
									<Badge className="text-[10px]">Latest</Badge>
								</div>
								<CardDescription className="flex items-center gap-3">
									<span className="flex items-center gap-1">
										<Tag className="w-3 h-3" />
										{latest.tag_name}
									</span>
									<span className="flex items-center gap-1">
										<Calendar className="w-3 h-3" />
										{formatDate(latest.published_at)}
									</span>
									{latest.asset && (
										<span className="flex items-center gap-1">
											<HardDrive className="w-3 h-3" />
											{formatSize(latest.asset.size)}
										</span>
									)}
								</CardDescription>
							</div>
							<div className="flex gap-2 shrink-0">
								{latest.asset && (
									<a
										href={latest.asset.browser_download_url}
										download
										className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
									>
										<Download className="w-4 h-4" />
										Download .bin
									</a>
								)}
								<a
									href={latest.html_url}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-border bg-background text-sm font-medium hover:bg-muted transition-colors"
								>
									<ExternalLink className="w-4 h-4" />
									GitHub
								</a>
							</div>
						</div>
					</CardHeader>
				</Card>
			) : (
				<Card className="border-dashed">
					<CardContent className="p-8 text-center text-muted-foreground text-sm">
						No firmware releases found. Push to <code>main</code> with a version bump to trigger CI.
					</CardContent>
				</Card>
			)}

			{/* Flashing instructions */}
			<Card>
				<CardHeader>
					<CardTitle className="text-base flex items-center gap-2">
						<Terminal className="w-4 h-4" />
						How to Flash
					</CardTitle>
					<CardDescription>Three ways to get firmware onto your ESP32</CardDescription>
				</CardHeader>
				<CardContent className="space-y-5 text-sm">
					<div>
						<p className="font-semibold mb-1.5">Option A - esptool.py (recommended)</p>
						<ol className="space-y-1 text-muted-foreground list-decimal list-inside">
							<li>
								Install: <code className="bg-muted px-1 rounded text-xs">pip install esptool</code>
							</li>
							<li>
								Connect ESP32 via USB and note the port (<code className="bg-muted px-1 rounded text-xs">/dev/ttyUSB0</code> on Linux,{" "}
								<code className="bg-muted px-1 rounded text-xs">COM3</code> on Windows)
							</li>
							<li>
								Flash:
								<pre className="mt-1.5 bg-muted rounded-md p-3 text-xs overflow-x-auto">{`esptool.py --port /dev/ttyUSB0 --baud 460800 write_flash -z 0x0 firmware.bin`}</pre>
							</li>
						</ol>
					</div>

					<div>
						<p className="font-semibold mb-1.5">Option B - PlatformIO (build from source)</p>
						<ol className="space-y-1 text-muted-foreground list-decimal list-inside">
							<li>Clone the repo and open it in VS Code with the PlatformIO extension</li>
							<li>Connect your ESP32 via USB</li>
							<li>
								Run:
								<pre className="mt-1.5 bg-muted rounded-md p-3 text-xs overflow-x-auto">{`pio run -t upload`}</pre>
							</li>
						</ol>
					</div>

					<div>
						<p className="font-semibold mb-1.5">Option C - OTA (already running v1.3.0+)</p>
						<ol className="space-y-1 text-muted-foreground list-decimal list-inside">
							<li>
								Download the <code className="bg-muted px-1 rounded text-xs">.bin</code> above
							</li>
							<li>Go to your device's Config tab → Firmware Update (OTA)</li>
							<li>Upload the file and click Push Update - the device reflashes itself</li>
						</ol>
					</div>
				</CardContent>
			</Card>

			{/* All releases list */}
			{releases.length > 1 && (
				<Card>
					<CardHeader>
						<CardTitle className="text-base">All Releases</CardTitle>
					</CardHeader>
					<CardContent className="divide-y divide-border">
						{releases.map((r, i) => (
							<div key={r.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
								<div>
									<div className="flex items-center gap-2">
										<span className="text-sm font-medium">{r.name}</span>
										{i === 0 && (
											<Badge variant="outline" className="text-[10px] h-4 px-1.5">
												Latest
											</Badge>
										)}
									</div>
									<div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
										<span className="flex items-center gap-1">
											<Tag className="w-3 h-3" />
											{r.tag_name}
										</span>
										<span className="flex items-center gap-1">
											<Calendar className="w-3 h-3" />
											{formatDate(r.published_at)}
										</span>
										{r.asset && (
											<span className="flex items-center gap-1">
												<HardDrive className="w-3 h-3" />
												{formatSize(r.asset.size)}
											</span>
										)}
									</div>
								</div>
								<div className="flex items-center gap-2 shrink-0">
									{r.asset && (
										<a
											href={r.asset.browser_download_url}
											download
											className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted transition-colors"
										>
											<Download className="w-3 h-3" /> .bin
										</a>
									)}
									<a
										href={r.html_url}
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted transition-colors"
									>
										<ExternalLink className="w-3 h-3" /> GitHub
									</a>
								</div>
							</div>
						))}
					</CardContent>
				</Card>
			)}
		</div>
	);
}
