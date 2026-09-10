import Link from "next/link";
import { getOptionalSession } from "@/lib/auth/dal";
import { logout } from "@/lib/auth/actions";

/**
 * Split out from the root layout so the session check (`await` on cookies)
 * doesn't hold up the first streamed byte of every page — see Next.js's
 * "Auth and streaming" guidance. Wrap this in <Suspense> where it's used.
 */
export async function AuthNav() {
  const session = await getOptionalSession();

  if (!session) {
    return (
      <>
        <Link href="/login" className="hover:text-foreground">
          Log in
        </Link>
        <Link
          href="/signup"
          className="rounded-md bg-accent px-3 py-1.5 text-accent-foreground hover:opacity-90"
        >
          Sign up
        </Link>
      </>
    );
  }

  return (
    <>
      <Link href="/dashboard" className="hover:text-foreground">
        Dashboard
      </Link>
      <form action={logout}>
        <button type="submit" className="hover:text-foreground cursor-pointer">
          Log out
        </button>
      </form>
    </>
  );
}
