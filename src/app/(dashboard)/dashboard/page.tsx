import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { listAgentsForOwner } from "@/lib/db/queries/agents";
import { listApiKeysForOwner } from "@/lib/db/queries/api-keys";

type OnboardingStepState = "done" | "current" | "upcoming";

function OnboardingStep({
  state,
  children,
}: {
  state: OnboardingStepState;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-medium ${
          state === "done"
            ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400"
            : state === "current"
              ? "border-accent/30 bg-accent/10 text-accent"
              : "border-border text-muted"
        }`}
      >
        {state === "done" ? "✓" : undefined}
      </span>
      <span className={state === "upcoming" ? "text-muted" : undefined}>
        {children}
      </span>
    </li>
  );
}

export default async function DashboardPage() {
  const session = await verifySession();
  const agentList = await listAgentsForOwner(db, session.userId);
  const apiKeys = await listApiKeysForOwner(db, session.userId);
  const activeKeyCount = apiKeys.filter((k) => k.revokedAt == null).length;

  // Real agent state, not static prose: an agent already exists, is
  // already active (monitored + public), or already has a verified
  // endpoint. Reuses the same lifecycleStatus/ownershipVerifiedAt fields
  // the rest of the dashboard already reads — no new backend state.
  const hasAgent = agentList.length > 0;
  const activeAgent = agentList.find((a) => a.lifecycleStatus === "active");
  const inactiveAgent = agentList.find((a) => a.lifecycleStatus !== "active");
  const hasVerifiedAgent = agentList.some((a) => a.ownershipVerifiedAt != null);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted">Signed in as {session.email}.</p>
      </div>

      {!activeAgent && (
        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium">Get your first agent monitored</h2>
          <ol className="mt-3 flex flex-col gap-2 text-sm text-muted">
            <OnboardingStep state={hasAgent ? "done" : "current"}>
              <Link
                href="/dashboard/agents/new"
                className="font-medium text-foreground hover:underline"
              >
                Register agent
              </Link>{" "}
              — name it and give it its exact invocation endpoint URL.
            </OnboardingStep>
            <OnboardingStep state={!hasAgent ? "upcoming" : "current"}>
              {hasAgent && inactiveAgent ? (
                <Link
                  href={`/dashboard/agents/${inactiveAgent.slug}`}
                  className="font-medium text-foreground hover:underline"
                >
                  Activate monitoring
                </Link>
              ) : (
                "Activate monitoring"
              )}{" "}
              — makes it public and puts it on the health-check schedule.
            </OnboardingStep>
            <OnboardingStep state={hasVerifiedAgent ? "done" : "upcoming"}>
              Verify endpoint ownership (optional) — raises confidence in the
              resulting trustDecision.
            </OnboardingStep>
            <OnboardingStep state="upcoming">
              Receive trust data — other agents can look your endpoint up and
              get a reliability score and trustDecision.
            </OnboardingStep>
          </ol>
          {!hasAgent && (
            <Link
              href="/dashboard/agents/new"
              className="mt-4 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
            >
              Register agent →
            </Link>
          )}
          {hasAgent && inactiveAgent && (
            <Link
              href={`/dashboard/agents/${inactiveAgent.slug}`}
              className="mt-4 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
            >
              Activate {inactiveAgent.name} →
            </Link>
          )}
        </div>
      )}

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
