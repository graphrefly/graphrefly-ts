/**
 * Rust-via-napi impl arm — Phase E rustImpl activation slice (D073–D077).
 *
 * Wraps `@graphrefly/native` (the napi-rs binding compiled from
 * `~/src/graphrefly-rs/crates/graphrefly-bindings-js/`) into the
 * `Impl` interface.
 *
 * # Architecture (D073 — JS-side value registry)
 *
 * The Rust binding stays handle-opaque: `BenchCore` only sees u32
 * `HandleId`s. User values `T` live in this module's `JSValueRegistry`.
 * For each `BenchCore` instance, the adapter:
 *
 * 1. Constructs a `JSValueRegistry` (per-Impl `Map<u32, unknown>`).
 * 2. Wires `core.setReleaseCallback(h => registry.delete(h))` so the
 *    JS mirror prunes when Rust-side refcount drops (D076).
 * 3. Exposes `RustNode<T>` / `RustGraph` wrappers; methods that touch
 *    Core await the napi async methods.
 *
 * # Sink semantics (D077 — async-everywhere)
 *
 * `await node.subscribe(cb)` resolves AFTER the handshake's sink
 * callback completes (per `bridge_sync_unit` blocking the tokio
 * thread). So `expect(seen).toContain(initial)` works synchronously
 * after the await.
 *
 * # Failure mode: native binding not built
 *
 * If `@graphrefly/native`'s `.node` artifact isn't built (`pnpm
 * --filter @graphrefly/native build`), the require fails. We export
 * `rustImpl: null` in that case so the registry filters it out and
 * scenarios run against legacy only.
 */

import * as legacy from "@graphrefly/pure-ts";
import { afterEach } from "vitest";
import type {
	Impl,
	ImplAppendLogTier,
	ImplCheckpointSnapshotTier,
	ImplGraph,
	ImplKvTier,
	ImplMemoryBackend,
	ImplNode,
	ImplReactiveIndex,
	ImplReactiveList,
	ImplReactiveLog,
	ImplReactiveMap,
	ImplSnapshotTier,
	ImplStorageHandle,
	ImplWalKvTier,
	Message,
	RestoreResultOutput,
	SinkFn,
	StorageImpl,
	StructuresImpl,
	TierOpts,
	UnsubFn,
} from "./types.js";

// ---------------------------------------------------------------------------
// Native binding load (graceful fallback if not built).
// ---------------------------------------------------------------------------

type NativeModule = typeof import("@graphrefly/native");

let native: NativeModule | null = null;
try {
	native = require("@graphrefly/native") as NativeModule;
} catch (e) {
	if (process.env.GRAPHREFLY_PARITY_VERBOSE) {
		console.warn(`[parity-tests] @graphrefly/native not loaded; rustImpl arm disabled. ${e}`);
	}
}

// ---------------------------------------------------------------------------
// Variant code table (must match `core_bindings.rs` MSG_CODE_*).
// ---------------------------------------------------------------------------

const MSG_CODE_START = 0;
const MSG_CODE_DIRTY = 1;
const MSG_CODE_RESOLVED = 2;
const MSG_CODE_DATA = 3;
const MSG_CODE_INVALIDATE = 4;
const MSG_CODE_PAUSE = 5;
const MSG_CODE_RESUME = 6;
const MSG_CODE_COMPLETE = 7;
const MSG_CODE_ERROR = 8;
const MSG_CODE_TEARDOWN = 9;

function tierForCode(code: number): symbol {
	switch (code) {
		case MSG_CODE_DIRTY:
			return legacy.DIRTY;
		case MSG_CODE_RESOLVED:
			return legacy.RESOLVED;
		case MSG_CODE_DATA:
			return legacy.DATA;
		case MSG_CODE_INVALIDATE:
			return legacy.INVALIDATE;
		case MSG_CODE_PAUSE:
			return legacy.PAUSE;
		case MSG_CODE_RESUME:
			return legacy.RESUME;
		case MSG_CODE_COMPLETE:
			return legacy.COMPLETE;
		case MSG_CODE_ERROR:
			return legacy.ERROR;
		case MSG_CODE_TEARDOWN:
			return legacy.TEARDOWN;
		default:
			return Symbol(`unknown-tier-${code}`);
	}
}

/**
 * Decode a flat `[code_0, payload_0, code_1, payload_1, ...]` array into
 * the legacy `Message<T>` tuple shape, using the JS-side registry to
 * resolve handle payloads to T values. Skips `Start` (user sinks
 * don't see the per-subscription handshake — legacy filters it).
 *
 * Used by `RustGraph.observe()` (Slice X2) and the per-node
 * `RustNode.subscribe` flow (which inlines the same logic but with
 * cache-mirror update side effects).
 *
 * Slice X3 /qa Group 2 #1: throws on missing-handle for DATA/ERROR
 * payloads instead of silently coercing to `undefined`. Per spec
 * §2.2.1, `undefined` DATA payload is the SENTINEL guard for
 * "never emitted" — silently producing `[DATA, undefined]` from a
 * registry-mirror miss would be misinterpreted by downstream sinks.
 * Mirrors the `closure_h_to_h` panic-on-unknown-HandleId discipline
 * (operator_bindings.rs).
 */
function decodeMessages<T>(flat: ReadonlyArray<number>, registry: JSValueRegistry): Message<T>[] {
	const messages: Message<T>[] = [];
	for (let i = 0; i < flat.length; i += 2) {
		const code = flat[i];
		const payload = flat[i + 1];
		if (code === MSG_CODE_START) continue;
		if (code === MSG_CODE_DATA || code === MSG_CODE_ERROR) {
			if (!registry.has(payload)) {
				throw new Error(
					`[parity-tests rust] decodeMessages: unknown HandleId(${payload}) for ` +
						`code=${code === MSG_CODE_DATA ? "DATA" : "ERROR"}; registry mirror missing. ` +
						`Possible Rust-side handle was leaked or release_callback didn't fire.`,
				);
			}
			messages.push([
				code === MSG_CODE_DATA ? legacy.DATA : legacy.ERROR,
				registry.get<T>(payload) as T,
			] as Message<T>);
		} else if (code === MSG_CODE_PAUSE || code === MSG_CODE_RESUME) {
			messages.push([tierForCode(code), payload] as Message<T>);
		} else {
			messages.push([tierForCode(code)] as Message<T>);
		}
	}
	return messages;
}

function symbolToCode(sym: symbol): number {
	if (sym === legacy.DATA) return MSG_CODE_DATA;
	if (sym === legacy.DIRTY) return MSG_CODE_DIRTY;
	if (sym === legacy.RESOLVED) return MSG_CODE_RESOLVED;
	if (sym === legacy.INVALIDATE) return MSG_CODE_INVALIDATE;
	if (sym === legacy.PAUSE) return MSG_CODE_PAUSE;
	if (sym === legacy.RESUME) return MSG_CODE_RESUME;
	if (sym === legacy.COMPLETE) return MSG_CODE_COMPLETE;
	if (sym === legacy.ERROR) return MSG_CODE_ERROR;
	if (sym === legacy.TEARDOWN) return MSG_CODE_TEARDOWN;
	throw new Error(`[parity-tests rust] unknown tier symbol: ${String(sym)}`);
}

// ---------------------------------------------------------------------------
// JSValueRegistry (D073) — per-BenchCore Map<u32 handle, T>.
//
// The Rust binding pre-installs the release callback to prune entries
// when refcount drops to 0. Late prunes are benign — handle IDs are
// monotonic, never reused.
// ---------------------------------------------------------------------------

class JSValueRegistry {
	private store = new Map<number, unknown>();

