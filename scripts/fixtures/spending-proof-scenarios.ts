/** D171 frozen passive schedules. These declare offline preparation, never a live execution grant. */
import type { Evaluation, SpendingBinding } from "../../examples/spending-alerts/causal-inputs.js";
import {
	type ProofExpectation,
	proofCanonical,
	proofFacts,
	proofFreeze,
	proofHash,
} from "./spending-proof-verifier.js";

export type ProofStep =
	| {
			readonly kind: "feed";
			readonly lane: "pack" | "arrivals" | "current" | "verification" | "local";
			readonly value: unknown;
	  }
	| { readonly kind: "drain" }
	| { readonly kind: "settle"; readonly call: number; readonly result: "full" | "short" | "reject" }
	| { readonly kind: "checkpoint"; readonly label: string; readonly expectedCalls: number };
export interface ProofScenario {
	readonly id: string;
	readonly family: "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8";
	readonly evaluations: readonly Evaluation[];
	readonly mutation:
		| "none"
		| "sample-to-population"
		| "equivalent-score"
		| "cli-title"
		| "missing-terminal-report"
		| "missing-business-branch"
		| "wrong-admission-outcome";
	readonly steps: readonly ProofStep[];
	readonly expected: ProofExpectation;
	readonly scope: string;
}
const numericMutationTargets = {
	"sample-to-population": {
		path: "examples/spending-alerts/causal-numeric.ts",
		symbol: "exactZScore",
		from: "rounded(delta * delta * (n - 1n), n * d, 0, true)",
		to: "rounded(delta * delta * n, n * d, 0, true)",
		scope:
			"Changes actual sample score to population score; displayed sample std expression is unchanged.",
	},
	"equivalent-score": {
		path: "examples/spending-alerts/causal-numeric.ts",
		symbol: "exactZScore",
		from: "rounded(delta * delta * (n - 1n), n * d, 0, true)",
		to: "rounded(delta * delta * n - delta * delta, n * d, 0, true)",
		scope:
			"Exact BigInt algebra preserves the rational and RN64 rounding; loaded source bytes change.",
	},
};
const edit = (path: string, from: string, to: string) => ({ path, from, to });
export const proofMutationTargets = proofFreeze({
	"sample-to-population": {
		...numericMutationTargets["sample-to-population"],
		arms: {
			graph: [numericMutationTargets["sample-to-population"]],
			plain: [
				edit(
					"scripts/fixtures/spending-numeric-plain.ts",
					"delta * delta * (n - 1n)",
					"delta * delta * n",
				),
			],
		},
	},
	"equivalent-score": {
		...numericMutationTargets["equivalent-score"],
		arms: {
			graph: [numericMutationTargets["equivalent-score"]],
			plain: [
				edit(
					"scripts/fixtures/spending-numeric-plain.ts",
					"delta * delta * (n - 1n)",
					"delta * delta * n - delta * delta",
				),
			],
		},
	},
	"cli-title": {
		...edit(
			"examples/spending-alerts/causal-graded-demo.ts",
			'"offline-spending-app"',
			'"proof-cli-title-only"',
		),
		scope:
			"Outside proof-worker closure. No algorithm-preservation or whole-repository attestation.",
		arms: {
			graph: [
				edit(
					"examples/spending-alerts/causal-graded-demo.ts",
					'"offline-spending-app"',
					'"proof-cli-title-only"',
				),
			],
			plain: [
				edit(
					"examples/spending-alerts/causal-graded-demo.ts",
					'"offline-spending-app"',
					'"proof-cli-title-only"',
				),
			],
		},
	},
	"missing-terminal-report": {
		scope:
			"Explanation business runs; only its terminal report is suppressed. Effect can succeed but lifecycle stays pending.",
		arms: {
			graph: [
				edit(
					"examples/spending-alerts/causal-admission.ts",
					"for (let i = 0; i < 3; i++)",
					"for (const i of [0, 2])",
				),
			],
			plain: [
				edit(
					"scripts/fixtures/spending-preset-plain.ts",
					'for (const branch of ["assessment", "explanation"])',
					'for (const branch of ["assessment"])',
				),
			],
		},
	},
	"missing-business-branch": {
		scope:
			"Graph reasonFactors emits no business rows, withholding alertMessage/assessment/material. Plain monolithic business result is withheld along with dependent reports; identity input is retained, no invented terminal.",
		arms: {
			graph: [
				edit(
					"examples/spending-alerts/causal-business.ts",
					'if (rows.length || issues.length) ctx.down([["DATA", frame(rows, issues)]]);',
					'if (name !== "reasonFactors" && (rows.length || issues.length)) ctx.down([["DATA", frame(rows, issues)]]);',
				),
			],
			plain: [
				edit(
					"scripts/fixtures/spending-preset-plain.ts",
					"const result = plainBusiness(e);",
					"if (true) continue;\n\t\t\t\tconst result = plainBusiness(e);",
				),
				edit(
					"scripts/fixtures/spending-preset-plain.ts",
					"for (const id of arrived) this.terminal(id, branch);",
					"for (const id of arrived) if (this.assessments.has(id)) this.terminal(id, branch);",
				),
				edit(
					"scripts/fixtures/spending-preset-plain.ts",
					"if (!this.domains.has(e.occurrence.revisionDomain)) continue;",
					"if (!b || !this.domains.has(e.occurrence.revisionDomain)) continue;",
				),
			],
		},
	},
	"wrong-admission-outcome": {
		scope:
			"Transport and host record succeed, but completion delivery alters admission identity; authority must retain pending effect.",
		arms: {
			graph: [
				edit(
					"examples/spending-alerts/causal-admission.ts",
					'if (f.valid) for (const outcome of f.value.outcomes) emit([["DATA", outcome]]);',
					'if (f.valid) for (const outcome of f.value.outcomes) emit([["DATA", { ...outcome, admissionRef: { kind: "spending-admission", id: "wrong-admission" } }]]);',
				),
			],
			plain: [
				edit(
					"scripts/fixtures/spending-preset-plain.ts",
					"for (const o of incomingOutcomes) {",
					'for (const item of incomingOutcomes) { const o = { ...item, admissionRef: { kind: "spending-admission", id: "wrong-admission" } };',
				),
			],
		},
	},
});

