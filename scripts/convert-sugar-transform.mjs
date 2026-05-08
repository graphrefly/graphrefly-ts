/**
 * Transforms sugar function calls to raw node() calls.
 * Run: node scripts/convert-sugar-transform.mjs
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// Helper to get the indentation of a line
function getIndent(line) {
	return line.match(/^(\s*)/)[1];
}

/**
 * Converts `state(...)` calls to `node([], ...)` calls in a text block.
 * Handles:
 *   state()                         → node([])
 *   state<T>()                      → node<T>([])
 *   state(v)                        → node([], { initial: v })
 *   state<T>(v)                     → node<T>([], { initial: v })
 *   state(v, opts)                  → node([], { ...opts, initial: v })
 *   state<T>(v, opts)               → node<T>([], { ...opts, initial: v })
 *
 * This uses a character-by-character parser to find balanced parens.
 */
function transformState(src) {
	// Match state<optional-typeargs>(args)
	const statePattern = /\bstate(<[^>]*>)?\(/g;
	let result = "";
	let lastEnd = 0;

	for (;;) {
		const match = statePattern.exec(src);
		if (match === null) break;
		// Make sure it's not in a comment or string (simplified check)
		const before = src.slice(0, match.index);
		// Skip if preceded by '.' (method call, not our sugar)
		if (before.endsWith(".")) continue;
		// Skip if in a word character (part of another identifier)
		if (before.length > 0 && /\w/.test(before[before.length - 1])) continue;

		const typeArgs = match[1] || "";
		const parenStart = match.index + match[0].length; // position after '('

		// Find the matching closing paren
		let depth = 1;
		let i = parenStart;
		while (i < src.length && depth > 0) {
			if (src[i] === "(" || src[i] === "[" || src[i] === "{") depth++;
			else if (src[i] === ")" || src[i] === "]" || src[i] === "}") depth--;
			if (depth > 0) i++;
			else break;
		}
		// i is now the index of the closing ')'
		const argsStr = src.slice(parenStart, i).trim();

		let replacement;
		if (argsStr === "") {
			// state() or state<T>()
			replacement = `node${typeArgs}([])`;
		} else {
			// Parse args: first arg is initial value, optional second arg is opts
			// Find the split point (top-level comma)
			let commaIdx = -1;
			let d = 0;
			for (let j = 0; j < argsStr.length; j++) {
				const c = argsStr[j];
				if (c === "(" || c === "[" || c === "{" || c === "<") d++;
				else if (c === ")" || c === "]" || c === "}" || c === ">") d--;
				else if (c === "," && d === 0) {
					commaIdx = j;
					break;
				}
			}

			if (commaIdx === -1) {
				// state(v) or state<T>(v)
				const v = argsStr;
				replacement = `node${typeArgs}([], { initial: ${v} })`;
			} else {
				// state(v, opts) or state<T>(v, opts)
				const v = argsStr.slice(0, commaIdx).trim();
				const opts = argsStr.slice(commaIdx + 1).trim();
				replacement = `node${typeArgs}([], { ...${opts}, initial: ${v} })`;
			}
		}

		result += src.slice(lastEnd, match.index) + replacement;
		lastEnd = i + 1; // skip past the closing ')'
		statePattern.lastIndex = lastEnd;
	}

	result += src.slice(lastEnd);
	return result;
}

/**
 * Convert `derived(deps, fn, opts?)` to node() equivalent.
 * This is complex because fn can be `([v]) => expr` or `(deps) => expr` etc.
 * We handle the most common patterns.
 *
 * Returns the source with derived calls replaced.
 */
function transformDerived(src, funcName = "derived") {
	const pattern = new RegExp(`\\b${funcName}(<[^>]*>)?\\(`, "g");
	let result = "";
	let lastEnd = 0;

	for (;;) {
		const match = pattern.exec(src);
		if (match === null) break;
		const before = src.slice(0, match.index);
		if (before.endsWith(".")) continue;
		if (before.length > 0 && /\w/.test(before[before.length - 1])) continue;

		const typeArgs = match[1] || "";
		const parenStart = match.index + match[0].length;

		// Find closing paren of entire derived(...) call
		let depth = 1;
		let i = parenStart;
		while (i < src.length && depth > 0) {
			const c = src[i];
			if (c === "(" || c === "[" || c === "{") depth++;
			else if (c === ")" || c === "]" || c === "}") depth--;
			if (depth > 0) i++;
			else break;
		}
		const fullArgs = src.slice(parenStart, i);

		// Parse the args at top level:
		// arg0 = deps array
		// arg1 = user fn
		// arg2 = opts (optional)
		const topLevelArgs = splitTopLevel(fullArgs);
		if (topLevelArgs.length < 2) {
			// Can't parse, leave it alone
			result += src.slice(lastEnd, i + 1);
			lastEnd = i + 1;
			pattern.lastIndex = lastEnd;
			continue;
		}

		const depsArg = topLevelArgs[0].trim();
		const userFnArg = topLevelArgs[1].trim();
		const optsArg = topLevelArgs[2] ? topLevelArgs[2].trim() : null;

		// Determine indentation from context
		const lineStart = src.lastIndexOf("\n", match.index) + 1;
		const indent = getIndent(`${src.slice(lineStart, match.index + 1).trimEnd()}x`).replace(
			/x$/,
			"",
		);
		const inner = `${indent}\t`;

		// Build the replacement
		let optsStr;
		if (optsArg) {
			optsStr = `{ describeKind: "derived", ...${optsArg} }`;
		} else {
			optsStr = `{ describeKind: "derived" }`;
		}

		// Build the nodeFn body
		const nodeFnBody = [
			`(batchData, actions, ctx) => {`,
			`${inner}const data = batchData.map((batch, i) => batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i]);`,
			`${inner}actions.emit((${userFnArg})(data, ctx));`,
			`${indent}}`,
		].join("\n");

		const replacement = `node${typeArgs}(${depsArg}, ${nodeFnBody}, ${optsStr})`;

		result += src.slice(lastEnd, match.index) + replacement;
		lastEnd = i + 1;
		pattern.lastIndex = lastEnd;
	}

	result += src.slice(lastEnd);
	return result;
}

/**
 * Convert `effect(deps, fn, opts?)` to node() equivalent.
 * Effect doesn't auto-emit — just runs fn.
 */
function transformEffect(src, funcName = "effect") {
	const pattern = new RegExp(`\\b${funcName}(<[^>]*>)?\\(`, "g");
	let result = "";
	let lastEnd = 0;

	for (;;) {
		const match = pattern.exec(src);
		if (match === null) break;
		const before = src.slice(0, match.index);
		if (before.endsWith(".")) continue;
		if (before.length > 0 && /\w/.test(before[before.length - 1])) continue;

		const typeArgs = match[1] || "";
		const parenStart = match.index + match[0].length;

		let depth = 1;
		let i = parenStart;
		while (i < src.length && depth > 0) {
			const c = src[i];
			if (c === "(" || c === "[" || c === "{") depth++;
			else if (c === ")" || c === "]" || c === "}") depth--;
			if (depth > 0) i++;
			else break;
		}
		const fullArgs = src.slice(parenStart, i);
		const topLevelArgs = splitTopLevel(fullArgs);

		if (topLevelArgs.length < 2) {
			result += src.slice(lastEnd, i + 1);
			lastEnd = i + 1;
			pattern.lastIndex = lastEnd;
			continue;
		}

		const depsArg = topLevelArgs[0].trim();
		const userFnArg = topLevelArgs[1].trim();
		const optsArg = topLevelArgs[2] ? topLevelArgs[2].trim() : null;

		const lineStart = src.lastIndexOf("\n", match.index) + 1;
		const indent = getIndent(`${src.slice(lineStart, match.index + 1).trimEnd()}x`).replace(
			/x$/,
			"",
		);
		const inner = `${indent}\t`;

		let optsStr;
		if (optsArg) {
			optsStr = `{ describeKind: "effect", ...${optsArg} }`;
		} else {
			optsStr = `{ describeKind: "effect" }`;
		}

		const nodeFnBody = [
			`(batchData, actions, ctx) => {`,
			`${inner}const data = batchData.map((batch, i) => batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i]);`,
			`${inner}return ((${userFnArg})(data, actions, ctx) ?? undefined);`,
			`${indent}}`,
		].join("\n");

		const replacement = `node${typeArgs}(${depsArg}, ${nodeFnBody}, ${optsStr})`;

		result += src.slice(lastEnd, match.index) + replacement;
		lastEnd = i + 1;
		pattern.lastIndex = lastEnd;
	}

	result += src.slice(lastEnd);
	return result;
}

/**
 * Convert `producer(fn, opts?)` to node() equivalent.
 */
function transformProducer(src) {
	const pattern = /\bproducer(<[^>]*>)?\(/g;
	let result = "";
	let lastEnd = 0;

	for (;;) {
		const match = pattern.exec(src);
		if (match === null) break;
		const before = src.slice(0, match.index);
		if (before.endsWith(".")) continue;
		if (before.length > 0 && /\w/.test(before[before.length - 1])) continue;

		const typeArgs = match[1] || "";
		const parenStart = match.index + match[0].length;

		let depth = 1;
		let i = parenStart;
		while (i < src.length && depth > 0) {
			const c = src[i];
			if (c === "(" || c === "[" || c === "{") depth++;
			else if (c === ")" || c === "]" || c === "}") depth--;
			if (depth > 0) i++;
			else break;
		}
		const fullArgs = src.slice(parenStart, i);
		const topLevelArgs = splitTopLevel(fullArgs);

		if (topLevelArgs.length < 1) {
			result += src.slice(lastEnd, i + 1);
			lastEnd = i + 1;
			pattern.lastIndex = lastEnd;
			continue;
		}

		const userFnArg = topLevelArgs[0].trim();
		const optsArg = topLevelArgs[1] ? topLevelArgs[1].trim() : null;

		// Transform the user fn: (actions, ctx) => ... → (_data, actions, ctx) => ...
		// The user fn has signature (actions) or (actions, ctx)
		const transformedFn = transformProducerFn(userFnArg);

		let optsStr;
		if (optsArg) {
			optsStr = `{ describeKind: "producer", ...${optsArg} }`;
		} else {
			optsStr = `{ describeKind: "producer" }`;
		}

		const replacement = `node${typeArgs}(${transformedFn}, ${optsStr})`;

		result += src.slice(lastEnd, match.index) + replacement;
		lastEnd = i + 1;
		pattern.lastIndex = lastEnd;
	}

	result += src.slice(lastEnd);
	return result;
}

/**
 * Transform a producer fn signature:
 * (actions) => ... → (_data, actions) => ...
 * (actions, ctx) => ... → (_data, actions, ctx) => ...
 * (actions): Type => ... → (_data, actions): Type => ...
 */
function transformProducerFn(fnStr) {
	// Arrow function: (actions) => ... or (actions, ctx) => ...
	const arrowMatch = fnStr.match(/^\s*\(actions(?:,\s*(ctx))?\)\s*(?::\s*[^=]*)?\s*=>/);
	if (arrowMatch) {
		if (arrowMatch[1]) {
			return fnStr.replace(/^\s*\(actions,\s*ctx\)/, "(_data, actions, ctx)");
		} else {
			return fnStr.replace(/^\s*\(actions\)/, "(_data, actions)");
		}
	}
	// Multi-line arrow: same pattern
	return fnStr
		.replace(/^\s*\(\s*actions\s*,\s*ctx\s*\)/, "(_data, actions, ctx)")
		.replace(/^\s*\(\s*actions\s*\)/, "(_data, actions)");
}

/**
 * Split a string by top-level commas (not inside brackets/parens/braces).
 */
function splitTopLevel(str) {
	const parts = [];
	let depth = 0;
	let current = "";
	let inString = false;
	let stringChar = "";

	for (let i = 0; i < str.length; i++) {
		const c = str[i];

		if (inString) {
			current += c;
			if (c === stringChar && str[i - 1] !== "\\") {
				inString = false;
			}
			continue;
		}

		if (c === '"' || c === "'" || c === "`") {
			inString = true;
			stringChar = c;
			current += c;
			continue;
		}

		if (c === "(" || c === "[" || c === "{") {
			depth++;
			current += c;
		} else if (c === ")" || c === "]" || c === "}") {
			depth--;
			current += c;
		} else if (c === "," && depth === 0) {
			parts.push(current);
			current = "";
		} else {
			current += c;
		}
	}

	if (current.trim()) parts.push(current);
	return parts;
}

// ─── Update import lines ─────────────────────────────────────────────────────

const REMOVED_SUGAR = [
	"state",
	"derived",
	"derivedT",
	"effect",
	"effectT",
	"producer",
	"DerivedFn",
	"EffectFn",
];

function updateImports(src, _filePath) {
	// Find the sugar import
	const sugarImportRe = /import\s*\{([^}]*)\}\s*from\s*["']([^"']*core\/sugar\.js)["']/g;
	let newSrc = src;

	const matches = [...src.matchAll(sugarImportRe)];
	for (const match of matches) {
		const symbols = match[1]
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		const kept = symbols.filter((s) => !REMOVED_SUGAR.includes(s));
		const removed = symbols.filter((s) => REMOVED_SUGAR.includes(s));

		if (removed.length === 0) continue;

		if (kept.length === 0) {
			// Remove the entire import line
			newSrc = newSrc.replace(match[0], "");
		} else {
			// Keep only non-removed symbols
			const newImport = `import { ${kept.join(", ")} } from '${match[2]}'`;
			newSrc = newSrc.replace(match[0], newImport);
		}
	}

	// Now check if we need to add `node` to the node import
	const hasNodeImport = /from\s+["'][^"']*core\/node\.js["']/.test(newSrc);
	if (hasNodeImport) {
		// Check if node is already in the import
		const nodeImportRe = /import\s*\{([^}]*)\}\s*from\s*["']([^"']*core\/node\.js)["']/;
		const nodeMatch = newSrc.match(nodeImportRe);
		if (nodeMatch) {
			const nodeSymbols = nodeMatch[1]
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			if (!nodeSymbols.includes("node")) {
				nodeSymbols.unshift("node");
				newSrc = newSrc.replace(
					nodeMatch[0],
					`import { ${nodeSymbols.join(", ")} } from '${nodeMatch[2]}'`,
				);
			}
		}
	} else {
		// Need to add node import. Find the right path.
		// The sugar import path tells us the relative path to core/
		const sugarImportMatch = src.match(/from\s*["']([^"']*core\/sugar\.js)["']/);
		if (sugarImportMatch) {
			const sugarPath = sugarImportMatch[1];
			const nodePath = sugarPath.replace("sugar.js", "node.js");
			// Insert node import at the top of imports
			const firstImportIdx = newSrc.indexOf("import ");
			newSrc =
				newSrc.slice(0, firstImportIdx) +
				`import { node } from '${nodePath}';\n` +
				newSrc.slice(firstImportIdx);
		}
	}

	// Clean up blank lines from removed imports
	newSrc = newSrc.replace(/\n\n\n/g, "\n\n");

	return newSrc;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const FILES = [
	"src/__tests__/core/node.test.ts",
	"src/__tests__/core/protocol.test.ts",
	"src/__tests__/core/perf-smoke.test.ts",
	"src/__tests__/core/lifecycle.test.ts",
	"src/__tests__/core/regressions.test.ts",
	"src/__tests__/core/versioning.test.ts",
	"src/__tests__/core/multi-message-delivery.test.ts",
	"src/__tests__/extra/backpressure.test.ts",
	"src/__tests__/extra/resilience.test.ts",
	"src/__tests__/extra/reactive-log-stress.test.ts",
	"src/__tests__/extra/edge-cases.test.ts",
	"src/__tests__/extra/operator-protocol-matrix.test.ts",
	"src/__tests__/extra/operators.test.ts",
	"src/__tests__/extra/reactive-map-stress.test.ts",
	"src/__tests__/extra/reactive-index-stress.test.ts",
	"src/__tests__/extra/sources.test.ts",
	"src/__tests__/extra/mutation/mutation.test.ts",
	"src/__tests__/extra/session1-foundation.test.ts",
	"src/__tests__/extra/composite.test.ts",
	"src/__tests__/extra/worker.test.ts",
	"src/__tests__/extra/reactive-sink.test.ts",
	"src/__tests__/extra/reactive-list-stress.test.ts",
	"src/__tests__/phase5-llm-composition.test.ts",
	"src/__tests__/patterns/ai.test.ts",
	"src/__tests__/patterns/domain-templates.test.ts",
	"src/__tests__/patterns/harness-default-bridges.test.ts",
	"src/__tests__/patterns/harness.test.ts",
	"src/__tests__/patterns/reduction.test.ts",
	"src/__tests__/patterns/memory.test.ts",
	"src/__tests__/patterns/lens.test.ts",
	"src/__tests__/patterns/guarded-execution.test.ts",
	"src/__tests__/patterns/refine-loop.test.ts",
	"src/__tests__/patterns/refine-executor.test.ts",
	"src/__tests__/patterns/actuator-executor.test.ts",
	"src/__tests__/patterns/surface/surface.test.ts",
	"src/__tests__/patterns/messaging.test.ts",
	"src/__tests__/patterns/orchestration.test.ts",
	"src/__tests__/patterns/inspect-preset.test.ts",
	"src/__tests__/patterns/auto-solidify.test.ts",
	"src/__tests__/patterns/ai/agents/tool-execution.test.ts",
	"src/__tests__/patterns/demo-shell.test.ts",
	"src/__tests__/patterns/graphspec.test.ts",
	"src/__tests__/patterns/audit.test.ts",
	"src/__tests__/patterns/resilient-pipeline.test.ts",
	"src/__tests__/graph/graph.test.ts",
	"src/__tests__/graph/validate-observability.test.ts",
	"src/__tests__/graph/describe-ascii.test.ts",
	"src/__tests__/graph/validate-no-islands.test.ts",
	"src/__tests__/graph/codec.test.ts",
	"src/__tests__/graph/topology.test.ts",
	"src/__tests__/graph/explain.test.ts",
	"src/__tests__/graph/reactive-changesets.test.ts",
	"src/__tests__/graphspec/spec-roundtrip.test.ts",
	"src/__tests__/graphspec/factory-tags-audit.test.ts",
	"src/__tests__/graphspec/factory-tags-bundles.test.ts",
	"src/__tests__/evals/catalog-aware-evaluator.test.ts",
	"src/__tests__/compat/nestjs.test.ts",
	"src/__tests__/compat/zustand.test.ts",
	"src/__tests__/properties/_invariants.ts",
];

let processed = 0;
let skipped = 0;
const errors = [];

for (const relPath of FILES) {
	const filePath = resolve(REPO_ROOT, relPath);
	if (!existsSync(filePath)) {
		console.log(`SKIP (not found): ${relPath}`);
		skipped++;
		continue;
	}

	let src = readFileSync(filePath, "utf8");

	// Check if file has sugar imports to remove
	const sugarImportRe = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*core\/sugar\.js["']/;
	const sugarMatch = src.match(sugarImportRe);
	if (!sugarMatch) {
		console.log(`SKIP (no sugar import): ${relPath}`);
		skipped++;
		continue;
	}

	const importedSymbols = sugarMatch[1]
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const hasState = importedSymbols.includes("state");
	const hasDerived = importedSymbols.includes("derived") || importedSymbols.includes("derivedT");
	const hasEffect = importedSymbols.includes("effect") || importedSymbols.includes("effectT");
	const hasProducer = importedSymbols.includes("producer");

	console.log(`Processing: ${relPath}`);
	console.log(
		`  Sugar functions: ${[hasState && "state", hasDerived && "derived/derivedT", hasEffect && "effect/effectT", hasProducer && "producer"].filter(Boolean).join(", ")}`,
	);

	try {
		if (hasState) src = transformState(src);
		if (hasDerived) {
			src = transformDerived(src, "derived");
			src = transformDerived(src, "derivedT");
		}
		if (hasEffect) {
			src = transformEffect(src, "effect");
			src = transformEffect(src, "effectT");
		}
		if (hasProducer) src = transformProducer(src);

		src = updateImports(src, filePath);

		writeFileSync(filePath, src, "utf8");
		processed++;
		console.log(`  ✓ Done`);
	} catch (e) {
		errors.push({ file: relPath, error: e.message });
		console.error(`  ✗ ERROR: ${e.message}`);
	}
}

console.log(`\nSummary: ${processed} processed, ${skipped} skipped, ${errors.length} errors`);
if (errors.length > 0) {
	console.error("Errors:");
	for (const e of errors) console.error(`  ${e.file}: ${e.error}`);
}
