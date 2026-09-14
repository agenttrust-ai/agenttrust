import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, seedUser } from "@/lib/db/test-harness";
import type { AppDatabase } from "@/lib/db/rls";
import { AppError, ErrorCode } from "@/lib/errors";

vi.mock("@/lib/monitoring/safe-fetch", () => ({
  fetchOwnershipVerificationFile: vi.fn(),
}));

import {
  activateOwnedAgent,
  checkOwnershipVerification,
  createAgent,
  deleteOwnedAgent,
  getOwnedAgent,
  getOwnedAgentBySlug,
  getPublicAgentBySlug,
  listAgentsForOwner,
  listPublicAgents,
  recordAgentHeartbeatBySlug,
  startOwnershipVerification,
  updateOwnedAgent,
} from "./agents";
import type { AgentInput } from "@/lib/validation/agent";
import { AGENT_CARD_SCHEMA_VERSION } from "@/lib/validation/agent-card";
import { decryptAgentCredential } from "@/lib/security/agent-credentials";
import { env } from "@/lib/config.server";
import { fetchOwnershipVerificationFile } from "@/lib/monitoring/safe-fetch";

const mockedFetchOwnershipVerificationFile = vi.mocked(fetchOwnershipVerificationFile);

const userA = "11111111-1111-1111-1111-111111111111";
const userB = "22222222-2222-2222-2222-222222222222";

const baseInput: AgentInput = {
  name: "Support Bot",
  description: "Handles tier-1 support.",
  endpointUrl: "https://agent.acme.io/v1/invoke",
  version: "1.0.0",
  capabilities: ["chat", "ticket-triage"],
  authType: "bearer",
  authCredential: "test-bearer-token",
};

let client: PGlite;
let db: AppDatabase;

beforeEach(async () => {
  const harness = await createTestDb();
  client = harness.client;
  db = harness.db;
  await seedUser(client, userA, "a@example.com");
  await seedUser(client, userB, "b@example.com");
  mockedFetchOwnershipVerificationFile.mockReset();
});

afterEach(async () => {
  await client.close();
});

describe("createAgent", () => {
  it("creates an agent owned by the caller, with a slug derived from the name", async () => {
    const agent = await createAgent(db, userA, baseInput);
    expect(agent.ownerId).toBe(userA);
    expect(agent.slug).toBe("support-bot");
    expect(agent.name).toBe("Support Bot");
    expect(agent.capabilityTags).toEqual(["chat", "ticket-triage"]);
    expect(agent.authType).toBe("bearer");
    expect(agent.lifecycleStatus).toBe("draft");
  });

  it("disambiguates a slug collision instead of failing", async () => {
    const first = await createAgent(db, userA, baseInput);
    const second = await createAgent(db, userB, baseInput);
    expect(first.slug).toBe("support-bot");
    expect(second.slug).toBe("support-bot-2");
  });
});

describe("createAgent / updateOwnedAgent — Agent Card persistence", () => {
  it("persists the Agent Card extension fields and stamps the current schema version", async () => {
    const agent = await createAgent(db, userA, {
      ...baseInput,
      agentCard: {
        modalities: ["text", "json"],
        interactionType: "streaming",
        documentationUrl: "https://docs.acme.io/support-bot",
      },
    });

    expect(agent.agentCard).toEqual({
      modalities: ["text", "json"],
      interactionType: "streaming",
      documentationUrl: "https://docs.acme.io/support-bot",
    });
    expect(agent.agentCardSchemaVersion).toBe(AGENT_CARD_SCHEMA_VERSION);
  });

  it("defaults to an empty Agent Card, still with the current schema version, when none is given", async () => {
    const agent = await createAgent(db, userA, baseInput);
    expect(agent.agentCard).toEqual({
      modalities: [],
      interactionType: null,
      documentationUrl: undefined,
    });
    expect(agent.agentCardSchemaVersion).toBe(AGENT_CARD_SCHEMA_VERSION);
  });

  it("updateOwnedAgent replaces the stored Agent Card", async () => {
    const created = await createAgent(db, userA, {
      ...baseInput,
      agentCard: { modalities: ["text"], interactionType: null, documentationUrl: undefined },
    });

    const updated = await updateOwnedAgent(db, userA, created.id, {
      ...baseInput,
      agentCard: {
        modalities: ["audio", "video"],
        interactionType: "async",
        documentationUrl: "https://docs.acme.io/v2",
      },
    });

    expect(updated.agentCard).toEqual({
      modalities: ["audio", "video"],
      interactionType: "async",
      documentationUrl: "https://docs.acme.io/v2",
    });
  });

  it("updateOwnedAgent without a new Agent Card resets it to empty, not the previous value (agentColumns always writes the full column)", async () => {
    const created = await createAgent(db, userA, {
      ...baseInput,
      agentCard: { modalities: ["text"], interactionType: "async", documentationUrl: undefined },
    });

    const updated = await updateOwnedAgent(db, userA, created.id, baseInput);
    expect(updated.agentCard).toEqual({
      modalities: [],
      interactionType: null,
      documentationUrl: undefined,
    });
  });

  it("the stored schema version is always the current constant, never anything from the input shape", async () => {
    const agent = await createAgent(db, userA, baseInput);
    const rows = await client.query<{ agent_card_schema_version: string }>(
      `select agent_card_schema_version from public.agents where id = $1`,
      [agent.id],
    );
    expect(rows.rows[0].agent_card_schema_version).toBe(AGENT_CARD_SCHEMA_VERSION);
  });
});

