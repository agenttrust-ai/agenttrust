/**
 * Shared data-table styling. Tables stay plain `<table>` markup (for
 * semantics and screen readers); these classes keep every table in the
 * app visually identical: hairline frame, mono eyebrow headers, and rows
 * that highlight on hover.
 */
// `relative` makes the frame the containing block for anything absolutely
// positioned inside the table (sr-only header labels, row link overlays),
// so it's clipped by this scroll container instead of widening the page.
export const tableFrame = "relative overflow-x-auto rounded-lg border border-border bg-surface";
export const table = "w-full text-sm";
export const theadRow = "border-b border-border bg-surface-2 text-left";
export const th = "eyebrow px-4 py-2.5 font-medium whitespace-nowrap";
export const tbodyRow = "border-b border-border last:border-0";
export const tbodyRowInteractive = "relative border-b border-border last:border-0 transition-colors duration-150 hover:bg-surface-2";
export const td = "px-4 py-3 align-middle";
