import { describe, expect, it } from "vitest";
import { deriveAgentStatus } from "./status";

const ok = { success: true };
const fail = { success: false };

describe("deriveAgentStatus", () => {
  it("is unknown with no check history", () => {
    expect(deriveAgentStatus("unknown", [])).toBe("unknown");
  });

  it("bootstraps to healthy on a single success with no prior status", () => {
    expect(deriveAgentStatus("unknown", [ok])).toBe("healthy");
  });

  it("bootstraps to degraded on a single failure with no prior status", () => {
    expect(deriveAgentStatus("unknown", [fail])).toBe("degraded");
  });

  it("does not flip to degraded on a single failure once a status is established", () => {
    expect(deriveAgentStatus("healthy", [fail, ok, ok])).toBe("healthy");
  });

  it("flips to degraded after 2 consecutive failures", () => {
    expect(deriveAgentStatus("healthy", [fail, fail, ok])).toBe("degraded");
  });

  it("does not yet flip to down after only 3 consecutive failures", () => {
    expect(deriveAgentStatus("healthy", [fail, fail, fail, ok])).toBe(
      "degraded",
    );
  });

  it("flips to down after 4 consecutive failures", () => {
    expect(deriveAgentStatus("degraded", [fail, fail, fail, fail, ok])).toBe(
      "down",
    );
  });

  it("recovers to healthy after 2 consecutive successes", () => {
    expect(deriveAgentStatus("down", [ok, ok, fail, fail, fail, fail])).toBe(
      "healthy",
    );
  });

  it("does not recover on a single success", () => {
    expect(deriveAgentStatus("down", [ok, fail, fail, fail, fail])).toBe(
      "down",
    );
  });

  it("holds the current status when neither threshold is met", () => {
    expect(deriveAgentStatus("degraded", [ok, fail])).toBe("degraded");
  });

  it("only looks at the leading run, not failures further back", () => {
    // Newest-first: 2 successes at the front should recover even though
    // there's a long failure streak earlier in the window.
    expect(
      deriveAgentStatus("down", [ok, ok, fail, fail, fail, fail, fail]),
    ).toBe("healthy");
  });
});
