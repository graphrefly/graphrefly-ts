import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	record,
	sameBytes,
	strictSnapshot,
} from "./canonical.js";
import type { CurrentGraphLivePreclaimV1 as D10CurrentGraphLivePreclaimV1 } from "./d8-current-live-preflight.js";
import { consumeCurrentGraphLivePreclaim as consumeD10CurrentGraphLivePreclaim } from "./d8-current-live-preflight.js";
import {
	D10_CURRENT_GRAPH_LIVE_COORDINATES_DIGEST,
	D10_CURRENT_GRAPH_LIVE_DECISION_REF,
	D10_CURRENT_GRAPH_LIVE_DECISION_REVISION,
	D10_CURRENT_GRAPH_LIVE_DISPATCH_CLAIM_REF,
	D10_CURRENT_GRAPH_LIVE_GENERATION_REF,
} from "./d10-current-live-coordinates.js";
import type { OpenRouterCurrentKeySpendAdmissionV1 } from "./openrouter-current-key-spend-admission.js";
import { consumeOpenRouterCurrentKeySpendAdmission } from "./openrouter-current-key-spend-admission.js";

export const D10_CURRENT_GRAPH_LIVE_DISPATCH_CLAIM_SCHEMA =
	"graphrefly-ts.d10.current-graph-live-dispatch-claim.v1" as const;
export const D10_CURRENT_GRAPH_LIVE_EXECUTION_AUTHORITY_REVISION =
	"graphrefly-ts.d10.current-graph-live-execution-authority.v1" as const;
export const D10_CURRENT_GRAPH_LIVE_PRIVATE_ROOT = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance/current-graph-native-d10",
);

type ClaimScope = "live-fixed-root" | "injected-test-root";

export interface D10CurrentGraphLiveDispatchClaimV1 {
	readonly schemaVersion: typeof D10_CURRENT_GRAPH_LIVE_DISPATCH_CLAIM_SCHEMA;
	readonly claimRef: typeof D10_CURRENT_GRAPH_LIVE_DISPATCH_CLAIM_REF;
	readonly decisionRef: typeof D10_CURRENT_GRAPH_LIVE_DECISION_REF;
	readonly decisionRevision: typeof D10_CURRENT_GRAPH_LIVE_DECISION_REVISION;
	readonly generationRef: typeof D10_CURRENT_GRAPH_LIVE_GENERATION_REF;
	readonly scope: ClaimScope;
	readonly coordinatesDigest: string;
	readonly preclaimDigest: string;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
	readonly blockCount: 1;
	readonly blockHardCapMicrousd: 6_000_000;
	readonly localEvalNoResetLimitMicrousd: 32_000_000;
	readonly claimDigest: string;
}

export interface D10CurrentGraphLiveExecutionAuthorityV1 {
	readonly revision: typeof D10_CURRENT_GRAPH_LIVE_EXECUTION_AUTHORITY_REVISION;
	readonly claim: D10CurrentGraphLiveDispatchClaimV1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1;
	readonly authorityDigest: string;
}

interface ClaimState {
	readonly scope: ClaimScope;
	readonly root: string;
	readonly file: string;
	readonly rootIdentity: Readonly<{ dev: number; ino: number }>;
	readonly fileIdentity: Readonly<{ dev: number; ino: number }>;
	readonly bytes: Uint8Array;
}

const claims = new WeakMap<object, ClaimState>();
const authorities = new WeakSet<object>();

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(
		path,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function assertPrivateRoot(rootValue: string): Promise<string> {
	const root = resolve(rootValue);
	const canonical = await realpath(root);
	if (canonical !== root) throw new TypeError("current live private root is not canonical");
	const stat = await lstat(root);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		(stat.mode & 0o777) !== 0o700 ||
		(process.getuid !== undefined && stat.uid !== process.getuid())
	)
		throw new TypeError("current live private root ownership is invalid");
	return root;
}

