import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import { invokeD723OpenRouterGraphTurn } from "./d723-openrouter-graph-turn.js";
import {
	createD776InjectedBaselineForTest,
	type D776QualificationBundleV1,
	runD776InjectedNoNetworkQualification,
	validateD776QualificationBundle,
} from "./d776-pre-live-qualification.js";
import { validateD777LiveBundle } from "./d777-graph-native-live.js";
import {
	admitD778TaskExposureProposal,
	admitD778ToolRejectionProposal,
	createD778GraphTaskEnvelope,
	createD778ModelVisibleConversation,
	createD778TaskExposureProposal,
	createD778ToolRejectionProposal,
	D778_READABLE_PATHS,
	D778_TASK_STATEMENT,
	type D778TaskExposureFactV1,
	type D778ToolRejectionCauseV1,
	type D778ToolRejectionFactV1,
	validateD778FinalChatBody,
} from "./d778-graph-task-tool-authority.js";
import {
	D778_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD778Implementation,
} from "./d778-implementation-manifest.js";
import {
	OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
	OPENROUTER_DEEPSEEK_V4_FLASH_SELECTED_MODEL,
} from "./openrouter-route-qualification.js";

export const D778_BUNDLE_SCHEMA = "graphrefly.b112.d778.pre-live-bundle.v1" as const;
export const D778_QUALIFICATION_SCHEMA = "graphrefly.b112.d778.qualification.v1" as const;
export const D778_GENERATION_SCHEMA = "graphrefly.b112.d778.generation.v1" as const;
export const D778_GENERATION_REF = "d778-complete-task-tool-diagnostics-2026-08-13-v1" as const;
const D777_ARTIFACT_SHA256 =
	"sha256:704753efde34e4ca3250d23bafed59169bf1d432d2df0f7c73efd8d33e87e236";
const D777_BUNDLE_DIGEST =
	"sha256:ceb765a1fdb798f313e24d497327ad873b01db3cf5b9248c3a57f77b8e402a84";
const encoder = new TextEncoder();

export interface D778ConsumedD777BaselineV1 {
	readonly basis: "real-artifact" | "injected-test";
	readonly artifactSha256: typeof D777_ARTIFACT_SHA256;
	readonly bundleDigest: typeof D777_BUNDLE_DIGEST;
}

export interface D778QualificationBundleV1 {
	readonly schemaVersion: typeof D778_BUNDLE_SCHEMA;
	readonly executionClass: "simulated-contract";
	readonly d776Bundle: D776QualificationBundleV1;
	readonly taskExposureFacts: readonly D778TaskExposureFactV1[];
	readonly toolRejectionFacts: readonly D778ToolRejectionFactV1[];
	readonly qualification: Readonly<Record<string, unknown>>;
	readonly generation: Readonly<Record<string, unknown>>;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly bundleDigest: string;
}

const baselines = new WeakSet<object>();
const bundles = new WeakSet<object>();
type D778FileIdentity = Readonly<{ dev: number | bigint; ino: number | bigint }>;
export type D778PersistenceFaultV1 = Readonly<{ readonly __d778PersistenceFault: true }>;
const persistenceFaults = new WeakMap<
	object,
	{ stage: "after-claim" | "after-artifacts-rename"; consumed: boolean }
>();

export function createD778PersistenceFaultForTest(
	stage: "after-claim" | "after-artifacts-rename",
): D778PersistenceFaultV1 {
	if (stage !== "after-claim" && stage !== "after-artifacts-rename")
		throw new TypeError("D778 persistence fault stage is invalid");
	const capability = Object.freeze({ __d778PersistenceFault: true as const });
	persistenceFaults.set(capability, { stage, consumed: false });
	return capability;
}

async function canonicalD778PrivateRoot(value: unknown): Promise<{
	path: string;
	identity: D778FileIdentity;
}> {
	if (typeof value !== "string" || value.length === 0 || value.length > 4096)
		throw new TypeError("D778 privateRoot is invalid");
	const path = resolve(value);
	const stat = await lstat(path);
	if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700 || (await realpath(path)) !== path)
		throw new TypeError("D778 private root must be canonical 0700");
	return { path, identity: { dev: stat.dev, ino: stat.ino } };
}

