import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import DashboardSidebar from "~/components/dashboard/DashboardSidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
	const session = await auth();
	if (!session?.user?.id) redirect("/auth/login");

	return (
		<div className="flex h-screen overflow-hidden bg-background">
			<DashboardSidebar user={session.user} />
			<main className="flex-1 overflow-y-auto">{children}</main>
		</div>
	);
}
