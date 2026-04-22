/**
 * Audit, policy enforcement, and compliance export (roadmap §9.2).
 *
 * Three composed factories that wrap any {@link Graph} with the harness
 * accountability layer:
 *
 * - {@link auditTrail} — reactive mutation log with by-node/by-actor/by-time
 *   queries.
 * - {@link policyEnforcer} — reactive ABAC enforcement; in `"audit"` mode
 *   records would-be denials, in `"enforce"` mode pushes guards onto target
 *   nodes so subsequent writes throw {@link GuardDenied}.
 * - {@link complianceSnapshot} — point-in-time export of graph state +
 *   audit trail + policies for regulatory archival.
 *
 * @module
 */
import type { Actor } from "../core/actor.js";
import { monotonicNs, wallClockNs } from "../core/clock.js";
import type { GuardAction, NodeGuard, PolicyRuleData } from "../core/guard.js";
import { policyFromRules } from "../core/guard.js";
import { DATA } from "../core/messages.js";
import type { Node } from "../core/node.js";
import { NodeImpl } from "../core/node.js";
import { derived, state } from "../core/sugar.js";
import { defaultHash } from "../core/versioning.js";
import { reactiveLog } from "../extra/reactive-log.js";
import {
	type CausalChain,
	Graph,
	type GraphOptions,
	type GraphPersistSnapshot,
	type TopologyEvent,
	watchTopologyTree,
} from "../graph/index.js";
import { domainMeta, keepalive } from "./_internal.js";
import { TopicGraph } from "./messaging.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** A single recorded mutation/event in an {@link AuditTrailGraph}. */
export interface AuditEntry {
	seq: number;
	timestamp_ns: number;
	wall_clock_ns: number;
	path: string;
	type:
		| "data"
		| "dirty"
		| "resolved"
		| "invalidate"
		| "pause"
		| "resume"
		| "complete"
		| "error"
		| "teardown";
	actor?: Actor;
	value?: unknown;
	error?: unknown;
	annotation?: string;
}

function auditMeta(kind: string, extra?: Record<string, unknown>): Record<string, unknown> {
	return domainMeta("audit", kind, extra);
}

// ---------------------------------------------------------------------------
// auditTrail
// ---------------------------------------------------------------------------

const DEFAULT_INCLUDE_TYPES: ReadonlySet<AuditEntry["type"]> = new Set([
	"data",
	"error",
	"complete",
	"teardown",
]);

/** Options for {@link auditTrail}. */
export interface AuditTrailOptions {
	name?: string;
	graph?: GraphOptions;
	/** Ring-buffer cap for the underlying `reactiveLog`. Default: unbounded. */
	maxSize?: number;
	/**
	 * Which event types to record. Default: `["data", "error", "complete",
	 * "teardown"]` — the user-meaningful set. Opt in to mid-wave protocol
	 * events (`"dirty"`, `"resolved"`, `"invalidate"`, `"pause"`, `"resume"`)
	 * by listing them explicitly. Note: those tier-1/tier-2 events do not
	 * carry an `actor` (no `lastMutation` populated) — record them only for
	 * protocol-level diagnostics.
	 */
	includeTypes?: readonly AuditEntry["type"][];
	/** Per-event filter; return false to skip. */
	filter?: (entry: AuditEntry) => boolean;
}

/**
 * Mounted audit log — `entries` exposes the reactive `AuditEntry[]`; query
 * helpers are sync convenience wrappers over the cached snapshot.
 */
export class AuditTrailGraph extends Graph {
	readonly entries: Node<readonly AuditEntry[]>;
	readonly count: Node<number>;
	private readonly _log;
	private readonly _target: Graph;

