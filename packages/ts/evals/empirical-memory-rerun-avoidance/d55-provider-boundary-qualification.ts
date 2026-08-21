import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { empiricalStrictJsonDigest, exactKeys, record, strictSnapshot } from "./canonical.js";
import { createD43PolicyCatalog } from "./d43-model-harness-policy.js";
import {
	createD44LiveExecutor,
	D44_BUGGY_ADMISSION_BLOCK,
	D44_D45_BASELINE_COMMIT,
	D44_FIXED_ADMISSION_BLOCK,
} from "./d44-d45-live-composition.js";
import {
	admitD45EffectResult,
	createD45GraphToolAuthority,
	type D45PartialCanonicalEvidenceV1,
	readD45ToolArguments,
	snapshotD45PartialCanonicalEvidence,
	takeD45AdmittedEffect,
	validateD45PartialCanonicalEvidence,
} from "./d45-graph-tool-authority.js";
import {
	createD45QualificationPolicy,
	D45_ASSIGNMENT,
	D45_READABLE_PATHS,
	D45_TASK_MATERIAL,
	D45_WRITABLE_PATH,
} from "./d45-graph-tool-qualification.js";
import { lowerD45ProviderEffect } from "./d45-mechanical-chat-adapter.js";
import {
	lowerD46ProviderEffect,
	readD46ToolArguments,
	validateD46CanonicalEvidence,
} from "./d46-bounded-inspection-authority.js";
import { runD46BoundedInspectionMeasurement } from "./d46-bounded-inspection-composition.js";

export const D55_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d55.provider-boundary-qualification.v2" as const;

const PRIVATE_HEADER_SENTINEL = "d55-private-header-sentinel" as const;
const PRIVATE_BODY_SENTINEL = "d55-private-body-sentinel" as const;
const TWO_MIB = 2 * 1_048_576;

type D55Scenario =
	| "invalid-metadata"
	| "over-bound-metadata"
	| "over-bound-body"
	| "body-abort"
	| "body-unknown"
	| "fetch-unknown"
	| "fetch-reset"
	| "fetch-dns"
	| "fetch-timeout"
	| "schema-rejection"
	| "d675-retry";

