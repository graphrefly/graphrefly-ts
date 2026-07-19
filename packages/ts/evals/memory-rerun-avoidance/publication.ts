import { createHash } from "node:crypto";
import type {
	EvalFamilyScorecardV1,
	EvalInputCoordinates,
	EvalResultRef,
} from "../../src/__tests__/eval-support/memory-rerun-avoidance/contracts.js";
import { strictJsonCodec } from "../../src/json/codec.js";
import { MEMORY_RERUN_AVOIDANCE_PUBLICATION as CONTRACT } from "./constants.js";

export interface SolutionEvalPublicationSourceRef {
	readonly kind: string;
	readonly id: string;
}

export interface MemoryRerunAvoidancePublicationManifestV1 {
	readonly schemaVersion: "graphrefly.private-solution-eval.publication-manifest.v1";
	readonly artifactRef: string;
	readonly familyRef: string;
	readonly lane: "deterministic";
	readonly scorecardSchemaVersion: "graphrefly.private-solution-eval.family-scorecard.v1";
	readonly scorecardSha256: string;
	readonly canonicalByteLength: number;
	readonly generatorRevision: string;
	readonly sourceRefs: readonly SolutionEvalPublicationSourceRef[];
}

export interface ValidatedMemoryRerunAvoidancePublication {
	readonly manifest: MemoryRerunAvoidancePublicationManifestV1;
	readonly scorecard: EvalFamilyScorecardV1;
}

const MANIFEST_KEYS = Object.freeze([
	"artifactRef",
	"canonicalByteLength",
	"familyRef",
	"generatorRevision",
	"lane",
	"schemaVersion",
	"scorecardSchemaVersion",
	"scorecardSha256",
	"sourceRefs",
]);

const CASE_KINDS = Object.freeze([
	"relevant-applied",
	"proposal-only",
	"admission-rejected",
	"irrelevant-applied",
	"wrong-scope-applied",
]);

const SCORECARD_KEYS = Object.freeze([
	"cases",
	"familyPassed",
	"familyRef",
	"issueCodes",
	"lane",
	"metrics",
	"requiredCaseRefs",
	"resultRefs",
	"schemaVersion",
]);

const CASE_KEYS = Object.freeze([
	"canonicalGatePassed",
	"caseConforms",
	"caseKind",
	"caseRef",
	"cold",
	"expectation",
	"familyRef",
	"input",
	"issueCodes",
	"lane",
	"memory",
	"reflection",
	"required",
	"resultRefs",
	"schemaVersion",
	"stagePredicates",
	"warm",
]);

const INPUT_COORDINATE_KEYS = Object.freeze([
	"executorRevision",
	"mapperRevision",
	"plannerRevision",
	"reflectorRevision",
	"verifierRevision",
	"workItemDigest",
	"worldDigest",
	"worldRevision",
]);

const PREDICATE_KEYS = Object.freeze([
	"cold_run_failed",
	"memory_record_admitted",
	"memory_record_applied",
	"memory_record_proposed",
	"memory_record_retrieved",
	"prior_failure_route_avoided",
	"same_work_item_input",
	"warm_decision_trace_includes_memory",
	"warm_run_passed",
]);

const EXPECTATION_KEYS = Object.freeze([
	"admissionState",
	"applicationState",
	"coldRunPassed",
	"mapperExplicitCandidates",
	"priorFailureRouteAvoided",
	"proposalState",
	"retrievalState",
	"sameWorkItemInput",
	"traceMemoryDisposition",
	"warmRoute",
	"warmRunPassed",
]);

const MEMORY_STAGE_STATES = Object.freeze({
	proposal: Object.freeze(["emitted", "not-emitted"]),
	admission: Object.freeze(["admitted", "rejected", "not-run"]),
	application: Object.freeze(["applied", "not-applied", "not-run"]),
	retrieval: Object.freeze(["retrieved", "not-retrieved"]),
});

