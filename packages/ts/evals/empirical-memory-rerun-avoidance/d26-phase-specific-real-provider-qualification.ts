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
import {
	CURRENT_GRAPH_LIVE_READABLE_FILES,
	CURRENT_GRAPH_LIVE_ROUTE,
	CURRENT_GRAPH_LIVE_WRITABLE_FILE,
} from "./d8-current-live-coordinates.js";
import {
	D21_EXPOSURE_MATRIX,
	D21_LIMITS,
	D21_TASK_PROFILE,
} from "./d21-current-efficacy-recovery-authority.js";
import {
	D22_FIXED_ADMISSION_BLOCK,
	D22_INITIAL_ADMISSION_BLOCK,
	D22_WRONG_ADMISSION_BLOCK,
} from "./d22-current-efficacy-real-provider-qualification.js";
import {
	admitD25EffectResult,
	createD25PhaseAuthority,
	type D25PhaseEvidenceV1,
	snapshotD25PhaseEvidence,
	validateD25PhaseEvidence,
} from "./d25-phase-specific-tool-admission.js";
import { D25_IMPLEMENTATION_MANIFEST_DIGEST } from "./d25-phase-specific-tool-implementation-manifest.js";
import { validateD25QualificationBundle } from "./d25-phase-specific-tool-qualification.js";
import {
	createD26PhaseSpecificRealProviderExecutor,
	type D26PhaseSpecificExecutorV1,
} from "./d26-phase-specific-real-provider-composition.js";
import { D26_IMPLEMENTATION_MANIFEST_DIGEST } from "./d26-phase-specific-real-provider-implementation-manifest.js";

export const D26_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d26.phase-specific-real-provider-qualification.v1" as const;
export const D26_BUNDLE_SCHEMA =
	"graphrefly-ts.d26.phase-specific-real-provider-qualification-bundle.v1" as const;
export const D26_GENERATION_SCHEMA =
	"graphrefly-ts.d26.phase-specific-real-provider-generation.v1" as const;
export const D26_GENERATION_REF =
	"current-graph-native-phase-specific-real-provider-no-network-2026-08-17-d26-v2" as const;
export const D26_INJECTED_GENERATION_REF =
	"current-graph-native-phase-specific-real-provider-injected-test-d26-v1" as const;
export const D26_D25_ARTIFACT_DIGEST =
	"sha256:312fb8db2309060246f10326c46fc46f18d379f59b81075b16357b497d718d99" as const;
export const D26_D25_BUNDLE_DIGEST =
	"sha256:ac427aea5b0db1f811251bb0fc9473dd0c4915c13ee8ecebef8c689428796c5f" as const;
export const D26_D25_QUALIFICATION_DIGEST =
	"sha256:70fda5d382e902b15d632c8060f1c431aff4348525d503816493b5d7937c1bab" as const;
export const D26_D25_GENERATION_DIGEST =
	"sha256:a06c19ce72f55c7170d182397c3f513582304dcb6dcf262fd0f316e5654dc742" as const;

type Basis = "consumed-d25-artifact" | "injected-test";

export interface D26D25BaselineAdmissionV1 {
	readonly revision: "graphrefly-ts.d26.d25-baseline-admission.v1";
}

