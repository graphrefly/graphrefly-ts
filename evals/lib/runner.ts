/**
 * Core eval orchestrator.
 *
 * Loads corpora from the spec repo, runs tasks through the LLM,
 * validates outputs, scores with the judge, and produces results.
 *
 * - `runLLMDXEval`: L1 generation (NL → GraphSpec zero-shot composition)
 * - `runComprehensionEval`: L1 comprehension (debug/modify/explain existing graphs)
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { estimateTokenCost, totalCost } from "./cost.js";
import { loadJudgePrompt, loadRubric, scoreRubric } from "./judge.js";
import { callLLM, extractJSON } from "./llm-client.js";
import type {
	BugTask,
	EvalConfig,
	EvalRun,
	EvalTask,
	ModificationTask,
	TaskResult,
} from "./types.js";
import { executeSpec, validateSpec } from "./validator.js";

async function loadCorpus<T>(name: string, config: EvalConfig): Promise<T[]> {
	const raw = await readFile(join(config.specEvalsPath, "corpus", `${name}.json`), "utf-8");
	return JSON.parse(raw);
}

async function loadTemplate(name: string, config: EvalConfig): Promise<string> {
	return readFile(join(config.specEvalsPath, "templates", `${name}.md`), "utf-8");
}

function addCost(result: TaskResult, model: string): void {
	if (result.token_count) {
		result.cost_usd = estimateTokenCost(result.token_count.input, result.token_count.output, model);
	}
}

// ---------------------------------------------------------------------------
// L1 Generation: NL → GraphSpec zero-shot composition
// ---------------------------------------------------------------------------

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
		console.log(`  [L1-gen] Task: ${task.id}`);

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
				const execution = executeSpec(spec);
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

		const result: TaskResult = {
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
		};
		addCost(result, config.model);
		results.push(result);
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
		run_id: `l1-gen-${Date.now()}`,
		timestamp: new Date().toISOString(),
		layer: "L1",
		model: config.model,
		provider: config.provider,
		schema_version: "scaffold",
		scores: {
			"L1-M1-valid-rate": validRate,
			"L1-M1-runnable-rate": runnableRate,
			"L1-M4-hallucination-rate": hallucinationRate,
		},
		tasks: results,
		total_cost_usd: totalCost(results.map((r) => r.cost_usd)),
	};
}

// ---------------------------------------------------------------------------
// L1 Comprehension: debug / modify / explain existing graphs
// ---------------------------------------------------------------------------

/**
 * Run a modification task: give the LLM an existing spec + NL instruction,
 * score the delta against expected changes.
 */
async function runModificationTask(
	task: ModificationTask,
	template: string,
	_judgePrompt: string,
	config: EvalConfig,
): Promise<TaskResult> {
	const specJson = JSON.stringify(task.base_spec, null, 2);
	const prompt = template
		.replace("{{BASE_SPEC}}", specJson)
		.replace("{{NL_MODIFICATION}}", task.nl_modification);

	const response = await callLLM(
		{
			system:
				"You are modifying an existing GraphSpec. Return the FULL modified GraphSpec as JSON only.",
			user: prompt,
		},
		config,
	);

	let valid = false;
	try {
		const spec = JSON.parse(extractJSON(response.content));
		valid = validateSpec(spec).valid;
	} catch {
		// Invalid JSON
	}

	return {
		task_id: task.id,
		treatment: "single",
		raw_output: response.content,
		valid,
		runnable: valid,
		judge_scores: [],
		latency_ms: response.latencyMs,
		token_count: {
			input: response.inputTokens,
			output: response.outputTokens,
		},
	};
}

/**
 * Run a bug-finding task: give the LLM a buggy spec, score whether it
 * correctly identifies and fixes the bug.
 */
