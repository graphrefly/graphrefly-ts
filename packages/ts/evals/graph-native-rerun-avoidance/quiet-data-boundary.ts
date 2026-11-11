import { depBatch } from "../../src/ctx/types.js";
import type { Graph } from "../../src/graph/graph.js";
import type { Node } from "../../src/node/node.js";
import { empiricalStrictJsonDigest } from "./canonical.js";

/** D151 package-private delivery of complete, already validated domain DATA. */
export function rootEvalQuietDataBoundary<T>(
	graph: Graph,
	input: Node<T>,
	opts: Readonly<{
		name: string;
		factory: string;
		maxOccurrences: number;
		key: (value: T) => string;
		fingerprint?: (value: T) => string;
		meta?: Readonly<Record<string, unknown>>;
	}>,
): Readonly<{ output: Node<T>; release: () => void }> {
	if (!Number.isSafeInteger(opts.maxOccurrences) || opts.maxOccurrences < 1)
		throw new TypeError("quiet DATA boundary needs a fixed positive occurrence bound");
	const validated = graph.node<T>(
		[input],
		(ctx) => {
			const ledger = new Map(ctx.state.get<Map<string, string>>() ?? []);
			const values: T[] = [];
			for (const raw of depBatch(ctx, 0) ?? []) {
				const value = raw as T;
				const key = opts.key(value);
				const digest = opts.fingerprint?.(value) ?? empiricalStrictJsonDigest(value);
				if (
					typeof key !== "string" ||
					key.length === 0 ||
					typeof digest !== "string" ||
					digest.length === 0
				)
					throw new TypeError("quiet DATA boundary occurrence identity invalid");
				const prior = ledger.get(key);
				if (prior !== undefined) {
					if (prior !== digest)
						throw new TypeError("quiet DATA boundary received conflicting occurrence replay");
					continue;
				}
				if (ledger.size >= opts.maxOccurrences)
					throw new TypeError("quiet DATA boundary exceeded its fixed bound");
				ledger.set(key, digest);
				values.push(value);
			}
			// Validate the complete batch before releasing any occurrence from it.
			ctx.state.set(ledger);
			if (values.length > 0) ctx.down(values.map((value) => ["DATA", value]));
		},
		{
			name: `${opts.name}/validated`,
			factory: "rootEvalQuietDataValidated",
			meta: { materialFree: true },
		},
	);
	// One quiet node is the release boundary (graphrefly-ts:D172): `validated` already admits
	// each occurrence once, and a quiet node's output goes out after the current wave as a wave
	// of its own (R-wave), so nothing below waits on the input's wave.
	const output = graph.node<T>(
		[validated],
		(ctx) => {
			const values = depBatch(ctx, 0) ?? [];
			if (values.length > 0) ctx.down(values.map((value) => ["DATA", value]));
		},
		{
			name: opts.name,
			factory: opts.factory,
			quiet: true,
			meta: { ...opts.meta, boundary: "complete-domain-data-only" },
		},
	);
	return Object.freeze({
		output,
		release: graph.retain(output, { reason: `${opts.name}: complete DATA release` }),
	});
}
