import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describeToMermaid } from "../../src/graph/render.js";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import { createCurrentExactModelHarnessProfileInput } from "./current-exact-profile.js";
import {
	createRootEvalTopology,
	type EvalAdmittedToolEffect,
	type EvalEffectOutcome,
	type EvalExecutableEffect,
	type EvalExecutorOutcome,
	materialFreeObservationValue,
	ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
	type RootEvalRunResult,
	requireCompletedRootEval,
	runRootEval,
} from "./eval-topology.js";
import {
	CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
	measureCurrentImplementation,
} from "./implementation-manifest.js";
import {
	ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT,
	ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT_DIGEST,
	ROOT_EVAL_LIVE_QUALIFICATION,
} from "./root-eval-live-qualification.js";
import {
	ROOT_EVAL_DEVELOPMENT_TASKS,
	ROOT_EVAL_HELD_OUT_SEAL_DIGEST,
	ROOT_EVAL_IRRELEVANT_SOURCE_REPLICATES,
	rootEvalScriptedMechanismReplacement,
} from "./root-eval-task.js";
import {
	ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT,
	ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT_DIGEST,
	ROOT_EVAL_TOPOLOGY_QUALIFICATION,
} from "./root-eval-topology-qualification.js";

export const ROOT_EVAL_ARTIFACT_DIRECTORY = resolve(import.meta.dirname, "artifacts");

export const ROOT_EVAL_GENERATED_ARTIFACT_PATHS = Object.freeze({
	describe: resolve(ROOT_EVAL_ARTIFACT_DIRECTORY, "root-eval-describe.json"),
	mermaid: resolve(ROOT_EVAL_ARTIFACT_DIRECTORY, "root-eval-topology.mmd"),
	observeEvents: resolve(ROOT_EVAL_ARTIFACT_DIRECTORY, "root-eval-observe-events.jsonl"),
	runSummary: resolve(ROOT_EVAL_ARTIFACT_DIRECTORY, "root-eval-run-summary.json"),
	qualification: resolve(ROOT_EVAL_ARTIFACT_DIRECTORY, "root-eval-topology-qualification.json"),
	liveQualification: resolve(ROOT_EVAL_ARTIFACT_DIRECTORY, "root-eval-live-qualification.json"),
	artifactSet: resolve(ROOT_EVAL_ARTIFACT_DIRECTORY, "root-eval-artifact-set.json"),
	d120TopologyQualification: resolve(
		ROOT_EVAL_ARTIFACT_DIRECTORY,
		"history/d120-root-eval-topology-qualification.json",
	),
	d120LiveQualification: resolve(
		ROOT_EVAL_ARTIFACT_DIRECTORY,
		"history/d120-root-eval-live-qualification.json",
	),
	d124Describe: resolve(ROOT_EVAL_ARTIFACT_DIRECTORY, "history/d124-root-eval-describe.json"),
	d124ObserveEvents: resolve(
		ROOT_EVAL_ARTIFACT_DIRECTORY,
		"history/d124-root-eval-observe-events.jsonl",
	),
	d124RunSummary: resolve(ROOT_EVAL_ARTIFACT_DIRECTORY, "history/d124-root-eval-run-summary.json"),
	d124TopologyQualification: resolve(
		ROOT_EVAL_ARTIFACT_DIRECTORY,
		"history/d124-root-eval-topology-qualification.json",
	),
	d124LiveQualification: resolve(
		ROOT_EVAL_ARTIFACT_DIRECTORY,
		"history/d124-root-eval-live-qualification.json",
	),
	d124Mermaid: resolve(ROOT_EVAL_ARTIFACT_DIRECTORY, "history/d124-root-eval-topology.mmd"),
});

export interface RootEvalGeneratedArtifactBytes {
	readonly describe: string;
	readonly mermaid: string;
	readonly observeEvents: string;
	readonly runSummary: string;
	readonly qualification: string;
	readonly liveQualification: string;
	readonly artifactSet: string;
	readonly d120TopologyQualification: string;
	readonly d120LiveQualification: string;
	readonly d124Describe: string;
	readonly d124ObserveEvents: string;
	readonly d124RunSummary: string;
	readonly d124TopologyQualification: string;
	readonly d124LiveQualification: string;
	readonly d124Mermaid: string;
}