	constructor(target: Graph, opts: AuditTrailOptions) {
		super(opts.name ?? `${target.name}_audit`, opts.graph);
		this._target = target;
		this._log = reactiveLog<AuditEntry>([], {
			name: "entries",
			...(opts.maxSize != null ? { maxSize: opts.maxSize } : {}),
		});
		this.entries = this._log.entries;
		this.add(this.entries, { name: "entries" });

		this.count = derived<number>(
			[this.entries],
			([snapshot]) => (snapshot as readonly AuditEntry[]).length,
			{ name: "count", describeKind: "derived", meta: auditMeta("count") },
		);
		this.add(this.count, { name: "count" });
		this.addDisposer(keepalive(this.count));

		const includeTypes =
			opts.includeTypes != null ? new Set(opts.includeTypes) : DEFAULT_INCLUDE_TYPES;
		const filter = opts.filter;

		// Monotonic per-trail. Wraps around at Number.MAX_SAFE_INTEGER (~9e15);
		// at 100k events/sec that's ~3000 years — not a practical concern.
		let seq = 0;
		const handle = target.observe({ timeline: true, structured: true });
		const offEvent = handle.onEvent((event) => {
			// `event.type` includes "derived" (causal-trace recompute marker) which
			// isn't a recordable mutation — skip it. Cast through narrowed type
			// after the discriminator check.
			if (event.type === "derived") return;
			const type = event.type as AuditEntry["type"];
			if (!includeTypes.has(type)) return;
			const path = event.path ?? "";
			const entry: AuditEntry = {
				seq: seq++,
				timestamp_ns: event.timestamp_ns ?? monotonicNs(),
				wall_clock_ns: wallClockNs(),
				path,
				type,
			};
			// Attribution + value enrichment.
			const node = path ? safeNode(target, path) : undefined;
			const lastMutation = node?.lastMutation;
			if (lastMutation != null) entry.actor = lastMutation.actor;
			if (type === "data") entry.value = (event as { data: unknown }).data;
			if (type === "error") entry.error = (event as { data: unknown }).data;
			const annotation = path ? safeAnnotation(target, path) : undefined;
			if (annotation != null) entry.annotation = annotation;
			if (filter != null && !filter(entry)) return;
			this._log.append(entry);
		});

		this.addDisposer(() => {
			offEvent();
			handle.dispose();
		});
		this.addDisposer(() => this._log.disposeAllViews());
	}

	/** All entries currently in the ring (snapshot). */
	all(): readonly AuditEntry[] {
		return (this.entries.cache as readonly AuditEntry[] | undefined) ?? [];
	}

	/** Entries matching `path`. Order preserved. */
	byNode(path: string): readonly AuditEntry[] {
		return this.all().filter((e) => e.path === path);
	}

	/** Entries whose `actor.id` matches. Use `byActorType` for type filtering. */
	byActor(actorId: string): readonly AuditEntry[] {
		return this.all().filter((e) => e.actor?.id === actorId);
	}

	/** Entries whose `actor.type` matches (e.g. `"llm"`, `"human"`). */
	byActorType(type: string): readonly AuditEntry[] {
		return this.all().filter((e) => e.actor?.type === type);
	}

	/**
	 * Entries with `timestamp_ns` in `[start_ns, end_ns)` (end exclusive).
	 * Omit `end_ns` to query open-ended.
	 */
	byTimeRange(start_ns: number, end_ns?: number): readonly AuditEntry[] {
		return this.all().filter((e) => {
			if (e.timestamp_ns < start_ns) return false;
			if (end_ns != null && e.timestamp_ns >= end_ns) return false;
			return true;
		});
	}

	/** Reference to the audited graph (escape hatch for tooling). */
	get target(): Graph {
		return this._target;
	}
}

/**
 * Wraps any {@link Graph} with a reactive audit trail recording every event
 * matching `includeTypes` (default: data + error + complete + teardown).
 *
 * Each entry carries `seq`, `timestamp_ns` (monotonic), `wall_clock_ns`,
 * `path`, `type`, and — when available — `actor`, `value`, `error`, and the
 * `graph.trace()` reasoning annotation for the path.
 *
 * The returned graph mounts an `entries` node + `count` derived. Query
 * helpers (`byNode`, `byActor`, `byTimeRange`) operate on the cached
 * snapshot synchronously.
 */
export function auditTrail(target: Graph, opts: AuditTrailOptions = {}): AuditTrailGraph {
	return new AuditTrailGraph(target, opts);
}

// ---------------------------------------------------------------------------
// policyEnforcer
// ---------------------------------------------------------------------------

/** A single policy denial recorded by {@link PolicyEnforcerGraph}. */
export interface PolicyViolation {
	timestamp_ns: number;
	wall_clock_ns: number;
	path: string;
	actor: Actor;
	action: GuardAction;
	mode: "audit" | "enforce";
	/** `"observed"` (audit mode after-the-fact) or `"blocked"` (enforce mode pre-write). */
	result: "observed" | "blocked";
}

