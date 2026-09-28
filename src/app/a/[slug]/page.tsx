import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getPublicAgentBySlug } from "@/lib/db/queries/agents";
import { getLatestCheckPublic } from "@/lib/db/queries/health-checks";
import { getReliabilityScoreStatePublic } from "@/lib/db/queries/reliability";
import { getEffectiveAgentStatus } from "@/lib/monitoring/heartbeat-status";
import { buildAgentCard } from "@/lib/validation/agent-card";
import { CapabilityTags } from "@/components/agents/capability-tags";
import { LastCheckSummary } from "@/components/agents/last-check-summary";
import { ReliabilityScoreBadge } from "@/components/agents/reliability-score";
import { AgentCardSummary } from "@/components/agents/agent-card-summary";
import { NetworkNode } from "@/components/network/network-node";
import { EvidenceGlyph } from "@/components/trust/evidence";
import { trustReportFromEvidence } from "@/components/trust/report-data";
import { TrustReport } from "@/components/trust/trust-report";
import { PageHeader } from "@/components/ui/page-header";
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

  // Independent reads — run together rather than one after another.
  const [latest, scoreState] = await Promise.all([
    getLatestCheckPublic(db, agent.id),
    getReliabilityScoreStatePublic(db, agent.id),
  ]);
  const latestScore = scoreState.score;
  const card = buildAgentCard(agent);
  // Built from the same inputs `toTrustEnrichedAgentJson` uses, so the
  // report here is the one `check_agent_trust` returns for this agent.
  const report = trustReportFromEvidence({
    name: agent.name,
    slug: agent.slug,
    status: getEffectiveAgentStatus(agent),
    score: latestScore?.score ?? null,
    scoreStatus: scoreState.status,
    verified: agent.ownershipVerifiedAt !== null,
  });

  const PANEL_HEADING = "flex items-center gap-2.5 text-sm font-medium";

  return (
    <div className="mx-auto flex w-full max-w-reading flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
      {/* 1 — Identity. */}
      <PageHeader
        eyebrow="Agent profile"
        title={agent.name}
        description={
          (agent.version || agent.description) && (
          <>
            {agent.version && <p className="font-mono text-xs">v{agent.version}</p>}
            {agent.description && <p className="mt-2 text-base">{agent.description}</p>}
          </>
          )
        }
      />

      {/* 2 — The decision callers get for this agent. */}
      <section aria-labelledby="decision-heading" className="flex flex-col gap-3">
        <h2 id="decision-heading" className="text-heading">
          Trust decision
        </h2>
        <TrustReport data={report} headingLevel="p" />
        <p className="text-xs text-muted">
          What <code className="font-mono text-foreground">check_agent_trust</code> returns for this
          agent now — AgentTrust&apos;s observed evidence, not a security
          guarantee, certification or endorsement.
        </p>
      </section>

      {/* 3 — The observed evidence behind it. */}
      <section aria-labelledby="evidence-heading" className="flex flex-col gap-3">
        <h2 id="evidence-heading" className="flex items-center gap-2 text-heading">
          <NetworkNode state="observed" size="md" />
          Observed evidence
        </h2>

        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className={PANEL_HEADING}>
            <EvidenceGlyph kind="health" />
            Endpoint health
          </h3>
          <dl className="mt-3 grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-xs text-muted">Last checked</dt>
              <dd className="mt-0.5">
                <LastCheckSummary check={latest ?? undefined} field="checkedAt" />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Response time</dt>
              <dd className="mt-0.5">
                <LastCheckSummary check={latest ?? undefined} field="latency" />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">HTTP status</dt>
              <dd className="mt-0.5">
                <LastCheckSummary check={latest ?? undefined} field="httpStatus" />
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className={PANEL_HEADING}>
              <EvidenceGlyph kind="reliability" />
              Reliability score
            </h3>
            <ReliabilityScoreBadge score={latestScore?.score ?? null} status={scoreState.status} />
          </div>
          {latestScore ? (
            <>
              <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted">Uptime</dt>
                  <dd className="mt-0.5 font-mono tabular-nums">{latestScore.uptimeSubscore.toFixed(0)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Latency</dt>
                  <dd className="mt-0.5 font-mono tabular-nums">{latestScore.latencySubscore.toFixed(0)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Consistency</dt>
                  <dd className="mt-0.5 font-mono tabular-nums">{latestScore.consistencySubscore.toFixed(0)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Incidents</dt>
                  <dd className="mt-0.5 font-mono tabular-nums">{latestScore.incidentSubscore.toFixed(0)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted">
                Computed from checks between{" "}
                {new Date(latestScore.windowStart).toLocaleDateString()} and{" "}
                {new Date(latestScore.windowEnd).toLocaleDateString()}.
              </p>
              {scoreState.status === "stale" && (
                <p className="mt-2 text-xs text-muted">
                  Out of date: recent monitoring hasn&apos;t produced a current
                  score, so this no longer counts as current evidence. Shown
                  for reference only.
                </p>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">
              Not enough monitoring history yet to compute a score.
            </p>
          )}
        </div>
      </section>

      {/* 4 — What the agent is. */}
      <section aria-labelledby="about-heading" className="flex flex-col gap-4 border-t border-border pt-8">
        <h2 id="about-heading" className="text-heading">
          About this agent
        </h2>
        <div>
          <h3 className="eyebrow">Capabilities</h3>
          <div className="mt-2">
            <CapabilityTags tags={agent.capabilityTags} />
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="eyebrow">Agent Card</h3>
          <div className="mt-3">
            <AgentCardSummary card={card} />
          </div>
        </div>
        <dl className="text-sm">
          <dt className="text-xs text-muted">Registered</dt>
          <dd className="mt-0.5">{new Date(agent.createdAt).toLocaleDateString()}</dd>
        </dl>
      </section>
    </div>
  );
}
