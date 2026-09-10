"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { createApiKey, revokeApiKey } from "@/lib/db/queries/api-keys";
import { parseCreateApiKeyFormData } from "@/lib/validation/api-key";
import { toAppError } from "@/lib/errors";

export type CreateApiKeyState =
  | {
      errors?: { name?: string[] };
      message?: string;
      /** Only ever populated immediately after a successful creation — never re-derivable afterward. */
      created?: { rawKey: string; name: string };
    }
  | undefined;

export async function createApiKeyAction(
  _prevState: CreateApiKeyState,
  formData: FormData,
): Promise<CreateApiKeyState> {
  const session = await verifySession();
  const parsed = parseCreateApiKeyFormData(formData);

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const { rawKey, key } = await createApiKey(db, session.userId, parsed.data);
    revalidatePath("/dashboard/api-keys");
    return { created: { rawKey, name: key.name } };
  } catch (error) {
    return { message: toAppError(error).message };
  }
}

export async function revokeApiKeyAction(keyId: string) {
  const session = await verifySession();
  await revokeApiKey(db, session.userId, keyId);
  revalidatePath("/dashboard/api-keys");
}
