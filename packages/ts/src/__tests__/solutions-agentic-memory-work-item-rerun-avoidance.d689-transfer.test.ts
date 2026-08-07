import { describe, expect, it, vi } from "vitest";
import { empiricalStrictJsonDigest } from "../../evals/empirical-memory-rerun-avoidance/canonical.js";
import {
	buildD689OfflineEvidence,
	createD689PrivateMaterialProtectionBundle,
	D689_CLAIM_BOUNDARY,
	D689_PAIR_QUALIFICATION_VERSION,
	D689_TRANSFER_MEMORY_VERSION,
	qualifyD689TransferMemory,
	validateD689PairQualification,
	validateD689TransferMemory,
	validateD689TransferQualityReport,
} from "../../evals/empirical-memory-rerun-avoidance/cross-work-item-memory-transfer.js";
import { strictJsonCodec } from "../json/codec.js";

const TARGET_PRIVATE_NEEDLE = "TARGET_PRIVATE_EXPECTED_PATCH_SENTINEL_689";
const SOURCE_RAW_PATCH_NEEDLE = "SOURCE_RAW_PATCH_SENTINEL_689";
const CREDENTIAL_NEEDLE = "sk-private-credential-sentinel-689";
const ENVIRONMENT_NEEDLE = "PRIVATE_ENVIRONMENT_SENTINEL_689";
const PRIVATE_WORKSPACE_NEEDLE = "PRIVATE_WORKSPACE_SENTINEL_689";

function evidenceDigest(label: string): string {
	return empiricalStrictJsonDigest({ label });
}

const sourceEvidence = Object.freeze({
	run: evidenceDigest("source-run"),
	actions: evidenceDigest("source-actions"),
	mutation: evidenceDigest("source-mutation"),
	verifier: evidenceDigest("source-verifier"),
});

function rule(statement: string, source = sourceEvidence.actions) {
	return { statement, sourceEvidenceDigests: [source] };
}

function memory(overrides: Record<string, unknown> = {}) {
	return {
		version: D689_TRANSFER_MEMORY_VERSION,
		memoryRef: "memory.source-success.cache-invalidation",
		memoryRevision: "memory.source-success.cache-invalidation.v1",
		sourceTaskRef: "task.source.cache-invalidation",
		failureMechanismRef: "failure-mechanism.stale-derived-state",
		failureMechanismRevision: "failure-mechanism.stale-derived-state.v1",
		triggerConditions: [
			rule(
				"A derived value remains stable after its upstream identity changes while the old identity still resolves.",
			),
		],
		diagnosticDiscriminators: [
			rule(
				"Compare the dependency identity used to populate the cache with the identity used to read it before changing invalidation code.",
			),
		],
		correctionPrinciples: [
			rule(
				"Bind the cached derivation to the dependency identity that owns the value, and invalidate only when that identity changes.",
				sourceEvidence.mutation,
			),
		],
		validationStrategy: [
			rule(
				"Exercise unchanged and changed dependency identities, then run the focused regression before the broader suite.",
				sourceEvidence.verifier,
			),
		],
		knownBadRouteContraindications: [
			rule(
				"Do not clear every cache entry when the evidence identifies one dependency-scoped stale value.",
			),
		],
		applicabilityScope: [
			rule(
				"Apply only when a retained derived value is keyed by an upstream identity and the verifier can distinguish unchanged from changed identity.",
			),
		],
		sourceEvidenceDigests: [
			sourceEvidence.verifier,
			sourceEvidence.run,
			sourceEvidence.mutation,
			sourceEvidence.actions,
		],
		...overrides,
	};
}

