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
	state: "packages/pure-ts/src/core/sugar.ts",
	producer: "packages/pure-ts/src/core/sugar.ts",
	derived: "packages/pure-ts/src/core/sugar.ts",
	derivedT: "packages/pure-ts/src/core/sugar.ts",
	effect: "packages/pure-ts/src/core/sugar.ts",
	effectT: "packages/pure-ts/src/core/sugar.ts",
	pipe: "packages/pure-ts/src/core/sugar.ts",

	// Extra — timer
	ResettableTimer: "packages/pure-ts/src/extra/timer.ts",

	// Core — batch
	batch: "packages/pure-ts/src/core/batch.ts",
	isBatching: "packages/pure-ts/src/core/batch.ts",
	downWithBatch: "packages/pure-ts/src/core/batch.ts",

	// Core — guard
	policy: "packages/pure-ts/src/core/guard.ts",
	GuardDenied: "packages/pure-ts/src/core/guard.ts",
	accessHintForGuard: "packages/pure-ts/src/core/guard.ts",

	// Extra — operators
	map: "packages/pure-ts/src/extra/operators.ts",
	filter: "packages/pure-ts/src/extra/operators.ts",
	scan: "packages/pure-ts/src/extra/operators.ts",
	reduce: "packages/pure-ts/src/extra/operators.ts",
	take: "packages/pure-ts/src/extra/operators.ts",
	skip: "packages/pure-ts/src/extra/operators.ts",
	takeWhile: "packages/pure-ts/src/extra/operators.ts",
	takeUntil: "packages/pure-ts/src/extra/operators.ts",
	first: "packages/pure-ts/src/extra/operators.ts",
	last: "packages/pure-ts/src/extra/operators.ts",
	find: "packages/pure-ts/src/extra/operators.ts",
	elementAt: "packages/pure-ts/src/extra/operators.ts",
	tap: "packages/pure-ts/src/extra/operators.ts",
	distinctUntilChanged: "packages/pure-ts/src/extra/operators.ts",
	pairwise: "packages/pure-ts/src/extra/operators.ts",
	combine: "packages/pure-ts/src/extra/operators.ts",
	withLatestFrom: "packages/pure-ts/src/extra/operators.ts",
	merge: "packages/pure-ts/src/extra/operators.ts",
	zip: "packages/pure-ts/src/extra/operators.ts",
	concat: "packages/pure-ts/src/extra/operators.ts",
	race: "packages/pure-ts/src/extra/operators.ts",
	switchMap: "packages/pure-ts/src/extra/operators.ts",
	exhaustMap: "packages/pure-ts/src/extra/operators.ts",
	concatMap: "packages/pure-ts/src/extra/operators.ts",
	mergeMap: "packages/pure-ts/src/extra/operators.ts",
	delay: "packages/pure-ts/src/extra/operators.ts",
	debounce: "packages/pure-ts/src/extra/operators.ts",
	throttle: "packages/pure-ts/src/extra/operators.ts",
	sample: "packages/pure-ts/src/extra/operators.ts",
	audit: "packages/pure-ts/src/extra/operators.ts",
	timeout: "packages/pure-ts/src/extra/operators.ts",
	buffer: "packages/pure-ts/src/extra/operators.ts",
	bufferCount: "packages/pure-ts/src/extra/operators.ts",
	bufferTime: "packages/pure-ts/src/extra/operators.ts",
	window: "packages/pure-ts/src/extra/operators.ts",
	windowCount: "packages/pure-ts/src/extra/operators.ts",
	windowTime: "packages/pure-ts/src/extra/operators.ts",
	interval: "packages/pure-ts/src/extra/operators.ts",
	repeat: "packages/pure-ts/src/extra/operators.ts",
	pausable: "packages/pure-ts/src/extra/operators.ts",
	rescue: "packages/pure-ts/src/extra/operators.ts",
	flatMap: "packages/pure-ts/src/extra/operators.ts",
	combineLatest: "packages/pure-ts/src/extra/operators.ts",
	debounceTime: "packages/pure-ts/src/extra/operators.ts",
	throttleTime: "packages/pure-ts/src/extra/operators.ts",
	catchError: "packages/pure-ts/src/extra/operators.ts",

	// Extra — backoff + resilience + checkpoint (roadmap §3.1)
	constant: "packages/pure-ts/src/extra/backoff.ts",
	linear: "packages/pure-ts/src/extra/backoff.ts",
	exponential: "packages/pure-ts/src/extra/backoff.ts",
	fibonacci: "packages/pure-ts/src/extra/backoff.ts",
	decorrelatedJitter: "packages/pure-ts/src/extra/backoff.ts",
	withMaxAttempts: "packages/pure-ts/src/extra/backoff.ts",
	resolveBackoffPreset: "packages/pure-ts/src/extra/backoff.ts",
	retry: "packages/pure-ts/src/extra/resilience.ts",
	circuitBreaker: "packages/pure-ts/src/extra/resilience.ts",
	CircuitOpenError: "packages/pure-ts/src/extra/resilience.ts",
	tokenBucket: "packages/pure-ts/src/extra/resilience.ts",
	tokenBucket: "packages/pure-ts/src/extra/resilience.ts",
	rateLimiter: "packages/pure-ts/src/extra/resilience.ts",
	withBreaker: "packages/pure-ts/src/extra/resilience.ts",
	withStatus: "packages/pure-ts/src/extra/resilience.ts",
	// Storage tiers — three-layer backend + tier model (Audit 4, 2026-04-24).
	// Layer 1 — backends (bytes-level keyed I/O).
	memoryBackend: "packages/pure-ts/src/extra/storage-tiers.ts",
	fileBackend: "packages/pure-ts/src/extra/storage-tiers-node.ts",
	sqliteBackend: "packages/pure-ts/src/extra/storage-tiers-node.ts",
	indexedDbBackend: "packages/pure-ts/src/extra/storage-tiers-browser.ts",
	// Layer 2 — tier factories (snapshot / append-log / kv over a backend).
	snapshotStorage: "packages/pure-ts/src/extra/storage-tiers.ts",
	appendLogStorage: "packages/pure-ts/src/extra/storage-tiers.ts",
	kvStorage: "packages/pure-ts/src/extra/storage-tiers.ts",
	// Convenience tier factories.
	memorySnapshot: "packages/pure-ts/src/extra/storage-tiers.ts",
	memoryAppendLog: "packages/pure-ts/src/extra/storage-tiers.ts",
	memoryKv: "packages/pure-ts/src/extra/storage-tiers.ts",
	dictKv: "packages/pure-ts/src/extra/storage-tiers.ts",
	dictSnapshot: "packages/pure-ts/src/extra/storage-tiers.ts",
	fileSnapshot: "packages/pure-ts/src/extra/storage-tiers-node.ts",
	fileAppendLog: "packages/pure-ts/src/extra/storage-tiers-node.ts",
	fileKv: "packages/pure-ts/src/extra/storage-tiers-node.ts",
	sqliteSnapshot: "packages/pure-ts/src/extra/storage-tiers-node.ts",
	sqliteAppendLog: "packages/pure-ts/src/extra/storage-tiers-node.ts",
	sqliteKv: "packages/pure-ts/src/extra/storage-tiers-node.ts",
	indexedDbSnapshot: "packages/pure-ts/src/extra/storage-tiers-browser.ts",
	indexedDbAppendLog: "packages/pure-ts/src/extra/storage-tiers-browser.ts",
	indexedDbKv: "packages/pure-ts/src/extra/storage-tiers-browser.ts",
	// Codec helpers.
	// jsonCodec is an `export const` object literal — not supported by the function/class parser.
	jsonCodecFor: "packages/pure-ts/src/extra/storage-tiers.ts",
	// IDB reactive sources (DOM globals).
	fromIDBRequest: "packages/pure-ts/src/extra/storage-browser.ts",
	fromIDBTransaction: "packages/pure-ts/src/extra/storage-browser.ts",

	// Extra — data structures (roadmap §3.2)
	reactiveMap: "packages/pure-ts/src/extra/reactive-map.ts",
	reactiveLog: "packages/pure-ts/src/extra/reactive-log.ts",
	reactiveIndex: "packages/pure-ts/src/extra/reactive-index.ts",
	reactiveList: "packages/pure-ts/src/extra/reactive-list.ts",
	pubsub: "packages/pure-ts/src/extra/pubsub.ts",

	// Extra — cron
	parseCron: "packages/pure-ts/src/extra/cron.ts",
	matchesCron: "packages/pure-ts/src/extra/cron.ts",

	// Extra — sources
	fromTimer: "packages/pure-ts/src/extra/sources.ts",
	fromCron: "packages/pure-ts/src/extra/sources.ts",
	fromPromise: "packages/pure-ts/src/extra/sources.ts",
	fromIter: "packages/pure-ts/src/extra/sources.ts",
	fromAsyncIter: "packages/pure-ts/src/extra/sources.ts",
	of: "packages/pure-ts/src/extra/sources.ts",
	empty: "packages/pure-ts/src/extra/sources.ts",
	never: "packages/pure-ts/src/extra/sources.ts",
	throwError: "packages/pure-ts/src/extra/sources.ts",
	cached: "packages/pure-ts/src/extra/sources.ts",
	replay: "packages/pure-ts/src/extra/sources.ts",
	share: "packages/pure-ts/src/extra/sources.ts",
	fromEvent: "packages/pure-ts/src/extra/sources.ts",
	fromWebhook: "packages/pure-ts/src/extra/adapters.ts",
	fromAny: "packages/pure-ts/src/extra/sources.ts",
	forEach: "packages/pure-ts/src/extra/sources.ts",
	toArray: "packages/pure-ts/src/extra/sources.ts",
	firstValueFrom: "packages/pure-ts/src/extra/sources.ts",
	shareReplay: "packages/pure-ts/src/extra/sources.ts",

	// Extra — composite (roadmap §3.2b)
	verifiable: "packages/pure-ts/src/extra/composite.ts",
	distill: "packages/pure-ts/src/extra/composite.ts",

	// Extra — backpressure (roadmap §5.1)
	createWatermarkController: "packages/pure-ts/src/extra/backpressure.ts",

	// Extra — observable (RxJS interop)
	toObservable: "packages/pure-ts/src/extra/observable.ts",

	// Patterns — reactive layout (roadmap §7.1)
	reactiveLayout: "packages/pure-ts/src/patterns/reactive-layout/reactive-layout.ts",
	analyzeAndMeasure: "packages/pure-ts/src/patterns/reactive-layout/reactive-layout.ts",
	computeLineBreaks: "packages/pure-ts/src/patterns/reactive-layout/reactive-layout.ts",
	computeCharPositions: "packages/pure-ts/src/patterns/reactive-layout/reactive-layout.ts",
	reactiveBlockLayout: "packages/pure-ts/src/patterns/reactive-layout/reactive-block-layout.ts",

	// Extra — worker bridge (roadmap §5.3)
	workerBridge: "packages/pure-ts/src/extra/worker/bridge.ts",
	workerSelf: "packages/pure-ts/src/extra/worker/self.ts",
	createTransport: "packages/pure-ts/src/extra/worker/transport.ts",

	// Patterns — reduction (roadmap §8.1)
	stratify: "packages/pure-ts/src/extra/stratify.ts",
	funnel: "packages/pure-ts/src/patterns/reduction/index.ts",
	feedback: "packages/pure-ts/src/patterns/reduction/index.ts",
	budgetGate: "packages/pure-ts/src/patterns/reduction/index.ts",
	scorer: "packages/pure-ts/src/patterns/reduction/index.ts",

	// Patterns — graphspec (roadmap §8.3)
	validateSpec: "packages/pure-ts/src/patterns/graphspec/index.ts",
	compileSpec: "packages/pure-ts/src/patterns/graphspec/index.ts",
	decompileGraph: "packages/pure-ts/src/patterns/graphspec/index.ts",
	llmCompose: "packages/pure-ts/src/patterns/graphspec/index.ts",
	llmRefine: "packages/pure-ts/src/patterns/graphspec/index.ts",
	specDiff: "packages/pure-ts/src/patterns/graphspec/index.ts",

	// Graph container
	Graph: "packages/pure-ts/src/graph/graph.ts",
	reachable: "packages/pure-ts/src/graph/graph.ts",
	explainPath: "packages/pure-ts/src/graph/explain.ts",
	mermaidLiveUrl: "packages/pure-ts/src/extra/render/graph-spec-to-mermaid-url.ts",
	validateGraphObservability: "packages/pure-ts/src/graph/validate-observability.ts",
	validateNoIslands: "packages/pure-ts/src/graph/validate-no-islands.ts",
	watchTopologyTree: "packages/pure-ts/src/graph/topology-tree.ts",

	// Inspect domain (Tier 9.1 γ-form γ-ii merge of audit + lens + guarded-execution)
	auditTrail: "packages/pure-ts/src/patterns/inspect/audit.ts",
	policyGate: "packages/pure-ts/src/patterns/inspect/audit.ts",
	complianceSnapshot: "packages/pure-ts/src/patterns/inspect/audit.ts",
	graphLens: "packages/pure-ts/src/patterns/inspect/lens.ts",
	guardedExecution: "packages/pure-ts/src/patterns/inspect/guarded-execution.ts",
	inspect: "packages/pure-ts/src/patterns/inspect/presets/inspect.ts",

	// Resilience preset (Tier 9.1 γ-R-2)
	resilientPipeline: "packages/pure-ts/src/extra/resilience/resilient-pipeline.ts",

	// Extra — singleflight + adaptive rate limiter (roadmap §9.3d)
	singleFromAny: "packages/pure-ts/src/extra/single-from-any.ts",
	singleNodeFromAny: "packages/pure-ts/src/extra/single-from-any.ts",
	adaptiveRateLimiter: "packages/pure-ts/src/extra/adaptive-rate-limiter.ts",

	// LLM Adapter Layer — core (roadmap §9.3d)
	createAdapter: "packages/pure-ts/src/patterns/ai/adapters/core/factory.ts",
	createPricingRegistry: "packages/pure-ts/src/patterns/ai/adapters/core/pricing.ts",
	registryPricing: "packages/pure-ts/src/patterns/ai/adapters/core/pricing.ts",
	composePricing: "packages/pure-ts/src/patterns/ai/adapters/core/pricing.ts",
	computePrice: "packages/pure-ts/src/patterns/ai/adapters/core/pricing.ts",
	createCapabilitiesRegistry: "packages/pure-ts/src/patterns/ai/adapters/core/capabilities.ts",
	observableAdapter: "packages/pure-ts/src/patterns/ai/adapters/core/observable.ts",

	// LLM Adapter Layer — providers
	anthropicAdapter: "packages/pure-ts/src/patterns/ai/adapters/providers/anthropic.ts",
	openAICompatAdapter: "packages/pure-ts/src/patterns/ai/adapters/providers/openai-compat.ts",
	googleAdapter: "packages/pure-ts/src/patterns/ai/adapters/providers/google.ts",
	dryRunAdapter: "packages/pure-ts/src/patterns/ai/adapters/providers/dry-run.ts",
	webllmAdapter: "packages/pure-ts/src/patterns/ai/adapters/providers/browser/webllm.ts",
	chromeNanoAdapter: "packages/pure-ts/src/patterns/ai/adapters/providers/browser/chrome-nano.ts",

	// LLM Adapter Layer — middleware
	withBudgetGate: "packages/pure-ts/src/patterns/ai/adapters/middleware/budget-gate.ts",
	withRateLimiter: "packages/pure-ts/src/patterns/ai/adapters/middleware/rate-limiter.ts",
	withReplayCache: "packages/pure-ts/src/patterns/ai/adapters/middleware/replay-cache.ts",
	withRetry: "packages/pure-ts/src/patterns/ai/adapters/middleware/retry.ts",
	withTimeout: "packages/pure-ts/src/patterns/ai/adapters/middleware/timeout.ts",
	withBreaker: "packages/pure-ts/src/patterns/ai/adapters/middleware/breaker.ts",
	resilientAdapter: "packages/pure-ts/src/patterns/ai/adapters/middleware/resilient-adapter.ts",
	parseRateLimitFromError: "packages/pure-ts/src/patterns/ai/adapters/middleware/http429-parser.ts",
	withDryRun: "packages/pure-ts/src/patterns/ai/adapters/middleware/dry-run.ts",

	// LLM Adapter Layer — routing
	cascadingLlmAdapter: "packages/pure-ts/src/patterns/ai/adapters/routing/cascading.ts",
	cloudFirstPreset: "packages/pure-ts/src/patterns/ai/adapters/routing/browser-presets.ts",
	localFirstPreset: "packages/pure-ts/src/patterns/ai/adapters/routing/browser-presets.ts",
	offlinePreset: "packages/pure-ts/src/patterns/ai/adapters/routing/browser-presets.ts",

	// AI memory — agentic-memory factory + composers (roadmap §4.4)
	// Tier 9.1 γ-β: `agentMemory` and `agentLoop` physically moved to `ai/presets/`.
	agentMemory: "packages/pure-ts/src/patterns/ai/presets/agent-memory.ts",
	agentLoop: "packages/pure-ts/src/patterns/ai/presets/agent-loop.ts",
	memoryWithVectors: "packages/pure-ts/src/patterns/ai/memory/memory-composers.ts",
	memoryWithKG: "packages/pure-ts/src/patterns/ai/memory/memory-composers.ts",
	memoryWithTiers: "packages/pure-ts/src/patterns/ai/memory/memory-composers.ts",
	memoryRetrieval: "packages/pure-ts/src/patterns/ai/memory/memory-composers.ts",

	// extra/composition — domain-agnostic substrates (Class B audit Alt E, 2026-04-30)
	auditedSuccessTracker: "packages/pure-ts/src/extra/composition/audited-success-tracker.ts",
	llmExtractor: "packages/pure-ts/src/patterns/ai/prompts/prompt-call.ts",
	llmConsolidator: "packages/pure-ts/src/patterns/ai/prompts/prompt-call.ts",
	promptCall: "packages/pure-ts/src/patterns/ai/prompts/prompt-call.ts",

	// Phase 4+ patterns: messaging (Tier 5.3, 2026-04-29)
	topic: "packages/pure-ts/src/patterns/messaging/index.ts",
	messagingHub: "packages/pure-ts/src/patterns/messaging/index.ts",
	subscription: "packages/pure-ts/src/patterns/messaging/index.ts",
	topicBridge: "packages/pure-ts/src/patterns/messaging/index.ts",

	// Phase 4+ patterns: orchestration
	pipelineGraph: "packages/pure-ts/src/patterns/orchestration/pipeline-graph.ts",
	decisionKeyOf: "packages/pure-ts/src/patterns/orchestration/pipeline-graph.ts",

	// Phase 4+ patterns: job-queue / job-flow
	jobQueue: "packages/pure-ts/src/patterns/job-queue/index.ts",
	jobFlow: "packages/pure-ts/src/patterns/job-queue/index.ts",
	jobEventKeyOf: "packages/pure-ts/src/patterns/job-queue/index.ts",

	// Phase 4+ patterns: cqrs
	cqrs: "packages/pure-ts/src/patterns/cqrs/index.ts",
	cqrsEventKeyOf: "packages/pure-ts/src/patterns/cqrs/index.ts",
	dispatchKeyOf: "packages/pure-ts/src/patterns/cqrs/index.ts",
	sagaInvocationKeyOf: "packages/pure-ts/src/patterns/cqrs/index.ts",

	// Phase 4+ patterns: process manager
	processManager: "packages/pure-ts/src/patterns/process/index.ts",
	processInstanceKeyOf: "packages/pure-ts/src/patterns/process/index.ts",
	processStateKeyOf: "packages/pure-ts/src/patterns/process/index.ts",
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
