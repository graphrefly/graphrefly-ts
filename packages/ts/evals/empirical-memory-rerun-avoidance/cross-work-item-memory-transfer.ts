import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	boolean,
	coordinate,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	fail,
	literal,
	oneOf,
	record,
	strictSnapshot,
	string,
} from "./canonical.js";
import {
	createEmpiricalExactPrivateNeedleProtectionExecutor,
	type EmpiricalExactPrivateNeedleProtectionExecutorV1,
	MAX_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS,
	MAX_EMPIRICAL_PRIVATE_NEEDLES,
	MIN_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS,
} from "./exact-private-needle-protection.js";
import {
	type EmpiricalProtectionReceiptV1,
	executeEmpiricalProtection,
} from "./model-execution.js";

export const D689_TRANSFER_MEMORY_VERSION =
	"graphrefly.private-solution-eval.cross-work-item-transfer-memory.v1" as const;
export const D689_PAIR_QUALIFICATION_VERSION =
	"graphrefly.private-solution-eval.cross-work-item-pair-qualification.v1" as const;
export const D689_QUALITY_REPORT_VERSION =
	"graphrefly.private-solution-eval.cross-work-item-transfer-quality-report.v1" as const;
export const D689_OFFLINE_EVIDENCE_VERSION =
	"graphrefly.private-solution-eval.cross-work-item-transfer-offline-evidence.v1" as const;
export const D689_CLAIM_BOUNDARY =
	"cross-work-item-successful-experience-transfer-offline-no-efficacy-claim" as const;

const MAX_RULES = 16;
const MAX_RULE_STATEMENT_CODE_UNITS = 1_024;
const MAX_EVIDENCE_DIGESTS = 32;
const MAX_TRANSFER_MEMORY_BYTES = 131_072;
const MAX_DRY_RUN_CASES = 64;

export type D689QualityIssueCode =
	| "source-verifier-not-passed"
	| "source-evidence-binding-incomplete"
	| "qualification-evidence-binding-incomplete"
	| "source-target-task-not-distinct"
	| "source-target-file-not-distinct"
	| "source-target-symbol-not-distinct"
	| "source-target-test-not-distinct"
	| "source-target-expected-material-not-distinct"
	| "target-not-history-free"
	| "failure-mechanism-coordinate-mismatch"
	| "same-mechanism-not-qualified"
	| "memory-pair-coordinate-mismatch"
	| "memory-provenance-mismatch"
	| "memory-not-actionable"
	| "memory-generic-only"
	| "private-material-protection-capability-mismatch"
	| "private-material-protection-coverage-incomplete"
	| "private-material-protection-set-binding-mismatch"
	| "memory-protection-blocked"
	| "memory-protection-failed";

export type D689ProtectedMaterialClass =
	| "credential"
	| "environment"
	| "private-workspace"
	| "source-raw-code-or-patch"
	| "target-expected-material";

const REQUIRED_PROTECTED_MATERIAL_CLASSES = Object.freeze([
	"credential",
	"environment",
	"private-workspace",
	"source-raw-code-or-patch",
	"target-expected-material",
] as const satisfies readonly D689ProtectedMaterialClass[]);
const D689_PRIVATE_MATERIAL_PROTECTION_PROFILE =
	"graphrefly.private-solution-eval.d689-private-material-protection.v1" as const;
const constructedPrivateMaterialProtectionBundles = new WeakSet<object>();

export interface D689PrivateMaterialProtectionBundleV1 {
	readonly profile: typeof D689_PRIVATE_MATERIAL_PROTECTION_PROFILE;
	readonly capabilityRef: string;
	readonly capabilityRevision: string;
	readonly protectedMaterialClasses: readonly D689ProtectedMaterialClass[];
	readonly protectedSetBindingDigest: string;
	readonly executor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
}