export interface D26QualificationBundleV1 {
	readonly schemaVersion: typeof D26_BUNDLE_SCHEMA;
	readonly basis: Basis;
	readonly mainEvidence: D25PhaseEvidenceV1;
	readonly nearMissEvidence: D25PhaseEvidenceV1;
	readonly qualification: Readonly<{
		readonly schemaVersion: typeof D26_QUALIFICATION_SCHEMA;
		readonly decisionRef: "graphrefly-ts:D26";
		readonly d25ArtifactDigest: typeof D26_D25_ARTIFACT_DIGEST;
		readonly d25BundleDigest: typeof D26_D25_BUNDLE_DIGEST;
		readonly d25QualificationDigest: typeof D26_D25_QUALIFICATION_DIGEST;
		readonly d25GenerationDigest: typeof D26_D25_GENERATION_DIGEST;
		readonly d25ImplementationManifestDigest: typeof D25_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly implementationManifestDigest: typeof D26_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly mainEvidenceDigest: string;
		readonly nearMissEvidenceDigest: string;
		readonly exactSixArmsCompleted: true;
		readonly realWorkspaceLifecyclePassed: true;
		readonly exactNamedFinalWirePassed: true;
		readonly singleProviderMutationPassed: true;
		readonly graphDeterministicSuccessorsPassed: true;
		readonly semanticCorrectionCount: 6;
		readonly nearMissIsolationPassed: true;
		readonly retryIdentityPassed: true;
		readonly retryDelayCoverageMs: readonly [1_000, 7_000, 60_000];
		readonly providerTransportCalls: number;
		readonly providerNetworkCalls: 0;
		readonly maxActiveEffects: 1;
		readonly workspaceResidueCount: 0;
		readonly liveGateEvaluated: false;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly qualified: true;
		readonly qualificationDigest: string;
	}>;
	readonly generation: Readonly<{
		readonly schemaVersion: typeof D26_GENERATION_SCHEMA;
		readonly generationRef: typeof D26_GENERATION_REF;
		readonly qualificationDigest: string;
		readonly mainEvidenceDigest: string;
		readonly nearMissEvidenceDigest: string;
		readonly implementationManifestDigest: typeof D26_IMPLEMENTATION_MANIFEST_DIGEST;
		readonly liveGateEvaluated: false;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly generationDigest: string;
	}>;
	readonly bundleDigest: string;
}

interface BaselineState {
	readonly basis: Basis;
}

interface TransportState {
	readonly mode: "main" | "near-miss";
	readonly retried: Set<string>;
	readonly pendingRetryBody: Map<string, string>;
	providerCalls: number;
	active: number;
	maxActive: number;
	namedWireCount: number;
	mutationWireCount: number;
}

const baselineStates = new WeakMap<object, BaselineState>();
const constructed = new WeakSet<object>();

function baseline(basis: Basis): D26D25BaselineAdmissionV1 {
	const value = Object.freeze({ revision: "graphrefly-ts.d26.d25-baseline-admission.v1" as const });
	baselineStates.set(value, { basis });
	return value;
}

export function admitD26D25Baseline(bytesValue: Uint8Array): D26D25BaselineAdmissionV1 {
	const bytes = new Uint8Array(bytesValue);
	if (empiricalSha256(bytes) !== D26_D25_ARTIFACT_DIGEST)
		throw new TypeError("D26 D25 artifact digest drifted");
	const decoded = strictJsonCodec.decode(bytes) as unknown;
	const validated = validateD25QualificationBundle(decoded);
	const bundle = record(validated, "D26 D25 bundle");
	if (
		validated.basis !== "consumed-d24-artifact" ||
		bundle.bundleDigest !== D26_D25_BUNDLE_DIGEST ||
		record(bundle.qualification, "D26 D25 qualification").qualificationDigest !==
			D26_D25_QUALIFICATION_DIGEST ||
		record(bundle.generation, "D26 D25 generation").generationDigest !== D26_D25_GENERATION_DIGEST
	)
		throw new TypeError("D26 D25 canonical coordinates drifted");
	return baseline("consumed-d25-artifact");
}

export function createD26InjectedBaselineForTest(): D26D25BaselineAdmissionV1 {
	return baseline("injected-test");
}

function consumeBaseline(value: unknown): BaselineState {
	const state = baselineStates.get(value as object);
	baselineStates.delete(value as object);
	if (state === undefined) throw new TypeError("D26 D25 baseline is forged or replayed");
	return state;
}

function call(id: string, name: string, args: unknown) {
	return Object.freeze({
		id,
		type: "function" as const,
		function: Object.freeze({ name, arguments: JSON.stringify(args) }),
	});
}

