/**
 * `ownershipController()` — multi-agent subgraph ownership preset
 * (DS-14.5.A delta #8; L5/L6 + Q1–Q10).
 *
 * **Placement (documented choice).** Lives in `presets/harness/` alongside
 * the other multi-agent coordination presets (`spawnable()`, `actorPool()`).
 * Per the 4-layer rubric this is a ≥3-utils composition (messaging `topic` +
 * `derived` arbitration + Guard ABAC) wiring multi-agent coordination — the
 * same charter as `harness/`'s existing `spawnable`/`actorPool`. A separate
 * `presets/multi-agent/` directory was rejected to avoid fragmenting the
 * multi-agent presets across two folders for a single factory (L6: "recipe +
 * preset, NO new primitive").
 *
 * **What it is.** A `Graph` that owns a shared ownership `topic` (Q3 — one
 * topic carries claim / release / override; subscribers narrow by `kind`),
 * a reactive `current` derivation that folds the ownership log applying the
 * L0–L3 staircase, and a `guard` (`policyAllowing` — the Q7 reactive-options
 * Guard widening) the caller mounts on the owned subgraph. It **consumes the
 * existing DS-14 {@link OwnershipChange}** envelope — it does NOT redefine it.
 *
 * **Staircase (Q10 — `level` is a priority axis, NOT a mechanism enum):**
 * - **L1 TTL** — a `claim` carries a level; the controller's `ttl` (ms)
 *   bounds the live window. L1 honors TTL strictly (Q4): a crash inside the
 *   window does NOT early-release; recommend `ttl ≤ 60s`.
 * - **L2 heartbeat** — `heartbeat?: NodeInput<unknown>` (Q2). Any reactive
 *   trigger Node; each emission resets the countdown ("max tolerance since
 *   last sign of life", unified across L1/L2). No library timer is shipped
 *   and no `claim.heartbeat()` method exists (`feedback_no_imperative` +
 *   `feedback_no_imperative_wrap_as_primitive`).
 * - **L3 supervisor** — a `kind:"override"` change wins by `level` priority
 *   regardless of expiry/heartbeat (priority axis independent of the expiry
 *   axis). Supervisor publishes to the SAME topic (Q3).
 *
 * **No polling / no timer (spec §5.8/§5.9/§5.10).** Expiry is evaluated
 * reactively: `current` recomputes whenever the ownership topic OR the
 * heartbeat OR the optional `clock` trigger emits, folding the whole log
 * from scratch (idempotent — no carried mutable cursor). Auto-release on
 * wall-clock TTL requires the caller to wire a reactive `clock` tick
 * (`fromTimer({ ms })` or an activity-derived Node) — the library does not
 * own a timer (L6 / Q2). Without `clock`, expiry still resolves at the next
 * topic/heartbeat emission and on any read that recomputes the derivation.
 *
 * @module
 */

import { monotonicNs, type Node, type NodeGuard, policyAllowing } from "@graphrefly/pure-ts/core";
import type { NodeInput, OwnershipChange, OwnershipChangePayload } from "@graphrefly/pure-ts/extra";
import { fromAny, keepalive } from "@graphrefly/pure-ts/extra";
import { Graph } from "@graphrefly/pure-ts/graph";
import { type TopicGraph, topic } from "../../utils/messaging/index.js";

/** Ownership level — priority axis (Q10). Higher rank = higher priority. */
const LEVEL_RANK = { L0: 0, L1: 1, L2: 2, L3: 3 } as const;
type OwnershipLevel = keyof typeof LEVEL_RANK;

