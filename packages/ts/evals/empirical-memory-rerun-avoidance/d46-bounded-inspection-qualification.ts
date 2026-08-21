import { constants } from "node:fs";
import { chmod, link, mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	strictSnapshot,
} from "./canonical.js";
import { D43_ARMS } from "./d43-model-harness-policy.js";
import {
	createD44LiveExecutor,
	D44_BUGGY_ADMISSION_BLOCK,
	D44_D45_BASELINE_COMMIT,
	D44_FIXED_ADMISSION_BLOCK,
	type D44LiveExecutorV1,
} from "./d44-d45-live-composition.js";
import {
	D45_READABLE_PATHS,
	D45_TASK_MATERIAL,
	D45_WRITABLE_PATH,
} from "./d45-graph-tool-qualification.js";
import {
	D46_CONTEXT_LINES,
	D46_MAX_PROJECTED_BYTES,
	D46_MAX_SOURCE_BYTES,
	D46_MAX_WINDOWS,
	type D46CanonicalEvidenceV1,
	type D46PartialCanonicalEvidenceV1,
	lowerD46ProviderEffect,
	projectD46BoundedInspection,
	readD46ToolArguments,
	validateD46CanonicalEvidence,
	validateD46PartialCanonicalEvidence,
} from "./d46-bounded-inspection-authority.js";
import {
	D46_COMPOSITION_REVISION,
	runD46BoundedInspectionMeasurement,
} from "./d46-bounded-inspection-composition.js";

export const D46_QUALIFICATION_SCHEMA =
	"graphrefly-ts.d46.bounded-inspection-qualification.v2" as const;
export const D46_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d46.bounded-inspection-qualification-bundle.v2" as const;
export const D46_QUALIFICATION_GENERATION_REF =
	"current-graph-native-bounded-inspection-2026-08-21-d46-v2" as const;

export interface D46QualificationBundleV1 {
	readonly schemaVersion: typeof D46_QUALIFICATION_BUNDLE_SCHEMA;
	readonly evidence: D46CanonicalEvidenceV1;
	readonly partialEvidence: D46PartialCanonicalEvidenceV1;
	readonly qualification: Readonly<{
		readonly schemaVersion: typeof D46_QUALIFICATION_SCHEMA;
		readonly decisionRef: "graphrefly-ts:D46";
		readonly compositionRevision: typeof D46_COMPOSITION_REVISION;
		readonly evidenceDigest: string;
		readonly partialEvidenceDigest: string;
		readonly exactSixArmsCompleted: true;
		readonly evaluableArms: 6;
		readonly boundedReadFacts: 24;
		readonly targetSpanProjectedForEveryArm: true;
		readonly sourceBound: typeof D46_MAX_SOURCE_BYTES;
		readonly projectionBound: typeof D46_MAX_PROJECTED_BYTES;
		readonly windowBound: typeof D46_MAX_WINDOWS;
		readonly contextLines: typeof D46_CONTEXT_LINES;
		readonly providerCalls: 13;
		readonly exactD710RetryIdentity: true;
		readonly providerNetworkCalls: 0;
		readonly credentialReads: 0;
		readonly dispatchClaims: 0;
		readonly maxActiveEffects: 1;
		readonly rawMaterialPersisted: false;
		readonly canonicalReplayQualified: true;
		readonly atomicPersistenceQualified: true;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly qualificationDigest: string;
	}>;
	readonly bundleDigest: string;
}

export interface D46QualificationReceiptV1 {
	readonly generationRef: typeof D46_QUALIFICATION_GENERATION_REF;
	readonly bundleArtifactDigest: string;
	readonly commitArtifactDigest: string;
	readonly receiptDigest: string;
}

export interface D46PartialPersistenceReceiptV1 {
	readonly generationRef: "current-graph-native-bounded-inspection-partial-2026-08-21-d46-v2";
	readonly evidenceArtifactDigest: string;
	readonly commitArtifactDigest: string;
	readonly receiptDigest: string;
}

