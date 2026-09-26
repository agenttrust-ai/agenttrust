import { CopyButton } from "./copy-button";

/**
 * A server-rendered code example with a copy button. The scroll area is
 * focusable so long lines can be scrolled from the keyboard.
 */
export function CodeBlock({
  children,
  label = "Code example",
}: {
  children: string;
  label?: string;
}) {
  return (
    <div className="relative mt-2 rounded-md border border-border bg-surface-2">
      <pre
        tabIndex={0}
        aria-label={label}
        className="overflow-x-auto rounded-md p-3 pr-20 font-mono text-xs leading-relaxed"
      >
        <code>{children}</code>
      </pre>
      <CopyButton text={children} className="absolute top-2 right-2" />
    </div>
  );
}
