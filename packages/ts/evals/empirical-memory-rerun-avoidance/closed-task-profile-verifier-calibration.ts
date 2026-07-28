import { coordinate, digest, exactKeys, fail, oneOf, record, strictSnapshot } from "./canonical.js";
import type { ClosedVerifierProfileCoordinatesV1 } from "./closed-task-profile-host.js";
import {
	EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS,
	type EmpiricalEvidenceRefV1,
	type EmpiricalQualificationEvidenceKind,
} from "./contracts.js";

export const CLOSED_VERIFIER_CALIBRATION_SCHEMAS = Object.freeze({
	caseResult: "graphrefly.private-solution-eval.closed-verifier-calibration-case-result.v1",
	report: "graphrefly.private-solution-eval.closed-verifier-calibration-report.v1",
});

export type ClosedVerifierCalibrationObservation = "accepted" | "rejected" | "non-evaluable";

export interface ClosedVerifierCalibrationCaseResultV1 {
	readonly schemaVersion: typeof CLOSED_VERIFIER_CALIBRATION_SCHEMAS.caseResult;
	readonly caseKind: EmpiricalQualificationEvidenceKind;
	readonly observation: ClosedVerifierCalibrationObservation;
	readonly evidenceRef: EmpiricalEvidenceRefV1;
}

export interface ClosedVerifierCalibrationCapabilityV1 {
	readonly verifierProfileRef: string;
	readonly verifierProfileRevision: string;
	readonly verifierProfileDigest: string;
	runCase(input: {
		readonly caseKind: EmpiricalQualificationEvidenceKind;
		readonly profileCoordinates: ClosedVerifierProfileCoordinatesV1;
		readonly signal: AbortSignal;
	}): Promise<ClosedVerifierCalibrationCaseResultV1>;
}

export interface ClosedVerifierCalibrationReportV1 {
	readonly schemaVersion: typeof CLOSED_VERIFIER_CALIBRATION_SCHEMAS.report;
	readonly profileCoordinates: ClosedVerifierProfileCoordinatesV1;
	readonly cases: readonly {
		readonly caseKind: EmpiricalQualificationEvidenceKind;
		readonly expected: ClosedVerifierCalibrationObservation;
		readonly observed: ClosedVerifierCalibrationObservation;
		readonly evidenceRef: EmpiricalEvidenceRefV1;
	}[];
	readonly qualified: boolean;
	readonly issueCodes: readonly string[];
}

const TASK_SPECIFIC_CASES = new Set<EmpiricalQualificationEvidenceKind>([
	"command-policy",
	"out-of-policy-diff-rejection",
	"target-defect-verifier",
	"workspace-isolation",
]);

/**
 * Runs D639's closed verifier calibration cases sequentially through one exact private capability.
 * Hidden fixtures and commands remain capability-owned; the report contains only bounded evidence.
 */
export async function runClosedVerifierCalibration(input: {
	readonly profileCoordinates: ClosedVerifierProfileCoordinatesV1;
	readonly capability: ClosedVerifierCalibrationCapabilityV1;
	readonly signal: AbortSignal;
}): Promise<ClosedVerifierCalibrationReportV1> {
	const profileCoordinates = validateProfileCoordinates(input.profileCoordinates);
	const capability = validateCapability(input.capability, profileCoordinates);
	const cases: Array<ClosedVerifierCalibrationReportV1["cases"][number]> = [];
	const issueCodes: string[] = [];
	const identities = new Set<string>();
	for (const caseKind of EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS) {
		assertNotCancelled(input.signal);
		let rawResult: unknown;
		try {
			rawResult = await capability.runCase({
				caseKind,
				profileCoordinates,
				signal: input.signal,
			});
			assertNotCancelled(input.signal);
		} catch {
			if (input.signal.aborted)
				throw new DOMException("verifier calibration cancelled", "AbortError");
			issueCodes.push(`calibration-execution-failed:${caseKind}`);
			continue;
		}
		let result: ClosedVerifierCalibrationCaseResultV1;
		try {
			result = validateCaseResult(rawResult, caseKind, profileCoordinates);
		} catch {
			issueCodes.push(`calibration-result-invalid:${caseKind}`);
			continue;
		}
		const identity = `${result.evidenceRef.kind}\0${result.evidenceRef.id}`;
		if (identities.has(identity)) {
			issueCodes.push(`calibration-evidence-reused:${caseKind}`);
			continue;
		}
		identities.add(identity);
		const expected = expectedObservation(caseKind);
		if (result.observation !== expected) {
			issueCodes.push(`calibration-case-mismatch:${caseKind}`);
		}
		cases.push(
			strictSnapshot({
				caseKind,
				expected,
				observed: result.observation,
				evidenceRef: result.evidenceRef,
			}),
		);
	}
	if (cases.length !== EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS.length) {
		issueCodes.push("calibration-case-set-incomplete");
	}
	const sortedIssueCodes = Object.freeze([...new Set(issueCodes)].sort());
	return strictSnapshot({
		schemaVersion: CLOSED_VERIFIER_CALIBRATION_SCHEMAS.report,
		profileCoordinates,
		cases,
		qualified: sortedIssueCodes.length === 0,
		issueCodes: sortedIssueCodes,
	});
}