/** Construct passive frozen inputs independently of either arm's fixture/material helpers. */
export function proofEvaluation(
	options: {
		id?: string;
		vendor?: string;
		revision?: number;
		amounts?: readonly number[];
		threshold?: number;
		dailyAverage?: number;
	} = {},
): Evaluation {
	const vendor = options.vendor ?? "coffee";
	const revision = options.revision ?? 1;
	const id = options.id ?? `proof-${vendor}-${revision}`;
	const prefix = (options.amounts ?? [1, 2, 3]).map((amount, i) => ({
		id: `${id}:tx${i}`,
		vendor,
		category: "coffee",
		amount,
		timestampIso: "2026-09-14T00:00:00.000Z",
	}));
	const profile = { dailyAverage: options.dailyAverage ?? 100, typicalCategories: ["coffee"] };
	const profileRef = { kind: "profile", id: `profile-${revision}` };
	const policy = { zThreshold: options.threshold ?? 0.9, dailyRatioThreshold: 100 };
	const value = {
		evaluationRef: id,
		subjectRef: id,
		inputDigest: proofHash(proofCanonical({ profileRef, profile, prefix })),
		profileRef,
		profile,
		policyRef: { kind: "policy", id: `policy-${revision}` },
		policyDigest: proofHash(proofCanonical(policy)),
		policy,
		prefix,
	};
	const coordinates = {
		revisionDomain: `proof-${vendor}`,
		occurrenceId: id,
		revision,
		sourceRefs: [{ kind: "evaluation", id }],
	};
	return proofFreeze({
		...value,
		occurrence: {
			...coordinates,
			digest: proofHash(
				proofCanonical({
					schemaRevision: "graphrefly/causal-occurrence-contract/v1@contract-v2",
					...coordinates,
					value,
				}),
			),
		},
	});
}
const feed = (lane: Extract<ProofStep, { kind: "feed" }>["lane"], value: unknown): ProofStep => ({
	kind: "feed",
	lane,
	value,
});
const drain: ProofStep = { kind: "drain" };
const checkpoint = (label: string, expectedCalls = 0): ProofStep => ({
	kind: "checkpoint",
	label,
	expectedCalls,
});
const settle = (call: number, result: "full" | "short" | "reject" = "full"): ProofStep => ({
	kind: "settle",
	call,
	result,
});

