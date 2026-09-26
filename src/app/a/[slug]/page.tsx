import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getPublicAgentBySlug } from "@/lib/db/queries/agents";
import { getLatestCheckPublic } from "@/lib/db/queries/health-checks";
import { getReliabilityScoreStatePublic } from "@/lib/db/queries/reliability";
import { getEffectiveAgentStatus } from "@/lib/monitoring/heartbeat-status";
import { buildAgentCard } from "@/lib/validation/agent-card";
import { CapabilityTags } from "@/components/agents/capability-tags";
import { StatusPill } from "@/components/agents/status-pill";
import { LastCheckSummary } from "@/components/agents/last-check-summary";
import { ReliabilityScoreBadge } from "@/components/agents/reliability-score";
import { AgentCardSummary } from "@/components/agents/agent-card-summary";
import { AppError, ErrorCode } from "@/lib/errors";

export default async function PublicAgentProfilePage({
  params,
}: PageProps<"/a/[slug]">) {
  const { slug } = await params;

  let agent;
  try {
    agent = await getPublicAgentBySlug(db, slug);
  } catch (error) {
    if (error instanceof AppError && error.code === ErrorCode.NOT_FOUND) {
      notFound();
    }
    throw error;
  }

  const latest = await getLatestCheckPublic(db, agent.id);
  const scoreState = await getReliabilityScoreStatePublic(db, agent.id);
  const latestScore = scoreState.score;
  const card = buildAgentCard(agent);

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-16">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {agent.name}
          </h1>
          {agent.version && (
            <p className="mt-1 font-mono text-sm text-muted">
              v{agent.version}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <StatusPill status={getEffectiveAgentStatus(agent)} />
          <ReliabilityScoreBadge
            score={latestScore?.score ?? null}
            status={scoreState.status}
          />
          {agent.ownershipVerifiedAt && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400">
              Endpoint verified
            </span>
          )}
        </div>
      </div>

      {agent.description && (
        <p className="mt-6 text-muted">{agent.description}</p>
      )}

      <div className="mt-8 flex flex-col gap-6">
        <div>
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
            Capabilities
          </h2>
          <div className="mt-2">
            <CapabilityTags tags={agent.capabilityTags} />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
            Agent Card
          </h2>
          <div className="mt-3">
            <AgentCardSummary card={card} />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
            Endpoint health
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted">Last checked</dt>
              <dd className="mt-0.5">
                <LastCheckSummary
                  check={latest ?? undefined}
                  field="checkedAt"
                />
              </dd>
            </div>
            <div>
              <dt className="text-muted">Response time</dt>
              <dd className="mt-0.5">
                <LastCheckSummary check={latest ?? undefined} field="latency" />
              </dd>
            </div>
            <div>
              <dt className="text-muted">HTTP status</dt>
              <dd className="mt-0.5">
                <LastCheckSummary
                  check={latest ?? undefined}
                  field="httpStatus"
                />
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
            Reliability / trust score
          </h2>
          {latestScore ? (
            <>
              <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted">Uptime</dt>
                  <dd className="mt-0.5">{latestScore.uptimeSubscore.toFixed(0)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Latency</dt>
                  <dd className="mt-0.5">{latestScore.latencySubscore.toFixed(0)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Consistency</dt>
                  <dd className="mt-0.5">{latestScore.consistencySubscore.toFixed(0)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Incidents</dt>
                  <dd className="mt-0.5">{latestScore.incidentSubscore.toFixed(0)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted">
                Computed from checks between{" "}
                {new Date(latestScore.windowStart).toLocaleDateString()} and{" "}
                {new Date(latestScore.windowEnd).toLocaleDateString()}.
              </p>
              {scoreState.status === "stale" && (
                <p className="mt-2 text-xs text-muted">
                  Out of date: not enough health checks in the last 7 days
                  for this to count as current evidence. Shown for reference
                  only.
                </p>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">
              Not enough monitoring history yet to compute a score.
            </p>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-4 border-t border-border pt-6 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">Registered</dt>
            <dd className="mt-0.5">
              {new Date(agent.createdAt).toLocaleDateString()}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
