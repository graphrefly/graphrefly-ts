import type { Ctx } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import {
	PolicyInputs,
	type PolicyReader,
	selectRetentionVictims,
	trimHeadOverflow,
} from "../graph/policies/collection.js";
import type { CapacityPolicy, ReactiveOpt } from "../graph/policies/types.js";
import { Node } from "../node/node.js";
import {
	canonicalPublicSourceRefs,
	dataIssue,
	isPlainRecord,
	publicMaterialForbiddenKeys,
	stableStringHash,
} from "./agent-runtime-common.js";
import type { SourceRef } from "./agent-runtime-types-core.js";
import type {
	ToolProviderAdapterExecutionRetentionEntry,
	ToolProviderAdapterInput,
	ToolProviderAdapterInputRetentionEntry,
	ToolProviderAdapterRunIssueRetentionEntry,
	ToolProviderAdapterRunRequested,
	ToolProviderAdapterRunRequestRetentionEntry,
	ToolProviderAdapterRunStatus,
	ToolProviderAdapterRunStatusRetentionEntry,
	ToolProviderAdapterRuntimeIndexRetentionPolicy,
	ToolProviderAdapterRuntimeRetentionEvidenceEntry,
	ToolProviderAdapterRuntimeRetentionIndex,
	ToolProviderAdapterRuntimeRetentionPolicy,
} from "./agent-runtime-types-tool.js";

export type RuntimeRetentionMode = "fifo" | "score";

export interface RuntimeRetentionIndexConfig {
	readonly maxSize?: number;
	readonly mode: RuntimeRetentionMode;
}

export interface RuntimeRetentionPolicyFact {
	readonly kind: "tool-provider-adapter-runtime-retention-policy";
	readonly policies: ReadonlyMap<
		ToolProviderAdapterRuntimeRetentionIndex,
		RuntimeRetentionIndexConfig
	>;
	readonly issues?: readonly DataIssue[];
}

export interface RuntimeRetentionPolicyReaders {
	readonly inputs: PolicyInputs;
	readonly readers: ReadonlyMap<ToolProviderAdapterRuntimeRetentionIndex, PolicyReader<number>>;
	readonly statics: ReadonlyMap<ToolProviderAdapterRuntimeRetentionIndex, number | undefined>;
}

export type EffectiveRuntimeRetentionPolicy = Partial<{
	readonly adapterInputs: RuntimeRetentionIndexConfig;
	readonly runRequests: RuntimeRetentionIndexConfig;
	readonly executions: RuntimeRetentionIndexConfig;
	readonly runStatuses: RuntimeRetentionIndexConfig;
	readonly runIssues: RuntimeRetentionIndexConfig;
	readonly retentionEvidence: RuntimeRetentionIndexConfig;
}>;

export type ReplayEvidenceGapKind =
	| "adapter-input-trimmed"
	| "execution-proof-trimmed"
	| "evidence-horizon"
	| "evidence-horizon-closed";

export type ReplayEvidenceClassification =
	| { readonly kind: "fresh" }
	| { readonly kind: "missing-input" }
	| {
			readonly kind: "retention-gap";
			readonly index: ToolProviderAdapterRuntimeRetentionIndex;
			readonly gapKind: ReplayEvidenceGapKind;
			readonly key?: string;
	  };

export interface RuntimeIndexItem<Entry, Value> {
	readonly key: string;
	readonly entry: Entry;
	readonly value: Value;
}

export interface RuntimeRetentionTrackedValue<Value> {
	readonly fact: Value;
	readonly dropKey?: () => void;
}