	set(handle: number, value: unknown): void {
		this.store.set(handle, value);
	}

	get<T>(handle: number): T | undefined {
		return this.store.get(handle) as T | undefined;
	}

	has(handle: number): boolean {
		return this.store.has(handle);
	}

	delete(handle: number): void {
		this.store.delete(handle);
	}

	get size(): number {
		return this.store.size;
	}
}

// ---------------------------------------------------------------------------
// RustNode<T>
// ---------------------------------------------------------------------------

class RustNode<T> implements ImplNode<T> {
	private cacheValue: T | undefined = undefined;

	constructor(
		private readonly core: import("@graphrefly/native").BenchCore,
		public readonly nodeId: number,
		private readonly registry: JSValueRegistry,
	) {}

	get inner(): unknown {
		return this.nodeId;
	}

	get cache(): T | undefined {
		return this.cacheValue;
	}

	/** Internal: update the JS-side cache mirror. Called from sink
	 * delivery so the synchronous `cache` getter sees fresh values. */
	_updateCache(value: T | undefined): void {
		this.cacheValue = value;
	}

	async subscribe(cb: SinkFn<T>): Promise<UnsubFn> {
		const registry = this.registry;

		const sink = (flat: number[]): void => {
			const messages: Message<T>[] = [];
			for (let i = 0; i < flat.length; i += 2) {
				const code = flat[i];
				const payload = flat[i + 1];
				if (code === MSG_CODE_START) {
					// User sinks don't observe the per-subscription Start
					// handshake (legacy filters it out before user sink).
					continue;
				}
				if (code === MSG_CODE_DATA) {
					const value = registry.get<T>(payload);
					this._updateCache(value);
					messages.push([legacy.DATA, value as T] as Message<T>);
				} else if (code === MSG_CODE_ERROR) {
					const value = registry.get<T>(payload);
					messages.push([legacy.ERROR, value as T] as Message<T>);
				} else if (code === MSG_CODE_PAUSE || code === MSG_CODE_RESUME) {
					messages.push([tierForCode(code), payload] as Message<T>);
				} else if (code === MSG_CODE_INVALIDATE) {
					this._updateCache(undefined);
					messages.push([tierForCode(code)] as Message<T>);
				} else {
					messages.push([tierForCode(code)] as Message<T>);
				}
			}
			cb(messages);
		};
		const subIdx = await this.core.subscribeWithTsfn(this.nodeId, sink);
		return async () => {
			await this.core.unsubscribe(subIdx);
		};
	}

	async down(msgs: ReadonlyArray<Message<T>>): Promise<void> {
		// Encode the batch into a flat [code, payload, ...] array and
		// dispatch via `batch_emit_handle_messages` so the whole batch
		// runs in ONE Core wave (Phase E /qa F2 — D077 "one call = one
		// wave"). Per-message await-loop violated batch atomicity.
		const encoded: number[] = [];
		let invalidated = false;
		for (const msg of msgs) {
			const tier = msg[0] as symbol;
			if (tier === legacy.DATA) {
				const value = msg[1] as T;
				const h = this.core.allocExternalHandle();
				this.registry.set(h, value);
				encoded.push(MSG_CODE_DATA, h);
			} else if (tier === legacy.DIRTY) {
				// Core auto-prefixes DIRTY; explicit DIRTY is a no-op
				// (parity with legacy's auto-DIRTY-prefix on tier-3
				// emissions). Encode anyway so the batch length matches
				// caller expectations; Rust side ignores it.
				encoded.push(MSG_CODE_DIRTY, 0);
			} else if (tier === legacy.INVALIDATE) {
				encoded.push(MSG_CODE_INVALIDATE, 0);
				invalidated = true;
			} else if (tier === legacy.PAUSE) {
				encoded.push(MSG_CODE_PAUSE, msg[1] as number);
			} else if (tier === legacy.RESUME) {
				encoded.push(MSG_CODE_RESUME, msg[1] as number);
			} else if (tier === legacy.COMPLETE) {
				encoded.push(MSG_CODE_COMPLETE, 0);
			} else if (tier === legacy.ERROR) {
				// Allocate a handle for the error payload; Core takes
				// ownership of the share via `core.error(nid, h)` inside
				// the batch (Phase E /qa F4 — previously this path
				// allocated and leaked because the binding called
				// `errorInt(node, 0)` discarding the handle).
				const value = msg[1] as T;
				const h = this.core.allocExternalHandle();
				this.registry.set(h, value);
				encoded.push(MSG_CODE_ERROR, h);
			} else if (tier === legacy.TEARDOWN) {
				encoded.push(MSG_CODE_TEARDOWN, 0);
			}
		}
		await this.core.batchEmitHandleMessages(this.nodeId, encoded);
		// Cache mirror update after the batch resolves so a Core throw
		// doesn't corrupt the mirror (Phase E /qa F12 — order-of-ops
		// fix; was updating mirror before await).
		if (invalidated) {
			this._updateCache(undefined);
		}
	}

	async complete(): Promise<void> {
		await this.core.complete(this.nodeId);
	}

	async error(value: T): Promise<void> {
		// Phase E /qa F4 (2026-05-08): route through `batchEmitHandleMessages`
		// so the handle reaches Core (and Core takes ownership of the
		// retain share). Previously this path allocated a handle and
		// then called `errorInt(node, 0)` — Core never saw the handle,
		// refcount stayed at 1 forever, and payload identity was lost.
		const h = this.core.allocExternalHandle();
		this.registry.set(h, value);
		await this.core.batchEmitHandleMessages(this.nodeId, [MSG_CODE_ERROR, h]);
	}

	async invalidate(): Promise<void> {
		await this.core.invalidate(this.nodeId);
		this._updateCache(undefined);
	}

	async teardown(): Promise<void> {
		await this.core.teardown(this.nodeId);
	}

	async pause(lockId: number): Promise<void> {
		await this.core.pause(this.nodeId, lockId);
	}

	async resume(lockId: number): Promise<{ replayed: number; dropped: number } | null> {
		return await this.core.resume(this.nodeId, lockId);
	}

	async allocLockId(): Promise<number> {
		return await this.core.allocLockId();
	}

	async setResubscribable(value: boolean): Promise<void> {
		await this.core.setResubscribable(this.nodeId, value);
	}

	async hasFiredOnce(): Promise<boolean> {
		return await this.core.hasFiredOnce(this.nodeId);
	}
}

// ---------------------------------------------------------------------------
// RustGraph
// ---------------------------------------------------------------------------

class RustGraph implements ImplGraph {
	constructor(
		private readonly bench: import("@graphrefly/native").BenchGraph,
		private readonly core: import("@graphrefly/native").BenchCore,
		private readonly registry: JSValueRegistry,
		private readonly nodesByName: Map<string, RustNode<unknown>> = new Map(),
	) {}

	tryResolve(path: string): ImplNode<unknown> | undefined {
		const id = this.bench.tryResolve(path);
		if (id === 0) return undefined;
		// Phase E /qa F6 (2026-05-08): for cross-mount paths
		// (e.g. `"child::inner"`), `nodesByName` only stores
		// LOCAL-graph names — the cached lookup misses even when
		// BenchGraph successfully walked the mount tree. Fall back
		// to constructing a fresh RustNode from the resolved id;
		// the cache mirror won't reflect prior emissions on this
		// freshly-wrapped node, but the node is functionally usable
		// (subscribe / down / cache accessor all work).
		const cached = this.nodesByName.get(path);
		if (cached) return cached;
		return new RustNode<unknown>(this.core, id, this.registry);
	}

