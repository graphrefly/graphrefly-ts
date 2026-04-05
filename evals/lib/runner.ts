/**
 * Core eval orchestrator.
 *
 * Loads corpora from the spec repo, runs tasks through the LLM,
 * validates outputs, scores with the judge, and produces results.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadJudgePrompt, loadRubric, scoreRubric } from "./judge.js";
import { callLLM, extractJSON } from "./llm-client.js";
import type { EvalConfig, EvalRun, EvalTask, TaskResult } from "./types.js";
import { executeSpec, validateSpec } from "./validator.js";

async function loadCorpus<T>(name: string, config: EvalConfig): Promise<T[]> {
	const raw = await readFile(join(config.specEvalsPath, "corpus", `${name}.json`), "utf-8");
	return JSON.parse(raw);
}

async function loadTemplate(name: string, config: EvalConfig): Promise<string> {
	return readFile(join(config.specEvalsPath, "templates", `${name}.md`), "utf-8");
}

/**
 * Run the LLM-DX eval (Layer 1): NL → GraphSpec zero-shot composition.
 */
export async function runLLMDXEval(config: EvalConfig): Promise<EvalRun> {
	const tasks = await loadCorpus<EvalTask>("nl-to-spec", config);
	const template = await loadTemplate("graphspec-treatment", config);
	const rubric = await loadRubric(join(config.specEvalsPath, "rubrics", "l1-llm-dx.json"));
	const validityPrompt = await loadJudgePrompt("validity", config);

	const results: TaskResult[] = [];

	for (const task of tasks) {
		console.log(`  [L1] Task: ${task.id}`);

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

			if (valid) {
				const execution = await executeSpec(spec);
				runnable = execution.runnable;
			}
		} catch {
			// Invalid JSON
		}

		// Judge scoring
		const { scores } = await scoreRubric(
			rubric.filter((r) => r.metric === "L1-M1"),
			validityPrompt,
			{ OUTPUT: response.content },
			config,
		);

		results.push({
			task_id: task.id,
			treatment: "single",
			raw_output: response.content,
			valid,
			runnable,
			judge_scores: scores,
			latency_ms: response.latencyMs,
			token_count: {
				input: response.inputTokens,
				output: response.outputTokens,
			},
		});
	}

	// Aggregate: L1-M1 = % valid and runnable
	const validRate = results.filter((r) => r.valid).length / results.length;
	const runnableRate = results.filter((r) => r.runnable).length / results.length;

	// L1-M4: hallucination rate (from judge scores)
	const hallucinations = results.filter((r) =>
		r.judge_scores.some((s) => s.claim.includes("catalog") && !s.pass),
	);
	const hallucinationRate = hallucinations.length / results.length;

	return {
		run_id: `l1-${Date.now()}`,
		timestamp: new Date().toISOString(),
		layer: "L1",
		model: config.model,
		schema_version: "scaffold",
		scores: {
			"L1-M1-valid-rate": validRate,
			"L1-M1-runnable-rate": runnableRate,
			"L1-M4-hallucination-rate": hallucinationRate,
		},
		tasks: results,
	};
}