/** Options for {@link ownershipController}. */
export type OwnershipControllerOptions = {
	/**
	 * TTL (milliseconds) bounding the live window of a claim. Honored
	 * strictly (Q4) — a crash inside the window does not early-release.
	 * Recommend ≤ 60_000 for L1 holds; wire `heartbeat` (L2) for longer.
	 */
	readonly ttl: number;
	/**
	 * L2 heartbeat (Q2). Any reactive trigger Node — each emission resets the
	 * TTL countdown. Simple: `fromTimer({ ms: ttl / 3 })`. Activity-based:
	 * `derived([toolCalls.events], …)`. Omitted → pure L1 TTL semantics.
	 */
	readonly heartbeat?: NodeInput<unknown>;
	/**
	 * L3 supervisor id. A `kind:"override"` change whose `actor` equals this
	 * id wins by `level` priority regardless of expiry/heartbeat. Override
	 * delivery is the shared topic with the `kind:"override"` discriminant
	 * (Q3) — not a separate priority topic.
	 */
	readonly supervisor?: string;
	/**
	 * Optional reactive clock trigger used ONLY to re-evaluate TTL expiry
	 * (e.g. `fromTimer({ ms: 1_000 })`). The library ships no timer (L6/Q2);
	 * wire this for wall-clock-driven auto-release without an intervening
	 * claim/heartbeat. Without it, expiry resolves lazily on the next
	 * topic/heartbeat emission.
	 */
	readonly clock?: NodeInput<unknown>;
	/** Bounded retention for the ownership topic (default 256). */
	readonly retainedLimit?: number;
};

/**
 * Resolved ownership state emitted by {@link OwnershipControllerGraph.current}.
 * `owner` is `null` when unclaimed or the live claim has expired.
 */
export type OwnershipState = {
	readonly owner: string | null;
	readonly level: OwnershipLevel | null;
	/** Allow-set fed to the Guard. `[]` (deny-all) when `owner === null`. */
	readonly allowed: readonly string[];
};

const EMPTY_STATE: OwnershipState = { owner: null, level: null, allowed: [] };

type ActiveOwner = { owner: string; level: OwnershipLevel; sinceNs: number };

/**
 * Multi-agent subgraph ownership controller. See module docs.
 *
 * Public surface:
 * - `topic` — the shared ownership `TopicGraph<OwnershipChange>` (Q3).
 *   Agents publish claim/release/override here (use the `claim`/`release`/
 *   `override` helpers — thin reactive wrappers over `topic.publish`, i.e.
 *   message flow, NOT imperative triggers).
 * - `current` — `Node<OwnershipState>`: the reactively-resolved owner after
 *   applying L1 TTL + L2 heartbeat + L3 supervisor arbitration.
 * - `allowed` — `Node<readonly string[]>`: the Guard allow-set (derived from
 *   `current`); re-points on claim/release/override with no rewire.
 * - `guard` — `NodeGuard` from `policyAllowing(this.allowed)`. Mount on the
 *   owned subgraph's nodes (`node({ guard })`) for the Q7 hard-block.
 */
export class OwnershipControllerGraph extends Graph {
	readonly topic: TopicGraph<OwnershipChange>;
	readonly current: Node<OwnershipState>;
	readonly allowed: Node<readonly string[]>;
	readonly guard: NodeGuard;

	private readonly _ttlNs: number;
	private readonly _supervisor: string | undefined;
	/** Last heartbeat sign-of-life (monotonic ns); 0 until first beat. */
	private _lastHeartbeatNs = 0;

