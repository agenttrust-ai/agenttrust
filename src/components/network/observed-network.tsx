/**
 * The Observed Agent Network: AgentTrust's recurring visual motif — a
 * quiet lattice of endpoints AgentTrust observes, a few of them in a
 * health state, and thin traces carrying evidence into a Trust Report.
 *
 * Purely decorative and entirely static markup: server-rendered SVG, no
 * client JavaScript, `aria-hidden`, and a handful of elements (the
 * lattice itself is one SVG pattern). Nothing here represents real
 * production agents — there are no names, counts or live values. Motion
 * (a slow signal along each trace, a faint node pulse) is CSS-only and
 * only runs without a reduced-motion preference; see globals.css.
 */

type HeroNode = {
  /** Lattice column and row (32px cells). */
  c: number;
  r: number;
  tone: "observed" | "healthy" | "degraded" | "down" | "unknown" | "signal";
  pulse?: boolean;
};

const CELL = 32;
const at = (n: number) => CELL / 2 + CELL * n;

/*
 * Hand-placed, not random: nodes cluster around the Trust Report column
 * and thin out toward the headline. In the 1440-wide frame the report's
 * left edge sits at x=808 at both the lg and xl breakpoints, so the
 * composition holds from 1024px up.
 */
const NODES: HeroNode[] = [
  { c: 24, r: 1, tone: "observed" },
  { c: 26, r: 0, tone: "observed" },
  { c: 29, r: 1, tone: "healthy" },
  { c: 31, r: 0, tone: "observed" },
  { c: 33, r: 1, tone: "observed" },
  { c: 36, r: 1, tone: "signal", pulse: true },
  { c: 38, r: 0, tone: "unknown" },
  { c: 41, r: 1, tone: "healthy" },
  { c: 43, r: 2, tone: "observed" },
  { c: 42, r: 5, tone: "observed" },
  { c: 44, r: 7, tone: "degraded" },
  { c: 41, r: 9, tone: "observed" },
  { c: 43, r: 11, tone: "healthy" },
  { c: 40, r: 13, tone: "observed", pulse: true },
  { c: 44, r: 15, tone: "down" },
  { c: 42, r: 17, tone: "observed" },
  { c: 21, r: 2, tone: "observed" },
  { c: 23, r: 5, tone: "unknown" },
  { c: 19, r: 0, tone: "observed" },
  { c: 34, r: 17, tone: "observed" },
  { c: 30, r: 18, tone: "healthy" },
];

/* A few faint links between nodes — lattice-aligned, never a diagram. */
const LINKS = [
  `M${at(26)} ${at(0)} V${at(1)} H${at(29)}`,
  `M${at(33)} ${at(1)} H${at(36)} V${at(0)} H${at(38)}`,
  `M${at(41)} ${at(1)} V${at(2)} H${at(43)} V${at(5)} H${at(42)}`,
  `M${at(41)} ${at(9)} H${at(43)} V${at(11)}`,
];

const TONE_FILL: Record<HeroNode["tone"], string> = {
  observed: "fill-border-strong",
  healthy: "fill-positive opacity-60",
  degraded: "fill-caution opacity-60",
  down: "fill-negative opacity-60",
  unknown: "fill-none stroke-neutral opacity-70",
  signal: "fill-accent opacity-70",
};

/** Full-bleed backdrop for the homepage hero. Place inside a `relative isolate` section. */
export function ObservedNetworkBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden opacity-60 lg:opacity-100"
    >
      <svg
        className="absolute top-0 left-1/2 h-full w-[1440px] -translate-x-1/2 [mask-image:radial-gradient(ellipse_90%_45%_at_50%_0%,black_15%,transparent_75%)] lg:[mask-image:radial-gradient(ellipse_55%_95%_at_66%_30%,black_30%,transparent_80%)]"
        viewBox="0 0 1440 1200"
        preserveAspectRatio="xMidYMin slice"
        focusable="false"
      >
        <defs>
          <pattern id="at-lattice" width={CELL} height={CELL} patternUnits="userSpaceOnUse">
            <circle cx={CELL / 2} cy={CELL / 2} r="1.1" className="fill-border-strong" />
          </pattern>
        </defs>
        <rect width="1440" height="1200" fill="url(#at-lattice)" />
        <g className="fill-none stroke-border-strong" strokeWidth="1">
          {LINKS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        {NODES.map((n) => (
          <circle
            key={`${n.c}-${n.r}`}
            cx={at(n.c)}
            cy={at(n.r)}
            r={n.tone === "observed" ? 2.25 : 2.75}
            strokeWidth={n.tone === "unknown" ? 1.25 : undefined}
            className={`${TONE_FILL[n.tone]}${n.pulse ? " at-node-pulse" : ""}`}
          />
        ))}
      </svg>
    </div>
  );
}

/*
 * Evidence traces: four lines that come down the gutter beside the Trust
 * Report and turn into it — health, reliability, freshness, ownership
 * feeding the report. Coordinates are relative to the report's top-left
 * corner; ROW_Y are the evidence rows' vertical centers.
 */
const GUTTER = 56;
const TOP = 80; // how far above the report the traces begin
const ROW_Y = [189, 232, 274, 316];
const TRACE_X = [44, 34, 24, 14]; // upper rows turn in first, so lines never cross
const TRACE_START = [8, 40, 20, 56];

const TRACES = ROW_Y.map((row, i) => {
  const x = TRACE_X[i];
  const y = TOP + row;
  return {
    start: { x, y: TRACE_START[i] },
    d: `M${x} ${TRACE_START[i]} V${y - 6} Q${x} ${y} ${x + 6} ${y} H${GUTTER}`,
  };
});

/**
 * Sits in the gutter to the left of the hero's Trust Report (xl and up,
 * where there's clear space; hidden below that). Place inside the
 * report's `relative` wrapper.
 */
export function EvidenceTraces() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute right-full hidden xl:block"
      style={{ top: -TOP }}
      width={GUTTER}
      height={TOP + ROW_Y[ROW_Y.length - 1] + 8}
      viewBox={`0 0 ${GUTTER} ${TOP + ROW_Y[ROW_Y.length - 1] + 8}`}
    >
      <g className="fill-none stroke-border-strong" strokeWidth="1">
        {TRACES.map((t) => (
          <path key={t.d} d={t.d} />
        ))}
      </g>
      <g className="fill-none stroke-accent" strokeWidth="1.5" strokeLinecap="round">
        {TRACES.map((t, i) => (
          <path
            key={t.d}
            d={t.d}
            pathLength={100}
            strokeDasharray="8 192"
            className="at-signal"
            style={{ animationDelay: `${i * 2.5}s` }}
          />
        ))}
      </g>
      {TRACES.map((t) => (
        <circle key={t.d} cx={t.start.x} cy={t.start.y} r="2.25" className="fill-border-strong" />
      ))}
    </svg>
  );
}
