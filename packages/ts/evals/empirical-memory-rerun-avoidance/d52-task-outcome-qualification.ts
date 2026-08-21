import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	admitD43EffectResult,
	createD43GraphHarnessAuthority,
	type D43AdmittedEffectV1,
	type D43EffectResultInputV1,
	type D43GraphHarnessEvidenceV1,
	snapshotD43GraphHarnessEvidence,
	takeD43AdmittedEffect,
	validateD43GraphHarnessEvidence,
} from "./d43-graph-harness-authority.js";
import { createD43PolicyCatalog } from "./d43-model-harness-policy.js";
import {
	admitD45EffectResult,
	createD45GraphToolAuthority,
	type D45AdmittedEffectV1,
	readD45ToolArguments,
	snapshotD45PartialCanonicalEvidence,
	takeD45AdmittedEffect,
	validateD45PartialCanonicalEvidence,
} from "./d45-graph-tool-authority.js";
import {
	createD45QualificationPolicy,
	D45_ASSIGNMENT,
	D45_PUBLIC_SEMANTIC_SCENARIO_SET_DIGEST,
	D45_PUBLIC_SEMANTIC_SCENARIOS,
	D45_READABLE_PATHS,
	D45_TASK_MATERIAL,
	D45_WRITABLE_PATH,
} from "./d45-graph-tool-qualification.js";
import { lowerD45ProviderEffect } from "./d45-mechanical-chat-adapter.js";
import {
	runD46InjectedNoNetworkQualification,
	validateD46QualificationBundle,
} from "./d46-bounded-inspection-qualification.js";

export const D52_QUALIFICATION_SCHEMA = "graphrefly-ts.d52.task-outcome-qualification.v1" as const;

function providerResult(
	effect: D43AdmittedEffectV1,
	outcome: D43EffectResultInputV1["outcome"],
): D43EffectResultInputV1 {
	return Object.freeze({
		outcome,
		elapsedMs: 1,
		costMicrousd: 1,
		usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 },
		wireDigest: empiricalStrictJsonDigest({
			request: effect.requestDigest,
			attempt: effect.attempt,
		}),
		retryClass: null,
		criteria: null,
	});
}

function localResult(
	effect: D43AdmittedEffectV1,
	outcome: D43EffectResultInputV1["outcome"],
): D43EffectResultInputV1 {
	const criteria =
		effect.kind === "public-semantic-validation"
			? Object.freeze({
					scenarioSetDigest: D45_PUBLIC_SEMANTIC_SCENARIO_SET_DIGEST,
					observations: Object.freeze(
						D45_PUBLIC_SEMANTIC_SCENARIOS.map((scenario) =>
							Object.freeze({
								criterion: scenario.criterion,
								scenarioRef: scenario.scenarioRef,
								scenarioDigest: scenario.scenarioDigest,
								observationDigest: empiricalStrictJsonDigest({
									request: effect.requestDigest,
									scenario: scenario.scenarioDigest,
									passed: outcome === "passed",
								}),
								freshnessDigest: empiricalStrictJsonDigest({
									requestDigest: effect.requestDigest,
									sequence: effect.sequence,
								}),
								passed: outcome === "passed",
							}),
						),
					),
				})
			: null;
	return Object.freeze({
		outcome,
		elapsedMs: 1,
		costMicrousd: 0,
		usage: null,
		wireDigest: null,
		retryClass: null,
		criteria,
	});
}

