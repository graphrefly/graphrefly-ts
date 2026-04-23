/**
 * Portable eval catalog — `CatalogFnEntry` / `CatalogSourceEntry` data
 * mirroring the manual catalog in `evals/portable-eval-prompts.md`.
 *
 * Used by Treatment B onward (auto-gen prompt via `generateCatalogPrompt()`)
 * and by `validateSpecAgainstCatalog()` to check fn/source names.
 *
 * Factories are intentional placeholders — the eval scores GraphSpec
 * composition (judges + structural validation), not runtime correctness.
 * The factories exist so `compileSpec()` succeeds in any future wire-up
 * and so `validateSpecAgainstCatalog()` has real entries to validate against.
 *
 * Section tags (e.g., "Transforms & filters") match the section headers in
 * the manual prompt verbatim, so `generateCatalogPrompt()` produces text
 * with the same grouping as Treatment A's manual catalog string.
 *
 * See `docs/roadmap.md` §9.1.2 (treatment progression) for the experiment
 * design. See `evals/results/session-2026-04-06-catalog-automation.md` for
 * the Run-4 gap analysis that motivates Treatment D additions.
 */

import { derived, effect, state } from "../../src/core/sugar.js";
import type {
	CatalogFnEntry,
	CatalogSourceEntry,
	GraphSpecCatalog,
} from "../../src/patterns/graphspec/index.js";

// ---------------------------------------------------------------------------
// Tag constants — section headers, matched exactly to the manual prompt
// ---------------------------------------------------------------------------

const TRANSFORMS = "Transforms & filters";
const FORMATTING = "Formatting & reporting";
const AI_LLM = "AI / LLM";
const REDUCTION = "Reduction (multi-source → signal)";
const ORCHESTRATION = "Orchestration";
const CHECKS = "Checks & validation";
const RESILIENCE = "Resilience";
const EFFECTS = "Effects (sinks)";

// ---------------------------------------------------------------------------
// Placeholder factories — pass-through derived/state/effect for runtime safety
// ---------------------------------------------------------------------------

const passthroughDerived: CatalogFnEntry["factory"] = (deps) => derived(deps, ([v]) => v);

const passthroughEffect: CatalogFnEntry["factory"] = (deps) =>
	effect(deps, () => {
		/* placeholder side effect */
	});

const passthroughSource: CatalogSourceEntry["factory"] = (config) =>
	state(null, { meta: { source: "placeholder", ...config } });

// ---------------------------------------------------------------------------
// Function catalog
// ---------------------------------------------------------------------------

/**
 * Function catalog — keys must match the names exposed in
 * `evals/portable-eval-prompts.md`. Adding or removing a name here
 * changes Treatment B's prompt.
 */
