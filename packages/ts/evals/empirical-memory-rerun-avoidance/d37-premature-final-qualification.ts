import { readdir, readFile } from "node:fs/promises";
import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import {
	admitCurrentGraphEffectResult,
	CURRENT_GRAPH_ARMS,
	type CurrentGraphNativeEvidenceV1,
	createCurrentGraphNativeEvalAuthority,
	snapshotCurrentGraphNativeEvidence,
	takeCurrentGraphAdmittedEffect,
	validateCurrentGraphNativeEvidence,
} from "./d5-graph-native-eval-authority.js";
import { persistCurrentGraphPrivateGeneration } from "./d6-current-private-persistence.js";
import {
	CURRENT_GRAPH_LIVE_LIMITS,
	CURRENT_GRAPH_LIVE_READABLE_FILES,
	CURRENT_GRAPH_LIVE_ROUTE,
	CURRENT_GRAPH_LIVE_WRITABLE_FILE,
} from "./d8-current-live-coordinates.js";
import {
	CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
	CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
} from "./d8-current-openrouter-adapter.js";
import {
	D21_EXPOSURE_MATRIX,
	D21_TASK_PROFILE,
} from "./d21-current-efficacy-recovery-authority.js";
import {
	admitD34EffectResult,
	createD34RetainedSpanAuthority,
	snapshotD34RetainedSpanEvidence,
	validateD34RetainedSpanEvidence,
} from "./d34-retained-span-mutation-authority.js";
import { createD35RetainedSpanRealProviderExecutor } from "./d35-retained-span-real-provider-composition.js";
import { validateD36LiveBundle } from "./d36-retained-span-live.js";
import { D37_IMPLEMENTATION_MANIFEST_DIGEST } from "./d37-premature-final-implementation-manifest.js";

export const D37_DECISION_REF = "graphrefly-ts:D37" as const;
export const D37_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d37.premature-final-qualification.v7" as const;
export const D37_BUNDLE_SCHEMA =
	"graphrefly-ts.d37.premature-final-qualification-bundle.v7" as const;
export const D37_GENERATION_SCHEMA =
	"graphrefly-ts.d37.premature-final-qualification-generation.v7" as const;
export const D37_GENERATION_REF =
	"current-graph-native-premature-final-no-network-2026-08-20-d37-v7" as const;

export const D37_D36_BASELINE = Object.freeze({
	artifactDigest:
		"sha256:746a95fa384d7b3efa4178666a4e74fef862b3b07cbdb423b40223916c3806c4" as const,
	bundleDigest: "sha256:99c9b4f15b0e5de9aaef26c8de9e97b513638665278eb85d1f9ed03504dcb288" as const,
	partialGraphDigest:
		"sha256:db58d916a38035f1c7f38ad783c32ac434edba0dbc614e58703f9d0a31e8c09b" as const,
	terminalReceiptDigest:
		"sha256:4e2edfa7d9d9626dfe599ade4c00d71d81a06f137b28d9143e4a8d92f9f6c430" as const,
});

export interface D37D36BaselineAdmissionV1 {
	readonly revision: "graphrefly-ts.d37.d36-baseline-admission.v1";
}

type D37Evidence = ReturnType<typeof validateD34RetainedSpanEvidence>;

