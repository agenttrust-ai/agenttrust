import { describe, expect, it } from "vitest";
import { agentInputSchema, parseAgentFormData, slugify } from "./agent";

const validInput = {
  name: "Support Bot",
  description: "Handles tier-1 customer support.",
  endpointUrl: "https://agent.acme.io/v1/invoke",
  version: "1.0.0",
  capabilities: ["chat", "ticket-triage"],
  authType: "bearer" as const,
};

describe("agentInputSchema", () => {
  it("accepts valid input", () => {
    const result = agentInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it("rejects a name that's too short", () => {
    const result = agentInputSchema.safeParse({ ...validInput, name: "x" });
    expect(result.success).toBe(false);
  });

  it("rejects an SSRF-unsafe endpoint URL", () => {
    const result = agentInputSchema.safeParse({
      ...validInput,
      endpointUrl: "https://169.254.169.254/latest/meta-data",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a plain-http endpoint URL", () => {
    const result = agentInputSchema.safeParse({
      ...validInput,
      endpointUrl: "http://agent.acme.io/health",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid authType", () => {
    const result = agentInputSchema.safeParse({
      ...validInput,
      authType: "password",
    });
    expect(result.success).toBe(false);
  });

  it("rejects oauth2 and custom — not supported in this MVP even though they remain valid DB enum values", () => {
    expect(
      agentInputSchema.safeParse({ ...validInput, authType: "oauth2" }).success,
    ).toBe(false);
    expect(
      agentInputSchema.safeParse({ ...validInput, authType: "custom" }).success,
    ).toBe(false);
  });

  it("rejects a malformed capability tag", () => {
    const result = agentInputSchema.safeParse({
      ...validInput,
      capabilities: ["Not Valid!"],
    });
    expect(result.success).toBe(false);
  });

  it("caps capabilities at 20 tags", () => {
    const result = agentInputSchema.safeParse({
      ...validInput,
      capabilities: Array.from({ length: 21 }, (_, i) => `tag-${i}`),
    });
    expect(result.success).toBe(false);
  });

  it("treats an empty description/version as absent", () => {
    const result = agentInputSchema.safeParse({
      ...validInput,
      description: "",
      version: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeUndefined();
      expect(result.data.version).toBeUndefined();
    }
  });

  it("accepts input with no agentCard at all — existing callers keep working unchanged", () => {
    const result = agentInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentCard).toBeUndefined();
    }
  });

  it("accepts a valid agentCard alongside the rest of the input", () => {
    const result = agentInputSchema.safeParse({
      ...validInput,
      agentCard: { modalities: ["text"], interactionType: "async" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentCard).toEqual({
        modalities: ["text"],
        interactionType: "async",
      });
    }
  });

  it("rejects the whole input when agentCard is present but malformed", () => {
    const result = agentInputSchema.safeParse({
      ...validInput,
      agentCard: { modalities: ["not-a-real-modality"] },
    });
    expect(result.success).toBe(false);
  });

  it("treats an empty authCredential/authHeaderName as absent, not as a value", () => {
    const result = agentInputSchema.safeParse({
      ...validInput,
      authCredential: "",
      authHeaderName: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.authCredential).toBeUndefined();
      expect(result.data.authHeaderName).toBeUndefined();
    }
  });

  it("accepts a bearer token credential", () => {
    const result = agentInputSchema.safeParse({
      ...validInput,
      authCredential: "sk-live-abc123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.authCredential).toBe("sk-live-abc123");
    }
  });

  it("accepts a custom, well-formed API key header name", () => {
    const result = agentInputSchema.safeParse({
      ...validInput,
      authType: "api_key",
      authCredential: "abc123",
      authHeaderName: "X-Custom-Key",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.authHeaderName).toBe("X-Custom-Key");
    }
  });

  it("rejects a header name containing invalid characters (e.g. a colon or space)", () => {
    expect(
      agentInputSchema.safeParse({
        ...validInput,
        authType: "api_key",
        authHeaderName: "X: Key",
      }).success,
    ).toBe(false);
    expect(
      agentInputSchema.safeParse({
        ...validInput,
        authType: "api_key",
        authHeaderName: "X Key",
      }).success,
    ).toBe(false);
  });

  it.each(["Host", "content-length", "Connection", "Transfer-Encoding", "TE", "Upgrade"])(
    "rejects the dangerous/connection-specific header name %s regardless of case",
    (name) => {
      const result = agentInputSchema.safeParse({
        ...validInput,
        authType: "api_key",
        authHeaderName: name,
      });
      expect(result.success).toBe(false);
    },
  );
});

describe("parseAgentFormData", () => {
  it("splits a comma-separated capabilities field into tags", () => {
    const formData = new FormData();
    formData.set("name", "Support Bot");
    formData.set("endpointUrl", "https://agent.acme.io/v1/invoke");
    formData.set("authType", "none");
    formData.set("capabilities", "chat, Ticket-Triage , billing");

    const result = parseAgentFormData(formData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capabilities).toEqual([
        "chat",
        "ticket-triage",
        "billing",
      ]);
    }
  });

  it("parses Agent Card fields (multi-select modalities, interaction type, doc URL) from the same form", () => {
    const formData = new FormData();
    formData.set("name", "Support Bot");
    formData.set("endpointUrl", "https://agent.acme.io/v1/invoke");
    formData.set("authType", "none");
    formData.append("agentCardModalities", "text");
    formData.append("agentCardModalities", "json");
    formData.set("agentCardInteractionType", "streaming");
    formData.set("agentCardDocumentationUrl", "https://docs.acme.io/support-bot");

    const result = parseAgentFormData(formData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentCard).toEqual({
        modalities: ["text", "json"],
        interactionType: "streaming",
        documentationUrl: "https://docs.acme.io/support-bot",
      });
    }
  });

  it("still succeeds, with an empty Agent Card, when none of those fields are submitted", () => {
    const formData = new FormData();
    formData.set("name", "Support Bot");
    formData.set("endpointUrl", "https://agent.acme.io/v1/invoke");
    formData.set("authType", "none");

    const result = parseAgentFormData(formData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentCard).toEqual({ modalities: [], interactionType: null });
    }
  });

  it("reads authCredential and authHeaderName from form fields", () => {
    const formData = new FormData();
    formData.set("name", "Support Bot");
    formData.set("endpointUrl", "https://agent.acme.io/v1/invoke");
    formData.set("authType", "api_key");
    formData.set("authCredential", "abc123");
    formData.set("authHeaderName", "X-Custom-Key");

    const result = parseAgentFormData(formData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.authCredential).toBe("abc123");
      expect(result.data.authHeaderName).toBe("X-Custom-Key");
    }
  });

  it("rejects the whole submission when an invalid modality is smuggled into the form", () => {
    const formData = new FormData();
    formData.set("name", "Support Bot");
    formData.set("endpointUrl", "https://agent.acme.io/v1/invoke");
    formData.set("authType", "none");
    formData.append("agentCardModalities", "carrier-pigeon");

    const result = parseAgentFormData(formData);
    expect(result.success).toBe(false);
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("My Cool Agent!")).toBe("my-cool-agent");
  });

  it("falls back to a default when nothing survives", () => {
    expect(slugify("!!!")).toBe("agent");
  });
});