	constructor(name: string, opts: OwnershipControllerOptions) {
		super(name);
		this._ttlNs = Math.max(0, opts.ttl) * 1_000_000;
		this._supervisor = opts.supervisor;

		this.topic = topic<OwnershipChange>(`${name}__ownership`, {
			retainedLimit: opts.retainedLimit ?? 256,
		});
		// The topic is its own TopicGraph; tear it down with this controller.
		// (Not mounted — `topic.events` already belongs to the TopicGraph; a
		// re-`add` would violate single-graph node ownership. Consumers
		// inspect ownership via `current` / `allowed`, not via a mount.)
		this.addDisposer(() => {
			this.topic.destroy();
		});

		// `current` recomputes whenever the ownership stream changes, the
		// heartbeat fires, or the optional clock ticks — the only sources
		// that can change the resolved owner. ALL deps wired BEFORE any claim
		// can be published (observers before emitters — §47 rule 2).
		const deps: Node<unknown>[] = [this.topic.events as Node<unknown>];
		const heartbeatIdx = opts.heartbeat != null ? deps.push(fromAny(opts.heartbeat)) - 1 : -1;
		if (opts.clock != null) deps.push(fromAny(opts.clock) as Node<unknown>);

		this.current = this.derived<OwnershipState>(
			"currentOwner",
			deps,
			(batchData, ctx) => {
				const nowNs = monotonicNs();
				// Did the heartbeat dep emit this wave? `batchData[i]` is the
				// array of values dep `i` emitted THIS wave; a non-empty
				// heartbeat batch is one or more beats.
				const beatThisWave =
					heartbeatIdx >= 0 &&
					(() => {
						const hb = batchData[heartbeatIdx] as readonly unknown[] | null | undefined;
						return hb != null && hb.length > 0;
					})();

				// Fold the WHOLE ownership log from scratch (idempotent — the
				// topic emits the full retained array, so a cursor would be a
				// bug surface; pure reduction is correct and simple, §47).
				// `batchData[0]` is `(readonly OwnershipChange[])[]` — the
				// snapshots emitted this wave; take the latest (mirrors
				// `topic.latest`'s `batch.at(-1)` pattern). On a SENTINEL
				// first-activation wave fall back to `ctx.prevData[0]`.
				const topoBatch = batchData[0] as
					| readonly (readonly OwnershipChange[])[]
					| null
					| undefined;
				const log = (
					topoBatch != null && topoBatch.length > 0
						? topoBatch[topoBatch.length - 1]
						: (ctx.prevData[0] as readonly OwnershipChange[] | undefined)
				) as readonly OwnershipChange[] | undefined;
				let active: ActiveOwner | null = null;
				if (log != null) {
					for (const ch of log) {
						if (ch?.change == null) continue;
						active = applyChange(active, ch, this._supervisor);
					}
				}

				// L1/L2 expiry, then conditional heartbeat renewal.
				// "Max tolerance since last sign of life": the live window is
				// `[signOfLife, signOfLife + ttl)` where signOfLife is the
				// claim time or the last VALID heartbeat (whichever is newer).
				// A heartbeat only renews if it arrives BEFORE the window
				// lapses (Q4 strict — a late beat must NOT resurrect an
				// already-expired claim; recompute order: expire first, then
				// accept a still-timely beat).
				if (active != null && this._ttlNs > 0) {
					const priorSignOfLife = Math.max(active.sinceNs, this._lastHeartbeatNs);
					const lapsed = nowNs - priorSignOfLife >= this._ttlNs;
					if (lapsed) {
						active = null;
					} else if (beatThisWave) {
						this._lastHeartbeatNs = nowNs; // timely beat → renew
					}
				} else if (beatThisWave && active != null) {
					// No TTL configured — a beat is still a sign of life.
					this._lastHeartbeatNs = nowNs;
				}

				return [
					active == null
						? EMPTY_STATE
						: { owner: active.owner, level: active.level, allowed: [active.owner] },
				];
			},
			{ keepAlive: true },
		);

		this.allowed = this.derived<readonly string[]>(
			"allowed",
			[this.current],
			(batchData, ctx) => {
				const batch = batchData[0] as readonly OwnershipState[] | null | undefined;
				const s = (batch != null && batch.length > 0 ? batch[batch.length - 1] : ctx.prevData[0]) as
					| OwnershipState
					| undefined;
				return [s?.allowed ?? []];
			},
			{ keepAlive: true },
		);
		this.addDisposer(keepalive(this.allowed));

		// Q7 — the reactive-options Guard. `policyAllowing` reads
		// `this.allowed.cache` synchronously at write-check time, so
		// claim/release/override re-point the allow-set with NO rewire.
		this.guard = policyAllowing(this.allowed);
	}

