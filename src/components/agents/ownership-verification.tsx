"use client";

import { useActionState } from "react";
import {
  checkOwnershipVerificationAction,
  startOwnershipVerificationAction,
  type OwnershipVerificationState,
} from "@/lib/agents/actions";

import type { ReactNode } from "react";
import { EvidenceGlyph } from "@/components/trust/evidence";
import { buttonClass } from "@/components/ui/button";
import { IconClock, IconShield, IconShieldCheck } from "@/components/ui/icons";
import { StatusChip } from "@/components/ui/status-chip";

/** Same panel chrome and heading as the other evidence panels on the agent page. */
function Panel({ status, children }: { status: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2.5 text-sm font-medium">
          <EvidenceGlyph kind="ownership" />
          Endpoint ownership
        </h3>
        {status}
      </div>
      {children}
    </div>
  );
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
      <Panel
        status={
          <StatusChip tone="positive" icon={IconShieldCheck}>
            Verified
          </StatusChip>
        }
      >
        <p className="mt-2 text-sm text-muted">
          Verified on {new Date(verifiedAt).toLocaleString()}. Other systems can see
          this on your public profile and through the Public API.
        </p>
      </Panel>
    );
  }

  if (!verificationToken || !verificationUrl) {
    return (
      <Panel
        status={
          <StatusChip tone="neutral" icon={IconShield}>
            Not verified
          </StatusChip>
        }
      >
        <p className="mt-2 text-sm text-muted">
          Prove you control this agent&apos;s endpoint so other systems can trust
          its identity, not just that something answers at its URL.
        </p>
        <form action={boundStart} className="mt-3">
          <button type="submit" className={buttonClass({ size: "sm" })}>
            Start verification
          </button>
        </form>
      </Panel>
    );
  }

  return (
    <Panel
      status={
        <StatusChip tone="caution" icon={IconClock}>
          Pending verification
        </StatusChip>
      }
    >
      <p className="mt-2 text-sm text-muted">
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
        <button type="submit" disabled={pending} className={buttonClass({ size: "sm" })}>
          {pending ? "Checking…" : "Check now"}
        </button>
      </form>
      {state?.error && <p className="mt-3 text-sm text-negative">{state.error}</p>}
    </Panel>
  );
}
