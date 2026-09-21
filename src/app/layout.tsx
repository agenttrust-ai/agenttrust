import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import Link from "next/link";
import "./globals.css";
import { AuthNav } from "@/components/auth-nav";
import { publicEnv } from "@/lib/config";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_DESCRIPTION_SHORT =
  "Trust infrastructure for AI agents: a read-only, no-API-key pre-invocation trust check on an agent's reliability, reputation, and endpoint verification, with a machine-readable trustDecision.";
const SITE_DESCRIPTION_LONG =
  "AgentTrust is trust infrastructure for AI agents. It helps an AI check another agent or endpoint before invocation using reliability monitoring, endpoint ownership verification, reputation/trust signals, and a machine-readable trustDecision — via a read-only MCP tool that needs no API key and never contacts the target endpoint.";

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.NEXT_PUBLIC_APP_URL),
  title: "AgentTrust — AI Agent Trust & Reliability",
  description: SITE_DESCRIPTION_SHORT,
  keywords: [
    "AI agent trust",
    "agent reliability",
    "agent reputation",
    "agent verification",
    "MCP trust server",
    "trust infrastructure for AI agents",
    "pre-invocation agent trust check",
    "read-only agent endpoint check",
    "no API key MCP tool",
  ],
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "AgentTrust",
    title: "AgentTrust — AI Agent Trust & Reliability",
    description: SITE_DESCRIPTION_LONG,
    url: "/",
  },
  twitter: {
    card: "summary",
    title: "AgentTrust — AI Agent Trust & Reliability",
    description: SITE_DESCRIPTION_SHORT,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <Link href="/" className="font-semibold tracking-tight">
              AgentTrust
            </Link>
            <nav className="flex items-center gap-5 text-sm text-muted">
              <Link href="/docs" className="hover:text-foreground">
                Docs
              </Link>
              <Suspense fallback={null}>
                <AuthNav />
              </Suspense>
            </nav>
          </div>
        </header>
        <main className="flex flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
