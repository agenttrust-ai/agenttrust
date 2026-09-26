import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { listAgentsForOwner } from "@/lib/db/queries/agents";
import { getLatestChecksForAgents } from "@/lib/db/queries/health-checks";
import {
  getLatestReliabilityScoresForAgents,
  getReliabilityScoreStatusesForOwnedAgents,
} from "@/lib/db/queries/reliability";
import { getEffectiveAgentStatus } from "@/lib/monitoring/heartbeat-status";
import { StatusPill } from "@/components/agents/status-pill";
import { LastCheckSummary } from "@/components/agents/last-check-summary";
import { ReliabilityScoreBadge } from "@/components/agents/reliability-score";
import { VerificationStatus } from "@/components/trust/trust-report";
import { buttonClass } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/components/ui/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import * as T from "@/components/ui/table";

export default async function AgentsPage() {
  const session = await verifySession();
  const agentList = await listAgentsForOwner(db, session.userId);
  const agentIds = agentList.map((a) => a.id);
  // Independent reads — run together rather than one after another.
  const [latestChecks, latestScores] = await Promise.all([
    getLatestChecksForAgents(db, session.userId, agentIds),
    getLatestReliabilityScoresForAgents(db, session.userId, agentIds),
  ]);
  const scoreStatuses = await getReliabilityScoreStatusesForOwnedAgents(
    db,
    session.userId,
    new Map(agentIds.map((id) => [id, latestScores.get(id) ?? null])),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Dashboard"
        title="Agents"
        description={`${agentList.length} registered. Health and reliability here are the same evidence callers see when they check your endpoint.`}
        actions={
          <Link href="/dashboard/agents/new" className={buttonClass({ size: "sm" })}>
            Register agent
          </Link>
        }
      />

      {agentList.length === 0 ? (
        <EmptyState
          title="No agents registered yet"
          action={
            <Link href="/dashboard/agents/new" className={buttonClass({ size: "sm" })}>
              Register your first agent
            </Link>
          }
        >
          Register an agent&apos;s endpoint to start collecting monitoring
          evidence.
        </EmptyState>
      ) : (
        <div className={T.tableFrame}>
          <table className={cx(T.table, "min-w-[880px]")}>
            <thead>
              <tr className={T.theadRow}>
                <th scope="col" className={T.th}>Agent</th>
                <th scope="col" className={T.th}>Health</th>
                <th scope="col" className={T.th}>Reliability</th>
                <th scope="col" className={T.th}>Ownership</th>
                <th scope="col" className={T.th}>Last check</th>
                <th scope="col" className={T.th}>Endpoint</th>
              </tr>
            </thead>
            <tbody>
              {agentList.map((agent) => {
                const check = latestChecks.get(agent.id);
                return (
                  <tr key={agent.id} className={T.tbodyRowInteractive}>
                    {/* Primary: identity. The name link stretches over the row. */}
                    <td className={cx(T.td, "max-w-[16rem]")}>
                      <div className="flex min-w-0 items-center gap-2">
                        <Link
                          href={`/dashboard/agents/${agent.slug}`}
                          className="truncate font-medium after:absolute after:inset-0 hover:text-accent"
                        >
                          {agent.name}
                        </Link>
                        {agent.lifecycleStatus !== "active" && <StatusChip tone="neutral">Draft</StatusChip>}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-xs text-muted">{agent.slug}</p>
                    </td>
                    {/* Primary: trust evidence. */}
                    <td className={T.td}>
                      <StatusPill status={getEffectiveAgentStatus(agent)} />
                    </td>
                    <td className={T.td}>
                      <ReliabilityScoreBadge
                        score={latestScores.get(agent.id)?.score ?? null}
                        status={scoreStatuses.get(agent.id)}
                      />
                    </td>
                    <td className={T.td}>
                      <VerificationStatus verified={agent.ownershipVerifiedAt != null} />
                    </td>
                    {/* Secondary: operational metadata. */}
                    <td className={cx(T.td, "whitespace-nowrap")}>
                      <p className="text-sm">
                        <LastCheckSummary check={check} field="checkedAt" />
                      </p>
                      {check && (
                        <p className="mt-0.5 font-mono text-xs text-muted tabular-nums">
                          <LastCheckSummary check={check} field="latency" />
                          {" · HTTP "}
                          <LastCheckSummary check={check} field="httpStatus" />
                        </p>
                      )}
                    </td>
                    <td className={cx(T.td, "max-w-[15rem]")}>
                      <p className="truncate font-mono text-xs text-muted" title={agent.endpointUrl}>
                        {agent.endpointUrl}
                      </p>
                      <p className="mt-0.5 text-xs text-subtle">Created {formatDate(agent.createdAt)}</p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
