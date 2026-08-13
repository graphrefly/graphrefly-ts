import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	oneOf,
	record,
	strictSnapshot,
} from "./canonical.js";
import { validateD766LiveBundle } from "./d766-graph-native-live.js";
import type { D722CanonicalGraphEvidenceV1 } from "./d767-graph-completion-memory-insight.js";
import { deriveD722CanonicalGraphEvidence } from "./d767-graph-completion-memory-insight.js";
import {
	createD761GraphPublicSemanticValidationPolicy,
	type D720ToolRef,
} from "./d767-graph-native-effect-runtime.js";
import {
	createD720SimulatedCallerExecutor,
	runD722GraphNativeEvalCore,
} from "./d767-graph-native-eval.js";
import {
	D767_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD767Implementation,
} from "./d767-implementation-manifest.js";

export const D767_DECISION_REF = "decision.D767" as const;
export const D767_DECISION_REVISION = "2026-08-13.v1" as const;
export const D767_QUALIFICATION_SCHEMA =
	"graphrefly.b112.d767.retry-exhaustion-qualification.v1" as const;
export const D767_GENERATION_SCHEMA =
	"graphrefly.b112.d767.retry-exhaustion-generation.v1" as const;
export const D767_BUNDLE_SCHEMA = "graphrefly.b112.d767.retry-exhaustion-bundle.v1" as const;
export const D767_PERSISTENCE_SCHEMA =
	"graphrefly.b112.d767.retry-exhaustion-persistence.v1" as const;
export const D767_GENERATION_REF = "d767-retry-exhaustion-no-network-v1" as const;
export const D767_TEST_GENERATION_REF = "d767-retry-exhaustion-injected-test-v1" as const;
export const D767_D766_ARTIFACT_SHA256 =
	"sha256:45b8eb333813c0d0966d22a1d4c74c468089e82e3c7185f0cc45e42b76def1ed" as const;
export const D767_D766_BUNDLE_DIGEST =
	"sha256:67f9d120df75a1462373ac72797ce139e73d8f51e7c6a020d9121f95fcaac935" as const;

const LIMITS = Object.freeze({
	maxRequests: 128,
	maxRetryWaits: 12,
	maxCostMicrousd: 6_000_000,
	maxElapsedMs: 7_200_000,
});
const CEILINGS = Object.freeze({
	routeDigest: empiricalStrictJsonDigest({ route: "d767-injected-no-network" }),
	providerMaxCostMicrousd: 10,
	providerMaxElapsedMs: 1_000,
	localEffectMaxElapsedMs: 1_000,
});
const EXHAUSTION_BY_RUN = Object.freeze({
	0: "d710-untyped-http-429",
	2: "d675-und-err-socket",
	5: "d671-provider-overloaded",
} as const);

export interface D767QualificationBundleV1 {
	readonly schemaVersion: typeof D767_BUNDLE_SCHEMA;
	readonly executionClass: "simulated-contract";
	readonly graphEvidence: D722CanonicalGraphEvidenceV1;
	readonly qualification: Readonly<Record<string, unknown>>;
	readonly generation: Readonly<Record<string, unknown>>;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly bundleDigest: string;
}

export interface D767BaselineV1 {
	readonly revision: "graphrefly.b112.d767.consumed-d766-baseline.v1";
}

const baselines = new WeakMap<object, "d766-exact-artifact" | "injected-test">();
const bundles = new WeakSet<object>();
const persistenceFaults = new WeakMap<object, "after-bundle-write">();

export function admitD767ConsumedD766Baseline(bytesValue: Uint8Array): D767BaselineV1 {
	if (
		!(bytesValue instanceof Uint8Array) ||
		bytesValue.byteLength < 1 ||
		bytesValue.byteLength > 1_048_576
	)
		throw new TypeError("D767 D766 artifact bytes are invalid");
	const bytes = new Uint8Array(bytesValue);
	literal(empiricalSha256(bytes), D767_D766_ARTIFACT_SHA256, "d767.baseline.sha256");
	const baseline = validateD766LiveBundle(strictJsonCodec.decode(bytes));
	literal(baseline.bundleDigest, D767_D766_BUNDLE_DIGEST, "d767.baseline.bundleDigest");
	const capability = Object.freeze({
		revision: "graphrefly.b112.d767.consumed-d766-baseline.v1" as const,
	});
	baselines.set(capability, "d766-exact-artifact");
	return capability;
}

