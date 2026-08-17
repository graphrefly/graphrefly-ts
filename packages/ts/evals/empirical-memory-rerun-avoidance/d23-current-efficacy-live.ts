import { spawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import { persistCurrentGraphPrivateGeneration } from "./d6-current-private-persistence.js";
import type {
	CurrentGraphProviderAdmittedEffectV1,
	CurrentGraphProviderEffectResultInputV1,
	CurrentGraphProviderFactV1,
} from "./d6-current-provider-authority.js";
import {
	CURRENT_GRAPH_LIVE_ROUTE,
	CURRENT_GRAPH_LIVE_WRITABLE_FILE,
} from "./d8-current-live-coordinates.js";
import { createCurrentGraphOpenRouterExecutor } from "./d8-current-openrouter-adapter.js";
import {
	admitD9ProviderEffectResult,
	createD9ProviderRejectionAuthority,
	type D9ProviderRejectionEvidenceV1,
	type D9ProviderRejectionFactV1,
	snapshotD9BoundedCanonicalEvidence,
	snapshotD9ProviderRejectionEvidence,
	takeD9ProviderEffect,
	validateD9ProviderRejectionEvidence,
} from "./d9-current-provider-rejection-authority.js";
import {
	D21_LIMITS,
	D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
	D21_TASK_PROFILE,
} from "./d21-current-efficacy-recovery-authority.js";
import {
	D22_FIXED_ADMISSION_BLOCK,
	D22_INITIAL_ADMISSION_BLOCK,
	D22_WRONG_ADMISSION_BLOCK,
	validateD22QualificationBundle,
} from "./d22-current-efficacy-real-provider-qualification.js";
import {
	consumeD23ExecutionAuthority,
	D23_CLAIM_SCHEMA,
	type D23DispatchClaimV1,
	type D23ExecutionAuthorityV1,
} from "./d23-current-efficacy-live-claim.js";
import {
	D23_COORDINATES_DIGEST,
	D23_D22_ARTIFACT_DIGEST,
	D23_D22_BUNDLE_DIGEST,
	D23_D22_GENERATION_DIGEST,
	D23_D22_IMPLEMENTATION_MANIFEST_DIGEST,
	D23_D22_QUALIFICATION_DIGEST,
	D23_DECISION_REF,
	D23_GENERATION_REF,
} from "./d23-current-efficacy-live-coordinates.js";
import type { D23CredentialV1 } from "./d23-current-efficacy-live-preflight.js";

export const D23_BASELINE_ADMISSION_REVISION =
	"graphrefly-ts.d23.d22-baseline-admission.v1" as const;
export const D23_BUNDLE_SCHEMA = "graphrefly-ts.d23.live-bundle.v1" as const;
export const D23_PARTIAL_GRAPH_SCHEMA = "graphrefly-ts.d23.partial-graph-evidence.v1" as const;
export const D23_GATE_SCHEMA = "graphrefly-ts.d23.positive-differential-gate.v1" as const;
export const D23_GENERATION_SCHEMA = "graphrefly-ts.d23.live-generation.v1" as const;
export const D23_TERMINAL_RECEIPT_SCHEMA = "graphrefly-ts.d23.live-terminal-receipt.v1" as const;
export const D23_PERSISTENCE_SCHEMA = "graphrefly-ts.d23.live-persistence.v1" as const;
export const D23_PREEXECUTION_FAILURE_SCHEMA =
	"graphrefly-ts.d23.live-preexecution-failure.v1" as const;
export const D23_MAX_BUNDLE_BYTES = 4_194_304;

export interface D23D22BaselineAdmissionV1 {
	readonly revision: typeof D23_BASELINE_ADMISSION_REVISION;
}

export interface D23Executor {
	readonly execute: (
		effect: CurrentGraphProviderAdmittedEffectV1,
	) => Promise<CurrentGraphProviderEffectResultInputV1>;
	readonly dispose: () => Promise<void>;
}

export interface D23PartialGraphEvidenceV1 {
	readonly schemaVersion: typeof D23_PARTIAL_GRAPH_SCHEMA;
	readonly decisionRef: typeof D23_DECISION_REF;
	readonly coordinatesDigest: string;
	readonly providerFacts: readonly CurrentGraphProviderFactV1[];
	readonly rejectionFacts: readonly D9ProviderRejectionFactV1[];
	readonly activeRequestDigest: string | null;
	readonly failureCode:
		| "executor-boundary-failed"
		| "graph-admission-failed"
		| "effect-bound-exhausted"
		| "executor-disposal-failed";
	readonly failureEffectKind: string | null;
	readonly partialGraphDigest: string;
}

export interface D23PositiveDifferentialGateV1 {
	readonly schemaVersion: typeof D23_GATE_SCHEMA;
	readonly definitionDigest: string;
	readonly evaluated: boolean;
	readonly passed: boolean;
	readonly failureCodes: readonly string[];
	readonly gateDigest: string;
}

export interface D23LiveBundleV1 {
	readonly schemaVersion: typeof D23_BUNDLE_SCHEMA;
	readonly decisionRef: typeof D23_DECISION_REF;
	readonly executionClass: "live-provider" | "injected-no-network";
	readonly disposition: "success" | "partial-failure";
	readonly coordinatesDigest: string;
	readonly implementationManifestDigest: string;
	readonly d22ArtifactDigest: typeof D23_D22_ARTIFACT_DIGEST;
	readonly d22BundleDigest: typeof D23_D22_BUNDLE_DIGEST;
	readonly d22QualificationDigest: typeof D23_D22_QUALIFICATION_DIGEST;
	readonly d22GenerationDigest: typeof D23_D22_GENERATION_DIGEST;
	readonly d22ImplementationManifestDigest: typeof D23_D22_IMPLEMENTATION_MANIFEST_DIGEST;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly claimDigest: string;
	readonly currentKeyAdmissionDigest: string;
	readonly graphEvidence: D9ProviderRejectionEvidenceV1 | null;
	readonly partialGraphEvidence: D23PartialGraphEvidenceV1 | null;
	readonly deadlineProjection: Readonly<{
		ordinaryProviderRequests: number;
		semanticCorrectionProviderRequests: number;
		ordinaryDeadlineMs: 120_000;
		semanticCorrectionDeadlineMs: 240_000;
		projectionDigest: string;
	}>;
	readonly gate: D23PositiveDifferentialGateV1;
	readonly generation: Readonly<Record<string, StrictJsonValue>> | null;
	readonly terminalReceipt: Readonly<Record<string, StrictJsonValue>>;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none" | "frozen-task-block-positive-differential";
	readonly bundleDigest: string;
}

const baselines = new WeakMap<object, "consumed-d22-artifact" | "injected-test">();
const constructedBundles = new WeakSet<object>();
const D23_PUBLIC_SEMANTIC_TEST_NAME = "admits only a fresh D419 managed remote run" as const;
const D23_PROCESS_OUTPUT_BOUND = 2 * 1_048_576;

function baselineCapability(
	basis: "consumed-d22-artifact" | "injected-test",
): D23D22BaselineAdmissionV1 {
	const capability = Object.freeze({ revision: D23_BASELINE_ADMISSION_REVISION });
	baselines.set(capability, basis);
	return capability;
}

export function admitD23D22Baseline(bytesValue: Uint8Array): D23D22BaselineAdmissionV1 {
	if (!(bytesValue instanceof Uint8Array))
		throw new TypeError("D23 D22 baseline bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D23_D22_ARTIFACT_DIGEST)
		throw new TypeError("D23 D22 baseline artifact drifted");
	const bundle = validateD22QualificationBundle(strictJsonCodec.decode(bytes));
	if (
		bundle.basis !== "consumed-d21-artifact" ||
		bundle.bundleDigest !== D23_D22_BUNDLE_DIGEST ||
		bundle.qualification.qualificationDigest !== D23_D22_QUALIFICATION_DIGEST ||
		bundle.generation.generationDigest !== D23_D22_GENERATION_DIGEST ||
		bundle.qualification.implementationManifestDigest !== D23_D22_IMPLEMENTATION_MANIFEST_DIGEST
	)
		throw new TypeError("D23 D22 baseline coordinates drifted");
	return baselineCapability("consumed-d22-artifact");
}

export function createD23InjectedBaselineForTest(): D23D22BaselineAdmissionV1 {
	return baselineCapability("injected-test");
}

function consumeBaseline(
	value: unknown,
	executionClass: D23LiveBundleV1["executionClass"],
	allowConsumedForQualification = false,
): void {
	if (value === null || typeof value !== "object") throw new TypeError("D23 baseline is invalid");
	const basis = baselines.get(value);
	if (basis === undefined) throw new TypeError("D23 baseline is forged or replayed");
	baselines.delete(value);
	if (
		(executionClass === "live-provider" && basis !== "consumed-d22-artifact") ||
		(executionClass === "injected-no-network" &&
			basis !== "injected-test" &&
			!(allowConsumedForQualification && basis === "consumed-d22-artifact"))
	)
		throw new TypeError("D23 baseline execution class drifted");
}

function isProviderResultBoundaryError(error: unknown): boolean {
	if (error instanceof SyntaxError) return true;
	if (!(error instanceof TypeError)) return false;
	if (/^current live provider (?:newText|oldText|path) argument is invalid$/u.test(error.message))
		return true;
	return [
		"current live provider choices drifted",
		"current live provider did not return bounded tool calls",
		"current live provider tool call is invalid",
		"current live provider returned an unknown tool",
		"current live provider tool arguments exceeded their bound",
	].includes(error.message);
}

function deadlineFor(effect: CurrentGraphProviderAdmittedEffectV1): 120_000 | 240_000 {
	return effect.runtime.modelEnvelope?.correctionStage === "semantic-correction"
		? 240_000
		: 120_000;
}

async function runPublicSemanticScenario(input: {
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly effect: CurrentGraphProviderAdmittedEffectV1;
}): Promise<CurrentGraphProviderEffectResultInputV1> {
	const request = input.effect.request;
	if (request.effectKind !== "public-semantic-validation" || request.workspaceStateDigest === null)
		throw new TypeError("D23 public semantic request drifted");
	const started = performance.now();
	const cwd = join(input.materializationRoot, `${request.arm}-${request.runSequence}`);
	const outcome = await new Promise<Readonly<{ code: number; output: Uint8Array }>>(
		(resolvePromise, rejectPromise) => {
			const child = spawn(
				join(input.repositoryRoot, "node_modules/.bin/vitest"),
				[
					"run",
					"packages/ts/src/__tests__/managed-cloud-postgresql.test.ts",
					"-t",
					D23_PUBLIC_SEMANTIC_TEST_NAME,
				],
				{ cwd, stdio: ["ignore", "pipe", "pipe"] },
			);
			const chunks: Uint8Array[] = [];
			let bytes = 0;
			let settled = false;
			let timer: NodeJS.Timeout;
			const finish = (error?: Error, code = 1) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				if (error !== undefined) rejectPromise(error);
				else resolvePromise(Object.freeze({ code, output: Buffer.concat(chunks) }));
			};
			const collect = (chunk: Buffer) => {
				bytes += chunk.byteLength;
				if (bytes > D23_PROCESS_OUTPUT_BOUND) {
					child.kill("SIGKILL");
					finish(new TypeError("D23 public semantic output exceeded its bound"));
					return;
				}
				chunks.push(new Uint8Array(chunk));
			};
			child.stdout.on("data", collect);
			child.stderr.on("data", collect);
			child.once("error", (error) => finish(error));
			child.once("close", (code) => finish(undefined, code ?? 1));
			timer = setTimeout(() => {
				child.kill("SIGKILL");
				finish(new TypeError("D23 public semantic validation timed out"));
			}, request.reservation.maxElapsedMs);
			timer.unref();
		},
	);
	const passed = outcome.code === 0;
	return Object.freeze({
		effectKind: "public-semantic-validation" as const,
		status: passed ? ("passed" as const) : ("failed" as const),
		criterionFailures: passed ? [] : (["canonical-proposal-not-admitted"] as const),
		workspaceStateDigest: request.workspaceStateDigest,
		evidenceDigest: empiricalStrictJsonDigest({
			requestDigest: request.requestDigest,
			scenario: D23_PUBLIC_SEMANTIC_TEST_NAME,
			outputDigest: empiricalSha256(outcome.output),
			passed,
		}),
		actualCostMicrousd: 0 as const,
		actualElapsedMs: Math.min(
			request.reservation.maxElapsedMs,
			Math.max(1, Math.ceil(performance.now() - started)),
		),
	});
}

export function createD23RealProviderExecutor(input: {
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly credential: D23CredentialV1;
	readonly fetchImpl: typeof fetch;
	readonly now?: () => number;
	readonly sleep?: (ms: number) => Promise<void>;
	readonly observeDeadlineForTest?: (deadlineMs: 120_000 | 240_000) => void;
}): D23Executor {
	const repositoryRoot = resolve(input.repositoryRoot);
	const materializationRoot = resolve(input.materializationRoot);
	let currentDeadline: 120_000 | 240_000 | null = null;
	const fetchWithOperationalDeadline: typeof fetch = async (url, init) => {
		if (currentDeadline === null) throw new TypeError("D23 provider deadline was not admitted");
		const controller = new AbortController();
		const upstream = init?.signal;
		const abort = () => controller.abort(upstream?.reason);
		if (upstream?.aborted) abort();
		else upstream?.addEventListener("abort", abort, { once: true });
		const timer = setTimeout(() => controller.abort(), currentDeadline);
		timer.unref();
		try {
			return await input.fetchImpl(url, { ...init, signal: controller.signal });
		} finally {
			clearTimeout(timer);
			upstream?.removeEventListener("abort", abort);
		}
	};
	const base = createCurrentGraphOpenRouterExecutor({
		repositoryRoot,
		materializationRoot,
		credential: input.credential,
		fetchImpl: fetchWithOperationalDeadline,
		now: input.now,
		sleep: input.sleep,
	});
	return Object.freeze({
		async execute(effect: CurrentGraphProviderAdmittedEffectV1) {
			if (effect.request.effectKind === "provider-request") {
				currentDeadline = deadlineFor(effect);
				input.observeDeadlineForTest?.(currentDeadline);
			}
			try {
				return effect.request.effectKind === "public-semantic-validation"
					? await runPublicSemanticScenario({ repositoryRoot, materializationRoot, effect })
					: await base.execute(effect);
			} finally {
				currentDeadline = null;
			}
		},
		dispose: () => base.dispose(),
	});
}

function deadlineProjection(evidence: D9ProviderRejectionEvidenceV1 | null) {
	let ordinaryProviderRequests = 0;
	let semanticCorrectionProviderRequests = 0;
	for (const fact of evidence?.providerEvidence.facts ?? []) {
		if (fact.request.effectKind !== "provider-request") continue;
		const source = evidence?.providerEvidence.workflowEvidence.facts.find(
			(candidate) => candidate.request.requestDigest === fact.request.sourceWorkflowRequestDigest,
		);
		if (source?.request.correctionDirective?.stage === "semantic-correction")
			semanticCorrectionProviderRequests += 1;
		else ordinaryProviderRequests += 1;
	}
	const material = strictSnapshot({
		ordinaryProviderRequests,
		semanticCorrectionProviderRequests,
		ordinaryDeadlineMs: 120_000 as const,
		semanticCorrectionDeadlineMs: 240_000 as const,
	});
	return Object.freeze({ ...material, projectionDigest: empiricalStrictJsonDigest(material) });
}

function evaluateGate(
	evidence: D9ProviderRejectionEvidenceV1 | null,
	evaluated: boolean,
): D23PositiveDifferentialGateV1 {
	const failures: string[] = [];
	if (evidence === null) failures.push("measurement-incomplete");
	else {
		const workflow = evidence.providerEvidence.workflowEvidence;
		if (evidence.rejectionCount !== 0) failures.push("provider-result-rejection");
		if (workflow.runStatus !== "complete" || workflow.runs.length !== 6)
			failures.push("six-arm-completion-missing");
		const expectedArms = [
			"cold",
			"relevant-applied",
			"proposal-only",
			"admission-rejected",
			"irrelevant-applied",
			"wrong-scope-applied",
		] as const;
		for (const [index, arm] of expectedArms.entries()) {
			const run = workflow.runs[index];
			if (run?.arm !== arm) failures.push(`arm-order:${arm}`);
			if (
				run?.publicSemanticValidationAttempted !== true ||
				run.publicSemanticValidationPassed !== true ||
				run.hiddenVerifierAttempted !== true ||
				run.cleanupStatus !== "completed"
			)
				failures.push(`not-evaluable:${arm}`);
			const expectedHidden = arm === "relevant-applied";
			if (run?.hiddenVerifierPassed !== expectedHidden) failures.push(`hidden-differential:${arm}`);
		}
		if (
			evidence.providerEvidence.facts.some(
				(fact) => fact.result.effectKind === "provider-request" && fact.result.status === "failed",
			)
		)
			failures.push("provider-attempt-failure");
	}
	const material = strictSnapshot({
		schemaVersion: D23_GATE_SCHEMA,
		definitionDigest: D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
		evaluated,
		passed: evaluated && failures.length === 0,
		failureCodes: Object.freeze(failures),
	});
	return Object.freeze({
		...material,
		gateDigest: empiricalStrictJsonDigest(material),
	}) as D23PositiveDifferentialGateV1;
}

function partialEvidence(input: {
	readonly providerFacts: readonly CurrentGraphProviderFactV1[];
	readonly rejectionFacts: readonly D9ProviderRejectionFactV1[];
	readonly active: CurrentGraphProviderAdmittedEffectV1 | null;
	readonly failureCode: D23PartialGraphEvidenceV1["failureCode"];
}): D23PartialGraphEvidenceV1 {
	const material = strictSnapshot({
		schemaVersion: D23_PARTIAL_GRAPH_SCHEMA,
		decisionRef: D23_DECISION_REF,
		coordinatesDigest: D23_COORDINATES_DIGEST,
		providerFacts: input.providerFacts,
		rejectionFacts: input.rejectionFacts,
		activeRequestDigest: input.active?.request.requestDigest ?? null,
		failureCode: input.failureCode,
		failureEffectKind: input.active?.request.effectKind ?? null,
	});
	return Object.freeze({
		...material,
		partialGraphDigest: empiricalStrictJsonDigest(material),
	}) as D23PartialGraphEvidenceV1;
}

function partialUsage(partial: D23PartialGraphEvidenceV1 | null) {
	let providerAttempts = 0;
	let confirmedCostMicrousd = 0;
	for (const fact of partial?.providerFacts ?? []) {
		if (fact.request.effectKind === "provider-request") providerAttempts += 1;
		confirmedCostMicrousd += fact.reconciliation.actualCostMicrousd;
	}
	return Object.freeze({ providerAttempts, confirmedCostMicrousd });
}

async function drive(input: {
	readonly executionAuthority: D23ExecutionAuthorityV1;
	readonly baseline: D23D22BaselineAdmissionV1;
	readonly executionClass: D23LiveBundleV1["executionClass"];
	readonly executor: D23Executor;
	readonly implementationManifestDigest: string;
	readonly allowConsumedBaselineForQualification?: boolean;
}): Promise<D23LiveBundleV1> {
	consumeBaseline(
		input.baseline,
		input.executionClass,
		input.allowConsumedBaselineForQualification === true,
	);
	const authority = consumeD23ExecutionAuthority(input.executionAuthority);
	if (
		authority.claim.implementationManifestDigest !== input.implementationManifestDigest ||
		(authority.claim.scope === "live-fixed-root") !== (input.executionClass === "live-provider")
	)
		throw new TypeError("D23 execution authority scope drifted");
	const graph = createD9ProviderRejectionAuthority({
		limits: D21_LIMITS,
		routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
		taskProfile: D21_TASK_PROFILE,
	});
	const providerFacts: CurrentGraphProviderFactV1[] = [];
	const rejectionFacts: D9ProviderRejectionFactV1[] = [];
	let active: CurrentGraphProviderAdmittedEffectV1 | null = null;
	let graphEvidence: D9ProviderRejectionEvidenceV1 | null = null;
	let failureCode: D23PartialGraphEvidenceV1["failureCode"] | null = null;
	try {
		for (let guard = 0; guard < D21_LIMITS.maxEffectFacts; guard += 1) {
			active = takeD9ProviderEffect(graph);
			if (active === null) {
				graphEvidence = validateD9ProviderRejectionEvidence(
					snapshotD9ProviderRejectionEvidence(graph),
				);
				break;
			}
			let result: CurrentGraphProviderEffectResultInputV1;
			try {
				result = await input.executor.execute(active);
			} catch (error) {
				if (
					active.request.effectKind === "provider-request" &&
					isProviderResultBoundaryError(error)
				)
					result = Object.freeze({}) as CurrentGraphProviderEffectResultInputV1;
				else {
					failureCode = "executor-boundary-failed";
					break;
				}
			}
			try {
				const outcome = admitD9ProviderEffectResult(graph, active.request.requestDigest, result);
				providerFacts.push(outcome.providerFact);
				if (outcome.rejectionFact !== null) rejectionFacts.push(outcome.rejectionFact);
			} catch {
				failureCode = "graph-admission-failed";
				break;
			}
		}
		if (graphEvidence === null && failureCode === null) failureCode = "effect-bound-exhausted";
	} finally {
		try {
			await input.executor.dispose();
		} catch {
			failureCode ??= "executor-disposal-failed";
		}
	}
	const success = graphEvidence !== null && failureCode === null;
	const partialGraphEvidence = success
		? null
		: partialEvidence({
				providerFacts,
				rejectionFacts,
				active,
				failureCode: failureCode ?? "graph-admission-failed",
			});
	const gate = evaluateGate(graphEvidence, input.executionClass === "live-provider" && success);
	const efficacyClaim = gate.passed
		? ("frozen-task-block-positive-differential" as const)
		: ("none" as const);
	const deadlines = deadlineProjection(graphEvidence);
	const generation = success
		? (() => {
				const material = strictSnapshot({
					schemaVersion: D23_GENERATION_SCHEMA,
					generationRef: D23_GENERATION_REF,
					coordinatesDigest: D23_COORDINATES_DIGEST,
					graphEvidenceDigest: graphEvidence!.evidenceDigest,
					deadlineProjectionDigest: deadlines.projectionDigest,
					gateDigest: gate.gateDigest,
					implementationManifestDigest: input.implementationManifestDigest,
					qualificationArtifactDigest: authority.claim.qualificationArtifactDigest,
					qualificationDigest: authority.claim.qualificationDigest,
					causalAttribution: "undetermined" as const,
					efficacyClaim,
				});
				return Object.freeze({
					...material,
					generationDigest: empiricalStrictJsonDigest(material),
				});
			})()
		: null;
	const usage =
		graphEvidence === null
			? partialUsage(partialGraphEvidence)
			: {
					providerAttempts: graphEvidence.providerEvidence.budget.providerAttempts,
					confirmedCostMicrousd: graphEvidence.providerEvidence.budget.confirmedCostMicrousd,
				};
	const terminalMaterial = strictSnapshot({
		schemaVersion: D23_TERMINAL_RECEIPT_SCHEMA,
		decisionRef: D23_DECISION_REF,
		disposition: success ? ("success" as const) : ("partial-failure" as const),
		claimDigest: authority.claim.claimDigest,
		currentKeyAdmissionDigest: authority.currentKeyAdmission.admissionDigest,
		graphEvidenceDigest: graphEvidence?.evidenceDigest ?? null,
		partialGraphDigest: partialGraphEvidence?.partialGraphDigest ?? null,
		gateDigest: gate.gateDigest,
		providerAttempts: usage.providerAttempts,
		confirmedCostMicrousd: usage.confirmedCostMicrousd,
		failureCode,
		causalAttribution: "undetermined" as const,
		efficacyClaim,
	});
	const terminalReceipt = Object.freeze({
		...terminalMaterial,
		terminalReceiptDigest: empiricalStrictJsonDigest(terminalMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D23_BUNDLE_SCHEMA,
		decisionRef: D23_DECISION_REF,
		executionClass: input.executionClass,
		disposition: success ? ("success" as const) : ("partial-failure" as const),
		coordinatesDigest: D23_COORDINATES_DIGEST,
		implementationManifestDigest: input.implementationManifestDigest,
		d22ArtifactDigest: D23_D22_ARTIFACT_DIGEST,
		d22BundleDigest: D23_D22_BUNDLE_DIGEST,
		d22QualificationDigest: D23_D22_QUALIFICATION_DIGEST,
		d22GenerationDigest: D23_D22_GENERATION_DIGEST,
		d22ImplementationManifestDigest: D23_D22_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: authority.claim.qualificationArtifactDigest,
		qualificationDigest: authority.claim.qualificationDigest,
		pricingObservationDigest: authority.claim.pricingObservationDigest,
		zeroByokObservationDigest: authority.claim.zeroByokObservationDigest,
		claimDigest: authority.claim.claimDigest,
		currentKeyAdmissionDigest: authority.currentKeyAdmission.admissionDigest,
		graphEvidence,
		partialGraphEvidence,
		deadlineProjection: deadlines,
		gate,
		generation,
		terminalReceipt,
		causalAttribution: "undetermined" as const,
		efficacyClaim,
	});
	const bundle = Object.freeze({
		...material,
		bundleDigest: empiricalStrictJsonDigest(material),
	}) as D23LiveBundleV1;
	if (
		strictJsonCodec.encode(bundle as unknown as StrictJsonValue).byteLength > D23_MAX_BUNDLE_BYTES
	)
		throw new TypeError("D23 live bundle exceeded its byte bound");
	constructedBundles.add(bundle);
	return bundle;
}

function credentialBinding(credential: D23CredentialV1): string {
	return empiricalStrictJsonDigest({
		credentialBindingRef: credential.credentialBindingRef,
		credentialBindingRevision: credential.credentialBindingRevision,
		keyVisiblePrefix: credential.bearerToken.slice(0, 12),
		keyVisibleSuffix: credential.bearerToken.slice(-3),
	});
}

export async function runD23LiveMeasurement(input: {
	readonly executionAuthority: D23ExecutionAuthorityV1;
	readonly baseline: D23D22BaselineAdmissionV1;
	readonly credential: D23CredentialV1;
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly implementationManifestDigest: string;
	readonly now?: () => number;
	readonly sleep?: (ms: number) => Promise<void>;
}): Promise<D23LiveBundleV1> {
	if (
		input.executionAuthority.claim.scope !== "live-fixed-root" ||
		credentialBinding(input.credential) !== input.executionAuthority.claim.credentialBindingDigest
	)
		throw new TypeError("D23 live credential or claim scope drifted");
	return drive({
		executionAuthority: input.executionAuthority,
		baseline: input.baseline,
		executionClass: "live-provider",
		executor: createD23RealProviderExecutor({
			repositoryRoot: input.repositoryRoot,
			materializationRoot: input.materializationRoot,
			credential: input.credential,
			fetchImpl: globalThis.fetch,
			now: input.now,
			sleep: input.sleep,
		}),
		implementationManifestDigest: input.implementationManifestDigest,
	});
}

export async function runD23InjectedMeasurementForTest(input: {
	readonly executionAuthority: D23ExecutionAuthorityV1;
	readonly baseline: D23D22BaselineAdmissionV1;
	readonly executor: D23Executor;
	readonly implementationManifestDigest: string;
	readonly allowConsumedBaselineForQualification?: boolean;
}): Promise<D23LiveBundleV1> {
	return drive({ ...input, executionClass: "injected-no-network" });
}

function validatePartial(value: unknown): D23PartialGraphEvidenceV1 {
	const candidate = record(value, "D23 partial Graph evidence");
	exactKeys(
		candidate,
		[
			"activeRequestDigest",
			"coordinatesDigest",
			"decisionRef",
			"failureCode",
			"failureEffectKind",
			"partialGraphDigest",
			"providerFacts",
			"rejectionFacts",
			"schemaVersion",
		],
		"D23 partial Graph evidence",
	);
	if (
		candidate.schemaVersion !== D23_PARTIAL_GRAPH_SCHEMA ||
		candidate.decisionRef !== D23_DECISION_REF ||
		candidate.coordinatesDigest !== D23_COORDINATES_DIGEST ||
		![
			"executor-boundary-failed",
			"graph-admission-failed",
			"effect-bound-exhausted",
			"executor-disposal-failed",
		].includes(String(candidate.failureCode))
	)
		throw new TypeError("D23 partial Graph coordinates drifted");
	const providerFacts = array(candidate.providerFacts, "D23 partial provider facts");
	const rejectionFacts = array(candidate.rejectionFacts, "D23 partial rejection facts");
	if (providerFacts.length > 512 || rejectionFacts.length > 6)
		throw new TypeError("D23 partial Graph facts exceeded their bound");
	for (const [index, factValue] of providerFacts.entries()) {
		const fact = record(factValue, `D23 partial provider facts[${index}]`);
		exactKeys(
			fact,
			[
				"admission",
				"arm",
				"factDigest",
				"reconciliation",
				"request",
				"result",
				"runSequence",
				"sequence",
			],
			`D23 partial provider facts[${index}]`,
		);
		safeInteger(fact.sequence, `D23 partial provider facts[${index}].sequence`, {
			min: 0,
			max: 511,
		});
		digest(fact.factDigest, `D23 partial provider facts[${index}].factDigest`);
		const { factDigest, ...factMaterial } = fact;
		if (factDigest !== empiricalStrictJsonDigest(factMaterial))
			throw new TypeError("D23 partial provider fact digest drifted");
	}
	const providerFactDigests = new Set(
		providerFacts.map((fact, index) =>
			String(record(fact, `D23 partial provider facts[${index}]`).factDigest),
		),
	);
	for (const [index, factValue] of rejectionFacts.entries()) {
		const fact = record(factValue, `D23 partial rejection facts[${index}]`);
		exactKeys(
			fact,
			[
				"admission",
				"arm",
				"candidateDigest",
				"causeCode",
				"factDigest",
				"providerFactDigest",
				"reconciliation",
				"request",
				"runSequence",
				"schemaVersion",
				"sequence",
			],
			`D23 partial rejection facts[${index}]`,
		);
		if (fact.sequence !== index || !providerFactDigests.has(String(fact.providerFactDigest)))
			throw new TypeError("D23 partial rejection fact lost its provider binding");
		digest(fact.factDigest, `D23 partial rejection facts[${index}].factDigest`);
		const { factDigest, ...factMaterial } = fact;
		if (factDigest !== empiricalStrictJsonDigest(factMaterial))
			throw new TypeError("D23 partial rejection fact digest drifted");
	}
	if (candidate.activeRequestDigest !== null)
		digest(candidate.activeRequestDigest, "D23 partial active request");
	const { partialGraphDigest, ...material } = candidate;
	if (partialGraphDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D23 partial Graph digest drifted");
	return strictSnapshot(candidate) as unknown as D23PartialGraphEvidenceV1;
}

export function validateD23LiveBundle(value: unknown): D23LiveBundleV1 {
	const candidate = snapshotD9BoundedCanonicalEvidence(value) as Record<string, unknown>;
	const bundle = record(candidate, "D23 live bundle");
	exactKeys(
		bundle,
		[
			"bundleDigest",
			"causalAttribution",
			"claimDigest",
			"coordinatesDigest",
			"currentKeyAdmissionDigest",
			"d22ArtifactDigest",
			"d22BundleDigest",
			"d22GenerationDigest",
			"d22ImplementationManifestDigest",
			"d22QualificationDigest",
			"deadlineProjection",
			"decisionRef",
			"disposition",
			"efficacyClaim",
			"executionClass",
			"gate",
			"generation",
			"graphEvidence",
			"implementationManifestDigest",
			"partialGraphEvidence",
			"pricingObservationDigest",
			"qualificationArtifactDigest",
			"qualificationDigest",
			"schemaVersion",
			"terminalReceipt",
			"zeroByokObservationDigest",
		],
		"D23 live bundle",
	);
	if (
		bundle.schemaVersion !== D23_BUNDLE_SCHEMA ||
		bundle.decisionRef !== D23_DECISION_REF ||
		bundle.coordinatesDigest !== D23_COORDINATES_DIGEST ||
		bundle.d22ArtifactDigest !== D23_D22_ARTIFACT_DIGEST ||
		bundle.d22BundleDigest !== D23_D22_BUNDLE_DIGEST ||
		bundle.d22QualificationDigest !== D23_D22_QUALIFICATION_DIGEST ||
		bundle.d22GenerationDigest !== D23_D22_GENERATION_DIGEST ||
		bundle.d22ImplementationManifestDigest !== D23_D22_IMPLEMENTATION_MANIFEST_DIGEST ||
		bundle.causalAttribution !== "undetermined"
	)
		throw new TypeError("D23 live bundle coordinates drifted");
	for (const key of [
		"bundleDigest",
		"claimDigest",
		"currentKeyAdmissionDigest",
		"implementationManifestDigest",
		"pricingObservationDigest",
		"qualificationArtifactDigest",
		"qualificationDigest",
		"zeroByokObservationDigest",
	] as const)
		digest(bundle[key], `D23 live bundle.${key}`);
	const graphEvidence =
		bundle.graphEvidence === null
			? null
			: validateD9ProviderRejectionEvidence(bundle.graphEvidence);
	const partialGraphEvidence =
		bundle.partialGraphEvidence === null ? null : validatePartial(bundle.partialGraphEvidence);
	if (
		(bundle.disposition === "success" &&
			(graphEvidence === null || partialGraphEvidence !== null || bundle.generation === null)) ||
		(bundle.disposition === "partial-failure" &&
			(graphEvidence !== null || partialGraphEvidence === null || bundle.generation !== null))
	)
		throw new TypeError("D23 live bundle disposition drifted");
	if (bundle.executionClass !== "live-provider" && bundle.executionClass !== "injected-no-network")
		throw new TypeError("D23 live execution class drifted");
	const expectedDeadlines = deadlineProjection(graphEvidence);
	if (
		empiricalStrictJsonDigest(bundle.deadlineProjection) !==
		empiricalStrictJsonDigest(expectedDeadlines)
	)
		throw new TypeError("D23 deadline projection drifted");
	const expectedGate = evaluateGate(
		graphEvidence,
		bundle.executionClass === "live-provider" && bundle.disposition === "success",
	);
	if (empiricalStrictJsonDigest(bundle.gate) !== empiricalStrictJsonDigest(expectedGate))
		throw new TypeError("D23 live gate projection drifted");
	const expectedClaim = expectedGate.passed ? "frozen-task-block-positive-differential" : "none";
	if (bundle.efficacyClaim !== expectedClaim) throw new TypeError("D23 efficacy claim drifted");
	const terminal = record(bundle.terminalReceipt, "D23 terminal receipt");
	exactKeys(
		terminal,
		[
			"causalAttribution",
			"claimDigest",
			"confirmedCostMicrousd",
			"currentKeyAdmissionDigest",
			"decisionRef",
			"disposition",
			"efficacyClaim",
			"failureCode",
			"gateDigest",
			"graphEvidenceDigest",
			"partialGraphDigest",
			"providerAttempts",
			"schemaVersion",
			"terminalReceiptDigest",
		],
		"D23 terminal receipt",
	);
	const expectedUsage =
		graphEvidence === null
			? partialUsage(partialGraphEvidence)
			: {
					providerAttempts: graphEvidence.providerEvidence.budget.providerAttempts,
					confirmedCostMicrousd: graphEvidence.providerEvidence.budget.confirmedCostMicrousd,
				};
	const { terminalReceiptDigest, ...terminalMaterial } = terminal;
	if (
		terminal.schemaVersion !== D23_TERMINAL_RECEIPT_SCHEMA ||
		terminal.decisionRef !== D23_DECISION_REF ||
		terminal.disposition !== bundle.disposition ||
		terminal.claimDigest !== bundle.claimDigest ||
		terminal.currentKeyAdmissionDigest !== bundle.currentKeyAdmissionDigest ||
		terminal.graphEvidenceDigest !== (graphEvidence?.evidenceDigest ?? null) ||
		terminal.partialGraphDigest !== (partialGraphEvidence?.partialGraphDigest ?? null) ||
		terminal.gateDigest !== expectedGate.gateDigest ||
		terminal.providerAttempts !== expectedUsage.providerAttempts ||
		terminal.confirmedCostMicrousd !== expectedUsage.confirmedCostMicrousd ||
		terminal.failureCode !== (partialGraphEvidence?.failureCode ?? null) ||
		terminal.causalAttribution !== "undetermined" ||
		terminal.efficacyClaim !== expectedClaim ||
		terminalReceiptDigest !== empiricalStrictJsonDigest(terminalMaterial)
	)
		throw new TypeError("D23 terminal receipt drifted");
	if (bundle.generation !== null) {
		const generation = record(bundle.generation, "D23 generation");
		exactKeys(
			generation,
			[
				"causalAttribution",
				"coordinatesDigest",
				"deadlineProjectionDigest",
				"efficacyClaim",
				"gateDigest",
				"generationDigest",
				"generationRef",
				"graphEvidenceDigest",
				"implementationManifestDigest",
				"qualificationArtifactDigest",
				"qualificationDigest",
				"schemaVersion",
			],
			"D23 generation",
		);
		const { generationDigest, ...generationMaterial } = generation;
		if (
			generation.schemaVersion !== D23_GENERATION_SCHEMA ||
			generation.generationRef !== D23_GENERATION_REF ||
			generation.coordinatesDigest !== D23_COORDINATES_DIGEST ||
			generation.graphEvidenceDigest !== graphEvidence?.evidenceDigest ||
			generation.deadlineProjectionDigest !== expectedDeadlines.projectionDigest ||
			generation.gateDigest !== expectedGate.gateDigest ||
			generation.implementationManifestDigest !== bundle.implementationManifestDigest ||
			generation.qualificationArtifactDigest !== bundle.qualificationArtifactDigest ||
			generation.qualificationDigest !== bundle.qualificationDigest ||
			generation.causalAttribution !== "undetermined" ||
			generation.efficacyClaim !== expectedClaim ||
			generationDigest !== empiricalStrictJsonDigest(generationMaterial)
		)
			throw new TypeError("D23 generation drifted");
	}
	const { bundleDigest, ...material } = bundle;
	if (bundleDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D23 live bundle digest drifted");
	return strictSnapshot(bundle) as unknown as D23LiveBundleV1;
}

export async function persistD23LiveBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D23LiveBundleV1;
}) {
	const input = record(inputValue, "D23 persistence input");
	exactKeys(input, ["bundle", "privateRoot"], "D23 persistence input");
	if (
		input.bundle === null ||
		typeof input.bundle !== "object" ||
		!constructedBundles.delete(input.bundle)
	)
		throw new TypeError("D23 persistence requires a same-process unconsumed bundle");
	const bundle = validateD23LiveBundle(input.bundle);
	const bundleBytes = strictJsonCodec.encode(bundle as unknown as StrictJsonValue);
	const terminalBytes = strictJsonCodec.encode(bundle.terminalReceipt as StrictJsonValue);
	const artifacts: Record<string, Uint8Array> = {
		"bundle.v1.json": bundleBytes,
		"terminal-receipt.v1.json": terminalBytes,
	};
	if (bundle.generation !== null)
		artifacts["generation.v1.json"] = strictJsonCodec.encode(bundle.generation as StrictJsonValue);
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d23.live-commit.v1",
		generationRef: D23_GENERATION_REF,
		disposition: bundle.disposition,
		bundleDigest: bundle.bundleDigest,
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		terminalReceiptDigest: digest(
			bundle.terminalReceipt.terminalReceiptDigest,
			"D23 terminal receipt",
		),
		generationDigest:
			bundle.generation === null
				? null
				: digest(bundle.generation.generationDigest, "D23 generation digest"),
	});
	const commit = Object.freeze({
		...commitMaterial,
		commitDigest: empiricalStrictJsonDigest(commitMaterial),
	});
	const receipt = await persistCurrentGraphPrivateGeneration({
		privateRoot: String(input.privateRoot),
		generationRef: D23_GENERATION_REF,
		artifacts,
		commitBytes: strictJsonCodec.encode(commit as unknown as StrictJsonValue),
	});
	return Object.freeze({
		schemaVersion: D23_PERSISTENCE_SCHEMA,
		generationRef: D23_GENERATION_REF,
		disposition: bundle.disposition,
		bundleDigest: bundle.bundleDigest,
		commitDigest: commit.commitDigest,
		persistenceReceiptDigest: receipt.receiptDigest,
		persistenceDigest: empiricalStrictJsonDigest({
			bundleDigest: bundle.bundleDigest,
			commitDigest: commit.commitDigest,
			persistenceReceiptDigest: receipt.receiptDigest,
		}),
	});
}

