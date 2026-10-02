import type { Metadata } from "next";
import type { ReactNode } from "react";
import { GLOBAL_RETENTION_MS } from "@/lib/api/anonymous-rate-limit";
import { CALLER_KEY_PERIOD_DAYS, TELEMETRY_RETENTION_DAYS } from "@/lib/telemetry/trust-check-events";
import { SUPPORT_EMAIL } from "@/lib/contact";

export const metadata: Metadata = {
  title: "Privacy Policy — AgentTrust",
  description:
    "What data AgentTrust's website, REST API and MCP servers process, why, how long it is kept, and how to contact us.",
  alternates: { canonical: "/privacy" },
};

const EFFECTIVE_DATE = "2 October 2026";
const GLOBAL_RETENTION_DAYS = GLOBAL_RETENTION_MS / (24 * 60 * 60 * 1000);

const PROSE =
  "flex flex-col gap-3 text-sm leading-relaxed text-muted [&_strong]:text-foreground " +
  "[&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-foreground " +
  "[&_a]:text-accent [&_a]:underline-offset-4 [&_a:hover]:underline [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20 border-t border-border pt-8">
      <h2 id={`${id}-heading`} className="text-heading">
        {title}
      </h2>
      <div className={`mt-4 ${PROSE}`}>{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
      <header>
        <p className="eyebrow">Legal</p>
        <h1 className="mt-2 text-title text-balance sm:text-[1.875rem] sm:leading-tight">Privacy Policy</h1>
        <div className={`mt-3 ${PROSE}`}>
          <p>Effective {EFFECTIVE_DATE}.</p>
          <p>
            AgentTrust (&ldquo;we&rdquo;) operates <code>getagenttrust.com</code>: the website, the REST API
            under <code>/api/v1</code>, and the MCP servers at <code>/api/mcp</code> and{" "}
            <code>/api/mcp/public</code>. This policy describes what data those services process, why, and for
            how long. Questions go to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
        </div>
      </header>

      <Section id="trust-checks" title="Trust checks">
        <p>
          A trust check (the <code>check_agent_trust</code> MCP tool, or the{" "}
          <a href="/check-agent-trust">check page</a>) takes one input: the endpoint URL to look up. We compare
          it with agents already stored in AgentTrust and return what we have observed. We never contact that
          URL during a check.
        </p>
        <p>To understand how the service is used, we record a usage event for each completed check:</p>
        <ul>
          <li>when it happened, whether it came over MCP or the web page, and whether the URL matched a known agent;</li>
          <li>for a match: which agent, and the trust decision we returned;</li>
          <li>
            for no match: the URL&apos;s hostname (only when it is a public domain name) and a keyed hash of the
            URL with its query string and fragment removed;
          </li>
          <li>the first product token of the client&apos;s User-Agent header (for example <code>node</code>);</li>
          <li>
            a caller identifier: a keyed hash of the caller&apos;s IP address that changes every{" "}
            {CALLER_KEY_PERIOD_DAYS} days, so callers can be counted but not followed across periods.
          </li>
        </ul>
        <p>
          We do not store the raw IP address, the full URL, query strings, request bodies, or any other header.
          Usage events are deleted after {TELEMETRY_RETENTION_DAYS} days.
        </p>
      </Section>

      <Section id="rate-limiting" title="Rate limiting">
        <p>
          Anonymous trust checks are rate-limited per IP address. To do that we store, for each one-minute
          window, a request count keyed by a hash of the IP address made with a secret key that changes every
          day. These records are only needed during their own minute and are deleted once they are more than a
          day old; deletion runs in the background, so one can occasionally remain somewhat longer. A separate
          service-wide count per minute, which contains no personal data, is kept for {GLOBAL_RETENTION_DAYS}{" "}
          days.
        </p>
      </Section>

      <Section id="accounts" title="Accounts and API keys">
        <ul>
          <li>
            Signing up requires an email address and a password. Sign-in is handled by our authentication
            provider, Supabase, and a session cookie keeps you signed in. We use no advertising or analytics
            cookies.
          </li>
          <li>
            API keys are shown once when created and stored only as a keyed hash. We count requests per key to
            enforce rate limits.
          </li>
          <li>We keep a log of account actions, such as creating keys or registering agents, for security.</li>
        </ul>
      </Section>

      <Section id="agents" title="Agents and monitoring">
        <ul>
          <li>
            When you register an agent we store what you provide: its name, description, endpoint URL, version
            and capabilities, and, if you supply one, the credential needed to call its endpoint. Credentials are
            encrypted (AES-256-GCM) and used only to send health checks.
          </li>
          <li>
            A public agent&apos;s profile (never its credential) is shown on the website and returned by the API
            and MCP tools, together with its health history, reliability score and trust decision.
          </li>
          <li>
            We send health-check requests to monitored agents&apos; endpoints, and ownership verification fetches
            a verification file from the endpoint&apos;s site.
          </li>
          <li>
            We also list MCP servers published in the official MCP Registry, using their public registry
            metadata, and monitor their public endpoints the same way.
          </li>
        </ul>
      </Section>

      <Section id="mcp" title="MCP clients and AI assistants">
        <p>
          Our MCP tools receive only the arguments a client sends with each call, such as an endpoint URL or
          an agent slug. We do not receive, request or store conversation content, chat history, memory or
          files from AI assistants that use our tools.
        </p>
      </Section>

      <Section id="sharing" title="Service providers and sharing">
        <p>
          We use Vercel to host the service and Supabase for our database and authentication. Both process data
          on our behalf, and Vercel keeps its own short-lived request logs, which include IP addresses. We do not
          sell personal data or share it for advertising.
        </p>
      </Section>

      <Section id="choices" title="Your choices">
        <p>
          You can ask us to access, correct or delete the data associated with your account or your registered
          agents by emailing <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. Usage events and
          rate-limit records contain no account identifier and are deleted automatically on the schedules above.
        </p>
      </Section>

      <Section id="contact" title="Contact, support and security">
        <p>
          For privacy questions, product support, or to report a security issue, email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. If this policy changes, we will update this
          page and its effective date.
        </p>
      </Section>
    </div>
  );
}
