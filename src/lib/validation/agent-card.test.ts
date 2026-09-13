import { describe, expect, it } from "vitest";
import {
  AGENT_CARD_MODALITIES,
  AGENT_CARD_SCHEMA_VERSION,
  agentCardInputSchema,
  buildAgentCard,
  parseAgentCardFormFields,
} from "./agent-card";

describe("agentCardInputSchema — valid input", () => {
  it("accepts an empty object, defaulting to nothing set", () => {
    const result = agentCardInputSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ modalities: [], interactionType: null });
  });

  it("accepts a full, valid card", () => {
    const result = agentCardInputSchema.safeParse({
      modalities: ["text", "json"],
      interactionType: "streaming",
      documentationUrl: "https://docs.example.com/agent",
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      modalities: ["text", "json"],
      interactionType: "streaming",
      documentationUrl: "https://docs.example.com/agent",
    });
  });

  it("treats an empty documentationUrl string as absent, not invalid", () => {
    const result = agentCardInputSchema.safeParse({ documentationUrl: "" });
    expect(result.success).toBe(true);
    expect(result.data?.documentationUrl).toBeUndefined();
  });

  it("accepts every defined modality at once (up to the full set, no more)", () => {
    const result = agentCardInputSchema.safeParse({
      modalities: [...AGENT_CARD_MODALITIES],
    });
    expect(result.success).toBe(true);
  });
});