export interface ToolProviderAdapterRunProjectorPrivateRetentionHooks {
	readonly onAdapterInputKey?: (entry: {
		readonly adapterInputId: string;
		readonly dropInput: () => void;
	}) => void;
	readonly classifyRetainedRunRequestReplayEvidence?: (
		request: ToolProviderAdapterRunRequested,
	) => ReplayEvidenceClassification;
	readonly onRunRequestKey?: (entry: {
		readonly key: string;
		readonly request: ToolProviderAdapterRunRequested;
		readonly dropKey: () => void;
	}) => void;
	readonly onRunStatusKey?: (entry: {
		readonly key: string;
		readonly status: ToolProviderAdapterRunStatus;
		readonly dropKey: () => void;
	}) => void;
	readonly onRunIssueKey?: (entry: {
		readonly key: string;
		readonly issue: DataIssue;
		readonly dropKey: () => void;
	}) => void;
}

export class RuntimeRetentionIndex<Entry extends { readonly sequence: number }, Value> {
	private readonly items = new Map<string, RuntimeIndexItem<Entry, Value>>();

	get size(): number {
		return this.items.size;
	}

	get(key: string): RuntimeIndexItem<Entry, Value> | undefined {
		return this.items.get(key);
	}

	has(key: string): boolean {
		return this.items.has(key);
	}

	set(key: string, entry: Entry, value: Value): RuntimeIndexItem<Entry, Value> {
		const item = { key, entry, value };
		this.items.set(key, item);
		return item;
	}

	delete(key: string): RuntimeIndexItem<Entry, Value> | undefined {
		const item = this.items.get(key);
		if (item !== undefined) this.items.delete(key);
		return item;
	}

	trimFifo(maxSize: number): RuntimeIndexItem<Entry, Value>[] {
		const items = Array.from(this.items.values()).sort(
			(a, b) => a.entry.sequence - b.entry.sequence,
		);
		return trimHeadOverflow(items, { maxSize })
			.map((item) => this.delete(item.key))
			.filter((item): item is RuntimeIndexItem<Entry, Value> => item !== undefined);
	}

	trimScored(
		maxSize: number,
		score: (entry: Entry) => number,
	): {
		readonly victims?: RuntimeIndexItem<Entry, Value>[];
		readonly invalid?: "threw" | "non-finite";
	} {
		const scored: { readonly entry: RuntimeIndexItem<Entry, Value>; readonly score: number }[] = [];
		for (const item of this.items.values()) {
			let value: number;
			try {
				value = score(item.entry);
			} catch {
				return { invalid: "threw" };
			}
			if (!Number.isFinite(value)) return { invalid: "non-finite" };
			scored.push({ entry: item, score: value });
		}
		const victims = selectRetentionVictims(scored, { maxSize }).map((item) =>
			this.delete(item.key),
		);
		return {
			victims: victims.filter((item): item is RuntimeIndexItem<Entry, Value> => item !== undefined),
		};
	}
}

export const toolProviderAdapterRuntimeRetentionIndexes = Object.freeze([
	"adapterInputs",
	"runRequests",
	"executions",
	"runStatuses",
	"runIssues",
	"retentionEvidence",
] as const satisfies readonly ToolProviderAdapterRuntimeRetentionIndex[]);

export function toolProviderAdapterRuntimeRetentionIndex(
	value: string | undefined,
): ToolProviderAdapterRuntimeRetentionIndex | undefined {
	return toolProviderAdapterRuntimeRetentionIndexes.find((index) => index === value);
}

export function isNodeOpt<T>(value: ReactiveOpt<T> | undefined): value is Node<T> {
	return value instanceof Node;
}

export function retentionIndexSourceRef(
	index: ToolProviderAdapterRuntimeRetentionIndex,
): SourceRef {
	return { kind: "tool-provider-adapter-runtime-retention-index", id: index };
}

export function runtimeEvidenceSourceRefs(
	index: ToolProviderAdapterRuntimeRetentionIndex,
	refs: readonly SourceRef[] = [],
): readonly SourceRef[] {
	return canonicalPublicSourceRefs([...refs, retentionIndexSourceRef(index)]);
}

