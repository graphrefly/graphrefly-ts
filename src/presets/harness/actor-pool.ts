/**
 * DS-14.6.A U-B — `actorPool()` (Phase 14.5).
 *
 * The dynamic-track complement to `spawnable()` (SESSION-DS-14.6-A L7/L8 +
 * 9Q walk). An actor is **identity + cursor + tool closure, NOT a subgraph**
 * (D-B1): no per-actor mount, so `describe()` shows only the pool / todo /
 * context-hub collections and the actor count drifts inside a single
 * reactive `active` map node. `depthCap` is enforced via the depth carried
 * on the attach request (D-B2); `release()` cascades teardown to the
 * actor's context view + todo cursor subscriptions (§3i — free).
 *
 * Contrast `spawnable()`: agent IS a subgraph, topology reflects the agent
 * set, `describe()`-visible — use it when agent identities are pre-known.
 * Use `actorPool()` for runtime recursive fan-out where agent count drifts.
 *
 * @module
 */

import { type Node, node } from "@graphrefly/pure-ts/core";
import { type ReactiveLogBundle, reactiveLog } from "@graphrefly/pure-ts/extra";
import { Graph } from "@graphrefly/pure-ts/graph";
import {
	type ContextEntry,
	type ContextView,
	type RenderedEntry,
	renderContextView,
	type TaggedContextPoolBundle,
	taggedContextPool,
} from "../ai/context/index.js";

export type ActorId = string;

export interface Todo {
	readonly id: string;
	readonly assignee?: ActorId;
	readonly payload: unknown;
}

export type ActorStatus = "idle" | "running" | "blocked" | "done";

export interface ActorState {
	readonly id: ActorId;
	readonly depth: number;
	readonly status: ActorStatus;
}

export interface ActorSpec<T> {
	readonly id?: ActorId;
	/** Recursion depth — gated against `depthCap` (D-B2). Default 0 (root). */
	readonly depth?: number;
	/** Per-actor compression view over the shared context pool. */
	readonly view: Omit<ContextView<T>, "pressure"> & { readonly pressure: Node<number> };
}

export interface ActorHandle<T> {
	readonly id: ActorId;
	/** This actor's compressed context slice. */
	readonly context: Node<readonly RenderedEntry<T>[]>;
	/** Todos currently assigned to this actor (or unassigned). */
	readonly todoCursor: Node<readonly Todo[]>;
	/** Write an entry into the shared pool, stamped with this actor's id tag. */
	publish(entry: Omit<ContextEntry<T>, "id" | "t_ns"> & { id?: string }): string;
	enqueueTodo(t: Todo): void;
	readonly status: Node<ActorStatus>;
	setStatus(s: ActorStatus): void;
	/** Idempotent. Tears the actor's subscriptions + removes it from `active`. */
	release(): void;
}

export interface ActorPoolOptions<T> {
	readonly name?: string;
	/** Max recursion depth; `attachActor` with `depth > depthCap` throws. */
	readonly depthCap?: number;
	/** Forwarded to the backing context pool. */
	readonly contextTopic?: string;
	readonly llmCompress?: TaggedContextPoolBundle<T>["_opts"]["llmCompress"];
}

export interface ActorPoolBundle<T> {
	attachActor(spec: ActorSpec<T>): ActorHandle<T>;
	readonly contextPool: TaggedContextPoolBundle<T>;
	readonly todos: ReactiveLogBundle<Todo>;
	/** Single reactive map of live actors — `describe()`-coherent (D-B1). */
	readonly active: Node<ReadonlyMap<ActorId, ActorState>>;
	readonly graph: Graph;
	dispose(): void;
}

/** Process-wide sequence for collision-safe default mount names (QA P6). */
let _actorPoolSeq = 0;

