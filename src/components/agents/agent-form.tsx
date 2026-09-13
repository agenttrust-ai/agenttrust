"use client";

import { useActionState, useState } from "react";
import {
  SUPPORTED_AGENT_AUTH_TYPES,
  DEFAULT_AUTH_HEADER_NAME,
} from "@/lib/validation/agent-constants";
import {
  AGENT_CARD_INTERACTION_TYPES,
  AGENT_CARD_MODALITIES,
  type AgentCardInteractionType,
  type AgentCardModality,
} from "@/lib/validation/agent-card";
import type { AgentFormState } from "@/lib/agents/actions";

const AUTH_TYPE_LABEL: Record<(typeof SUPPORTED_AGENT_AUTH_TYPES)[number], string> = {
  none: "None",
  bearer: "Bearer token",
  api_key: "API key",
};

const MODALITY_LABEL: Record<AgentCardModality, string> = {
  text: "Text",
  json: "JSON",
  audio: "Audio",
  image: "Image",
  video: "Video",
  file: "File",
};

const INTERACTION_TYPE_LABEL: Record<AgentCardInteractionType, string> = {
  "request-response": "Request/response",
  streaming: "Streaming",
  async: "Async",
};

type AgentFormValues = {
  name: string;
  description: string;
  endpointUrl: string;
  version: string;
  capabilities: string[];
  authType: string;
  /** Header name for authType "api_key" — never the credential itself. */
  authHeaderName: string;
  /** Whether a credential is already stored — never the credential itself, just drives the "leave blank to keep" vs "required" hint. */
  hasStoredCredential: boolean;
  agentCardModalities: string[];
  agentCardInteractionType: string;
  agentCardDocumentationUrl: string;
};

