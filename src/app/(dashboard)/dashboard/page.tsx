import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { listAgentsForOwner } from "@/lib/db/queries/agents";
import { listApiKeysForOwner } from "@/lib/db/queries/api-keys";

export default async function DashboardPage() {
  const session = await verifySession();
  const agentList = await listAgentsForOwner(db, session.userId);
  const apiKeys = await listApiKeysForOwner(db, session.userId);
  const activeKeyCount = apiKeys.filter((k) => k.revokedAt == null).length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted">Signed in as {session.email}.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/dashboard/agents"
          className="flex items-center justify-between rounded-lg border border-border bg-surface p-5 hover:border-accent"
        >
          <div>
            <h2 className="font-medium">Agents</h2>
            <p className="text-sm text-muted">
              {agentList.length === 0
                ? "No agents registered yet."
                : `${agentList.length} registered.`}
            </p>
          </div>
          <span className="text-sm text-accent">Manage →</span>
        </Link>

        <Link
          href="/dashboard/api-keys"
          className="flex items-center justify-between rounded-lg border border-border bg-surface p-5 hover:border-accent"
        >
          <div>
            <h2 className="font-medium">API keys</h2>
            <p className="text-sm text-muted">
              {activeKeyCount === 0
                ? "No active keys."
                : `${activeKeyCount} active.`}
            </p>
          </div>
          <span className="text-sm text-accent">Manage →</span>
        </Link>
      </div>
    </div>
  );
}
