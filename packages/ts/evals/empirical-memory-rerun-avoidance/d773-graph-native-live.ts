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
import { type D720CallerExecutorV2, runD722GraphNativeEvalCore } from "./d767-graph-native-eval.js";
import type { D771CanonicalGraphEvidenceV1 } from "./d771-graph-completion-memory-insight.js";
import { deriveD771CanonicalGraphEvidence } from "./d771-graph-completion-memory-insight.js";
import { validateD771QualificationBundle } from "./d771-pre-live-qualification.js";
import {
	D773_BUDGET_LIMITS,
	D773_COORDINATES_DIGEST,
	D773_DECISION_REF,
	D773_DECISION_REVISION,
	D773_EFFECT_CEILINGS,
	D773_GENERATION_REF,
	D773_HISTORICAL_ARTIFACT_SHA256,
	D773_HISTORICAL_BUNDLE_DIGEST,
	D773_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
} from "./d773-coordinates.js";
import { D773_IMPLEMENTATION_MANIFEST_DIGEST } from "./d773-implementation-manifest.js";
import { evaluateD773ArmAwarePositiveGate } from "./d773-live-positive-gate.js";
import {
	admitD773LiveRouteProposal,
	createD773LiveRouteAuthority,
	type D773LiveRouteEvidenceV1,
	snapshotD773LiveRouteEvidence,
	takeD773LiveRouteProposal,
	validateD773LiveRouteEvidence,
} from "./d773-live-route-authority.js";
import {
	consumeD773ExecutionAuthority,
	type D773ExecutionAuthorityV1,
} from "./d773-single-use-dispatch-claim.js";

export const D773_BUNDLE_SCHEMA = "graphrefly.b112.d773.live-bundle.v1" as const;
export const D773_PERSISTENCE_SCHEMA = "graphrefly.b112.d773.live-persistence.v1" as const;

export interface D773LiveBundleV1 {
	readonly schemaVersion: typeof D773_BUNDLE_SCHEMA;
	readonly disposition: "success" | "partial-failure";
	readonly graphEvidence: D771CanonicalGraphEvidenceV1;
	readonly routeEvidence: D773LiveRouteEvidenceV1;
	readonly qualification: Readonly<Record<string, unknown>>;
	readonly observation: Readonly<Record<string, unknown>>;
	readonly generation: Readonly<Record<string, unknown>>;
	readonly terminalReceipt: Readonly<Record<string, unknown>>;
	readonly bundleDigest: string;
}

const constructed = new WeakSet<object>();

function validateHistorical(bytes: Uint8Array): void {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 16 * 1_048_576)
		throw new TypeError("D773 historical artifact bytes are invalid");
	literal(empiricalSha256(bytes), D773_HISTORICAL_ARTIFACT_SHA256, "d773.historical.sha256");
	const bundle = validateD771QualificationBundle(strictJsonCodec.decode(new Uint8Array(bytes)));
	literal(bundle.bundleDigest, D773_HISTORICAL_BUNDLE_DIGEST, "d773.historical.bundle");
	literal(
		bundle.qualification.implementationManifestDigest,
		D773_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
		"d773.historical.implementation",
	);
}

