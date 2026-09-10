import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { listAgentsForOwner } from "@/lib/db/queries/agents";
import { getLatestChecksForAgents } from "@/lib/db/queries/health-checks";
import { getLatestReliabilityScoresForAgents } from "@/lib/db/queries/reliability";
import { getEffectiveAgentStatus } from "@/lib/monitoring/heartbeat-status";
import { StatusPill } from "@/components/agents/status-pill";
import { LastCheckSummary } from "@/components/agents/last-check-summary";
import { ReliabilityScoreBadge } from "@/components/agents/reliability-score";

export default async function AgentsPage() {
  const session = await verifySession();
  const agentList = await listAgentsForOwner(db, session.userId);
  const agentIds = agentList.map((a) => a.id);
  const latestChecks = await getLatestChecksForAgents(db, session.userId, agentIds);
  const latestScores = await getLatestReliabilityScoresForAgents(
    db,
    session.userId,
    agentIds,
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="text-sm text-muted">{agentList.length} registered</p>
        </div>
        <Link
          href="/dashboard/agents/new"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          Register agent
        </Link>
      </div>

      {agentList.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted">No agents registered yet.</p>
          <Link
            href="/dashboard/agents/new"
            className="mt-3 inline-block text-sm text-accent hover:underline"
          >
            Register your first agent →
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Trust score</th>
                <th className="px-4 py-2.5 font-medium">Last checked</th>
                <th className="px-4 py-2.5 font-medium">Response time</th>
                <th className="px-4 py-2.5 font-medium">HTTP status</th>
                <th className="px-4 py-2.5 font-medium">Endpoint</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {agentList.map((agent) => (
                <tr
                  key={agent.id}
                  className="border-b border-border last:border-0 hover:bg-surface-2"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/agents/${agent.slug}`}
                      className="font-medium hover:text-accent"
                    >
                      {agent.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={getEffectiveAgentStatus(agent)} />
                  </td>
                  <td className="px-4 py-3">
                    <ReliabilityScoreBadge
                      score={latestScores.get(agent.id)?.score ?? null}
                    />
                  </td>
                  <td className="px-4 py-3 text-muted">
                    <LastCheckSummary
                      check={latestChecks.get(agent.id)}
                      field="checkedAt"
                    />
                  </td>
                  <td className="px-4 py-3 text-muted">
                    <LastCheckSummary
                      check={latestChecks.get(agent.id)}
                      field="latency"
                    />
                  </td>
                  <td className="px-4 py-3 text-muted">
                    <LastCheckSummary
                      check={latestChecks.get(agent.id)}
                      field="httpStatus"
                    />
                  </td>
                  <td className="max-w-[240px] truncate px-4 py-3 font-mono text-xs text-muted">
                    {agent.endpointUrl}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {new Date(agent.createdAt).toLocaleDateString()}
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
