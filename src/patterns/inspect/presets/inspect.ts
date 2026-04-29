/**
 * `inspect()` preset — Tier 9.1 γ-form γ-II + Q5-6 medium scope.
 *
 * Composes graph observability into a single mounted facade:
 *   - `lens` (mounted as a `LensSubgraph` child) — exposes `topology` /
 *     `health` / `flow` Nodes via `inspect.lens.*`.
 *   - `audit` (mounted `AuditTrailGraph`) — every mutation on the wrapped
 *     target captured as an audit entry.
 *   - `explainTarget(from, to, opts?)` — facade over
 *     `target.describe({ explain: {...} })`; supports both static and
 *     reactive forms.
 *   - `complianceSnapshot()` — one-shot tamper-evident snapshot pairing the
 *     target's persisted state with the audit log.
 *
 * **Path-namespace boundary.** `inspect.describe()` shows InspectGraph's
 * OWN topology (the lens + audit subgraphs and any caller-added siblings) —
 * NOT the wrapped target's topology. Use `inspect.target.describe()` to
 * walk the target. `inspect.node("counter")` resolves under the inspect
 * graph, NOT the target.
 *
 * **Why a Graph subclass.** Per Tier 9.1 γ-II lock: closure-bundled returns
 * (`{lens, audit, explain, ...}` of independently-constructed primitives)
 * hide topology — `describe()` from the wrapper can't walk into the
 * audit/lens pieces. Mounting them under a real `InspectGraph` keeps every
 * contained primitive visible in describe / explain across the boundary,
 * which is the point of the inspect preset.
 *
 * **Why the lens lives in a child `LensSubgraph` mount.** `Graph.destroy()`
 * signals TEARDOWN through `this._nodes` after disposers drain. If the
 * lens nodes were `add()`ed directly to InspectGraph's path table, they
 * would receive TEARDOWN at parent destroy — invalidating any externally
 * held `view.lens.topology.subscribe(...)` reference. Mounting via a child
 * subgraph contains the cascade: inspect's TEARDOWN visits the lens
 * subgraph's nodes through `mount → child._destroyClearOnly`, which clears
 * structure but does NOT broadcast TEARDOWN. The `lens.dispose()` disposer
 * still tears down the underlying observe handle as designed (D1 fix per
 * /qa lock).
 *
 * **Why `inspect()` mounts `graphLens` rather than rebuilding `health` / `flow`.**
 * Per Q3 yellow lock: rebuilding would duplicate the `topology → health`
 * and `dataFlow → flow` deriveds, doubling subscription cost and risking
 * semantic drift. Mounting graphLens once lets `inspect.lens` and the
 * standalone `graphLens(target)` factory share a single source of truth.
 *
 * @module
 */

import type { Actor } from "../../../core/actor.js";
import { placeholderArgs } from "../../../core/meta.js";
import type { Node } from "../../../core/node.js";
import type { CausalChain } from "../../../graph/explain.js";
import { Graph } from "../../../graph/graph.js";
import {
	type AuditTrailGraph,
	type AuditTrailOptions,
	auditTrail,
	type ComplianceSnapshotResult,
	complianceSnapshot,
	type PolicyGateGraph,
} from "../audit.js";
import { type GraphLensView, graphLens } from "../lens.js";

/** Options for {@link inspect}. */
export interface InspectOptions {
	/** Default actor recorded on `complianceSnapshot()` calls. */
	actor?: Actor;
	/**
	 * Forwarded to the mounted {@link auditTrail} so callers can configure
	 * retention / inclusion policy. Pre-allocated to keep `inspect()`
	 * callable with no opts.
	 */
	audit?: AuditTrailOptions;
	/** Optional name override for the `InspectGraph` itself. */
	name?: string;
}