/** Options for {@link policyEnforcer}. */
export interface PolicyEnforcerOptions {
	name?: string;
	graph?: GraphOptions;
	/**
	 * `"audit"` (default) — observe events and record would-be denials;
	 * does not block writes. Audit mode requires `lastMutation` attribution
	 * on the audited node — anonymous/internal writes (no `actor` passed,
	 * unguarded node) are skipped silently because the policy cannot be
	 * evaluated without an actor.
	 *
	 * `"enforce"` — push guards onto target nodes so disallowed writes
	 * throw {@link GuardDenied}. Reverted on dispose.
	 */
	mode?: "audit" | "enforce";
	/**
	 * Restrict enforcement to specific node paths (qualified). When omitted,
	 * applies to every node visible in `target.describe()` at construction
	 * time (subgraphs are walked transitively) AND subscribes to the full
	 * topology tree via {@link watchTopologyTree}, so nodes added to
	 * `target` OR any transitively-mounted subgraph after construction are
	 * guarded automatically (enforce mode only).
	 *
	 * **Cost:** unrestricted mode runs `describe({detail:"minimal"})` once
	 * at construction (O(N) over the graph tree) plus one topology
	 * subscription per graph instance in the mount tree. Restricted mode
	 * skips both and disables dynamic coverage — callers providing
	 * `paths` must re-create on subgraph changes.
	 */
	paths?: readonly string[];
	/** Ring-buffer cap for the violations topic. Default: 1000. */
	violationsLimit?: number;
}

/**
 * Reactive ABAC enforcement layer. Policies are reactive — pass a
 * `Node<readonly PolicyRuleData[]>` to allow LLMs (or any reactive source)
 * to update them at runtime; the enforcer rebinds its internal
 * {@link NodeGuard} on every push.
 */
export class PolicyEnforcerGraph extends Graph {
	readonly policies: Node<readonly PolicyRuleData[]>;
	readonly violations: TopicGraph<PolicyViolation>;
	readonly violationCount: Node<number>;
	private readonly _target: Graph;
	private readonly _mode: "audit" | "enforce";
	private _currentGuard: NodeGuard;

