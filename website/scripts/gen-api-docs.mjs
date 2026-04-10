#!/usr/bin/env node

/**
 * Generate API docs from TypeScript source JSDoc.
 *
 * Usage:
 *   node scripts/gen-api-docs.mjs                    # all registered entries
 *   node scripts/gen-api-docs.mjs node map            # specific functions
 *   node scripts/gen-api-docs.mjs --check             # dry-run, exit 1 if stale
 *
 * Reads structured JSDoc from source, outputs website/src/content/docs/api/<name>.md.
 *
 * Ported from callbag-recharge/scripts/gen-api-docs.mjs, adapted for:
 *   - GraphReFly source layout (src/core, src/extra, src/graph)
 *   - Starlight frontmatter (title, description)
 *   - Starlight-safe HTML entity escaping (no Vue/VitePress)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", ".."); // graphrefly-ts root
const OUT_DIR = resolve(__dirname, "..", "src", "content", "docs", "api");

// ─── Registry: map function names to source files ───────────────────────────

const REGISTRY = {
	// Core — node primitive + sugar constructors
	node: "src/core/node.ts",
	state: "src/core/sugar.ts",
	producer: "src/core/sugar.ts",
	derived: "src/core/sugar.ts",
	effect: "src/core/sugar.ts",
	pipe: "src/core/sugar.ts",

	// Core — timer
	ResettableTimer: "src/core/timer.ts",

	// Core — batch
	batch: "src/core/batch.ts",
	isBatching: "src/core/batch.ts",
	partitionForBatch: "src/core/batch.ts",
	downWithBatch: "src/core/batch.ts",
	dynamicNode: "src/core/dynamic-node.ts",

	// Core — guard
	policy: "src/core/guard.ts",
	GuardDenied: "src/core/guard.ts",
	accessHintForGuard: "src/core/guard.ts",

	// Extra — operators
	map: "src/extra/operators.ts",
	filter: "src/extra/operators.ts",
	scan: "src/extra/operators.ts",
	reduce: "src/extra/operators.ts",
	take: "src/extra/operators.ts",
	skip: "src/extra/operators.ts",
	takeWhile: "src/extra/operators.ts",
	takeUntil: "src/extra/operators.ts",
	first: "src/extra/operators.ts",
	last: "src/extra/operators.ts",
	find: "src/extra/operators.ts",
	elementAt: "src/extra/operators.ts",
	tap: "src/extra/operators.ts",
	distinctUntilChanged: "src/extra/operators.ts",
	pairwise: "src/extra/operators.ts",
	combine: "src/extra/operators.ts",
	withLatestFrom: "src/extra/operators.ts",
	merge: "src/extra/operators.ts",
	zip: "src/extra/operators.ts",
	concat: "src/extra/operators.ts",
	race: "src/extra/operators.ts",
	switchMap: "src/extra/operators.ts",
	exhaustMap: "src/extra/operators.ts",
	concatMap: "src/extra/operators.ts",
	mergeMap: "src/extra/operators.ts",
	delay: "src/extra/operators.ts",
	debounce: "src/extra/operators.ts",
	throttle: "src/extra/operators.ts",
	sample: "src/extra/operators.ts",
	audit: "src/extra/operators.ts",
	timeout: "src/extra/operators.ts",
	buffer: "src/extra/operators.ts",
	bufferCount: "src/extra/operators.ts",
	bufferTime: "src/extra/operators.ts",
	window: "src/extra/operators.ts",
	windowCount: "src/extra/operators.ts",
	windowTime: "src/extra/operators.ts",
	interval: "src/extra/operators.ts",
	repeat: "src/extra/operators.ts",
	pausable: "src/extra/operators.ts",
	rescue: "src/extra/operators.ts",
	flatMap: "src/extra/operators.ts",
	combineLatest: "src/extra/operators.ts",
	debounceTime: "src/extra/operators.ts",
	throttleTime: "src/extra/operators.ts",
	catchError: "src/extra/operators.ts",

	// Extra — backoff + resilience + checkpoint (roadmap §3.1)
	constant: "src/extra/backoff.ts",
	linear: "src/extra/backoff.ts",
	exponential: "src/extra/backoff.ts",
	fibonacci: "src/extra/backoff.ts",
	decorrelatedJitter: "src/extra/backoff.ts",
	withMaxAttempts: "src/extra/backoff.ts",
	resolveBackoffPreset: "src/extra/backoff.ts",
	retry: "src/extra/resilience.ts",
	circuitBreaker: "src/extra/resilience.ts",
	CircuitOpenError: "src/extra/resilience.ts",
	tokenBucket: "src/extra/resilience.ts",
	tokenTracker: "src/extra/resilience.ts",
	rateLimiter: "src/extra/resilience.ts",
	withBreaker: "src/extra/resilience.ts",
	withStatus: "src/extra/resilience.ts",
	MemoryCheckpointAdapter: "src/extra/checkpoint.ts",
	DictCheckpointAdapter: "src/extra/checkpoint.ts",
	FileCheckpointAdapter: "src/extra/checkpoint.ts",
	SqliteCheckpointAdapter: "src/extra/checkpoint.ts",
	saveGraphCheckpoint: "src/extra/checkpoint.ts",
	restoreGraphCheckpoint: "src/extra/checkpoint.ts",
	checkpointNodeValue: "src/extra/checkpoint.ts",
	saveGraphCheckpointIndexedDb: "src/extra/checkpoint.ts",
	restoreGraphCheckpointIndexedDb: "src/extra/checkpoint.ts",
	fromIDBRequest: "src/extra/checkpoint.ts",
	fromIDBTransaction: "src/extra/checkpoint.ts",

	// Extra — data structures (roadmap §3.2)
	reactiveMap: "src/extra/reactive-map.ts",
	reactiveLog: "src/extra/reactive-log.ts",
	logSlice: "src/extra/reactive-log.ts",
	reactiveIndex: "src/extra/reactive-index.ts",
	reactiveList: "src/extra/reactive-list.ts",
	pubsub: "src/extra/pubsub.ts",

	// Extra — cron
	parseCron: "src/extra/cron.ts",
	matchesCron: "src/extra/cron.ts",

	// Extra — sources
	fromTimer: "src/extra/sources.ts",
	fromCron: "src/extra/sources.ts",
	fromPromise: "src/extra/sources.ts",
	fromIter: "src/extra/sources.ts",
	fromAsyncIter: "src/extra/sources.ts",
	of: "src/extra/sources.ts",
	empty: "src/extra/sources.ts",
	never: "src/extra/sources.ts",
	throwError: "src/extra/sources.ts",
	cached: "src/extra/sources.ts",
	replay: "src/extra/sources.ts",
	share: "src/extra/sources.ts",
	fromEvent: "src/extra/sources.ts",
	fromWebhook: "src/extra/adapters.ts",
	fromAny: "src/extra/sources.ts",
	forEach: "src/extra/sources.ts",
	toArray: "src/extra/sources.ts",
	firstValueFrom: "src/extra/sources.ts",
	shareReplay: "src/extra/sources.ts",

	// Extra — composite (roadmap §3.2b)
	verifiable: "src/extra/composite.ts",
	distill: "src/extra/composite.ts",

	// Extra — backpressure (roadmap §5.1)
	createWatermarkController: "src/extra/backpressure.ts",

	// Extra — observable (RxJS interop)
	toObservable: "src/extra/observable.ts",

	// Patterns — reactive layout (roadmap §7.1)
	reactiveLayout: "src/patterns/reactive-layout/reactive-layout.ts",
	analyzeAndMeasure: "src/patterns/reactive-layout/reactive-layout.ts",
	computeLineBreaks: "src/patterns/reactive-layout/reactive-layout.ts",
	computeCharPositions: "src/patterns/reactive-layout/reactive-layout.ts",
	reactiveBlockLayout: "src/patterns/reactive-layout/reactive-block-layout.ts",

	// Extra — worker bridge (roadmap §5.3)
	workerBridge: "src/extra/worker/bridge.ts",
	workerSelf: "src/extra/worker/self.ts",
	createTransport: "src/extra/worker/transport.ts",

	// Patterns — reduction (roadmap §8.1)
	stratify: "src/patterns/reduction.ts",
	funnel: "src/patterns/reduction.ts",
	feedback: "src/patterns/reduction.ts",
	budgetGate: "src/patterns/reduction.ts",
	scorer: "src/patterns/reduction.ts",

	// Patterns — graphspec (roadmap §8.3)
	validateSpec: "src/patterns/graphspec.ts",
	compileSpec: "src/patterns/graphspec.ts",
	decompileGraph: "src/patterns/graphspec.ts",
	llmCompose: "src/patterns/graphspec.ts",
	llmRefine: "src/patterns/graphspec.ts",
	specDiff: "src/patterns/graphspec.ts",

	// Graph container
	Graph: "src/graph/graph.ts",
	reachable: "src/graph/graph.ts",
};

// ─── TypeScript parsing ─────────────────────────────────────────────────────

function parseSource(filePath) {
	const absPath = resolve(ROOT, filePath);
	const source = readFileSync(absPath, "utf-8");
	const sourceFile = ts.createSourceFile(absPath, source, ts.ScriptTarget.Latest, true);
	return { sourceFile, source };
}

/**
 * Find the exported function declaration (or overload signatures)
 * for a given function name.
 */
