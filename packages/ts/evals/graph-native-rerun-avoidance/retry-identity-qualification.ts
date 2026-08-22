import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	admitD43EffectResult,
	createD43GraphHarnessAuthority,
	type D43AdmittedEffectV1,
	type D43EffectIntent,
	type D43EffectResultInputV1,
	snapshotD43GraphHarnessEvidence,
	takeD43AdmittedEffect,
	validateD43GraphHarnessEvidence,
} from "./graph-harness-authority.js";
import {
	admitD45EffectResult,
	admitD45ProviderWire,
	createD45GraphToolAuthority,
	type D45GraphToolAuthorityV1,
	readD45ProviderMaterial,
	snapshotD45PartialCanonicalEvidence,
	takeD45AdmittedEffect,
	validateD45PartialCanonicalEvidence,
} from "./graph-tool-authority.js";
import {
	createD45QualificationPolicy,
	D45_ASSIGNMENT,
	D45_READABLE_PATHS,
	D45_TASK_MATERIAL,
	D45_WRITABLE_PATH,
} from "./graph-tool-qualification.js";
import { lowerD45ProviderEffect } from "./mechanical-chat-adapter.js";
import {
	createD43ModelHarnessPolicy,
	createD43PolicyCatalog,
	type D43EnhancementRecipe,
} from "./model-harness-policy.js";

export const D66_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d66.retry-identity-qualification.v1" as const;

const RETRY_CASES = Object.freeze([
	Object.freeze({ intent: "initial" as const, retryClass: "D671" as const }),
	Object.freeze({ intent: "phase-correction" as const, retryClass: "D675" as const }),
	Object.freeze({ intent: "fresh-mutation" as const, retryClass: "D710" as const }),
	Object.freeze({ intent: "semantic-correction" as const, retryClass: "D675" as const }),
]);

function policyWithoutProviderContinuation() {
	const base = createD45QualificationPolicy();
	return createD43ModelHarnessPolicy({
		policyRef: "model-policy.deepseek-v4-flash-0731.deepinfra-fp8.d66-v1",
		model: {
			profileRef: base.model.profileRef,
			modelRef: base.model.modelRef,
			supportsNamedToolChoice: true,
			supportsParallelToolCalls: false,
			inspectionMaxOutputTokens: base.model.inspectionMaxOutputTokens,
			mutationMaxOutputTokens: base.model.mutationMaxOutputTokens,
		},
		provider: {
			bindingRef: base.provider.bindingRef,
			providerRef: base.provider.providerRef,
			endpointProtocol: base.provider.endpointProtocol,
			namedToolChoiceEncoding: base.provider.namedToolChoiceEncoding,
			allowFallback: false,
			allowProviderSwitch: false,
			allowParallelEffects: false,
			providerDeadlineMs: base.provider.providerDeadlineMs,
		},
		campaign: {
			campaignRef: base.campaign.campaignRef,
			arms: base.campaign.arms,
			maxProviderAttempts: base.campaign.maxProviderAttempts,
			maxCostMicrousd: base.campaign.maxCostMicrousd,
			maxElapsedMs: base.campaign.maxElapsedMs,
			localEffectReservationMs: base.campaign.localEffectReservationMs,
			providerReservationMicrousd: base.campaign.providerReservationMicrousd,
			publicSemanticScenarioSetDigest: base.campaign.publicSemanticScenarioSetDigest,
			taskEnvelopeDigest: base.campaign.taskEnvelopeDigest,
			maxSameLogicalRequestRetries: 1,
			retryClasses: ["D671", "D675", "D710"],
		},
		enhancementRecipes: base.enhancementRecipes.filter(
			(recipe): recipe is D43EnhancementRecipe =>
				recipe !== "sanitized-provider-failure-continuation",
		),
	});
}

function localResult(outcome: "success" | "passed" | "failed"): D43EffectResultInputV1 {
	return Object.freeze({
		outcome,
		elapsedMs: 1,
		costMicrousd: 0,
		usage: null,
		wireDigest: null,
		retryClass: null,
		criteria: null,
	});
}

function providerResult(
	effect: D43AdmittedEffectV1,
	outcome:
		| "success"
		| "schema-rejected"
		| "replacement-not-found"
		| "retryable-provider-failure"
		| "transport-failed",
	retryClass: "D671" | "D675" | "D710" | null = null,
): D43EffectResultInputV1 {
	return Object.freeze({
		outcome,
		elapsedMs: 1,
		costMicrousd: 1,
		usage:
			outcome === "retryable-provider-failure" || outcome === "transport-failed"
				? null
				: Object.freeze({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 0 }),
		wireDigest: empiricalStrictJsonDigest({ logicalRequestDigest: effect.logicalRequestDigest }),
		retryClass,
		criteria: null,
	});
}