function deriveD46QualificationClaims(evidence: D46CanonicalEvidenceV1) {
	const providerResults = evidence.d45Evidence.facts.filter(
		(fact) => fact.factKind === "provider-result",
	);
	const retryResults = providerResults.filter((fact) => fact.result.retryClass === "D710");
	let exactD710RetryIdentity = false;
	if (retryResults.length === 1) {
		const retryResult = retryResults[0]!;
		const original = evidence.d45Evidence.facts.find(
			(fact) =>
				fact.factKind === "effect-admitted" &&
				fact.effect.effectDigest === retryResult.effectDigest,
		);
		if (original?.factKind === "effect-admitted") {
			const retry = evidence.d45Evidence.facts.find(
				(fact) =>
					fact.factKind === "effect-admitted" &&
					fact.sequence > original.sequence &&
					fact.effect.effectKind === "provider-proposal" &&
					fact.effect.logicalRequestDigest === original.effect.logicalRequestDigest,
			);
			const originalWire = evidence.d45Evidence.facts.find(
				(fact) =>
					fact.factKind === "provider-wire-admitted" &&
					fact.effectDigest === original.effect.effectDigest,
			);
			const retryWire =
				retry?.factKind === "effect-admitted"
					? evidence.d45Evidence.facts.find(
							(fact) =>
								fact.factKind === "provider-wire-admitted" &&
								fact.effectDigest === retry.effect.effectDigest,
						)
					: undefined;
			exactD710RetryIdentity =
				retry?.factKind === "effect-admitted" &&
				originalWire?.factKind === "provider-wire-admitted" &&
				retryWire?.factKind === "provider-wire-admitted" &&
				originalWire.wireDigest === retryWire.wireDigest;
		}
	}
	return Object.freeze({
		exactSixArmsCompleted: evidence.exactSixArmsCompleted,
		evaluableArms: evidence.d45Evidence.lifecycle.arms.filter((arm) => arm.evaluable).length,
		boundedReadFacts: evidence.sliceFacts.length,
		providerCalls: providerResults.length,
		exactD710RetryIdentity,
	});
}

