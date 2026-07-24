export interface CommittedFactIdentityLike {
	readonly key: string;
}

export interface CommittedFactLike {
	readonly identity: CommittedFactIdentityLike;
	readonly materialIdentity: CommittedFactIdentityLike;
}

export type CommittedFactBatchDisposition =
	| { readonly kind: "append" }
	| { readonly kind: "duplicate" }
	| { readonly kind: "partial-overlap" }
	| { readonly kind: "conflict"; readonly identity: string }
	| { readonly kind: "internal-conflict"; readonly identity: string }
	| { readonly kind: "internal-duplicate"; readonly identity: string };

/** @internal Reject a stored stream that already violates identity/material uniqueness. */
export function assertCommittedFactStreamIntegrity<TFact extends CommittedFactLike>(
	facts: readonly TFact[],
): void {
	const materialByIdentity = new Map<string, string>();
	for (const fact of facts) {
		const identity = fact.identity.key;
		const material = fact.materialIdentity.key;
		const previousMaterial = materialByIdentity.get(identity);
		if (previousMaterial === undefined) {
			materialByIdentity.set(identity, material);
			continue;
		}
		const classification = previousMaterial === material ? "duplicate" : "conflict";
		throw new TypeError(`committed fact stream contains a cross-batch identity ${classification}`);
	}
}

/** @internal Shared D641 identity/material equality mechanics. */
export function committedFactBatchDisposition<TFact extends CommittedFactLike>(
	existing: readonly TFact[],
	incoming: readonly TFact[],
): CommittedFactBatchDisposition {
	assertCommittedFactStreamIntegrity(existing);
	const incomingByIdentity = new Map<string, string>();
	for (const fact of incoming) {
		const previousMaterial = incomingByIdentity.get(fact.identity.key);
		if (previousMaterial === undefined) {
			incomingByIdentity.set(fact.identity.key, fact.materialIdentity.key);
			continue;
		}
		return previousMaterial === fact.materialIdentity.key
			? { kind: "internal-duplicate", identity: fact.identity.key }
			: { kind: "internal-conflict", identity: fact.identity.key };
	}

	const existingByIdentity = new Map<string, string>();
	for (const fact of existing) {
		existingByIdentity.set(fact.identity.key, fact.materialIdentity.key);
	}
	let duplicateFacts = 0;
	for (const fact of incoming) {
		const previousMaterial = existingByIdentity.get(fact.identity.key);
		if (previousMaterial === undefined) continue;
		if (previousMaterial !== fact.materialIdentity.key) {
			return { kind: "conflict", identity: fact.identity.key };
		}
		duplicateFacts += 1;
	}
	if (duplicateFacts === incoming.length && incoming.length > 0) return { kind: "duplicate" };
	if (duplicateFacts > 0) return { kind: "partial-overlap" };
	return { kind: "append" };
}

export interface CommittedFactReadWindow<TFact> {
	readonly facts: readonly TFact[];
	readonly position: number;
	readonly done: boolean;
}

/** @internal Shared D641 fact-position paging mechanics. */
export function committedFactReadWindow<TFact>(
	facts: readonly TFact[],
	after: number,
	limit: number,
): CommittedFactReadWindow<TFact> {
	if (after > facts.length) {
		throw new RangeError("committed fact cursor is beyond the current stream tail");
	}
	const visible = facts.slice(
		after,
		limit === Number.POSITIVE_INFINITY ? undefined : after + limit,
	);
	const position = after + visible.length;
	return Object.freeze({
		facts: Object.freeze(visible),
		position,
		done: position >= facts.length,
	});
}