export function runtimeEvidenceMetadata(
	index: ToolProviderAdapterRuntimeRetentionIndex,
	opts: {
		readonly key?: string;
		readonly extra?: Record<string, unknown>;
	} = {},
): Record<string, unknown> {
	return {
		index,
		...(opts.key === undefined ? {} : { key: runtimeDiagnosticKey(opts.key) }),
		...(opts.extra ?? {}),
	};
}

export function runtimeDiagnosticKey(key: string): string {
	return `key:${stableStringHash(key)}:${key.length}`;
}

export const maxRuntimeRetentionScorerStringChars = 256;

export function runtimeRetentionScorerEntry<Entry>(
	index: ToolProviderAdapterRuntimeRetentionIndex,
	entry: Entry,
): Entry {
	if (!isPlainRecord(entry) || publicMaterialForbiddenKeys(entry, "provider").length > 0) {
		throw new TypeError(`unsafe ${index} retention scorer entry`);
	}
	const bounded: Record<string, unknown> = {};
	for (const value of Object.values(entry)) {
		if (value !== undefined && typeof value !== "string" && typeof value !== "number") {
			throw new TypeError(`unsafe ${index} retention scorer entry`);
		}
	}
	for (const [key, value] of Object.entries(entry)) {
		bounded[key] =
			key === "key" && typeof value === "string"
				? runtimeDiagnosticKey(value)
				: typeof value === "string" && value.length > maxRuntimeRetentionScorerStringChars
					? `bounded:${stableStringHash(value)}:${value.length}`
					: value;
	}
	return Object.freeze(bounded) as Entry;
}

export function retentionPolicyMaxSize(
	policy: ToolProviderAdapterRuntimeIndexRetentionPolicy<unknown> | undefined,
): ReactiveOpt<number> | undefined {
	return policy?.maxSize;
}

export function retentionPolicyMode(
	policy: ToolProviderAdapterRuntimeIndexRetentionPolicy<unknown> | undefined,
): RuntimeRetentionMode | undefined {
	if (policy === undefined) return undefined;
	return "score" in policy && policy.score !== undefined ? "score" : "fifo";
}

export function buildRetentionPolicyReaders(
	graph: Graph,
	name: string,
	retention: ToolProviderAdapterRuntimeRetentionPolicy | undefined,
): RuntimeRetentionPolicyReaders {
	const inputs = new PolicyInputs();
	const readers = new Map<ToolProviderAdapterRuntimeRetentionIndex, PolicyReader<number>>();
	const statics = new Map<ToolProviderAdapterRuntimeRetentionIndex, number | undefined>();
	for (const index of toolProviderAdapterRuntimeRetentionIndexes) {
		const policy = retention?.[index] as
			| ToolProviderAdapterRuntimeIndexRetentionPolicy<unknown>
			| undefined;
		const maxSize = retentionPolicyMaxSize(policy);
		if (maxSize === undefined) {
			statics.set(index, undefined);
			readers.set(index, inputs.add(undefined));
			continue;
		}
		const node = isNodeOpt(maxSize)
			? maxSize
			: graph.node<number>([], null, {
					name: `${name}/retentionPolicy/${index}/maxSize`,
					factory: "toolProviderAdapterRuntimeRetentionPolicy.maxSize",
					initial: maxSize,
				});
		if (!isNodeOpt(maxSize)) statics.set(index, maxSize);
		readers.set(index, inputs.add(node));
	}
	return { inputs, readers, statics };
}

