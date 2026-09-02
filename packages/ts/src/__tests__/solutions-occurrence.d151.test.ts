import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import type { Message } from "../protocol/messages.js";
import { type SolutionOccurrence, solutionOccurrenceProjection } from "../solutions/occurrence.js";

type Value = Readonly<{ readonly coordinate: string; readonly material: string }>;

function occurrence(
	id: string,
	patch: Partial<SolutionOccurrence<Value>> = {},
): SolutionOccurrence<Value> {
	return Object.freeze({
		occurrenceId: id,
		occurrenceRevision: 1,
		occurrenceDigest: `sha256:${(id === "one" ? "1" : "2").repeat(64)}`,
		occurrenceSourceRefs: Object.freeze([{ kind: "work-item", id: `work-item/${id}` }]),
		value: Object.freeze({ coordinate: id, material: `material/${id}` }),
		...patch,
	});
}

function fixture(maxOccurrences = 2) {
	const owner = graph();
	const input = owner.node<SolutionOccurrence<Value>>([], null, { name: "occurrence/input" });
	const projection = solutionOccurrenceProjection(owner, input, {
		name: "occurrence/projection",
		factory: "testOccurrenceProjection",
		maxOccurrences,
		project: (value) => Object.freeze({ selected: value.coordinate }),
	});
	const messages: Message[] = [];
	const unsubscribe = projection.subscribe((message) => messages.push(message));
	return { input, messages, unsubscribe };
}

describe("D151 package-private solution occurrence projection", () => {
	it("preserves bounded occurrences across reordered waves and deduplicates exact replay", () => {
		const { input, messages, unsubscribe } = fixture();
		const second = occurrence("two");
		const first = occurrence("one");
		input.down([["DATA", second]]);
		input.down([["DATA", first]]);
		expect(
			messages
				.filter((message) => message[0] === "DATA")
				.map((message) => (message[1] as SolutionOccurrence<unknown>).occurrenceId),
		).toEqual(["two", "one"]);
		input.down([["DATA", second]]);
		expect(messages.filter((message) => message[0] === "DATA")).toHaveLength(2);
		unsubscribe();
	});

	it.each([
		["digest", { occurrenceDigest: `sha256:${"a".repeat(64)}` }, /conflicted with prior DATA/u],
		[
			"provenance",
			{ occurrenceSourceRefs: [{ kind: "work-item", id: "rebound" }] },
			/conflicted with prior DATA/u,
		],
		["value", { value: { coordinate: "one", material: "changed" } }, /conflicted with prior DATA/u],
	] as const)("fails closed on same-revision %s conflict", (_label, patch, expected) => {
		const { input, unsubscribe } = fixture();
		input.down([["DATA", occurrence("one")]]);
		expect(() => input.down([["DATA", occurrence("one", patch)]])).toThrow(expected);
		unsubscribe();
	});

	it("accepts a higher revision, rejects stale replay, and enforces the fixed identity bound", () => {
		const revised = fixture(1);
		revised.input.down([["DATA", occurrence("one")]]);
		revised.input.down([
			[
				"DATA",
				occurrence("one", {
					occurrenceRevision: 2,
					occurrenceDigest: `sha256:${"b".repeat(64)}`,
					value: { coordinate: "one", material: "revision-2" },
				}),
			],
		]);
		expect(() => revised.input.down([["DATA", occurrence("one")]])).toThrow(/stale revision/u);
		revised.unsubscribe();

		const bounded = fixture(1);
		bounded.input.down([["DATA", occurrence("one")]]);
		expect(() => bounded.input.down([["DATA", occurrence("two")]])).toThrow(/fixed bound/u);
		bounded.unsubscribe();
	});
});