describe("getOwnedAgent — authorization", () => {
  it("lets the owner read their own agent", async () => {
    const created = await createAgent(db, userA, baseInput);
    const fetched = await getOwnedAgent(db, userA, created.id);
    expect(fetched.id).toBe(created.id);
  });

  it("hides another user's agent as NOT_FOUND (never FORBIDDEN — no existence leak)", async () => {
    const created = await createAgent(db, userA, baseInput);
    await expect(getOwnedAgent(db, userB, created.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it("raises AppError for a nonexistent id", async () => {
    await expect(
      getOwnedAgent(db, userA, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe("getOwnedAgentBySlug — authorization", () => {
  it("lets the owner read their own agent by slug", async () => {
    const created = await createAgent(db, userA, baseInput);
    const fetched = await getOwnedAgentBySlug(db, userA, created.slug);
    expect(fetched.id).toBe(created.id);
  });

  it("hides another user's agent by slug as NOT_FOUND", async () => {
    const created = await createAgent(db, userA, baseInput);
    await expect(
      getOwnedAgentBySlug(db, userB, created.slug),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

describe("listAgentsForOwner — RLS-sensitive access", () => {
  it("only ever returns the caller's own agents, enforced by the real RLS policy", async () => {
    await createAgent(db, userA, baseInput);
    await createAgent(db, userA, { ...baseInput, name: "Second Bot" });
    await createAgent(db, userB, { ...baseInput, name: "Other Owner Bot" });

    const asA = await listAgentsForOwner(db, userA);
    expect(asA).toHaveLength(2);
    expect(asA.every((agent) => agent.ownerId === userA)).toBe(true);

    const asB = await listAgentsForOwner(db, userB);
    expect(asB).toHaveLength(1);
    expect(asB[0].name).toBe("Other Owner Bot");
  });

  it("returns an empty list, not an error, for an owner with no agents", async () => {
    expect(await listAgentsForOwner(db, userA)).toEqual([]);
  });
});

describe("updateOwnedAgent", () => {
  it("lets the owner update their agent", async () => {
    const created = await createAgent(db, userA, baseInput);
    const updated = await updateOwnedAgent(db, userA, created.id, {
      ...baseInput,
      name: "Support Bot v2",
      capabilities: ["chat"],
    });
    expect(updated.name).toBe("Support Bot v2");
    expect(updated.capabilityTags).toEqual(["chat"]);
  });

  it("rejects an update from a non-owner as NOT_FOUND and leaves the row untouched", async () => {
    const created = await createAgent(db, userA, baseInput);
    await expect(
      updateOwnedAgent(db, userB, created.id, {
        ...baseInput,
        name: "Hijacked",
      }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });

    const stillOriginal = await getOwnedAgent(db, userA, created.id);
    expect(stillOriginal.name).toBe("Support Bot");
  });

  it("re-validates the endpoint URL is still SSRF-safe at the DB layer via the https check constraint", async () => {
    const created = await createAgent(db, userA, baseInput);
    // Bypassing the zod layer on purpose: this proves the *database* itself
    // refuses a non-https endpoint, not just the form validation in front of it.
    await expect(
      updateOwnedAgent(db, userA, created.id, {
        ...baseInput,
        endpointUrl: "http://insecure.example.com",
      }),
    ).rejects.toThrow();
  });

  it("clears any ownership-verification token/timestamp when the endpoint URL changes", async () => {
    const created = await createAgent(db, userA, baseInput);
    await startOwnershipVerification(db, userA, created.id);
    mockedFetchOwnershipVerificationFile.mockResolvedValue({
      success: true,
      body: (await getOwnedAgent(db, userA, created.id)).ownershipVerificationToken!,
    });
    const verified = await checkOwnershipVerification(db, userA, created.id);
    expect(verified.ownershipVerifiedAt).not.toBeNull();

    const updated = await updateOwnedAgent(db, userA, created.id, {
      ...baseInput,
      endpointUrl: "https://a-different-endpoint.example.com/v1/invoke",
    });

    expect(updated.ownershipVerificationToken).toBeNull();
    expect(updated.ownershipVerifiedAt).toBeNull();
  });

  it("preserves the ownership-verification state when the endpoint URL is unchanged", async () => {
    const created = await createAgent(db, userA, baseInput);
    const started = await startOwnershipVerification(db, userA, created.id);

    const updated = await updateOwnedAgent(db, userA, created.id, {
      ...baseInput,
      name: "Renamed, same endpoint",
    });

    expect(updated.ownershipVerificationToken).toBe(started.ownershipVerificationToken);
  });
});

describe("credential create/preserve/replace/clear semantics", () => {
  function decrypt(ciphertext: string | null): string {
    if (!ciphertext) throw new Error("expected a stored ciphertext");
    return decryptAgentCredential(ciphertext, env.AGENT_CREDENTIAL_ENCRYPTION_KEY);
  }

  describe("createAgent", () => {
    it("stores an encrypted credential for authType bearer, never the plaintext", async () => {
      const agent = await createAgent(db, userA, {
        ...baseInput,
        authType: "bearer",
        authCredential: "my-bearer-secret",
      });
      expect(agent.authCredentialCiphertext).not.toBeNull();
      expect(agent.authCredentialCiphertext).not.toContain("my-bearer-secret");
      expect(decrypt(agent.authCredentialCiphertext)).toBe("my-bearer-secret");
      expect(agent.authHeaderName).toBeNull();
    });

    it("stores an encrypted credential and defaults the header name for authType api_key", async () => {
      const agent = await createAgent(db, userA, {
        ...baseInput,
        authType: "api_key",
        authCredential: "my-api-key",
      });
      expect(decrypt(agent.authCredentialCiphertext)).toBe("my-api-key");
      expect(agent.authHeaderName).toBe("X-API-Key");
    });

    it("honors a custom header name for authType api_key", async () => {
      const agent = await createAgent(db, userA, {
        ...baseInput,
        authType: "api_key",
        authCredential: "my-api-key",
        authHeaderName: "X-Custom-Key",
      });
      expect(agent.authHeaderName).toBe("X-Custom-Key");
    });

    it("rejects creating a bearer agent with no credential", async () => {
      await expect(
        createAgent(db, userA, {
          ...baseInput,
          authType: "bearer",
          authCredential: undefined,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });

    it("rejects creating an api_key agent with no credential", async () => {
      await expect(
        createAgent(db, userA, {
          ...baseInput,
          authType: "api_key",
          authCredential: undefined,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });

    it("stores no credential columns for authType none", async () => {
      const agent = await createAgent(db, userA, {
        ...baseInput,
        authType: "none",
        authCredential: undefined,
      });
      expect(agent.authCredentialCiphertext).toBeNull();
      expect(agent.authHeaderName).toBeNull();
    });
  });

  describe("updateOwnedAgent", () => {
    it("preserves the existing credential when the field is left blank and the mode is unchanged", async () => {
      const created = await createAgent(db, userA, {
        ...baseInput,
        authType: "bearer",
        authCredential: "original-secret",
      });

      const updated = await updateOwnedAgent(db, userA, created.id, {
        ...baseInput,
        authType: "bearer",
        authCredential: undefined,
        name: "Renamed Bot",
      });

      expect(updated.name).toBe("Renamed Bot");
      expect(decrypt(updated.authCredentialCiphertext)).toBe("original-secret");
    });

    it("replaces the credential when a new one is supplied", async () => {
      const created = await createAgent(db, userA, {
        ...baseInput,
        authType: "bearer",
        authCredential: "original-secret",
      });

      const updated = await updateOwnedAgent(db, userA, created.id, {
        ...baseInput,
        authType: "bearer",
        authCredential: "rotated-secret",
      });

      expect(decrypt(updated.authCredentialCiphertext)).toBe("rotated-secret");
    });

    it("clears the stored credential and header name when authType switches to none", async () => {
      const created = await createAgent(db, userA, {
        ...baseInput,
        authType: "api_key",
        authCredential: "my-api-key",
        authHeaderName: "X-Custom-Key",
      });

      const updated = await updateOwnedAgent(db, userA, created.id, {
        ...baseInput,
        authType: "none",
        authCredential: undefined,
      });

      expect(updated.authCredentialCiphertext).toBeNull();
      expect(updated.authHeaderName).toBeNull();
    });

    it("requires a new credential when switching between authenticated modes, even though one is already stored", async () => {
      const created = await createAgent(db, userA, {
        ...baseInput,
        authType: "bearer",
        authCredential: "original-secret",
      });

      await expect(
        updateOwnedAgent(db, userA, created.id, {
          ...baseInput,
          authType: "api_key",
          authCredential: undefined,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });

    it("succeeds switching between authenticated modes when a new credential is supplied", async () => {
      const created = await createAgent(db, userA, {
        ...baseInput,
        authType: "bearer",
        authCredential: "original-secret",
      });

      const updated = await updateOwnedAgent(db, userA, created.id, {
        ...baseInput,
        authType: "api_key",
        authCredential: "new-api-key",
      });

      expect(decrypt(updated.authCredentialCiphertext)).toBe("new-api-key");
      expect(updated.authHeaderName).toBe("X-API-Key");
    });

    it("rejects turning on bearer auth (from none) with no credential supplied", async () => {
      const created = await createAgent(db, userA, {
        ...baseInput,
        authType: "none",
        authCredential: undefined,
      });

      await expect(
        updateOwnedAgent(db, userA, created.id, {
          ...baseInput,
          authType: "bearer",
          authCredential: undefined,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });

    it("allows renaming the api_key header independently, without supplying a new credential", async () => {
      const created = await createAgent(db, userA, {
        ...baseInput,
        authType: "api_key",
        authCredential: "my-api-key",
      });
      expect(created.authHeaderName).toBe("X-API-Key");

      const updated = await updateOwnedAgent(db, userA, created.id, {
        ...baseInput,
        authType: "api_key",
        authCredential: undefined,
        authHeaderName: "X-Renamed-Key",
      });

      expect(updated.authHeaderName).toBe("X-Renamed-Key");
      expect(decrypt(updated.authCredentialCiphertext)).toBe("my-api-key");
    });

    it("existing NULL-credential agents (authType none, created before this feature) update cleanly with no backfill required", async () => {
      const created = await createAgent(db, userA, {
        ...baseInput,
        authType: "none",
        authCredential: undefined,
      });
      expect(created.authCredentialCiphertext).toBeNull();

      const updated = await updateOwnedAgent(db, userA, created.id, {
        ...baseInput,
        authType: "none",
        authCredential: undefined,
        name: "Still None",
      });

      expect(updated.name).toBe("Still None");
      expect(updated.authCredentialCiphertext).toBeNull();
    });
  });
});

describe("endpoint-ownership verification", () => {
  describe("startOwnershipVerification", () => {
    it("generates and stores a token for a fresh agent", async () => {
      const created = await createAgent(db, userA, baseInput);
      expect(created.ownershipVerificationToken).toBeNull();

      const started = await startOwnershipVerification(db, userA, created.id);
      expect(started.ownershipVerificationToken).not.toBeNull();
      expect(started.ownershipVerificationToken).toMatch(/^[0-9a-f]{48}$/);
      expect(started.ownershipVerifiedAt).toBeNull();
    });

    it("is idempotent — a second call returns the same token, not a new one", async () => {
      const created = await createAgent(db, userA, baseInput);
      const first = await startOwnershipVerification(db, userA, created.id);
      const second = await startOwnershipVerification(db, userA, created.id);
      expect(second.ownershipVerificationToken).toBe(first.ownershipVerificationToken);
    });

    it("rejects a non-owner as NOT_FOUND, and never calls the network fetcher", async () => {
      const created = await createAgent(db, userA, baseInput);
      await expect(
        startOwnershipVerification(db, userB, created.id),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
      expect(mockedFetchOwnershipVerificationFile).not.toHaveBeenCalled();
    });

    it("raises NOT_FOUND for a nonexistent agent id", async () => {
      await expect(
        startOwnershipVerification(db, userA, "00000000-0000-0000-0000-000000000000"),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });

  describe("checkOwnershipVerification", () => {
    it("marks the agent verified and records a timestamp when the served file matches the token", async () => {
      const created = await createAgent(db, userA, baseInput);
      const started = await startOwnershipVerification(db, userA, created.id);
      mockedFetchOwnershipVerificationFile.mockResolvedValue({
        success: true,
        body: started.ownershipVerificationToken!,
      });

      const before = new Date();
      const verified = await checkOwnershipVerification(db, userA, created.id);
      expect(verified.ownershipVerifiedAt).not.toBeNull();
      expect(verified.ownershipVerifiedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it("tolerates a trailing newline in the served file, same as a real text file would have", async () => {
      const created = await createAgent(db, userA, baseInput);
      const started = await startOwnershipVerification(db, userA, created.id);
      mockedFetchOwnershipVerificationFile.mockResolvedValue({
        success: true,
        body: `${started.ownershipVerificationToken}\n`,
      });

      const verified = await checkOwnershipVerification(db, userA, created.id);
      expect(verified.ownershipVerifiedAt).not.toBeNull();
    });

    it("does NOT mark verified, and returns a safe error, on an incorrect token", async () => {
      const created = await createAgent(db, userA, baseInput);
      await startOwnershipVerification(db, userA, created.id);
      mockedFetchOwnershipVerificationFile.mockResolvedValue({
        success: true,
        body: "the-wrong-value",
      });

      await expect(
        checkOwnershipVerification(db, userA, created.id),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: "The verification file's contents didn't match the expected token.",
      });
      const after = await getOwnedAgent(db, userA, created.id);
      expect(after.ownershipVerifiedAt).toBeNull();
    });

    it("does NOT mark verified when the file is missing (fetch reports failure)", async () => {
      const created = await createAgent(db, userA, baseInput);
      await startOwnershipVerification(db, userA, created.id);
      mockedFetchOwnershipVerificationFile.mockResolvedValue({
        success: false,
        errorCode: "HTTP_404",
        errorMessage: "The verification endpoint responded with HTTP 404.",
      });

      await expect(
        checkOwnershipVerification(db, userA, created.id),
      ).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: "The verification endpoint responded with HTTP 404.",
      });
      const after = await getOwnedAgent(db, userA, created.id);
      expect(after.ownershipVerifiedAt).toBeNull();
    });

    it("does NOT mark verified on a timeout, and surfaces the fetcher's safe error message", async () => {
      const created = await createAgent(db, userA, baseInput);
      await startOwnershipVerification(db, userA, created.id);
      mockedFetchOwnershipVerificationFile.mockResolvedValue({
        success: false,
        errorCode: "TIMEOUT",
        errorMessage: "The endpoint took too long to respond.",
      });

      await expect(
        checkOwnershipVerification(db, userA, created.id),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });

    it("does NOT mark verified when the fetcher reports an SSRF block", async () => {
      const created = await createAgent(db, userA, baseInput);
      await startOwnershipVerification(db, userA, created.id);
      mockedFetchOwnershipVerificationFile.mockResolvedValue({
        success: false,
        errorCode: "SSRF_BLOCKED",
        errorMessage: "The endpoint resolved to a blocked network address.",
      });

      await expect(
        checkOwnershipVerification(db, userA, created.id),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
      const after = await getOwnedAgent(db, userA, created.id);
      expect(after.ownershipVerifiedAt).toBeNull();
    });

    it("rejects checking before starting — a nonexistent token is a validation error, not a crash", async () => {
      const created = await createAgent(db, userA, baseInput);
      await expect(
        checkOwnershipVerification(db, userA, created.id),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
      expect(mockedFetchOwnershipVerificationFile).not.toHaveBeenCalled();
    });

    it("rejects a non-owner as NOT_FOUND, and never calls the network fetcher", async () => {
      const created = await createAgent(db, userA, baseInput);
      await startOwnershipVerification(db, userA, created.id);
      await expect(
        checkOwnershipVerification(db, userB, created.id),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
      expect(mockedFetchOwnershipVerificationFile).not.toHaveBeenCalled();
    });

    it("fetches the well-known path at the endpoint's origin, not the endpoint's own invocation URL", async () => {
      const created = await createAgent(db, userA, baseInput); // endpointUrl: https://agent.acme.io/v1/invoke
      const started = await startOwnershipVerification(db, userA, created.id);
      mockedFetchOwnershipVerificationFile.mockResolvedValue({
        success: true,
        body: started.ownershipVerificationToken!,
      });

      await checkOwnershipVerification(db, userA, created.id);

      expect(mockedFetchOwnershipVerificationFile).toHaveBeenCalledWith(
        "https://agent.acme.io/.well-known/agenttrust-verification.txt",
      );
    });
  });

  describe("existing agents with no verification state", () => {
    it("an agent that has never started verification has null token and null verifiedAt", async () => {
      const created = await createAgent(db, userA, baseInput);
      expect(created.ownershipVerificationToken).toBeNull();
      expect(created.ownershipVerifiedAt).toBeNull();
    });

    it("existing NULL-credential agents are completely unaffected by ownership-verification columns", async () => {
      const created = await createAgent(db, userA, {
        ...baseInput,
        authType: "none",
        authCredential: undefined,
      });
      expect(created.authCredentialCiphertext).toBeNull();
      expect(created.ownershipVerificationToken).toBeNull();
      expect(created.ownershipVerifiedAt).toBeNull();
    });
  });
});

describe("deleteOwnedAgent", () => {
  it("lets the owner delete their agent", async () => {
    const created = await createAgent(db, userA, baseInput);
    await deleteOwnedAgent(db, userA, created.id);
    await expect(getOwnedAgent(db, userA, created.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it("rejects a delete from a non-owner and leaves the row intact", async () => {
    const created = await createAgent(db, userA, baseInput);
    await expect(deleteOwnedAgent(db, userB, created.id)).rejects.toMatchObject(
      {
        code: ErrorCode.NOT_FOUND,
      },
    );
    expect(await getOwnedAgent(db, userA, created.id)).toBeTruthy();
  });
});

describe("activateOwnedAgent — the draft -> active transition", () => {
  it("lets the owner activate their own draft agent", async () => {
    const created = await createAgent(db, userA, baseInput);
    expect(created.lifecycleStatus).toBe("draft");

    const activated = await activateOwnedAgent(db, userA, created.id);
    expect(activated.lifecycleStatus).toBe("active");
  });

  it("rejects activation from a non-owner as NOT_FOUND, and leaves the agent in draft", async () => {
    const created = await createAgent(db, userA, baseInput);
    await expect(activateOwnedAgent(db, userB, created.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });

    const stillDraft = await getOwnedAgent(db, userA, created.id);
    expect(stillDraft.lifecycleStatus).toBe("draft");
  });

  it("rejects activating a nonexistent agent", async () => {
    await expect(
      activateOwnedAgent(db, userA, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it("makes the agent visible on its public profile once activated (it was NOT_FOUND before)", async () => {
    const created = await createAgent(db, userA, baseInput);
    await expect(getPublicAgentBySlug(db, created.slug)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });

    await activateOwnedAgent(db, userA, created.id);

    const found = await getPublicAgentBySlug(db, created.slug);
    expect(found.id).toBe(created.id);
  });
});

describe("getPublicAgentBySlug — anonymous, RLS-sensitive access", () => {
  it("is invisible while still draft (the default lifecycle status)", async () => {
    const created = await createAgent(db, userA, baseInput);
    await expect(getPublicAgentBySlug(db, created.slug)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });

  it("becomes visible once active and public", async () => {
    const created = await createAgent(db, userA, baseInput);
    await client.query(
      `update public.agents set lifecycle_status = 'active' where id = $1`,
      [created.id],
    );
    const found = await getPublicAgentBySlug(db, created.slug);
    expect(found.id).toBe(created.id);
  });

  it("stays invisible when active but unlisted", async () => {
    const created = await createAgent(db, userA, baseInput);
    await client.query(
      `update public.agents set lifecycle_status = 'active', visibility = 'unlisted' where id = $1`,
      [created.id],
    );
    await expect(getPublicAgentBySlug(db, created.slug)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND,
    });
  });
});

describe("recordAgentHeartbeatBySlug — authorization + server-authoritative time", () => {
  it("sets lastHeartbeatAt to the given server timestamp for the owner's own agent", async () => {
    const created = await createAgent(db, userA, baseInput);
    const at = new Date("2026-06-01T12:00:00.000Z");

    const updated = await recordAgentHeartbeatBySlug(db, userA, created.slug, at);
    expect(updated.lastHeartbeatAt?.toISOString()).toBe(at.toISOString());
  });

  it("ignores any notion of a client timestamp — the caller can only pass the server's own `Date`", async () => {
    // There is no parameter for a caller-declared time other than the one
    // the handler itself constructs with `new Date()` — this test just
    // pins down that whatever Date object is passed through is stored
    // verbatim, confirming the seam a handler would use stays trustworthy
    // as long as it always calls `new Date()` itself rather than parsing
    // anything from the request.
    const created = await createAgent(db, userA, baseInput);
    const before = new Date();
    await recordAgentHeartbeatBySlug(db, userA, created.slug, before);
    const after = await getOwnedAgentBySlug(db, userA, created.slug);
    expect(after.lastHeartbeatAt).not.toBeNull();
    expect(after.lastHeartbeatAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("rejects a heartbeat for another owner's agent as NOT_FOUND, without leaking existence", async () => {
    const created = await createAgent(db, userA, baseInput);
    await expect(
      recordAgentHeartbeatBySlug(db, userB, created.slug, new Date()),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });

    const stillNull = await getOwnedAgentBySlug(db, userA, created.slug);
    expect(stillNull.lastHeartbeatAt).toBeNull();
  });

  it("rejects a heartbeat for a nonexistent slug as NOT_FOUND", async () => {
    await expect(
      recordAgentHeartbeatBySlug(db, userA, "does-not-exist", new Date()),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it("updates lastHeartbeatAt again on a second heartbeat, moving it forward", async () => {
    const created = await createAgent(db, userA, baseInput);
    const first = new Date("2026-06-01T12:00:00.000Z");
    const second = new Date("2026-06-01T12:05:00.000Z");

    await recordAgentHeartbeatBySlug(db, userA, created.slug, first);
    const updated = await recordAgentHeartbeatBySlug(db, userA, created.slug, second);

    expect(updated.lastHeartbeatAt?.toISOString()).toBe(second.toISOString());
  });
});

describe("listPublicAgents — Public API listing, RLS-sensitive access", () => {
  async function activate(agentId: string) {
    await client.query(
      `update public.agents set lifecycle_status = 'active' where id = $1`,
      [agentId],
    );
  }

  it("returns only public+active agents, never drafts or another owner's unlisted agents", async () => {
    const pub = await createAgent(db, userA, { ...baseInput, name: "Public Bot" });
    await activate(pub.id);

    await createAgent(db, userA, { ...baseInput, name: "Draft Bot" });
    // left as 'draft'

    const unlisted = await createAgent(db, userB, { ...baseInput, name: "Unlisted Bot" });
    await client.query(
      `update public.agents set lifecycle_status = 'active', visibility = 'unlisted' where id = $1`,
      [unlisted.id],
    );

    const page = await listPublicAgents(db, { limit: 20 });
    const names = page.agents.map((a) => a.name);
    expect(names).toContain("Public Bot");
    expect(names).not.toContain("Draft Bot");
    expect(names).not.toContain("Unlisted Bot");
  });

  it("returns agents from every owner, not just one", async () => {
    const a = await createAgent(db, userA, { ...baseInput, name: "From A" });
    await activate(a.id);
    const b = await createAgent(db, userB, { ...baseInput, name: "From B" });
    await activate(b.id);

    const page = await listPublicAgents(db, { limit: 20 });
    expect(page.agents.map((x) => x.name).sort()).toEqual(["From A", "From B"]);
  });

  it("paginates with a cursor, returning every agent exactly once across pages", async () => {
    for (let i = 0; i < 5; i++) {
      const agent = await createAgent(db, userA, { ...baseInput, name: `Bot ${i}` });
      await activate(agent.id);
    }

    const seen = new Set<string>();
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const page = await listPublicAgents(db, { limit: 2, cursor });
      expect(page.agents.length).toBeLessThanOrEqual(2);
      for (const agent of page.agents) seen.add(agent.id);
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 10);

    expect(seen.size).toBe(5);
    expect(pages).toBe(3); // 2 + 2 + 1
  });

  it("signals no further pages once exhausted", async () => {
    const a = await createAgent(db, userA, { ...baseInput, name: "Only One" });
    await activate(a.id);

    const page = await listPublicAgents(db, { limit: 20 });
    expect(page.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor as a validation error rather than silently ignoring it", async () => {
    await expect(
      listPublicAgents(db, { limit: 20, cursor: "not-a-real-cursor" }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
  });

  it("returns an empty page, not an error, when nothing is public yet", async () => {
    const page = await listPublicAgents(db, { limit: 20 });
    expect(page.agents).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  describe("discovery by endpoint URL", () => {
    it("returns the matching agent for an exact endpoint URL", async () => {
      const agent = await createAgent(db, userA, {
        ...baseInput,
        name: "Findable Bot",
        endpointUrl: "https://discover-me.example.com/v1/invoke",
      });
      await activate(agent.id);

      const page = await listPublicAgents(db, {
        limit: 20,
        endpointUrl: "https://discover-me.example.com/v1/invoke",
      });
      expect(page.agents.map((a) => a.name)).toEqual(["Findable Bot"]);
    });

    it("matches regardless of a trailing slash on either side", async () => {
      const agent = await createAgent(db, userA, {
        ...baseInput,
        name: "No Trailing Slash Stored",
        endpointUrl: "https://trailing-slash.example.com/v1/invoke",
      });
      await activate(agent.id);

      const withSlash = await listPublicAgents(db, {
        limit: 20,
        endpointUrl: "https://trailing-slash.example.com/v1/invoke/",
      });
      expect(withSlash.agents.map((a) => a.name)).toEqual(["No Trailing Slash Stored"]);
    });

    it("matches regardless of scheme/host casing in the query", async () => {
      const agent = await createAgent(db, userA, {
        ...baseInput,
        name: "Casing Bot",
        endpointUrl: "https://casing-test.example.com/v1/invoke",
      });
      await activate(agent.id);

      const page = await listPublicAgents(db, {
        limit: 20,
        endpointUrl: "HTTPS://CASING-TEST.example.com/v1/invoke",
      });
      expect(page.agents.map((a) => a.name)).toEqual(["Casing Bot"]);
    });

    it("returns an empty page, not an error, for an unregistered endpoint URL", async () => {
      const agent = await createAgent(db, userA, {
        ...baseInput,
        name: "Some Bot",
        endpointUrl: "https://registered.example.com/v1/invoke",
      });
      await activate(agent.id);

      const page = await listPublicAgents(db, {
        limit: 20,
        endpointUrl: "https://never-registered.example.com/v1/invoke",
      });
      expect(page.agents).toEqual([]);
      expect(page.nextCursor).toBeNull();
    });

    it("returns an empty page, not an error, for a malformed endpoint URL query value", async () => {
      const page = await listPublicAgents(db, {
        limit: 20,
        endpointUrl: "not a url at all",
      });
      expect(page.agents).toEqual([]);
      expect(page.nextCursor).toBeNull();
    });

    it("never surfaces a draft agent through the endpoint-URL filter, even for an exact match", async () => {
      const draft = await createAgent(db, userA, {
        ...baseInput,
        name: "Draft With Findable URL",
        endpointUrl: "https://still-draft.example.com/v1/invoke",
      });
      // left as 'draft' — never activated

      const page = await listPublicAgents(db, {
        limit: 20,
        endpointUrl: "https://still-draft.example.com/v1/invoke",
      });
      expect(page.agents).toEqual([]);
      expect(draft.lifecycleStatus).toBe("draft");
    });

    it("never surfaces an unlisted agent through the endpoint-URL filter, even for an exact match", async () => {
      const unlisted = await createAgent(db, userA, {
        ...baseInput,
        name: "Unlisted With Findable URL",
        endpointUrl: "https://still-unlisted.example.com/v1/invoke",
      });
      await client.query(
        `update public.agents set lifecycle_status = 'active', visibility = 'unlisted' where id = $1`,
        [unlisted.id],
      );

      const page = await listPublicAgents(db, {
        limit: 20,
        endpointUrl: "https://still-unlisted.example.com/v1/invoke",
      });
      expect(page.agents).toEqual([]);
    });

    it("leaves ordinary listing (no endpointUrl given) completely unaffected", async () => {
      const a = await createAgent(db, userA, { ...baseInput, name: "Plain A" });
      await activate(a.id);
      const b = await createAgent(db, userA, { ...baseInput, name: "Plain B", endpointUrl: "https://plain-b.example.com/invoke" });
      await activate(b.id);

      const page = await listPublicAgents(db, { limit: 20 });
      expect(page.agents.map((x) => x.name).sort()).toEqual(["Plain A", "Plain B"]);
    });

    it("still paginates correctly when the endpoint-URL filter matches more than one agent", async () => {
      // No uniqueness constraint on endpointUrl (out of this milestone's
      // scope) — two different agents can legitimately share one.
      const sharedUrl = "https://shared-endpoint.example.com/v1/invoke";
      const first = await createAgent(db, userA, { ...baseInput, name: "Shared First", endpointUrl: sharedUrl });
      await activate(first.id);
      const second = await createAgent(db, userB, { ...baseInput, name: "Shared Second", endpointUrl: sharedUrl });
      await activate(second.id);

      const page = await listPublicAgents(db, { limit: 20, endpointUrl: sharedUrl });
      expect(page.agents.map((a) => a.name).sort()).toEqual(["Shared First", "Shared Second"]);
    });
  });
});

describe("profile bootstrap trigger", () => {
  it("creates a public.profiles row automatically when a user is seeded into auth.users", async () => {
    const rows = await client.query(
      `select id, email from public.profiles where id = $1`,
      [userA],
    );
    expect(rows.rows).toEqual([{ id: userA, email: "a@example.com" }]);
  });
});