async function assertD778DirectoryIdentity(
	path: string,
	identity: D778FileIdentity,
): Promise<void> {
	const stat = await lstat(path);
	if (
		!stat.isDirectory() ||
		(stat.mode & 0o777) !== 0o700 ||
		stat.dev !== identity.dev ||
		stat.ino !== identity.ino ||
		(await realpath(path)) !== path
	)
		throw new TypeError("D778 directory identity drifted");
}

async function writeD778Canonical(path: string, bytes: Uint8Array): Promise<D778FileIdentity> {
	const handle = await open(
		path,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1)
			throw new TypeError("D778 canonical artifact is not an owned 0600 file");
		await handle.writeFile(bytes);
		await handle.sync();
		return { dev: stat.dev, ino: stat.ino };
	} finally {
		await handle.close();
	}
}

async function assertD778File(
	path: string,
	identity: D778FileIdentity,
	expected: Uint8Array,
): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		const actual = new Uint8Array(await handle.readFile());
		if (
			!stat.isFile() ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.nlink !== 1 ||
			stat.dev !== identity.dev ||
			stat.ino !== identity.ino ||
			!sameBytes(actual, expected)
		)
			throw new TypeError("D778 artifact identity or bytes drifted");
	} finally {
		await handle.close();
	}
}

function baseline(basis: D778ConsumedD777BaselineV1["basis"]): D778ConsumedD777BaselineV1 {
	const value = strictSnapshot({
		basis,
		artifactSha256: D777_ARTIFACT_SHA256,
		bundleDigest: D777_BUNDLE_DIGEST,
	} as const);
	baselines.add(value);
	return value;
}

export function createD778InjectedBaselineForTest(): D778ConsumedD777BaselineV1 {
	return baseline("injected-test");
}

export function admitD778ConsumedD777Baseline(bytes: Uint8Array): D778ConsumedD777BaselineV1 {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength > 4_194_304)
		throw new TypeError("D778 D777 baseline bytes exceed the bound");
	if (empiricalSha256(bytes) !== D777_ARTIFACT_SHA256)
		throw new TypeError("D778 D777 baseline artifact digest drifted");
	const bundle = validateD777LiveBundle(strictJsonCodec.decode(bytes));
	if (bundle.bundleDigest !== D777_BUNDLE_DIGEST)
		throw new TypeError("D778 D777 canonical bundle digest drifted");
	return baseline("real-artifact");
}

function bindingFor(graph: D776QualificationBundleV1["graphEvidence"], fact: any) {
	const reconciliation = graph.ledger.effectReconciliations.find(
		(entry: any) => entry.admissionDigest === fact.admissionDigest,
	);
	if (reconciliation === undefined) throw new TypeError("D778 Graph reconciliation is missing");
	return {
		requestDigest: fact.request.requestDigest,
		admissionDigest: fact.admissionDigest,
		resultFactDigest: fact.factDigest,
		reconciliationDigest: reconciliation.reconciliationDigest,
	};
}

