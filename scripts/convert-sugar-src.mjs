/**
 * Transforms sugar function calls to raw node() calls in SOURCE files.
 * Run: node scripts/convert-sugar-src.mjs
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

function splitTopLevel(str) {
	const parts = [];
	let depth = 0;
	let current = "";
	let inString = false;
	let stringChar = "";
	let inTemplate = 0; // template literal nesting

	for (let i = 0; i < str.length; i++) {
		const c = str[i];
		if (inString && !inTemplate) {
			current += c;
			if (c === "\\") {
				current += str[++i];
				continue;
			}
			if (c === stringChar) inString = false;
			continue;
		}
		if (inTemplate > 0) {
			current += c;
			if (c === "\\") {
				current += str[++i];
				continue;
			}
			if (c === "`") {
				inTemplate--;
				continue;
			}
			if (c === "{" && str[i - 1] === "$") {
				depth++;
				continue;
			}
			if (c === "}" && depth > 0) {
				depth--;
				continue;
			}
			continue;
		}
		if (c === '"' || c === "'") {
			inString = true;
			stringChar = c;
			current += c;
			continue;
		}
		if (c === "`") {
			inTemplate++;
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

function getIndent(linePrefix) {
	return (linePrefix.match(/^(\s*)/) || ["", ""])[1];
}

function transformState(src) {
	const statePattern = /\bstate(<[^>]*>)?\(/g;
	let result = "";
	let lastEnd = 0;
	let match;

	while ((match = statePattern.exec(src)) !== null) {
		const before = src.slice(0, match.index);
		if (before.endsWith(".")) continue;
		if (before.length > 0 && /\w/.test(before[before.length - 1])) continue;

		const typeArgs = match[1] || "";
		const parenStart = match.index + match[0].length;

		let depth = 1;
		let i = parenStart;
		while (i < src.length && depth > 0) {
			if (src[i] === "(" || src[i] === "[" || src[i] === "{") depth++;
			else if (src[i] === ")" || src[i] === "]" || src[i] === "}") depth--;
			if (depth > 0) i++;
			else break;
		}
		const argsStr = src.slice(parenStart, i).trim();

		let replacement;
		if (argsStr === "") {
			replacement = `node${typeArgs}([])`;
		} else {
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
				replacement = `node${typeArgs}([], { initial: ${argsStr} })`;
			} else {
				const v = argsStr.slice(0, commaIdx).trim();
				const opts = argsStr.slice(commaIdx + 1).trim();
				replacement = `node${typeArgs}([], { ...${opts}, initial: ${v} })`;
			}
		}

		result += src.slice(lastEnd, match.index) + replacement;
		lastEnd = i + 1;
		statePattern.lastIndex = lastEnd;
	}
	result += src.slice(lastEnd);
	return result;
}

function transformDerived(src, funcName = "derived") {
	const pattern = new RegExp(`\\b${funcName}(<[^>]*>)?\\(`, "g");
	let result = "";
	let lastEnd = 0;
	let match;

	while ((match = pattern.exec(src)) !== null) {
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
		const linePrefix = src.slice(lineStart, match.index);
		const indent = getIndent(linePrefix);
		const inner = indent + "\t";

		let optsStr;
		if (optsArg) {
			optsStr = `{ describeKind: "derived", ...${optsArg} }`;
		} else {
			optsStr = `{ describeKind: "derived" }`;
		}

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

function transformEffect(src, funcName = "effect") {
	const pattern = new RegExp(`\\b${funcName}(<[^>]*>)?\\(`, "g");
	let result = "";
	let lastEnd = 0;
	let match;

	while ((match = pattern.exec(src)) !== null) {
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
		const linePrefix = src.slice(lineStart, match.index);
		const indent = getIndent(linePrefix);
		const inner = indent + "\t";

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

function transformProducer(src) {
	const pattern = /\bproducer(<[^>]*>)?\(/g;
	let result = "";
	let lastEnd = 0;
	let match;

	while ((match = pattern.exec(src)) !== null) {
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

		// Transform producer fn: (actions) => ... → (_data, actions) => ...
		// (actions, ctx) => ... → (_data, actions, ctx) => ...
		const transformedFn = userFnArg
			.replace(/^\s*\(\s*actions\s*,\s*ctx\s*\)/, "(_data, actions, ctx)")
			.replace(/^\s*\(\s*actions\s*\)/, "(_data, actions)");

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

function updateImports(src, filePath) {
	const sugarImportRe = /import\s*(type\s*)?\{([^}]*)\}\s*from\s*["']([^"']*core\/sugar\.js)["']/g;
	let newSrc = src;

	const matches = [...src.matchAll(sugarImportRe)];
	for (const match of matches) {
		const typePrefix = match[1] || "";
		const symbolsStr = match[2];
		const importPath = match[3];

		const symbols = symbolsStr
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);

		// Separate value symbols from type-only symbols
		const keptSymbols = [];
		const removedSymbols = [];
		for (const s of symbols) {
			// Handle "type X" form within the import
			const name = s.replace(/^type\s+/, "");
			if (REMOVED_SUGAR.includes(name)) {
				removedSymbols.push(s);
			} else {
				keptSymbols.push(s);
			}
		}

		if (removedSymbols.length === 0) continue;

		if (keptSymbols.length === 0) {
			newSrc = newSrc.replace(match[0], "");
		} else {
			const newImport = `import ${typePrefix}{ ${keptSymbols.join(", ")} } from "${importPath}"`;
			newSrc = newSrc.replace(match[0], newImport);
		}
	}

	// Check if we need to add `node` to the node import
	const hasNodeImport = /from\s+["'][^"']*core\/node\.js["']/.test(newSrc);
	if (hasNodeImport) {
		const nodeImportRe = /import\s*\{([^}]*)\}\s*from\s*(["'][^"']*core\/node\.js["'])/;
		const nodeMatch = newSrc.match(nodeImportRe);
		if (nodeMatch) {
			const nodeSymbols = nodeMatch[1]
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			if (!nodeSymbols.includes("node") && !nodeSymbols.some((s) => s.trim() === "node")) {
				nodeSymbols.unshift("node");
				newSrc = newSrc.replace(
					nodeMatch[0],
					`import { ${nodeSymbols.join(", ")} } from ${nodeMatch[2]}`,
				);
			}
		}
	} else {
		// Need to add node import
		const sugarImportMatch = src.match(/from\s*["']([^"']*core\/sugar\.js)["']/);
		if (sugarImportMatch) {
			const sugarPath = sugarImportMatch[1];
			const nodePath = sugarPath.replace("sugar.js", "node.js");
			const firstImportIdx = newSrc.indexOf("import ");
			if (firstImportIdx >= 0) {
				newSrc =
					newSrc.slice(0, firstImportIdx) +
					`import { node } from "${nodePath}";\n` +
					newSrc.slice(firstImportIdx);
			}
		}
	}

	// Clean up multiple blank lines
	newSrc = newSrc.replace(/\n{3,}/g, "\n\n");

	return newSrc;
}

const SOURCE_FILES = [
	"src/patterns/ai/_internal.ts",
	"src/patterns/ai/adapters/_internal/wrappers.ts",
	"src/patterns/ai/adapters/core/capabilities.ts",
	"src/patterns/ai/adapters/core/observable.ts",
	"src/patterns/ai/adapters/middleware/budget-gate.ts",
	"src/patterns/ai/agents/chat-stream.ts",
	"src/patterns/ai/agents/handoff.ts",
	"src/patterns/ai/agents/tool-execution.ts",
	"src/patterns/ai/agents/tool-registry.ts",
	"src/patterns/ai/agents/tool-selector.ts",
	"src/patterns/ai/extractors/cost-meter.ts",
	"src/patterns/ai/extractors/keyword-flag.ts",
	"src/patterns/ai/extractors/tool-call.ts",
	"src/patterns/ai/extractors/stream-extractor.ts",
	"src/patterns/ai/graph-integration/graph-from-spec.ts",
	"src/patterns/ai/graph-integration/suggest-strategy.ts",
	"src/patterns/ai/memory/memory-composers.ts",
	"src/patterns/ai/presets/agent-loop.ts",
	"src/patterns/ai/presets/agent-memory.ts",
	"src/patterns/ai/prompts/prompt-call.ts",
	"src/patterns/ai/prompts/prompt-node.ts",
	"src/patterns/ai/prompts/streaming.ts",
	"src/patterns/ai/prompts/system-prompt.ts",
	"src/patterns/ai/safety/content-gate.ts",
	"src/patterns/ai/safety/redactor.ts",
	"src/patterns/demo-shell/index.ts",
	"src/patterns/inspect/audit.ts",
	"src/patterns/inspect/guarded-execution.ts",
	"src/patterns/inspect/lens.ts",
	"src/patterns/reactive-layout/reactive-block-layout.ts",
	"src/patterns/reactive-layout/reactive-flow-layout.ts",
	"src/patterns/reactive-layout/reactive-layout.ts",
	"src/patterns/reduction/index.ts",
	"src/patterns/orchestration/pipeline-graph.ts",
	"src/extra/reactive-index.ts",
	"src/extra/storage-browser.ts",
	"src/extra/stratify.ts",
	"src/extra/io/index.ts",
	"src/extra/sources-fs.ts",
];

let processed = 0;
let skipped = 0;
const errors = [];

for (const relPath of SOURCE_FILES) {
	const filePath = resolve(REPO_ROOT, relPath);
	if (!existsSync(filePath)) {
		console.log(`SKIP (not found): ${relPath}`);
		skipped++;
		continue;
	}

	let src = readFileSync(filePath, "utf8");

	// Check which sugar symbols are used
	const sugarImportRe = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["'][^"']*core\/sugar\.js["']/;
	const sugarMatch = src.match(sugarImportRe);
	if (!sugarMatch) {
		console.log(`SKIP (no sugar import): ${relPath}`);
		skipped++;
		continue;
	}

	const importedSymbols = sugarMatch[1]
		.split(",")
		.map((s) => s.trim().replace(/^type\s+/, ""))
		.filter(Boolean);
	const hasState = importedSymbols.includes("state");
	const hasDerived = importedSymbols.includes("derived") || importedSymbols.includes("derivedT");
	const hasEffect = importedSymbols.includes("effect") || importedSymbols.includes("effectT");
	const hasProducer = importedSymbols.includes("producer");
	const hasDerivedFn = importedSymbols.includes("DerivedFn");
	const hasEffectFn = importedSymbols.includes("EffectFn");

	if (!hasState && !hasDerived && !hasEffect && !hasProducer && !hasDerivedFn && !hasEffectFn) {
		console.log(`SKIP (no removed symbols): ${relPath}`);
		skipped++;
		continue;
	}

	console.log(`Processing: ${relPath}`);

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
		errors.push({ file: relPath, error: e.message, stack: e.stack });
		console.error(`  ✗ ERROR: ${e.message}`);
		console.error(e.stack);
	}
}

console.log(`\nSummary: ${processed} processed, ${skipped} skipped, ${errors.length} errors`);