export interface RootEvalGeneratedArtifactSnapshot {
	readonly artifactSetDigest: string;
	readonly implementationManifestDigest: string;
}

const ROOT_EVAL_ARTIFACT_MARKER_MAX_BYTES = 65_536;
const ROOT_EVAL_ARTIFACT_FILE_MAX_BYTES = 64 * 1_048_576;

function parseRootEvalArtifactSet(bytes: Uint8Array): {
	readonly implementationManifestDigest: string;
	readonly files: Readonly<Record<string, string>>;
} {
	if (bytes.byteLength < 1 || bytes.byteLength > ROOT_EVAL_ARTIFACT_MARKER_MAX_BYTES)
		throw new Error("root eval artifact-set marker exceeded its byte bound");
	const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new Error("root eval artifact-set marker was malformed");
	const marker = value as Record<string, unknown>;
	if (
		Object.keys(marker).sort().join("\0") !==
			["files", "format", "implementationManifestDigest", "publication", "version"]
				.sort()
				.join("\0") ||
		marker.format !== "graphrefly.rootEvalArtifactSet" ||
		marker.version !== 1 ||
		marker.publication !== "commit-marker-written-last" ||
		typeof marker.implementationManifestDigest !== "string" ||
		marker.files === null ||
		typeof marker.files !== "object" ||
		Array.isArray(marker.files)
	)
		throw new Error("root eval artifact-set marker was malformed");
	const files = marker.files as Record<string, unknown>;
	for (const [name, fileDigest] of Object.entries(files))
		if (
			!/^([a-z0-9-]+\/)*[a-z0-9.-]+$/u.test(name) ||
			typeof fileDigest !== "string" ||
			!/^sha256:[0-9a-f]{64}$/u.test(fileDigest)
		)
			throw new Error("root eval artifact-set marker file binding was malformed");
	return Object.freeze({
		implementationManifestDigest: marker.implementationManifestDigest,
		files: Object.freeze(files as Record<string, string>),
	});
}