function validateProfileCoordinates(value: unknown): ClosedVerifierProfileCoordinatesV1 {
	const profile = record(value, "calibration.profileCoordinates");
	exactKeys(
		profile,
		[
			"fixtureSuiteDigest",
			"fixtureSuiteRef",
			"fixtureSuiteRevision",
			"harnessRevision",
			"taskDigest",
			"taskRef",
			"verifierProfileDigest",
			"verifierProfileRef",
			"verifierProfileRevision",
		],
		"calibration.profileCoordinates",
	);
	return strictSnapshot({
		taskRef: coordinate(profile.taskRef, "calibration.profileCoordinates.taskRef"),
		taskDigest: digest(profile.taskDigest, "calibration.profileCoordinates.taskDigest"),
		verifierProfileRef: coordinate(
			profile.verifierProfileRef,
			"calibration.profileCoordinates.verifierProfileRef",
		),
		verifierProfileRevision: coordinate(
			profile.verifierProfileRevision,
			"calibration.profileCoordinates.verifierProfileRevision",
		),
		verifierProfileDigest: digest(
			profile.verifierProfileDigest,
			"calibration.profileCoordinates.verifierProfileDigest",
		),
		fixtureSuiteRef: coordinate(
			profile.fixtureSuiteRef,
			"calibration.profileCoordinates.fixtureSuiteRef",
		),
		fixtureSuiteRevision: coordinate(
			profile.fixtureSuiteRevision,
			"calibration.profileCoordinates.fixtureSuiteRevision",
		),
		fixtureSuiteDigest: digest(
			profile.fixtureSuiteDigest,
			"calibration.profileCoordinates.fixtureSuiteDigest",
		),
		harnessRevision: coordinate(
			profile.harnessRevision,
			"calibration.profileCoordinates.harnessRevision",
		),
	});
}

function validateCapability(
	value: ClosedVerifierCalibrationCapabilityV1,
	profile: ClosedVerifierProfileCoordinatesV1,
): ClosedVerifierCalibrationCapabilityV1 {
	const capability = record(value, "calibration.capability");
	exactKeys(
		capability,
		["runCase", "verifierProfileDigest", "verifierProfileRef", "verifierProfileRevision"],
		"calibration.capability",
	);
	if (
		capability.verifierProfileRef !== profile.verifierProfileRef ||
		capability.verifierProfileRevision !== profile.verifierProfileRevision ||
		capability.verifierProfileDigest !== profile.verifierProfileDigest ||
		typeof capability.runCase !== "function"
	) {
		fail("calibration.capability", "does not match the exact verifier profile");
	}
	return value;
}

