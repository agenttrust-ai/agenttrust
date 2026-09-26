import type { ReactNode } from "react";
import type { ReliabilityScoreStatus } from "@/lib/reliability/freshness";
import { ReliabilityScoreBadge } from "@/components/agents/reliability-score";
import { StatusPill } from "@/components/agents/status-pill";
import { cx } from "@/components/ui/cx";
import {
  IconActivity,
  IconCheck,
  IconClock,
  IconDashedCircle,
  IconGauge,
  IconShield,
  IconShieldCheck,
  IconX,
  type IconComponent,
} from "@/components/ui/icons";
import { StatusChip } from "@/components/ui/status-chip";
import {
  CONFIDENCE_LABEL,
  CONFIDENCE_LEVELS,
  reasonsHeading,
  verdictOf,
  type TrustDecisionView,
  type VerdictKind,
} from "./verdict";

/**
 * Exactly the fields `check_agent_trust` returns for a matched agent — the
 * report renders only what the backend already provides.
 */
export type TrustReportData = {
  name?: string;
  slug?: string;
  status?: string;
  verified?: boolean;
  reliabilityScore?: number | null;
  reliabilityScoreStatus?: ReliabilityScoreStatus;
  trustDecision: TrustDecisionView;
};

const VERDICT_ICON: Record<VerdictKind, IconComponent> = {
  recommended: IconCheck,
  not_recommended: IconX,
  insufficient_data: IconDashedCircle,
};

const VERDICT_RAIL: Record<VerdictKind, string> = {
  recommended: "bg-positive",
  not_recommended: "bg-negative",
  insufficient_data: "bg-neutral",
};

const VERDICT_TILE: Record<VerdictKind, string> = {
  recommended: "border-positive-border bg-positive-surface text-positive",
  not_recommended: "border-negative-border bg-negative-surface text-negative",
  insufficient_data: "border-neutral-border bg-neutral-surface text-neutral",
};

/** Four discrete, labeled steps — the backend's own confidence values. */
export function ConfidenceMeter({
  confidence,
}: {
  confidence: TrustDecisionView["confidence"];
}) {
  const level = CONFIDENCE_LEVELS.indexOf(confidence);
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="flex gap-0.5">
        {[1, 2, 3].map((step) => (
          <span
            key={step}
            className={cx(
              "h-1.5 w-4 rounded-full",
              step <= level ? "bg-foreground" : "bg-border-strong",
            )}
          />
        ))}
      </span>
      <span className="text-xs text-muted">
        Confidence:{" "}
        <span className="font-medium text-foreground">
          {CONFIDENCE_LABEL[confidence]}
        </span>
      </span>
    </div>
  );
}

export function VerificationStatus({ verified }: { verified: boolean }) {
  return verified ? (
    <StatusChip tone="positive" icon={IconShieldCheck}>
      Verified
    </StatusChip>
  ) : (
    <StatusChip tone="neutral" icon={IconShield}>
      Not verified
    </StatusChip>
  );
}

const FRESHNESS: Record<
  ReliabilityScoreStatus,
  { tone: "positive" | "neutral"; icon: IconComponent; label: string }
> = {
  fresh: { tone: "positive", icon: IconClock, label: "Current" },
  stale: { tone: "neutral", icon: IconClock, label: "Out of date" },
  none: { tone: "neutral", icon: IconDashedCircle, label: "No score yet" },
};

export function EvidenceFreshness({ status }: { status: ReliabilityScoreStatus }) {
  const f = FRESHNESS[status];
  return (
    <StatusChip tone={f.tone} icon={f.icon}>
      {f.label}
    </StatusChip>
  );
}

