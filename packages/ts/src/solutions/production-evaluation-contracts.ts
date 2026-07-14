/** Database-neutral production-evaluation contracts and bounded validation (D610). */
import type { SourceRef } from "../orchestration/index.js";

export const PRODUCTION_EVALUATION_CONTRACT_VERSION = "1" as const;
export type ProductionMigrationActionKind =
	| "observe"
	| "shadow"
	| "cutover"
	| "decommission"
	| "rollback";
export type ProductionAttestationPosture =
	| "demo-ready"
	| "poc-passed"
	| "production-admitted"
	| "expanded";
export type ProductionActionTerminalState = "succeeded" | "failed" | "cancelled" | "timed-out";

export interface ProductionEvaluationHostClock {
	now(): number;
}
export interface ProductionEvaluationRef {
	readonly id: string;
	readonly revision: string;
}
export interface ProductionCandidatePins {
	readonly adapter: ProductionEvaluationRef;
	readonly runtime: ProductionEvaluationRef;
	readonly configurationFingerprint: string;
}
export interface ProductionEvaluationScope {
	readonly tenantId: string;
	readonly workspaceId: string;
}
export interface ProductionEvaluationScenarioPin {
	readonly scenarioId: string;
	readonly revision: string;
	readonly dependencyIds: readonly string[];
}
export interface ProductionEvaluationCampaignRevision {
	readonly kind: "production-evaluation-campaign-revision";
	readonly campaignId: string;
	readonly revision: string;
	readonly previousRevision: string | null;
	readonly scope: ProductionEvaluationScope;
	readonly candidate: ProductionCandidatePins;
	readonly scenarioPack: ProductionEvaluationRef;
	readonly criteria: ProductionEvaluationRef;
	readonly scenarios: readonly ProductionEvaluationScenarioPin[];
	readonly environmentRefs: readonly ProductionEvaluationRef[];
	readonly dataRefs: readonly ProductionEvaluationRef[];
	readonly sourceRefs: readonly ProductionEvaluationRef[];
	readonly schemaRefs: readonly ProductionEvaluationRef[];
	readonly policyRefs: readonly ProductionEvaluationRef[];
	readonly createdBy: string;
	readonly createdAtMs: number;
}
export interface ProductionScenarioResult {
	readonly kind: "production-scenario-result";
	readonly scope: ProductionEvaluationScope;
	readonly campaignId: string;
	readonly campaignRevision: string;
	readonly scenarioId: string;
	readonly scenarioRevision: string;
	readonly resultId: string;
	readonly candidate: ProductionCandidatePins;
	readonly requestId: string;
	readonly admissionId: string;
	readonly runId: string;
	readonly attempt: number;
	readonly outcomeId: string;
	readonly evidenceId: string;
	readonly evidenceHighWater: number;
	readonly outcome: "succeeded" | "failed" | "cancelled" | "timed-out";
	readonly measurements: Readonly<Record<string, number>>;
	readonly evidenceRefs: readonly ProductionEvaluationRef[];
	readonly recordedAtMs: number;
}
export interface ProductionVerifiedScenarioExecution {
	readonly requestId: string;
	readonly admissionId: string;
	readonly runId: string;
	readonly attempt: number;
	readonly outcomeId: string;
	readonly evidenceId: string;
	readonly outcome: ProductionScenarioResult["outcome"];
	readonly candidate: ProductionCandidatePins;
	readonly evidenceHighWater: number;
	readonly currentEvidenceHighWater: number;
	readonly evidenceRefs: readonly ProductionEvaluationRef[];
}
export interface ProductionScenarioResultAuthority {
	lookup(
		value: Readonly<{
			scope: ProductionEvaluationScope;
			campaignId: string;
			campaignRevision: string;
			scenarioId: string;
			scenarioRevision: string;
			requestId: string;
			admissionId: string;
			runId: string;
			attempt: number;
			outcomeId: string;
			evidenceId: string;
		}>,
	): Promise<ProductionVerifiedScenarioExecution | null>;
}
export interface ProductionAttestation {
	readonly kind: "production-attestation";
	readonly attestationId: string;
	readonly decisionId: string;
	readonly idempotencyKey: string;
	readonly scope: ProductionEvaluationScope;
	readonly campaignId: string;
	readonly campaignRevision: string;
	readonly candidate: ProductionCandidatePins;
	readonly posture: ProductionAttestationPosture;
	readonly criteriaRevision: string;
	readonly evidenceHighWater: number;
	readonly actorRef: ProductionEvaluationRef;
	readonly admitterRef: ProductionEvaluationRef;
	readonly reviewerRefs: readonly ProductionEvaluationRef[];
	readonly policyRevision: string;
	readonly reason: string;
	readonly auditRefs: readonly ProductionEvaluationRef[];
	readonly issuedAtMs: number;
	readonly expiresAtMs: number;
	readonly supersedesId: string | null;
	readonly revokedAtMs: number | null;
}
export interface ProductionVerifiedAttestationAdmission {
	readonly attestation: ProductionAttestation;
}
export interface ProductionAttestationAdmissionAuthority {
	lookup(value: ProductionAttestation): Promise<ProductionVerifiedAttestationAdmission | null>;
}
export interface ProductionMigrationActionPins {
	readonly scope: ProductionEvaluationScope;
	readonly campaignId: string;
	readonly campaignRevision: string;
	readonly source: ProductionCandidatePins;
	readonly target: ProductionCandidatePins;
	readonly trafficRefs: readonly ProductionEvaluationRef[];
	readonly dataRefs: readonly ProductionEvaluationRef[];
	readonly schemaRefs: readonly ProductionEvaluationRef[];
	readonly policyRefs: readonly ProductionEvaluationRef[];
	readonly credentialPostureRefs: readonly ProductionEvaluationRef[];
	readonly prerequisiteRefs: readonly ProductionEvaluationRef[];
	readonly attestationRef: ProductionEvaluationRef;
	readonly predecessorActionRefs: readonly ProductionEvaluationRef[];
	readonly coexistenceEvidenceRefs: readonly ProductionEvaluationRef[];
	readonly rollbackPlan: ProductionEvaluationRef;
	readonly evidenceHighWater: number;
}
export interface ProductionVerifiedMigrationPrerequisites {
	readonly scope: ProductionEvaluationScope;
	readonly campaignId: string;
	readonly campaignRevision: string;
	readonly candidate: ProductionCandidatePins;
	readonly evidenceHighWater: number;
	readonly attestationRef: ProductionEvaluationRef;
	readonly trafficRefs: readonly ProductionEvaluationRef[];
	readonly dataRefs: readonly ProductionEvaluationRef[];
	readonly schemaRefs: readonly ProductionEvaluationRef[];
	readonly policyRefs: readonly ProductionEvaluationRef[];
	readonly credentialPostureRefs: readonly ProductionEvaluationRef[];
	readonly prerequisiteRefs: readonly ProductionEvaluationRef[];
	readonly coexistenceEvidenceRefs: readonly ProductionEvaluationRef[];
	readonly predecessorActionRefs: readonly ProductionEvaluationRef[];
	readonly rollbackPlan: ProductionEvaluationRef;
	readonly policyRevision: string;
	readonly checkedAtMs: number;
	readonly expiresAtMs: number;
}
export interface ProductionMigrationPrerequisiteAuthority {
	lookup(
		value: ProductionMigrationActionProposal,
	): Promise<ProductionVerifiedMigrationPrerequisites | null>;
}
export interface ProductionMigrationActionProposal {
	readonly kind: "production-migration-action-proposal";
	readonly actionId: string;
	readonly actionKind: ProductionMigrationActionKind;
	readonly generation: number;
	readonly fence: number;
	readonly idempotencyKey: string;
	readonly pins: ProductionMigrationActionPins;
	readonly requestedBy: string;
	readonly requestedAtMs: number;
}
export interface ProductionMigrationActionAdmission {
	readonly kind: "production-migration-action-admission";
	readonly admissionId: string;
	readonly scope: ProductionEvaluationScope;
	readonly actionId: string;
	readonly actionKind: ProductionMigrationActionKind;
	readonly generation: number;
	readonly fence: number;
	readonly policyRevision: string;
	readonly admittedBy: string;
	readonly admittedAtMs: number;
	readonly expiresAtMs: number;
}
export interface ProductionMigrationActionMaterialization {
	readonly kind: "production-migration-action-materialization";
	readonly materializationId: string;
	readonly scope: ProductionEvaluationScope;
	readonly actionId: string;
	readonly admissionId: string;
	readonly actionKind: ProductionMigrationActionKind;
	readonly generation: number;
	readonly fence: number;
	readonly executorRequestId: string;
	readonly materializedAtMs: number;
}
export interface ProductionMigrationExecutionHandoffIntent {
	readonly kind: "production-migration-execution-handoff-intent";
	readonly scope: ProductionEvaluationScope;
	readonly actionId: string;
	readonly admissionId: string;
	readonly materializationId: string;
	readonly executorRequestId: string;
}
export interface ProductionMigrationExecutionRequest {
	readonly kind: "production-migration-execution-request";
	readonly scope: ProductionEvaluationScope;
	readonly campaignId: string;
	readonly campaignRevision: string;
	readonly actionKind: ProductionMigrationActionKind;
	readonly actionId: string;
	readonly admissionId: string;
	readonly materializationId: string;
	readonly executorRequestId: string;
	readonly generation: number;
	readonly fence: number;
	readonly source: ProductionCandidatePins;
	readonly target: ProductionCandidatePins;
	readonly trafficRefs: readonly ProductionEvaluationRef[];
	readonly dataRefs: readonly ProductionEvaluationRef[];
	readonly schemaRefs: readonly ProductionEvaluationRef[];
	readonly policyRefs: readonly ProductionEvaluationRef[];
	readonly credentialPostureRefs: readonly ProductionEvaluationRef[];
	readonly prerequisiteRefs: readonly ProductionEvaluationRef[];
	readonly attestationRef: ProductionEvaluationRef;
	readonly predecessorActionRefs: readonly ProductionEvaluationRef[];
	readonly coexistenceEvidenceRefs: readonly ProductionEvaluationRef[];
	readonly rollbackPlan: ProductionEvaluationRef;
	readonly evidenceHighWater: number;
	readonly evidenceRefs: readonly ProductionEvaluationRef[];
	readonly loweredAtMs: number;
}
export interface ProductionMigrationExecutionBinding {
	readonly kind: "production-migration-execution-binding";
	readonly scope: ProductionEvaluationScope;
	readonly campaignId: string;
	readonly campaignRevision: string;
	readonly actionKind: ProductionMigrationActionKind;
	readonly actionId: string;
	readonly admissionId: string;
	readonly materializationId: string;
	readonly executorRequestId: string;
	readonly generation: number;
	readonly fence: number;
	readonly providerRequestId: string;
	readonly providerAdmissionId: string;
	readonly providerRunId: string;
	readonly providerAttempt: number;
	readonly sourceRefs: readonly SourceRef[];
	readonly boundAtMs: number;
}
export interface ProductionMigrationExecutionSettlement {
	readonly kind: "production-migration-execution-settlement";
	readonly scope: ProductionEvaluationScope;
	readonly executorRequestId: string;
	readonly providerRequestId: string;
	readonly providerAdmissionId: string;
	readonly providerRunId: string;
	readonly providerAttempt: number;
	readonly providerOutcomeId: string;
	readonly providerEvidenceId: string;
	readonly providerEvidenceHighWater: number;
	readonly sourceRefs: readonly SourceRef[];
	readonly settledAtMs: number;
}
export interface ProductionMigrationActionOutcome {
	readonly kind: "production-migration-action-outcome";
	readonly outcomeId: string;
	readonly scope: ProductionEvaluationScope;
	readonly actionId: string;
	readonly admissionId: string;
	readonly materializationId: string;
	readonly actionKind: ProductionMigrationActionKind;
	readonly generation: number;
	readonly fence: number;
	readonly executorRunId: string;
	readonly providerRequestId: string;
	readonly providerAdmissionId: string;
	readonly providerOutcomeId: string;
	readonly providerEvidenceId: string;
	readonly providerAttempt: number;
	readonly sourceRefs: readonly SourceRef[];
	readonly state: ProductionActionTerminalState;
	readonly evidenceRefs: readonly ProductionEvaluationRef[];
	readonly terminalHighWater: number;
	readonly recordedAtMs: number;
}
export interface ProductionVerifiedMigrationOutcome {
	readonly actionId: string;
	readonly admissionId: string;
	readonly materializationId: string;
	readonly actionKind: ProductionMigrationActionKind;
	readonly generation: number;
	readonly fence: number;
	readonly executorRunId: string;
	readonly providerRequestId: string;
	readonly providerAdmissionId: string;
	readonly providerOutcomeId: string;
	readonly providerEvidenceId: string;
	readonly providerAttempt: number;
	readonly sourceRefs: readonly SourceRef[];
	readonly state: ProductionActionTerminalState;
	readonly evidenceRefs: readonly ProductionEvaluationRef[];
	readonly terminalHighWater: number;
}
export interface ProductionMigrationOutcomeAuthority {
	lookup(
		value: Readonly<{
			scope: ProductionEvaluationScope;
			actionId: string;
			admissionId: string;
			materializationId: string;
			executorRunId: string;
			providerRequestId: string;
			providerAdmissionId: string;
			providerOutcomeId: string;
			providerEvidenceId: string;
			providerAttempt: number;
			sourceRefs: readonly SourceRef[];
		}>,
	): Promise<ProductionVerifiedMigrationOutcome | null>;
}
export interface ProductionEvidencePacketManifest {
	readonly kind: "production-evidence-packet-manifest";
	readonly packetId: string;
	readonly scope: ProductionEvaluationScope;
	readonly campaignId: string;
	readonly campaignRevision: string;
	readonly candidate: ProductionCandidatePins;
	readonly evidenceHighWater: number;
	readonly resultRefs: readonly ProductionEvaluationRef[];
	readonly attestationRefs: readonly ProductionEvaluationRef[];
	readonly actionRefs: readonly ProductionEvaluationRef[];
	readonly manifestRevision: string;
	readonly admissionId: string;
	readonly policyRevision: string;
	readonly redactionRevision: string;
	readonly createdBy: string;
	readonly createdAtMs: number;
}
export interface ProductionVerifiedEvidencePacketAdmission {
	readonly admissionId: string;
	readonly packetId: string;
	readonly scope: ProductionEvaluationScope;
	readonly campaignId: string;
	readonly campaignRevision: string;
	readonly candidate: ProductionCandidatePins;
	readonly evidenceHighWater: number;
	readonly resultRefs: readonly ProductionEvaluationRef[];
	readonly attestationRefs: readonly ProductionEvaluationRef[];
	readonly actionRefs: readonly ProductionEvaluationRef[];
	readonly policyRevision: string;
	readonly redactionRevision: string;
	readonly admittedAtMs: number;
	readonly expiresAtMs: number;
}
export interface ProductionEvidencePacketAdmissionAuthority {
	lookup(
		value: ProductionEvidencePacketManifest,
	): Promise<ProductionVerifiedEvidencePacketAdmission | null>;
}
export interface ProductionEvaluationAuditEntry {
	readonly kind: "production-evaluation-audit";
	readonly tenantId: string;
	readonly sequence: number;
	readonly eventKind: string;
	readonly objectId: string;
	readonly occurredAtMs: number;
}
export type ProductionEvaluationConflictCode =
	| "invalid"
	| "not-found"
	| "conflict"
	| "stale-head"
	| "stale-fence"
	| "ineligible"
	| "expired"
	| "revoked"
	| "correlation-mismatch"
	| "already-terminal";