function findExportedFunction(sourceFile, name) {
	let fn = null;
	const overloads = [];

	ts.forEachChild(sourceFile, (node) => {
		if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
			const isExported =
				node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
			if (isExported) {
				if (node.body) {
					fn = node; // implementation
				} else {
					overloads.push(node); // overload signature
				}
			}
		}
	});

	return { implementation: fn, overloads };
}

/**
 * Find an exported class declaration.
 */
function findExportedClass(sourceFile, name) {
	let cls = null;
	ts.forEachChild(sourceFile, (node) => {
		if (ts.isClassDeclaration(node) && node.name?.text === name) {
			cls = node;
		}
	});
	return cls;
}

/**
 * `export const foo = bar` where `bar` is an identifier — reuse `bar`'s signature for docs.
 */
function findExportedConstAlias(sourceFile, name) {
	let hit = null;
	function walk(node) {
		if (hit != null) return;
		if (ts.isVariableStatement(node)) {
			const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
			if (isExported) {
				for (const d of node.declarationList.declarations) {
					if (!ts.isIdentifier(d.name) || d.name.text !== name) continue;
					const init = d.initializer;
					if (init && ts.isIdentifier(init)) {
						hit = { statement: node, declaration: d, targetName: init.text };
						return;
					}
				}
			}
		}
		ts.forEachChild(node, walk);
	}
	walk(sourceFile);
	return hit;
}

