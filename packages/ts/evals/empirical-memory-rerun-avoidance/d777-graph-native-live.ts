import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
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
import {
	createD726ArmLocalTerminalProviderPolicy,
	createD761GraphPublicSemanticValidationPolicy,
} from "./d767-graph-native-effect-runtime.js";
import type { D771CanonicalGraphEvidenceV1 } from "./d771-graph-completion-memory-insight.js";
import { deriveD771CanonicalGraphEvidence } from "./d771-graph-completion-memory-insight.js";
import { evaluateD775ArmAwarePositiveGate } from "./d775-live-positive-gate.js";
import { type D776CallerExecutorV1, runD776GraphNativeEvalCore } from "./d776-graph-native-eval.js";
import { validateD776QualificationBundle } from "./d776-pre-live-qualification.js";
import {
	type D776RouteEvidenceV1,
	validateD776RouteEvidence,
} from "./d776-provider-result-route-authority.js";
import {
	D777_BUDGET_LIMITS,
	D777_COORDINATES_DIGEST,
	D777_DECISION_REF,
	D777_DECISION_REVISION,
	D777_EFFECT_CEILINGS,
	D777_GENERATION_REF,
	D777_HISTORICAL_ARTIFACT_SHA256,
	D777_HISTORICAL_BUNDLE_DIGEST,
	D777_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
} from "./d777-coordinates.js";
import { D777_IMPLEMENTATION_MANIFEST_DIGEST } from "./d777-implementation-manifest.js";
import {
	consumeD777ExecutionAuthority,
	type D777ExecutionAuthorityV1,
} from "./d777-single-use-dispatch-claim.js";

export const D777_BUNDLE_SCHEMA = "graphrefly.b112.d777.live-bundle.v1" as const;
export const D777_PERSISTENCE_SCHEMA = "graphrefly.b112.d777.live-persistence.v1" as const;

export interface D777LiveBundleV1 {
	readonly schemaVersion: typeof D777_BUNDLE_SCHEMA;
	readonly disposition: "success" | "partial-failure";
	readonly graphEvidence: D771CanonicalGraphEvidenceV1;
	readonly routeEvidence: D776RouteEvidenceV1;
	readonly qualification: Readonly<Record<string, unknown>>;
	readonly observation: Readonly<Record<string, unknown>>;
	readonly generation: Readonly<Record<string, unknown>>;
	readonly terminalReceipt: Readonly<Record<string, unknown>>;
	readonly bundleDigest: string;
}

const constructed = new WeakSet<object>();

function hasOperationalFailure(graphEvidence: D771CanonicalGraphEvidenceV1): boolean {
	return graphEvidence.effectRuns.some(
		(run) =>
			run.runtimeStatus !== "complete" ||
			run.facts.some((fact) => {
				if (fact.kind !== "graph-effect-result-admitted") return false;
				const result = fact.result;
				if (result.effectKind === "provider-request") return result.status === "terminal-failure";
				if (result.effectKind === "materialization" || result.effectKind === "retry-wait")
					return result.status === "failed";
				if (result.effectKind === "tool-action" || result.effectKind === "cleanup")
					return result.status === "failed";
				if (result.effectKind === "public-semantic-validation")
					return result.status === "executor-failed";
				return false;
			}),
	);
}

function validateHistorical(bytes: Uint8Array): void {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 16 * 1_048_576)
		throw new TypeError("D777 historical artifact bytes are invalid");
	literal(empiricalSha256(bytes), D777_HISTORICAL_ARTIFACT_SHA256, "d777.historical.sha256");
	const bundle = validateD776QualificationBundle(strictJsonCodec.decode(new Uint8Array(bytes)));
	literal(bundle.bundleDigest, D777_HISTORICAL_BUNDLE_DIGEST, "d777.historical.bundle");
	literal(
		bundle.qualification.implementationManifestDigest,
		D777_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
		"d777.historical.implementation",
	);
}