	constructor(
		target: Graph,
		policies: readonly PolicyRuleData[] | Node<readonly PolicyRuleData[]>,
		opts: PolicyEnforcerOptions,
	) {
		super(opts.name ?? `${target.name}_policy`, opts.graph);
		this._target = target;
		this._mode = opts.mode ?? "audit";

		const policiesNode = isNode(policies)
			? policies
			: state<readonly PolicyRuleData[]>(policies, { name: "policies" });
		this.policies = policiesNode;
		this.add(this.policies, { name: "policies" });

		this.violations = new TopicGraph<PolicyViolation>("violations", {
			retainedLimit: opts.violationsLimit ?? 1000,
		});
		this.mount("violations", this.violations);

		this.violationCount = derived<number>(
			[this.violations.events],
			([snapshot]) => (snapshot as readonly PolicyViolation[]).length,
			{
				name: "violationCount",
				describeKind: "derived",
				meta: auditMeta("policy_violation_count"),
			},
		);
		this.add(this.violationCount, { name: "violationCount" });
		this.addDisposer(keepalive(this.violationCount));

		// Factory-time seed (COMPOSITION-GUIDE §28): cache the latest rules
		// inside a closure, refresh on each subscribe-pushed update, and read
		// closure inside the guard so policy updates take effect immediately.
		const initialRules = (policiesNode.cache as readonly PolicyRuleData[] | undefined) ?? [];
		let latestRules: readonly PolicyRuleData[] = initialRules;
		this._currentGuard = policyFromRules(latestRules);
		const offPolicies = policiesNode.subscribe((msgs) => {
			for (const m of msgs) {
				if (m[0] === DATA) {
					latestRules = (m[1] as readonly PolicyRuleData[] | undefined) ?? [];
					this._currentGuard = policyFromRules(latestRules);
				}
			}
		});
		this.addDisposer(offPolicies);

		// Determine which target paths to watch.
		const paths = opts.paths != null ? [...opts.paths] : collectPaths(target);

		if (this._mode === "enforce") {
			// Track which paths are currently guarded so dynamic adds don't
			// double-wrap and removed nodes release guard handles.
			const restorers = new Map<string, () => void>();
			const wrapAndPush = (path: string): void => {
				if (restorers.has(path)) return;
				const node = safeNode(target, path);
				if (!(node instanceof NodeImpl)) return;
				const pathGuard: NodeGuard = (actor, action) => {
					const ok = this._currentGuard(actor, action);
					if (!ok) {
						this._publishViolation(actor, action, path, "blocked");
					}
					return ok;
				};
				restorers.set(path, node._pushGuard(pathGuard));
			};
			// Initial sweep: guard every path present at construction.
			for (const path of paths) wrapAndPush(path);

			// Dynamic coverage: when `paths` was NOT explicitly provided, follow
			// the full topology tree (target + every transitively-mounted
			// subgraph, including subgraphs mounted after construction) so late
			// adds at any depth get guarded. `prefix` carries the qualified
			// path-prefix from `target` to the emitter graph.
			if (opts.paths == null) {
				const offTopology = watchTopologyTree(target, (event, emitter, prefix) => {
					if (event.kind === "added") {
						if (event.nodeKind === "node") {
							wrapAndPush(`${prefix}${event.name}`);
						} else {
							// Mount added. Walk just the newly-mounted subgraph's local
							// paths (scoped describe — O(M) in the mounted subtree)
							// rather than re-describing the entire target tree. The
							// emitter is the PARENT of the new mount; resolve the child
							// via its `_mounts` map.
							const child = emitter._mounts.get(event.name);
							if (!(child instanceof Graph)) return;
							const mountPrefix = `${prefix}${event.name}::`;
							const localPaths = collectPaths(child);
							for (const localPath of localPaths) {
								// `localPath` is relative to `child`; qualify with the
								// mount prefix so guard keys stay target-rooted.
								wrapAndPush(
									localPath === "" ? `${prefix}${event.name}` : `${mountPrefix}${localPath}`,
								);
							}
						}
					} else if (event.kind === "removed") {
						// TEARDOWN already unhooks the guard; release bookkeeping so
						// re-adds under the same qualified path re-wrap cleanly.
						if (event.nodeKind === "node") {
							const qp = `${prefix}${event.name}`;
							const r = restorers.get(qp);
							if (r != null) {
								r();
								restorers.delete(qp);
							}
						} else {
							const mountQp = `${prefix}${event.name}`;
							const mountPrefix = `${mountQp}::`;
							for (const [p, r] of restorers) {
								if (p === mountQp || p.startsWith(mountPrefix)) {
									r();
									restorers.delete(p);
								}
							}
						}
					}
				});
				this.addDisposer(offTopology);
			} else {
				// Restricted mode: subscribe to target.topology (own-graph only —
				// explicit `paths` means caller owns the path set) so node removals
				// release their restorers instead of leaking until enforcer dispose.
				const offCleanup = target.topology.subscribe((msgs) => {
					for (const m of msgs) {
						if (m[0] !== DATA) continue;
						const event = m[1] as TopologyEvent;
						if (event.kind !== "removed" || event.nodeKind !== "node") continue;
						const r = restorers.get(event.name);
						if (r != null) {
							r();
							restorers.delete(event.name);
						}
					}
				});
				this.addDisposer(offCleanup);
			}
			this.addDisposer(() => {
				for (const r of restorers.values()) r();
				restorers.clear();
			});
		} else {
			// Audit mode: observe writes, evaluate against current guard, record
			// violations without blocking. Use the structured observe stream so
			// `path` and `actor` attribution are supplied without per-node
			// subscription bookkeeping. B9: unattributed writes no longer skip
			// — the ObserveEvent always carries a well-formed `actor` (falling
			// back to `DEFAULT_ACTOR` for anonymous/internal writes), so the
			// policy is evaluated against every write.
			const handle = target.observe({ timeline: true, structured: true });
			const off = handle.onEvent((event) => {
				if (event.type !== "data" && event.type !== "error") return;
				const path = event.path ?? "";
				if (!path) return;
				if (opts.paths != null && !opts.paths.includes(path)) return;
				// Prefer the event-stamped actor (always populated for DATA/ERROR
				// post-B9). Fall back to lastMutation for back-compat with any
				// consumer stubbing observe events without the field.
				const actor =
					(event as { actor?: Actor }).actor ?? safeNode(target, path)?.lastMutation?.actor;
				if (actor == null) return; // defensive — shouldn't happen post-B9
				const action: GuardAction = "write";
				if (this._currentGuard(actor, action)) return;
				this._publishViolation(actor, action, path, "observed");
			});
			this.addDisposer(() => {
				off();
				handle.dispose();
			});
		}
	}

	private _publishViolation(
		actor: Actor,
		action: GuardAction,
		path: string,
		result: "observed" | "blocked",
	): void {
		this.violations.publish({
			timestamp_ns: monotonicNs(),
			wall_clock_ns: wallClockNs(),
			path,
			actor,
			action,
			mode: this._mode,
			result,
		});
	}

	/** Snapshot of recorded violations. */
	all(): readonly PolicyViolation[] {
		return this.violations.retained();
	}