export function readRetentionPolicyFact(
	ctx: Ctx,
	retention: ToolProviderAdapterRuntimeRetentionPolicy | undefined,
	readers: RuntimeRetentionPolicyReaders,
	current: RuntimeRetentionPolicyFact | undefined,
): RuntimeRetentionPolicyFact {
	const policies = new Map<ToolProviderAdapterRuntimeRetentionIndex, RuntimeRetentionIndexConfig>();
	const issues: DataIssue[] = [];
	for (const index of toolProviderAdapterRuntimeRetentionIndexes) {
		const raw = retention?.[index] as
			| ToolProviderAdapterRuntimeIndexRetentionPolicy<unknown>
			| undefined;
		if (raw === undefined) continue;
		const reader = readers.readers.get(index);
		const previous = current?.policies.get(index)?.maxSize ?? readers.statics.get(index);
		const maxSize = reader?.read(ctx, previous);
		const issue = validateRuntimeRetentionPolicy(index, raw, maxSize);
		if (issue !== undefined) {
			issues.push(issue);
			continue;
		}
		policies.set(index, {
			maxSize,
			mode: retentionPolicyMode(raw) ?? "fifo",
		});
	}
	return {
		kind: "tool-provider-adapter-runtime-retention-policy",
		policies,
		...(issues.length === 0 ? {} : { issues: Object.freeze(issues) }),
	};
}

export function validateRuntimeRetentionPolicy(
	index: ToolProviderAdapterRuntimeRetentionIndex,
	policy: ToolProviderAdapterRuntimeIndexRetentionPolicy<unknown>,
	maxSize: number | undefined,
): DataIssue | undefined {
	if ("score" in policy && policy.score !== undefined && typeof policy.score !== "function")
		return invalidRetentionPolicyIssue(index, "score must be a function");
	if (!("score" in policy) || policy.score === undefined) {
		const order = (policy as CapacityPolicy<string>).order ?? "fifo";
		if (order !== "fifo") return invalidRetentionPolicyIssue(index, "order must be fifo");
	}
	if (maxSize === undefined || !Number.isSafeInteger(maxSize) || maxSize < 1)
		return invalidRetentionPolicyIssue(index, "maxSize must be a safe integer >= 1");
	return undefined;
}

export function invalidRetentionPolicyIssue(
	index: ToolProviderAdapterRuntimeRetentionIndex,
	reason: string,
): DataIssue {
	return dataIssue(
		"tool-provider-adapter-runtime-invalid-retention-policy",
		"Tool provider adapter runtime retention policy is invalid; last-known-good policy remains active.",
		{
			subjectId: index,
			refs: [retentionIndexSourceRef(index)],
			details: { index, reason },
			severity: "warning",
		},
	);
}

export function adapterInputRetentionEntry(
	key: string,
	sequence: number,
	input: ToolProviderAdapterInput,
	insertedAtMs: number | undefined,
): ToolProviderAdapterInputRetentionEntry {
	return Object.freeze({
		key,
		sequence,
		...(insertedAtMs === undefined ? {} : { insertedAtMs }),
		adapterInputId: input.adapterInputId,
		requestId: input.requestId,
		operationId: input.operationId,
		...(input.routeId === undefined ? {} : { routeId: input.routeId }),
		...(input.providerId === undefined ? {} : { providerId: input.providerId }),
		...(input.executorId === undefined ? {} : { executorId: input.executorId }),
		...(input.profileId === undefined ? {} : { profileId: input.profileId }),
		status: input.status,
	});
}

export function runRequestRetentionEntry(
	key: string,
	sequence: number,
	request: ToolProviderAdapterRunRequested,
): ToolProviderAdapterRunRequestRetentionEntry {
	return Object.freeze({
		key,
		sequence,
		...(request.requestedAtMs === undefined ? {} : { requestedAtMs: request.requestedAtMs }),
		adapterInputId: request.adapterInputId,
		runId: request.runId,
		attempt: request.attempt,
		requestId: request.requestId,
		operationId: request.operationId,
		...(request.routeId === undefined ? {} : { routeId: request.routeId }),
		...(request.providerId === undefined ? {} : { providerId: request.providerId }),
		...(request.executorId === undefined ? {} : { executorId: request.executorId }),
		...(request.profileId === undefined ? {} : { profileId: request.profileId }),
		reason: request.reason,
	});
}

