// Split out from agent.ts on purpose: this has zero dependencies, so Client
// Components (like the agent registration form) can import it directly
// without pulling in the SSRF checker — which imports `node:net` and can't
// be bundled for the browser at all.
export const AGENT_AUTH_TYPES = [
  "none",
  "api_key",
  "bearer",
  "oauth2",
  "custom",
] as const;

// The subset of AGENT_AUTH_TYPES actually offered and supported for
// credential-based monitoring in this MVP. "oauth2"/"custom" stay in
// AGENT_AUTH_TYPES (and the underlying DB enum) for schema compatibility,
// but are deliberately never selectable here — the registration/edit form
// and the request-signing input schema both use this narrower list, not
// AGENT_AUTH_TYPES.
export const SUPPORTED_AGENT_AUTH_TYPES = ["none", "bearer", "api_key"] as const;

/** Default header name used to send the credential when authType is "api_key". */
export const DEFAULT_AUTH_HEADER_NAME = "X-API-Key";
