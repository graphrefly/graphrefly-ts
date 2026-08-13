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
import { D761_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST } from "./d761-public-semantic-validation-qualification.js";
import type { D722CanonicalGraphEvidenceV1 } from "./d767-graph-completion-memory-insight.js";
import { deriveD722CanonicalGraphEvidence } from "./d767-graph-completion-memory-insight.js";
import {
	createD726ArmLocalTerminalProviderPolicy,
	createD761GraphPublicSemanticValidationPolicy,
} from "./d767-graph-native-effect-runtime.js";
import { type D720CallerExecutorV2, runD722GraphNativeEvalCore } from "./d767-graph-native-eval.js";
import { validateD767QualificationBundle } from "./d767-retry-exhaustion-qualification.js";
import {
	D768_BUDGET_LIMITS,
	D768_COORDINATES_DIGEST,
	D768_DECISION_REF,
	D768_DECISION_REVISION,
	D768_EFFECT_CEILINGS,
	D768_GENERATION_REF,
	D768_HISTORICAL_ARTIFACT_SHA256,
	D768_HISTORICAL_BUNDLE_DIGEST,
	D768_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
} from "./d768-coordinates.js";
import { D768_IMPLEMENTATION_MANIFEST_DIGEST } from "./d768-implementation-manifest.js";
import {
	consumeD768ExecutionAuthority,
	type D768ExecutionAuthorityV1,
} from "./d768-single-use-dispatch-claim.js";

export const D768_BUNDLE_SCHEMA = "graphrefly.b112.d768.live-bundle.v1" as const;
export const D768_PERSISTENCE_SCHEMA = "graphrefly.b112.d768.live-persistence.v1" as const;

export interface D768LiveBundleV1 {
	readonly schemaVersion: typeof D768_BUNDLE_SCHEMA;
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
		throw new TypeError("D768 historical artifact bytes are invalid");
	literal(empiricalSha256(bytes), D768_HISTORICAL_ARTIFACT_SHA256, "d768.historical.sha256");
	const bundle = validateD767QualificationBundle(strictJsonCodec.decode(new Uint8Array(bytes)));
	literal(bundle.bundleDigest, D768_HISTORICAL_BUNDLE_DIGEST, "d768.historical.bundle");
	literal(
		bundle.qualification.implementationManifestDigest,
		D768_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
		"d768.historical.implementation",
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

export async function runD768LiveMeasurement(inputValue: {
	readonly historicalBundleBytes: Uint8Array;
	readonly executionAuthority: D768ExecutionAuthorityV1;
	readonly executor: D720CallerExecutorV2;
	readonly pricingReadDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly implementationManifestDigest: string;
	readonly signal: AbortSignal;
}): Promise<D768LiveBundleV1> {
	const input = record(inputValue, "d768.live.input");
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
		"d768.live.input",
	);
	validateHistorical(input.historicalBundleBytes as Uint8Array);
	literal(
		input.implementationManifestDigest,
		D768_IMPLEMENTATION_MANIFEST_DIGEST,
		"d768.live.implementation",
	);
	const authority = consumeD768ExecutionAuthority(input.executionAuthority);
	if (!(input.signal instanceof AbortSignal)) throw new TypeError("D768 signal is invalid");
	const policy = createD761GraphPublicSemanticValidationPolicy();
	const terminalPolicy = createD726ArmLocalTerminalProviderPolicy();
	const core = await runD722GraphNativeEvalCore({
		sourceDigest: empiricalStrictJsonDigest({
			decisionRef: D768_DECISION_REF,
			coordinatesDigest: D768_COORDINATES_DIGEST,
			claimDigest: authority.claim.claimDigest,
		}),
		budgetLimits: D768_BUDGET_LIMITS,
		effectCeilings: D768_EFFECT_CEILINGS,
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
		decisionRef: D768_DECISION_REF,
		decisionRevision: D768_DECISION_REVISION,
		coordinatesDigest: D768_COORDINATES_DIGEST,
		historicalArtifactSha256: D768_HISTORICAL_ARTIFACT_SHA256,
		historicalBundleDigest: D768_HISTORICAL_BUNDLE_DIGEST,
		baselineImplementationManifestDigest: D768_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
		implementationManifestDigest: D768_IMPLEMENTATION_MANIFEST_DIGEST,
		pricingReadDigest: digest(input.pricingReadDigest, "d768.pricingRead"),
		pricingObservationDigest: digest(input.pricingObservationDigest, "d768.pricingObservation"),
		zeroByokObservationDigest: digest(input.zeroByokObservationDigest, "d768.zeroByok"),
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
		generationRef: D768_GENERATION_REF,
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
		schemaVersion: D768_BUNDLE_SCHEMA,
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

export function validateD768LiveBundle(value: unknown): D768LiveBundleV1 {
	const candidate = record(value, "d768.bundle");
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
		"d768.bundle",
	);
	literal(candidate.schemaVersion, D768_BUNDLE_SCHEMA, "d768.bundle.schema");
	const bundleDigest = digest(candidate.bundleDigest, "d768.bundle.digest");
	const material = strictSnapshot({
		schemaVersion: candidate.schemaVersion,
		disposition: candidate.disposition,
		graphEvidence: candidate.graphEvidence,
		qualification: candidate.qualification,
		observation: candidate.observation,
		generation: candidate.generation,
	});
	literal(bundleDigest, empiricalStrictJsonDigest(material), "d768.bundle.digest");
	return strictSnapshot({ ...material, bundleDigest }) as D768LiveBundleV1;
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

export async function persistD768LiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D768LiveBundleV1;
}) {
	const input = record(inputValue, "d768.persist.input");
	exactKeys(input, ["bundle", "privateRoot"], "d768.persist.input");
	const bundle = input.bundle as D768LiveBundleV1;
	if (!constructed.delete(bundle))
		throw new TypeError("D768 persistence requires fresh constructed bundle");
	validateD768LiveBundle(bundle);
	const privateRoot = resolve(input.privateRoot as string);
	if ((await realpath(privateRoot)) !== privateRoot)
		throw new TypeError("D768 private root is not canonical");
	const staging = join(privateRoot, `.tmp-${D768_GENERATION_REF}-${randomUUID()}`);
	const finalRoot = join(privateRoot, D768_GENERATION_REF);
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
			schemaVersion: D768_PERSISTENCE_SCHEMA,
			generationRef: D768_GENERATION_REF,
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