export type ProductionEvaluationStoreResult<T> =
	| Readonly<{ accepted: true; code: "created" | "rereferenced" | "advanced"; value: T }>
	| Readonly<{ accepted: false; code: ProductionEvaluationConflictCode; value: null }>;

const LIMITS = { depth: 8, keys: 80, array: 128, string: 512 } as const;
function inspect(value: unknown, depth = 0, seen = new Set<object>()): boolean {
	if (value === null || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (typeof value === "string") return value.length > 0 && value.length <= LIMITS.string;
	if (typeof value !== "object" || depth > LIMITS.depth || seen.has(value)) return false;
	seen.add(value);
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== Array.prototype) return false;
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Object.values(descriptors).some((d) => d.get || d.set)) return false;
	const entries = Object.entries(descriptors).filter(([key]) => key !== "length");
	if (entries.length > LIMITS.keys || (Array.isArray(value) && value.length > LIMITS.array))
		return false;
	const valid = entries.every(([, descriptor]) => inspect(descriptor.value, depth + 1, seen));
	seen.delete(value);
	return valid;
}
export function productionEvaluationSnapshot<T>(value: T): Readonly<T> {
	if (!inspect(value))
		throw new TypeError("production-evaluation-invalid-or-accessor-bearing-value");
	const copy = structuredClone(value);
	const freeze = (item: unknown): void => {
		if (!item || typeof item !== "object" || Object.isFrozen(item)) return;
		for (const child of Object.values(item)) freeze(child);
		Object.freeze(item);
	};
	freeze(copy);
	return copy as Readonly<T>;
}
function sorted(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sorted);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([k, v]) => [k, sorted(v)]),
		);
	return value;
}
export function productionEvaluationCanonical(value: unknown): string {
	const copy = productionEvaluationSnapshot(value);
	return JSON.stringify(sorted(copy));
}
export function sameProductionCandidate(
	a: ProductionCandidatePins,
	b: ProductionCandidatePins,
): boolean {
	return productionEvaluationCanonical(a) === productionEvaluationCanonical(b);
}
const ROOT_KEYS: Readonly<Record<string, readonly string[]>> = {
	"production-evaluation-campaign-revision": [
		"kind",
		"campaignId",
		"revision",
		"previousRevision",
		"scope",
		"candidate",
		"scenarioPack",
		"criteria",
		"scenarios",
		"environmentRefs",
		"dataRefs",
		"sourceRefs",
		"schemaRefs",
		"policyRefs",
		"createdBy",
		"createdAtMs",
	],
	"production-scenario-result": [
		"kind",
		"scope",
		"campaignId",
		"campaignRevision",
		"scenarioId",
		"scenarioRevision",
		"resultId",
		"candidate",
		"requestId",
		"admissionId",
		"runId",
		"attempt",
		"outcomeId",
		"evidenceId",
		"evidenceHighWater",
		"outcome",
		"measurements",
		"evidenceRefs",
		"recordedAtMs",
	],
	"production-attestation": [
		"kind",
		"attestationId",
		"decisionId",
		"idempotencyKey",
		"scope",
		"campaignId",
		"campaignRevision",
		"candidate",
		"posture",
		"criteriaRevision",
		"evidenceHighWater",
		"actorRef",
		"admitterRef",
		"reviewerRefs",
		"policyRevision",
		"reason",
		"auditRefs",
		"issuedAtMs",
		"expiresAtMs",
		"supersedesId",
		"revokedAtMs",
	],
	"production-migration-action-proposal": [
		"kind",
		"actionId",
		"actionKind",
		"generation",
		"fence",
		"idempotencyKey",
		"pins",
		"requestedBy",
		"requestedAtMs",
	],
	"production-migration-action-admission": [
		"kind",
		"admissionId",
		"scope",
		"actionId",
		"actionKind",
		"generation",
		"fence",
		"policyRevision",
		"admittedBy",
		"admittedAtMs",
		"expiresAtMs",
	],
	"production-migration-action-materialization": [
		"kind",
		"materializationId",
		"scope",
		"actionId",
		"admissionId",
		"actionKind",
		"generation",
		"fence",
		"executorRequestId",
		"materializedAtMs",
	],
	"production-migration-execution-handoff-intent": [
		"kind",
		"scope",
		"actionId",
		"admissionId",
		"materializationId",
		"executorRequestId",
	],
	"production-migration-action-outcome": [
		"kind",
		"outcomeId",
		"scope",
		"actionId",
		"admissionId",
		"materializationId",
		"actionKind",
		"generation",
		"fence",
		"executorRunId",
		"providerRequestId",
		"providerAdmissionId",
		"providerOutcomeId",
		"providerEvidenceId",
		"providerAttempt",
		"sourceRefs",
		"state",
		"evidenceRefs",
		"terminalHighWater",
		"recordedAtMs",
	],
	"production-migration-execution-binding": [
		"kind",
		"scope",
		"campaignId",
		"campaignRevision",
		"actionKind",
		"actionId",
		"admissionId",
		"materializationId",
		"executorRequestId",
		"generation",
		"fence",
		"providerRequestId",
		"providerAdmissionId",
		"providerRunId",
		"providerAttempt",
		"sourceRefs",
		"boundAtMs",
	],
	"production-migration-execution-settlement": [
		"kind",
		"scope",
		"executorRequestId",
		"providerRequestId",
		"providerAdmissionId",
		"providerRunId",
		"providerAttempt",
		"providerOutcomeId",
		"providerEvidenceId",
		"providerEvidenceHighWater",
		"sourceRefs",
		"settledAtMs",
	],
	"production-evidence-packet-manifest": [
		"kind",
		"packetId",
		"scope",
		"campaignId",
		"campaignRevision",
		"candidate",
		"evidenceHighWater",
		"resultRefs",
		"attestationRefs",
		"actionRefs",
		"manifestRevision",
		"admissionId",
		"policyRevision",
		"redactionRevision",
		"createdBy",
		"createdAtMs",
	],
};
const onlyKeys = (value: object, expected: readonly string[]) => {
	const actual = Object.keys(value).sort(),
		wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};
