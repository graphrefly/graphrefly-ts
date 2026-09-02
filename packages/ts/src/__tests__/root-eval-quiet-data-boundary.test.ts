import { describe, expect, it } from "vitest";
import { rootEvalQuietDataBoundary } from "../../evals/graph-native-rerun-avoidance/quiet-data-boundary.js";
import { graph } from "../graph/graph.js";

describe("D151 quiet complete-DATA boundary", () => {
	it("preserves a six-occurrence wave, supports bigint through an exact fingerprint, and deduplicates mixed replay", () => {
		const owner = graph();
		type Value = { id: string; version: bigint };
		const input = owner.node<Value>([], null, { name: "input" });
		const boundary = rootEvalQuietDataBoundary(owner, input, {
			name: "accepted",
			factory: "testAccepted",
			maxOccurrences: 7,
			key: (value) => value.id,
			fingerprint: (value) => String(value.version),
		});
		const messages: unknown[][] = [];
		const stop = boundary.output.subscribe((message) => messages.push([...message]));
		try {
			input.down([["DIRTY"], ["RESOLVED"]]);
			expect(messages.some((message) => message[0] === "DIRTY")).toBe(false);
			const values = Array.from({ length: 6 }, (_, index) => ({ id: String(index), version: 1n }));
			input.down(values.map((value) => ["DATA", value]));
			input.down([
				["DATA", values[0]],
				["DATA", { id: "6", version: 1n }],
			]);
			expect(
				messages.filter((message) => message[0] === "DATA").map((message) => message[1]),
			).toEqual([...values, { id: "6", version: 1n }]);
		} finally {
			stop();
			boundary.release();
		}
	});
	it("fails closed for a whole conflicting batch without releasing its valid prefix", () => {
		const owner = graph();
		const input = owner.node<{ id: string; value: number }>([], null, { name: "input" });
		const boundary = rootEvalQuietDataBoundary(owner, input, {
			name: "accepted",
			factory: "testAccepted",
			maxOccurrences: 2,
			key: (value) => value.id,
		});
		const data: unknown[] = [];
		const stop = boundary.output.subscribe((message) => {
			if (message[0] === "DATA") data.push(message[1]);
		});
		const errors: unknown[] = [];
		const unobserve = owner.observe("accepted/validated").subscribe((event) => {
			if (event.msg[0] === "ERROR") errors.push(event.msg[1]);
		});
		try {
			expect(() =>
				input.down([
					["DATA", { id: "same", value: 1 }],
					["DATA", { id: "same", value: 2 }],
				]),
			).toThrow("conflicting occurrence replay");
			expect(data).toEqual([]);
		} finally {
			stop();
			unobserve();
			boundary.release();
		}
	});
});
