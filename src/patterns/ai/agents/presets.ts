/**
 * Phase 13.H — `agent(spec)` preset + `presetRegistry` sugar.
 *
 * Source: `archive/docs/SESSION-multi-agent-gap-analysis.md` G1 + G2.
 *
 * `agent()` is the ergonomic factory — given a parent Graph and an
 * `AgentSpec`, mints an `AgentGraph`, mounts it under the parent at
 * `spec.name`, and returns the `AgentBundle` contract.
 *
 * `presetRegistry()` is thin sugar over `reactiveMap` — a typed reactive
 * map of `<id, preset>`. Pairs with `materialize` (Phase 13.C) for
 * dynamic preset selection: callers store specs / factories / configs in
 * the registry and `materialize` mounts the matching one based on a
 * routing key.
 *
 * **Cross-cut #1 lock:** no `agent.run()` imperative sugar — caller-side
 * runtime is `bundle.in.emit(input)` + `awaitSettled(bundle.out)`.
 */

import {
	type ReactiveMapBundle,
	reactiveMap,
} from "../../../extra/data-structures/reactive-map.js";
import type { Graph } from "../../../graph/graph.js";
import type { LLMResponse } from "../adapters/core/types.js";
import { type AgentBundle, AgentGraph, type AgentSpec } from "./agent.js";

// ---------------------------------------------------------------------------
// agent() factory
// ---------------------------------------------------------------------------

/**
 * Mints an {@link AgentGraph} from `spec`, mounts it under `parent` at
 * `spec.name`, and returns the {@link AgentBundle} contract.
 *
 * **Default type parameters.** When called without explicit type params,
 * `TIn` defaults to `string` and `TOut` to `LLMResponse` — the common
 * case where the caller writes a user message and reads the raw response.
 * Custom types require both `inMapper` and `outMapper` in the spec; the
 * default mappers throw at runtime if `TIn` / `TOut` aren't string /
 * LLMResponse.
 *
 * **Memory partition default.** Each `agent()` call mints its own
 * `AgentMemoryGraph` if `spec.memory` is omitted (private memory; the
 * common case). Pass an explicit shared instance — e.g.
 * `agent(parent, { ..., memory: sharedMemory })` for two agents — to
 * implement §29 handoff context transfer.
 *
 * **Reactive entry / exit:**
 * - `bundle.in.emit(input)` kicks the loop reactively (no imperative
 *   `.run()` per cross-cut #1 lock).
 * - `awaitSettled(bundle.out, { skipCurrent: true })` resolves on the
 *   first response after the kick. `skipCurrent` matters for the second
 *   call onward — `out` caches the prior response.
 *
 * **Mounting.** The factory mounts under `parent.mount(spec.name, ...)`.
 * The slot name must be free on `parent` at construction time. To keep
 * the agent unmounted, construct `new AgentGraph(spec)` directly.
 *
 * @example
 * ```ts
 * import { agent, awaitSettled, Graph } from "@graphrefly/graphrefly-ts";
 *
 * const parent = new Graph("parent");
 * const a = agent(parent, {
 *   name: "researcher",
 *   adapter: openaiAdapter,
 *   systemPrompt: "Research the user's question carefully.",
 * });
 * a.in.emit("What's the capital of France?");
 * const resp = await awaitSettled(a.out, { skipCurrent: true });
 * ```
 *
 * @category patterns
 */
export function agent<TIn = string, TOut = LLMResponse>(
	parent: Graph,
	spec: AgentSpec<TIn, TOut>,
): AgentBundle<TIn, TOut> {
	const graph = new AgentGraph<TIn, TOut>(spec);
	parent.mount(spec.name, graph);
	return {
		in: graph.in,
		out: graph.out,
		status: graph.status,
		cost: graph.cost,
		graph,
	};
}

// ---------------------------------------------------------------------------
// presetRegistry()
// ---------------------------------------------------------------------------

/**
 * The bundle returned by {@link presetRegistry}. Wraps a `reactiveMap`
 * with imperative `put` / `remove` shortcuts and exposes the underlying
 * `registry` for direct reactive consumption (`.entries` is a
 * `Node<ReadonlyMap<string, TPreset>>`).
 *
 * Use the `registry.entries` Node directly with {@link materialize} (Phase
 * 13.C) — pass it as the `factories` argument when `TPreset` is itself
 * a `() => Graph` factory thunk, or transform via `derived` when
 * `TPreset` is a richer spec type that needs a `spec → factory` adapter.
 */
export interface PresetRegistryBundle<TPreset> {
	/**
	 * The underlying reactive map. `registry.entries` is the
	 * `Node<ReadonlyMap<string, TPreset>>` — pass directly to
	 * {@link materialize} when preset shape matches the factories arg.
	 */
	readonly registry: ReactiveMapBundle<string, TPreset>;
	/** Imperative add / replace. Always emits a fresh snapshot. */
	put(id: string, preset: TPreset): void;
	/** Imperative remove. Returns `true` if the id was present. */
	remove(id: string): boolean;
}

/**
 * Thin sugar over `reactiveMap` — a typed registry of `<id, preset>` for
 * agent / strategy / persona / skill catalogs.
 *
 * **Generic over preset shape.** `TPreset` is open — could be an
 * {@link AgentSpec}, a `() => Graph` factory thunk, a static config
 * object, or anything else. Decoupled from `agent()` so the same primitive
 * powers harnessLoop strategy registries, pipelineGraph stage catalogs,
 * etc.
 *
 * **Composes with `materialize`.** When `TPreset` is a `() => Graph`
 * factory, pass `registry.entries` directly to
 * {@link materialize} as the `factories` argument. When `TPreset` is a
 * spec, transform via `derived` to build a `Map<id, () => Graph>` adapter:
 *
 * ```ts
 * const presets = presetRegistry<AgentSpec<string, LLMResponse>>();
 * presets.put("researcher", { name: "researcher", adapter, systemPrompt: "..." });
 *
 * // Adapter: spec → factory.
 * const factories = derived(
 *   [presets.registry.entries],
 *   ([m]) => new Map(
 *     [...m].map(([id, spec]) => [id, () => new AgentGraph(spec)]),
 *   ),
 * );
 * const slot = materialize(activeKey, factories, parent);
 * ```
 *
 * @param initial - Optional initial entries.
 * @returns {@link PresetRegistryBundle}.
 *
 * @category patterns
 */
export function presetRegistry<TPreset>(
	initial?: ReadonlyMap<string, TPreset>,
): PresetRegistryBundle<TPreset> {
	const registry = reactiveMap<string, TPreset>({ name: "presetRegistry" });
	if (initial != null) {
		for (const [id, preset] of initial) {
			registry.set(id, preset);
		}
	}
	return {
		registry,
		put(id, preset) {
			registry.set(id, preset);
		},
		remove(id) {
			if (!registry.has(id)) return false;
			registry.delete(id);
			return true;
		},
	};
}
