/**
 * Contrastive eval runner — Graph > Functions (Layer 0).
 *
 * Runs the same task through two treatments (GraphSpec vs plain functions)
 * and compares error rates, consistency, and bug localization.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	LLMResponse as AdapterLLMResponse,
	ChatMessage,
	LLMAdapter,
} from "../../packages/legacy-pure-ts/src/patterns/ai/index.js";
import {
	type GraphSpec,
	generateCatalogPrompt,
	llmRefine,
	validateSpecAgainstCatalog,
} from "../../packages/legacy-pure-ts/src/patterns/graphspec/index.js";
import { estimateTokenCost, totalCost } from "./cost.js";
import { loadJudgePrompt, loadRubric, scoreRubric } from "./judge.js";
import {
	callLLM,
	extractJSON,
	getAllBudgetStats,
	getProviderLimits,
	getRateLimiterStats,
} from "./llm-client.js";
import { portableCatalog, selectCatalogSubset } from "./portable-catalog.js";
import { portableTemplateDescriptions, portableTemplates } from "./portable-templates.js";
import type {
	CatalogTreatment,
	EvalConfig,
	EvalRun,
	EvalTask,
	JudgeScore,
	TaskResult,
} from "./types.js";
import { validateSpec } from "./validator.js";

// ---------------------------------------------------------------------------
// LLMAdapter shim — wraps our cost-safe `callLLM` so `llmRefine`/`llmCompose`
// in src/patterns/graphspec.ts can drive the same provider stack (cache,
// budget gate, rate limiter, cost tracking). Invocation count is exposed so
// Treatment C can report refine attempts.
// ---------------------------------------------------------------------------

interface RefineAdapter {
	adapter: LLMAdapter;
	/** Total invocations — initial compose (if routed here) + each refine. */
	readonly calls: number;
	/** Cumulative input tokens across all invocations. */
	readonly inputTokens: number;
	/** Cumulative output tokens across all invocations. */
	readonly outputTokens: number;
	/** Last response content seen (post-refine if any). */
	readonly lastContent: string;
	/** Cumulative wall latency (ms) across all invocations. */
	readonly latencyMs: number;
}

function createRefineAdapter(config: EvalConfig): RefineAdapter {
	let calls = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let lastContent = "";
	let latencyMs = 0;

	const adapter: LLMAdapter = {
		async invoke(messages: readonly ChatMessage[]): Promise<AdapterLLMResponse> {
			calls += 1;
			const system = messages.find((m) => m.role === "system")?.content ?? "";
			const user = messages.find((m) => m.role === "user")?.content ?? "";
			const response = await callLLM({ system, user, model: config.model }, config);
			inputTokens += response.inputTokens;
			outputTokens += response.outputTokens;
			latencyMs += response.latencyMs;
			lastContent = response.content;
			return {
				content: response.content,
				usage: {
					inputTokens: response.inputTokens,
					outputTokens: response.outputTokens,
				},
			};
		},
		// `stream` is required by the LLMAdapter contract but llmRefine/llmCompose
		// don't use it. Return an empty async iterable so the shape is valid.
		stream: (async function* () {
			/* unused by refine path */
		})(),
	};

	return {
		adapter,
		get calls() {
			return calls;
		},
		get inputTokens() {
			return inputTokens;
		},
		get outputTokens() {
			return outputTokens;
		},
		get lastContent() {
			return lastContent;
		},
		get latencyMs() {
			return latencyMs;
		},
	};
}

export type ContrastiveResumeConfig = Pick<EvalConfig, "l0FromTaskId" | "l0ResumeAfterTaskId">;

/**
 * Compute L0 contrastive aggregate scores from a flat task-result array.
 *
 * Pure — exported so the writer can recompute after merging two partial runs
 * (`mergeRuns` in {@link reporter}). When either treatment has zero results
 * (mid-resume slice), its error-rate is `0` and the ratio falls back to `0`.
 */
