import { describe, expect, it, vi } from "vitest";
import { node } from "../../../core/node.js";

import {
	type BaseAuditRecord,
	bumpCursor,
	createAuditLog,
	mutate,
} from "../../../extra/mutation/index.js";
import { Graph } from "../../../graph/graph.js";

interface TestRecord extends BaseAuditRecord {
	readonly action: "set" | "fail";
	readonly key?: string;
	readonly errorType?: string;
}

function makeAuditLog() {
	const g = new Graph("test");
	const audit = createAuditLog<TestRecord>({ name: "events", graph: g });
	// Activate the entries node so .cache reflects appends synchronously.
	const unsub = audit.entries.subscribe(() => undefined);
	return { audit, dispose: unsub };
}

describe("mutate frame:inline", () => {
	it("happy path: returns the action result and appends a success record", () => {
		const { audit, dispose } = makeAuditLog();
		const setKey = mutate((key: string, value: number) => `${key}=${value}`, {
			frame: "inline",
			log: audit,
			onSuccessRecord: ([key], _r, m) => ({ action: "set" as const, key, t_ns: m.t_ns }),
		});

		const result = setKey("foo", 1);
		expect(result).toBe("foo=1");

		const entries = audit.entries.cache as readonly TestRecord[];
		expect(entries).toHaveLength(1);
		expect(entries[0]!.action).toBe("set");
		expect(entries[0]!.key).toBe("foo");
		expect(typeof entries[0]!.t_ns).toBe("number");

		dispose();
	});

	it("freeze: true (default) freezes object args inside the action body", () => {
		// Asserts only the contract: the action sees frozen args. Whether
		// `deepFreeze` mutates the caller's object in-place or copies first
		// is an implementation detail; don't lock that in.
		const { audit, dispose } = makeAuditLog();
		const seenFrozen: boolean[] = [];
		const op = mutate(
			(arg: { v: number }) => {
				seenFrozen.push(Object.isFrozen(arg));
				return arg.v;
			},
			{
				frame: "inline",
				log: audit,
				onSuccessRecord: (_a, _r, m) => ({ action: "set" as const, t_ns: m.t_ns }),
			},
		);
		op({ v: 1 });
		expect(seenFrozen[0]).toBe(true);
		dispose();
	});

	it("freeze: false opt-out leaves args mutable in the action body", () => {
		const { audit, dispose } = makeAuditLog();
		const seenFrozen: boolean[] = [];
		const op = mutate(
			(arg: { v: number }) => {
				seenFrozen.push(Object.isFrozen(arg));
				arg.v = 42;
				return arg.v;
			},
			{
				frame: "inline",
				log: audit,
				freeze: false,
				onSuccessRecord: (_a, _r, m) => ({ action: "set" as const, t_ns: m.t_ns }),
			},
		);
		const input = { v: 1 };
		const result = op(input);
		expect(seenFrozen[0]).toBe(false);
		expect(result).toBe(42);
		expect(input.v).toBe(42);
		dispose();
	});

	it("throw path: appends a failure record with errorType and rethrows", () => {
		const { audit, dispose } = makeAuditLog();
		class MyError extends Error {
			override name = "MyError";
		}
		const op = mutate(
			() => {
				throw new MyError("boom");
			},
			{
				frame: "inline",
				log: audit,
				onSuccessRecord: (_a, _r, m) => ({ action: "set" as const, t_ns: m.t_ns }),
				onFailureRecord: (_a, _err, m) => ({
					action: "fail" as const,
					t_ns: m.t_ns,
					errorType: m.errorType,
				}),
			},
		);

		expect(() => op()).toThrow(MyError);
		const entries = audit.entries.cache as readonly TestRecord[];
		expect(entries).toHaveLength(1);
		expect(entries[0]!.action).toBe("fail");
		expect(entries[0]!.errorType).toBe("MyError");
		dispose();
	});

	it("seq cursor: advances on each call; substrate-tier — bump persists on throw", () => {
		const { audit, dispose } = makeAuditLog();
		const cursor = node<number>([], { name: "seq", initial: 0 });
		const sub = cursor.subscribe(() => undefined);
		let callIndex = 0;
		const op = mutate(
			() => {
				callIndex += 1;
				if (callIndex === 2) throw new TypeError("fail-second");
				return callIndex;
			},
			{
				frame: "inline",
				log: audit,
				seq: cursor,
				onSuccessRecord: (_a, _r, m) => ({ action: "set" as const, t_ns: m.t_ns, seq: m.seq }),
				onFailureRecord: (_a, _e, m) => ({
					action: "fail" as const,
					t_ns: m.t_ns,
					seq: m.seq,
					errorType: m.errorType,
				}),
			},
		);

		op();
		expect(cursor.cache).toBe(1);

		expect(() => op()).toThrow(TypeError);
		// Substrate-tier: no batch frame, so the seq bump persists even though the
		// action threw. The failure record stamps the same seq so audit consumers
		// see a contiguous sequence (1, 2, 3, ...).
		expect(cursor.cache).toBe(2);

		op();
		expect(cursor.cache).toBe(3);

		const entries = audit.entries.cache as readonly TestRecord[];
		expect(entries.map((e) => e.seq)).toEqual([1, 2, 3]);
		expect(entries.map((e) => e.action)).toEqual(["set", "fail", "set"]);

		sub();
		dispose();
	});

	it("handlerVersion is stamped onto every record", () => {
		const { audit, dispose } = makeAuditLog();
		const op = mutate((key: string) => key, {
			frame: "inline",
			log: audit,
			handlerVersion: { id: "h1", version: "v1" },
			onSuccessRecord: ([key], _r, m) => ({ action: "set" as const, key, t_ns: m.t_ns }),
		});
		op("x");
		const entries = audit.entries.cache as readonly TestRecord[];
		expect(entries[0]!.handlerVersion).toEqual({ id: "h1", version: "v1" });
		dispose();
	});

	it("undefined record from builder skips the append", () => {
		const { audit, dispose } = makeAuditLog();
		const op = mutate(() => undefined, {
			frame: "inline",
			log: audit,
			onSuccessRecord: () => undefined,
		});
		op();
		expect(audit.entries.cache as readonly TestRecord[]).toHaveLength(0);
		dispose();
	});

	// Tier 8 γ-0: audit-optional opt-in.
	it("audit omitted: still freezes / re-throws / advances seq, but skips audit emission", () => {
		const cursor = node<number>([], { name: "seq", initial: 0 });
		const sub = cursor.subscribe(() => undefined);
		const seenFrozen: boolean[] = [];

		const op = mutate(
			(arg: { v: number }) => {
				seenFrozen.push(Object.isFrozen(arg));
				return arg.v;
			},
			{ frame: "inline", seq: cursor }, // no log, no onSuccessRecord/onFailureRecord
		);

		// Freeze contract preserved.
		op({ v: 1 });
		expect(seenFrozen[0]).toBe(true);
		// seq advanced even without log.
		expect(cursor.cache).toBe(1);

		// Throw still re-throws — and no record is emitted (there is no log).
		const throwingOp = mutate(
			() => {
				throw new Error("boom");
			},
			{ frame: "inline", seq: cursor },
		);
		expect(() => throwingOp()).toThrow(/boom/);
		// seq advanced once more for the failed call (inline frame is no-batch).
		expect(cursor.cache).toBe(2);

		sub();
	});
});

