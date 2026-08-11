import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import type { AgentRequestIssued } from "../../src/orchestration/agent-runtime.js";
import {
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import {
	admitD719CleanGraphArmResult,
	admitD719CleanGraphCancellation,
	admitD719CleanGraphExecutorFailure,
	createD719CleanEffectController,
	createD719CleanGraphLedger,
	type D719CallerArmResultV1,
	type D719CleanBudgetLimitsV1,
	type D719CleanEffectControllerV1,
	type D719CleanGraphEvidenceV1,
	type D719CleanRequestInput,
	snapshotD719CleanGraphEvidence,
	takeNextD719CleanGraphRequest,
	validateD719CleanGraphEvidence,
} from "./d719-clean-graph-ledger.js";

export const D720_GRAPH_NATIVE_EVAL_REVISION =
	"graphrefly.b112.d720.clean-graph-native-eval.v1" as const;
export const D720_GRAPH_NATIVE_EVAL_BUNDLE_SCHEMA =
	"graphrefly.b112.d720.graph-native-eval-bundle.v1" as const;
export const D720_GRAPH_NATIVE_PERSISTENCE_SCHEMA =
	"graphrefly.b112.d720.graph-native-persistence-receipt.v1" as const;

export interface D720CallerExecutionInputV1 {
	readonly request: AgentRequestIssued<D719CleanRequestInput>;
	readonly effects: D719CleanEffectControllerV1;
	readonly signal?: AbortSignal;
}

export interface D720CallerExecutorV1 {
	readonly revision: "graphrefly.b112.d720.caller-executor.v1";
}

export interface D720GraphNativeEvalBundleV1 {
	readonly schemaVersion: typeof D720_GRAPH_NATIVE_EVAL_BUNDLE_SCHEMA;
	readonly evalRevision: typeof D720_GRAPH_NATIVE_EVAL_REVISION;
	readonly executionClass: "simulated-contract";
	readonly graphEvidence: D719CleanGraphEvidenceV1;
	readonly graphEvidenceDigest: string;
	readonly findingsDigest: string;
	readonly runStatus: "complete" | "stopped";
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly bundleDigest: string;
}

export interface D720PersistedBundleReceiptV1 {
	readonly schemaVersion: typeof D720_GRAPH_NATIVE_PERSISTENCE_SCHEMA;
	readonly bundleRef: string;
	readonly graphEvidenceArtifactDigest: string;
	readonly findingsArtifactDigest: string;
	readonly bundleArtifactDigest: string;
	readonly bundleDigest: string;
	readonly persistenceDigest: string;
}

interface ExecutorState {
	readonly execute: (input: D720CallerExecutionInputV1) => Promise<D719CallerArmResultV1>;
}

const constructedExecutors = new WeakMap<object, ExecutorState>();
const constructedBundles = new WeakSet<object>();

function signalIsAborted(signal: AbortSignal | undefined): boolean {
	return signal?.aborted === true;
}

export function createD720SimulatedCallerExecutor(
	execute: (input: D720CallerExecutionInputV1) => Promise<D719CallerArmResultV1>,
): D720CallerExecutorV1 {
	if (typeof execute !== "function") throw new TypeError("D720 executor must be a function");
	const capability = Object.freeze({
		revision: "graphrefly.b112.d720.caller-executor.v1" as const,
	});
	constructedExecutors.set(capability, { execute });
	return capability;
}

function executorState(value: unknown): ExecutorState {
	if (typeof value !== "object" || value === null) {
		throw new TypeError("D720 executor must be a constructed capability");
	}
	const state = constructedExecutors.get(value);
	if (state === undefined) throw new TypeError("D720 executor was not constructed by the eval");
	return state;
}

export async function runD720GraphNativeEval(inputValue: {
	readonly sourceDigest: string;
	readonly budgetLimits: D719CleanBudgetLimitsV1;
	readonly executor: D720CallerExecutorV1;
	readonly signal?: AbortSignal;
}): Promise<D720GraphNativeEvalBundleV1> {
	const input = record(inputValue, "d720.run");
	exactKeys(
		input,
		Object.hasOwn(input, "signal")
			? ["budgetLimits", "executor", "signal", "sourceDigest"]
			: ["budgetLimits", "executor", "sourceDigest"],
		"d720.run",
	);
	const sourceDigest = digest(input.sourceDigest, "d720.run.sourceDigest");
	const executor = executorState(input.executor);
	if (Object.hasOwn(input, "signal") && !(input.signal instanceof AbortSignal)) {
		throw new TypeError("D720 signal is invalid");
	}
	const signal = input.signal as AbortSignal | undefined;
	const ledger = createD719CleanGraphLedger({
		sourceDigest,
		budgetLimits: input.budgetLimits as D719CleanBudgetLimitsV1,
	});
	for (let runCount = 0; runCount < 12; runCount += 1) {
		const request = takeNextD719CleanGraphRequest(ledger);
		if (request === null) break;
		const effects = createD719CleanEffectController(ledger, request);
		if (signalIsAborted(signal)) {
			admitD719CleanGraphCancellation(ledger, request);
			break;
		}
		let result: D719CallerArmResultV1;
		try {
			result = await executor.execute(
				Object.freeze(signal === undefined ? { effects, request } : { effects, request, signal }),
			);
		} catch {
			if (signalIsAborted(signal)) admitD719CleanGraphCancellation(ledger, request);
			else admitD719CleanGraphExecutorFailure(ledger, request);
			break;
		}
		if (signalIsAborted(signal)) {
			admitD719CleanGraphCancellation(ledger, request);
			break;
		}
		const decision = admitD719CleanGraphArmResult(ledger, request, result);
		if (decision.disposition === "stop") break;
	}
	if (takeNextD719CleanGraphRequest(ledger) !== null) {
		throw new TypeError("D720 six-arm bound ended while Graph still exposed work");
	}
	const graphEvidence = validateD719CleanGraphEvidence(snapshotD719CleanGraphEvidence(ledger));
	const material = strictSnapshot({
		schemaVersion: D720_GRAPH_NATIVE_EVAL_BUNDLE_SCHEMA,
		evalRevision: D720_GRAPH_NATIVE_EVAL_REVISION,
		executionClass: "simulated-contract" as const,
		graphEvidence,
		graphEvidenceDigest: graphEvidence.evidenceDigest,
		findingsDigest: empiricalStrictJsonDigest(graphEvidence.findings),
		runStatus: graphEvidence.runStatus,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const bundle = Object.freeze({ ...material, bundleDigest: empiricalStrictJsonDigest(material) });
	constructedBundles.add(bundle);
	return bundle;
}

export function validateD720GraphNativeEvalBundle(value: unknown): D720GraphNativeEvalBundleV1 {
	const candidate = record(value, "d720.bundle");
	exactKeys(
		candidate,
		[
			"bundleDigest",
			"causalAttribution",
			"efficacyClaim",
			"evalRevision",
			"executionClass",
			"findingsDigest",
			"graphEvidence",
			"graphEvidenceDigest",
			"runStatus",
			"schemaVersion",
		],
		"d720.bundle",
	);
	const graphEvidence = validateD719CleanGraphEvidence(candidate.graphEvidence);
	const snapshot = strictSnapshot({
		...candidate,
		graphEvidence,
	}) as unknown as D720GraphNativeEvalBundleV1;
	if (
		snapshot.schemaVersion !== D720_GRAPH_NATIVE_EVAL_BUNDLE_SCHEMA ||
		snapshot.evalRevision !== D720_GRAPH_NATIVE_EVAL_REVISION ||
		snapshot.executionClass !== "simulated-contract" ||
		snapshot.causalAttribution !== "undetermined" ||
		snapshot.efficacyClaim !== "none" ||
		snapshot.runStatus !== graphEvidence.runStatus
	) {
		throw new TypeError("D720 bundle coordinates drifted");
	}
	if (
		snapshot.graphEvidenceDigest !== graphEvidence.evidenceDigest ||
		snapshot.findingsDigest !== empiricalStrictJsonDigest(graphEvidence.findings)
	) {
		throw new TypeError("D720 bundle does not bind its Graph evidence");
	}
	digest(snapshot.bundleDigest, "d720.bundle.bundleDigest");
	const material = strictSnapshot({
		schemaVersion: snapshot.schemaVersion,
		evalRevision: snapshot.evalRevision,
		executionClass: snapshot.executionClass,
		graphEvidence,
		graphEvidenceDigest: snapshot.graphEvidenceDigest,
		findingsDigest: snapshot.findingsDigest,
		runStatus: snapshot.runStatus,
		causalAttribution: snapshot.causalAttribution,
		efficacyClaim: snapshot.efficacyClaim,
	});
	if (snapshot.bundleDigest !== empiricalStrictJsonDigest(material)) {
		throw new TypeError("D720 bundle digest mismatch");
	}
	return snapshot;
}

async function assertPrivateRoot(privateRoot: string): Promise<string> {
	if (typeof privateRoot !== "string" || privateRoot.length === 0) {
		throw new TypeError("D720 privateRoot is invalid");
	}
	const absolute = resolve(privateRoot);
	if (absolute !== privateRoot)
		throw new TypeError("D720 privateRoot must be absolute and canonical");
	const stat = await lstat(absolute);
	if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) {
		throw new TypeError("D720 privateRoot must be a real 0700 directory");
	}
	if ((await realpath(absolute)) !== absolute) {
		throw new TypeError("D720 privateRoot realpath drifted");
	}
	return absolute;
}

function validateBundleRef(value: unknown): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > 96 ||
		!/^d720-[a-z0-9][a-z0-9-]*$/.test(value)
	) {
		throw new TypeError("D720 bundleRef is invalid");
	}
	return value;
}

