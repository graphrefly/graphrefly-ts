import { constants } from "node:fs";
import { chmod, mkdtemp, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";
import {
	createD43ModelHarnessPolicy,
	createD43PolicyCatalog,
	D43_ARMS,
	D43_ENHANCEMENT_RECIPES,
} from "./d43-model-harness-policy.js";
import {
	admitD45EffectResult,
	createD45GraphToolAuthority,
	type D45AdmittedEffectV1,
	type D45CanonicalEvidenceV1,
	type D45EffectResultInputV1,
	type D45PartialCanonicalEvidenceV1,
	d45TaskEnvelopeDigest,
	readD45ToolArguments,
	snapshotD45CanonicalEvidence,
	snapshotD45PartialCanonicalEvidence,
	takeD45AdmittedEffect,
	validateD45CanonicalEvidence,
	validateD45PartialCanonicalEvidence,
} from "./d45-graph-tool-authority.js";
import {
	lowerD45ProviderEffect,
	parseD45ChatProviderResponse,
} from "./d45-mechanical-chat-adapter.js";

export const D45_QUALIFICATION_SCHEMA = "graphrefly-ts.d45.qualification.v1" as const;
export const D45_QUALIFICATION_BUNDLE_SCHEMA = "graphrefly-ts.d45.qualification-bundle.v1" as const;
export const D45_QUALIFICATION_GENERATION_REF =
	"current-graph-native-tool-admission-2026-08-21-d45-v2" as const;
export const D45_PARTIAL_GENERATION_REF =
	"current-graph-native-tool-admission-partial-2026-08-21-d45-v2" as const;

export const D45_READABLE_PATHS = Object.freeze([
	"packages/ts/src/executors/managed-cloud-postgresql.ts",
	"packages/ts/src/executors/managed-untrusted-js-compute.ts",
	"packages/ts/src/identity.ts",
	"packages/ts/src/orchestration/agent-runtime-tool-provider-run-admission.ts",
] as const);
export const D45_WRITABLE_PATH = D45_READABLE_PATHS[0];
export const D45_SYSTEM_INSTRUCTION =
	"You are editing a bounded TypeScript workspace. Use only the named tool selected by Graph. Inspect before mutation and make the smallest exact replacement. Never invent file contents or claim verification; Graph separately admits diff and validation effects." as const;
export const D45_TASK_STATEMENT =
	"Managed cloud PostgreSQL must admit only producer-owned canonical run-admission proposal provenance before a worker claim. Inspect the producer contract and canonical identity helpers, then make the smallest consumer change that accepts the valid canonical proposal and rejects malformed or locally reconstructed proposal provenance.\n\nAcceptance criteria:\n1. A fresh producer-owned canonical run-admission proposal is admitted before worker claim.\n2. Malformed and non-canonical proposal provenance is rejected before store mutation.\n3. Locally reconstructed proposal provenance that disagrees with the producer ref is rejected.\n4. Authorization, fencing, lease, credential and claim invariants remain intact.\n5. Only packages/ts/src/executors/managed-cloud-postgresql.ts changes." as const;

const ARM_CONTEXTS = Object.freeze({
	cold: "Frozen evaluation arm: cold. Memory disposition: none. No admitted memory insight content.",
	"relevant-applied":
		"Frozen evaluation arm: relevant-applied. Memory disposition: admitted-applied. When accepting a producer-owned canonical proposal, preserve its proposal coordinate separately from the later admission coordinate and reject any locally reconstructed or mismatched provenance before mutation. A producer proposal identifier is a bounded compound authority identifier, not an ordinary safe string; validate it with the canonical compound-authority boundary before comparing it to sourceRefs.",
	"proposal-only":
		"Frozen evaluation arm: proposal-only. Memory disposition: proposal-unadmitted. No admitted memory insight content.",
	"admission-rejected":
		"Frozen evaluation arm: admission-rejected. Memory disposition: admission-rejected. No admitted memory insight content.",
	"irrelevant-applied":
		"Frozen evaluation arm: irrelevant-applied. Memory disposition: admitted-applied. When a bounded retry is admitted, reconcile every transport attempt independently and retain the original logical-request coordinate across the serial retry.",
	"wrong-scope-applied":
		"Frozen evaluation arm: wrong-scope-applied. Memory disposition: admitted-applied. For managed untrusted compute, cancellation ownership must be established before releasing executor capacity to a replacement task.",
} satisfies Record<(typeof D43_ARMS)[number], string>);

export const D45_TASK_MATERIAL = Object.freeze({
	systemInstruction: D45_SYSTEM_INSTRUCTION,
	taskStatement: D45_TASK_STATEMENT,
	armContexts: ARM_CONTEXTS,
	readablePaths: D45_READABLE_PATHS,
	writablePath: D45_WRITABLE_PATH,
});

export const D45_TASK_ENVELOPE_DIGEST = d45TaskEnvelopeDigest(D45_TASK_MATERIAL);

export const D45_ASSIGNMENT = Object.freeze({
	assignmentRef: "assignment.deepseek-deepinfra-fp8.d45",
	modelRef: "deepseek/deepseek-v4-flash-0731",
	providerRef: "deepinfra/fp8",
	campaignRef: "campaign.memory-rerun-avoidance.six-arm.d45-v1",
});

export const D45_PUBLIC_SEMANTIC_SCENARIOS = Object.freeze(
	[
		Object.freeze({
			criterion: "actor-visible-behavior-changed" as const,
			scenarioRef: "d45/fresh-producer-proposal-before-worker-claim",
			description:
				"A fresh producer-owned canonical proposal is admitted before any worker claim side effect.",
		}),
		Object.freeze({
			criterion: "acceptance-criteria-satisfied" as const,
			scenarioRef: "d45/malformed-provenance-rejected-before-store-mutation",
			description:
				"Malformed or non-canonical proposal provenance is rejected before store mutation.",
		}),
		Object.freeze({
			criterion: "scope-preserved" as const,
			scenarioRef: "d45/reconstructed-provenance-disagreement-rejected",
			description:
				"A locally reconstructed proposal that disagrees with the producer ref is rejected.",
		}),
		Object.freeze({
			criterion: "regression-free" as const,
			scenarioRef: "d45/claim-invariants-and-write-scope-preserved",
			description:
				"Authorization, fencing, lease, credential and claim invariants hold and only the allowed file changes.",
		}),
	].map((item) => Object.freeze({ ...item, scenarioDigest: empiricalStrictJsonDigest(item) })),
);

export const D45_PUBLIC_SEMANTIC_SCENARIO_SET_DIGEST = empiricalStrictJsonDigest(
	D45_PUBLIC_SEMANTIC_SCENARIOS.map(({ criterion, scenarioRef, scenarioDigest }) => ({
		criterion,
		scenarioRef,
		scenarioDigest,
	})),
);

export function createD45QualificationPolicy() {
	return createD43ModelHarnessPolicy({
		policyRef: "model-policy.deepseek-v4-flash-0731.deepinfra-fp8.d45-v1",
		model: {
			profileRef: "model-profile.deepseek-v4-flash-0731.d45-v1",
			modelRef: D45_ASSIGNMENT.modelRef,
			supportsNamedToolChoice: true,
			supportsParallelToolCalls: false,
			inspectionMaxOutputTokens: 65_536,
			mutationMaxOutputTokens: 16_384,
		},
		provider: {
			bindingRef: "provider-binding.deepinfra-fp8-chat.d45-v1",
			providerRef: D45_ASSIGNMENT.providerRef,
			endpointProtocol: "chat-completions",
			namedToolChoiceEncoding: "function-object",
			allowFallback: false,
			allowProviderSwitch: false,
			allowParallelEffects: false,
			providerDeadlineMs: 600_000,
		},
		campaign: {
			campaignRef: D45_ASSIGNMENT.campaignRef,
			arms: D43_ARMS,
			maxProviderAttempts: 96,
			maxCostMicrousd: 6_000_000,
			maxElapsedMs: 7_200_000,
			localEffectReservationMs: 10_000,
			providerReservationMicrousd: 100_000,
			publicSemanticScenarioSetDigest: D45_PUBLIC_SEMANTIC_SCENARIO_SET_DIGEST,
			taskEnvelopeDigest: D45_TASK_ENVELOPE_DIGEST,
			maxSameLogicalRequestRetries: 1,
			retryClasses: ["D671", "D675", "D710"],
		},
		enhancementRecipes: D43_ENHANCEMENT_RECIPES,
	});
}

export interface D45QualificationBundleV1 {
	readonly schemaVersion: typeof D45_QUALIFICATION_BUNDLE_SCHEMA;
	readonly mainEvidence: D45CanonicalEvidenceV1;
	readonly recoveryEvidence: D45CanonicalEvidenceV1;
	readonly retryEvidence: D45CanonicalEvidenceV1;
	readonly failureEvidence: D45CanonicalEvidenceV1;
	readonly partialEvidence: D45PartialCanonicalEvidenceV1;
	readonly qualification: Readonly<{
		readonly schemaVersion: typeof D45_QUALIFICATION_SCHEMA;
		readonly decisionRef: "graphrefly-ts:D45";
		readonly mainEvidenceDigest: string;
		readonly recoveryEvidenceDigest: string;
		readonly retryEvidenceDigest: string;
		readonly failureEvidenceDigest: string;
		readonly partialEvidenceDigest: string;
		readonly exactSixArmScenarios: 4;
		readonly mainFrozenGateWouldPass: true;
		readonly proposalToolBijection: true;
		readonly oneToFourInspectionReadsObserved: true;
		readonly exactSingleMutationObserved: true;
		readonly allProposalRejectionCodesObserved: true;
		readonly exactReplacementRejectionsObserved: true;
		readonly exactRetryWireIdentity: true;
		readonly failureSixArmsCompleted: true;
		readonly cleanupCompletedAfterFailure: true;
		readonly conservativeReservationObserved: true;
		readonly partialCanonicalEvidenceValidated: true;
		readonly partialAtomicPersistenceQualified: true;
		readonly workspaceFreshnessPreAdmissionObserved: true;
		readonly toolFailureObserved: true;
		readonly retryExhaustionObserved: true;
		readonly rawChatAdapterQualified: true;
		readonly rawMaterialPersisted: false;
		readonly historicalRuntimeDependencies: 0;
		readonly providerNetworkCalls: 0;
		readonly credentialReads: 0;
		readonly dispatchClaims: 0;
		readonly liveGateEvaluated: false;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly qualificationDigest: string;
	}>;
	readonly bundleDigest: string;
}

export interface D45QualificationPersistenceReceiptV1 {
	readonly generationRef: typeof D45_QUALIFICATION_GENERATION_REF;
	readonly bundleArtifactDigest: string;
	readonly commitArtifactDigest: string;
	readonly receiptDigest: string;
}

export interface D45PartialPersistenceReceiptV1 {
	readonly generationRef: typeof D45_PARTIAL_GENERATION_REF;
	readonly evidenceArtifactDigest: string;
	readonly commitArtifactDigest: string;
	readonly receiptDigest: string;
}

const ORIGINAL = "const canonicalProposal = candidate.proposalRef;";
const REPLACEMENT =
	"const canonicalProposal = candidate.proposalRef;\n\tassertProducerOwnedCanonicalProposal(canonicalProposal);";

function initialFiles() {
	return new Map<string, string>([
		[
			D45_WRITABLE_PATH,
			`const producerOwned = new WeakSet();\nfunction createProposal(proposalId) { const proposalRef = { proposalId }; producerOwned.add(proposalRef); return { proposalRef }; }\nfunction assertProducerOwnedCanonicalProposal(proposalRef) { if (!producerOwned.has(proposalRef)) throw new TypeError("non-canonical proposal provenance"); }\nfunction admit(candidate, events) {\n\t${ORIGINAL}\n\tevents.push("proposal-admitted", "worker-claim", "store-mutation");\n\treturn canonicalProposal;\n}\nreturn { createProposal, admit };\n`,
		],
		[D45_READABLE_PATHS[1], "export const untrustedCompute = true;\n"],
		[D45_READABLE_PATHS[2], "export const canonicalIdentity = Symbol.for('canonical');\n"],
		[
			D45_READABLE_PATHS[3],
			"export interface ProducerOwnedCanonicalProposal { proposalRef: string }\n",
		],
	]);
}

function workspaceDigest(files: ReadonlyMap<string, string>): string {
	return empiricalStrictJsonDigest([...files.entries()]);
}

function executeInjectedPublicSemanticScenarios(
	files: ReadonlyMap<string, string>,
): readonly boolean[] {
	const source = files.get(D45_WRITABLE_PATH);
	if (source === undefined) return Object.freeze([false, false, false, false]);
	let actor: {
		readonly createProposal: (proposalId: string) => { readonly proposalRef: object };
		readonly admit: (candidate: { proposalRef?: unknown }, events: string[]) => unknown;
	};
	try {
		actor = Function(`"use strict";\n${source}`)() as typeof actor;
	} catch {
		return Object.freeze([false, false, false, false]);
	}
	const events: string[] = [];
	const invariants = { authorization: 1, fencing: 1, lease: 1, credential: 1 };
	const valid = actor.createProposal("proposal/fresh");
	actor.admit(valid, events);
	const freshOrdering =
		events.indexOf("proposal-admitted") < events.indexOf("worker-claim") &&
		events.indexOf("worker-claim") < events.indexOf("store-mutation");
	const beforeMalformed = events.length;
	let malformedRejected = false;
	try {
		actor.admit({ proposalRef: 7 }, events);
	} catch {
		malformedRejected = true;
	}
	malformedRejected = malformedRejected && events.length === beforeMalformed;
	const beforeReconstructed = events.length;
	let reconstructedRejected = false;
	try {
		actor.admit({ proposalRef: { ...valid.proposalRef } }, events);
	} catch {
		reconstructedRejected = true;
	}
	reconstructedRejected = reconstructedRejected && events.length === beforeReconstructed;
	const invariantsPreserved =
		invariants.authorization === 1 &&
		invariants.fencing === 1 &&
		invariants.lease === 1 &&
		invariants.credential === 1 &&
		[...files.entries()].every(
			([path, content]) => path === D45_WRITABLE_PATH || content === initialFiles().get(path),
		);
	return Object.freeze([
		freshOrdering,
		malformedRejected,
		reconstructedRejected,
		invariantsPreserved,
	]);
}

function semanticCriteria(effect: D45AdmittedEffectV1, files: ReadonlyMap<string, string>) {
	const outcomes = executeInjectedPublicSemanticScenarios(files);
	return Object.freeze({
		scenarioSetDigest: D45_PUBLIC_SEMANTIC_SCENARIO_SET_DIGEST,
		observations: Object.freeze(
			D45_PUBLIC_SEMANTIC_SCENARIOS.map((scenario, index) =>
				Object.freeze({
					criterion: scenario.criterion,
					scenarioRef: scenario.scenarioRef,
					scenarioDigest: scenario.scenarioDigest,
					observationDigest: empiricalStrictJsonDigest({
						arm: effect.arm,
						phase: effect.phase,
						scenarioDigest: scenario.scenarioDigest,
						passed: outcomes[index] === true,
					}),
					freshnessDigest: empiricalStrictJsonDigest({
						requestDigest: effect.sourceD43RequestDigest,
						sequence: effect.sourceD43Sequence,
					}),
					passed: outcomes[index] === true,
				}),
			),
		),
	});
}

type RecoveryKind =
	| "unchanged"
	| "not-found"
	| "not-unique"
	| "wrong-tool"
	| "path-not-allowed"
	| "cardinality";

const RECOVERY_BY_ARM = Object.freeze({
	cold: "unchanged",
	"relevant-applied": "not-found",
	"proposal-only": "not-unique",
	"admission-rejected": "wrong-tool",
	"irrelevant-applied": "path-not-allowed",
	"wrong-scope-applied": "cardinality",
} satisfies Record<(typeof D43_ARMS)[number], RecoveryKind>);

function nextInjectedReadPath(body: string): string {
	const request = JSON.parse(body) as {
		readonly tools: readonly [
			Readonly<{
				readonly function: Readonly<{
					readonly parameters: Readonly<{
						readonly properties: Readonly<{
							readonly path: Readonly<{ readonly enum: readonly string[] }>;
						}>;
					}>;
				}>;
			}>,
		];
	};
	const path = request.tools[0].function.parameters.properties.path.enum[0];
	if (path === undefined) throw new TypeError("D50 injected inspection omitted unread path");
	return path;
}

async function runScenario(
	mode: "main" | "recovery" | "retry" | "failure",
): Promise<D45CanonicalEvidenceV1> {
	const policy = createD45QualificationPolicy();
	const authority = createD45GraphToolAuthority({
		catalog: createD43PolicyCatalog([policy]),
		assignment: D45_ASSIGNMENT,
		readablePaths: D45_READABLE_PATHS,
		writablePath: D45_WRITABLE_PATH,
		taskMaterial: D45_TASK_MATERIAL,
		routeProfile: { reasoningEffort: "high", requireParameters: true },
		campaign: policy.campaign,
	});
	let files = initialFiles();
	let stateDigest = workspaceDigest(files);
	const providerAttempts = new Map<string, number>();
	let injectFreshnessDrift = false;
	for (;;) {
		const effect = takeD45AdmittedEffect(authority);
		if (effect === null) break;
		let result: D45EffectResultInputV1;
		if (effect.effectKind === "provider-proposal") {
			const wire = lowerD45ProviderEffect(authority, effect);
			const key = `${effect.arm}:${effect.phase}`;
			const attempt = (providerAttempts.get(key) ?? 0) + 1;
			providerAttempts.set(key, attempt);
			if (
				mode === "failure" &&
				((effect.arm === "cold" && effect.phase === "inspection") ||
					(effect.arm === "proposal-only" && effect.phase === "mutation"))
			) {
				result = {
					effectKind: "provider-proposal",
					outcome: effect.arm === "cold" ? "transport-failed" : "provider-rejected",
					elapsedMs: 10,
					costMicrousd: 0,
					usage: null,
					wireDigest: wire.wireDigest,
					retryClass: null,
					proposal: null,
				};
			} else if (
				mode === "retry" &&
				effect.phase === "inspection" &&
				((effect.arm === "cold" && attempt === 1) ||
					(effect.arm === "proposal-only" && attempt <= 2))
			) {
				result = {
					effectKind: "provider-proposal",
					outcome: "retryable-provider-failure",
					elapsedMs: 10,
					costMicrousd: 0,
					usage: null,
					wireDigest: wire.wireDigest,
					retryClass: "D710",
					proposal: null,
				};
			} else {
				let toolCalls: readonly unknown[];
				const recovery = mode === "recovery" ? RECOVERY_BY_ARM[effect.arm] : null;
				if (effect.phase === "inspection") {
					if (mode === "failure" && effect.arm === "wrong-scope-applied" && attempt === 1)
						toolCalls = [
							{
								toolRef: "replace-exact",
								path: D45_WRITABLE_PATH,
								oldText: "x".repeat(32_769),
								newText: "bounded",
							},
						];
					else if (attempt === 1 && recovery === "wrong-tool")
						toolCalls = [
							{
								toolRef: "replace-exact",
								path: D45_WRITABLE_PATH,
								oldText: ORIGINAL,
								newText: REPLACEMENT,
							},
						];
					else if (attempt === 1 && recovery === "path-not-allowed")
						toolCalls = [{ toolRef: "read-file", path: "packages/ts/src/not-allowlisted.ts" }];
					else if (attempt === 1 && recovery === "cardinality") toolCalls = [];
					else toolCalls = [{ toolRef: "read-file", path: nextInjectedReadPath(wire.body) }];
				} else if (attempt === 1 && recovery === "unchanged") {
					toolCalls = [
						{
							toolRef: "replace-exact",
							path: D45_WRITABLE_PATH,
							oldText: ORIGINAL,
							newText: ORIGINAL,
						},
					];
				} else if (attempt === 1 && recovery === "not-found") {
					toolCalls = [
						{
							toolRef: "replace-exact",
							path: D45_WRITABLE_PATH,
							oldText: "missing span",
							newText: REPLACEMENT,
						},
					];
				} else if (attempt === 1 && recovery === "not-unique") {
					toolCalls = [
						{
							toolRef: "replace-exact",
							path: D45_WRITABLE_PATH,
							oldText: "canonicalProposal",
							newText: "canonicalProposalRef",
						},
					];
				} else {
					toolCalls = [
						{
							toolRef: "replace-exact",
							path: D45_WRITABLE_PATH,
							oldText: ORIGINAL,
							newText: REPLACEMENT,
						},
					];
				}
				result = {
					effectKind: "provider-proposal",
					outcome: "success",
					elapsedMs: 10,
					costMicrousd: 10,
					usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5 },
					wireDigest: wire.wireDigest,
					retryClass: null,
					proposal: { toolCalls: toolCalls as never },
				};
				if (
					mode === "failure" &&
					effect.arm === "irrelevant-applied" &&
					effect.phase === "inspection"
				)
					injectFreshnessDrift = true;
			}
		} else if (effect.effectKind === "workspace-freshness") {
			result = {
				effectKind: "workspace-freshness",
				elapsedMs: 1,
				evidenceDigest: empiricalStrictJsonDigest({
					effect: effect.effectDigest,
					observed: true,
				}),
				observedWorkspaceStateDigest: injectFreshnessDrift
					? empiricalStrictJsonDigest({ stale: stateDigest })
					: stateDigest,
			};
			injectFreshnessDrift = false;
		} else if (effect.effectKind === "tool-action") {
			const argumentsValue = readD45ToolArguments(authority, effect);
			const before = stateDigest;
			let content: string | null = null;
			if (mode === "failure" && effect.arm === "wrong-scope-applied") {
				result = {
					effectKind: "tool-action",
					status: "failed",
					causeCode: "read-failed",
					elapsedMs: 1,
					evidenceDigest: empiricalStrictJsonDigest({
						effect: effect.effectDigest,
						readFailed: true,
					}),
					workspaceStateBeforeDigest: before,
					workspaceStateAfterDigest: before,
					content: null,
				};
			} else {
				if (argumentsValue.toolRef === "read-file") content = files.get(argumentsValue.path) ?? "";
				else {
					const current = files.get(argumentsValue.path) ?? "";
					files.set(
						argumentsValue.path,
						current.replace(argumentsValue.oldText, argumentsValue.newText),
					);
					stateDigest = workspaceDigest(files);
				}
				result = {
					effectKind: "tool-action",
					status: "success",
					causeCode: null,
					elapsedMs: 1,
					evidenceDigest: empiricalStrictJsonDigest({
						effect: effect.effectDigest,
						before,
						stateDigest,
					}),
					workspaceStateBeforeDigest: before,
					workspaceStateAfterDigest: stateDigest,
					content,
				};
			}
		} else {
			const isValidation =
				effect.sourceD43EffectKind === "focused-validation" ||
				effect.sourceD43EffectKind === "public-semantic-validation" ||
				effect.sourceD43EffectKind === "hidden-verifier";
			const injectedExecutorFailure =
				mode === "failure" &&
				((effect.arm === "relevant-applied" && effect.sourceD43EffectKind === "materialization") ||
					(effect.arm === "admission-rejected" &&
						effect.sourceD43EffectKind === "focused-validation") ||
					(effect.arm === "irrelevant-applied" &&
						effect.sourceD43EffectKind === "hidden-verifier"));
			const outcome = injectedExecutorFailure
				? "executor-failed"
				: effect.sourceD43EffectKind === "hidden-verifier"
					? effect.arm === "relevant-applied"
						? "passed"
						: "failed"
					: isValidation
						? "passed"
						: "success";
			result = {
				effectKind: "local-effect",
				outcome,
				elapsedMs: 1,
				evidenceDigest: empiricalStrictJsonDigest({ effect: effect.effectDigest, outcome }),
				workspaceStateDigest:
					effect.sourceD43EffectKind === "cleanup" ||
					(effect.sourceD43EffectKind === "materialization" && injectedExecutorFailure)
						? null
						: stateDigest,
				criteria:
					effect.sourceD43EffectKind === "public-semantic-validation"
						? semanticCriteria(effect, files)
						: null,
			};
			if (effect.sourceD43EffectKind === "cleanup") {
				files = initialFiles();
				stateDigest = workspaceDigest(files);
			}
		}
		admitD45EffectResult(authority, effect, result);
	}
	return validateD45CanonicalEvidence(snapshotD45CanonicalEvidence(authority));
}

