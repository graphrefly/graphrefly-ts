import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import type { AgentRequestIssued } from "../../src/orchestration/agent-runtime.js";
import { empiricalStrictJsonDigest, exactKeys, record, strictSnapshot } from "./canonical.js";
import {
	commitD696PrivateStagingDirectory,
	failD696PrivateStagingGeneration,
} from "./d696-continuation-assisted-live.js";
import {
	createD716GraphNativeSixArmCoordinator,
	D716_GRAPH_NATIVE_ARM_ORDER,
	D716_GRAPH_NATIVE_COORDINATOR_REVISION,
	type D716ArmCompletionFact,
	type D716GraphNativeCoordinationEvidenceV1,
	type D716GraphNativeSixArmCoordinatorV1,
	type D716RequestInput,
	recordD716GraphNativeArmCompletion,
	takeNextD716GraphNativeArmRequest,
	validateD716GraphNativeCoordinationEvidence,
} from "./d716-graph-native-live-coordinator.js";
import {
	brandD716GraphNativeLiveQualification,
	deleteD716GraphNativeLiveQualificationBrand,
	isBrandedD716GraphNativeLiveQualification,
} from "./d716-graph-native-live-qualification-brand.js";
import {
	type EmpiricalTrialBlockObservationV3,
	validateEmpiricalTrialBlockObservation,
} from "./empirical-smoke-evidence.js";
import type { B112MatchedBlockReflectionV2 } from "./matched-block-memory.js";
import type { OpenRouterMatchedTrialBlockResultV4 } from "./openrouter-first-task-smoke.js";
import { syncDirectory, writePrivateFile } from "./private-smoke-persistence.js";

export const D716_GRAPH_NATIVE_LIVE_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d716.graph-native-live-qualification.v1" as const;
export const D716_GRAPH_NATIVE_LIVE_SCORECARD_SCHEMA =
	"graphrefly.b112.d716.graph-native-live-scorecard.v1" as const;
export const D716_GRAPH_NATIVE_LIVE_GENERATION_SCHEMA =
	"graphrefly.b112.d716.graph-native-live-generation.v1" as const;
export const D716_GRAPH_NATIVE_LIVE_CLAIM_BOUNDARY =
	"package-private-simulated-contract-graph-native-six-arm-live-harness" as const;

