import type { Message } from "../protocol/messages.js";
import type { SolutionOccurrence } from "../solutions/occurrence.js";

/** Explicit complete caller snapshot; never derives identity from Graph wave timing. */
export function occurrenceFixture<T>(
	value: T,
	revision = 1,
	id = "fixture",
): SolutionOccurrence<T> {
	return {
		occurrenceId: id,
		occurrenceRevision: revision,
		occurrenceDigest: `sha256:${createHash("sha256").update(`${id}:${revision}`).digest("hex")}`,
		occurrenceSourceRefs: [{ kind: "test-snapshot", id: `${id}:${revision}` }],
		value,
	};
}

export function occurrenceData<T>(messages: readonly Message[]): T[] {
	return messages.filter((m) => m[0] === "DATA").map((m) => (m[1] as SolutionOccurrence<T>).value);
}

import { createHash } from "node:crypto";