	nameOf(node: ImplNode<unknown>): string | undefined {
		const id = node.inner as number;
		return this.bench.nameOf(id) ?? undefined;
	}

	async state<T>(name: string, initial?: T): Promise<ImplNode<T>> {
		let initialHandle: number | null = null;
		if (initial !== undefined) {
			initialHandle = this.core.allocExternalHandle();
			this.registry.set(initialHandle, initial);
		}
		const id = await this.bench.state(name, initialHandle);
		const node = new RustNode<T>(this.core, id, this.registry);
		if (initial !== undefined) {
			node._updateCache(initial);
		}
		this.nodesByName.set(name, node as RustNode<unknown>);
		return node;
	}

	async derived<T>(
		_name: string,
		_deps: ReadonlyArray<ImplNode<unknown>>,
		_fn: (data: ReadonlyArray<ReadonlyArray<unknown>>) => ReadonlyArray<T>,
	): Promise<ImplNode<T>> {
		// `BenchGraph.derived` only supports built-in fns (Identity /
		// AddOne) — JS-callback derived nodes go through `BenchOperators`
		// (map/filter/etc.) and `add(name, id)`. Tests using
		// `g.derived(name, deps, fn)` with arbitrary `fn` won't work
		// against rustImpl in this slice; they're gated in triage.
		throw new Error(
			"[parity-tests rust] g.derived(name, deps, fn) with arbitrary fn is " +
				"out of scope for this slice (D074 carry-forward). Tests should " +
				'gate via test.runIf(impl.name !== "rust-via-napi") or use the ' +
				"operator factories (impl.map / impl.filter / etc.) and impl.Graph.add().",
		);
	}

	async dynamic<T>(
		name: string,
		deps: ReadonlyArray<ImplNode<unknown>>,
		fn: (data: ReadonlyArray<ReadonlyArray<unknown>>) => ReadonlyArray<T>,
	): Promise<ImplNode<T>> {
		return this.derived(name, deps, fn);
	}

	async add<T>(name: string, node: ImplNode<T>): Promise<ImplNode<T>> {
		const id = node.inner as number;
		this.bench.add(name, id);
		this.nodesByName.set(name, node as RustNode<unknown>);
		return node;
	}

	async set(name: string, value: unknown): Promise<void> {
		const h = this.core.allocExternalHandle();
		this.registry.set(h, value);
		await this.bench.setByName(name, h);
		// Update cache mirror on the named node.
		const n = this.nodesByName.get(name) as RustNode<unknown> | undefined;
		if (n) {
			n._updateCache(value);
		}
	}

	async get(name: string): Promise<unknown> {
		const h = await this.bench.getByName(name);
		if (h === 0) return undefined;
		return this.registry.get(h);
	}

	async invalidate(name: string): Promise<void> {
		await this.bench.invalidateByName(name);
		const n = this.nodesByName.get(name) as RustNode<unknown> | undefined;
		if (n) {
			n._updateCache(undefined);
		}
	}

	async complete(name: string): Promise<void> {
		await this.bench.completeByName(name);
	}

	async error(name: string, value: unknown): Promise<void> {
		const h = this.core.allocExternalHandle();
		this.registry.set(h, value);
		await this.bench.errorByName(name, h);
	}

	async remove(name: string): Promise<{ nodeCount: number; mountCount: number }> {
		const audit = await this.bench.remove(name);
		this.nodesByName.delete(name);
		return audit;
	}

	async signal(messages: ReadonlyArray<Message>): Promise<void> {
		// Encode the batch and dispatch via `signal_batch`, which does
		// server-side validation: tier-3 (DATA/RESOLVED) and other
		// non-broadcast tiers (COMPLETE/ERROR/TEARDOWN) reject BEFORE
		// any partial broadcast fires (Phase E /qa F3 — parity with
		// legacy's synchronous tier-3 throw).
		const encoded: number[] = [];
		for (const msg of messages) {
			encoded.push(symbolToCode(msg[0] as symbol));
			encoded.push(typeof msg[1] === "number" ? msg[1] : 0);
		}
		await this.bench.signalBatch(encoded);
	}

	async mount(name: string, child?: ImplGraph): Promise<ImplGraph> {
		if (child) {
			throw new Error(
				"[parity-tests rust] g.mount(name, child) with pre-built child is " +
					"out of scope for this slice (D074 carry-forward).",
			);
		}
		const childBench = await this.bench.mountNew(name);
		return new RustGraph(childBench, this.core, this.registry);
	}

	async unmount(name: string): Promise<{ nodeCount: number; mountCount: number }> {
		const audit = await this.bench.unmount(name);
		return audit;
	}

	async destroy(): Promise<void> {
		await this.bench.destroy();
		this.nodesByName.clear();
	}

	edges(opts?: { recursive?: boolean }): Array<[string, string]> {
		const flat = this.bench.edges(opts?.recursive ?? false);
		const result: Array<[string, string]> = [];
		for (let i = 0; i < flat.length; i += 2) {
			result.push([flat[i], flat[i + 1]]);
		}
		return result;
	}

	describe(opts?: { reactive: true }): unknown {
		if (opts?.reactive) {
			return this._describeReactive();
		}
		return JSON.parse(this.bench.describeJson());
	}

	private async _describeReactive() {
		// Slice X2: Phase E2 reactive describe wrapper.
		//
		// Slice X3 /qa D+E (2026-05-08): no synchronous `describeJson()`
		// seed. Pre-fix:
		//   1. JS thread called `JSON.parse(this.bench.describeJson())`
		//      synchronously to seed `latest`. That call internally
		//      acquires Core's mutex (via `Graph::describe`'s `cache_of`
		//      walk). If a tokio thread was mid-wave (parked in a TSFN
		//      bridge), the JS thread blocked → libuv stalled → tokio
		//      blocked. Same deadlock vector D080 closed for `BenchCore`.
		//   2. The seed + TSFN's push-on-subscribe both delivered the
		//      same initial snapshot to the first subscriber, violating
		//      R3.6.1 "exactly one initial snapshot."
		//
		// New shape: `latest` starts undefined. The Rust-side
		// `describe_reactive` fires push-on-subscribe via TSFN as part
		// of its activation; the first TSFN delivery hydrates `latest`
		// and fans out to all currently-subscribed sinks. Subscribers
		// added BEFORE first TSFN arrive sit in `sinks` and fire once
		// when it lands. Subscribers added AFTER replay `latest`
		// immediately. No duplicate delivery, no JS-thread Core-mutex
		// acquisition.
		const sinks = new Set<(snapshot: unknown) => void>();
		let latest: unknown | undefined;
		const handle = await this.bench.describeReactive((json: string) => {
			const snapshot = JSON.parse(json);
			latest = snapshot;
			for (const sink of sinks) {
				sink(snapshot);
			}
		});
		return {
			subscribe: (sink: (snapshot: unknown) => void) => {
				sinks.add(sink);
				// Replay latest if first TSFN already arrived; else the
				// next TSFN delivery will fire this sink via the Set.
				if (latest !== undefined) {
					sink(latest);
				}
				return () => {
					sinks.delete(sink);
				};
			},
			dispose: async () => {
				sinks.clear();
				await handle.dispose();
			},
		};
	}