function runPartialScenario(): D45PartialCanonicalEvidenceV1 {
	const policy = createD45QualificationPolicy();
	const authority = createD45GraphToolAuthority({
		catalog: createD43PolicyCatalog([policy]),
		assignment: D45_ASSIGNMENT,
		readablePaths: D45_READABLE_PATHS,
		writablePath: D45_WRITABLE_PATH,
		taskMaterial: D45_TASK_MATERIAL,
		routeProfile: { reasoningEffort: "high", requireParameters: true },
		campaign: policy.campaign,
	});
	const stateDigest = workspaceDigest(initialFiles());
	const materialization = takeD45AdmittedEffect(authority)!;
	admitD45EffectResult(authority, materialization, {
		effectKind: "local-effect",
		outcome: "success",
		elapsedMs: 1,
		evidenceDigest: empiricalStrictJsonDigest("d45-partial-materialized"),
		workspaceStateDigest: stateDigest,
		criteria: null,
	});
	const inspection = takeD45AdmittedEffect(authority)!;
	const wire = lowerD45ProviderEffect(authority, inspection);
	admitD45EffectResult(authority, inspection, {
		effectKind: "provider-proposal",
		outcome: "success",
		elapsedMs: 7,
		costMicrousd: 11,
		usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0 },
		wireDigest: wire.wireDigest,
		retryClass: null,
		proposal: { toolCalls: [{ toolRef: "read-file", path: D45_WRITABLE_PATH }] },
	});
	const interruptedTool = takeD45AdmittedEffect(authority);
	if (interruptedTool?.effectKind !== "workspace-freshness")
		throw new TypeError("D45 partial qualification did not interrupt a Graph tool composite");
	return validateD45PartialCanonicalEvidence(snapshotD45PartialCanonicalEvidence(authority));
}