export function computeContrastiveScores(results: TaskResult[]): Record<string, number> {
	const graphResults = results.filter((r) => r.treatment === "graphspec");
	const funcResults = results.filter((r) => r.treatment === "functions");
	const graphErrorRate =
		graphResults.length > 0 ? graphResults.filter((r) => !r.valid).length / graphResults.length : 0;
	const funcErrorRate =
		funcResults.length > 0 ? funcResults.filter((r) => !r.valid).length / funcResults.length : 0;
	return {
		"L0-M1-graphspec-error-rate": graphErrorRate,
		"L0-M1-functions-error-rate": funcErrorRate,
		"L0-M1-ratio": funcErrorRate > 0 ? graphErrorRate / funcErrorRate : 0,
	};
}

/**
 * Slice the L0 corpus for resume runs. Full corpus order is preserved; unknown ids throw.
 */
export function sliceContrastiveTasksForResume(
	all: EvalTask[],
	config: ContrastiveResumeConfig,
): EvalTask[] {
	const from = config.l0FromTaskId;
	const after = config.l0ResumeAfterTaskId;
	if (from && after) {
		throw new Error(
			"Set only one of EVAL_L0_FROM or EVAL_L0_AFTER (or l0FromTaskId / l0ResumeAfterTaskId on EvalConfig)",
		);
	}
	if (!from && !after) {
		return all;
	}
	const ids = all.map((t) => t.id);
	if (from) {
		const i = ids.indexOf(from);
		if (i === -1) {
			throw new Error(
				`EVAL_L0_FROM: unknown task id "${from}". Known ids: ${ids.slice(0, 5).join(", ")}… (${ids.length} total)`,
			);
		}
		return all.slice(i);
	}
	const i = ids.indexOf(after!);
	if (i === -1) {
		throw new Error(
			`EVAL_L0_AFTER: unknown task id "${after}". Known ids: ${ids.slice(0, 5).join(", ")}… (${ids.length} total)`,
		);
	}
	return all.slice(i + 1);
}

async function loadTemplate(name: string, config: EvalConfig): Promise<string> {
	return readFile(join(config.specEvalsPath, "templates", `${name}.md`), "utf-8");
}

// ---------------------------------------------------------------------------
// Treatment B/C/D — auto-generated GraphSpec prompt
// ---------------------------------------------------------------------------

const TREATMENT_B_HEADER = `# GraphSpec Composition — Auto-Generated Prompt

You are composing a reactive graph using GraphReFly's GraphSpec format.

## GraphSpec Schema

A GraphSpec is JSON with these top-level fields:

- \`name\`: **Required.** Short identifier for the graph (e.g. "rss-to-slack").
  Used for \`describe()\` and \`snapshot()\`.
- \`nodes\`: Required. Object keyed by node name.
- \`templates\`: Optional. Reusable subgraph patterns.
- \`feedback\`: Optional. Bounded feedback edges.

Each node has:

- \`type\`: \`producer\` (data source), \`state\` (mutable value), \`derived\`
  (computed from deps), \`effect\` (side effect from deps), \`template\`
  (instantiate a reusable template).
- \`deps\`: array of dep node names (required for derived/effect).
- \`fn\`: catalog function name (required for derived/effect — must reference
  the catalog below, NOT a source).
- \`source\`: catalog source name (required for producer).
- \`config\`: optional config object passed to fn/source.
- \`initial\`: initial value (state nodes).
- \`meta\`: \`{ description: "<purpose>" }\` recommended for every node.

Edges are implicit from \`deps\`. Do not include an edges array.

Resilience ordering when composing manually: rateLimiter → circuitBreaker →
retry → timeout(innerCall) → fallback (outermost to innermost).

Stratify routing: stratify tags items with a branch name; downstream nodes
must use \`filterBy\` to select their branch.

`;

