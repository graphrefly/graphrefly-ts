import { spawn } from "node:child_process";
import { chmod, lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";
import { persistCurrentGraphPrivateGeneration } from "./d6-current-private-persistence.js";
import type {
	CurrentGraphProviderAdmittedEffectV1,
	CurrentGraphProviderEffectResultInputV1,
} from "./d6-current-provider-authority.js";
import {
	CURRENT_GRAPH_LIVE_READABLE_FILES,
	CURRENT_GRAPH_LIVE_ROUTE,
	CURRENT_GRAPH_LIVE_WRITABLE_FILE,
} from "./d8-current-live-coordinates.js";
import {
	CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK,
	CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK,
	createCurrentGraphOpenRouterExecutor,
} from "./d8-current-openrouter-adapter.js";
import {
	admitD9ProviderEffectResult,
	createD9ProviderRejectionAuthority,
	type D9ProviderRejectionEvidenceV1,
	snapshotD9BoundedCanonicalEvidence,
	snapshotD9ProviderRejectionEvidence,
	takeD9ProviderEffect,
	validateD9ProviderRejectionEvidence,
} from "./d9-current-provider-rejection-authority.js";
import {
	D21_D20_FAILURE_BASELINE,
	D21_EXPOSURE_MATRIX,
	D21_LIMITS,
	D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
	D21_TASK_PROFILE,
	validateD21QualificationBundle,
} from "./d21-current-efficacy-recovery-authority.js";
import { D22_IMPLEMENTATION_MANIFEST_DIGEST } from "./d22-current-efficacy-real-provider-implementation-manifest.js";

export const D22_DECISION_REF = "graphrefly-ts:D22" as const;
export const D22_AUTHORITY_REVISION =
	"graphrefly-ts.d22.current-efficacy-real-provider-composition.v1" as const;
export const D22_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d22.current-efficacy-real-provider-qualification.v1" as const;
export const D22_BUNDLE_SCHEMA =
	"graphrefly-ts.d22.current-efficacy-real-provider-bundle.v1" as const;
export const D22_GENERATION_SCHEMA =
	"graphrefly-ts.d22.current-efficacy-real-provider-generation.v1" as const;
export const D22_GENERATION_REF =
	"current-graph-native-efficacy-real-provider-no-network-2026-08-16-d22-v1" as const;
export const D22_INJECTED_TEST_GENERATION_REF =
	"current-graph-native-efficacy-real-provider-injected-test-d22-v1" as const;
export const D22_MAX_BUNDLE_BYTES = 4_194_304 as const;

export const D22_D21_BASELINE = Object.freeze({
	implementationCommit: "18104f297246c7a7a8b4b0aa19af836d9a2516ad" as const,
	bundleArtifactDigest:
		"sha256:7875cd108b8e96f2b99f98984e553235dac947bd935afe011c642eb9eecc1312" as const,
	bundleDigest: "sha256:92d2e5bf2385abd741516c84c2169ed9e0322f65c1aef1fc1776f7677ed6a129" as const,
	qualificationDigest:
		"sha256:de076c92225ac28987e238a59e8649871dfadd0035da9f54619f6d429f93517f" as const,
	generationDigest:
		"sha256:cc05cbc2fdfb8d23b4636005ab1f3bee5083e411f16595c973ba2f1c206985d5" as const,
	implementationManifestDigest:
		"sha256:234c8952d766601026457fa446b9531bb005b9be166fd1bd12881bcdc03fa76c" as const,
});

const D22_FIXED_ADMISSION_REF_SUFFIX = `
	if (admissionDecisionId !== undefined) {
		assertSafe(admissionDecisionId, "admission decision coordinate");
	}
	const requestRefs = refs(request.sourceRefs ?? []);
	if (
		!requestRefs.some(
			(ref) => ref.kind === "tool-provider-run-admission" && ref.id === admissionId,
		) ||`;
const D22_WRONG_ADMISSION_REF_SUFFIX = D22_FIXED_ADMISSION_REF_SUFFIX.replace(
	"ref.id === admissionId",
	"ref.id === admissionProposalId",
);
export const D22_INITIAL_ADMISSION_BLOCK =
	CURRENT_GRAPH_LIVE_BUGGY_ADMISSION_BLOCK + D22_FIXED_ADMISSION_REF_SUFFIX;
export const D22_WRONG_ADMISSION_BLOCK =
	CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK + D22_WRONG_ADMISSION_REF_SUFFIX;
export const D22_FIXED_ADMISSION_BLOCK =
	CURRENT_GRAPH_LIVE_FIXED_ADMISSION_BLOCK + D22_FIXED_ADMISSION_REF_SUFFIX;
if (
	D22_WRONG_ADMISSION_REF_SUFFIX === D22_FIXED_ADMISSION_REF_SUFFIX ||
	D22_WRONG_ADMISSION_BLOCK === D22_FIXED_ADMISSION_BLOCK ||
	!D22_WRONG_ADMISSION_BLOCK.includes("assertBoundedAuthorityId(admissionProposalId")
)
	throw new TypeError("D22 wrong semantic fixture drifted");

export interface D22D21BaselineAdmissionV1 {
	readonly revision: "graphrefly-ts.d22.d21-baseline-admission.v1";
}

export interface D22QualificationBundleV1 {
	readonly schemaVersion: typeof D22_BUNDLE_SCHEMA;
	readonly basis: "consumed-d21-artifact" | "injected-test";
	readonly recoveryEvidence: D9ProviderRejectionEvidenceV1;
	readonly rejectionEvidence: D9ProviderRejectionEvidenceV1;
	readonly qualification: Readonly<{
		schemaVersion: typeof D22_QUALIFICATION_SCHEMA;
		decisionRef: typeof D22_DECISION_REF;
		authorityRevision: typeof D22_AUTHORITY_REVISION;
		implementationManifestDigest: typeof D22_IMPLEMENTATION_MANIFEST_DIGEST;
		d21Baseline: typeof D22_D21_BASELINE;
		d20FailureBaselineDigest: string;
		taskProfileDigest: string;
		routeDigest: string;
		exposureMatrixDigest: string;
		positiveDifferentialGateDefinitionDigest: string;
		recoveryEvidenceDigest: string;
		rejectionEvidenceDigest: string;
		exactSixArmsCompleted: true;
		semanticRecoveryCount: 6;
		semanticCorrectionContextCount: 6;
		providerResultRejectionCount: 1;
		providerResultRejectionContinuedNextArm: true;
		conservativeReservationAccountingPassed: true;
		retryIdentityPassed: true;
		providerAttempts: number;
		retryWaits: 1;
		providerNetworkCalls: 0;
		workspaceResidueCount: 0;
		maxActiveEffects: 1;
		liveGateEvaluated: false;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		qualified: true;
		qualificationDigest: string;
	}>;
	readonly generation: Readonly<{
		schemaVersion: typeof D22_GENERATION_SCHEMA;
		generationRef: typeof D22_GENERATION_REF;
		qualificationDigest: string;
		recoveryEvidenceDigest: string;
		rejectionEvidenceDigest: string;
		implementationManifestDigest: typeof D22_IMPLEMENTATION_MANIFEST_DIGEST;
		liveGateEvaluated: false;
		causalAttribution: "undetermined";
		efficacyClaim: "none";
		generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

interface BaselineState {
	readonly basis: D22QualificationBundleV1["basis"];
}

interface D22Executor {
	readonly execute: (
		effect: CurrentGraphProviderAdmittedEffectV1,
	) => Promise<CurrentGraphProviderEffectResultInputV1>;
	readonly dispose: () => Promise<void>;
}

const D22_PUBLIC_SEMANTIC_TEST_NAME = "admits only a fresh D419 managed remote run" as const;
const D22_PROCESS_OUTPUT_BOUND = 2 * 1_048_576;

async function runD22PublicSemanticScenario(input: {
	readonly repositoryRoot: string;
	readonly materializationRoot: string;
	readonly effect: CurrentGraphProviderAdmittedEffectV1;
}): Promise<CurrentGraphProviderEffectResultInputV1> {
	const request = input.effect.request;
	if (request.effectKind !== "public-semantic-validation")
		throw new TypeError("D22 public semantic request kind drifted");
	if (request.workspaceStateDigest === null)
		throw new TypeError("D22 public semantic workspace is missing");
	const started = performance.now();
	const cwd = join(input.materializationRoot, `${request.arm}-${request.runSequence}`);
	const outcome = await new Promise<Readonly<{ code: number; stdout: Uint8Array }>>(
		(resolvePromise, rejectPromise) => {
			const child = spawn(
				join(input.repositoryRoot, "node_modules/.bin/vitest"),
				[
					"run",
					"packages/ts/src/__tests__/managed-cloud-postgresql.test.ts",
					"-t",
					D22_PUBLIC_SEMANTIC_TEST_NAME,
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
				else resolvePromise(Object.freeze({ code, stdout: Buffer.concat(chunks) }));
			};
			const collect = (chunk: Buffer) => {
				bytes += chunk.byteLength;
				if (bytes > D22_PROCESS_OUTPUT_BOUND) {
					child.kill("SIGKILL");
					finish(new TypeError("D22 public semantic output exceeded its bound"));
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
				finish(new TypeError("D22 public semantic validation timed out"));
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
			scenario: D22_PUBLIC_SEMANTIC_TEST_NAME,
			outputDigest: empiricalSha256(outcome.stdout),
			passed,
		}),
		actualCostMicrousd: 0 as const,
		actualElapsedMs: Math.min(
			request.reservation.maxElapsedMs,
			Math.max(1, Math.ceil(performance.now() - started)),
		),
	});
}

const baselines = new WeakMap<object, BaselineState>();
const constructed = new WeakSet<object>();

function baselineCapability(basis: BaselineState["basis"]): D22D21BaselineAdmissionV1 {
	const capability = Object.freeze({
		revision: "graphrefly-ts.d22.d21-baseline-admission.v1" as const,
	});
	baselines.set(capability, Object.freeze({ basis }));
	return capability;
}

export function admitD22D21Baseline(bytesValue: Uint8Array): D22D21BaselineAdmissionV1 {
	if (!(bytesValue instanceof Uint8Array))
		throw new TypeError("D22 D21 baseline bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D22_D21_BASELINE.bundleArtifactDigest)
		throw new TypeError("D22 D21 baseline artifact drifted");
	const bundle = validateD21QualificationBundle(strictJsonCodec.decode(bytes));
	if (
		bundle.basis !== "consumed-d20-artifact" ||
		bundle.bundleDigest !== D22_D21_BASELINE.bundleDigest ||
		bundle.qualification.qualificationDigest !== D22_D21_BASELINE.qualificationDigest ||
		bundle.generation.generationDigest !== D22_D21_BASELINE.generationDigest ||
		bundle.qualification.implementationManifestDigest !==
			D22_D21_BASELINE.implementationManifestDigest
	)
		throw new TypeError("D22 D21 baseline coordinates drifted");
	return baselineCapability("consumed-d21-artifact");
}

export function createD22InjectedBaselineForTest(): D22D21BaselineAdmissionV1 {
	return baselineCapability("injected-test");
}

function consumeBaseline(value: unknown): BaselineState {
	if (value === null || typeof value !== "object") throw new TypeError("D22 baseline is invalid");
	const state = baselines.get(value);
	if (state === undefined) throw new TypeError("D22 baseline is forged or replayed");
	baselines.delete(value);
	return state;
}

function providerResponse(calls: readonly unknown[]) {
	return new Response(
		JSON.stringify({
			choices: [{ message: { role: "assistant", content: null, tool_calls: calls } }],
			usage: {
				prompt_tokens: 100,
				completion_tokens: 20,
				prompt_tokens_details: { cached_tokens: 0 },
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

function functionCall(id: string, name: string, args: unknown) {
	return Object.freeze({
		id,
		type: "function",
		function: { name, arguments: JSON.stringify(args) },
	});
}

function createD22InjectedFetch(mode: "recovery" | "rejection") {
	let providerCalls = 0;
	let retryInjected = false;
	let pendingRetryBodyDigest: string | null = null;
	let rejectionInjected = false;
	const fetchImpl: typeof fetch = async (_url, init) => {
		providerCalls += 1;
		const bodyBytes = Buffer.from(init?.body as Uint8Array);
		const bodyDigest = empiricalSha256(bodyBytes);
		const body = JSON.parse(bodyBytes.toString("utf8")) as {
			readonly messages: readonly { readonly role?: string; readonly content?: string }[];
		};
		if (mode === "recovery" && !retryInjected) {
			retryInjected = true;
			pendingRetryBodyDigest = bodyDigest;
			return new Response(JSON.stringify({ error: { message: "bounded" } }), {
				status: 429,
				headers: { "content-type": "application/json", "retry-after": "0" },
			});
		}
		if (pendingRetryBodyDigest !== null) {
			if (pendingRetryBodyDigest !== bodyDigest)
				throw new TypeError("D22 injected retry body drifted");
			pendingRetryBodyDigest = null;
		}
		if (mode === "rejection" && !rejectionInjected) {
			rejectionInjected = true;
			return providerResponse([]);
		}
		const hasToolResult = body.messages.some((message) => message.role === "tool");
		const isCorrection = body.messages.some(
			(message) =>
				message.role === "system" && message.content?.includes("correction=semantic-correction"),
		);
		if (!hasToolResult)
			return providerResponse(
				CURRENT_GRAPH_LIVE_READABLE_FILES.map((path, index) =>
					functionCall(`read-${providerCalls}-${index}`, "read_file", { path }),
				),
			);
		const oldText = isCorrection ? D22_WRONG_ADMISSION_BLOCK : D22_INITIAL_ADMISSION_BLOCK;
		const newText = isCorrection ? D22_FIXED_ADMISSION_BLOCK : D22_WRONG_ADMISSION_BLOCK;
		return providerResponse([
			functionCall(`replace-${providerCalls}`, "replace_exact", {
				path: CURRENT_GRAPH_LIVE_WRITABLE_FILE,
				oldText,
				newText,
			}),
			functionCall(`diff-${providerCalls}`, "workspace_diff", {}),
			functionCall(`focused-${providerCalls}`, "focused_validation", {}),
		]);
	};
	return Object.freeze({ fetchImpl, providerCalls: () => providerCalls });
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
	].some((message) => error.message === message);
}

async function executeForGraph(
	executor: D22Executor,
	effect: CurrentGraphProviderAdmittedEffectV1,
) {
	try {
		return await executor.execute(effect);
	} catch (error) {
		if (effect.request.effectKind !== "provider-request" || !isProviderResultBoundaryError(error))
			throw error;
		// Deliberately invalid and material-free: D9 classifies and conservatively reconciles it.
		return Object.freeze({});
	}
}

export async function runD22GraphComposition(input: {
	readonly executor: D22Executor;
}): Promise<D9ProviderRejectionEvidenceV1> {
	const captured = record(input, "D22 Graph composition input");
	exactKeys(captured, ["executor"], "D22 Graph composition input");
	const executorRecord = record(captured.executor, "D22 executor");
	exactKeys(executorRecord, ["dispose", "execute"], "D22 executor");
	const executor = executorRecord as unknown as D22Executor;
	if (typeof executor.execute !== "function" || typeof executor.dispose !== "function")
		throw new TypeError("D22 executor ports are invalid");
	const authority = createD9ProviderRejectionAuthority({
		limits: D21_LIMITS,
		routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
		taskProfile: D21_TASK_PROFILE,
	});
	try {
		for (let guard = 0; guard < D21_LIMITS.maxEffectFacts; guard += 1) {
			const effect = takeD9ProviderEffect(authority);
			if (effect === null)
				return validateD9ProviderRejectionEvidence(snapshotD9ProviderRejectionEvidence(authority));
			if (
				effect.request.effectKind === "provider-request" &&
				effect.runtime.route?.routeDigest !== CURRENT_GRAPH_LIVE_ROUTE.routeDigest
			)
				throw new TypeError(
					`D22 Graph route drifted: ${effect.runtime.route?.routeDigest ?? "missing"}`,
				);
			const result = await executeForGraph(executor, effect);
			admitD9ProviderEffectResult(authority, effect.request.requestDigest, result);
		}
		throw new TypeError("D22 Graph composition exceeded its effect bound");
	} finally {
		await executor.dispose();
	}
}

function semanticCorrectionContexts(evidence: D9ProviderRejectionEvidenceV1) {
	return evidence.providerEvidence.workflowEvidence.facts
		.filter((fact) => fact.request.effectKind === "provider-request")
		.map((fact) => fact.request.correctionDirective)
		.filter(
			(context): context is NonNullable<typeof context> => context?.stage === "semantic-correction",
		);
}

function assertRecoveryEvidence(evidence: D9ProviderRejectionEvidenceV1): void {
	const workflow = evidence.providerEvidence.workflowEvidence;
	const contexts = semanticCorrectionContexts(evidence);
	if (
		evidence.rejectionCount !== 0 ||
		workflow.runStatus !== "complete" ||
		workflow.runs.length !== 6 ||
		workflow.runs.some(
			(run) =>
				run.status !== "completed" ||
				!run.semanticRecoveryUsed ||
				!run.publicSemanticValidationPassed ||
				!run.hiddenVerifierPassed ||
				run.cleanupStatus !== "completed",
		) ||
		contexts.length !== 6
	)
		throw new TypeError(
			`D22 real semantic recovery lifecycle drifted: ${JSON.stringify({
				rejectionCount: evidence.rejectionCount,
				runStatus: workflow.runStatus,
				contextCount: contexts.length,
				budget: workflow.budget,
				findings: workflow.findings.map((finding) => finding.code),
				runs: workflow.runs.map((run) => ({
					status: run.status,
					phase: run.phase,
					semanticRecoveryUsed: run.semanticRecoveryUsed,
					publicSemanticValidationAttempted: run.publicSemanticValidationAttempted,
					publicSemanticValidationPassed: run.publicSemanticValidationPassed,
					hiddenVerifierPassed: run.hiddenVerifierPassed,
					cleanupStatus: run.cleanupStatus,
				})),
			})}`,
		);
	for (const context of contexts)
		if (context.requiredFirstToolRef !== "replace-exact" || context.criterionFailures.length === 0)
			throw new TypeError("D22 real semantic correction context drifted");
	for (const run of workflow.runs) {
		const facts = workflow.facts.filter(
			(fact) => fact.request.arm === run.arm && fact.request.runSequence === run.runSequence,
		);
		const semanticStatuses = facts
			.filter((fact) => fact.factKind === "public-semantic-result")
			.map((fact) => fact.result.status);
		const hiddenStatuses = facts
			.filter((fact) => fact.factKind === "hidden-verifier-result")
			.map((fact) => fact.result.status);
		const replaceResults = facts.filter(
			(fact) =>
				fact.factKind === "tool-result" &&
				fact.result.toolRef === "replace-exact" &&
				fact.result.status === "succeeded",
		);
		const runContexts = facts
			.filter((fact) => fact.request.effectKind === "provider-request")
			.map((fact) => fact.request.correctionDirective)
			.filter((context) => context?.stage === "semantic-correction");
		if (
			semanticStatuses.length !== 2 ||
			semanticStatuses[0] !== "failed" ||
			semanticStatuses[1] !== "passed" ||
			hiddenStatuses.length !== 1 ||
			hiddenStatuses[0] !== "passed" ||
			replaceResults.length !== 2 ||
			runContexts.length !== 1
		)
			throw new TypeError("D22 per-run semantic recovery trace drifted");
	}
}

function assertRejectionEvidence(evidence: D9ProviderRejectionEvidenceV1): void {
	const workflow = evidence.providerEvidence.workflowEvidence;
	const rejection = evidence.rejectionFacts[0];
	if (
		evidence.rejectionCount !== 1 ||
		rejection?.causeCode !== "provider-result-schema-invalid" ||
		rejection.reconciliation.actualCostMicrousd !== rejection.request.reservation.maxCostMicrousd ||
		rejection.reconciliation.actualElapsedMs !== rejection.request.reservation.maxElapsedMs ||
		workflow.runs.length !== 6 ||
		workflow.runs[0]?.status !== "incomplete" ||
		workflow.runs[0]?.cleanupStatus !== "completed" ||
		workflow.runs
			.slice(1)
			.some(
				(run) =>
					run.status !== "completed" ||
					!run.semanticRecoveryUsed ||
					!run.publicSemanticValidationPassed ||
					!run.hiddenVerifierPassed ||
					run.cleanupStatus !== "completed",
			)
	)
		throw new TypeError("D22 real provider rejection lifecycle drifted");
}

async function assertNoResidue(path: string): Promise<void> {
	await lstat(path).then(
		() => {
			throw new TypeError("D22 real composition left workspace residue");
		},
		(error: unknown) => {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		},
	);
}

async function runInjectedEvidence(
	repositoryRoot: string,
	temporaryRoot: string,
	mode: "recovery" | "rejection",
) {
	const transport = createD22InjectedFetch(mode);
	const materializationRoot = join(temporaryRoot, `workspaces-${mode}`);
	const baseExecutor = createCurrentGraphOpenRouterExecutor({
		repositoryRoot,
		materializationRoot,
		credential: Object.freeze({
			bearerToken: "sk-or-v1-test-d22-no-network-key",
			credentialBindingRef: "openrouter.local-eval-2" as const,
			credentialBindingRevision: "2026-08-14.v1" as const,
		}),
		fetchImpl: transport.fetchImpl,
		sleep: async () => undefined,
	});
	const executor: D22Executor = Object.freeze({
		execute: async (effect: CurrentGraphProviderAdmittedEffectV1) =>
			effect.request.effectKind === "public-semantic-validation"
				? runD22PublicSemanticScenario({ repositoryRoot, materializationRoot, effect })
				: baseExecutor.execute(effect),
		dispose: () => baseExecutor.dispose(),
	});
	const evidence = await runD22GraphComposition({ executor });
	await assertNoResidue(materializationRoot);
	return Object.freeze({ evidence, providerCalls: transport.providerCalls() });
}

export async function runD22InjectedNoNetworkQualification(input: {
	readonly baseline: D22D21BaselineAdmissionV1;
	readonly implementationManifestDigest: string;
	readonly repositoryRoot: string;
}): Promise<D22QualificationBundleV1> {
	const captured = record(input, "D22 qualification input");
	exactKeys(
		captured,
		["baseline", "implementationManifestDigest", "repositoryRoot"],
		"D22 qualification input",
	);
	if (captured.implementationManifestDigest !== D22_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D22 implementation manifest digest drifted");
	if (typeof captured.repositoryRoot !== "string" || captured.repositoryRoot.length === 0)
		throw new TypeError("D22 repository root is invalid");
	const baseline = consumeBaseline(captured.baseline);
	const repositoryRoot = await realpath(resolve(captured.repositoryRoot));
	const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d22-")));
	await chmod(temporaryRoot, 0o700);
	try {
		const recovery = await runInjectedEvidence(repositoryRoot, temporaryRoot, "recovery");
		const rejection = await runInjectedEvidence(repositoryRoot, temporaryRoot, "rejection");
		assertRecoveryEvidence(recovery.evidence);
		assertRejectionEvidence(rejection.evidence);
		const retryWaits = recovery.evidence.providerEvidence.budget.retryWaits;
		if (retryWaits !== 1) throw new TypeError("D22 retry identity qualification drifted");
		const qualificationMaterial = strictSnapshot({
			schemaVersion: D22_QUALIFICATION_SCHEMA,
			decisionRef: D22_DECISION_REF,
			authorityRevision: D22_AUTHORITY_REVISION,
			implementationManifestDigest: D22_IMPLEMENTATION_MANIFEST_DIGEST,
			d21Baseline: D22_D21_BASELINE,
			d20FailureBaselineDigest: empiricalStrictJsonDigest(D21_D20_FAILURE_BASELINE),
			taskProfileDigest: D21_TASK_PROFILE.taskProfileDigest,
			routeDigest: CURRENT_GRAPH_LIVE_ROUTE.routeDigest,
			exposureMatrixDigest: empiricalStrictJsonDigest(D21_EXPOSURE_MATRIX),
			positiveDifferentialGateDefinitionDigest: D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST,
			recoveryEvidenceDigest: recovery.evidence.evidenceDigest,
			rejectionEvidenceDigest: rejection.evidence.evidenceDigest,
			exactSixArmsCompleted: true as const,
			semanticRecoveryCount: 6 as const,
			semanticCorrectionContextCount: 6 as const,
			providerResultRejectionCount: 1 as const,
			providerResultRejectionContinuedNextArm: true as const,
			conservativeReservationAccountingPassed: true as const,
			retryIdentityPassed: true as const,
			providerAttempts: recovery.evidence.providerEvidence.budget.providerAttempts,
			retryWaits: 1 as const,
			providerNetworkCalls: 0 as const,
			workspaceResidueCount: 0 as const,
			maxActiveEffects: 1 as const,
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
			schemaVersion: D22_GENERATION_SCHEMA,
			generationRef: D22_GENERATION_REF,
			qualificationDigest: qualification.qualificationDigest,
			recoveryEvidenceDigest: recovery.evidence.evidenceDigest,
			rejectionEvidenceDigest: rejection.evidence.evidenceDigest,
			implementationManifestDigest: D22_IMPLEMENTATION_MANIFEST_DIGEST,
			liveGateEvaluated: false as const,
			causalAttribution: "undetermined" as const,
			efficacyClaim: "none" as const,
		});
		const generation = Object.freeze({
			...generationMaterial,
			generationDigest: empiricalStrictJsonDigest(generationMaterial),
		});
		const material = strictSnapshot({
			schemaVersion: D22_BUNDLE_SCHEMA,
			basis: baseline.basis,
			recoveryEvidence: recovery.evidence,
			rejectionEvidence: rejection.evidence,
			qualification,
			generation,
		});
		const bundle = Object.freeze({
			...material,
			bundleDigest: empiricalStrictJsonDigest(material),
		}) as D22QualificationBundleV1;
		if (strictJsonCodec.encode(bundle).byteLength > D22_MAX_BUNDLE_BYTES)
			throw new TypeError("D22 qualification bundle exceeded its byte bound");
		constructed.add(bundle);
		return bundle;
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

export function validateD22QualificationBundle(value: unknown): D22QualificationBundleV1 {
	const candidate = record(
		snapshotD9BoundedCanonicalEvidence(value),
		"D22 qualification bundle",
	) as unknown as D22QualificationBundleV1;
	exactKeys(
		candidate as unknown as Record<string, unknown>,
		[
			"basis",
			"bundleDigest",
			"generation",
			"qualification",
			"recoveryEvidence",
			"rejectionEvidence",
			"schemaVersion",
		],
		"D22 qualification bundle",
	);
	if (
		candidate.schemaVersion !== D22_BUNDLE_SCHEMA ||
		(candidate.basis !== "consumed-d21-artifact" && candidate.basis !== "injected-test")
	)
		throw new TypeError("D22 qualification bundle coordinates drifted");
	const recoveryEvidence = validateD9ProviderRejectionEvidence(candidate.recoveryEvidence);
	const rejectionEvidence = validateD9ProviderRejectionEvidence(candidate.rejectionEvidence);
	assertRecoveryEvidence(recoveryEvidence);
	assertRejectionEvidence(rejectionEvidence);
	const q = record(
		candidate.qualification,
		"D22 qualification",
	) as unknown as D22QualificationBundleV1["qualification"];
	exactKeys(
		q as unknown as Record<string, unknown>,
		[
			"authorityRevision",
			"causalAttribution",
			"conservativeReservationAccountingPassed",
			"d20FailureBaselineDigest",
			"d21Baseline",
			"decisionRef",
			"efficacyClaim",
			"exactSixArmsCompleted",
			"exposureMatrixDigest",
			"implementationManifestDigest",
			"liveGateEvaluated",
			"maxActiveEffects",
			"positiveDifferentialGateDefinitionDigest",
			"providerAttempts",
			"providerNetworkCalls",
			"providerResultRejectionContinuedNextArm",
			"providerResultRejectionCount",
			"qualificationDigest",
			"qualified",
			"recoveryEvidenceDigest",
			"rejectionEvidenceDigest",
			"retryIdentityPassed",
			"retryWaits",
			"routeDigest",
			"schemaVersion",
			"semanticCorrectionContextCount",
			"semanticRecoveryCount",
			"taskProfileDigest",
			"workspaceResidueCount",
		],
		"D22 qualification",
	);
	if (
		q.schemaVersion !== D22_QUALIFICATION_SCHEMA ||
		q.decisionRef !== D22_DECISION_REF ||
		q.authorityRevision !== D22_AUTHORITY_REVISION ||
		q.implementationManifestDigest !== D22_IMPLEMENTATION_MANIFEST_DIGEST ||
		empiricalStrictJsonDigest(q.d21Baseline) !== empiricalStrictJsonDigest(D22_D21_BASELINE) ||
		q.d20FailureBaselineDigest !== empiricalStrictJsonDigest(D21_D20_FAILURE_BASELINE) ||
		q.taskProfileDigest !== D21_TASK_PROFILE.taskProfileDigest ||
		q.routeDigest !== CURRENT_GRAPH_LIVE_ROUTE.routeDigest ||
		q.exposureMatrixDigest !== empiricalStrictJsonDigest(D21_EXPOSURE_MATRIX) ||
		q.positiveDifferentialGateDefinitionDigest !==
			D21_POSITIVE_DIFFERENTIAL_GATE_DEFINITION_DIGEST ||
		q.recoveryEvidenceDigest !== recoveryEvidence.evidenceDigest ||
		q.rejectionEvidenceDigest !== rejectionEvidence.evidenceDigest ||
		q.exactSixArmsCompleted !== true ||
		q.semanticRecoveryCount !== 6 ||
		q.semanticCorrectionContextCount !== 6 ||
		q.providerResultRejectionCount !== 1 ||
		q.providerResultRejectionContinuedNextArm !== true ||
		q.conservativeReservationAccountingPassed !== true ||
		q.retryIdentityPassed !== true ||
		q.providerAttempts !== recoveryEvidence.providerEvidence.budget.providerAttempts ||
		q.retryWaits !== 1 ||
		q.providerNetworkCalls !== 0 ||
		q.workspaceResidueCount !== 0 ||
		q.maxActiveEffects !== 1 ||
		q.liveGateEvaluated !== false ||
		q.causalAttribution !== "undetermined" ||
		q.efficacyClaim !== "none" ||
		q.qualified !== true
	)
		throw new TypeError("D22 qualification claims drifted");
	const { qualificationDigest: _qualificationDigest, ...qualificationFields } = q;
	if (q.qualificationDigest !== empiricalStrictJsonDigest(strictSnapshot(qualificationFields)))
		throw new TypeError("D22 qualification digest drifted");
	const g = record(
		candidate.generation,
		"D22 generation",
	) as unknown as D22QualificationBundleV1["generation"];
	exactKeys(
		g as unknown as Record<string, unknown>,
		[
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"implementationManifestDigest",
			"liveGateEvaluated",
			"qualificationDigest",
			"recoveryEvidenceDigest",
			"rejectionEvidenceDigest",
			"schemaVersion",
		],
		"D22 generation",
	);
	if (
		g.schemaVersion !== D22_GENERATION_SCHEMA ||
		g.generationRef !== D22_GENERATION_REF ||
		g.qualificationDigest !== q.qualificationDigest ||
		g.recoveryEvidenceDigest !== recoveryEvidence.evidenceDigest ||
		g.rejectionEvidenceDigest !== rejectionEvidence.evidenceDigest ||
		g.implementationManifestDigest !== D22_IMPLEMENTATION_MANIFEST_DIGEST ||
		g.liveGateEvaluated !== false ||
		g.causalAttribution !== "undetermined" ||
		g.efficacyClaim !== "none"
	)
		throw new TypeError("D22 generation claims drifted");
	const { generationDigest: _generationDigest, ...generationFields } = g;
	if (g.generationDigest !== empiricalStrictJsonDigest(strictSnapshot(generationFields)))
		throw new TypeError("D22 generation digest drifted");
	const material = strictSnapshot({
		schemaVersion: D22_BUNDLE_SCHEMA,
		basis: candidate.basis,
		recoveryEvidence,
		rejectionEvidence,
		qualification: q,
		generation: g,
	});
	if (candidate.bundleDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D22 bundle digest drifted");
	return Object.freeze({
		...material,
		bundleDigest: candidate.bundleDigest,
	}) as D22QualificationBundleV1;
}

export async function persistD22QualificationBundle(input: {
	readonly privateRoot: string;
	readonly bundle: D22QualificationBundleV1;
}) {
	const captured = record(input, "D22 persistence input");
	exactKeys(captured, ["bundle", "privateRoot"], "D22 persistence input");
	if (typeof captured.privateRoot !== "string" || captured.privateRoot.length === 0)
		throw new TypeError("D22 private root is invalid");
	if (captured.bundle === null || typeof captured.bundle !== "object")
		throw new TypeError("D22 persistence bundle is invalid");
	if (!constructed.has(captured.bundle)) throw new TypeError("D22 bundle is not constructed");
	constructed.delete(captured.bundle);
	const bundle = validateD22QualificationBundle(captured.bundle);
	if (bundle.basis !== "consumed-d21-artifact")
		throw new TypeError("D22 production persistence requires consumed D21 evidence");
	const bundleBytes = strictJsonCodec.encode(bundle as unknown as StrictJsonValue);
	const qualificationBytes = strictJsonCodec.encode(
		bundle.qualification as unknown as StrictJsonValue,
	);
	const generationBytes = strictJsonCodec.encode(bundle.generation as unknown as StrictJsonValue);
	const commitBytes = strictJsonCodec.encode(
		strictSnapshot({
			generationRef: D22_GENERATION_REF,
			bundleDigest: bundle.bundleDigest,
			qualificationDigest: bundle.qualification.qualificationDigest,
			generationDigest: bundle.generation.generationDigest,
		}) as StrictJsonValue,
	);
	return persistCurrentGraphPrivateGeneration({
		privateRoot: captured.privateRoot,
		generationRef: D22_GENERATION_REF,
		artifacts: Object.freeze({
			"bundle.v1.json": bundleBytes,
			"qualification.v1.json": qualificationBytes,
			"generation.v1.json": generationBytes,
		}),
		commitBytes,
	});
}

export async function persistD22InjectedQualificationForTest(input: {
	readonly privateRoot: string;
	readonly bundle: D22QualificationBundleV1;
}) {
	const captured = record(input, "D22 test persistence input");
	exactKeys(captured, ["bundle", "privateRoot"], "D22 test persistence input");
	if (typeof captured.privateRoot !== "string" || captured.privateRoot.length === 0)
		throw new TypeError("D22 test private root is invalid");
	if (captured.bundle === null || typeof captured.bundle !== "object")
		throw new TypeError("D22 test bundle is invalid");
	if (!constructed.has(captured.bundle)) throw new TypeError("D22 test bundle is not constructed");
	constructed.delete(captured.bundle);
	const bundle = validateD22QualificationBundle(captured.bundle);
	if (bundle.basis !== "injected-test")
		throw new TypeError("D22 test persistence requires injected evidence");
	return persistCurrentGraphPrivateGeneration({
		privateRoot: captured.privateRoot,
		generationRef: D22_INJECTED_TEST_GENERATION_REF,
		artifacts: Object.freeze({
			"bundle.v1.json": strictJsonCodec.encode(bundle as unknown as StrictJsonValue),
		}),
		commitBytes: strictJsonCodec.encode(
			strictSnapshot({
				generationRef: D22_INJECTED_TEST_GENERATION_REF,
				bundleDigest: bundle.bundleDigest,
				basis: bundle.basis,
			}) as StrictJsonValue,
		),
	});
}