function providerResponse(calls: readonly unknown[]) {
	return new Response(
		JSON.stringify({
			choices: [{ message: { role: "assistant", content: null, tool_calls: calls } }],
			usage: {
				prompt_tokens: 120,
				completion_tokens: 80,
				prompt_tokens_details: { cached_tokens: 20 },
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

function requestCoordinates(body: Record<string, unknown>) {
	if (!Array.isArray(body.messages)) throw new TypeError("D26 injected messages are invalid");
	const messages = body.messages as Array<Record<string, unknown>>;
	const arm = Object.keys(D21_EXPOSURE_MATRIX).find((candidate) =>
		messages.some(
			(message) =>
				typeof message.content === "string" &&
				message.content.includes(`Frozen evaluation arm: ${candidate}.`),
		),
	);
	if (arm === undefined) throw new TypeError("D26 injected arm is missing");
	const choice = record(body.tool_choice, "D26 injected tool choice");
	const fn = record(choice.function, "D26 injected tool choice.function");
	if (choice.type !== "function" || (fn.name !== "read_file" && fn.name !== "replace_exact"))
		throw new TypeError("D26 injected named tool choice drifted");
	if (!Array.isArray(body.tools) || body.tools.length !== 1)
		throw new TypeError("D26 injected final tools are not exact");
	const tool = record(body.tools[0], "D26 injected tool");
	const toolFunction = record(tool.function, "D26 injected tool.function");
	if (toolFunction.name !== fn.name) throw new TypeError("D26 injected tool and choice disagree");
	return Object.freeze({
		arm,
		namedTool: fn.name as "read_file" | "replace_exact",
		isCorrection: messages.some(
			(message) =>
				typeof message.content === "string" &&
				message.content.includes("correction=semantic-correction"),
		),
	});
}

function createInjectedTransport(mode: TransportState["mode"]) {
	const state: TransportState = {
		mode,
		retried: new Set(),
		pendingRetryBody: new Map(),
		providerCalls: 0,
		active: 0,
		maxActive: 0,
		namedWireCount: 0,
		mutationWireCount: 0,
	};
	const retryPolicy = new Map<string, "D671" | "D675" | "D710">([
		["cold", "D710"],
		["relevant-applied", "D671"],
		["proposal-only", "D675"],
	]);
	const fetchImpl: typeof fetch = async (_url, init) => {
		state.active += 1;
		state.maxActive = Math.max(state.maxActive, state.active);
		try {
			state.providerCalls += 1;
			const bytes = Buffer.from(init?.body as Uint8Array);
			const bodyDigest = empiricalSha256(bytes);
			const body = record(JSON.parse(bytes.toString("utf8")), "D26 injected body");
			const coordinates = requestCoordinates(body);
			state.namedWireCount += 1;
			if (coordinates.namedTool === "replace_exact") state.mutationWireCount += 1;
			const pending = state.pendingRetryBody.get(coordinates.arm);
			if (pending !== undefined) {
				if (pending !== bodyDigest) throw new TypeError("D26 injected final retry body drifted");
				state.pendingRetryBody.delete(coordinates.arm);
			} else if (mode === "main" && !state.retried.has(coordinates.arm)) {
				const policy = retryPolicy.get(coordinates.arm);
				if (policy !== undefined) {
					state.retried.add(coordinates.arm);
					state.pendingRetryBody.set(coordinates.arm, bodyDigest);
					if (policy === "D675") {
						throw new TypeError("D26 injected socket reset", {
							cause: Object.freeze({ code: "UND_ERR_SOCKET" }),
						});
					}
					return new Response(
						JSON.stringify(
							policy === "D710"
								? { error: { message: "bounded" } }
								: { error: { message: "bounded", type: "rate_limit", code: "rate_limit" } },
						),
						{
							status: policy === "D710" ? 429 : 503,
							headers: { "content-type": "application/json" },
						},
					);
				}
			}
			if (mode === "near-miss") {
				if (coordinates.arm === "cold")
					return providerResponse([call("cold-wrong", "workspace_diff", {})]);
				if (coordinates.arm === "admission-rejected" && coordinates.namedTool === "read_file")
					return providerResponse(
						[...CURRENT_GRAPH_LIVE_READABLE_FILES, CURRENT_GRAPH_LIVE_READABLE_FILES[0]].map(
							(path, index) => call(`too-many-${index}`, "read_file", { path }),
						),
					);
				if (coordinates.arm === "wrong-scope-applied")
					return new Response(JSON.stringify({ error: { message: "bounded terminal" } }), {
						status: 400,
						headers: { "content-type": "application/json" },
					});
			}
			if (coordinates.namedTool === "read_file")
				return providerResponse(
					CURRENT_GRAPH_LIVE_READABLE_FILES.map((path, index) =>
						call(`read-${state.providerCalls}-${index}`, "read_file", { path }),
					),
				);
			if (mode === "near-miss") {
				if (coordinates.arm === "relevant-applied")
					return providerResponse([
						call("duplicate-1", "replace_exact", {
							path: CURRENT_GRAPH_LIVE_WRITABLE_FILE,
							oldText: D22_INITIAL_ADMISSION_BLOCK,
							newText: D22_WRONG_ADMISSION_BLOCK,
						}),
						call("duplicate-2", "replace_exact", {
							path: CURRENT_GRAPH_LIVE_WRITABLE_FILE,
							oldText: D22_INITIAL_ADMISSION_BLOCK,
							newText: D22_WRONG_ADMISSION_BLOCK,
						}),
					]);
				const wrong = coordinates.arm === "proposal-only" ? "focused_validation" : "read_file";
				return providerResponse([
					call(
						`wrong-${coordinates.arm}`,
						wrong,
						wrong === "read_file" ? { path: CURRENT_GRAPH_LIVE_READABLE_FILES[0] } : {},
					),
				]);
			}
			return providerResponse([
				call(`replace-${state.providerCalls}`, "replace_exact", {
					path: CURRENT_GRAPH_LIVE_WRITABLE_FILE,
					oldText: coordinates.isCorrection
						? D22_WRONG_ADMISSION_BLOCK
						: D22_INITIAL_ADMISSION_BLOCK,
					newText: coordinates.isCorrection ? D22_FIXED_ADMISSION_BLOCK : D22_WRONG_ADMISSION_BLOCK,
				}),
			]);
		} finally {
			state.active -= 1;
		}
	};
	return Object.freeze({ fetchImpl, state });
}

async function runComposition(input: {
	readonly authority: ReturnType<typeof createD25PhaseAuthority>;
	readonly executor: D26PhaseSpecificExecutorV1;
}): Promise<D25PhaseEvidenceV1> {
	try {
		for (let guard = 0; guard < D21_LIMITS.maxEffectFacts; guard += 1) {
			const execution = await input.executor.executeNext();
			if (execution === null)
				return validateD25PhaseEvidence(snapshotD25PhaseEvidence(input.authority));
			admitD25EffectResult(input.authority, execution.admitted, execution.result);
		}
		throw new TypeError("D26 Graph composition exceeded its effect bound");
	} finally {
		await input.executor.dispose();
	}
}

async function assertNoResidue(path: string): Promise<void> {
	await lstat(path).then(
		() => {
			throw new TypeError("D26 real composition left workspace residue");
		},
		(error: unknown) => {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		},
	);
}

async function runInjectedEvidence(input: {
	readonly repositoryRoot: string;
	readonly temporaryRoot: string;
	readonly mode: "main" | "near-miss";
}) {
	const transport = createInjectedTransport(input.mode);
	const materializationRoot = join(input.temporaryRoot, `workspaces-${input.mode}`);
	const authority = createD25PhaseAuthority({
		limits: D21_LIMITS,
		routeProfile: CURRENT_GRAPH_LIVE_ROUTE,
		taskProfile: D21_TASK_PROFILE,
	});
	const executor = createD26PhaseSpecificRealProviderExecutor({
		authority,
		repositoryRoot: input.repositoryRoot,
		materializationRoot,
		credential: Object.freeze({
			bearerToken: "sk-or-v1-test-d26-no-network-key",
			credentialBindingRef: "openrouter.local-eval-2" as const,
			credentialBindingRevision: "2026-08-14.v1" as const,
		}),
		fetchImpl: transport.fetchImpl,
		sleep: async () => undefined,
	});
	const evidence = await runComposition({ authority, executor });
	await assertNoResidue(materializationRoot);
	return Object.freeze({ evidence, state: transport.state });
}

function workflow(evidence: D25PhaseEvidenceV1) {
	return evidence.workflowEvidence.providerEvidence.workflowEvidence;
}

function retryDelays(evidence: D25PhaseEvidenceV1): readonly number[] {
	return evidence.workflowEvidence.providerEvidence.facts
		.flatMap((fact) =>
			fact.request.effectKind === "retry-wait" ? [fact.request.retryDelayMs] : [],
		)
		.sort((left, right) => left - right);
}

function providerAttemptCount(evidence: D25PhaseEvidenceV1): number {
	return evidence.workflowEvidence.providerEvidence.facts.filter(
		(fact) => fact.request.effectKind === "provider-request",
	).length;
}

function assertMain(evidence: D25PhaseEvidenceV1): void {
	const runs = workflow(evidence).runs;
	if (
		runs.length !== 6 ||
		new Set(runs.map((run) => run.arm)).size !== 6 ||
		runs.some(
			(run) =>
				run.status !== "completed" ||
				!run.publicSemanticValidationPassed ||
				!run.hiddenVerifierPassed ||
				run.cleanupStatus !== "completed",
		) ||
		evidence.phaseFacts.filter((fact) => fact.disposition === "accepted-mutation").length !== 12 ||
		evidence.phaseFacts.some(
			(fact) =>
				fact.disposition === "accepted-mutation" &&
				(fact.proposalToolCallCount !== 1 || fact.proposalToolRefs[0] !== "replace-exact"),
		) ||
		JSON.stringify(retryDelays(evidence)) !== JSON.stringify([1_000, 7_000, 60_000])
	)
		throw new TypeError(
			`D26 main real-workspace lifecycle drifted: ${JSON.stringify({
				runs: runs.map((run) => ({
					arm: run.arm,
					cleanup: run.cleanupStatus,
					hidden: run.hiddenVerifierPassed,
					semantic: run.publicSemanticValidationPassed,
					status: run.status,
				})),
				acceptedMutations: evidence.phaseFacts.filter(
					(fact) => fact.disposition === "accepted-mutation",
				).length,
				retryDelays: retryDelays(evidence),
			})}`,
		);
}

function assertNearMiss(evidence: D25PhaseEvidenceV1): void {
	const runs = workflow(evidence).runs;
	const exactPhaseProjection = evidence.phaseFacts.map((fact) => [
		fact.arm,
		fact.phaseBefore,
		fact.namedToolRef,
		fact.disposition,
		fact.proposalToolCallCount,
	]);
	const expectedPhaseProjection = [
		["cold", "none", "read-file", "phase-tool-mismatch", 1],
		["relevant-applied", "none", "read-file", "accepted-inspection", 4],
		["relevant-applied", "inspection", "replace-exact", "mutation-proposal-cardinality", 2],
		["proposal-only", "none", "read-file", "accepted-inspection", 4],
		["proposal-only", "inspection", "replace-exact", "phase-tool-mismatch", 1],
		["admission-rejected", "none", "read-file", "phase-tool-mismatch", 5],
		["irrelevant-applied", "none", "read-file", "accepted-inspection", 4],
		["irrelevant-applied", "inspection", "replace-exact", "phase-tool-mismatch", 1],
		["wrong-scope-applied", "none", "read-file", "provider-failed", 0],
	] as const;
	if (
		runs.length !== 6 ||
		new Set(runs.map((run) => run.arm)).size !== 6 ||
		runs.some((run) => run.status !== "incomplete" || run.cleanupStatus !== "completed") ||
		JSON.stringify(exactPhaseProjection) !== JSON.stringify(expectedPhaseProjection)
	)
		throw new TypeError("D26 near-miss isolation drifted");
}

function buildBundle(input: {
	readonly basis: Basis;
	readonly main: ReturnType<typeof strictSnapshot<D25PhaseEvidenceV1>>;
	readonly nearMiss: ReturnType<typeof strictSnapshot<D25PhaseEvidenceV1>>;
	readonly providerCalls: number;
}): D26QualificationBundleV1 {
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D26_QUALIFICATION_SCHEMA,
		decisionRef: "graphrefly-ts:D26" as const,
		d25ArtifactDigest: D26_D25_ARTIFACT_DIGEST,
		d25BundleDigest: D26_D25_BUNDLE_DIGEST,
		d25QualificationDigest: D26_D25_QUALIFICATION_DIGEST,
		d25GenerationDigest: D26_D25_GENERATION_DIGEST,
		d25ImplementationManifestDigest: D25_IMPLEMENTATION_MANIFEST_DIGEST,
		implementationManifestDigest: D26_IMPLEMENTATION_MANIFEST_DIGEST,
		mainEvidenceDigest: input.main.evidenceDigest,
		nearMissEvidenceDigest: input.nearMiss.evidenceDigest,
		exactSixArmsCompleted: true as const,
		realWorkspaceLifecyclePassed: true as const,
		exactNamedFinalWirePassed: true as const,
		singleProviderMutationPassed: true as const,
		graphDeterministicSuccessorsPassed: true as const,
		semanticCorrectionCount: 6 as const,
		nearMissIsolationPassed: true as const,
		retryIdentityPassed: true as const,
		retryDelayCoverageMs: [1_000, 7_000, 60_000] as const,
		providerTransportCalls: input.providerCalls,
		providerNetworkCalls: 0 as const,
		maxActiveEffects: 1 as const,
		workspaceResidueCount: 0 as const,
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
		schemaVersion: D26_GENERATION_SCHEMA,
		generationRef: D26_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		mainEvidenceDigest: input.main.evidenceDigest,
		nearMissEvidenceDigest: input.nearMiss.evidenceDigest,
		implementationManifestDigest: D26_IMPLEMENTATION_MANIFEST_DIGEST,
		liveGateEvaluated: false as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = Object.freeze({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D26_BUNDLE_SCHEMA,
		basis: input.basis,
		mainEvidence: input.main,
		nearMissEvidence: input.nearMiss,
		qualification,
		generation,
	});
	const bundle = Object.freeze({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
	constructed.add(bundle);
	return bundle;
}

export async function runD26InjectedNoNetworkQualification(inputValue: {
	readonly baseline: D26D25BaselineAdmissionV1;
	readonly implementationManifestDigest: string;
	readonly repositoryRoot: string;
}): Promise<D26QualificationBundleV1> {
	const input = record(inputValue, "D26 qualification input");
	exactKeys(
		input,
		["baseline", "implementationManifestDigest", "repositoryRoot"],
		"D26 qualification input",
	);
	if (input.implementationManifestDigest !== D26_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D26 implementation manifest digest drifted");
	if (typeof input.repositoryRoot !== "string" || input.repositoryRoot.length === 0)
		throw new TypeError("D26 repository root is invalid");
	const basis = consumeBaseline(input.baseline).basis;
	const repositoryRoot = await realpath(resolve(input.repositoryRoot));
	const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "graphrefly-d26-")));
	await chmod(temporaryRoot, 0o700);
	try {
		const main = await runInjectedEvidence({ repositoryRoot, temporaryRoot, mode: "main" });
		const nearMiss = await runInjectedEvidence({
			repositoryRoot,
			temporaryRoot,
			mode: "near-miss",
		});
		assertMain(main.evidence);
		assertNearMiss(nearMiss.evidence);
		if (
			main.state.pendingRetryBody.size !== 0 ||
			main.state.maxActive !== 1 ||
			nearMiss.state.maxActive !== 1 ||
			main.state.namedWireCount !== main.state.providerCalls ||
			nearMiss.state.namedWireCount !== nearMiss.state.providerCalls ||
			main.state.mutationWireCount !== 12
		)
			throw new TypeError("D26 operational wire qualification drifted");
		return buildBundle({
			basis,
			main: strictSnapshot(main.evidence),
			nearMiss: strictSnapshot(nearMiss.evidence),
			providerCalls: main.state.providerCalls + nearMiss.state.providerCalls,
		});
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

export function validateD26QualificationBundle(value: unknown): D26QualificationBundleV1 {
	const candidate = record(value, "D26 bundle");
	exactKeys(
		candidate,
		[
			"basis",
			"bundleDigest",
			"generation",
			"mainEvidence",
			"nearMissEvidence",
			"qualification",
			"schemaVersion",
		],
		"D26 bundle",
	);
	if (
		candidate.schemaVersion !== D26_BUNDLE_SCHEMA ||
		(candidate.basis !== "consumed-d25-artifact" && candidate.basis !== "injected-test")
	)
		throw new TypeError("D26 bundle coordinates drifted");
	const mainEvidence = validateD25PhaseEvidence(candidate.mainEvidence);
	const nearMissEvidence = validateD25PhaseEvidence(candidate.nearMissEvidence);
	assertMain(mainEvidence);
	assertNearMiss(nearMissEvidence);
	const qualification = record(candidate.qualification, "D26 qualification");
	const generation = record(candidate.generation, "D26 generation");
	exactKeys(
		qualification,
		[
			"causalAttribution",
			"d25ArtifactDigest",
			"d25BundleDigest",
			"d25GenerationDigest",
			"d25ImplementationManifestDigest",
			"d25QualificationDigest",
			"decisionRef",
			"efficacyClaim",
			"exactNamedFinalWirePassed",
			"exactSixArmsCompleted",
			"graphDeterministicSuccessorsPassed",
			"implementationManifestDigest",
			"liveGateEvaluated",
			"mainEvidenceDigest",
			"maxActiveEffects",
			"nearMissEvidenceDigest",
			"nearMissIsolationPassed",
			"providerNetworkCalls",
			"providerTransportCalls",
			"qualificationDigest",
			"qualified",
			"realWorkspaceLifecyclePassed",
			"retryDelayCoverageMs",
			"retryIdentityPassed",
			"schemaVersion",
			"semanticCorrectionCount",
			"singleProviderMutationPassed",
			"workspaceResidueCount",
		],
		"D26 qualification",
	);
	exactKeys(
		generation,
		[
			"causalAttribution",
			"efficacyClaim",
			"generationDigest",
			"generationRef",
			"implementationManifestDigest",
			"liveGateEvaluated",
			"mainEvidenceDigest",
			"nearMissEvidenceDigest",
			"qualificationDigest",
			"schemaVersion",
		],
		"D26 generation",
	);
	if (
		qualification.schemaVersion !== D26_QUALIFICATION_SCHEMA ||
		qualification.decisionRef !== "graphrefly-ts:D26" ||
		qualification.d25ArtifactDigest !== D26_D25_ARTIFACT_DIGEST ||
		qualification.d25BundleDigest !== D26_D25_BUNDLE_DIGEST ||
		qualification.d25QualificationDigest !== D26_D25_QUALIFICATION_DIGEST ||
		qualification.d25GenerationDigest !== D26_D25_GENERATION_DIGEST ||
		qualification.d25ImplementationManifestDigest !== D25_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.implementationManifestDigest !== D26_IMPLEMENTATION_MANIFEST_DIGEST ||
		qualification.mainEvidenceDigest !== mainEvidence.evidenceDigest ||
		qualification.nearMissEvidenceDigest !== nearMissEvidence.evidenceDigest ||
		qualification.exactSixArmsCompleted !== true ||
		qualification.realWorkspaceLifecyclePassed !== true ||
		qualification.exactNamedFinalWirePassed !== true ||
		qualification.singleProviderMutationPassed !== true ||
		qualification.graphDeterministicSuccessorsPassed !== true ||
		qualification.semanticCorrectionCount !== 6 ||
		qualification.nearMissIsolationPassed !== true ||
		qualification.retryIdentityPassed !== true ||
		JSON.stringify(qualification.retryDelayCoverageMs) !== JSON.stringify([1_000, 7_000, 60_000]) ||
		!Number.isSafeInteger(qualification.providerTransportCalls) ||
		(qualification.providerTransportCalls as number) < 1 ||
		(qualification.providerTransportCalls as number) > 256 ||
		qualification.providerTransportCalls !==
			providerAttemptCount(mainEvidence) + providerAttemptCount(nearMissEvidence) ||
		qualification.qualified !== true ||
		qualification.providerNetworkCalls !== 0 ||
		qualification.maxActiveEffects !== 1 ||
		qualification.workspaceResidueCount !== 0 ||
		qualification.liveGateEvaluated !== false ||
		qualification.causalAttribution !== "undetermined" ||
		qualification.efficacyClaim !== "none" ||
		generation.schemaVersion !== D26_GENERATION_SCHEMA ||
		generation.generationRef !== D26_GENERATION_REF ||
		generation.qualificationDigest !== qualification.qualificationDigest ||
		generation.mainEvidenceDigest !== mainEvidence.evidenceDigest ||
		generation.nearMissEvidenceDigest !== nearMissEvidence.evidenceDigest ||
		generation.implementationManifestDigest !== D26_IMPLEMENTATION_MANIFEST_DIGEST ||
		generation.liveGateEvaluated !== false ||
		generation.causalAttribution !== "undetermined" ||
		generation.efficacyClaim !== "none"
	)
		throw new TypeError("D26 qualification coordinates drifted");
	const { qualificationDigest, ...qualificationMaterial } = qualification;
	if (qualification.qualificationDigest !== empiricalStrictJsonDigest(qualificationMaterial))
		throw new TypeError("D26 qualification digest drifted");
	const { generationDigest, ...generationMaterial } = generation;
	if (generation.generationDigest !== empiricalStrictJsonDigest(generationMaterial))
		throw new TypeError("D26 generation digest drifted");
	const material = strictSnapshot({
		schemaVersion: candidate.schemaVersion,
		basis: candidate.basis,
		mainEvidence,
		nearMissEvidence,
		qualification,
		generation,
	});
	if (candidate.bundleDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("D26 bundle digest drifted");
	return strictSnapshot(candidate) as unknown as D26QualificationBundleV1;
}

async function persistD26(input: {
	readonly bundle: D26QualificationBundleV1;
	readonly privateRoot: string;
	readonly generationRef: string;
}) {
	const bytes = strictJsonCodec.encode(strictSnapshot(input.bundle) as unknown as StrictJsonValue);
	const commitBytes = strictJsonCodec.encode(
		strictSnapshot({
			schemaVersion: "graphrefly-ts.d26.phase-specific-real-provider-commit.v1",
			generationRef: input.generationRef,
			bundleDigest: input.bundle.bundleDigest,
			qualificationDigest: input.bundle.qualification.qualificationDigest,
			generationDigest: input.bundle.generation.generationDigest,
		}) as StrictJsonValue,
	);
	return persistCurrentGraphPrivateGeneration({
		privateRoot: input.privateRoot,
		generationRef: input.generationRef,
		artifacts: Object.freeze({ "bundle.v1.json": bytes }),
		commitBytes,
	});
}

export async function persistD26QualificationBundle(input: {
	readonly bundle: D26QualificationBundleV1;
	readonly privateRoot: string;
}) {
	if (!constructed.has(input.bundle))
		throw new TypeError("D26 bundle is not same-process constructed");
	constructed.delete(input.bundle);
	if (input.bundle.basis !== "consumed-d25-artifact")
		throw new TypeError("D26 production persistence requires consumed D25 evidence");
	validateD26QualificationBundle(input.bundle);
	return persistD26({
		bundle: input.bundle,
		privateRoot: input.privateRoot,
		generationRef: D26_GENERATION_REF,
	});
}

export async function persistD26InjectedQualificationForTest(input: {
	readonly bundle: D26QualificationBundleV1;
	readonly privateRoot: string;
}) {
	if (!constructed.has(input.bundle))
		throw new TypeError("D26 bundle is not same-process constructed");
	constructed.delete(input.bundle);
	if (input.bundle.basis !== "injected-test")
		throw new TypeError("D26 injected persistence basis drifted");
	validateD26QualificationBundle(input.bundle);
	return persistD26({
		bundle: input.bundle,
		privateRoot: input.privateRoot,
		generationRef: D26_INJECTED_GENERATION_REF,
	});
}
