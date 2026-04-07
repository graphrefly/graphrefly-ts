/**
 * LLM-as-judge module.
 *
 * Loads rubric assertions and judge prompt templates from the spec repo,
 * then uses an LLM to evaluate each assertion against the generated output.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { callLLM, extractJSON } from "./llm-client.js";
import type { EvalConfig, JudgeScore, RubricAssertion } from "./types.js";

export async function loadRubric(rubricPath: string): Promise<RubricAssertion[]> {
	const raw = await readFile(rubricPath, "utf-8");
	return JSON.parse(raw);
}

export async function loadJudgePrompt(templateName: string, config: EvalConfig): Promise<string> {
	const path = join(config.specEvalsPath, "templates", "judge-prompts", `${templateName}.md`);
	return readFile(path, "utf-8");
}

/**
 * Run a single judge assertion against an LLM output.
 */
export async function judgeAssertion(
	assertion: RubricAssertion,
	judgePromptTemplate: string,
	variables: Record<string, string>,
	config: EvalConfig,
): Promise<JudgeScore> {
	// Interpolate variables into the judge prompt
	let prompt = judgePromptTemplate;
	for (const [key, value] of Object.entries(variables)) {
		prompt = prompt.replaceAll(`{{${key}}}`, value);
	}

	const response = await callLLM(
		{
			system: "You are an eval judge. Evaluate the claim and respond with JSON only.",
			user: `${prompt}\n\nClaim to evaluate: "${assertion.claim}"`,
			model: config.judgeModel,
		},
		config,
		config.judgeProvider,
	);

	try {
		const parsed = JSON.parse(extractJSON(response.content));
		return {
			claim: assertion.claim,
			pass: parsed.pass ?? false,
			reasoning: parsed.reasoning ?? "",
		};
	} catch {
		return {
			claim: assertion.claim,
			pass: false,
			reasoning: `Judge response was not valid JSON: ${response.content.slice(0, 200)}`,
		};
	}
}

/**
 * Score a full rubric against an output, returning weighted aggregate.
 */
export async function scoreRubric(
	assertions: RubricAssertion[],
	judgePromptTemplate: string,
	variables: Record<string, string>,
	config: EvalConfig,
): Promise<{ scores: JudgeScore[]; weightedScore: number }> {
	const scores: JudgeScore[] = [];

	// Run assertions sequentially to avoid rate limits
	for (const assertion of assertions) {
		const score = await judgeAssertion(assertion, judgePromptTemplate, variables, config);
		scores.push(score);
	}

	const totalWeight = assertions.reduce((sum, a) => sum + a.weight, 0);
	const weightedScore =
		assertions.reduce((sum, a, i) => sum + (scores[i].pass ? a.weight : 0), 0) / totalWeight;

	return { scores, weightedScore };
}
