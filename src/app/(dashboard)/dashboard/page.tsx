import Link from "next/link";
import type { ReactNode } from "react";
import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { listAgentsForOwner } from "@/lib/db/queries/agents";
import { listApiKeysForOwner } from "@/lib/db/queries/api-keys";
import { getEffectiveAgentStatus } from "@/lib/monitoring/heartbeat-status";
import { StatusPill } from "@/components/agents/status-pill";
import { VerificationStatus } from "@/components/trust/trust-report";
import { buttonClass } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/empty-state";
import { IconActivity, IconAlert, IconArrowRight, IconCheck, IconShield } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import * as T from "@/components/ui/table";

type OnboardingStepState = "done" | "current" | "upcoming";

function OnboardingStep({
  state,
  children,
}: {
  state: OnboardingStepState;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={cx(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs",
          state === "done"
            ? "border-positive-border bg-positive-surface text-positive"
            : state === "current"
              ? "border-foreground text-foreground"
              : "border-border-strong text-subtle",
        )}
      >
        {state === "done" ? <IconCheck className="size-3" /> : undefined}
        <span className="sr-only">{state === "done" ? "Done" : state === "current" ? "Next" : "Later"}</span>
      </span>
      <span className={state === "upcoming" ? "text-muted" : undefined}>{children}</span>
    </li>
  );
}

function Stat({
  label,
  value,
  detail,
  icon: Icon,
  alert = false,
}: {
  label: string;
  value: number;
  detail: string;
  icon: typeof IconActivity;
  alert?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 bg-surface px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Icon className={cx("size-3.5", alert ? "text-negative" : "text-subtle")} />
        {label}
      </p>
      <p className={cx("font-mono text-2xl tabular-nums", alert && "text-negative")}>{value}</p>
      <p className="text-xs text-muted">{detail}</p>
    </div>
  );
}

/** Attention-worthy health first; otherwise the list's own order. */
const HEALTH_ORDER: Record<string, number> = { down: 0, degraded: 1, unknown: 2, healthy: 3 };

const MAX_ROWS = 8;

