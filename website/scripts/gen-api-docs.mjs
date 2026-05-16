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
 *   - GraphReFly source layout (packages/pure-ts/src/core, packages/pure-ts/src/extra, packages/pure-ts/src/graph)
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
	node: "packages/pure-ts/src/core/node.ts",
	pipe: "packages/pure-ts/src/core/sugar.ts",

	// Extra — timer
	ResettableTimer: "packages/pure-ts/src/core/_internal/timer.ts",

	// Core — batch
	batch: "packages/pure-ts/src/core/batch.ts",
	isBatching: "packages/pure-ts/src/core/batch.ts",
	downWithBatch: "packages/pure-ts/src/core/batch.ts",

	// Core — guard
	policy: "packages/pure-ts/src/core/guard.ts",
	GuardDenied: "packages/pure-ts/src/core/guard.ts",
	accessHintForGuard: "packages/pure-ts/src/core/guard.ts",

	// Extra — operators
	map: "packages/pure-ts/src/extra/operators/transform.ts",
	filter: "packages/pure-ts/src/extra/operators/transform.ts",
	scan: "packages/pure-ts/src/extra/operators/transform.ts",
	reduce: "packages/pure-ts/src/extra/operators/transform.ts",
	take: "packages/pure-ts/src/extra/operators/take.ts",
	skip: "packages/pure-ts/src/extra/operators/take.ts",
	takeWhile: "packages/pure-ts/src/extra/operators/take.ts",
	takeUntil: "packages/pure-ts/src/extra/operators/take.ts",
	first: "packages/pure-ts/src/extra/operators/take.ts",
	last: "packages/pure-ts/src/extra/operators/take.ts",
	find: "packages/pure-ts/src/extra/operators/take.ts",
	elementAt: "packages/pure-ts/src/extra/operators/take.ts",
	tap: "packages/pure-ts/src/extra/operators/control.ts",
	distinctUntilChanged: "packages/pure-ts/src/extra/operators/transform.ts",
	pairwise: "packages/pure-ts/src/extra/operators/transform.ts",
	combine: "packages/pure-ts/src/extra/operators/combine.ts",
	withLatestFrom: "packages/pure-ts/src/extra/operators/combine.ts",
	merge: "packages/pure-ts/src/extra/operators/combine.ts",
	zip: "packages/pure-ts/src/extra/operators/combine.ts",
	concat: "packages/pure-ts/src/extra/operators/combine.ts",
	race: "packages/pure-ts/src/extra/operators/combine.ts",
	switchMap: "packages/pure-ts/src/extra/operators/higher-order.ts",
	exhaustMap: "packages/pure-ts/src/extra/operators/higher-order.ts",
	concatMap: "packages/pure-ts/src/extra/operators/higher-order.ts",
	mergeMap: "packages/pure-ts/src/extra/operators/higher-order.ts",
	delay: "packages/pure-ts/src/extra/operators/time.ts",
	debounce: "packages/pure-ts/src/extra/operators/time.ts",
	throttle: "packages/pure-ts/src/extra/operators/time.ts",
	sample: "packages/pure-ts/src/extra/operators/time.ts",
	audit: "packages/pure-ts/src/extra/operators/time.ts",
	timeout: "packages/pure-ts/src/extra/operators/control.ts",
	buffer: "packages/pure-ts/src/extra/operators/buffer.ts",
	bufferCount: "packages/pure-ts/src/extra/operators/buffer.ts",
	bufferTime: "packages/pure-ts/src/extra/operators/buffer.ts",
	window: "packages/pure-ts/src/extra/operators/buffer.ts",
	windowCount: "packages/pure-ts/src/extra/operators/buffer.ts",
	windowTime: "packages/pure-ts/src/extra/operators/buffer.ts",
	interval: "packages/pure-ts/src/extra/operators/time.ts",
	repeat: "packages/pure-ts/src/extra/operators/control.ts",
	pausable: "packages/pure-ts/src/extra/operators/control.ts",
	rescue: "packages/pure-ts/src/extra/operators/control.ts",
	flatMap: "packages/pure-ts/src/extra/operators/higher-order.ts",
	combineLatest: "packages/pure-ts/src/extra/operators/combine.ts",
	debounceTime: "packages/pure-ts/src/extra/operators/time.ts",
	throttleTime: "packages/pure-ts/src/extra/operators/time.ts",
	catchError: "packages/pure-ts/src/extra/operators/control.ts",

	// Extra — backoff + resilience + checkpoint (roadmap §3.1)
	constant: "src/base/resilience/backoff.ts",
	linear: "src/base/resilience/backoff.ts",
	exponential: "src/base/resilience/backoff.ts",
	fibonacci: "src/base/resilience/backoff.ts",
	decorrelatedJitter: "src/base/resilience/backoff.ts",
	withMaxAttempts: "src/base/resilience/backoff.ts",
	resolveBackoffPreset: "src/base/resilience/backoff.ts",
	retry: "src/base/resilience/retry.ts",
	circuitBreaker: "src/utils/resilience/breaker.ts",
	CircuitOpenError: "src/utils/resilience/breaker.ts",
	tokenBucket: "src/utils/resilience/rate-limiter.ts",
	tokenBucket: "src/utils/resilience/rate-limiter.ts",
	rateLimiter: "src/utils/resilience/rate-limiter.ts",
	withBreaker: "src/utils/resilience/breaker.ts",
	withStatus: "src/base/resilience/status.ts",
	// Storage tiers — three-layer backend + tier model (Audit 4, 2026-04-24).
	// Layer 1 — backends (bytes-level keyed I/O).
	memoryBackend: "packages/pure-ts/src/extra/storage/tiers.ts",
	fileBackend: "packages/pure-ts/src/extra/storage/tiers-node.ts",
	sqliteBackend: "packages/pure-ts/src/extra/storage/tiers-node.ts",
	indexedDbBackend: "packages/pure-ts/src/extra/storage/tiers-browser.ts",
	// Layer 2 — tier factories (snapshot / append-log / kv over a backend).
	snapshotStorage: "packages/pure-ts/src/extra/storage/tiers.ts",
	appendLogStorage: "packages/pure-ts/src/extra/storage/tiers.ts",
	kvStorage: "packages/pure-ts/src/extra/storage/tiers.ts",
	// Convenience tier factories.
	memorySnapshot: "packages/pure-ts/src/extra/storage/tiers.ts",
	memoryAppendLog: "packages/pure-ts/src/extra/storage/tiers.ts",
	memoryKv: "packages/pure-ts/src/extra/storage/tiers.ts",
	dictKv: "packages/pure-ts/src/extra/storage/tiers.ts",
	dictSnapshot: "packages/pure-ts/src/extra/storage/tiers.ts",
	fileSnapshot: "packages/pure-ts/src/extra/storage/tiers-node.ts",
	fileAppendLog: "packages/pure-ts/src/extra/storage/tiers-node.ts",
	fileKv: "packages/pure-ts/src/extra/storage/tiers-node.ts",
	sqliteSnapshot: "packages/pure-ts/src/extra/storage/tiers-node.ts",
	sqliteAppendLog: "packages/pure-ts/src/extra/storage/tiers-node.ts",
	sqliteKv: "packages/pure-ts/src/extra/storage/tiers-node.ts",
	indexedDbSnapshot: "packages/pure-ts/src/extra/storage/tiers-browser.ts",
	indexedDbAppendLog: "packages/pure-ts/src/extra/storage/tiers-browser.ts",
	indexedDbKv: "packages/pure-ts/src/extra/storage/tiers-browser.ts",
	// Codec helpers.
	// jsonCodec / bigintJsonCodec are `export const` object literals — not supported by the function/class parser.
	jsonCodecFor: "packages/pure-ts/src/extra/storage/tiers.ts",
	bigintJsonCodecFor: "packages/pure-ts/src/extra/storage/tiers.ts",
	// IDB reactive sources (DOM globals).
	fromIDBRequest: "src/base/sources/browser/idb.ts",
	fromIDBTransaction: "src/base/sources/browser/idb.ts",

	// Extra — data structures (roadmap §3.2)
	reactiveMap: "packages/pure-ts/src/extra/data-structures/reactive-map.ts",
	reactiveLog: "packages/pure-ts/src/extra/data-structures/reactive-log.ts",
	reactiveIndex: "packages/pure-ts/src/extra/data-structures/reactive-index.ts",
	reactiveList: "packages/pure-ts/src/extra/data-structures/reactive-list.ts",
	pubsub: "src/base/composition/pubsub.ts",

	// Extra — cron
	parseCron: "src/base/sources/event/cron.ts",
	matchesCron: "src/base/sources/event/cron.ts",

	// Extra — sources
	fromTimer: "packages/pure-ts/src/extra/sources/event/timer.ts",
	fromCron: "src/base/sources/event/cron.ts",
	fromPromise: "packages/pure-ts/src/extra/sources/async.ts",
	fromIter: "packages/pure-ts/src/extra/sources/sync/iter.ts",
	fromAsyncIter: "packages/pure-ts/src/extra/sources/async.ts",
	of: "packages/pure-ts/src/extra/sources/sync/iter.ts",
	empty: "packages/pure-ts/src/extra/sources/sync/iter.ts",
	never: "packages/pure-ts/src/extra/sources/sync/iter.ts",
	throwError: "packages/pure-ts/src/extra/sources/sync/iter.ts",
	cached: "src/base/sources/async.ts",
	replay: "src/base/sources/async.ts",
	share: "src/base/sources/async.ts",
	fromEvent: "src/base/sources/event/dom.ts",
	fromWebhook: "src/base/io/webhook.ts",
	fromAny: "packages/pure-ts/src/extra/sources/async.ts",
	forEach: "src/base/sources/async.ts",
	toArray: "src/base/sources/async.ts",
	firstValueFrom: "src/base/sources/settled.ts",
	shareReplay: "src/base/sources/async.ts",

	// Extra — composite (roadmap §3.2b)
	verifiable: "src/base/composition/verifiable.ts",
	distill: "src/base/composition/distill.ts",

	// Extra — backpressure (roadmap §5.1)
	createWatermarkController: "src/base/composition/backpressure.ts",

	// Extra — observable (RxJS interop)
	toObservable: "src/base/composition/observable.ts",

	// Patterns — reactive layout (roadmap §7.1)
	reactiveLayout: "src/utils/reactive-layout/reactive-layout.ts",
	analyzeAndMeasure: "src/utils/reactive-layout/reactive-layout.ts",
	computeLineBreaks: "src/utils/reactive-layout/reactive-layout.ts",
	computeCharPositions: "src/utils/reactive-layout/reactive-layout.ts",
	reactiveBlockLayout: "src/utils/reactive-layout/reactive-block-layout.ts",

	// Extra — worker bridge (roadmap §5.3)
	workerBridge: "src/base/worker/bridge.ts",
	workerSelf: "src/base/worker/self.ts",
	createTransport: "src/base/worker/transport.ts",

	// Patterns — reduction (roadmap §8.1)
	stratify: "packages/pure-ts/src/extra/composition/stratify.ts",
	funnel: "src/utils/reduction/index.ts",
	feedback: "src/utils/reduction/index.ts",
	budgetGate: "src/utils/resilience/budget-gate.ts",
	scorer: "src/utils/reduction/index.ts",

	// Patterns — graphspec (roadmap §8.3)
	validateSpec: "src/utils/graphspec/index.ts",
	compileSpec: "src/utils/graphspec/index.ts",
	llmCompose: "src/utils/graphspec/index.ts",
	llmRefine: "src/utils/graphspec/index.ts",
	specDiff: "src/utils/graphspec/index.ts",

	// Graph container
	Graph: "packages/pure-ts/src/graph/graph.ts",
	reachable: "packages/pure-ts/src/graph/graph.ts",
	explainPath: "packages/pure-ts/src/graph/explain.ts",
	mermaidLiveUrl: "src/base/render/graph-spec-to-mermaid-url.ts",
	validateGraphObservability: "src/base/validate-observability.ts",
	validateNoIslands: "packages/pure-ts/src/graph/validate-no-islands.ts",
	watchTopologyTree: "packages/pure-ts/src/graph/topology-tree.ts",

	// Inspect domain (Tier 9.1 γ-form γ-ii merge of audit + lens + guarded-execution)
	auditTrail: "src/utils/inspect/audit.ts",
	policyGate: "src/utils/inspect/audit.ts",
	complianceSnapshot: "src/utils/inspect/audit.ts",
	graphLens: "src/utils/inspect/lens.ts",
	guardedExecution: "src/presets/inspect/guarded-execution.ts",
	inspect: "src/presets/inspect/composite.ts",

	// Resilience preset (Tier 9.1 γ-R-2)
	resilientPipeline: "src/presets/resilience/resilient-pipeline.ts",

	// Extra — singleflight + adaptive rate limiter (roadmap §9.3d)
	singleFromAny: "src/base/composition/single-from-any.ts",
	singleNodeFromAny: "src/base/composition/single-from-any.ts",
	adaptiveRateLimiter: "src/utils/resilience/adaptive-rate-limiter.ts",

	// LLM Adapter Layer — core (roadmap §9.3d)
	createAdapter: "src/utils/ai/adapters/core/factory.ts",
	createPricingRegistry: "src/utils/ai/adapters/core/pricing.ts",
	registryPricing: "src/utils/ai/adapters/core/pricing.ts",
	composePricing: "src/utils/ai/adapters/core/pricing.ts",
	computePrice: "src/utils/ai/adapters/core/pricing.ts",
	createCapabilitiesRegistry: "src/utils/ai/adapters/core/capabilities.ts",
	observableAdapter: "src/utils/ai/adapters/core/observable.ts",

	// LLM Adapter Layer — providers
	anthropicAdapter: "src/utils/ai/adapters/providers/anthropic.ts",
	openAICompatAdapter: "src/utils/ai/adapters/providers/openai-compat.ts",
	googleAdapter: "src/utils/ai/adapters/providers/google.ts",
	dryRunAdapter: "src/utils/ai/adapters/providers/dry-run.ts",
	webllmAdapter: "src/utils/ai/adapters/providers/browser/webllm.ts",
	chromeNanoAdapter: "src/utils/ai/adapters/providers/browser/chrome-nano.ts",

	// LLM Adapter Layer — middleware
	withBudgetGate: "src/utils/ai/adapters/middleware/budget-gate.ts",
	withRateLimiter: "src/utils/ai/adapters/middleware/rate-limiter.ts",
	withReplayCache: "src/utils/ai/adapters/middleware/replay-cache.ts",
	withRetry: "src/utils/ai/adapters/middleware/retry.ts",
	withTimeout: "src/base/resilience/timeout.ts",
	withBreaker: "src/utils/resilience/breaker.ts",
	resilientAdapter: "src/utils/ai/adapters/middleware/resilient-adapter.ts",
	parseRateLimitFromError: "src/utils/ai/adapters/middleware/http429-parser.ts",
	withDryRun: "src/utils/ai/adapters/middleware/dry-run.ts",

	// LLM Adapter Layer — routing
	cascadingLlmAdapter: "src/utils/ai/adapters/routing/cascading.ts",
	cloudFirstPreset: "src/utils/ai/adapters/routing/browser-presets.ts",
	localFirstPreset: "src/utils/ai/adapters/routing/browser-presets.ts",
	offlinePreset: "src/utils/ai/adapters/routing/browser-presets.ts",

	// AI memory — agentic-memory factory + composers (roadmap §4.4)
	// Tier 9.1 γ-β: `agentMemory` and `agentLoop` physically moved to `ai/presets/`.
	agentMemory: "src/presets/ai/agent-memory.ts",
	agentLoop: "src/presets/ai/agent-loop.ts",
	memoryWithVectors: "src/utils/ai/memory/memory-composers.ts",
	memoryWithKG: "src/utils/ai/memory/memory-composers.ts",
	memoryWithTiers: "src/utils/ai/memory/memory-composers.ts",
	memoryRetrieval: "src/utils/ai/memory/memory-composers.ts",

	// extra/composition — domain-agnostic substrates (Class B audit Alt E, 2026-04-30)
	auditedSuccessTracker: "src/utils/orchestration/audited-success-tracker.ts",
	llmExtractor: "src/utils/ai/prompts/prompt-call.ts",
	llmConsolidator: "src/utils/ai/prompts/prompt-call.ts",
	promptCall: "src/utils/ai/prompts/prompt-call.ts",

	// Phase 4+ patterns: messaging (Tier 5.3, 2026-04-29)
	topic: "src/utils/messaging/index.ts",
	messagingHub: "src/utils/messaging/index.ts",
	subscription: "src/utils/messaging/index.ts",
	topicBridge: "src/utils/messaging/index.ts",

	// Phase 4+ patterns: orchestration
	pipelineGraph: "src/utils/orchestration/pipeline-graph.ts",
	decisionKeyOf: "src/utils/orchestration/pipeline-graph.ts",

	// Phase 4+ patterns: job-queue / job-flow
	jobQueue: "src/utils/job-queue/index.ts",
	jobFlow: "src/utils/job-queue/index.ts",
	jobEventKeyOf: "src/utils/job-queue/index.ts",

	// Phase 4+ patterns: cqrs
	cqrs: "src/utils/cqrs/index.ts",
	cqrsEventKeyOf: "src/utils/cqrs/index.ts",
	dispatchKeyOf: "src/utils/cqrs/index.ts",
	sagaInvocationKeyOf: "src/utils/cqrs/index.ts",

	// Phase 4+ patterns: process manager
	processManager: "src/utils/process/index.ts",
	processInstanceKeyOf: "src/utils/process/index.ts",
	processStateKeyOf: "src/utils/process/index.ts",
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