export function executionRetentionEntry(
	key: string,
	sequence: number,
	request: ToolProviderAdapterRunRequested,
	status: ToolProviderAdapterExecutionRetentionEntry["status"],
	occurredAtMs: number | undefined,
	outcomeId?: string,
): ToolProviderAdapterExecutionRetentionEntry {
	return Object.freeze({
		key,
		sequence,
		...(occurredAtMs === undefined ? {} : { occurredAtMs }),
		adapterInputId: request.adapterInputId,
		runId: request.runId,
		attempt: request.attempt,
		requestId: request.requestId,
		operationId: request.operationId,
		...(request.routeId === undefined ? {} : { routeId: request.routeId }),
		...(request.providerId === undefined ? {} : { providerId: request.providerId }),
		...(request.executorId === undefined ? {} : { executorId: request.executorId }),
		...(request.profileId === undefined ? {} : { profileId: request.profileId }),
		...(outcomeId === undefined ? {} : { outcomeId }),
		status,
		reason: request.reason,
	});
}

export function runStatusRetentionEntry(
	key: string,
	sequence: number,
	status: ToolProviderAdapterRunStatus,
	occurredAtMs: number | undefined,
): ToolProviderAdapterRunStatusRetentionEntry {
	const issueCode = status.issues?.[0]?.code;
	return Object.freeze({
		key,
		sequence,
		...(occurredAtMs === undefined ? {} : { occurredAtMs }),
		adapterInputId: status.adapterInputId,
		runId: status.runId,
		...(status.attempt === undefined ? {} : { attempt: status.attempt }),
		...(status.requestId === undefined ? {} : { requestId: status.requestId }),
		...(status.operationId === undefined ? {} : { operationId: status.operationId }),
		status: status.status,
		...(status.outcomeId === undefined ? {} : { outcomeId: status.outcomeId }),
		...(issueCode === undefined ? {} : { issueCode }),
	});
}

export function runIssueRetentionEntry(
	key: string,
	sequence: number,
	issue: DataIssue,
	occurredAtMs: number | undefined,
	context: {
		readonly adapterInputId?: string;
		readonly runId?: string;
		readonly attempt?: number;
		readonly requestId?: string;
		readonly operationId?: string;
	} = {},
): ToolProviderAdapterRunIssueRetentionEntry {
	return Object.freeze({
		key,
		sequence,
		...(occurredAtMs === undefined ? {} : { occurredAtMs }),
		...(context.adapterInputId === undefined ? {} : { adapterInputId: context.adapterInputId }),
		...(context.runId === undefined ? {} : { runId: context.runId }),
		...(context.attempt === undefined ? {} : { attempt: context.attempt }),
		...(context.requestId === undefined ? {} : { requestId: context.requestId }),
		...(context.operationId === undefined ? {} : { operationId: context.operationId }),
		issueCode: issue.code,
		...(issue.severity === undefined ? {} : { severity: issue.severity }),
		...(issue.subjectId === undefined ? {} : { subjectId: issue.subjectId }),
	});
}

export function retentionEvidenceEntry(
	key: string,
	sequence: number,
	opts: {
		readonly adapterInputId: string;
		readonly evidenceKind: ToolProviderAdapterRuntimeRetentionEvidenceEntry["evidenceKind"];
		readonly occurredAtMs?: number;
		readonly attemptHighWater?: number;
		readonly reason: ToolProviderAdapterRuntimeRetentionEvidenceEntry["reason"];
	},
): ToolProviderAdapterRuntimeRetentionEvidenceEntry {
	return Object.freeze({
		key,
		sequence,
		...(opts.occurredAtMs === undefined ? {} : { occurredAtMs: opts.occurredAtMs }),
		adapterInputId: opts.adapterInputId,
		evidenceKind: opts.evidenceKind,
		...(opts.attemptHighWater === undefined ? {} : { attemptHighWater: opts.attemptHighWater }),
		reason: opts.reason,
	});
}