export function createD689PrivateMaterialProtectionBundle(
	value: unknown,
): D689PrivateMaterialProtectionBundleV1 {
	const config = record(value, "d689.privateMaterialProtection");
	exactKeys(
		config,
		[
			"capabilityRef",
			"capabilityRevision",
			"policyRef",
			"policyRevision",
			"protectedNeedlesByClass",
		],
		"d689.privateMaterialProtection",
	);
	const capabilityRef = coordinate(
		config.capabilityRef,
		"d689.privateMaterialProtection.capabilityRef",
	);
	const capabilityRevision = coordinate(
		config.capabilityRevision,
		"d689.privateMaterialProtection.capabilityRevision",
	);
	const entries = array(
		config.protectedNeedlesByClass,
		"d689.privateMaterialProtection.protectedNeedlesByClass",
	).map((entry, index) => {
		const path = `d689.privateMaterialProtection.protectedNeedlesByClass[${index}]`;
		const classified = record(entry, path);
		exactKeys(classified, ["materialClass", "protectedNeedles"], path);
		const materialClass = oneOf(
			classified.materialClass,
			REQUIRED_PROTECTED_MATERIAL_CLASSES,
			`${path}.materialClass`,
		);
		const needles = array(classified.protectedNeedles, `${path}.protectedNeedles`).map(
			(needle, needleIndex) => {
				const validated = string(
					needle,
					`${path}.protectedNeedles[${needleIndex}]`,
					MAX_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS,
				);
				if (validated.length < MIN_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS) {
					fail(
						`${path}.protectedNeedles[${needleIndex}]`,
						`expected at least ${MIN_EMPIRICAL_PRIVATE_NEEDLE_CODE_UNITS} code units`,
					);
				}
				return validated;
			},
		);
		if (needles.length === 0) fail(`${path}.protectedNeedles`, "expected at least one needle");
		if (new Set(needles).size !== needles.length) {
			fail(`${path}.protectedNeedles`, "expected unique needles");
		}
		return { materialClass, needles: Object.freeze([...needles].sort()) };
	});
	if (new Set(entries.map((entry) => entry.materialClass)).size !== entries.length) {
		fail("d689.privateMaterialProtection.protectedNeedlesByClass", "expected unique classes");
	}
	entries.sort((left, right) => compareCodeUnits(left.materialClass, right.materialClass));
	if (
		!sameDigestSet(
			entries.map((entry) => entry.materialClass),
			REQUIRED_PROTECTED_MATERIAL_CLASSES,
		)
	) {
		fail(
			"d689.privateMaterialProtection.protectedNeedlesByClass",
			"expected exact D689 protected material classes",
		);
	}
	const protectedNeedles = entries.flatMap((entry) => entry.needles);
	if (protectedNeedles.length > MAX_EMPIRICAL_PRIVATE_NEEDLES) {
		fail(
			"d689.privateMaterialProtection.protectedNeedlesByClass",
			`expected at most ${MAX_EMPIRICAL_PRIVATE_NEEDLES} total needles`,
		);
	}
	if (new Set(protectedNeedles).size !== protectedNeedles.length) {
		fail("d689.privateMaterialProtection", "needles must be unique across material classes");
	}
	const policyRef = coordinate(config.policyRef, "d689.privateMaterialProtection.policyRef");
	const policyRevision = coordinate(
		config.policyRevision,
		"d689.privateMaterialProtection.policyRevision",
	);
	const protectedSetBindingDigest = empiricalStrictJsonDigest({
		kind: "d689-private-material-protected-set-binding.v1",
		capabilityRef,
		capabilityRevision,
		classes: entries.map((entry) => ({
			materialClass: entry.materialClass,
			needleDigests: entry.needles
				.map((needle) =>
					empiricalStrictJsonDigest({
						kind: "d689-private-material-needle-binding.v1",
						materialClass: entry.materialClass,
						needle,
					}),
				)
				.sort(),
		})),
	});
	const bundle = Object.freeze({
		profile: D689_PRIVATE_MATERIAL_PROTECTION_PROFILE,
		capabilityRef,
		capabilityRevision,
		protectedMaterialClasses: REQUIRED_PROTECTED_MATERIAL_CLASSES,
		protectedSetBindingDigest,
		executor: createEmpiricalExactPrivateNeedleProtectionExecutor({
			policyRef,
			policyRevision,
			protectedNeedleCapabilityRef: capabilityRef,
			protectedNeedleCapabilityRevision: capabilityRevision,
			protectedNeedles,
		}),
	});
	constructedPrivateMaterialProtectionBundles.add(bundle);
	return bundle;
}

export interface D689TransferRuleV1 {
	readonly statement: string;
	readonly sourceEvidenceDigests: readonly string[];
}

export interface D689TransferMemoryV1 {
	readonly version: typeof D689_TRANSFER_MEMORY_VERSION;
	readonly memoryRef: string;
	readonly memoryRevision: string;
	readonly sourceTaskRef: string;
	readonly failureMechanismRef: string;
	readonly failureMechanismRevision: string;
	readonly triggerConditions: readonly D689TransferRuleV1[];
	readonly diagnosticDiscriminators: readonly D689TransferRuleV1[];
	readonly correctionPrinciples: readonly D689TransferRuleV1[];
	readonly validationStrategy: readonly D689TransferRuleV1[];
	readonly knownBadRouteContraindications: readonly D689TransferRuleV1[];
	readonly applicabilityScope: readonly D689TransferRuleV1[];
	readonly sourceEvidenceDigests: readonly string[];
}

export interface D689PairTaskCoordinatesV1 {
	readonly taskRef: string;
	readonly fileIdentityDigest: string;
	readonly symbolIdentityDigest: string;
	readonly testIdentityDigest: string;
	readonly expectedMaterialIdentityDigest: string;
}

export interface D689PairQualificationV1 {
	readonly version: typeof D689_PAIR_QUALIFICATION_VERSION;
	readonly qualificationRef: string;
	readonly qualificationRevision: string;
	readonly authorityRef: string;
	readonly authorityRevision: string;
	readonly source: D689PairTaskCoordinatesV1 & {
		readonly runDigest: string;
		readonly actionTraceDigest: string;
		readonly mutationEvidenceDigest: string;
		readonly verifierRef: string;
		readonly verifierRevision: string;
		readonly verifierEvidenceDigest: string;
		readonly verifierStatus: "passed" | "failed" | "unverifiable";
	};
	readonly target: D689PairTaskCoordinatesV1 & {
		readonly historyStatus: "history-free" | "history-exposed";
	};
	readonly sourceFailureMechanismRef: string;
	readonly sourceFailureMechanismRevision: string;
	readonly targetFailureMechanismRef: string;
	readonly targetFailureMechanismRevision: string;
	readonly sameMechanismQualified: boolean;
	readonly sameMechanismEvidenceDigest: string;
	readonly distinctnessEvidenceDigest: string;
	readonly historyFreedomEvidenceDigest: string;
	readonly actionabilityAttestation: {
		readonly memoryDigest: string;
		readonly actionable: boolean;
		readonly genericOnly: boolean;
		readonly evidenceDigest: string;
	};
	readonly privateMaterialProtectionAttestation: {
		readonly capabilityRef: string;
		readonly capabilityRevision: string;
		readonly protectedMaterialClasses: readonly D689ProtectedMaterialClass[];
		readonly protectedSetBindingDigest: string;
		readonly evidenceDigest: string;
	};
	readonly qualificationEvidenceDigests: readonly string[];
}

