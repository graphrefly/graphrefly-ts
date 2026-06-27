import { type Ctx, depBatch } from "../ctx/types.js";
import type { DataIssue } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import type { AgentNeed } from "./agent-runtime-types-agent.js";
import type {
	AgentOutputEnvelope,
	ExecutorArtifactMaterial,
	SizeCapacityEvidence,
	SourceRef,
} from "./agent-runtime-types-core.js";
import type {
	ToolProviderAdapterInput,
	ToolProviderExecutionPolicy,
	ToolProviderPublicTextPolicy,
} from "./agent-runtime-types-tool.js";

export function uniqueSourceRefs(sourceRefs: readonly SourceRef[]): readonly SourceRef[] {
	const seen = new Set<string>();
	const unique: SourceRef[] = [];
	for (const sourceRef of sourceRefs) {
		const key = `${sourceRef.kind}:${sourceRef.id}:${JSON.stringify(sourceRef.metadata ?? {})}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(sourceRef);
	}
	return Object.freeze(unique);
}

export function stableJsonStringify(value: unknown): string {
	const seen = new WeakSet<object>();
	return JSON.stringify(value, (_key, child) => {
		if (typeof child === "bigint") return child.toString();
		if (typeof child === "function") return "[Function]";
		if (!isRecord(child) && !Array.isArray(child)) return child;
		if (seen.has(child)) return "[Circular]";
		seen.add(child);
		if (Array.isArray(child)) return child;
		return Object.keys(child)
			.sort()
			.reduce<Record<string, unknown>>((out, key) => {
				out[key] = child[key];
				return out;
			}, {});
	});
}

export function stableStringHash(value: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < value.length; i += 1) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}

export function cloneGraphVisibleMaterial(value: unknown): unknown {
	if (!isRecord(value) && !Array.isArray(value)) return value;
	if (Array.isArray(value))
		return Object.freeze(value.map((item) => cloneGraphVisibleMaterial(item)));
	return Object.freeze(
		Object.entries(value).reduce<Record<string, unknown>>((record, [key, child]) => {
			record[key] = cloneGraphVisibleMaterial(child);
			return record;
		}, {}),
	);
}

export function projectRuntimeFact<T, TOut>(
	graph: Graph,
	runtime: Node<T>,
	name: string,
	factory: string,
	pick: (fact: T) => TOut | undefined,
): Node<TOut> {
	return graph.node<TOut>(
		[runtime],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) {
				const typed = fact as T;
				const value = pick(typed);
				if (value !== undefined) ctx.down([["DATA", value]]);
			}
		},
		{ name, factory },
	);
}

export function forEachDepBatch(
	ctx: Ctx,
	start: number,
	count: number,
	fn: (value: unknown) => void,
): void {
	for (let i = 0; i < count; i += 1) {
		for (const value of depBatch(ctx, start + i) ?? []) fn(value);
	}
}

export function forbiddenDataKeys(
	value: unknown,
	path: readonly (string | number)[] = [],
	seen: WeakSet<object> = new WeakSet(),
): readonly { readonly path: readonly (string | number)[]; readonly reason: string }[] {
	if (typeof value === "function") return [{ path, reason: "function-value" }];
	if (typeof value === "symbol" || typeof value === "bigint") {
		return [{ path, reason: "non-graph-visible-primitive" }];
	}
	if (!isRecord(value) && !Array.isArray(value)) return [];
	if (typeof value === "object" && value !== null) {
		if (seen.has(value)) return [];
		seen.add(value);
	}
	const issues: { readonly path: readonly (string | number)[]; readonly reason: string }[] = [];
	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			issues.push(...forbiddenDataKeys(item, [...path, index], seen));
		});
		return issues;
	}
	if (!isPlainRecord(value)) return [{ path, reason: "non-plain-runtime-object" }];
	const symbolKeys = Object.getOwnPropertySymbols(value);
	if (symbolKeys.length > 0) {
		issues.push({ path, reason: "symbol-key" });
	}
	for (const [key, child] of Object.entries(value)) {
		const nextPath = [...path, key];
		if (
			/^(apiKey|api_key|secret|client|transport|subprocess|sdk|oauth|credential|credentials|accessToken|access_token|refreshToken|refresh_token|idToken|id_token|token|password|passphrase|authorization|authHeader|auth_header|bearer|privateKey|private_key|sessionCookie|session_cookie|cookie)$/i.test(
				key,
			)
		) {
			issues.push({ path: nextPath, reason: "forbidden-runtime-key" });
		}
		issues.push(...forbiddenDataKeys(child, nextPath, seen));
	}
	return issues;
}

export function forbiddenGraphVisibleMaterialIssues(
	value: unknown,
	subjectRef: SourceRef,
	area: string,
): readonly DataIssue[] {
	if (value === undefined) return [];
	const forbidden = publicMaterialForbiddenKeys(value, "provider");
	if (forbidden.length === 0) return [];
	return Object.freeze(
		forbidden.map((entry) =>
			dataIssue(
				"tool-provider-catalog-forbidden-runtime-material",
				"Tool provider catalog material must not contain runtime-private adapter material.",
				{ subjectId: subjectRef.id, refs: [subjectRef], details: { area, reason: entry.reason } },
			),
		),
	);
}

export function forbiddenAdapterInputMaterialIssues(
	value: unknown,
	subjectRef: SourceRef,
	area: string,
): readonly DataIssue[] {
	if (value === undefined) return [];
	const forbidden = publicMaterialForbiddenKeys(value, "provider");
	if (forbidden.length === 0) return [];
	return Object.freeze(
		forbidden.map((entry) =>
			dataIssue(
				"tool-provider-adapter-input-forbidden-runtime-material",
				"Tool provider adapter input material must not contain runtime-private adapter material.",
				{ subjectId: subjectRef.id, refs: [subjectRef], details: { area, reason: entry.reason } },
			),
		),
	);
}

export type PublicMaterialMode = "graph" | "provider";

export function sanitizeAdapterInputSourceRefs(
	sourceRefs: readonly SourceRef[],
): readonly SourceRef[] {
	return canonicalPublicSourceRefs(sourceRefs);
}

export function sanitizeGraphVisibleRecord<T extends Record<string, unknown> | undefined>(
	value: T,
	policy?: ToolProviderPublicTextPolicy,
): T | undefined {
	return sanitizePublicRecord(value, { mode: "graph", policy });
}

export function sanitizeProviderGraphVisibleRecord<T extends Record<string, unknown> | undefined>(
	value: T,
	policy?: ToolProviderPublicTextPolicy,
): T | undefined {
	return sanitizePublicRecord(value, { mode: "provider", policy });
}

export function canonicalPublicSourceRefs(sourceRefs: readonly SourceRef[]): readonly SourceRef[] {
	return uniqueSourceRefs(
		sourceRefs.map((sourceRef) => {
			const metadata = sanitizePublicRecord(sourceRef.metadata, { mode: "provider" });
			return metadata === undefined
				? { kind: sourceRef.kind, id: sourceRef.id }
				: { kind: sourceRef.kind, id: sourceRef.id, metadata };
		}),
	);
}

export function sanitizePublicRecord<T extends Record<string, unknown> | undefined>(
	value: T,
	opts: {
		readonly mode: PublicMaterialMode;
		readonly policy?: ToolProviderPublicTextPolicy;
	},
): T | undefined {
	if (value === undefined || publicMaterialForbiddenKeys(value, opts.mode).length > 0) {
		return undefined;
	}
	return Object.freeze(boundRecordStrings(value, maxPublicMetadataStringChars(opts.policy))) as T;
}

export function publicMaterialForbiddenKeys(
	value: unknown,
	mode: PublicMaterialMode,
): readonly { readonly path: readonly (string | number)[]; readonly reason: string }[] {
	const forbidden = [...forbiddenDataKeys(value)];
	if (mode === "provider") forbidden.push(...forbiddenProviderRawMaterialKeys(value));
	return forbidden;
}

export function unlockedToolProviderPolicyOverrides(
	overrides:
		| Partial<Omit<ToolProviderExecutionPolicy, "kind" | "policyId" | "providerId">>
		| undefined,
): Partial<Omit<ToolProviderExecutionPolicy, "kind" | "policyId" | "providerId">> | undefined {
	if (overrides === undefined) return undefined;
	const rest = { ...(overrides as Record<string, unknown>) };
	delete rest.kind;
	delete rest.policyId;
	delete rest.providerId;
	return rest as Partial<Omit<ToolProviderExecutionPolicy, "kind" | "policyId" | "providerId">>;
}

export function sanitizeAgentOutputEnvelope<T>(
	envelope: AgentOutputEnvelope<T>,
	input: ToolProviderAdapterInput,
	policy: ToolProviderPublicTextPolicy | undefined,
	issues: DataIssue[],
): AgentOutputEnvelope<T> {
	const summary =
		envelope.summary === undefined
			? undefined
			: boundedPublicText(envelope.summary, "summary", input, policy, issues);
	const metadata = sanitizeRuntimeMetadata(envelope.metadata, input, policy, issues);
	if (metadata === undefined && envelope.metadata !== undefined) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-runtime-metadata-redacted",
				"Tool provider adapter runtime metadata was omitted because it contained runtime-private material.",
				{
					subjectId: input.requestId,
					refs: [ref("tool-provider-adapter-input", input.adapterInputId)],
					severity: "warning",
				},
			),
		);
	}
	const value = sanitizeInlineOutputValue(envelope.value, input, policy, issues);
	return Object.freeze({
		kind: envelope.kind,
		value: value as T | undefined,
		refs: envelope.refs === undefined ? undefined : sanitizeAdapterInputSourceRefs(envelope.refs),
		summary,
		artifacts:
			envelope.artifacts === undefined
				? undefined
				: Object.freeze(
						envelope.artifacts.map((artifact) =>
							sanitizeExecutorArtifactMaterial(artifact, input, policy, issues),
						),
					),
		metadata,
	} satisfies AgentOutputEnvelope<T>);
}

export function sanitizeExecutorArtifactMaterial(
	artifact: ExecutorArtifactMaterial,
	input: ToolProviderAdapterInput,
	policy: ToolProviderPublicTextPolicy | undefined,
	issues: DataIssue[],
): ExecutorArtifactMaterial {
	const metadata = sanitizeRuntimeMetadata(artifact.metadata, input, policy, issues);
	const redaction = sanitizeRuntimeMetadata(artifact.redaction, input, policy, issues);
	return Object.freeze({
		kind: artifact.kind,
		...(artifact.format === undefined ? {} : { format: artifact.format }),
		...(artifact.schemaRef === undefined ? {} : { schemaRef: artifact.schemaRef }),
		...(artifact.schemaKind === undefined ? {} : { schemaKind: artifact.schemaKind }),
		...(artifact.mimeType === undefined ? {} : { mimeType: artifact.mimeType }),
		...(artifact.mediaType === undefined ? {} : { mediaType: artifact.mediaType }),
		...(artifact.filename === undefined ? {} : { filename: artifact.filename }),
		...(artifact.byteLength === undefined ? {} : { byteLength: artifact.byteLength }),
		...(artifact.digest === undefined ? {} : { digest: artifact.digest }),
		...(artifact.encoding === undefined ? {} : { encoding: artifact.encoding }),
		dataMode: artifact.dataMode,
		...(artifact.summary === undefined
			? {}
			: { summary: boundedPublicText(artifact.summary, "summary", input, policy, issues) }),
		...(artifact.value === undefined
			? {}
			: { value: sanitizeInlineOutputValue(artifact.value, input, policy, issues) }),
		...(artifact.ref === undefined
			? {}
			: { ref: sanitizeAdapterInputSourceRefs([artifact.ref])[0] }),
		...(artifact.refs === undefined ? {} : { refs: sanitizeAdapterInputSourceRefs(artifact.refs) }),
		...(artifact.sourceRefs === undefined
			? {}
			: { sourceRefs: sanitizeAdapterInputSourceRefs(artifact.sourceRefs) }),
		...(artifact.sizeEvidence === undefined
			? {}
			: {
					sizeEvidence: Object.freeze(
						artifact.sizeEvidence.map((evidence) =>
							sanitizeSizeCapacityEvidence(evidence, input, policy, issues),
						),
					),
				}),
		...(artifact.sensitivity === undefined
			? {}
			: { sensitivity: Object.freeze([...artifact.sensitivity]) }),
		...(redaction === undefined ? {} : { redaction }),
		...(metadata === undefined ? {} : { metadata }),
	} satisfies ExecutorArtifactMaterial);
}

function sanitizeSizeCapacityEvidence(
	evidence: SizeCapacityEvidence,
	input: ToolProviderAdapterInput,
	policy: ToolProviderPublicTextPolicy | undefined,
	issues: DataIssue[],
): SizeCapacityEvidence {
	const metadata = sanitizeRuntimeMetadata(evidence.metadata, input, policy, issues);
	const redaction = sanitizeRuntimeMetadata(evidence.redaction, input, policy, issues);
	return Object.freeze({
		kind: "size-capacity-evidence",
		unit: evidence.unit,
		quantity: evidence.quantity,
		measurementSource: evidence.measurementSource,
		...(evidence.estimated === undefined ? {} : { estimated: evidence.estimated }),
		...(evidence.encoding === undefined ? {} : { encoding: evidence.encoding }),
		...(evidence.mediaType === undefined ? {} : { mediaType: evidence.mediaType }),
		...(evidence.sourceRefs === undefined
			? {}
			: { sourceRefs: sanitizeAdapterInputSourceRefs(evidence.sourceRefs) }),
		...(evidence.refs === undefined ? {} : { refs: sanitizeAdapterInputSourceRefs(evidence.refs) }),
		...(evidence.issues === undefined
			? {}
			: {
					issues: Object.freeze(evidence.issues.map((issue) => sanitizeAdapterInputIssue(issue))),
				}),
		...(evidence.sensitivity === undefined
			? {}
			: { sensitivity: Object.freeze([...evidence.sensitivity]) }),
		...(redaction === undefined ? {} : { redaction }),
		...(metadata === undefined ? {} : { metadata }),
	} satisfies SizeCapacityEvidence);
}

export function sanitizeAgentNeed(
	need: AgentNeed,
	input: ToolProviderAdapterInput,
	policy: ToolProviderPublicTextPolicy | undefined,
	issues: DataIssue[],
): AgentNeed {
	const metadata = sanitizeRuntimeMetadata(need.metadata, input, policy, issues);
	if (metadata === undefined && need.metadata !== undefined) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-runtime-metadata-redacted",
				"Tool provider adapter runtime metadata was omitted because it contained runtime-private material.",
				{
					subjectId: input.requestId,
					refs: [ref("tool-provider-adapter-input", input.adapterInputId)],
					severity: "warning",
				},
			),
		);
	}
	return Object.freeze({
		kind: need.kind,
		message:
			need.message === undefined
				? undefined
				: boundedPublicText(need.message, "message", input, policy, issues),
		refs: need.refs === undefined ? undefined : sanitizeAdapterInputSourceRefs(need.refs),
		metadata,
	} satisfies AgentNeed);
}

export function sanitizeRuntimeMetadata<T extends Record<string, unknown> | undefined>(
	value: T,
	input: ToolProviderAdapterInput,
	policy: ToolProviderPublicTextPolicy | undefined,
	issues: DataIssue[],
): T | undefined {
	if (value === undefined) return undefined;
	const bounded = sanitizePublicRecordWithEvidence(value, { mode: "provider", policy });
	if (bounded === undefined) return undefined;
	for (const entry of bounded.truncated) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-runtime-public-text-truncated",
				"Tool provider adapter runtime public text was truncated; large/raw material must use artifact summary/ref envelopes.",
				{
					subjectId: input.requestId,
					refs: [ref("tool-provider-adapter-input", input.adapterInputId)],
					severity: "warning",
					details: {
						field: "metadata",
						path: entry.path.join("."),
						originalChars: entry.originalChars,
						limitChars: entry.limitChars,
						unit: "chars",
						measurementSource: "js-string-length",
					},
				},
			),
		);
	}
	return Object.freeze(bounded.value) as T;
}

export function sanitizePublicRecordWithEvidence(
	value: Record<string, unknown>,
	opts: {
		readonly mode: PublicMaterialMode;
		readonly policy?: ToolProviderPublicTextPolicy;
	},
):
	| {
			readonly value: Record<string, unknown>;
			readonly truncated: readonly {
				readonly path: readonly (string | number)[];
				readonly originalChars: number;
				readonly limitChars: number;
			}[];
	  }
	| undefined {
	if (publicMaterialForbiddenKeys(value, opts.mode).length > 0) return undefined;
	return boundRecordStringsWithEvidence(value, maxPublicMetadataStringChars(opts.policy));
}

export function sanitizeInlineOutputValue(
	value: unknown,
	input: ToolProviderAdapterInput,
	policy: ToolProviderPublicTextPolicy | undefined,
	issues: DataIssue[],
): unknown {
	if (value === undefined) return undefined;
	const forbidden = [
		...publicMaterialForbiddenKeys(value, "provider"),
		...oversizedInlineTextKeys(value, maxPublicSummaryChars(policy)),
	];
	if (forbidden.length === 0) return cloneGraphVisibleMaterial(value);
	for (const entry of forbidden) {
		issues.push(
			dataIssue(
				"tool-provider-adapter-runtime-forbidden-runtime-material",
				"Tool provider adapter runtime output value must not inline runtime-private, raw, or oversized provider material.",
				{
					subjectId: input.requestId,
					refs: [ref("tool-provider-adapter-input", input.adapterInputId)],
					details: { reason: entry.reason },
				},
			),
		);
	}
	return undefined;
}

export function boundedPublicText(
	text: string,
	field: "message" | "reason" | "summary",
	input: ToolProviderAdapterInput,
	policy: ToolProviderPublicTextPolicy | undefined,
	issues: DataIssue[],
): string {
	const limit =
		field === "summary"
			? maxPublicSummaryChars(policy)
			: field === "reason"
				? maxPublicReasonChars(policy)
				: maxPublicMessageChars(policy);
	const bounded = boundPublicText(text, limit);
	if (!bounded.truncated) return bounded.text;
	issues.push(
		dataIssue(
			"tool-provider-adapter-runtime-public-text-truncated",
			"Tool provider adapter runtime public text was truncated; large/raw material must use artifact summary/ref envelopes.",
			{
				subjectId: input.requestId,
				refs: [ref("tool-provider-adapter-input", input.adapterInputId)],
				severity: "warning",
				details: {
					field,
					originalChars: bounded.originalChars,
					limitChars: bounded.limitChars,
					unit: "chars",
					measurementSource: "js-string-length",
				},
			},
		),
	);
	return bounded.text;
}

export function boundPublicText(
	text: string,
	limitChars: number,
): {
	readonly text: string;
	readonly truncated: boolean;
	readonly originalChars: number;
	readonly limitChars: number;
} {
	const limit = Math.max(0, limitChars);
	if (text.length <= limit) {
		return { text, truncated: false, originalChars: text.length, limitChars: limit };
	}
	const bounded =
		limit <= 1
			? text.slice(0, limit)
			: limit <= 3
				? text.slice(0, limit)
				: `${text.slice(0, limit - 3)}...`;
	return { text: bounded, truncated: true, originalChars: text.length, limitChars: limit };
}

export function boundRecordStrings(
	value: Record<string, unknown>,
	limitChars: number,
	seen: WeakSet<object> = new WeakSet(),
): Record<string, unknown> {
	if (seen.has(value)) return {};
	seen.add(value);
	return Object.entries(value).reduce<Record<string, unknown>>((out, [key, child]) => {
		if (typeof child === "string") {
			out[key] = boundPublicText(child, limitChars).text;
		} else if (Array.isArray(child)) {
			out[key] = child.map((item) =>
				typeof item === "string"
					? boundPublicText(item, limitChars).text
					: isPlainRecord(item)
						? boundRecordStrings(item, limitChars, seen)
						: item,
			);
		} else if (isPlainRecord(child)) {
			out[key] = boundRecordStrings(child, limitChars, seen);
		} else {
			out[key] = child;
		}
		return out;
	}, {});
}

export function boundRecordStringsWithEvidence(
	value: Record<string, unknown>,
	limitChars: number,
	path: readonly (string | number)[] = [],
	seen: WeakSet<object> = new WeakSet(),
): {
	readonly value: Record<string, unknown>;
	readonly truncated: readonly {
		readonly path: readonly (string | number)[];
		readonly originalChars: number;
		readonly limitChars: number;
	}[];
} {
	if (seen.has(value)) return { value: {}, truncated: [] };
	seen.add(value);
	const truncated: {
		readonly path: readonly (string | number)[];
		readonly originalChars: number;
		readonly limitChars: number;
	}[] = [];
	const out = Object.entries(value).reduce<Record<string, unknown>>((record, [key, child]) => {
		const childPath = [...path, key];
		if (typeof child === "string") {
			const bounded = boundPublicText(child, limitChars);
			record[key] = bounded.text;
			if (bounded.truncated) {
				truncated.push({
					path: childPath,
					originalChars: bounded.originalChars,
					limitChars: bounded.limitChars,
				});
			}
		} else if (Array.isArray(child)) {
			record[key] = child.map((item, index) => {
				const itemPath = [...childPath, index];
				if (typeof item === "string") {
					const bounded = boundPublicText(item, limitChars);
					if (bounded.truncated) {
						truncated.push({
							path: itemPath,
							originalChars: bounded.originalChars,
							limitChars: bounded.limitChars,
						});
					}
					return bounded.text;
				}
				if (isPlainRecord(item)) {
					const nested = boundRecordStringsWithEvidence(item, limitChars, itemPath, seen);
					truncated.push(...nested.truncated);
					return nested.value;
				}
				return item;
			});
		} else if (isPlainRecord(child)) {
			const nested = boundRecordStringsWithEvidence(child, limitChars, childPath, seen);
			record[key] = nested.value;
			truncated.push(...nested.truncated);
		} else {
			record[key] = child;
		}
		return record;
	}, {});
	return { value: out, truncated };
}

export function sanitizeIssueDetails(
	details: unknown,
	policy?: ToolProviderPublicTextPolicy,
): unknown {
	if (details === undefined) return undefined;
	if (publicMaterialForbiddenKeys(details, "provider").length > 0) {
		return { redacted: true, reason: "forbidden-runtime-material" };
	}
	const bounded = boundUnknownStringsWithEvidence(details, maxPublicMetadataStringChars(policy));
	if (bounded.truncated.length === 0) return bounded.value;
	const detailsTruncated = {
		detailsTruncated: true,
		detailsTruncatedPaths: bounded.truncated.map((entry) => entry.path.join(".")),
		measurementSource: "js-string-length",
	};
	if (isPlainRecord(bounded.value)) {
		return Object.freeze({ ...bounded.value, ...detailsTruncated });
	}
	return Object.freeze({ value: bounded.value, ...detailsTruncated });
}

export function boundUnknownStringsWithEvidence(
	value: unknown,
	limitChars: number,
	path: readonly (string | number)[] = [],
	seen: WeakSet<object> = new WeakSet(),
): {
	readonly value: unknown;
	readonly truncated: readonly {
		readonly path: readonly (string | number)[];
		readonly originalChars: number;
		readonly limitChars: number;
	}[];
} {
	if (typeof value === "string") {
		const bounded = boundPublicText(value, limitChars);
		return {
			value: bounded.text,
			truncated: bounded.truncated
				? [{ path, originalChars: bounded.originalChars, limitChars: bounded.limitChars }]
				: [],
		};
	}
	if (!isRecord(value) && !Array.isArray(value)) return { value, truncated: [] };
	if (typeof value === "object" && value !== null) {
		if (seen.has(value)) return { value: Array.isArray(value) ? [] : {}, truncated: [] };
		seen.add(value);
	}
	const truncated: {
		readonly path: readonly (string | number)[];
		readonly originalChars: number;
		readonly limitChars: number;
	}[] = [];
	if (Array.isArray(value)) {
		const out = value.map((item, index) => {
			const bounded = boundUnknownStringsWithEvidence(item, limitChars, [...path, index], seen);
			truncated.push(...bounded.truncated);
			return bounded.value;
		});
		return { value: out, truncated };
	}
	const out = Object.entries(value).reduce<Record<string, unknown>>((record, [key, child]) => {
		const bounded = boundUnknownStringsWithEvidence(child, limitChars, [...path, key], seen);
		record[key] = bounded.value;
		truncated.push(...bounded.truncated);
		return record;
	}, {});
	return { value: out, truncated };
}

export function oversizedInlineTextKeys(
	value: unknown,
	limitChars: number,
	path: readonly (string | number)[] = [],
	seen: WeakSet<object> = new WeakSet(),
): readonly { readonly path: readonly (string | number)[]; readonly reason: string }[] {
	if (typeof value === "string") {
		return value.length > Math.max(0, limitChars)
			? [{ path, reason: "oversized-inline-text" }]
			: [];
	}
	if (!isRecord(value) && !Array.isArray(value)) return [];
	if (typeof value === "object" && value !== null) {
		if (seen.has(value)) return [];
		seen.add(value);
	}
	const issues: { readonly path: readonly (string | number)[]; readonly reason: string }[] = [];
	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			issues.push(...oversizedInlineTextKeys(item, limitChars, [...path, index], seen));
		});
		return issues;
	}
	for (const [key, child] of Object.entries(value)) {
		issues.push(...oversizedInlineTextKeys(child, limitChars, [...path, key], seen));
	}
	return issues;
}

export function maxPublicMessageChars(policy?: ToolProviderPublicTextPolicy): number {
	return normalizedPublicTextLimit(policy?.maxMessageChars, 512);
}

export function maxPublicSummaryChars(policy?: ToolProviderPublicTextPolicy): number {
	return normalizedPublicTextLimit(policy?.maxSummaryChars, 512);
}

export function maxPublicReasonChars(policy?: ToolProviderPublicTextPolicy): number {
	return normalizedPublicTextLimit(policy?.maxReasonChars, 512);
}

export function maxPublicMetadataStringChars(policy?: ToolProviderPublicTextPolicy): number {
	return normalizedPublicTextLimit(policy?.maxMetadataStringChars, 256);
}

export function normalizedPublicTextLimit(value: number | undefined, fallback: number): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.max(0, Math.floor(value));
}

export function sanitizeAdapterInputIssue(
	issue: DataIssue,
	policy?: ToolProviderPublicTextPolicy,
): DataIssue {
	const boundedMessage = boundPublicText(issue.message, maxPublicMessageChars(policy));
	const details = sanitizeIssueDetails(issue.details, policy);
	const metadata = sanitizeProviderGraphVisibleRecord(issue.metadata, policy);
	const refs =
		issue.refs === undefined
			? undefined
			: Object.freeze(issue.refs.filter((entry): entry is string => typeof entry === "string"));
	return Object.freeze({
		kind: issue.kind,
		code: issue.code,
		...(issue.source === undefined ? {} : { source: issue.source }),
		message: boundedMessage.text,
		severity: issue.severity,
		subjectId: issue.subjectId,
		...(issue.correlationId === undefined ? {} : { correlationId: issue.correlationId }),
		...(issue.causationId === undefined ? {} : { causationId: issue.causationId }),
		...(issue.path === undefined ? {} : { path: Object.freeze([...issue.path]) }),
		...(refs === undefined || refs.length === 0 ? {} : { refs }),
		...(issue.retryable === undefined ? {} : { retryable: issue.retryable }),
		details:
			boundedMessage.truncated || details !== issue.details
				? {
						...(isRecord(details) ? details : {}),
						...(boundedMessage.truncated
							? {
									truncated: true,
									originalChars: boundedMessage.originalChars,
									limitChars: boundedMessage.limitChars,
									measurementSource: "js-string-length",
								}
							: {}),
					}
				: details,
		...(metadata === undefined ? {} : { metadata }),
	} satisfies DataIssue);
}

export function forbiddenProviderRawMaterialKeys(
	value: unknown,
	path: readonly (string | number)[] = [],
	seen: WeakSet<object> = new WeakSet(),
): readonly { readonly path: readonly (string | number)[]; readonly reason: string }[] {
	if (!isRecord(value) && !Array.isArray(value)) return [];
	if (typeof value === "object" && value !== null) {
		if (seen.has(value)) return [];
		seen.add(value);
	}
	const issues: { readonly path: readonly (string | number)[]; readonly reason: string }[] = [];
	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			issues.push(...forbiddenProviderRawMaterialKeys(item, [...path, index], seen));
		});
		return issues;
	}
	for (const [key, child] of Object.entries(value)) {
		const nextPath = [...path, key];
		if (
			/^(stdout|stderr|stack|stackTrace|stack_trace|providerRaw|provider_raw|rawResponse|raw_response|diff|patch|fileContents|file_contents|binary|media)$/i.test(
				key,
			)
		) {
			issues.push({ path: nextPath, reason: "raw-provider-material" });
		}
		issues.push(...forbiddenProviderRawMaterialKeys(child, nextPath, seen));
	}
	return issues;
}

export function dataIssue(
	code: string,
	message: string,
	opts: {
		readonly subjectId?: string;
		readonly refs?: readonly SourceRef[];
		readonly severity?: DataIssue["severity"];
		readonly details?: unknown;
	} = {},
): DataIssue {
	return {
		kind: "issue",
		code,
		message,
		severity: opts.severity ?? "error",
		subjectId: opts.subjectId,
		refs: opts.refs?.map((r) => `${r.kind}:${r.id}`),
		details: opts.details,
	};
}

export function ref(kind: string, id: string): SourceRef {
	return { kind, id };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (!isRecord(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}
