import { z } from "zod";

export const createApiKeySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: "Give this key a name." })
    .max(100, { error: "Name must be 100 characters or fewer." }),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export function parseCreateApiKeyFormData(formData: FormData) {
  return createApiKeySchema.safeParse({
    name: formData.get("name") ?? undefined,
  });
}