/** Bounded opaque identity: admits canonical compoundTupleKey values, never URLs/control text. */
const token = (value: unknown) =>
	typeof value === "string" &&
	value.length > 0 &&
	value.length <= 512 &&
	value.trim() === value &&
	![...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code < 32 || code === 127;
	}) &&
	!value.includes("://");
const validRef = (value: unknown) =>
	!!value &&
	typeof value === "object" &&
	onlyKeys(value, ["id", "revision"]) &&
	token((value as ProductionEvaluationRef).id) &&
	token((value as ProductionEvaluationRef).revision);
const validRefs = (value: unknown) => Array.isArray(value) && value.every(validRef);
const validScope = (value: unknown) =>
	!!value &&
	typeof value === "object" &&
	onlyKeys(value, ["tenantId", "workspaceId"]) &&
	token((value as ProductionEvaluationScope).tenantId) &&
	token((value as ProductionEvaluationScope).workspaceId);
const validCandidate = (value: unknown) =>
	!!value &&
	typeof value === "object" &&
	onlyKeys(value, ["adapter", "configurationFingerprint", "runtime"]) &&
	validRef((value as ProductionCandidatePins).adapter) &&
	validRef((value as ProductionCandidatePins).runtime) &&
	token((value as ProductionCandidatePins).configurationFingerprint);