export interface D689TransferQualityReportV1 {
	readonly version: typeof D689_QUALITY_REPORT_VERSION;
	readonly claimBoundary: typeof D689_CLAIM_BOUNDARY;
	readonly efficacyClaim: "none";
	readonly pairQualificationDigest: string;
	readonly memoryDigest: string;
	readonly sourceTaskRef: string;
	readonly targetTaskRef: string;
	readonly failureMechanismRef: string;
	readonly preProviderQualityGatePassed: boolean;
	readonly issueCodes: readonly D689QualityIssueCode[];
	readonly privateMaterialProtectionReceipt: EmpiricalProtectionReceiptV1;
}

export interface D689OfflineDryRunCaseV1 {
	readonly caseRef: string;
	readonly expectedDisposition: "pass" | "reject";
	readonly memory: unknown;
	readonly pairQualification: unknown;
	readonly privateMaterialProtection: D689PrivateMaterialProtectionBundleV1;
}

export interface D689OfflineEvidenceV1 {
	readonly version: typeof D689_OFFLINE_EVIDENCE_VERSION;
	readonly claimBoundary: typeof D689_CLAIM_BOUNDARY;
	readonly efficacyClaim: "none";
	readonly caseCount: number;
	readonly passingCaseCount: number;
	readonly rejectedCaseCount: number;
	readonly allExpectedDispositionsObserved: true;
	readonly providerCallCount: 0;
	readonly historicalEvidenceRewritten: false;
	readonly targetMaterialPersisted: false;
	readonly publicExportDelta: false;
	readonly casesDigest: string;
	readonly evidenceDigest: string;
}

function canonicalDigestSet(
	value: unknown,
	path: string,
	options: { readonly min: number; readonly max?: number },
): readonly string[] {
	const entries = array(value, path);
	const max = options.max ?? MAX_EVIDENCE_DIGESTS;
	if (entries.length < options.min || entries.length > max) {
		fail(path, `expected between ${options.min} and ${max} digests`);
	}
	const result = entries.map((entry, index) => digest(entry, `${path}[${index}]`)).sort();
	if (new Set(result).size !== result.length) fail(path, "expected unique digests");
	return Object.freeze(result);
}

function canonicalRules(value: unknown, path: string, min: number): readonly D689TransferRuleV1[] {
	const entries = array(value, path);
	if (entries.length < min || entries.length > MAX_RULES) {
		fail(path, `expected between ${min} and ${MAX_RULES} rules`);
	}
	const result = entries.map((entry, index) => {
		const rulePath = `${path}[${index}]`;
		const rule = record(entry, rulePath);
		exactKeys(rule, ["sourceEvidenceDigests", "statement"], rulePath);
		return strictSnapshot({
			statement: string(rule.statement, `${rulePath}.statement`, MAX_RULE_STATEMENT_CODE_UNITS),
			sourceEvidenceDigests: canonicalDigestSet(
				rule.sourceEvidenceDigests,
				`${rulePath}.sourceEvidenceDigests`,
				{ min: 1, max: 8 },
			),
		});
	});
	if (new Set(result.map((entry) => entry.statement)).size !== result.length) {
		fail(path, "expected unique rule statements");
	}
	return Object.freeze(
		result.sort((left, right) => compareCodeUnits(left.statement, right.statement)),
	);
}

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function validateD689TransferMemory(value: unknown): D689TransferMemoryV1 {
	const memory = record(value, "d689.memory");
	exactKeys(
		memory,
		[
			"applicabilityScope",
			"correctionPrinciples",
			"diagnosticDiscriminators",
			"failureMechanismRef",
			"failureMechanismRevision",
			"knownBadRouteContraindications",
			"memoryRef",
			"memoryRevision",
			"sourceEvidenceDigests",
			"sourceTaskRef",
			"triggerConditions",
			"validationStrategy",
			"version",
		],
		"d689.memory",
	);
	literal(memory.version, D689_TRANSFER_MEMORY_VERSION, "d689.memory.version");
	const validated = strictSnapshot({
		version: D689_TRANSFER_MEMORY_VERSION,
		memoryRef: coordinate(memory.memoryRef, "d689.memory.memoryRef"),
		memoryRevision: coordinate(memory.memoryRevision, "d689.memory.memoryRevision"),
		sourceTaskRef: coordinate(memory.sourceTaskRef, "d689.memory.sourceTaskRef"),
		failureMechanismRef: coordinate(memory.failureMechanismRef, "d689.memory.failureMechanismRef"),
		failureMechanismRevision: coordinate(
			memory.failureMechanismRevision,
			"d689.memory.failureMechanismRevision",
		),
		triggerConditions: canonicalRules(memory.triggerConditions, "d689.memory.triggerConditions", 1),
		diagnosticDiscriminators: canonicalRules(
			memory.diagnosticDiscriminators,
			"d689.memory.diagnosticDiscriminators",
			1,
		),
		correctionPrinciples: canonicalRules(
			memory.correctionPrinciples,
			"d689.memory.correctionPrinciples",
			1,
		),
		validationStrategy: canonicalRules(
			memory.validationStrategy,
			"d689.memory.validationStrategy",
			1,
		),
		knownBadRouteContraindications: canonicalRules(
			memory.knownBadRouteContraindications,
			"d689.memory.knownBadRouteContraindications",
			0,
		),
		applicabilityScope: canonicalRules(
			memory.applicabilityScope,
			"d689.memory.applicabilityScope",
			1,
		),
		sourceEvidenceDigests: canonicalDigestSet(
			memory.sourceEvidenceDigests,
			"d689.memory.sourceEvidenceDigests",
			{ min: 4 },
		),
	});
	if (strictJsonCodec.encode(validated).byteLength > MAX_TRANSFER_MEMORY_BYTES) {
		fail("d689.memory", `exceeds ${MAX_TRANSFER_MEMORY_BYTES} canonical bytes`);
	}
	const boundEvidence = new Set(validated.sourceEvidenceDigests);
	for (const rules of [
		validated.triggerConditions,
		validated.diagnosticDiscriminators,
		validated.correctionPrinciples,
		validated.validationStrategy,
		validated.knownBadRouteContraindications,
		validated.applicabilityScope,
	]) {
		for (const rule of rules) {
			if (rule.sourceEvidenceDigests.some((entry) => !boundEvidence.has(entry))) {
				fail("d689.memory", "rule evidence must be bound by sourceEvidenceDigests");
			}
		}
	}
	return validated;
}

