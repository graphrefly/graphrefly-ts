import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	safeInteger,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import {
	D723_DECISION_REF,
	D723_DECISION_REVISION,
	D723_GENERATION_REF,
} from "./d723-graph-native-real-provider.js";

export const D723_DISPATCH_CLAIM_SCHEMA =
	"graphrefly.b112.d723.single-use-dispatch-claim.v1" as const;
export const D723_DISPATCH_CLAIM_REF = "d723-graph-native-live-block-2026-08-11-v1" as const;
export const D723_PRIVATE_ROOT = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);

export interface D723PersistedDispatchClaimV1 {
	readonly schemaVersion: typeof D723_DISPATCH_CLAIM_SCHEMA;
	readonly claimRef: typeof D723_DISPATCH_CLAIM_REF;
	readonly decisionRef: typeof D723_DECISION_REF;
	readonly decisionRevision: typeof D723_DECISION_REVISION;
	readonly generationRef: typeof D723_GENERATION_REF;
	readonly blockCount: 1;
	readonly blockHardCapMicrousd: 6_000_000;
	readonly localEvalNoResetLimitMicrousd: 32_000_000;
	readonly claimDigest: string;
}

export interface D723ExecutionAuthorityV1 {
	readonly revision: "graphrefly.b112.d723.execution-authority.v1";
}

const acquiredClaims = new WeakMap<object, { readonly root: string; consumed: boolean }>();
const executionAuthorities = new WeakSet<object>();

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

function claimMaterial(): Omit<D723PersistedDispatchClaimV1, "claimDigest"> {
	return strictSnapshot({
		schemaVersion: D723_DISPATCH_CLAIM_SCHEMA,
		claimRef: D723_DISPATCH_CLAIM_REF,
		decisionRef: D723_DECISION_REF,
		decisionRevision: D723_DECISION_REVISION,
		generationRef: D723_GENERATION_REF,
		blockCount: 1 as const,
		blockHardCapMicrousd: 6_000_000 as const,
		localEvalNoResetLimitMicrousd: 32_000_000 as const,
	});
}

export async function acquireD723SingleUseDispatchClaimAtRoot(
	privateRootValue: string,
): Promise<D723PersistedDispatchClaimV1> {
	const privateRoot = resolve(privateRootValue);
	const canonicalRoot = await realpath(privateRoot);
	if (canonicalRoot !== privateRoot) throw new TypeError("D723 private root is not canonical");
	const rootStat = await lstat(privateRoot);
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o777) !== 0o700)
		throw new TypeError("D723 private root ownership or mode is invalid");
	const claimRoot = join(privateRoot, `.${D723_DISPATCH_CLAIM_REF}`);
	await mkdir(claimRoot, { recursive: false, mode: 0o700 });
	await chmod(claimRoot, 0o700);
	const material = claimMaterial();
	const claim = strictSnapshot({ ...material, claimDigest: empiricalStrictJsonDigest(material) });
	const bytes = strictJsonCodec.encode(claim);
	const file = join(claimRoot, "dispatch-claim.v1.json");
	const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
	await chmod(file, 0o600);
	await syncDirectory(claimRoot);
	await syncDirectory(privateRoot);
	if (!sameBytes(new Uint8Array(await readFile(file)), bytes))
		throw new TypeError("D723 dispatch claim readback drifted");
	acquiredClaims.set(claim, { root: claimRoot, consumed: false });
	return claim as D723PersistedDispatchClaimV1;
}

export function acquireD723SingleUseDispatchClaim(): Promise<D723PersistedDispatchClaimV1> {
	return acquireD723SingleUseDispatchClaimAtRoot(D723_PRIVATE_ROOT);
}

export async function consumeD723DispatchClaimForExecution(inputValue: {
	readonly claim: D723PersistedDispatchClaimV1;
	readonly currentKeyAdmissionDigest: string;
	readonly remainingMicrousd: number;
}): Promise<D723ExecutionAuthorityV1> {
	const input = record(inputValue, "d723.consumeClaim");
	exactKeys(
		input,
		["claim", "currentKeyAdmissionDigest", "remainingMicrousd"],
		"d723.consumeClaim",
	);
	const state =
		typeof input.claim === "object" && input.claim !== null
			? acquiredClaims.get(input.claim)
			: undefined;
	if (state === undefined || state.consumed)
		throw new TypeError("D723 dispatch claim is not fresh and constructed");
	if (
		safeInteger(input.remainingMicrousd, "d723.remainingMicrousd", { min: 6_000_000 }) < 6_000_000
	)
		throw new TypeError("D723 current-key remaining spend is below the hard cap");
	if (
		typeof input.currentKeyAdmissionDigest !== "string" ||
		!/^sha256:[0-9a-f]{64}$/.test(input.currentKeyAdmissionDigest)
	)
		throw new TypeError("D723 current-key admission digest is invalid");
	state.consumed = true;
	const executionRoot = join(state.root, "execution-started");
	await mkdir(executionRoot, { recursive: false, mode: 0o700 });
	await chmod(executionRoot, 0o700);
	const marker = strictSnapshot({
		claimDigest: (input.claim as D723PersistedDispatchClaimV1).claimDigest,
		currentKeyAdmissionDigest: input.currentKeyAdmissionDigest,
		remainingMicrousd: input.remainingMicrousd,
	});
	const markerPath = join(executionRoot, "current-key-admission.v1.json");
	const handle = await open(
		markerPath,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
		0o600,
	);
	try {
		await handle.writeFile(strictJsonCodec.encode(marker));
		await handle.sync();
	} finally {
		await handle.close();
	}
	await chmod(markerPath, 0o600);
	await syncDirectory(executionRoot);
	await syncDirectory(state.root);
	const authority = Object.freeze({
		revision: "graphrefly.b112.d723.execution-authority.v1" as const,
	});
	executionAuthorities.add(authority);
	return authority;
}

export function consumeD723ExecutionAuthority(value: unknown): void {
	if (typeof value !== "object" || value === null || !executionAuthorities.delete(value))
		throw new TypeError("D723 execution authority must be same-process and single-use");
}
