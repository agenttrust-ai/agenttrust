"use client";

import { useActionState, useState } from "react";
import { createApiKeyAction } from "@/lib/api-keys/actions";
import { buttonClass } from "@/components/ui/button";
import { FormError, inputClass } from "@/components/ui/text-field";

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
          aria-invalid={state?.errors?.name ? true : undefined}
          className={inputClass}
        />
        {state?.errors?.name && (
          <p className="text-sm text-negative">{state.errors.name[0]}</p>
        )}
      </div>
      <button
        type="submit"
        disabled={pending}
        className={buttonClass({ className: "h-10" })}
      >
        {pending ? "Creating…" : "Create key"}
      </button>
      {state?.message && (
        <div className="sm:basis-full">
          <FormError>{state.message}</FormError>
        </div>
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