export interface D37QualificationBundleV1 {
	readonly schemaVersion: typeof D37_BUNDLE_SCHEMA;
	readonly baselineBasis: "consumed-d36-artifact" | "injected-test";
	readonly evidence: D37Evidence;
	readonly headroomEvidence: CurrentGraphNativeEvidenceV1;
	readonly secondFailureEvidence: D37Evidence;
	readonly qualification: Readonly<{
		readonly schemaVersion: typeof D37_QUALIFICATION_SCHEMA;
		readonly decisionRef: typeof D37_DECISION_REF;
		readonly d36Baseline: typeof D37_D36_BASELINE;
		readonly implementationManifestDigest: typeof D37_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly evidenceDigest: string;
		readonly headroomEvidenceDigest: string;
		readonly secondFailureEvidenceDigest: string;
		readonly exactSixArmsCompleted: true;
		readonly prematureFinalFactCount: 6;
		readonly phaseRetryContextCount: 6;
		readonly providerTransportCalls: 31;
		readonly retainedSpanTransportCalls: 7;
		readonly retryWaitCount: 1;
		readonly maxActiveTransport: 1;
		readonly providerNetworkCalls: 0;
		readonly allPublicSemanticPassed: true;
		readonly allHiddenVerifierPassed: true;
		readonly allCleanupCompleted: true;
		readonly secondFailureStoppedLocally: true;
		readonly insufficientHeadroomStoppedBeforeContext: true;
		readonly workspaceResidueCount: 0;
		readonly persistedRawProviderContent: false;
		readonly liveGateEvaluated: false;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly qualified: true;
		readonly qualificationDigest: string;
	}>;
	readonly generation: Readonly<{
		readonly schemaVersion: typeof D37_GENERATION_SCHEMA;
		readonly generationRef: typeof D37_GENERATION_REF;
		readonly qualificationDigest: string;
		readonly evidenceDigest: string;
		readonly implementationManifestDigest: typeof D37_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

const baselines = new WeakMap<object, D37QualificationBundleV1["baselineBasis"]>();
const constructed = new WeakSet<object>();

function baselineCapability(basis: D37QualificationBundleV1["baselineBasis"]) {
	const capability = Object.freeze({
		revision: "graphrefly-ts.d37.d36-baseline-admission.v1" as const,
	});
	baselines.set(capability, basis);
	return capability;
}

export function admitD37D36Baseline(bytesValue: Uint8Array): D37D36BaselineAdmissionV1 {
	if (!(bytesValue instanceof Uint8Array))
		throw new TypeError("D37 D36 baseline bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D37_D36_BASELINE.artifactDigest)
		throw new TypeError("D37 D36 baseline artifact drifted");
	const bundle = validateD36LiveBundle(strictJsonCodec.decode(bytes));
	if (
		bundle.disposition !== "partial-failure" ||
		bundle.bundleDigest !== D37_D36_BASELINE.bundleDigest ||
		bundle.partialGraphEvidence?.partialGraphDigest !== D37_D36_BASELINE.partialGraphDigest ||
		bundle.terminalReceipt.terminalReceiptDigest !== D37_D36_BASELINE.terminalReceiptDigest ||
		bundle.efficacyClaim !== "none"
	)
		throw new TypeError("D37 D36 baseline coordinates drifted");
	return baselineCapability("consumed-d36-artifact");
}

export function createD37InjectedBaselineForTest(): D37D36BaselineAdmissionV1 {
	return baselineCapability("injected-test");
}

function consumeBaseline(value: D37D36BaselineAdmissionV1) {
	const basis = baselines.get(value as object);
	baselines.delete(value as object);
	if (basis === undefined) throw new TypeError("D37 baseline is forged or replayed");
	return basis;
}

function response(calls: readonly Readonly<{ name: string; args: unknown }>[]) {
	return new Response(
		JSON.stringify({
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: calls.map((call, index) => ({
							id: `d37-${call.name}-${index}`,
							type: "function",
							function: { name: call.name, arguments: JSON.stringify(call.args) },
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

function structuredFinal() {
	return new Response(
		JSON.stringify({
			choices: [{ message: { role: "assistant", content: "bounded injected final" } }],
			usage: {
				prompt_tokens: 100,
				completion_tokens: 20,
				prompt_tokens_details: { cached_tokens: 0 },
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

function armFor(messages: readonly unknown[]): string {
	const serialized = JSON.stringify(messages);
	const arm = Object.keys(D21_EXPOSURE_MATRIX).find((candidate) =>
		serialized.includes(`Frozen evaluation arm: ${candidate}.`),
	);
	if (arm === undefined) throw new TypeError("D37 injected arm context is missing");
	return arm;
}

function retryWaitCount(evidence: D37Evidence): number {
	return evidence.phaseEvidence.workflowEvidence.providerEvidence.facts.filter(
		(fact) => fact.result.effectKind === "retry-wait",
	).length;
}

function assertReportedPrematureFinalUsage(evidence: D37Evidence, expectedCount: number) {
	const facts = evidence.phaseEvidence.workflowEvidence.providerEvidence.facts.filter(
		(fact) =>
			fact.result.effectKind === "provider-request" &&
			fact.result.failureCode === "premature-structured-final",
	);
	if (
		facts.length !== expectedCount ||
		facts.some(
			(fact) =>
				fact.result.effectKind !== "provider-request" ||
				fact.result.status !== "failed" ||
				fact.result.usage.costBasis !== "reported" ||
				fact.result.usage.requests !== 1 ||
				fact.result.usage.inputTokens !== 100 ||
				fact.result.usage.outputTokens !== 20 ||
				fact.result.usage.cacheReadTokens !== 0 ||
				fact.reconciliation.actualCostMicrousd !== fact.result.usage.actualCostMicrousd ||
				fact.reconciliation.actualElapsedMs !== fact.result.usage.actualElapsedMs,
		)
	)
		throw new TypeError("D37 premature-final reported usage reconciliation drifted");
}

function assertQualifiedEvidence(evidence: D37Evidence) {
	const workflow = evidence.phaseEvidence.workflowEvidence.providerEvidence.workflowEvidence;
	if (
		workflow.runs.length !== CURRENT_GRAPH_ARMS.length ||
		workflow.runs.some(
			(run, index) =>
				run.arm !== CURRENT_GRAPH_ARMS[index] ||
				run.runSequence !== index ||
				run.status !== "completed" ||
				run.phase !== "complete" ||
				!run.publicSemanticValidationAttempted ||
				!run.publicSemanticValidationPassed ||
				!run.hiddenVerifierAttempted ||
				!run.hiddenVerifierPassed ||
				run.cleanupStatus !== "completed",
		)
	)
		throw new TypeError(
			`D37 exact six-arm completion drifted: ${JSON.stringify({
				runs: workflow.runs,
				coldFacts: workflow.facts
					.filter((fact) => fact.arm === "cold")
					.map((fact) => ({
						effect: fact.request.effectKind,
						phase: fact.request.phaseBefore,
						tool: fact.request.toolRef,
						correction: fact.request.correctionDirective,
						result: fact.result,
					})),
				findings: workflow.findings.filter((finding) => finding.arm === "cold"),
			})}`,
		);
	const prematureFindings = workflow.findings.filter(
		(finding) => finding.code === "premature-structured-final",
	);
	const phaseRetryFacts = workflow.facts.filter(
		(fact) =>
			fact.result.effectKind === "provider-request" &&
			fact.request.correctionDirective?.reason === "premature-structured-final" &&
			fact.request.correctionDirective.stage === "phase-retry",
	);
	const providerRequestFacts = workflow.facts.filter(
		(fact) => fact.result.effectKind === "provider-request",
	);
	if (
		prematureFindings.length !== CURRENT_GRAPH_ARMS.length ||
		phaseRetryFacts.length !== CURRENT_GRAPH_ARMS.length ||
		phaseRetryFacts.some(
			(fact, index) =>
				fact.arm !== CURRENT_GRAPH_ARMS[index] ||
				fact.runSequence !== index ||
				fact.result.status !== "completed" ||
				fact.request.correctionDirective?.requiredFirstToolRef !==
					(index === 0 ? "read-file" : "replace-exact"),
		) ||
		providerRequestFacts.length !== 30 ||
		retryWaitCount(evidence) !== 1 ||
		evidence.facts.length !== CURRENT_GRAPH_ARMS.length * 2 ||
		evidence.facts.some(
			(fact, index) =>
				fact.arm !== CURRENT_GRAPH_ARMS[Math.floor(index / 2)] ||
				fact.runSequence !== Math.floor(index / 2) ||
				fact.kind !== (index % 2 === 0 ? "retained-span" : "new-text-proposal") ||
				fact.disposition !== (index % 2 === 0 ? "retained" : "accepted"),
		)
	)
		throw new TypeError(
			`D37 exact recovery evidence drifted: ${JSON.stringify({
				prematureFindings: prematureFindings.length,
				phaseRetryFacts: phaseRetryFacts.map((fact) => ({
					arm: fact.arm,
					runSequence: fact.runSequence,
					status: fact.result.status,
					requiredFirstToolRef: fact.request.correctionDirective?.requiredFirstToolRef,
				})),
				providerRequestFacts: providerRequestFacts.length,
				retryWaits: retryWaitCount(evidence),
				retainedFacts: evidence.facts.map((fact) => ({
					arm: fact.arm,
					runSequence: fact.runSequence,
					kind: fact.kind,
					disposition: fact.disposition,
				})),
			})}`,
		);
	assertReportedPrematureFinalUsage(evidence, CURRENT_GRAPH_ARMS.length);
	return Object.freeze({
		prematureFinalFactCount: prematureFindings.length,
		phaseRetryContextCount: phaseRetryFacts.length,
		providerTransportCalls: providerRequestFacts.length + retryWaitCount(evidence),
		retainedSpanTransportCalls:
			evidence.facts.filter((fact) => fact.kind === "new-text-proposal").length +
			retryWaitCount(evidence),
	});
}

function assertSecondFailureEvidence(evidence: D37Evidence) {
	const workflow = evidence.phaseEvidence.workflowEvidence.providerEvidence.workflowEvidence;
	if (
		workflow.runs.length !== CURRENT_GRAPH_ARMS.length ||
		workflow.runs.some(
			(run, index) =>
				run.arm !== CURRENT_GRAPH_ARMS[index] ||
				run.runSequence !== index ||
				run.cleanupStatus !== "completed" ||
				(index === 0
					? run.status !== "incomplete" ||
						run.phase !== "inspection" ||
						run.publicSemanticValidationAttempted ||
						run.hiddenVerifierAttempted
					: run.status !== "completed" ||
						run.phase !== "complete" ||
						!run.publicSemanticValidationPassed ||
						!run.hiddenVerifierPassed),
		)
	)
		throw new TypeError(
			`D37 second-failure run projection drifted: ${JSON.stringify({
				runs: workflow.runs,
				coldFacts: workflow.facts
					.filter((fact) => fact.arm === "cold")
					.map((fact) => ({
						effect: fact.request.effectKind,
						phase: fact.request.phaseBefore,
						correction: fact.request.correctionDirective,
						result: fact.result,
					})),
			})}`,
		);
	const coldFailures = workflow.facts.filter(
		(fact) =>
			fact.arm === "cold" &&
			fact.result.effectKind === "provider-request" &&
			fact.result.status === "failed" &&
			fact.result.failureCode === "premature-structured-final",
	);
	const coldRetry = coldFailures.filter(
		(fact) =>
			fact.request.correctionDirective?.reason === "premature-structured-final" &&
			fact.request.correctionDirective.stage === "phase-retry",
	);
	const coldRetainedFacts = evidence.facts.filter(
		(fact) => fact.arm === "cold" && fact.kind === "retained-span",
	);
	if (
		coldFailures.length !== 2 ||
		coldRetry.length !== 1 ||
		coldFailures[0]?.request.correctionDirective?.stage !== "fresh-mutation" ||
		coldFailures[1]?.request.correctionDirective?.stage !== "phase-retry" ||
		coldRetainedFacts.length !== 1 ||
		evidence.facts.some((fact) => fact.arm === "cold" && fact.kind === "new-text-proposal") ||
		workflow.findings.filter(
			(finding) => finding.arm === "cold" && finding.code === "premature-structured-final",
		).length !== 2
	)
		throw new TypeError("D37 second premature-final evidence drifted");
	assertReportedPrematureFinalUsage(evidence, CURRENT_GRAPH_ARMS.length + 1);
}

async function runMain(input: {
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly secondFinal: boolean;
}) {
	const authority = createD34RetainedSpanAuthority({
		limits: CURRENT_GRAPH_LIVE_LIMITS,
		routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
		taskProfile: D21_TASK_PROFILE,
	});
	const providerCallsByArm = new Map<string, number>();
	let retryInjected = false;
	let transportCalls = 0;
	let retainedCalls = 0;
	let activeTransport = 0;
	let maxActiveTransport = 0;
	const executor = createD35RetainedSpanRealProviderExecutor({
		authority,
		repositoryRoot: input.repositoryRoot,
		materializationRoot: input.materializationRoot,
		credential: {
			bearerToken: "d37-injected-no-network",
			credentialBindingRef: "openrouter.local-eval-2",
			credentialBindingRevision: "2026-08-14.v1",
		},
		fetchImpl: async (_url, init) => {
			activeTransport += 1;
			maxActiveTransport = Math.max(maxActiveTransport, activeTransport);
			transportCalls += 1;
			try {
				const body = record(
					JSON.parse(Buffer.from(init?.body as Uint8Array).toString("utf8")),
					"D37 injected body",
				);
				const messages = Array.isArray(body.messages) ? body.messages : [];
				const arm = armFor(messages);
				const armProviderCall = (providerCallsByArm.get(arm) ?? 0) + 1;
				providerCallsByArm.set(arm, armProviderCall);
				const choice = body.tool_choice;
				const hasReadResult = messages.some(
					(message) =>
						record(message, "D37 injected message").role === "tool" &&
						typeof record(message, "D37 injected message").content === "string" &&
						(record(message, "D37 injected message").content as string).includes(
							"managed-cloud-postgresql",
						),
				);
				const toolName =
					choice === "required"
						? hasReadResult
							? "replace_exact"
							: "read_file"
						: record(record(choice, "D37 tool choice").function, "D37 tool function").name;
				if (!input.secondFinal && arm === "cold" && armProviderCall === 1) return structuredFinal();
				if (arm !== "cold" && armProviderCall === 2) return structuredFinal();
				if (input.secondFinal && arm === "cold" && (armProviderCall === 4 || armProviderCall === 5))
					return structuredFinal();
				if (toolName === "read_file")
					return response(
						CURRENT_GRAPH_LIVE_READABLE_FILES.map((path) => ({
							name: "read_file",
							args: { path },
						})),
					);
				if (toolName === "replace_exact") {
					return response([
						{
							name: "replace_exact",
							args: {
								path: CURRENT_GRAPH_LIVE_WRITABLE_FILE,
								oldText: CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
								newText: CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
							},
						},
					]);
				}
				if (toolName !== "propose_replacement_text")
					throw new TypeError("D37 injected named tool drifted");
				const serializedBody = JSON.stringify(body);
				if (
					serializedBody.includes(CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK) ||
					serializedBody.includes('"oldText"')
				)
					throw new TypeError("D37 retained-span request leaked rejected source material");
				retainedCalls += 1;
				if (!retryInjected) {
					retryInjected = true;
					return new Response(JSON.stringify({ error: { message: "bounded" } }), {
						status: 429,
						headers: { "content-type": "application/json", "retry-after": "0" },
					});
				}
				return response([
					{
						name: "propose_replacement_text",
						args: { newText: CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK },
					},
				]);
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
	try {
		for (let guard = 0; guard < CURRENT_GRAPH_LIVE_LIMITS.maxEffectFacts; guard += 1) {
			const execution = await executor.executeNext();
			if (execution === null) break;
			admitD34EffectResult(authority, execution.admitted, execution.result);
		}
	} finally {
		await executor.dispose();
	}
	const snapshot = snapshotD34RetainedSpanEvidence(authority);
	if (snapshot.facts.length === 0 || snapshot.facts.length > 64)
		throw new TypeError(
			`D37 retained fact count drifted: ${JSON.stringify({
				retained: snapshot.facts.length,
				phase: snapshot.phaseEvidence.phaseFacts.map((fact) => ({
					arm: fact.arm,
					phase: fact.phaseBefore,
					disposition: fact.disposition,
					tools: fact.proposalToolRefs,
				})),
				findings:
					snapshot.phaseEvidence.workflowEvidence.providerEvidence.workflowEvidence.findings.map(
						(finding) => finding.code,
					),
			})}`,
		);
	return Object.freeze({
		evidence: validateD34RetainedSpanEvidence(snapshot),
		transportCalls,
		retainedCalls,
		maxActiveTransport,
	});
}

function runHeadroomEvidence() {
	const authority = createCurrentGraphNativeEvalAuthority({
		limits: {
			maxProviderRequests: 2,
			maxCostMicrousd: CURRENT_GRAPH_LIVE_LIMITS.maxCostMicrousd,
			maxElapsedMs: CURRENT_GRAPH_LIVE_LIMITS.maxElapsedMs,
			maxEffectFacts: CURRENT_GRAPH_LIVE_LIMITS.maxEffectFacts,
			providerMaxCostMicrousd: CURRENT_GRAPH_LIVE_LIMITS.providerMaxCostMicrousd,
			providerMaxElapsedMs: CURRENT_GRAPH_LIVE_LIMITS.providerMaxElapsedMs,
			localEffectMaxElapsedMs: CURRENT_GRAPH_LIVE_LIMITS.localEffectMaxElapsedMs,
		},
	});
	for (let guard = 0; guard < CURRENT_GRAPH_LIVE_LIMITS.maxEffectFacts; guard += 1) {
		const admitted = takeCurrentGraphAdmittedEffect(authority);
		if (admitted === null)
			return validateCurrentGraphNativeEvidence(snapshotCurrentGraphNativeEvidence(authority));
		const base = {
			evidenceDigest: empiricalStrictJsonDigest({
				arm: admitted.request.arm,
				sequence: admitted.request.sequence,
				effectKind: admitted.request.effectKind,
			}),
			actualCostMicrousd: 0 as const,
			actualElapsedMs: 1,
		};
		if (admitted.request.effectKind === "materialization")
			admitCurrentGraphEffectResult(authority, admitted.request.requestDigest, {
				...base,
				effectKind: "materialization",
				status: "completed",
				workspaceStateDigest: empiricalStrictJsonDigest({ arm: admitted.request.arm }),
			});
		else if (admitted.request.effectKind === "provider-request")
			admitCurrentGraphEffectResult(authority, admitted.request.requestDigest, {
				...base,
				effectKind: "provider-request",
				status: admitted.request.phaseBefore === "inspection" ? "failed" : "completed",
				disposition:
					admitted.request.phaseBefore === "inspection" ? null : ("tool-intents" as const),
				toolIntents:
					admitted.request.phaseBefore === "inspection"
						? []
						: (["read-file", "read-file", "read-file", "read-file"] as const),
				failureCode:
					admitted.request.phaseBefore === "inspection"
						? ("premature-structured-final" as const)
						: null,
			});
		else if (admitted.request.effectKind === "tool-action") {
			const workspace = admitted.request.workspaceStateDigest;
			if (workspace === null || admitted.request.toolRef !== "read-file")
				throw new TypeError("D37 headroom tool admission drifted");
			admitCurrentGraphEffectResult(authority, admitted.request.requestDigest, {
				...base,
				effectKind: "tool-action",
				toolRef: "read-file",
				status: "succeeded",
				causeCode: null,
				workspaceStateBeforeDigest: workspace,
				workspaceStateAfterDigest: workspace,
				nonEmptyDiff: false,
			});
		} else if (admitted.request.effectKind === "cleanup")
			admitCurrentGraphEffectResult(authority, admitted.request.requestDigest, {
				...base,
				effectKind: "cleanup",
				status: "completed",
				workspaceStateDigest: null,
			});
		else throw new TypeError("D37 headroom effect sequence drifted");
	}
	throw new TypeError("D37 headroom run exceeded its effect bound");
}

function assertHeadroomEvidence(evidence: CurrentGraphNativeEvidenceV1) {
	const workflow = evidence;
	if (
		workflow.runs.length !== CURRENT_GRAPH_ARMS.length ||
		workflow.runs.some(
			(run, index) =>
				run.arm !== CURRENT_GRAPH_ARMS[index] ||
				run.runSequence !== index ||
				run.status !== "incomplete" ||
				run.cleanupStatus !== "completed" ||
				(index === 0 ? run.phase !== "inspection" : run.phase !== "none"),
		) ||
		workflow.findings.filter((finding) => finding.code === "premature-structured-final").length !==
			1 ||
		workflow.findings.filter((finding) => finding.code === "budget-exhausted").length !== 5 ||
		workflow.facts.some(
			(fact) => fact.request.correctionDirective?.reason === "premature-structured-final",
		)
	)
		throw new TypeError("D37 insufficient-headroom evidence drifted");
}

export async function runD37InjectedNoNetworkQualification(input: {
	readonly baseline: D37D36BaselineAdmissionV1;
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
}): Promise<D37QualificationBundleV1> {
	const baselineBasis = consumeBaseline(input.baseline);
	const main = await runMain({ ...input, secondFinal: false });
	const qualified = assertQualifiedEvidence(main.evidence);
	const secondRoot = `${input.materializationRoot}-second-final`;
	const second = await runMain({ ...input, materializationRoot: secondRoot, secondFinal: true });
	const headroomEvidence = runHeadroomEvidence();
	assertHeadroomEvidence(headroomEvidence);
	const runs = main.evidence.phaseEvidence.workflowEvidence.providerEvidence.workflowEvidence.runs;
	const findings =
		main.evidence.phaseEvidence.workflowEvidence.providerEvidence.workflowEvidence.findings;
	const phaseContexts =
		main.evidence.phaseEvidence.workflowEvidence.providerEvidence.workflowEvidence.facts.filter(
			(fact) =>
				fact.result.effectKind === "provider-request" &&
				fact.request.correctionDirective?.reason === "premature-structured-final" &&
				fact.request.correctionDirective.stage === "phase-retry",
		);
	const secondRuns =
		second.evidence.phaseEvidence.workflowEvidence.providerEvidence.workflowEvidence.runs;
	assertSecondFailureEvidence(second.evidence);
	let workspaceResidueCount = 0;
	for (const root of [input.materializationRoot, secondRoot]) {
		try {
			workspaceResidueCount += (await readdir(root)).length;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	if (
		runs.length !== 6 ||
		runs.some(
			(run) =>
				run.status !== "completed" ||
				!run.publicSemanticValidationPassed ||
				!run.hiddenVerifierPassed ||
				run.cleanupStatus !== "completed",
		) ||
		qualified.prematureFinalFactCount !== 6 ||
		qualified.phaseRetryContextCount !== 6 ||
		qualified.providerTransportCalls !== main.transportCalls ||
		qualified.retainedSpanTransportCalls !== main.retainedCalls ||
		retryWaitCount(main.evidence) !== 1 ||
		main.maxActiveTransport !== 1 ||
		secondRuns.length !== 6 ||
		secondRuns.some(
			(run) =>
				run.cleanupStatus !== "completed" ||
				(run.arm === "cold" ? run.status !== "incomplete" : run.status !== "completed"),
		) ||
		workspaceResidueCount !== 0
	)
		throw new TypeError(
			`D37 injected lifecycle drifted: ${JSON.stringify({
				runs,
				prematureFinalFindings: findings.filter(
					(finding) => finding.code === "premature-structured-final",
				).length,
				phaseContexts: phaseContexts.length,
				retryWaits: retryWaitCount(main.evidence),
				maxActiveTransport: main.maxActiveTransport,
				secondRuns,
				workspaceResidueCount,
			})}`,
		);
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D37_QUALIFICATION_SCHEMA,
		decisionRef: D37_DECISION_REF,
		d36Baseline: D37_D36_BASELINE,
		implementationManifestDigest: D37_IMPLEMENTATION_MANIFEST_DIGEST,
		evidenceDigest: main.evidence.evidenceDigest,
		headroomEvidenceDigest: headroomEvidence.evidenceDigest,
		secondFailureEvidenceDigest: second.evidence.evidenceDigest,
		exactSixArmsCompleted: true as const,
		prematureFinalFactCount: 6 as const,
		phaseRetryContextCount: 6 as const,
		providerTransportCalls: 31 as const,
		retainedSpanTransportCalls: 7 as const,
		retryWaitCount: 1 as const,
		maxActiveTransport: 1 as const,
		providerNetworkCalls: 0 as const,
		allPublicSemanticPassed: true as const,
		allHiddenVerifierPassed: true as const,
		allCleanupCompleted: true as const,
		secondFailureStoppedLocally: true as const,
		insufficientHeadroomStoppedBeforeContext: true as const,
		workspaceResidueCount: 0 as const,
		persistedRawProviderContent: false as const,
		liveGateEvaluated: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
		qualified: true as const,
	});
	const qualification = Object.freeze({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: D37_GENERATION_SCHEMA,
		generationRef: D37_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		evidenceDigest: main.evidence.evidenceDigest,
		implementationManifestDigest: D37_IMPLEMENTATION_MANIFEST_DIGEST,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = Object.freeze({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D37_BUNDLE_SCHEMA,
		baselineBasis,
		evidence: main.evidence,
		headroomEvidence,
		secondFailureEvidence: second.evidence,
		qualification,
		generation,
	});
	const bundle = Object.freeze({
		...material,
		bundleDigest: empiricalStrictJsonDigest(material),
	}) as D37QualificationBundleV1;
	constructed.add(bundle);
	return bundle;
}

export function validateD37QualificationBundle(value: unknown): D37QualificationBundleV1 {
	const candidate = record(value, "D37 qualification bundle");
	exactKeys(
		candidate,
		[
			"baselineBasis",
			"bundleDigest",
			"evidence",
			"generation",
			"headroomEvidence",
			"qualification",
			"schemaVersion",
			"secondFailureEvidence",
		],
		"D37 qualification bundle",
	);
	if (
		candidate.schemaVersion !== D37_BUNDLE_SCHEMA ||
		(candidate.baselineBasis !== "consumed-d36-artifact" &&
			candidate.baselineBasis !== "injected-test")
	)
		throw new TypeError("D37 bundle coordinates drifted");
	const evidence = validateD34RetainedSpanEvidence(candidate.evidence);
	const headroomEvidence = validateCurrentGraphNativeEvidence(candidate.headroomEvidence);
	const secondFailureEvidence = validateD34RetainedSpanEvidence(candidate.secondFailureEvidence);
	const qualification = record(candidate.qualification, "D37 qualification");
	const generation = record(candidate.generation, "D37 generation");
	exactKeys(
		qualification,
		[
			"allCleanupCompleted",
			"allHiddenVerifierPassed",
			"allPublicSemanticPassed",
			"causalAttribution",
			"d36Baseline",
			"decisionRef",
			"efficacyClaim",
			"evidenceDigest",
			"exactSixArmsCompleted",
			"implementationManifestDigest",
			"insufficientHeadroomStoppedBeforeContext",
			"liveGateEvaluated",
			"maxActiveTransport",
			"persistedRawProviderContent",
			"phaseRetryContextCount",
			"prematureFinalFactCount",
			"providerNetworkCalls",
			"providerTransportCalls",
			"qualificationDigest",
			"qualified",
			"retainedSpanTransportCalls",
			"retryWaitCount",
			"schemaVersion",
			"headroomEvidenceDigest",
			"secondFailureEvidenceDigest",
			"secondFailureStoppedLocally",
			"workspaceResidueCount",
		],
		"D37 qualification",
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
		"D37 generation",
	);
	const derived = assertQualifiedEvidence(evidence);
	assertHeadroomEvidence(headroomEvidence);
	assertSecondFailureEvidence(secondFailureEvidence);
	if (
		qualification.schemaVersion !== D37_QUALIFICATION_SCHEMA ||
		qualification.decisionRef !== D37_DECISION_REF ||
		empiricalStrictJsonDigest(qualification.d36Baseline) !==
			empiricalStrictJsonDigest(D37_D36_BASELINE) ||
		qualification.implementationManifestDigest !== D37_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.evidenceDigest !== evidence.evidenceDigest ||
		qualification.headroomEvidenceDigest !== headroomEvidence.evidenceDigest ||
		qualification.secondFailureEvidenceDigest !== secondFailureEvidence.evidenceDigest ||
		qualification.exactSixArmsCompleted !== true ||
		qualification.prematureFinalFactCount !== 6 ||
		qualification.phaseRetryContextCount !== 6 ||
		qualification.providerTransportCalls !== 31 ||
		qualification.retainedSpanTransportCalls !== 7 ||
		qualification.prematureFinalFactCount !== derived.prematureFinalFactCount ||
		qualification.phaseRetryContextCount !== derived.phaseRetryContextCount ||
		qualification.providerTransportCalls !== derived.providerTransportCalls ||
		qualification.retainedSpanTransportCalls !== derived.retainedSpanTransportCalls ||
		qualification.retryWaitCount !== 1 ||
		qualification.maxActiveTransport !== 1 ||
		qualification.providerNetworkCalls !== 0 ||
		qualification.allPublicSemanticPassed !== true ||
		qualification.allHiddenVerifierPassed !== true ||
		qualification.allCleanupCompleted !== true ||
		qualification.secondFailureStoppedLocally !== true ||
		qualification.insufficientHeadroomStoppedBeforeContext !== true ||
		qualification.workspaceResidueCount !== 0 ||
		qualification.persistedRawProviderContent !== false ||
		qualification.liveGateEvaluated !== false ||
		qualification.causalAttribution !== "undetermined" ||
		qualification.efficacyClaim !== "none" ||
		qualification.qualified !== true ||
		generation.schemaVersion !== D37_GENERATION_SCHEMA ||
		generation.generationRef !== D37_GENERATION_REF ||
		generation.qualificationDigest !== qualification.qualificationDigest ||
		generation.evidenceDigest !== evidence.evidenceDigest ||
		generation.implementationManifestDigest !== D37_IMPLEMENTATION_MANIFEST_DIGEST ||
		generation.causalAttribution !== "undetermined" ||
		generation.efficacyClaim !== "none"
	)
		throw new TypeError("D37 qualification semantics drifted");
	safeInteger(qualification.providerTransportCalls, "D37 providerTransportCalls", {
		min: 31,
		max: 31,
	});
	const qualificationBase = { ...qualification };
	delete qualificationBase.qualificationDigest;
	if (qualification.qualificationDigest !== empiricalStrictJsonDigest(qualificationBase))
		throw new TypeError("D37 qualification digest drifted");
	const generationBase = { ...generation };
	delete generationBase.generationDigest;
	if (generation.generationDigest !== empiricalStrictJsonDigest(generationBase))
		throw new TypeError("D37 generation digest drifted");
	const material = strictSnapshot({
		schemaVersion: D37_BUNDLE_SCHEMA,
		baselineBasis: candidate.baselineBasis,
		evidence,
		headroomEvidence,
		secondFailureEvidence,
		qualification: strictSnapshot(qualification),
		generation: strictSnapshot(generation),
	});
	if (candidate.bundleDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D37 bundle digest drifted");
	return strictSnapshot(candidate) as unknown as D37QualificationBundleV1;
}

export async function persistD37Qualification(input: {
	readonly privateRoot: string;
	readonly bundle: D37QualificationBundleV1;
}) {
	if (!constructed.has(input.bundle as object))
		throw new TypeError("D37 bundle was not constructed in this process");
	constructed.delete(input.bundle as object);
	const bundle = validateD37QualificationBundle(input.bundle);
	if (bundle.baselineBasis !== "consumed-d36-artifact")
		throw new TypeError("D37 production persistence requires consumed D36 artifact bytes");
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: D37_GENERATION_REF,
		artifacts: {
			"bundle.v1.json": strictJsonCodec.encode(bundle as unknown as StrictJsonValue),
			"qualification.v1.json": strictJsonCodec.encode(
				bundle.qualification as unknown as StrictJsonValue,
			),
			"generation.v1.json": strictJsonCodec.encode(bundle.generation as unknown as StrictJsonValue),
		},
		commitBytes: strictJsonCodec.encode(
			strictSnapshot({
				schemaVersion: "graphrefly-ts.d37.premature-final-qualification-commit.v7",
				generationRef: D37_GENERATION_REF,
				bundleDigest: bundle.bundleDigest,
				qualificationDigest: bundle.qualification.qualificationDigest,
				generationDigest: bundle.generation.generationDigest,
			}) as unknown as StrictJsonValue,
		),
	});
}

export async function readD37BaselineBytes(path: string): Promise<Uint8Array> {
	return new Uint8Array(await readFile(path));
}