function driveD43RetryCase(targetIntent: D43EffectIntent, retryClass: "D671" | "D675" | "D710") {
	const policy = policyWithoutProviderContinuation();
	const authority = createD43GraphHarnessAuthority({
		catalog: createD43PolicyCatalog([policy]),
		assignment: D45_ASSIGNMENT,
	});
	let injected = false;
	let initialEffect: D43AdmittedEffectV1 | null = null;
	let retryEffect: D43AdmittedEffectV1 | null = null;
	for (;;) {
		const effect = takeD43AdmittedEffect(authority);
		if (effect === null) break;
		if (!injected && effect.providerEffect && effect.intent === targetIntent) {
			injected = true;
			initialEffect = effect;
			admitD43EffectResult(
				authority,
				effect,
				providerResult(effect, "retryable-provider-failure", retryClass),
			);
			const retry = takeD43AdmittedEffect(authority);
			if (
				retry === null ||
				retry.intent !== targetIntent ||
				retry.logicalRequestDigest !== effect.logicalRequestDigest ||
				retry.attempt !== effect.attempt + 1 ||
				retry.requestDigest === effect.requestDigest ||
				retry.admissionDigest === effect.admissionDigest
			)
				throw new TypeError(`D66 ${targetIntent} retry identity drifted`);
			retryEffect = retry;
			admitD43EffectResult(authority, retry, providerResult(retry, "transport-failed"));
			continue;
		}
		if (effect.kind === "materialization" || effect.kind === "cleanup") {
			admitD43EffectResult(authority, effect, localResult("success"));
			continue;
		}
		if (effect.kind === "inspection") {
			admitD43EffectResult(
				authority,
				effect,
				providerResult(
					effect,
					targetIntent === "phase-correction" && effect.intent === "initial"
						? "schema-rejected"
						: "success",
				),
			);
			continue;
		}
		if (effect.kind === "mutation") {
			admitD43EffectResult(
				authority,
				effect,
				providerResult(
					effect,
					targetIntent === "fresh-mutation" && effect.intent === "initial"
						? "replacement-not-found"
						: "success",
				),
			);
			continue;
		}
		if (effect.kind === "focused-validation") {
			admitD43EffectResult(
				authority,
				effect,
				localResult(targetIntent === "semantic-correction" ? "failed" : "passed"),
			);
			continue;
		}
		admitD43EffectResult(
			authority,
			effect,
			localResult(effect.kind.includes("validation") ? "passed" : "success"),
		);
	}
	if (!injected || initialEffect === null || retryEffect === null)
		throw new TypeError(`D66 ${targetIntent} retry scenario did not reach its target`);
	const evidence = validateD43GraphHarnessEvidence(snapshotD43GraphHarnessEvidence(authority));
	if (!evidence.arms[0]?.cleanupCompleted || evidence.budget.providerAttempts < 2)
		throw new TypeError(`D66 ${targetIntent} retry cleanup or accounting drifted`);
	return Object.freeze({
		intent: targetIntent,
		retryClass,
		logicalRequestDigest: initialEffect.logicalRequestDigest,
		initialWireDigest: providerResult(initialEffect, "retryable-provider-failure", retryClass)
			.wireDigest,
		retryWireDigest: providerResult(retryEffect, "transport-failed").wireDigest,
		initialRequestDigest: initialEffect.requestDigest,
		retryRequestDigest: retryEffect.requestDigest,
		evidenceDigest: evidence.evidenceDigest,
	});
}

function createD45Authority(): D45GraphToolAuthorityV1 {
	const policy = policyWithoutProviderContinuation();
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

function admitMaterialization(authority: D45GraphToolAuthorityV1): string {
	const effect = takeD45AdmittedEffect(authority);
	if (effect?.sourceD43EffectKind !== "materialization")
		throw new TypeError("D66 materialization admission drifted");
	const workspaceStateDigest = empiricalStrictJsonDigest("d66-workspace-state");
	admitD45EffectResult(authority, effect, {
		effectKind: "local-effect",
		outcome: "success",
		elapsedMs: 1,
		evidenceDigest: empiricalStrictJsonDigest("d66-materialized"),
		workspaceStateDigest,
		criteria: null,
	});
	return workspaceStateDigest;
}

function reachD45PhaseCorrectionRetry(authority: D45GraphToolAuthorityV1) {
	admitMaterialization(authority);
	const initial = takeD45AdmittedEffect(authority);
	if (initial?.effectKind !== "provider-proposal" || initial.phase !== "inspection")
		throw new TypeError("D66 initial provider admission drifted");
	const initialWire = lowerD45ProviderEffect(authority, initial);
	admitD45EffectResult(authority, initial, {
		effectKind: "provider-proposal",
		outcome: "success",
		elapsedMs: 1,
		costMicrousd: 1,
		usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0 },
		wireDigest: initialWire.wireDigest,
		retryClass: null,
		responseRejectionCode: null,
		proposal: { toolCalls: [] },
	});
	const correction = takeD45AdmittedEffect(authority);
	if (correction?.effectKind !== "provider-proposal" || correction.phase !== "inspection")
		throw new TypeError("D66 phase-correction admission drifted");
	const correctionWire = lowerD45ProviderEffect(authority, correction);
	admitD45EffectResult(authority, correction, {
		effectKind: "provider-proposal",
		outcome: "retryable-provider-failure",
		elapsedMs: 1,
		costMicrousd: 1,
		usage: null,
		wireDigest: correctionWire.wireDigest,
		retryClass: "D675",
		responseRejectionCode: null,
		proposal: null,
	});
	const retry = takeD45AdmittedEffect(authority);
	if (
		retry?.effectKind !== "provider-proposal" ||
		retry.logicalRequestDigest !== correction.logicalRequestDigest
	)
		throw new TypeError("D66 D45 retry admission drifted");
	return Object.freeze({ correction, correctionWire, retry });
}