function observedRejections(evidence: D45CanonicalEvidenceV1): Set<string> {
	const result = new Set<string>();
	for (const item of evidence.facts) {
		if (item.factKind === "provider-result" && item.result.proposalRejectionCode !== null)
			result.add(item.result.proposalRejectionCode);
	}
	for (const finding of evidence.lifecycle.findings) result.add(finding.causeCode);
	return result;
}

export async function runD45InjectedNoNetworkQualification(): Promise<D45QualificationBundleV1> {
	const mainEvidence = await runScenario("main");
	const recoveryEvidence = await runScenario("recovery");
	const retryEvidence = await runScenario("retry");
	const failureEvidence = await runScenario("failure");
	const partialEvidence = runPartialScenario();
	const partialRoot = await mkdtemp(join(tmpdir(), "graphrefly-d45-partial-qa-"));
	let partialAtomicPersistenceQualified = false;
	try {
		await persistD45PartialEvidence({ privateRoot: partialRoot, evidence: partialEvidence });
		const persisted = strictJsonCodec.decode(
			await readFile(join(partialRoot, D45_PARTIAL_GENERATION_REF, "partial.v1.json")),
		);
		partialAtomicPersistenceQualified =
			validateD45PartialCanonicalEvidence(persisted).evidenceDigest ===
			partialEvidence.evidenceDigest;
	} finally {
		await rm(partialRoot, { recursive: true, force: true });
	}
	if (!partialAtomicPersistenceQualified)
		throw new TypeError("D45 partial evidence atomic persistence qualification failed");
	if (!mainEvidence.frozenGateWouldPass || !mainEvidence.proposalToolBijection)
		throw new TypeError("D45 main six-arm qualification did not reach the frozen gate");
	const rejections = new Set([
		...observedRejections(recoveryEvidence),
		...observedRejections(failureEvidence),
	]);
	const required = [
		"cardinality",
		"wrong-tool",
		"path-not-allowed",
		"argument-bounds",
		"replacement-unchanged",
		"replacement-not-found",
		"replacement-not-unique",
	];
	if (!required.every((item) => rejections.has(item)))
		throw new TypeError(
			`D45 recovery qualification missed rejection evidence: ${required.filter((item) => !rejections.has(item)).join(",")}`,
		);
	if (
		!failureEvidence.exactSixArmsCompleted ||
		failureEvidence.lifecycle.arms.some((arm) => !arm.cleanupCompleted)
	)
		throw new TypeError("D45 failure qualification did not complete arm-local cleanup");
	const conservativeReservationObserved = failureEvidence.facts.some(
		(item) =>
			item.factKind === "provider-result" &&
			item.result.reconciledCostMicrousd > item.result.costMicrousd,
	);
	if (!conservativeReservationObserved)
		throw new TypeError("D45 failure qualification omitted conservative reconciliation");
	const workspaceFreshnessPreAdmissionObserved = failureEvidence.facts.some(
		(item) => item.factKind === "workspace-freshness-result" && !item.result.fresh,
	);
	const toolFailureObserved = failureEvidence.facts.some(
		(item) => item.factKind === "tool-result" && item.result.status === "failed",
	);
	const retryExhaustionObserved = retryEvidence.lifecycle.findings.some(
		(item) => item.causeCode === "retry-bound-exhausted",
	);
	if (!workspaceFreshnessPreAdmissionObserved || !toolFailureObserved || !retryExhaustionObserved)
		throw new TypeError("D45 adversarial failure qualification omitted a required Graph path");
	const rawChatAdapterQualified =
		parseD45ChatProviderResponse({
			status: 200,
			bytes: new TextEncoder().encode(
				JSON.stringify({
					choices: [
						{
							finish_reason: "tool_calls",
							message: {
								role: "assistant",
								tool_calls: [
									{
										function: {
											name: "read_file",
											arguments: JSON.stringify({ path: D45_WRITABLE_PATH }),
										},
									},
								],
							},
						},
					],
					usage: { prompt_tokens: 100, completion_tokens: 20 },
				}),
			),
			elapsedMs: 1,
			wireDigest: empiricalStrictJsonDigest("d45-injected-raw-chat-wire"),
			pricing: {
				inputMicrousdPerMillionTokens: 80_000,
				outputMicrousdPerMillionTokens: 180_000,
				cacheReadMicrousdPerMillionTokens: 16_000,
			},
		}).proposal?.toolCalls[0]?.toolRef === "read-file";
	if (!rawChatAdapterQualified) throw new TypeError("D45 raw Chat adapter qualification failed");
	const mainToolEffects = mainEvidence.facts.filter(
		(item) => item.factKind === "effect-admitted" && item.effect.effectKind === "tool-action",
	);
	const retryWiresByLogical = new Map<string, string[]>();
	for (const item of retryEvidence.facts) {
		if (item.factKind !== "provider-wire-admitted") continue;
		const wires = retryWiresByLogical.get(item.logicalRequestDigest) ?? [];
		wires.push(item.wireDigest);
		retryWiresByLogical.set(item.logicalRequestDigest, wires);
	}
	const exactRetryWireIdentity = [...retryWiresByLogical.values()].some(
		(wires) => wires.length >= 2 && new Set(wires).size === 1,
	);
	if (!exactRetryWireIdentity)
		throw new TypeError("D45 retry qualification did not preserve exact final-wire identity");
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D45_QUALIFICATION_SCHEMA,
		decisionRef: "graphrefly-ts:D45" as const,
		mainEvidenceDigest: mainEvidence.evidenceDigest,
		recoveryEvidenceDigest: recoveryEvidence.evidenceDigest,
		retryEvidenceDigest: retryEvidence.evidenceDigest,
		failureEvidenceDigest: failureEvidence.evidenceDigest,
		partialEvidenceDigest: partialEvidence.evidenceDigest,
		exactSixArmScenarios: 4 as const,
		mainFrozenGateWouldPass: true as const,
		proposalToolBijection: true as const,
		oneToFourInspectionReadsObserved: D43_ARMS.every((arm) => {
			const reads = mainToolEffects.filter(
				(item) =>
					item.factKind === "effect-admitted" &&
					item.effect.arm === arm &&
					item.effect.phase === "inspection",
			);
			return (
				reads.length === 4 &&
				reads.every((item) => item.factKind === "effect-admitted" && item.effect.toolCount === 1) &&
				new Set(
					reads.map((item) => (item.factKind === "effect-admitted" ? item.effect.path : null)),
				).size === 4
			);
		}) as true,
		exactSingleMutationObserved: mainToolEffects.some(
			(item) =>
				item.factKind === "effect-admitted" &&
				item.effect.phase === "mutation" &&
				item.effect.toolCount === 1,
		) as true,
		allProposalRejectionCodesObserved: true as const,
		exactReplacementRejectionsObserved: true as const,
		exactRetryWireIdentity: exactRetryWireIdentity as true,
		failureSixArmsCompleted: true as const,
		cleanupCompletedAfterFailure: true as const,
		conservativeReservationObserved: true as const,
		partialCanonicalEvidenceValidated: true as const,
		partialAtomicPersistenceQualified: partialAtomicPersistenceQualified as true,
		workspaceFreshnessPreAdmissionObserved: workspaceFreshnessPreAdmissionObserved as true,
		toolFailureObserved: toolFailureObserved as true,
		retryExhaustionObserved: retryExhaustionObserved as true,
		rawChatAdapterQualified: rawChatAdapterQualified as true,
		rawMaterialPersisted: false as const,
		historicalRuntimeDependencies: 0 as const,
		providerNetworkCalls: 0 as const,
		credentialReads: 0 as const,
		dispatchClaims: 0 as const,
		liveGateEvaluated: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	if (
		!qualificationMaterial.oneToFourInspectionReadsObserved ||
		!qualificationMaterial.exactSingleMutationObserved
	)
		throw new TypeError("D45 tool cardinality qualification was not load-bearing");
	const qualification = Object.freeze({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D45_QUALIFICATION_BUNDLE_SCHEMA,
		mainEvidence,
		recoveryEvidence,
		retryEvidence,
		failureEvidence,
		partialEvidence,
		qualification,
	});
	return Object.freeze({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
}

export function validateD45QualificationBundle(value: D45QualificationBundleV1) {
	const candidate = record(value, "D45 qualification bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"failureEvidence",
			"mainEvidence",
			"partialEvidence",
			"qualification",
			"recoveryEvidence",
			"retryEvidence",
			"schemaVersion",
		],
		"D45 qualification bundle",
	);
	const qualificationCandidate = record(candidate.qualification, "D45 qualification");
	exactKeys(
		qualificationCandidate,
		[
			"allProposalRejectionCodesObserved",
			"causalAttribution",
			"cleanupCompletedAfterFailure",
			"conservativeReservationObserved",
			"credentialReads",
			"decisionRef",
			"dispatchClaims",
			"efficacyClaim",
			"exactReplacementRejectionsObserved",
			"exactRetryWireIdentity",
			"exactSingleMutationObserved",
			"exactSixArmScenarios",
			"failureEvidenceDigest",
			"failureSixArmsCompleted",
			"historicalRuntimeDependencies",
			"liveGateEvaluated",
			"mainEvidenceDigest",
			"mainFrozenGateWouldPass",
			"oneToFourInspectionReadsObserved",
			"partialAtomicPersistenceQualified",
			"partialCanonicalEvidenceValidated",
			"partialEvidenceDigest",
			"proposalToolBijection",
			"providerNetworkCalls",
			"qualificationDigest",
			"rawMaterialPersisted",
			"rawChatAdapterQualified",
			"recoveryEvidenceDigest",
			"retryEvidenceDigest",
			"retryExhaustionObserved",
			"schemaVersion",
			"toolFailureObserved",
			"workspaceFreshnessPreAdmissionObserved",
		],
		"D45 qualification",
	);
	const main = validateD45CanonicalEvidence(value.mainEvidence);
	const recovery = validateD45CanonicalEvidence(value.recoveryEvidence);
	const retry = validateD45CanonicalEvidence(value.retryEvidence);
	const failure = validateD45CanonicalEvidence(value.failureEvidence);
	const partial = validateD45PartialCanonicalEvidence(value.partialEvidence);
	if (
		value.schemaVersion !== D45_QUALIFICATION_BUNDLE_SCHEMA ||
		value.qualification.schemaVersion !== D45_QUALIFICATION_SCHEMA ||
		value.qualification.decisionRef !== "graphrefly-ts:D45" ||
		value.qualification.mainEvidenceDigest !== main.evidenceDigest ||
		value.qualification.recoveryEvidenceDigest !== recovery.evidenceDigest ||
		value.qualification.retryEvidenceDigest !== retry.evidenceDigest ||
		value.qualification.failureEvidenceDigest !== failure.evidenceDigest ||
		value.qualification.partialEvidenceDigest !== partial.evidenceDigest ||
		value.qualification.exactSixArmScenarios !== 4 ||
		value.qualification.mainFrozenGateWouldPass !== true ||
		value.qualification.proposalToolBijection !== true ||
		value.qualification.oneToFourInspectionReadsObserved !== true ||
		value.qualification.exactSingleMutationObserved !== true ||
		value.qualification.allProposalRejectionCodesObserved !== true ||
		value.qualification.exactReplacementRejectionsObserved !== true ||
		value.qualification.exactRetryWireIdentity !== true ||
		value.qualification.failureSixArmsCompleted !== true ||
		value.qualification.cleanupCompletedAfterFailure !== true ||
		value.qualification.conservativeReservationObserved !== true ||
		value.qualification.partialCanonicalEvidenceValidated !== true ||
		value.qualification.partialAtomicPersistenceQualified !== true ||
		value.qualification.workspaceFreshnessPreAdmissionObserved !== true ||
		value.qualification.toolFailureObserved !== true ||
		value.qualification.retryExhaustionObserved !== true ||
		value.qualification.rawChatAdapterQualified !== true ||
		value.qualification.rawMaterialPersisted !== false ||
		value.qualification.historicalRuntimeDependencies !== 0 ||
		value.qualification.providerNetworkCalls !== 0 ||
		value.qualification.credentialReads !== 0 ||
		value.qualification.dispatchClaims !== 0 ||
		value.qualification.liveGateEvaluated !== false ||
		value.qualification.causalAttribution !== "undetermined" ||
		value.qualification.efficacyClaim !== "none"
	)
		throw new TypeError("D45 qualification coordinates drifted");
	const { qualificationDigest, ...qualificationMaterial } = value.qualification;
	if (qualificationDigest !== empiricalStrictJsonDigest(qualificationMaterial))
		throw new TypeError("D45 qualification digest drifted");
	const { bundleDigest, ...bundleMaterial } = value;
	if (bundleDigest !== empiricalStrictJsonDigest(bundleMaterial))
		throw new TypeError("D45 bundle digest drifted");
	return strictSnapshot(value) as unknown as D45QualificationBundleV1;
}

export function canonicalReplayD45Qualification(value: D45QualificationBundleV1) {
	return validateD45QualificationBundle(
		strictJsonCodec.decode(strictJsonCodec.encode(value)) as unknown as D45QualificationBundleV1,
	);
}

async function writeExclusive(path: string, bytes: Uint8Array) {
	const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function syncDirectory(path: string) {
	const handle = await open(path, constants.O_RDONLY);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function persistAtomicArtifact(input: {
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly fileName: string;
	readonly bytes: Uint8Array;
	readonly materialDigest: string;
}) {
	if (!isAbsolute(input.privateRoot)) throw new TypeError("D45 private root must be absolute");
	const root = await realpath(input.privateRoot);
	const target = join(root, input.generationRef);
	const staging = await mkdtemp(join(root, `.${input.generationRef}.staging-`));
	await chmod(staging, 0o700);
	const artifactDigest = empiricalSha256(input.bytes);
	const commitBytes = strictJsonCodec.encode(
		strictSnapshot({
			schemaVersion: "graphrefly-ts.d45.atomic-commit.v1" as const,
			generationRef: input.generationRef,
			fileName: input.fileName,
			artifactDigest,
			materialDigest: input.materialDigest,
		}),
	);
	let published = false;
	try {
		await writeExclusive(join(staging, input.fileName), input.bytes);
		await writeExclusive(join(staging, "commit.v1.json"), commitBytes);
		await syncDirectory(staging);
		await rename(staging, target);
		published = true;
		try {
			await syncDirectory(root);
		} catch {
			const [publishedArtifact, publishedCommit] = await Promise.all([
				readFile(join(target, input.fileName)),
				readFile(join(target, "commit.v1.json")),
			]);
			if (
				empiricalSha256(publishedArtifact) !== artifactDigest ||
				empiricalSha256(publishedCommit) !== empiricalSha256(commitBytes)
			)
				throw new TypeError("D45 published artifact verification failed after directory sync");
			await syncDirectory(root);
		}
	} catch (error) {
		if (!published) await rm(staging, { recursive: true, force: true });
		throw error;
	}
	return Object.freeze({ artifactDigest, commitArtifactDigest: empiricalSha256(commitBytes) });
}

export async function persistD45Qualification(input: {
	readonly privateRoot: string;
	readonly bundle: D45QualificationBundleV1;
}): Promise<D45QualificationPersistenceReceiptV1> {
	const bundle = validateD45QualificationBundle(input.bundle);
	const bytes = strictJsonCodec.encode(bundle);
	const persisted = await persistAtomicArtifact({
		privateRoot: input.privateRoot,
		generationRef: D45_QUALIFICATION_GENERATION_REF,
		fileName: "bundle.v1.json",
		bytes,
		materialDigest: bundle.bundleDigest,
	});
	const receiptMaterial = strictSnapshot({
		generationRef: D45_QUALIFICATION_GENERATION_REF,
		bundleArtifactDigest: persisted.artifactDigest,
		commitArtifactDigest: persisted.commitArtifactDigest,
	});
	return Object.freeze({
		...receiptMaterial,
		receiptDigest: empiricalStrictJsonDigest(receiptMaterial),
	});
}

export async function persistD45PartialEvidence(input: {
	readonly privateRoot: string;
	readonly evidence: D45PartialCanonicalEvidenceV1;
}): Promise<D45PartialPersistenceReceiptV1> {
	const evidence = validateD45PartialCanonicalEvidence(input.evidence);
	const bytes = strictJsonCodec.encode(evidence);
	const persisted = await persistAtomicArtifact({
		privateRoot: input.privateRoot,
		generationRef: D45_PARTIAL_GENERATION_REF,
		fileName: "partial.v1.json",
		bytes,
		materialDigest: evidence.evidenceDigest,
	});
	const receiptMaterial = strictSnapshot({
		generationRef: D45_PARTIAL_GENERATION_REF,
		evidenceArtifactDigest: persisted.artifactDigest,
		commitArtifactDigest: persisted.commitArtifactDigest,
	});
	return Object.freeze({
		...receiptMaterial,
		receiptDigest: empiricalStrictJsonDigest(receiptMaterial),
	});
}
