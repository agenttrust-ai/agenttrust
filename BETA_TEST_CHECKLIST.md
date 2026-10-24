# AgentTrust — Beta Test Checklist

Work through this in order. See [`BETA_ONBOARDING.md`](BETA_ONBOARDING.md)
for the full walkthrough of each step.

## Day 1 (about 10 minutes)

- [ ] Account created (email confirmed)
- [ ] API key created
- [ ] Agent registered
- [ ] Ownership verification attempted (optional)
- [ ] Agent activated
- [ ] Agent discoverable by endpoint URL (`GET /api/v1/agents?endpoint_url=`) — expect `status: "unknown"` and `confidence: "insufficient_data"` until monitoring has run
- [ ] Trust decision returned (`trustDecision.recommended`/`confidence`/`reasons` present)
- [ ] (Optional) Same check without an API key — MCP `check_agent_trust` at `https://getagenttrust.com/api/mcp/public`, or `checkAgentTrust()` from `@getagenttrust/sdk`

## After monitoring has run

- [ ] Monitoring works — after the next daily check (00:00 UTC), `status` is no longer `unknown`
- [ ] Reliability score appears — after the fifth daily check (about 4–5 days), `reliabilityScore` is a number and `reliabilityScoreStatus` is `fresh`
- [ ] Integration completed (your own agent/app successfully acts on a trust decision)

---

## Time to first successful integration

Start time: ________  End time: ________  Total: ________

## Confusing steps

_What, if anything, wasn't clear on the first try?_

-
-

## Errors encountered

_Paste the exact error code/message (never a real API key or token) and what you were doing when it happened._

-
-
