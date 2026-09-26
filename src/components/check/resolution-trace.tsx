import { NetworkNode } from "@/components/network/network-node";

function Segment() {
  return <span className="h-px min-w-3 flex-1 bg-border-strong" />;
}

/**
 * The one-line path a lookup took: the endpoint URL, resolved against
 * AgentTrust's existing observations, into a Trust Report — or into no
 * match. It describes a directory lookup, never a live request: nothing
 * here suggests the endpoint itself was contacted.
 */
export function ResolutionTrace({ resolved }: { resolved: boolean }) {
  return (
    <div className="text-xs text-muted">
      <p className="sr-only">
        {resolved
          ? "Resolved from AgentTrust's existing observations. No request was sent to the endpoint."
          : "Not found in AgentTrust's existing observations. No request was sent to the endpoint."}
      </p>
      <div aria-hidden="true" className="flex items-center gap-2">
        <NetworkNode state="signal" size="sm" />
        <span>Endpoint</span>
        <Segment />
        <NetworkNode state={resolved ? "observed" : "unresolved"} size={resolved ? "md" : "lg"} />
        <span className="whitespace-nowrap">
          <span className="hidden sm:inline">AgentTrust </span>observations
        </span>
        <Segment />
        <span className="whitespace-nowrap text-foreground">{resolved ? "Trust report" : "No match"}</span>
      </div>
    </div>
  );
}