export function createD767InjectedBaselineForTest(): D767BaselineV1 {
	const capability = Object.freeze({
		revision: "graphrefly.b112.d767.consumed-d766-baseline.v1" as const,
	});
	baselines.set(capability, "injected-test");
	return capability;
}

export function createD767PersistenceFaultForTest(stageValue: string): object {
	if (stageValue !== "after-bundle-write")
		throw new TypeError("D767 persistence fault stage is invalid");
	const capability = Object.freeze({ revision: "graphrefly.b112.d767.persistence-fault.v1" });
	persistenceFaults.set(capability, stageValue);
	return capability;
}

function toolForPhase(phase: string): D720ToolRef {
	if (phase === "inspection") return "read-file";
	if (phase === "exact-mutation") return "replace-exact";
	if (phase === "workspace-diff") return "workspace-diff";
	if (phase === "focused-validation") return "focused-validation";
	throw new TypeError("D767 fixture received a non-tool phase");
}

function admitted(run: D722CanonicalGraphEvidenceV1["effectRuns"][number]) {
	return run.facts.filter((fact) => fact.kind === "graph-effect-result-admitted");
}

function validateMechanism(graph: D722CanonicalGraphEvidenceV1) {
	const arms = [
		"cold",
		"relevant-applied",
		"proposal-only",
		"admission-rejected",
		"irrelevant-applied",
		"wrong-scope-applied",
	] as const;
	if (
		graph.runStatus !== "complete" ||
		graph.effectRuns.length !== 6 ||
		graph.ledger.completedArms.join(",") !== arms.join(",") ||
		graph.ledger.maxActiveArms !== 1
	)
		throw new TypeError(
			`D767 six-arm serial horizon drifted: ${JSON.stringify({ runStatus: graph.runStatus, runs: graph.effectRuns.length, completedArms: graph.ledger.completedArms, maxActiveArms: graph.ledger.maxActiveArms, decisions: graph.ledger.decisions.map((x) => ({ arm: x.arm, stoppedReason: x.stoppedReason, disposition: x.disposition })) })}`,
		);
	const expectedExhausted = new Map(
		Object.entries(EXHAUSTION_BY_RUN).map(([run, reason]) => [Number(run), reason] as const),
	);
	let providerRequests = 0;
	let retryWaits = 0;
	let exhausted = 0;
	for (const [runIndex, run] of graph.effectRuns.entries()) {
		const facts = admitted(run);
		providerRequests += facts.filter(
			(fact) => fact.result.effectKind === "provider-request",
		).length;
		retryWaits += facts.filter((fact) => fact.result.effectKind === "retry-wait").length;
		const decision = graph.ledger.decisions[runIndex];
		if (decision === undefined) throw new TypeError("D767 decision coverage drifted");
		const cleanup = facts.at(-1);
		if (cleanup?.result.effectKind !== "cleanup" || cleanup.result.status !== "succeeded")
			throw new TypeError("D767 cleanup coverage drifted");
		const expectedReason = expectedExhausted.get(runIndex);
		if (expectedReason !== undefined) {
			exhausted += 1;
			if (
				decision.stoppedReason !== "provider-retry-exhausted" ||
				decision.disposition !== "admit-next" ||
				decision.evaluable !== false
			)
				throw new TypeError("D767 exhausted run disposition drifted");
			const providers = facts.flatMap((fact) =>
				fact.result.effectKind === "provider-request" && fact.result.status === "retryable-failure"
					? [
							fact as typeof fact & {
								readonly result: Extract<
									typeof fact.result,
									{ readonly effectKind: "provider-request" }
								>;
							},
						]
					: [],
			);
			const waits = facts.filter((fact) => fact.result.effectKind === "retry-wait");
			const expectedAttempts = expectedReason.startsWith("d671-") ? 3 : 2;
			if (providers.length !== expectedAttempts || waits.length !== expectedAttempts - 1)
				throw new TypeError("D767 exact retry cardinality drifted");
			const [first] = providers;
			if (
				first === undefined ||
				providers.some(
					(provider, index) =>
						provider.request.logicalRequestDigest !== first.request.logicalRequestDigest ||
						provider.request.issuedRequestDigest !== first.request.issuedRequestDigest ||
						provider.request.attemptOrdinal !== index + 1 ||
						provider.result.failureDiscriminator !== expectedReason,
				)
			)
				throw new TypeError("D767 retry identity drifted");
		} else if (decision.stoppedReason !== null || decision.fullTaskCompleted !== true) {
			throw new TypeError("D767 non-exhausted arm did not complete");
		}
	}
	if (exhausted !== 3 || retryWaits !== 4)
		throw new TypeError("D767 exhausted-run coverage drifted");
	if (
		graph.ledger.effectProposals.filter((proposal) => proposal.effectKind === "provider-request")
			.length !== providerRequests
	)
		throw new TypeError("D767 provider admission coverage drifted");
	if (
		graph.ledger.effectReconciliations.length !==
		graph.ledger.effectAdmissions.filter((x) => x.admitted).length
	)
		throw new TypeError("D767 reconciliation coverage drifted");
	return Object.freeze({ providerRequests, retryWaits, exhaustedRuns: exhausted });
}