describe("agentCardInputSchema — malformed input rejection", () => {
  it("rejects an unrecognized modality", () => {
    const result = agentCardInputSchema.safeParse({ modalities: ["telepathy"] });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate modalities", () => {
    const result = agentCardInputSchema.safeParse({ modalities: ["text", "text"] });
    expect(result.success).toBe(false);
  });

  it("rejects more modalities than the fixed set could ever contain", () => {
    const tooMany = Array.from({ length: AGENT_CARD_MODALITIES.length + 1 }, () => "text");
    const result = agentCardInputSchema.safeParse({ modalities: tooMany });
    expect(result.success).toBe(false);
  });

  it("rejects an unrecognized interaction type", () => {
    const result = agentCardInputSchema.safeParse({ interactionType: "telepathic" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-https documentation URL", () => {
    const result = agentCardInputSchema.safeParse({
      documentationUrl: "http://docs.example.com/agent",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a javascript: URI masquerading as a documentation URL", () => {
    const result = agentCardInputSchema.safeParse({
      documentationUrl: "javascript:alert(1)",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a documentation URL over the length limit", () => {
    const overlong = "https://example.com/" + "a".repeat(600);
    const result = agentCardInputSchema.safeParse({ documentationUrl: overlong });
    expect(result.success).toBe(false);
  });

  it("rejects an oversized modalities array even if individually each entry were valid-shaped garbage", () => {
    const result = agentCardInputSchema.safeParse({
      modalities: Array.from({ length: 500 }, () => "text"),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a completely wrong-shaped payload without throwing", () => {
    expect(() => agentCardInputSchema.safeParse("not an object")).not.toThrow();
    expect(agentCardInputSchema.safeParse("not an object").success).toBe(false);
    expect(agentCardInputSchema.safeParse(null).success).toBe(false);
    expect(agentCardInputSchema.safeParse([1, 2, 3]).success).toBe(false);
  });
});

describe("parseAgentCardFormFields", () => {
  it("reads multi-value modalities, a single interaction type, and the doc URL from FormData", () => {
    const fd = new FormData();
    fd.append("agentCardModalities", "text");
    fd.append("agentCardModalities", "json");
    fd.set("agentCardInteractionType", "async");
    fd.set("agentCardDocumentationUrl", "https://docs.example.com");

    const parsed = parseAgentCardFormFields(fd);
    expect(parsed.modalities).toEqual(["text", "json"]);
    expect(parsed.interactionType).toBe("async");
    expect(parsed.documentationUrl).toBe("https://docs.example.com");
  });

  it("normalizes an unselected interaction type ('') to null, not an empty string", () => {
    const fd = new FormData();
    fd.set("agentCardInteractionType", "");
    expect(parseAgentCardFormFields(fd).interactionType).toBeNull();
  });

  it("defaults cleanly when every Agent Card field is entirely absent", () => {
    const fd = new FormData();
    const parsed = parseAgentCardFormFields(fd);
    expect(parsed.modalities).toEqual([]);
    expect(parsed.interactionType).toBeNull();
    expect(agentCardInputSchema.safeParse(parsed).success).toBe(true);
  });
});

describe("buildAgentCard — derivation and safety", () => {
  const baseAgent = {
    name: "Support Bot",
    description: "Handles tier-1 support.",
    capabilityTags: ["chat", "billing"],
    authType: "bearer",
    agentCard: { modalities: ["text"], interactionType: "streaming", documentationUrl: "https://docs.example.com" },
  };

  it("derives name, description, capabilities, and auth type from the agent row, not from the stored blob", () => {
    const card = buildAgentCard(baseAgent);
    expect(card.name).toBe("Support Bot");
    expect(card.description).toBe("Handles tier-1 support.");
    expect(card.capabilities).toEqual(["chat", "billing"]);
    expect(card.authentication).toEqual({ type: "bearer" });
  });

  it("always stamps the current server-side schema version, regardless of what's stored", () => {
    const card = buildAgentCard(baseAgent);
    expect(card.schemaVersion).toBe(AGENT_CARD_SCHEMA_VERSION);
  });

  it("carries through the stored extension fields", () => {
    const card = buildAgentCard(baseAgent);
    expect(card.interfaces.modalities).toEqual(["text"]);
    expect(card.interfaces.interactionType).toBe("streaming");
    expect(card.documentationUrl).toBe("https://docs.example.com");
  });

  it("never includes endpointUrl, ownerId, id, or any other field not explicitly derived", () => {
    const agentWithExtraFields = {
      ...baseAgent,
      endpointUrl: "https://secret-internal-endpoint.example.com/invoke",
      ownerId: "11111111-1111-1111-1111-111111111111",
      id: "22222222-2222-2222-2222-222222222222",
    };
    const card = buildAgentCard(agentWithExtraFields);
    const serialized = JSON.stringify(card);
    expect(serialized).not.toContain("secret-internal-endpoint");
    expect(serialized).not.toContain(agentWithExtraFields.ownerId);
    expect(serialized).not.toContain(agentWithExtraFields.id);
  });

  it("never includes the credential ciphertext or header name, even when passed a full Agent-shaped row", () => {
    const agentWithCredentialFields = {
      ...baseAgent,
      authType: "api_key",
      authCredentialCiphertext: "planted-fake-ciphertext-value==",
      authHeaderName: "X-Custom-Key",
    };
    const card = buildAgentCard(agentWithCredentialFields);
    const serialized = JSON.stringify(card);
    expect(serialized).not.toContain("planted-fake-ciphertext-value");
    expect(serialized).not.toContain("authCredentialCiphertext");
    expect(serialized).not.toContain("X-Custom-Key");
    // The only auth-related thing the card ever exposes is the type.
    expect(card.authentication).toEqual({ type: "api_key" });
  });

  it("handles a legacy agent with an empty (default) stored card cleanly, with no extras", () => {
    const legacyAgent = { ...baseAgent, agentCard: {} };
    const card = buildAgentCard(legacyAgent);
    expect(card.interfaces.modalities).toEqual([]);
    expect(card.interfaces.interactionType).toBeNull();
    expect(card.documentationUrl).toBeNull();
  });

  it("handles a null description without throwing", () => {
    const card = buildAgentCard({ ...baseAgent, description: null });
    expect(card.description).toBeNull();
  });

  it("falls back to an all-empty card, without throwing, for a corrupt or hand-edited stored blob", () => {
    const corrupt = { ...baseAgent, agentCard: { modalities: "not-an-array", interactionType: 42 } };
    expect(() => buildAgentCard(corrupt)).not.toThrow();
    const card = buildAgentCard(corrupt);
    expect(card.interfaces.modalities).toEqual([]);
    expect(card.interfaces.interactionType).toBeNull();
  });

  it("falls back cleanly when the stored value is null itself (not even the default '{}')", () => {
    expect(() => buildAgentCard({ ...baseAgent, agentCard: null })).not.toThrow();
    const card = buildAgentCard({ ...baseAgent, agentCard: null });
    expect(card.interfaces.modalities).toEqual([]);
  });
});