async function qualifyTaskWire(d776: D776QualificationBundleV1) {
	const facts: D778TaskExposureFactV1[] = [];
	let transportCalls = 0;
	const retryBodies = new Map<string, Uint8Array>();
	const armByRun = new Map(
		d776.graphEvidence.ledger.facts.map((fact: any) => [fact.runSequence, fact.arm] as const),
	);
	for (const run of d776.graphEvidence.effectRuns) {
		const graphFacts = run.facts.filter(
			(fact: any) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.request.effectKind === "provider-request",
		) as any;
		const arm = armByRun.get(run.runSequence);
		if (arm === undefined) throw new TypeError("D778 Graph arm coordinate is missing");
		for (const graphFact of graphFacts) {
			const envelope = createD778GraphTaskEnvelope({
				arm: arm as never,
				effectRequest: graphFact.request,
			});
			let wireReceipt: object | null = null;
			const turn = await invokeD723OpenRouterGraphTurn({
				effectRequest: graphFact.request,
				credential: {
					bearerToken: "not-a-live-d778-credential",
					credentialBindingRef: "d778.injected-no-network",
					credentialBindingRevision: "v1",
				},
				taskStatement: D778_TASK_STATEMENT,
				conversation: createD778ModelVisibleConversation(envelope),
				signal: new AbortController().signal,
				monotonicNowMs: () => transportCalls,
				transport: {
					async request(request) {
						transportCalls += 1;
						const prior = retryBodies.get(graphFact.request.logicalRequestDigest);
						if (prior === undefined)
							retryBodies.set(graphFact.request.logicalRequestDigest, request.body.slice());
						else if (!sameBytes(prior, request.body))
							throw new TypeError("D778 same-logical-request retry wire drifted");
						wireReceipt = validateD778FinalChatBody({
							body: request.body,
							envelope,
							requestDigest: graphFact.request.requestDigest,
							...(graphFact.request.completionContext === undefined
								? {}
								: { completionContext: graphFact.request.completionContext }),
						});
						const body = record(
							JSON.parse(new TextDecoder().decode(request.body)),
							"d778.fixture.body",
						);
						const visible = JSON.stringify(body.messages);
						if (!visible.includes(D778_TASK_STATEMENT) || !visible.includes(D778_READABLE_PATHS[0]))
							throw new TypeError("D778 injected model did not receive complete task material");
						return {
							status: 200,
							retryAfterMs: null,
							body: encoder.encode(
								JSON.stringify({
									id: `d778-${transportCalls}`,
									usage: { prompt_tokens: 1, completion_tokens: 1 },
									choices: [
										{
											finish_reason: "tool_calls",
											message: {
												content: null,
												tool_calls: [
													{
														id: `d778-read-${transportCalls}`,
														type: "function",
														function: {
															name: "read_file",
															arguments: JSON.stringify({ path: D778_READABLE_PATHS[0] }),
														},
													},
												],
											},
										},
									],
									openrouter_metadata: {
										endpoints: {
											available: [
												{
													provider: OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_NAME,
													model: OPENROUTER_DEEPSEEK_V4_FLASH_SELECTED_MODEL,
													selected: true,
												},
											],
										},
									},
								}),
							),
						};
					},
				},
			});
			if (turn.rawToolIntents[0]?.arguments === undefined)
				throw new TypeError("D778 injected model omitted the grounded inspection intent");
			if (wireReceipt === null) throw new TypeError("D778 task wire receipt was not issued");
			facts.push(
				admitD778TaskExposureProposal(
					createD778TaskExposureProposal({
						envelope,
						wireReceipt,
						binding: bindingFor(d776.graphEvidence, graphFact),
					}),
				),
			);
		}
	}
	if (facts.length !== d776.routeEvidence.facts.length || transportCalls !== facts.length)
		throw new TypeError("D778 exact six-arm task-wire coverage drifted");
	return Object.freeze(facts);
}

function qualifyToolRejections(): readonly D778ToolRejectionFactV1[] {
	const causes: readonly D778ToolRejectionCauseV1[] = [
		"malformed-arguments",
		"unexpected-arguments",
		"path-not-allowed",
		"exact-replacement-not-applicable",
		"focused-validation-failed",
	];
	return Object.freeze(
		causes.map((causeCode, runSequence) => {
			const workspace = empiricalStrictJsonDigest({ d778: "tool-workspace", runSequence });
			const binding = {
				requestDigest: empiricalStrictJsonDigest({ d778: "tool-request", runSequence }),
				admissionDigest: empiricalStrictJsonDigest({ d778: "tool-admission", runSequence }),
				resultFactDigest: empiricalStrictJsonDigest({ d778: "tool-result", runSequence }),
				reconciliationDigest: empiricalStrictJsonDigest({
					d778: "tool-reconciliation",
					runSequence,
				}),
			};
			return admitD778ToolRejectionProposal(
				createD778ToolRejectionProposal({
					runSequence,
					toolRef: runSequence === 4 ? "focused-validation" : "read-file",
					causeCode,
					workspaceStateBeforeDigest: workspace,
					workspaceStateAfterDigest: workspace,
					binding,
				}),
			);
		}),
	);
}