function injectedProviderResponse(body: RequestInit["body"], retryable429 = false): Response {
	if (typeof body !== "string") throw new TypeError("D46 qualification expected strict JSON wire");
	if (retryable429)
		return new Response(JSON.stringify({ error: { message: "bounded qualification retry" } }), {
			status: 429,
			headers: { "content-type": "application/json" },
		});
	const request = JSON.parse(body) as {
		readonly tool_choice: Readonly<{ readonly function: Readonly<{ readonly name: string }> }>;
	};
	const name = request.tool_choice.function.name;
	const calls =
		name === "read_file"
			? D45_READABLE_PATHS.map((path) => ({
					function: { name: "read_file", arguments: JSON.stringify({ path }) },
				}))
			: [
					{
						function: {
							name: "replace_exact",
							arguments: JSON.stringify({
								path: D45_WRITABLE_PATH,
								oldText: D44_BUGGY_ADMISSION_BLOCK,
								newText: D44_FIXED_ADMISSION_BLOCK,
							}),
						},
					},
				];
	return new Response(
		JSON.stringify({
			choices: [{ finish_reason: "tool_calls", message: { role: "assistant", tool_calls: calls } }],
			usage: {
				prompt_tokens: 1_000,
				completion_tokens: 100,
				prompt_tokens_details: { cached_tokens: 0 },
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

export async function runD46InjectedNoNetworkQualification(input?: {
	readonly repositoryRoot?: string;
}): Promise<D46QualificationBundleV1> {
	const repositoryRoot = resolve(input?.repositoryRoot ?? join(import.meta.dirname, "../../../.."));
	const fixedSource = await readFile(resolve(repositoryRoot, D45_WRITABLE_PATH), "utf8");
	const buggySource = fixedSource.replace(D44_FIXED_ADMISSION_BLOCK, D44_BUGGY_ADMISSION_BLOCK);
	if (
		buggySource === fixedSource ||
		D43_ARMS.some((arm) => {
			const projection = projectD46BoundedInspection({
				path: D45_WRITABLE_PATH,
				content: buggySource,
				publicContext: `${D45_TASK_MATERIAL.systemInstruction}\n${D45_TASK_MATERIAL.taskStatement}\n${D45_TASK_MATERIAL.armContexts[arm]}`,
			});
			return !projection.content.includes(D44_BUGGY_ADMISSION_BLOCK);
		})
	)
		throw new TypeError("D46 selector omitted the frozen target span");
	const materializationRoot = await mkdtemp(join(tmpdir(), "graphrefly-d46-qualification-"));
	let providerCalls = 0;
	const executor = createD44LiveExecutor({
		repositoryRoot,
		materializationRoot,
		baselineCommit: D44_D45_BASELINE_COMMIT,
		bearerToken: "injected-no-network",
		authorityAccess: {
			lowerProviderEffect: (authority, effect) =>
				lowerD46ProviderEffect(authority as never, effect),
			readToolArguments: (authority, effect) => readD46ToolArguments(authority as never, effect),
		},
		fetchImpl: async (_url, init) => {
			providerCalls += 1;
			return injectedProviderResponse(init?.body, providerCalls === 1);
		},
	});
	const measurement = await runD46BoundedInspectionMeasurement({
		executor,
		injectedNoNetwork: true,
	});
	if (measurement.disposition !== "success")
		throw new TypeError("D46 injected composition did not complete");
	const evidence = validateD46CanonicalEvidence(measurement.evidence);
	const derived = deriveD46QualificationClaims(evidence);
	if (
		!evidence.exactSixArmsCompleted ||
		evidence.d45Evidence.lifecycle.arms.length !== 6 ||
		evidence.d45Evidence.lifecycle.arms.some((arm) => !arm.evaluable) ||
		derived.boundedReadFacts !== 24 ||
		evidence.sliceFacts.some(
			(fact) =>
				fact.projectedBytes > D46_MAX_PROJECTED_BYTES || fact.windows.length > D46_MAX_WINDOWS,
		) ||
		!derived.exactD710RetryIdentity ||
		derived.providerCalls !== 13 ||
		providerCalls !== derived.providerCalls ||
		measurement.providerCalls !== providerCalls
	)
		throw new TypeError("D46 injected six-arm invariants failed");
	const serializedEvidence = JSON.stringify(evidence);
	if (
		serializedEvidence.includes(D44_BUGGY_ADMISSION_BLOCK) ||
		serializedEvidence.includes(D44_FIXED_ADMISSION_BLOCK)
	)
		throw new TypeError("D46 durable evidence leaked raw mutation material");
	let partialDisposed = false;
	const partialExecutor: D44LiveExecutorV1 = {
		revision: "graphrefly-ts.d44.d45-live-composition.v1",
		async execute(_authority, effect) {
			if (effect.sourceD43EffectKind !== "materialization")
				throw new TypeError("injected provider interruption");
			const workspaceStateDigest = empiricalStrictJsonDigest({ arm: effect.arm, partial: true });
			return {
				result: {
					effectKind: "local-effect",
					outcome: "success",
					elapsedMs: 1,
					evidenceDigest: empiricalStrictJsonDigest({ effect: effect.effectDigest }),
					workspaceStateDigest,
					criteria: null,
				},
				retryDelayMs: 0,
			};
		},
		async dispose() {
			partialDisposed = true;
		},
	};
	const partialMeasurement = await runD46BoundedInspectionMeasurement({
		executor: partialExecutor,
		injectedNoNetwork: false,
	});
	if (partialMeasurement.disposition !== "partial-failure")
		throw new TypeError("D46 injected interruption omitted partial evidence");
	const partialEvidence = partialMeasurement.partialEvidence;
	if (!partialDisposed || partialEvidence.terminalCleanup.status !== "completed")
		throw new TypeError("D46 injected interruption omitted Graph-admitted cleanup");
	let failedCleanupAttempts = 0;
	const failedCleanupExecutor: D44LiveExecutorV1 = {
		...partialExecutor,
		async dispose() {
			failedCleanupAttempts += 1;
			throw new TypeError("injected dispose rejection containing private material");
		},
	};
	const failedCleanupMeasurement = await runD46BoundedInspectionMeasurement({
		executor: failedCleanupExecutor,
		injectedNoNetwork: false,
	});
	if (
		failedCleanupMeasurement.disposition !== "partial-failure" ||
		failedCleanupAttempts !== 1 ||
		failedCleanupMeasurement.partialEvidence.terminalCleanup.status !== "failed" ||
		failedCleanupMeasurement.partialEvidence.terminalCleanup.causeCode !== "dispose-rejected" ||
		JSON.stringify(failedCleanupMeasurement.partialEvidence).includes("private material")
	)
		throw new TypeError("D46 dispose rejection omitted sanitized Graph terminal fact");
	const partialRoot = await mkdtemp(join(tmpdir(), "graphrefly-d46-partial-persistence-"));
	try {
		const receipt = await persistD46PartialEvidence({
			directory: partialRoot,
			evidence: partialEvidence,
		});
		if (receipt.evidenceArtifactDigest !== receipt.commitArtifactDigest)
			throw new TypeError("D46 partial persistence receipt drifted");
	} finally {
		await rm(partialRoot, { recursive: true, force: true });
	}
	const qualificationMaterial = strictSnapshot({
		schemaVersion: D46_QUALIFICATION_SCHEMA,
		decisionRef: "graphrefly-ts:D46" as const,
		compositionRevision: D46_COMPOSITION_REVISION,
		evidenceDigest: evidence.evidenceDigest,
		partialEvidenceDigest: partialEvidence.evidenceDigest,
		exactSixArmsCompleted: true as const,
		evaluableArms: 6 as const,
		boundedReadFacts: 24 as const,
		targetSpanProjectedForEveryArm: true as const,
		sourceBound: D46_MAX_SOURCE_BYTES,
		projectionBound: D46_MAX_PROJECTED_BYTES,
		windowBound: D46_MAX_WINDOWS,
		contextLines: D46_CONTEXT_LINES,
		providerCalls: 13 as const,
		exactD710RetryIdentity: true as const,
		providerNetworkCalls: 0 as const,
		credentialReads: 0 as const,
		dispatchClaims: 0 as const,
		maxActiveEffects: 1 as const,
		rawMaterialPersisted: false as const,
		canonicalReplayQualified: true as const,
		atomicPersistenceQualified: true as const,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const qualification = Object.freeze({
		...qualificationMaterial,
		qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
	});
	const bundleMaterial = strictSnapshot({
		schemaVersion: D46_QUALIFICATION_BUNDLE_SCHEMA,
		evidence,
		partialEvidence,
		qualification,
	});
	return Object.freeze({
		...bundleMaterial,
		bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
	}) as D46QualificationBundleV1;
}

export function validateD46QualificationBundle(
	value: D46QualificationBundleV1,
): D46QualificationBundleV1 {
	exactKeys(
		record(value, "D46.qualificationBundle"),
		["schemaVersion", "evidence", "partialEvidence", "qualification", "bundleDigest"],
		"D46.qualificationBundle",
	);
	exactKeys(
		record(value.qualification, "D46.qualification"),
		[
			"schemaVersion",
			"decisionRef",
			"compositionRevision",
			"evidenceDigest",
			"partialEvidenceDigest",
			"exactSixArmsCompleted",
			"evaluableArms",
			"boundedReadFacts",
			"targetSpanProjectedForEveryArm",
			"sourceBound",
			"projectionBound",
			"windowBound",
			"contextLines",
			"providerCalls",
			"exactD710RetryIdentity",
			"providerNetworkCalls",
			"credentialReads",
			"dispatchClaims",
			"maxActiveEffects",
			"rawMaterialPersisted",
			"canonicalReplayQualified",
			"atomicPersistenceQualified",
			"causalAttribution",
			"efficacyClaim",
			"qualificationDigest",
		],
		"D46.qualification",
	);
	const evidence = validateD46CanonicalEvidence(value.evidence);
	const partialEvidence = validateD46PartialCanonicalEvidence(value.partialEvidence);
	const derived = deriveD46QualificationClaims(evidence);
	const { qualificationDigest: _qualificationDigest, ...qualificationMaterial } =
		value.qualification;
	if (
		value.schemaVersion !== D46_QUALIFICATION_BUNDLE_SCHEMA ||
		value.qualification.schemaVersion !== D46_QUALIFICATION_SCHEMA ||
		value.qualification.decisionRef !== "graphrefly-ts:D46" ||
		value.qualification.compositionRevision !== D46_COMPOSITION_REVISION ||
		value.qualification.evidenceDigest !== evidence.evidenceDigest ||
		value.qualification.partialEvidenceDigest !== partialEvidence.evidenceDigest ||
		value.qualification.exactSixArmsCompleted !== derived.exactSixArmsCompleted ||
		value.qualification.evaluableArms !== derived.evaluableArms ||
		value.qualification.boundedReadFacts !== derived.boundedReadFacts ||
		value.qualification.targetSpanProjectedForEveryArm !== true ||
		value.qualification.sourceBound !== D46_MAX_SOURCE_BYTES ||
		value.qualification.projectionBound !== D46_MAX_PROJECTED_BYTES ||
		value.qualification.windowBound !== D46_MAX_WINDOWS ||
		value.qualification.contextLines !== D46_CONTEXT_LINES ||
		value.qualification.providerCalls !== derived.providerCalls ||
		value.qualification.exactD710RetryIdentity !== derived.exactD710RetryIdentity ||
		value.qualification.providerNetworkCalls !== 0 ||
		value.qualification.credentialReads !== 0 ||
		value.qualification.dispatchClaims !== 0 ||
		value.qualification.maxActiveEffects !== 1 ||
		value.qualification.rawMaterialPersisted !== false ||
		value.qualification.canonicalReplayQualified !== true ||
		value.qualification.atomicPersistenceQualified !== true ||
		value.qualification.causalAttribution !== "undetermined" ||
		value.qualification.efficacyClaim !== "none" ||
		value.qualification.qualificationDigest !==
			empiricalStrictJsonDigest(strictSnapshot(qualificationMaterial)) ||
		value.bundleDigest !==
			empiricalStrictJsonDigest(
				strictSnapshot({
					schemaVersion: value.schemaVersion,
					evidence,
					partialEvidence,
					qualification: value.qualification,
				}),
			)
	)
		throw new TypeError("D46 qualification bundle failed canonical replay");
	return value;
}

export async function persistD46Qualification(input: {
	readonly directory: string;
	readonly bundle: D46QualificationBundleV1;
}): Promise<D46QualificationReceiptV1> {
	if (!isAbsolute(input.directory)) throw new TypeError("D46 qualification path must be absolute");
	const bundle = validateD46QualificationBundle(input.bundle);
	await mkdir(input.directory, { recursive: true, mode: 0o700 });
	await chmod(input.directory, 0o700);
	const target = join(input.directory, `${D46_QUALIFICATION_GENERATION_REF}.json`);
	const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
	const bytes = strictJsonCodec.encode(bundle);
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
		await handle.writeFile(bytes);
		await handle.sync();
		await handle.close();
		handle = null;
		await link(temp, target);
		await rm(temp);
		const root = await open(dirname(target), constants.O_RDONLY);
		try {
			await root.sync();
		} finally {
			await root.close();
		}
	} catch (error) {
		await handle?.close().catch(() => undefined);
		await rm(temp, { force: true });
		throw error;
	}
	const artifact = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
	let committed: Uint8Array;
	try {
		committed = await artifact.readFile();
	} finally {
		await artifact.close();
	}
	if (empiricalSha256(committed) !== empiricalSha256(bytes))
		throw new TypeError("D46 qualification persistence drifted");
	const receiptMaterial = strictSnapshot({
		generationRef: D46_QUALIFICATION_GENERATION_REF,
		bundleArtifactDigest: empiricalSha256(bytes),
		commitArtifactDigest: empiricalSha256(committed),
	});
	return Object.freeze({
		...receiptMaterial,
		receiptDigest: empiricalStrictJsonDigest(receiptMaterial),
	});
}

export async function persistD46PartialEvidence(input: {
	readonly directory: string;
	readonly evidence: D46PartialCanonicalEvidenceV1;
}): Promise<D46PartialPersistenceReceiptV1> {
	if (!isAbsolute(input.directory)) throw new TypeError("D46 partial path must be absolute");
	const evidence = validateD46PartialCanonicalEvidence(input.evidence);
	await mkdir(input.directory, { recursive: true, mode: 0o700 });
	await chmod(input.directory, 0o700);
	const generationRef =
		"current-graph-native-bounded-inspection-partial-2026-08-21-d46-v2" as const;
	const target = join(input.directory, `${generationRef}.json`);
	const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
	const bytes = strictJsonCodec.encode(evidence);
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
		await handle.writeFile(bytes);
		await handle.sync();
		await handle.close();
		handle = null;
		await link(temp, target);
		await rm(temp);
		const root = await open(dirname(target), constants.O_RDONLY);
		try {
			await root.sync();
		} finally {
			await root.close();
		}
	} catch (error) {
		await handle?.close().catch(() => undefined);
		await rm(temp, { force: true });
		throw error;
	}
	const artifact = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
	let committed: Uint8Array;
	try {
		committed = await artifact.readFile();
	} finally {
		await artifact.close();
	}
	if (empiricalSha256(committed) !== empiricalSha256(bytes))
		throw new TypeError("D46 partial persistence drifted");
	const receiptMaterial = strictSnapshot({
		generationRef,
		evidenceArtifactDigest: empiricalSha256(bytes),
		commitArtifactDigest: empiricalSha256(committed),
	});
	return Object.freeze({
		...receiptMaterial,
		receiptDigest: empiricalStrictJsonDigest(receiptMaterial),
	});
}
