import fs from "node:fs";
import path from "node:path";
import * as sdk from "../../../packages/sdk/src/index";

/**
 * Facts read from the TypeScript SDK's own source (packages/sdk/src), so
 * documentation tests compare the docs against the code rather than against
 * a second hand-written list that could drift with it.
 */
const SDK_SRC = path.resolve(import.meta.dirname, "../../../packages/sdk/src");
const read = (file: string) =>
  fs.readFileSync(path.join(SDK_SRC, file), "utf8");

/** The property names of `export interface <name> { ... }` in types.ts. */
function interfaceKeys(name: string): string[] {
  const body = read("types.ts").match(
    new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`),
  )?.[1];
  if (!body)
    throw new Error(`interface ${name} not found in packages/sdk/src/types.ts`);
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((match) => match[1]);
}

/** Every `AgentTrustErrorCode`, in declaration order. */
export function sdkErrorCodes(): string[] {
  // The union runs to the next top-level declaration; its doc comments are
  // dropped first, since they can contain quotes and semicolons.
  const union = read("errors.ts").match(
    /export type AgentTrustErrorCode =([\s\S]*?)\nexport /,
  )?.[1];
  if (!union)
    throw new Error(
      "AgentTrustErrorCode not found in packages/sdk/src/errors.ts",
    );
  return [
    ...union.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/"([A-Z_]+)"/g),
  ].map((match) => match[1]);
}

/** Every `TrustPolicy` option, in declaration order. */
export const sdkPolicyOptions = () => interfaceKeys("TrustPolicy");

/** The fields of a matched result (`MatchedTrustResult`). */
export const sdkMatchedResultFields = () => interfaceKeys("MatchedTrustResult");

/** The fields of `trustDecision`. */
export const sdkTrustDecisionFields = () => interfaceKeys("TrustDecision");

/** The functions and classes the SDK exports at runtime (not types or constants). */
export function sdkExportedFunctions(): string[] {
  return Object.entries(sdk)
    .filter(([, value]) => typeof value === "function")
    .map(([name]) => name)
    .sort();
}