export async function runD778InjectedNoNetworkQualification(
	baselineValue: D778ConsumedD777BaselineV1,
): Promise<D778QualificationBundleV1> {
	if (!baselines.has(baselineValue)) throw new TypeError("D778 baseline is forged or replayed");
	baselines.delete(baselineValue);
	if ((await measureD778Implementation()) !== D778_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D778 implementation manifest validation failed");
	const d776Bundle = validateD776QualificationBundle(
		await runD776InjectedNoNetworkQualification(createD776InjectedBaselineForTest()),
	);
	const taskExposureFacts = await qualifyTaskWire(d776Bundle);
	const toolRejectionFacts = qualifyToolRejections();
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D778_QUALIFICATION_SCHEMA,
		decisionRef: "decision.D778.2026-08-13.v1",
		baselineBasis: baselineValue.basis,
		baselineArtifactSha256: baselineValue.artifactSha256,
		baselineBundleDigest: baselineValue.bundleDigest,
		implementationManifestDigest: D778_IMPLEMENTATION_MANIFEST_DIGEST,
		d776BundleDigest: d776Bundle.bundleDigest,
		d776GraphEvidenceDigest: d776Bundle.graphEvidence.evidenceDigest,
		completedArms: 6,
		taskExposureFactCount: taskExposureFacts.length,
		toolRejectionFactCount: toolRejectionFacts.length,
		toolRejectionCauseCoverage: toolRejectionFacts.map((fact) => fact.causeCode).sort(),
		adapterSideLedgerCount: 0,
		credentialReads: 0,
		controlPlaneCalls: 0,
		providerNetworkCalls: 0,
		maxActiveEffects: 1,
		workspaceResidueCount: 0,
	});
	const qualification = strictSnapshot({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: D778_GENERATION_SCHEMA,
		generationRef: D778_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		taskExposureDigest: empiricalStrictJsonDigest(taskExposureFacts),
		toolRejectionDigest: empiricalStrictJsonDigest(toolRejectionFacts),
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = strictSnapshot({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D778_BUNDLE_SCHEMA,
		executionClass: "simulated-contract" as const,
		d776Bundle,
		taskExposureFacts,
		toolRejectionFacts,
		qualification,
		generation,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const bundle = Object.freeze({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
	bundles.add(bundle);
	return bundle;
}

export function validateD778QualificationBundle(value: unknown): D778QualificationBundleV1 {
	const candidate = record(value, "d778.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"causalAttribution",
			"d776Bundle",
			"efficacyClaim",
			"executionClass",
			"generation",
			"qualification",
			"schemaVersion",
			"taskExposureFacts",
			"toolRejectionFacts",
		],
		"d778.bundle",
	);
	const d776 = validateD776QualificationBundle(candidate.d776Bundle);
	const taskFacts = candidate.taskExposureFacts as readonly D778TaskExposureFactV1[];
	const toolFacts = candidate.toolRejectionFacts as readonly D778ToolRejectionFactV1[];
	if (
		!Array.isArray(taskFacts) ||
		taskFacts.length !== d776.routeEvidence.facts.length ||
		!Array.isArray(toolFacts) ||
		toolFacts.length !== 5
	)
		throw new TypeError("D778 exact evidence cardinality drifted");
	const armByRun = new Map(
		d776.graphEvidence.ledger.facts.map((fact: any) => [fact.runSequence, fact.arm] as const),
	);
	const expectedTaskFacts = d776.graphEvidence.effectRuns.flatMap((run) => {
		const graphFacts = run.facts.filter(
			(fact: any) =>
				fact.kind === "graph-effect-result-admitted" &&
				fact.request.effectKind === "provider-request",
		) as any;
		const arm = armByRun.get(run.runSequence);
		if (graphFacts.length === 0 || arm === undefined)
			throw new TypeError("D778 Graph exposure replay is incomplete");
		return graphFacts.map((graphFact: any) => {
			const envelope = createD778GraphTaskEnvelope({
				arm: arm as never,
				effectRequest: graphFact.request,
			});
			const messages = [
				...createD778ModelVisibleConversation(envelope).messages,
				...(graphFact.request.completionContext === undefined
					? []
					: [
							{
								role: "user",
								content: JSON.stringify({
									graphCompletionContext: graphFact.request.completionContext,
								}),
							},
						]),
			];
			const material = {
				schemaVersion: "graphrefly.b112.d778.graph-task-exposure-fact.v1",
				arm,
				runSequence: run.runSequence,
				envelopeDigest: envelope.envelopeDigest,
				modelVisibleMessagesDigest: empiricalStrictJsonDigest(messages),
				...bindingFor(d776.graphEvidence, graphFact),
			};
			return strictSnapshot({ ...material, factDigest: empiricalStrictJsonDigest(material) });
		});
	});
	if (empiricalStrictJsonDigest(taskFacts) !== empiricalStrictJsonDigest(expectedTaskFacts))
		throw new TypeError("D778 task exposure Graph bijection drifted");
	const causeCodes = [
		"malformed-arguments",
		"unexpected-arguments",
		"path-not-allowed",
		"exact-replacement-not-applicable",
		"focused-validation-failed",
	] as const;
	const expectedToolFacts = causeCodes.map((causeCode, runSequence) => {
		const workspace = empiricalStrictJsonDigest({ d778: "tool-workspace", runSequence });
		const material = {
			schemaVersion: "graphrefly.b112.d778.sanitized-tool-rejection-fact.v1",
			runSequence,
			toolRef: runSequence === 4 ? "focused-validation" : "read-file",
			causeCode,
			workspaceStateBeforeDigest: workspace,
			workspaceStateAfterDigest: workspace,
			requestDigest: empiricalStrictJsonDigest({ d778: "tool-request", runSequence }),
			admissionDigest: empiricalStrictJsonDigest({ d778: "tool-admission", runSequence }),
			resultFactDigest: empiricalStrictJsonDigest({ d778: "tool-result", runSequence }),
			reconciliationDigest: empiricalStrictJsonDigest({ d778: "tool-reconciliation", runSequence }),
		};
		return strictSnapshot({ ...material, factDigest: empiricalStrictJsonDigest(material) });
	});
	if (empiricalStrictJsonDigest(toolFacts) !== empiricalStrictJsonDigest(expectedToolFacts))
		throw new TypeError("D778 tool rejection admission matrix drifted");
	const qualification = record(candidate.qualification, "d778.qualification");
	exactKeys(
		qualification,
		[
			"adapterSideLedgerCount",
			"baselineArtifactSha256",
			"baselineBasis",
			"baselineBundleDigest",
			"completedArms",
			"controlPlaneCalls",
			"credentialReads",
			"d776BundleDigest",
			"d776GraphEvidenceDigest",
			"decisionRef",
			"implementationManifestDigest",
			"maxActiveEffects",
			"providerNetworkCalls",
			"qualificationDigest",
			"schemaVersion",
			"taskExposureFactCount",
			"toolRejectionCauseCoverage",
			"toolRejectionFactCount",
			"workspaceResidueCount",
		],
		"d778.qualification",
	);
	const { qualificationDigest, ...qualificationMaterial } = qualification;
	if (
		qualification.schemaVersion !== D778_QUALIFICATION_SCHEMA ||
		qualification.decisionRef !== "decision.D778.2026-08-13.v1" ||
		(qualification.baselineBasis !== "real-artifact" &&
			qualification.baselineBasis !== "injected-test") ||
		qualification.baselineArtifactSha256 !== D777_ARTIFACT_SHA256 ||
		qualification.baselineBundleDigest !== D777_BUNDLE_DIGEST ||
		qualification.implementationManifestDigest !== D778_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.d776BundleDigest !== d776.bundleDigest ||
		qualification.d776GraphEvidenceDigest !== d776.graphEvidence.evidenceDigest ||
		qualification.completedArms !== 6 ||
		qualification.taskExposureFactCount !== d776.routeEvidence.facts.length ||
		qualification.toolRejectionFactCount !== 5 ||
		empiricalStrictJsonDigest(qualification.toolRejectionCauseCoverage) !==
			empiricalStrictJsonDigest([...causeCodes].sort()) ||
		qualification.adapterSideLedgerCount !== 0 ||
		qualification.credentialReads !== 0 ||
		qualification.controlPlaneCalls !== 0 ||
		qualification.providerNetworkCalls !== 0 ||
		qualification.maxActiveEffects !== 1 ||
		qualification.workspaceResidueCount !== 0 ||
		qualificationDigest !== empiricalStrictJsonDigest(qualificationMaterial)
	)
		throw new TypeError("D778 qualification projection drifted");
	const generation = record(candidate.generation, "d778.generation");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"qualificationDigest",
			"schemaVersion",
			"taskExposureDigest",
			"toolRejectionDigest",
		],
		"d778.generation",
	);
	const { generationDigest, ...generationMaterial } = generation;
	if (
		generation.schemaVersion !== D778_GENERATION_SCHEMA ||
		generation.generationRef !== D778_GENERATION_REF ||
		generation.qualificationDigest !== qualificationDigest ||
		generation.taskExposureDigest !== empiricalStrictJsonDigest(taskFacts) ||
		generation.toolRejectionDigest !== empiricalStrictJsonDigest(toolFacts) ||
		generation.causalAttribution !== "undetermined" ||
		generation.efficacyClaim !== "none" ||
		generationDigest !== empiricalStrictJsonDigest(generationMaterial)
	)
		throw new TypeError("D778 generation projection drifted");
	const { bundleDigest, ...bundleMaterial } = candidate;
	if (
		candidate.schemaVersion !== D778_BUNDLE_SCHEMA ||
		candidate.executionClass !== "simulated-contract" ||
		candidate.causalAttribution !== "undetermined" ||
		candidate.efficacyClaim !== "none" ||
		bundleDigest !== empiricalStrictJsonDigest(bundleMaterial)
	)
		throw new TypeError("D778 bundle digest drifted");
	return strictSnapshot(candidate) as unknown as D778QualificationBundleV1;
}

async function persistD778OwnedBundle(inputValue: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly bundleDigest: string;
	readonly bundleBytes: Uint8Array;
	readonly fault?: D778PersistenceFaultV1;
}): Promise<Readonly<Record<string, unknown>>> {
	const input = record(inputValue, "d778.persist.owned");
	exactKeys(
		input,
		Object.hasOwn(input, "fault")
			? ["bundleBytes", "bundleDigest", "fault", "generationRef", "privateRoot"]
			: ["bundleBytes", "bundleDigest", "generationRef", "privateRoot"],
		"d778.persist.owned",
	);
	const generationRef = input.generationRef;
	if (generationRef !== D778_GENERATION_REF && generationRef !== "d778-owned-persistence-test-v1")
		throw new TypeError("D778 persistence generation ref is invalid");
	const bundleDigest = input.bundleDigest;
	if (typeof bundleDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(bundleDigest))
		throw new TypeError("D778 persistence bundle digest is invalid");
	if (!(input.bundleBytes instanceof Uint8Array) || input.bundleBytes.byteLength > 8_388_608)
		throw new TypeError("D778 persistence bundle bytes exceed the bound");
	const suppliedBundleBytes = input.bundleBytes.slice();
	let faultStage: "after-claim" | "after-artifacts-rename" | null = null;
	if (Object.hasOwn(input, "fault")) {
		const fault = persistenceFaults.get(input.fault as object);
		if (fault === undefined || fault.consumed)
			throw new TypeError("D778 persistence fault is forged or replayed");
		fault.consumed = true;
		faultStage = fault.stage;
	}
	const validatedRoot = await canonicalD778PrivateRoot(input.privateRoot);
	const root = validatedRoot.path;
	const final = join(root, generationRef);
	const parentHandle = await open(root, constants.O_RDONLY | constants.O_NOFOLLOW);
	let parentIdentity: D778FileIdentity | null = null;
	let claimCreated = false;
	let finalIdentity: D778FileIdentity | null = null;
	let artifactsIdentity: D778FileIdentity | null = null;
	let finalHandle: Awaited<ReturnType<typeof open>> | null = null;
	let artifactsHandle: Awaited<ReturnType<typeof open>> | null = null;
	let bundleBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
	let markerBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
	let operationError: unknown = null;
	try {
		const parentStat = await parentHandle.stat();
		parentIdentity = { dev: parentStat.dev, ino: parentStat.ino };
		if (
			parentIdentity.dev !== validatedRoot.identity.dev ||
			parentIdentity.ino !== validatedRoot.identity.ino
		)
			throw new TypeError("D778 private root changed before stable-handle acquisition");
		await assertD778DirectoryIdentity(root, parentIdentity);
		try {
			await mkdir(final, { mode: 0o700 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST")
				throw new TypeError("D778 generation already exists");
			throw error;
		}
		claimCreated = true;
		finalHandle = await open(final, constants.O_RDONLY | constants.O_NOFOLLOW);
		const finalStat = await finalHandle.stat();
		if (!finalStat.isDirectory() || (finalStat.mode & 0o777) !== 0o700)
			throw new TypeError("D778 claimed generation identity is invalid");
		finalIdentity = { dev: finalStat.dev, ino: finalStat.ino };
		await assertD778DirectoryIdentity(final, finalIdentity);
		if (faultStage === "after-claim") throw new TypeError("D778 injected after-claim failure");
		bundleBytes = suppliedBundleBytes;
		const staging = join(final, `.d778-staging-${randomUUID()}`);
		await mkdir(staging, { mode: 0o700 });
		const stagingStat = await lstat(staging);
		const stagingIdentity = { dev: stagingStat.dev, ino: stagingStat.ino };
		await assertD778DirectoryIdentity(staging, stagingIdentity);
		const bundleIdentity = await writeD778Canonical(join(staging, "bundle.v1.json"), bundleBytes);
		const stagingHandle = await open(staging, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			await stagingHandle.sync();
		} finally {
			await stagingHandle.close();
		}
		await assertD778File(join(staging, "bundle.v1.json"), bundleIdentity, bundleBytes);
		await assertD778DirectoryIdentity(root, parentIdentity);
		await assertD778DirectoryIdentity(final, finalIdentity);
		const artifacts = join(final, "artifacts");
		await rename(staging, artifacts);
		artifactsHandle = await open(artifacts, constants.O_RDONLY | constants.O_NOFOLLOW);
		const artifactsStat = await artifactsHandle.stat();
		artifactsIdentity = { dev: artifactsStat.dev, ino: artifactsStat.ino };
		if (
			!artifactsStat.isDirectory() ||
			(artifactsStat.mode & 0o777) !== 0o700 ||
			artifactsIdentity.dev !== stagingIdentity.dev ||
			artifactsIdentity.ino !== stagingIdentity.ino
		)
			throw new TypeError("D778 committed artifacts identity drifted");
		await assertD778DirectoryIdentity(artifacts, artifactsIdentity);
		if (faultStage === "after-artifacts-rename")
			throw new TypeError("D778 injected post-rename failure");
		const markerMaterial = strictSnapshot({
			generationRef,
			bundleDigest,
			bundleArtifactSha256: empiricalSha256(bundleBytes),
		});
		markerBytes = strictJsonCodec.encode({
			...markerMaterial,
			commitMarkerDigest: empiricalStrictJsonDigest(markerMaterial),
		});
		const markerIdentity = await writeD778Canonical(join(final, "commit.v1.json"), markerBytes);
		await finalHandle.sync();
		await assertD778File(join(artifacts, "bundle.v1.json"), bundleIdentity, bundleBytes);
		await assertD778File(join(final, "commit.v1.json"), markerIdentity, markerBytes);
		await assertD778DirectoryIdentity(root, parentIdentity);
		await assertD778DirectoryIdentity(final, finalIdentity);
		await assertD778DirectoryIdentity(artifacts, artifactsIdentity);
		await parentHandle.sync();
		await assertD778DirectoryIdentity(root, parentIdentity);
		await assertD778DirectoryIdentity(final, finalIdentity);
		await assertD778DirectoryIdentity(artifacts, artifactsIdentity);
		await assertD778File(join(artifacts, "bundle.v1.json"), bundleIdentity, bundleBytes);
		await assertD778File(join(final, "commit.v1.json"), markerIdentity, markerBytes);
		const finalHandleStat = await finalHandle.stat();
		const artifactsHandleStat = await artifactsHandle.stat();
		if (
			finalHandleStat.dev !== finalIdentity.dev ||
			finalHandleStat.ino !== finalIdentity.ino ||
			artifactsHandleStat.dev !== artifactsIdentity.dev ||
			artifactsHandleStat.ino !== artifactsIdentity.ino
		)
			throw new TypeError("D778 stable directory handle identity drifted");
	} catch (error) {
		operationError = error;
	}
	const closeResults = await Promise.allSettled([
		artifactsHandle?.close() ?? Promise.resolve(),
		finalHandle?.close() ?? Promise.resolve(),
	]);
	const closeErrors = closeResults
		.filter((result): result is PromiseRejectedResult => result.status === "rejected")
		.map((result) => result.reason);
	if (closeErrors.length > 0)
		operationError = new AggregateError(
			operationError === null ? closeErrors : [operationError, ...closeErrors],
			"D778 persistence handle cleanup failed",
		);
	let cleanupError: unknown = null;
	if (operationError !== null && claimCreated) {
		if (parentIdentity === null || finalIdentity === null) {
			cleanupError = new TypeError("D778 exact cleanup ownership was not established");
		} else {
			const currentRoot = await lstat(root).catch(() => null);
			const currentFinal = await lstat(final).catch(() => null);
			if (
				currentRoot === null ||
				currentRoot.dev !== parentIdentity.dev ||
				currentRoot.ino !== parentIdentity.ino ||
				currentFinal === null ||
				currentFinal.dev !== finalIdentity.dev ||
				currentFinal.ino !== finalIdentity.ino
			) {
				cleanupError = new TypeError("D778 cleanup refused after ownership drift");
			} else {
				try {
					await rm(final, { recursive: true, force: true });
					await parentHandle.sync();
				} catch (error) {
					cleanupError = error;
				}
			}
		}
	}
	const parentClose = await Promise.allSettled([parentHandle.close()]);
	const parentCloseError = parentClose[0]?.status === "rejected" ? parentClose[0].reason : null;
	if (operationError !== null) {
		const errors = [operationError];
		if (cleanupError !== null) errors.push(cleanupError);
		if (parentCloseError !== null) errors.push(parentCloseError);
		if (errors.length > 1) throw new AggregateError(errors, "D778 persistence cleanup failed");
		throw operationError;
	}
	void parentCloseError;
	const material = strictSnapshot({
		schemaVersion: "graphrefly.b112.d778.persistence.v1",
		generationRef,
		bundleDigest,
		bundleArtifactSha256: empiricalSha256(bundleBytes),
	});
	return strictSnapshot({ ...material, persistenceDigest: empiricalStrictJsonDigest(material) });
}

export async function persistD778QualificationBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D778QualificationBundleV1;
	readonly fault?: D778PersistenceFaultV1;
}): Promise<Readonly<Record<string, unknown>>> {
	const input = record(inputValue, "d778.persist");
	exactKeys(
		input,
		Object.hasOwn(input, "fault") ? ["bundle", "fault", "privateRoot"] : ["bundle", "privateRoot"],
		"d778.persist",
	);
	if (!bundles.has(input.bundle as object))
		throw new TypeError("D778 bundle was not constructed here");
	bundles.delete(input.bundle as object);
	const bundle = validateD778QualificationBundle(input.bundle);
	if (record(bundle.qualification, "d778.persist.qualification").baselineBasis !== "real-artifact")
		throw new TypeError("D778 production persistence rejects injected baseline evidence");
	return persistD778OwnedBundle({
		privateRoot: input.privateRoot as string,
		generationRef: D778_GENERATION_REF,
		bundleDigest: bundle.bundleDigest,
		bundleBytes: strictJsonCodec.encode(bundle),
		...(Object.hasOwn(input, "fault") ? { fault: input.fault as D778PersistenceFaultV1 } : {}),
	});
}

export async function persistD778AtomicFixtureForTest(inputValue: {
	readonly privateRoot: string;
	readonly fault?: D778PersistenceFaultV1;
}): Promise<Readonly<Record<string, unknown>>> {
	const input = record(inputValue, "d778.persist.test");
	exactKeys(
		input,
		Object.hasOwn(input, "fault") ? ["fault", "privateRoot"] : ["privateRoot"],
		"d778.persist.test",
	);
	const fixture = strictSnapshot({
		schemaVersion: "graphrefly.b112.d778.persistence-test-fixture.v1",
		materialFree: true,
	});
	return persistD778OwnedBundle({
		privateRoot: input.privateRoot as string,
		generationRef: "d778-owned-persistence-test-v1",
		bundleDigest: empiricalStrictJsonDigest(fixture),
		bundleBytes: strictJsonCodec.encode(fixture),
		...(Object.hasOwn(input, "fault") ? { fault: input.fault as D778PersistenceFaultV1 } : {}),
	});
}