export const portableFns: Record<string, CatalogFnEntry> = {
	// --- Transforms & filters ---------------------------------------------------
	filterBy: {
		factory: passthroughDerived,
		description: "Filter items by condition.",
		configSchema: {
			field: { type: "string" },
			op: { type: "string", enum: ["eq", "gt", "lt", "contains"] },
			value: { type: "unknown" },
		},
		tags: [TRANSFORMS],
	},
	mapFields: {
		factory: passthroughDerived,
		description: "Transform record fields.",
		configSchema: {
			mapping: { type: "Record<string,string>" },
		},
		tags: [TRANSFORMS],
	},
	normalize: {
		factory: passthroughDerived,
		description: "Normalize data shape.",
		tags: [TRANSFORMS],
	},
	groupBy: {
		factory: passthroughDerived,
		description: "Group items by field.",
		configSchema: { field: { type: "string" } },
		tags: [TRANSFORMS],
	},
	aggregate: {
		factory: passthroughDerived,
		description: "Aggregate values across items.",
		configSchema: {
			op: {
				type: "string",
				// Treatment-D fix: median added to close T8a "avg ≠ median" gap
				enum: ["sum", "avg", "count", "min", "max", "median"],
			},
			field: { type: "string" },
		},
		tags: [TRANSFORMS],
	},
	rollingAvg: {
		factory: passthroughDerived,
		description: "Running average over a sliding window.",
		configSchema: { windowSize: { type: "number" } },
		tags: [TRANSFORMS],
	},
	computeAverage: {
		factory: passthroughDerived,
		description: "Average of a numeric array.",
		tags: [TRANSFORMS],
	},
	scan: {
		factory: passthroughDerived,
		description: "Running accumulator over a stream.",
		configSchema: {
			fn: { type: "string" },
			initial: { type: "unknown" },
		},
		tags: [TRANSFORMS],
	},
	distinctUntilChanged: {
		factory: passthroughDerived,
		description: "Skip consecutive duplicates.",
		configSchema: { key: { type: "string", required: false } },
		tags: [TRANSFORMS],
	},
	take: {
		factory: passthroughDerived,
		description: "Take first N values then stop.",
		configSchema: { count: { type: "number" } },
		tags: [TRANSFORMS],
	},
	skip: {
		factory: passthroughDerived,
		description: "Skip first N values.",
		configSchema: { count: { type: "number" } },
		tags: [TRANSFORMS],
	},
	delay: {
		factory: passthroughDerived,
		description: "Delay each value by N milliseconds.",
		configSchema: { delayMs: { type: "number" } },
		tags: [TRANSFORMS],
	},
	debounce: {
		factory: passthroughDerived,
		description: "Debounce rapid values.",
		configSchema: { waitMs: { type: "number" } },
		tags: [TRANSFORMS],
	},
	throttle: {
		factory: passthroughDerived,
		description: "Throttle values to a fixed interval.",
		configSchema: { intervalMs: { type: "number" } },
		tags: [TRANSFORMS],
	},
	batchEvents: {
		factory: passthroughDerived,
		description: "Collect values into batches.",
		configSchema: {
			size: { type: "number" },
			intervalMs: { type: "number" },
		},
		tags: [TRANSFORMS],
	},
	merge: {
		factory: passthroughDerived,
		description: "Combine multiple inputs into one stream.",
		configSchema: {
			strategy: { type: "string", enum: ["concat", "zip", "object"] },
		},
		tags: [TRANSFORMS],
	},
	dedup: {
		factory: passthroughDerived,
		description: "Deduplicate stream.",
		configSchema: {
			key: { type: "string", required: false },
			ttlMs: { type: "number", required: false },
		},
		tags: [TRANSFORMS],
	},
	conditionalMap: {
		// Treatment-D fix: closes T6 interval-computation gap (Run 4 analysis).
		// Thin catalog wrapper over dynamicNode — not a new primitive.
		factory: passthroughDerived,
		description:
			"Map input to output based on rules. Generalization of thresholdCheck that produces values instead of booleans.",
		configSchema: {
			rules: { type: "Array<{match:{field,op,value},output:unknown}>" },
			default: { type: "unknown" },
		},
		examples: [
			{
				rules: [
					{ match: { field: "count", op: "gt", value: 100 }, output: 2000 },
					{ match: { field: "count", op: "lt", value: 20 }, output: 30000 },
				],
				default: 10000,
			},
		],
		tags: [TRANSFORMS],
	},

	// --- Formatting & reporting ------------------------------------------------
	formatResults: {
		factory: passthroughDerived,
		description: "Format data into a serialised representation.",
		configSchema: {
			format: { type: "string", enum: ["json", "csv", "markdown"] },
		},
		tags: [FORMATTING],
	},
	generateReport: {
		factory: passthroughDerived,
		description: "Generate a report from one or more data sources.",
		tags: [FORMATTING],
	},
	distill: {
		factory: passthroughDerived,
		description: "Extract and consolidate information from upstream sources.",
		configSchema: {
			strategy: { type: "string", enum: ["latest", "merge", "summarize"] },
		},
		tags: [FORMATTING],
	},

	// --- AI / LLM --------------------------------------------------------------
	llmClassify: {
		factory: passthroughDerived,
		description: "AI classification into one of a fixed category set.",
		configSchema: { categories: { type: "string[]" } },
		tags: [AI_LLM],
	},
	llmSummarize: {
		factory: passthroughDerived,
		description: "AI summarization of input text.",
		configSchema: {
			maxLength: { type: "number", required: false },
			style: { type: "string", enum: ["bullets", "paragraph"], required: false },
		},
		tags: [AI_LLM],
	},
	llmExtract: {
		factory: passthroughDerived,
		description: "AI structured extraction against a schema.",
		configSchema: { schema: { type: "object" } },
		tags: [AI_LLM],
	},
	llmScore: {
		factory: passthroughDerived,
		// Treatment-D fix: T11 missing-DB-query gap (Run 4 analysis).
		description:
			"Score an item with an LLM rubric. When comparing against existing data, add a database producer node as a second dep so the comparison set flows in.",
		configSchema: {
			rubric: { type: "string" },
			scale: { type: "[number,number]", required: false },
		},
		tags: [AI_LLM],
	},

	// --- Reduction -------------------------------------------------------------
	stratify: {
		factory: passthroughDerived,
		description:
			"Route inputs into priority branches by rules. Tags items with branch name; downstream filterBy selects the branch.",
		configSchema: {
			rules: { type: "Array<{match:{field,op,value},branch:string}>" },
			default: { type: "string", required: false },
		},
		tags: [REDUCTION],
	},
	funnel: {
		factory: passthroughDerived,
		description: "Multi-stage filtering and consolidation pipeline.",
		configSchema: {
			stages: { type: "Array<{fn,config}>" },
		},
		tags: [REDUCTION],
	},
	feedback: {
		factory: passthroughDerived,
		description:
			"DEPRECATED as inline fn — declare the computation as a normal derived node and add a top-level feedback edge instead.",
		tags: [REDUCTION],
	},
	scorer: {
		factory: passthroughDerived,
		description: "Score and rank items by weighted fields.",
		configSchema: {
			weights: { type: "Record<string,number>" },
			normalize: { type: "boolean", required: false },
		},
		tags: [REDUCTION],
	},
	budgetGate: {
		factory: passthroughDerived,
		description: "Allow items through while within a budget.",
		configSchema: {
			budget: { type: "number" },
			costField: { type: "string" },
			resetIntervalMs: { type: "number", required: false },
		},
		tags: [REDUCTION],
	},

	// --- Orchestration ---------------------------------------------------------
	approval: {
		factory: passthroughDerived,
		description: "Human or LLM approval gate.",
		configSchema: {
			approver: { type: "string", enum: ["human", "llm"] },
			prompt: { type: "string", required: false },
		},
		tags: [ORCHESTRATION],
	},
	branch: {
		factory: passthroughDerived,
		description: "Route to named branches based on a condition.",
		configSchema: {
			condition: { type: "string" },
			// biome-ignore lint/suspicious/noThenProperty: catalog field name mirrors the manual prompt verbatim (see evals/portable-eval-prompts.md line 117).
			then: { type: "string" },
			else: { type: "string", required: false },
		},
		tags: [ORCHESTRATION],
	},
	join: {
		factory: passthroughDerived,
		description: "Wait for multiple deps and combine.",
		configSchema: {
			strategy: { type: "string", enum: ["all", "race"] },
		},
		tags: [ORCHESTRATION],
	},

	// --- Checks & validation ---------------------------------------------------
	thresholdCheck: {
		factory: passthroughDerived,
		description: "Check value against threshold.",
		configSchema: {
			threshold: { type: "number" },
			direction: { type: "string", enum: ["above", "below"] },
		},
		tags: [CHECKS],
	},
	validateSchema: {
		factory: passthroughDerived,
		description: "Validate data against a JSON schema.",
		configSchema: {
			schema: { type: "object" },
			onInvalid: {
				type: "string",
				enum: ["error", "filter", "tag"],
				required: false,
			},
		},
		tags: [CHECKS],
	},

	// --- Resilience ------------------------------------------------------------
	retry: {
		factory: passthroughDerived,
		description:
			"Retry on failure. Wraps the node's deps — retries fetching from upstream. Do NOT put a source name in fn — retry wraps whatever its deps produce.",
		configSchema: {
			maxAttempts: { type: "number" },
			backoff: {
				type: "string",
				enum: ["exponential", "linear", "fibonacci"],
				required: false,
			},
		},
		tags: [RESILIENCE],
	},
	fallback: {
		factory: passthroughDerived,
		description: "Use a fallback value or source when the main path errors.",
		configSchema: {
			fallbackValue: { type: "unknown", required: false },
			fallbackSource: { type: "string", required: false },
		},
		tags: [RESILIENCE],
	},
	timeout: {
		factory: passthroughDerived,
		description: "Error if no data arrives within deadline.",
		configSchema: { timeoutMs: { type: "number" } },
		tags: [RESILIENCE],
	},
	circuitBreaker: {
		factory: passthroughDerived,
		description: "Gate requests through circuit breaker (closed/open/half-open).",
		configSchema: {
			failureThreshold: { type: "number", required: false },
			cooldownMs: { type: "number", required: false },
			onOpen: { type: "string", enum: ["skip", "error"], required: false },
		},
		tags: [RESILIENCE],
	},
	rateLimiter: {
		factory: passthroughDerived,
		description: "Enforce rate limit on data flow (sliding window).",
		configSchema: {
			maxEvents: { type: "number" },
			windowMs: { type: "number" },
		},
		tags: [RESILIENCE],
	},
	tokenBucket: {
		factory: passthroughDerived,
		description: "Token bucket rate limiter.",
		configSchema: {
			capacity: { type: "number" },
			refillRate: { type: "number" },
			refillIntervalMs: { type: "number" },
		},
		tags: [RESILIENCE],
	},
	withBreaker: {
		factory: passthroughDerived,
		description: "Attach a circuit breaker to a node.",
		configSchema: {
			failureThreshold: { type: "number" },
			cooldownMs: { type: "number" },
		},
		tags: [RESILIENCE],
	},
	withStatus: {
		factory: passthroughDerived,
		description: "Attach status/error companion metadata to a node.",
		configSchema: {
			initialStatus: {
				type: "string",
				enum: ["pending", "active", "completed", "errored"],
				required: false,
			},
		},
		tags: [RESILIENCE],
	},
	cache: {
		factory: passthroughDerived,
		description: "Cache values with TTL.",
		configSchema: { ttlMs: { type: "number" } },
		tags: [RESILIENCE],
	},

	// --- Effects (sinks) -------------------------------------------------------
	sendEmail: {
		factory: passthroughEffect,
		description: "Send email.",
		configSchema: {
			to: { type: "string" },
			subject: { type: "string", required: false },
		},
		tags: [EFFECTS],
	},
	sendSlack: {
		factory: passthroughEffect,
		description: "Post to Slack.",
		configSchema: { channel: { type: "string" } },
		tags: [EFFECTS],
	},
	sendAlert: {
		factory: passthroughEffect,
		description: "Send alert via configured channel.",
		configSchema: {
			channel: { type: "string", enum: ["push", "sms", "email"] },
		},
		tags: [EFFECTS],
	},
	notifyPush: {
		factory: passthroughEffect,
		description: "Push notification.",
		configSchema: { title: { type: "string", required: false } },
		tags: [EFFECTS],
	},
	writeToDB: {
		factory: passthroughEffect,
		description: "Write to database.",
		configSchema: { table: { type: "string" } },
		tags: [EFFECTS],
	},
	writeLog: {
		factory: passthroughEffect,
		description: "Log data.",
		configSchema: { level: { type: "string", required: false } },
		tags: [EFFECTS],
	},
	uploadToS3: {
		factory: passthroughEffect,
		description: "Upload to S3.",
		configSchema: { bucket: { type: "string" } },
		tags: [EFFECTS],
	},
	updateDashboard: {
		factory: passthroughEffect,
		description: "Update dashboard.",
		configSchema: { dashboardId: { type: "string", required: false } },
		tags: [EFFECTS],
	},
	sendPagerDuty: {
		factory: passthroughEffect,
		description: "PagerDuty alert.",
		configSchema: {
			severity: {
				type: "string",
				enum: ["info", "warning", "critical"],
				required: false,
			},
		},
		tags: [EFFECTS],
	},
	createJiraTicket: {
		factory: passthroughEffect,
		description: "Create Jira ticket.",
		configSchema: { project: { type: "string" } },
		tags: [EFFECTS],
	},
	processPayment: {
		factory: passthroughEffect,
		description: "Process payment.",
		configSchema: { gateway: { type: "string", required: false } },
		tags: [EFFECTS],
	},
	toKafka: {
		factory: passthroughEffect,
		description: "Publish to Kafka topic.",
		configSchema: { topic: { type: "string" } },
		tags: [EFFECTS],
	},
	toPostgres: {
		factory: passthroughEffect,
		description: "Write to PostgreSQL.",
		configSchema: { table: { type: "string" } },
		tags: [EFFECTS],
	},
	toClickHouse: {
		factory: passthroughEffect,
		description: "Write to ClickHouse.",
		configSchema: { table: { type: "string" } },
		tags: [EFFECTS],
	},
	toLoki: {
		factory: passthroughEffect,
		description: "Push to Loki log aggregation.",
		configSchema: { labels: { type: "Record<string,string>" } },
		tags: [EFFECTS],
	},
};

