"use client";

import { useActionState, useState } from "react";
import { createApiKeyAction } from "@/lib/api-keys/actions";

export function CreateApiKeyForm() {
  const [state, formAction, pending] = useActionState(
    createApiKeyAction,
    undefined,
  );

  if (state?.created) {
    return (
      <RevealCreatedKey
        rawKey={state.created.rawKey}
        name={state.created.name}
      />
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="flex flex-1 flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium">
          Key name
        </label>
        <input
          id="name"
          name="name"
          required
          placeholder="e.g. Local development"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        {state?.errors?.name && (
          <p className="text-sm text-red-600">{state.errors.name[0]}</p>
        )}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create key"}
      </button>
      {state?.message && (
        <p className="text-sm text-red-600 sm:basis-full">{state.message}</p>
      )}
    </form>
  );
}

function RevealCreatedKey({ rawKey, name }: { rawKey: string; name: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-lg border border-accent bg-surface-2 p-4">
      <p className="text-sm font-medium">
        &ldquo;{name}&rdquo; created. Copy this key now — you won&apos;t be able
        to see it again.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm select-all">
          {rawKey}
        </code>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(rawKey);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="shrink-0 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-surface"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}