export function actorPool<T = unknown>(
	parent: Graph,
	opts: ActorPoolOptions<T> = {},
): ActorPoolBundle<T> {
	// QA P6: collision-safe default — recursive fan-out spins nested pools
	// under one parent; static "actorPool" would collide on `parent.mount`.
	const name = opts.name ?? `actorPool-${++_actorPoolSeq}`;
	const graph = new Graph(name);
	parent.mount(name, graph);
	const depthCap = opts.depthCap ?? Number.POSITIVE_INFINITY;
	// QA P5: per-pool actor counter (was module-global → test-pollution).
	let autoActor = 0;
	// QA P7: track live handles so dispose() can release them all.
	const liveHandles = new Set<ActorHandle<T>>();

	const contextPool = taggedContextPool<T>(graph, {
		topic: opts.contextTopic ?? "context",
		llmCompress: opts.llmCompress,
		name: `${name}.ctx`,
	});
	const todos: ReactiveLogBundle<Todo> = reactiveLog<Todo>(undefined, { name: `${name}.todos` });

	// Single reactive `active` map node — actor count drifts inside it; no
	// per-actor subgraph mount (D-B1, describe-coherent).
	const stateMap = new Map<ActorId, ActorState>();
	const active = node<ReadonlyMap<ActorId, ActorState>>([], {
		name: `${name}.active`,
		initial: new Map(),
	});
	function pushActive(): void {
		active.emit(new Map(stateMap));
	}

	function attachActor(spec: ActorSpec<T>): ActorHandle<T> {
		const depth = spec.depth ?? 0;
		if (depth > depthCap) {
			throw new RangeError(`actorPool: depth ${depth} exceeds depthCap ${depthCap}`);
		}
		const id = spec.id ?? `actor-${++autoActor}`;

		const context = renderContextView(contextPool, spec.view as ContextView<T>);
		// Per-actor todo cursor — assigned-to-me or unassigned.
		const todoCursor = node<readonly Todo[]>(
			[todos.entries as Node],
			(data, actions, ctx) => {
				const all = (data[0] != null && data[0].length > 0 ? data[0].at(-1) : ctx.prevData[0]) as
					| readonly Todo[]
					| undefined;
				actions.emit((all ?? []).filter((t) => t.assignee === id || t.assignee === undefined));
			},
			{ describeKind: "derived" },
		);
		const status = node<ActorStatus>([], { name: `${name}.${id}.status`, initial: "idle" });

		stateMap.set(id, { id, depth, status: "idle" });
		pushActive();

		// Keepalive subs so `.cache` stays warm; torn on release (cascade-cancel).
		const subs = [
			context.subscribe(() => {}),
			todoCursor.subscribe(() => {}),
			status.subscribe(() => {}),
		];
		let released = false;

		const handle: ActorHandle<T> = {
			id,
			context,
			todoCursor,
			status,
			publish(entry) {
				const tags = [...(entry.tags ?? []), `actor:${id}`];
				return contextPool.add({ ...entry, tags });
			},
			enqueueTodo(t) {
				todos.append(t);
			},
			setStatus(s) {
				status.emit(s);
				const prev = stateMap.get(id);
				if (prev) {
					stateMap.set(id, { ...prev, status: s });
					pushActive();
				}
			},
			release() {
				if (released) return;
				released = true;
				// Cascade-cancel: tearing the keepalive subs deactivates the
				// per-actor derived nodes (lazy-deactivation — COMPOSITION-GUIDE
				// §1), detaching `context`/`todoCursor`/`status` from the shared
				// pool/todos logs once no other subscriber remains.
				for (const u of subs) u();
				stateMap.delete(id);
				liveHandles.delete(handle);
				pushActive();
			},
		};
		liveHandles.add(handle);
		return handle;
	}

	return {
		attachActor,
		contextPool,
		todos,
		active,
		graph,
		dispose(): void {
			// QA P7: release outstanding actors first (tears their keepalive
			// subs / deactivates per-actor derived nodes) before disposing the
			// shared pool + todo log.
			for (const h of [...liveHandles]) h.release();
			contextPool.dispose();
			todos.dispose();
		},
	};
}
