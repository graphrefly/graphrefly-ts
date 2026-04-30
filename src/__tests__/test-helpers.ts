/**
 * Shared test utilities for subscribing to nodes and collecting messages.
 *
 * Single `collect` function with options covers all collection modes:
 * - batches (default) or flat individual messages
 * - with or without START handshake filtering
 */
import { START } from "../core/messages.js";

type Subscribable = { subscribe: (fn: (m: unknown) => void) => () => void };

export type CollectOptions = {
	/** Collect flat individual messages instead of batches. Default: false. */
	flat?: boolean;
	/** Include START handshake messages. Default: false (filters START). */
	raw?: boolean;
};

type CollectBatchResult = { messages: unknown[][]; batches: unknown[][]; unsub: () => void };
type CollectFlatResult = {
	messages: [symbol, unknown?][];
	msgs: [symbol, unknown?][];
	unsub: () => void;
};

/**
 * Subscribe and collect messages from a node.
 *
 * @param node - The subscribable node.
 * @param opts - Collection options.
 * @returns `{ messages, unsub }` — `messages` is either `unknown[][]` (batches) or
 *   `[symbol, unknown?][]` (flat), depending on `opts.flat`.
 *
 * @example
 * // Default: batches, no START
 * const { messages, unsub } = collect(n);
 *
 * @example
 * // Flat messages, no START
 * const { messages, unsub } = collect(n, { flat: true });
 *
 * @example
 * // Batches including START
 * const { messages, unsub } = collect(n, { raw: true });
 */
export function collect(
	node: Subscribable,
	opts: CollectOptions & { flat: true },
): CollectFlatResult;
export function collect(node: Subscribable, opts?: CollectOptions): CollectBatchResult;
export function collect(
	node: Subscribable,
	opts?: CollectOptions,
): CollectBatchResult | CollectFlatResult {
	const flat = opts?.flat === true;
	const raw = opts?.raw === true;

	if (flat) {
		const messages: [symbol, unknown?][] = [];
		const unsub = node.subscribe((m) => {
			for (const msg of m as [symbol, unknown?][]) {
				if (raw || msg[0] !== START) messages.push(msg);
			}
		});
		return { messages, msgs: messages, unsub };
	}

	const messages: unknown[][] = [];
	const unsub = node.subscribe((msgs) => {
		const filtered = raw
			? (msgs as unknown[])
			: (msgs as unknown[]).filter((m) => (m as [symbol, unknown])[0] !== START);
		if (filtered.length > 0) messages.push(filtered);
	});
	return { messages, batches: messages, unsub };
}

/**
 * @deprecated Use `collect(node, { flat: true })` instead.
 */
export function collectFlat(node: Subscribable) {
	return collect(node, { flat: true });
}

/**
 * Collapse the raw `data: readonly (readonly unknown[] | undefined)[]` shape
 * passed to `GraphDerivedFn` / `GraphEffectFn` into per-dep latest scalars.
 *
 * For each dep `i`:
 * - If `data[i]` has at least one DATA value, returns the LAST one.
 * - Otherwise (dep not involved this wave, or RESOLVED), returns
 *   `ctx.prevData[i]` — the last DATA value from the prior wave.
 *
 * Mirrors the canonical scalar-read formula documented on `GraphDerivedFn`.
 * Tests that don't care about multi-emit semantics use this; tests that DO
 * care should index `data[i]` directly. The name reflects the collapse —
 * "latest of each dep" — not "all values."
 */
export function latestVals(
	data: readonly (readonly unknown[] | undefined)[],
	ctx: { readonly prevData: readonly unknown[] },
): readonly unknown[] {
	return data.map((b, i) => (b != null && b.length > 0 ? b[b.length - 1] : ctx.prevData[i]));
}
