import { depBatch } from "../../src/ctx/types.js";
import type { Graph } from "../../src/graph/graph.js";
import type { Node } from "../../src/node/node.js";
import { merge } from "../../src/operators/index.js";
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
	const pullId = Symbol(opts.name);
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
	const port = graph.node<T>(
		[validated],
		(ctx) => {
			const values = depBatch(ctx, 0) ?? [];
			if (values.length > 0) ctx.down(values.map((value) => ["DATA", value]));
		},
		{
			name: `${opts.name}/released`,
			factory: "rootEvalQuietDataPort",
			pullId,
			pausable: "resumeAll",
			meta: { ...opts.meta, boundary: "complete-domain-data-only" },
		},
	);
	const output = graph.node<T>(
		[port],
		(ctx) => {
			const values = depBatch(ctx, 0) ?? [];
			if (values.length > 0) ctx.down(values.map((value) => ["DATA", value]));
		},
		{
			name: opts.name,
			factory: opts.factory,
			meta: { ...opts.meta, boundary: "complete-domain-data-only" },
		},
	);
	const events = graph.initNode(merge<T>(), [output, validated], {
		name: `${opts.name}/release-events`,
	});
	const controller = graph.node(
		[events],
		(ctx) => {
			const ledger = ctx.state.get<Map<string, string>>() ?? new Map<string, string>();
			let fresh = false;
			for (const raw of depBatch(ctx, 0) ?? []) {
				const value = raw as T;
				const key = opts.key(value);
				const digest = opts.fingerprint?.(value) ?? empiricalStrictJsonDigest(value);
				const prior = ledger.get(key);
				if (prior !== undefined) {
					if (prior !== digest)
						throw new TypeError("quiet DATA boundary received conflicting occurrence replay");
					continue;
				}
				if (ledger.size >= opts.maxOccurrences)
					throw new TypeError("quiet DATA boundary exceeded its fixed bound");
				ledger.set(key, digest);
				fresh = true;
			}
			ctx.state.set(ledger);
			if (fresh) ctx.upNext([["PULL", { pullId }]]);
		},
		{ name: `${opts.name}/release-controller`, factory: "rootEvalQuietDataReleaseController" },
	);
	return Object.freeze({
		output,
		release: graph.retain(controller, { reason: `${opts.name}: complete DATA release` }),
	});
}
