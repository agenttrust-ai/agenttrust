import { describe, expect, it } from "vitest";
import { GET, POST } from "./route";

function postWith(body: unknown): Request {
  return new Request("https://example.com/api/test-agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function postRaw(rawBody: string): Request {
  return new Request("https://example.com/api/test-agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rawBody,
  });
}

describe("POST /api/test-agent — valid requests", () => {
  it("returns 200 with the documented response shape", async () => {
    const res = await POST(postWith({ message: "hello" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      agent: "Support Bot",
      reply: "Support Bot received: hello",
      timestamp: expect.any(String),
    });
  });

  it("deterministically echoes the message into the reply", async () => {
    const res = await POST(postWith({ message: "ping" }));
    const body = await res.json();
    expect(body.reply).toBe("Support Bot received: ping");
  });

  it("timestamp is a valid, current ISO-8601 string", async () => {
    const before = Date.now();
    const res = await POST(postWith({ message: "hi" }));
    const after = Date.now();
    const body = await res.json();

    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const parsed = new Date(body.timestamp).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });

  it("trims surrounding whitespace from the message before echoing it", async () => {
    const res = await POST(postWith({ message: "  padded  " }));
    const body = await res.json();
    expect(body.reply).toBe("Support Bot received: padded");
  });
});

describe("POST /api/test-agent — missing or invalid message", () => {
  it("400s when message is missing entirely", async () => {
    const res = await POST(postWith({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe("string");
  });

  it("400s when message is an empty string", async () => {
    const res = await POST(postWith({ message: "" }));
    expect(res.status).toBe(400);
  });

  it("400s when message is only whitespace", async () => {
    const res = await POST(postWith({ message: "   " }));
    expect(res.status).toBe(400);
  });

  it("400s when message is the wrong type", async () => {
    const res = await POST(postWith({ message: 12345 }));
    expect(res.status).toBe(400);
  });

  it("400s when message is oversized", async () => {
    const res = await POST(postWith({ message: "x".repeat(2001) }));
    expect(res.status).toBe(400);
  });

  it("400s when the body is a JSON array instead of an object", async () => {
    const res = await POST(postWith(["not", "an", "object"]));
    expect(res.status).toBe(400);
  });

  it("400s when the body is an unrelated JSON object", async () => {
    const res = await POST(postWith({ foo: "bar" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/test-agent — malformed request body", () => {
  it("400s on invalid JSON, with a clean JSON error response (not a crash)", async () => {
    const res = await POST(postRaw("{not valid json"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe("string");
  });

  it("400s on a completely empty body", async () => {
    const res = await POST(postRaw(""));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/test-agent — health-check compatibility", () => {
  it("returns 200 so the existing pull-based monitor sees this agent as healthy", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.agent).toBe("Support Bot");
    expect(typeof body.timestamp).toBe("string");
  });
});

describe("security: no secret or sensitive data exposure", () => {
  it("never includes an env-var-shaped key or a database URL in any response, success or error", async () => {
    const responses = await Promise.all([
      POST(postWith({ message: "test" })),
      POST(postWith({})),
      POST(postRaw("{bad json")),
    ]);
    const bodies = await Promise.all(responses.map((r) => r.json()));
    const text = JSON.stringify(bodies);

    expect(text).not.toMatch(/postgres(ql)?:\/\//i);
    expect(text.toLowerCase()).not.toContain("secret");
    expect(text.toLowerCase()).not.toContain("pepper");
    expect(text.toLowerCase()).not.toContain("api_key_hash");
    expect(text).not.toContain("at_live_");
  });

  it("response only ever contains the documented fields — no stray internal data", async () => {
    const res = await POST(postWith({ message: "hi" }));
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["agent", "ok", "reply", "timestamp"]);
  });
});
