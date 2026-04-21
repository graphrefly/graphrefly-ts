// JSON Schema fed to Chrome Nano via responseConstraint, and the matching
// system prompt. Both adapters share the schema so output shape is identical
// regardless of which one is in use.

import type { EntityKind, Relation } from "./types.js";

export const ENTITY_KINDS: readonly EntityKind[] = [
	"concept",
	"method",
	"risk",
	"actor",
	"metric",
	"other",
];

export const RELATIONS: readonly Relation[] = [
	"is_a",
	"part_of",
	"addresses",
	"uses",
	"causes",
	"contrasts_with",
];

export const EXTRACTION_SCHEMA = {
	type: "object",
	required: ["entities", "relations"],
	additionalProperties: false,
	properties: {
		entities: {
			type: "array",
			maxItems: 8,
			items: {
				type: "object",
				required: ["id", "label", "kind"],
				additionalProperties: false,
				properties: {
					id: { type: "string", pattern: "^[a-z0-9_-]+$" },
					label: { type: "string", minLength: 1, maxLength: 60 },
					kind: { type: "string", enum: [...ENTITY_KINDS] },
				},
			},
		},
		relations: {
			type: "array",
			maxItems: 8,
			items: {
				type: "object",
				required: ["from", "to", "relation"],
				additionalProperties: false,
				properties: {
					from: { type: "string" },
					to: { type: "string" },
					relation: { type: "string", enum: [...RELATIONS] },
				},
			},
		},
	},
};

export const EXTRACTION_SYSTEM_PROMPT = `You extract a tiny knowledge graph from one paragraph at a time.

What to extract:
- Any meaningful **noun or noun phrase** — proper nouns (people, places, organizations) AND common nouns (concepts, processes, objects). Examples: "habitat", "fauna", "kingdom", "evolution", "neural network", "Mechanistic Interpretability", "Reward Hacking".
- At most 6 entities per paragraph. Pick the ones the paragraph is actually about.

What to skip:
- Pronouns ("it", "they", "this"), discourse markers ("yes", "no", "okay", "however"), articles, prepositions, verbs, single letters.
- Page chrome / UI labels ("Image", "See also", "Edit", "Caption", "Yes", "No").
- Generic standalone words with no domain meaning ("thing", "stuff", "way").
- Anything you'd be unable to draw a meaningful relation to/from.

Schema constraints:
- "id" must be lowercase snake_case derived from the label (use hyphens for spaces).
- "kind" must be one of: ${ENTITY_KINDS.join(", ")}.
- Add 1-6 relations between entities you returned.
- "relation" must be one of: ${RELATIONS.join(", ")}.
- Direction matters: "from → to". Pick the natural direction (e.g., "hitl part_of harness", not "harness part_of hitl").

Output JSON only, matching the schema. No prose.`;

export function buildUserPrompt(paragraph: string): string {
	return `Extract entities and relations from this paragraph:\n\n${paragraph}`;
}