function qualifyD45PreDispatchIdentity() {
	const authority = createD45Authority();
	const { correction, correctionWire, retry } = reachD45PhaseCorrectionRetry(authority);
	const retryWire = lowerD45ProviderEffect(authority, retry);
	if (retryWire.body !== correctionWire.body || retryWire.wireDigest !== correctionWire.wireDigest)
		throw new TypeError("D66 mechanical retry wire changed after phase correction");
	const partial = validateD45PartialCanonicalEvidence(
		snapshotD45PartialCanonicalEvidence(authority),
	);
	admitD45EffectResult(authority, retry, {
		effectKind: "provider-proposal",
		outcome: "transport-failed",
		elapsedMs: 1,
		costMicrousd: 1,
		usage: null,
		wireDigest: retryWire.wireDigest,
		retryClass: null,
		responseRejectionCode: null,
		proposal: null,
	});
	const cleanup = takeD45AdmittedEffect(authority);
	if (cleanup?.sourceD43EffectKind !== "cleanup")
		throw new TypeError("D66 D45 retry failure did not release cleanup");
	admitD45EffectResult(authority, cleanup, {
		effectKind: "local-effect",
		outcome: "success",
		elapsedMs: 1,
		evidenceDigest: empiricalStrictJsonDigest("d66-cleanup"),
		workspaceStateDigest: null,
		criteria: null,
	});
	if (takeD45AdmittedEffect(authority) !== null)
		throw new TypeError("D66 D45 cleanup did not stop the bounded scenario");
	return Object.freeze({
		logicalRequestDigest: correction.logicalRequestDigest,
		wireDigest: retryWire.wireDigest,
		partialEvidenceDigest: partial.evidenceDigest,
	});
}

function qualifyD45PreDispatchDriftRejection() {
	const authority = createD45Authority();
	const { retry } = reachD45PhaseCorrectionRetry(authority);
	readD45ProviderMaterial(authority, retry);
	let rejected = false;
	try {
		admitD45ProviderWire(authority, retry, `sha256:${"f".repeat(64)}`);
	} catch {
		rejected = true;
	}
	if (!rejected) throw new TypeError("D66 accepted retry wire drift before dispatch");
	const partial = validateD45PartialCanonicalEvidence(
		snapshotD45PartialCanonicalEvidence(authority),
	);
	if (partial.activeWireDigest !== null)
		throw new TypeError("D66 persisted rejected retry wire evidence");
	return Object.freeze({ rejected: true as const, evidenceDigest: partial.evidenceDigest });
}

export function runD66RetryIdentityQualification() {
	const cases = Object.freeze(
		RETRY_CASES.map(({ intent, retryClass }) => driveD43RetryCase(intent, retryClass)),
	);
	if (cases.some((item) => item.initialWireDigest !== item.retryWireDigest))
		throw new TypeError("D66 same-request retry wire identity qualification drifted");
	const d45Identity = qualifyD45PreDispatchIdentity();
	const d45Drift = qualifyD45PreDispatchDriftRejection();
	const material = strictSnapshot({
		schemaVersion: D66_QUALIFICATION_SCHEMA,
		decisionRef: "graphrefly-ts:D66" as const,
		cases,
		d45Identity,
		d45Drift,
		originalIntentPreserved: true as const,
		freshRequestAndAdmissionCoordinates: true as const,
		exactWireIdentity: true as const,
		preDispatchWireDriftRejected: true as const,
		boundedRetryCardinalityUnchanged: true as const,
		cleanupQualified: true as const,
		canonicalReplayQualified: true as const,
		rawMaterialPersisted: false as const,
		providerNetworkCalls: 0 as const,
		credentialReads: 0 as const,
		dispatchClaims: 0 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const serialized = JSON.stringify(material);
	if (/(oldText|newText|<graph-admitted-read|Authorization|sk-or-v1)/u.test(serialized))
		throw new TypeError("D66 qualification persisted raw material");
	return Object.freeze({
		...material,
		qualificationDigest: empiricalStrictJsonDigest(material),
		artifactDigest: empiricalSha256(new TextEncoder().encode(serialized)),
	});
}