function EvidenceRow({
  icon: Icon,
  label,
  children,
}: {
  icon: IconComponent;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="flex items-center gap-2 text-sm text-muted">
        <Icon className="size-4 text-subtle" />
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * The AgentTrust Trust Report: verdict first, then confidence, the
 * evidence behind it, and the backend's own reasons. Purely
 * presentational — every value comes from a `check_agent_trust`-shaped
 * result; nothing is recomputed here.
 *
 * `compact` drops the identity header and evidence grid for use where
 * several reports sit side by side.
 */
export function TrustReport({
  data,
  endpointUrl,
  example = false,
  headingLevel = "h2",
  compact = false,
  className,
}: {
  data: TrustReportData;
  endpointUrl?: string;
  /** Illustrative data — labels the report so it can't pass for a live lookup. */
  example?: boolean;
  /** Use "p" where the report sits inside another section's heading outline. */
  headingLevel?: "h2" | "h3" | "p";
  compact?: boolean;
  className?: string;
}) {
  const verdict = verdictOf(data.trustDecision);
  const VerdictIcon = VERDICT_ICON[verdict.kind];
  const Heading = headingLevel;
  const reasons = data.trustDecision.reasons;

  return (
    <article
      className={cx(
        "relative overflow-hidden rounded-lg border border-border bg-surface",
        "shadow-[0_1px_0_0_var(--border),0_24px_48px_-32px_rgb(0_0_0/0.35)]",
        className,
      )}
    >
      <span aria-hidden="true" className={cx("absolute inset-y-0 left-0 w-1", VERDICT_RAIL[verdict.kind])} />

      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <p className="eyebrow">{example ? "Example trust report" : "Trust report"}</p>
          {!compact && (
            <>
              <Heading className="mt-1 truncate text-sm font-semibold">
                {data.name ?? data.slug}
              </Heading>
              {endpointUrl && (
                <p className="mt-0.5 font-mono text-xs break-all text-muted">{endpointUrl}</p>
              )}
            </>
          )}
        </div>
      </header>

      <div className="px-5 pt-4 pb-4">
        <div className="flex items-center gap-3">
          <span
            className={cx(
              "flex size-10 shrink-0 items-center justify-center rounded-md border",
              VERDICT_TILE[verdict.kind],
            )}
          >
            <VerdictIcon className="size-5" />
          </span>
          <div className="min-w-0">
            {compact ? (
              <Heading className="text-heading">{verdict.label}</Heading>
            ) : (
              <p className="text-title">{verdict.label}</p>
            )}
            <div className="mt-1">
              <ConfidenceMeter confidence={data.trustDecision.confidence} />
            </div>
          </div>
        </div>

        {!compact && (
          <dl className="mt-4 divide-y divide-border border-y border-border">
            <EvidenceRow icon={IconActivity} label="Health">
              <StatusPill status={data.status ?? "unknown"} />
            </EvidenceRow>
            <EvidenceRow icon={IconGauge} label="Reliability">
              <ReliabilityScoreBadge
                score={data.reliabilityScore ?? null}
                status={data.reliabilityScoreStatus}
              />
            </EvidenceRow>
            <EvidenceRow icon={IconClock} label="Evidence">
              <EvidenceFreshness status={data.reliabilityScoreStatus ?? "none"} />
            </EvidenceRow>
            <EvidenceRow icon={IconShield} label="Endpoint ownership">
              <VerificationStatus verified={data.verified ?? false} />
            </EvidenceRow>
          </dl>
        )}

        {compact && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <StatusPill status={data.status ?? "unknown"} />
            <ReliabilityScoreBadge
              score={data.reliabilityScore ?? null}
              status={data.reliabilityScoreStatus}
            />
            <VerificationStatus verified={data.verified ?? false} />
          </div>
        )}

        <div className="mt-4">
          <p className="text-xs font-medium text-foreground">
            {reasonsHeading(verdict.kind, reasons.length)}
          </p>
          {reasons.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1">
              {reasons.map((reason) => (
                <li key={reason} className="flex gap-2 text-sm text-muted">
                  <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-subtle" />
                  {reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <footer className="flex flex-wrap gap-x-3 gap-y-0.5 border-t border-border bg-surface-2 px-5 py-2.5 font-mono text-xs text-muted">
        <span>trustDecision</span>
        <span className="text-foreground">recommended: {String(data.trustDecision.recommended)}</span>
        <span className="text-foreground">confidence: &quot;{data.trustDecision.confidence}&quot;</span>
      </footer>
    </article>
  );
}

/**
 * `{ matched: false }` in the same card chrome as a Trust Report — but not
 * a verdict: AgentTrust simply has no observations for that exact URL.
 * Deliberately neutral; it is not an error and not a negative result.
 */
export function NotMatchedReport({ endpointUrl }: { endpointUrl?: string }) {
  return (
    <article className="relative overflow-hidden rounded-lg border border-dashed border-border-strong bg-surface">
      <header className="border-b border-border px-5 py-3">
        <p className="eyebrow">Trust report</p>
        {endpointUrl && (
          <p className="mt-1 font-mono text-xs break-all text-muted">{endpointUrl}</p>
        )}
      </header>
      <div className="flex gap-3 px-5 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-neutral-border bg-neutral-surface text-neutral">
          <IconDashedCircle className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-heading">No evidence for this endpoint</p>
          <p className="mt-1 text-sm text-muted">
            AgentTrust hasn&apos;t observed an agent at this exact URL, so it has
            no evidence either way. This is an unknown — not an error, not a
            negative result, and not a sign the endpoint is unsafe.
          </p>
        </div>
      </div>
      <footer className="border-t border-border bg-surface-2 px-5 py-2.5 font-mono text-xs text-foreground">
        {`{ "matched": false }`}
      </footer>
    </article>
  );
}
