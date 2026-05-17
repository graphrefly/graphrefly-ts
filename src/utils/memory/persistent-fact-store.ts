/**
 * Promotion 1 (memo:Re Story 6.4 back-derivation; DS-14.7 follow-up #2 —
 * the persistence half of `simpleFactStore()`). Design-review-locked
 * 2026-05-16.
 *
 * memo:Re hand-rolled `createPersistentMemoryStore` (217 LOC): a
 * `reactiveLog.attach(ingest)` side-log + an `appendLogStorage` tier +
 * paginated replay + a `persistedCount` suffix-cursor for replay-dedup +
 * flush/dispose lifecycle. Its code-review's *only High* finding (flush
 * partial-failure double-append) + several Meds (concurrent-flush race,
 * `persistedCount` baseline fragility, `loadAllHistory` silent truncation)
 * were all artifacts of the first consumer hand-rolling substrate-general
 * orchestration. This factory owns log↔store↔replay↔dedup correctly so the
 * whole silent-corruption bug class disappears for every future consumer.
 *
 * **Key design properties (locked):**
 * - **Synchronous factory.** Returns the `Graph` immediately like every other
 *   `utils/memory` factory — `utils/` is composed by presets/solutions and
 *   must stay reactive (no `await` in a construction path). The inherently-IO
 *   durable load + replay is the ONE async boundary and it lives in a single
 *   isolated reactive source node (`fromAny` over a paginated `loadEntries`
 *   async-iterator), per spec §5.10 — not in the factory signature.
 * - **Substrate-owned durable cursor.** Persistence is wired AFTER the replay
 *   source drains; `ReactiveLogBundle.attachStorage` initialises its
 *   delivered-cursor to `ingestLog.size` at attach time, so the replayed
 *   history is NOT re-persisted and only post-replay live fragments ship.
 *   The cursor is entirely internal — the consumer tracks nothing (no
 *   `persistedCount`). Observability is the read-only `position` Node.
 * - **Flush delegated** to the already-QA-hardened `appendLogStorage.flush`
 *   (reject-on-prior-failure + rollback-epoch + chained-drain) — the High
 *   double-append dissolves because nothing here hand-rolls `appendEntries`
 *   + a cursor.
 * - **No silent partial-history loss.** Replay reads the durable history in a
 *   single `tier.loadEntries()` call — the substrate append-log tier returns
 *   the COMPLETE log (it does not paginate / windowed-truncate), so memo:Re's
 *   `loadAllHistory` partial-page-truncation bug class is absent by
 *   construction (not "detected"). Any `loadEntries` rejection propagates as
 *   `ERROR` on the replay source (observable), not a swallowed partial load.
 *   (Real cursor pagination for very large logs is a deferred substrate
 *   enhancement — see `docs/optimizations.md`.)
 *
 * Determinism: `reactiveFactStore`'s cascade `validTo` is derived from the
 * triggering root (not wall-clock), so replaying the persisted ingest stream
 * rebuilds a byte-identical store — the rebuildable-projection contract
 * documented on {@link ReactiveFactStoreConfig.recordIngest}.
 *
 * Only the bytes-`StorageBackend` adapter stays userland; the BigInt-safe
 * codec is upstream (`bigintJsonCodecFor`, the default here).
 *
 * @module
 */

import { COMPLETE, type Node, node } from "@graphrefly/pure-ts/core";
import {
	type AppendLogStorageTier,
	appendLogStorage,
	bigintJsonCodecFor,
	type Codec,
	fromAny,
	keepalive,
	type StorageBackend,
} from "@graphrefly/pure-ts/extra";
import { domainMeta } from "../../base/meta/domain-meta.js";
import {
	type MemoryFragment,
	type ReactiveFactStoreConfig,
	type ReactiveFactStoreGraph,
	reactiveFactStore,
} from "./fact-store.js";

function persistMeta(kind: string): Record<string, unknown> {
	return domainMeta("memory", kind);
}

export interface PersistentReactiveFactStoreConfig<T>
	// `admissionFilter` is intentionally omitted (QA-A): `ingestLog` records the
	// POST-admission stream, so replaying it through a `config.ingest` that
	// re-applies admission would double-filter — and any stateful/non-
	// deterministic filter desyncs the durable log from the rebuilt store
	// (silent corruption). Apply admission ONCE, upstream of `config.ingest`
	// (e.g. a `.filter` before emitting); the durable log is the post-admission
	// truth. Use the non-persistent `reactiveFactStore` if you need the
	// reactive `admissionFilter` face.
	extends Omit<ReactiveFactStoreConfig<T>, "recordIngest" | "admissionFilter"> {
	/**
	 * Bytes backend the durable ingest log is persisted through. The ONLY
	 * userland piece — e.g. memo:Re's Drizzle/Expo-SQLite `StorageBackend`,
	 * or `memoryBackend()` for tests.
	 */
	readonly storage: StorageBackend;
	/** Backend key / tier name. Default `"fact_store_ingest"`. */
	readonly persistName?: string;
	/** Codec for the durable bucket. Default `bigintJsonCodecFor` (BigInt-safe). */
	readonly codec?: Codec<readonly MemoryFragment<T>[]>;
}

