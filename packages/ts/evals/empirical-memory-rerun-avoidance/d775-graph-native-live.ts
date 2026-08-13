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
import { type D774CallerExecutorV1, runD774GraphNativeEvalCore } from "./d774-graph-native-eval.js";
import { validateD774QualificationBundle } from "./d774-pre-live-qualification.js";
import {
	type D774RouteEvidenceV1,
	validateD774RouteEvidence,
} from "./d774-provider-result-route-authority.js";
import {
	D775_BUDGET_LIMITS,
	D775_COORDINATES_DIGEST,
	D775_DECISION_REF,
	D775_DECISION_REVISION,
	D775_EFFECT_CEILINGS,
	D775_GENERATION_REF,
	D775_HISTORICAL_ARTIFACT_SHA256,
	D775_HISTORICAL_BUNDLE_DIGEST,
	D775_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
} from "./d775-coordinates.js";
import { D775_IMPLEMENTATION_MANIFEST_DIGEST } from "./d775-implementation-manifest.js";
import { evaluateD775ArmAwarePositiveGate } from "./d775-live-positive-gate.js";
import {
	consumeD775ExecutionAuthority,
	type D775ExecutionAuthorityV1,
} from "./d775-single-use-dispatch-claim.js";

export const D775_BUNDLE_SCHEMA = "graphrefly.b112.d775.live-bundle.v1" as const;
export const D775_PERSISTENCE_SCHEMA = "graphrefly.b112.d775.live-persistence.v1" as const;

export interface D775LiveBundleV1 {
	readonly schemaVersion: typeof D775_BUNDLE_SCHEMA;
	readonly disposition: "success" | "partial-failure";
	readonly graphEvidence: D771CanonicalGraphEvidenceV1;
	readonly routeEvidence: D774RouteEvidenceV1;
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
		throw new TypeError("D775 historical artifact bytes are invalid");
	literal(empiricalSha256(bytes), D775_HISTORICAL_ARTIFACT_SHA256, "d775.historical.sha256");
	const bundle = validateD774QualificationBundle(strictJsonCodec.decode(new Uint8Array(bytes)));
	literal(bundle.bundleDigest, D775_HISTORICAL_BUNDLE_DIGEST, "d775.historical.bundle");
	literal(
		bundle.qualification.implementationManifestDigest,
		D775_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
		"d775.historical.implementation",
	);
}