const TREATMENT_B_FOOTER = `

## Your Task

Compose a GraphSpec for the following description. Return ONLY valid JSON,
no markdown fences, no explanation.

**Description:** {{NL_DESCRIPTION}}
`;

function buildTemplateD_Section(): string {
	const lines: string[] = [
		"## Pre-built Templates (use when applicable)",
		"",
		"You may instantiate the following templates via",
		'`{ "type": "template", "template": "<name>", "bind": { ... } }`.',
		"Each template has a parameter list and an output node — bind your nodes",
		"to its params and depend on the instance for downstream nodes. Some",
		"templates require feedback edges (see template description).",
		"",
	];
	for (const [name, desc] of Object.entries(portableTemplateDescriptions)) {
		lines.push(`- **${name}**: ${desc}`);
	}
	return lines.join("\n");
}

function buildAutoGenPrompt(
	treatment: CatalogTreatment,
	catalog: GraphSpecCatalog = portableCatalog,
): string {
	const catalogText = generateCatalogPrompt(catalog);
	const templateSection = treatment === "D" ? `\n\n${buildTemplateD_Section()}\n` : "";
	return (
		`${TREATMENT_B_HEADER}\n## Available catalog\n\n${catalogText}` +
		templateSection +
		TREATMENT_B_FOOTER
	);
}

async function loadCorpus<T>(name: string, config: EvalConfig): Promise<T[]> {
	const raw = await readFile(join(config.specEvalsPath, "corpus", `${name}.json`), "utf-8");
	return JSON.parse(raw);
}

function addCost(result: TaskResult, model: string): void {
	if (result.token_count) {
		result.cost_usd = estimateTokenCost(result.token_count.input, result.token_count.output, model);
	}
}

/**
 * Run a single task through the GraphSpec treatment.
 *
 * Treatment selection (config.catalogTreatment, env `EVAL_TREATMENT`):
 * - `A` (default): manual catalog from `graphspec-treatment.md`.
 * - `B`: auto-generated prompt from `portableCatalog` (no refine).
 * - `C`: `B` + auto-refine — when the initial spec fails catalog validation,
 *   feed errors back to the LLM via `llmRefine` up to `maxAutoRefine` times.
 *   Refine attempts are recorded as judge-shaped diagnostic entries.
 * - `D`: `B` + pre-built templates section injected into the prompt and merged
 *   into the spec's `templates` field before validation.
 * - `E`: `B` + catalog subsetting — `selectCatalogSubset(task.nl, portableCatalog)`
 *   keeps only task-relevant fns/sources + essentials. Validates against the
 *   subset so a referenced-but-unlisted fn is flagged. Diagnostic records
 *   subset size (x/N fns, y/M sources).
 *
 * Treatments B/C/D/E share the same initial prompt skeleton — only the
 * catalog content and post-generation handling differ.
 */
