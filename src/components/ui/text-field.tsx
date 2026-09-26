import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { IconAlert } from "./icons";

/**
 * Shared control styling without a height, for multi-line controls
 * (`<textarea>`, `<select multiple>`) that set their own — combining two
 * height utilities would leave the winner up to CSS order.
 */
export const inputBaseClass =
  "w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-foreground " +
  "placeholder:text-subtle transition-[border-color,box-shadow] duration-150 " +
  "hover:border-muted focus-visible:border-accent focus-visible:outline-none " +
  "focus-visible:ring-3 focus-visible:ring-accent/25 " +
  "aria-invalid:border-negative aria-invalid:focus-visible:ring-negative/25 " +
  "disabled:cursor-not-allowed disabled:opacity-60";

/** Shared single-line input/select styling, for controls that aren't wrapped in `TextField`. */
export const inputClass = `${inputBaseClass} h-10`;

/**
 * Label + input + optional hint + optional error, with the accessibility
 * wiring done once: the hint and error are linked via `aria-describedby`
 * and an error sets `aria-invalid`. No hooks — usable from server and
 * client components alike.
 */
export function TextField({
  id,
  label,
  hint,
  error,
  className,
  ...inputProps
}: Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(inputClass, className)}
        {...inputProps}
      />
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-sm text-negative">
          <IconAlert className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

/** A form-level message (e.g. "Invalid credentials"), announced when it appears. */
export function FormError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md border border-negative-border bg-negative-surface px-3 py-2 text-sm text-negative"
    >
      <IconAlert className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