// ─── JSDoc extraction ───────────────────────────────────────────────────────

/**
 * Turn TypeScript-parsed JSDoc comment parts into plain text.
 * `{@link Foo}` is stored as link nodes with empty `.text` in some positions; joining `.text`
 * only produced broken markdown ("Creates a reactive —").
 */
function flattenJSDocComment(comment) {
	if (comment == null) return "";
	if (typeof comment === "string") return comment;
	if (!Array.isArray(comment)) return "";
	const parts = [];
	for (const c of comment) {
		if (typeof c === "string") {
			parts.push(c);
		} else if (c.kind === ts.SyntaxKind.JSDocText) {
			parts.push(c.text);
		} else if (
			c.kind === ts.SyntaxKind.JSDocLink ||
			c.kind === ts.SyntaxKind.JSDocLinkCode ||
			c.kind === ts.SyntaxKind.JSDocLinkPlain
		) {
			const tail = (c.text ?? "").trim();
			if (tail.length > 0) parts.push(tail);
			else if (c.name) parts.push(c.name.getText());
		}
	}
	return parts.join("");
}

function getJSDoc(node) {
	const jsDocs = node.jsDoc;
	if (!jsDocs || jsDocs.length === 0) return null;
	return jsDocs[jsDocs.length - 1];
}

/**
 * Re-indent code that lost its indentation from JSDoc * stripping.
 */