	async observe(path?: string, opts?: { reactive: true }): Promise<unknown> {
		const sinks = new Set<
			(pathOrMsgs: string | ReadonlyArray<unknown>, msgs?: ReadonlyArray<unknown>) => void
		>();
		const dispatchAll = (name: string, encoded: number[]) => {
			const decoded = decodeMessages(encoded, this.registry);
			for (const sink of sinks) {
				sink(name, decoded);
			}
		};
		let handle: import("@graphrefly/native").BenchObserveReactiveHandle;
		if (opts?.reactive) {
			// Reactive all-nodes (auto-subscribe late additions).
			handle = await this.bench.observeAllReactive(dispatchAll);
		} else {
			// Sink-style — uses observeSubscribe with optional path.
			handle = await this.bench.observeSubscribe(path ?? null, dispatchAll);
		}
		return {
			subscribe: (
				sink: (pathOrMsgs: string | ReadonlyArray<unknown>, msgs?: ReadonlyArray<unknown>) => void,
			) => {
				sinks.add(sink);
				return () => {
					sinks.delete(sink);
				};
			},
			dispose: async () => {
				sinks.clear();
				await handle.dispose();
			},
		};
	}
}

// ---------------------------------------------------------------------------
// Per-Impl singleton — one BenchCore + one JSValueRegistry shared
// across all node/operator/graph factories.
// ---------------------------------------------------------------------------

interface RustImplState {
	core: import("@graphrefly/native").BenchCore;
	operators: import("@graphrefly/native").BenchOperators;
	registry: JSValueRegistry;
}

let cachedState: RustImplState | null = null;
function getState(): RustImplState {
	if (!native) {
		throw new Error("[parity-tests rust] @graphrefly/native not loaded");
	}
	if (cachedState === null) {
		const core = new native.BenchCore();
		const operators = native.BenchOperators.fromCore(core);
		const registry = new JSValueRegistry();
		core.setReleaseCallback((handle: number) => {
			registry.delete(handle);
		});
		cachedState = { core, operators, registry };
	}
	return cachedState;
}

// F11 (Slice X3, Phase E /qa carry-forward): null `cachedState` between
// tests so each test gets a fresh BenchCore + operators + registry.
// Vitest isolates across files (process-per-file) but NOT within a file —
// without this hook, tests that abort mid-execution before `g.destroy()`
// leak nodes / handles into subsequent tests in the same file. Filed in
// `~/src/graphrefly-rs/docs/porting-deferred.md` "F11 — `getState()`
// singleton causes cross-test pollution".
//
// Vitest's `afterEach` is a top-level hook auto-registered for every
// `test.runIf` / `test` in any file that imports this module (via the
// registry that pulls in `rustImpl`).
//
// Slice X3 /qa B (2026-05-08): `await dispose()` BEFORE nulling
// `cachedState` so the prior BenchCore's subscription drop runs on a
// tokio blocking thread, not on the JS thread during the next test's
// startup. Mirrors the D080 dispose discipline — without this, a
// reactive sink with an in-flight TSFN delivery in test N could
// re-introduce the JS-thread/Core-mutex deadlock in test N+1's GC.
// `.catch(() => {})` swallows shutdown errors (e.g., dispose during
// vitest's process teardown when the tokio runtime may already be
// winding down).
afterEach(async () => {
	if (cachedState) {
		await cachedState.core.dispose().catch(() => {});
		cachedState = null;
	}
});

// ---------------------------------------------------------------------------
// Operator helpers
// ---------------------------------------------------------------------------

function unwrap<T>(n: ImplNode<T>): number {
	return n.inner as number;
}

function makeProjector<T, U>(state: RustImplState, fn: (x: T) => U): (h: number) => number {
	const { core, registry } = state;
	return (h: number): number => {
		const value = registry.get<T>(h);
		const result = fn(value as T);
		const out = core.allocExternalHandle();
		registry.set(out, result);
		return out;
	};
}

function makePredicate<T>(
	state: RustImplState,
	predicate: (x: T) => boolean,
): (h: number) => boolean {
	const { registry } = state;
	return (h: number): boolean => {
		const value = registry.get<T>(h);
		return predicate(value as T);
	};
}

function makeFolder<T, U>(
	state: RustImplState,
	fn: (acc: U, x: T) => U,
): (acc: number, value: number) => number {
	const { core, registry } = state;
	return (accH: number, valueH: number): number => {
		const acc = registry.get<U>(accH);
		const value = registry.get<T>(valueH);
		const result = fn(acc as U, value as T);
		const out = core.allocExternalHandle();
		registry.set(out, result);
		return out;
	};
}

function makeEquals<T>(
	state: RustImplState,
	equals: (a: T, b: T) => boolean,
): (a: number, b: number) => boolean {
	const { registry } = state;
	return (a: number, b: number): boolean => {
		const aV = registry.get<T>(a);
		const bV = registry.get<T>(b);
		return equals(aV as T, bV as T);
	};
}

function makeStratifyClassifier<T, R>(
	state: RustImplState,
	classifier: (rules: R, value: T) => boolean,
): (rulesH: number, valueH: number) => boolean {
	const { registry } = state;
	return (rulesH: number, valueH: number): boolean => {
		const rules = registry.get<R>(rulesH);
		const value = registry.get<T>(valueH);
		try {
			return classifier(rules as R, value as T);
		} catch {
			return false;
		}
	};
}

function makePackerArray<T>(state: RustImplState): (handles: number[]) => number {
	const { core, registry } = state;
	return (handles: number[]): number => {
		const values = handles.map((h) => registry.get(h));
		const out = core.allocExternalHandle();
		registry.set(out, values as T);
		return out;
	};
}

function makePairwise<T>(state: RustImplState): (prev: number, current: number) => number {
	const { core, registry } = state;
	return (prev: number, current: number): number => {
		const prevV = registry.get<T>(prev);
		const currV = registry.get<T>(current);
		const out = core.allocExternalHandle();
		registry.set(out, [prevV, currV] as [T, T]);
		return out;
	};
}

function wrapAsRustNode<T>(state: RustImplState, id: number): RustNode<T> {
	return new RustNode<T>(state.core, id, state.registry);
}

// ---------------------------------------------------------------------------
// The Impl arm
// ---------------------------------------------------------------------------

