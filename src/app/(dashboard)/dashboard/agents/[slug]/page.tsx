import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { getOwnedAgentBySlug } from "@/lib/db/queries/agents";
import { getLatestChecksForAgents } from "@/lib/db/queries/health-checks";
import {
  getLatestReliabilityScoreForOwnedAgent,
  getReliabilityScoreStatusesForOwnedAgents,
} from "@/lib/db/queries/reliability";
import { getEffectiveAgentStatus } from "@/lib/monitoring/heartbeat-status";
import { SCORE_MAX_AGE_HOURS } from "@/lib/reliability/freshness";
import { buildAgentCard } from "@/lib/validation/agent-card";
import { AgentForm } from "@/components/agents/agent-form";
import { DeleteAgentButton } from "@/components/agents/delete-agent-button";
import { StatusPill } from "@/components/agents/status-pill";
import { PageHeader } from "@/components/ui/page-header";
import { LastCheckSummary } from "@/components/agents/last-check-summary";
import { ReliabilityScoreBadge } from "@/components/agents/reliability-score";
import { AgentCardSummary } from "@/components/agents/agent-card-summary";
import { OwnershipVerificationPanel } from "@/components/agents/ownership-verification";
import { NetworkNode } from "@/components/network/network-node";
import { EvidenceGlyph } from "@/components/trust/evidence";
import { trustReportFromEvidence } from "@/components/trust/report-data";
import { TrustReport } from "@/components/trust/trust-report";
import { buttonClass } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { buildVerificationUrl } from "@/lib/verification/ownership";
import {
  updateAgentAction,
  deleteAgentAction,
  activateAgentAction,
} from "@/lib/agents/actions";