function runTaskOutcomeTruthTable(): Readonly<{
	evidence: D43GraphHarnessEvidenceV1;
	focusedValidationReservationMs: number;
	publicSemanticValidationReservationMs: number;
	otherLocalReservationsUnchanged: boolean;
}> {
	const policy = createD45QualificationPolicy();
	const authority = createD43GraphHarnessAuthority({
		catalog: createD43PolicyCatalog([policy]),
		assignment: D45_ASSIGNMENT,
	});
	let focusedValidationReservationMs = 0;
	let publicSemanticValidationReservationMs = 0;
	let otherLocalReservationsUnchanged = true;
	for (let guard = 0; guard < 256; guard += 1) {
		const effect = takeD43AdmittedEffect(authority);
		if (effect === null)
			return Object.freeze({
				evidence: validateD43GraphHarnessEvidence(snapshotD43GraphHarnessEvidence(authority)),
				focusedValidationReservationMs,
				publicSemanticValidationReservationMs,
				otherLocalReservationsUnchanged,
			});
		if (effect.kind === "focused-validation")
			focusedValidationReservationMs = effect.elapsedReservationMs;
		else if (effect.kind === "public-semantic-validation")
			publicSemanticValidationReservationMs = effect.elapsedReservationMs;
		else if (!effect.providerEffect && effect.elapsedReservationMs !== 10_000)
			otherLocalReservationsUnchanged = false;
		let result: D43EffectResultInputV1;
		if (effect.kind === "inspection") result = providerResult(effect, "success");
		else if (effect.kind === "mutation") {
			if (effect.arm === "cold") result = providerResult(effect, "schema-rejected");
			else if (effect.arm === "proposal-only")
				result = providerResult(effect, "replacement-not-found");
			else result = providerResult(effect, "success");
		} else if (effect.kind === "workspace-diff") {
			result = localResult(effect, effect.arm === "admission-rejected" ? "wrong-scope" : "success");
		} else if (effect.kind === "focused-validation") {
			result = localResult(effect, effect.arm === "irrelevant-applied" ? "failed" : "passed");
		} else if (effect.kind === "public-semantic-validation") result = localResult(effect, "passed");
		else if (effect.kind === "hidden-verifier")
			result = localResult(effect, effect.arm === "relevant-applied" ? "passed" : "failed");
		else result = localResult(effect, "success");
		admitD43EffectResult(authority, effect, result);
	}
	throw new TypeError("D52 task outcome truth table exceeded its effect bound");
}

function createToolAuthority() {
	const policy = createD45QualificationPolicy();
	return createD45GraphToolAuthority({
		catalog: createD43PolicyCatalog([policy]),
		assignment: D45_ASSIGNMENT,
		readablePaths: D45_READABLE_PATHS,
		writablePath: D45_WRITABLE_PATH,
		taskMaterial: D45_TASK_MATERIAL,
		routeProfile: { reasoningEffort: "high", requireParameters: true },
		campaign: policy.campaign,
	});
}

function prepareMutation(authority: ReturnType<typeof createToolAuthority>) {
	const stateDigest = empiricalStrictJsonDigest("d52-workspace-before");
	const materialization = takeD45AdmittedEffect(authority)!;
	admitD45EffectResult(authority, materialization, {
		effectKind: "local-effect",
		outcome: "success",
		elapsedMs: 1,
		evidenceDigest: empiricalStrictJsonDigest("d52-materialized"),
		workspaceStateDigest: stateDigest,
		criteria: null,
	});
	for (const path of D45_READABLE_PATHS) {
		const inspection = takeD45AdmittedEffect(authority)!;
		const wire = lowerD45ProviderEffect(authority, inspection);
		admitD45EffectResult(authority, inspection, {
			effectKind: "provider-proposal",
			outcome: "success",
			elapsedMs: 1,
			costMicrousd: 1,
			usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 },
			wireDigest: wire.wireDigest,
			retryClass: null,
			proposal: { toolCalls: [{ toolRef: "read-file", path }] },
		});
		const freshness = takeD45AdmittedEffect(authority)!;
		admitD45EffectResult(authority, freshness, {
			effectKind: "workspace-freshness",
			elapsedMs: 1,
			evidenceDigest: empiricalStrictJsonDigest({ path, fresh: true }),
			observedWorkspaceStateDigest: stateDigest,
		});
		const readEffect = takeD45AdmittedEffect(authority)!;
		const read = readD45ToolArguments(authority, readEffect);
		admitD45EffectResult(authority, readEffect, {
			effectKind: "tool-action",
			status: "success",
			causeCode: null,
			elapsedMs: 1,
			evidenceDigest: empiricalStrictJsonDigest({ path, read: true }),
			workspaceStateBeforeDigest: stateDigest,
			workspaceStateAfterDigest: stateDigest,
			content:
				read.path === D45_WRITABLE_PATH ? `before\n${"a".repeat(384)}\nafter` : `context:${path}`,
		});
	}
	const mutation = takeD45AdmittedEffect(authority)!;
	const wire = lowerD45ProviderEffect(authority, mutation);
	return { mutation, wire, stateDigest };
}

