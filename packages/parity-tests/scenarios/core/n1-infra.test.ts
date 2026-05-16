/**
 * N1 substrate-infra cross-impl behavioral parity (Finding 8, 2026-05-15).
 *
 * The N1 surface (`sha256Hex`, `RingBuffer`, `ResettableTimer`,
 * `describeNode`, `sourceOpts`) is pinned onto the `Impl` contract and
 * structurally enforced by `rust.ts`'s `as Impl` cast — but a structural
 * cast only proves the *members exist*, not that they *behave* the same
 * across arms. A wrapper regression (e.g. `sha256Hex` byte-encoding the
 * input wrong, ring-buffer evicting in the wrong order) would be
 * invisible to `pnpm test:parity`.
 *
 * This scenario closes that gap with `describe.each(impls)` behavioral
 * assertions for the three cross-impl-comparable symbols:
 *
 * - `sha256Hex` — locks the string→bytes UTF-8 encoding contract
 *   (empty string + ASCII + multibyte UTF-8 + raw `Uint8Array`).
 * - `RingBuffer` — locks drop-oldest / FIFO eviction order past capacity.
 * - `ResettableTimer` — locks the observable `pending` + reset contract
 *   per `types.ts` `ImplResettableTimer`.
 *
 * `describeNode` is intentionally NOT asserted for cross-impl equality:
 * the rust arm returns a Core-projection shape (`{ type, status, deps,
 * valueHandle, sentinel }`) that diverges from pure-ts's
 * `DescribeNodeOutput` by design. See
 * `~/src/graphrefly-rs/docs/porting-deferred.md` § "Option C
 * `@graphrefly/native` async surface — known limitations" → describeNode.
 * A field-level parity assertion there would be a false regression.
 *
 * Symbols are referenced ONLY via `impl.<name>` (impl-agnostic) so the
 * scenario runs against BOTH the pure-ts and rust-via-napi arms.
 *
 * @module
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("N1 infra — sha256Hex parity — $name", (impl) => {
	// RFC-known + UTF-8 vectors. Hex must be byte-identical across arms,
	// which only holds if both arms encode the JS string to UTF-8 bytes
	// the same way (the contract Finding 8 locks).
	const vectors: Array<[string, string]> = [
		// empty string — sha256("") is the canonical e3b0c4… vector.
		["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
		// ASCII
		["hello", "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"],
		// multibyte UTF-8 (é = U+00E9, 2 bytes; 世界 = 3 bytes each).
		["café 世界", undefined as unknown as string],
	];

	for (const [input, expected] of vectors) {
		test(`sha256Hex(${JSON.stringify(input)}) is stable + cross-impl`, async () => {
			const hex = await impl.sha256Hex(input);
			expect(hex).toMatch(/^[0-9a-f]{64}$/);
			if (expected !== undefined) {
				expect(hex).toBe(expected);
			}
		});
	}

	test("sha256Hex(Uint8Array) == sha256Hex(equivalent UTF-8 string)", async () => {
		const str = "café 世界";
		const bytes = new TextEncoder().encode(str);
		const fromBytes = await impl.sha256Hex(bytes);
		const fromStr = await impl.sha256Hex(str);
		expect(fromBytes).toBe(fromStr);
		expect(fromBytes).toMatch(/^[0-9a-f]{64}$/);
	});

	test("sha256Hex is deterministic across repeated calls", async () => {
		const a = await impl.sha256Hex("repeat-me");
		const b = await impl.sha256Hex("repeat-me");
		expect(a).toBe(b);
	});
});

describe.each(impls)("N1 infra — RingBuffer parity — $name", (impl) => {
	test("push past capacity evicts oldest (FIFO), contents identical", () => {
		const rb = new impl.RingBuffer<number>(3);
		expect(rb.maxSize).toBe(3);
		expect(rb.size).toBe(0);

		rb.push(1);
		rb.push(2);
		rb.push(3);
		expect(rb.size).toBe(3);
		expect(rb.toArray()).toEqual([1, 2, 3]);

		// Overflow — drop-oldest.
		rb.push(4);
		expect(rb.size).toBe(3);
		expect(rb.toArray()).toEqual([2, 3, 4]);

		rb.push(5);
		rb.push(6);
		expect(rb.toArray()).toEqual([4, 5, 6]);
	});

	test("at() positive + negative indexing parity", () => {
		const rb = new impl.RingBuffer<string>(3);
		rb.push("a");
		rb.push("b");
		rb.push("c");
		rb.push("d"); // evicts "a" -> [b, c, d]
		expect(rb.at(0)).toBe("b");
		expect(rb.at(2)).toBe("d");
		expect(rb.at(-1)).toBe("d");
		expect(rb.at(-3)).toBe("b");
		expect(rb.at(99)).toBeUndefined();
	});

	test("shift() drains in FIFO order; clear() resets", () => {
		const rb = new impl.RingBuffer<number>(4);
		rb.push(10);
		rb.push(20);
		rb.push(30);
		expect(rb.shift()).toBe(10);
		expect(rb.shift()).toBe(20);
		expect(rb.size).toBe(1);
		expect(rb.toArray()).toEqual([30]);

		rb.push(40);
		rb.clear();
		expect(rb.size).toBe(0);
		expect(rb.toArray()).toEqual([]);
		expect(rb.shift()).toBeUndefined();
	});
});

describe.each(impls)("N1 infra — ResettableTimer parity — $name", (impl) => {
	test("constructs not-pending; start() sets pending; fires once", async () => {
		const t = new impl.ResettableTimer();
		expect(t.pending).toBe(false);

		let fired = 0;
		await new Promise<void>((resolve) => {
			t.start(5, () => {
				fired += 1;
				resolve();
			});
			expect(t.pending).toBe(true);
		});
		expect(fired).toBe(1);
		// After firing, no longer pending.
		expect(t.pending).toBe(false);
	});

	test("cancel() before deadline suppresses the callback", async () => {
		const t = new impl.ResettableTimer();
		let fired = 0;
		t.start(20, () => {
			fired += 1;
		});
		expect(t.pending).toBe(true);
		t.cancel();
		expect(t.pending).toBe(false);
		// Wait past the original deadline — callback must NOT have fired.
		await new Promise<void>((resolve) => {
			const probe = new impl.ResettableTimer();
			probe.start(40, resolve);
		});
		expect(fired).toBe(0);
	});

	test("start() while pending resets the deadline (only latest fires)", async () => {
		const t = new impl.ResettableTimer();
		let firstFired = 0;
		let secondFired = 0;
		t.start(15, () => {
			firstFired += 1;
		});
		// Re-arm before the first deadline — supersedes it.
		await new Promise<void>((resolve) => {
			t.start(15, () => {
				secondFired += 1;
				resolve();
			});
		});
		expect(secondFired).toBe(1);
		expect(firstFired).toBe(0);
	});
});