async function runBugTask(
	task: BugTask,
	_judgePrompt: string,
	config: EvalConfig,
): Promise<{ graphResult: TaskResult; funcResult: TaskResult }> {
	const specJson = JSON.stringify(task.graphspec_bug.spec, null, 2);

	// GraphSpec treatment
	const graphResponse = await callLLM(
		{
			system:
				"You are debugging a GraphSpec. Find all bugs and explain each one. For each bug, state what's wrong and suggest a fix. Respond in JSON: { bugs: [{ location, issue, fix }] }",
			user: `${task.description}\n\nGraphSpec:\n${specJson}`,
		},
		config,
	);

	const graphFoundBug = graphResponse.content
		.toLowerCase()
		.includes(task.graphspec_bug.bug_location.split("—")[0].trim().toLowerCase());

	const graphResult: TaskResult = {
		task_id: task.id,
		treatment: "graphspec",
		raw_output: graphResponse.content,
		valid: true, // Bug-finding always produces valid output (prose/JSON)
		runnable: true,
		judge_scores: [
			{
				claim: "Found the seeded bug",
				pass: graphFoundBug,
				reasoning: graphFoundBug ? "Bug location mentioned" : "Bug location not found in output",
			},
		],
		latency_ms: graphResponse.latencyMs,
		token_count: {
			input: graphResponse.inputTokens,
			output: graphResponse.outputTokens,
		},
	};

	// Functions treatment
	const funcResponse = await callLLM(
		{
			system:
				"You are debugging TypeScript code. Find all bugs and explain each one. For each bug, state what's wrong and suggest a fix. Respond in JSON: { bugs: [{ location, issue, fix }] }",
			user: `${task.description}\n\nCode:\n${task.functions_bug.code}`,
		},
		config,
	);

	const funcFoundBug = funcResponse.content
		.toLowerCase()
		.includes(task.functions_bug.bug_location.split("—")[0].trim().toLowerCase());

	const funcResult: TaskResult = {
		task_id: task.id,
		treatment: "functions",
		raw_output: funcResponse.content,
		valid: true,
		runnable: true,
		judge_scores: [
			{
				claim: "Found the seeded bug",
				pass: funcFoundBug,
				reasoning: funcFoundBug ? "Bug location mentioned" : "Bug location not found in output",
			},
		],
		latency_ms: funcResponse.latencyMs,
		token_count: {
			input: funcResponse.inputTokens,
			output: funcResponse.outputTokens,
		},
	};

	return { graphResult, funcResult };
}

/**
 * Run the full L1 comprehension eval.
 *
 * Sub-evals:
 * - Modification tasks (nl-mod corpus): can the LLM modify an existing graph?
 * - Bug-finding tasks (contrastive-bugs corpus): can the LLM spot bugs?
 */
export async function runComprehensionEval(config: EvalConfig): Promise<EvalRun> {
	const modTasks = await loadCorpus<ModificationTask>("nl-mod", config);
	const bugTasks = await loadCorpus<BugTask>("contrastive-bugs", config);
	const diffPrompt = await loadJudgePrompt("diff-accuracy", config);
	const bugPrompt = await loadJudgePrompt("bug-localization", config);

	const results: TaskResult[] = [];

	// Modification tasks
	const modTemplate = `Given this GraphSpec:\n\`\`\`json\n{{BASE_SPEC}}\n\`\`\`\n\nModification requested: {{NL_MODIFICATION}}\n\nReturn the modified GraphSpec as valid JSON.`;

	for (const task of modTasks) {
		console.log(`  [L1-comp] Mod task: ${task.id}`);
		const result = await runModificationTask(task, modTemplate, diffPrompt, config);
		addCost(result, config.model);
		results.push(result);
	}

	// Bug-finding tasks
	for (const task of bugTasks) {
		console.log(`  [L1-comp] Bug task: ${task.id}`);
		const { graphResult, funcResult } = await runBugTask(task, bugPrompt, config);
		addCost(graphResult, config.model);
		addCost(funcResult, config.model);
		results.push(graphResult, funcResult);
	}

	// Aggregate scores
	const modResults = results.filter((r) => modTasks.some((t) => t.id === r.task_id));
	const bugGraphResults = results.filter(
		(r) => r.treatment === "graphspec" && bugTasks.some((t) => t.id === r.task_id),
	);
	const bugFuncResults = results.filter(
		(r) => r.treatment === "functions" && bugTasks.some((t) => t.id === r.task_id),
	);

	const modValidRate =
		modResults.length > 0 ? modResults.filter((r) => r.valid).length / modResults.length : 0;
	const graphBugDetection =
		bugGraphResults.length > 0
			? bugGraphResults.filter((r) => r.judge_scores.some((s) => s.pass)).length /
				bugGraphResults.length
			: 0;
	const funcBugDetection =
		bugFuncResults.length > 0
			? bugFuncResults.filter((r) => r.judge_scores.some((s) => s.pass)).length /
				bugFuncResults.length
			: 0;

	return {
		run_id: `l1-comp-${Date.now()}`,
		timestamp: new Date().toISOString(),
		layer: "L1",
		model: config.model,
		provider: config.provider,
		schema_version: "scaffold",
		scores: {
			"L1-comp-mod-valid-rate": modValidRate,
			"L1-comp-bug-graphspec-detection": graphBugDetection,
			"L1-comp-bug-functions-detection": funcBugDetection,
		},
		tasks: results,
		total_cost_usd: totalCost(results.map((r) => r.cost_usd)),
	};
}