/**
 * Thin Graph-subclass shell that owns the `graphLens(target)` Nodes so
 * inspect's TEARDOWN cascade reaches them via `_destroyClearOnly` (which
 * clears structure WITHOUT broadcasting TEARDOWN) instead of via
 * `signal([[TEARDOWN]])` (which DOES broadcast and would invalidate any
 * externally held lens-node subscription).
 *
 * @internal
 */
class LensSubgraph extends Graph {
	readonly view: GraphLensView;

	constructor(target: Graph) {
		super("lens");
		this.view = graphLens(target);
		this.add(this.view.topology, { name: "topology" });
		this.add(this.view.health, { name: "health" });
		this.add(this.view.flow, { name: "flow" });
	}
}

/**
 * Graph subclass returned by {@link inspect}. Mounts a `graphLens` view (as
 * a child `LensSubgraph`), an `auditTrail` (as a child subgraph), and
 * exposes `explainTarget()` + `complianceSnapshot()` facades over the
 * wrapped target.
 *
 * Mounted children (visible in `describe()`):
 *   - `lens::topology` / `lens::health` / `lens::flow` — `graphLens(target)` Nodes.
 *   - `audit::*` — the mounted {@link AuditTrailGraph}.
 *
 * @category observability
 */
export class InspectGraph extends Graph {
	readonly target: Graph;
	/**
	 * Underlying lens view — reach individual Nodes via
	 * `inspect.lens.topology` / `inspect.lens.health` / `inspect.lens.flow`.
	 *
	 * Direct `inspect.topology` / `inspect.health` / `inspect.flow`
	 * accessors are NOT shipped because `Graph.topology` is already an
	 * accessor on the base class with a different shape (`Node<TopologyEvent>`
	 * — the mount/unmount stream of THIS graph, not the wrapped target's
	 * describe snapshot). Going through `.lens.*` keeps the two concepts
	 * cleanly separated.
	 */
	readonly lens: GraphLensView;
	/** Mounted audit trail subgraph. */
	readonly audit: AuditTrailGraph;

	private readonly _defaultActor?: Actor;
	private readonly _lensSubgraph: LensSubgraph;

	constructor(target: Graph, opts: InspectOptions = {}) {
		super(opts.name ?? `inspect(${target.name})`);
		this.target = target;
		this._defaultActor = opts.actor;

		// D1 (qa lock): lens lives inside a child mount so `inspect.destroy()`'s
		// TEARDOWN signal cascade reaches the lens nodes via
		// `_destroyClearOnly` (no broadcast) rather than via `_signalDeliver`
		// over `inspect._nodes` (which WOULD broadcast). External holders of
		// `view.lens.topology.subscribe(...)` see only the `lens.dispose()`
		// teardown of the underlying observe handle, not a stray TEARDOWN
		// from inspect's path table.
		this._lensSubgraph = new LensSubgraph(target);
		this.lens = this._lensSubgraph.view;
		this.mount("lens", this._lensSubgraph);

		this.audit = auditTrail(target, opts.audit ?? {});
		this.mount("audit", this.audit);

		// Tear down the lens's underlying observe subscription on destroy.
		// The mounted subgraphs themselves tear down via mount lifecycle.
		this.addDisposer(() => this.lens.dispose());
	}

