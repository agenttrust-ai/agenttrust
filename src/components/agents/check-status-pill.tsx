import { StatusChip } from "@/components/ui/status-chip";

const LABEL: Record<string, string> = {
  success: "Success",
  http_error: "HTTP error",
  timeout: "Timeout",
  dns_error: "DNS error",
  tls_error: "TLS error",
  connection_error: "Connection error",
  ssrf_blocked: "Blocked (unsafe URL)",
  unknown_error: "Unknown error",
};

/** Renders a single health_checks.status value — the technical category one check fell into. */
export function CheckStatusPill({ status }: { status: string }) {
  return (
    <StatusChip tone={status === "success" ? "positive" : "negative"}>
      {LABEL[status] ?? status}
    </StatusChip>
  );
}
