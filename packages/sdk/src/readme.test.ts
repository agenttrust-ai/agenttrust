import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as sdk from "./index.js";

/**
 * The README is the SDK's main documentation (and its npm page), so its
 * examples must compile exactly as written and it must cover the public API.
 * Facts come from the SDK's own types via the TypeScript checker. No network.
 */
const SDK_DIR = path.resolve(import.meta.dirname, "..");
const INDEX = path.join(SDK_DIR, "src/index.ts");
const README = fs.readFileSync(path.join(SDK_DIR, "README.md"), "utf8");
const TS_BLOCKS = [...README.matchAll(/```ts\n([\s\S]*?)```/g)].map(
  (match) => match[1],
);

const COMPILER_OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  // The SDK's own build settings: ES2022 plus the fetch/AbortController/console globals.
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  types: [],
  // What `npm install @getagenttrust/sdk` resolves to, pointed at this source.
  paths: { "@getagenttrust/sdk": [INDEX] },
};

/** Type-checks each snippet as its own ES module file; returns every diagnostic. */
function compileSnippets(snippets: string[]): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agenttrust-sdk-readme-"));
  try {
    const files = snippets.map((code, index) => {
      const file = path.join(dir, `example-${index + 1}.mts`);
      fs.writeFileSync(file, code);
      return file;
    });
    const program = ts.createProgram(files, COMPILER_OPTIONS);
    return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
      const where = diagnostic.file
        ? `${path.basename(diagnostic.file.fileName)}: `
        : "";
      return (
        where + ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
      );
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The SDK's exported types, resolved through the checker. */
function exportedType(name: string): {
  type: ts.Type;
  checker: ts.TypeChecker;
} {
  const program = ts.createProgram([INDEX], COMPILER_OPTIONS);
  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(
    program.getSourceFile(INDEX)!,
  )!;
  const exported = checker
    .getExportsOfModule(moduleSymbol)
    .find((symbol) => symbol.name === name);
  if (!exported) throw new Error(`${name} is not exported from src/index.ts`);
  const symbol =
    exported.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(exported)
      : exported;
  return { type: checker.getDeclaredTypeOfSymbol(symbol), checker };
}

const propertyNames = (name: string) =>
  exportedType(name)
    .type.getProperties()
    .map((property) => property.name);

const errorCodes = () => {
  const { type } = exportedType("AgentTrustErrorCode");
  return (type.isUnion() ? type.types : [type]).map((member) =>
    String((member as ts.StringLiteralType).value),
  );
};

describe("README examples", () => {
  it("has TypeScript examples to check", () => {
    expect(TS_BLOCKS.length).toBeGreaterThanOrEqual(5);
  });

  it("compile exactly as written, under strict TypeScript", () => {
    expect(compileSnippets(TS_BLOCKS)).toEqual([]);
  });

  it("would catch an example that doesn't compile (the harness works)", () => {
    const broken = `import { createAgentTrustClient } from "@getagenttrust/sdk";
const agentTrust = createAgentTrustClient({ timeoutMs: 5_000 });
await agentTrust.checkAgentTrust(url, { timeoutMs: 2_000, signal });
`;
    expect(compileSnippets([broken]).join("\n")).toMatch(
      /Cannot find name 'url'/,
    );
  });
});

describe("README covers the public API", () => {
  it("documents every exported function and class", () => {
    const names = Object.entries(sdk)
      .filter(([, value]) => typeof value === "function")
      .map(([name]) => name);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(README).toContain(`\`${name}`);
  });

  it("documents every policy option", () => {
    const options = propertyNames("TrustPolicy");
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) expect(README).toContain(`| \`${option}\` |`);
  });

  it("documents every result field", () => {
    for (const field of propertyNames("MatchedTrustResult").filter(
      (field) => field !== "trustDecision",
    )) {
      expect(README).toContain(`| \`${field}\` |`);
    }
    for (const field of propertyNames("TrustDecision"))
      expect(README).toContain(`| \`trustDecision.${field}\` |`);
    for (const field of propertyNames("UnmatchedTrustResult"))
      expect(README).toContain(`| \`${field}\` |`);
  });

  it("documents every error code", () => {
    const codes = errorCodes();
    expect(codes).toContain("NOT_TRUSTED");
    for (const code of codes)
      expect(README).toMatch(new RegExp(`\\| [^\\n]*\`${code}\``));
  });
});