export async function runD777LiveMeasurement(inputValue: {
	readonly historicalBundleBytes: Uint8Array;
	readonly executionAuthority: D777ExecutionAuthorityV1;
	readonly executor: D776CallerExecutorV1;
	readonly pricingReadDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly implementationManifestDigest: string;
	readonly signal: AbortSignal;
}): Promise<D777LiveBundleV1> {
	const input = record(inputValue, "d777.live.input");
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
		"d777.live.input",
	);
	validateHistorical(input.historicalBundleBytes as Uint8Array);
	literal(
		input.implementationManifestDigest,
		D777_IMPLEMENTATION_MANIFEST_DIGEST,
		"d777.live.implementation",
	);
	const authority = consumeD777ExecutionAuthority(input.executionAuthority);
	if (!(input.signal instanceof AbortSignal)) throw new TypeError("D777 signal is invalid");
	const policy = createD761GraphPublicSemanticValidationPolicy();
	const terminalPolicy = createD726ArmLocalTerminalProviderPolicy();
	const sourceDigest = empiricalStrictJsonDigest({
		decisionRef: D777_DECISION_REF,
		coordinatesDigest: D777_COORDINATES_DIGEST,
		claimDigest: authority.claim.claimDigest,
	});
	const core = await runD776GraphNativeEvalCore({
		sourceDigest,
		budgetLimits: D777_BUDGET_LIMITS,
		effectCeilings: D777_EFFECT_CEILINGS,
		executor: input.executor as D776CallerExecutorV1,
		armLocalTerminalPolicy: terminalPolicy,
		objectivePhaseRecoveryPolicy: policy,
		signal: input.signal as AbortSignal,
	});
	const graphEvidence = deriveD771CanonicalGraphEvidence(
		core.ledger,
		core.effectRuns,
		terminalPolicy,
		policy,
	);
	const providerFacts = graphEvidence.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) =>
			fact.kind === "graph-effect-result-admitted" &&
			fact.request.effectKind === "provider-request" &&
			fact.result.effectKind === "provider-request" &&
			fact.result.failureProvenance !== "executor-failure"
				? [fact as unknown as Readonly<Record<string, unknown>>]
				: [],
		),
	);
	const routeEvidence = validateD776RouteEvidence(
		core.routeEvidence,
		providerFacts,
		D777_EFFECT_CEILINGS,
		graphEvidence.ledger.effectReconciliations,
	);
	const gate = evaluateD775ArmAwarePositiveGate(
		graphEvidence,
		routeEvidence as never,
		sourceDigest,
	);
	const efficacyClaim = gate.passed
		? ("positive-differential-frozen-task-block" as const)
		: ("none" as const);
	const disposition =
		graphEvidence.runStatus === "complete" &&
		graphEvidence.ledger.completedArms.length === 6 &&
		routeEvidence.coverageComplete &&
		!hasOperationalFailure(graphEvidence)
			? ("success" as const)
			: ("partial-failure" as const);
	const qualificationMaterial = strictSnapshot({
		decisionRef: D777_DECISION_REF,
		decisionRevision: D777_DECISION_REVISION,
		coordinatesDigest: D777_COORDINATES_DIGEST,
		historicalArtifactSha256: D777_HISTORICAL_ARTIFACT_SHA256,
		historicalBundleDigest: D777_HISTORICAL_BUNDLE_DIGEST,
		baselineImplementationManifestDigest: D777_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
		implementationManifestDigest: D777_IMPLEMENTATION_MANIFEST_DIGEST,
		pricingReadDigest: digest(input.pricingReadDigest, "d777.pricingRead"),
		pricingObservationDigest: digest(input.pricingObservationDigest, "d777.pricingObservation"),
		zeroByokObservationDigest: digest(input.zeroByokObservationDigest, "d777.zeroByok"),
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
		routeEvidenceDigest: routeEvidence.evidenceDigest,
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
		generationRef: D777_GENERATION_REF,
		disposition,
		qualificationDigest: qualification.qualificationDigest,
		observationDigest: observation.observationDigest,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		routeEvidenceDigest: routeEvidence.evidenceDigest,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const terminalMaterial = strictSnapshot({
		generationRef: D777_GENERATION_REF,
		disposition,
		claimDigest: authority.claim.claimDigest,
		currentKeyAdmissionDigest: authority.currentKeyAdmission.admissionDigest,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		routeEvidenceDigest: routeEvidence.evidenceDigest,
		bundleOutcome: disposition === "success" ? "success-generation" : "partial-graph-evidence",
	});
	const terminalReceipt = strictSnapshot({
		...terminalMaterial,
		terminalReceiptDigest: empiricalStrictJsonDigest(terminalMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D777_BUNDLE_SCHEMA,
		disposition,
		graphEvidence,
		routeEvidence,
		qualification,
		observation,
		generation,
		terminalReceipt,
	});
	const bundle = Object.freeze({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
	constructed.add(bundle);
	return bundle;
}

export function validateD777LiveBundle(value: unknown): D777LiveBundleV1 {
	const candidate = record(value, "d777.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"disposition",
			"generation",
			"graphEvidence",
			"routeEvidence",
			"observation",
			"qualification",
			"schemaVersion",
			"terminalReceipt",
		],
		"d777.bundle",
	);
	literal(candidate.schemaVersion, D777_BUNDLE_SCHEMA, "d777.bundle.schema");
	const graphCandidate = record(candidate.graphEvidence, "d777.bundle.graphEvidence");
	const policy = createD761GraphPublicSemanticValidationPolicy();
	const terminalPolicy = createD726ArmLocalTerminalProviderPolicy();
	const graphEvidence = deriveD771CanonicalGraphEvidence(
		graphCandidate.ledger as never,
		graphCandidate.effectRuns as never,
		terminalPolicy,
		policy,
	);
	literal(
		empiricalStrictJsonDigest(graphCandidate),
		empiricalStrictJsonDigest(graphEvidence),
		"d777.bundle.graphEvidence.canonicalReplay",
	);
	const providerFacts = graphEvidence.effectRuns.flatMap((run) =>
		run.facts.flatMap((fact) =>
			fact.kind === "graph-effect-result-admitted" &&
			fact.request.effectKind === "provider-request" &&
			fact.result.effectKind === "provider-request" &&
			fact.result.failureProvenance !== "executor-failure"
				? [fact as unknown as Readonly<Record<string, unknown>>]
				: [],
		),
	);
	const routeEvidence = validateD776RouteEvidence(
		candidate.routeEvidence,
		providerFacts,
		D777_EFFECT_CEILINGS,
		graphEvidence.ledger.effectReconciliations,
	);
	const qualification = record(candidate.qualification, "d777.bundle.qualification");
	exactKeys(
		qualification,
		[
			"baselineImplementationManifestDigest",
			"claimDigest",
			"coordinatesDigest",
			"currentKeyAdmissionDigest",
			"decisionRef",
			"decisionRevision",
			"historicalArtifactSha256",
			"historicalBundleDigest",
			"implementationManifestDigest",
			"pricingObservationDigest",
			"pricingReadDigest",
			"qualificationDigest",
			"zeroByokObservationDigest",
		],
		"d777.bundle.qualification",
	);
	const { qualificationDigest: qualificationDigestValue, ...qualificationMaterial } = qualification;
	const qualificationDigest = digest(qualificationDigestValue, "d777.bundle.qualification.digest");
	literal(
		qualificationDigest,
		empiricalStrictJsonDigest(qualificationMaterial),
		"d777.bundle.qualification.digest",
	);
	literal(qualification.decisionRef, D777_DECISION_REF, "d777.bundle.qualification.decision");
	literal(
		qualification.implementationManifestDigest,
		D777_IMPLEMENTATION_MANIFEST_DIGEST,
		"d777.bundle.qualification.implementation",
	);
	const expectedSourceDigest = empiricalStrictJsonDigest({
		decisionRef: D777_DECISION_REF,
		coordinatesDigest: D777_COORDINATES_DIGEST,
		claimDigest: digest(qualification.claimDigest, "d777.bundle.qualification.claimDigest"),
	});
	const gate = evaluateD775ArmAwarePositiveGate(
		graphEvidence,
		routeEvidence as never,
		expectedSourceDigest,
	);
	const observation = record(candidate.observation, "d777.bundle.observation");
	exactKeys(
		observation,
		[
			"causalAttribution",
			"completedArms",
			"disposition",
			"efficacyClaim",
			"gate",
			"graphEvidenceDigest",
			"observationDigest",
			"routeEvidenceDigest",
		],
		"d777.bundle.observation",
	);
	literal(
		empiricalStrictJsonDigest(observation.gate),
		empiricalStrictJsonDigest(gate),
		"d777.bundle.observation.gate",
	);
	const derivedDisposition =
		graphEvidence.runStatus === "complete" &&
		graphEvidence.ledger.completedArms.length === 6 &&
		routeEvidence.coverageComplete &&
		!hasOperationalFailure(graphEvidence)
			? "success"
			: "partial-failure";
	literal(candidate.disposition, derivedDisposition, "d777.bundle.disposition");
	literal(observation.disposition, derivedDisposition, "d777.bundle.observation.disposition");
	literal(
		observation.graphEvidenceDigest,
		graphEvidence.evidenceDigest,
		"d777.bundle.observation.graph",
	);
	literal(
		observation.routeEvidenceDigest,
		routeEvidence.evidenceDigest,
		"d777.bundle.observation.route",
	);
	literal(
		observation.completedArms,
		graphEvidence.ledger.completedArms.length,
		"d777.bundle.observation.arms",
	);
	literal(observation.causalAttribution, "undetermined", "d777.bundle.observation.attribution");
	literal(
		observation.efficacyClaim,
		gate.passed ? "positive-differential-frozen-task-block" : "none",
		"d777.bundle.observation.efficacy",
	);
	const { observationDigest: observationDigestValue, ...observationMaterial } = observation;
	const observationDigest = digest(observationDigestValue, "d777.bundle.observation.digest");
	literal(
		observationDigest,
		empiricalStrictJsonDigest(observationMaterial),
		"d777.bundle.observation.digest",
	);
	const generation = record(candidate.generation, "d777.bundle.generation");
	exactKeys(
		generation,
		[
			"disposition",
			"generationDigest",
			"generationRef",
			"graphEvidenceDigest",
			"observationDigest",
			"qualificationDigest",
			"routeEvidenceDigest",
		],
		"d777.bundle.generation",
	);
	const { generationDigest, ...generationMaterial } = generation;
	literal(
		generationDigest,
		empiricalStrictJsonDigest(generationMaterial),
		"d777.bundle.generation.digest",
	);
	literal(generation.generationRef, D777_GENERATION_REF, "d777.bundle.generation.ref");
	literal(generation.disposition, derivedDisposition, "d777.bundle.generation.disposition");
	literal(
		generation.qualificationDigest,
		qualificationDigest,
		"d777.bundle.generation.qualification",
	);
	literal(generation.observationDigest, observationDigest, "d777.bundle.generation.observation");
	literal(
		generation.graphEvidenceDigest,
		graphEvidence.evidenceDigest,
		"d777.bundle.generation.graph",
	);
	literal(
		generation.routeEvidenceDigest,
		routeEvidence.evidenceDigest,
		"d777.bundle.generation.route",
	);
	const terminalReceipt = record(candidate.terminalReceipt, "d777.bundle.terminalReceipt");
	exactKeys(
		terminalReceipt,
		[
			"bundleOutcome",
			"claimDigest",
			"currentKeyAdmissionDigest",
			"disposition",
			"generationRef",
			"graphEvidenceDigest",
			"routeEvidenceDigest",
			"terminalReceiptDigest",
		],
		"d777.bundle.terminalReceipt",
	);
	const { terminalReceiptDigest, ...terminalMaterial } = terminalReceipt;
	literal(
		terminalReceiptDigest,
		empiricalStrictJsonDigest(terminalMaterial),
		"d777.bundle.terminalReceipt.digest",
	);
	literal(
		terminalReceipt.disposition,
		derivedDisposition,
		"d777.bundle.terminalReceipt.disposition",
	);
	literal(
		terminalReceipt.claimDigest,
		digest(qualification.claimDigest, "d777.bundle.qualification.claim"),
		"d777.bundle.terminalReceipt.claim",
	);
	literal(
		terminalReceipt.currentKeyAdmissionDigest,
		digest(qualification.currentKeyAdmissionDigest, "d777.bundle.qualification.currentKey"),
		"d777.bundle.terminalReceipt.currentKey",
	);
	literal(
		terminalReceipt.bundleOutcome,
		derivedDisposition === "success" ? "success-generation" : "partial-graph-evidence",
		"d777.bundle.terminalReceipt.outcome",
	);
	const bundleDigest = digest(candidate.bundleDigest, "d777.bundle.digest");
	const material = strictSnapshot({
		schemaVersion: candidate.schemaVersion,
		disposition: candidate.disposition,
		graphEvidence,
		routeEvidence,
		qualification,
		observation,
		generation,
		terminalReceipt,
	});
	literal(bundleDigest, empiricalStrictJsonDigest(material), "d777.bundle.digest");
	return strictSnapshot({ ...material, bundleDigest }) as D777LiveBundleV1;
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

export async function persistD777LiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D777LiveBundleV1;
}) {
	const input = record(inputValue, "d777.persist.input");
	exactKeys(input, ["bundle", "privateRoot"], "d777.persist.input");
	const bundle = input.bundle as D777LiveBundleV1;
	if (!constructed.delete(bundle))
		throw new TypeError("D777 persistence requires fresh constructed bundle");
	validateD777LiveBundle(bundle);
	const privateRoot = resolve(input.privateRoot as string);
	if ((await realpath(privateRoot)) !== privateRoot)
		throw new TypeError("D777 private root is not canonical");
	const staging = join(privateRoot, `.tmp-${D777_GENERATION_REF}-${randomUUID()}`);
	const finalRoot = join(privateRoot, D777_GENERATION_REF);
	await mkdir(staging, { mode: 0o700 });
	const stagingStat = await lstat(staging);
	let published = false;
	try {
		const artifacts = join(staging, "artifacts");
		await mkdir(artifacts, { mode: 0o700 });
		const files = {
			"graph-evidence.v1.json": strictJsonCodec.encode(bundle.graphEvidence),
			"route-evidence.v1.json": strictJsonCodec.encode(bundle.routeEvidence),
			"qualification.v1.json": strictJsonCodec.encode(bundle.qualification),
			"observation.v1.json": strictJsonCodec.encode(bundle.observation),
			[bundle.disposition === "success"
				? "success-generation.v1.json"
				: "partial-graph-generation.v1.json"]: strictJsonCodec.encode(bundle.generation),
			"terminal-receipt.v1.json": strictJsonCodec.encode(bundle.terminalReceipt),
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
		published = true;
		const finalStat = await lstat(finalRoot);
		if (
			!finalStat.isDirectory() ||
			finalStat.isSymbolicLink() ||
			finalStat.dev !== stagingStat.dev ||
			finalStat.ino !== stagingStat.ino
		)
			throw new TypeError("D777 published generation identity drifted");
		await syncDirectory(privateRoot);
		for (const [name, bytes] of Object.entries(files)) {
			const handle = await open(
				join(finalRoot, "artifacts", name),
				constants.O_RDONLY | constants.O_NOFOLLOW,
			);
			try {
				const stat = await handle.stat();
				const readback = new Uint8Array(await handle.readFile());
				if (
					!stat.isFile() ||
					stat.nlink !== 1 ||
					(stat.mode & 0o777) !== 0o600 ||
					readback.byteLength !== bytes.byteLength ||
					readback.some((value, index) => value !== bytes[index])
				)
					throw new TypeError("D777 published artifact readback drifted");
			} finally {
				await handle.close();
			}
		}
		const receipt = strictSnapshot({
			schemaVersion: D777_PERSISTENCE_SCHEMA,
			generationRef: D777_GENERATION_REF,
			bundleArtifactDigest: empiricalSha256(files["bundle.v1.json"]),
			bundleDigest: bundle.bundleDigest,
			generationDigest: bundle.generation.generationDigest,
			terminalReceiptDigest: bundle.terminalReceipt.terminalReceiptDigest,
		});
		return strictSnapshot({ ...receipt, persistenceDigest: empiricalStrictJsonDigest(receipt) });
	} catch (error) {
		const ownedPath = published ? finalRoot : staging;
		const current = await lstat(ownedPath).catch(() => null);
		if (
			current?.isDirectory() &&
			!current.isSymbolicLink() &&
			current.dev === stagingStat.dev &&
			current.ino === stagingStat.ino
		)
			await rm(ownedPath, { recursive: true, force: true });
		throw error;
	}
}
