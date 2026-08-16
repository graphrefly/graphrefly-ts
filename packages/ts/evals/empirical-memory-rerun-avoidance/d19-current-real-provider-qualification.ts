import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";
import { persistCurrentGraphPrivateGeneration } from "./d6-current-private-persistence.js";
import type { D17EffectResultInputV1 } from "./d17-current-efficacy-authority.js";
import { createD18OneEffectAdapter } from "./d18-current-injected-provider-adapter.js";
import {
	admitD18EffectResult,
	createD18Authority,
	D18_DECISION_REF,
	D18_INSPECTION_PATHS,
	D18_WRITABLE_PATH,
	type D18AdmittedEffectV1,
	type D18AuthorityV1,
	type D18EvidenceV1,
	type D18RetryPolicy,
	snapshotD18Evidence,
	takeD18Effect,
	validateD18Evidence,
} from "./d18-current-provider-composition-authority.js";
import {
	D18_BUNDLE_SCHEMA,
	validateD18QualificationBundle,
} from "./d18-current-provider-composition-qualification.js";
import {
	createD19ProviderPort,
	createD19RealProviderAdapter,
	D19_BUGGY_ADMISSION_BLOCK,
	D19_FIXED_ADMISSION_BLOCK,
	D19_OPENROUTER_ENDPOINT,
} from "./d19-current-real-provider-adapter.js";
import { D19_IMPLEMENTATION_MANIFEST_DIGEST } from "./d19-current-real-provider-implementation-manifest.js";

export const D19_DECISION_REF = "graphrefly-ts:D19" as const;
export const D19_D18_BASELINE_ARTIFACT_DIGEST =
	"sha256:87ac26d0ac063a8deac024bf5517ae5f9aadbcbbbe5c4e74b461b12b171f97e3" as const;
export const D19_D18_BASELINE_BUNDLE_DIGEST =
	"sha256:0ad500af39ddb6418b25393b14b582732f98a76c27f04fe1d039c9193cbd911a" as const;
export const D19_D18_IMPLEMENTATION_MANIFEST_DIGEST =
	"sha256:29b9ba51e32082f6ecf8ce97479be6ff4985173a8dcce8bab7772800766d89a0" as const;
export const D19_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d19.current-real-provider-qualification.v1" as const;
export const D19_BUNDLE_SCHEMA =
	"graphrefly-ts.d19.current-real-provider-qualification-bundle.v1" as const;
export const D19_GENERATION_SCHEMA =
	"graphrefly-ts.d19.current-real-provider-generation.v1" as const;
export const D19_GENERATION_REF =
	"current-graph-native-real-provider-no-network-2026-08-16-d19-v3" as const;
export const D19_INJECTED_TEST_GENERATION_REF =
	"current-graph-native-real-provider-injected-test-2026-08-16-d19-v3" as const;

export interface D19D18BaselineAdmissionV1 {
	readonly revision: "graphrefly-ts.d19.d18-baseline-admission.v1";
}

