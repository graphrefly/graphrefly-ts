import { depBatch } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey } from "../identity.js";
import { stableJsonString } from "../json/codec.js";
import type { Node } from "../node/node.js";
import { merge } from "../operators/index.js";

export interface SolutionOccurrenceSourceRef {
	readonly kind: string;
	readonly id: string;
}

export interface SolutionOccurrence<T> {
	readonly occurrenceId: string;
	readonly occurrenceRevision: number;
	readonly occurrenceDigest: string;
	readonly occurrenceSourceRefs: readonly SolutionOccurrenceSourceRef[];
	readonly value: T;
}

/** Package-private projection of an already validated occurrence; never drops its identity. */
export function solutionOccurrenceSelect<T, R>(
	graph: Graph,
	input: Node<SolutionOccurrence<T>>,
	name: string,
	factory: string,
	select: (value: T) => R,
): Node<SolutionOccurrence<R>> {
	return graph.node<SolutionOccurrence<R>>(
		[input],
		(ctx) => {
			const outputs = (depBatch(ctx, 0) ?? []).map((raw) => {
				const occurrence = raw as SolutionOccurrence<T>;
				return ["DATA", Object.freeze({ ...occurrence, value: select(occurrence.value) })] as const;
			});
			if (outputs.length > 0) ctx.down(outputs);
		},
		{ name, factory },
	);
}

/**
 * Package-private exact join of two validated projections of the same occurrence.
 * Both lanes must originate in a validated occurrence lifecycle. A wave is not
 * the correlation key. Retention (including completed replay identities) is bounded
 * for this graph-lifetime bundle (the retained controller keeps its lanes active);
 * incomplete pairs stay quiet and never borrow a latest value.
 */