function proveExactMutationBounds() {
	const overlong = createToolAuthority();
	const overlongPrepared = prepareMutation(overlong);
	admitD45EffectResult(overlong, overlongPrepared.mutation, {
		effectKind: "provider-proposal",
		outcome: "success",
		elapsedMs: 1,
		costMicrousd: 1,
		usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 },
		wireDigest: overlongPrepared.wire.wireDigest,
		retryClass: null,
		proposal: {
			toolCalls: [
				{
					toolRef: "replace-exact",
					path: D45_WRITABLE_PATH,
					oldText: "a".repeat(513),
					newText: "b",
				},
			],
		},
	});
	const overlongNext = takeD45AdmittedEffect(overlong)!;
	const overlongPartial = validateD45PartialCanonicalEvidence(
		snapshotD45PartialCanonicalEvidence(overlong),
	);

	const expansion = createToolAuthority();
	const expansionPrepared = prepareMutation(expansion);
	admitD45EffectResult(expansion, expansionPrepared.mutation, {
		effectKind: "provider-proposal",
		outcome: "success",
		elapsedMs: 1,
		costMicrousd: 1,
		usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 },
		wireDigest: expansionPrepared.wire.wireDigest,
		retryClass: null,
		proposal: {
			toolCalls: [
				{
					toolRef: "replace-exact",
					path: D45_WRITABLE_PATH,
					oldText: "a",
					newText: "b".repeat(130),
				},
			],
		},
	});
	const expansionNext = takeD45AdmittedEffect(expansion)!;
	const expansionPartial = validateD45PartialCanonicalEvidence(
		snapshotD45PartialCanonicalEvidence(expansion),
	);

	const admitted = createToolAuthority();
	const admittedPrepared = prepareMutation(admitted);
	admitD45EffectResult(admitted, admittedPrepared.mutation, {
		effectKind: "provider-proposal",
		outcome: "success",
		elapsedMs: 1,
		costMicrousd: 1,
		usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 },
		wireDigest: admittedPrepared.wire.wireDigest,
		retryClass: null,
		proposal: {
			toolCalls: [
				{
					toolRef: "replace-exact",
					path: D45_WRITABLE_PATH,
					oldText: "a".repeat(384),
					newText: "b".repeat(512),
				},
			],
		},
	});
	const admittedNext = takeD45AdmittedEffect(admitted)!;
	const schema = JSON.parse(admittedPrepared.wire.body) as {
		tools: readonly [
			{
				function: {
					parameters: {
						properties: { oldText: { maxLength: number }; newText: { maxLength: number } };
					};
				};
			},
		];
	};
	const rejectionCodes = [...overlongPartial.facts, ...expansionPartial.facts]
		.filter((fact) => fact.factKind === "provider-result")
		.map((fact) =>
			fact.factKind === "provider-result" ? fact.result.proposalRejectionCode : null,
		);
	return Object.freeze({
		overlongRejectedBeforeTool: overlongNext.effectKind === "provider-proposal",
		expansionRejectedBeforeTool: expansionNext.effectKind === "provider-proposal",
		exactBoundaryAdmitted:
			admittedNext.effectKind === "workspace-freshness" && admittedNext.toolRef === null,
		wireOldTextMaxLength: schema.tools[0].function.parameters.properties.oldText.maxLength,
		wireNewTextMaxLength: schema.tools[0].function.parameters.properties.newText.maxLength,
		argumentBoundsFacts: rejectionCodes.filter((code) => code === "argument-bounds").length,
	});
}