export interface D19QualificationBundleV1 {
	readonly schemaVersion: typeof D19_BUNDLE_SCHEMA;
	readonly baseline: Readonly<{
		artifactDigest: typeof D19_D18_BASELINE_ARTIFACT_DIGEST;
		bundleDigest: typeof D19_D18_BASELINE_BUNDLE_DIGEST;
		implementationManifestDigest: typeof D19_D18_IMPLEMENTATION_MANIFEST_DIGEST;
		basis: "exact-private-artifact" | "injected-test";
	}>;
	readonly implementationManifestDigest: string;
	readonly graphEvidence: D18EvidenceV1;
	readonly retryEvidence: Readonly<{ D671: D18EvidenceV1; D675: D18EvidenceV1 }>;
	readonly failureProjections: Readonly<{
		terminalHttp: D19FailureProjectionV1;
		decode: D19FailureProjectionV1;
		cancelledTransport: D19FailureProjectionV1;
	}>;
	readonly qualification: Readonly<{
		schemaVersion: typeof D19_QUALIFICATION_SCHEMA;
		decisionRef: typeof D19_DECISION_REF;
		baselineDecisionRef: typeof D18_DECISION_REF;
		externalNetworkCalls: 0;
		injectedTransportCalls: number;
		armOrder: readonly string[];
		fullRealLocalLifecyclePassed: true;
		publicSemanticIndependentPassed: true;
		hiddenVerifierPassed: true;
		retryPoliciesPassed: readonly ["D671", "D675", "D710"];
		sameBodyRetryPassed: true;
		terminalFailureCleanupAndNextArmPassed: true;
		decodeFailureCleanupAndNextArmPassed: true;
		cancelledTransportCleanupAndNextArmPassed: true;
		maxActiveEffects: 1;
		workspaceResidueCount: 0;
		liveGateEvaluated: false;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		qualificationDigest: string;
	}>;
	readonly generation: Readonly<{
		schemaVersion: typeof D19_GENERATION_SCHEMA;
		generationRef: typeof D19_GENERATION_REF | typeof D19_INJECTED_TEST_GENERATION_REF;
		graphEvidenceDigest: string;
		qualificationDigest: string;
		implementationManifestDigest: string;
		generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

export interface D19FailureProjectionV1 {
	readonly schemaVersion: "graphrefly-ts.d19.failure-projection.v1";
	readonly scenario: "terminal-http" | "decode" | "cancelled-transport";
	readonly graphEvidenceDigest: string;
	readonly providerAttempts: number;
	readonly conservativeCostMicrousd: number;
	readonly runs: readonly Readonly<{
		arm: string;
		providerFailureFamily: "http" | "executor" | "transport" | null;
		cleanupCompleted: boolean;
		evaluable: boolean;
	}>[];
	readonly projectionDigest: string;
}

const exactBaselines = new WeakSet<object>();
const injectedBaselines = new WeakSet<object>();
const constructedBundles = new WeakSet<object>();

function baselineReceipt(basis: "exact-private-artifact" | "injected-test") {
	const receipt = Object.freeze({
		revision: "graphrefly-ts.d19.d18-baseline-admission.v1" as const,
	});
	(basis === "exact-private-artifact" ? exactBaselines : injectedBaselines).add(receipt);
	return receipt;
}

export function admitD19D18Baseline(bytesValue: Uint8Array): D19D18BaselineAdmissionV1 {
	if (!(bytesValue instanceof Uint8Array))
		throw new TypeError("D19 D18 baseline bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D19_D18_BASELINE_ARTIFACT_DIGEST)
		throw new TypeError("D19 D18 baseline artifact digest drifted");
	const bundle = validateD18QualificationBundle(strictJsonCodec.decode(bytes));
	if (
		bundle.schemaVersion !== D18_BUNDLE_SCHEMA ||
		bundle.bundleDigest !== D19_D18_BASELINE_BUNDLE_DIGEST ||
		bundle.implementationManifestDigest !== D19_D18_IMPLEMENTATION_MANIFEST_DIGEST ||
		bundle.baseline.basis !== "exact-private-artifact"
	)
		throw new TypeError("D19 D18 baseline canonical coordinates drifted");
	return baselineReceipt("exact-private-artifact");
}

export function createD19InjectedD18BaselineForTest(): D19D18BaselineAdmissionV1 {
	return baselineReceipt("injected-test");
}

function successResponse(body: unknown): Response {
	const candidate = record(body, "D19 injected body");
	const toolChoice = candidate.tool_choice;
	const mutation = typeof toolChoice === "object" && toolChoice !== null;
	const calls = mutation
		? [
				{
					id: "replace-1",
					type: "function",
					function: {
						name: "replace_exact",
						arguments: JSON.stringify({
							path: D18_WRITABLE_PATH,
							oldText: D19_BUGGY_ADMISSION_BLOCK,
							newText: D19_FIXED_ADMISSION_BLOCK,
						}),
					},
				},
			]
		: D18_INSPECTION_PATHS.map((path, index) => ({
				id: `read-${index}`,
				type: "function",
				function: { name: "read_file", arguments: JSON.stringify({ path }) },
			}));
	return new Response(
		JSON.stringify({
			choices: [{ message: { role: "assistant", content: null, tool_calls: calls } }],
			usage: {
				prompt_tokens: 100,
				completion_tokens: 20,
				prompt_tokens_details: { cached_tokens: 10 },
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

type InjectedScenario = D18RetryPolicy | "success" | "terminal-http" | "decode" | "cancelled";

function injectedFetch(scenario: InjectedScenario, calls: Uint8Array[]): typeof fetch {
	let first = true;
	return (async (input, init) => {
		if (input !== D19_OPENROUTER_ENDPOINT || init?.method !== "POST")
			throw new TypeError("D19 injected route drifted");
		if (!(init.body instanceof Uint8Array)) throw new TypeError("D19 injected body is not bytes");
		const bytes = new Uint8Array(init.body);
		calls.push(bytes);
		const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
		if (first) {
			first = false;
			if (scenario === "D675") {
				const error = new TypeError("injected socket");
				Object.defineProperty(error, "cause", { value: { code: "UND_ERR_SOCKET" } });
				throw error;
			}
			if (scenario === "D671")
				return new Response(JSON.stringify({ error: { type: "rate_limit" } }), {
					status: 503,
					headers: { "content-type": "application/json" },
				});
			if (scenario === "D710")
				return new Response(JSON.stringify({ error: { message: "retry" } }), {
					status: 429,
					headers: { "content-type": "application/json" },
				});
			if (scenario === "terminal-http")
				return new Response(JSON.stringify({ error: { type: "invalid_request" } }), {
					status: 400,
					headers: { "content-type": "application/json" },
				});
			if (scenario === "decode")
				return new Response("not-json", {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			if (scenario === "cancelled") throw new DOMException("injected", "AbortError");
		}
		return successResponse(body);
	}) as typeof fetch;
}

function digestOf(kind: string, value: unknown): string {
	return empiricalStrictJsonDigest({ kind, value });
}

function scriptedLocalPorts() {
	return {
		local: async (
			effect: Extract<D18AdmittedEffectV1, { kind: "workflow-local" }>,
			material: any,
		) => {
			const request = effect.workflowEffect.request;
			const state = digestOf("D19 scripted workspace", request.arm);
			let result: D17EffectResultInputV1;
			let runtimeMaterial: string | undefined;
			if (request.effectKind === "materialization")
				result = {
					effectKind: "materialization",
					status: "completed",
					workspaceStateDigest: state,
					evidenceDigest: digestOf("materialization", request.requestDigest),
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
				};
			else if (request.effectKind === "tool-action") {
				if (request.toolRef === "read-file") runtimeMaterial = D19_BUGGY_ADMISSION_BLOCK;
				result = {
					effectKind: "tool-action",
					toolRef: request.toolRef!,
					status: "succeeded",
					workspaceStateBeforeDigest: state,
					workspaceStateAfterDigest: state,
					nonEmptyDiff: request.toolRef === "workspace-diff",
					evidenceDigest: digestOf("tool", [request.requestDigest, material.toolArguments]),
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
				};
			} else if (request.effectKind === "public-semantic-validation")
				result = {
					effectKind: "public-semantic-validation",
					status: "passed",
					criterionFailureCodes: [],
					workspaceStateDigest: state,
					evidenceDigest: digestOf("public", request.requestDigest),
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
				};
			else if (request.effectKind === "hidden-verifier")
				result = {
					effectKind: "hidden-verifier",
					status: "passed",
					workspaceStateDigest: state,
					evidenceDigest: digestOf("hidden", request.requestDigest),
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
				};
			else
				result = {
					effectKind: "cleanup",
					status: "completed",
					workspaceStateDigest: null,
					evidenceDigest: digestOf("cleanup", request.requestDigest),
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
				};
			return Object.freeze({
				result,
				...(runtimeMaterial === undefined ? {} : { runtimeMaterial }),
			});
		},
		retryWait: async (effect: Extract<D18AdmittedEffectV1, { kind: "retry-wait" }>) => ({
			actualElapsedMs: effect.request.delayMs,
			evidenceDigest: digestOf("wait", effect.request.requestDigest),
		}),
	};
}

async function drive(
	authority: D18AuthorityV1,
	adapter: {
		readonly execute: (
			authority: D18AuthorityV1,
			effect: D18AdmittedEffectV1,
		) => Promise<{ readonly result: unknown; readonly runtimeMaterial?: unknown }>;
	},
	validateComplete = true,
): Promise<D18EvidenceV1> {
	for (let guard = 0; guard < 512; guard += 1) {
		const effect = takeD18Effect(authority);
		if (effect === null) {
			const snapshot = snapshotD18Evidence(authority);
			return validateComplete ? validateD18Evidence(snapshot) : snapshot;
		}
		const executed = await adapter.execute(authority, effect);
		admitD18EffectResult(authority, effect, executed.result, executed.runtimeMaterial);
	}
	throw new TypeError("D19 Graph effect bound exhausted");
}

async function runScriptedScenario(scenario: InjectedScenario) {
	const calls: Uint8Array[] = [];
	const local = scriptedLocalPorts();
	const one = createD18OneEffectAdapter({
		provider: createD19ProviderPort({
			fetchImpl: injectedFetch(scenario, calls),
			bearerToken: "injected-no-network",
			now: (() => {
				let value = 0;
				return () => ++value;
			})(),
		}),
		local: local.local,
		retryWait: local.retryWait,
	});
	return Object.freeze({
		evidence: await drive(
			createD18Authority(),
			one,
			scenario === "success" || scenario === "D671" || scenario === "D675" || scenario === "D710",
		),
		calls: Object.freeze(calls.map((bytes) => new Uint8Array(bytes))),
		maxActive: one.maxActiveEffects(),
	});
}

async function runRealLocalScenario(repositoryRoot: string) {
	const temporaryRoot = await mkdtemp(join(tmpdir(), "graphrefly-d19-real-local-"));
	const calls: Uint8Array[] = [];
	let clock = 0;
	const adapter = createD19RealProviderAdapter({
		repositoryRoot,
		materializationRoot: join(temporaryRoot, "workspaces"),
		fetchImpl: injectedFetch("D710", calls),
		bearerToken: "injected-no-network",
		now: () => ++clock,
		sleep: async () => undefined,
	});
	try {
		const evidence = await drive(createD18Authority(), adapter);
		return Object.freeze({
			evidence,
			calls: Object.freeze(calls.map((bytes) => new Uint8Array(bytes))),
			maxActive: adapter.maxActiveEffects(),
			workspaceResidueCount: adapter.workspaceResidueCount(),
		});
	} finally {
		await adapter.dispose();
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

function retryProof(evidence: D18EvidenceV1, policy: D18RetryPolicy) {
	const wait = evidence.providerFacts.find(
		(fact) =>
			fact.request.schemaVersion === "graphrefly-ts.d18.retry-wait-request.v1" &&
			fact.request.retryPolicy === policy,
	);
	if (wait === undefined) throw new TypeError(`D19 ${policy} retry wait is missing`);
	const attempts = evidence.providerFacts.filter(
		(fact) =>
			fact.request.schemaVersion === "graphrefly-ts.d18.provider-attempt-request.v1" &&
			fact.request.workflowRequestDigest === wait.request.workflowRequestDigest,
	);
	if (attempts.length !== 2) throw new TypeError(`D19 ${policy} retry cardinality drifted`);
	const bodies = attempts.map((fact) => (fact.request as any).wireBodyDigest);
	if (new Set(bodies).size !== 1) throw new TypeError(`D19 ${policy} retry body drifted`);
	return strictSnapshot({ policy, waitFactDigest: wait.factDigest, wireBodyDigest: bodies[0] });
}

function assertFailureContinues(
	evidence: D18EvidenceV1,
	family: "http" | "executor" | "transport",
): void {
	if (
		evidence.workflowEvidence.runs.length !== 6 ||
		evidence.workflowEvidence.runs[0]?.providerFailureFamily !== family ||
		evidence.workflowEvidence.runs[0]?.cleanupCompleted !== true ||
		evidence.workflowEvidence.runs.slice(1).some((run) => !run.cleanupCompleted)
	)
		throw new TypeError(`D19 ${family} failure did not clean and continue`);
}

function failureProjection(
	evidence: D18EvidenceV1,
	scenario: D19FailureProjectionV1["scenario"],
	family: "http" | "executor" | "transport",
): D19FailureProjectionV1 {
	assertFailureContinues(evidence, family);
	const material = strictSnapshot({
		schemaVersion: "graphrefly-ts.d19.failure-projection.v1" as const,
		scenario,
		graphEvidenceDigest: evidence.evidenceDigest,
		providerAttempts: evidence.budget.providerAttempts,
		conservativeCostMicrousd: evidence.budget.actualCostMicrousd,
		runs: evidence.workflowEvidence.runs.map((run) => ({
			arm: run.arm,
			providerFailureFamily: run.providerFailureFamily,
			cleanupCompleted: run.cleanupCompleted,
			evaluable: run.evaluable,
		})),
	});
	return Object.freeze({ ...material, projectionDigest: empiricalStrictJsonDigest(material) });
}

export async function runD19InjectedNoNetworkQualification(input: {
	readonly baseline: D19D18BaselineAdmissionV1;
	readonly implementationManifestDigest: string;
	readonly repositoryRoot: string;
	readonly generationRef?: typeof D19_GENERATION_REF | typeof D19_INJECTED_TEST_GENERATION_REF;
}): Promise<D19QualificationBundleV1> {
	const basis = exactBaselines.has(input.baseline)
		? "exact-private-artifact"
		: injectedBaselines.has(input.baseline)
			? "injected-test"
			: null;
	if (basis === null) throw new TypeError("D19 D18 baseline admission is forged");
	const main = await runRealLocalScenario(input.repositoryRoot);
	const d671 = await runScriptedScenario("D671");
	const d675 = await runScriptedScenario("D675");
	const terminal = await runScriptedScenario("terminal-http");
	const decode = await runScriptedScenario("decode");
	const cancelled = await runScriptedScenario("cancelled");
	const retryProofs = [
		retryProof(d671.evidence, "D671"),
		retryProof(d675.evidence, "D675"),
		retryProof(main.evidence, "D710"),
	];
	const failureProjections = Object.freeze({
		terminalHttp: failureProjection(terminal.evidence, "terminal-http", "http"),
		decode: failureProjection(decode.evidence, "decode", "executor"),
		cancelledTransport: failureProjection(cancelled.evidence, "cancelled-transport", "transport"),
	});
	const runs = main.evidence.workflowEvidence.runs;
	if (
		runs.length !== 6 ||
		runs.some(
			(run) =>
				!run.mutationCompleted ||
				!run.diffCompleted ||
				!run.focusedValidationPassed ||
				!run.publicSemanticValidationPassed ||
				!run.hiddenVerifierPassed ||
				!run.cleanupCompleted,
		)
	)
		throw new TypeError("D19 real local lifecycle did not complete all six arms");
	if (main.maxActive !== 1 || main.workspaceResidueCount !== 0)
		throw new TypeError("D19 seriality or workspace cleanup drifted");
	const injectedTransportCalls =
		main.calls.length +
		d671.calls.length +
		d675.calls.length +
		terminal.calls.length +
		decode.calls.length +
		cancelled.calls.length;
	const qualificationBase = strictSnapshot({
		schemaVersion: D19_QUALIFICATION_SCHEMA,
		decisionRef: D19_DECISION_REF,
		baselineDecisionRef: D18_DECISION_REF,
		externalNetworkCalls: 0 as const,
		injectedTransportCalls,
		armOrder: runs.map((run) => run.arm),
		fullRealLocalLifecyclePassed: true as const,
		publicSemanticIndependentPassed: true as const,
		hiddenVerifierPassed: true as const,
		retryPoliciesPassed: ["D671", "D675", "D710"] as const,
		sameBodyRetryPassed: true as const,
		terminalFailureCleanupAndNextArmPassed: true as const,
		decodeFailureCleanupAndNextArmPassed: true as const,
		cancelledTransportCleanupAndNextArmPassed: true as const,
		maxActiveEffects: 1 as const,
		workspaceResidueCount: 0 as const,
		liveGateEvaluated: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = Object.freeze({
		...qualificationBase,
		qualificationDigest: empiricalStrictJsonDigest({
			...qualificationBase,
			graphEvidenceDigest: main.evidence.evidenceDigest,
			retryProofs,
			failureProjectionDigests: [
				failureProjections.terminalHttp.projectionDigest,
				failureProjections.decode.projectionDigest,
				failureProjections.cancelledTransport.projectionDigest,
			],
			implementationManifestDigest: input.implementationManifestDigest,
		}),
	});
	const generationBase = strictSnapshot({
		schemaVersion: D19_GENERATION_SCHEMA,
		generationRef: input.generationRef ?? D19_GENERATION_REF,
		graphEvidenceDigest: main.evidence.evidenceDigest,
		qualificationDigest: qualification.qualificationDigest,
		implementationManifestDigest: input.implementationManifestDigest,
	});
	const generation = Object.freeze({
		...generationBase,
		generationDigest: empiricalStrictJsonDigest(generationBase),
	});
	const base = strictSnapshot({
		schemaVersion: D19_BUNDLE_SCHEMA,
		baseline: Object.freeze({
			artifactDigest: D19_D18_BASELINE_ARTIFACT_DIGEST,
			bundleDigest: D19_D18_BASELINE_BUNDLE_DIGEST,
			implementationManifestDigest: D19_D18_IMPLEMENTATION_MANIFEST_DIGEST,
			basis,
		}),
		implementationManifestDigest: input.implementationManifestDigest,
		graphEvidence: main.evidence,
		retryEvidence: Object.freeze({ D671: d671.evidence, D675: d675.evidence }),
		failureProjections,
		qualification,
		generation,
	});
	const bundle = Object.freeze({ ...base, bundleDigest: empiricalStrictJsonDigest(base) });
	constructedBundles.add(bundle);
	return bundle;
}

function exactArmOrder(evidence: D18EvidenceV1): readonly string[] {
	const arms = evidence.workflowEvidence.runs.map((run) => run.arm);
	if (arms.length !== 6 || new Set(arms).size !== 6)
		throw new TypeError("D19 six-arm projection drifted");
	return Object.freeze(arms);
}

function validateFailureProjection(
	value: unknown,
	scenario: D19FailureProjectionV1["scenario"],
	family: "http" | "executor" | "transport",
): D19FailureProjectionV1 {
	const candidate = record(value, `D19 ${scenario} projection`);
	exactKeys(
		candidate,
		[
			"conservativeCostMicrousd",
			"graphEvidenceDigest",
			"projectionDigest",
			"providerAttempts",
			"runs",
			"scenario",
			"schemaVersion",
		],
		`D19 ${scenario} projection`,
	);
	if (
		candidate.schemaVersion !== "graphrefly-ts.d19.failure-projection.v1" ||
		candidate.scenario !== scenario ||
		typeof candidate.graphEvidenceDigest !== "string" ||
		!/^sha256:[0-9a-f]{64}$/u.test(candidate.graphEvidenceDigest) ||
		!Number.isSafeInteger(candidate.providerAttempts) ||
		(candidate.providerAttempts as number) < 1 ||
		(candidate.providerAttempts as number) > 96 ||
		!Number.isSafeInteger(candidate.conservativeCostMicrousd) ||
		(candidate.conservativeCostMicrousd as number) < 100_000 ||
		(candidate.conservativeCostMicrousd as number) > 6_000_000
	)
		throw new TypeError(`D19 ${scenario} projection coordinates drifted`);
	const runValues = array(candidate.runs, `D19 ${scenario} runs`);
	if (runValues.length !== 6) throw new TypeError(`D19 ${scenario} arm cardinality drifted`);
	const expectedArms = [
		"cold",
		"relevant-applied",
		"proposal-only",
		"admission-rejected",
		"irrelevant-applied",
		"wrong-scope-applied",
	] as const;
	const runs = runValues.map((runValue, index) => {
		const run = record(runValue, `D19 ${scenario} runs[${index}]`);
		exactKeys(
			run,
			["arm", "cleanupCompleted", "evaluable", "providerFailureFamily"],
			`D19 ${scenario} runs[${index}]`,
		);
		if (
			run.arm !== expectedArms[index] ||
			run.cleanupCompleted !== true ||
			typeof run.evaluable !== "boolean" ||
			(index === 0 ? run.providerFailureFamily !== family : run.providerFailureFamily !== null) ||
			(index === 0 && run.evaluable !== false)
		)
			throw new TypeError(`D19 ${scenario} run projection drifted`);
		return Object.freeze({
			arm: run.arm as string,
			providerFailureFamily: run.providerFailureFamily as "http" | "executor" | "transport" | null,
			cleanupCompleted: true as const,
			evaluable: run.evaluable as boolean,
		});
	});
	const material = strictSnapshot({
		schemaVersion: "graphrefly-ts.d19.failure-projection.v1" as const,
		scenario,
		graphEvidenceDigest: candidate.graphEvidenceDigest,
		providerAttempts: candidate.providerAttempts as number,
		conservativeCostMicrousd: candidate.conservativeCostMicrousd as number,
		runs,
	});
	if (candidate.projectionDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError(`D19 ${scenario} projection digest drifted`);
	return Object.freeze({ ...material, projectionDigest: candidate.projectionDigest as string });
}

export function validateD19QualificationBundle(value: unknown): D19QualificationBundleV1 {
	const candidate = record(value, "D19 bundle");
	exactKeys(
		candidate,
		[
			"baseline",
			"bundleDigest",
			"failureProjections",
			"generation",
			"graphEvidence",
			"implementationManifestDigest",
			"qualification",
			"retryEvidence",
			"schemaVersion",
		],
		"D19 bundle",
	);
	if (candidate.schemaVersion !== D19_BUNDLE_SCHEMA)
		throw new TypeError("D19 bundle schema drifted");
	const baselineValue = record(candidate.baseline, "D19 baseline");
	exactKeys(
		baselineValue,
		["artifactDigest", "basis", "bundleDigest", "implementationManifestDigest"],
		"D19 baseline",
	);
	if (
		baselineValue.artifactDigest !== D19_D18_BASELINE_ARTIFACT_DIGEST ||
		baselineValue.bundleDigest !== D19_D18_BASELINE_BUNDLE_DIGEST ||
		baselineValue.implementationManifestDigest !== D19_D18_IMPLEMENTATION_MANIFEST_DIGEST ||
		(baselineValue.basis !== "exact-private-artifact" && baselineValue.basis !== "injected-test")
	)
		throw new TypeError("D19 baseline coordinates drifted");
	const baseline = strictSnapshot(baselineValue) as D19QualificationBundleV1["baseline"];
	const graphEvidence = validateD18Evidence(candidate.graphEvidence);
	const retryValue = record(candidate.retryEvidence, "D19 retry evidence");
	exactKeys(retryValue, ["D671", "D675"], "D19 retry evidence");
	const retryEvidence = Object.freeze({
		D671: validateD18Evidence(retryValue.D671),
		D675: validateD18Evidence(retryValue.D675),
	});
	const failureValue = record(candidate.failureProjections, "D19 failure projections");
	exactKeys(
		failureValue,
		["cancelledTransport", "decode", "terminalHttp"],
		"D19 failure projections",
	);
	const failureProjections = Object.freeze({
		terminalHttp: validateFailureProjection(failureValue.terminalHttp, "terminal-http", "http"),
		decode: validateFailureProjection(failureValue.decode, "decode", "executor"),
		cancelledTransport: validateFailureProjection(
			failureValue.cancelledTransport,
			"cancelled-transport",
			"transport",
		),
	});
	const retryProofs = [
		retryProof(retryEvidence.D671, "D671"),
		retryProof(retryEvidence.D675, "D675"),
		retryProof(graphEvidence, "D710"),
	];
	const runs = graphEvidence.workflowEvidence.runs;
	if (
		runs.some(
			(run) =>
				!run.mutationCompleted ||
				!run.diffCompleted ||
				!run.focusedValidationPassed ||
				!run.publicSemanticValidationPassed ||
				!run.hiddenVerifierPassed ||
				!run.cleanupCompleted,
		)
	)
		throw new TypeError("D19 canonical real-local lifecycle drifted");
	const implementationManifestDigest = candidate.implementationManifestDigest;
	if (
		typeof implementationManifestDigest !== "string" ||
		!/^sha256:[0-9a-f]{64}$/u.test(implementationManifestDigest)
	)
		throw new TypeError("D19 implementation manifest digest is invalid");
	if (
		baseline.basis === "exact-private-artifact" &&
		implementationManifestDigest !== D19_IMPLEMENTATION_MANIFEST_DIGEST
	)
		throw new TypeError("D19 production implementation manifest drifted");
	const qualification = record(candidate.qualification, "D19 qualification");
	const expectedKeys = [
		"armOrder",
		"baselineDecisionRef",
		"cancelledTransportCleanupAndNextArmPassed",
		"causalAttribution",
		"decisionRef",
		"decodeFailureCleanupAndNextArmPassed",
		"efficacyClaim",
		"externalNetworkCalls",
		"fullRealLocalLifecyclePassed",
		"hiddenVerifierPassed",
		"injectedTransportCalls",
		"liveGateEvaluated",
		"maxActiveEffects",
		"publicSemanticIndependentPassed",
		"qualificationDigest",
		"retryPoliciesPassed",
		"sameBodyRetryPassed",
		"schemaVersion",
		"terminalFailureCleanupAndNextArmPassed",
		"workspaceResidueCount",
	] as const;
	exactKeys(qualification, expectedKeys, "D19 qualification");
	const injectedTransportCalls =
		graphEvidence.budget.providerAttempts +
		retryEvidence.D671.budget.providerAttempts +
		retryEvidence.D675.budget.providerAttempts +
		failureProjections.terminalHttp.providerAttempts +
		failureProjections.decode.providerAttempts +
		failureProjections.cancelledTransport.providerAttempts;
	const expectedQualificationBase = strictSnapshot({
		schemaVersion: D19_QUALIFICATION_SCHEMA,
		decisionRef: D19_DECISION_REF,
		baselineDecisionRef: D18_DECISION_REF,
		externalNetworkCalls: 0 as const,
		injectedTransportCalls,
		armOrder: exactArmOrder(graphEvidence),
		fullRealLocalLifecyclePassed: true as const,
		publicSemanticIndependentPassed: true as const,
		hiddenVerifierPassed: true as const,
		retryPoliciesPassed: ["D671", "D675", "D710"] as const,
		sameBodyRetryPassed: true as const,
		terminalFailureCleanupAndNextArmPassed: true as const,
		decodeFailureCleanupAndNextArmPassed: true as const,
		cancelledTransportCleanupAndNextArmPassed: true as const,
		maxActiveEffects: 1 as const,
		workspaceResidueCount: 0 as const,
		liveGateEvaluated: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	for (const [key, expected] of Object.entries(expectedQualificationBase))
		if (JSON.stringify(qualification[key]) !== JSON.stringify(expected))
			throw new TypeError(`D19 qualification.${key} drifted`);
	const expectedQualificationDigest = empiricalStrictJsonDigest({
		...expectedQualificationBase,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		retryProofs,
		failureProjectionDigests: [
			failureProjections.terminalHttp.projectionDigest,
			failureProjections.decode.projectionDigest,
			failureProjections.cancelledTransport.projectionDigest,
		],
		implementationManifestDigest,
	});
	if (qualification.qualificationDigest !== expectedQualificationDigest)
		throw new TypeError("D19 qualification digest drifted");
	const generation = record(candidate.generation, "D19 generation");
	exactKeys(
		generation,
		[
			"generationDigest",
			"generationRef",
			"graphEvidenceDigest",
			"implementationManifestDigest",
			"qualificationDigest",
			"schemaVersion",
		],
		"D19 generation",
	);
	const generationBase = strictSnapshot({
		schemaVersion: generation.schemaVersion,
		generationRef: generation.generationRef,
		graphEvidenceDigest: generation.graphEvidenceDigest,
		qualificationDigest: generation.qualificationDigest,
		implementationManifestDigest: generation.implementationManifestDigest,
	});
	if (
		generation.schemaVersion !== D19_GENERATION_SCHEMA ||
		(generation.generationRef !== D19_GENERATION_REF &&
			generation.generationRef !== D19_INJECTED_TEST_GENERATION_REF) ||
		(baseline.basis === "exact-private-artifact") !==
			(generation.generationRef === D19_GENERATION_REF) ||
		generation.graphEvidenceDigest !== graphEvidence.evidenceDigest ||
		generation.qualificationDigest !== qualification.qualificationDigest ||
		generation.implementationManifestDigest !== implementationManifestDigest ||
		generation.generationDigest !== empiricalStrictJsonDigest(generationBase)
	)
		throw new TypeError("D19 generation drifted");
	const base = strictSnapshot({
		schemaVersion: candidate.schemaVersion,
		baseline,
		implementationManifestDigest,
		graphEvidence,
		retryEvidence,
		failureProjections,
		qualification,
		generation,
	});
	if (candidate.bundleDigest !== empiricalStrictJsonDigest(base))
		throw new TypeError("D19 bundle digest drifted");
	return Object.freeze({
		...base,
		bundleDigest: candidate.bundleDigest,
	}) as D19QualificationBundleV1;
}

async function persist(input: {
	readonly privateRoot: string;
	readonly bundle: D19QualificationBundleV1;
	readonly injected: boolean;
}) {
	if (!constructedBundles.delete(input.bundle))
		throw new TypeError("D19 qualification bundle is forged or replayed");
	const bundle = validateD19QualificationBundle(input.bundle);
	if (
		input.injected !== (bundle.baseline.basis === "injected-test") ||
		(input.injected
			? bundle.generation.generationRef !== D19_INJECTED_TEST_GENERATION_REF
			: bundle.generation.generationRef !== D19_GENERATION_REF)
	)
		throw new TypeError("D19 persistence basis drifted");
	const artifacts = Object.freeze({
		"bundle.v1.json": strictJsonCodec.encode(bundle),
		"qualification.v1.json": strictJsonCodec.encode(bundle.qualification),
		"generation.v1.json": strictJsonCodec.encode(bundle.generation),
	});
	const commit = strictSnapshot({
		schemaVersion: input.injected
			? "graphrefly-ts.d19.current-real-provider-injected-commit.v1"
			: "graphrefly-ts.d19.current-real-provider-commit.v1",
		generationRef: bundle.generation.generationRef,
		bundleDigest: bundle.bundleDigest,
		artifactDigests: Object.fromEntries(
			Object.entries(artifacts).map(([name, bytes]) => [name, empiricalSha256(bytes)]),
		),
	});
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: bundle.generation.generationRef,
		artifacts,
		commitBytes: strictJsonCodec.encode(commit),
	});
}

export async function persistD19Qualification(input: {
	readonly privateRoot: string;
	readonly bundle: D19QualificationBundleV1;
}) {
	return persist({ ...input, injected: false });
}

export async function persistD19InjectedQualificationForTest(input: {
	readonly privateRoot: string;
	readonly bundle: D19QualificationBundleV1;
}) {
	return persist({ ...input, injected: true });
}

export async function readD19QualificationArtifact(
	path: string,
): Promise<D19QualificationBundleV1> {
	const bytes = new Uint8Array(await readFile(path));
	return validateD19QualificationBundle(strictJsonCodec.decode(bytes));
}

export function D19ConstructedBundleForTest(value: D19QualificationBundleV1): boolean {
	return constructedBundles.has(value);
}
