/**
 * `frozenContext` — prefix-cache-friendly snapshot of upstream context.
 *
 * @module
 */

import { factoryTag } from "@graphrefly/pure-ts/core";
import { type Node, node as nodeFactory } from "@graphrefly/pure-ts/core";
import { fromAny, type NodeInput } from "@graphrefly/pure-ts/extra";
import { aiMeta } from "../_internal.js";

export type FrozenContextOptions = {
	/**
	 * Reactive signal that triggers re-materialization. Each `DATA` emission
	 * from this node re-reads the source and refreshes the frozen value.
	 * Typical shapes: `fromTimer(ms)` for periodic refresh, a stage-transition
	 * node for event-driven refresh, or a manual `state<number>` the caller
	 * increments via `setState(n + 1)`.
	 *
	 * When omitted, the frozen value is materialized exactly once (on first
	 * subscribe) and never refreshes for the lifetime of the activation —
	 * use this for session-start snapshots that must stay stable. The
	 * single-shot latch IS reset on `INVALIDATE` (graph-wide flush via
	 * `graph.signal([[INVALIDATE]])`), so callers who need an "evict and
	 * re-materialize" escape hatch get one through the standard graph
	 * lifecycle without having to wire a `refreshTrigger`.
	 */
	refreshTrigger?: NodeInput<unknown>;
	name?: string;
};

/**
 * Freeze a reactive source into a stable snapshot that only re-materializes
 * on explicit trigger. Built for long-running harness loops where system
 * prompts include `agentMemory` / stage context — every reactive change to
 * the source invalidates the LLM provider's prefix cache, so re-rendering
 * the prompt every turn is expensive.
 *
 * `frozenContext(source)` reads the source once and caches the value;
 * downstream `promptNode` compositions see a stable reference until the
 * optional `refreshTrigger` fires.
 *
 * Trade-off: slightly stale context vs. prefix cache hit rate. For most
 * harness apps, the memory snapshot at session start is "good enough" —
 * refreshing on a coarse-grained trigger (`fromCron("*\/30min")`, stage
 * transition) preserves 90%+ prefix cache hits while keeping context useful.
 *
 * @example
 * ```ts
 * // Freeze agent memory for the duration of a stage.
 * const frozen = frozenContext(memory.context, {
 *   refreshTrigger: stage,  // re-materialize on stage change
 * });
 * const reply = promptNode({ context: frozen, ... });
 * ```
 *
 * @category patterns.ai
 */
export function frozenContext<T>(
	source: NodeInput<T>,
	opts?: FrozenContextOptions,
): Node<T | null> {
	const src = fromAny(source);
	const trigger = opts?.refreshTrigger != null ? fromAny(opts.refreshTrigger) : null;

	// JSON-serializable subset of opts: omit `refreshTrigger` (a NodeInput).
	const frozenArgs: Record<string, unknown> | undefined =
		opts?.name !== undefined ? { name: opts.name } : undefined;
	const frozenTag = factoryTag("frozenContext", frozenArgs);

	// Single-shot path: deps = [src] only. Emit the first src value and then
	// hold regardless of source drift.
	if (trigger == null) {
		return nodeFactory<T | null>(
			[src],
			(data, actions, ctx) => {
				const alreadyEmitted = ctx.store.emitted === true;
				if (alreadyEmitted) return;
				const srcBatch = data[0];
				const srcValue =
					srcBatch != null && srcBatch.length > 0 ? srcBatch.at(-1) : ctx.prevData[0];
				// Only emit once src has produced a settled value.
				if (srcValue === undefined) return;
				ctx.store.emitted = true;
				actions.emit(srcValue as T);
				// On INVALIDATE (graph-wide flush), reset the "already emitted"
				// latch so the next fn re-run captures a fresh snapshot.
				// Without this, INVALIDATE clears the cache but the latch stays
				// armed, so subscribers stay on the cleared (null) state forever.
				//
				// Lock 6.D (Phase 13.6.B): clear `emitted` on deactivation —
				// the pre-flip auto-wipe handled this implicitly.
				//
				// QA D1 (Phase 13.6.B QA pass): `onResubscribableReset` covers
				// the multi-sub-stayed terminal-resubscribable path where
				// `_deactivate` does NOT run but the lifecycle reset still
				// needs to clear the latch. Without this slot, a sibling sink
				// that keeps the node alive past terminal would pin
				// `emitted === true` into the next subscription cycle and
				// suppress every future emission.
				const store = ctx.store;
				return {
					onInvalidate: () => {
						store.emitted = false;
					},
					onDeactivation: () => {
						delete store.emitted;
					},
					onResubscribableReset: () => {
						delete store.emitted;
					},
				};
			},
			{
				name: opts?.name ?? "frozenContext",
				describeKind: "derived",
				initial: null,
				meta: aiMeta("frozen_context", { ...frozenTag }),
			},
		);
	}

	// Refresh-on-trigger path: deps = [src, trigger]. Emit the current src
	// value ONLY when the trigger dep is involved in the wave. Source-only
	// changes are silently held so downstream prompt composition sees the
	// same value between triggers, preserving the LLM provider's prefix cache.
	//
	// Uses raw `node()` to inspect per-dep wave involvement — `derived` fires
	// on any dep change and can't distinguish. The declaration-order semantic
	// gap in multi-dep push-on-subscribe (§2.7) works in our favor on
	// activation: src fires first (captured into ctx.prevData), trigger fires
	// in a second wave → emit via prevData[0] fallback.
	return nodeFactory<T | null>(
		[src, trigger],
		(data, actions, ctx) => {
			const triggerBatch = data[1];
			const triggered = triggerBatch != null && triggerBatch.length > 0;
			if (!triggered) return;
			const srcBatch = data[0];
			const srcValue = srcBatch != null && srcBatch.length > 0 ? srcBatch.at(-1) : ctx.prevData[0];
			actions.emit(srcValue as T);
		},
		{
			name: opts?.name ?? "frozenContext",
			describeKind: "derived",
			initial: null,
			meta: aiMeta("frozen_context", { ...frozenTag }),
		},
	);
}
