import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	strictSnapshot,
} from "./canonical.js";
import type { D722CanonicalGraphEvidenceV1 } from "./d761-graph-completion-memory-insight.js";
import { deriveD722CanonicalGraphEvidence } from "./d761-graph-completion-memory-insight.js";
import {
	createD726ArmLocalTerminalProviderPolicy,
	createD761GraphPublicSemanticValidationPolicy,
} from "./d761-graph-native-effect-runtime.js";
import { type D720CallerExecutorV2, runD722GraphNativeEvalCore } from "./d761-graph-native-eval.js";
import {
	D761_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
	validateD761QualificationBundle,
} from "./d761-public-semantic-validation-qualification.js";
import {
	D766_BUDGET_LIMITS,
	D766_COORDINATES_DIGEST,
	D766_DECISION_REF,
	D766_DECISION_REVISION,
	D766_EFFECT_CEILINGS,
	D766_GENERATION_REF,
	D766_HISTORICAL_ARTIFACT_SHA256,
	D766_HISTORICAL_BUNDLE_DIGEST,
	D766_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
} from "./d766-coordinates.js";
import {
	consumeD766ExecutionAuthority,
	type D766ExecutionAuthorityV1,
} from "./d766-single-use-dispatch-claim.js";

export const D766_BUNDLE_SCHEMA = "graphrefly.b112.d766.live-bundle.v1" as const;
export const D766_PERSISTENCE_SCHEMA = "graphrefly.b112.d766.live-persistence.v1" as const;

export interface D766LiveBundleV1 {
	readonly schemaVersion: typeof D766_BUNDLE_SCHEMA;
	readonly disposition: "success" | "partial-failure";
	readonly graphEvidence: D722CanonicalGraphEvidenceV1;
	readonly qualification: Readonly<Record<string, unknown>>;
	readonly observation: Readonly<Record<string, unknown>>;
	readonly generation: Readonly<Record<string, unknown>>;
	readonly bundleDigest: string;
}

const constructed = new WeakSet<object>();

function validateHistorical(bytes: Uint8Array): void {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 16 * 1_048_576)
		throw new TypeError("D766 historical artifact bytes are invalid");
	literal(empiricalSha256(bytes), D766_HISTORICAL_ARTIFACT_SHA256, "d766.historical.sha256");
	const bundle = validateD761QualificationBundle(strictJsonCodec.decode(new Uint8Array(bytes)));
	literal(bundle.bundleDigest, D766_HISTORICAL_BUNDLE_DIGEST, "d766.historical.bundle");
	literal(
		bundle.qualification.implementationManifestDigest,
		D766_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
		"d766.historical.implementation",
	);
}

function admitted(run: D722CanonicalGraphEvidenceV1["effectRuns"][number]) {
	return run.facts.filter((fact) => fact.kind === "graph-effect-result-admitted");
}

function evaluatePositiveDifferentialGate(graph: D722CanonicalGraphEvidenceV1) {
	const arms = [
		"cold",
		"relevant-applied",
		"proposal-only",
		"admission-rejected",
		"irrelevant-applied",
		"wrong-scope-applied",
	] as const;
	const expectedHidden = ["failed", "passed", "failed", "failed", "failed", "failed"] as const;
	const failures: string[] = [];
	if (
		graph.runStatus !== "complete" ||
		graph.effectRuns.length !== 6 ||
		graph.ledger.completedArms.join(",") !== arms.join(",")
	)
		failures.push("six-arm-horizon-not-complete");
	for (const [index, arm] of arms.entries()) {
		const run = graph.effectRuns[index];
		if (run === undefined) {
			failures.push(`${arm}:missing-run`);
			continue;
		}
		const facts = admitted(run);
		const semantic = facts.filter(
			(fact) => fact.result.effectKind === "public-semantic-validation",
		);
		const hidden = facts.filter((fact) => fact.result.effectKind === "hidden-verifier");
		const cleanup = facts.filter((fact) => fact.result.effectKind === "cleanup");
		const correctionContexts = new Set(
			facts.flatMap((fact) =>
				fact.request.completionContext?.reason === "public-semantic-validation-failed"
					? [fact.request.completionContext.contextDigest]
					: [],
			),
		);
		const providerFailures = facts.filter(
			(fact) =>
				fact.result.effectKind === "provider-request" &&
				(fact.result.status === "terminal-failure" || fact.result.status === "retryable-failure"),
		);
		if (
			run.runtimeStatus !== "complete" ||
			semantic.length !== 2 ||
			semantic[0]?.result.effectKind !== "public-semantic-validation" ||
			semantic[0].result.status !== "failed" ||
			semantic[1]?.result.effectKind !== "public-semantic-validation" ||
			semantic[1].result.status !== "passed" ||
			correctionContexts.size !== 1 ||
			hidden.length !== 1 ||
			hidden[0]?.result.effectKind !== "hidden-verifier" ||
			hidden[0].result.status !== expectedHidden[index] ||
			cleanup.length !== 1 ||
			cleanup[0]?.result.effectKind !== "cleanup" ||
			cleanup[0].result.status !== "succeeded" ||
			providerFailures.length !== 0
		)
			failures.push(`${arm}:required-differential-not-observed`);
	}
	if (
		graph.ledger.effectAdmissions.filter((value) => value.admitted).length !==
		graph.ledger.effectReconciliations.length
	)
		failures.push("accounting-not-exact");
	return strictSnapshot({
		gateDefinitionDigest: D761_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
		passed: failures.length === 0,
		failureCodes: failures,
	});
}

