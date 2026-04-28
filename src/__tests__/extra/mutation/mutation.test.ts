import { describe, expect, it } from "vitest";
import { state } from "../../../core/sugar.js";
import {
	type BaseAuditRecord,
	bumpCursor,
	createAuditLog,
	lightMutation,
	wrapMutation,
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

describe("imperative-audit / lightMutation", () => {
	it("happy path: returns the action result and appends a success record", () => {
		const { audit, dispose } = makeAuditLog();
		const setKey = lightMutation((key: string, value: number) => `${key}=${value}`, {
			audit,
			onSuccess: ([key], _r, m) => ({ action: "set" as const, key, t_ns: m.t_ns }),
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
		const op = lightMutation(
			(arg: { v: number }) => {
				seenFrozen.push(Object.isFrozen(arg));
				return arg.v;
			},
			{
				audit,
				onSuccess: (_a, _r, m) => ({ action: "set" as const, t_ns: m.t_ns }),
			},
		);
		op({ v: 1 });
		expect(seenFrozen[0]).toBe(true);
		dispose();
	});

	it("freeze: false opt-out leaves args mutable in the action body", () => {
		const { audit, dispose } = makeAuditLog();
		const seenFrozen: boolean[] = [];
		const op = lightMutation(
			(arg: { v: number }) => {
				seenFrozen.push(Object.isFrozen(arg));
				arg.v = 42;
				return arg.v;
			},
			{
				audit,
				freeze: false,
				onSuccess: (_a, _r, m) => ({ action: "set" as const, t_ns: m.t_ns }),
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
		const op = lightMutation(
			() => {
				throw new MyError("boom");
			},
			{
				audit,
				onSuccess: (_a, _r, m) => ({ action: "set" as const, t_ns: m.t_ns }),
				onFailure: (_a, _err, m) => ({
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
		const cursor = state<number>(0, { name: "seq" });
		const sub = cursor.subscribe(() => undefined);
		let callIndex = 0;
		const op = lightMutation(
			() => {
				callIndex += 1;
				if (callIndex === 2) throw new TypeError("fail-second");
				return callIndex;
			},
			{
				audit,
				seq: cursor,
				onSuccess: (_a, _r, m) => ({ action: "set" as const, t_ns: m.t_ns, seq: m.seq }),
				onFailure: (_a, _e, m) => ({
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
		const op = lightMutation((key: string) => key, {
			audit,
			handlerVersion: { id: "h1", version: "v1" },
			onSuccess: ([key], _r, m) => ({ action: "set" as const, key, t_ns: m.t_ns }),
		});
		op("x");
		const entries = audit.entries.cache as readonly TestRecord[];
		expect(entries[0]!.handlerVersion).toEqual({ id: "h1", version: "v1" });
		dispose();
	});

	it("undefined record from builder skips the append", () => {
		const { audit, dispose } = makeAuditLog();
		const op = lightMutation(() => undefined, {
			audit,
			onSuccess: () => undefined,
		});
		op();
		expect(audit.entries.cache as readonly TestRecord[]).toHaveLength(0);
		dispose();
	});
});

describe("imperative-audit / wrapMutation regression", () => {
	it("success: appends success record with stamped seq and handlerVersion", () => {
		const { audit, dispose } = makeAuditLog();
		const cursor = state<number>(0, { name: "seq" });
		const sub = cursor.subscribe(() => undefined);

		const op = wrapMutation((key: string) => key.toUpperCase(), {
			audit,
			seq: cursor,
			handlerVersion: { id: "h", version: 1 },
			onSuccess: ([key], result, m) =>
				({ action: "set" as const, key, t_ns: m.t_ns, seq: m.seq }) satisfies TestRecord,
			onFailure: (_a, _e, m) => ({
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
		const cursor = state<number>(0, { name: "seq" });
		const sub = cursor.subscribe(() => undefined);

		const op = wrapMutation(
			() => {
				throw new TypeError("nope");
			},
			{
				audit,
				seq: cursor,
				onSuccess: (_a, _r, m) => ({ action: "set" as const, t_ns: m.t_ns, seq: m.seq }),
				onFailure: (_a, _e, m) => ({
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

	it("throw: the failure-audit append is NOT itself swallowed by the batch rollback", () => {
		// Sanity check — the post-refactor wrapMutation must still call
		// `appendAudit(onFailure, ...)` AFTER the batch rejects, not inside it.
		// Validates the captureSet path in the catch block.
		const { audit, dispose } = makeAuditLog();
		const op = wrapMutation(
			() => {
				throw new Error("e");
			},
			{
				audit,
				onFailure: (_a, _e, m) => ({
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
});

describe("imperative-audit / bumpCursor", () => {
	it("emits DIRTY then DATA(next) and returns the new value", () => {
		const cursor = state<number>(5, { name: "c" });
		const sub = cursor.subscribe(() => undefined);
		const next = bumpCursor(cursor);
		expect(next).toBe(6);
		expect(cursor.cache).toBe(6);
		sub();
	});

	it("starts from 0 when the cursor cache is undefined", () => {
		const cursor = state<number>(undefined as unknown as number, { name: "c" });
		const sub = cursor.subscribe(() => undefined);
		const next = bumpCursor(cursor);
		expect(next).toBe(1);
		sub();
	});

	it("updates cache even with no subscribers (substrate before consumers attach)", () => {
		// JobQueueGraph.enqueue and similar primitives may bump the seq cursor
		// before any consumer attaches. The contract: `bumpCursor` updates
		// `cursor.cache` regardless of subscriber count.
		const cursor = state<number>(0, { name: "c" });
		const next = bumpCursor(cursor);
		expect(next).toBe(1);
		expect(cursor.cache).toBe(1);
	});

	it("resets to 0 on NaN / non-finite / non-numeric cache (corrupted state)", () => {
		const nanCursor = state<number>(Number.NaN, { name: "nan" });
		nanCursor.subscribe(() => undefined);
		expect(bumpCursor(nanCursor)).toBe(1);

		const infCursor = state<number>(Number.POSITIVE_INFINITY, { name: "inf" });
		infCursor.subscribe(() => undefined);
		expect(bumpCursor(infCursor)).toBe(1);

		const stringCursor = state<number>("oops" as unknown as number, { name: "str" });
		stringCursor.subscribe(() => undefined);
		expect(bumpCursor(stringCursor)).toBe(1);
	});
});
