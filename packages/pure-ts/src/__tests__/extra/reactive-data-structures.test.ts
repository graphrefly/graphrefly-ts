import { describe, expect, it } from "vitest";
import { batch } from "../../core/batch.js";
import { DATA, DIRTY } from "../../core/messages.js";
import { node } from "../../core/node.js";
import { reactiveIndex } from "../../extra/data-structures/reactive-index.js";
import { reactiveList } from "../../extra/data-structures/reactive-list.js";
import { reactiveLog } from "../../extra/data-structures/reactive-log.js";
import { appendLogStorage, memoryBackend } from "../../extra/storage/tiers.js";
import { collect } from "../test-helpers.js";

describe("extra reactiveLog / logSlice (roadmap §3.2)", () => {
	it("append and clear emit versioned snapshots", () => {
		const lg = reactiveLog<number>();
		const { batches, unsub } = collect(lg.entries);
		lg.append(1);
		unsub();
		const flat = (batches as [symbol, unknown][][]).flat();
		expect(flat.some((m) => m[0] === DIRTY)).toBe(true);
		// Push-on-subscribe delivers the initial cached empty array first;
		// find the DATA that contains the appended value.
		const dataMessages = flat.filter((m) => m[0] === DATA) as [symbol, readonly number[]][];
		const appended = dataMessages.find((m) => (m[1] as readonly number[]).length > 0);
		expect(appended).toBeDefined();
		expect([...appended![1]]).toEqual([1]);
	});

	it("tail returns last n entries", () => {
		const lg = reactiveLog<string>();
		lg.append("a");
		lg.append("b");
		const tail = lg.view({ kind: "tail", n: 1 });
		expect(tail.cache).toEqual(["b"]);
	});

	it("slice matches tuple slice semantics", () => {
		const lg = reactiveLog([0, 1, 2, 3]);
		const sl = lg.view({ kind: "slice", start: 1, stop: 3 });
		expect(sl.cache).toEqual([1, 2]);
	});

	// Regression: memo:Re P0 (2026-05-16). N sequential append() waves each
	// scheduled a microtask-chained doFlush() on the no-debounce tier; a single
	// await tier.flush() short-circuited (pending empty) and resolved before the
	// in-flight chain drained, so only wave #1 ("a") was durable. fix:
	// appendLogStorage.flushNow returns the outstanding flushChain when pending
	// is empty. appendMany (one wave) was the passing control.
	it("attachStorage persists EVERY sequential append wave, not just the first", async () => {
		const backend = memoryBackend();
		const tier = appendLogStorage<string>(backend, { name: "L" });
		const log = reactiveLog<string>([], { name: "L" });
		log.attachStorage([tier]);
		log.append("a");
		log.append("b");
		log.append("c");
		log.append("d");
		await tier.flush?.();
		const loaded = await tier.loadEntries!();
		expect(loaded.entries).toEqual(["a", "b", "c", "d"]);
	});

	it("attachStorage appendMany control (single wave) persists all", async () => {
		const backend = memoryBackend();
		const tier = appendLogStorage<string>(backend, { name: "L" });
		const log = reactiveLog<string>([], { name: "L" });
		log.attachStorage([tier]);
		log.appendMany(["a", "b", "c", "d"]);
		await tier.flush?.();
		const loaded = await tier.loadEntries!();
		expect(loaded.entries).toEqual(["a", "b", "c", "d"]);
	});

	it("attachStorage flush() drains the in-flight chain against an ASYNC backend", async () => {
		// Locks the C3 serialized-chain path: async read/write force every
		// doFlush onto the promise chain; flush() must still await all of it.
		const store = new Map<string, Uint8Array>();
		const asyncBackend = {
			name: "async-mem",
			async read(k: string) {
				await Promise.resolve();
				const v = store.get(k);
				return v === undefined ? undefined : new Uint8Array(v);
			},
			async write(k: string, b: Uint8Array) {
				await Promise.resolve();
				store.set(k, new Uint8Array(b));
			},
			async delete(k: string) {
				store.delete(k);
			},
			list: (p?: string) => [...store.keys()].filter((k) => (p ? k.startsWith(p) : true)).sort(),
		};
		const tier = appendLogStorage<string>(asyncBackend, { name: "A" });
		const log = reactiveLog<string>([], { name: "A" });
		log.attachStorage([tier]);
		log.append("x");
		log.append("y");
		log.append("z");
		await tier.flush?.();
		const loaded = await tier.loadEntries!();
		expect(loaded.entries).toEqual(["x", "y", "z"]);
	});

	// QA/D3 regression: flush() now returns the in-flight chain when pending
	// is empty, so a failed in-flight write SURFACES on `await tier.flush()`
	// (was: silently resolved). Locks the durability error-surfacing contract
	// the Rust parity arm must mirror (cross-track-ledger §2).
	it("attachStorage flush() rejects when an in-flight chained write fails", async () => {
		const failing = {
			name: "failing",
			read: async () => undefined,
			write: async () => {
				await Promise.resolve();
				throw new Error("backend write failed");
			},
			delete: async () => {},
			list: () => [],
		};
		const tier = appendLogStorage<string>(failing, { name: "F" });
		const log = reactiveLog<string>([], { name: "F" });
		log.attachStorage([tier]);
		log.append("a");
		log.append("b");
		await expect(tier.flush?.()).rejects.toThrow("backend write failed");
	});

	// QA/F9 regression (option A): a debounced tier has no internal flush
	// timer and attachStorage's per-wave path is suppressed for it — without
	// a driver it buffered forever (silent data loss). attachStorage now
	// drives a reactive fromTimer flush per debounced tier, AND a final
	// best-effort drain on teardown.
	it("attachStorage drives a debounced tier's flush via reactive timer", async () => {
		const backend = memoryBackend();
		const tier = appendLogStorage<string>(backend, { name: "D", debounceMs: 10 });
		const log = reactiveLog<string>([], { name: "D" });
		log.attachStorage([tier]);
		log.append("a");
		log.append("b");
		// No explicit flush(), no teardown — only the reactive timer drives it.
		await new Promise((r) => setTimeout(r, 60)); // > 1 period (10ms), generous
		await tier.flush?.(); // drain any in-flight chain (durability fix)
		const loaded = await tier.loadEntries!();
		expect(loaded.entries).toEqual(["a", "b"]);
	});

	it("attachStorage detach drains a debounced tier's last buffered window", async () => {
		const backend = memoryBackend();
		const tier = appendLogStorage<string>(backend, {
			name: "DT",
			debounceMs: 100_000, // long — timer will NOT fire during the test
		});
		const log = reactiveLog<string>([], { name: "DT" });
		const detach = log.attachStorage([tier]);
		log.append("x");
		log.append("y");
		detach(); // teardown final-flush schedules the drain
		await tier.flush?.(); // await the in-flight drain
		const loaded = await tier.loadEntries!();
		expect(loaded.entries).toEqual(["x", "y"]);
	});

	// QA/rollback strong-semantic regression: rollback() bumps an epoch;
	// a doFlush whose buckets were captured pre-rollback is skipped at entry,
	// so rolled-back-but-already-chained entries are NOT persisted (was: the
	// in-flight chained write still committed them).
	it("rollback() aborts an in-flight chained write scheduled before it", async () => {
		const store = new Map<string, Uint8Array>();
		const asyncBackend = {
			name: "async-mem",
			async read(k: string) {
				await Promise.resolve();
				const v = store.get(k);
				return v === undefined ? undefined : new Uint8Array(v);
			},
			async write(k: string, b: Uint8Array) {
				await Promise.resolve();
				store.set(k, new Uint8Array(b));
			},
			async delete(k: string) {
				store.delete(k);
			},
			list: () => [...store.keys()].sort(),
		};
		const tier = appendLogStorage<string>(asyncBackend, { name: "R" });
		// No-debounce → appendEntries schedules a chained (async) doFlush.
		tier.appendEntries(["a", "b"]);
		await tier.rollback?.(); // bump epoch BEFORE the chained doFlush runs
		await tier.flush?.(); // drains the chain — doFlush no-ops (epoch stale)
		const loaded = await tier.loadEntries!();
		expect(loaded.entries).toEqual([]);
	});

	it("rollback() does NOT abort writes scheduled AFTER it", async () => {
		const store = new Map<string, Uint8Array>();
		const asyncBackend = {
			name: "async-mem2",
			async read(k: string) {
				await Promise.resolve();
				const v = store.get(k);
				return v === undefined ? undefined : new Uint8Array(v);
			},
			async write(k: string, b: Uint8Array) {
				await Promise.resolve();
				store.set(k, new Uint8Array(b));
			},
			async delete(k: string) {
				store.delete(k);
			},
			list: () => [...store.keys()].sort(),
		};
		const tier = appendLogStorage<string>(asyncBackend, { name: "R2" });
		tier.appendEntries(["stale"]);
		await tier.rollback?.();
		tier.appendEntries(["kept"]); // new epoch — must persist
		await tier.flush?.();
		const loaded = await tier.loadEntries!();
		expect(loaded.entries).toEqual(["kept"]);
	});
});