function validateTaskCoordinates(value: unknown, path: string): D689PairTaskCoordinatesV1 {
	const coordinates = record(value, path);
	const commonKeys = [
		"expectedMaterialIdentityDigest",
		"fileIdentityDigest",
		"symbolIdentityDigest",
		"taskRef",
		"testIdentityDigest",
	] as const;
	for (const key of commonKeys) {
		if (!Object.hasOwn(coordinates, key)) fail(path, `missing ${key}`);
	}
	return strictSnapshot({
		taskRef: coordinate(coordinates.taskRef, `${path}.taskRef`),
		fileIdentityDigest: digest(coordinates.fileIdentityDigest, `${path}.fileIdentityDigest`),
		symbolIdentityDigest: digest(coordinates.symbolIdentityDigest, `${path}.symbolIdentityDigest`),
		testIdentityDigest: digest(coordinates.testIdentityDigest, `${path}.testIdentityDigest`),
		expectedMaterialIdentityDigest: digest(
			coordinates.expectedMaterialIdentityDigest,
			`${path}.expectedMaterialIdentityDigest`,
		),
	});
}

export function validateD689PairQualification(value: unknown): D689PairQualificationV1 {
	const qualification = record(value, "d689.pairQualification");
	exactKeys(
		qualification,
		[
			"actionabilityAttestation",
			"authorityRef",
			"authorityRevision",
			"distinctnessEvidenceDigest",
			"historyFreedomEvidenceDigest",
			"privateMaterialProtectionAttestation",
			"qualificationEvidenceDigests",
			"qualificationRef",
			"qualificationRevision",
			"sameMechanismQualified",
			"sameMechanismEvidenceDigest",
			"source",
			"sourceFailureMechanismRef",
			"sourceFailureMechanismRevision",
			"target",
			"targetFailureMechanismRef",
			"targetFailureMechanismRevision",
			"version",
		],
		"d689.pairQualification",
	);
	literal(qualification.version, D689_PAIR_QUALIFICATION_VERSION, "d689.pairQualification.version");
	const source = record(qualification.source, "d689.pairQualification.source");
	exactKeys(
		source,
		[
			"actionTraceDigest",
			"expectedMaterialIdentityDigest",
			"fileIdentityDigest",
			"mutationEvidenceDigest",
			"runDigest",
			"symbolIdentityDigest",
			"taskRef",
			"testIdentityDigest",
			"verifierEvidenceDigest",
			"verifierRef",
			"verifierRevision",
			"verifierStatus",
		],
		"d689.pairQualification.source",
	);
	const target = record(qualification.target, "d689.pairQualification.target");
	exactKeys(
		target,
		[
			"expectedMaterialIdentityDigest",
			"fileIdentityDigest",
			"historyStatus",
			"symbolIdentityDigest",
			"taskRef",
			"testIdentityDigest",
		],
		"d689.pairQualification.target",
	);
	const attestation = record(
		qualification.actionabilityAttestation,
		"d689.pairQualification.actionabilityAttestation",
	);
	exactKeys(
		attestation,
		["actionable", "evidenceDigest", "genericOnly", "memoryDigest"],
		"d689.pairQualification.actionabilityAttestation",
	);
	const protectionAttestation = record(
		qualification.privateMaterialProtectionAttestation,
		"d689.pairQualification.privateMaterialProtectionAttestation",
	);
	exactKeys(
		protectionAttestation,
		[
			"capabilityRef",
			"capabilityRevision",
			"evidenceDigest",
			"protectedMaterialClasses",
			"protectedSetBindingDigest",
		],
		"d689.pairQualification.privateMaterialProtectionAttestation",
	);
	const protectedMaterialClasses = array(
		protectionAttestation.protectedMaterialClasses,
		"d689.pairQualification.privateMaterialProtectionAttestation.protectedMaterialClasses",
	)
		.map((entry, index) =>
			oneOf(
				entry,
				REQUIRED_PROTECTED_MATERIAL_CLASSES,
				`d689.pairQualification.privateMaterialProtectionAttestation.protectedMaterialClasses[${index}]`,
			),
		)
		.sort();
	if (new Set(protectedMaterialClasses).size !== protectedMaterialClasses.length) {
		fail(
			"d689.pairQualification.privateMaterialProtectionAttestation.protectedMaterialClasses",
			"expected unique material classes",
		);
	}
	return strictSnapshot({
		version: D689_PAIR_QUALIFICATION_VERSION,
		qualificationRef: coordinate(
			qualification.qualificationRef,
			"d689.pairQualification.qualificationRef",
		),
		qualificationRevision: coordinate(
			qualification.qualificationRevision,
			"d689.pairQualification.qualificationRevision",
		),
		authorityRef: coordinate(qualification.authorityRef, "d689.pairQualification.authorityRef"),
		authorityRevision: coordinate(
			qualification.authorityRevision,
			"d689.pairQualification.authorityRevision",
		),
		source: {
			...validateTaskCoordinates(source, "d689.pairQualification.source"),
			runDigest: digest(source.runDigest, "d689.pairQualification.source.runDigest"),
			actionTraceDigest: digest(
				source.actionTraceDigest,
				"d689.pairQualification.source.actionTraceDigest",
			),
			mutationEvidenceDigest: digest(
				source.mutationEvidenceDigest,
				"d689.pairQualification.source.mutationEvidenceDigest",
			),
			verifierRef: coordinate(source.verifierRef, "d689.pairQualification.source.verifierRef"),
			verifierRevision: coordinate(
				source.verifierRevision,
				"d689.pairQualification.source.verifierRevision",
			),
			verifierEvidenceDigest: digest(
				source.verifierEvidenceDigest,
				"d689.pairQualification.source.verifierEvidenceDigest",
			),
			verifierStatus: oneOf(
				source.verifierStatus,
				["passed", "failed", "unverifiable"] as const,
				"d689.pairQualification.source.verifierStatus",
			),
		},
		target: {
			...validateTaskCoordinates(target, "d689.pairQualification.target"),
			historyStatus: oneOf(
				target.historyStatus,
				["history-free", "history-exposed"] as const,
				"d689.pairQualification.target.historyStatus",
			),
		},
		sourceFailureMechanismRef: coordinate(
			qualification.sourceFailureMechanismRef,
			"d689.pairQualification.sourceFailureMechanismRef",
		),
		sourceFailureMechanismRevision: coordinate(
			qualification.sourceFailureMechanismRevision,
			"d689.pairQualification.sourceFailureMechanismRevision",
		),
		targetFailureMechanismRef: coordinate(
			qualification.targetFailureMechanismRef,
			"d689.pairQualification.targetFailureMechanismRef",
		),
		targetFailureMechanismRevision: coordinate(
			qualification.targetFailureMechanismRevision,
			"d689.pairQualification.targetFailureMechanismRevision",
		),
		sameMechanismQualified: boolean(
			qualification.sameMechanismQualified,
			"d689.pairQualification.sameMechanismQualified",
		),
		sameMechanismEvidenceDigest: digest(
			qualification.sameMechanismEvidenceDigest,
			"d689.pairQualification.sameMechanismEvidenceDigest",
		),
		distinctnessEvidenceDigest: digest(
			qualification.distinctnessEvidenceDigest,
			"d689.pairQualification.distinctnessEvidenceDigest",
		),
		historyFreedomEvidenceDigest: digest(
			qualification.historyFreedomEvidenceDigest,
			"d689.pairQualification.historyFreedomEvidenceDigest",
		),
		actionabilityAttestation: {
			memoryDigest: digest(
				attestation.memoryDigest,
				"d689.pairQualification.actionabilityAttestation.memoryDigest",
			),
			actionable: boolean(
				attestation.actionable,
				"d689.pairQualification.actionabilityAttestation.actionable",
			),
			genericOnly: boolean(
				attestation.genericOnly,
				"d689.pairQualification.actionabilityAttestation.genericOnly",
			),
			evidenceDigest: digest(
				attestation.evidenceDigest,
				"d689.pairQualification.actionabilityAttestation.evidenceDigest",
			),
		},
		privateMaterialProtectionAttestation: {
			capabilityRef: coordinate(
				protectionAttestation.capabilityRef,
				"d689.pairQualification.privateMaterialProtectionAttestation.capabilityRef",
			),
			capabilityRevision: coordinate(
				protectionAttestation.capabilityRevision,
				"d689.pairQualification.privateMaterialProtectionAttestation.capabilityRevision",
			),
			protectedMaterialClasses,
			protectedSetBindingDigest: digest(
				protectionAttestation.protectedSetBindingDigest,
				"d689.pairQualification.privateMaterialProtectionAttestation.protectedSetBindingDigest",
			),
			evidenceDigest: digest(
				protectionAttestation.evidenceDigest,
				"d689.pairQualification.privateMaterialProtectionAttestation.evidenceDigest",
			),
		},
		qualificationEvidenceDigests: canonicalDigestSet(
			qualification.qualificationEvidenceDigests,
			"d689.pairQualification.qualificationEvidenceDigests",
			{ min: 1 },
		),
	});
}

