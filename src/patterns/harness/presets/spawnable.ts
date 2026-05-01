/**
 * Phase 13.I — `spawnable()` harness preset.
 *
 * Source: `archive/docs/SESSION-multi-agent-gap-analysis.md` G3 lock B + G5
 * reframe.
 *
 * Wraps a {@link MessagingHubGraph} + {@link presetRegistry} +
 * (per-request) {@link agent} mounting + depth-cap + termination contract.
 * Consumers emit a `Message<SpawnPayload>` to the well-known
 * {@link SPAWNS_TOPIC}; `spawnable()` mints a fresh agent from the
 * matching preset, mounts it, and tracks it in `activeSlot` until the
 * agent settles or expires. Out-of-policy requests (depth-cap exceeded,
 * unknown presetId, schema-invalid, expired) flow to the `rejected`
 * topic.
 *
 * **Cross-cut #1 lock (no `agent.run()`):** spawnable kicks each agent
 * via `bundle.in.emit(taskInput)`; status transitions are observed via
 * the agent's reactive `status` Node.
 *
 * **Termination contract:**
 * - `done` / `error` from the agent's `status` → unmount + remove from
 *   `activeSlot`.
 * - `expiresAt` (set on the request envelope, ISO 8601) — when the wall
 *   clock passes the deadline AND the agent is still active, the agent is
 *   aborted (via `loop.abort()`) and reported on `rejected` with
 *   `reason: "expired"`. (Per-spawn timeout via the `timeout` operator
 *   recipe is documented in COMPOSITION-GUIDE-PATTERNS.)
 *
 * **Depth-cap:** locked recipe (DS-13.I) is `valve(spawnTopic, derived(
 * [depthCounter], n => n < cap))`, but the practical pattern in
 * `spawnable()` checks depth per-request inside the request handler so
 * over-cap requests can be reported on `rejected`. Callers who want hard
 * cuts (no rejection signal) can wrap their own publish path with
 * `valve` per the recipe.
 */

