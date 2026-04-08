import { NextResponse } from "next/server";

export interface FirmwareRelease {
	id: number;
	tag_name: string;
	name: string;
	published_at: string;
	html_url: string;
	asset: { name: string; browser_download_url: string; size: number } | null;
}

const REPO = "paraswtf/smarthub";

export async function GET() {
	try {
		const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
			headers: { Accept: "application/vnd.github.v3+json" },
			next: { revalidate: 60 },
		});
		if (!res.ok) throw new Error(`GitHub API ${res.status}`);

		const all = (await res.json()) as Array<{
			id: number;
			tag_name: string;
			name: string;
			published_at: string;
			html_url: string;
			assets: Array<{ name: string; browser_download_url: string; size: number }>;
		}>;

		const firmware: FirmwareRelease[] = all
			.filter((r) => r.tag_name.startsWith("firmware-"))
			.map((r) => ({
				id: r.id,
				tag_name: r.tag_name,
				name: r.name,
				published_at: r.published_at,
				html_url: r.html_url,
				asset: r.assets.find((a) => a.name.endsWith(".bin")) ?? null,
			}));

		return NextResponse.json(firmware, {
			headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
		});
	} catch {
		return NextResponse.json([], { status: 200 });
	}
}