	/**
	 * Causal-chain facade over `target.describe({ explain: {...} })`. Supports
	 * both static (one-shot {@link CausalChain}) and reactive
	 * (`{ reactive: true }`) forms.
	 *
	 * Named `explainTarget` (not folded into a `describe` mode on this class)
	 * because `inspect.describe(...)` walks `InspectGraph`'s OWN topology
	 * (lens + audit subgraphs) rather than the wrapped target's. Use
	 * `inspect.explainTarget(...)` for chains across the wrapped graph;
	 * `inspect.describe({ explain: {...} })` for chains across the lens /
	 * audit composition.
	 */
	explainTarget(
		from: string | Node<string>,
		to: string | Node<string>,
		opts?: {
			maxDepth?: number | Node<number>;
			findCycle?: boolean | Node<boolean>;
		},
	): CausalChain;
	explainTarget(
		from: string | Node<string>,
		to: string | Node<string>,
		opts: {
			reactive: true;
			maxDepth?: number | Node<number>;
			findCycle?: boolean | Node<boolean>;
			name?: string;
		},
	): { node: Node<CausalChain>; dispose: () => void };
	explainTarget(
		from: string | Node<string>,
		to: string | Node<string>,
		opts?: {
			reactive?: boolean;
			maxDepth?: number | Node<number>;
			findCycle?: boolean | Node<boolean>;
			name?: string;
		},
	): CausalChain | { node: Node<CausalChain>; dispose: () => void } {
		// Cast through the discriminated overload — TypeScript can't pick a
		// signature on `target.describe({explain})` because `opts` has the
		// union shape (reactive: boolean | undefined).
		const explainArg: {
			from: string | Node<string>;
			to: string | Node<string>;
			maxDepth?: number | Node<number>;
			findCycle?: boolean | Node<boolean>;
		} = { from, to };
		if (opts?.maxDepth !== undefined) explainArg.maxDepth = opts.maxDepth;
		if (opts?.findCycle !== undefined) explainArg.findCycle = opts.findCycle;
		const describeOpts: Record<string, unknown> = { explain: explainArg };
		if (opts?.reactive === true) describeOpts.reactive = true;
		if (opts?.name !== undefined) describeOpts.name = opts.name;
		return (
			this.target.describe as unknown as (
				o: typeof describeOpts,
			) => CausalChain | { node: Node<CausalChain>; dispose: () => void }
		)(describeOpts);
	}

	/**
	 * One-shot tamper-evident snapshot pairing the target's persisted state
	 * with the audit log + (optional) policy-gate violations.
	 *
	 * Uses the inspect's mounted `audit` by default; pair with a separate
	 * `policyGate` (mounted elsewhere) by passing `policies` explicitly.
	 *
	 * **Cryptographic strength caveat (echoed from {@link complianceSnapshot}):**
	 * the returned `fingerprint` is a truncated SHA-256 (16 hex chars / ~64
	 * bits) optimized for compact archival. Sufficient for casual integrity
	 * checks and content-addressed dedup; for adversarial tamper-evidence,
	 * pair with a full SHA-256 over the canonical JSON externally.
	 */
	complianceSnapshot(opts?: {
		actor?: Actor;
		policies?: PolicyGateGraph;
	}): ComplianceSnapshotResult {
		const actor = opts?.actor ?? this._defaultActor;
		return complianceSnapshot(this.target, {
			audit: this.audit,
			...(actor != null ? { actor } : {}),
			...(opts?.policies != null ? { policies: opts.policies } : {}),
		});
	}
}

/**
 * Build an {@link InspectGraph} that mounts `graphLens` + `auditTrail` over
 * the wrapped target and exposes `explainTarget()` + `complianceSnapshot()`
 * facades.
 *
 * @example
 * ```ts
 * import { inspect } from "@graphrefly/graphrefly/patterns/inspect";
 *
 * const target = buildMyApp();
 * const view = inspect(target, { actor: { id: "ops-bot", role: "monitor" } });
 *
 * // Live observability
 * view.lens.health.subscribe((msgs) => console.log("health:", msgs));
 * view.lens.flow.subscribe((msgs) => console.log("flow:", msgs));
 *
 * // Causal explainability across the wrapped target
 * const chain = view.explainTarget("input", "output");
 *
 * // Tamper-evident snapshot for archival
 * const snapshot = view.complianceSnapshot();
 * ```
 *
 * @category observability
 */
export function inspect(target: Graph, opts: InspectOptions = {}): InspectGraph {
	const g = new InspectGraph(target, opts);
	// A1 (qa lock): self-tag so `inspect.describe().factory === "inspect"`,
	// matching the policyGate / pipelineGraph / harnessLoop precedent.
	g.tagFactory("inspect", placeholderArgs(opts as unknown as Record<string, unknown>));
	return g;
}