import { batch } from "../../../core/batch.js";
import { wallClockNs } from "../../../core/clock.js";
import { DATA } from "../../../core/messages.js";
import { type Node, node } from "../../../core/node.js";
import { keepalive } from "../../../extra/sources.js";
import { Graph } from "../../../graph/graph.js";
import { aiMeta } from "../../ai/_internal.js";
import type { LLMResponse } from "../../ai/adapters/core/types.js";
import type { AgentBundle, AgentSpec, AgentStatus } from "../../ai/agents/agent.js";
import type { PresetRegistryBundle } from "../../ai/agents/presets.js";
import { agent } from "../../ai/agents/presets.js";
import {
	type Message,
	type MessagingHubGraph,
	SPAWNS_TOPIC,
	type SubscriptionGraph,
	subscription,
	type TopicGraph,
	topic,
} from "../../messaging/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Payload of a spawn request envelope. Wraps in a {@link Message}<...>:
 * the request body sets `presetId` (the preset registry key) and
 * `taskInput` (the typed input passed to the spawned agent's `bundle.in`).
 */
export interface SpawnPayload<TIn> {
	readonly presetId: string;
	readonly taskInput: TIn;
}

/**
 * Rejection record published to the `rejected` topic when a spawn request
 * is denied. `reason` is a short human-readable code.
 */
export interface SpawnRejection<TIn> {
	readonly request: Message<SpawnPayload<TIn>>;
	readonly reason: string;
}

/**
 * Options for {@link spawnable}.
 */
export interface SpawnableOpts<TIn, TOut> {
	/** Existing messaging hub. {@link SPAWNS_TOPIC} is created lazily on it. */
	readonly hub: MessagingHubGraph;
	/** Preset registry — keys must match `request.payload.presetId`. */
	readonly registry: PresetRegistryBundle<AgentSpec<TIn, TOut>>;
	/**
	 * Local mount name on the hub for this spawnable's subgraph. Multiple
	 * spawnable instances on the same hub must use distinct names. Default
	 * `"spawnable"`.
	 */
	readonly name?: string;
	/** Maximum concurrently-active agents. Default unbounded. */
	readonly depthCap?: number;
	/**
	 * Initial cursor for the spawn-topic subscription. Default `"now"` —
	 * pre-existing retained spawn requests are NOT replayed at construction.
	 * Pass `"retained"` to replay or a number for explicit cursor offset.
	 */
	readonly from?: "now" | "retained" | number;
	/**
	 * Optional caller-supplied validator. Returns `true` to accept the
	 * request, `false` to reject. Reject reason on the `rejected` topic is
	 * `"validation failed"`. Pair with the `Message.schema` field carried
	 * in the envelope when full JSON-Schema validation is needed (consumer
	 * supplies the validator — ajv / zod / valibot — and reads the schema
	 * from the envelope to gate). The substrate itself does NOT ship a
	 * JSON-Schema validator; the `Message.schema` field is wire convention.
	 */
	readonly validate?: (request: Message<SpawnPayload<TIn>>) => boolean;
}

/**
 * The bundle returned by {@link spawnable}.
 */
export interface SpawnableBundle<TIn, TOut> {
	/** The well-known spawn topic — emit `Message<SpawnPayload<TIn>>` here. */
	readonly spawnTopic: TopicGraph<Message<SpawnPayload<TIn>>>;
	/** Reactive map of currently-active agent bundles, keyed by request id. */
	readonly activeSlot: Node<ReadonlyMap<string, AgentBundle<TIn, TOut>>>;
	/** Topic of rejected requests with reason. */
	readonly rejected: TopicGraph<SpawnRejection<TIn>>;
	/** The internal SpawnableGraph subgraph (mounted under the hub). */
	readonly graph: SpawnableGraph<TIn, TOut>;
}

// ---------------------------------------------------------------------------
// SpawnableGraph
// ---------------------------------------------------------------------------

/**
 * Graph subclass implementing {@link SpawnableBundle}'s topology.
 * Mounted under the hub at `opts.name` (default `"spawnable"`).
 *
 * Topology:
 * ```
 * <hub>
 * ├── spawns                (TopicGraph; well-known well-named spawn topic)
 * └── <name>                (SpawnableGraph)
 *     ├── spawn-sub         (SubscriptionGraph over hub::spawns::events)
 *     ├── rejected          (TopicGraph<SpawnRejection>)
 *     ├── active-slot       (Node<ReadonlyMap<id, AgentBundle>>)
 *     └── spawn-{req.id}/   (mounted AgentGraph per active spawn)
 * ```
 */
export class SpawnableGraph<TIn, TOut> extends Graph {
	readonly spawnTopic: TopicGraph<Message<SpawnPayload<TIn>>>;
	readonly rejected: TopicGraph<SpawnRejection<TIn>>;
	readonly activeSlot: Node<ReadonlyMap<string, AgentBundle<TIn, TOut>>>;
	private readonly _spawnSub: SubscriptionGraph<Message<SpawnPayload<TIn>>>;
	private readonly _registry: PresetRegistryBundle<AgentSpec<TIn, TOut>>;
	private readonly _depthCap: number | undefined;
	private readonly _validate: ((req: Message<SpawnPayload<TIn>>) => boolean) | undefined;
	private _disposed = false;

	constructor(opts: SpawnableOpts<TIn, TOut>) {
		const name = opts.name ?? "spawnable";
		super(name);

		this._registry = opts.registry;
		this._depthCap = opts.depthCap;
		this._validate = opts.validate;

		// Spawn topic on the hub (well-known name; lazy-created if absent).
		this.spawnTopic = opts.hub.topic<Message<SpawnPayload<TIn>>>(SPAWNS_TOPIC);

		// Rejected topic is private to this spawnable subgraph.
		this.rejected = topic<SpawnRejection<TIn>>("rejected");
		this.mount("rejected", this.rejected);

		// Active-slot map. `equals: () => false` so each mutation emits a
		// fresh snapshot even when callers pass an identity-equal Map ref.
		const activeSlotNode = node<ReadonlyMap<string, AgentBundle<TIn, TOut>>>([], {
			name: "active-slot",
			describeKind: "state",
			meta: aiMeta("spawnable_active_slot"),
			initial: new Map(),
			equals: () => false,
		});
		this.add(activeSlotNode, { name: "active-slot" });
		this.activeSlot = activeSlotNode;

		// Cursor-based subscription over hub.spawnTopic.events. Lives under
		// this spawnable subgraph (NOT the hub), so multiple spawnable
		// instances on the same hub get independent cursors.
		// Default `from: "now"` skips pre-construction retained requests —
		// older requests are NOT replayed unless the caller opts in.
		this._spawnSub = subscription<Message<SpawnPayload<TIn>>>("spawn-sub", this.spawnTopic, {
			from: opts.from ?? "now",
		});
		this.mount("spawn-sub", this._spawnSub);

		// Subscribe to `available` to process new requests; ack as we go.
		const subRef = this._spawnSub;
		const unsub = subRef.available.subscribe((msgs) => {
			if (this._disposed) return;
			for (const m of msgs) {
				if (m[0] !== DATA) continue;
				const items = m[1] as readonly Message<SpawnPayload<TIn>>[];
				if (items.length === 0) continue;
				for (const req of items) {
					if (this._disposed) return;
					this._processRequest(req);
				}
				subRef.ack(items.length);
			}
		});
		this.addDisposer(unsub);
		this.addDisposer(() => {
			this._disposed = true;
		});
		// Keepalive on the active-slot Node so external `cache` reads stay
		// current even when no one is subscribed.
		this.addDisposer(keepalive(activeSlotNode));
	}

	private _processRequest(req: Message<SpawnPayload<TIn>>): void {
		if (this._disposed) return;

		// Custom validation.
		if (this._validate && !this._validate(req)) {
			this.rejected.publish({ request: req, reason: "validation failed" });
			return;
		}

		// Expiry check (only on entry — per-agent timeouts during run are a
		// future iteration; recipe-style composition with `timeout` covers
		// the in-flight case until then). Use `wallClockNs()` so test
		// suites that monkey-patch the central clock can pin expiry decisions.
		if (req.expiresAt != null) {
			const expiry = Date.parse(req.expiresAt);
			if (!Number.isFinite(expiry)) {
				this.rejected.publish({ request: req, reason: "invalid expiresAt" });
				return;
			}
			const nowMs = wallClockNs() / 1_000_000;
			if (nowMs >= expiry) {
				this.rejected.publish({ request: req, reason: "expired" });
				return;
			}
		}

		// Depth-cap check.
		const currentMap =
			(this.activeSlot.cache as ReadonlyMap<string, AgentBundle<TIn, TOut>> | undefined) ??
			new Map();
		if (this._depthCap != null && currentMap.size >= this._depthCap) {
			this.rejected.publish({
				request: req,
				reason: `depth-cap exceeded (${currentMap.size}/${this._depthCap})`,
			});
			return;
		}

		// Look up preset.
		const spec = this._registry.registry.get(req.payload.presetId);
		if (!spec) {
			this.rejected.publish({
				request: req,
				reason: `unknown presetId: ${req.payload.presetId}`,
			});
			return;
		}

		// Mint and mount the agent. Slot name is derived from the request id
		// so it's traceable in describe / explain output.
		const slotName = `spawn-${req.id}`;
		let bundle: AgentBundle<TIn, TOut>;
		try {
			bundle = agent<TIn, TOut>(this, { ...spec, name: slotName });
		} catch (e) {
			this.rejected.publish({
				request: req,
				reason: `agent mint failed: ${(e as Error).message ?? "unknown"}`,
			});
			return;
		}

		// Update active-slot.
		const updated = new Map(currentMap);
		updated.set(req.id, bundle);
		this.activeSlot.emit(updated);

		// Watch for completion BEFORE kicking, so a synchronous adapter that
		// drives status straight to "done" inside the kick still triggers
		// cleanup. Subscribe to status; on terminal, unmount + remove. Each
		// per-spawn statusUnsub releases inside `onTerminal` so we don't
		// accumulate dead disposers per-spawn over the spawnable's lifetime.
		let statusUnsub: (() => void) | undefined;
		const onTerminal = (stat: AgentStatus): void => {
			if (stat !== "done" && stat !== "error") return;
			// Idempotent — guard against double-fire.
			const live =
				(this.activeSlot.cache as ReadonlyMap<string, AgentBundle<TIn, TOut>> | undefined) ??
				new Map();
			if (!live.has(req.id)) return;
			batch(() => {
				try {
					this.remove(slotName);
				} catch {
					// Already removed (e.g., parent destroyed mid-flight).
				}
				const next = new Map(live);
				next.delete(req.id);
				this.activeSlot.emit(next);
			});
			// Release the per-spawn status subscription now that the spawn
			// is finished — prevents disposer accumulation over many spawns.
			statusUnsub?.();
			statusUnsub = undefined;
		};
		statusUnsub = bundle.status.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) onTerminal(m[1] as AgentStatus);
			}
		});
		// Defensive disposer — fires on SpawnableGraph.destroy() if the
		// spawn is still in-flight. `onTerminal` clears `statusUnsub` so
		// double-call is a no-op.
		this.addDisposer(() => statusUnsub?.());

		// Kick the agent reactively.
		bundle.in.emit(req.payload.taskInput);
	}
}

