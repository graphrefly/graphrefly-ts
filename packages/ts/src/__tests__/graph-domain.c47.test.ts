/**
 * C-47 (R-graph-domain@3, R-request-order, R-checkpoint; graphrefly:D803): graphs on one thread
 * share no wave, request queue or batch.
 */

import { describe, expect, it } from "vitest";
import { graph, type Message } from "../index.js";

const values = (msgs: readonly Message[]) => msgs.filter((m) => m[0] === "DATA").map((m) => m[1]);

describe("C-47 — graphs on one thread share no wave, request queue or batch", () => {
	it("a write to another graph during a wave runs at once; a write back waits for the wave", () => {
		const g1 = graph();
		const g2 = graph();
		const a = g1.state(0, { name: "a" });
		const c = g1.state(0, { name: "c" });
		const b = g2.state(0, { name: "b" });
		const log: string[] = [];
		const captures: Record<string, string> = {};

		c.subscribe((msgs) => {
			for (const v of values(msgs)) log.push(`c sink: ${v}`);
		});
		b.subscribe((msgs) => {
			for (const v of values(msgs)) {
				log.push(`s2 sees b=${v}`);
				if (v === 1) {
					c.set(1); // g1 is in a's wave: this is g1's next request
					log.push("s2 wrote c");
				}
			}
		});
		a.subscribe((msgs) => {
			for (const v of values(msgs)) {
				if (v !== 1) continue;
				log.push("s1 writes b");
				b.set(1); // g2 is idle: b's wave runs at once, inside this callback
				log.push("s1: b's write returned");
				for (const [name, g] of [
					["g1", g1],
					["g2", g2],
				] as const) {
					try {
						g.checkpoint();
						captures[name] = "captured";
					} catch {
						captures[name] = "refused";
					}
				}
				log.push("a's wave ends");
			}
		});
		log.length = 0;

		a.set(1);

		expect(log).toEqual([
			"s1 writes b",
			"s2 sees b=1",
			"s2 wrote c",
			"s1: b's write returned",
			"a's wave ends",
			"c sink: 1", // c's write ran after a's wave, as g1's next request
		]);
		expect(captures).toEqual({ g1: "refused", g2: "captured" });
		expect(c.cache).toBe(1);
	});

	it("a write to another graph inside a batch body is that graph's own request", () => {
		const g1 = graph();
		const g2 = graph();
		const a = g1.state(0, { name: "a" });
		const b = g2.state(0, { name: "b" });
		const aSeen: unknown[] = [];
		a.subscribe((msgs) => aSeen.push(...values(msgs)));
		aSeen.length = 0;
		let readB: unknown;
		let aDuringBody: unknown;

		g1.batch(() => {
			a.set(5);
			b.set(7); // g2's own request: runs at once
			readB = b.cache;
			aDuringBody = a.cache;
		});

		expect(readB).toBe(7);
		expect(aDuringBody).toBe(0); // a's write commits only when the body returns
		expect(a.cache).toBe(5);
		expect(aSeen).toEqual([5]);
	});
});
