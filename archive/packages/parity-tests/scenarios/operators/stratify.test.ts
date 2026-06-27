/**
 * Stratify operator parity scenarios (D199 — Unit 5 Q9.2 of
 * `archive/docs/SESSION-rust-port-layer-boundary.md`).
 *
 * `stratifyBranch(source, rules, classifier)` is the substrate
 * counterpart of TS `extra/composition/stratify.ts` `_addBranch`.
 * The TS `stratify(name, source, rules, opts) → Graph` Graph factory
 * composes N branches; here we exercise the routing operator
 * directly so both pure-ts and rust-via-napi prove the same
 * semantics.
 *
 * Rust port reference:
 * `~/src/graphrefly-rs/crates/graphrefly-operators/src/stratify.rs`
 * (D199, landed 2026-05-14).
 *
 * Rules / decisions covered:
 * - D193 substrate predicate (classifier-routing operator)
 * - D199 ~50 LOC port into graphrefly-operators
 * - "rules updates affect future items only" (cache update, no
 *   downstream emit)
 * - "rules COMPLETE silently absorbed" (branch keeps last-seen rules
 *   cache + continues)
 * - Source COMPLETE / ERROR forwarded
 */

import { describe, expect, test } from "vitest";
import { impls } from "../../impls/registry.js";

describe.each(impls)("stratify — basic routing — $name", (impl) => {
	test("classifier match emits DATA; miss drops silently", async () => {
		const src = await impl.node<number>([], { name: "src" });
		// rules holds the integer modulus to use for classification.
		const rules = await impl.node<number>([], { name: "rules", initial: 2 });

		// Branch "evens": matches when value % rules === 0.
		const evens = await impl.stratifyBranch<number, number>(
			src,
			rules,
			(modulus, value) => value % modulus === 0,
		);

		const seenData: number[] = [];
		const unsub = await evens.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seenData.push(msg[1] as number);
			}
		});

		try {
			seenData.length = 0;
			await src.down([[impl.DATA, 1]]); // odd → drop
			await src.down([[impl.DATA, 2]]); // even → emit
			await src.down([[impl.DATA, 3]]); // odd → drop
			await src.down([[impl.DATA, 4]]); // even → emit

			expect(seenData).toEqual([2, 4]);
		} finally {
			await unsub();
		}
	});

	test("no-rules sentinel drops all (classifier never fires)", async () => {
		const src = await impl.node<number>([], { name: "src" });
		// rules in sentinel state — never emits DATA.
		const rules = await impl.node<number>([], { name: "rules" });

		const branch = await impl.stratifyBranch<number, number>(
			src,
			rules,
			(_modulus, _value) => true, // would always match if invoked
		);

		const seenData: number[] = [];
		const unsub = await branch.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seenData.push(msg[1] as number);
			}
		});

		try {
			seenData.length = 0;
			await src.down([[impl.DATA, 1]]);
			await src.down([[impl.DATA, 2]]);

			expect(seenData).toEqual([]);
		} finally {
			await unsub();
		}
	});
});

describe.each(impls)("stratify — reactive rules — $name", (impl) => {
	test("rules update affects FUTURE items only", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const rules = await impl.node<number>([], { name: "rules", initial: 2 });

		const branch = await impl.stratifyBranch<number, number>(
			src,
			rules,
			(modulus, value) => value % modulus === 0,
		);

		const seenData: number[] = [];
		const unsub = await branch.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seenData.push(msg[1] as number);
			}
		});

		try {
			seenData.length = 0;
			// Under mode=2 — emit evens. Use distinct values so identity
			// equals doesn't dedup on repeat.
			await src.down([[impl.DATA, 2]]); // 2 % 2 == 0 → emit
			await src.down([[impl.DATA, 5]]); // 5 % 2 == 1 → drop

			// Update rules → mode=3.
			await rules.down([[impl.DATA, 3]]);

			// Under mode=3 — emit multiples of 3.
			await src.down([[impl.DATA, 9]]); // 9 % 3 == 0 → emit
			await src.down([[impl.DATA, 7]]); // 7 % 3 == 1 → drop
			await src.down([[impl.DATA, 12]]); // 12 % 3 == 0 → emit

			expect(seenData).toEqual([2, 9, 12]);
		} finally {
			await unsub();
		}
	});

	test("rules COMPLETE silently absorbed; branch continues under cached rules", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const rules = await impl.node<number>([], { name: "rules", initial: 2 });

		const branch = await impl.stratifyBranch<number, number>(
			src,
			rules,
			(modulus, value) => value % modulus === 0,
		);

		const seenData: number[] = [];
		let sawComplete = false;
		const unsub = await branch.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seenData.push(msg[1] as number);
				if (msg[0] === impl.COMPLETE) sawComplete = true;
			}
		});

		try {
			seenData.length = 0;
			sawComplete = false;
			await src.down([[impl.DATA, 2]]); // emit
			await rules.down([[impl.COMPLETE]]); // branch should NOT complete
			await src.down([[impl.DATA, 4]]); // still classified under cached mode=2 → emit

			expect(seenData).toEqual([2, 4]);
			expect(sawComplete).toBe(false);
		} finally {
			await unsub();
		}
	});
});