export async function runD775LiveMeasurement(inputValue: {
	readonly historicalBundleBytes: Uint8Array;
	readonly executionAuthority: D775ExecutionAuthorityV1;
	readonly executor: D774CallerExecutorV1;
	readonly pricingReadDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly implementationManifestDigest: string;
	readonly signal: AbortSignal;
}): Promise<D775LiveBundleV1> {
	const input = record(inputValue, "d775.live.input");
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
		"d775.live.input",
	);
	validateHistorical(input.historicalBundleBytes as Uint8Array);
	literal(
		input.implementationManifestDigest,
		D775_IMPLEMENTATION_MANIFEST_DIGEST,
		"d775.live.implementation",
	);
	const authority = consumeD775ExecutionAuthority(input.executionAuthority);
	if (!(input.signal instanceof AbortSignal)) throw new TypeError("D775 signal is invalid");
	const policy = createD761GraphPublicSemanticValidationPolicy();
	const terminalPolicy = createD726ArmLocalTerminalProviderPolicy();
	const sourceDigest = empiricalStrictJsonDigest({
		decisionRef: D775_DECISION_REF,
		coordinatesDigest: D775_COORDINATES_DIGEST,
		claimDigest: authority.claim.claimDigest,
	});
	const core = await runD774GraphNativeEvalCore({
		sourceDigest,
		budgetLimits: D775_BUDGET_LIMITS,
		effectCeilings: D775_EFFECT_CEILINGS,
		executor: input.executor as D774CallerExecutorV1,
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
	const routeEvidence = validateD774RouteEvidence(
		core.routeEvidence,
		providerFacts,
		D775_EFFECT_CEILINGS,
		graphEvidence.ledger.effectReconciliations,
	);
	const gate = evaluateD775ArmAwarePositiveGate(graphEvidence, routeEvidence, sourceDigest);
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
		decisionRef: D775_DECISION_REF,
		decisionRevision: D775_DECISION_REVISION,
		coordinatesDigest: D775_COORDINATES_DIGEST,
		historicalArtifactSha256: D775_HISTORICAL_ARTIFACT_SHA256,
		historicalBundleDigest: D775_HISTORICAL_BUNDLE_DIGEST,
		baselineImplementationManifestDigest: D775_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
		implementationManifestDigest: D775_IMPLEMENTATION_MANIFEST_DIGEST,
		pricingReadDigest: digest(input.pricingReadDigest, "d775.pricingRead"),
		pricingObservationDigest: digest(input.pricingObservationDigest, "d775.pricingObservation"),
		zeroByokObservationDigest: digest(input.zeroByokObservationDigest, "d775.zeroByok"),
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
		generationRef: D775_GENERATION_REF,
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
		generationRef: D775_GENERATION_REF,
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
		schemaVersion: D775_BUNDLE_SCHEMA,
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

export function validateD775LiveBundle(value: unknown): D775LiveBundleV1 {
	const candidate = record(value, "d775.bundle");
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
		"d775.bundle",
	);
	literal(candidate.schemaVersion, D775_BUNDLE_SCHEMA, "d775.bundle.schema");
	const graphCandidate = record(candidate.graphEvidence, "d775.bundle.graphEvidence");
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
		"d775.bundle.graphEvidence.canonicalReplay",
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
	const routeEvidence = validateD774RouteEvidence(
		candidate.routeEvidence,
		providerFacts,
		D775_EFFECT_CEILINGS,
		graphEvidence.ledger.effectReconciliations,
	);
	const qualification = record(candidate.qualification, "d775.bundle.qualification");
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
		"d775.bundle.qualification",
	);
	const { qualificationDigest: qualificationDigestValue, ...qualificationMaterial } = qualification;
	const qualificationDigest = digest(qualificationDigestValue, "d775.bundle.qualification.digest");
	literal(
		qualificationDigest,
		empiricalStrictJsonDigest(qualificationMaterial),
		"d775.bundle.qualification.digest",
	);
	literal(qualification.decisionRef, D775_DECISION_REF, "d775.bundle.qualification.decision");
	literal(
		qualification.implementationManifestDigest,
		D775_IMPLEMENTATION_MANIFEST_DIGEST,
		"d775.bundle.qualification.implementation",
	);
	const expectedSourceDigest = empiricalStrictJsonDigest({
		decisionRef: D775_DECISION_REF,
		coordinatesDigest: D775_COORDINATES_DIGEST,
		claimDigest: digest(qualification.claimDigest, "d775.bundle.qualification.claimDigest"),
	});
	const gate = evaluateD775ArmAwarePositiveGate(graphEvidence, routeEvidence, expectedSourceDigest);
	const observation = record(candidate.observation, "d775.bundle.observation");
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
		"d775.bundle.observation",
	);
	literal(
		empiricalStrictJsonDigest(observation.gate),
		empiricalStrictJsonDigest(gate),
		"d775.bundle.observation.gate",
	);
	const derivedDisposition =
		graphEvidence.runStatus === "complete" &&
		graphEvidence.ledger.completedArms.length === 6 &&
		routeEvidence.coverageComplete &&
		!hasOperationalFailure(graphEvidence)
			? "success"
			: "partial-failure";
	literal(candidate.disposition, derivedDisposition, "d775.bundle.disposition");
	literal(observation.disposition, derivedDisposition, "d775.bundle.observation.disposition");
	literal(
		observation.graphEvidenceDigest,
		graphEvidence.evidenceDigest,
		"d775.bundle.observation.graph",
	);
	literal(
		observation.routeEvidenceDigest,
		routeEvidence.evidenceDigest,
		"d775.bundle.observation.route",
	);
	literal(
		observation.completedArms,
		graphEvidence.ledger.completedArms.length,
		"d775.bundle.observation.arms",
	);
	literal(observation.causalAttribution, "undetermined", "d775.bundle.observation.attribution");
	literal(
		observation.efficacyClaim,
		gate.passed ? "positive-differential-frozen-task-block" : "none",
		"d775.bundle.observation.efficacy",
	);
	const { observationDigest: observationDigestValue, ...observationMaterial } = observation;
	const observationDigest = digest(observationDigestValue, "d775.bundle.observation.digest");
	literal(
		observationDigest,
		empiricalStrictJsonDigest(observationMaterial),
		"d775.bundle.observation.digest",
	);
	const generation = record(candidate.generation, "d775.bundle.generation");
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
		"d775.bundle.generation",
	);
	const { generationDigest, ...generationMaterial } = generation;
	literal(
		generationDigest,
		empiricalStrictJsonDigest(generationMaterial),
		"d775.bundle.generation.digest",
	);
	literal(generation.generationRef, D775_GENERATION_REF, "d775.bundle.generation.ref");
	literal(generation.disposition, derivedDisposition, "d775.bundle.generation.disposition");
	literal(
		generation.qualificationDigest,
		qualificationDigest,
		"d775.bundle.generation.qualification",
	);
	literal(generation.observationDigest, observationDigest, "d775.bundle.generation.observation");
	literal(
		generation.graphEvidenceDigest,
		graphEvidence.evidenceDigest,
		"d775.bundle.generation.graph",
	);
	literal(
		generation.routeEvidenceDigest,
		routeEvidence.evidenceDigest,
		"d775.bundle.generation.route",
	);
	const terminalReceipt = record(candidate.terminalReceipt, "d775.bundle.terminalReceipt");
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
		"d775.bundle.terminalReceipt",
	);
	const { terminalReceiptDigest, ...terminalMaterial } = terminalReceipt;
	literal(
		terminalReceiptDigest,
		empiricalStrictJsonDigest(terminalMaterial),
		"d775.bundle.terminalReceipt.digest",
	);
	literal(
		terminalReceipt.disposition,
		derivedDisposition,
		"d775.bundle.terminalReceipt.disposition",
	);
	literal(
		terminalReceipt.claimDigest,
		digest(qualification.claimDigest, "d775.bundle.qualification.claim"),
		"d775.bundle.terminalReceipt.claim",
	);
	literal(
		terminalReceipt.currentKeyAdmissionDigest,
		digest(qualification.currentKeyAdmissionDigest, "d775.bundle.qualification.currentKey"),
		"d775.bundle.terminalReceipt.currentKey",
	);
	literal(
		terminalReceipt.bundleOutcome,
		derivedDisposition === "success" ? "success-generation" : "partial-graph-evidence",
		"d775.bundle.terminalReceipt.outcome",
	);
	const bundleDigest = digest(candidate.bundleDigest, "d775.bundle.digest");
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
	literal(bundleDigest, empiricalStrictJsonDigest(material), "d775.bundle.digest");
	return strictSnapshot({ ...material, bundleDigest }) as D775LiveBundleV1;
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

export async function persistD775LiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D775LiveBundleV1;
}) {
	const input = record(inputValue, "d775.persist.input");
	exactKeys(input, ["bundle", "privateRoot"], "d775.persist.input");
	const bundle = input.bundle as D775LiveBundleV1;
	if (!constructed.delete(bundle))
		throw new TypeError("D775 persistence requires fresh constructed bundle");
	validateD775LiveBundle(bundle);
	const privateRoot = resolve(input.privateRoot as string);
	if ((await realpath(privateRoot)) !== privateRoot)
		throw new TypeError("D775 private root is not canonical");
	const staging = join(privateRoot, `.tmp-${D775_GENERATION_REF}-${randomUUID()}`);
	const finalRoot = join(privateRoot, D775_GENERATION_REF);
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
			throw new TypeError("D775 published generation identity drifted");
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
					throw new TypeError("D775 published artifact readback drifted");
			} finally {
				await handle.close();
			}
		}
		const receipt = strictSnapshot({
			schemaVersion: D775_PERSISTENCE_SCHEMA,
			generationRef: D775_GENERATION_REF,
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