export interface PersistentReactiveFactStoreGraph<T> extends ReactiveFactStoreGraph<T> {
	/**
	 * Reactive count of durably-persisted fragments. `0` until startup replay
	 * completes; thereafter the committed-fragment count (replayed history —
	 * loaded FROM the durable tier — plus live fragments shipped by the
	 * substrate-owned `attachStorage` cursor; call {@link flush} to force them
	 * physically durable). Observability only — the cursor is internal.
	 */
	readonly position: Node<number>;
	/**
	 * Reactive count of fragments rebuilt from durable history at startup.
	 * `0` until the first replayed fragment; final value once replay
	 * `COMPLETE`s.
	 */
	readonly replayedCount: Node<number>;
	/** The durable append-log tier (shared backend; e.g. for projector cursors). */
	readonly tier: AppendLogStorageTier<MemoryFragment<T>>;
	/**
	 * Force-drain the durable tier. Delegates to the QA-hardened
	 * `appendLogStorage.flush` (rejects if a prior in-flight write failed;
	 * honours the rollback epoch). Resolves once all shipped fragments are
	 * physically durable.
	 *
	 * **Pre-attach-live durability (QA-E):** a fragment emitted into
	 * `config.ingest` in the same synchronous tick as construction (before the
	 * async replay drains) is shipped by a one-shot, fire-and-forget
	 * reconciliation write whose rejection is NOT surfaced inline. Call
	 * `flush()` after construction settles to (a) confirm that slice is
	 * physically durable and (b) surface any write failure as a rejection. The
	 * normal pattern — observe `replayedCount`/`position` before feeding live
	 * ingest — avoids the window entirely.
	 */
	flush(): Promise<void>;
}

/**
 * Build a durable, event-sourced {@link reactiveFactStore} that owns
 * log↔store↔replay↔dedup correctly. Synchronous factory; the only async is
 * an isolated internal replay source. See module docstring for the locked
 * design rationale.
 *
 * @example
 * ```ts
 * import { persistentReactiveFactStore } from "@graphrefly/graphrefly";
 * import { memoryBackend } from "@graphrefly/pure-ts/extra";
 *
 * const ingest = node<MemoryFragment<Doc>>([], { initial: undefined });
 * const mem = persistentReactiveFactStore<Doc>({
 *   ingest,
 *   extractDependencies: (f) => f.sources,
 *   storage: memoryBackend(),
 * });
 * // Restart is automatic: the durable history is replayed through `ingest`
 * // on construction; observe `mem.replayedCount` / `mem.position`.
 * ingest.emit(myFragment);            // live — persisted (not re-persisted)
 * await mem.flush();                  // force physically durable
 * ```
 *
 * @category memory
 */
