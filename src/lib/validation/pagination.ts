import { z } from "zod";

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export const paginationQuerySchema = z.object({
  limit: z.coerce
    .number({ error: "limit must be a number." })
    .int({ error: "limit must be a whole number." })
    .min(1, { error: "limit must be at least 1." })
    .max(MAX_PAGE_LIMIT, { error: `limit must be ${MAX_PAGE_LIMIT} or fewer.` })
    .default(DEFAULT_PAGE_LIMIT),
  cursor: z.string().trim().min(1).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function parsePaginationQuery(searchParams: URLSearchParams) {
  return paginationQuerySchema.safeParse({
    limit: searchParams.get("limit") ?? undefined,
    cursor: searchParams.get("cursor") ?? undefined,
  });
}