function validateCaseResult(
	value: unknown,
	expectedCaseKind: EmpiricalQualificationEvidenceKind,
	profile: ClosedVerifierProfileCoordinatesV1,
): ClosedVerifierCalibrationCaseResultV1 {
	const result = record(value, "calibration.caseResult");
	exactKeys(
		result,
		["caseKind", "evidenceRef", "observation", "schemaVersion"],
		"calibration.caseResult",
	);
	if (result.schemaVersion !== CLOSED_VERIFIER_CALIBRATION_SCHEMAS.caseResult) {
		fail("calibration.caseResult.schemaVersion", "unexpected schema");
	}
	const caseKind = oneOf(
		result.caseKind,
		EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS,
		"calibration.caseResult.caseKind",
	);
	if (caseKind !== expectedCaseKind) {
		fail("calibration.caseResult.caseKind", "does not match the requested closed case");
	}
	const evidenceRef = validateEvidenceRef(result.evidenceRef, caseKind, profile);
	return strictSnapshot({
		schemaVersion: CLOSED_VERIFIER_CALIBRATION_SCHEMAS.caseResult,
		caseKind,
		observation: oneOf(
			result.observation,
			["accepted", "rejected", "non-evaluable"] as const,
			"calibration.caseResult.observation",
		),
		evidenceRef,
	});
}

function validateEvidenceRef(
	value: unknown,
	caseKind: EmpiricalQualificationEvidenceKind,
	profile: ClosedVerifierProfileCoordinatesV1,
): EmpiricalEvidenceRefV1 {
	const evidence = record(value, "calibration.caseResult.evidenceRef");
	exactKeys(
		evidence,
		[
			"digest",
			"fixtureSuiteDigest",
			"harnessRevision",
			"id",
			"kind",
			"subjectDigest",
			"subjectRef",
		],
		"calibration.caseResult.evidenceRef",
	);
	const validated = strictSnapshot({
		kind: oneOf(
			evidence.kind,
			EMPIRICAL_QUALIFICATION_EVIDENCE_KINDS,
			"calibration.caseResult.evidenceRef.kind",
		),
		id: coordinate(evidence.id, "calibration.caseResult.evidenceRef.id"),
		digest: digest(evidence.digest, "calibration.caseResult.evidenceRef.digest"),
		subjectRef: coordinate(evidence.subjectRef, "calibration.caseResult.evidenceRef.subjectRef"),
		subjectDigest: digest(
			evidence.subjectDigest,
			"calibration.caseResult.evidenceRef.subjectDigest",
		),
		fixtureSuiteDigest: digest(
			evidence.fixtureSuiteDigest,
			"calibration.caseResult.evidenceRef.fixtureSuiteDigest",
		),
		harnessRevision: coordinate(
			evidence.harnessRevision,
			"calibration.caseResult.evidenceRef.harnessRevision",
		),
	});
	const taskSpecific = TASK_SPECIFIC_CASES.has(caseKind);
	if (
		validated.kind !== caseKind ||
		validated.fixtureSuiteDigest !== profile.fixtureSuiteDigest ||
		validated.harnessRevision !== profile.harnessRevision ||
		validated.subjectRef !== (taskSpecific ? profile.taskRef : profile.verifierProfileRef) ||
		validated.subjectDigest !== (taskSpecific ? profile.taskDigest : profile.verifierProfileDigest)
	) {
		fail("calibration.caseResult.evidenceRef", "does not bind the exact case and profile");
	}
	return validated;
}

function expectedObservation(
	caseKind: EmpiricalQualificationEvidenceKind,
): ClosedVerifierCalibrationObservation {
	switch (caseKind) {
		case "command-policy":
		case "known-good-verifier":
		case "workspace-isolation":
			return "accepted";
		case "missing-evidence-non-evaluable":
		case "non-executable-evidence-non-evaluable":
		case "unreliable-evidence-non-evaluable":
			return "non-evaluable";
		case "actor-claim-rejection":
		case "out-of-policy-diff-rejection":
		case "plausible-wrong-verifier":
		case "target-defect-verifier":
		case "test-tamper-rejection":
		case "verifier-tamper-rejection":
			return "rejected";
	}
}

function assertNotCancelled(signal: AbortSignal): void {
	if (signal.aborted) throw new DOMException("verifier calibration cancelled", "AbortError");
}