	get mode(): "audit" | "enforce" {
		return this._mode;
	}

	get target(): Graph {
		return this._target;
	}
}

/**
 * Wraps a {@link Graph} with reactive policy enforcement. Pass either a
 * static rule list or a {@link Node} of rules (LLM-updatable). Records
 * `PolicyViolation` entries to `violations` topic; in `"enforce"` mode also
 * pushes guards onto target nodes so disallowed writes throw.
 */
export function policyEnforcer(
	target: Graph,
	policies: readonly PolicyRuleData[] | Node<readonly PolicyRuleData[]>,
	opts: PolicyEnforcerOptions = {},
): PolicyEnforcerGraph {
	return new PolicyEnforcerGraph(target, policies, opts);
}

// ---------------------------------------------------------------------------
// reactiveExplainPath
// ---------------------------------------------------------------------------

/**
 * Reactive {@link CausalChain} that recomputes whenever the audited graph
 * changes. Returns a `Node<CausalChain>` suitable for subscription, mounting,
 * or composition (e.g. inside `graphLens.why(node)`).
 *
 * **How it stays live:** an internal `version` state is bumped by an observer
 * attached to `target.observe()`; the derived chain depends on `version`, so
 * each mutation triggers a recompute. To avoid stalling on no-op events, only
 * `data`, `error`, `complete`, and `teardown` bump the version (matching the
 * audit defaults).
 */
/**
 * @deprecated Use `graph.explain(from, to, { reactive: true, ... })` directly.
 *   This free-function wrapper now dispatches to the consolidated
 *   {@link Graph.explain} overload for mental-model consistency with
 *   `describe` / `observe`. Will be removed pre-1.0.
 */
export function reactiveExplainPath(
	target: Graph,
	from: string,
	to: string,
	opts?: { maxDepth?: number; name?: string; findCycle?: boolean },
): { node: Node<CausalChain>; dispose: () => void } {
	return target.explain(from, to, { reactive: true, ...opts });
}

// ---------------------------------------------------------------------------
// complianceSnapshot
// ---------------------------------------------------------------------------

/** Options for {@link complianceSnapshot}. */
export interface ComplianceSnapshotOptions {
	audit?: AuditTrailGraph;
	policies?: PolicyEnforcerGraph;
	/** Actor recorded as the snapshot taker. */
	actor?: Actor;
}

/** Output of {@link complianceSnapshot}. JSON-serializable. */
export interface ComplianceSnapshotResult {
	format_version: 1;
	timestamp_ns: number;
	wall_clock_ns: number;
	actor?: Actor;
	graph: GraphPersistSnapshot;
	audit?: { count: number; entries: AuditEntry[] };
	policies?: {
		mode: "audit" | "enforce";
		rules: readonly PolicyRuleData[];
		violations: readonly PolicyViolation[];
	};
	/**
	 * Truncated SHA-256 hex (16 chars / ~64 bits) over a canonical encoding
	 * of every field above (excluding `fingerprint` itself). Deterministic
	 * across runs given identical inputs. Suitable for casual tamper-evidence
	 * and content-addressed dedup; for full cryptographic strength, hash the
	 * canonical JSON externally with Web Crypto / Node `crypto`.
	 */
	fingerprint: string;
}

/**
 * One-shot point-in-time export of a {@link Graph}'s state plus optional
 * audit + policy bundles. Returns a JSON-serializable object with a
 * deterministic truncated-SHA-256 {@link ComplianceSnapshotResult.fingerprint}
 * over the canonical payload for tamper-evidence in regulatory archival.
 *
 * **Cryptographic strength:** the fingerprint is truncated to 64 bits for
 * compact archival. Collision-resistant for casual integrity checks but NOT
 * sufficient for adversarial tamper-evidence — pair with a full SHA-256
 * (or stronger) over the canonical JSON when regulatory requirements demand
 * collision resistance.
 */