describe("mutate frame:transactional", () => {
	it("success: appends success record with stamped seq and handlerVersion", () => {
		const { audit, dispose } = makeAuditLog();
		const cursor = node<number>([], { name: "seq", initial: 0 });
		const sub = cursor.subscribe(() => undefined);

		const op = mutate((key: string) => key.toUpperCase(), {
			frame: "transactional",
			log: audit,
			seq: cursor,
			handlerVersion: { id: "h", version: 1 },
			onSuccessRecord: ([key], result, m) =>
				({ action: "set" as const, key, t_ns: m.t_ns, seq: m.seq }) satisfies TestRecord,
			onFailureRecord: (_a, _e, m) => ({
				action: "fail" as const,
				t_ns: m.t_ns,
				seq: m.seq,
				errorType: m.errorType,
			}),
		});

		const result = op("foo");
		expect(result).toBe("FOO");
		const entries = audit.entries.cache as readonly TestRecord[];
		expect(entries).toHaveLength(1);
		expect(entries[0]!.action).toBe("set");
		expect(entries[0]!.seq).toBe(1);
		expect(entries[0]!.handlerVersion).toEqual({ id: "h", version: 1 });

		sub();
		dispose();
	});

	it("throw: appends failure record outside the rolled-back batch frame", () => {
		const { audit, dispose } = makeAuditLog();
		const cursor = node<number>([], { name: "seq", initial: 0 });
		const sub = cursor.subscribe(() => undefined);

		const op = mutate(
			() => {
				throw new TypeError("nope");
			},
			{
				frame: "transactional",
				log: audit,
				seq: cursor,
				onSuccessRecord: (_a, _r, m) => ({ action: "set" as const, t_ns: m.t_ns, seq: m.seq }),
				onFailureRecord: (_a, _e, m) => ({
					action: "fail" as const,
					t_ns: m.t_ns,
					seq: m.seq,
					errorType: m.errorType,
				}),
			},
		);

		expect(() => op()).toThrow(TypeError);
		// Failure record was committed outside the batch's rolled-back frame, so
		// it persists even though the action threw.
		const entries = audit.entries.cache as readonly TestRecord[];
		expect(entries).toHaveLength(1);
		expect(entries[0]!.action).toBe("fail");
		expect(entries[0]!.errorType).toBe("TypeError");
		// The failure record stamps the seq captured during the batch.
		expect(entries[0]!.seq).toBe(1);

		sub();
		dispose();
	});

	it("throw: the failure record is NOT itself swallowed by the batch rollback", () => {
		// Sanity check — mutate(frame:transactional) must still call
		// `appendAudit(onFailureRecord, ...)` AFTER the batch rejects, not inside it.
		// Validates the captureSet path in the catch block.
		const { audit, dispose } = makeAuditLog();
		const op = mutate(
			() => {
				throw new Error("e");
			},
			{
				frame: "transactional",
				log: audit,
				onFailureRecord: (_a, _e, m) => ({
					action: "fail" as const,
					t_ns: m.t_ns,
					errorType: m.errorType,
				}),
			},
		);

		expect(() => op()).toThrow(/e/);
		expect(audit.entries.cache as readonly TestRecord[]).toHaveLength(1);
		dispose();
	});

	// Tier 8 γ-0: log-optional opt-in.
	it("log omitted: re-throws and freezes args, but skips record emission", () => {
		// mutate(frame:transactional) without log still opens a batch frame,
		// freezes args, advances seq, and re-throws.
		const cursor = node<number>([], { name: "c", initial: 0 });
		const sub = cursor.subscribe(() => undefined);
		const seenFrozen: boolean[] = [];

		const op = mutate(
			(arg: { v: number }) => {
				seenFrozen.push(Object.isFrozen(arg));
				return arg.v;
			},
			{ frame: "transactional", seq: cursor }, // no log
		);

		op({ v: 1 });
		expect(seenFrozen[0]).toBe(true);

		// Throw still propagates without a log.
		const throwingOp = mutate(
			() => {
				throw new Error("nope");
			},
			{ frame: "transactional", seq: cursor }, // no log
		);
		expect(() => throwingOp()).toThrow(/nope/);

		sub();
	});

	it("down hook fires on throw after batch rollback", () => {
		const { audit, dispose } = makeAuditLog();
		let downCalled = false;
		let downArgs: unknown[] = [];

		const op = mutate(
			{
				up: (key: string) => {
					throw new Error("fail");
				},
				down: (key: string) => {
					downCalled = true;
					downArgs = [key];
				},
			},
			{
				frame: "transactional",
				log: audit,
				onFailureRecord: (_a, _e, m) => ({
					action: "fail" as const,
					t_ns: m.t_ns,
					errorType: m.errorType,
				}),
			},
		);

		expect(() => op("test-key")).toThrow(/fail/);
		expect(downCalled).toBe(true);
		expect(downArgs).toEqual(["test-key"]);
		// Failure record still persists
		expect(audit.entries.cache as readonly TestRecord[]).toHaveLength(1);
		dispose();
	});
});

