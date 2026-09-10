import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { listApiKeysForOwner } from "@/lib/db/queries/api-keys";
import { revokeApiKeyAction } from "@/lib/api-keys/actions";
import { CreateApiKeyForm } from "@/components/api-keys/create-api-key-form";
import { RevokeApiKeyButton } from "@/components/api-keys/revoke-api-key-button";

function formatDate(value: Date | string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function ApiKeysPage() {
  const session = await verifySession();
  const keys = await listApiKeysForOwner(db, session.userId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
        <p className="text-sm text-muted">
          Keys authenticate programmatic access to your account. Each raw key is
          shown only once, right after you create it.
        </p>
      </div>

      <div className="max-w-2xl rounded-lg border border-border bg-surface p-4">
        <CreateApiKeyForm />
      </div>

      {keys.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted">
          No API keys yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Key</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
                <th className="px-4 py-2.5 font-medium">Last used</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const boundRevoke = revokeApiKeyAction.bind(null, key.id);
                const isRevoked = key.revokedAt != null;
                return (
                  <tr
                    key={key.id}
                    className="border-b border-border last:border-0 hover:bg-surface-2"
                  >
                    <td className="px-4 py-3 font-medium">{key.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">
                      {key.keyPrefix}…
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {formatDate(key.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {formatDate(key.lastUsedAt)}
                    </td>
                    <td className="px-4 py-3">
                      {isRevoked ? (
                        <span className="text-xs text-muted">
                          Revoked {formatDate(key.revokedAt)}
                        </span>
                      ) : (
                        <span className="text-xs text-green-700 dark:text-green-400">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isRevoked && (
                        <RevokeApiKeyButton
                          action={boundRevoke}
                          keyName={key.name}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
