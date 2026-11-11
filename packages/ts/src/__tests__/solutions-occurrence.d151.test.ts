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

/**
 * R-failure@3: a fail-closed rejection thrown inside a node's function is that node's ERROR, which
 * reaches the projection's subscriber; the host write itself does not throw.
 */
function rejects(messages: readonly Message[], write: () => void, pattern?: RegExp): void {
	expect(write).not.toThrow();
	const error = messages.find((message) => message[0] === "ERROR");
	expect(error, "expected the rejection as an ERROR").toBeDefined();
	if (pattern !== undefined)
		expect(String((error?.[1] as Error | undefined)?.message ?? error?.[1])).toMatch(pattern);
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
	const unsubscribe = projection.subscribe((incoming) => {
		for (const message of incoming) {
			messages.push(message);
		}
	});
	return { owner, input, messages, unsubscribe };
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
		rejects(f.messages, () =>
			f.owner.batch(() => {
				f.input.set(occurrence("one"));
				f.input.set(occurrence("two", { value: malformed }));
			}),
		);
		expect(invoked).toBe(false);
		expect(f.messages.filter((message) => message[0] === "DATA")).toEqual([]);
		f.unsubscribe();
	});
	it("preserves bounded occurrences across reordered waves and deduplicates exact replay", () => {
		const { input, messages, unsubscribe } = fixture();
		const second = occurrence("two");
		const first = occurrence("one");
		input.set(second);
		input.set(first);
		expect(
			messages
				.filter((message) => message[0] === "DATA")
				.map((message) => (message[1] as SolutionOccurrence<unknown>).occurrenceId),
		).toEqual(["two", "one"]);
		input.set(second);
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
		const { input, messages, unsubscribe } = fixture();
		input.set(occurrence("one"));
		rejects(messages, () => input.set(occurrence("one", patch)), expected);
		unsubscribe();
	});

	it("accepts a higher revision, rejects stale replay, and enforces the fixed identity bound", () => {
		const revised = fixture(1);
		revised.input.set(occurrence("one"));
		revised.input.set(
			occurrence("one", {
				occurrenceRevision: 2,
				occurrenceDigest: `sha256:${"b".repeat(64)}`,
				value: { coordinate: "one", material: "revision-2" },
			}),
		);
		rejects(revised.messages, () => revised.input.set(occurrence("one")), /stale revision/u);
		revised.unsubscribe();

		const bounded = fixture(1);
		bounded.input.set(occurrence("one"));
		rejects(bounded.messages, () => bounded.input.set(occurrence("two")), /fixed bound/u);
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
		const stop = output.subscribe((incoming) => {
			for (const message of incoming) {
				messages.push(message);
			}
		});
		expect(
			messages
				.filter((message) => message[0] === "DATA")
				.map((message) => (message[1] as SolutionOccurrence<string[]>).value),
		).toEqual([["one", "one"]]);
		stop();
		const later: Message[] = [];
		const stopLater = output.subscribe((incoming) => {
			for (const message of incoming) {
				later.push(message);
			}
		});
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
		const unsubscribe = output.subscribe((incoming) => {
			for (const message of incoming) {
				messages.push(message);
			}
		});
		return { owner, leftInput, rightInput, messages, unsubscribe };
	}
	it("pairs all DATA by identity, not wave or latest value; an absent sibling stays quiet", () => {
		const f = joined();
		f.owner.batch(() => {
			f.leftInput.set(occurrence("one"));
			f.leftInput.set(occurrence("two"));
		});
		expect(
			f.messages.filter((message) => message[0] === "DATA" || message[0] === "PENDING"),
		).toEqual([]);
		f.rightInput.set(occurrence("two"));
		f.rightInput.set(occurrence("one"));
		expect(
			f.messages
				.filter((message) => message[0] === "DATA")
				.map((message) => (message[1] as SolutionOccurrence<string[]>).value),
		).toEqual([
			["two", "two"],
			["one", "one"],
		]);
		f.leftInput.set(occurrence("two"));
		f.rightInput.set(occurrence("two"));
		expect(f.messages.filter((message) => message[0] === "DATA")).toHaveLength(2);
		expect(f.owner.describe().edges).toEqual(
			expect.arrayContaining([
				{ from: "left", to: "joined/left" },
				{ from: "right", to: "joined/right" },
				{ from: "joined/arrivals", to: "joined/matched" },
				{ from: "joined/matched", to: "joined" },
			]),
		);
		f.unsubscribe();
	});
	it("releases every completed occurrence from one multi-DATA wave", () => {
		const f = joined();
		f.owner.batch(() => {
			f.leftInput.set(occurrence("one"));
			f.leftInput.set(occurrence("two"));
		});
		f.owner.batch(() => {
			f.rightInput.set(occurrence("one"));
			f.rightInput.set(occurrence("two"));
		});
		expect(
			f.messages
				.filter((message) => message[0] === "DATA")
				.map((message) => (message[1] as SolutionOccurrence<unknown>).occurrenceId),
		).toEqual(["one", "two"]);
		f.unsubscribe();
	});
	it("rejects cross-lane provenance disagreement without publishing a partial batch", () => {
		const f = joined();
		f.owner.batch(() => {
			f.leftInput.set(occurrence("one"));
			f.leftInput.set(occurrence("two"));
		});
		rejects(
			f.messages,
			() =>
				f.owner.batch(() => {
					f.rightInput.set(occurrence("one"));
					f.rightInput.set(
						occurrence("two", { occurrenceSourceRefs: [{ kind: "work-item", id: "wrong" }] }),
					);
				}),
			/provenance mismatch/,
		);
		expect(f.messages.filter((message) => message[0] === "DATA")).toEqual([]);
		f.unsubscribe();
	});
	it("bounds pending plus completed identity/revision pairs", () => {
		const f = joined(1);
		f.leftInput.set(occurrence("one"));
		f.rightInput.set(occurrence("one"));
		rejects(f.messages, () => f.leftInput.set(occurrence("two")), /retention bound exceeded/);
		f.unsubscribe();
	});
	it("enforces pending retention before the other lane has ever emitted", () => {
		const f = joined(1);
		f.leftInput.set(occurrence("one"));
		rejects(f.messages, () => f.leftInput.set(occurrence("two")), /retention bound exceeded/);
		expect(f.messages.filter((message) => message[0] === "DATA")).toEqual([]);
		f.unsubscribe();
	});
	it("detaches pending material so caller mutation cannot rewrite an occurrence", () => {
		const f = joined();
		const material = { coordinate: "one", material: "original" };
		f.leftInput.set(occurrence("one", { value: material }));
		material.coordinate = "changed-without-revision";
		f.rightInput.set(occurrence("one"));
		expect(
			f.messages
				.filter((message) => message[0] === "DATA")
				.map((message) => (message[1] as SolutionOccurrence<string[]>).value),
		).toEqual([["one", "one"]]);
		f.unsubscribe();
	});
});
