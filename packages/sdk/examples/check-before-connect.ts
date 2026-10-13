/**
 * A trust gate in front of an MCP connection: an agent that's about to
 * connect to an MCP server it found at runtime (from a registry, a user, or
 * another agent) asks AgentTrust first, and only connects if the server
 * meets its policy.
 *
 *   npx tsx packages/sdk/examples/check-before-connect.ts https://mcp.example.com/mcp
 *
 * Each run makes one anonymous request to AgentTrust (rate-limited per IP).
 * AgentTrust never contacts the server being checked.
 */
import {
  AgentTrustError,
  NotTrustedError,
  createAgentTrustClient,
  type TrustCheckResult,
  type TrustPolicy,
} from "../src/index.js";

const agentTrust = createAgentTrustClient({ timeoutMs: 5_000 });

/** What this agent requires before connecting to a server it didn't configure itself. */
const policy: TrustPolicy = {
  requireRecommended: true, // AgentTrust's own decision: healthy, fresh score ≥ 50
  minReliabilityScore: 80, // stricter than AgentTrust's default threshold
  allowUnknown: false, // fail closed on servers AgentTrust hasn't observed
};

/**
 * Connects only if the server passes the policy. `connect` is whatever your
 * MCP client does — for example, with the official TypeScript SDK:
 *
 *   const client = new Client({ name: "my-agent", version: "1.0.0" });
 *   await client.connect(new StreamableHTTPClientTransport(new URL(url)));
 */
export async function connectWithTrustGate<T>(
  serverUrl: string,
  connect: (url: string) => Promise<T>,
): Promise<{ connected: true; client: T; trust: TrustCheckResult } | { connected: false; reason: string }> {
  try {
    const trust = await agentTrust.assertTrusted(serverUrl, policy);
    return { connected: true, client: await connect(serverUrl), trust };
  } catch (error) {
    if (error instanceof NotTrustedError) {
      const observation = !error.result.matched ? error.result.observation?.message : undefined;
      return { connected: false, reason: [...error.failures, observation].filter(Boolean).join(" — ") };
    }
    if (error instanceof AgentTrustError && error.code === "RATE_LIMITED") {
      // Fail closed, and don't hammer AgentTrust: back off for the time it asks.
      return { connected: false, reason: `trust check rate-limited; retry in ${error.retryAfterSeconds ?? "a few"}s` };
    }
    if (error instanceof AgentTrustError) {
      // Couldn't get a decision (timeout, network, bad URL): fail closed.
      return { connected: false, reason: `trust check unavailable (${error.code}): ${error.message}` };
    }
    throw error;
  }
}

async function main() {
  const serverUrl = process.argv[2];
  if (!serverUrl) {
    console.error("Usage: npx tsx packages/sdk/examples/check-before-connect.ts <mcp-server-url>");
    process.exitCode = 2;
    return;
  }

  // Stand-in for a real MCP connection, so the example has no other dependencies.
  const outcome = await connectWithTrustGate(serverUrl, async (url) => ({ url, connectedAt: new Date() }));

  if (outcome.connected) {
    const { trust } = outcome;
    if (trust.matched) {
      console.log(
        `Connected to ${trust.name}: ${trust.status}, score ${trust.reliabilityScore}, confidence ${trust.trustDecision.confidence}${trust.verified ? ", verified" : ""}.`,
      );
    }
  } else {
    console.log(`Not connecting to ${serverUrl}: ${outcome.reason}`);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("check-before-connect.ts")) {
  void main();
}