export default async function DashboardPage() {
  const session = await verifySession();
  const [agentList, apiKeys] = await Promise.all([
    listAgentsForOwner(db, session.userId),
    listApiKeysForOwner(db, session.userId),
  ]);

  // Everything below is derived from the rows already loaded — no extra
  // queries. Health is the same `getEffectiveAgentStatus` the rest of the
  // app shows; drafts aren't monitored, so they're not counted in health.
  const agents = agentList.map((agent) => ({ agent, status: getEffectiveAgentStatus(agent) }));
  const active = agents.filter(({ agent }) => agent.lifecycleStatus === "active");
  const drafts = agents.length - active.length;
  const healthy = active.filter(({ status }) => status === "healthy").length;
  const needsAttention = active.filter(({ status }) => status === "degraded" || status === "down").length;
  const verified = agents.filter(({ agent }) => agent.ownershipVerifiedAt != null).length;
  const activeKeys = apiKeys.filter((k) => k.revokedAt == null).length;

  const inactiveAgent = agentList.find((a) => a.lifecycleStatus !== "active");
  const showOnboarding = active.length === 0;

  const rows = agents
    .map((row, index) => ({ ...row, index }))
    .sort((a, b) => {
      const byHealth =
        (a.agent.lifecycleStatus === "active" ? HEALTH_ORDER[a.status] ?? 2 : 4) -
        (b.agent.lifecycleStatus === "active" ? HEALTH_ORDER[b.status] ?? 2 : 4);
      return byHealth !== 0 ? byHealth : a.index - b.index;
    })
    .slice(0, MAX_ROWS);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Dashboard"
        title="Overview"
        actions={
          <>
            <Link href="/check-agent-trust" className={buttonClass({ variant: "secondary", size: "sm" })}>
              Check an agent
            </Link>
            <Link href="/dashboard/agents/new" className={buttonClass({ size: "sm" })}>
              Register agent
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
        <Stat
          label="Agents"
          value={agents.length}
          detail={`${active.length} active · ${drafts} draft`}
          icon={IconActivity}
        />
        <Stat
          label="Healthy"
          value={healthy}
          detail={`of ${active.length} active ${active.length === 1 ? "agent" : "agents"}`}
          icon={IconCheck}
        />
        <Stat
          label="Needs attention"
          value={needsAttention}
          detail={needsAttention > 0 ? "degraded or down" : "nothing flagged"}
          icon={IconAlert}
          alert={needsAttention > 0}
        />
        <Stat
          label="Active API keys"
          value={activeKeys}
          detail={`${apiKeys.length - activeKeys} revoked`}
          icon={IconShield}
        />
      </div>

      {showOnboarding && (
        <section aria-labelledby="onboarding-heading" className="rounded-lg border border-border bg-surface p-5">
          <h2 id="onboarding-heading" className="text-sm font-medium">
            Get your first agent monitored
          </h2>
          <ol className="mt-3 flex flex-col gap-2 text-sm">
            <OnboardingStep state={agents.length > 0 ? "done" : "current"}>
              <Link href="/dashboard/agents/new" className="font-medium hover:underline">
                Register agent
              </Link>{" "}
              <span className="text-muted">— name it and give it its exact invocation endpoint URL.</span>
            </OnboardingStep>
            <OnboardingStep state={agents.length === 0 ? "upcoming" : "current"}>
              {inactiveAgent ? (
                <Link href={`/dashboard/agents/${inactiveAgent.slug}`} className="font-medium hover:underline">
                  Activate monitoring
                </Link>
              ) : (
                "Activate monitoring"
              )}{" "}
              <span className="text-muted">— makes it public and puts it on the health-check schedule.</span>
            </OnboardingStep>
            <OnboardingStep state={verified > 0 ? "done" : "upcoming"}>
              Verify endpoint ownership (optional){" "}
              <span className="text-muted">— raises confidence in the resulting trustDecision.</span>
            </OnboardingStep>
            <OnboardingStep state="upcoming">
              Receive trust data{" "}
              <span className="text-muted">
                — other agents can look your endpoint up and get a reliability score and trustDecision.
              </span>
            </OnboardingStep>
          </ol>
        </section>
      )}

      <section aria-labelledby="agents-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="agents-heading" className="text-heading">
            Your agents
          </h2>
          {agents.length > 0 && (
            <Link href="/dashboard/agents" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
              {agents.length > MAX_ROWS ? `View all ${agents.length}` : "Reliability details"}
              <IconArrowRight className="size-3.5" />
            </Link>
          )}
        </div>

        {agents.length === 0 ? (
          <EmptyState
            title="No agents registered yet"
            action={
              <Link href="/dashboard/agents/new" className={buttonClass({ size: "sm" })}>
                Register your first agent
              </Link>
            }
          >
            Register an agent&apos;s endpoint to start collecting the monitoring
            evidence other agents check before calling it.
          </EmptyState>
        ) : (
          <div className={T.tableFrame}>
            <table className={cx(T.table, "min-w-[560px]")}>
              <thead>
                <tr className={T.theadRow}>
                  <th scope="col" className={T.th}>Agent</th>
                  <th scope="col" className={T.th}>Health</th>
                  <th scope="col" className={T.th}>Endpoint ownership</th>
                  <th scope="col" className={cx(T.th, "text-right")}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ agent, status }) => (
                  <tr key={agent.id} className={T.tbodyRowInteractive}>
                    <td className={T.td}>
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
                    <td className={T.td}>
                      <StatusPill status={status} />
                    </td>
                    <td className={T.td}>
                      <VerificationStatus verified={agent.ownershipVerifiedAt != null} />
                    </td>
                    <td className={cx(T.td, "text-right text-subtle")}>
                      <IconArrowRight className="ml-auto size-4" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