function claimMaterial(
	scope: ClaimScope,
	preclaim: D10CurrentGraphLivePreclaimV1,
	implementationManifestDigest: string,
	qualificationArtifactDigest: string,
	qualificationDigest: string,
) {
	return strictSnapshot({
		schemaVersion: D10_CURRENT_GRAPH_LIVE_DISPATCH_CLAIM_SCHEMA,
		claimRef: D10_CURRENT_GRAPH_LIVE_DISPATCH_CLAIM_REF,
		decisionRef: D10_CURRENT_GRAPH_LIVE_DECISION_REF,
		decisionRevision: D10_CURRENT_GRAPH_LIVE_DECISION_REVISION,
		generationRef: D10_CURRENT_GRAPH_LIVE_GENERATION_REF,
		scope,
		coordinatesDigest: D10_CURRENT_GRAPH_LIVE_COORDINATES_DIGEST,
		preclaimDigest: digest(preclaim.preclaimDigest, "current.live.claim.preclaimDigest"),
		implementationManifestDigest: digest(
			implementationManifestDigest,
			"current.live.claim.implementationManifestDigest",
		),
		qualificationArtifactDigest: digest(
			qualificationArtifactDigest,
			"current.live.claim.qualificationArtifactDigest",
		),
		qualificationDigest: digest(qualificationDigest, "current.live.claim.qualificationDigest"),
		blockCount: 1 as const,
		blockHardCapMicrousd: 6_000_000 as const,
		localEvalNoResetLimitMicrousd: 32_000_000 as const,
	});
}

async function acquire(
	privateRootValue: string,
	scope: ClaimScope,
	inputValue: {
		readonly preclaim: D10CurrentGraphLivePreclaimV1;
		readonly implementationManifestDigest: string;
		readonly qualificationArtifactDigest: string;
		readonly qualificationDigest: string;
	},
): Promise<D10CurrentGraphLiveDispatchClaimV1> {
	const input = record(inputValue, "current.live.claim.input");
	exactKeys(
		input,
		[
			"implementationManifestDigest",
			"preclaim",
			"qualificationArtifactDigest",
			"qualificationDigest",
		],
		"current.live.claim.input",
	);
	const preclaim = consumeD10CurrentGraphLivePreclaim(input.preclaim);
	const implementationManifestDigest = digest(
		input.implementationManifestDigest,
		"current.live.claim.implementationManifestDigest",
	);
	const privateRoot = await assertPrivateRoot(privateRootValue);
	const claimRoot = join(privateRoot, `.${D10_CURRENT_GRAPH_LIVE_DISPATCH_CLAIM_REF}`);
	await mkdir(claimRoot, { recursive: false, mode: 0o700 });
	await chmod(claimRoot, 0o700);
	const rootHandle = await open(
		claimRoot,
		constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
	);
	let rootStat: Awaited<ReturnType<typeof rootHandle.stat>>;
	try {
		rootStat = await rootHandle.stat();
		if (!rootStat.isDirectory() || (rootStat.mode & 0o777) !== 0o700 || rootStat.nlink < 2)
			throw new TypeError("current live claim directory identity is invalid");
	} finally {
		await rootHandle.close();
	}
	const material = claimMaterial(
		scope,
		preclaim,
		implementationManifestDigest,
		digest(input.qualificationArtifactDigest, "current.live.claim.qualificationArtifactDigest"),
		digest(input.qualificationDigest, "current.live.claim.qualificationDigest"),
	);
	const claim = Object.freeze({
		...material,
		claimDigest: empiricalStrictJsonDigest(material),
	}) as D10CurrentGraphLiveDispatchClaimV1;
	const bytes = strictJsonCodec.encode(claim);
	const file = join(claimRoot, "dispatch-claim.v1.json");
	const writer = await open(
		file,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await writer.writeFile(bytes);
		await writer.sync();
	} finally {
		await writer.close();
	}
	await chmod(file, 0o600);
	await syncDirectory(claimRoot);
	await syncDirectory(privateRoot);
	const reader = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
	let fileStat: Awaited<ReturnType<typeof reader.stat>>;
	try {
		fileStat = await reader.stat();
		if (
			!fileStat.isFile() ||
			(fileStat.mode & 0o777) !== 0o600 ||
			fileStat.nlink !== 1 ||
			!sameBytes(new Uint8Array(await reader.readFile()), bytes)
		)
			throw new TypeError("current live claim readback drifted");
	} finally {
		await reader.close();
	}
	claims.set(claim, {
		scope,
		root: claimRoot,
		file,
		rootIdentity: { dev: rootStat.dev, ino: rootStat.ino },
		fileIdentity: { dev: fileStat.dev, ino: fileStat.ino },
		bytes,
	});
	return claim;
}

export function acquireD10CurrentGraphLiveDispatchClaim(input: {
	readonly preclaim: D10CurrentGraphLivePreclaimV1;
	readonly implementationManifestDigest: string;
	readonly qualificationArtifactDigest: string;
	readonly qualificationDigest: string;
}) {
	return acquire(D10_CURRENT_GRAPH_LIVE_PRIVATE_ROOT, "live-fixed-root", input);
}

