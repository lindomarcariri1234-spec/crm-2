#!/usr/bin/env node
/**
 * compact-dts.mjs
 *
 * Rewrites lib/api-zod/dist/generated/api.d.ts to replace verbose
 *   zod.ZodObject<{…fieldTypes…}, "strip", ZodTypeAny, Output, Input>
 * declarations with the compact form
 *   zod.ZodType<Output, zod.ZodTypeDef, Input>
 *
 * TypeScript must expand every ZodObject generic tree when it type-checks
 * files that import @workspace/api-zod — each schema with nested ZodObject
 * fields blows up to hundreds of recursive type nodes in the checker's heap.
 * With compact ZodType<Output> the checker just holds a plain object shape,
 * cutting peak heap per batch from ~2 GB to ~400 MB.
 *
 * `pnpm --filter @workspace/api-zod run build` invokes this script after every
 * declaration emit. Keep these transforms aligned with Orval's generated
 * declaration shapes whenever its generation output changes.
 *
 * Patterns handled:
 *   ZodObject<{…}, "strip", ZodTypeAny, O, I>          → ZodType<O, ZodTypeDef, I>
 *   ZodArray<ZodObject<…>, "many">                      → ZodType<O[], ZodTypeDef, I[]>
 *   ZodIntersection<ZodObject<…>, ZodObject<…>>         → ZodType<O1&O2, ZodTypeDef, I1&I2>
 *   ZodArray<ZodIntersection<ZodObject<…>,ZodObject<…>> → ZodType<(O1&O2)[], ZodTypeDef, (I1&I2)[]>
 *   everything else (simple constants, ZodEnum, …)      → kept as-is
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dtsPath = path.resolve(__dirname, "../dist/generated/api.d.ts");

// ---------------------------------------------------------------------------
// Balanced-bracket generic argument splitter
// ---------------------------------------------------------------------------

/**
 * Starting right after an opening `<`, split the content at depth-0 commas
 * and return the list of top-level arguments plus the index of the closing `>`.
 *
 * All four bracket kinds (<>, {}, [], ()) are tracked together so that inner
 * generics, object literals and tuples are never split mid-way.
 */
function getTopLevelArgs(content, afterAngleIdx) {
  const args = [];
  let depth = 0;
  let segStart = afterAngleIdx;
  let inStr = false;
  let strChar = "";

  for (let i = afterAngleIdx; i < content.length; i++) {
    const ch = content[i];

    if (inStr) {
      if (ch === strChar) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      strChar = ch;
      continue;
    }

    if (ch === "<" || ch === "{" || ch === "[" || ch === "(") {
      depth++;
    } else if (ch === ">" || ch === "}" || ch === "]" || ch === ")") {
      if (depth === 0) {
        // This `>` closes the outermost `<` we were called for.
        args.push(content.slice(segStart, i).trim());
        return { args, closingIdx: i };
      }
      depth--;
    } else if (ch === "," && depth === 0) {
      args.push(content.slice(segStart, i).trim());
      segStart = i + 1;
    }
  }

  // Shouldn't reach here for well-formed TypeScript .d.ts files.
  args.push(content.slice(segStart).trim());
  return { args, closingIdx: content.length - 1 };
}

// ---------------------------------------------------------------------------
// Type-shape extractors
// ---------------------------------------------------------------------------

/**
 * Given a string starting with `zod.ZodObject<`, returns { output, input }.
 * Returns null if the string does not match or is malformed.
 */
function extractFromZodObject(typeStr) {
  const prefix = "zod.ZodObject<";
  if (!typeStr.startsWith(prefix)) return null;
  const { args } = getTopLevelArgs(typeStr, prefix.length);
  // args[0]=fieldTypes  args[1]="strip"  args[2]=ZodTypeAny  args[3]=Output  args[4]=Input
  if (args.length < 5) return null;
  return { output: args[3], input: args[4] };
}

/**
 * Recursively extract the (output, input) pair from a Zod type string.
 * Handles ZodObject, ZodArray, and ZodIntersection.
 * Returns null for unrecognised types (caller will keep the declaration as-is).
 */