export const rustImpl: Impl | null = native
	? ({
			name: "rust-via-napi",

			DATA: legacy.DATA,
			RESOLVED: legacy.RESOLVED,
			DIRTY: legacy.DIRTY,
			INVALIDATE: legacy.INVALIDATE,
			PAUSE: legacy.PAUSE,
			RESUME: legacy.RESUME,
			COMPLETE: legacy.COMPLETE,
			ERROR: legacy.ERROR,
			TEARDOWN: legacy.TEARDOWN,

			async node<T>(
				_deps: ReadonlyArray<ImplNode<unknown>>,
				opts?: { initial?: T; name?: string; resubscribable?: boolean },
			): Promise<ImplNode<T>> {
				const state = getState();
				let id: number;
				if (opts && opts.initial !== undefined) {
					const handle = state.core.allocExternalHandle();
					state.registry.set(handle, opts.initial);
					id = await state.core.registerStateWithHandle(handle);
				} else {
					id = await state.core.registerStateSentinel();
				}
				if (opts?.resubscribable) {
					await state.core.setResubscribable(id, true);
				}
				const node = new RustNode<T>(state.core, id, state.registry);
				if (opts && opts.initial !== undefined) {
					node._updateCache(opts.initial);
				}
				return node;
			},

			Graph: class implements ImplGraph {
				private impl: RustGraph;
				/** @internal — exposed for storage binding access. */
				readonly _bench: import("@graphrefly/native").BenchGraph;
				constructor(name: string) {
					const state = getState();
					const bench = native!.BenchGraph.fromCore(state.core, name);
					this._bench = bench;
					this.impl = new RustGraph(bench, state.core, state.registry);
				}
				tryResolve(path: string) {
					return this.impl.tryResolve(path);
				}
				nameOf(node: ImplNode<unknown>) {
					return this.impl.nameOf(node);
				}
				state<T>(name: string, initial?: T) {
					return this.impl.state<T>(name, initial);
				}
				derived<T>(
					name: string,
					deps: ReadonlyArray<ImplNode<unknown>>,
					fn: (data: ReadonlyArray<ReadonlyArray<unknown>>) => ReadonlyArray<T>,
				) {
					return this.impl.derived<T>(name, deps, fn);
				}
				dynamic<T>(
					name: string,
					deps: ReadonlyArray<ImplNode<unknown>>,
					fn: (data: ReadonlyArray<ReadonlyArray<unknown>>) => ReadonlyArray<T>,
				) {
					return this.impl.dynamic<T>(name, deps, fn);
				}
				add<T>(name: string, node: ImplNode<T>) {
					return this.impl.add<T>(name, node);
				}
				set(name: string, value: unknown) {
					return this.impl.set(name, value);
				}
				get(name: string) {
					return this.impl.get(name);
				}
				invalidate(name: string) {
					return this.impl.invalidate(name);
				}
				complete(name: string) {
					return this.impl.complete(name);
				}
				error(name: string, value: unknown) {
					return this.impl.error(name, value);
				}
				remove(name: string) {
					return this.impl.remove(name);
				}
				signal(messages: ReadonlyArray<Message>) {
					return this.impl.signal(messages);
				}
				mount(name: string, child?: ImplGraph) {
					return this.impl.mount(name, child);
				}
				unmount(name: string) {
					return this.impl.unmount(name);
				}
				destroy() {
					return this.impl.destroy();
				}
				edges(opts?: { recursive?: boolean }) {
					return this.impl.edges(opts);
				}
				describe(opts?: any) {
					return this.impl.describe(opts);
				}
				observe(path?: string, opts?: any) {
					return this.impl.observe(path, opts);
				}
			},

			// Transform.
			async map<T, U>(src: ImplNode<T>, fn: (x: T) => U): Promise<ImplNode<U>> {
				const state = getState();
				const id = await state.operators.registerMap(unwrap(src), makeProjector(state, fn));
				return wrapAsRustNode<U>(state, id);
			},
			async filter<T>(src: ImplNode<T>, predicate: (x: T) => boolean): Promise<ImplNode<T>> {
				const state = getState();
				const id = await state.operators.registerFilter(
					unwrap(src),
					makePredicate(state, predicate),
				);
				return wrapAsRustNode<T>(state, id);
			},
			async scan<T, U>(src: ImplNode<T>, fn: (acc: U, x: T) => U, seed: U): Promise<ImplNode<U>> {
				const state = getState();
				const seedH = state.core.allocExternalHandle();
				state.registry.set(seedH, seed);
				const id = await state.operators.registerScan(unwrap(src), seedH, makeFolder(state, fn));
				return wrapAsRustNode<U>(state, id);
			},
			async reduce<T, U>(src: ImplNode<T>, fn: (acc: U, x: T) => U, seed: U): Promise<ImplNode<U>> {
				const state = getState();
				const seedH = state.core.allocExternalHandle();
				state.registry.set(seedH, seed);
				const id = await state.operators.registerReduce(unwrap(src), seedH, makeFolder(state, fn));
				return wrapAsRustNode<U>(state, id);
			},
			async distinctUntilChanged<T>(
				src: ImplNode<T>,
				equals?: (a: T, b: T) => boolean,
			): Promise<ImplNode<T>> {
				const state = getState();
				const id = equals
					? await state.operators.registerDistinctUntilChangedWith(
							unwrap(src),
							makeEquals(state, equals),
						)
					: await state.operators.registerDistinctUntilChanged(unwrap(src));
				return wrapAsRustNode<T>(state, id);
			},
			async pairwise<T>(src: ImplNode<T>): Promise<ImplNode<[T, T]>> {
				const state = getState();
				const id = await state.operators.registerPairwise(unwrap(src), makePairwise<T>(state));
				return wrapAsRustNode<[T, T]>(state, id);
			},

			// Combine.
			async combine<T>(srcs: ReadonlyArray<ImplNode<unknown>>): Promise<ImplNode<T[]>> {
				const state = getState();
				const id = await state.operators.registerCombine(
					srcs.map(unwrap),
					makePackerArray<T[]>(state),
				);
				return wrapAsRustNode<T[]>(state, id);
			},
			async withLatestFrom<T, U>(
				primary: ImplNode<T>,
				secondary: ImplNode<U>,
			): Promise<ImplNode<[T, U]>> {
				const state = getState();
				const id = await state.operators.registerWithLatestFrom(
					unwrap(primary),
					unwrap(secondary),
					makePackerArray<[T, U]>(state),
				);
				return wrapAsRustNode<[T, U]>(state, id);
			},
			async merge<T>(srcs: ReadonlyArray<ImplNode<T>>): Promise<ImplNode<T>> {
				const state = getState();
				const id = await state.operators.registerMerge(srcs.map(unwrap));
				return wrapAsRustNode<T>(state, id);
			},

			// Flow.
			async take<T>(src: ImplNode<T>, count: number): Promise<ImplNode<T>> {
				const state = getState();
				const id = await state.operators.registerTake(unwrap(src), count);
				return wrapAsRustNode<T>(state, id);
			},
			async skip<T>(src: ImplNode<T>, count: number): Promise<ImplNode<T>> {
				const state = getState();
				const id = await state.operators.registerSkip(unwrap(src), count);
				return wrapAsRustNode<T>(state, id);
			},
			async takeWhile<T>(src: ImplNode<T>, predicate: (x: T) => boolean): Promise<ImplNode<T>> {
				const state = getState();
				const id = await state.operators.registerTakeWhile(
					unwrap(src),
					makePredicate(state, predicate),
				);
				return wrapAsRustNode<T>(state, id);
			},
			async last<T>(src: ImplNode<T>, opts?: { defaultValue: T }): Promise<ImplNode<T>> {
				const state = getState();
				let id: number;
				if (opts && opts.defaultValue !== undefined) {
					const dh = state.core.allocExternalHandle();
					state.registry.set(dh, opts.defaultValue);
					id = await state.operators.registerLastWithDefault(unwrap(src), dh);
				} else {
					id = await state.operators.registerLast(unwrap(src));
				}
				return wrapAsRustNode<T>(state, id);
			},
			async first<T>(src: ImplNode<T>): Promise<ImplNode<T>> {
				const state = getState();
				const id = await state.operators.registerFirst(unwrap(src));
				return wrapAsRustNode<T>(state, id);
			},
			async find<T>(src: ImplNode<T>, predicate: (x: T) => boolean): Promise<ImplNode<T>> {
				const state = getState();
				const id = await state.operators.registerFind(unwrap(src), makePredicate(state, predicate));
				return wrapAsRustNode<T>(state, id);
			},
			async elementAt<T>(src: ImplNode<T>, index: number): Promise<ImplNode<T>> {
				const state = getState();
				const id = await state.operators.registerElementAt(unwrap(src), index);
				return wrapAsRustNode<T>(state, id);
			},

			// Subscription-managed combinators.
			async zip<T>(srcs: ReadonlyArray<ImplNode<unknown>>): Promise<ImplNode<T[]>> {
				const state = getState();
				const id = await state.operators.registerZip(srcs.map(unwrap), makePackerArray<T[]>(state));
				return wrapAsRustNode<T[]>(state, id);
			},
			async concat<T>(first: ImplNode<T>, second: ImplNode<T>): Promise<ImplNode<T>> {
				const state = getState();
				const id = await state.operators.registerConcat(unwrap(first), unwrap(second));
				return wrapAsRustNode<T>(state, id);
			},
			async race<T>(srcs: ReadonlyArray<ImplNode<T>>): Promise<ImplNode<T>> {
				const state = getState();
				const id = await state.operators.registerRace(srcs.map(unwrap));
				return wrapAsRustNode<T>(state, id);
			},
			async takeUntil<T>(src: ImplNode<T>, notifier: ImplNode<unknown>): Promise<ImplNode<T>> {
				const state = getState();
				const id = await state.operators.registerTakeUntil(unwrap(src), unwrap(notifier));
				return wrapAsRustNode<T>(state, id);
			},

			// Higher-order.
			async switchMap<T, U>(
				outer: ImplNode<T>,
				project: (x: T) => ImplNode<U>,
			): Promise<ImplNode<U>> {
				const state = getState();
				const projector = (h: number): number => {
					const value = state.registry.get<T>(h);
					return unwrap(project(value as T));
				};
				const id = await state.operators.registerSwitchMap(unwrap(outer), projector);
				return wrapAsRustNode<U>(state, id);
			},
			async exhaustMap<T, U>(
				outer: ImplNode<T>,
				project: (x: T) => ImplNode<U>,
			): Promise<ImplNode<U>> {
				const state = getState();
				const projector = (h: number): number => {
					const value = state.registry.get<T>(h);
					return unwrap(project(value as T));
				};
				const id = await state.operators.registerExhaustMap(unwrap(outer), projector);
				return wrapAsRustNode<U>(state, id);
			},
			async concatMap<T, U>(
				outer: ImplNode<T>,
				project: (x: T) => ImplNode<U>,
			): Promise<ImplNode<U>> {
				const state = getState();
				const projector = (h: number): number => {
					const value = state.registry.get<T>(h);
					return unwrap(project(value as T));
				};
				const id = await state.operators.registerConcatMap(unwrap(outer), projector);
				return wrapAsRustNode<U>(state, id);
			},
			async mergeMap<T, U>(
				outer: ImplNode<T>,
				project: (x: T) => ImplNode<U>,
				concurrency?: number,
			): Promise<ImplNode<U>> {
				const state = getState();
				const projector = (h: number): number => {
					const value = state.registry.get<T>(h);
					return unwrap(project(value as T));
				};
				const id = await state.operators.registerMergeMap(
					unwrap(outer),
					projector,
					concurrency ?? null,
				);
				return wrapAsRustNode<U>(state, id);
			},
			// Control operators (Slice U napi parity).
			async tap<T>(src: ImplNode<T>, fn: (x: T) => void): Promise<ImplNode<T>> {
				const state = getState();
				const callback = (h: number): void => {
					fn(state.registry.get<T>(h) as T);
				};
				const id = await state.operators.registerTap(unwrap(src), callback);
				return wrapAsRustNode<T>(state, id);
			},
			async tapObserver<T>(
				src: ImplNode<T>,
				opts: { data?: (x: T) => void; error?: (e: unknown) => void; complete?: () => void },
			): Promise<ImplNode<T>> {
				const state = getState();
				const dataCb = opts.data
					? (h: number): void => {
							opts.data!(state.registry.get<T>(h) as T);
						}
					: undefined;
				const errorCb = opts.error
					? (h: number): void => {
							opts.error!(state.registry.get(h));
						}
					: undefined;
				const completeCb = opts.complete ?? undefined;
				const id = await state.operators.registerTapObserver(
					unwrap(src),
					dataCb ?? null,
					errorCb ?? null,
					completeCb ?? null,
				);
				return wrapAsRustNode<T>(state, id);
			},
			async onFirstData<T>(src: ImplNode<T>, fn: (x: T) => void): Promise<ImplNode<T>> {
				const state = getState();
				const callback = (h: number): void => {
					fn(state.registry.get<T>(h) as T);
				};
				const id = await state.operators.registerOnFirstData(unwrap(src), callback);
				return wrapAsRustNode<T>(state, id);
			},
			async rescue<T>(src: ImplNode<T>, fn: (err: unknown) => T | undefined): Promise<ImplNode<T>> {
				const state = getState();
				const callback = (errorHandle: number): number => {
					const errValue = state.registry.get(errorHandle);
					const result = fn(errValue);
					if (result === undefined) return -1;
					const outH = state.core.allocExternalHandle();
					state.registry.set(outH, result);
					return outH;
				};
				const id = await state.operators.registerRescue(unwrap(src), callback);
				return wrapAsRustNode<T>(state, id);
			},
			async valve<T>(
				src: ImplNode<T>,
				control: ImplNode<unknown>,
				gate: (x: unknown) => boolean,
			): Promise<ImplNode<T>> {
				const state = getState();
				const gateCb = (h: number): boolean => {
					return gate(state.registry.get(h));
				};
				const id = await state.operators.registerValve(unwrap(src), unwrap(control), gateCb);
				return wrapAsRustNode<T>(state, id);
			},
			async settle<T>(
				src: ImplNode<T>,
				quietWaves: number,
				maxWaves?: number,
			): Promise<ImplNode<T>> {
				const state = getState();
				const id = await state.operators.registerSettle(unwrap(src), quietWaves, maxWaves ?? null);
				return wrapAsRustNode<T>(state, id);
			},
			async repeat<T>(src: ImplNode<T>, count: number): Promise<ImplNode<T>> {
				const state = getState();
				const id = await state.operators.registerRepeat(unwrap(src), count);
				return wrapAsRustNode<T>(state, id);
			},

			// Buffer operators (Slice U napi parity).
			async buffer<T>(src: ImplNode<T>, notifier: ImplNode<unknown>): Promise<ImplNode<T[]>> {
				const state = getState();
				const packer = (handles: number[]): number => {
					const values = handles.map((h) => state.registry.get(h));
					const outH = state.core.allocExternalHandle();
					state.registry.set(outH, values as T[]);
					return outH;
				};
				const id = await state.operators.registerBuffer(unwrap(src), unwrap(notifier), packer);
				return wrapAsRustNode<T[]>(state, id);
			},
			async bufferCount<T>(src: ImplNode<T>, count: number): Promise<ImplNode<T[]>> {
				const state = getState();
				const packer = (handles: number[]): number => {
					const values = handles.map((h) => state.registry.get(h));
					const outH = state.core.allocExternalHandle();
					state.registry.set(outH, values as T[]);
					return outH;
				};
				const id = await state.operators.registerBufferCount(unwrap(src), count, packer);
				return wrapAsRustNode<T[]>(state, id);
			},

			// Cold sources (Slice 3e/3f napi parity).
			async fromIter<T>(values: T[]): Promise<ImplNode<T>> {
				const state = getState();
				const handles = values.map((v) => {
					const h = state.core.allocExternalHandle();
					state.registry.set(h, v);
					return h;
				});
				const id = await state.operators.registerFromIter(handles);
				return wrapAsRustNode<T>(state, id);
			},
			async of<T>(values: T[]): Promise<ImplNode<T>> {
				const state = getState();
				const handles = values.map((v) => {
					const h = state.core.allocExternalHandle();
					state.registry.set(h, v);
					return h;
				});
				const id = await state.operators.registerOf(handles);
				return wrapAsRustNode<T>(state, id);
			},
			async empty<T>(): Promise<ImplNode<T>> {
				const state = getState();
				const id = await state.operators.registerEmpty();
				return wrapAsRustNode<T>(state, id);
			},
			async throwError<T>(error: unknown): Promise<ImplNode<T>> {
				const state = getState();
				const h = state.core.allocExternalHandle();
				state.registry.set(h, error);
				const id = await state.operators.registerThrowError(h);
				return wrapAsRustNode<T>(state, id);
			},

			// Stratify substrate (D199).
			async stratifyBranch<T, R>(
				src: ImplNode<T>,
				rules: ImplNode<R>,
				classifier: (rules: R, value: T) => boolean,
			): Promise<ImplNode<T>> {
				const state = getState();
				const id = await state.operators.registerStratifyBranch(
					unwrap(src),
					unwrap(rules),
					makeStratifyClassifier(state, classifier),
				);
				return wrapAsRustNode<T>(state, id);
			},

			// Storage (M4.F).
			storage: buildRustStorage(),

			// Structures (M5).
			structures: buildRustStructures(),
		} as Impl)
	: null;