async function writeCanonical(path: string, bytes: Uint8Array): Promise<void> {
	const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, constants.O_RDONLY);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function cleanupOrAggregate(path: string, error: unknown, label: string): Promise<never> {
	try {
		await rm(path, { recursive: true, force: true });
	} catch (cleanupError) {
		throw new AggregateError([error, cleanupError], label);
	}
	throw error;
}

export async function persistD720GraphNativeEvalBundle(inputValue: {
	readonly privateRoot: string;
	readonly bundleRef: string;
	readonly bundle: D720GraphNativeEvalBundleV1;
}): Promise<D720PersistedBundleReceiptV1> {
	const input = record(inputValue, "d720.persist");
	exactKeys(input, ["bundle", "bundleRef", "privateRoot"], "d720.persist");
	if (
		typeof input.bundle !== "object" ||
		input.bundle === null ||
		!constructedBundles.has(input.bundle)
	) {
		throw new TypeError("D720 persistence requires a same-process constructed bundle");
	}
	const bundle = validateD720GraphNativeEvalBundle(input.bundle);
	const bundleRef = validateBundleRef(input.bundleRef);
	const privateRoot = await assertPrivateRoot(input.privateRoot as string);
	const finalRoot = join(privateRoot, bundleRef);
	const privateRootStat = await lstat(privateRoot);
	try {
		await mkdir(finalRoot, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new TypeError("D720 bundle already exists");
		}
		throw error;
	}
	const stagingRoot = join(finalRoot, `.d720-staging-${randomUUID()}`);
	const artifactsRoot = join(finalRoot, "artifacts");
	let graphBytes: Uint8Array;
	let findingsBytes: Uint8Array;
	let bundleBytes: Uint8Array;
	let claimedRootIdentity: { readonly dev: number; readonly ino: number } | null = null;
	try {
		const claimedRootStat = await lstat(finalRoot);
		claimedRootIdentity = { dev: claimedRootStat.dev, ino: claimedRootStat.ino };
		const claimedPrivateRootStat = await lstat(privateRoot);
		if (
			!claimedRootStat.isDirectory() ||
			claimedRootStat.isSymbolicLink() ||
			(claimedRootStat.mode & 0o777) !== 0o700 ||
			claimedPrivateRootStat.dev !== privateRootStat.dev ||
			claimedPrivateRootStat.ino !== privateRootStat.ino ||
			(await realpath(privateRoot)) !== privateRoot ||
			(await realpath(finalRoot)) !== finalRoot
		) {
			throw new TypeError("D720 persistence ownership drifted after exclusive claim");
		}
		await mkdir(stagingRoot, { mode: 0o700 });
		graphBytes = strictJsonCodec.encode(bundle.graphEvidence);
		findingsBytes = strictJsonCodec.encode(bundle.graphEvidence.findings);
		bundleBytes = strictJsonCodec.encode(bundle);
		await writeCanonical(join(stagingRoot, "graph-evidence.v1.json"), graphBytes);
		await writeCanonical(join(stagingRoot, "harness-findings.v1.json"), findingsBytes);
		await writeCanonical(join(stagingRoot, "eval-bundle.v1.json"), bundleBytes);
		await syncDirectory(stagingRoot);
		for (const [name, expected] of [
			["graph-evidence.v1.json", graphBytes],
			["harness-findings.v1.json", findingsBytes],
			["eval-bundle.v1.json", bundleBytes],
		] as const) {
			const actual = await readFile(join(stagingRoot, name));
			if (!sameBytes(actual, expected)) throw new TypeError(`D720 ${name} readback mismatch`);
		}
		const beforeCommitRootStat = await lstat(privateRoot);
		const beforeCommitClaimStat = await lstat(finalRoot);
		if (
			beforeCommitRootStat.dev !== privateRootStat.dev ||
			beforeCommitRootStat.ino !== privateRootStat.ino ||
			(await realpath(finalRoot)) !== finalRoot ||
			beforeCommitClaimStat.dev !== claimedRootIdentity.dev ||
			beforeCommitClaimStat.ino !== claimedRootIdentity.ino
		) {
			throw new TypeError("D720 persistence ownership drifted before commit");
		}
		await rename(stagingRoot, artifactsRoot);
		await syncDirectory(finalRoot);
		const commitBytes = strictJsonCodec.encode(
			strictSnapshot({
				schemaVersion: "graphrefly.b112.d720.graph-native-commit.v1",
				bundleDigest: bundle.bundleDigest,
				artifactsDirectory: "artifacts",
			}),
		);
		await writeCanonical(join(finalRoot, "commit.v1.json"), commitBytes);
		await syncDirectory(finalRoot);
		const currentPrivateRootStat = await lstat(privateRoot);
		if (
			currentPrivateRootStat.dev !== privateRootStat.dev ||
			currentPrivateRootStat.ino !== privateRootStat.ino ||
			(await realpath(privateRoot)) !== privateRoot
		) {
			throw new TypeError("D720 privateRoot identity drifted during persistence");
		}
		try {
			const stableParentHandle = await open(privateRoot, constants.O_RDONLY);
			try {
				const stableParentStat = await stableParentHandle.stat();
				if (
					stableParentStat.dev !== privateRootStat.dev ||
					stableParentStat.ino !== privateRootStat.ino
				)
					throw new TypeError("D720 parent handle identity drifted");
				await stableParentHandle.sync();
				const afterSyncParentStat = await lstat(privateRoot);
				if (
					afterSyncParentStat.dev !== privateRootStat.dev ||
					afterSyncParentStat.ino !== privateRootStat.ino ||
					(await realpath(privateRoot)) !== privateRoot
				)
					throw new TypeError("D720 parent path identity drifted after sync");
			} finally {
				await stableParentHandle.close();
			}
		} catch (error) {
			try {
				await rm(finalRoot, { recursive: true, force: true });
				await syncDirectory(privateRoot);
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], "D720 post-rename cleanup failed");
			}
			throw error;
		}
	} catch (error) {
		const cleanupRootStat = await lstat(privateRoot).catch(() => null);
		const cleanupClaimStat = await lstat(finalRoot).catch(() => null);
		if (
			cleanupRootStat === null ||
			cleanupRootStat.dev !== privateRootStat.dev ||
			cleanupRootStat.ino !== privateRootStat.ino ||
			claimedRootIdentity === null ||
			cleanupClaimStat === null ||
			cleanupClaimStat.dev !== claimedRootIdentity.dev ||
			cleanupClaimStat.ino !== claimedRootIdentity.ino
		) {
			throw new AggregateError(
				[error, new TypeError("D720 cleanup refused after privateRoot identity drift")],
				"D720 exclusive generation ownership lost",
			);
		}
		return cleanupOrAggregate(finalRoot, error, "D720 exclusive generation cleanup failed");
	}
	const material = strictSnapshot({
		schemaVersion: D720_GRAPH_NATIVE_PERSISTENCE_SCHEMA,
		bundleRef,
		graphEvidenceArtifactDigest: empiricalSha256(graphBytes),
		findingsArtifactDigest: empiricalSha256(findingsBytes),
		bundleArtifactDigest: empiricalSha256(bundleBytes),
		bundleDigest: bundle.bundleDigest,
	});
	return Object.freeze({ ...material, persistenceDigest: empiricalStrictJsonDigest(material) });
}
