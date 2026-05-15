/**
 * `withDryRun` — short-circuit to a fake adapter when a flag is on.
 *
 * Useful for CI / preflight / cost-safety pipelines: wrap a real adapter,
 * pass `enabled: true` (or a reactive flag) to bypass the wire call. Default
 * shim is {@link dryRunAdapter}; callers can supply their own.
 *
 * **Returns `{adapter, dispose}`** — call `dispose()` to release the internal
 * keepalive on the reactive `enabled` input. Long-lived adapter instances
 * (module-level singletons) can ignore dispose; transient adapters (per-
 * request or per-user) should call it on teardown to allow the source to
 * be GC'd.
 */

import { fromAny, keepalive, type NodeInput } from "@graphrefly/pure-ts/extra";
import { adapterWrapper, withLayer } from "../_internal/wrappers.js";
import type { LLMAdapter } from "../core/types.js";
import { dryRunAdapter } from "../providers/dry-run.js";

export interface WithDryRunOptions {
	/**
	 * Toggle — `true` always dry-runs; `false` always passes through; a
	 * `NodeInput<boolean>` reads the current value at call time (factory-time
	 * seed pattern, live-tunable).
	 */
	enabled: NodeInput<boolean>;
	/** Dry-run adapter override. Default: `dryRunAdapter({ provider: inner.provider, model: inner.model })`. */
	mock?: LLMAdapter;
}

export interface WithDryRunBundle {
	adapter: LLMAdapter;
	/**
	 * Release the internal keepalive subscription on the reactive `enabled`
	 * input. Idempotent. Safe to ignore on long-lived adapters.
	 */
	dispose(): void;
}

export function withDryRun(inner: LLMAdapter, opts: WithDryRunOptions): WithDryRunBundle {
	const mock = opts.mock ?? dryRunAdapter({ provider: inner.provider, model: inner.model });

	// Normalize the enabled input: literal boolean stays literal; NodeInput<boolean>
	// gets bridged so we can read .cache at call time (factory-time seed per
	// COMPOSITION-GUIDE §28). Keep the node alive so push-on-subscribe and
	// derived-chain recomputation keep the cache current — otherwise a reactive
	// flag would stay at its initial value forever.
	const enabledLiteral = typeof opts.enabled === "boolean" ? (opts.enabled as boolean) : undefined;
	const enabledNode =
		enabledLiteral === undefined ? fromAny(opts.enabled as NodeInput<boolean>) : undefined;
	let unsubKeepalive: (() => void) | undefined;
	if (enabledNode) unsubKeepalive = keepalive(enabledNode);

	const isEnabled = (): boolean => {
		if (enabledLiteral !== undefined) return enabledLiteral;
		return Boolean(enabledNode?.cache);
	};

	const adapter: LLMAdapter = adapterWrapper(inner, {
		invoke(messages, invokeOpts) {
			return isEnabled() ? mock.invoke(messages, invokeOpts) : inner.invoke(messages, invokeOpts);
		},

		stream(messages, invokeOpts) {
			return isEnabled() ? mock.stream(messages, invokeOpts) : inner.stream(messages, invokeOpts);
		},
	});
	withLayer(adapter, "withDryRun", inner);

	const dispose = (): void => {
		if (unsubKeepalive) {
			unsubKeepalive();
			unsubKeepalive = undefined;
		}
	};

	return { adapter, dispose };
}