function reindentCode(code) {
	const lines = code.split("\n");
	const result = [];
	let depth = 0;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) {
			result.push("");
			continue;
		}
		if (/^[}\])]/.test(trimmed)) {
			depth = Math.max(0, depth - 1);
		}
		result.push("  ".repeat(depth) + trimmed);
		const opens = (trimmed.match(/[{([\[]/g) || []).length;
		const closes = (trimmed.match(/[})\]]/g) || []).length;
		depth += opens - closes;
		if (depth < 0) depth = 0;
	}

	while (result.length > 0 && result[result.length - 1] === "") result.pop();
	return result.join("\n");
}

function extractJSDocData(jsDoc) {
	const result = {
		description: "",
		params: [],
		returns: "",
		remarks: [],
		examples: [],
		seeAlso: [],
		optionsType: "",
		optionsRows: [],
		returnsTable: [],
		category: "",
	};
	if (!jsDoc) return result;

	if (jsDoc.comment) {
		result.description = flattenJSDocComment(jsDoc.comment);
	}

	if (!jsDoc.tags) return result;

	for (const tag of jsDoc.tags) {
		const tagName = tag.tagName.text;
		const comment = flattenJSDocComment(tag.comment);

		switch (tagName) {
			case "param": {
				const name = tag.name?.getText() || "";
				const desc = comment.trim().replace(/^-\s*/, "");
				result.params.push({ name, description: desc });
				break;
			}
			case "returns":
			case "return":
				result.returns = comment.trim();
				break;
			case "remarks":
				result.remarks.push(comment.trim());
				break;
			case "example": {
				const raw = comment.trim();
				const codeMatch = raw.match(/^([\s\S]*?)```(\w*)\n([\s\S]*?)```\s*$/);
				if (codeMatch) {
					const title = codeMatch[1].trim();
					const lang = codeMatch[2] || "ts";
					const code = codeMatch[3];
					const reindented = reindentCode(code);
					result.examples.push({ title, lang, code: reindented });
				} else {
					result.examples.push({ title: "", lang: "ts", code: raw });
				}
				break;
			}
			case "seeAlso":
				result.seeAlso = comment
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean);
				break;
			case "optionsType":
				result.optionsType = comment.trim();
				break;
			case "option": {
				const parts = comment.split("|").map((s) => s.trim());
				if (parts.length >= 4) {
					result.optionsRows.push({
						property: parts[0],
						type: parts[1],
						default: parts[2],
						description: parts[3],
					});
				}
				break;
			}
			case "returnsTable":
				for (const line of comment.split("\n")) {
					const parts = line.split("|").map((s) => s.trim());
					if (parts.length >= 3) {
						result.returnsTable.push({
							method: parts[0],
							signature: parts[1],
							description: parts[2],
						});
					}
				}
				break;
			case "category":
				result.category = comment.trim();
				break;
		}
	}

	return result;
}

// ─── Signature extraction ───────────────────────────────────────────────────

