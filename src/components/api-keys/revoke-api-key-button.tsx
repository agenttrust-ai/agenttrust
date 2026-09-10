"use client";

export function RevokeApiKeyButton({
  action,
  keyName,
}: {
  action: () => Promise<void>;
  keyName: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (
          !window.confirm(
            `Revoke "${keyName}"? Anything using this key will stop working immediately.`,
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="text-sm font-medium text-red-600 hover:underline"
      >
        Revoke
      </button>
    </form>
  );
}