describe("extra reactiveIndex (roadmap §3.2)", () => {
	it("orders by secondary then primary and supports delete", () => {
		const idx = reactiveIndex<string, string>();
		idx.upsert("p1", 10, "a");
		idx.upsert("p2", 5, "b");
		expect(idx.byPrimary.cache).toEqual(
			new Map([
				["p1", "a"],
				["p2", "b"],
			]),
		);
		const ordered = idx.ordered.cache as readonly { primary: string }[];
		expect(ordered.map((r) => r.primary)).toEqual(["p2", "p1"]);
		idx.delete("p2");
		const m = idx.byPrimary.cache as Map<string, string>;
		expect([...m.keys()]).toEqual(["p1"]);
	});
});

describe("reactiveLog.attach — skipCachedReplay (memo:Re P2)", () => {
	it("default: appends the upstream's cached value on subscribe (push-on-subscribe)", () => {
		const up = node<number>([], { initial: undefined });
		up.emit(1);
		up.emit(2);
		const log = reactiveLog<number>();
		const dispose = log.attach(up);
		// Cached last value (2) replayed at subscribe → appended.
		expect(log.entries.cache).toEqual([2]);
		up.emit(3);
		expect(log.entries.cache).toEqual([2, 3]);
		dispose();
	});

	it("skipCachedReplay: drops the cached-replay burst, keeps live emissions", () => {
		const up = node<number>([], { initial: undefined });
		up.emit(1);
		up.emit(2);
		const log = reactiveLog<number>();
		const dispose = log.attach(up, { skipCachedReplay: true });
		// Cached 2 delivered synchronously during subscribe → skipped.
		expect(log.entries.cache).toEqual([]);
		// Subsequent live emissions still append.
		up.emit(3);
		up.emit(4);
		expect(log.entries.cache).toEqual([3, 4]);
		dispose();
	});

	it("skipCachedReplay on a cold upstream is a no-op (nothing to skip)", () => {
		const up = node<number>([], { initial: undefined });
		const log = reactiveLog<number>();
		const dispose = log.attach(up, { skipCachedReplay: true });
		up.emit(1);
		expect(log.entries.cache).toEqual([1]);
		dispose();
	});

	it("skipCachedReplay works when attach() runs inside batch() (handshake is downWithBatch-deferred)", () => {
		const up = node<number>([], { initial: undefined });
		up.emit(1);
		up.emit(2);
		const log = reactiveLog<number>();
		let dispose = () => {};
		// Under batch(), the cached handshake DATA is deferred to drain —
		// AFTER attach() returns. A synchronous-window flag would miss it and
		// append 2 anyway; the first-frame skip must still catch it.
		batch(() => {
			dispose = log.attach(up, { skipCachedReplay: true });
		});
		expect(log.entries.cache).toEqual([]);
		up.emit(3);
		expect(log.entries.cache).toEqual([3]);
		dispose();
	});

	it("skipCachedReplay drops the FULL replay buffer handshake, not just the last value", () => {
		const up = node<number>([], { initial: undefined, replayBuffer: 3 });
		up.emit(1);
		up.emit(2);
		up.emit(3);
		const log = reactiveLog<number>();
		const dispose = log.attach(up, { skipCachedReplay: true });
		// Entire [1,2,3] replay-buffer handshake frame dropped.
		expect(log.entries.cache).toEqual([]);
		up.emit(4);
		expect(log.entries.cache).toEqual([4]);
		dispose();
	});

	it("attachStorage throws on an overwrite-mode tier (delta-ship would truncate)", () => {
		const log = reactiveLog<number>();
		const tier = appendLogStorage<number>(memoryBackend(), {
			name: "L",
			mode: "overwrite",
		});
		expect(() => log.attachStorage([tier])).toThrow(/overwrite/);
		// An append-mode tier is accepted.
		const ok = appendLogStorage<number>(memoryBackend(), { name: "L2" });
		expect(() => log.attachStorage([ok])()).not.toThrow();
	});

	it("default (no opt) still appends the full replay buffer on attach", () => {
		const up = node<number>([], { initial: undefined, replayBuffer: 3 });
		up.emit(1);
		up.emit(2);
		up.emit(3);
		const log = reactiveLog<number>();
		const dispose = log.attach(up);
		expect(log.entries.cache).toEqual([1, 2, 3]);
		dispose();
	});
});

describe("extra reactiveList (roadmap §3.2)", () => {
	it("append, insert, pop, clear", () => {
		const lst = reactiveList<number>();
		lst.append(1);
		lst.insert(0, 0);
		expect(lst.items.cache).toEqual([0, 1]);
		expect(lst.pop()).toBe(1);
		expect(lst.items.cache).toEqual([0]);
	});
});