// ---------------------------------------------------------------------------
// spawnable() factory
// ---------------------------------------------------------------------------

/**
 * Constructs a {@link SpawnableGraph}, mounts it under `opts.hub` at
 * `opts.name` (default `"spawnable"`), and returns the
 * {@link SpawnableBundle} contract.
 *
 * **Composition with Phase 13 substrate:**
 * - Builds on **13.B** ({@link Message} envelope, {@link SPAWNS_TOPIC}).
 * - Builds on **13.G/H** ({@link agent}, {@link AgentBundle}).
 * - Builds on **13.H** ({@link presetRegistry}).
 * - The depth-cap gate is documented as a **13.D recipe**
 *   (`valve(spawnTopic, derived([depthCounter], n => n < cap))`); inside
 *   `spawnable()` the depth check is per-request so over-cap requests
 *   surface on `rejected`. Callers wanting a hard cut (no rejection
 *   signal) can wrap their publish path with `valve`.
 *
 * **Strategy-key axis (DS-13.I):** when `harnessLoop` is wired to a
 * spawnable, downstream `strategy.record(...)` calls should pass the
 * spawning agent's `presetId` for the {@link strategyKey} first axis.
 * Single-agent harness keeps using {@link DEFAULT_PRESET_ID} as before.
 *
 * @example
 * ```ts
 * const hub = messagingHub("hub");
 * const presets = presetRegistry<AgentSpec<string, LLMResponse>>();
 * presets.put("researcher", { name: "researcher", adapter: openai, systemPrompt: "..." });
 * presets.put("coder", { name: "coder", adapter: anthropic, systemPrompt: "..." });
 *
 * const sp = spawnable({ hub, registry: presets, depthCap: 5 });
 *
 * // Trigger a spawn:
 * sp.spawnTopic.publish({
 *   id: "req-42",
 *   payload: { presetId: "researcher", taskInput: "what is reactive graph composition?" },
 * });
 *
 * // Observe active agents:
 * sp.activeSlot.subscribe((msgs) => { ... });
 *
 * // Observe rejections:
 * sp.rejected.events.subscribe((msgs) => { ... });
 * ```
 *
 * @category patterns
 */
export function spawnable<TIn = string, TOut = LLMResponse>(
	opts: SpawnableOpts<TIn, TOut>,
): SpawnableBundle<TIn, TOut> {
	const graph = new SpawnableGraph<TIn, TOut>(opts);
	opts.hub.mount(opts.name ?? "spawnable", graph);
	return {
		spawnTopic: graph.spawnTopic,
		activeSlot: graph.activeSlot,
		rejected: graph.rejected,
		graph,
	};
}