function pair(
	memoryValue: unknown,
	overrides: {
		readonly source?: Record<string, unknown>;
		readonly target?: Record<string, unknown>;
		readonly top?: Record<string, unknown>;
		readonly attestation?: Record<string, unknown>;
		readonly protectionAttestation?: Record<string, unknown>;
	} = {},
) {
	const sameMechanismEvidenceDigest = evidenceDigest("pair-causal-mechanism-evidence");
	const distinctnessEvidenceDigest = evidenceDigest("pair-distinctness-evidence");
	const historyFreedomEvidenceDigest = evidenceDigest("target-history-freedom-evidence");
	const actionabilityEvidenceDigest = evidenceDigest("independent-actionability-attestation");
	const protectionEvidenceDigest = evidenceDigest("private-material-protection-attestation");
	const protectedSetBindingDigest = protection().protectedSetBindingDigest;
	return {
		version: D689_PAIR_QUALIFICATION_VERSION,
		qualificationRef: "qualification.d689.synthetic-pair",
		qualificationRevision: "qualification.d689.synthetic-pair.v1",
		authorityRef: "operator.d689.pair-qualification",
		authorityRevision: "operator.d689.pair-qualification.v1",
		source: {
			taskRef: "task.source.cache-invalidation",
			fileIdentityDigest: evidenceDigest("source-file"),
			symbolIdentityDigest: evidenceDigest("source-symbol"),
			testIdentityDigest: evidenceDigest("source-test"),
			expectedMaterialIdentityDigest: evidenceDigest("source-expected-material"),
			runDigest: sourceEvidence.run,
			actionTraceDigest: sourceEvidence.actions,
			mutationEvidenceDigest: sourceEvidence.mutation,
			verifierRef: "verifier.closed-source",
			verifierRevision: "verifier.closed-source.v1",
			verifierEvidenceDigest: sourceEvidence.verifier,
			verifierStatus: "passed",
			...overrides.source,
		},
		target: {
			taskRef: "task.target.subscription-refresh",
			fileIdentityDigest: evidenceDigest("target-file"),
			symbolIdentityDigest: evidenceDigest("target-symbol"),
			testIdentityDigest: evidenceDigest("target-test"),
			expectedMaterialIdentityDigest: evidenceDigest("target-expected-material"),
			historyStatus: "history-free",
			...overrides.target,
		},
		sourceFailureMechanismRef: "failure-mechanism.stale-derived-state",
		sourceFailureMechanismRevision: "failure-mechanism.stale-derived-state.v1",
		targetFailureMechanismRef: "failure-mechanism.stale-derived-state",
		targetFailureMechanismRevision: "failure-mechanism.stale-derived-state.v1",
		sameMechanismQualified: true,
		sameMechanismEvidenceDigest,
		distinctnessEvidenceDigest,
		historyFreedomEvidenceDigest,
		actionabilityAttestation: {
			memoryDigest: empiricalStrictJsonDigest(validateD689TransferMemory(memoryValue)),
			actionable: true,
			genericOnly: false,
			evidenceDigest: actionabilityEvidenceDigest,
			...overrides.attestation,
		},
		privateMaterialProtectionAttestation: {
			capabilityRef: "capability.d689.private-material",
			capabilityRevision: "capability.d689.private-material.v1",
			protectedMaterialClasses: [
				"credential",
				"environment",
				"private-workspace",
				"source-raw-code-or-patch",
				"target-expected-material",
			],
			protectedSetBindingDigest,
			evidenceDigest: protectionEvidenceDigest,
			...overrides.protectionAttestation,
		},
		qualificationEvidenceDigests: [
			sameMechanismEvidenceDigest,
			distinctnessEvidenceDigest,
			historyFreedomEvidenceDigest,
			actionabilityEvidenceDigest,
			protectionEvidenceDigest,
		],
		...overrides.top,
	};
}

function protection(targetExpectedMaterialNeedles = [TARGET_PRIVATE_NEEDLE]) {
	return createD689PrivateMaterialProtectionBundle({
		policyRef: "policy.d689.target-private-needle",
		policyRevision: "policy.d689.target-private-needle.v1",
		capabilityRef: "capability.d689.private-material",
		capabilityRevision: "capability.d689.private-material.v1",
		protectedNeedlesByClass: [
			{ materialClass: "credential", protectedNeedles: [CREDENTIAL_NEEDLE] },
			{ materialClass: "environment", protectedNeedles: [ENVIRONMENT_NEEDLE] },
			{ materialClass: "private-workspace", protectedNeedles: [PRIVATE_WORKSPACE_NEEDLE] },
			{ materialClass: "source-raw-code-or-patch", protectedNeedles: [SOURCE_RAW_PATCH_NEEDLE] },
			{
				materialClass: "target-expected-material",
				protectedNeedles: targetExpectedMaterialNeedles,
			},
		],
	});
}