export async function checkRootEvalGeneratedArtifactSnapshot(input?: {
	readonly artifactDirectory?: string;
}): Promise<RootEvalGeneratedArtifactSnapshot> {
	const artifactDirectory = resolve(input?.artifactDirectory ?? ROOT_EVAL_ARTIFACT_DIRECTORY);
	const artifactSetPath = resolve(artifactDirectory, "root-eval-artifact-set.json");
	const markerStat = await stat(artifactSetPath);
	if (!markerStat.isFile() || markerStat.size > ROOT_EVAL_ARTIFACT_MARKER_MAX_BYTES)
		throw new Error("root eval artifact-set marker exceeded its byte bound");
	const markerBefore = await readFile(artifactSetPath);
	const marker = parseRootEvalArtifactSet(markerBefore);
	if (marker.implementationManifestDigest !== CURRENT_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new Error("root eval artifact-set implementation manifest drifted");
	const expectedFiles = Object.entries(ROOT_EVAL_GENERATED_ARTIFACT_PATHS)
		.filter(([key]) => key !== "artifactSet")
		.map(([, path]) => relative(ROOT_EVAL_ARTIFACT_DIRECTORY, path))
		.sort();
	if (Object.keys(marker.files).sort().join("\0") !== expectedFiles.join("\0"))
		throw new Error("root eval artifact-set file membership drifted");
	for (const name of expectedFiles) {
		const path = resolve(artifactDirectory, name);
		if (!path.startsWith(`${artifactDirectory}/`))
			throw new Error("root eval artifact-set path escaped its directory");
		const fileStat = await stat(path);
		if (!fileStat.isFile() || fileStat.size > ROOT_EVAL_ARTIFACT_FILE_MAX_BYTES)
			throw new Error(`root eval generated artifact exceeded its byte bound: ${name}`);
		if (empiricalSha256(await readFile(path)) !== marker.files[name])
			throw new Error(`root eval generated artifact snapshot drift: ${name}`);
	}
	const markerAfter = await readFile(artifactSetPath);
	if (empiricalSha256(markerAfter) !== empiricalSha256(markerBefore))
		throw new Error("root eval artifact set changed while its snapshot was checked");
	return Object.freeze({
		artifactSetDigest: empiricalSha256(markerBefore),
		implementationManifestDigest: marker.implementationManifestDigest,
	});
}

const D124_TOPOLOGY_QA_DIGEST =
	"sha256:a5dfafaca9437a317c82433e3de528fcc6d32805210329ab37bf167497d7200e";
const D124_TOPOLOGY_QUALIFICATION_DIGEST =
	"sha256:422491364a267407ea4f837e77b4c942122da658f1d9b633ae65dd1862279493";
const D124_LIVE_QA_DIGEST =
	"sha256:90fdba7d97a6cd4e353cefe6f762ea114d92b2f1b6cdc23e4451f44656cefcfa";
const D124_LIVE_QUALIFICATION_DIGEST =
	"sha256:b6d49961927d36d18153d32c673414bf9488edaa3fe8f96d9294f2e9efacc3a4";
const D124_TOPOLOGY_QUALIFICATION_BYTES_DIGEST =
	"sha256:66df4bc2853ece5b96449939c002521079d31aebe0989e6966b7ec5dbbf93c12";
const D124_LIVE_QUALIFICATION_BYTES_DIGEST =
	"sha256:4e83b0f797775e5c5dcb311a112f18fdd29ccb8ccf22380c34d8cf0816d8dfdc";
const D124_DESCRIBE_DIGEST =
	"sha256:91fc8d290eeecb70d281a86fcc3dc2437d6840e9fbaa88b20184d04757ffda54";
const D124_OBSERVE_DIGEST =
	"sha256:fb5600fa171f3e5cf5a69432595ab6282433501680d71d247193327bb1338e94";
const D124_RUN_SUMMARY_DIGEST =
	"sha256:38c2a81c0dedb762bb53ab31f9f5531758f711a0d3f2f8695e4fb2eb59096d9b";
const D124_MERMAID_DIGEST =
	"sha256:193f393ee67f8259bdc678ed182070d70108779598312498154a960ea4e9200a";

async function readD120FrozenQualificationBytes(): Promise<
	Readonly<{ topology: string; live: string }>
> {
	const [topology, live] = await Promise.all([
		readFile(ROOT_EVAL_GENERATED_ARTIFACT_PATHS.d120TopologyQualification, "utf8"),
		readFile(ROOT_EVAL_GENERATED_ARTIFACT_PATHS.d120LiveQualification, "utf8"),
	]);
	// Frozen evidence is read verbatim, never reconstructed from current QA assertions.
	if (
		empiricalSha256(Buffer.from(topology)) !==
			"sha256:afe7528e510006c2afe35315ded6edf00830df40af3d2d96878c5ee8ee6bc23e" ||
		empiricalSha256(Buffer.from(live)) !==
			"sha256:b79f03e45490a6d728b933fe7bc2aa4f6fd1f622c8ebd02afdb6111004132aa9"
	)
		throw new Error("root eval D120 frozen qualification bytes drifted");
	return Object.freeze({ topology, live });
}

async function readD124FrozenArtifactBytes(): Promise<
	Readonly<{
		readonly describe: string;
		readonly observeEvents: string;
		readonly runSummary: string;
		readonly topologyQualification: string;
		readonly liveQualification: string;
		readonly mermaid: string;
	}>
> {
	const [describe, observeEvents, runSummary, topologyQualification, liveQualification, mermaid] =
		await Promise.all([
			readFile(ROOT_EVAL_GENERATED_ARTIFACT_PATHS.d124Describe, "utf8"),
			readFile(ROOT_EVAL_GENERATED_ARTIFACT_PATHS.d124ObserveEvents, "utf8"),
			readFile(ROOT_EVAL_GENERATED_ARTIFACT_PATHS.d124RunSummary, "utf8"),
			readFile(ROOT_EVAL_GENERATED_ARTIFACT_PATHS.d124TopologyQualification, "utf8"),
			readFile(ROOT_EVAL_GENERATED_ARTIFACT_PATHS.d124LiveQualification, "utf8"),
			readFile(ROOT_EVAL_GENERATED_ARTIFACT_PATHS.d124Mermaid, "utf8"),
		]);
	for (const [name, bytes, digest] of [
		["describe", describe, D124_DESCRIBE_DIGEST],
		["observe", observeEvents, D124_OBSERVE_DIGEST],
		["run-summary", runSummary, D124_RUN_SUMMARY_DIGEST],
		["topology-qualification", topologyQualification, D124_TOPOLOGY_QUALIFICATION_BYTES_DIGEST],
		["live-qualification", liveQualification, D124_LIVE_QUALIFICATION_BYTES_DIGEST],
		["mermaid", mermaid, D124_MERMAID_DIGEST],
	] as const)
		if (empiricalSha256(Buffer.from(bytes)) !== digest)
			throw new Error(`root eval immutable D124 ${name} artifact drifted`);
	const parsedTopology = JSON.parse(topologyQualification) as {
		readonly artifactDigest?: string;
		readonly qualification?: { readonly qualificationDigest?: string };
	};
	const parsedLive = JSON.parse(liveQualification) as {
		readonly artifactDigest?: string;
		readonly qualification?: { readonly qualificationDigest?: string };
	};
	if (
		parsedTopology.artifactDigest !== D124_TOPOLOGY_QA_DIGEST ||
		parsedTopology.qualification?.qualificationDigest !== D124_TOPOLOGY_QUALIFICATION_DIGEST ||
		parsedLive.artifactDigest !== D124_LIVE_QA_DIGEST ||
		parsedLive.qualification?.qualificationDigest !== D124_LIVE_QUALIFICATION_DIGEST
	)
		throw new Error("root eval immutable D124 qualification identity drifted");
	return Object.freeze({
		describe,
		observeEvents,
		runSummary,
		topologyQualification,
		liveQualification,
		mermaid,
	});
}

function qualificationOutcome(effect: EvalAdmittedToolEffect): EvalEffectOutcome {
	const passed =
		effect.workItemRole === "source" ||
		(effect.path === ROOT_EVAL_DEVELOPMENT_TASKS[effect.replicate - 1]!.writablePath &&
			effect.oldText === ROOT_EVAL_DEVELOPMENT_TASKS[effect.replicate - 1]!.fixtureBuggyText &&
			effect.newText === ROOT_EVAL_DEVELOPMENT_TASKS[effect.replicate - 1]!.fixtureCorrectText);
	const expectedDigest =
		effect.workItemRole === "source"
			? ROOT_EVAL_DEVELOPMENT_TASKS[effect.replicate - 1]!.sourceVerifierEvidenceDigest
			: empiricalStrictJsonDigest({
					kind: "expected-eval-result",
					replicate: effect.replicate,
					arm: effect.arm,
					dispatchOrdinal: effect.dispatchOrdinal,
				});
	return Object.freeze({
		kind: "eval-effect-outcome",
		admission: effect,
		executionId: effect.executionId,
		admissionId: effect.providerAdmission.admissionId,
		toolAdmissionId: effect.toolAdmissionId,
		operationId: effect.providerAdmission.operationId,
		argumentsDigest: effect.argumentsDigest,
		effectRunId: effect.effectRunId,
		workItemId: effect.workItemId,
		workItemRole: effect.workItemRole,
		replicate: effect.replicate,
		arm: effect.arm,
		providerLogicalAttempt: effect.providerLogicalAttempt,
		dispatchOrdinal: effect.dispatchOrdinal,
		capacityRetryOrdinal: effect.capacityRetryOrdinal,
		availabilityRetryOrdinal: effect.availabilityRetryOrdinal,
		status: "completed",
		costMicrousd: 0,
		elapsedMs: effect.replicate * 10 + effect.dispatchOrdinal,
		resultDigest: empiricalStrictJsonDigest({
			kind: "no-network-eval-result",
			replicate: effect.replicate,
			arm: effect.arm,
			dispatchOrdinal: effect.dispatchOrdinal,
		}),
		evidence: Object.freeze({
			expectedDigest,
			actualDigest: empiricalStrictJsonDigest({
				kind: "actual-control-result",
				replicate: effect.replicate,
				arm: effect.arm,
			}),
			diff: passed ? "scoped-change" : "no-change",
			cleanupCompleted: true,
			publicSemantic: passed ? "equivalent" : "different",
			hiddenVerifier: passed ? "pass" : "fail",
		}),
	});
}

async function qualificationExecutor(effect: EvalExecutableEffect): Promise<EvalExecutorOutcome> {
	if (effect.kind === "eval-admitted-tool-effect") return qualificationOutcome(effect);
	if (effect.kind === "eval-admitted-billing-observation") {
		const before = effect.currentKeyBefore;
		const currentKeyAfter = Object.freeze({
			...before,
			remainingMicrousd: before.remainingMicrousd - effect.accountedUpperBoundMicrousd,
			usageMicrousd: before.usageMicrousd + effect.accountedUpperBoundMicrousd,
			admissionDigest: empiricalStrictJsonDigest({
				kind: "qualification-current-key-observation",
				executionId: effect.executionId,
			}),
		});
		return Object.freeze({
			kind: "eval-billing-observation-outcome" as const,
			admission: effect,
			executionId: effect.executionId,
			observation: effect.observation,
			status: "completed" as const,
			currentKeyAfter,
			resultDigest: empiricalStrictJsonDigest(currentKeyAfter),
		});
	}
	if (effect.kind === "eval-admitted-retry-delay")
		return Object.freeze({
			kind: "eval-retry-delay-outcome" as const,
			admission: effect,
			executionId: effect.executionId,
			elapsedMs: effect.delayMs,
			status: "completed" as const,
			resultDigest: empiricalStrictJsonDigest({
				kind: "qualification-delay",
				id: effect.executionId,
			}),
		});
	const task = ROOT_EVAL_DEVELOPMENT_TASKS[effect.replicate - 1]!;
	const payload = effect.request.payload as
		| {
				readonly memoryExposureCount?: number;
				readonly memoryBindings?: readonly Readonly<{
					readonly bindingRef: string;
					readonly digest: string;
				}>[];
		  }
		| undefined;
	let targetReplacement = task.fixtureCorrectText;
	if (effect.workItemRole === "target") {
		const sourceTask =
			effect.arm === "irrelevant-applied"
				? ROOT_EVAL_DEVELOPMENT_TASKS[
						ROOT_EVAL_IRRELEVANT_SOURCE_REPLICATES[effect.replicate - 1]! - 1
					]!
				: task;
		const exposed = effect.arm === "relevant-applied" || effect.arm === "irrelevant-applied";
		const expectedBindingDigest = empiricalStrictJsonDigest({
			kind: "eval-private-memory-binding",
			taskInstanceRef: sourceTask.instanceRef,
			sourceWorkItemId: sourceTask.sourceWorkItemRef,
			sourceEvidenceDigest: sourceTask.sourceVerifierEvidenceDigest,
			sourceInsightDigest: sourceTask.sourceInsightDigest,
			arm: effect.arm,
		});
		if (
			(exposed &&
				(payload?.memoryExposureCount !== 1 ||
					payload.memoryBindings?.length !== 1 ||
					payload.memoryBindings[0]?.digest !== expectedBindingDigest)) ||
			(!exposed &&
				(payload?.memoryExposureCount !== 0 || (payload.memoryBindings?.length ?? 0) !== 0))
		)
			throw new TypeError("no-network executor rejected memory occurrence binding drift");
		targetReplacement = rootEvalScriptedMechanismReplacement(task, {
			sourceInsightContent: exposed ? sourceTask.sourceInsightContent : undefined,
			admitted: exposed || effect.arm === "wrong-scope-applied",
			applied: exposed || effect.arm === "wrong-scope-applied",
			scopeMatches: effect.arm !== "wrong-scope-applied",
		}).replacement;
	}
	const tool = Object.freeze({
		toolRef: "graphrefly.eval.exact-tool.v1" as const,
		path: effect.workItemRole === "source" ? task.sourceWritablePath : task.writablePath,
		oldText: effect.workItemRole === "source" ? task.sourceFixtureBuggyText : task.fixtureBuggyText,
		newText: effect.workItemRole === "source" ? task.sourceFixtureCorrectText : targetReplacement,
	});
	const exactRouteHttp429 =
		effect.workItemRole === "target" &&
		effect.replicate === 1 &&
		effect.arm === "cold" &&
		effect.dispatchOrdinal === 1;
	return Object.freeze({
		kind: "eval-provider-outcome" as const,
		admission: effect,
		admissionId: effect.admissionId,
		executionId: effect.executionId,
		operationId: effect.operationId,
		effectRunId: effect.effectRunId,
		workItemId: effect.workItemId,
		workItemRole: effect.workItemRole,
		replicate: effect.replicate,
		arm: effect.arm,
		providerLogicalAttempt: effect.providerLogicalAttempt,
		dispatchOrdinal: effect.dispatchOrdinal,
		capacityRetryOrdinal: effect.capacityRetryOrdinal,
		availabilityRetryOrdinal: effect.availabilityRetryOrdinal,
		status: exactRouteHttp429 ? ("retryable" as const) : ("tool-proposed" as const),
		reason: exactRouteHttp429 ? ("http-capacity-retryable" as const) : ("tool-proposed" as const),
		recoveryClass: exactRouteHttp429 ? ("capacity" as const) : null,
		dispatchAttempted: true,
		dispatchElapsedMs: 0,
		providerResponseKind: "http",
		httpStatus: exactRouteHttp429 ? 429 : 200,
		providerErrorCode: null,
		transportNoToolSideEffect: false,
		costMicrousd: exactRouteHttp429 ? 0 : 10,
		costEvidence: "provider-reported" as const,
		pricingRoundingAllowanceMicrousd: 0,
		elapsedMs: effect.replicate * 10 + effect.dispatchOrdinal,
		resultDigest: empiricalStrictJsonDigest({
			kind: "qualification-provider",
			id: effect.executionId,
		}),
		retryAfterMs: exactRouteHttp429 ? 60_000 : 0,
		cleanupCompleted: exactRouteHttp429,
		toolProposal: exactRouteHttp429
			? null
			: Object.freeze({
					...tool,
					argumentsDigest: empiricalStrictJsonDigest(tool),
				}),
	});
}

function prettyJson(value: unknown): string {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

export async function buildRootEvalGeneratedArtifactBytes(): Promise<RootEvalGeneratedArtifactBytes> {
	const measuredManifestDigest = await measureCurrentImplementation();
	if (measuredManifestDigest !== CURRENT_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new Error("root eval artifact generation rejects implementation manifest drift");
	const topology = createRootEvalTopology({
		profileInput: createCurrentExactModelHarnessProfileInput(),
		currentKeyBefore: ROOT_EVAL_NO_NETWORK_CURRENT_KEY_BEFORE,
		providerPacingSetTimeout: (callback) => {
			callback();
			return 0 as unknown as ReturnType<typeof setTimeout>;
		},
		campaignRef: "root-eval-d152-mechanism-no-network-qualification-v1",
		campaignPurpose: "development",
		taskSetRef: ROOT_EVAL_DEVELOPMENT_TASKS[0]!.taskSetRef,
		generationRef: "root-eval-d152-mechanism-no-network-qualification-v1",
		replicateCount: 5,
		heldOutSealDigest: ROOT_EVAL_HELD_OUT_SEAL_DIGEST,
		budgetPartition: "development-usd-36",
		partitionHardCapMicrousd: 36_000_000,
		partitionSpentBeforeMicrousd: 0,
		partitionLedgerDigest: empiricalStrictJsonDigest({
			kind: "d152-no-network-qualification-ledger",
		}),
		developmentQualificationStreakBefore: 0,
	});
	const describe = topology.graph.describe();
	const rawObservationEvents: Array<RootEvalRunResult["observations"][number]> = [];
	const observationPaths = [
		"eval/budget/state",
		"eval/provider/start-spacing-readiness",
		"eval/campaign/terminal",
		"eval/observation/arrivals",
		"eval/observation/canonical-state",
		"eval/observation/provider-effect-activity",
		"eval/observation/tool-effect-activity",
		"eval/observation/retry-effect-activity",
		"eval/observation/billing-effect-activity",
		"eval/observation/effect-activity",
		"eval/observation",
	] as const;
	const stopRawObservations = observationPaths.map((path) =>
		topology.graph.observe(path).subscribe((event) => rawObservationEvents.push(event)),
	);
	let result: RootEvalRunResult;
	try {
		result = requireCompletedRootEval(await runRootEval(topology, qualificationExecutor));
	} finally {
		for (const stop of stopRawObservations) stop();
	}
	rawObservationEvents.sort((left, right) => left.seq - right.seq);
	const observation = [...result.observations]
		.reverse()
		.map(materialFreeObservationValue)
		.find((value) => value !== undefined);
	if (observation === undefined || observation.finding === "pending") {
		throw new Error("root eval artifact generation requires a terminal Graph observation");
	}
	const runSummary = Object.freeze({
		format: "graphrefly.rootEvalRunSummary" as const,
		version: 1 as const,
		authority: "derived-no-network-qa" as const,
		claimStatus: "no-network-identifiability-only" as const,
		efficacyClaim: "none" as const,
		observation,
		finding: result.finding,
		peakConcurrentEffects: result.peakConcurrentEffects,
		executedAdmissionCount: result.executedAdmissionIds.length,
	});
	const describeBytes = prettyJson(describe);
	const observeEventBytes = `${rawObservationEvents.map((event) => JSON.stringify(event)).join("\n")}\n`;
	const runSummaryBytes = prettyJson(runSummary);
	const mermaidBytes = `%% Deterministic describeToMermaid(root graph.describe()) view; raw JSON remains authority.\n${describeToMermaid(describe)}\n`;
	const evidenceDigests = Object.freeze({
		describe: empiricalSha256(Buffer.from(describeBytes)),
		observeEvents: empiricalSha256(Buffer.from(observeEventBytes)),
		runSummary: empiricalSha256(Buffer.from(runSummaryBytes)),
		explanatoryMermaid: empiricalSha256(Buffer.from(mermaidBytes)),
	});
	const qualification = Object.freeze({
		artifact: ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT,
		artifactDigest: ROOT_EVAL_TOPOLOGY_NO_NETWORK_QA_ARTIFACT_DIGEST,
		qualification: ROOT_EVAL_TOPOLOGY_QUALIFICATION,
		measuredImplementationManifestDigest: measuredManifestDigest,
		evidenceDigests,
		evidenceBindingDigest: empiricalStrictJsonDigest({
			implementationManifestDigest: measuredManifestDigest,
			qualificationDigest: ROOT_EVAL_TOPOLOGY_QUALIFICATION.qualificationDigest,
			evidenceDigests,
		}),
	});
	const qualificationBytes = prettyJson(qualification);
	const liveQualificationBytes = prettyJson({
		artifact: ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT,
		artifactDigest: ROOT_EVAL_LIVE_NO_NETWORK_QA_ARTIFACT_DIGEST,
		qualification: ROOT_EVAL_LIVE_QUALIFICATION,
		measuredImplementationManifestDigest: measuredManifestDigest,
	});
	const d120Frozen = await readD120FrozenQualificationBytes();
	const d124Frozen = await readD124FrozenArtifactBytes();
	const artifactSet = Object.freeze({
		format: "graphrefly.rootEvalArtifactSet" as const,
		version: 1 as const,
		publication: "commit-marker-written-last" as const,
		implementationManifestDigest: measuredManifestDigest,
		files: Object.freeze({
			"root-eval-describe.json": evidenceDigests.describe,
			"root-eval-observe-events.jsonl": evidenceDigests.observeEvents,
			"root-eval-run-summary.json": evidenceDigests.runSummary,
			"root-eval-topology-qualification.json": empiricalSha256(Buffer.from(qualificationBytes)),
			"root-eval-live-qualification.json": empiricalSha256(Buffer.from(liveQualificationBytes)),
			"root-eval-topology.mmd": evidenceDigests.explanatoryMermaid,
			"history/d120-root-eval-topology-qualification.json": empiricalSha256(
				Buffer.from(d120Frozen.topology),
			),
			"history/d120-root-eval-live-qualification.json": empiricalSha256(
				Buffer.from(d120Frozen.live),
			),
			"history/d124-root-eval-describe.json": D124_DESCRIBE_DIGEST,
			"history/d124-root-eval-observe-events.jsonl": D124_OBSERVE_DIGEST,
			"history/d124-root-eval-run-summary.json": D124_RUN_SUMMARY_DIGEST,
			"history/d124-root-eval-topology-qualification.json": empiricalSha256(
				Buffer.from(d124Frozen.topologyQualification),
			),
			"history/d124-root-eval-live-qualification.json": empiricalSha256(
				Buffer.from(d124Frozen.liveQualification),
			),
			"history/d124-root-eval-topology.mmd": D124_MERMAID_DIGEST,
		}),
	});
	if ((await measureCurrentImplementation()) !== measuredManifestDigest)
		throw new Error("root eval implementation drifted during artifact generation");
	return Object.freeze({
		describe: describeBytes,
		mermaid: mermaidBytes,
		observeEvents: observeEventBytes,
		runSummary: runSummaryBytes,
		qualification: qualificationBytes,
		liveQualification: liveQualificationBytes,
		artifactSet: prettyJson(artifactSet),
		d120TopologyQualification: d120Frozen.topology,
		d120LiveQualification: d120Frozen.live,
		d124Describe: d124Frozen.describe,
		d124ObserveEvents: d124Frozen.observeEvents,
		d124RunSummary: d124Frozen.runSummary,
		d124TopologyQualification: d124Frozen.topologyQualification,
		d124LiveQualification: d124Frozen.liveQualification,
		d124Mermaid: d124Frozen.mermaid,
	});
}

export async function writeRootEvalGeneratedArtifacts(): Promise<void> {
	const bytes = await buildRootEvalGeneratedArtifactBytes();
	await mkdir(ROOT_EVAL_ARTIFACT_DIRECTORY, { recursive: true });
	const publicationKeys = [
		"describe",
		"mermaid",
		"observeEvents",
		"runSummary",
		"qualification",
		"liveQualification",
		"d120TopologyQualification",
		"d120LiveQualification",
		"d124Describe",
		"d124ObserveEvents",
		"d124RunSummary",
		"d124TopologyQualification",
		"d124LiveQualification",
		"d124Mermaid",
	] as const;
	const temporaryPaths = new Map<keyof typeof bytes, string>();
	try {
		for (const key of [...publicationKeys, "artifactSet"] as const) {
			await mkdir(dirname(ROOT_EVAL_GENERATED_ARTIFACT_PATHS[key]), { recursive: true });
			const temporaryPath = `${ROOT_EVAL_GENERATED_ARTIFACT_PATHS[key]}.${randomUUID()}.tmp`;
			temporaryPaths.set(key, temporaryPath);
			await writeFile(temporaryPath, bytes[key], "utf8");
		}
		for (const key of publicationKeys)
			await rename(temporaryPaths.get(key)!, ROOT_EVAL_GENERATED_ARTIFACT_PATHS[key]);
		await rename(
			temporaryPaths.get("artifactSet")!,
			ROOT_EVAL_GENERATED_ARTIFACT_PATHS.artifactSet,
		);
	} finally {
		await Promise.all(
			[...temporaryPaths.values()].map((temporaryPath) => rm(temporaryPath, { force: true })),
		);
	}
}

export async function checkRootEvalGeneratedArtifacts(): Promise<void> {
	const expected = await buildRootEvalGeneratedArtifactBytes();
	const markerBefore = await readFile(ROOT_EVAL_GENERATED_ARTIFACT_PATHS.artifactSet, "utf8");
	for (const key of Object.keys(ROOT_EVAL_GENERATED_ARTIFACT_PATHS) as (keyof typeof expected)[]) {
		const actual = await readFile(ROOT_EVAL_GENERATED_ARTIFACT_PATHS[key], "utf8");
		if (actual !== expected[key]) {
			throw new Error(
				`root eval generated artifact drift: ${ROOT_EVAL_GENERATED_ARTIFACT_PATHS[key]}`,
			);
		}
	}
	const markerAfter = await readFile(ROOT_EVAL_GENERATED_ARTIFACT_PATHS.artifactSet, "utf8");
	if (markerAfter !== markerBefore)
		throw new Error("root eval artifact set changed while it was being checked");
}

async function main(): Promise<void> {
	const mode = process.argv[2] ?? "--write";
	if (mode === "--write") return writeRootEvalGeneratedArtifacts();
	if (mode === "--check") return checkRootEvalGeneratedArtifacts();
	throw new Error(`unknown root eval artifact mode: ${mode}`);
}

const entryPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entryPath === fileURLToPath(import.meta.url)) {
	await main();
}
