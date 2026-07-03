import { depBatch } from "../../ctx/types.js";
import type { DataIssue } from "../../data/index.js";
import type { Graph } from "../../graph/graph.js";
import { canonicalTupleKey, compoundTupleKey } from "../../identity.js";
import type { Node } from "../../node/node.js";
import type { AgentRuntimeAuditRecord, SourceRef } from "../../orchestration/agent-runtime.js";
import type { WorkItemDomainActionStatus } from "./actions-types.js";

export function auditRecord(
	kind: string,
	seq: number,
	status: WorkItemDomainActionStatus,
): AgentRuntimeAuditRecord {
	return {
		id: compoundTupleKey(kind, [String(seq)]),
		kind,
		subjectId: status.workItemId,
		message: status.message,
		issueCode: status.code,
		sourceRefs: status.sourceRefs,
		metadata: {
			statusId: status.statusId,
			state: status.state,
			proposalId: status.proposalId,
			admissionId: status.admissionId,
			actionKind: status.actionKind,
			...(status.metadata ?? {}),
		},
	};
}

export function project<TFact, TSelected>(
	graph: Graph,
	runtime: Node<TFact>,
	name: string,
	factory: string,
	select: (fact: TFact) => TSelected | undefined,
): Node<TSelected> {
	return graph.node<TSelected>(
		[runtime],
		(ctx) => {
			for (const raw of depBatch(ctx, 0) ?? []) {
				const selected = select(raw as TFact);
				if (selected !== undefined) ctx.down([["DATA", selected]]);
			}
		},
		{ name, factory, partial: true, completeWhenDepsComplete: false, errorWhenDepsError: false },
	);
}

export function dataIssue(
	code: string,
	message: string,
	opts: {
		readonly subjectId?: string;
		readonly refs?: readonly SourceRef[];
		readonly metadata?: Record<string, unknown>;
	} = {},
): DataIssue {
	return {
		kind: "issue",
		code,
		message,
		severity: "error",
		source: "work-item-actions",
		subjectId: opts.subjectId,
		refs: opts.refs?.map((sourceRef) => canonicalTupleKey([sourceRef.kind, sourceRef.id])),
		metadata: opts.metadata,
	};
}

export function uniqueSourceRefs(sourceRefs: readonly SourceRef[]): readonly SourceRef[] {
	const seen = new Set<string>();
	const out: SourceRef[] = [];
	for (const sourceRef of sourceRefs) {
		const key = canonicalTupleKey([
			sourceRef.kind,
			sourceRef.id,
			JSON.stringify(sourceRef.metadata ?? {}),
		]);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(sourceRef);
	}
	return out;
}

export function sourceRefs(value: unknown): readonly SourceRef[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.filter(
		(item): item is SourceRef =>
			isRecord(item) && typeof item.kind === "string" && typeof item.id === "string",
	);
}

export function numberMetadata(
	metadata: Record<string, unknown> | undefined,
	key: string,
): number | undefined {
	const value = metadata?.[key];
	return typeof value === "number" ? value : undefined;
}

export function stringMetadata(
	metadata: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = metadata?.[key];
	return typeof value === "string" ? value : undefined;
}

export function ref(kind: string, id: string): SourceRef {
	return { kind, id };
}

export function recordString(value: unknown, key: string): string | undefined {
	return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}
