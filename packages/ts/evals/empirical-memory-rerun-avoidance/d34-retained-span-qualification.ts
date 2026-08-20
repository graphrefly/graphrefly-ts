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
	CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE,
	CURRENT_GRAPH_PROVIDER_INJECTED_TASK,
	CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS,
} from "./d6-current-provider-authority.js";
import { validateD27LiveBundle } from "./d27-phase-specific-live.js";
import {
	lowerD34RetainedSpanChatBody,
	projectD34RetainedSpanChatResponse,
} from "./d34-retained-span-chat-wire.js";
import { D34_IMPLEMENTATION_MANIFEST_DIGEST } from "./d34-retained-span-implementation-manifest.js";
import {
	admitD34EffectResult,
	createD34RetainedSpanAuthority,
	D34_DECISION_REF,
	snapshotD34RetainedSpanEvidence,
	takeD34AdmittedEffect,
	validateD34RetainedSpanEvidence,
} from "./d34-retained-span-mutation-authority.js";

export const D34_QUALIFICATION_SCHEMA = "graphrefly-ts.d34.retained-span-qualification.v1" as const;
export const D34_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d34.retained-span-qualification-bundle.v1" as const;
export const D34_QUALIFICATION_GENERATION_SCHEMA =
	"graphrefly-ts.d34.retained-span-qualification-generation.v1" as const;
export const D34_QUALIFICATION_GENERATION_REF =
	"current-graph-native-retained-span-no-network-2026-08-20-d34-v2" as const;
export const D34_D33_BASELINE = Object.freeze({
	artifactDigest:
		"sha256:809349368679d6aa2cf572cc96bcd7a4536ca6a5456a6d311580471f27d85255" as const,
	bundleDigest: "sha256:75ef3be6ea1e65e1af625ec07900344e8cc1f5036fbcd65f74f128abbf155376" as const,
	graphEvidenceDigest:
		"sha256:afb7fb091c81fabec58a9f29fe04e492bcc92eafa433437acfa298d015c8d70e" as const,
	generationDigest:
		"sha256:62561be5639fca4794ccd837fd25b232666bb2aa72fdbef4ee4bdb0fb3ca0574" as const,
});

export interface D34D33BaselineAdmissionV1 {
	readonly revision: "graphrefly-ts.d34.d33-baseline-admission.v1";
}

