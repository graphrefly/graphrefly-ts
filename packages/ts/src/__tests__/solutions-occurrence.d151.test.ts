import { describe, expect, it } from "vitest";
import { graph } from "../graph/graph.js";
import type { Message } from "../protocol/messages.js";
import {
	type SolutionOccurrence,
	solutionOccurrenceJoin,
	solutionOccurrenceProjection,
} from "../solutions/occurrence.js";

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
	it("rejects non-DATA input without invoking accessors or publishing a partial batch", () => {
		let invoked = false;
		const malformed = {
			coordinate: "two",
			get material() {
				invoked = true;
				return "hidden";
			},
		};
		const f = fixture();
		expect(() =>
			f.input.down([
				["DATA", occurrence("one")],
				["DATA", occurrence("two", { value: malformed })],
			]),
		).toThrow();
		expect(invoked).toBe(false);
		expect(f.messages.filter((message) => message[0] === "DATA")).toEqual([]);
		f.unsubscribe();
	});
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

describe("D151 exact solution occurrence join", () => {
	it("preserves an initial snapshot for consumers attached after construction", () => {
		const g = graph();
		const input = g.state(occurrence("one"));
		const output = solutionOccurrenceJoin(g, input, input, {
			name: "initial",
			factory: "testOccurrenceJoin",
			maxOccurrences: 2,
			project: (left, right) => [left.coordinate, right.coordinate],
		});
		const messages: Message[] = [];
		const stop = output.subscribe((message) => messages.push(message));
		expect(
			messages
				.filter((message) => message[0] === "DATA")
				.map((message) => (message[1] as SolutionOccurrence<string[]>).value),
		).toEqual([["one", "one"]]);
		stop();
		const later: Message[] = [];
		const stopLater = output.subscribe((message) => later.push(message));
		expect(later.filter((message) => message[0] === "DATA")).toHaveLength(1);
		stopLater();
	});
	function joined(maxOccurrences = 2) {
		const owner = graph();
		const leftInput = owner.node<SolutionOccurrence<Value>>([], null, { name: "left-input" });
		const rightInput = owner.node<SolutionOccurrence<Value>>([], null, { name: "right-input" });
		const lane = (input: typeof leftInput, name: string) =>
			solutionOccurrenceProjection(owner, input, {
				name,
				factory: "testValidatedLane",
				maxOccurrences: 10,
				project: (value) => value,
			});
		const output = solutionOccurrenceJoin(
			owner,
			lane(leftInput, "left"),
			lane(rightInput, "right"),
			{
				name: "joined",
				factory: "testOccurrenceJoin",
				maxOccurrences,
				project: (left, right) => [left.coordinate, right.coordinate],
			},
		);
		const messages: Message[] = [];
		const unsubscribe = output.subscribe((message) => messages.push(message));
		return { owner, leftInput, rightInput, messages, unsubscribe };
	}
	it("pairs all DATA by identity, not wave or latest value; an absent sibling stays quiet", () => {
		const f = joined();
		f.leftInput.down([
			["DATA", occurrence("one")],
			["DATA", occurrence("two")],
		]);
		expect(f.messages.filter((message) => message[0] === "DATA" || message[0] === "DIRTY")).toEqual(
			[],
		);
		f.rightInput.down([["DATA", occurrence("two")]]);
		f.rightInput.down([["DATA", occurrence("one")]]);
		expect(
			f.messages
				.filter((message) => message[0] === "DATA")
				.map((message) => (message[1] as SolutionOccurrence<string[]>).value),
		).toEqual([
			["two", "two"],
			["one", "one"],
		]);
		f.leftInput.down([["DATA", occurrence("two")]]);
		f.rightInput.down([["DATA", occurrence("two")]]);
		expect(f.messages.filter((message) => message[0] === "DATA")).toHaveLength(2);
		expect(f.owner.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "left", to: "joined/left" },
				{ from: "right", to: "joined/right" },
				{ from: "joined/arrivals", to: "joined/matched" },
				{ from: "joined/matched", to: "joined/released" },
				{ from: "joined/released", to: "joined" },
			]),
		);
		f.unsubscribe();
	});
	it("releases every completed occurrence from one multi-DATA wave", () => {
		const f = joined();
		f.leftInput.down([
			["DATA", occurrence("one")],
			["DATA", occurrence("two")],
		]);
		f.rightInput.down([
			["DATA", occurrence("one")],
			["DATA", occurrence("two")],
		]);
		expect(
			f.messages
				.filter((message) => message[0] === "DATA")
				.map((message) => (message[1] as SolutionOccurrence<unknown>).occurrenceId),
		).toEqual(["one", "two"]);
		f.unsubscribe();
	});
	it("rejects cross-lane provenance disagreement without publishing a partial batch", () => {
		const f = joined();
		f.leftInput.down([
			["DATA", occurrence("one")],
			["DATA", occurrence("two")],
		]);
		expect(() =>
			f.rightInput.down([
				["DATA", occurrence("one")],
				["DATA", occurrence("two", { occurrenceSourceRefs: [{ kind: "work-item", id: "wrong" }] })],
			]),
		).toThrow(/provenance mismatch/);
		expect(f.messages.filter((message) => message[0] === "DATA")).toEqual([]);
		f.unsubscribe();
	});
	it("bounds pending plus completed identity/revision pairs", () => {
		const f = joined(1);
		f.leftInput.down([["DATA", occurrence("one")]]);
		f.rightInput.down([["DATA", occurrence("one")]]);
		expect(() => f.leftInput.down([["DATA", occurrence("two")]])).toThrow(
			/retention bound exceeded/,
		);
		f.unsubscribe();
	});
	it("enforces pending retention before the other lane has ever emitted", () => {
		const f = joined(1);
		f.leftInput.down([["DATA", occurrence("one")]]);
		expect(() => f.leftInput.down([["DATA", occurrence("two")]])).toThrow(
			/retention bound exceeded/,
		);
		expect(f.messages.filter((message) => message[0] === "DATA")).toEqual([]);
		f.unsubscribe();
	});
	it("detaches pending material so caller mutation cannot rewrite an occurrence", () => {
		const f = joined();
		const material = { coordinate: "one", material: "original" };
		f.leftInput.down([["DATA", occurrence("one", { value: material })]]);
		material.coordinate = "changed-without-revision";
		f.rightInput.down([["DATA", occurrence("one")]]);
		expect(
			f.messages
				.filter((message) => message[0] === "DATA")
				.map((message) => (message[1] as SolutionOccurrence<string[]>).value),
		).toEqual([["one", "one"]]);
		f.unsubscribe();
	});
});