// ---------------------------------------------------------------------------
// Source catalog
// ---------------------------------------------------------------------------

export const portableSources: Record<string, CatalogSourceEntry> = {
	"rest-api": {
		factory: passthroughSource,
		description: "Poll REST endpoint.",
		configSchema: {
			url: { type: "string" },
			pollIntervalMs: { type: "number", required: false },
		},
	},
	webhook: {
		factory: passthroughSource,
		description: "Receive HTTP callbacks.",
		configSchema: { path: { type: "string" } },
	},
	websocket: {
		factory: passthroughSource,
		description: "WebSocket connection.",
		configSchema: { url: { type: "string" } },
	},
	database: {
		factory: passthroughSource,
		description: "Query database.",
		configSchema: { query: { type: "string" } },
	},
	kafka: {
		factory: passthroughSource,
		description: "Consume Kafka topic.",
		configSchema: {
			topic: { type: "string" },
			groupId: { type: "string", required: false },
		},
	},
	rss: {
		factory: passthroughSource,
		description: "Poll RSS feed.",
		configSchema: { url: { type: "string" } },
	},
	email: {
		factory: passthroughSource,
		description: "Watch email inbox (IMAP).",
		configSchema: { folder: { type: "string", required: false } },
	},
	"filesystem-watch": {
		factory: passthroughSource,
		description: "Watch files for changes.",
		configSchema: {
			path: { type: "string" },
			glob: { type: "string", required: false },
		},
	},
	cron: {
		factory: passthroughSource,
		description: "Emit on cron schedule.",
		configSchema: { expression: { type: "string" } },
	},
	timer: {
		factory: passthroughSource,
		description: "Emit at fixed interval.",
		configSchema: { intervalMs: { type: "number" } },
	},
	prometheus: {
		factory: passthroughSource,
		description: "Query Prometheus metrics.",
		configSchema: { query: { type: "string" } },
	},
	mqtt: {
		factory: passthroughSource,
		description: "MQTT subscription.",
		configSchema: {
			broker: { type: "string" },
			topic: { type: "string" },
		},
	},
	"github-events": {
		factory: passthroughSource,
		description: "GitHub webhook events.",
		configSchema: {
			repo: { type: "string" },
			events: { type: "string[]", required: false },
		},
	},
	otel: {
		factory: passthroughSource,
		description: "OpenTelemetry signals (spans, metrics, logs).",
		configSchema: {
			signalType: { type: "string", enum: ["spans", "metrics", "logs"] },
			endpoint: { type: "string", required: false },
		},
	},
	"redis-stream": {
		factory: passthroughSource,
		description: "Redis Stream consumer.",
		configSchema: {
			stream: { type: "string" },
			group: { type: "string", required: false },
			consumer: { type: "string", required: false },
		},
	},
	nats: {
		factory: passthroughSource,
		description: "NATS subscriber.",
		configSchema: { subject: { type: "string" } },
	},
	rabbitmq: {
		factory: passthroughSource,
		description: "RabbitMQ consumer.",
		configSchema: { queue: { type: "string" } },
	},
	pulsar: {
		factory: passthroughSource,
		description: "Pulsar consumer.",
		configSchema: {
			topic: { type: "string" },
			subscription: { type: "string", required: false },
		},
	},
	syslog: {
		factory: passthroughSource,
		description: "Syslog receiver.",
		configSchema: { port: { type: "number", required: false } },
	},
	mcp: {
		factory: passthroughSource,
		description: "MCP tool invocation source.",
		configSchema: {
			server: { type: "string" },
			tool: { type: "string" },
		},
	},
};

