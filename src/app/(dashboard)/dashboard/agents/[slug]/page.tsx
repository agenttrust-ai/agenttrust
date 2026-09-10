import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { getOwnedAgentBySlug } from "@/lib/db/queries/agents";
import { getLatestChecksForAgents } from "@/lib/db/queries/health-checks";
import { getLatestReliabilityScoreForOwnedAgent } from "@/lib/db/queries/reliability";
import { getEffectiveAgentStatus } from "@/lib/monitoring/heartbeat-status";
import { buildAgentCard } from "@/lib/validation/agent-card";
import { AgentForm } from "@/components/agents/agent-form";
import { DeleteAgentButton } from "@/components/agents/delete-agent-button";
import { StatusPill } from "@/components/agents/status-pill";
import { LastCheckSummary } from "@/components/agents/last-check-summary";
import { ReliabilityScoreBadge } from "@/components/agents/reliability-score";
import { AgentCardSummary } from "@/components/agents/agent-card-summary";
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
  const latestChecks = await getLatestChecksForAgents(db, session.userId, [
    agent.id,
  ]);
  const latest = latestChecks.get(agent.id);
  const latestScore = await getLatestReliabilityScoreForOwnedAgent(
    db,
    session.userId,
    agent.id,
  );
  const card = buildAgentCard(agent);

  const boundUpdate = updateAgentAction.bind(null, agent.id);
  const boundDelete = deleteAgentAction.bind(null, agent.id);
  const boundActivate = activateAgentAction.bind(null, agent.id);
  const isDraft = agent.lifecycleStatus === "draft";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/dashboard/agents"
            className="text-sm text-muted hover:text-foreground"
          >
            ← Agents
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {agent.name}
            </h1>
            <StatusPill status={getEffectiveAgentStatus(agent)} />
          </div>
        </div>
        <Link
          href={`/a/${agent.slug}`}
          className="text-sm text-accent hover:underline"
        >
          View public profile →
        </Link>
      </div>

      {isDraft && (
        <div className="max-w-xl rounded-lg border border-accent/30 bg-surface p-4">
          <h2 className="text-sm font-medium">This agent is still a draft</h2>
          <p className="mt-1 text-sm text-muted">
            Draft agents aren&apos;t on their public profile and aren&apos;t
            checked by monitoring yet. Activate it to make it publicly
            visible and start pull-based health checks and heartbeats
            counting toward its trust score.
          </p>
          <form action={boundActivate} className="mt-3">
            <button
              type="submit"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
            >
              Activate agent
            </button>
          </form>
        </div>
      )}

      <div className="max-w-xl rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Health</h2>
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
        {latest && !latest.success && latest.errorMessage && (
          <p className="mt-3 text-sm text-red-600">{latest.errorMessage}</p>
        )}
      </div>

      <div className="max-w-xl rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Reliability / trust score</h2>
          <ReliabilityScoreBadge score={latestScore?.score ?? null} />
        </div>
        {latestScore ? (
          <>
            <dl className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted">Uptime</dt>
                <dd className="mt-0.5">{latestScore.uptimeSubscore.toFixed(0)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Latency</dt>
                <dd className="mt-0.5">{latestScore.latencySubscore.toFixed(0)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Consistency</dt>
                <dd className="mt-0.5">{latestScore.consistencySubscore.toFixed(0)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Incidents</dt>
                <dd className="mt-0.5">{latestScore.incidentSubscore.toFixed(0)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted">
              Computed {new Date(latestScore.computedAt).toLocaleString()} from checks
              between {new Date(latestScore.windowStart).toLocaleDateString()} and{" "}
              {new Date(latestScore.windowEnd).toLocaleDateString()}.
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted">
            Not enough monitoring history yet — a score appears once enough checks
            have accumulated.
          </p>
        )}
      </div>

      <div className="max-w-xl rounded-lg border border-border bg-surface p-4">
        <h2 className="text-sm font-medium">Agent Card</h2>
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
            agentCardModalities: card.interfaces.modalities,
            agentCardInteractionType: card.interfaces.interactionType ?? "",
            agentCardDocumentationUrl: card.documentationUrl ?? "",
          }}
        />
      </div>

      <div className="max-w-xl border-t border-border pt-6">
        <h2 className="text-sm font-medium">Danger zone</h2>
        <p className="mt-1 text-sm text-muted">
          Permanently delete this agent and its registration data.
        </p>
        <div className="mt-3">
          <DeleteAgentButton action={boundDelete} agentName={agent.name} />
        </div>
      </div>
    </div>
  );
}
