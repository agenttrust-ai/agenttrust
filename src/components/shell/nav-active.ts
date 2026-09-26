/**
 * Whether a nav item for `href` is the current page. `exact` items (e.g.
 * the dashboard overview) only match their own path; others also match
 * any nested path. An `href` with a hash (e.g. "/docs#mcp") is an in-page
 * jump, never "the current page".
 */
export function isNavActive(
  pathname: string | null,
  href: string,
  { exact = false }: { exact?: boolean } = {},
): boolean {
  if (!pathname || href.includes("#")) return false;
  if (pathname === href) return true;
  return !exact && pathname.startsWith(`${href}/`);
}
