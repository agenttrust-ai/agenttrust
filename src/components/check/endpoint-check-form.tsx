import Form from "next/form";
import { cx } from "@/components/ui/cx";
import { buttonClass } from "@/components/ui/button";
import { IconArrowRight } from "@/components/ui/icons";

/**
 * The endpoint trust-check entry point. Submits to the existing canonical
 * `/check-agent-trust?endpointUrl=…` route (the same GET contract as
 * before) via `next/form`, so submission is a client-side navigation.
 * `next/form` prefetches only the bare action path, which performs no
 * lookup — a check only ever runs when someone actually submits.
 */
export function EndpointCheckForm({
  id,
  defaultValue,
  className,
}: {
  /** Unique per page — the input id the visible label points at. */
  id: string;
  /** The URL just checked, kept in the field on the results page. */
  defaultValue?: string;
  className?: string;
}) {
  const hintId = `${id}-hint`;
  return (
    <Form action="/check-agent-trust" className={cx("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        Agent endpoint URL
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={id}
          name="endpointUrl"
          type="url"
          inputMode="url"
          required
          maxLength={2048}
          defaultValue={defaultValue}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://agent.example.com/a2a"
          aria-describedby={hintId}
          className={cx(
            // flex-1 only in the row layout: in the stacked (column) layout
            // it would set flex-basis 0 and collapse the input's height.
            "h-12 w-full min-w-0 sm:w-auto sm:flex-1 rounded-md border border-border-strong bg-surface px-3.5 font-mono text-sm text-foreground",
            "placeholder:text-subtle transition-[border-color,box-shadow] duration-150 hover:border-muted",
            "focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/25 focus-visible:outline-none",
          )}
        />
        <button type="submit" className={buttonClass({ size: "lg", className: "h-12 px-5" })}>
          Check agent
          <IconArrowRight className="size-4" />
        </button>
      </div>
      <p id={hintId} className="text-xs text-muted">
        The exact URL your agent is about to call. Read-only lookup — no account
        or API key, and the endpoint itself is never contacted.
      </p>
    </Form>
  );
}
