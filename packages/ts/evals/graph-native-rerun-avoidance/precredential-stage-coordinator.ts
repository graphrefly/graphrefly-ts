export type RootEvalLiveOperatorMode =
	| "--prepare-browser"
	| "--qualify-private-inputs"
	| "--execute-live";

export type RootEvalPrecredentialStage =
	| "long-gates"
	| "bounded-currentness"
	| "persist-receipt"
	| "private-input-admission"
	| "control-plane-admission"
	| "claim"
	| "campaign";

const ROOT_EVAL_PRECREDENTIAL_STAGE_PLANS = Object.freeze({
	"--prepare-browser": Object.freeze([
		"long-gates",
		"bounded-currentness",
		"persist-receipt",
	] as const),
	"--qualify-private-inputs": Object.freeze([
		"bounded-currentness",
		"private-input-admission",
	] as const),
	"--execute-live": Object.freeze([
		"bounded-currentness",
		"private-input-admission",
		"control-plane-admission",
		"claim",
		"campaign",
	] as const),
});

export function rootEvalPrecredentialStagePlan(
	mode: RootEvalLiveOperatorMode,
): readonly RootEvalPrecredentialStage[] {
	return ROOT_EVAL_PRECREDENTIAL_STAGE_PLANS[mode];
}

export async function runRootEvalPrecredentialStagePlan(input: {
	readonly mode: RootEvalLiveOperatorMode;
	readonly run: (stage: RootEvalPrecredentialStage) => Promise<void>;
}): Promise<readonly RootEvalPrecredentialStage[]> {
	const completed: RootEvalPrecredentialStage[] = [];
	for (const stage of rootEvalPrecredentialStagePlan(input.mode)) {
		await input.run(stage);
		completed.push(stage);
	}
	return Object.freeze(completed);
}