// ---------------------------------------------------------------------------
// Combined catalog
// ---------------------------------------------------------------------------

/**
 * The portable eval catalog — passed to `generateCatalogPrompt()` for
 * Treatment B and to `validateSpecAgainstCatalog()` for fn/source name
 * validation.
 */
export const portableCatalog: GraphSpecCatalog = {
	fns: portableFns,
	sources: portableSources,
};

// ---------------------------------------------------------------------------
// Treatment E — catalog subsetting via keyword matching
// ---------------------------------------------------------------------------

/** Options for {@link selectCatalogSubset}. */
export interface CatalogSubsetOptions {
	/** Minimum number of fns to include (pads with highest-ranked remaining if few matches). Default 8. */
	minFns?: number;
	/** Minimum number of sources to include. Default 3. */
	minSources?: number;
	/** Stopwords removed from task-description keyword extraction. */
	stopwords?: ReadonlySet<string>;
	/** Always-include fn names (core primitives the LLM should always see). */
	essentialFns?: readonly string[];
}

/**
 * Stopwords stripped from task-description keywords before scoring.
 * Intentionally small — we're pruning noise, not imposing linguistic style.
 */
const DEFAULT_STOPWORDS: ReadonlySet<string> = new Set([
	"a",
	"an",
	"the",
	"and",
	"or",
	"but",
	"not",
	"of",
	"to",
	"in",
	"on",
	"at",
	"for",
	"from",
	"by",
	"with",
	"as",
	"is",
	"are",
	"be",
	"it",
	"its",
	"this",
	"that",
	"these",
	"those",
	"into",
	"when",
	"if",
	"then",
	"else",
	"do",
	"each",
	"every",
	"all",
	"any",
	"some",
	"more",
	"most",
	"via",
	"using",
	"use",
	"i",
	"we",
	"you",
	"our",
	"your",
	"my",
	"new",
	"old",
]);