export function persistentReactiveFactStore<T>(
	config: PersistentReactiveFactStoreConfig<T>,
): PersistentReactiveFactStoreGraph<T> {
	const persistName = config.persistName ?? "fact_store_ingest";
	const codec = config.codec ?? bigintJsonCodecFor<readonly MemoryFragment<T>[]>();
	const tier = appendLogStorage<MemoryFragment<T>>(config.storage, {
		name: persistName,
		codec,
	});

	// `recordIngest:true` is implied — the rebuildable-projection source.
	const store = reactiveFactStore<T>({ ...config, recordIngest: true });
	const ingestLog = store.ingestLog!;

	// Durable-history async iterator. The substrate `appendLogStorage` tier's
	// `loadEntries()` returns the COMPLETE log in one call (it does not honor
	// `cursor`/`pageSize` windowing), so a single read yields the full history
	// — no partial-page-truncation risk (QA-B). A `loadEntries` rejection
	// propagates as ERROR on the replay source (not swallowed).
	async function* loadHistory(): AsyncGenerator<MemoryFragment<T>> {
		if (typeof tier.loadEntries !== "function") return;
		const page = await tier.loadEntries();
		for (const f of page.entries) yield f;
	}

	// Replay = a reactive async source feeding `config.ingest` (spec §5.10 —
	// the ONLY async lives in this one source node; the factory is sync).
	const replaySource = fromAny<MemoryFragment<T>>(loadHistory(), {
		name: "_replay_source",
		meta: persistMeta("persist_replay_source"),
	});
	store.add(replaySource, { name: "_replay_source" });

	// replayPump: re-feed each replayed fragment through `config.ingest`
	// (the documented rebuildable-projection replay — `.emit` into a source is
	// the sanctioned reactive entry, mirroring the `decay` recipe precedent).
	// Emits the running replayed count (consumers observe `replayedCount`).
	let replayed = 0;
	const replayPump = node<number>(
		[replaySource],
		(batchData, actions) => {
			const b = batchData[0] as readonly MemoryFragment<T>[] | undefined;
			if (b != null && b.length > 0) {
				for (const f of b) {
					config.ingest.emit(f);
					replayed += 1;
				}
				actions.emit(replayed);
			}
		},
		{
			name: "_replay_pump",
			describeKind: "derived",
			initial: 0,
			meta: persistMeta("persist_replay_pump"),
		},
	);
	store.add(replayPump, { name: "_replay_pump" });
	store.addDisposer(keepalive(replayPump));

	// `attached` flips reactively when the replay source COMPLETEs — gates
	// `position` so it can advance from 0 the instant replay drains.
	const attached = node<boolean>([], {
		initial: false,
		name: "_storage_attached",
		describeKind: "state",
		meta: persistMeta("persist_attached"),
	});
	store.add(attached, { name: "_storage_attached" });
	store.addDisposer(keepalive(attached));

	// Wire durable persistence AFTER replay drains. By COMPLETE, `ingestLog`
	// holds the full replayed history (synchronous per-wave propagation), so
	// `attachStorage` initialises its delivered-cursor to `ingestLog.size` →
	// the replayed history is NOT re-persisted; only live post-replay
	// fragments ship. The cursor is the substrate's `delivered` map; the
	// consumer tracks nothing. Catching the replay source's COMPLETE terminal
	// is reactive (spec §2.2 terminal propagation); `attachStorage` is the
	// IO-sink wiring, analogous to its own internal `fromTimer`/teardown-drain
	// wiring (§24 internal subscription, invisible in describe).
	//
	// **Pre-attach live-ingest window.** A caller that emits a live fragment
	// in the same synchronous tick as construction feeds `config.ingest`
	// BEFORE the async replay drains, so `ingestLog.size` at COMPLETE is
	// `replayed + (pre-attach live)`. `attachStorage`'s delivered-cursor
	// starts at `ingestLog.size` and can't tell that slice from replayed
	// history → it would never ship it (silent loss). Ship that one slice
	// once here (the same `appendEntries` API attachStorage uses — a one-shot
	// reconciliation, NOT a maintained consumer cursor); steady-state
	// delta-shipping stays the substrate-owned `delivered` cursor.
	let detachStorage: (() => void) | undefined;
	const replaySub = replaySource.subscribe((msgs) => {
		for (const m of msgs) {
			if (m[0] === COMPLETE && detachStorage === undefined) {
				const sizeAtAttach = ingestLog.size;
				detachStorage = ingestLog.attachStorage([tier]);
				if (sizeAtAttach > replayed) {
					const slice: MemoryFragment<T>[] = [];
					for (let i = replayed; i < sizeAtAttach; i += 1) {
						const v = ingestLog.at(i);
						if (v === undefined) {
							// QA-F: the slice is contiguous + fully-present by
							// invariant (`ingestLog` indices [replayed,size) are the
							// pre-attach live fragments). A hole here is a real bug —
							// fail loud rather than silently gap the durable log
							// (matches this file's "no silent loss" contract).
							throw new Error(
								`persistentReactiveFactStore: ingestLog hole at index ${i} ` +
									`in reconciliation slice [${replayed}, ${sizeAtAttach}); ` +
									`pre-attach-live durability cannot be guaranteed.`,
							);
						}
						slice.push(v);
					}
					if (slice.length > 0) {
						const r = tier.appendEntries(slice);
						if (r instanceof Promise) r.catch(() => {});
					}
				}
				attached.emit(true);
			}
		}
	});
	store.addDisposer(() => {
		replaySub();
		detachStorage?.();
	});

	// position: durably-persisted fragment count. `0` until replay completes;
	// then the `ingestLog` size (replayed history was loaded FROM the tier; new
	// fragments are shipped by the substrate-owned attachStorage cursor).
	const position = node<number>(
		[ingestLog.entries, attached],
		(batchData, actions, ctx) => {
			const eb = batchData[0];
			const arr = (eb != null && eb.length > 0 ? eb.at(-1) : ctx.prevData[0]) as
				| readonly MemoryFragment<T>[]
				| undefined;
			const ab = batchData[1];
			const isAttached = (ab != null && ab.length > 0 ? ab.at(-1) : ctx.prevData[1]) as
				| boolean
				| undefined;
			actions.emit(isAttached === true ? (arr?.length ?? 0) : 0);
		},
		{
			name: "_durable_position",
			describeKind: "derived",
			initial: 0,
			meta: persistMeta("persist_position"),
		},
	);
	store.add(position, { name: "_durable_position" });
	store.addDisposer(keepalive(position));

	const out = Object.assign(store, {
		position,
		replayedCount: replayPump,
		tier,
		async flush(): Promise<void> {
			await tier.flush?.();
		},
	}) as PersistentReactiveFactStoreGraph<T>;
	return out;
}
