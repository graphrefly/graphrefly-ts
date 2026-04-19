/**
 * Contrastive eval runner — Graph > Functions (Layer 0).
 *
 * Runs the same task through two treatments (GraphSpec vs plain functions)
 * and compares error rates, consistency, and bug localization.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { generateCatalogPrompt, validateSpecAgainstCatalog } from "../../src/patterns/graphspec.js";
import { estimateTokenCost, totalCost } from "./cost.js";
import { loadJudgePrompt, loadRubric, scoreRubric } from "./judge.js";
import { callLLM, extractJSON, getProviderLimits, getRateLimiterStats } from "./llm-client.js";
import { portableCatalog } from "./portable-catalog.js";
import { portableTemplateDescriptions, portableTemplates } from "./portable-templates.js";
import type { CatalogTreatment, EvalConfig, EvalRun, EvalTask, TaskResult } from "./types.js";
import { validateSpec } from "./validator.js";

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

A GraphSpec is JSON with \`nodes\` (required), optional \`templates\`, and
optional \`feedback\` edges. Each node has:

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

function buildAutoGenPrompt(treatment: CatalogTreatment): string {
	const catalogText = generateCatalogPrompt(portableCatalog);
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
 * - `B` / `C` / `D`: auto-generated prompt from `portableCatalog`.
 *   - `D` additionally injects `Pre-built Templates` section.
 *   - `C` would additionally enable auto-refine (requires llmCompose wiring;
 *     currently equivalent to B inside the contrastive runner — refine loop
 *     is owned by `llmCompose`, not the bare contrastive path).
 */
async function runGraphSpecTreatment(
	task: EvalTask,
	template: string,
	config: EvalConfig,
): Promise<TaskResult> {
	const useAutoGen = config.catalogTreatment !== "A";
	const promptSource = useAutoGen ? buildAutoGenPrompt(config.catalogTreatment) : template;
	const prompt = promptSource.replace("{{NL_DESCRIPTION}}", task.nl_description);

	const response = await callLLM(
		{
			system: prompt.split("## Your Task")[0],
			user: prompt.split("## Your Task")[1] ?? task.nl_description,
		},
		config,
	);

	let valid = false;
	let runnable = false;
	const catalogErrors: string[] = [];
	try {
		const spec = JSON.parse(extractJSON(response.content));
		// Treatment D: ensure pre-built templates are merged in so
		// `validateSpecAgainstCatalog` accepts template references the LLM
		// invokes by name (`{ type: "template", template: "resilientFetch", ... }`).
		if (config.catalogTreatment === "D" && spec && typeof spec === "object") {
			spec.templates = { ...portableTemplates, ...(spec.templates ?? {}) };
		}
		const validation = validateSpec(spec);
		valid = validation.valid;
		runnable = valid; // Placeholder until graphFromSpec exists

		// Treatment B/C/D: also run catalog-aware validation. Failures here
		// are surfaced as JudgeScore-shaped diagnostics on the result so they
		// show up in the run output without breaking the existing valid/runnable
		// contract that Treatment A uses.
		if (useAutoGen && valid) {
			const catalogValidation = validateSpecAgainstCatalog(spec, portableCatalog);
			if (!catalogValidation.valid) {
				catalogErrors.push(...catalogValidation.errors);
			}
		}
	} catch {
		// Invalid JSON
	}

	const result: TaskResult = {
		task_id: task.id,
		treatment: "graphspec",
		raw_output: response.content,
		valid,
		runnable,
		judge_scores: [], // Populated by judge pass
		latency_ms: response.latencyMs,
		token_count: {
			input: response.inputTokens,
			output: response.outputTokens,
		},
	};

	for (const err of catalogErrors) {
		result.judge_scores.push({
			claim: "catalog validation",
			pass: false,
			reasoning: err,
		});
	}

	return result;
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
				result.judge_scores = scores;
			}
		}

		results.push(graphResult, funcResult);
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

	return {
		run_id: config.runId ?? `l0-${Date.now()}`,
		timestamp: new Date().toISOString(),
		layer: "L0",
		model: config.model,
		provider: config.provider,
		schema_version: "scaffold",
		scores,
		tasks: results,
		total_cost_usd: totalCost(results.map((r) => r.cost_usd)),
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