export async function persistD23PreexecutionFailure(inputValue: {
	readonly privateRoot: string;
	readonly claim: D23DispatchClaimV1;
	readonly implementationManifestDigest: string;
	readonly failurePhase: "current-key-admission" | "execution-construction";
	readonly allowInjectedTestScope?: boolean;
}) {
	const input = record(inputValue, "D23 preexecution failure input");
	exactKeys(
		input,
		Object.hasOwn(input, "allowInjectedTestScope")
			? [
					"allowInjectedTestScope",
					"claim",
					"failurePhase",
					"implementationManifestDigest",
					"privateRoot",
				]
			: ["claim", "failurePhase", "implementationManifestDigest", "privateRoot"],
		"D23 preexecution failure input",
	);
	const claim = record(input.claim, "D23 preexecution failure claim");
	exactKeys(
		claim,
		[
			"blockCount",
			"blockHardCapMicrousd",
			"claimDigest",
			"claimRef",
			"coordinatesDigest",
			"credentialBindingDigest",
			"decisionRef",
			"generationRef",
			"implementationManifestDigest",
			"localEvalNoResetLimitMicrousd",
			"preclaimDigest",
			"pricingObservationDigest",
			"qualificationArtifactDigest",
			"qualificationDigest",
			"schemaVersion",
			"scope",
			"zeroByokObservationDigest",
		],
		"D23 preexecution failure claim",
	);
	const { claimDigest, ...claimMaterial } = claim;
	if (
		claim.schemaVersion !== D23_CLAIM_SCHEMA ||
		claim.decisionRef !== D23_DECISION_REF ||
		claim.generationRef !== D23_GENERATION_REF ||
		(claim.scope !== "live-fixed-root" && input.allowInjectedTestScope !== true) ||
		claim.coordinatesDigest !== D23_COORDINATES_DIGEST ||
		claim.implementationManifestDigest !== input.implementationManifestDigest ||
		claimDigest !== empiricalStrictJsonDigest(claimMaterial) ||
		(input.failurePhase !== "current-key-admission" &&
			input.failurePhase !== "execution-construction")
	)
		throw new TypeError("D23 preexecution failure coordinates drifted");
	const failureMaterial = strictSnapshot({
		schemaVersion: D23_PREEXECUTION_FAILURE_SCHEMA,
		decisionRef: D23_DECISION_REF,
		generationRef: D23_GENERATION_REF,
		disposition: "partial-failure" as const,
		failurePhase: input.failurePhase as "current-key-admission" | "execution-construction",
		failureCode: "preexecution-admission-failed" as const,
		coordinatesDigest: D23_COORDINATES_DIGEST,
		claimDigest,
		implementationManifestDigest: claim.implementationManifestDigest,
		qualificationArtifactDigest: claim.qualificationArtifactDigest,
		qualificationDigest: claim.qualificationDigest,
		pricingObservationDigest: claim.pricingObservationDigest,
		zeroByokObservationDigest: claim.zeroByokObservationDigest,
		providerAttempts: 0 as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const failure = Object.freeze({
		...failureMaterial,
		failureDigest: empiricalStrictJsonDigest(failureMaterial),
	});
	const failureBytes = strictJsonCodec.encode(failure as unknown as StrictJsonValue);
	const commitMaterial = strictSnapshot({
		schemaVersion: "graphrefly-ts.d23.live-commit.v1",
		generationRef: D23_GENERATION_REF,
		disposition: "partial-failure" as const,
		bundleDigest: null,
		bundleArtifactDigest: null,
		terminalReceiptDigest: failure.failureDigest,
		generationDigest: null,
	});
	const commit = Object.freeze({
		...commitMaterial,
		commitDigest: empiricalStrictJsonDigest(commitMaterial),
	});
	const receipt = await persistCurrentGraphPrivateGeneration({
		privateRoot: String(input.privateRoot),
		generationRef: D23_GENERATION_REF,
		artifacts: { "preexecution-failure.v1.json": failureBytes },
		commitBytes: strictJsonCodec.encode(commit as unknown as StrictJsonValue),
	});
	return Object.freeze({
		schemaVersion: D23_PERSISTENCE_SCHEMA,
		generationRef: D23_GENERATION_REF,
		disposition: "partial-failure" as const,
		failureDigest: failure.failureDigest,
		commitDigest: commit.commitDigest,
		persistenceReceiptDigest: receipt.receiptDigest,
		persistenceDigest: empiricalStrictJsonDigest({
			failureDigest: failure.failureDigest,
			commitDigest: commit.commitDigest,
			persistenceReceiptDigest: receipt.receiptDigest,
		}),
	});
}

export async function assertD23NoWorkspaceResidue(path: string): Promise<void> {
	await lstat(path).then(
		() => {
			throw new TypeError("D23 left workspace residue");
		},
		(error: unknown) => {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		},
	);
}

export const D23_FIXTURE_BLOCKS = Object.freeze({
	initial: D22_INITIAL_ADMISSION_BLOCK,
	wrong: D22_WRONG_ADMISSION_BLOCK,
	fixed: D22_FIXED_ADMISSION_BLOCK,
	writableFile: CURRENT_GRAPH_LIVE_WRITABLE_FILE,
});