/** Logical schedules use a held transport: only settle steps release a call; short adds one byte. */
export function proofScenarios(binding: SpendingBinding): readonly ProofScenario[] {
	const normal = proofEvaluation({ threshold: 1.1 });
	const alert = proofEvaluation();
	const pack = (evaluations: readonly Evaluation[]) =>
		feed("pack", { format: "spending-input-v1", binding, evaluations });
	const arrivals = (e: Evaluation) =>
		feed("arrivals", { packRef: binding.packRef, evaluationRefs: [e.evaluationRef] });
	const begin = (e: Evaluation, previousCalls = 0) => {
		const facts = proofFacts(e, binding);
		return [
			feed("current", facts.current),
			feed("local", facts.local),
			arrivals(e),
			drain,
			checkpoint(`business-observed:${e.evaluationRef}`, previousCalls),
		];
	};
	const verify = (e: Evaluation) => [
		feed("verification", proofFacts(e, binding).verification),
		drain,
	];
	const stop = (e: Evaluation) => [
		feed("local", { ...proofFacts(e, binding).local, stop: true }),
		drain,
	];
	const attempt = (
		e: Evaluation,
		outcome: ProofExpectation["attempts"][number]["outcome"] = "succeeded",
		readback: "full" | number = "full",
	) => ({ evaluationRef: e.evaluationRef, outcome, readback });
	const success = [
		pack([alert]),
		drain,
		...begin(alert),
		...verify(alert),
		settle(0),
		drain,
		...stop(alert),
	];
	const cases: ProofScenario[] = [];
	const add = (
		id: string,
		family: ProofScenario["family"],
		evaluations: readonly Evaluation[],
		steps: readonly ProofStep[],
		expected: ProofExpectation,
		scope: string,
		mutation: ProofScenario["mutation"] = "none",
	) =>
		cases.push({
			id,
			family,
			evaluations,
			steps,
			expected: {
				...expected,
				checkpoints: steps.flatMap((step) =>
					step.kind === "checkpoint"
						? [{ label: step.label, attemptedCalls: step.expectedCalls }]
						: [],
				),
			},
			scope,
			mutation,
		});
	const quiet = { business: "match" as const, attempts: [], normalEndReady: false };
	add(
		"S1-baseline",
		"S1",
		[normal],
		[pack([normal]), drain, ...begin(normal), ...verify(normal), ...stop(normal)],
		{ ...quiet, normalEndReady: true },
		"Positive no-mutation control: sample=1, threshold=1.1, no alert.",
	);
	add(
		"S1-score-mutant",
		"S1",
		[normal],
		[pack([normal]), drain, ...begin(normal), ...verify(normal), ...stop(normal)],
		{ ...quiet, business: "mismatch" },
		"Actual score mutation changes 1 to about 1.224; verifier must reject observed business before a write.",
		"sample-to-population",
	);
	add(
		"S2-baseline",
		"S2",
		[alert],
		success,
		{ business: "match", attempts: [attempt(alert)], normalEndReady: true },
		"Positive unmodified full request/readback control.",
	);
	add(
		"S2-equivalent",
		"S2",
		[alert],
		success,
		{ business: "match", attempts: [attempt(alert)], normalEndReady: true },
		"BigInt equivalent score rewrite, original topology, exact expected request bytes.",
		"equivalent-score",
	);

	const revisions = [
		alert,
		proofEvaluation({ vendor: "tea" }),
		proofEvaluation({ revision: 2, dailyAverage: 101 }),
		proofEvaluation({ vendor: "tea", revision: 2, dailyAverage: 102 }),
	];
	const interleaved: ProofStep[] = [pack(revisions), drain];
	for (const [i, e] of revisions.entries())
		interleaved.push(
			...begin(e, i),
			checkpoint(`await-verification:${e.evaluationRef}`, i),
			...verify(e),
			settle(i),
			drain,
		);
	interleaved.push(...stop(revisions[3]));
	add(
		"S3-interleaved-revisions",
		"S3",
		revisions,
		interleaved,
		{ business: "match", attempts: revisions.map((e) => attempt(e)), normalEndReady: true },
		"One instance; coffee/tea and policy/profile revisions interleave, pending verification precedes each exact release. This does not inject a missing internal terminal branch.",
	);
	add(
		"S3-missing-terminal-report",
		"S3",
		[alert],
		success,
		{
			business: "match",
			attempts: [attempt(alert)],
			normalEndReady: false,
			authority: [{ evaluationRef: alert.evaluationRef, outcome: "succeeded", lifecycle: false }],
		},
		"Business and effect succeed, but missing explanation terminal report keeps lifecycle pending; not a missing business input.",
		"missing-terminal-report",
	);
	add(
		"S3-missing-business-branch",
		"S3",
		[alert],
		[pack([alert]), drain, ...begin(alert), ...verify(alert), ...stop(alert)],
		{
			business: "unavailable",
			attempts: [],
			normalEndReady: false,
			authority: [{ evaluationRef: alert.evaluationRef, outcome: "absent", lifecycle: false }],
		},
		"Actual explanation business output is absent, so no complete assessment/material/request can reach the host; retained identity remains pending.",
		"missing-business-branch",
	);

	const facts = proofFacts(alert, binding);
	add(
		"S4-stale-current",
		"S4",
		[alert],
		[
			pack([alert]),
			drain,
			feed("current", {
				...facts.current,
				current: [{ ...facts.current.current[0], policyDigest: proofHash("wrong-policy") }],
			}),
			feed("local", facts.local),
			arrivals(alert),
			drain,
			...verify(alert),
			...stop(alert),
		],
		quiet,
		"Exact occurrence with incorrect current policy digest never establishes current admission.",
	);
	const gap = proofEvaluation({ revision: 2 });
	add(
		"S4-revision-gap",
		"S4",
		[gap],
		[pack([gap]), drain, ...begin(gap), ...verify(gap), ...stop(gap)],
		quiet,
		"Revision 2 without revision 1 retains an honest sequence gap; no quiet success or request execution.",
	);
	add(
		"S5-exact-replay",
		"S5",
		[alert],
		[
			...success.slice(0, -2),
			arrivals(alert),
			drain,
			checkpoint("read-only-analysis-replay", 1),
			...stop(alert),
		],
		{ business: "match", attempts: [attempt(alert)], normalEndReady: true },
		"Exact arrival replay in one lifecycle retains one request/write. Analysis is the read-only verifier, with no writer parameter.",
	);
	const changed = proofEvaluation({ amounts: [1, 2, 4] });
	add(
		"S5-conflicting-pack",
		"S5",
		[alert],
		[...success.slice(0, -2), pack([changed]), drain, arrivals(changed), drain, ...stop(alert)],
		{ business: "match", attempts: [attempt(alert)], normalEndReady: false },
		"Same evaluation ID changed payload cannot replace the immutable pack; existing successful record stays retained.",
	);
	for (const [suffix, result, outcome, bytes] of [
		["success", "full", "succeeded", "full"],
		["short", "short", "unknown", 1],
		["rejection", "reject", "unknown", 0],
	] as const)
		add(
			`S6-${suffix}`,
			"S6",
			[alert],
			[
				pack([alert]),
				drain,
				...begin(alert),
				...verify(alert),
				settle(0, result),
				drain,
				...stop(alert),
			],
			{
				business: "match",
				attempts: [attempt(alert, outcome, bytes)],
				normalEndReady: outcome === "succeeded",
			},
			"Independent bytes distinguish full/partial/zero readback; rejection never proves known-no-submit.",
		);
	add(
		"S6-unreturned",
		"S6",
		[alert],
		[pack([alert]), drain, ...begin(alert), ...verify(alert), ...stop(alert)],
		{ business: "match", attempts: [attempt(alert, "pending", 0)], normalEndReady: false },
		"Unreturned writer retains one exact pending request despite stop.",
	);
	add(
		"S6-known-no-submit",
		"S6",
		[alert],
		[
			pack([alert]),
			drain,
			feed("current", facts.current),
			feed("local", { ...facts.local, stop: true }),
			arrivals(alert),
			drain,
			...verify(alert),
		],
		{
			...quiet,
			normalEndReady: true,
			authority: [{ evaluationRef: alert.evaluationRef, outcome: "rejected", lifecycle: true }],
		},
		"Stop is present before admission; no transport call is attempted.",
	);
	add(
		"S6-wrong-admission-outcome",
		"S6",
		[alert],
		success,
		{
			business: "match",
			attempts: [attempt(alert)],
			normalEndReady: false,
			authority: [{ evaluationRef: alert.evaluationRef, outcome: "pending", lifecycle: false }],
		},
		"Full independent readback and host success do not settle an authority receiving a different admission identity.",
		"wrong-admission-outcome",
	);
	add(
		"S7-missing-verifier",
		"S7",
		[alert],
		[pack([alert]), drain, ...begin(alert), ...stop(alert)],
		quiet,
		"Absent independent verification is not an implicit pass.",
	);
	add(
		"S7-missing-current",
		"S7",
		[alert],
		[
			pack([alert]),
			drain,
			feed("local", facts.local),
			arrivals(alert),
			drain,
			checkpoint(`business-observed:${alert.evaluationRef}`),
			...verify(alert),
			...stop(alert),
		],
		quiet,
		"No current lane fact is supplied: valid business, verification and local grant cannot substitute for currentness.",
	);
	add(
		"S7-stale-source",
		"S7",
		[alert],
		[
			pack([alert]),
			drain,
			...begin(alert),
			feed("verification", {
				...facts.verification,
				receipts: [{ ...facts.verification.receipts[0], sourceDigest: proofHash("stale-source") }],
			}),
			drain,
			...stop(alert),
		],
		quiet,
		"Receipt with stale source binding is not refreshed from a nominal candidate pass.",
	);
	add(
		"S7-over-capacity",
		"S7",
		[alert],
		[
			pack(Array.from({ length: 65 }, () => alert)),
			drain,
			...begin(alert),
			...verify(alert),
			...stop(alert),
		],
		{ ...quiet, business: "unavailable" },
		"Invalid over-capacity pack yields no business proof, no writer call, no normal end.",
	);
	add(
		"S8-normal",
		"S8",
		[normal],
		[pack([normal]), drain, ...begin(normal), ...verify(normal), ...stop(normal)],
		{ ...quiet, normalEndReady: true },
		"Known category, daily ratio below threshold, normal sample score: no request.",
	);
	add(
		"S8-cli-title",
		"S8",
		[alert],
		success,
		{ business: "match", attempts: [attempt(alert)], normalEndReady: true },
		"CLI-title source is outside proof-worker closure; do not infer arbitrary source equivalence.",
		"cli-title",
	);
	return proofFreeze(cases);
}
