import { depBatch } from "../ctx/types.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey } from "../identity.js";
import { stableJsonString } from "../json/codec.js";
import type { Node } from "../node/node.js";

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

interface SolutionOccurrenceLedgerEntry {
	readonly revision: number;
	readonly digest: string;
	readonly sourceRefsKey: string;
	readonly valueKey: string;
}

function canonicalOccurrenceValue(value: unknown, seen = new Set<object>()): unknown {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		typeof value === "number"
	)
		return value;
	if (typeof value === "bigint") return Object.freeze({ bigint: value.toString() });
	if (typeof value !== "object")
		throw new TypeError("solution occurrence DATA must be canonically inspectable");
	if (seen.has(value)) throw new TypeError("solution occurrence DATA must not be circular");
	seen.add(value);
	try {
		if (Array.isArray(value))
			return Object.freeze(value.map((item) => canonicalOccurrenceValue(item, seen)));
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null)
			throw new TypeError("solution occurrence DATA must use plain objects");
		return Object.freeze(
			Object.fromEntries(
				Object.entries(value)
					.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
					.map(([key, item]) => [key, canonicalOccurrenceValue(item, seen)]),
			),
		);
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

/** Package-private D151 exact occurrence projection shared by real solution segments. */
export function solutionOccurrenceProjection<TInput, TOutput>(
	graph: Graph,
	input: Node<SolutionOccurrence<TInput>>,
	opts: Readonly<{
		readonly name: string;
		readonly factory: string;
		readonly maxOccurrences: number;
		readonly project: (value: TInput) => TOutput;
	}>,
): Node<SolutionOccurrence<TOutput>> {
	if (!Number.isSafeInteger(opts.maxOccurrences) || opts.maxOccurrences < 1)
		throw new TypeError("solution occurrence retention bound must be a positive safe integer");
	return graph.node<SolutionOccurrence<TOutput>>(
		[input],
		(ctx) => {
			const ledger =
				ctx.state.get<Map<string, SolutionOccurrenceLedgerEntry>>() ??
				new Map<string, SolutionOccurrenceLedgerEntry>();
			const outputs: SolutionOccurrence<TOutput>[] = [];
			for (const raw of depBatch(ctx, 0) ?? []) {
				const occurrence = raw as SolutionOccurrence<TInput>;
				if (occurrence === null || typeof occurrence !== "object")
					throw new TypeError("solution occurrence DATA must be an object");
				if (typeof occurrence.occurrenceId !== "string" || occurrence.occurrenceId.length === 0)
					throw new TypeError("solution occurrence identity must be non-empty");
				if (
					!Number.isSafeInteger(occurrence.occurrenceRevision) ||
					occurrence.occurrenceRevision < 1
				)
					throw new TypeError("solution occurrence revision must be a positive safe integer");
				if (!/^sha256:[0-9a-f]{64}$/u.test(occurrence.occurrenceDigest))
					throw new TypeError("solution occurrence digest must be canonical sha256");
				if (
					!Array.isArray(occurrence.occurrenceSourceRefs) ||
					occurrence.occurrenceSourceRefs.length === 0 ||
					occurrence.occurrenceSourceRefs.some(
						(ref) =>
							typeof ref.kind !== "string" ||
							ref.kind.length === 0 ||
							typeof ref.id !== "string" ||
							ref.id.length === 0,
					)
				)
					throw new TypeError("solution occurrence source refs were invalid");
				const sourceRefsKey = occurrenceValueKey(occurrence.occurrenceSourceRefs);
				if (
					new Set(
						occurrence.occurrenceSourceRefs.map((ref) => canonicalTupleKey([ref.kind, ref.id])),
					).size !== occurrence.occurrenceSourceRefs.length
				)
					throw new TypeError("solution occurrence source refs must be unique");
				const valueKey = occurrenceValueKey(occurrence.value);
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
						occurrenceSourceRefs: Object.freeze([...occurrence.occurrenceSourceRefs]),
						value: opts.project(occurrence.value),
					}),
				);
			}
			ctx.state.set(ledger);
			if (outputs.length > 0) ctx.down(outputs.map((output) => ["DATA", output]));
		},
		{
			name: opts.name,
			factory: opts.factory,
			completeWhenDepsComplete: false,
			errorWhenDepsError: false,
			meta: {
				occurrenceIdentity: "scope-local-id/revision/digest/source-refs",
				correlation: "exact-single-frame",
				retentionBound: opts.maxOccurrences,
			},
		},
	);
}