async function runGraphSpecTreatment(
	task: EvalTask,
	template: string,
	config: EvalConfig,
): Promise<TaskResult> {
	const useAutoGen = config.catalogTreatment !== "A";
	// Treatment E: compute task-specific catalog subset. Other treatments use full catalog.
	const activeCatalog =
		config.catalogTreatment === "E"
			? selectCatalogSubset(task.nl_description, portableCatalog)
			: portableCatalog;
	const promptSource = useAutoGen
		? buildAutoGenPrompt(config.catalogTreatment, activeCatalog)
		: template;
	const prompt = promptSource.replace("{{NL_DESCRIPTION}}", task.nl_description);

	const response = await callLLM(
		{
			system: prompt.split("## Your Task")[0],
			user: prompt.split("## Your Task")[1] ?? task.nl_description,
			// Required so the budget gate can attribute spend to the model
			// (otherwise estimateTokenCost(req.model=undefined) returns 0 and
			// generation cost is silently uncounted — the judge calls were the
			// only thing showing up in [budget] output).
			model: config.model,
		},
		config,
	);

	let valid = false;
	let runnable = false;
	const diagnostics: JudgeScore[] = [];
	// Mutable across the refine loop — final values go into the returned result.
	let rawOutput = response.content;
	let accumulatedLatencyMs = response.latencyMs;
	let accumulatedInputTokens = response.inputTokens;
	let accumulatedOutputTokens = response.outputTokens;
	let spec: GraphSpec | undefined;

	// Treatment E: record subset size up-front so diagnostics show the catalog
	// reduction even when the run produces a valid spec (no catalog errors).
	if (config.catalogTreatment === "E") {
		const fullFns = Object.keys(portableCatalog.fns ?? {}).length;
		const fullSources = Object.keys(portableCatalog.sources ?? {}).length;
		const selFns = Object.keys(activeCatalog.fns ?? {}).length;
		const selSources = Object.keys(activeCatalog.sources ?? {}).length;
		diagnostics.push({
			claim: "catalog subset size",
			pass: true,
			reasoning: `Selected ${selFns}/${fullFns} fns and ${selSources}/${fullSources} sources from task keywords.`,
		});
	}

	try {
		const parsed = JSON.parse(extractJSON(response.content));
		// Treatment D: ensure pre-built templates are merged in so
		// `validateSpecAgainstCatalog` accepts template references the LLM
		// invokes by name (`{ type: "template", template: "resilientFetch", ... }`).
		if (config.catalogTreatment === "D" && parsed && typeof parsed === "object") {
			parsed.templates = { ...portableTemplates, ...(parsed.templates ?? {}) };
		}
		const validation = validateSpec(parsed);
		valid = validation.valid;
		runnable = valid; // Placeholder until graphFromSpec exists
		if (valid) {
			spec = parsed as GraphSpec;
		}

		// Treatment B/C/D: catalog-aware validation. For C, failures drive the
		// refine loop; for B/D, they're recorded as diagnostics only.
		if (useAutoGen && spec) {
			const catalogValidation = validateSpecAgainstCatalog(spec, activeCatalog);
			if (!catalogValidation.valid) {
				if (config.catalogTreatment === "C") {
					// Treatment C: auto-refine loop. Use `llmRefine` with our
					// cost-safe adapter shim so refine calls go through the same
					// cache + budget + rate-limiter stack as generation calls.
					const maxRefine = 2;
					const refineAdapter = createRefineAdapter(config);
					let currentSpec = spec;
					let currentErrors = catalogValidation.errors;
					let refinesUsed = 0;
					for (let attempt = 1; attempt <= maxRefine; attempt++) {
						try {
							currentSpec = await llmRefine(
								currentSpec,
								`Fix these catalog errors:\n${currentErrors.join("\n")}\n\nUse ONLY functions and sources from the catalog.`,
								refineAdapter.adapter,
								{ catalog: portableCatalog },
							);
							refinesUsed = attempt;
							const revalidated = validateSpecAgainstCatalog(currentSpec, portableCatalog);
							if (revalidated.valid) {
								spec = currentSpec;
								currentErrors = [];
								break;
							}
							currentErrors = revalidated.errors;
						} catch (err) {
							// Refine call itself failed (invalid JSON, budget cap,
							// transient error). Record and stop refining.
							diagnostics.push({
								claim: `auto-refine attempt ${attempt}`,
								pass: false,
								reasoning: err instanceof Error ? err.message : String(err),
							});
							refinesUsed = attempt;
							break;
						}
					}
					// Fold refine-adapter accounting back into the task result.
					rawOutput = refineAdapter.lastContent || rawOutput;
					accumulatedLatencyMs += refineAdapter.latencyMs;
					accumulatedInputTokens += refineAdapter.inputTokens;
					accumulatedOutputTokens += refineAdapter.outputTokens;
					diagnostics.push({
						claim: "auto-refine attempts used",
						pass: currentErrors.length === 0,
						reasoning: `${refinesUsed}/${maxRefine} refines used. Final catalog ${currentErrors.length === 0 ? "valid" : "invalid"} — ${currentErrors.length} remaining errors.`,
					});
					// If still invalid after max refines, surface errors as diagnostics.
					for (const errMsg of currentErrors) {
						diagnostics.push({
							claim: "catalog validation (post-refine)",
							pass: false,
							reasoning: errMsg,
						});
					}
					// Treatment C's `valid` reflects post-refine structural+catalog
					// validity so a successful refine counts as a task pass.
					if (currentErrors.length === 0) {
						valid = true;
						runnable = true;
					} else {
						valid = false;
						runnable = false;
					}
				} else {
					// B/D: record catalog errors as diagnostics, no refine.
					for (const errMsg of catalogValidation.errors) {
						diagnostics.push({
							claim: "catalog validation",
							pass: false,
							reasoning: errMsg,
						});
					}
				}
			}
		}
	} catch {
		// Initial JSON parse failed — treatment C does not attempt refine on
		// malformed JSON (llmRefine requires a parseable starting spec).
	}

	return {
		task_id: task.id,
		treatment: "graphspec",
		raw_output: rawOutput,
		valid,
		runnable,
		judge_scores: diagnostics,
		latency_ms: accumulatedLatencyMs,
		token_count: {
			input: accumulatedInputTokens,
			output: accumulatedOutputTokens,
		},
	};
}

