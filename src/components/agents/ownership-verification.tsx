"use client";

import { useActionState } from "react";
import {
  checkOwnershipVerificationAction,
  startOwnershipVerificationAction,
  type OwnershipVerificationState,
} from "@/lib/agents/actions";

const BADGE_BASE =
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium";

function Badge({ label, className }: { label: string; className: string }) {
  return <span className={`${BADGE_BASE} ${className}`}>{label}</span>;
}

export function OwnershipVerificationPanel({
  agentId,
  verificationToken,
  verificationUrl,
  verifiedAt,
}: {
  agentId: string;
  /** Only ever passed in on the *owner's own* dashboard page — never rendered anywhere public. */
  verificationToken: string | null;
  verificationUrl: string | null;
  verifiedAt: string | null;
}) {
  const boundCheck = checkOwnershipVerificationAction.bind(null, agentId);
  const [state, checkAction, pending] = useActionState<
    OwnershipVerificationState,
    FormData
  >(boundCheck, undefined);
  const boundStart = startOwnershipVerificationAction.bind(null, agentId);

  if (verifiedAt) {
    return (
      <div className="max-w-xl rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Endpoint ownership</h2>
          <Badge
            label="Verified"
            className="border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400"
          />
        </div>
        <p className="mt-1 text-sm text-muted">
          Verified on {new Date(verifiedAt).toLocaleString()}. Other systems can see
          this on your public profile and through the Public API.
        </p>
      </div>
    );
  }

  if (!verificationToken || !verificationUrl) {
    return (
      <div className="max-w-xl rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Endpoint ownership</h2>
          <Badge
            label="Unverified"
            className="border-border bg-surface text-muted"
          />
        </div>
        <p className="mt-1 text-sm text-muted">
          Prove you control this agent&apos;s endpoint so other systems can trust
          its identity, not just that something answers at its URL.
        </p>
        <form action={boundStart} className="mt-3">
          <button
            type="submit"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            Start verification
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-xl rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Endpoint ownership</h2>
        <Badge
          label="Pending verification"
          className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
        />
      </div>
      <p className="mt-1 text-sm text-muted">
        Publish a file at this exact URL, containing exactly this value, then check
        again:
      </p>
      <p className="mt-3 text-xs text-muted">URL</p>
      <code className="mt-0.5 block break-all rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">
        {verificationUrl}
      </code>
      <p className="mt-3 text-xs text-muted">File contents</p>
      <code className="mt-0.5 block break-all rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">
        {verificationToken}
      </code>
      <form action={checkAction} className="mt-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Checking…" : "Check now"}
        </button>
      </form>
      {state?.error && <p className="mt-3 text-sm text-red-600">{state.error}</p>}
    </div>
  );
}