export function acquireD10CurrentGraphLiveDispatchClaimAtRootForTest(
	root: string,
	input: {
		readonly preclaim: D10CurrentGraphLivePreclaimV1;
		readonly implementationManifestDigest: string;
		readonly qualificationArtifactDigest: string;
		readonly qualificationDigest: string;
	},
) {
	return acquire(root, "injected-test-root", input);
}

async function revalidateClaim(
	claim: D10CurrentGraphLiveDispatchClaimV1,
	state: ClaimState,
): Promise<void> {
	const rootStat = await lstat(state.root);
	if (
		!rootStat.isDirectory() ||
		rootStat.isSymbolicLink() ||
		(rootStat.mode & 0o777) !== 0o700 ||
		rootStat.dev !== state.rootIdentity.dev ||
		rootStat.ino !== state.rootIdentity.ino ||
		(await realpath(state.root)) !== state.root
	)
		throw new TypeError("current live durable claim directory drifted");
	const reader = await open(state.file, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await reader.stat();
		if (
			!stat.isFile() ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.nlink !== 1 ||
			stat.dev !== state.fileIdentity.dev ||
			stat.ino !== state.fileIdentity.ino ||
			!sameBytes(new Uint8Array(await reader.readFile()), state.bytes)
		)
			throw new TypeError("current live durable claim file drifted");
	} finally {
		await reader.close();
	}
	const material = claimMaterial(
		state.scope,
		{ preclaimDigest: claim.preclaimDigest } as D10CurrentGraphLivePreclaimV1,
		claim.implementationManifestDigest,
		claim.qualificationArtifactDigest,
		claim.qualificationDigest,
	);
	if (claim.claimDigest !== empiricalStrictJsonDigest(material))
		throw new TypeError("current live durable claim digest drifted");
}

export async function consumeD10CurrentGraphLiveDispatchClaim(inputValue: {
	readonly claim: D10CurrentGraphLiveDispatchClaimV1;
	readonly currentKeyAdmission: OpenRouterCurrentKeySpendAdmissionV1;
	readonly allowInjectedTestScope?: boolean;
}): Promise<D10CurrentGraphLiveExecutionAuthorityV1> {
	const input = record(inputValue, "current.live.execution.input");
	exactKeys(
		input,
		Object.hasOwn(input, "allowInjectedTestScope")
			? ["allowInjectedTestScope", "claim", "currentKeyAdmission"]
			: ["claim", "currentKeyAdmission"],
		"current.live.execution.input",
	);
	const claim = input.claim as D10CurrentGraphLiveDispatchClaimV1;
	const state = typeof claim === "object" && claim !== null ? claims.get(claim) : undefined;
	if (state === undefined) throw new TypeError("current live dispatch claim is forged or consumed");
	claims.delete(claim);
	if (state.scope !== "live-fixed-root" && input.allowInjectedTestScope !== true)
		throw new TypeError("current live execution rejected an injected claim");
	await revalidateClaim(claim, state);
	const currentKeyAdmission = consumeOpenRouterCurrentKeySpendAdmission(input.currentKeyAdmission);
	if (
		currentKeyAdmission.limitMicrousd !== 32_000_000 ||
		currentKeyAdmission.limitReset !== "none" ||
		currentKeyAdmission.isManagementKey !== false ||
		currentKeyAdmission.remainingMicrousd < 6_000_000
	)
		throw new TypeError("current live current-key admission is outside the approved boundary");
	const marker = join(state.root, ".execution-started");
	await mkdir(marker, { recursive: false, mode: 0o700 });
	await chmod(marker, 0o700);
	await syncDirectory(marker);
	await syncDirectory(state.root);
	const markerStat = await lstat(marker);
	if (
		!markerStat.isDirectory() ||
		markerStat.isSymbolicLink() ||
		(markerStat.mode & 0o777) !== 0o700 ||
		(await realpath(marker)) !== marker
	)
		throw new TypeError("current live execution marker drifted");
	const material = strictSnapshot({
		revision: D10_CURRENT_GRAPH_LIVE_EXECUTION_AUTHORITY_REVISION,
		claim,
		currentKeyAdmission,
	});
	const authority = Object.freeze({
		...material,
		authorityDigest: empiricalStrictJsonDigest(material),
	}) as D10CurrentGraphLiveExecutionAuthorityV1;
	authorities.add(authority);
	return authority;
}

export function consumeD10CurrentGraphLiveExecutionAuthority(
	value: unknown,
): D10CurrentGraphLiveExecutionAuthorityV1 {
	if (typeof value !== "object" || value === null || !authorities.delete(value))
		throw new TypeError("current live execution authority must be fresh and single-use");
	return value as D10CurrentGraphLiveExecutionAuthorityV1;
}
