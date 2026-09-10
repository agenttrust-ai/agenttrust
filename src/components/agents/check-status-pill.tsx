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

const CLASS: Record<string, string> = {
  success: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
};
const DEFAULT_CLASS =
  "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400";

/** Renders a single health_checks.status value — the technical category one check fell into. */
export function CheckStatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${CLASS[status] ?? DEFAULT_CLASS}`}
    >
      {LABEL[status] ?? status}
    </span>
  );
}
