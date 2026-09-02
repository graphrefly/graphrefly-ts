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
				const prepared =
					opts.identity === undefined ? null : { value: opts.project(occurrence.value) };
				const valueKey = occurrenceValueKey(
					prepared === null ? occurrence.value : opts.identity!(occurrence.value, prepared.value),
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
						value: prepared === null ? opts.project(occurrence.value) : prepared.value,
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
			errorWhenDepsError: true,
			meta: {
				occurrenceIdentity: "scope-local-id/revision/digest/source-refs",
				correlation: "exact-single-frame",
				retentionBound: opts.maxOccurrences,
			},
		},
	);
}