export function solutionOccurrenceJoin<L, R, O>(
	graph: Graph,
	left: Node<SolutionOccurrence<L>>,
	right: Node<SolutionOccurrence<R>>,
	opts: Readonly<{
		name: string;
		factory: string;
		maxOccurrences: number;
		project: (left: L, right: R) => O;
	}>,
): Node<SolutionOccurrence<O>> {
	if (!Number.isSafeInteger(opts.maxOccurrences) || opts.maxOccurrences < 1)
		throw new TypeError("solution occurrence join bound must be positive");
	type Arrival =
		| Readonly<{ lane: 0; values: readonly SolutionOccurrence<L>[] }>
		| Readonly<{ lane: 1; values: readonly SolutionOccurrence<R>[] }>;
	const arrivals = graph.initNode(
		merge<Arrival>(),
		[
			graph.node<Arrival>(
				[left],
				(ctx) => {
					const batch = depBatch(ctx, 0) ?? [];
					if (batch.length > 0)
						ctx.down([["DATA", { lane: 0, values: batch as readonly SolutionOccurrence<L>[] }]]);
				},
				{ name: `${opts.name}/left`, factory: "solutionOccurrenceJoinLeft" },
			),
			graph.node<Arrival>(
				[right],
				(ctx) => {
					const batch = depBatch(ctx, 0) ?? [];
					if (batch.length > 0)
						ctx.down([["DATA", { lane: 1, values: batch as readonly SolutionOccurrence<R>[] }]]);
				},
				{ name: `${opts.name}/right`, factory: "solutionOccurrenceJoinRight" },
			),
		],
		{ name: `${opts.name}/arrivals` },
	);
	type Pair = Readonly<{
		left?: SolutionOccurrence<L>;
		right?: SolutionOccurrence<R>;
		leftKey?: string;
		rightKey?: string;
		complete?: true;
	}>;
	const matched = graph.node<SolutionOccurrence<O>>(
		[arrivals],
		(ctx) => {
			const pairs = new Map(ctx.state.get<Map<string, Pair>>());
			for (const raw of depBatch(ctx, 0) ?? []) {
				const { lane, values } = raw as Arrival;
				for (const value of values) {
					const id = canonicalTupleKey([value.occurrenceId, String(value.occurrenceRevision)]);
					const key = occurrenceValueKey(value);
					const prior = pairs.get(id);
					if (prior === undefined && pairs.size >= opts.maxOccurrences)
						throw new Error("solution occurrence join retention bound exceeded");
					const priorKey = lane === 0 ? prior?.leftKey : prior?.rightKey;
					if (priorKey !== undefined && priorKey !== key)
						throw new Error("solution occurrence join replay conflict");
					if (prior?.complete) continue;
					pairs.set(
						id,
						lane === 0
							? { ...prior, left: value as SolutionOccurrence<L>, leftKey: key }
							: { ...prior, right: value as SolutionOccurrence<R>, rightKey: key },
					);
				}
			}
			const outputs: SolutionOccurrence<O>[] = [];
			for (const [id, pair] of pairs) {
				if (pair.complete || pair.left === undefined || pair.right === undefined) continue;
				if (
					pair.left.occurrenceDigest !== pair.right.occurrenceDigest ||
					occurrenceValueKey(pair.left.occurrenceSourceRefs) !==
						occurrenceValueKey(pair.right.occurrenceSourceRefs)
				)
					throw new Error("solution occurrence join provenance mismatch");
				outputs.push(
					Object.freeze({ ...pair.left, value: opts.project(pair.left.value, pair.right.value) }),
				);
				pairs.set(id, { leftKey: pair.leftKey, rightKey: pair.rightKey, complete: true });
			}
			ctx.state.set(pairs);
			if (outputs.length > 0) ctx.down(outputs.map((output) => ["DATA", output]));
		},
		{ name: `${opts.name}/matched`, factory: "solutionOccurrenceMatched" },
	);
	const pullId = Symbol(`${opts.name}/accepted`);
	const port = graph.node<SolutionOccurrence<O>>(
		[matched],
		(ctx) => {
			const values = depBatch(ctx, 0) ?? [];
			if (values.length > 0) ctx.down(values.map((value) => ["DATA", value]));
		},
		{
			name: `${opts.name}/released`,
			factory: "solutionOccurrenceQuietPort",
			pullId,
			pausable: "resumeAll",
			meta: {
				role: "quiet-complete-occurrence",
				correlation: "exact-id/revision/digest/source-refs",
			},
		},
	);
	// Ordinary output preserves the library's cached snapshot semantics for late consumers.
	// Only the internal port is pull-quiet; bounded replay preserves initial complete DATA.
	const accepted = graph.node<SolutionOccurrence<O>>(
		[port],
		(ctx) => {
			const values = depBatch(ctx, 0) ?? [];
			if (values.length > 0) ctx.down(values.map((value) => ["DATA", value]));
		},
		{ name: opts.name, factory: opts.factory, replayBuffer: opts.maxOccurrences },
	);
	const releases = graph.initNode(merge<SolutionOccurrence<O>>(), [accepted, matched], {
		name: `${opts.name}/release-events`,
	});
	const release = graph.node(
		[releases],
		(ctx) => {
			const seen = ctx.state.get<Set<string>>() ?? new Set<string>();
			let fresh = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const value = raw as SolutionOccurrence<O>;
				const key = canonicalTupleKey([value.occurrenceId, String(value.occurrenceRevision)]);
				if (seen.has(key)) continue;
				if (seen.size >= opts.maxOccurrences)
					throw new TypeError("solution occurrence release bound exceeded");
				seen.add(key);
				fresh = true;
			}
			ctx.state.set(seen);
			if (fresh) ctx.upNext([["PULL", { pullId }]]);
		},
		{ name: `${opts.name}/release-controller`, factory: "solutionOccurrenceReleaseController" },
	);
	graph.retain(release, { reason: `${opts.name} only releases complete matched occurrences` });
	return accepted;
}

interface SolutionOccurrenceLedgerEntry {
	readonly revision: number;
	readonly digest: string;
	readonly sourceRefsKey: string;
	readonly valueKey: string;
}

function canonicalOccurrenceValue(value: unknown, seen = new Set<object>()): unknown {
	if (value === null) return ["null"];
	if (typeof value === "string" || typeof value === "boolean") return [typeof value, value];
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError("solution occurrence number must be finite");
		return ["number", Object.is(value, -0) ? "-0" : value];
	}
	if (typeof value === "bigint") return ["bigint", value.toString()];
	if (typeof value !== "object") throw new TypeError("solution occurrence DATA must be data-only");
	if (seen.has(value)) throw new TypeError("solution occurrence DATA must not be circular");
	seen.add(value);
	try {
		const descriptors = Object.getOwnPropertyDescriptors(value);
		if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string"))
			throw new TypeError("solution occurrence DATA cannot contain symbol keys");
		if (Object.values(descriptors).some((descriptor) => !Object.hasOwn(descriptor, "value")))
			throw new TypeError("solution occurrence DATA cannot contain accessors");
		if (Array.isArray(value)) {
			const length = descriptors.length?.value;
			if (
				!Number.isSafeInteger(length) ||
				length < 0 ||
				Object.keys(descriptors).length !== length + 1
			)
				throw new TypeError("solution occurrence DATA must use dense arrays");
			return [
				"array",
				Array.from({ length }, (_, index) => {
					const descriptor = descriptors[String(index)];
					if (descriptor === undefined)
						throw new TypeError("solution occurrence DATA must use dense arrays");
					return canonicalOccurrenceValue(descriptor.value, seen);
				}),
			];
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null)
			throw new TypeError("solution occurrence DATA must use plain objects");
		return [
			"object",
			Object.keys(descriptors)
				.sort()
				.map((key) => [key, canonicalOccurrenceValue(descriptors[key]!.value, seen)]),
		];
	} catch {
		// Hostile Proxy/accessor diagnostics are never allowed to echo private input.
		throw new TypeError("solution occurrence DATA is not safely inspectable");
	} finally {
		seen.delete(value);
	}
}

