import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";
import { persistCurrentGraphPrivateGeneration } from "./d6-current-private-persistence.js";
import {
	CURRENT_GRAPH_LIVE_LIMITS,
	CURRENT_GRAPH_LIVE_ROUTE,
	CURRENT_GRAPH_LIVE_TASK,
	CURRENT_GRAPH_LIVE_WRITABLE_FILE,
} from "./d8-current-live-coordinates.js";
import {
	CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
	CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
} from "./d8-current-openrouter-adapter.js";
import {
	admitD34EffectResult,
	createD34RetainedSpanAuthority,
	snapshotD34RetainedSpanEvidence,
	validateD34RetainedSpanEvidence,
} from "./d34-retained-span-mutation-authority.js";
import { validateD34QualificationBundle } from "./d34-retained-span-qualification.js";
import { D35_IMPLEMENTATION_MANIFEST_DIGEST } from "./d35-retained-span-implementation-manifest.js";
import {
	createD35RetainedSpanRealProviderExecutor,
	D35_DECISION_REF,
} from "./d35-retained-span-real-provider-composition.js";

export const D35_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d35.retained-span-real-provider-qualification.v1" as const;
export const D35_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d35.retained-span-real-provider-qualification-bundle.v1" as const;
export const D35_QUALIFICATION_GENERATION_SCHEMA =
	"graphrefly-ts.d35.retained-span-real-provider-qualification-generation.v1" as const;
export const D35_QUALIFICATION_GENERATION_REF =
	"current-graph-native-retained-span-real-provider-no-network-2026-08-20-d35-v1" as const;

export const D35_D34_BASELINE = Object.freeze({
	artifactDigest:
		"sha256:3e4c963f61b0e3961e98c381d37fe09933fe4b67bb95e120ffc38bbb2993abb5" as const,
	bundleDigest: "sha256:6df3498ca9f95e32c80dff001da14e663bd457ee02527aaacbe3304a625f7fc6" as const,
	qualificationDigest:
		"sha256:0dec33e8f03c8d0ea8fb5352ca770b90120779d07a6c911938b81a3c17eceb82" as const,
	generationDigest:
		"sha256:fc7506b12b95a8e1f51a0ad3cca2f184bfdeb277f2cedab3b60569970bee2b1e" as const,
	evidenceDigest:
		"sha256:f9b4290bf4dba4f5447b813f823c7a06b59acd842902ba23baa3f352c1912474" as const,
	implementationManifestDigest:
		"sha256:b11fc1815e4824b3c0bbaec2ad6b9bc45ec0a53a8f89fc82589b4df679089105" as const,
});

export interface D35D34BaselineAdmissionV1 {
	readonly revision: "graphrefly-ts.d35.d34-baseline-admission.v1";
}