export interface D34QualificationBundleV1 {
	readonly schemaVersion: typeof D34_QUALIFICATION_BUNDLE_SCHEMA;
	readonly baselineBasis: "consumed-d33-artifact" | "injected-test";
	readonly evidence: ReturnType<typeof validateD34RetainedSpanEvidence>;
	readonly qualification: Readonly<{
		schemaVersion: typeof D34_QUALIFICATION_SCHEMA;
		decisionRef: typeof D34_DECISION_REF;
		d33Baseline: typeof D34_D33_BASELINE;
		implementationManifestDigest: typeof D34_IMPLEMENTATION_MANIFEST_DIGEST;
		evidenceDigest: string;
		exactSixArmsCompleted: true;
		retainedSpanCount: 6;
		acceptedNewTextCount: 6;
		cardinalityRejectionCount: 1;
		cardinalityCorrectionCount: 1;
		allPublicSemanticPassed: true;
		allHiddenVerifierPassed: true;
		allCleanupCompleted: true;
		providerNetworkCalls: 0;
		maxActiveEffects: 1;
		exactNewTextOnlyWirePassed: true;
		retryWireIdentityPassed: true;
		persistedRawSourceOrPatch: false;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		qualified: true;
		qualificationDigest: string;
	}>;
	readonly generation: Readonly<{
		schemaVersion: typeof D34_QUALIFICATION_GENERATION_SCHEMA;
		generationRef: typeof D34_QUALIFICATION_GENERATION_REF;
		qualificationDigest: string;
		evidenceDigest: string;
		implementationManifestDigest: typeof D34_IMPLEMENTATION_MANIFEST_DIGEST;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

const baselines = new WeakMap<object, D34QualificationBundleV1["baselineBasis"]>();
const constructed = new WeakSet<object>();

function baselineCapability(basis: D34QualificationBundleV1["baselineBasis"]) {
	const capability = Object.freeze({
		revision: "graphrefly-ts.d34.d33-baseline-admission.v1" as const,
	});
	baselines.set(capability, basis);
	return capability;
}

export function admitD34D33Baseline(bytesValue: Uint8Array): D34D33BaselineAdmissionV1 {
	if (!(bytesValue instanceof Uint8Array))
		throw new TypeError("D34 D33 baseline bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D34_D33_BASELINE.artifactDigest)
		throw new TypeError("D34 D33 baseline artifact drifted");
	const bundle = validateD27LiveBundle(strictJsonCodec.decode(bytes));
	if (
		bundle.disposition !== "success" ||
		bundle.bundleDigest !== D34_D33_BASELINE.bundleDigest ||
		bundle.graphEvidence?.evidenceDigest !== D34_D33_BASELINE.graphEvidenceDigest ||
		bundle.generation?.generationDigest !== D34_D33_BASELINE.generationDigest ||
		bundle.efficacyClaim !== "none"
	)
		throw new TypeError("D34 D33 baseline coordinates drifted");
	return baselineCapability("consumed-d33-artifact");
}

export function createD34InjectedBaselineForTest(): D34D33BaselineAdmissionV1 {
	return baselineCapability("injected-test");
}

function consumeBaseline(value: D34D33BaselineAdmissionV1) {
	const basis = baselines.get(value as object);
	baselines.delete(value as object);
	if (basis === undefined) throw new TypeError("D34 D33 baseline is forged or replayed");
	return basis;
}

function digest(value: unknown) {
	return empiricalStrictJsonDigest(value);
}

function usage(label: unknown) {
	return Object.freeze({
		requests: 1 as const,
		inputTokens: 10,
		outputTokens: 2,
		cacheReadTokens: 0,
		actualCostMicrousd: 1,
		actualElapsedMs: 1,
		costBasis: "reported" as const,
		evidenceDigest: digest(label),
	});
}

function providerResult(label: unknown, toolCalls: readonly unknown[]) {
	const measured = usage(label);
	return Object.freeze({
		effectKind: "provider-request" as const,
		status: "completed" as const,
		toolCalls,
		failureCode: null,
		retryProposal: null,
		usage: {
			requests: measured.requests,
			inputTokens: measured.inputTokens,
			outputTokens: measured.outputTokens,
			cacheReadTokens: measured.cacheReadTokens,
			actualCostMicrousd: measured.actualCostMicrousd,
			actualElapsedMs: measured.actualElapsedMs,
			costBasis: measured.costBasis,
		},
		evidenceDigest: measured.evidenceDigest,
	});
}

function validateInjectedWireQualification() {
	const base = strictSnapshot({
		schemaVersion: "graphrefly-ts.d34.retained-span-mutation-directive.v1" as const,
		requestDigest: digest({ wire: "request" }),
		admissionDigest: digest({ wire: "admission" }),
		arm: "cold" as const,
		runSequence: 0,
		workspaceStateDigest: digest({ wire: "workspace" }),
		spanFactDigest: digest({ wire: "span-fact" }),
		spanDigest: digest({ wire: "span" }),
		spanBytes: 19,
		namedToolName: "propose_replacement_text" as const,
		maxProposalCount: 1 as const,
		maxNewTextBytes: 131_072 as const,
	});
	const directive = Object.freeze({ ...base, directiveDigest: digest(base) });
	const original = Buffer.from(
		JSON.stringify({
			model: "injected",
			messages: [{ role: "user", content: "repair the admitted current span" }],
			tools: [
				{
					type: "function",
					function: {
						name: "replace_exact",
						description: "replace an exact span",
						parameters: { type: "object" },
					},
				},
			],
			tool_choice: { type: "function", function: { name: "replace_exact" } },
		}),
	);
	const first = lowerD34RetainedSpanChatBody({ bodyBytes: original, directive });
	const retry = lowerD34RetainedSpanChatBody({ bodyBytes: original, directive });
	const decoded = record(
		JSON.parse(Buffer.from(first.bytes).toString("utf8")),
		"D34 injected lowered wire",
	);
	const serialized = JSON.stringify(decoded);
	if (
		!Buffer.from(first.bytes).equals(Buffer.from(retry.bytes)) ||
		serialized.includes("oldText") ||
		serialized.includes("const stale = true;") ||
		!serialized.includes("propose_replacement_text")
	)
		throw new TypeError("D34 injected wire lowering drifted");
	const projection = projectD34RetainedSpanChatResponse({
		directive,
		responseBytes: Buffer.from(
			JSON.stringify({
				choices: [
					{
						message: {
							tool_calls: [
								{
									type: "function",
									function: {
										name: "propose_replacement_text",
										arguments: JSON.stringify({ newText: "const fixed = true;" }),
									},
								},
							],
						},
					},
				],
			}),
		),
	});
	if (projection.proposalCount !== 1 || projection.newTextProposals.length !== 1)
		throw new TypeError("D34 injected wire projection drifted");
	return Object.freeze({
		exactNewTextOnlyWirePassed: true as const,
		retryWireIdentityPassed: true as const,
	});
}

async function runInjectedEvidence() {
	const authority = createD34RetainedSpanAuthority({
		limits: CURRENT_GRAPH_PROVIDER_QUALIFICATION_LIMITS,
		routeProfile: CURRENT_GRAPH_PROVIDER_INJECTED_ROUTE,
		taskProfile: CURRENT_GRAPH_PROVIDER_INJECTED_TASK,
	});
	const workspaceByArm = new Map<string, string>();
	let cardinalityInjected = false;
	let activeEffects = 0;
	let maxActiveEffects = 0;
	for (let guard = 0; guard < 256; guard += 1) {
		const admitted = takeD34AdmittedEffect(authority);
		if (admitted === null)
			return Object.freeze({
				evidence: validateD34RetainedSpanEvidence(snapshotD34RetainedSpanEvidence(authority)),
				maxActiveEffects,
			});
		activeEffects += 1;
		maxActiveEffects = Math.max(maxActiveEffects, activeEffects);
		const effect = admitted.effect.effect;
		const request = effect.request;
		const key = `${request.arm}-${request.runSequence}`;
		const current = workspaceByArm.get(key) ?? digest({ key, state: "initial" });
		workspaceByArm.set(key, current);
		try {
			if (request.effectKind === "materialization") {
				admitD34EffectResult(authority, admitted, {
					effectKind: "materialization",
					status: "completed",
					workspaceStateDigest: current,
					evidenceDigest: digest({ key, materialized: true }),
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
				});
				continue;
			}
			if (request.effectKind === "provider-request") {
				if (admitted.retainedSpanDirective !== null) {
					const useCardinality: boolean = request.arm === "cold" && !cardinalityInjected;
					if (useCardinality) cardinalityInjected = true;
					const measured = usage({ key, useCardinality });
					admitD34EffectResult(authority, admitted, {
						effectKind: "provider-request",
						status: "completed",
						newTextProposals: useCardinality
							? ["const fixed = true;", "const duplicate = true;"]
							: [`const fixed_${request.arm.replaceAll("-", "_")} = true;`],
						usage: {
							requests: measured.requests,
							inputTokens: measured.inputTokens,
							outputTokens: measured.outputTokens,
							cacheReadTokens: measured.cacheReadTokens,
							actualCostMicrousd: measured.actualCostMicrousd,
							actualElapsedMs: measured.actualElapsedMs,
							costBasis: measured.costBasis,
						},
						evidenceDigest: measured.evidenceDigest,
					});
					continue;
				}
				const named = admitted.effect.phaseDirective?.namedToolRef;
				admitD34EffectResult(
					authority,
					admitted,
					named === "read-file"
						? providerResult({ key, named }, [{ toolRef: "read-file", path: "src/current.ts" }])
						: providerResult({ key, named }, [
								{
									toolRef: "replace-exact",
									path: "src/current.ts",
									oldText: "const stale = true;",
									newText: "const stale = true;",
								},
							]),
				);
				continue;
			}
			if (request.effectKind === "tool-action") {
				const args = effect.runtime.toolArguments;
				if (args === null) throw new TypeError("D34 injected tool arguments are missing");
				if (args.toolRef === "read-file")
					admitD34EffectResult(authority, admitted, {
						effectKind: "tool-action",
						toolRef: "read-file",
						status: "succeeded",
						causeCode: null,
						workspaceStateBeforeDigest: current,
						workspaceStateAfterDigest: current,
						nonEmptyDiff: false,
						evidenceDigest: digest({ key, read: true }),
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
					});
				else if (args.toolRef === "replace-exact") {
					const unchanged = args.oldText === args.newText;
					const after = unchanged ? current : digest({ current, newText: args.newText });
					workspaceByArm.set(key, after);
					admitD34EffectResult(authority, admitted, {
						effectKind: "tool-action",
						toolRef: "replace-exact",
						status: unchanged ? "failed" : "succeeded",
						causeCode: unchanged ? "exact-replacement-unchanged" : null,
						workspaceStateBeforeDigest: current,
						workspaceStateAfterDigest: after,
						nonEmptyDiff: !unchanged,
						evidenceDigest: digest({ key, unchanged, after }),
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
					});
				} else
					admitD34EffectResult(authority, admitted, {
						effectKind: "tool-action",
						toolRef: args.toolRef,
						status: "succeeded",
						causeCode: null,
						workspaceStateBeforeDigest: current,
						workspaceStateAfterDigest: current,
						nonEmptyDiff: args.toolRef === "workspace-diff",
						evidenceDigest: digest({ key, toolRef: args.toolRef }),
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
					});
				continue;
			}
			if (request.effectKind === "public-semantic-validation")
				admitD34EffectResult(authority, admitted, {
					effectKind: "public-semantic-validation",
					status: "passed",
					criterionFailures: [],
					workspaceStateDigest: current,
					evidenceDigest: digest({ key, semantic: true }),
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
				});
			else if (request.effectKind === "hidden-verifier")
				admitD34EffectResult(authority, admitted, {
					effectKind: "hidden-verifier",
					status: "passed",
					workspaceStateDigest: current,
					evidenceDigest: digest({ key, hidden: true }),
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
				});
			else
				admitD34EffectResult(authority, admitted, {
					effectKind: "cleanup",
					status: "completed",
					workspaceStateDigest: null,
					evidenceDigest: digest({ key, cleanup: true }),
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
				});
		} finally {
			activeEffects -= 1;
		}
	}
	throw new TypeError("D34 injected qualification exceeded its effect bound");
}

function bundleMaterial(value: Omit<D34QualificationBundleV1, "bundleDigest">) {
	return strictSnapshot(value);
}

export async function runD34InjectedNoNetworkQualification(input: {
	readonly baseline: D34D33BaselineAdmissionV1;
}): Promise<D34QualificationBundleV1> {
	const baselineBasis = consumeBaseline(input.baseline);
	const { evidence, maxActiveEffects } = await runInjectedEvidence();
	const wire = validateInjectedWireQualification();
	const runs = evidence.phaseEvidence.workflowEvidence.providerEvidence.workflowEvidence.runs;
	const retained = evidence.facts.filter((fact) => fact.kind === "retained-span");
	const accepted = evidence.facts.filter((fact) => fact.disposition === "accepted");
	const cardinality = evidence.facts.filter((fact) => fact.disposition === "cardinality-rejected");
	if (
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
		maxActiveEffects !== 1
	)
		throw new TypeError("D34 injected qualification lifecycle drifted");
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D34_QUALIFICATION_SCHEMA,
		decisionRef: D34_DECISION_REF,
		d33Baseline: D34_D33_BASELINE,
		implementationManifestDigest: D34_IMPLEMENTATION_MANIFEST_DIGEST,
		evidenceDigest: evidence.evidenceDigest,
		exactSixArmsCompleted: true as const,
		retainedSpanCount: 6 as const,
		acceptedNewTextCount: 6 as const,
		cardinalityRejectionCount: 1 as const,
		cardinalityCorrectionCount: 1 as const,
		allPublicSemanticPassed: true as const,
		allHiddenVerifierPassed: true as const,
		allCleanupCompleted: true as const,
		providerNetworkCalls: 0 as const,
		maxActiveEffects: 1 as const,
		exactNewTextOnlyWirePassed: wire.exactNewTextOnlyWirePassed,
		retryWireIdentityPassed: wire.retryWireIdentityPassed,
		persistedRawSourceOrPatch: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		qualified: true as const,
	});
	const qualification = Object.freeze({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: D34_QUALIFICATION_GENERATION_SCHEMA,
		generationRef: D34_QUALIFICATION_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		evidenceDigest: evidence.evidenceDigest,
		implementationManifestDigest: D34_IMPLEMENTATION_MANIFEST_DIGEST,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = Object.freeze({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const material = bundleMaterial({
		schemaVersion: D34_QUALIFICATION_BUNDLE_SCHEMA,
		baselineBasis,
		evidence,
		qualification,
		generation,
	});
	const bundle = Object.freeze({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
	constructed.add(bundle);
	return bundle;
}

export function validateD34QualificationBundle(value: unknown): D34QualificationBundleV1 {
	const candidate = record(value, "D34 qualification bundle");
	exactKeys(
		candidate,
		["baselineBasis", "bundleDigest", "evidence", "generation", "qualification", "schemaVersion"],
		"D34 qualification bundle",
	);
	if (
		candidate.schemaVersion !== D34_QUALIFICATION_BUNDLE_SCHEMA ||
		(candidate.baselineBasis !== "consumed-d33-artifact" &&
			candidate.baselineBasis !== "injected-test")
	)
		throw new TypeError("D34 qualification bundle coordinates drifted");
	const evidence = validateD34RetainedSpanEvidence(candidate.evidence);
	const runs = evidence.phaseEvidence.workflowEvidence.providerEvidence.workflowEvidence.runs;
	const qualification = record(candidate.qualification, "D34 qualification");
	const generation = record(candidate.generation, "D34 qualification generation");
	exactKeys(
		qualification,
		[
			"acceptedNewTextCount",
			"allCleanupCompleted",
			"allHiddenVerifierPassed",
			"allPublicSemanticPassed",
			"cardinalityCorrectionCount",
			"cardinalityRejectionCount",
			"causalAttribution",
			"d33Baseline",
			"decisionRef",
			"efficacyClaim",
			"evidenceDigest",
			"exactNewTextOnlyWirePassed",
			"exactSixArmsCompleted",
			"implementationManifestDigest",
			"maxActiveEffects",
			"persistedRawSourceOrPatch",
			"providerNetworkCalls",
			"qualificationDigest",
			"qualified",
			"retainedSpanCount",
			"retryWireIdentityPassed",
			"schemaVersion",
		],
		"D34 qualification",
	);
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
		"D34 qualification generation",
	);
	if (
		qualification.schemaVersion !== D34_QUALIFICATION_SCHEMA ||
		qualification.decisionRef !== D34_DECISION_REF ||
		qualification.implementationManifestDigest !== D34_IMPLEMENTATION_MANIFEST_DIGEST ||
		empiricalStrictJsonDigest(qualification.d33Baseline) !==
			empiricalStrictJsonDigest(D34_D33_BASELINE) ||
		qualification.evidenceDigest !== evidence.evidenceDigest ||
		qualification.exactSixArmsCompleted !== true ||
		qualification.retainedSpanCount !== 6 ||
		qualification.acceptedNewTextCount !== 6 ||
		qualification.cardinalityRejectionCount !== 1 ||
		qualification.cardinalityCorrectionCount !== 1 ||
		qualification.allPublicSemanticPassed !== true ||
		qualification.allHiddenVerifierPassed !== true ||
		qualification.allCleanupCompleted !== true ||
		qualification.providerNetworkCalls !== 0 ||
		qualification.maxActiveEffects !== 1 ||
		qualification.exactNewTextOnlyWirePassed !== true ||
		qualification.retryWireIdentityPassed !== true ||
		qualification.persistedRawSourceOrPatch !== false ||
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
		generation.schemaVersion !== D34_QUALIFICATION_GENERATION_SCHEMA ||
		generation.generationRef !== D34_QUALIFICATION_GENERATION_REF ||
		generation.qualificationDigest !== qualification.qualificationDigest ||
		generation.evidenceDigest !== evidence.evidenceDigest ||
		generation.implementationManifestDigest !== D34_IMPLEMENTATION_MANIFEST_DIGEST ||
		generation.causalAttribution !== "undetermined" ||
		generation.efficacyClaim !== "none"
	)
		throw new TypeError("D34 qualification semantics drifted");
	const qualificationBase = { ...qualification };
	delete qualificationBase.qualificationDigest;
	if (qualification.qualificationDigest !== empiricalStrictJsonDigest(qualificationBase))
		throw new TypeError("D34 qualification digest drifted");
	const generationBase = { ...generation };
	delete generationBase.generationDigest;
	if (generation.generationDigest !== empiricalStrictJsonDigest(generationBase))
		throw new TypeError("D34 qualification generation digest drifted");
	const rebuiltMaterial = bundleMaterial({
		schemaVersion: D34_QUALIFICATION_BUNDLE_SCHEMA,
		baselineBasis: candidate.baselineBasis,
		evidence,
		qualification: strictSnapshot(qualification) as D34QualificationBundleV1["qualification"],
		generation: strictSnapshot(generation) as D34QualificationBundleV1["generation"],
	});
	const rebuilt = Object.freeze({
		...rebuiltMaterial,
		bundleDigest: empiricalStrictJsonDigest(rebuiltMaterial),
	});
	if (candidate.bundleDigest !== rebuilt.bundleDigest)
		throw new TypeError("D34 qualification bundle digest drifted");
	return rebuilt;
}

export async function persistD34Qualification(input: {
	readonly privateRoot: string;
	readonly bundle: D34QualificationBundleV1;
}) {
	if (!constructed.has(input.bundle as object))
		throw new TypeError("D34 qualification bundle was not constructed in this process");
	constructed.delete(input.bundle as object);
	const bundle = validateD34QualificationBundle(input.bundle);
	if (bundle.baselineBasis !== "consumed-d33-artifact")
		throw new TypeError("D34 production qualification requires consumed D33 artifact bytes");
	const artifacts = {
		"bundle.v1.json": strictJsonCodec.encode(bundle as unknown as StrictJsonValue),
		"evidence.v1.json": strictJsonCodec.encode(bundle.evidence as unknown as StrictJsonValue),
		"qualification.v1.json": strictJsonCodec.encode(
			bundle.qualification as unknown as StrictJsonValue,
		),
		"generation.v1.json": strictJsonCodec.encode(bundle.generation as unknown as StrictJsonValue),
	};
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: D34_QUALIFICATION_GENERATION_REF,
		artifacts,
		commitBytes: strictJsonCodec.encode(
			strictSnapshot({
				schemaVersion: "graphrefly-ts.d34.retained-span-qualification-commit.v1",
				generationRef: D34_QUALIFICATION_GENERATION_REF,
				bundleDigest: bundle.bundleDigest,
				qualificationDigest: bundle.qualification.qualificationDigest,
				generationDigest: bundle.generation.generationDigest,
			}) as unknown as StrictJsonValue,
		),
	});
}