export function validateProductionEvaluationValue<T>(value: T, expectedKind: string): Readonly<T> {
	const copy = productionEvaluationSnapshot(value) as T & { kind?: unknown };
	const keys = ROOT_KEYS[expectedKind];
	if (copy.kind !== expectedKind || !keys || !onlyKeys(copy, keys))
		throw new TypeError(`production-evaluation-kind:${expectedKind}`);
	const record = copy as Record<string, unknown>;
	const actionKinds: readonly unknown[] = [
		"observe",
		"shadow",
		"cutover",
		"decommission",
		"rollback",
	];
	if ("actionKind" in record && !actionKinds.includes(record.actionKind))
		throw new TypeError("production-evaluation-action-kind-invalid");
	if (
		expectedKind === "production-attestation" &&
		!["demo-ready", "poc-passed", "production-admitted", "expanded"].includes(
			record.posture as string,
		)
	)
		throw new TypeError("production-evaluation-attestation-posture-invalid");
	if (
		expectedKind === "production-scenario-result" &&
		!["succeeded", "failed", "cancelled", "timed-out"].includes(record.outcome as string)
	)
		throw new TypeError("production-evaluation-scenario-outcome-invalid");
	if (
		expectedKind === "production-migration-action-outcome" &&
		!["succeeded", "failed", "cancelled", "timed-out"].includes(record.state as string)
	)
		throw new TypeError("production-evaluation-terminal-state-invalid");
	for (const [name, entry] of Object.entries(record)) {
		if (
			(name.endsWith("Id") ||
				name.endsWith("Revision") ||
				name === "revision" ||
				name === "createdBy" ||
				name === "requestedBy" ||
				name === "admittedBy" ||
				name === "idempotencyKey") &&
			entry !== null &&
			!token(entry)
		)
			throw new TypeError("production-evaluation-identifier-invalid");
		if (
			(name.endsWith("AtMs") ||
				name.endsWith("HighWater") ||
				name === "attempt" ||
				name === "generation" ||
				name === "fence") &&
			entry !== null &&
			(!Number.isSafeInteger(entry) || (entry as number) < 0)
		)
			throw new TypeError("production-evaluation-number-invalid");
	}
	if ("scope" in record && !validScope(record.scope))
		throw new TypeError("production-evaluation-scope-invalid");
	if ("candidate" in record && !validCandidate(record.candidate))
		throw new TypeError("production-evaluation-candidate-invalid");
	if (expectedKind === "production-migration-action-proposal") {
		const pins = record.pins as ProductionMigrationActionPins;
		if (
			!pins ||
			!onlyKeys(pins, [
				"scope",
				"campaignId",
				"campaignRevision",
				"source",
				"target",
				"trafficRefs",
				"dataRefs",
				"schemaRefs",
				"policyRefs",
				"credentialPostureRefs",
				"prerequisiteRefs",
				"attestationRef",
				"predecessorActionRefs",
				"coexistenceEvidenceRefs",
				"rollbackPlan",
				"evidenceHighWater",
			]) ||
			!validScope(pins.scope) ||
			!validCandidate(pins.source) ||
			!validCandidate(pins.target) ||
			!validRef(pins.attestationRef) ||
			!validRef(pins.rollbackPlan) ||
			![
				pins.trafficRefs,
				pins.dataRefs,
				pins.schemaRefs,
				pins.policyRefs,
				pins.credentialPostureRefs,
				pins.prerequisiteRefs,
				pins.predecessorActionRefs,
				pins.coexistenceEvidenceRefs,
			].every(validRefs)
		)
			throw new TypeError("production-evaluation-action-pins-invalid");
	}
	if (expectedKind === "production-evaluation-campaign-revision") {
		const value = record as unknown as ProductionEvaluationCampaignRevision;
		const scenarioIds = Array.isArray(value.scenarios)
			? new Set(value.scenarios.map((scenario) => scenario.scenarioId))
			: new Set<string>();
		if (
			!validRef(value.scenarioPack) ||
			!validRef(value.criteria) ||
			![
				value.environmentRefs,
				value.dataRefs,
				value.sourceRefs,
				value.schemaRefs,
				value.policyRefs,
			].every(validRefs) ||
			!Array.isArray(value.scenarios) ||
			value.scenarios.length === 0 ||
			scenarioIds.size !== value.scenarios.length ||
			value.scenarios.some(
				(scenario) =>
					!onlyKeys(scenario, ["dependencyIds", "revision", "scenarioId"]) ||
					!token(scenario.scenarioId) ||
					!token(scenario.revision) ||
					!Array.isArray(scenario.dependencyIds) ||
					scenario.dependencyIds.some(
						(id: string) => !token(id) || !scenarioIds.has(id) || id === scenario.scenarioId,
					) ||
					new Set(scenario.dependencyIds).size !== scenario.dependencyIds.length,
			)
		)
			throw new TypeError("production-evaluation-campaign-pins-invalid");
		const byId = new Map(value.scenarios.map((scenario) => [scenario.scenarioId, scenario]));
		const visiting = new Set<string>(),
			visited = new Set<string>();
		const cyclic = (id: string): boolean => {
			if (visiting.has(id)) return true;
			if (visited.has(id)) return false;
			visiting.add(id);
			for (const dependencyId of byId.get(id)?.dependencyIds ?? [])
				if (cyclic(dependencyId)) return true;
			visiting.delete(id);
			visited.add(id);
			return false;
		};
		if (value.scenarios.some((scenario) => cyclic(scenario.scenarioId)))
			throw new TypeError("production-evaluation-scenario-cycle");
	}
	if (
		expectedKind === "production-scenario-result" &&
		!validRefs((record as unknown as ProductionScenarioResult).evidenceRefs)
	)
		throw new TypeError("production-evaluation-result-evidence-invalid");
	if (expectedKind === "production-attestation") {
		const value = record as unknown as ProductionAttestation;
		if (
			!validRef(value.actorRef) ||
			!validRef(value.admitterRef) ||
			!validRefs(value.reviewerRefs) ||
			!validRefs(value.auditRefs)
		)
			throw new TypeError("production-evaluation-attestation-refs-invalid");
	}
	if (
		expectedKind === "production-migration-action-outcome" &&
		!validRefs((record as unknown as ProductionMigrationActionOutcome).evidenceRefs)
	)
		throw new TypeError("production-evaluation-outcome-evidence-invalid");
	if (expectedKind === "production-evidence-packet-manifest") {
		const value = record as unknown as ProductionEvidencePacketManifest;
		if (
			!validRefs(value.resultRefs) ||
			!validRefs(value.attestationRefs) ||
			!validRefs(value.actionRefs)
		)
			throw new TypeError("production-evaluation-packet-refs-invalid");
	}
	return copy;
}