	/**
	 * Publish a `claim`. Thin reactive wrapper over `topic.publish` (message
	 * flow per §29 — NOT an imperative trigger). `level` defaults to `"L2"`
	 * when this controller has a heartbeat wired, else `"L1"`.
	 */
	claim(actor: string, level?: OwnershipLevel): void {
		const lvl = level ?? "L1";
		this.topic.publish(makeChange({ kind: "claim", subgraphId: this.name, actor, level: lvl }));
	}

	/** Publish a `release`. Clears ownership iff `actor` is the current owner. */
	release(actor: string): void {
		this.topic.publish(makeChange({ kind: "release", subgraphId: this.name, actor }));
	}

	/**
	 * Publish a supervisor `override` (L3). Wins by `level` priority
	 * regardless of expiry (Q10). `actor` should be this controller's
	 * `supervisor` id for the override to take precedence.
	 */
	override(actor: string, previousActor: string, reason: string): void {
		this.topic.publish(
			makeChange({ kind: "override", subgraphId: this.name, actor, previousActor, reason }),
		);
	}
}

/** Wrap an {@link OwnershipChangePayload} in the DS-14 {@link OwnershipChange} envelope. */
function makeChange(payload: OwnershipChangePayload): OwnershipChange {
	const t = monotonicNs();
	return { structure: "ownership", version: t, t_ns: t, lifecycle: "ownership", change: payload };
}

/**
 * Fold one ownership change into the resolved-owner state.
 *
 * - `claim` — sets the active owner (records claim time for L1 TTL). A
 *   lower-priority claim cannot displace a higher-`level` live owner (Q10 —
 *   override arbitration is pure level comparison).
 * - `release` — clears ownership iff the releasing actor is the owner.
 * - `override` — supervisor override: wins by `level` priority. Carries
 *   `previousActor` + `reason` per DS-14 (Q3); modeled as an L3 hand-off to
 *   `p.actor`.
 */
function applyChange(
	active: ActiveOwner | null,
	ch: OwnershipChange,
	supervisor: string | undefined,
): ActiveOwner | null {
	const p = ch.change;
	// Use the change's publish timestamp (`t_ns`, stamped in `makeChange`) as
	// the claim time — NOT the fold time. The log is re-folded from scratch on
	// every recompute (§47), so stamping `monotonicNs()` here would re-baseline
	// the TTL window every recompute and the claim would never expire.
	if (p.kind === "claim") {
		if (active != null && LEVEL_RANK[active.level] > LEVEL_RANK[p.level]) return active;
		return { owner: p.actor, level: p.level, sinceNs: ch.t_ns };
	}
	if (p.kind === "release") {
		if (active != null && active.owner === p.actor) return null;
		return active;
	}
	// override
	const isSupervisor = supervisor != null && p.actor === supervisor;
	if (isSupervisor || active == null || LEVEL_RANK.L3 >= LEVEL_RANK[active.level]) {
		return { owner: p.actor, level: "L3", sinceNs: ch.t_ns };
	}
	return active;
}

/**
 * Create a multi-agent subgraph ownership controller (DS-14.5.A #8).
 *
 * @example
 * ```ts
 * const oc = ownershipController("payments", { ttl: 30_000, supervisor: "lead" });
 * // Mount the Guard on the owned subgraph:
 * const n = node([], { initial: 0, guard: oc.guard });
 * oc.claim("agent-a");                 // agent-a now owns; non-owner writes throw
 * oc.override("lead", "agent-a", "rebalance"); // supervisor takes over
 * ```
 */
export function ownershipController(
	name: string,
	opts: OwnershipControllerOptions,
): OwnershipControllerGraph {
	return new OwnershipControllerGraph(name, opts);
}