describe.each(impls)("stratify — terminal forwarding — $name", (impl) => {
	test("source COMPLETE forwarded downstream", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const rules = await impl.node<number>([], { name: "rules", initial: 2 });

		const branch = await impl.stratifyBranch<number, number>(
			src,
			rules,
			(modulus, value) => value % modulus === 0,
		);

		const seenData: number[] = [];
		let sawComplete = false;
		const unsub = await branch.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.DATA) seenData.push(msg[1] as number);
				if (msg[0] === impl.COMPLETE) sawComplete = true;
			}
		});

		try {
			seenData.length = 0;
			sawComplete = false;
			await src.down([[impl.DATA, 2]]);
			await src.down([[impl.COMPLETE]]);

			expect(seenData).toEqual([2]);
			expect(sawComplete).toBe(true);
		} finally {
			await unsub();
		}
	});

	test("source ERROR forwarded downstream", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const rules = await impl.node<number>([], { name: "rules", initial: 2 });

		const branch = await impl.stratifyBranch<number, number>(
			src,
			rules,
			(modulus, value) => value % modulus === 0,
		);

		let sawError: unknown;
		const unsub = await branch.subscribe((msgs) => {
			for (const msg of msgs) {
				if (msg[0] === impl.ERROR) sawError = msg[1];
			}
		});

		try {
			await src.down([[impl.ERROR, "boom"]]);
			expect(sawError).toBe("boom");
		} finally {
			await unsub();
		}
	});
});

describe.each(impls)("stratify — multi-branch independence — $name", (impl) => {
	test("same source feeds N branches with different classifier semantics", async () => {
		const src = await impl.node<number>([], { name: "src" });
		const rules = await impl.node<number>([], { name: "rules", initial: 3 });

		const zeros = await impl.stratifyBranch<number, number>(
			src,
			rules,
			(modulus, value) => value % modulus === 0,
		);
		const ones = await impl.stratifyBranch<number, number>(
			src,
			rules,
			(modulus, value) => value % modulus === 1,
		);
		const twos = await impl.stratifyBranch<number, number>(
			src,
			rules,
			(modulus, value) => value % modulus === 2,
		);

		const zerosOut: number[] = [];
		const onesOut: number[] = [];
		const twosOut: number[] = [];

		const u0 = await zeros.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === impl.DATA) zerosOut.push(m[1] as number);
		});
		const u1 = await ones.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === impl.DATA) onesOut.push(m[1] as number);
		});
		const u2 = await twos.subscribe((msgs) => {
			for (const m of msgs) if (m[0] === impl.DATA) twosOut.push(m[1] as number);
		});

		try {
			zerosOut.length = 0;
			onesOut.length = 0;
			twosOut.length = 0;
			for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
				await src.down([[impl.DATA, n]]);
			}

			expect(zerosOut).toEqual([0, 3, 6]);
			expect(onesOut).toEqual([1, 4, 7]);
			expect(twosOut).toEqual([2, 5, 8]);
		} finally {
			await u0();
			await u1();
			await u2();
		}
	});
});
