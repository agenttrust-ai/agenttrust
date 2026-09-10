import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { getOwnedAgentBySlug } from "@/lib/db/queries/agents";
import { listRecentChecksForOwnedAgent } from "@/lib/db/queries/health-checks";
import { CheckStatusPill } from "@/components/agents/check-status-pill";

export default async function AgentHealthHistoryPage({
  params,
}: PageProps<"/dashboard/agents/[slug]/health">) {
  const { slug } = await params;
  const session = await verifySession();
  const agent = await getOwnedAgentBySlug(db, session.userId, slug);
  const checks = await listRecentChecksForOwnedAgent(
    db,
    session.userId,
    agent.id,
    50,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/dashboard/agents/${agent.slug}`}
          className="text-sm text-muted hover:text-foreground"
        >
          ← {agent.name}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          Health history
        </h1>
        <p className="text-sm text-muted">
          Most recent {checks.length} checks.
        </p>
      </div>

      {checks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted">
          No checks recorded yet. The scheduler runs on a fixed interval — the
          first result should appear shortly after registration.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Checked at</th>
                <th className="px-4 py-2.5 font-medium">Result</th>
                <th className="px-4 py-2.5 font-medium">HTTP status</th>
                <th className="px-4 py-2.5 font-medium">Latency</th>
                <th className="px-4 py-2.5 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((check) => (
                <tr
                  key={check.id}
                  className="border-b border-border last:border-0 hover:bg-surface-2"
                >
                  <td className="px-4 py-3 text-muted">
                    {new Date(check.checkedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <CheckStatusPill status={check.status} />
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {check.statusCode ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {check.latencyMs != null ? `${check.latencyMs} ms` : "—"}
                  </td>
                  <td className="max-w-[320px] truncate px-4 py-3 text-muted">
                    {check.errorMessage ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