// ---------------------------------------------------------------------------
// Rust storage impl (M4.F — D175)
// ---------------------------------------------------------------------------

function buildRustStorage(): StorageImpl | undefined {
	if (!native) return undefined;
	// Cast to `any` — storage binding types are generated at napi build time
	// and won't exist in the .d.ts until the native module is rebuilt with
	// --features storage. The parity test runner validates shapes at runtime.
	const n = native as any;
	// Feature-detect: if the native module wasn't built with `--features storage`,
	// these classes won't exist.
	if (typeof n.BenchMemoryBackend !== "function") return undefined;

	return {
		memoryBackend(): ImplMemoryBackend {
			const b = new n.BenchMemoryBackend();
			const impl: ImplMemoryBackend & { _raw: InstanceType<typeof n.BenchMemoryBackend> } = {
				_raw: b,
				readRaw(key: string) {
					return b.readRaw(key) ?? undefined;
				},
				list(prefix: string) {
					return b.list(prefix);
				},
			};
			return impl;
		},

		snapshotTier(backend: ImplMemoryBackend, opts?: TierOpts): ImplSnapshotTier {
			const b = (backend as any)._raw as InstanceType<typeof n.BenchMemoryBackend>;
			const tier = n.BenchValueSnapshotTier.create(
				b,
				opts?.name ?? null,
				opts?.compactEvery ?? null,
				opts?.debounceMs ?? null,
			);
			return {
				get name() {
					return tier.name;
				},
				get debounceMs() {
					return tier.debounceMs ?? undefined;
				},
				get compactEvery() {
					return tier.compactEvery ?? undefined;
				},
				save(value: unknown) {
					tier.save(JSON.stringify(value));
				},
				load() {
					const json = tier.load();
					return json != null ? JSON.parse(json) : undefined;
				},
				flush() {
					tier.flush();
				},
				rollback() {
					tier.rollback();
				},
			};
		},

		kvTier(backend: ImplMemoryBackend, opts?: TierOpts): ImplKvTier {
			const b = (backend as any)._raw as InstanceType<typeof n.BenchMemoryBackend>;
			const tier = n.BenchValueKvTier.create(
				b,
				opts?.name ?? null,
				opts?.compactEvery ?? null,
				opts?.debounceMs ?? null,
			);
			return {
				get name() {
					return tier.name;
				},
				save(key: string, value: unknown) {
					tier.save(key, JSON.stringify(value));
				},
				load(key: string) {
					const json = tier.load(key);
					return json != null ? JSON.parse(json) : undefined;
				},
				delete(key: string) {
					tier.delete(key);
				},
				list(prefix: string) {
					return tier.list(prefix);
				},
				flush() {
					tier.flush();
				},
				rollback() {
					tier.rollback();
				},
			};
		},

		appendLogTier(backend: ImplMemoryBackend, opts?: TierOpts): ImplAppendLogTier {
			const b = (backend as any)._raw as InstanceType<typeof n.BenchMemoryBackend>;
			const tier = n.BenchValueAppendLogTier.create(
				b,
				opts?.name ?? null,
				opts?.compactEvery ?? null,
				opts?.debounceMs ?? null,
			);
			return {
				get name() {
					return tier.name;
				},
				appendEntries(entries: unknown[]) {
					tier.appendEntries(JSON.stringify(entries));
				},
				async loadEntries(keyFilter?: string): Promise<unknown[]> {
					const json = tier.loadEntries(keyFilter ?? null);
					return JSON.parse(json);
				},
				flush() {
					tier.flush();
				},
				rollback() {
					tier.rollback();
				},
			};
		},

		checkpointSnapshotTier(
			backend: ImplMemoryBackend,
			opts?: TierOpts,
		): ImplCheckpointSnapshotTier {
			const b = (backend as any)._raw as InstanceType<typeof n.BenchMemoryBackend>;
			const tier = n.BenchCheckpointSnapshotTier.create(
				b,
				opts?.name ?? null,
				opts?.compactEvery ?? null,
			);
			const wrapper: ImplCheckpointSnapshotTier & { _rawTier: typeof tier } = {
				_rawTier: tier,
				get name() {
					return tier.name;
				},
				save(record: unknown) {
					tier.save(JSON.stringify(record));
				},
				load() {
					const json = tier.load();
					return json != null ? JSON.parse(json) : undefined;
				},
				flush() {
					tier.flush();
				},
				rollback() {
					tier.rollback();
				},
			};
			return wrapper;
		},

		walKvTier(backend: ImplMemoryBackend, opts?: TierOpts): ImplWalKvTier {
			const b = (backend as any)._raw as InstanceType<typeof n.BenchMemoryBackend>;
			const tier = n.BenchWalKvTier.create(b, opts?.name ?? null, opts?.compactEvery ?? null);
			const wrapper: ImplWalKvTier & { _rawTier: typeof tier } = {
				_rawTier: tier,
				get name() {
					return tier.name;
				},
				save(key: string, frame: unknown) {
					tier.save(key, JSON.stringify(frame));
				},
				load(key: string) {
					const json = tier.load(key);
					return json != null ? JSON.parse(json) : undefined;
				},
				delete(key: string) {
					tier.delete(key);
				},
				list(prefix: string) {
					return tier.list(prefix);
				},
				flush() {
					tier.flush();
				},
				rollback() {
					tier.rollback();
				},
			};
			return wrapper;
		},

		async attachSnapshotStorage(
			graph: ImplGraph,
			snapshot: ImplCheckpointSnapshotTier,
			wal?: ImplWalKvTier,
		): Promise<ImplStorageHandle> {
			const bench = (graph as any)._bench;
			if (!bench) throw new Error("storage: could not access raw BenchGraph from ImplGraph");
			const snapTier = (snapshot as any)._rawTier;
			const walTier = wal ? (wal as any)._rawTier : undefined;
			const handle = await n.benchAttachSnapshotStorage(bench, snapTier, walTier ?? null);
			return {
				async dispose() {
					await handle.dispose();
				},
			};
		},

		async restoreSnapshot(
			graph: ImplGraph,
			snapshot: ImplCheckpointSnapshotTier,
			wal: ImplWalKvTier,
			opts?: { targetSeq?: number },
		): Promise<RestoreResultOutput> {
			const bench = (graph as any)._bench;
			if (!bench) throw new Error("storage: could not access raw BenchGraph from ImplGraph");
			const snapTier = (snapshot as any)._rawTier;
			const walTier = (wal as any)._rawTier;
			const json = await n.benchRestoreSnapshot(bench, snapTier, walTier, opts?.targetSeq ?? null);
			const result = JSON.parse(json);
			return {
				replayedFrames: result.replayed_frames,
				skippedFrames: result.skipped_frames,
				finalSeq: result.final_seq,
				phases: result.phases.map((p: any) => ({
					lifecycle: p.lifecycle,
					frames: p.frames,
				})),
			};
		},

		async graphSnapshot(graph: ImplGraph): Promise<unknown> {
			const bench = (graph as any)._bench;
			if (!bench) throw new Error("storage: could not access raw BenchGraph from ImplGraph");
			const json = await n.benchGraphSnapshot(bench);
			return JSON.parse(json);
		},

		walFrameKey(prefix: string, frameSeq: number): string {
			return n.benchWalFrameKey(prefix, frameSeq);
		},

		async walFrameChecksum(frame: unknown): Promise<string> {
			return n.benchWalFrameChecksum(JSON.stringify(frame));
		},

		async verifyWalFrameChecksum(frame: unknown): Promise<boolean> {
			return n.benchVerifyWalFrameChecksum(JSON.stringify(frame));
		},

		walReplayOrder(): string[] {
			return n.benchReplayOrder();
		},
	};
}