describe("imperative-audit / bumpCursor", () => {
	it("emits DIRTY then DATA(next) and returns the new value", () => {
		const cursor = node<number>([], { name: "c", initial: 5 });
		const sub = cursor.subscribe(() => undefined);
		const next = bumpCursor(cursor);
		expect(next).toBe(6);
		expect(cursor.cache).toBe(6);
		sub();
	});

	it("starts from 0 when the cursor cache is undefined", () => {
		const cursor = node<number>([], { name: "c", initial: undefined as unknown as number });
		const sub = cursor.subscribe(() => undefined);
		const next = bumpCursor(cursor);
		expect(next).toBe(1);
		sub();
	});

	it("updates cache even with no subscribers (substrate before consumers attach)", () => {
		// JobQueueGraph.enqueue and similar primitives may bump the seq cursor
		// before any consumer attaches. The contract: `bumpCursor` updates
		// `cursor.cache` regardless of subscriber count.
		const cursor = node<number>([], { name: "c", initial: 0 });
		const next = bumpCursor(cursor);
		expect(next).toBe(1);
		expect(cursor.cache).toBe(1);
	});

	it("resets to 0 on NaN / non-finite / non-numeric cache (corrupted state)", () => {
		const nanCursor = node<number>([], { name: "nan", initial: Number.NaN });
		nanCursor.subscribe(() => undefined);
		expect(bumpCursor(nanCursor)).toBe(1);

		const infCursor = node<number>([], { name: "inf", initial: Number.POSITIVE_INFINITY });
		infCursor.subscribe(() => undefined);
		expect(bumpCursor(infCursor)).toBe(1);

		const stringCursor = node<number>([], { name: "str", initial: "oops" as unknown as number });
		stringCursor.subscribe(() => undefined);
		expect(bumpCursor(stringCursor)).toBe(1);
	});

	it("EH-12: warns once per cursor on silent reset from non-numeric cache", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		try {
			const cursor = node<number>([], { name: "warn", initial: "bad" as unknown as number });
			cursor.subscribe(() => undefined);
			// First bump on a malformed cache should warn.
			expect(bumpCursor(cursor)).toBe(1);
			expect(warnSpy).toHaveBeenCalledTimes(1);
			expect(String(warnSpy.mock.calls[0]?.[0] ?? "")).toMatch(/non-numeric/);
			// Second bump (now numeric) is silent.
			expect(bumpCursor(cursor)).toBe(2);
			expect(warnSpy).toHaveBeenCalledTimes(1);
		} finally {
			warnSpy.mockRestore();
		}
	});

	it("EH-12: undefined cache (substrate-not-yet-emitted) does NOT warn", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		try {
			// node<number>([], { initial: undefined as unknown }) treats the seed as the SENTINEL —
			// `cache` is `undefined`. This is the legitimate "no DATA yet" branch
			// and should not log; only string/NaN/Infinity-style corruption does.
			const cursor = node<number>([], { name: "fresh", initial: undefined as unknown as number });
			cursor.subscribe(() => undefined);
			expect(bumpCursor(cursor)).toBe(1);
			expect(warnSpy).not.toHaveBeenCalled();
		} finally {
			warnSpy.mockRestore();
		}
	});
});