export async function runD766LiveMeasurement(inputValue: {
	readonly historicalBundleBytes: Uint8Array;
	readonly executionAuthority: D766ExecutionAuthorityV1;
	readonly executor: D720CallerExecutorV2;
	readonly pricingReadDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly implementationManifestDigest: string;
	readonly signal: AbortSignal;
}): Promise<D766LiveBundleV1> {
	const input = record(inputValue, "d766.live.input");
	exactKeys(
		input,
		[
			"executionAuthority",
			"executor",
			"historicalBundleBytes",
			"implementationManifestDigest",
			"pricingObservationDigest",
			"pricingReadDigest",
			"signal",
			"zeroByokObservationDigest",
		],
		"d766.live.input",
	);
	validateHistorical(input.historicalBundleBytes as Uint8Array);
	literal(
		input.implementationManifestDigest,
		D766_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
		"d766.live.implementation",
	);
	const authority = consumeD766ExecutionAuthority(input.executionAuthority);
	if (!(input.signal instanceof AbortSignal)) throw new TypeError("D766 signal is invalid");
	const policy = createD761GraphPublicSemanticValidationPolicy();
	const terminalPolicy = createD726ArmLocalTerminalProviderPolicy();
	const core = await runD722GraphNativeEvalCore({
		sourceDigest: empiricalStrictJsonDigest({
			decisionRef: D766_DECISION_REF,
			coordinatesDigest: D766_COORDINATES_DIGEST,
			claimDigest: authority.claim.claimDigest,
		}),
		budgetLimits: D766_BUDGET_LIMITS,
		effectCeilings: D766_EFFECT_CEILINGS,
		executor: input.executor as D720CallerExecutorV2,
		armLocalTerminalPolicy: terminalPolicy,
		objectivePhaseRecoveryPolicy: policy,
		signal: input.signal as AbortSignal,
	});
	const graphEvidence = deriveD722CanonicalGraphEvidence(
		core.ledger,
		core.effectRuns,
		terminalPolicy,
		policy,
	);
	const gate = evaluatePositiveDifferentialGate(graphEvidence);
	const efficacyClaim = gate.passed
		? ("positive-differential-frozen-task-block" as const)
		: ("none" as const);
	const disposition =
		graphEvidence.runStatus === "complete" && graphEvidence.ledger.completedArms.length === 6
			? ("success" as const)
			: ("partial-failure" as const);
	const qualificationMaterial = strictSnapshot({
		decisionRef: D766_DECISION_REF,
		decisionRevision: D766_DECISION_REVISION,
		coordinatesDigest: D766_COORDINATES_DIGEST,
		historicalArtifactSha256: D766_HISTORICAL_ARTIFACT_SHA256,
		historicalBundleDigest: D766_HISTORICAL_BUNDLE_DIGEST,
		implementationManifestDigest: D766_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
		pricingReadDigest: digest(input.pricingReadDigest, "d766.pricingRead"),
		pricingObservationDigest: digest(input.pricingObservationDigest, "d766.pricingObservation"),
		zeroByokObservationDigest: digest(input.zeroByokObservationDigest, "d766.zeroByok"),
		claimDigest: authority.claim.claimDigest,
		currentKeyAdmissionDigest: authority.currentKeyAdmission.admissionDigest,
	});
	const qualification = strictSnapshot({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const observationMaterial = strictSnapshot({
		disposition,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		completedArms: graphEvidence.ledger.completedArms.length,
		gate,
		causalAttribution: "undetermined" as const,
		efficacyClaim,
	});
	const observation = strictSnapshot({
		...observationMaterial,
		observationDigest: empiricalStrictJsonDigest(observationMaterial),
	});
	const generationMaterial = strictSnapshot({
		generationRef: D766_GENERATION_REF,
		disposition,
		qualificationDigest: qualification.qualificationDigest,
		observationDigest: observation.observationDigest,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D766_BUNDLE_SCHEMA,
		disposition,
		graphEvidence,
		qualification,
		observation,
		generation,
	});
	const bundle = Object.freeze({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
	constructed.add(bundle);
	return bundle;
}

export function validateD766LiveBundle(value: unknown): D766LiveBundleV1 {
	const candidate = record(value, "d766.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"disposition",
			"generation",
			"graphEvidence",
			"observation",
			"qualification",
			"schemaVersion",
		],
		"d766.bundle",
	);
	literal(candidate.schemaVersion, D766_BUNDLE_SCHEMA, "d766.bundle.schema");
	const bundleDigest = digest(candidate.bundleDigest, "d766.bundle.digest");
	const material = strictSnapshot({
		schemaVersion: candidate.schemaVersion,
		disposition: candidate.disposition,
		graphEvidence: candidate.graphEvidence,
		qualification: candidate.qualification,
		observation: candidate.observation,
		generation: candidate.generation,
	});
	literal(bundleDigest, empiricalStrictJsonDigest(material), "d766.bundle.digest");
	return strictSnapshot({ ...material, bundleDigest }) as D766LiveBundleV1;
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(
		path,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

export async function persistD766LiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D766LiveBundleV1;
}) {
	const input = record(inputValue, "d766.persist.input");
	exactKeys(input, ["bundle", "privateRoot"], "d766.persist.input");
	const bundle = input.bundle as D766LiveBundleV1;
	if (!constructed.delete(bundle))
		throw new TypeError("D766 persistence requires fresh constructed bundle");
	validateD766LiveBundle(bundle);
	const privateRoot = resolve(input.privateRoot as string);
	if ((await realpath(privateRoot)) !== privateRoot)
		throw new TypeError("D766 private root is not canonical");
	const staging = join(privateRoot, `.tmp-${D766_GENERATION_REF}-${randomUUID()}`);
	const finalRoot = join(privateRoot, D766_GENERATION_REF);
	await mkdir(staging, { mode: 0o700 });
	try {
		const artifacts = join(staging, "artifacts");
		await mkdir(artifacts, { mode: 0o700 });
		const files = {
			"graph-evidence.v1.json": strictJsonCodec.encode(bundle.graphEvidence),
			"qualification.v1.json": strictJsonCodec.encode(bundle.qualification),
			"observation.v1.json": strictJsonCodec.encode(bundle.observation),
			"generation.v1.json": strictJsonCodec.encode(bundle.generation),
			"bundle.v1.json": strictJsonCodec.encode(bundle),
		};
		for (const [name, bytes] of Object.entries(files)) {
			const handle = await open(
				join(artifacts, name),
				constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
				0o600,
			);
			try {
				await handle.writeFile(bytes);
				await handle.sync();
			} finally {
				await handle.close();
			}
		}
		await syncDirectory(artifacts);
		await syncDirectory(staging);
		await rename(staging, finalRoot);
		await syncDirectory(privateRoot);
		const receipt = strictSnapshot({
			schemaVersion: D766_PERSISTENCE_SCHEMA,
			generationRef: D766_GENERATION_REF,
			bundleArtifactDigest: empiricalSha256(files["bundle.v1.json"]),
			bundleDigest: bundle.bundleDigest,
			generationDigest: bundle.generation.generationDigest,
		});
		return strictSnapshot({ ...receipt, persistenceDigest: empiricalStrictJsonDigest(receipt) });
	} catch (error) {
		await rm(staging, { recursive: true, force: true }).catch(() => undefined);
		throw error;
	}
}