function extractOutputInput(typeStr) {
  // ZodObject
  if (typeStr.startsWith("zod.ZodObject<")) {
    return extractFromZodObject(typeStr);
  }

  // ZodArray<InnerType, "many">
  if (typeStr.startsWith("zod.ZodArray<")) {
    const innerStart = "zod.ZodArray<".length;
    const { args: arrayArgs } = getTopLevelArgs(typeStr, innerStart);
    // arrayArgs[0] = inner Zod type, arrayArgs[1] = "many"
    const inner = extractOutputInput(arrayArgs[0]);
    if (!inner) return null;
    // When the element type is an intersection (A & B), parenthesise before
    // appending [] so the result is (A & B)[] not the incorrect A & B[].
    const wrapOutput = inner.needsParens ? `(${inner.output})` : inner.output;
    const wrapInput = inner.needsParens ? `(${inner.input})` : inner.input;
    return {
      output: `${wrapOutput}[]`,
      input: `${wrapInput}[]`,
      needsParens: false,
    };
  }

  // ZodIntersection<A, B>
  if (typeStr.startsWith("zod.ZodIntersection<")) {
    const innerStart = "zod.ZodIntersection<".length;
    const { args: intArgs } = getTopLevelArgs(typeStr, innerStart);
    if (intArgs.length < 2) return null;
    const left = extractOutputInput(intArgs[0]);
    const right = extractOutputInput(intArgs[1]);
    if (!left || !right) return null;
    return {
      output: `${left.output} &\n    ${right.output}`,
      input: `${left.input} &\n    ${right.input}`,
      needsParens: true,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Declaration transformer
// ---------------------------------------------------------------------------

/**
 * Transform a single `export declare const NAME: TYPE;` declaration.
 * The caller passes the full text of the declaration (no trailing newline needed).
 * Returns the transformed text (or the original unchanged if no simplification applies).
 */
function transformDeclaration(declText) {
  // Quick-exit for simple constant assignments (`= "value"`) and anything
  // that doesn't involve a Zod type annotation.
  if (!declText.includes(": zod.Zod")) return declText;

  // Locate the ": TYPE" portion.
  // We look for ": zod.ZodObject<", ": zod.ZodArray<", or ": zod.ZodIntersection<"
  // The first character of the type is right after ": ".
  const colonIdx = declText.indexOf(": zod.Zod");
  if (colonIdx === -1) return declText;

  const prefix = declText.slice(0, colonIdx + 2); // everything up to and including ": "
  // Strip the trailing ";" to get the raw type string.
  const typeStr = declText.slice(colonIdx + 2).replace(/;\s*$/, "");

  const result = extractOutputInput(typeStr);
  if (!result) return declText;

  const { output, input, needsParens } = result;

  // For ZodArray<ZodIntersection<...>>, the element type already has `&` in it;
  // wrap with parens before appending `[]` — handled by the caller by noting
  // needsParens, but we also need to fix already-built array strings.
  // (The `extractOutputInput` for ZodArray already appended `[]` after the
  //  potentially-intersected string, which is valid TS.)

  return `${prefix}zod.ZodType<\n${output},\n    zod.ZodTypeDef,\n${input}\n>;`;
}

// ---------------------------------------------------------------------------
// File-level processor
// ---------------------------------------------------------------------------

async function main() {
  const original = await readFile(dtsPath, "utf8");

  // Walk the file character by character to find declaration boundaries.
  // Each `export declare const` begins a new declaration; it ends at the
  // depth-0 `;` that terminates the type annotation.

  let output = "";
  let pos = 0;

  while (pos < original.length) {
    const exportIdx = original.indexOf("export declare const ", pos);
    if (exportIdx === -1) {
      output += original.slice(pos);
      break;
    }

    // Copy everything between current position and the start of this declaration
    // (includes preceding JSDoc comment, blank lines, etc.)
    output += original.slice(pos, exportIdx);

    // Find the end of this declaration: the first `;` at bracket depth 0.
    let depth = 0;
    let inStr = false;
    let strChar = "";
    let declEnd = -1;

    for (let i = exportIdx; i < original.length; i++) {
      const ch = original[i];

      if (inStr) {
        if (ch === strChar) inStr = false;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = true;
        strChar = ch;
        continue;
      }

      if (ch === "<" || ch === "{" || ch === "[" || ch === "(") depth++;
      else if (ch === ">" || ch === "}" || ch === "]" || ch === ")") {
        if (depth > 0) depth--;
      } else if (ch === ";" && depth === 0) {
        declEnd = i;
        break;
      }
    }

    if (declEnd === -1) {
      // Malformed — copy the rest verbatim.
      output += original.slice(exportIdx);
      break;
    }

    const declText = original.slice(exportIdx, declEnd + 1); // includes ";"
    output += transformDeclaration(declText);
    pos = declEnd + 1;
  }

  const beforeLines = original.split("\n").length;
  const afterLines = output.split("\n").length;

  await writeFile(dtsPath, output, "utf8");
  console.log(`compact-dts: ${beforeLines} lines → ${afterLines} lines (saved ${beforeLines - afterLines} lines)`);
}

main().catch((err) => {
  console.error("compact-dts failed:", err);
  process.exit(1);
});