/** Fns always included regardless of task — universal composition primitives. */
const DEFAULT_ESSENTIALS: readonly string[] = ["filterBy", "mapFields", "merge"];

function extractKeywords(text: string, stopwords: ReadonlySet<string>): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length >= 3 && !stopwords.has(w));
}

function scoreEntryText(
	name: string,
	description: string,
	tags: readonly string[] | undefined,
	keywords: readonly string[],
): number {
	const haystack = `${name} ${description} ${(tags ?? []).join(" ")}`.toLowerCase();
	let score = 0;
	for (const kw of keywords) {
		if (haystack.includes(kw)) score += 1;
	}
	return score;
}

/**
 * Produce a task-specific subset of a catalog using keyword matching against
 * each entry's `name + description + tags`. Used by Treatment E to test the
 * hypothesis that **smaller context → higher composition success rate**.
 *
 * Selection rules:
 * 1. All entries in `essentialFns` are kept unconditionally.
 * 2. All entries with keyword-score > 0 are kept.
 * 3. If fewer than `minFns`/`minSources` entries are kept, pad with the
 *    highest-scoring remaining entries until the minimum is reached.
 *
 * @param taskDescription Natural-language task (e.g. `EvalTask.nl_description`).
 * @param catalog Full catalog to subset.
 * @param opts Subsetting knobs. See {@link CatalogSubsetOptions}.
 * @returns A smaller `GraphSpecCatalog` preserving the essentials + relevant entries.
 */
