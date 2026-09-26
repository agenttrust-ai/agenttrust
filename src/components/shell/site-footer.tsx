import Link from "next/link";
import { IconExternal } from "@/components/ui/icons";
import { LogoMark } from "./logo";

type FooterLink = { href: string; label: string; external?: boolean };

const GROUPS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/check-agent-trust", label: "Check an agent" },
      { href: "/dashboard", label: "Dashboard" },
      { href: "/docs", label: "Docs" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/docs#mcp", label: "MCP server" },
      { href: "/docs#getting-started", label: "REST API" },
      { href: "/llms.txt", label: "llms.txt" },
      {
        href: "https://github.com/agenttrust-ai/agenttrust",
        label: "GitHub",
        external: true,
      },
    ],
  },
];

const LINK =
  "inline-flex items-center gap-1 rounded-sm text-sm text-muted transition-[color,background-color] duration-150 hover:text-foreground";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid w-full max-w-shell gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.6fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <LogoMark />
            <span>AgentTrust</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-muted">
            Trust infrastructure for AI agents. Trust checks are read-only and
            never contact the agent being checked.
          </p>
        </div>
        {GROUPS.map((group) => (
          <nav key={group.title} aria-label={group.title}>
            <p className="eyebrow">{group.title}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {group.links.map((link) => (
                <li key={link.href}>
                  {link.external ? (
                    <a href={link.href} rel="noopener noreferrer" className={LINK}>
                      {link.label}
                      <IconExternal className="size-3.5" />
                    </a>
                  ) : (
                    <Link href={link.href} className={LINK}>
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
    </footer>
  );
}
