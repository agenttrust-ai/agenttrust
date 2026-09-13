"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import {
  activateOwnedAgent,
  checkOwnershipVerification,
  createAgent,
  deleteOwnedAgent,
  startOwnershipVerification,
  updateOwnedAgent,
} from "@/lib/db/queries/agents";
import { parseAgentFormData } from "@/lib/validation/agent";
import { toAppError } from "@/lib/errors";

export type AgentFormState =
  | {
      errors?: Partial<
        Record<
          | "name"
          | "description"
          | "endpointUrl"
          | "version"
          | "capabilities"
          | "authType"
          | "authCredential"
          | "authHeaderName"
          | "agentCard",
          string[]
        >
      >;
      message?: string;
    }
  | undefined;

export async function createAgentAction(
  _prevState: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  const session = await verifySession();
  const parsed = parseAgentFormData(formData);

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  let slug: string;
  try {
    const agent = await createAgent(db, session.userId, parsed.data);
    slug = agent.slug;
  } catch (error) {
    return { message: toAppError(error).message };
  }

  revalidatePath("/dashboard/agents");
  redirect(`/dashboard/agents/${slug}`);
}

export async function updateAgentAction(
  agentId: string,
  _prevState: AgentFormState,
  formData: FormData,
): Promise<AgentFormState> {
  const session = await verifySession();
  const parsed = parseAgentFormData(formData);

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  let slug: string;
  try {
    const agent = await updateOwnedAgent(
      db,
      session.userId,
      agentId,
      parsed.data,
    );
    slug = agent.slug;
  } catch (error) {
    return { message: toAppError(error).message };
  }

  revalidatePath("/dashboard/agents");
  revalidatePath(`/dashboard/agents/${slug}`);
  redirect(`/dashboard/agents/${slug}`);
}

export async function deleteAgentAction(agentId: string) {
  const session = await verifySession();
  await deleteOwnedAgent(db, session.userId, agentId);
  revalidatePath("/dashboard/agents");
  redirect("/dashboard/agents");
}

/** Draft -> active: the one step that makes an agent both publicly visible and eligible for pull monitoring. */
export async function activateAgentAction(agentId: string) {
  const session = await verifySession();
  const agent = await activateOwnedAgent(db, session.userId, agentId);
  revalidatePath("/dashboard/agents");
  revalidatePath(`/dashboard/agents/${agent.slug}`);
}

/**
 * Generates (or, if one already exists, just re-reveals) the challenge
 * token for endpoint-ownership verification. A plain no-return-value
 * action, same shape as `activateAgentAction` — there's nothing that can
 * fail here in a way the owner needs an inline error for; NOT_FOUND from a
 * bad agentId surfaces as this Server Action's own thrown-error path.
 */
export async function startOwnershipVerificationAction(agentId: string) {
  const session = await verifySession();
  const agent = await startOwnershipVerification(db, session.userId, agentId);
  revalidatePath(`/dashboard/agents/${agent.slug}`);
}

export type OwnershipVerificationState = { error: string } | undefined;

/**
 * Performs the actual check. Unlike `startOwnershipVerificationAction`,
 * failure here is an expected, frequent outcome (the owner hasn't published
 * the file yet, or made a mistake) — so it reports back through
 * `useActionState` the same way `createAgentAction`/`updateAgentAction` do,
 * instead of throwing an uncaught error into the Server Action machinery.
 */
export async function checkOwnershipVerificationAction(
  agentId: string,
): Promise<OwnershipVerificationState> {
  const session = await verifySession();
  try {
    const agent = await checkOwnershipVerification(db, session.userId, agentId);
    revalidatePath(`/dashboard/agents/${agent.slug}`);
    return undefined;
  } catch (error) {
    return { error: toAppError(error).message };
  }
}