export async function runD773LiveMeasurement(inputValue: {
	readonly historicalBundleBytes: Uint8Array;
	readonly executionAuthority: D773ExecutionAuthorityV1;
	readonly executor: D720CallerExecutorV2;
	readonly pricingReadDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly implementationManifestDigest: string;
	readonly signal: AbortSignal;
}): Promise<D773LiveBundleV1> {
	const input = record(inputValue, "d773.live.input");
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
		"d773.live.input",
	);
	validateHistorical(input.historicalBundleBytes as Uint8Array);
	literal(
		input.implementationManifestDigest,
		D773_IMPLEMENTATION_MANIFEST_DIGEST,
		"d773.live.implementation",
	);
	const authority = consumeD773ExecutionAuthority(input.executionAuthority);
	if (!(input.signal instanceof AbortSignal)) throw new TypeError("D773 signal is invalid");
	const policy = createD761GraphPublicSemanticValidationPolicy();
	const terminalPolicy = createD726ArmLocalTerminalProviderPolicy();
	const sourceDigest = empiricalStrictJsonDigest({
		decisionRef: D773_DECISION_REF,
		coordinatesDigest: D773_COORDINATES_DIGEST,
		claimDigest: authority.claim.claimDigest,
	});
	const core = await runD722GraphNativeEvalCore({
		sourceDigest,
		budgetLimits: D773_BUDGET_LIMITS,
		effectCeilings: D773_EFFECT_CEILINGS,
		executor: input.executor as D720CallerExecutorV2,
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
	const routeAuthority = createD773LiveRouteAuthority();
	for (const run of graphEvidence.effectRuns)
		for (const fact of run.facts)
			if (
				fact.kind === "graph-effect-result-admitted" &&
				fact.request.effectKind === "provider-request"
			) {
				const proposal = takeD773LiveRouteProposal(fact.request);
				if (proposal !== null) admitD773LiveRouteProposal(routeAuthority, proposal, graphEvidence);
			}
	const routeEvidence = snapshotD773LiveRouteEvidence(routeAuthority, graphEvidence);
	const gate = evaluateD773ArmAwarePositiveGate(graphEvidence, routeEvidence, sourceDigest);
	const efficacyClaim = gate.passed
		? ("positive-differential-frozen-task-block" as const)
		: ("none" as const);
	const disposition =
		graphEvidence.runStatus === "complete" &&
		graphEvidence.ledger.completedArms.length === 6 &&
		routeEvidence.coverageComplete
			? ("success" as const)
			: ("partial-failure" as const);
	const qualificationMaterial = strictSnapshot({
		decisionRef: D773_DECISION_REF,
		decisionRevision: D773_DECISION_REVISION,
		coordinatesDigest: D773_COORDINATES_DIGEST,
		historicalArtifactSha256: D773_HISTORICAL_ARTIFACT_SHA256,
		historicalBundleDigest: D773_HISTORICAL_BUNDLE_DIGEST,
		baselineImplementationManifestDigest: D773_QUALIFIED_IMPLEMENTATION_MANIFEST_DIGEST,
		implementationManifestDigest: D773_IMPLEMENTATION_MANIFEST_DIGEST,
		pricingReadDigest: digest(input.pricingReadDigest, "d773.pricingRead"),
		pricingObservationDigest: digest(input.pricingObservationDigest, "d773.pricingObservation"),
		zeroByokObservationDigest: digest(input.zeroByokObservationDigest, "d773.zeroByok"),
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
		generationRef: D773_GENERATION_REF,
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
		generationRef: D773_GENERATION_REF,
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
		schemaVersion: D773_BUNDLE_SCHEMA,
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

export function validateD773LiveBundle(value: unknown): D773LiveBundleV1 {
	const candidate = record(value, "d773.bundle");
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
		"d773.bundle",
	);
	literal(candidate.schemaVersion, D773_BUNDLE_SCHEMA, "d773.bundle.schema");
	const graphCandidate = record(candidate.graphEvidence, "d773.bundle.graphEvidence");
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
		"d773.bundle.graphEvidence.canonicalReplay",
	);
	const routeEvidence = validateD773LiveRouteEvidence(candidate.routeEvidence, graphEvidence);
	const qualification = record(candidate.qualification, "d773.bundle.qualification");
	const expectedSourceDigest = empiricalStrictJsonDigest({
		decisionRef: D773_DECISION_REF,
		coordinatesDigest: D773_COORDINATES_DIGEST,
		claimDigest: digest(qualification.claimDigest, "d773.bundle.qualification.claimDigest"),
	});
	const gate = evaluateD773ArmAwarePositiveGate(graphEvidence, routeEvidence, expectedSourceDigest);
	const observation = record(candidate.observation, "d773.bundle.observation");
	literal(
		empiricalStrictJsonDigest(observation.gate),
		empiricalStrictJsonDigest(gate),
		"d773.bundle.observation.gate",
	);
	const bundleDigest = digest(candidate.bundleDigest, "d773.bundle.digest");
	const material = strictSnapshot({
		schemaVersion: candidate.schemaVersion,
		disposition: candidate.disposition,
		graphEvidence,
		routeEvidence,
		qualification,
		observation,
		generation: candidate.generation,
		terminalReceipt: candidate.terminalReceipt,
	});
	literal(bundleDigest, empiricalStrictJsonDigest(material), "d773.bundle.digest");
	return strictSnapshot({ ...material, bundleDigest }) as D773LiveBundleV1;
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

export async function persistD773LiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D773LiveBundleV1;
}) {
	const input = record(inputValue, "d773.persist.input");
	exactKeys(input, ["bundle", "privateRoot"], "d773.persist.input");
	const bundle = input.bundle as D773LiveBundleV1;
	if (!constructed.delete(bundle))
		throw new TypeError("D773 persistence requires fresh constructed bundle");
	validateD773LiveBundle(bundle);
	const privateRoot = resolve(input.privateRoot as string);
	if ((await realpath(privateRoot)) !== privateRoot)
		throw new TypeError("D773 private root is not canonical");
	const staging = join(privateRoot, `.tmp-${D773_GENERATION_REF}-${randomUUID()}`);
	const finalRoot = join(privateRoot, D773_GENERATION_REF);
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
			throw new TypeError("D773 published generation identity drifted");
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
					throw new TypeError("D773 published artifact readback drifted");
			} finally {
				await handle.close();
			}
		}
		const receipt = strictSnapshot({
			schemaVersion: D773_PERSISTENCE_SCHEMA,
			generationRef: D773_GENERATION_REF,
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