export default async function AgentDetailPage({
  params,
}: PageProps<"/dashboard/agents/[slug]">) {
  const { slug } = await params;
  const session = await verifySession();
  const agent = await getOwnedAgentBySlug(db, session.userId, slug);
  // Independent reads — run together rather than one after another.
  const [latestChecks, latestScore] = await Promise.all([
    getLatestChecksForAgents(db, session.userId, [agent.id]),
    getLatestReliabilityScoreForOwnedAgent(db, session.userId, agent.id),
  ]);
  const latest = latestChecks.get(agent.id);
  const scoreStatus = (
    await getReliabilityScoreStatusesForOwnedAgents(
      db,
      session.userId,
      new Map([[agent.id, latestScore]]),
    )
  ).get(agent.id);
  const card = buildAgentCard(agent);
  // endpointUrl is always a well-formed URL by the time it's stored (the
  // same zod validation `agentColumns` relies on), so this can't actually
  // fail — the try/catch is just defense against ever crashing this page
  // render on a future/unexpected edge case.
  let verificationUrl: string | null = null;
  if (agent.ownershipVerificationToken) {
    try {
      verificationUrl = buildVerificationUrl(agent.endpointUrl);
    } catch {
      verificationUrl = null;
    }
  }

  const boundUpdate = updateAgentAction.bind(null, agent.id);
  const boundDelete = deleteAgentAction.bind(null, agent.id);
  const boundActivate = activateAgentAction.bind(null, agent.id);
  const isDraft = agent.lifecycleStatus === "draft";
  const status = getEffectiveAgentStatus(agent);
  // `check_agent_trust` and the REST lookup only match public, active
  // agents — anything else gets `{ matched: false }`, so that's what this
  // page shows instead of a report.
  const isListed = agent.visibility === "public" && agent.lifecycleStatus === "active";
  // The same four inputs the API feeds `computeTrustDecision`, so this is
  // exactly the report a caller gets for this endpoint right now.
  const report = trustReportFromEvidence({
    name: agent.name,
    slug: agent.slug,
    status,
    score: latestScore?.score ?? null,
    scoreStatus: scoreStatus ?? "none",
    verified: agent.ownershipVerifiedAt !== null,
  });

  return (
    <div className="flex flex-col gap-8">
      {/* 1 — Identity. */}
      <PageHeader
        back={{ href: "/dashboard/agents", label: "Agents" }}
        title={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {agent.name}
            <StatusPill status={status} />
          </span>
        }
        description={<span className="font-mono text-xs break-all">{agent.endpointUrl}</span>}
        actions={
          <Link href={`/a/${agent.slug}`} className="text-sm text-accent hover:underline">
            View public profile →
          </Link>
        }
      />

      {isDraft && (
        <div className="max-w-xl rounded-lg border border-accent/30 bg-surface p-4">
          <h2 className="text-sm font-medium">This agent is still a draft</h2>
          <p className="mt-1 text-sm text-muted">
            Draft agents aren&apos;t on their public profile and aren&apos;t
            checked by monitoring yet. Activate it to make it publicly visible
            and start pull-based health checks and heartbeats counting toward
            its trust score.
          </p>
          <form action={boundActivate} className="mt-3">
            <button type="submit" className={buttonClass({ size: "sm" })}>
              Activate agent
            </button>
          </form>
        </div>
      )}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] xl:gap-10">
        {/* 2 — The decision callers get. */}
        <section aria-labelledby="decision-heading" className="flex flex-col gap-3 lg:sticky lg:top-20">
          <div>
            <h2 id="decision-heading" className="text-heading">
              Trust decision
            </h2>
            <p className="mt-1 text-sm text-muted">
              What <code className="font-mono text-xs text-foreground">check_agent_trust</code> and the REST
              lookup return for this endpoint right now.
            </p>
          </div>
          {isListed ? (
            <TrustReport data={report} endpointUrl={agent.endpointUrl} headingLevel="p" />
          ) : (
            <Callout tone="neutral" title="Not in the public directory yet">
              Until this agent is active, callers checking its endpoint get{" "}
              <code className="font-mono text-xs text-foreground">{`{ "matched": false }`}</code> — no
              evidence either way.
            </Callout>
          )}
        </section>

        {/* 3 — The observed evidence behind it. */}
        <section aria-labelledby="evidence-heading" className="flex min-w-0 flex-col gap-3">
          <div>
            <h2 id="evidence-heading" className="flex items-center gap-2 text-heading">
              <NetworkNode state="observed" size="md" />
              Observed evidence
            </h2>
            <p className="mt-1 text-sm text-muted">
              Collected by AgentTrust&apos;s monitoring and ownership verification.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2.5 text-sm font-medium">
                <EvidenceGlyph kind="health" />
                Health
              </h3>
              <Link
                href={`/dashboard/agents/${agent.slug}/health`}
                className="text-sm text-accent hover:underline"
              >
                View history →
              </Link>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-xs text-muted">Last checked</dt>
                <dd className="mt-0.5">
                  <LastCheckSummary check={latest} field="checkedAt" />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Response time</dt>
                <dd className="mt-0.5">
                  <LastCheckSummary check={latest} field="latency" />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">HTTP status</dt>
                <dd className="mt-0.5">
                  <LastCheckSummary check={latest} field="httpStatus" />
                </dd>
              </div>
            </dl>
            {latest &&
              !latest.success &&
              (latest.statusCode === 401 || latest.statusCode === 403) && (
                <p className="mt-3 text-sm text-negative">
                  Authentication failed (HTTP {latest.statusCode}) — check the
                  credential and header name configured below.
                </p>
              )}
            {latest &&
              !latest.success &&
              latest.statusCode !== 401 &&
              latest.statusCode !== 403 &&
              latest.errorMessage && (
                <p className="mt-3 text-sm text-negative">{latest.errorMessage}</p>
              )}
          </div>

          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2.5 text-sm font-medium">
                <EvidenceGlyph kind="reliability" />
                Reliability score
              </h3>
              <ReliabilityScoreBadge
                score={latestScore?.score ?? null}
                status={scoreStatus}
              />
            </div>
            {latestScore ? (
              <>
                <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-muted">Uptime</dt>
                    <dd className="mt-0.5 font-mono tabular-nums">
                      {latestScore.uptimeSubscore.toFixed(0)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Latency</dt>
                    <dd className="mt-0.5 font-mono tabular-nums">
                      {latestScore.latencySubscore.toFixed(0)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Consistency</dt>
                    <dd className="mt-0.5 font-mono tabular-nums">
                      {latestScore.consistencySubscore.toFixed(0)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Incidents</dt>
                    <dd className="mt-0.5 font-mono tabular-nums">
                      {latestScore.incidentSubscore.toFixed(0)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-muted">
                  Computed {new Date(latestScore.computedAt).toLocaleString()} from
                  checks between{" "}
                  {new Date(latestScore.windowStart).toLocaleDateString()} and{" "}
                  {new Date(latestScore.windowEnd).toLocaleDateString()}.
                </p>
                {scoreStatus === "stale" && (
                  <p className="mt-2 text-xs text-muted">
                    Out of date: the latest health check couldn&apos;t produce a
                    new score (a score needs at least 5 checks in the 7 days
                    before it), or monitoring hasn&apos;t refreshed it in over{" "}
                    {SCORE_MAX_AGE_HOURS} hours. It no longer counts as current
                    evidence and your agent isn&apos;t recommended on it. It
                    becomes current again the next time monitoring computes a
                    score.
                  </p>
                )}
              </>
            ) : (
              <p className="mt-3 text-sm text-muted">
                Not enough monitoring history yet — a score appears once enough
                checks have accumulated.
              </p>
            )}
          </div>

          {!isDraft && !agent.ownershipVerifiedAt && (
            <p className="text-sm text-muted">
              <span className="font-medium text-foreground">Optional next step:</span> verify
              endpoint ownership. It raises the confidence of the trustDecision
              callers see, and is never required for{" "}
              <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs text-foreground">
                recommended
              </code>
              .
            </p>
          )}

          <OwnershipVerificationPanel
            agentId={agent.id}
            verificationToken={agent.ownershipVerificationToken}
            verificationUrl={verificationUrl}
            verifiedAt={agent.ownershipVerifiedAt?.toISOString() ?? null}
          />
        </section>
      </div>

      {/* 4 — Configuration. */}
      <section aria-labelledby="config-heading" className="flex flex-col gap-6 border-t border-border pt-8">
        <h2 id="config-heading" className="text-heading">
          Configuration
        </h2>

        <div className="max-w-xl rounded-lg border border-border bg-surface p-4">
          <h3 className="text-sm font-medium">Agent Card</h3>
          <p className="mt-1 text-xs text-muted">
            What the Public API and your public profile show as structured
            capability metadata.
          </p>
          <div className="mt-3">
            <AgentCardSummary card={card} />
          </div>
        </div>

        <div className="max-w-xl">
          <AgentForm
            action={boundUpdate}
            submitLabel="Save changes"
            defaultValues={{
              name: agent.name,
              description: agent.description ?? "",
              endpointUrl: agent.endpointUrl,
              version: agent.version ?? "",
              capabilities: agent.capabilityTags,
              authType: agent.authType,
              authHeaderName: agent.authHeaderName ?? "",
              hasStoredCredential: agent.authCredentialCiphertext !== null,
              agentCardModalities: card.interfaces.modalities,
              agentCardInteractionType: card.interfaces.interactionType ?? "",
              agentCardDocumentationUrl: card.documentationUrl ?? "",
            }}
          />
        </div>

        <div className="max-w-xl border-t border-border pt-6">
          <h3 className="text-sm font-medium">Danger zone</h3>
          <p className="mt-1 text-sm text-muted">
            Permanently delete this agent and its registration data.
          </p>
          <div className="mt-3">
            <DeleteAgentButton action={boundDelete} agentName={agent.name} />
          </div>
        </div>
      </section>
    </div>
  );
}