export function complianceSnapshot(
	target: Graph,
	opts: ComplianceSnapshotOptions = {},
): ComplianceSnapshotResult {
	const result: Omit<ComplianceSnapshotResult, "fingerprint"> = {
		format_version: 1,
		timestamp_ns: monotonicNs(),
		wall_clock_ns: wallClockNs(),
		graph: target.snapshot() as GraphPersistSnapshot,
	};
	if (opts.actor != null) result.actor = opts.actor;
	if (opts.audit != null) {
		const entries = [...opts.audit.all()];
		result.audit = { count: entries.length, entries };
	}
	if (opts.policies != null) {
		const rules = (opts.policies.policies.cache as readonly PolicyRuleData[] | undefined) ?? [];
		result.policies = {
			mode: opts.policies.mode,
			rules,
			violations: [...opts.policies.all()],
		};
	}
	const fingerprint = computeFingerprint(result);
	return { ...result, fingerprint };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function isNode<T>(x: unknown): x is Node<T> {
	return typeof x === "object" && x !== null && "subscribe" in (x as object);
}

function safeNode(target: Graph, path: string): Node | undefined {
	try {
		return target.node(path);
	} catch {
		return undefined;
	}
}

function safeAnnotation(target: Graph, path: string): string | undefined {
	try {
		return target.annotation(path);
	} catch {
		return undefined;
	}
}

/**
 * Walks every locally-registered node path in `target`, descending through
 * mounted subgraphs. Returns qualified paths.
 */
function collectPaths(target: Graph): string[] {
	const described = target.describe({ detail: "minimal" });
	return Object.keys(described.nodes);
}

/**
 * Stable canonical JSON → truncated SHA-256 hex fingerprint (16 hex chars,
 * ~64-bit). Uses the same vendored sync SHA-256 as `core/versioning.ts`
 * `defaultHash`, so cross-module fingerprints stay consistent.
 *
 * Canonicalization handles cycles (recursion-stack tracker), `undefined`,
 * `bigint`, `Map`, `Set`, `Date`, `RegExp`, and typed arrays via typed
 * markers — see {@link canonicalize}.
 *
 * **Note:** truncated to 16 hex chars (~64-bit) for compact archival. For
 * full 256-bit cryptographic strength, hash {@link complianceSnapshot} JSON
 * externally with Web Crypto / Node `crypto`.
 */
function computeFingerprint(value: unknown): string {
	// Pre-stringify our canonical form so `defaultHash`'s
	// `canonicalizeForHash` (which rejects unsafe integers) only ever sees a
	// JSON string. Compliance payloads carry `timestamp_ns` values that
	// exceed `Number.MAX_SAFE_INTEGER` — JSON.stringify handles them fine,
	// the hash function only cares about deterministic input bytes.
	return defaultHash(JSON.stringify(canonicalize(value)));
}

/**
 * Cycle-safe canonical encoding. Uses a recursion-stack `Set` (push on
 * descent, pop on return) so legitimate DAG re-references are encoded as
 * themselves; only true cycles produce a `__circular: true` marker. Typed
 * markers preserve `undefined` / `bigint` / `Map` / `Set` / `Date` / `RegExp`
 * / typed-array information that bare `JSON.stringify` would silently drop
 * or collide with strings.
 */
function canonicalize(value: unknown): unknown {
	const stack = new Set<object>();
	const walk = (v: unknown): unknown => {
		if (v === undefined) return { __undefined: true };
		if (v === null) return null;
		const t = typeof v;
		if (t === "bigint") return { __bigint: (v as bigint).toString() };
		if (t !== "object") return v;
		const obj = v as object;
		if (stack.has(obj)) return { __circular: true };
		stack.add(obj);
		try {
			if (Array.isArray(obj)) {
				return (obj as unknown[]).map(walk);
			}
			if (obj instanceof Date) {
				return { __date: obj.toISOString() };
			}
			if (obj instanceof RegExp) {
				return { __regexp: { source: obj.source, flags: obj.flags } };
			}
			if (obj instanceof Map) {
				const entries = [...(obj as Map<unknown, unknown>).entries()].map(([k, mv]) => [
					walk(k),
					walk(mv),
				]);
				return { __map: entries };
			}
			if (obj instanceof Set) {
				const items = [...(obj as Set<unknown>)].map(walk);
				return { __set: items };
			}
			if (ArrayBuffer.isView(obj)) {
				const ta = obj as unknown as { length: number; [i: number]: number };
				const arr: number[] = new Array(ta.length);
				for (let i = 0; i < ta.length; i++) arr[i] = ta[i] ?? 0;
				return { __typed_array: { ctor: obj.constructor.name, data: arr } };
			}
			const out: Record<string, unknown> = {};
			for (const k of Object.keys(obj as Record<string, unknown>).sort()) {
				out[k] = walk((obj as Record<string, unknown>)[k]);
			}
			return out;
		} finally {
			stack.delete(obj);
		}
	};
	return walk(value);
}

// `explainPath` / `CausalChain` / `CausalStep` are exported from `graph/`
// at module root; do not re-export here to keep the namespace boundary clean
// and avoid duplicate-identifier issues in bundled .d.ts.