function fail(path: string, message: string): never {
	throw new TypeError(`B106.1 publication ${path}: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return fail(path, "expected object");
	}
	return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
	if (!Array.isArray(value)) return fail(path, "expected array");
	return value;
}

function string(value: unknown, path: string): string {
	if (typeof value !== "string") return fail(path, "expected string");
	return value;
}

function boolean(value: unknown, path: string): boolean {
	if (typeof value !== "boolean") return fail(path, "expected boolean");
	return value;
}

function finiteNumber(value: unknown, path: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fail(path, "expected finite number");
	}
	return value;
}

function literal<T extends string | boolean>(value: unknown, expected: T, path: string): T {
	if (value !== expected) return fail(path, `expected ${JSON.stringify(expected)}`);
	return expected;
}

function oneOf<T extends string>(value: unknown, expected: readonly T[], path: string): T {
	const actual = string(value, path);
	if (!expected.includes(actual as T)) {
		return fail(path, `expected one of ${JSON.stringify(expected)}`);
	}
	return actual as T;
}

function exactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
	path: string,
): void {
	const actual = Object.keys(value).sort();
	const canonical = [...expected].sort();
	if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
		fail(path, `unexpected keys ${JSON.stringify(actual)}`);
	}
}

function stringArray(value: unknown, path: string, limit: number): readonly string[] {
	const values = array(value, path);
	if (values.length > limit) fail(path, `exceeds bound ${limit}`);
	return values.map((entry, index) => string(entry, `${path}[${index}]`));
}

function resultRefs(value: unknown, path: string, limit: number): readonly EvalResultRef[] {
	const values = array(value, path);
	if (values.length > limit) fail(path, `exceeds bound ${limit}`);
	return values.map((entry, index) => {
		const ref = record(entry, `${path}[${index}]`);
		exactKeys(ref, ["id", "kind"], `${path}[${index}]`);
		return Object.freeze({
			kind: string(ref.kind, `${path}[${index}].kind`),
			id: string(ref.id, `${path}[${index}].id`),
		});
	});
}

function sourceRefs(value: unknown, path: string): readonly SolutionEvalPublicationSourceRef[] {
	const refs = resultRefs(value, path, 8);
	if (refs.length === 0) fail(path, "requires at least one source ref");
	return refs;
}

function sameStrings(actual: readonly string[], expected: readonly string[], path: string): void {
	if (
		actual.length !== expected.length ||
		actual.some((value, index) => value !== expected[index])
	) {
		fail(path, `expected ${JSON.stringify(expected)}`);
	}
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
	for (const nested of Object.values(value)) deepFreeze(nested);
	return Object.freeze(value);
}

function assertCanonicalBytes(value: unknown, bytes: Uint8Array, path: string): void {
	const canonical = strictJsonCodec.encode(value);
	if (!sameBytes(canonical, bytes)) fail(path, "bytes are not strict canonical JSON");
}

function assertDigest(value: unknown, path: string): string {
	const digest = string(value, path);
	if (!/^sha256:[0-9a-f]{64}$/.test(digest)) fail(path, "expected canonical sha256 digest");
	return digest;
}

function assertInputCoordinates(value: unknown, path: string): EvalInputCoordinates {
	const input = record(value, path);
	exactKeys(input, INPUT_COORDINATE_KEYS, path);
	const expected = CONTRACT.inputRevisions;
	for (const [key, revision] of Object.entries(expected)) {
		literal(input[key], revision, `${path}.${key}`);
	}
	assertDigest(input.workItemDigest, `${path}.workItemDigest`);
	assertDigest(input.worldDigest, `${path}.worldDigest`);
	return input as unknown as EvalInputCoordinates;
}

function assertRunObservation(value: unknown, path: string): void {
	const run = record(value, path);
	exactKeys(
		run,
		["decisionTrace", "issueCodes", "outcomeStatus", "resultRefs", "route", "verifierSatisfied"],
		path,
	);
	oneOf(run.route, ["unsafe-direct-edit", "memory-guided-verify-first"], `${path}.route`);
	oneOf(run.outcomeStatus, ["completed", "failed"], `${path}.outcomeStatus`);
	boolean(run.verifierSatisfied, `${path}.verifierSatisfied`);
	stringArray(run.issueCodes, `${path}.issueCodes`, 16);
	resultRefs(run.resultRefs, `${path}.resultRefs`, 32);
	const trace = array(run.decisionTrace, `${path}.decisionTrace`);
	if (trace.length > 16) fail(`${path}.decisionTrace`, "exceeds bound 16");
	for (let index = 0; index < trace.length; index += 1) {
		const eventPath = `${path}.decisionTrace[${index}]`;
		const event = record(trace[index], eventPath);
		const eventKind = oneOf(
			event.event,
			["planner-start", "route-selected", "memory-considered", "memory-used", "memory-rejected"],
			`${eventPath}.event`,
		);
		if (eventKind === "planner-start" || eventKind === "route-selected") {
			exactKeys(event, ["event", "reasonCode", "route"], eventPath);
			oneOf(
				event.route,
				["unsafe-direct-edit", "memory-guided-verify-first"],
				`${eventPath}.route`,
			);
		} else {
			exactKeys(event, ["event", "reasonCode", "recordRef"], eventPath);
			resultRefs([event.recordRef], `${eventPath}.recordRef`, 1);
		}
		string(event.reasonCode, `${eventPath}.reasonCode`);
	}
}

function assertCase(value: unknown, expectedRef: string, expectedKind: string, path: string): void {
	const observation = record(value, path);
	exactKeys(observation, CASE_KEYS, path);
	literal(observation.schemaVersion, CONTRACT.caseSchemaVersion, `${path}.schemaVersion`);
	literal(observation.familyRef, CONTRACT.familyRef, `${path}.familyRef`);
	literal(observation.caseRef, expectedRef, `${path}.caseRef`);
	literal(observation.caseKind, expectedKind, `${path}.caseKind`);
	literal(observation.lane, CONTRACT.lane, `${path}.lane`);
	literal(observation.required, true, `${path}.required`);

	const input = record(observation.input, `${path}.input`);
	exactKeys(input, ["cold", "warm"], `${path}.input`);
	const cold = assertInputCoordinates(input.cold, `${path}.input.cold`);
	const warm = assertInputCoordinates(input.warm, `${path}.input.warm`);
	if (!sameBytes(strictJsonCodec.encode(cold), strictJsonCodec.encode(warm))) {
		fail(`${path}.input`, "cold and warm coordinates differ");
	}

	assertRunObservation(observation.cold, `${path}.cold`);
	assertRunObservation(observation.warm, `${path}.warm`);
	const reflection = record(observation.reflection, `${path}.reflection`);
	exactKeys(
		reflection,
		["candidateCount", "candidateRecordRefs", "evidenceRefs"],
		`${path}.reflection`,
	);
	const candidateCount = finiteNumber(
		reflection.candidateCount,
		`${path}.reflection.candidateCount`,
	);
	if (!Number.isSafeInteger(candidateCount) || candidateCount < 0 || candidateCount > 16) {
		fail(`${path}.reflection.candidateCount`, "expected bounded non-negative safe integer");
	}
	resultRefs(reflection.candidateRecordRefs, `${path}.reflection.candidateRecordRefs`, 16);
	resultRefs(reflection.evidenceRefs, `${path}.reflection.evidenceRefs`, 16);
	const memory = record(observation.memory, `${path}.memory`);
	exactKeys(
		memory,
		["admission", "application", "mapperExplicitCandidates", "proposal", "retrieval"],
		`${path}.memory`,
	);
	for (const stage of ["proposal", "admission", "application", "retrieval"] as const) {
		const stageValue = record(memory[stage], `${path}.memory.${stage}`);
		exactKeys(stageValue, ["recordRefs", "state"], `${path}.memory.${stage}`);
		oneOf(stageValue.state, MEMORY_STAGE_STATES[stage], `${path}.memory.${stage}.state`);
		resultRefs(stageValue.recordRefs, `${path}.memory.${stage}.recordRefs`, 32);
	}
	if (memory.mapperExplicitCandidates !== 0) {
		fail(`${path}.memory.mapperExplicitCandidates`, "expected 0");
	}

	const predicates = record(observation.stagePredicates, `${path}.stagePredicates`);
	exactKeys(predicates, PREDICATE_KEYS, `${path}.stagePredicates`);
	for (const key of PREDICATE_KEYS) {
		boolean(predicates[key], `${path}.stagePredicates.${key}`);
	}
	const expectation = record(observation.expectation, `${path}.expectation`);
	exactKeys(expectation, EXPECTATION_KEYS, `${path}.expectation`);
	literal(expectation.coldRunPassed, false, `${path}.expectation.coldRunPassed`);
	literal(expectation.sameWorkItemInput, true, `${path}.expectation.sameWorkItemInput`);
	if (expectation.mapperExplicitCandidates !== 0) {
		fail(`${path}.expectation.mapperExplicitCandidates`, "expected 0");
	}
	oneOf(expectation.proposalState, ["emitted", "not-emitted"], `${path}.expectation.proposalState`);
	oneOf(
		expectation.admissionState,
		["admitted", "rejected", "not-run"],
		`${path}.expectation.admissionState`,
	);
	oneOf(
		expectation.applicationState,
		["applied", "not-applied", "not-run"],
		`${path}.expectation.applicationState`,
	);
	oneOf(
		expectation.retrievalState,
		["retrieved", "not-retrieved"],
		`${path}.expectation.retrievalState`,
	);
	boolean(expectation.warmRunPassed, `${path}.expectation.warmRunPassed`);
	oneOf(
		expectation.warmRoute,
		["unsafe-direct-edit", "memory-guided-verify-first"],
		`${path}.expectation.warmRoute`,
	);
	oneOf(
		expectation.traceMemoryDisposition,
		["used", "rejected-irrelevant", "rejected-scope", "none"],
		`${path}.expectation.traceMemoryDisposition`,
	);
	boolean(expectation.priorFailureRouteAvoided, `${path}.expectation.priorFailureRouteAvoided`);
	boolean(observation.canonicalGatePassed, `${path}.canonicalGatePassed`);
	boolean(observation.caseConforms, `${path}.caseConforms`);
	stringArray(observation.issueCodes, `${path}.issueCodes`, 16);
	resultRefs(observation.resultRefs, `${path}.resultRefs`, 32);
}

function assertMetrics(value: unknown): void {
	const metrics = record(value, "scorecard.metrics");
	exactKeys(
		metrics,
		["negativeControlFalsePositiveRate", "relevantMemoryLift", "stageCounts", "traceAttribution"],
		"scorecard.metrics",
	);
	const lift = record(metrics.relevantMemoryLift, "scorecard.metrics.relevantMemoryLift");
	exactKeys(lift, ["coldPassRate", "lift", "warmPassRate"], "scorecard.metrics.relevantMemoryLift");
	for (const key of ["coldPassRate", "warmPassRate", "lift"]) {
		finiteNumber(lift[key], `scorecard.metrics.relevantMemoryLift.${key}`);
	}
	const falsePositiveRate = record(
		metrics.negativeControlFalsePositiveRate,
		"scorecard.metrics.negativeControlFalsePositiveRate",
	);
	exactKeys(
		falsePositiveRate,
		["controls", "falsePositives", "rate"],
		"scorecard.metrics.negativeControlFalsePositiveRate",
	);
	for (const key of ["falsePositives", "controls", "rate"]) {
		finiteNumber(
			falsePositiveRate[key],
			`scorecard.metrics.negativeControlFalsePositiveRate.${key}`,
		);
	}
	const attribution = record(metrics.traceAttribution, "scorecard.metrics.traceAttribution");
	exactKeys(
		attribution,
		["attributedRetrievedRecords", "rate", "retrievedRecords"],
		"scorecard.metrics.traceAttribution",
	);
	for (const key of ["attributedRetrievedRecords", "retrievedRecords", "rate"]) {
		finiteNumber(attribution[key], `scorecard.metrics.traceAttribution.${key}`);
	}
	const stages = record(metrics.stageCounts, "scorecard.metrics.stageCounts");
	const stageKeys = [
		"admissionNotRun",
		"admissionRejected",
		"admitted",
		"applicationNotApplied",
		"applicationNotRun",
		"applied",
		"proposed",
		"retrieved",
	];
	exactKeys(stages, stageKeys, "scorecard.metrics.stageCounts");
	for (const key of stageKeys) finiteNumber(stages[key], `scorecard.metrics.stageCounts.${key}`);
}

export function publicationSha256(bytes: Uint8Array): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function validateMemoryRerunAvoidanceScorecardBytes(
	bytes: Uint8Array,
): EvalFamilyScorecardV1 {
	const decoded = strictJsonCodec.decode(bytes);
	assertCanonicalBytes(decoded, bytes, "scorecard");
	const scorecard = record(decoded, "scorecard");
	exactKeys(scorecard, SCORECARD_KEYS, "scorecard");
	literal(scorecard.schemaVersion, CONTRACT.scorecardSchemaVersion, "scorecard.schemaVersion");
	literal(scorecard.familyRef, CONTRACT.familyRef, "scorecard.familyRef");
	literal(scorecard.lane, CONTRACT.lane, "scorecard.lane");
	const requiredCaseRefs = stringArray(
		scorecard.requiredCaseRefs,
		"scorecard.requiredCaseRefs",
		16,
	);
	sameStrings(requiredCaseRefs, CONTRACT.requiredCaseRefs, "scorecard.requiredCaseRefs");
	const cases = array(scorecard.cases, "scorecard.cases");
	if (cases.length !== CASE_KINDS.length) fail("scorecard.cases", "expected five required cases");
	for (let index = 0; index < cases.length; index += 1) {
		assertCase(
			cases[index],
			CONTRACT.requiredCaseRefs[index] ?? fail("scorecard.cases", "missing case ref"),
			CASE_KINDS[index] ?? fail("scorecard.cases", "missing case kind"),
			`scorecard.cases[${index}]`,
		);
	}
	assertMetrics(scorecard.metrics);
	const familyPassed = boolean(scorecard.familyPassed, "scorecard.familyPassed");
	const allRequiredCasesConform = cases.every(
		(value) => record(value, "scorecard.cases[*]").caseConforms === true,
	);
	if (familyPassed !== allRequiredCasesConform) {
		fail("scorecard.familyPassed", "must equal required cases every(caseConforms)");
	}
	stringArray(scorecard.issueCodes, "scorecard.issueCodes", 16);
	resultRefs(scorecard.resultRefs, "scorecard.resultRefs", 32);
	return scorecard as unknown as EvalFamilyScorecardV1;
}

export function createMemoryRerunAvoidancePublicationManifest(
	scorecardBytes: Uint8Array,
): MemoryRerunAvoidancePublicationManifestV1 {
	validateMemoryRerunAvoidanceScorecardBytes(scorecardBytes);
	return Object.freeze({
		schemaVersion: CONTRACT.manifestSchemaVersion,
		artifactRef: CONTRACT.artifactRef,
		familyRef: CONTRACT.familyRef,
		lane: CONTRACT.lane,
		scorecardSchemaVersion: CONTRACT.scorecardSchemaVersion,
		scorecardSha256: publicationSha256(scorecardBytes),
		canonicalByteLength: scorecardBytes.byteLength,
		generatorRevision: CONTRACT.generatorRevision,
		sourceRefs: CONTRACT.sourceRefs,
	});
}

function validateManifestBytes(bytes: Uint8Array): MemoryRerunAvoidancePublicationManifestV1 {
	const decoded = strictJsonCodec.decode(bytes);
	assertCanonicalBytes(decoded, bytes, "manifest");
	const manifest = record(decoded, "manifest");
	exactKeys(manifest, MANIFEST_KEYS, "manifest");
	literal(manifest.schemaVersion, CONTRACT.manifestSchemaVersion, "manifest.schemaVersion");
	literal(manifest.artifactRef, CONTRACT.artifactRef, "manifest.artifactRef");
	literal(manifest.familyRef, CONTRACT.familyRef, "manifest.familyRef");
	literal(manifest.lane, CONTRACT.lane, "manifest.lane");
	literal(
		manifest.scorecardSchemaVersion,
		CONTRACT.scorecardSchemaVersion,
		"manifest.scorecardSchemaVersion",
	);
	assertDigest(manifest.scorecardSha256, "manifest.scorecardSha256");
	const length = finiteNumber(manifest.canonicalByteLength, "manifest.canonicalByteLength");
	if (!Number.isSafeInteger(length) || length <= 0) {
		fail("manifest.canonicalByteLength", "expected positive safe integer");
	}
	literal(manifest.generatorRevision, CONTRACT.generatorRevision, "manifest.generatorRevision");
	const refs = sourceRefs(manifest.sourceRefs, "manifest.sourceRefs");
	if (!sameBytes(strictJsonCodec.encode(refs), strictJsonCodec.encode(CONTRACT.sourceRefs))) {
		fail("manifest.sourceRefs", "do not match canonical publication sources");
	}
	return manifest as unknown as MemoryRerunAvoidancePublicationManifestV1;
}

export function validateMemoryRerunAvoidancePublication(
	scorecardBytes: Uint8Array,
	manifestBytes: Uint8Array,
): ValidatedMemoryRerunAvoidancePublication {
	const scorecard = validateMemoryRerunAvoidanceScorecardBytes(scorecardBytes);
	const manifest = validateManifestBytes(manifestBytes);
	if (manifest.canonicalByteLength !== scorecardBytes.byteLength) {
		fail("manifest.canonicalByteLength", "does not match scorecard bytes");
	}
	if (manifest.scorecardSha256 !== publicationSha256(scorecardBytes)) {
		fail("manifest.scorecardSha256", "does not match scorecard bytes");
	}
	return Object.freeze({ manifest: deepFreeze(manifest), scorecard: deepFreeze(scorecard) });
}
