import { createHash } from "node:crypto";
import { canonicalTupleKey } from "../../../identity.js";
import {
	stableJsonString,
	strictCanonicalJsonBytes,
	strictJsonCodec,
} from "../../../json/codec.js";
import type { SourceRef } from "../../../orchestration/agent-runtime.js";
import type { WorkItemProjection } from "../../../solutions/work-item/index.js";
import type { EvalResultRef, EvalScope, EvalWorld } from "./contracts.js";

export const evalId = (...parts: readonly string[]): string =>
	canonicalTupleKey(["b105", ...parts]);

const compareCodeUnits = (left: string, right: string): number =>
	left < right ? -1 : left > right ? 1 : 0;

export function canonicalSourceRefs(refs: readonly SourceRef[] = []): readonly SourceRef[] {
	const byCoordinate = new Map<string, SourceRef>();
	for (const ref of refs) {
		const metadata = strictJsonCodec.decode(strictJsonCodec.encode(ref.metadata ?? {})) as Record<
			string,
			unknown
		>;
		const snapshot: SourceRef = Object.freeze({
			kind: ref.kind,
			id: ref.id,
			...(Object.keys(metadata).length === 0 ? {} : { metadata }),
		});
		const coordinate = canonicalTupleKey([ref.kind, ref.id, stableJsonString(metadata)]);
		byCoordinate.set(coordinate, snapshot);
	}
	return Object.freeze(
		[...byCoordinate.entries()]
			.sort(([left], [right]) => compareCodeUnits(left, right))
			.map(([, ref]) => ref),
	);
}

export function sha256StrictJson(value: unknown): string {
	return `sha256:${createHash("sha256").update(strictCanonicalJsonBytes(value)).digest("hex")}`;
}

export function workItemDigest(item: WorkItemProjection, scope: EvalScope): string {
	return sha256StrictJson({
		workItemId: item.workItemId,
		authoringRevision: item.authoringRevision,
		executionInputRevision: item.executionInputRevision,
		summary: item.summary,
		sourceRefs: canonicalSourceRefs(item.sourceRefs),
		evalScope: scope,
	});
}

export function worldDigest(world: EvalWorld): string {
	return sha256StrictJson(world);
}

export function boundedIssueCodes(codes: readonly string[], limit = 16): readonly string[] {
	return Object.freeze([...new Set(codes)].sort().slice(0, limit));
}

export function boundedResultRefs(
	refs: readonly EvalResultRef[],
	limit = 32,
): readonly EvalResultRef[] {
	const byCoordinate = new Map<string, EvalResultRef>();
	for (const ref of refs) {
		byCoordinate.set(canonicalTupleKey([ref.kind, ref.id]), Object.freeze({ ...ref }));
	}
	return Object.freeze(
		[...byCoordinate.entries()]
			.sort(([left], [right]) => compareCodeUnits(left, right))
			.slice(0, limit)
			.map(([, ref]) => ref),
	);
}