export interface D716GraphNativeLiveQualificationV1 {
	readonly schemaVersion: typeof D716_GRAPH_NATIVE_LIVE_QUALIFICATION_SCHEMA;
	readonly claimBoundary: typeof D716_GRAPH_NATIVE_LIVE_CLAIM_BOUNDARY;
	readonly coordinatorRevision: typeof D716_GRAPH_NATIVE_COORDINATOR_REVISION;
	readonly executionClass: "simulated-contract";
	readonly underlyingObservationDigest: string;
	readonly coordinationEvidenceDigest: string;
	readonly simulatedTransportRequestCount: number;
	readonly progressPhases: readonly D716GraphNativeCoordinationEvidenceV1["progress"][number]["phase"][];
	readonly gates: {
		readonly exactSixArmOrder: boolean;
		readonly allSixArmsCompleted: boolean;
		readonly warmArmsIndependentOfCold: boolean;
		readonly oneActiveArm: boolean;
		readonly workItemExecutionRecipeUsed: boolean;
		readonly nonEvaluableColdStillAdvances: boolean;
		readonly wrongProvenanceRejected: boolean;
		readonly duplicateOrStaleCompletionRejected: boolean;
		readonly accessorRejectedBeforeRead: boolean;
		readonly failureFactsRemainMaterialFree: boolean;
		readonly noNetwork: true;
		readonly providerCallCount: 0;
		readonly chargedCostMicrousd: 0;
	};
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface D716GraphNativeLiveScorecardV1 {
	readonly schemaVersion: typeof D716_GRAPH_NATIVE_LIVE_SCORECARD_SCHEMA;
	readonly claimBoundary: typeof D716_GRAPH_NATIVE_LIVE_CLAIM_BOUNDARY;
	readonly qualificationDigest: string;
	readonly qualified: boolean;
	readonly completedArmCount: number;
	readonly evaluableArmCount: number;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly scorecardDigest: string;
}

const constructedQualifications = new WeakSet<object>();
const constructedScorecards = new WeakSet<object>();

export function isConstructedD716GraphNativeLiveQualification(
	value: unknown,
): value is D716GraphNativeLiveQualificationV1 {
	return (
		typeof value === "object" &&
		value !== null &&
		constructedQualifications.has(value) &&
		isBrandedD716GraphNativeLiveQualification(value)
	);
}

function requestFact(
	request: AgentRequestIssued<D716RequestInput>,
	overrides: Partial<D716ArmCompletionFact> = {},
): D716ArmCompletionFact {
	const input = request.input?.value;
	if (input === undefined || input.authority !== "D716") {
		throw new TypeError("D716 qualification request omitted graph coordinates");
	}
	return strictSnapshot({
		arm: input.arm,
		sequence: input.sequence,
		workItemId: `d716-arm-${input.arm}`,
		executionInputRevision: input.sequence + 1,
		issuedRequestDigest: empiricalStrictJsonDigest(request),
		traceComplete: false,
		inspectionObserved: false,
		contentChangingMutationObserved: false,
		nonEmptyDiffAfterLatestMutation: false,
		focusedValidationAttempted: false,
		focusedValidationPassed: false,
		hiddenVerifierAttempted: false,
		hiddenVerifierPassed: false,
		requests: 0,
		costMicrousd: 0,
		elapsedMs: 0,
		stoppedReason: "warm-preparation-failed" as const,
		...overrides,
	});
}

function finishRemainingArms(coordinator: D716GraphNativeSixArmCoordinatorV1): void {
	for (let index = 2; index < D716_GRAPH_NATIVE_ARM_ORDER.length; index += 1) {
		const request = takeNextD716GraphNativeArmRequest(coordinator);
		recordD716GraphNativeArmCompletion(coordinator, requestFact(request));
	}
}

function runBoundaryGates(input: {
	readonly warmReflection: B112MatchedBlockReflectionV2;
	readonly infrastructureEvidenceDigest: string;
}): Pick<
	D716GraphNativeLiveQualificationV1["gates"],
	| "accessorRejectedBeforeRead"
	| "duplicateOrStaleCompletionRejected"
	| "nonEvaluableColdStillAdvances"
	| "oneActiveArm"
	| "wrongProvenanceRejected"
> {
	const create = () =>
		createD716GraphNativeSixArmCoordinator({
			qualificationDigest:
				"sha256:56d5ec277761d635b9036a2dd0a2c84db6bcd8731d3f148f020744b17297b644",
			infrastructureEvidenceDigest: input.infrastructureEvidenceDigest,
			warmReflection: input.warmReflection,
		});
	const coordinator = create();
	const cold = takeNextD716GraphNativeArmRequest(coordinator);
	let oneActiveArm = false;
	try {
		takeNextD716GraphNativeArmRequest(coordinator);
	} catch {
		oneActiveArm = true;
	}
	let wrongProvenanceRejected = false;
	try {
		recordD716GraphNativeArmCompletion(coordinator, {
			...requestFact(cold),
			issuedRequestDigest: empiricalStrictJsonDigest({ forged: true }),
		});
	} catch {
		try {
			recordD716GraphNativeArmCompletion(coordinator, {
				...requestFact(cold),
				sequence: (cold.input?.value?.sequence ?? 0) + 1,
			});
		} catch {
			wrongProvenanceRejected = true;
		}
	}
	recordD716GraphNativeArmCompletion(
		coordinator,
		requestFact(cold, { stoppedReason: "cancelled" }),
	);
	const warm = takeNextD716GraphNativeArmRequest(coordinator);
	const nonEvaluableColdStillAdvances = warm.input?.value?.arm === "relevant-applied";
	let duplicateOrStaleCompletionRejected = false;
	try {
		recordD716GraphNativeArmCompletion(coordinator, requestFact(cold));
	} catch {
		duplicateOrStaleCompletionRejected = true;
	}
	recordD716GraphNativeArmCompletion(coordinator, requestFact(warm));
	finishRemainingArms(coordinator);

	const accessorCoordinator = create();
	const accessorRequest = takeNextD716GraphNativeArmRequest(accessorCoordinator);
	let getterHits = 0;
	const accessorFact = Object.defineProperty({}, "arm", {
		enumerable: true,
		get() {
			getterHits += 1;
			return accessorRequest.input?.value?.arm;
		},
	});
	let accessorRejectedBeforeRead = false;
	try {
		recordD716GraphNativeArmCompletion(accessorCoordinator, accessorFact);
	} catch {
		accessorRejectedBeforeRead = getterHits === 0;
	}
	return Object.freeze({
		oneActiveArm,
		wrongProvenanceRejected,
		duplicateOrStaleCompletionRejected,
		nonEvaluableColdStillAdvances,
		accessorRejectedBeforeRead,
	});
}

export function createD716GraphNativeLiveQualification(inputValue: {
	readonly result: OpenRouterMatchedTrialBlockResultV4;
	readonly warmReflection: B112MatchedBlockReflectionV2;
}): D716GraphNativeLiveQualificationV1 {
	const input = record(inputValue, "d716.qualificationInput");
	exactKeys(input, ["result", "warmReflection"], "d716.qualificationInput");
	const result = record(
		input.result,
		"d716.result",
	) as unknown as OpenRouterMatchedTrialBlockResultV4;
	if (result.profile !== "smoke" || result.graphNativeCoordination === undefined) {
		throw new TypeError("D716 qualification requires the integrated smoke result");
	}
	const underlying = validateEmpiricalTrialBlockObservation(result.observation);
	const coordination = validateD716GraphNativeCoordinationEvidence(result.graphNativeCoordination);
	const boundary = runBoundaryGates({
		warmReflection: input.warmReflection as B112MatchedBlockReflectionV2,
		infrastructureEvidenceDigest: coordination.infrastructureEvidenceDigest,
	});
	const factories = new Set(coordination.topology.map((node) => node.factory));
	const transportRequests = underlying.result.requests;
	const material = strictSnapshot({
		schemaVersion: D716_GRAPH_NATIVE_LIVE_QUALIFICATION_SCHEMA,
		claimBoundary: D716_GRAPH_NATIVE_LIVE_CLAIM_BOUNDARY,
		coordinatorRevision: D716_GRAPH_NATIVE_COORDINATOR_REVISION,
		executionClass: "simulated-contract" as const,
		underlyingObservationDigest: empiricalStrictJsonDigest(underlying),
		coordinationEvidenceDigest: coordination.evidenceDigest,
		simulatedTransportRequestCount: transportRequests,
		progressPhases: coordination.progress.map((item) => item.phase),
		gates: {
			exactSixArmOrder:
				coordination.armOrder.join("|") === D716_GRAPH_NATIVE_ARM_ORDER.join("|") &&
				coordination.issuedArms.join("|") === D716_GRAPH_NATIVE_ARM_ORDER.join("|"),
			allSixArmsCompleted:
				coordination.completedArms.join("|") === D716_GRAPH_NATIVE_ARM_ORDER.join("|"),
			warmArmsIndependentOfCold:
				coordination.warmArmsIndependentOfCold && underlying.rerunEligible === false,
			oneActiveArm: boundary.oneActiveArm && coordination.maxActiveArms === 1,
			workItemExecutionRecipeUsed:
				factories.has("workItemExecutionRequestFacts") &&
				factories.has("d716GraphNativeSerialArmScheduler"),
			nonEvaluableColdStillAdvances: boundary.nonEvaluableColdStillAdvances,
			wrongProvenanceRejected: boundary.wrongProvenanceRejected,
			duplicateOrStaleCompletionRejected: boundary.duplicateOrStaleCompletionRejected,
			accessorRejectedBeforeRead: boundary.accessorRejectedBeforeRead,
			failureFactsRemainMaterialFree: coordination.progress.every(
				(item) => item.stoppedReason === null || item.provenanceDigest.startsWith("sha256:"),
			),
			noNetwork: true as const,
			providerCallCount: 0 as const,
			chargedCostMicrousd: 0 as const,
		},
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = strictSnapshot({
		...material,
		evidenceDigest: empiricalStrictJsonDigest(material),
	});
	constructedQualifications.add(qualification);
	brandD716GraphNativeLiveQualification(qualification);
	return qualification;
}

export function validateD716GraphNativeLiveQualification(
	value: unknown,
): D716GraphNativeLiveQualificationV1 {
	const candidate = record(value, "d716.qualification");
	exactKeys(
		candidate,
		[
			"causalAttribution",
			"claimBoundary",
			"coordinationEvidenceDigest",
			"coordinatorRevision",
			"efficacyClaim",
			"evidenceDigest",
			"executionClass",
			"gates",
			"progressPhases",
			"schemaVersion",
			"simulatedTransportRequestCount",
			"underlyingObservationDigest",
		],
		"d716.qualification",
	);
	const snapshot = strictSnapshot(candidate) as unknown as D716GraphNativeLiveQualificationV1;
	if (
		snapshot.schemaVersion !== D716_GRAPH_NATIVE_LIVE_QUALIFICATION_SCHEMA ||
		snapshot.claimBoundary !== D716_GRAPH_NATIVE_LIVE_CLAIM_BOUNDARY ||
		snapshot.coordinatorRevision !== D716_GRAPH_NATIVE_COORDINATOR_REVISION ||
		snapshot.executionClass !== "simulated-contract" ||
		snapshot.causalAttribution !== "undetermined" ||
		snapshot.efficacyClaim !== "none" ||
		snapshot.progressPhases.length !== 6
	) {
		throw new TypeError("D716 qualification coordinates drifted");
	}
	const gates = record(snapshot.gates, "d716.qualification.gates");
	exactKeys(
		gates,
		[
			"accessorRejectedBeforeRead",
			"allSixArmsCompleted",
			"chargedCostMicrousd",
			"duplicateOrStaleCompletionRejected",
			"exactSixArmOrder",
			"failureFactsRemainMaterialFree",
			"noNetwork",
			"nonEvaluableColdStillAdvances",
			"oneActiveArm",
			"providerCallCount",
			"warmArmsIndependentOfCold",
			"workItemExecutionRecipeUsed",
			"wrongProvenanceRejected",
		],
		"d716.qualification.gates",
	);
	if (Object.values(gates).some((item) => item !== true && item !== 0)) {
		throw new TypeError("D716 qualification gate failed");
	}
	if (
		!Number.isSafeInteger(snapshot.simulatedTransportRequestCount) ||
		snapshot.simulatedTransportRequestCount < 0
	) {
		throw new TypeError("D716 simulated transport request count is invalid");
	}
	const { evidenceDigest: _evidenceDigest, ...material } = snapshot;
	if (empiricalStrictJsonDigest(material) !== snapshot.evidenceDigest) {
		throw new TypeError("D716 qualification digest mismatch");
	}
	return snapshot;
}

export function createD716GraphNativeLiveScorecard(
	qualification: D716GraphNativeLiveQualificationV1,
): D716GraphNativeLiveScorecardV1 {
	if (!constructedQualifications.has(qualification as object)) {
		throw new TypeError("D716 scorecard requires a same-process qualification");
	}
	validateD716GraphNativeLiveQualification(qualification);
	const material = strictSnapshot({
		schemaVersion: D716_GRAPH_NATIVE_LIVE_SCORECARD_SCHEMA,
		claimBoundary: D716_GRAPH_NATIVE_LIVE_CLAIM_BOUNDARY,
		qualificationDigest: qualification.evidenceDigest,
		qualified: true,
		completedArmCount: 6,
		evaluableArmCount: qualification.progressPhases.filter((phase) => phase !== "none").length,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const scorecard = strictSnapshot({
		...material,
		scorecardDigest: empiricalStrictJsonDigest(material),
	});
	constructedScorecards.add(scorecard);
	return scorecard;
}

export async function persistD716GraphNativePrivateGeneration(inputValue: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly qualification: D716GraphNativeLiveQualificationV1;
	readonly scorecard: D716GraphNativeLiveScorecardV1;
}): Promise<{
	readonly generationPath: string;
	readonly qualificationDigest: string;
	readonly scorecardDigest: string;
	readonly generationDigest: string;
}> {
	const input = record(inputValue, "d716.persistence");
	exactKeys(
		input,
		["generationRef", "privateRoot", "qualification", "scorecard"],
		"d716.persistence",
	);
	if (
		!constructedQualifications.has(input.qualification as object) ||
		!constructedScorecards.has(input.scorecard as object)
	) {
		throw new TypeError("D716 persistence requires same-process evidence");
	}
	if (
		typeof input.privateRoot !== "string" ||
		typeof input.generationRef !== "string" ||
		!/^[a-z0-9][a-z0-9.-]{0,127}$/.test(input.generationRef)
	) {
		throw new TypeError("D716 persistence coordinates are invalid");
	}
	const privateRoot = input.privateRoot;
	const generationRef = input.generationRef;
	await mkdir(privateRoot, { recursive: true, mode: 0o700 });
	const rootStatus = await lstat(privateRoot);
	if (
		!rootStatus.isDirectory() ||
		rootStatus.isSymbolicLink() ||
		(rootStatus.mode & 0o777) !== 0o700
	) {
		throw new TypeError("D716 private root must be an exact 0700 directory");
	}
	const finalPath = join(privateRoot, generationRef);
	try {
		await lstat(finalPath);
		throw new TypeError("D716 generation already exists");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const qualification = input.qualification as D716GraphNativeLiveQualificationV1;
	const scorecard = input.scorecard as D716GraphNativeLiveScorecardV1;
	const generationMaterial = strictSnapshot({
		schemaVersion: D716_GRAPH_NATIVE_LIVE_GENERATION_SCHEMA,
		generationRef,
		claimBoundary: D716_GRAPH_NATIVE_LIVE_CLAIM_BOUNDARY,
		qualification: { file: "qualification.v1.json", digest: qualification.evidenceDigest },
		scorecard: { file: "scorecard.v1.json", digest: scorecard.scorecardDigest },
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const files = Object.freeze([
		{ file: "qualification.v1.json", bytes: strictJsonCodec.encode(qualification) },
		{ file: "scorecard.v1.json", bytes: strictJsonCodec.encode(scorecard) },
		{ file: "generation.v1.json", bytes: strictJsonCodec.encode(generation) },
	]);
	const stagingPath = join(privateRoot, `.d716-staging-${randomUUID()}`);
	try {
		await mkdir(stagingPath, { mode: 0o700 });
		for (const file of files) await writePrivateFile(join(stagingPath, file.file), file.bytes);
		await syncDirectory(stagingPath);
		for (const file of files) {
			const readback = new Uint8Array(await readFile(join(stagingPath, file.file)));
			if (!Buffer.from(readback).equals(file.bytes)) {
				throw new TypeError(`D716 staging readback failed for ${file.file}`);
			}
		}
		await commitD696PrivateStagingDirectory({ stagingPath, finalPath, privateRoot });
		constructedQualifications.delete(qualification as object);
		deleteD716GraphNativeLiveQualificationBrand(qualification as object);
		constructedScorecards.delete(scorecard as object);
		return Object.freeze({
			generationPath: finalPath,
			qualificationDigest: qualification.evidenceDigest,
			scorecardDigest: scorecard.scorecardDigest,
			generationDigest: generation.generationDigest,
		});
	} catch (error) {
		return failD696PrivateStagingGeneration(stagingPath, error);
	}
}

export type D716QualifiedUnderlyingObservation = EmpiricalTrialBlockObservationV3;
