import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { listApiKeysForOwner } from "@/lib/db/queries/api-keys";
import { revokeApiKeyAction } from "@/lib/api-keys/actions";
import { CreateApiKeyForm } from "@/components/api-keys/create-api-key-form";
import { RevokeApiKeyButton } from "@/components/api-keys/revoke-api-key-button";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/components/ui/format";
import { IconX } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import * as T from "@/components/ui/table";

export default async function ApiKeysPage() {
  const session = await verifySession();
  const keys = await listApiKeysForOwner(db, session.userId);

  // Presentation only: active keys first, revoked keys after them (history
  // is kept, just not competing with keys that still work). The sort is
  // stable, so each group keeps the query's own order.
  const ordered = [...keys].sort(
    (a, b) => Number(a.revokedAt != null) - Number(b.revokedAt != null),
  );
  const activeCount = keys.filter((k) => k.revokedAt == null).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Dashboard"
        title="API keys"
        description="Keys authenticate the REST API and the MCP tools that need one. Each raw key is shown only once, right after you create it. The anonymous check_agent_trust tool needs no key."
      />

      <section aria-label="Create an API key" className="rounded-lg border border-border bg-surface px-4 py-3.5 sm:max-w-2xl">
        <CreateApiKeyForm />
      </section>

      {keys.length === 0 ? (
        <EmptyState title="No API keys yet">
          Create one above to call the REST API or the keyed MCP tools.
        </EmptyState>
      ) : (
        <section aria-labelledby="keys-heading" className="flex flex-col gap-3">
          <h2 id="keys-heading" className="text-heading">
            Keys{" "}
            <span className="text-sm font-normal text-muted">
              {activeCount} active · {keys.length - activeCount} revoked
            </span>
          </h2>
          <div className={T.tableFrame}>
            <table className={cx(T.table, "min-w-[640px]")}>
              <thead>
                <tr className={T.theadRow}>
                  <th scope="col" className={T.th}>Name</th>
                  <th scope="col" className={T.th}>Status</th>
                  <th scope="col" className={T.th}>Key</th>
                  <th scope="col" className={T.th}>Created</th>
                  <th scope="col" className={T.th}>Last used</th>
                  <th scope="col" className={T.th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((key) => {
                  const boundRevoke = revokeApiKeyAction.bind(null, key.id);
                  const isRevoked = key.revokedAt != null;
                  return (
                    <tr key={key.id} className={cx(T.tbodyRow, isRevoked && "text-muted")}>
                      <td className={cx(T.td, "max-w-[16rem]")}>
                        <p className={cx("truncate", !isRevoked && "font-medium")}>{key.name}</p>
                      </td>
                      <td className={cx(T.td, "whitespace-nowrap")}>
                        {isRevoked ? (
                          <>
                            <StatusChip tone="neutral" icon={IconX}>
                              Revoked
                            </StatusChip>
                            <p className="mt-1 text-xs text-subtle">{formatDate(key.revokedAt)}</p>
                          </>
                        ) : (
                          <StatusChip tone="positive">Active</StatusChip>
                        )}
                      </td>
                      <td className={cx(T.td, "font-mono text-xs text-muted")}>{key.keyPrefix}…</td>
                      <td className={cx(T.td, "whitespace-nowrap text-muted")}>{formatDate(key.createdAt)}</td>
                      <td className={cx(T.td, "whitespace-nowrap text-muted")}>
                        {formatDate(key.lastUsedAt, "Never")}
                      </td>
                      <td className={cx(T.td, "text-right")}>
                        {!isRevoked && <RevokeApiKeyButton action={boundRevoke} keyName={key.name} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