function successfulProviderResponse(body: RequestInit["body"]): Response {
	const request = JSON.parse(String(body)) as {
		readonly tool_choice: { readonly function: { readonly name: string } };
		readonly tools: readonly [
			{
				readonly function: {
					readonly parameters: {
						readonly properties: { readonly path: { readonly enum: readonly string[] } };
					};
				};
			},
		];
	};
	const name = request.tool_choice.function.name;
	const argumentsValue =
		name === "read_file"
			? { path: request.tools[0].function.parameters.properties.path.enum[0] }
			: {
					path: D45_WRITABLE_PATH,
					oldText: D44_BUGGY_ADMISSION_BLOCK,
					newText: D44_FIXED_ADMISSION_BLOCK,
				};
	return new Response(
		JSON.stringify({
			choices: [
				{
					finish_reason: "tool_calls",
					message: {
						tool_calls: [{ function: { name, arguments: JSON.stringify(argumentsValue) } }],
					},
				},
			],
			usage: { prompt_tokens: 100, completion_tokens: 20 },
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

function throwingBody(error: unknown): Response {
	const response = new Response("{}", {
		status: 200,
		headers: { "content-type": "application/json" },
	});
	Object.defineProperty(response, "arrayBuffer", {
		configurable: false,
		enumerable: false,
		value: async () => {
			throw error;
		},
		writable: false,
	});
	return response;
}

function scenarioResponse(scenario: D55Scenario, body: RequestInit["body"]): Response {
	if (scenario === "invalid-metadata")
		return new Response("{}", {
			status: 200,
			headers: {
				"content-length": PRIVATE_HEADER_SENTINEL,
				"content-type": "application/json",
			},
		});
	if (scenario === "over-bound-metadata")
		return new Response("{}", {
			status: 200,
			headers: { "content-length": String(TWO_MIB + 1), "content-type": "application/json" },
		});
	if (scenario === "over-bound-body")
		return new Response(new Uint8Array(TWO_MIB + 1), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	if (scenario === "body-abort")
		return throwingBody(new DOMException(PRIVATE_BODY_SENTINEL, "AbortError"));
	if (scenario === "body-unknown") return throwingBody(new TypeError(PRIVATE_BODY_SENTINEL));
	if (scenario === "schema-rejection")
		return new Response(
			JSON.stringify({
				choices: [],
				usage: { prompt_tokens: 100, completion_tokens: 20 },
			}),
			{
				status: 200,
				headers: { "content-type": "application/json" },
			},
		);
	return successfulProviderResponse(body);
}

function expectedOutcome(scenario: D55Scenario) {
	if (
		scenario === "body-abort" ||
		scenario === "fetch-reset" ||
		scenario === "fetch-dns" ||
		scenario === "fetch-timeout"
	)
		return "transport-failed" as const;
	if (scenario === "d675-retry") return "retryable-provider-failure" as const;
	if (scenario === "schema-rejection") return "schema-rejected" as const;
	return "executor-failed" as const;
}

async function runSingleBoundaryScenario(input: {
	readonly repositoryRoot: string;
	readonly scenario: D55Scenario;
}): Promise<
	Readonly<{
		scenario: D55Scenario;
		outcome: ReturnType<typeof expectedOutcome>;
		retryClass: "D675" | null;
		providerCalls: number;
		exactGraphBinding: true;
		conservativeReconciliation: true;
		armLocalCleanupAndContinuation: true | null;
		exactRetryIdentity: boolean;
		evidence: D45PartialCanonicalEvidenceV1;
	}>
> {
	let providerCalls = 0;
	const executor = createD44LiveExecutor({
		repositoryRoot: input.repositoryRoot,
		materializationRoot: await mkdtemp(join(tmpdir(), `graphrefly-d55-${input.scenario}-`)),
		baselineCommit: D44_D45_BASELINE_COMMIT,
		bearerToken: "injected-no-network",
		authorityAccess: {
			lowerProviderEffect: (authority, effect) =>
				lowerD45ProviderEffect(authority as never, effect),
			readToolArguments: (authority, effect) => readD45ToolArguments(authority as never, effect),
		},
		fetchImpl: async (_request, init) => {
			providerCalls += 1;
			if (input.scenario === "fetch-unknown") throw new TypeError(PRIVATE_BODY_SENTINEL);
			const transportCode =
				input.scenario === "fetch-reset"
					? "ECONNRESET"
					: input.scenario === "fetch-dns"
						? "ENOTFOUND"
						: input.scenario === "fetch-timeout"
							? "UND_ERR_CONNECT_TIMEOUT"
							: null;
			if (transportCode !== null)
				throw Object.assign(new Error(PRIVATE_BODY_SENTINEL), {
					cause: { code: transportCode },
				});
			if (input.scenario === "d675-retry" && providerCalls === 1)
				throw Object.assign(new Error(PRIVATE_BODY_SENTINEL), {
					cause: { code: "UND_ERR_SOCKET" },
				});
			return scenarioResponse(input.scenario, init?.body);
		},
	});
	const policy = createD45QualificationPolicy();
	const authority = createD45GraphToolAuthority({
		catalog: createD43PolicyCatalog([policy]),
		assignment: D45_ASSIGNMENT,
		readablePaths: D45_READABLE_PATHS,
		writablePath: D45_WRITABLE_PATH,
		taskMaterial: D45_TASK_MATERIAL,
		routeProfile: { reasoningEffort: "high", requireParameters: true },
		campaign: policy.campaign,
	});
	try {
		const materialization = takeD45AdmittedEffect(authority);
		if (materialization?.sourceD43EffectKind !== "materialization")
			throw new TypeError("D55 scenario omitted materialization admission");
		const materialized = await executor.execute(authority, materialization);
		admitD45EffectResult(authority, materialization, materialized.result);
		const provider = takeD45AdmittedEffect(authority);
		if (provider?.effectKind !== "provider-proposal")
			throw new TypeError("D55 scenario omitted provider admission");
		const executed = await executor.execute(authority, provider);
		const outcome = expectedOutcome(input.scenario);
		if (
			executed.result.effectKind !== "provider-proposal" ||
			executed.result.outcome !== outcome ||
			executed.result.wireDigest === null ||
			executed.result.usage !== null ||
			executed.result.costMicrousd !== 0 ||
			executed.result.retryClass !== (input.scenario === "d675-retry" ? "D675" : null)
		)
			throw new TypeError(`D55 ${input.scenario} classification drifted`);
		admitD45EffectResult(authority, provider, executed.result);
		let exactRetryIdentity = false;
		if (input.scenario === "d675-retry") {
			const retry = takeD45AdmittedEffect(authority);
			if (
				retry?.effectKind !== "provider-proposal" ||
				retry.logicalRequestDigest !== provider.logicalRequestDigest
			)
				throw new TypeError("D55 D675 retry identity drifted");
			const retried = await executor.execute(authority, retry);
			if (retried.result.effectKind !== "provider-proposal" || retried.result.outcome !== "success")
				throw new TypeError("D55 D675 retry did not return a bounded success proposal");
			admitD45EffectResult(authority, retry, retried.result);
			exactRetryIdentity = retried.result.wireDigest === executed.result.wireDigest;
		} else {
			const cleanup = takeD45AdmittedEffect(authority);
			if (cleanup?.sourceD43EffectKind !== "cleanup")
				throw new TypeError(`D55 ${input.scenario} omitted arm-local cleanup admission`);
			const cleaned = await executor.execute(authority, cleanup);
			admitD45EffectResult(authority, cleanup, cleaned.result);
			const nextArm = takeD45AdmittedEffect(authority);
			if (nextArm?.arm !== "relevant-applied" || nextArm.sourceD43EffectKind !== "materialization")
				throw new TypeError(`D55 ${input.scenario} did not release the next fixed arm`);
		}
		const evidence = validateD45PartialCanonicalEvidence(
			strictSnapshot(snapshotD45PartialCanonicalEvidence(authority)),
		);
		const providerAdmission = evidence.facts.find(
			(fact) =>
				fact.factKind === "effect-admitted" && fact.effect.effectDigest === provider.effectDigest,
		);
		const wire = evidence.facts.find(
			(fact) =>
				fact.factKind === "provider-wire-admitted" && fact.effectDigest === provider.effectDigest,
		);
		const result = evidence.facts.find(
			(fact) => fact.factKind === "provider-result" && fact.effectDigest === provider.effectDigest,
		);
		if (
			providerAdmission?.factKind !== "effect-admitted" ||
			wire?.factKind !== "provider-wire-admitted" ||
			result?.factKind !== "provider-result" ||
			wire.requestDigest !== provider.requestDigest ||
			wire.admissionDigest !== provider.admissionDigest ||
			result.requestDigest !== provider.requestDigest ||
			result.admissionDigest !== provider.admissionDigest ||
			result.result.wireDigest !== wire.wireDigest
		)
			throw new TypeError(`D55 ${input.scenario} Graph binding drifted`);
		const conservativeReconciliation =
			result.result.reconciledCostMicrousd === provider.providerReservationMicrousd &&
			(executed.result.outcome === "executor-failed"
				? result.result.reconciledElapsedMs === provider.elapsedReservationMs
				: result.result.reconciledElapsedMs <= provider.elapsedReservationMs);
		const armLocalCleanupAndContinuation = input.scenario === "d675-retry" ? null : true;
		if (
			!conservativeReconciliation ||
			(input.scenario !== "d675-retry" && !armLocalCleanupAndContinuation) ||
			(input.scenario === "d675-retry" && !exactRetryIdentity)
		)
			throw new TypeError(
				`D55 ${input.scenario} reconciliation or cleanup drifted: ${JSON.stringify({
					reconciledCostMicrousd: result.result.reconciledCostMicrousd,
					reconciledElapsedMs: result.result.reconciledElapsedMs,
					reservationCostMicrousd: provider.providerReservationMicrousd,
					reservationElapsedMs: provider.elapsedReservationMs,
					armLocalCleanupAndContinuation,
					exactRetryIdentity,
				})}`,
			);
		return Object.freeze({
			scenario: input.scenario,
			outcome,
			retryClass: input.scenario === "d675-retry" ? ("D675" as const) : null,
			providerCalls,
			exactGraphBinding: true as const,
			conservativeReconciliation: true as const,
			armLocalCleanupAndContinuation,
			exactRetryIdentity,
			evidence,
		});
	} finally {
		await executor.dispose();
	}
}

async function runFullSixArmContinuation(
	repositoryRoot: string,
	scenario: "invalid-metadata" | "schema-rejection",
) {
	let providerCalls = 0;
	const executor = createD44LiveExecutor({
		repositoryRoot,
		materializationRoot: await mkdtemp(join(tmpdir(), `graphrefly-d55-six-arm-${scenario}-`)),
		baselineCommit: D44_D45_BASELINE_COMMIT,
		bearerToken: "injected-no-network",
		authorityAccess: {
			lowerProviderEffect: (authority, effect) =>
				lowerD46ProviderEffect(authority as never, effect),
			readToolArguments: (authority, effect) => readD46ToolArguments(authority as never, effect),
		},
		fetchImpl: async (_request, init) => {
			providerCalls += 1;
			return providerCalls === 5
				? scenarioResponse(scenario, init?.body)
				: successfulProviderResponse(init?.body);
		},
	});
	const measurement = await runD46BoundedInspectionMeasurement({
		executor,
		injectedNoNetwork: true,
	});
	if (measurement.disposition !== "success")
		throw new TypeError("D55 injected six-arm continuation did not complete");
	return Object.freeze({
		evidence: validateD46CanonicalEvidence(strictSnapshot(measurement.evidence)),
		providerCalls,
	});
}

export async function runD55InjectedNoNetworkQualification(input?: {
	readonly repositoryRoot?: string;
}) {
	const repositoryRoot = resolve(input?.repositoryRoot ?? join(import.meta.dirname, "../../../.."));
	const scenarios = [];
	for (const scenario of [
		"invalid-metadata",
		"over-bound-metadata",
		"over-bound-body",
		"body-abort",
		"body-unknown",
		"fetch-unknown",
		"fetch-reset",
		"fetch-dns",
		"fetch-timeout",
		"d675-retry",
	] as const)
		try {
			scenarios.push(await runSingleBoundaryScenario({ repositoryRoot, scenario }));
		} catch (error) {
			throw new TypeError(`D55 ${scenario} matrix scenario failed`, { cause: error });
		}
	const frozenScenarios = Object.freeze(scenarios);
	const full = await runFullSixArmContinuation(repositoryRoot, "invalid-metadata");
	const schemaFull = await runFullSixArmContinuation(repositoryRoot, "schema-rejection");
	const replay = validateD46CanonicalEvidence(strictSnapshot(full.evidence));
	if (empiricalStrictJsonDigest(replay) !== empiricalStrictJsonDigest(full.evidence))
		throw new TypeError("D55 canonical replay drifted");
	const cold = full.evidence.d45Evidence.lifecycle.arms[0];
	const laterArms = full.evidence.d45Evidence.lifecycle.arms.slice(1);
	const schemaResults = schemaFull.evidence.d45Evidence.facts.filter(
		(fact) => fact.factKind === "provider-result" && fact.result.outcome === "schema-rejected",
	);
	const serialized = JSON.stringify({
		evidence: full.evidence,
		schemaEvidence: schemaFull.evidence,
		scenarios: frozenScenarios,
	});
	if (
		!full.evidence.exactSixArmsCompleted ||
		full.evidence.d45Evidence.lifecycle.arms.length !== 6 ||
		cold?.arm !== "cold" ||
		!cold.completed ||
		!cold.cleanupCompleted ||
		cold.evaluable ||
		cold.taskOutcome !== "non-evaluable" ||
		laterArms.some((arm) => !arm.completed || !arm.cleanupCompleted) ||
		!schemaFull.evidence.exactSixArmsCompleted ||
		schemaResults.length !== 1 ||
		serialized.includes(PRIVATE_HEADER_SENTINEL) ||
		serialized.includes(PRIVATE_BODY_SENTINEL) ||
		frozenScenarios.some(
			(scenario) => !scenario.exactGraphBinding || !scenario.conservativeReconciliation,
		)
	)
		throw new TypeError("D55 provider-boundary qualification invariant failed");
	const scenarioEvidenceDigests = Object.freeze([
		...frozenScenarios.map((scenario) =>
			Object.freeze({
				scenario: scenario.scenario,
				outcome: scenario.outcome,
				retryClass: scenario.retryClass,
				evidenceDigest: empiricalStrictJsonDigest(scenario.evidence),
			}),
		),
		Object.freeze({
			scenario: "schema-rejection" as const,
			outcome: "schema-rejected" as const,
			retryClass: null,
			evidenceDigest: empiricalStrictJsonDigest(schemaFull.evidence),
		}),
	]);
	const claims = Object.freeze({
		schemaVersion: D55_QUALIFICATION_SCHEMA,
		decisionRef: "graphrefly-ts:D55" as const,
		canonicalEvidenceDigest: empiricalStrictJsonDigest(full.evidence),
		scenarioEvidenceDigests,
		exactSixArmsCompleted: true as const,
		postWireExecutorFailureScenarios: 5 as const,
		transportFailureScenarios: 4 as const,
		schemaRejectionScenarios: 1 as const,
		d675RetryScenarios: 1 as const,
		conservativeCostMicrousd: 100_000 as const,
		conservativeElapsedMs: 600_000 as const,
		armLocalCleanupAndContinuation: true as const,
		transportClassificationPreserved: true as const,
		d675RetryPreserved: true as const,
		canonicalReplayQualified: true as const,
		providerCalls:
			full.providerCalls +
			schemaFull.providerCalls +
			frozenScenarios.reduce((sum, scenario) => sum + scenario.providerCalls, 0),
		providerNetworkCalls: 0 as const,
		credentialReads: 0 as const,
		dispatchClaims: 0 as const,
		rawMaterialPersisted: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	return Object.freeze({
		...claims,
		canonicalEvidence: full.evidence,
		scenarioEvidence: Object.freeze([
			...frozenScenarios.map((scenario) =>
				Object.freeze({ scenario: scenario.scenario, evidence: scenario.evidence }),
			),
			Object.freeze({ scenario: "schema-rejection" as const, evidence: schemaFull.evidence }),
		]),
		qualificationDigest: empiricalStrictJsonDigest(claims),
	});
}

const D55_SCENARIOS = Object.freeze([
	"invalid-metadata",
	"over-bound-metadata",
	"over-bound-body",
	"body-abort",
	"body-unknown",
	"fetch-unknown",
	"fetch-reset",
	"fetch-dns",
	"fetch-timeout",
	"d675-retry",
	"schema-rejection",
] as const);

export function validateD55Qualification(value: unknown): unknown {
	const candidate = record(value, "D55 qualification");
	exactKeys(
		candidate,
		[
			"armLocalCleanupAndContinuation",
			"canonicalEvidence",
			"canonicalEvidenceDigest",
			"canonicalReplayQualified",
			"causalAttribution",
			"conservativeCostMicrousd",
			"conservativeElapsedMs",
			"credentialReads",
			"d675RetryPreserved",
			"d675RetryScenarios",
			"decisionRef",
			"dispatchClaims",
			"efficacyClaim",
			"exactSixArmsCompleted",
			"postWireExecutorFailureScenarios",
			"providerCalls",
			"providerNetworkCalls",
			"qualificationDigest",
			"rawMaterialPersisted",
			"scenarioEvidence",
			"scenarioEvidenceDigests",
			"schemaRejectionScenarios",
			"schemaVersion",
			"transportClassificationPreserved",
			"transportFailureScenarios",
		],
		"D55 qualification",
	);
	if (
		candidate.schemaVersion !== D55_QUALIFICATION_SCHEMA ||
		candidate.decisionRef !== "graphrefly-ts:D55" ||
		candidate.exactSixArmsCompleted !== true ||
		candidate.postWireExecutorFailureScenarios !== 5 ||
		candidate.transportFailureScenarios !== 4 ||
		candidate.schemaRejectionScenarios !== 1 ||
		candidate.d675RetryScenarios !== 1 ||
		candidate.conservativeCostMicrousd !== 100_000 ||
		candidate.conservativeElapsedMs !== 600_000 ||
		candidate.armLocalCleanupAndContinuation !== true ||
		candidate.transportClassificationPreserved !== true ||
		candidate.d675RetryPreserved !== true ||
		candidate.canonicalReplayQualified !== true ||
		candidate.providerCalls !== 72 ||
		candidate.providerNetworkCalls !== 0 ||
		candidate.credentialReads !== 0 ||
		candidate.dispatchClaims !== 0 ||
		candidate.rawMaterialPersisted !== false ||
		candidate.causalAttribution !== "undetermined" ||
		candidate.efficacyClaim !== "none" ||
		typeof candidate.canonicalEvidenceDigest !== "string" ||
		typeof candidate.qualificationDigest !== "string" ||
		!Array.isArray(candidate.scenarioEvidenceDigests) ||
		!Array.isArray(candidate.scenarioEvidence) ||
		candidate.scenarioEvidenceDigests.length !== D55_SCENARIOS.length ||
		candidate.scenarioEvidence.length !== D55_SCENARIOS.length
	)
		throw new TypeError("D55 qualification claims drifted");
	const canonicalEvidence = validateD46CanonicalEvidence(candidate.canonicalEvidence as never);
	if (empiricalStrictJsonDigest(canonicalEvidence) !== candidate.canonicalEvidenceDigest)
		throw new TypeError("D55 canonical evidence digest drifted");
	if (!canonicalEvidence.exactSixArmsCompleted)
		throw new TypeError("D55 primary canonical evidence did not complete exactly six arms");
	let derivedPostWireExecutorFailures = 0;
	let derivedTransportFailures = 0;
	let derivedSchemaRejections = 0;
	let derivedD675Retries = 0;
	let derivedProviderCalls = canonicalEvidence.d45Evidence.facts.filter(
		(fact) => fact.factKind === "provider-result",
	).length;
	for (const [index, scenario] of D55_SCENARIOS.entries()) {
		const digestEntry = record(candidate.scenarioEvidenceDigests[index], "D55 scenario digest");
		const evidenceEntry = record(candidate.scenarioEvidence[index], "D55 scenario evidence");
		exactKeys(
			digestEntry,
			["evidenceDigest", "outcome", "retryClass", "scenario"],
			"D55 scenario digest",
		);
		exactKeys(evidenceEntry, ["evidence", "scenario"], "D55 scenario evidence");
		if (digestEntry.scenario !== scenario || evidenceEntry.scenario !== scenario)
			throw new TypeError("D55 scenario order drifted");
		const expected = expectedOutcome(scenario);
		const expectedRetryClass = scenario === "d675-retry" ? "D675" : null;
		if (digestEntry.outcome !== expected || digestEntry.retryClass !== expectedRetryClass)
			throw new TypeError(`D55 ${scenario} classification claim drifted`);
		const evidence =
			scenario === "schema-rejection"
				? validateD46CanonicalEvidence(evidenceEntry.evidence as never)
				: validateD45PartialCanonicalEvidence(evidenceEntry.evidence as never);
		if (
			typeof digestEntry.evidenceDigest !== "string" ||
			empiricalStrictJsonDigest(evidence) !== digestEntry.evidenceDigest
		)
			throw new TypeError("D55 scenario evidence digest drifted");
		if (
			scenario === "schema-rejection" &&
			!validateD46CanonicalEvidence(evidenceEntry.evidence as never).exactSixArmsCompleted
		)
			throw new TypeError("D55 schema canonical evidence did not complete exactly six arms");
		const d45Evidence =
			scenario === "schema-rejection"
				? validateD46CanonicalEvidence(evidenceEntry.evidence as never).d45Evidence
				: validateD45PartialCanonicalEvidence(evidenceEntry.evidence as never);
		const providerResults = d45Evidence.facts.filter((fact) => fact.factKind === "provider-result");
		derivedProviderCalls += providerResults.length;
		const target =
			scenario === "schema-rejection"
				? providerResults.find((fact) => fact.result.outcome === "schema-rejected")
				: providerResults[0];
		if (target === undefined || target.result.outcome !== expected)
			throw new TypeError(`D55 ${scenario} canonical outcome drifted`);
		if (target.result.retryClass !== expectedRetryClass)
			throw new TypeError(`D55 ${scenario} canonical retry class drifted`);
		const admission = d45Evidence.facts.find(
			(fact) =>
				fact.factKind === "effect-admitted" && fact.effect.effectDigest === target.effectDigest,
		);
		const wire = d45Evidence.facts.find(
			(fact) =>
				fact.factKind === "provider-wire-admitted" && fact.effectDigest === target.effectDigest,
		);
		if (
			admission?.factKind !== "effect-admitted" ||
			admission.effect.effectKind !== "provider-proposal" ||
			wire?.factKind !== "provider-wire-admitted" ||
			target.requestDigest !== admission.effect.requestDigest ||
			target.admissionDigest !== admission.effect.admissionDigest ||
			wire.requestDigest !== target.requestDigest ||
			wire.admissionDigest !== target.admissionDigest ||
			wire.wireDigest !== target.result.wireDigest ||
			target.result.reconciledCostMicrousd !== admission.effect.providerReservationMicrousd ||
			admission.effect.providerReservationMicrousd !== candidate.conservativeCostMicrousd ||
			admission.effect.elapsedReservationMs !== candidate.conservativeElapsedMs ||
			(target.result.outcome === "executor-failed"
				? target.result.reconciledElapsedMs !== admission.effect.elapsedReservationMs
				: target.result.reconciledElapsedMs > admission.effect.elapsedReservationMs)
		)
			throw new TypeError(`D55 ${scenario} canonical binding or reconciliation drifted`);
		if (scenario === "d675-retry") {
			const retried = providerResults[1];
			const retryAdmission =
				retried === undefined
					? undefined
					: d45Evidence.facts.find(
							(fact) =>
								fact.factKind === "effect-admitted" &&
								fact.effect.effectDigest === retried.effectDigest,
						);
			if (
				providerResults.length !== 2 ||
				retried?.result.outcome !== "success" ||
				retried.result.retryClass !== null ||
				retryAdmission?.factKind !== "effect-admitted" ||
				retryAdmission.effect.logicalRequestDigest !== admission.effect.logicalRequestDigest ||
				retryAdmission.effect.providerReservationMicrousd !== candidate.conservativeCostMicrousd ||
				retryAdmission.effect.elapsedReservationMs !== candidate.conservativeElapsedMs ||
				retried.result.wireDigest !== target.result.wireDigest
			)
				throw new TypeError("D55 D675 canonical retry identity drifted");
			derivedD675Retries += 1;
		} else {
			const cleanupAdmission = d45Evidence.facts.find(
				(fact) =>
					fact.sequence > target.sequence &&
					fact.factKind === "effect-admitted" &&
					fact.effect.sourceD43EffectKind === "cleanup",
			);
			const cleanupResult =
				cleanupAdmission?.factKind === "effect-admitted"
					? d45Evidence.facts.find(
							(fact) =>
								fact.sequence > cleanupAdmission.sequence &&
								fact.factKind === "local-result" &&
								fact.effectDigest === cleanupAdmission.effect.effectDigest,
						)
					: undefined;
			const nextMaterialization = d45Evidence.facts.find(
				(fact) =>
					fact.sequence > (cleanupResult?.sequence ?? Number.MAX_SAFE_INTEGER) &&
					fact.factKind === "effect-admitted" &&
					fact.effect.arm === "relevant-applied" &&
					fact.effect.sourceD43EffectKind === "materialization",
			);
			if (
				cleanupAdmission?.factKind !== "effect-admitted" ||
				cleanupResult?.factKind !== "local-result" ||
				nextMaterialization?.factKind !== "effect-admitted"
			)
				throw new TypeError(`D55 ${scenario} canonical cleanup continuation drifted`);
		}
		if (target.result.outcome === "executor-failed") derivedPostWireExecutorFailures += 1;
		else if (target.result.outcome === "transport-failed") derivedTransportFailures += 1;
		else if (target.result.outcome === "schema-rejected") derivedSchemaRejections += 1;
	}
	if (
		candidate.postWireExecutorFailureScenarios !== derivedPostWireExecutorFailures ||
		candidate.transportFailureScenarios !== derivedTransportFailures ||
		candidate.schemaRejectionScenarios !== derivedSchemaRejections ||
		candidate.d675RetryScenarios !== derivedD675Retries ||
		candidate.providerCalls !== derivedProviderCalls
	)
		throw new TypeError("D55 qualification counters are not derived from canonical Graph facts");
	const claims = strictSnapshot({
		schemaVersion: candidate.schemaVersion,
		decisionRef: candidate.decisionRef,
		canonicalEvidenceDigest: candidate.canonicalEvidenceDigest,
		scenarioEvidenceDigests: candidate.scenarioEvidenceDigests,
		exactSixArmsCompleted: candidate.exactSixArmsCompleted,
		postWireExecutorFailureScenarios: candidate.postWireExecutorFailureScenarios,
		transportFailureScenarios: candidate.transportFailureScenarios,
		schemaRejectionScenarios: candidate.schemaRejectionScenarios,
		d675RetryScenarios: candidate.d675RetryScenarios,
		conservativeCostMicrousd: candidate.conservativeCostMicrousd,
		conservativeElapsedMs: candidate.conservativeElapsedMs,
		armLocalCleanupAndContinuation: candidate.armLocalCleanupAndContinuation,
		transportClassificationPreserved: candidate.transportClassificationPreserved,
		d675RetryPreserved: candidate.d675RetryPreserved,
		canonicalReplayQualified: candidate.canonicalReplayQualified,
		providerCalls: candidate.providerCalls,
		providerNetworkCalls: candidate.providerNetworkCalls,
		credentialReads: candidate.credentialReads,
		dispatchClaims: candidate.dispatchClaims,
		rawMaterialPersisted: candidate.rawMaterialPersisted,
		causalAttribution: candidate.causalAttribution,
		efficacyClaim: candidate.efficacyClaim,
	});
	if (empiricalStrictJsonDigest(claims) !== candidate.qualificationDigest)
		throw new TypeError("D55 qualification digest drifted");
	if (
		JSON.stringify(candidate).includes(PRIVATE_HEADER_SENTINEL) ||
		JSON.stringify(candidate).includes(PRIVATE_BODY_SENTINEL)
	)
		throw new TypeError("D55 qualification retained private material");
	return strictSnapshot(candidate);
}

export function validateD55PersistedQualification(
	value: unknown,
	expectedImplementationManifestDigest: string,
): unknown {
	const candidate = record(value, "D55 persisted qualification");
	exactKeys(
		candidate,
		["bundleDigest", "implementationManifestDigest", "qualification", "schemaVersion"],
		"D55 persisted qualification",
	);
	if (
		candidate.schemaVersion !== "graphrefly-ts.d55.persisted-qualification.v2" ||
		candidate.implementationManifestDigest !== expectedImplementationManifestDigest ||
		typeof candidate.bundleDigest !== "string"
	)
		throw new TypeError("D55 persisted qualification coordinates drifted");
	const qualification = validateD55Qualification(candidate.qualification);
	const material = strictSnapshot({
		schemaVersion: candidate.schemaVersion,
		implementationManifestDigest: candidate.implementationManifestDigest,
		qualification,
	});
	if (empiricalStrictJsonDigest(material) !== candidate.bundleDigest)
		throw new TypeError("D55 persisted qualification bundle digest drifted");
	return Object.freeze({ ...material, bundleDigest: candidate.bundleDigest });
}
