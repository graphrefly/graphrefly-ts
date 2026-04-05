/**
 * Contrastive eval runner — Graph > Functions (Layer 0).
 *
 * Runs the same task through two treatments (GraphSpec vs plain functions)
 * and compares error rates, consistency, and bug localization.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadJudgePrompt, loadRubric, scoreRubric } from "./judge.js";
import { callLLM, extractJSON } from "./llm-client.js";
import type { BugTask, EvalConfig, EvalRun, EvalTask, TaskResult } from "./types.js";
import { validateSpec } from "./validator.js";

async function loadTemplate(name: string, config: EvalConfig): Promise<string> {
	return readFile(join(config.specEvalsPath, "templates", `${name}.md`), "utf-8");
}

async function loadCorpus<T>(name: string, config: EvalConfig): Promise<T[]> {
	const raw = await readFile(join(config.specEvalsPath, "corpus", `${name}.json`), "utf-8");
	return JSON.parse(raw);
}

/**
 * Run a single task through the GraphSpec treatment.
 */
async function runGraphSpecTreatment(
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

	let valid = false;
	let runnable = false;
	try {
		const spec = JSON.parse(extractJSON(response.content));
		const validation = validateSpec(spec);
		valid = validation.valid;
		runnable = valid; // Placeholder until graphFromSpec exists
	} catch {
		// Invalid JSON
	}

	return {
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
	const tasks = await loadCorpus<EvalTask>("contrastive-tasks", config);
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

	// Compute aggregate scores
	const graphResults = results.filter((r) => r.treatment === "graphspec");
	const funcResults = results.filter((r) => r.treatment === "functions");

	const graphErrorRate = graphResults.filter((r) => !r.valid).length / graphResults.length;
	const funcErrorRate = funcResults.filter((r) => !r.valid).length / funcResults.length;

	return {
		run_id: `l0-${Date.now()}`,
		timestamp: new Date().toISOString(),
		layer: "L0",
		model: config.model,
		schema_version: "scaffold",
		scores: {
			"L0-M1-graphspec-error-rate": graphErrorRate,
			"L0-M1-functions-error-rate": funcErrorRate,
			"L0-M1-ratio": funcErrorRate > 0 ? graphErrorRate / funcErrorRate : 0,
		},
		tasks: results,
	};
}