export function selectCatalogSubset(
	taskDescription: string,
	catalog: GraphSpecCatalog,
	opts: CatalogSubsetOptions = {},
): GraphSpecCatalog {
	const stopwords = opts.stopwords ?? DEFAULT_STOPWORDS;
	const essentials = new Set(opts.essentialFns ?? DEFAULT_ESSENTIALS);
	const minFns = opts.minFns ?? 8;
	const minSources = opts.minSources ?? 3;
	const keywords = extractKeywords(taskDescription, stopwords);

	const subsetFns: Record<string, CatalogFnEntry> = {};
	const subsetSources: Record<string, CatalogSourceEntry> = {};

	if (catalog.fns) {
		const scored: Array<[string, CatalogFnEntry, number]> = [];
		for (const [name, entry] of Object.entries(catalog.fns)) {
			if (typeof entry === "function") continue; // bare factories have no metadata
			const rich = entry as CatalogFnEntry;
			const score = scoreEntryText(name, rich.description, rich.tags, keywords);
			scored.push([name, rich, score]);
		}
		// Step 1: essentials first.
		for (const [name, rich] of scored) {
			if (essentials.has(name)) subsetFns[name] = rich;
		}
		// Step 2: all positive-scoring entries.
		for (const [name, rich, score] of scored) {
			if (score > 0) subsetFns[name] = rich;
		}
		// Step 3: pad to minFns with highest-scoring remaining.
		scored.sort((a, b) => b[2] - a[2]);
		for (const [name, rich] of scored) {
			if (Object.keys(subsetFns).length >= minFns) break;
			subsetFns[name] = rich;
		}
	}

	if (catalog.sources) {
		const scored: Array<[string, CatalogSourceEntry, number]> = [];
		for (const [name, entry] of Object.entries(catalog.sources)) {
			if (typeof entry === "function") continue;
			const rich = entry as CatalogSourceEntry;
			const score = scoreEntryText(name, rich.description, rich.tags, keywords);
			scored.push([name, rich, score]);
		}
		for (const [name, rich, score] of scored) {
			if (score > 0) subsetSources[name] = rich;
		}
		scored.sort((a, b) => b[2] - a[2]);
		for (const [name, rich] of scored) {
			if (Object.keys(subsetSources).length >= minSources) break;
			subsetSources[name] = rich;
		}
	}

	return { fns: subsetFns, sources: subsetSources };
}