function occurrenceValueKey(value: unknown): string {
	return canonicalTupleKey([
		"solution-occurrence-value",
		stableJsonString(canonicalOccurrenceValue(value)),
	]);
}

/** Detach the same descriptor-read DATA we fingerprint; never execute a getter. */
function occurrenceSnapshot<T>(value: T): T {
	const seen = new Set<object>();
	const copy = (item: unknown): unknown => {
		if (item === null || typeof item !== "object") return item;
		if (seen.has(item)) throw new TypeError("circular occurrence DATA");
		seen.add(item);
		try {
			const descriptors = Object.getOwnPropertyDescriptors(item);
			if (
				Reflect.ownKeys(descriptors).some((key) => typeof key !== "string") ||
				Object.values(descriptors).some((field) => !Object.hasOwn(field, "value"))
			)
				throw new TypeError("occurrence DATA has non-data fields");
			if (Array.isArray(item)) {
				const length = descriptors.length?.value;
				if (
					!Number.isSafeInteger(length) ||
					length < 0 ||
					Object.keys(descriptors).length !== length + 1
				)
					throw new TypeError("invalid occurrence array");
				return Object.freeze(
					Array.from({ length }, (_, index) => {
						const field = descriptors[String(index)];
						if (field === undefined) throw new TypeError("sparse occurrence array");
						return copy(field.value);
					}),
				);
			}
			const prototype = Object.getPrototypeOf(item);
			if (prototype !== Object.prototype && prototype !== null)
				throw new TypeError("non-plain occurrence DATA");
			return Object.freeze(
				Object.fromEntries(
					Object.entries(descriptors).map(([key, field]) => [key, copy(field.value)]),
				),
			);
		} finally {
			seen.delete(item);
		}
	};
	try {
		return copy(value) as T;
	} catch {
		throw new TypeError("solution occurrence DATA is not safely inspectable");
	}
}

