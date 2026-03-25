import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import DashboardOverviewClient from "~/components/dashboard/DashboardOverviewClient";

export default async function DashboardPage() {
	const session = await auth();
	if (!session?.user?.id) redirect("/auth/login");

	return <DashboardOverviewClient userName={session.user.name} />;
}
