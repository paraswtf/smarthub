import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { headers } from "next/headers";
import DashboardOverviewClient from "~/components/dashboard/DashboardOverviewClient";
import type { Device, Relay } from "@prisma/client";

type DeviceWithRelays = Device & { relays: Relay[] };

export default async function DashboardPage() {
	const session = await auth();
	if (!session?.user?.id) redirect("/auth/login");

	const ctx = await createTRPCContext({ req: { headers: await headers() } as Parameters<typeof createTRPCContext>[0]["req"] });
	const caller = createCaller(ctx);

	const [devices, apiKeys] = await Promise.all([caller.device.list().catch((): DeviceWithRelays[] => []), caller.apiKey.list().catch(() => [] as Awaited<ReturnType<typeof caller.apiKey.list>>)]);

	const onlineCount = devices.filter((d: DeviceWithRelays) => d.online).length;
	const relayCount = devices.reduce((n: number, d: DeviceWithRelays) => n + d.relays.length, 0);
	const activeRelays = devices.reduce((n: number, d: DeviceWithRelays) => n + d.relays.filter((r: Relay) => r.state).length, 0);

	return (
		<DashboardOverviewClient
			user={session.user}
			stats={{ devices: devices.length, online: onlineCount, relays: relayCount, activeRelays, apiKeys: apiKeys.length }}
			devices={devices}
		/>
	);
}
