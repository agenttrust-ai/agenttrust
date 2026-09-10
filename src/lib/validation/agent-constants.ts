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