function sameDigestSet(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function addIssue(issues: Set<D689QualityIssueCode>, issue: D689QualityIssueCode): void {
	issues.add(issue);
}

export function qualifyD689TransferMemory(input: {
	readonly memory: unknown;
	readonly pairQualification: unknown;
	readonly privateMaterialProtection: D689PrivateMaterialProtectionBundleV1;
}): D689TransferQualityReportV1 {
	const memory = validateD689TransferMemory(input.memory);
	const pair = validateD689PairQualification(input.pairQualification);
	const privateMaterialProtection = input.privateMaterialProtection;
	if (
		typeof privateMaterialProtection !== "object" ||
		privateMaterialProtection === null ||
		!constructedPrivateMaterialProtectionBundles.has(privateMaterialProtection)
	) {
		fail("d689.privateMaterialProtection", "expected a constructed D689 protection bundle");
	}
	const memoryDigest = empiricalStrictJsonDigest(memory);
	const pairQualificationDigest = empiricalStrictJsonDigest(pair);
	const issues = new Set<D689QualityIssueCode>();
	if (pair.source.verifierStatus !== "passed") addIssue(issues, "source-verifier-not-passed");
	const expectedSourceEvidenceDigests = [
		pair.source.actionTraceDigest,
		pair.source.mutationEvidenceDigest,
		pair.source.runDigest,
		pair.source.verifierEvidenceDigest,
	].sort();
	if (!sameDigestSet(memory.sourceEvidenceDigests, expectedSourceEvidenceDigests)) {
		addIssue(issues, "source-evidence-binding-incomplete");
	}
	if (pair.source.taskRef === pair.target.taskRef)
		addIssue(issues, "source-target-task-not-distinct");
	if (pair.source.fileIdentityDigest === pair.target.fileIdentityDigest) {
		addIssue(issues, "source-target-file-not-distinct");
	}
	if (pair.source.symbolIdentityDigest === pair.target.symbolIdentityDigest) {
		addIssue(issues, "source-target-symbol-not-distinct");
	}
	if (pair.source.testIdentityDigest === pair.target.testIdentityDigest) {
		addIssue(issues, "source-target-test-not-distinct");
	}
	if (pair.source.expectedMaterialIdentityDigest === pair.target.expectedMaterialIdentityDigest) {
		addIssue(issues, "source-target-expected-material-not-distinct");
	}
	if (pair.target.historyStatus !== "history-free") addIssue(issues, "target-not-history-free");
	if (
		pair.sourceFailureMechanismRef !== pair.targetFailureMechanismRef ||
		pair.sourceFailureMechanismRevision !== pair.targetFailureMechanismRevision
	) {
		addIssue(issues, "failure-mechanism-coordinate-mismatch");
	}
	if (!pair.sameMechanismQualified) addIssue(issues, "same-mechanism-not-qualified");
	const expectedQualificationEvidenceDigests = [
		pair.actionabilityAttestation.evidenceDigest,
		pair.distinctnessEvidenceDigest,
		pair.historyFreedomEvidenceDigest,
		pair.privateMaterialProtectionAttestation.evidenceDigest,
		pair.sameMechanismEvidenceDigest,
	].sort();
	if (!sameDigestSet(pair.qualificationEvidenceDigests, expectedQualificationEvidenceDigests)) {
		addIssue(issues, "qualification-evidence-binding-incomplete");
	}
	if (
		memory.sourceTaskRef !== pair.source.taskRef ||
		memory.failureMechanismRef !== pair.sourceFailureMechanismRef ||
		memory.failureMechanismRevision !== pair.sourceFailureMechanismRevision
	) {
		addIssue(issues, "memory-pair-coordinate-mismatch");
	}
	if (pair.actionabilityAttestation.memoryDigest !== memoryDigest) {
		addIssue(issues, "memory-provenance-mismatch");
	}
	if (!pair.actionabilityAttestation.actionable) addIssue(issues, "memory-not-actionable");
	if (pair.actionabilityAttestation.genericOnly) addIssue(issues, "memory-generic-only");
	if (
		pair.privateMaterialProtectionAttestation.capabilityRef !==
			privateMaterialProtection.capabilityRef ||
		pair.privateMaterialProtectionAttestation.capabilityRevision !==
			privateMaterialProtection.capabilityRevision
	) {
		addIssue(issues, "private-material-protection-capability-mismatch");
	}
	if (
		!sameDigestSet(
			pair.privateMaterialProtectionAttestation.protectedMaterialClasses,
			REQUIRED_PROTECTED_MATERIAL_CLASSES,
		)
	) {
		addIssue(issues, "private-material-protection-coverage-incomplete");
	}
	if (
		pair.privateMaterialProtectionAttestation.protectedSetBindingDigest !==
		privateMaterialProtection.protectedSetBindingDigest
	) {
		addIssue(issues, "private-material-protection-set-binding-mismatch");
	}

	const protection = executeEmpiricalProtection(privateMaterialProtection.executor, {
		policyRef: privateMaterialProtection.executor.policyRef,
		policyRevision: privateMaterialProtection.executor.policyRevision,
		stage: "source-ingress",
		subject: strictJsonCodec.decode(strictJsonCodec.encode(memory)) as StrictJsonValue,
	});
	if (protection.issueCode !== null) addIssue(issues, "memory-protection-failed");
	if (protection.receipt.disposition !== "allowed") addIssue(issues, "memory-protection-blocked");
	const issueCodes = Object.freeze([...issues].sort());
	const report = strictSnapshot({
		version: D689_QUALITY_REPORT_VERSION,
		claimBoundary: D689_CLAIM_BOUNDARY,
		efficacyClaim: "none" as const,
		pairQualificationDigest,
		memoryDigest,
		sourceTaskRef: pair.source.taskRef,
		targetTaskRef: pair.target.taskRef,
		failureMechanismRef: pair.sourceFailureMechanismRef,
		preProviderQualityGatePassed: issueCodes.length === 0,
		issueCodes,
		privateMaterialProtectionReceipt: protection.receipt,
	});
	return report;
}

export function validateD689TransferQualityReport(value: unknown): D689TransferQualityReportV1 {
	const report = record(value, "d689.qualityReport");
	exactKeys(
		report,
		[
			"claimBoundary",
			"efficacyClaim",
			"failureMechanismRef",
			"issueCodes",
			"memoryDigest",
			"pairQualificationDigest",
			"privateMaterialProtectionReceipt",
			"preProviderQualityGatePassed",
			"sourceTaskRef",
			"targetTaskRef",
			"version",
		],
		"d689.qualityReport",
	);
	literal(report.version, D689_QUALITY_REPORT_VERSION, "d689.qualityReport.version");
	literal(report.claimBoundary, D689_CLAIM_BOUNDARY, "d689.qualityReport.claimBoundary");
	literal(report.efficacyClaim, "none", "d689.qualityReport.efficacyClaim");
	const rawIssues = array(report.issueCodes, "d689.qualityReport.issueCodes");
	const issueCodes = rawIssues
		.map((issue, index) =>
			oneOf(
				issue,
				[
					"source-verifier-not-passed",
					"source-evidence-binding-incomplete",
					"qualification-evidence-binding-incomplete",
					"source-target-task-not-distinct",
					"source-target-file-not-distinct",
					"source-target-symbol-not-distinct",
					"source-target-test-not-distinct",
					"source-target-expected-material-not-distinct",
					"target-not-history-free",
					"failure-mechanism-coordinate-mismatch",
					"same-mechanism-not-qualified",
					"memory-pair-coordinate-mismatch",
					"memory-provenance-mismatch",
					"memory-not-actionable",
					"memory-generic-only",
					"private-material-protection-capability-mismatch",
					"private-material-protection-coverage-incomplete",
					"private-material-protection-set-binding-mismatch",
					"memory-protection-blocked",
					"memory-protection-failed",
				] as const,
				`d689.qualityReport.issueCodes[${index}]`,
			),
		)
		.sort();
	if (new Set(issueCodes).size !== issueCodes.length) {
		fail("d689.qualityReport.issueCodes", "expected unique issue codes");
	}
	const passed = boolean(
		report.preProviderQualityGatePassed,
		"d689.qualityReport.preProviderQualityGatePassed",
	);
	if (passed !== (issueCodes.length === 0)) {
		fail("d689.qualityReport", "gate disposition does not match issue codes");
	}
	const receipt = record(
		report.privateMaterialProtectionReceipt,
		"d689.qualityReport.privateMaterialProtectionReceipt",
	);
	exactKeys(
		receipt,
		[
			"disposition",
			"policyRef",
			"policyRevision",
			"receiptDigest",
			"receiptRef",
			"stage",
			"subjectDigest",
		],
		"d689.qualityReport.privateMaterialProtectionReceipt",
	);
	const memoryDigest = digest(report.memoryDigest, "d689.qualityReport.memoryDigest");
	const receiptSubjectDigest = digest(
		receipt.subjectDigest,
		"d689.qualityReport.receipt.subjectDigest",
	);
	if (receiptSubjectDigest !== memoryDigest) {
		fail("d689.qualityReport.receipt.subjectDigest", "must equal memoryDigest");
	}
	const receiptDisposition = oneOf(
		receipt.disposition,
		["allowed", "blocked"] as const,
		"d689.qualityReport.receipt.disposition",
	);
	const protectionFailed = issueCodes.includes("memory-protection-failed");
	const protectionBlocked = issueCodes.includes("memory-protection-blocked");
	if (protectionBlocked !== (receiptDisposition === "blocked")) {
		fail("d689.qualityReport", "protection issue does not match receipt disposition");
	}
	if (protectionFailed && receiptDisposition !== "blocked") {
		fail("d689.qualityReport", "failed protection must fail closed");
	}
	const receiptRef = coordinate(receipt.receiptRef, "d689.qualityReport.receipt.receiptRef");
	const expectedReceiptRef = protectionFailed
		? `protection-failed:source-ingress:${receiptSubjectDigest.slice("sha256:".length)}`
		: `protection:source-ingress:${receiptDisposition}:${receiptSubjectDigest.slice("sha256:".length)}`;
	if (receiptRef !== expectedReceiptRef) {
		fail("d689.qualityReport.receipt.receiptRef", "does not match canonical receipt identity");
	}
	const receiptMaterial = strictSnapshot({
		policyRef: coordinate(receipt.policyRef, "d689.qualityReport.receipt.policyRef"),
		policyRevision: coordinate(receipt.policyRevision, "d689.qualityReport.receipt.policyRevision"),
		stage: literal(receipt.stage, "source-ingress", "d689.qualityReport.receipt.stage"),
		subjectDigest: receiptSubjectDigest,
		receiptRef,
		disposition: receiptDisposition,
	});
	const receiptDigest = digest(receipt.receiptDigest, "d689.qualityReport.receipt.receiptDigest");
	if (receiptDigest !== empiricalStrictJsonDigest(receiptMaterial)) {
		fail("d689.qualityReport.receipt.receiptDigest", "does not match canonical receipt material");
	}
	return strictSnapshot({
		version: D689_QUALITY_REPORT_VERSION,
		claimBoundary: D689_CLAIM_BOUNDARY,
		efficacyClaim: "none" as const,
		pairQualificationDigest: digest(
			report.pairQualificationDigest,
			"d689.qualityReport.pairQualificationDigest",
		),
		memoryDigest,
		sourceTaskRef: coordinate(report.sourceTaskRef, "d689.qualityReport.sourceTaskRef"),
		targetTaskRef: coordinate(report.targetTaskRef, "d689.qualityReport.targetTaskRef"),
		failureMechanismRef: coordinate(
			report.failureMechanismRef,
			"d689.qualityReport.failureMechanismRef",
		),
		preProviderQualityGatePassed: passed,
		issueCodes,
		privateMaterialProtectionReceipt: { ...receiptMaterial, receiptDigest },
	});
}

export function buildD689OfflineEvidence(
	value: readonly D689OfflineDryRunCaseV1[],
): D689OfflineEvidenceV1 {
	const cases = array(value, "d689.offline.cases");
	if (cases.length < 2 || cases.length > MAX_DRY_RUN_CASES) {
		fail("d689.offline.cases", `expected between 2 and ${MAX_DRY_RUN_CASES} cases`);
	}
	const validated = cases.map((entry, index) => {
		const path = `d689.offline.cases[${index}]`;
		const testCase = record(entry, path);
		exactKeys(
			testCase,
			[
				"caseRef",
				"expectedDisposition",
				"memory",
				"pairQualification",
				"privateMaterialProtection",
			],
			path,
		);
		const report = qualifyD689TransferMemory({
			memory: testCase.memory,
			pairQualification: testCase.pairQualification,
			privateMaterialProtection:
				testCase.privateMaterialProtection as D689PrivateMaterialProtectionBundleV1,
		});
		const expectedDisposition = oneOf(
			testCase.expectedDisposition,
			["pass", "reject"] as const,
			`${path}.expectedDisposition`,
		);
		if ((expectedDisposition === "pass") !== report.preProviderQualityGatePassed) {
			fail(path, "expected disposition does not match the quality report");
		}
		return strictSnapshot({
			caseRef: coordinate(testCase.caseRef, `${path}.caseRef`),
			expectedDisposition,
			qualityReport: report,
		});
	});
	if (new Set(validated.map((entry) => entry.caseRef)).size !== validated.length) {
		fail("d689.offline.cases", "expected unique case refs");
	}
	const canonicalCases = Object.freeze(
		validated.sort((left, right) => compareCodeUnits(left.caseRef, right.caseRef)),
	);
	const passingCaseCount = canonicalCases.filter(
		(entry) => entry.qualityReport.preProviderQualityGatePassed,
	).length;
	const rejectedCaseCount = canonicalCases.length - passingCaseCount;
	if (passingCaseCount === 0 || rejectedCaseCount === 0) {
		fail("d689.offline.cases", "expected at least one passing and one rejected case");
	}
	const casesDigest = empiricalStrictJsonDigest(canonicalCases);
	const material = strictSnapshot({
		version: D689_OFFLINE_EVIDENCE_VERSION,
		claimBoundary: D689_CLAIM_BOUNDARY,
		efficacyClaim: "none" as const,
		caseCount: canonicalCases.length,
		passingCaseCount,
		rejectedCaseCount,
		allExpectedDispositionsObserved: true as const,
		providerCallCount: 0 as const,
		historicalEvidenceRewritten: false as const,
		targetMaterialPersisted: false as const,
		publicExportDelta: false as const,
		casesDigest,
	});
	return strictSnapshot({ ...material, evidenceDigest: empiricalStrictJsonDigest(material) });
}
