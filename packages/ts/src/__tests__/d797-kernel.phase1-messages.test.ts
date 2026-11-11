/**
 * D797 kernel migration, phase 1 (graphrefly-ts:D797-KERNEL-MIGRATION-TS): the closed message set.
 *
 * TS harness for the root scenarios C-26, C-42 and C-12 (c) in
 * ~/src/graphrefly/spec/conformance.jsonl, against R-messages@1, R-wave@2, R-subscription@3,
 * R-failure@3 and R-no-imperative@2 (graphrefly:D798, D799 and D801).
 */

import { describe, expect, it } from "vitest";
import type { Ctx, Message, Wave } from "../index.js";
import { graph } from "../index.js";

const types = (msgs: readonly Message[]) => msgs.map((m) => m[0]);

function recorder(): { msgs: Message[]; sink: (m: Message) => void } {
	const msgs: Message[] = [];
	return { msgs, sink: (m) => msgs.push(m) };
}

/** Arrays a function might try to send that are not in the closed set (cast past the type). */
const retired = {
	PULL: [["PULL", { pullId: "p" }]],
	PAUSE: [["PAUSE", "lock"]],
	RESUME: [["RESUME", "lock"]],
	TEARDOWN: [["TEARDOWN"]],
} as unknown as Record<string, Wave>;

describe("C-26: the message set is closed: PULL, PAUSE, RESUME and TEARDOWN are not messages", () => {
	it.each(
		Object.keys(retired),
	)("%s from a function is unknown and ends the node with ERROR", (type) => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		let runs = 0;
		const n = g.node<number>([a], (ctx) => {
			runs++;
			ctx.down(retired[type] as Wave);
			ctx.down([["DATA", 99]]);
		});
		const s = recorder();
		n.subscribe((incoming) => {
			for (const message of incoming) s.sink(message);
		});

		expect(runs).toBe(1);
		expect(n.status.output).toBe("errored");
		expect(types(s.msgs)).not.toContain(type);
		expect(types(s.msgs).at(-1)).toBe("ERROR");
		expect(String((s.msgs.at(-1) as readonly ["ERROR", unknown])[1])).toContain("closed");
		// The well-formed DATA after the rejected array never went out: the node had ended.
		expect(s.msgs.some((m) => m[0] === "DATA")).toBe(false);

		// The node never runs again; control would be a write to a declared state dependency.
		a.set(2);
		expect(runs).toBe(1);
		expect(types(s.msgs).filter((t) => t === "ERROR")).toHaveLength(1);
	});
});

describe("C-42: the message set is closed and nothing travels upstream", () => {
	it("rejects each array before applying anything; the DATA sent afterwards is retained", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		const rejected: string[] = [];
		const attempts: Wave[] = [
			...Object.values(retired),
			[["PENDING"]],
			[["START"]],
			[["NOT_A_MESSAGE"]] as unknown as Wave,
			// The array is rejected whole: its leading DATA is not applied either.
			[
				["DATA", 5],
				["PAUSE", "lock"],
			] as unknown as Wave,
		];
		const n = g.node<number>([a], (ctx) => {
			for (const attempt of attempts) {
				try {
					ctx.down(attempt);
				} catch (e) {
					rejected.push(String(attempt[attempt.length - 1]?.[0]));
					expect(e).toBeInstanceOf(Error);
				}
			}
			ctx.down([["DATA", 42]]);
		});
		const s = recorder();
		n.subscribe((incoming) => {
			for (const message of incoming) s.sink(message);
		});

		expect(rejected).toEqual([
			"PULL",
			"PAUSE",
			"RESUME",
			"TEARDOWN",
			"PENDING",
			"START",
			"NOT_A_MESSAGE",
			"PAUSE",
		]);
		expect(n.cache).toBe(42);
		expect(n.status.output).not.toBe("errored");
		expect(s.msgs.filter((m) => m[0] === "DATA")).toEqual([["DATA", 42]]);
		for (const type of ["PULL", "PAUSE", "RESUME", "TEARDOWN", "NOT_A_MESSAGE"])
			expect(types(s.msgs)).not.toContain(type);
	});

	it("uncaught, the rejection is the node's ERROR", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		const n = g.node<number>([a], (ctx) => {
			ctx.down([["PENDING"]]);
		});
		const s = recorder();
		n.subscribe((incoming) => {
			for (const message of incoming) s.sink(message);
		});
		expect(n.status.output).toBe("errored");
		expect(types(s.msgs).at(-1)).toBe("ERROR");
		expect(types(s.msgs).filter((t) => t === "ERROR")).toHaveLength(1);
	});

	it("there is no upward call on ctx or on a node", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		let seen: Ctx | undefined;
		const n = g.node<number>([a], (ctx) => {
			seen = ctx;
		});
		n.subscribe(() => {});
		expect(seen).toBeDefined();
		expect("up" in (seen as object)).toBe(false);
		expect("upNext" in (seen as object)).toBe(false);
		expect("pull" in (seen as object)).toBe(false);
		expect("up" in n).toBe(false);
	});

	it("a host emission through node.down is held to the same closed set", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		for (const attempt of [
			...Object.values(retired),
			[["START"]],
			[["PENDING"]],
			[["RESOLVED"]],
		] as Wave[])
			expect(() => a.down(attempt)).toThrow();
		expect(a.cache).toBe(1);
	});
});

describe("C-12 (c): RESOLVED is the kernel's alone", () => {
	it("a function that sends RESOLVED is rejected and ends the node with ERROR", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		const n = g.node<number>([a], (ctx) => {
			if (ctx.waveData[0]?.flat().includes(2)) ctx.down([["RESOLVED"]]);
			else ctx.down([["DATA", 1]]);
		});
		const d = g.node<number>([n], (ctx) => {
			ctx.down([["DATA", 1]]);
		});
		const s = recorder();
		const ds = recorder();
		n.subscribe((incoming) => {
			for (const message of incoming) s.sink(message);
		});
		d.subscribe((incoming) => {
			for (const message of incoming) ds.sink(message);
		});
		s.msgs.length = 0;
		a.set(2);
		expect(n.status.output).toBe("errored");
		expect(types(s.msgs)).not.toContain("RESOLVED");
		expect(types(s.msgs).at(-1)).toBe("ERROR");
		expect(String((s.msgs.at(-1) as readonly ["ERROR", unknown])[1])).toContain("kernel");
		// Its dependent is not left pending: the ERROR settles it (auto ERROR).
		expect(d.status.output).toBe("errored");
	});

	it("a pending node that sends nothing gets the kernel's RESOLVED", () => {
		const g = graph();
		const a = g.node<number>([], null, { initial: 1 });
		const n = g.node<number>([a], () => {});
		const s = recorder();
		n.subscribe((incoming) => {
			for (const message of incoming) s.sink(message);
		});
		s.msgs.length = 0;
		a.set(2);
		expect(types(s.msgs)).toEqual(["PENDING", "RESOLVED"]);
	});
});