// ---------------------------------------------------------------------------
// Rust structures impl (M5)
// ---------------------------------------------------------------------------

function buildRustStructures(): StructuresImpl | undefined {
	if (!native) return undefined;
	const n = native as any;
	// Feature-detect: structures binding classes exist only when built
	// with `--features structures`. napi classes are JS functions, not objects.
	if (typeof n.BenchReactiveLog?.create !== "function") {
		return undefined;
	}

	return {
		reactiveLog<T>(opts?: { maxSize?: number }): ImplReactiveLog<T> {
			const state = getState();
			const packer = (handles: number[]): number => {
				const values = handles.map((h) => state.registry.get(h));
				const out = state.core.allocExternalHandle();
				state.registry.set(out, values as readonly T[]);
				return out;
			};
			const log = n.BenchReactiveLog.create(
				state.core,
				packer,
				opts?.maxSize != null ? opts.maxSize : null,
			);
			const node = wrapAsRustNode<readonly T[]>(state, log.nodeId);
			return {
				node,
				get size() {
					return log.size;
				},
				async append(value: T) {
					const h = state.core.allocExternalHandle();
					state.registry.set(h, value);
					await log.append(h);
				},
				async appendMany(values: T[]) {
					const handles = values.map((v) => {
						const h = state.core.allocExternalHandle();
						state.registry.set(h, v);
						return h;
					});
					await log.appendMany(handles);
				},
				async clear() {
					await log.clear();
				},
				async trimHead(n_: number) {
					await log.trimHead(n_);
				},
				at(index: number) {
					const h = log.at(index);
					if (h === 0) return undefined;
					return state.registry.get<T>(h) as T | undefined;
				},
			};
		},

		reactiveList<T>(): ImplReactiveList<T> {
			const state = getState();
			const packer = (handles: number[]): number => {
				const values = handles.map((h) => state.registry.get(h));
				const out = state.core.allocExternalHandle();
				state.registry.set(out, values as readonly T[]);
				return out;
			};
			const list = n.BenchReactiveList.create(state.core, packer);
			const node = wrapAsRustNode<readonly T[]>(state, list.nodeId);
			return {
				node,
				get size() {
					return list.size;
				},
				async append(value: T) {
					const h = state.core.allocExternalHandle();
					state.registry.set(h, value);
					await list.append(h);
				},
				async appendMany(values: T[]) {
					const handles = values.map((v) => {
						const h = state.core.allocExternalHandle();
						state.registry.set(h, v);
						return h;
					});
					await list.appendMany(handles);
				},
				async insert(index: number, value: T) {
					const h = state.core.allocExternalHandle();
					state.registry.set(h, value);
					await list.insert(index, h);
				},
				async pop(index?: number) {
					const h = await list.pop(index ?? null);
					return state.registry.get<T>(h) as T;
				},
				async clear() {
					await list.clear();
				},
				at(index: number) {
					const h = list.at(index);
					if (h === 0) return undefined;
					return state.registry.get<T>(h) as T | undefined;
				},
			};
		},

		reactiveMap<K, V>(opts?: { maxSize?: number }): ImplReactiveMap<K, V> {
			const state = getState();
			const packer = (handles: number[]): number => {
				// Handles arrive as [k, v, k, v, ...] from the map intern fn.
				const pairs: [K, V][] = [];
				for (let i = 0; i < handles.length; i += 2) {
					pairs.push([
						state.registry.get<K>(handles[i]) as K,
						state.registry.get<V>(handles[i + 1]) as V,
					]);
				}
				const out = state.core.allocExternalHandle();
				state.registry.set(out, new Map<K, V>(pairs));
				return out;
			};
			const map = n.BenchReactiveMap.create(
				state.core,
				packer,
				opts?.maxSize != null ? opts.maxSize : null,
				null, // defaultTtl
			);
			const node = wrapAsRustNode<unknown>(state, map.nodeId);
			// Per-key handle registry for get/has lookups.
			const keyHandles = new Map<K, number>();
			return {
				node,
				get size() {
					return map.size;
				},
				async set(key: K, value: V) {
					let kh = keyHandles.get(key);
					if (kh == null) {
						kh = state.core.allocExternalHandle();
						state.registry.set(kh, key);
						keyHandles.set(key, kh);
					}
					const vh = state.core.allocExternalHandle();
					state.registry.set(vh, value);
					await map.set(kh, vh, null);
				},
				get(key: K) {
					const kh = keyHandles.get(key);
					if (kh == null) return undefined;
					const vh = map.get(kh);
					if (vh === 0) return undefined;
					return state.registry.get<V>(vh) as V | undefined;
				},
				has(key: K) {
					const kh = keyHandles.get(key);
					if (kh == null) return false;
					return map.has(kh);
				},
				async delete(key: K) {
					const kh = keyHandles.get(key);
					if (kh == null) return;
					await map.delete(kh);
				},
				async clear() {
					await map.clear();
					keyHandles.clear();
				},
			};
		},

		reactiveIndex<K, V>(): ImplReactiveIndex<K, V> {
			const state = getState();
			const packer = (handles: number[]): number => {
				// Handles arrive as [primary, value, primary, value, ...].
				const rows: { primary: K; value: V }[] = [];
				for (let i = 0; i < handles.length; i += 2) {
					rows.push({
						primary: state.registry.get<K>(handles[i]) as K,
						value: state.registry.get<V>(handles[i + 1]) as V,
					});
				}
				const out = state.core.allocExternalHandle();
				state.registry.set(out, rows);
				return out;
			};
			const index = n.BenchReactiveIndex.create(state.core, packer);
			const node = wrapAsRustNode<unknown>(state, index.nodeId);
			const primaryHandles = new Map<K, number>();
			return {
				node,
				get size() {
					return index.size;
				},
				async upsert(primary: K, secondary: string, value: V) {
					let ph = primaryHandles.get(primary);
					if (ph == null) {
						ph = state.core.allocExternalHandle();
						state.registry.set(ph, primary);
						primaryHandles.set(primary, ph);
					}
					const vh = state.core.allocExternalHandle();
					state.registry.set(vh, value);
					return index.upsert(ph, secondary, vh);
				},
				async delete(primary: K) {
					const ph = primaryHandles.get(primary);
					if (ph == null) return;
					await index.delete(ph);
				},
				async clear() {
					await index.clear();
					primaryHandles.clear();
				},
				has(primary: K) {
					const ph = primaryHandles.get(primary);
					if (ph == null) return false;
					return index.has(ph);
				},
				get(primary: K) {
					const ph = primaryHandles.get(primary);
					if (ph == null) return undefined;
					const vh = index.get(ph);
					if (vh === 0) return undefined;
					return state.registry.get<V>(vh) as V | undefined;
				},
			};
		},
	};
}
