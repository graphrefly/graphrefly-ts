import { stableJsonString } from "../json/codec.js";

export type NodeVersioningLevel = 0 | 1;

export type NodeVersionHashFn = (value: unknown) => string;

export type NodeVersioningPolicy =
	| false
	| 0
	| 1
	| {
			level: NodeVersioningLevel;
			hash?: NodeVersionHashFn;
	  };

export type ResolvedNodeVersioningPolicy =
	| { readonly enabled: false }
	| { readonly enabled: true; readonly level: 0 }
	| { readonly enabled: true; readonly level: 1; readonly hash: NodeVersionHashFn };

export type NodeVersionV0 = {
	readonly level: 0;
	readonly counter: number;
};

export type NodeVersionV1 = {
	readonly level: 1;
	readonly counter: number;
	readonly cid: string;
	readonly prev: string | null;
};

export type NodeVersion = NodeVersionV0 | NodeVersionV1;

export type NodeVersionJson = NodeVersion;

const ABSENT_V1_SEED = Object.freeze({
	"@graphrefly/node-version": "v1-absent",
});

function fnv1a64(input: string): string {
	let hash = 0xcbf29ce484222325n;
	const prime = 0x100000001b3n;
	for (let i = 0; i < input.length; i += 1) {
		hash ^= BigInt(input.charCodeAt(i));
		hash = BigInt.asUintN(64, hash * prime);
	}
	return hash.toString(16).padStart(16, "0");
}

export function defaultNodeVersionHash(value: unknown): string {
	return `fnv1a64:${fnv1a64(stableJsonString(value))}`;
}

export function resolveNodeVersioningPolicy(
	policy: NodeVersioningPolicy | undefined,
): ResolvedNodeVersioningPolicy {
	if (policy === false) return { enabled: false };
	if (policy === undefined || policy === 0) return { enabled: true, level: 0 };
	if (policy === 1) return { enabled: true, level: 1, hash: defaultNodeVersionHash };
	if (typeof policy === "object" && policy !== null) {
		if (policy.level === 0) return { enabled: true, level: 0 };
		if (policy.level === 1) {
			return { enabled: true, level: 1, hash: policy.hash ?? defaultNodeVersionHash };
		}
	}
	throw new Error("node: versioning level must be 0 or 1; V2/V3 are not locked yet (D109)");
}

export function createNodeVersion(
	policy: ResolvedNodeVersioningPolicy,
	initialValue: unknown = ABSENT_V1_SEED,
): NodeVersion | undefined {
	if (!policy.enabled) return undefined;
	if (policy.level === 0) return Object.freeze({ level: 0, counter: 0 });
	return Object.freeze({
		level: 1,
		counter: 0,
		cid: policy.hash(initialValue),
		prev: null,
	});
}

export function advanceNodeVersion(
	current: NodeVersion | undefined,
	policy: ResolvedNodeVersioningPolicy,
	value: unknown,
): NodeVersion | undefined {
	if (!policy.enabled) return undefined;
	if (current === undefined) return createNodeVersion(policy, value);
	if (policy.level === 0) {
		return Object.freeze({ level: 0, counter: current.counter + 1 });
	}
	const previous = current.level === 1 ? current.cid : null;
	return Object.freeze({
		level: 1,
		counter: current.counter + 1,
		cid: policy.hash(value),
		prev: previous,
	});
}

export function cloneNodeVersion(version: NodeVersion | undefined): NodeVersion | undefined {
	if (version === undefined) return undefined;
	if (version.level === 0) return Object.freeze({ level: 0, counter: version.counter });
	return Object.freeze({
		level: 1,
		counter: version.counter,
		cid: version.cid,
		prev: version.prev,
	});
}

export function restoredV1Cid(
	policy: Extract<ResolvedNodeVersioningPolicy, { enabled: true; level: 1 }>,
	hasData: boolean,
	cache: unknown,
): string {
	return policy.hash(hasData ? cache : ABSENT_V1_SEED);
}

export function validateNodeVersionJson(value: unknown, path: string): NodeVersionJson {
	if (typeof value !== "object" || value === null) {
		throw new Error(`restoreGraph: ${path} must be an object`);
	}
	const record = value as Record<string, unknown>;
	if (record.level === 0) {
		if (!Number.isSafeInteger(record.counter) || (record.counter as number) < 0) {
			throw new Error(`restoreGraph: ${path}.counter must be a non-negative safe integer`);
		}
		return Object.freeze({ level: 0, counter: record.counter as number });
	}
	if (record.level === 1) {
		if (!Number.isSafeInteger(record.counter) || (record.counter as number) < 0) {
			throw new Error(`restoreGraph: ${path}.counter must be a non-negative safe integer`);
		}
		if (typeof record.cid !== "string") {
			throw new Error(`restoreGraph: ${path}.cid must be a string`);
		}
		if (record.prev !== null && typeof record.prev !== "string") {
			throw new Error(`restoreGraph: ${path}.prev must be a string or null`);
		}
		if ((record.counter as number) === 0 && record.prev !== null) {
			throw new Error(`restoreGraph: ${path}.prev must be null when counter is 0`);
		}
		if ((record.counter as number) > 0 && typeof record.prev !== "string") {
			throw new Error(`restoreGraph: ${path}.prev must be a string when counter is > 0`);
		}
		return Object.freeze({
			level: 1,
			counter: record.counter as number,
			cid: record.cid,
			prev: record.prev,
		});
	}
	throw new Error(`restoreGraph: ${path}.level must be 0 or 1`);
}