export interface D35QualificationBundleV1 {
	readonly schemaVersion: typeof D35_QUALIFICATION_BUNDLE_SCHEMA;
	readonly baselineBasis: "consumed-d34-artifact" | "injected-test";
	readonly evidence: ReturnType<typeof validateD34RetainedSpanEvidence>;
	readonly qualification: Readonly<{
		readonly schemaVersion: typeof D35_QUALIFICATION_SCHEMA;
		readonly decisionRef: typeof D35_DECISION_REF;
		readonly d34Baseline: typeof D35_D34_BASELINE;
		readonly implementationManifestDigest: typeof D35_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly evidenceDigest: string;
		readonly exactSixArmsCompleted: true;
		readonly retainedSpanCount: 6;
		readonly acceptedNewTextCount: 6;
		readonly cardinalityCorrectionCount: 1;
		readonly injectedTransportCalls: 26;
		readonly retainedSpanTransportCalls: 8;
		readonly retryWaitCount: 1;
		readonly maxActiveEffects: 1;
		readonly maxActiveTransport: 1;
		readonly exactRetainedRetryWireIdentity: true;
		readonly exactNamedNewTextOnlyWire: true;
		readonly allPublicSemanticPassed: true;
		readonly allHiddenVerifierPassed: true;
		readonly allCleanupCompleted: true;
		readonly providerNetworkCalls: 0;
		readonly persistedRawSourcePatchOrArguments: false;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly qualified: true;
		readonly qualificationDigest: string;
	}>;
	readonly generation: Readonly<{
		readonly schemaVersion: typeof D35_QUALIFICATION_GENERATION_SCHEMA;
		readonly generationRef: typeof D35_QUALIFICATION_GENERATION_REF;
		readonly qualificationDigest: string;
		readonly evidenceDigest: string;
		readonly implementationManifestDigest: typeof D35_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

const baselines = new WeakMap<object, D35QualificationBundleV1["baselineBasis"]>();
const constructed = new WeakSet<object>();

function baselineCapability(basis: D35QualificationBundleV1["baselineBasis"]) {
	const capability = Object.freeze({
		revision: "graphrefly-ts.d35.d34-baseline-admission.v1" as const,
	});
	baselines.set(capability, basis);
	return capability;
}

export function admitD35D34Baseline(bytesValue: Uint8Array): D35D34BaselineAdmissionV1 {
	if (!(bytesValue instanceof Uint8Array))
		throw new TypeError("D35 D34 baseline bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D35_D34_BASELINE.artifactDigest)
		throw new TypeError("D35 D34 baseline artifact drifted");
	const bundle = validateD34QualificationBundle(strictJsonCodec.decode(bytes));
	if (
		bundle.baselineBasis !== "consumed-d33-artifact" ||
		bundle.bundleDigest !== D35_D34_BASELINE.bundleDigest ||
		bundle.qualification.qualificationDigest !== D35_D34_BASELINE.qualificationDigest ||
		bundle.generation.generationDigest !== D35_D34_BASELINE.generationDigest ||
		bundle.evidence.evidenceDigest !== D35_D34_BASELINE.evidenceDigest ||
		bundle.qualification.implementationManifestDigest !==
			D35_D34_BASELINE.implementationManifestDigest ||
		bundle.qualification.efficacyClaim !== "none"
	)
		throw new TypeError("D35 D34 baseline coordinates drifted");
	return baselineCapability("consumed-d34-artifact");
}

export function createD35InjectedBaselineForTest(): D35D34BaselineAdmissionV1 {
	return baselineCapability("injected-test");
}

function consumeBaseline(value: D35D34BaselineAdmissionV1) {
	const basis = baselines.get(value as object);
	baselines.delete(value as object);
	if (basis === undefined) throw new TypeError("D35 D34 baseline is forged or replayed");
	return basis;
}

function providerResponse(toolName: string, args: unknown, callCount = 1) {
	return new Response(
		JSON.stringify({
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: Array.from({ length: callCount }, (_, index) => ({
							id: `d35-${toolName}-${index}`,
							type: "function",
							function: { name: toolName, arguments: JSON.stringify(args) },
						})),
					},
				},
			],
			usage: {
				prompt_tokens: 100,
				completion_tokens: 20,
				prompt_tokens_details: { cached_tokens: 0 },
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

function retryWaitCount(evidence: ReturnType<typeof validateD34RetainedSpanEvidence>) {
	return evidence.phaseEvidence.workflowEvidence.providerEvidence.facts.filter(
		(fact) => fact.result.effectKind === "retry-wait",
	).length;
}

function providerAttemptCount(evidence: ReturnType<typeof validateD34RetainedSpanEvidence>) {
	return evidence.phaseEvidence.workflowEvidence.providerEvidence.facts.filter(
		(fact) => fact.result.effectKind === "provider-request",
	).length;
}

async function runInjectedRealProvider(input: {
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
}) {
	const authority = createD34RetainedSpanAuthority({
		limits: CURRENT_GRAPH_LIVE_LIMITS,
		routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
		taskProfile: CURRENT_GRAPH_LIVE_TASK,
	});
	let activeTransport = 0;
	let maxActiveTransport = 0;
	let transportCalls = 0;
	let cardinalityInjected = false;
	let retainedRetryInjected = false;
	const retainedBodies: Uint8Array[] = [];
	const executor = createD35RetainedSpanRealProviderExecutor({
		authority,
		repositoryRoot: input.repositoryRoot,
		materializationRoot: input.materializationRoot,
		credential: {
			bearerToken: "d35-injected-no-network",
			credentialBindingRef: "openrouter.local-eval-2",
			credentialBindingRevision: "2026-08-14.v1",
		},
		fetchImpl: async (_url, init) => {
			activeTransport += 1;
			maxActiveTransport = Math.max(maxActiveTransport, activeTransport);
			transportCalls += 1;
			try {
				const bytes =
					typeof init?.body === "string"
						? Buffer.from(init.body, "utf8")
						: Buffer.from(init?.body as Uint8Array);
				const body = record(JSON.parse(bytes.toString("utf8")), "D35 injected Chat body");
				const messages = Array.isArray(body.messages) ? body.messages : [];
				const hasReadResult = messages.some((value) => {
					const message = record(value, "D35 injected Chat message");
					return (
						message.role === "tool" &&
						typeof message.content === "string" &&
						message.content.includes("managed-cloud-postgresql")
					);
				});
				const choice = body.tool_choice;
				const toolName =
					choice === "required"
						? hasReadResult
							? "replace_exact"
							: "read_file"
						: record(record(choice, "D35 injected tool choice").function, "D35 tool choice fn")
								.name;
				if (toolName === "read_file")
					return providerResponse("read_file", { path: CURRENT_GRAPH_LIVE_WRITABLE_FILE });
				if (toolName === "replace_exact")
					return providerResponse("replace_exact", {
						path: CURRENT_GRAPH_LIVE_WRITABLE_FILE,
						oldText: CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
						newText: CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
					});
				if (toolName !== "propose_replacement_text")
					throw new TypeError("D35 injected named tool drifted");
				retainedBodies.push(new Uint8Array(bytes));
				if (!retainedRetryInjected) {
					retainedRetryInjected = true;
					return new Response(JSON.stringify({ error: { message: "bounded injected 429" } }), {
						status: 429,
						headers: { "content-type": "application/json", "retry-after": "0" },
					});
				}
				if (!cardinalityInjected) {
					cardinalityInjected = true;
					return providerResponse(
						"propose_replacement_text",
						{ newText: CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK },
						2,
					);
				}
				return providerResponse("propose_replacement_text", {
					newText: CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
				});
			} finally {
				activeTransport -= 1;
			}
		},
		now: (() => {
			let value = 0;
			return () => ++value;
		})(),
		sleep: async () => undefined,
	});
	let maxActiveEffects = 0;
	let activeEffects = 0;
	try {
		for (let guard = 0; guard < 256; guard += 1) {
			activeEffects += 1;
			maxActiveEffects = Math.max(maxActiveEffects, activeEffects);
			try {
				const execution = await executor.executeNext();
				if (execution === null) break;
				admitD34EffectResult(authority, execution.admitted, execution.result);
			} finally {
				activeEffects -= 1;
			}
		}
	} finally {
		await executor.dispose();
	}
	const evidence = validateD34RetainedSpanEvidence(snapshotD34RetainedSpanEvidence(authority));
	if (
		retainedBodies.length !== 8 ||
		!Buffer.from(retainedBodies[0]!).equals(Buffer.from(retainedBodies[1]!))
	)
		throw new TypeError("D35 retained-span retry wire identity drifted");
	for (const bytes of retainedBodies) {
		const body = record(JSON.parse(Buffer.from(bytes).toString("utf8")), "D35 retained Chat body");
		const toolChoice = record(body.tool_choice, "D35 retained tool choice");
		const choiceFunction = record(toolChoice.function, "D35 retained tool choice function");
		const tools = Array.isArray(body.tools) ? body.tools : [];
		const serializedTools = JSON.stringify(tools);
		const messages = Array.isArray(body.messages) ? body.messages : [];
		const capsule = record(messages.at(-1), "D35 retained final message").content;
		if (
			choiceFunction.name !== "propose_replacement_text" ||
			serializedTools.includes("oldText") ||
			serializedTools.includes(CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK) ||
			!serializedTools.includes("newText") ||
			typeof capsule !== "string" ||
			capsule.includes("oldText") ||
			capsule.includes(CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK)
		)
			throw new TypeError("D35 retained-span wire privacy drifted");
	}
	return Object.freeze({
		evidence,
		transportCalls,
		retainedTransportCalls: retainedBodies.length,
		maxActiveTransport,
		maxActiveEffects,
	});
}

function bundleMaterial(value: Omit<D35QualificationBundleV1, "bundleDigest">) {
	return strictSnapshot(value);
}

export async function runD35InjectedNoNetworkQualification(input: {
	readonly baseline: D35D34BaselineAdmissionV1;
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
}): Promise<D35QualificationBundleV1> {
	const baselineBasis = consumeBaseline(input.baseline);
	const run = await runInjectedRealProvider(input);
	const runs = run.evidence.phaseEvidence.workflowEvidence.providerEvidence.workflowEvidence.runs;
	const retained = run.evidence.facts.filter((fact) => fact.kind === "retained-span");
	const accepted = run.evidence.facts.filter((fact) => fact.disposition === "accepted");
	const cardinality = run.evidence.facts.filter(
		(fact) => fact.disposition === "cardinality-rejected",
	);
	const waits = retryWaitCount(run.evidence);
	const providerAttempts = providerAttemptCount(run.evidence);
	if (
		runs.length !== 6 ||
		runs.some(
			(runEvidence) =>
				runEvidence.status !== "completed" ||
				!runEvidence.publicSemanticValidationPassed ||
				!runEvidence.hiddenVerifierPassed ||
				runEvidence.cleanupStatus !== "completed",
		) ||
		retained.length !== 6 ||
		accepted.length !== 6 ||
		cardinality.length !== 1 ||
		run.transportCalls !== 26 ||
		providerAttempts !== run.transportCalls ||
		run.retainedTransportCalls !== 8 ||
		waits !== 1 ||
		run.maxActiveTransport !== 1 ||
		run.maxActiveEffects !== 1
	)
		throw new TypeError(
			`D35 injected real-provider lifecycle drifted: ${JSON.stringify({
				runs: runs.map((item) => ({
					arm: item.arm,
					status: item.status,
					publicSemanticValidationPassed: item.publicSemanticValidationPassed,
					hiddenVerifierPassed: item.hiddenVerifierPassed,
					cleanupStatus: item.cleanupStatus,
				})),
				retained: retained.length,
				accepted: accepted.length,
				cardinality: cardinality.length,
				transportCalls: run.transportCalls,
				retainedTransportCalls: run.retainedTransportCalls,
				waits,
				providerAttempts,
				maxActiveTransport: run.maxActiveTransport,
				maxActiveEffects: run.maxActiveEffects,
			})}`,
		);
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D35_QUALIFICATION_SCHEMA,
		decisionRef: D35_DECISION_REF,
		d34Baseline: D35_D34_BASELINE,
		implementationManifestDigest: D35_IMPLEMENTATION_MANIFEST_DIGEST,
		evidenceDigest: run.evidence.evidenceDigest,
		exactSixArmsCompleted: true as const,
		retainedSpanCount: 6 as const,
		acceptedNewTextCount: 6 as const,
		cardinalityCorrectionCount: 1 as const,
		injectedTransportCalls: 26 as const,
		retainedSpanTransportCalls: 8 as const,
		retryWaitCount: 1 as const,
		maxActiveEffects: 1 as const,
		maxActiveTransport: 1 as const,
		exactRetainedRetryWireIdentity: true as const,
		exactNamedNewTextOnlyWire: true as const,
		allPublicSemanticPassed: true as const,
		allHiddenVerifierPassed: true as const,
		allCleanupCompleted: true as const,
		providerNetworkCalls: 0 as const,
		persistedRawSourcePatchOrArguments: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		qualified: true as const,
	});
	const qualification = Object.freeze({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: D35_QUALIFICATION_GENERATION_SCHEMA,
		generationRef: D35_QUALIFICATION_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		evidenceDigest: run.evidence.evidenceDigest,
		implementationManifestDigest: D35_IMPLEMENTATION_MANIFEST_DIGEST,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = Object.freeze({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const material = bundleMaterial({
		schemaVersion: D35_QUALIFICATION_BUNDLE_SCHEMA,
		baselineBasis,
		evidence: run.evidence,
		qualification,
		generation,
	});
	const bundle = Object.freeze({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
	constructed.add(bundle);
	return bundle;
}

export function validateD35QualificationBundle(value: unknown): D35QualificationBundleV1 {
	const candidate = record(value, "D35 qualification bundle");
	exactKeys(
		candidate,
		["baselineBasis", "bundleDigest", "evidence", "generation", "qualification", "schemaVersion"],
		"D35 qualification bundle",
	);
	if (
		candidate.schemaVersion !== D35_QUALIFICATION_BUNDLE_SCHEMA ||
		(candidate.baselineBasis !== "consumed-d34-artifact" &&
			candidate.baselineBasis !== "injected-test")
	)
		throw new TypeError("D35 qualification bundle coordinates drifted");
	const evidence = validateD34RetainedSpanEvidence(candidate.evidence);
	const qualification = record(candidate.qualification, "D35 qualification");
	const generation = record(candidate.generation, "D35 generation");
	const qualificationKeys = [
		"acceptedNewTextCount",
		"allCleanupCompleted",
		"allHiddenVerifierPassed",
		"allPublicSemanticPassed",
		"cardinalityCorrectionCount",
		"causalAttribution",
		"d34Baseline",
		"decisionRef",
		"efficacyClaim",
		"evidenceDigest",
		"exactNamedNewTextOnlyWire",
		"exactRetainedRetryWireIdentity",
		"exactSixArmsCompleted",
		"implementationManifestDigest",
		"injectedTransportCalls",
		"maxActiveEffects",
		"maxActiveTransport",
		"persistedRawSourcePatchOrArguments",
		"providerNetworkCalls",
		"qualificationDigest",
		"qualified",
		"retainedSpanCount",
		"retainedSpanTransportCalls",
		"retryWaitCount",
		"schemaVersion",
	] as const;
	exactKeys(qualification, qualificationKeys, "D35 qualification");
	exactKeys(
		generation,
		[
			"causalAttribution",
			"efficacyClaim",
			"evidenceDigest",
			"generationDigest",
			"generationRef",
			"implementationManifestDigest",
			"qualificationDigest",
			"schemaVersion",
		],
		"D35 generation",
	);
	const runs = evidence.phaseEvidence.workflowEvidence.providerEvidence.workflowEvidence.runs;
	const retained = evidence.facts.filter((fact) => fact.kind === "retained-span");
	const accepted = evidence.facts.filter((fact) => fact.disposition === "accepted");
	const cardinality = evidence.facts.filter((fact) => fact.disposition === "cardinality-rejected");
	if (
		qualification.schemaVersion !== D35_QUALIFICATION_SCHEMA ||
		qualification.decisionRef !== D35_DECISION_REF ||
		empiricalStrictJsonDigest(qualification.d34Baseline) !==
			empiricalStrictJsonDigest(D35_D34_BASELINE) ||
		qualification.implementationManifestDigest !== D35_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.evidenceDigest !== evidence.evidenceDigest ||
		qualification.exactSixArmsCompleted !== true ||
		qualification.retainedSpanCount !== 6 ||
		qualification.acceptedNewTextCount !== 6 ||
		qualification.cardinalityCorrectionCount !== 1 ||
		qualification.injectedTransportCalls !== 26 ||
		qualification.retainedSpanTransportCalls !== 8 ||
		qualification.retryWaitCount !== 1 ||
		qualification.maxActiveEffects !== 1 ||
		qualification.maxActiveTransport !== 1 ||
		qualification.exactRetainedRetryWireIdentity !== true ||
		qualification.exactNamedNewTextOnlyWire !== true ||
		qualification.allPublicSemanticPassed !== true ||
		qualification.allHiddenVerifierPassed !== true ||
		qualification.allCleanupCompleted !== true ||
		qualification.providerNetworkCalls !== 0 ||
		qualification.persistedRawSourcePatchOrArguments !== false ||
		qualification.causalAttribution !== "undetermined" ||
		qualification.efficacyClaim !== "none" ||
		qualification.qualified !== true ||
		runs.length !== 6 ||
		runs.some(
			(run) =>
				run.status !== "completed" ||
				!run.publicSemanticValidationPassed ||
				!run.hiddenVerifierPassed ||
				run.cleanupStatus !== "completed",
		) ||
		retained.length !== 6 ||
		accepted.length !== 6 ||
		cardinality.length !== 1 ||
		retryWaitCount(evidence) !== 1 ||
		providerAttemptCount(evidence) !== 26 ||
		generation.schemaVersion !== D35_QUALIFICATION_GENERATION_SCHEMA ||
		generation.generationRef !== D35_QUALIFICATION_GENERATION_REF ||
		generation.qualificationDigest !== qualification.qualificationDigest ||
		generation.evidenceDigest !== evidence.evidenceDigest ||
		generation.implementationManifestDigest !== D35_IMPLEMENTATION_MANIFEST_DIGEST ||
		generation.causalAttribution !== "undetermined" ||
		generation.efficacyClaim !== "none"
	)
		throw new TypeError("D35 qualification semantics drifted");
	const qualificationBase = { ...qualification };
	delete qualificationBase.qualificationDigest;
	if (qualification.qualificationDigest !== empiricalStrictJsonDigest(qualificationBase))
		throw new TypeError("D35 qualification digest drifted");
	const generationBase = { ...generation };
	delete generationBase.generationDigest;
	if (generation.generationDigest !== empiricalStrictJsonDigest(generationBase))
		throw new TypeError("D35 generation digest drifted");
	const rebuiltMaterial = bundleMaterial({
		schemaVersion: D35_QUALIFICATION_BUNDLE_SCHEMA,
		baselineBasis: candidate.baselineBasis,
		evidence,
		qualification: strictSnapshot(qualification) as D35QualificationBundleV1["qualification"],
		generation: strictSnapshot(generation) as D35QualificationBundleV1["generation"],
	});
	const rebuilt = Object.freeze({
		...rebuiltMaterial,
		bundleDigest: empiricalStrictJsonDigest(rebuiltMaterial),
	});
	if (candidate.bundleDigest !== rebuilt.bundleDigest)
		throw new TypeError("D35 qualification bundle digest drifted");
	return rebuilt;
}

export async function persistD35Qualification(input: {
	readonly privateRoot: string;
	readonly bundle: D35QualificationBundleV1;
}) {
	if (!constructed.has(input.bundle as object))
		throw new TypeError("D35 qualification bundle was not constructed in this process");
	constructed.delete(input.bundle as object);
	const bundle = validateD35QualificationBundle(input.bundle);
	if (bundle.baselineBasis !== "consumed-d34-artifact")
		throw new TypeError("D35 production qualification requires consumed D34 artifact bytes");
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: D35_QUALIFICATION_GENERATION_REF,
		artifacts: {
			"bundle.v1.json": strictJsonCodec.encode(bundle as unknown as StrictJsonValue),
			"evidence.v1.json": strictJsonCodec.encode(bundle.evidence as unknown as StrictJsonValue),
			"qualification.v1.json": strictJsonCodec.encode(
				bundle.qualification as unknown as StrictJsonValue,
			),
			"generation.v1.json": strictJsonCodec.encode(bundle.generation as unknown as StrictJsonValue),
		},
		commitBytes: strictJsonCodec.encode(
			strictSnapshot({
				schemaVersion: "graphrefly-ts.d35.retained-span-real-provider-commit.v1",
				generationRef: D35_QUALIFICATION_GENERATION_REF,
				bundleDigest: bundle.bundleDigest,
				qualificationDigest: bundle.qualification.qualificationDigest,
				generationDigest: bundle.generation.generationDigest,
			}) as unknown as StrictJsonValue,
		),
	});
}