function publicCriteria(effect: D45AdmittedEffectV1) {
	return Object.freeze({
		scenarioSetDigest: D45_PUBLIC_SEMANTIC_SCENARIO_SET_DIGEST,
		observations: Object.freeze(
			D45_PUBLIC_SEMANTIC_SCENARIOS.map((scenario, index) =>
				Object.freeze({
					criterion: scenario.criterion,
					scenarioRef: scenario.scenarioRef,
					scenarioDigest: scenario.scenarioDigest,
					observationDigest: empiricalStrictJsonDigest({
						scenario: scenario.scenarioDigest,
						passed: index !== 0,
					}),
					freshnessDigest: empiricalStrictJsonDigest({
						requestDigest: effect.sourceD43RequestDigest,
						sequence: effect.sourceD43Sequence,
					}),
					passed: index !== 0,
				}),
			),
		),
	});
}

function provePublicCorrectionContext(): string {
	const authority = createToolAuthority();
	const prepared = prepareMutation(authority);
	admitD45EffectResult(authority, prepared.mutation, {
		effectKind: "provider-proposal",
		outcome: "success",
		elapsedMs: 1,
		costMicrousd: 1,
		usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0 },
		wireDigest: prepared.wire.wireDigest,
		retryClass: null,
		proposal: {
			toolCalls: [
				{
					toolRef: "replace-exact",
					path: D45_WRITABLE_PATH,
					oldText: "a".repeat(384),
					newText: "b".repeat(384),
				},
			],
		},
	});
	const freshness = takeD45AdmittedEffect(authority)!;
	admitD45EffectResult(authority, freshness, {
		effectKind: "workspace-freshness",
		elapsedMs: 1,
		evidenceDigest: empiricalStrictJsonDigest("d52-mutation-fresh"),
		observedWorkspaceStateDigest: prepared.stateDigest,
	});
	const mutation = takeD45AdmittedEffect(authority)!;
	readD45ToolArguments(authority, mutation);
	const after = empiricalStrictJsonDigest("d52-workspace-after");
	admitD45EffectResult(authority, mutation, {
		effectKind: "tool-action",
		status: "success",
		causeCode: null,
		elapsedMs: 1,
		evidenceDigest: empiricalStrictJsonDigest("d52-mutation-success"),
		workspaceStateBeforeDigest: prepared.stateDigest,
		workspaceStateAfterDigest: after,
		content: null,
	});
	for (const outcome of ["success", "passed"] as const) {
		const local = takeD45AdmittedEffect(authority)!;
		admitD45EffectResult(authority, local, {
			effectKind: "local-effect",
			outcome,
			elapsedMs: 1,
			evidenceDigest: empiricalStrictJsonDigest({ local: local.effectDigest, outcome }),
			workspaceStateDigest: after,
			criteria: null,
		});
	}
	const semantic = takeD45AdmittedEffect(authority)!;
	admitD45EffectResult(authority, semantic, {
		effectKind: "local-effect",
		outcome: "failed",
		elapsedMs: 1,
		evidenceDigest: empiricalStrictJsonDigest("d52-public-failed"),
		workspaceStateDigest: after,
		criteria: publicCriteria(semantic),
	});
	const correction = takeD45AdmittedEffect(authority)!;
	return lowerD45ProviderEffect(authority, correction).body;
}