/**
 * Run a single task through the plain functions treatment.
 */
async function runFunctionsTreatment(
	task: EvalTask,
	template: string,
	config: EvalConfig,
): Promise<TaskResult> {
	const prompt = template.replace("{{NL_DESCRIPTION}}", task.nl_description);

	const response = await callLLM(
		{
			system: prompt.split("## Your Task")[0],
			user: prompt.split("## Your Task")[1] ?? task.nl_description,
			// Same reason as runGraphSpecTreatment: model attribution for cost.
			model: config.model,
		},
		config,
	);

	// For functions treatment, "valid" means parseable TypeScript (heuristic)
	const valid = response.content.includes("function") || response.content.includes("async");

	return {
		task_id: task.id,
		treatment: "functions",
		raw_output: response.content,
		valid,
		runnable: valid, // Heuristic — no TS compiler in eval loop (yet)
		judge_scores: [],
		latency_ms: response.latencyMs,
		token_count: {
			input: response.inputTokens,
			output: response.outputTokens,
		},
	};
}

/**
 * Run the full contrastive eval (L0).
 */
export async function runContrastiveEval(config: EvalConfig): Promise<EvalRun> {
	const fullCorpus = await loadCorpus<EvalTask>("contrastive-tasks", config);
	const tasks = sliceContrastiveTasksForResume(fullCorpus, config);
	if (tasks.length < fullCorpus.length) {
		const skipped = fullCorpus.length - tasks.length;
		console.log(
			`  [L0] Resume: running ${tasks.length}/${fullCorpus.length} task(s) (${skipped} skipped from corpus head)`,
		);
	}

	// Log provider limits
	const limits = getProviderLimits(config);
	console.log(
		`  [L0] Provider limits: RPM=${limits.rpm}, RPD=${limits.rpd === Infinity ? "∞" : limits.rpd}, ` +
			`TPM=${limits.tpm === Infinity ? "∞" : limits.tpm.toLocaleString()}, ` +
			`context=${limits.contextWindow.toLocaleString()}, maxOutput=${limits.maxOutputTokens.toLocaleString()}`,
	);
	console.log(
		`  [L0] Rate limiting: ${config.rateLimitEnabled ? "enabled (adaptive)" : "disabled"}`,
	);

	const graphspecTemplate = await loadTemplate("graphspec-treatment", config);
	const functionsTemplate = await loadTemplate("functions-treatment", config);
	const rubric = await loadRubric(join(config.specEvalsPath, "rubrics", "l0-contrastive.json"));
	const correctnessPrompt = await loadJudgePrompt("correctness", config);

	const results: TaskResult[] = [];

	for (const task of tasks) {
		console.log(`  [L0] Task: ${task.id}`);

		try {
			// Run both treatments
			const graphResult = await runGraphSpecTreatment(task, graphspecTemplate, config);
			const funcResult = await runFunctionsTreatment(task, functionsTemplate, config);

			// Add cost estimates
			addCost(graphResult, config.model);
			addCost(funcResult, config.model);

			// Judge correctness for both
			if (task.contrastive?.key_behaviors) {
				for (const result of [graphResult, funcResult]) {
					const { scores } = await scoreRubric(
						rubric.filter((r) => r.metric === "L0-M1"),
						correctnessPrompt,
						{
							NL_DESCRIPTION: task.nl_description,
							OUTPUT: result.raw_output,
							TREATMENT: result.treatment,
							KEY_BEHAVIORS: task.contrastive.key_behaviors.join("\n- "),
						},
						config,
					);
					// Preserve any diagnostics pushed by runGraphSpecTreatment
					// (catalog-subset size, auto-refine attempts, task-aborted,
					// catalog validation errors). Previously this line was
					// `result.judge_scores = scores` which silently clobbered
					// those per-task observability entries.
					result.judge_scores = [...result.judge_scores, ...scores];
				}
			}

			results.push(graphResult, funcResult);
		} catch (err) {
			// Transient API errors (truncated JSON, connection drops, 5xx after
			// retries are exhausted in the limiter) shouldn't kill the whole
			// run. Record a diagnostic failure for both treatments and continue.
			// Successful prior tasks stay in `results`; the cache still holds
			// any individual responses that did complete this iteration.
			const errMsg = err instanceof Error ? err.message : String(err);
			console.error(`  [L0] Task ${task.id} aborted: ${errMsg}`);
			for (const treatment of ["graphspec", "functions"] as const) {
				results.push({
					task_id: task.id,
					treatment,
					raw_output: "",
					valid: false,
					runnable: false,
					judge_scores: [
						{
							claim: "task aborted",
							pass: false,
							reasoning: `Transient API error during ${treatment} treatment: ${errMsg}. Re-run to retry — successful response fragments are cached.`,
						},
					],
					latency_ms: 0,
				});
			}
		}
	}

	const scores = computeContrastiveScores(results);

	// Log rate limiter stats
	const rlStats = getRateLimiterStats(config);
	if (config.rateLimitEnabled && (rlStats.totalRetries > 0 || rlStats.totalWaitMs > 0)) {
		console.log(
			`\n  [L0] Rate limiter: ${rlStats.totalRetries} retries, ` +
				`${(rlStats.totalWaitMs / 1000).toFixed(1)}s total pacing wait, ` +
				`effective RPM=${rlStats.effectiveRpm}`,
		);
	}

	// Sum budget-gate state across every provider (gen + judge) — previously
	// `total_cost_usd` only summed per-task generation cost, hiding judge
	// spend that often dominated on reasoning-model judges (e.g. qwen-397b
	// judge contributed 3-5x generation cost during qwen A run).
	const budgetStats = getAllBudgetStats();
	const taskGenCost = totalCost(results.map((r) => r.cost_usd));
	const total_cost_usd = budgetStats.totalPriceUsd > 0 ? budgetStats.totalPriceUsd : taskGenCost;

	return {
		run_id: config.runId ?? `l0-${Date.now()}`,
		timestamp: new Date().toISOString(),
		layer: "L0",
		model: config.model,
		provider: config.provider,
		schema_version: "scaffold",
		scores,
		tasks: results,
		total_cost_usd,
		rate_limit_stats: config.rateLimitEnabled
			? {
					total_retries: rlStats.totalRetries,
					total_wait_ms: rlStats.totalWaitMs,
					effective_rpm: rlStats.effectiveRpm,
					effective_tpm: rlStats.effectiveTpm,
				}
			: undefined,
	};
}