export function AgentForm({
  action,
  defaultValues,
  submitLabel,
}: {
  action: (
    state: AgentFormState,
    formData: FormData,
  ) => Promise<AgentFormState>;
  defaultValues?: Partial<AgentFormValues>;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);

  // The auth type has to be controlled state (not just a `defaultValue`) so
  // the credential fields below can react to it live — e.g. showing the API
  // key header field the instant someone picks "API key", with no round
  // trip. `initialAuthType` (what's actually stored, from `defaultValues`)
  // is kept separately so "switched to a different authenticated mode"
  // can be detected client-side too, matching the DAL's own
  // resolveCredentialColumnsForUpdate rule that a mode switch always needs
  // a fresh credential — this only drives the hint text, the DAL is still
  // the real enforcement.
  const initialAuthType = defaultValues?.authType ?? "none";
  const [authType, setAuthType] = useState(initialAuthType);
  const hasStoredCredential = defaultValues?.hasStoredCredential ?? false;
  const switchedAuthenticatedMode = authType !== initialAuthType;
  const showCredentialFields = authType === "bearer" || authType === "api_key";
  const credentialRequired =
    showCredentialFields && (!hasStoredCredential || switchedAuthenticatedMode);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium">
          Name
        </label>
        <input
          id="name"
          name="name"
          required
          defaultValue={defaultValues?.name}
          placeholder="Support Bot"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        {state?.errors?.name && (
          <p className="text-sm text-red-600">{state.errors.name[0]}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="description" className="text-sm font-medium">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={defaultValues?.description}
          placeholder="What this agent does, and who it's for."
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        {state?.errors?.description && (
          <p className="text-sm text-red-600">{state.errors.description[0]}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="endpointUrl" className="text-sm font-medium">
          Endpoint URL
        </label>
        <input
          id="endpointUrl"
          name="endpointUrl"
          required
          defaultValue={defaultValues?.endpointUrl}
          placeholder="https://agent.example.com/v1/invoke"
          className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        <p className="text-xs text-muted">
          Must be HTTPS and publicly reachable — not a localhost, private, or
          internal address.
        </p>
        {state?.errors?.endpointUrl && (
          <p className="text-sm text-red-600">{state.errors.endpointUrl[0]}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="version" className="text-sm font-medium">
            Version
          </label>
          <input
            id="version"
            name="version"
            defaultValue={defaultValues?.version}
            placeholder="1.0.0"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          {state?.errors?.version && (
            <p className="text-sm text-red-600">{state.errors.version[0]}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="authType" className="text-sm font-medium">
            Authentication type
          </label>
          <select
            id="authType"
            name="authType"
            required
            value={authType}
            onChange={(e) => setAuthType(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
          >
            {SUPPORTED_AGENT_AUTH_TYPES.map((type) => (
              <option key={type} value={type}>
                {AUTH_TYPE_LABEL[type]}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted">
            How AgentTrust authenticates to this endpoint when checking its
            health.
          </p>
          {state?.errors?.authType && (
            <p className="text-sm text-red-600">{state.errors.authType[0]}</p>
          )}
        </div>
      </div>

      {showCredentialFields && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="authCredential" className="text-sm font-medium">
              {authType === "bearer" ? "Bearer token" : "API key value"}
            </label>
            <input
              id="authCredential"
              name="authCredential"
              type="password"
              autoComplete="off"
              required={credentialRequired}
              placeholder={credentialRequired ? "Required" : "••••••••"}
              className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="text-xs text-muted">
              {credentialRequired
                ? "Encrypted at rest and never shown again after you save it."
                : "Leave blank to keep the credential already on file — enter a new value to replace it."}
            </p>
            {state?.errors?.authCredential && (
              <p className="text-sm text-red-600">{state.errors.authCredential[0]}</p>
            )}
          </div>

          {authType === "api_key" && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="authHeaderName" className="text-sm font-medium">
                Header name
              </label>
              <input
                id="authHeaderName"
                name="authHeaderName"
                defaultValue={defaultValues?.authHeaderName}
                placeholder={DEFAULT_AUTH_HEADER_NAME}
                className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-accent"
              />
              <p className="text-xs text-muted">
                Defaults to {DEFAULT_AUTH_HEADER_NAME} if left blank.
              </p>
              {state?.errors?.authHeaderName && (
                <p className="text-sm text-red-600">{state.errors.authHeaderName[0]}</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="capabilities" className="text-sm font-medium">
          Capabilities
        </label>
        <input
          id="capabilities"
          name="capabilities"
          defaultValue={defaultValues?.capabilities?.join(", ")}
          placeholder="chat, ticket-triage, billing"
          className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-accent"
        />
        <p className="text-xs text-muted">
          Comma-separated tags, lowercase with hyphens (e.g. ticket-triage).
        </p>
        {state?.errors?.capabilities && (
          <p className="text-sm text-red-600">{state.errors.capabilities[0]}</p>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-border p-4">
        <div>
          <h3 className="text-sm font-medium">Agent Card</h3>
          <p className="text-xs text-muted">
            Structured metadata other systems can read — shown on your public
            profile and through the Public API.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="agentCardModalities" className="text-sm font-medium">
              Modalities
            </label>
            <select
              id="agentCardModalities"
              name="agentCardModalities"
              multiple
              defaultValue={defaultValues?.agentCardModalities}
              className="h-28 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
            >
              {AGENT_CARD_MODALITIES.map((modality) => (
                <option key={modality} value={modality}>
                  {MODALITY_LABEL[modality]}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted">
              Cmd/Ctrl-click to select more than one.
            </p>
            {state?.errors?.agentCard && (
              <p className="text-sm text-red-600">{state.errors.agentCard[0]}</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="agentCardInteractionType" className="text-sm font-medium">
              Interaction type
            </label>
            <select
              id="agentCardInteractionType"
              name="agentCardInteractionType"
              defaultValue={defaultValues?.agentCardInteractionType ?? ""}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">Not specified</option>
              {AGENT_CARD_INTERACTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {INTERACTION_TYPE_LABEL[type]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="agentCardDocumentationUrl" className="text-sm font-medium">
            Documentation URL
          </label>
          <input
            id="agentCardDocumentationUrl"
            name="agentCardDocumentationUrl"
            defaultValue={defaultValues?.agentCardDocumentationUrl}
            placeholder="https://docs.example.com/my-agent"
            className="rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <p className="text-xs text-muted">
            A public https:// link to human-readable docs — never the
            agent&apos;s invocation endpoint, which stays private.
          </p>
        </div>
      </div>

      {state?.message && (
        <p className="text-sm text-red-600">{state.message}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