export async function runD767InjectedNoNetworkQualification(
	baselineValue: D767BaselineV1,
): Promise<D767QualificationBundleV1> {
	if (typeof baselineValue !== "object" || baselineValue === null)
		throw new TypeError("D767 requires a fresh exact D766 baseline capability");
	const baselineBasis = baselines.get(baselineValue);
	if (baselineBasis === undefined)
		throw new TypeError("D767 requires a fresh exact D766 baseline capability");
	baselines.delete(baselineValue);
	if ((await measureD767Implementation()) !== D767_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D767 implementation manifest validation failed");
	const workspaces = new Map<number, string>();
	const networkCalls = 0;
	let active = 0;
	let maxActive = 0;
	const executor = createD720SimulatedCallerExecutor(async ({ effectRequest }) => {
		active += 1;
		maxActive = Math.max(maxActive, active);
		if (active !== 1) throw new TypeError("D767 observed parallel effects");
		try {
			if (effectRequest.effectKind === "materialization") {
				const workspace = empiricalStrictJsonDigest({
					d767: "workspace",
					run: effectRequest.runSequence,
				});
				workspaces.set(effectRequest.runSequence, workspace);
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "materialization" as const,
						status: "ready" as const,
						workspaceStateDigest: workspace,
						evidenceDigest: empiricalStrictJsonDigest({ d767: "materialized", effectRequest }),
					},
				};
			}
			const workspace = workspaces.get(effectRequest.runSequence);
			if (effectRequest.effectKind === "provider-request") {
				if (workspace === undefined) throw new TypeError("D767 provider workspace is missing");
				const failureDiscriminator =
					EXHAUSTION_BY_RUN[effectRequest.runSequence as keyof typeof EXHAUSTION_BY_RUN];
				if (
					failureDiscriminator !== undefined &&
					effectRequest.completionContext?.nextRequiredPhase === "workspace-diff"
				)
					return {
						actualCostMicrousd: 0,
						actualElapsedMs: 1,
						result: {
							effectKind: "provider-request" as const,
							status: "retryable-failure" as const,
							toolIntents: Object.freeze([]),
							failureDiscriminator,
							retryAfterMs: null,
							workspaceStateDigest: workspace,
							evidenceDigest: empiricalStrictJsonDigest({
								d767: "429",
								request: effectRequest.requestDigest,
							}),
						},
					};
				if (effectRequest.completionContext?.nextRequiredPhase === "hidden-verifier")
					return {
						actualCostMicrousd: 1,
						actualElapsedMs: 1,
						result: {
							effectKind: "provider-request" as const,
							status: "structured-final" as const,
							toolIntents: Object.freeze([]),
							failureDiscriminator: "none" as const,
							retryAfterMs: null,
							workspaceStateDigest: workspace,
							evidenceDigest: empiricalStrictJsonDigest({
								d767: "final",
								request: effectRequest.requestDigest,
							}),
						},
					};
				const toolRef = toolForPhase(
					effectRequest.completionContext?.nextRequiredPhase ?? "inspection",
				);
				return {
					actualCostMicrousd: 1,
					actualElapsedMs: 1,
					result: {
						effectKind: "provider-request" as const,
						status: "tool-intents" as const,
						toolIntents: Object.freeze([
							Object.freeze({
								toolRef,
								intentDigest: empiricalStrictJsonDigest({
									d767: "intent",
									request: effectRequest.requestDigest,
								}),
							}),
						]),
						failureDiscriminator: "none" as const,
						retryAfterMs: null,
						workspaceStateDigest: workspace,
						evidenceDigest: empiricalStrictJsonDigest({
							d767: "tools",
							request: effectRequest.requestDigest,
						}),
					},
				};
			}
			if (effectRequest.effectKind === "retry-wait") {
				const actualElapsedMs =
					effectRequest.retryReason === "d710-untyped-http-429"
						? 60_000
						: effectRequest.retryReason.startsWith("d671-")
							? effectRequest.attemptOrdinal === 2
								? 5_000
								: 10_000
							: 1;
				return {
					actualCostMicrousd: 0,
					actualElapsedMs,
					result: {
						effectKind: "retry-wait" as const,
						status: "completed" as const,
						evidenceDigest: empiricalStrictJsonDigest({ d767: "wait", effectRequest }),
					},
				};
			}
			if (effectRequest.effectKind === "tool-action") {
				if (workspace === undefined || effectRequest.toolIntent === null)
					throw new TypeError("D767 tool workspace is missing");
				const after =
					effectRequest.toolIntent.toolRef === "replace-exact"
						? empiricalStrictJsonDigest({
								workspace,
								mutation: effectRequest.toolIntent.intentDigest,
							})
						: workspace;
				workspaces.set(effectRequest.runSequence, after);
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "tool-action" as const,
						toolRef: effectRequest.toolIntent.toolRef,
						intentDigest: effectRequest.toolIntent.intentDigest,
						status: "succeeded" as const,
						nonEmptyDiff: effectRequest.toolIntent.toolRef === "workspace-diff",
						workspaceStateBeforeDigest: workspace,
						workspaceStateAfterDigest: after,
						evidenceDigest: empiricalStrictJsonDigest({ d767: "tool", effectRequest }),
					},
				};
			}
			if (effectRequest.effectKind === "public-semantic-validation") {
				if (workspace === undefined) throw new TypeError("D767 semantic workspace is missing");
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "public-semantic-validation" as const,
						status: "passed" as const,
						criterionFailures: Object.freeze([]),
						workspaceStateDigest: workspace,
						evidenceDigest: empiricalStrictJsonDigest({ d767: "semantic", effectRequest }),
					},
				};
			}
			if (effectRequest.effectKind === "hidden-verifier") {
				if (workspace === undefined) throw new TypeError("D767 verifier workspace is missing");
				return {
					actualCostMicrousd: 0,
					actualElapsedMs: 1,
					result: {
						effectKind: "hidden-verifier" as const,
						status: "passed" as const,
						workspaceStateDigest: workspace,
						evidenceDigest: empiricalStrictJsonDigest({ d767: "verifier", effectRequest }),
					},
				};
			}
			workspaces.delete(effectRequest.runSequence);
			return {
				actualCostMicrousd: 0,
				actualElapsedMs: 1,
				result: {
					effectKind: "cleanup" as const,
					status: "succeeded" as const,
					evidenceDigest: empiricalStrictJsonDigest({ d767: "cleanup", effectRequest }),
				},
			};
		} finally {
			active -= 1;
		}
	});
	const policy = createD761GraphPublicSemanticValidationPolicy();
	const core = await runD722GraphNativeEvalCore({
		sourceDigest: empiricalStrictJsonDigest({ decisionRef: D767_DECISION_REF }),
		budgetLimits: LIMITS,
		effectCeilings: CEILINGS,
		executor,
		objectivePhaseRecoveryPolicy: policy,
		signal: AbortSignal.timeout(30_000),
	});
	const graphEvidence = deriveD722CanonicalGraphEvidence(
		core.ledger,
		core.effectRuns,
		undefined,
		policy,
	);
	const counts = validateMechanism(graphEvidence);
	if (networkCalls !== 0 || maxActive !== 1 || workspaces.size !== 0)
		throw new TypeError("D767 operational qualification drifted");
	const qualificationMaterial = strictSnapshot({
		decisionRef: D767_DECISION_REF,
		decisionRevision: D767_DECISION_REVISION,
		baselineArtifactSha256: D767_D766_ARTIFACT_SHA256,
		baselineBundleDigest: D767_D766_BUNDLE_DIGEST,
		baselineBasis,
		implementationManifestDigest: D767_IMPLEMENTATION_MANIFEST_DIGEST,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		providerRequestCount: counts.providerRequests,
		retryWaitCount: counts.retryWaits,
		exhaustedRunCount: counts.exhaustedRuns,
		maxActiveEffects: maxActive,
		networkCalls,
		workspaceResidueCount: workspaces.size,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = Object.freeze({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const generationMaterial = strictSnapshot({
		schemaVersion: D767_GENERATION_SCHEMA,
		generationRef:
			baselineBasis === "d766-exact-artifact" ? D767_GENERATION_REF : D767_TEST_GENERATION_REF,
		qualificationDigest: qualification.qualificationDigest,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		executionClass: "simulated-contract" as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const generation = Object.freeze({
		...generationMaterial,
		generationDigest: empiricalStrictJsonDigest(generationMaterial),
	});
	const material = strictSnapshot({
		schemaVersion: D767_BUNDLE_SCHEMA,
		executionClass: "simulated-contract" as const,
		graphEvidence,
		qualification,
		generation,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const bundle = Object.freeze({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
	bundles.add(bundle);
	return bundle;
}

export function validateD767QualificationBundle(value: unknown): D767QualificationBundleV1 {
	const candidate = record(value, "d767.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"causalAttribution",
			"efficacyClaim",
			"executionClass",
			"generation",
			"graphEvidence",
			"qualification",
			"schemaVersion",
		],
		"d767.bundle",
	);
	literal(candidate.schemaVersion, D767_BUNDLE_SCHEMA, "d767.bundle.schema");
	literal(candidate.executionClass, "simulated-contract", "d767.bundle.executionClass");
	literal(candidate.causalAttribution, "undetermined", "d767.bundle.causalAttribution");
	literal(candidate.efficacyClaim, "none", "d767.bundle.efficacyClaim");
	const graph = candidate.graphEvidence as D722CanonicalGraphEvidenceV1;
	validateMechanism(graph);
	const qualification = record(candidate.qualification, "d767.qualification");
	oneOf(
		qualification.baselineBasis,
		["d766-exact-artifact", "injected-test"],
		"d767.qualification.baselineBasis",
	);
	literal(qualification.decisionRef, D767_DECISION_REF, "d767.qualification.decisionRef");
	literal(
		qualification.baselineArtifactSha256,
		D767_D766_ARTIFACT_SHA256,
		"d767.qualification.baselineSha",
	);
	literal(
		qualification.baselineBundleDigest,
		D767_D766_BUNDLE_DIGEST,
		"d767.qualification.baselineBundle",
	);
	literal(
		qualification.implementationManifestDigest,
		D767_IMPLEMENTATION_MANIFEST_DIGEST,
		"d767.qualification.implementationManifest",
	);
	const replayed = deriveD722CanonicalGraphEvidence(
		graph.ledger,
		graph.effectRuns,
		undefined,
		createD761GraphPublicSemanticValidationPolicy(),
	);
	if (empiricalStrictJsonDigest(replayed) !== empiricalStrictJsonDigest(graph))
		throw new TypeError("D767 Graph evidence is not an exact canonical replay");
	literal(
		qualification.graphEvidenceDigest,
		graph.evidenceDigest,
		"d767.qualification.graphEvidence",
	);
	const material = strictSnapshot({
		schemaVersion: candidate.schemaVersion,
		executionClass: candidate.executionClass,
		graphEvidence: candidate.graphEvidence,
		qualification: candidate.qualification,
		generation: candidate.generation,
		causalAttribution: candidate.causalAttribution,
		efficacyClaim: candidate.efficacyClaim,
	});
	literal(
		digest(candidate.bundleDigest, "d767.bundle.bundleDigest"),
		empiricalStrictJsonDigest(material),
		"d767.bundle.bundleDigest",
	);
	return strictSnapshot({
		...material,
		bundleDigest: candidate.bundleDigest,
	}) as D767QualificationBundleV1;
}

export async function persistD767QualificationBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundle: D767QualificationBundleV1;
	readonly fault?: object;
}) {
	const input = record(inputValue, "d767.persist");
	exactKeys(
		input,
		Object.hasOwn(input, "fault") ? ["bundle", "fault", "privateRoot"] : ["bundle", "privateRoot"],
		"d767.persist",
	);
	const bundle = input.bundle as D767QualificationBundleV1;
	if (!bundles.delete(bundle))
		throw new TypeError("D767 persistence requires a fresh constructed bundle");
	validateD767QualificationBundle(bundle);
	const qualification = record(bundle.qualification, "d767.persist.qualification");
	const generationRef =
		qualification.baselineBasis === "d766-exact-artifact"
			? D767_GENERATION_REF
			: qualification.baselineBasis === "injected-test"
				? D767_TEST_GENERATION_REF
				: (() => {
						throw new TypeError("D767 persistence baseline basis is invalid");
					})();
	let faultStage: "after-bundle-write" | undefined;
	if (Object.hasOwn(input, "fault")) {
		if (typeof input.fault !== "object" || input.fault === null)
			throw new TypeError("D767 persistence fault is invalid");
		faultStage = persistenceFaults.get(input.fault);
		if (faultStage === undefined)
			throw new TypeError("D767 persistence fault is invalid or consumed");
		persistenceFaults.delete(input.fault);
	}
	const privateRoot = resolve(input.privateRoot as string);
	if ((await realpath(privateRoot)) !== privateRoot)
		throw new TypeError("D767 private root is not canonical");
	const rootStat = await lstat(privateRoot);
	if (!rootStat.isDirectory() || (rootStat.mode & 0o777) !== 0o700)
		throw new TypeError("D767 private root must be a 0700 directory");
	const finalRoot = join(privateRoot, generationRef);
	const tombstone = join(privateRoot, `.trash-${generationRef}-${randomUUID()}`);
	let identity: { readonly dev: number; readonly ino: number } | null = null;
	let committed = false;
	try {
		await mkdir(finalRoot, { mode: 0o700 });
		const claimed = await lstat(finalRoot);
		if (!claimed.isDirectory() || (claimed.mode & 0o777) !== 0o700 || claimed.nlink < 1)
			throw new TypeError("D767 generation claim identity drifted");
		identity = { dev: claimed.dev, ino: claimed.ino };
		const bytes = strictJsonCodec.encode(bundle);
		await writeFile(join(finalRoot, "bundle.v1.json"), bytes, { mode: 0o600, flag: "wx" });
		const file = await open(
			join(finalRoot, "bundle.v1.json"),
			constants.O_RDONLY | constants.O_NOFOLLOW,
		);
		try {
			await file.sync();
			const stat = await file.stat();
			if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600)
				throw new TypeError("D767 artifact identity drifted");
			if (empiricalSha256(await file.readFile()) !== empiricalSha256(bytes))
				throw new TypeError("D767 artifact bytes drifted");
		} finally {
			await file.close();
		}
		if (faultStage === "after-bundle-write")
			throw new TypeError("D767 injected after-bundle-write failure");
		await writeFile(
			join(finalRoot, "commit.v1.json"),
			strictJsonCodec.encode({ bundleDigest: bundle.bundleDigest, generationRef }),
			{ mode: 0o600, flag: "wx" },
		);
		const finalHandle = await open(
			finalRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			await finalHandle.sync();
		} finally {
			await finalHandle.close();
		}
		const parent = await open(
			privateRoot,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
		try {
			await parent.sync();
		} finally {
			await parent.close();
		}
		const rebound = await lstat(finalRoot);
		if (rebound.dev !== identity.dev || rebound.ino !== identity.ino || !rebound.isDirectory())
			throw new TypeError("D767 final generation identity drifted");
		const finalBytes = await readFile(join(finalRoot, "bundle.v1.json"));
		if (empiricalSha256(finalBytes) !== empiricalSha256(bytes))
			throw new TypeError("D767 final artifact bytes drifted");
		committed = true;
		const receiptMaterial = strictSnapshot({
			schemaVersion: D767_PERSISTENCE_SCHEMA,
			generationRef,
			bundleDigest: bundle.bundleDigest,
			artifactSha256: empiricalSha256(finalBytes),
		});
		return Object.freeze({
			...receiptMaterial,
			persistenceDigest: empiricalStrictJsonDigest(receiptMaterial),
		});
	} catch (error) {
		if (!committed && identity !== null) {
			try {
				await rename(finalRoot, tombstone);
				const moved = await lstat(tombstone);
				if (moved.dev !== identity.dev || moved.ino !== identity.ino)
					throw new TypeError("D767 cleanup ownership drifted");
				await rm(tombstone, { recursive: true, force: false });
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], "D767 persistence and cleanup failed");
			}
		}
		throw error;
	}
}