export function runD52InjectedNoNetworkQualification() {
	const truthTable = runTaskOutcomeTruthTable();
	const { evidence } = truthTable;
	const bounds = proveExactMutationBounds();
	const correctionWire = provePublicCorrectionContext();
	const relevant = evidence.arms.find((arm) => arm.arm === "relevant-applied");
	const controls = evidence.arms.filter((arm) => arm.arm !== "relevant-applied");
	const material = strictSnapshot({
		schemaVersion: D52_QUALIFICATION_SCHEMA,
		decisionRef: "graphrefly-ts:D52" as const,
		evidenceDigest: evidence.evidenceDigest,
		exactSixArmsCompleted: evidence.exactSixArmsCompleted,
		frozenGateWouldPass: evidence.frozenGateWouldPass,
		relevantTaskPassed: relevant?.taskOutcome === "passed",
		controlsTaskFailed: controls.every((arm) => arm.taskOutcome === "failed"),
		earlierFailureHiddenVerifierNull: controls
			.filter((arm) => arm.arm !== "wrong-scope-applied")
			.every((arm) => arm.hiddenVerifierPassed === null),
		hiddenFailurePreserved:
			controls.find((arm) => arm.arm === "wrong-scope-applied")?.hiddenVerifierPassed === false,
		overlongRejectedBeforeTool: bounds.overlongRejectedBeforeTool,
		expansionRejectedBeforeTool: bounds.expansionRejectedBeforeTool,
		exactBoundaryAdmitted: bounds.exactBoundaryAdmitted,
		wireOldTextMaxLength: bounds.wireOldTextMaxLength,
		wireNewTextMaxLength: bounds.wireNewTextMaxLength,
		argumentBoundsFacts: bounds.argumentBoundsFacts,
		focusedValidationReservationMs: truthTable.focusedValidationReservationMs,
		publicSemanticValidationReservationMs: truthTable.publicSemanticValidationReservationMs,
		otherLocalReservationsUnchanged: truthTable.otherLocalReservationsUnchanged,
		publicCorrectionContextExposed:
			correctionWire.includes("d45/fresh-producer-proposal-before-worker-claim=failed") &&
			correctionWire.includes("d45/malformed-provenance-rejected-before-store-mutation=passed"),
		rawMutationMaterialPersisted:
			JSON.stringify(evidence).includes("a".repeat(384)) ||
			JSON.stringify(evidence).includes("b".repeat(384)),
		providerNetworkCalls: 0 as const,
		credentialReads: 0 as const,
		dispatchClaims: 0 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const required = [
		material.exactSixArmsCompleted,
		material.frozenGateWouldPass,
		material.relevantTaskPassed,
		material.controlsTaskFailed,
		material.earlierFailureHiddenVerifierNull,
		material.hiddenFailurePreserved,
		material.overlongRejectedBeforeTool,
		material.expansionRejectedBeforeTool,
		material.exactBoundaryAdmitted,
		material.wireOldTextMaxLength === 512,
		material.wireNewTextMaxLength === 512,
		material.argumentBoundsFacts === 2,
		material.focusedValidationReservationMs === 60_000,
		material.publicSemanticValidationReservationMs === 60_000,
		material.otherLocalReservationsUnchanged,
		material.publicCorrectionContextExposed,
		material.rawMutationMaterialPersisted === false,
	];
	if (!required.every(Boolean)) throw new TypeError("D52 injected qualification failed");
	const qualification = Object.freeze({
		...material,
		qualificationDigest: empiricalStrictJsonDigest(material),
	});
	const bundleMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d52.task-outcome-qualification-bundle.v1" as const,
		evidence,
		qualification,
	});
	return Object.freeze({
		...bundleMaterial,
		bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
	});
}

export async function runD52FullInjectedNoNetworkQualification() {
	const taskOutcome = runD52InjectedNoNetworkQualification();
	const fullSixArm = validateD46QualificationBundle(await runD46InjectedNoNetworkQualification());
	if (
		fullSixArm.qualification.exactSixArmsCompleted !== true ||
		fullSixArm.qualification.evaluableArms !== 6 ||
		fullSixArm.qualification.boundedReadFacts !== 24 ||
		fullSixArm.qualification.providerNetworkCalls !== 0 ||
		fullSixArm.qualification.credentialReads !== 0 ||
		fullSixArm.qualification.dispatchClaims !== 0
	)
		throw new TypeError("D52 full six-arm qualification drifted");
	const material = strictSnapshot({
		schemaVersion: "graphrefly-ts.d52.full-qualification-bundle.v1" as const,
		decisionRef: "graphrefly-ts:D52" as const,
		taskOutcome,
		fullSixArm,
		providerNetworkCalls: 0 as const,
		credentialReads: 0 as const,
		dispatchClaims: 0 as const,
		liveGateEvaluated: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	return Object.freeze({
		...material,
		bundleDigest: empiricalStrictJsonDigest(material),
	});
}