describe("D689 cross-WorkItem successful-experience transfer", () => {
	it("passes a distinct, causally qualified, actionable, target-clean transfer memory", () => {
		const transferMemory = memory();
		const report = qualifyD689TransferMemory({
			memory: transferMemory,
			pairQualification: pair(transferMemory),
			privateMaterialProtection: protection(),
		});

		expect(report.preProviderQualityGatePassed).toBe(true);
		expect(report.issueCodes).toEqual([]);
		expect(report.privateMaterialProtectionReceipt.disposition).toBe("allowed");
		expect(report.claimBoundary).toBe(D689_CLAIM_BOUNDARY);
		expect(report.efficacyClaim).toBe("none");
		expect(JSON.stringify(report)).not.toContain(TARGET_PRIVATE_NEEDLE);
	});

	it("fails closed when source success, distinctness, mechanism, history, or actionability is absent", () => {
		const transferMemory = memory();
		const baselinePair = pair(transferMemory);
		const rejected = qualifyD689TransferMemory({
			memory: transferMemory,
			pairQualification: {
				...baselinePair,
				source: {
					...baselinePair.source,
					verifierStatus: "failed",
				},
				target: {
					...baselinePair.target,
					taskRef: baselinePair.source.taskRef,
					fileIdentityDigest: baselinePair.source.fileIdentityDigest,
					symbolIdentityDigest: baselinePair.source.symbolIdentityDigest,
					testIdentityDigest: baselinePair.source.testIdentityDigest,
					expectedMaterialIdentityDigest: baselinePair.source.expectedMaterialIdentityDigest,
					historyStatus: "history-exposed",
				},
				targetFailureMechanismRef: "failure-mechanism.unrelated",
				historyFreedomEvidenceDigest: evidenceDigest("tampered-history-freedom-evidence"),
				sameMechanismQualified: false,
				actionabilityAttestation: {
					...baselinePair.actionabilityAttestation,
					actionable: false,
					genericOnly: true,
				},
			},
			privateMaterialProtection: protection(),
		});

		expect(rejected.preProviderQualityGatePassed).toBe(false);
		expect(rejected.issueCodes).toEqual([
			"failure-mechanism-coordinate-mismatch",
			"memory-generic-only",
			"memory-not-actionable",
			"qualification-evidence-binding-incomplete",
			"same-mechanism-not-qualified",
			"source-target-expected-material-not-distinct",
			"source-target-file-not-distinct",
			"source-target-symbol-not-distinct",
			"source-target-task-not-distinct",
			"source-target-test-not-distinct",
			"source-verifier-not-passed",
			"target-not-history-free",
		]);
	});

	it("blocks target, source-patch, credential, environment, and workspace sentinels", () => {
		for (const sentinel of [
			TARGET_PRIVATE_NEEDLE,
			SOURCE_RAW_PATCH_NEEDLE,
			CREDENTIAL_NEEDLE,
			ENVIRONMENT_NEEDLE,
			PRIVATE_WORKSPACE_NEEDLE,
		]) {
			const leakedMemory = memory({
				correctionPrinciples: [
					rule(`Forbidden private material: ${sentinel}`, sourceEvidence.mutation),
				],
			});
			const report = qualifyD689TransferMemory({
				memory: leakedMemory,
				pairQualification: pair(leakedMemory),
				privateMaterialProtection: protection(),
			});

			expect(report.preProviderQualityGatePassed).toBe(false);
			expect(report.issueCodes).toEqual(["memory-protection-blocked"]);
			expect(report.privateMaterialProtectionReceipt.disposition).toBe("blocked");
			expect(new TextDecoder().decode(strictJsonCodec.encode(report))).not.toContain(sentinel);
			expect(JSON.stringify(report)).not.toContain(sentinel);
		}
	});

	it("binds complete protection coverage and reads the protection capability exactly once", () => {
		const transferMemory = memory({
			correctionPrinciples: [
				rule(`Forbidden private material: ${TARGET_PRIVATE_NEEDLE}`, sourceEvidence.mutation),
			],
		});
		const incomplete = qualifyD689TransferMemory({
			memory: transferMemory,
			pairQualification: pair(transferMemory, {
				protectionAttestation: {
					capabilityRef: "capability.d689.wrong-private-material",
					protectedMaterialClasses: ["target-expected-material"],
				},
			}),
			privateMaterialProtection: protection(),
		});
		expect(incomplete.issueCodes).toEqual(
			[
				"private-material-protection-capability-mismatch",
				"private-material-protection-coverage-incomplete",
				"memory-protection-blocked",
			].sort(),
		);
		const substitutedSet = qualifyD689TransferMemory({
			memory: transferMemory,
			pairQualification: pair(transferMemory),
			privateMaterialProtection: protection(["UNRELATED_PRIVATE_SENTINEL_689"]),
		});
		expect(substitutedSet.preProviderQualityGatePassed).toBe(false);
		expect(substitutedSet.issueCodes).toEqual(["private-material-protection-set-binding-mismatch"]);
		expect(substitutedSet.privateMaterialProtectionReceipt.disposition).toBe("allowed");

		const protectedExecutor = protection();
		const unrelatedExecutor = protection(["UNRELATED_PRIVATE_SENTINEL_689"]);
		let reads = 0;
		const input = {
			memory: transferMemory,
			pairQualification: pair(transferMemory),
		} as {
			memory: unknown;
			pairQualification: unknown;
			privateMaterialProtection: typeof protectedExecutor;
		};
		Object.defineProperty(input, "privateMaterialProtection", {
			enumerable: true,
			get: () => {
				reads += 1;
				return reads === 1 ? protectedExecutor : unrelatedExecutor;
			},
		});
		const report = qualifyD689TransferMemory(input);
		expect(reads).toBe(1);
		expect(report.issueCodes).toEqual(["memory-protection-blocked"]);
	});

	it("rejects malformed shapes and evidence references outside the source binding", () => {
		const transferMemory = memory();
		expect(() => validateD689TransferMemory({ ...transferMemory, unexpected: true })).toThrow(
			/unexpected keys/,
		);
		expect(() =>
			validateD689TransferMemory({
				...transferMemory,
				triggerConditions: [rule("Unbound evidence", evidenceDigest("not-bound"))],
			}),
		).toThrow(/rule evidence must be bound/);
		const accessor = { ...transferMemory };
		Object.defineProperty(accessor, "memoryRef", {
			get: () => "memory.accessor",
			enumerable: true,
		});
		expect(() => validateD689TransferMemory(accessor)).toThrow(/own data property/);
		expect(() =>
			validateD689PairQualification({ ...pair(transferMemory), unexpected: true }),
		).toThrow(/unexpected keys/);
	});

	it("canonicalizes rule, evidence, and case order into deterministic dry-run evidence", () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		try {
			const collisionResistantRules = [
				rule("x", sourceEvidence.actions),
				rule(`x\u0000${sourceEvidence.actions}`, sourceEvidence.verifier),
			];
			const firstMemory = memory({ triggerConditions: collisionResistantRules });
			const secondMemory = memory({
				triggerConditions: [...collisionResistantRules].reverse(),
				sourceEvidenceDigests: [...firstMemory.sourceEvidenceDigests].reverse(),
			});
			const firstPass = qualifyD689TransferMemory({
				memory: firstMemory,
				pairQualification: pair(firstMemory),
				privateMaterialProtection: protection(),
			});
			const secondPass = qualifyD689TransferMemory({
				memory: secondMemory,
				pairQualification: pair(secondMemory),
				privateMaterialProtection: protection(),
			});
			expect(strictJsonCodec.encode(firstPass)).toEqual(strictJsonCodec.encode(secondPass));

			const genericPair = pair(firstMemory, { attestation: { genericOnly: true } });
			const cases = [
				{
					caseRef: "case.positive",
					expectedDisposition: "pass" as const,
					memory: firstMemory,
					pairQualification: pair(firstMemory),
					privateMaterialProtection: protection(),
				},
				{
					caseRef: "case.generic-only",
					expectedDisposition: "reject" as const,
					memory: firstMemory,
					pairQualification: genericPair,
					privateMaterialProtection: protection(),
				},
			];
			const forward = buildD689OfflineEvidence(cases);
			const reversed = buildD689OfflineEvidence([...cases].reverse());

			expect(strictJsonCodec.encode(forward)).toEqual(strictJsonCodec.encode(reversed));
			expect(forward).toMatchObject({
				caseCount: 2,
				passingCaseCount: 1,
				rejectedCaseCount: 1,
				providerCallCount: 0,
				historicalEvidenceRewritten: false,
				targetMaterialPersisted: false,
				publicExportDelta: false,
				efficacyClaim: "none",
			});
			expect(forward.evidenceDigest).toBe(
				"sha256:3b154b7f259a5ae4ab1cd383a7601c71103ac6fe494f558b5ca91aab71961090",
			);
			expect(fetchSpy).not.toHaveBeenCalled();
			const roundTrippedReport = strictJsonCodec.decode(strictJsonCodec.encode(firstPass));
			expect(validateD689TransferQualityReport(roundTrippedReport)).toEqual(firstPass);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