function getSignatureText(node, source) {
	const start = node.getStart();
	const bodyStart = node.body ? node.body.getStart() : node.getEnd();
	let sig = source.substring(start, bodyStart).trim();
	sig = sig.replace(/^export\s+/, "");
	sig = sig.replace(/\s*\{?\s*$/, "");
	return sig;
}

function getOverloadSignatures(overloads, source) {
	return overloads.map((o) => {
		let sig = source.substring(o.getStart(), o.getEnd()).trim();
		sig = sig.replace(/^export\s+/, "");
		sig = sig.replace(/;$/, "");
		return sig;
	});
}

// ─── Parameter table from function params ───────────────────────────────────

function extractParams(node, jsdocParams, source) {
	const params = [];
	if (!node.parameters) return params;

	for (const p of node.parameters) {
		const name = p.name.getText();
		if (name === "...ops") continue;

		const typeText = p.type ? source.substring(p.type.getStart(), p.type.getEnd()) : "unknown";
		const isOptional = !!p.questionToken || !!p.initializer;

		const jsdoc = jsdocParams.find((jp) => jp.name === name);
		const description = jsdoc?.description || "";

		params.push({ name, type: typeText, description, optional: isOptional });
	}

	return params;
}

// ─── Markdown helpers ───────────────────────────────────────────────────────

function escapeHtml(str) {
	return str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Markdown generation ────────────────────────────────────────────────────

function generateMarkdown(name, data) {
	const lines = [];

	// Starlight frontmatter
	const title = `${name}()`;
	const desc = data.description ? data.description.slice(0, 160) : `API reference for ${name}.`;
	lines.push("---");
	lines.push(`title: ${JSON.stringify(title)}`);
	lines.push(`description: ${JSON.stringify(desc)}`);
	lines.push("---");
	lines.push("");

	// Description
	if (data.description) {
		lines.push(escapeHtml(data.description));
		lines.push("");
	}

	// Signature
	lines.push("## Signature");
	lines.push("");
	lines.push("```ts");
	for (const sig of data.signatures) {
		lines.push(sig);
	}
	lines.push("```");
	lines.push("");

	// Parameters
	if (data.params.length > 0) {
		lines.push("## Parameters");
		lines.push("");
		lines.push("| Parameter | Type | Description |");
		lines.push("|-----------|------|-------------|");
		for (const p of data.params) {
			const typeStr = `\`${escapeHtml(p.type)}\``;
			lines.push(`| \`${escapeHtml(p.name)}\` | ${typeStr} | ${escapeHtml(p.description)} |`);
		}
		lines.push("");
	}

	// Options type expansion
	if (data.optionsRows && data.optionsRows.length > 0) {
		lines.push(`### ${data.optionsTypeName}`);
		lines.push("");
		lines.push("| Property | Type | Default | Description |");
		lines.push("|----------|------|---------|-------------|");
		for (const row of data.optionsRows) {
			lines.push(
				`| \`${escapeHtml(row.property)}\` | \`${escapeHtml(row.type)}\` | \`${escapeHtml(row.default)}\` | ${escapeHtml(row.description)} |`,
			);
		}
		lines.push("");
	}

	// Returns
	if (data.returns) {
		lines.push("## Returns");
		lines.push("");
		lines.push(escapeHtml(data.returns));
		lines.push("");
	}

	// Returns table
	if (data.returnsTable && data.returnsTable.length > 0) {
		lines.push("| Method | Signature | Description |");
		lines.push("|--------|-----------|-------------|");
		for (const row of data.returnsTable) {
			lines.push(
				`| \`${escapeHtml(row.method)}\` | \`${escapeHtml(row.signature)}\` | ${escapeHtml(row.description)} |`,
			);
		}
		lines.push("");
	}

	// Basic Usage (first example)
	if (data.examples.length > 0) {
		const first = data.examples[0];
		lines.push("## Basic Usage");
		lines.push("");
		lines.push(`\`\`\`${first.lang}`);
		lines.push(first.code);
		lines.push("```");
		lines.push("");
	}

	// Behavior details
	if (data.remarks.length > 0) {
		lines.push("## Behavior Details");
		lines.push("");
		for (const r of data.remarks) {
			lines.push(`- ${r}`);
		}
		lines.push("");
	}

	// Additional examples
	if (data.examples.length > 1) {
		lines.push("## Examples");
		lines.push("");
		for (let i = 1; i < data.examples.length; i++) {
			const ex = data.examples[i];
			const exTitle = ex.title || `Example ${i + 1}`;
			lines.push(`### ${exTitle}`);
			lines.push("");
			lines.push(`\`\`\`${ex.lang}`);
			lines.push(ex.code);
			lines.push("```");
			lines.push("");
		}
	}

	// See Also
	if (data.seeAlso.length > 0) {
		lines.push("## See Also");
		lines.push("");
		for (const link of data.seeAlso) {
			lines.push(`- ${link}`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

// ─── Main pipeline ──────────────────────────────────────────────────────────

function processFunction(name, filePath) {
	const { sourceFile, source } = parseSource(filePath);
	let { implementation, overloads } = findExportedFunction(sourceFile, name);
	let alias = null;
	if (!implementation && overloads.length === 0) {
		alias = findExportedConstAlias(sourceFile, name);
		if (alias) {
			const inner = findExportedFunction(sourceFile, alias.targetName);
			implementation = inner.implementation;
			overloads = inner.overloads;
		}
	}

	const primaryNode = implementation || overloads[overloads.length - 1];
	if (!primaryNode) {
		// Try as a class (e.g., Graph)
		const cls = findExportedClass(sourceFile, name);
		if (cls) {
			const jsDoc = getJSDoc(cls);
			const jsdocData = extractJSDocData(jsDoc);
			return {
				name,
				description: jsdocData.description,
				signatures: [`class ${name}`],
				params: [],
				returns: jsdocData.returns,
				returnsTable: jsdocData.returnsTable,
				remarks: jsdocData.remarks,
				examples: jsdocData.examples,
				seeAlso: jsdocData.seeAlso,
				optionsRows: jsdocData.optionsRows || [],
				optionsTypeName: jsdocData.optionsType,
			};
		}
		console.error(`  ⚠ No exported function or class '${name}' found in ${filePath}`);
		return null;
	}

	const implJsDoc = getJSDoc(primaryNode);
	const implDoc = extractJSDocData(implJsDoc);
	let jsdocData = implDoc;
	if (alias) {
		const aliasJs = getJSDoc(alias.declaration) ?? getJSDoc(alias.statement);
		const aliasDoc = extractJSDocData(aliasJs);
		jsdocData = {
			description: aliasDoc.description || implDoc.description,
			params: implDoc.params,
			returns: aliasDoc.returns || implDoc.returns,
			remarks: aliasDoc.remarks.length > 0 ? aliasDoc.remarks : implDoc.remarks,
			examples: aliasDoc.examples.length > 0 ? aliasDoc.examples : implDoc.examples,
			seeAlso: aliasDoc.seeAlso.length > 0 ? aliasDoc.seeAlso : implDoc.seeAlso,
			optionsRows: implDoc.optionsRows,
			optionsType: implDoc.optionsType,
			returnsTable: implDoc.returnsTable,
			category: aliasDoc.category || implDoc.category,
		};
	}

	let signatures;
	if (overloads.length > 0) {
		signatures = getOverloadSignatures(overloads, source);
	} else {
		signatures = [getSignatureText(primaryNode, source)];
	}

	const paramNode = implementation || overloads[overloads.length - 1];
	const params = extractParams(paramNode, jsdocData.params ?? [], source);

	return {
		name,
		description: jsdocData.description,
		signatures,
		params,
		returns: jsdocData.returns,
		returnsTable: jsdocData.returnsTable,
		remarks: jsdocData.remarks,
		examples: jsdocData.examples,
		seeAlso: jsdocData.seeAlso,
		optionsRows: jsdocData.optionsRows || [],
		optionsTypeName: jsdocData.optionsType,
	};
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const checkMode = args.includes("--check");
const targets = args.filter((a) => !a.startsWith("--"));

const entries =
	targets.length > 0
		? targets.map((t) => [t, REGISTRY[t]]).filter(([, v]) => v)
		: Object.entries(REGISTRY);

mkdirSync(OUT_DIR, { recursive: true });

let stale = 0;

for (const [name, filePath] of entries) {
	const data = processFunction(name, filePath);
	if (!data) continue;

	const md = generateMarkdown(name, data);
	const outPath = resolve(OUT_DIR, `${name}.md`);

	if (checkMode) {
		if (existsSync(outPath)) {
			const existing = readFileSync(outPath, "utf-8");
			if (existing !== md) {
				console.log(`  ⚠ ${name}.md is stale`);
				stale++;
			} else {
				console.log(`  ✓ ${name}.md is up to date`);
			}
		} else {
			console.log(`  ⚠ ${name}.md does not exist`);
			stale++;
		}
	} else {
		writeFileSync(outPath, md);
		console.log(`  ✓ wrote ${name}.md`);
	}
}

if (checkMode && stale > 0) {
	console.log(`\n${stale} file(s) stale. Run 'node scripts/gen-api-docs.mjs' to regenerate.`);
	process.exit(1);
}

if (!checkMode) {
	console.log(`\n[gen-api-docs] done. ${entries.length} entries processed.`);
}