/** Package-private D151 exact occurrence projection shared by real solution segments. */
export function solutionOccurrenceProjection<TInput, TOutput>(
	graph: Graph,
	input: Node<SolutionOccurrence<TInput>>,
	opts: Readonly<{
		readonly name: string;
		readonly factory: string;
		readonly maxOccurrences: number;
		readonly project: (value: TInput) => TOutput;
		/** Domain validation may precede fingerprinting; invalid DATA grants no authority. */
		readonly identity?: (value: TInput, projected: TOutput) => unknown;
	}>,
): Node<SolutionOccurrence<TOutput>> {
	if (!Number.isSafeInteger(opts.maxOccurrences) || opts.maxOccurrences < 1)
		throw new TypeError("solution occurrence retention bound must be a positive safe integer");
	return graph.node<SolutionOccurrence<TOutput>>(
		[input],
		(ctx) => {
			// Stage the whole batch. A failed projection must not commit replay authority.
			const ledger = new Map(ctx.state.get<Map<string, SolutionOccurrenceLedgerEntry>>());
			const outputs: SolutionOccurrence<TOutput>[] = [];
			for (const raw of depBatch(ctx, 0) ?? []) {
				if (raw === null || typeof raw !== "object")
					throw new TypeError("solution occurrence DATA must be an object");
				let occurrence: SolutionOccurrence<TInput>;
				try {
					const fields = Object.getOwnPropertyDescriptors(raw);
					if (
						Reflect.ownKeys(fields).length !== 5 ||
						[
							"occurrenceId",
							"occurrenceRevision",
							"occurrenceDigest",
							"occurrenceSourceRefs",
							"value",
						].some((key) => fields[key] === undefined || !Object.hasOwn(fields[key]!, "value"))
					)
						throw new TypeError("invalid envelope");
					occurrence = Object.fromEntries(
						Object.entries(fields).map(([key, field]) => [key, field.value]),
					) as unknown as SolutionOccurrence<TInput>;
				} catch {
					throw new TypeError("solution occurrence envelope must contain only data fields");
				}
				if (typeof occurrence.occurrenceId !== "string" || occurrence.occurrenceId.length === 0)
					throw new TypeError("solution occurrence identity must be non-empty");
				if (
					!Number.isSafeInteger(occurrence.occurrenceRevision) ||
					occurrence.occurrenceRevision < 1
				)
					throw new TypeError("solution occurrence revision must be a positive safe integer");
				if (
					typeof occurrence.occurrenceDigest !== "string" ||
					!/^sha256:[0-9a-f]{64}$/u.test(occurrence.occurrenceDigest)
				)
					throw new TypeError("solution occurrence digest must be canonical sha256");
				const refs: SolutionOccurrenceSourceRef[] = [];
				try {
					if (!Array.isArray(occurrence.occurrenceSourceRefs)) throw new TypeError();
					const entries = Object.getOwnPropertyDescriptors(
						occurrence.occurrenceSourceRefs as object,
					);
					const length = entries.length?.value;
					if (
						!Number.isSafeInteger(length) ||
						length < 1 ||
						Reflect.ownKeys(entries).length !== length + 1
					)
						throw new TypeError();
					for (let index = 0; index < length; index += 1) {
						const entry = entries[String(index)];
						if (
							entry === undefined ||
							!Object.hasOwn(entry, "value") ||
							entry.value === null ||
							typeof entry.value !== "object"
						)
							throw new TypeError();
						const fields = Object.getOwnPropertyDescriptors(entry.value);
						if (
							Reflect.ownKeys(fields).length !== 2 ||
							!fields.kind ||
							!fields.id ||
							!Object.hasOwn(fields.kind, "value") ||
							!Object.hasOwn(fields.id, "value") ||
							typeof fields.kind.value !== "string" ||
							fields.kind.value.length === 0 ||
							typeof fields.id.value !== "string" ||
							fields.id.value.length === 0
						)
							throw new TypeError();
						refs.push(Object.freeze({ kind: fields.kind.value, id: fields.id.value }));
					}
				} catch {
					throw new TypeError("solution occurrence source refs must contain only data kind/id");
				}
				const sourceRefsKey = occurrenceValueKey(refs);
				if (new Set(refs.map((ref) => canonicalTupleKey([ref.kind, ref.id]))).size !== refs.length)
					throw new TypeError("solution occurrence source refs must be unique");
				const inputSnapshot =
					opts.identity === undefined ? occurrenceSnapshot(occurrence.value) : occurrence.value;
				const prepared =
					opts.identity === undefined ? null : { value: opts.project(occurrence.value) };
				const valueKey = occurrenceValueKey(
					prepared === null ? inputSnapshot : opts.identity!(occurrence.value, prepared.value),
				);
				const prior = ledger.get(occurrence.occurrenceId);
				if (prior !== undefined) {
					if (occurrence.occurrenceRevision < prior.revision)
						throw new TypeError("solution occurrence replay used a stale revision");
					if (occurrence.occurrenceRevision === prior.revision) {
						if (
							occurrence.occurrenceDigest !== prior.digest ||
							sourceRefsKey !== prior.sourceRefsKey ||
							valueKey !== prior.valueKey
						)
							throw new TypeError("solution occurrence replay conflicted with prior DATA");
						continue;
					}
				}
				if (prior === undefined && ledger.size >= opts.maxOccurrences)
					throw new TypeError("solution occurrence retention exceeded its fixed bound");
				ledger.set(
					occurrence.occurrenceId,
					Object.freeze({
						revision: occurrence.occurrenceRevision,
						digest: occurrence.occurrenceDigest,
						sourceRefsKey,
						valueKey,
					}),
				);
				outputs.push(
					Object.freeze({
						occurrenceId: occurrence.occurrenceId,
						occurrenceRevision: occurrence.occurrenceRevision,
						occurrenceDigest: occurrence.occurrenceDigest,
						occurrenceSourceRefs: Object.freeze(refs),
						value: prepared === null ? opts.project(inputSnapshot) : prepared.value,
					}),
				);
			}
			ctx.state.set(ledger);
			if (outputs.length > 0) ctx.down(outputs.map((output) => ["DATA", output]));
		},
		{
			name: opts.name,
			factory: opts.factory,
			replayBuffer: opts.maxOccurrences,
			completeWhenDepsComplete: false,
			errorWhenDepsError: true,
			meta: {
				occurrenceIdentity: "scope-local-id/revision/digest/source-refs",
				correlation: "exact-single-frame",
				retentionBound: opts.maxOccurrences,
			},
		},
	);
}
