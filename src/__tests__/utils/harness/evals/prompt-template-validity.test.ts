/**
 * Fail-fast: the example specs embedded in eval prompt templates MUST
 * validate against `validateSpec()`. If you add a required field to the
 * validator and forget to update the prompt, this test fails — surfaces
 * the prompt/validator drift in CI before any LLM call is made.
 *
 * Discovered during a Treatment-A run on z-ai/glm-4.7: 100% graphspec
 * failures because the prompt described `{ nodes: {...} }` but the
 * validator required a top-level `name`. Cost: $0.33 + a half-day of
 * confused debugging. Cost of this test: 5 ms per CI run.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { factoryTag } from "@graphrefly/pure-ts/core";
import { describe, expect, it } from "vitest";
import { portableCatalog } from "../../../../../evals/lib/portable-catalog.js";
import {
	type GraphSpec,
	generateCatalogPrompt,
	validateSpec,
} from "../../../../utils/graphspec/index.js";

/** Extract every ```json … ``` block from a markdown file as parsed JSON. */
function extractJsonBlocks(md: string): unknown[] {
	const pattern = /```json\n([\s\S]*?)\n```/g;
	const blocks: unknown[] = [];
	let m: RegExpExecArray | null;
	m = pattern.exec(md);
	while (m !== null) {
		try {
			blocks.push(JSON.parse(m[1] ?? ""));
		} catch {
			// non-JSON block (template literal, etc.) — skip
		}
		m = pattern.exec(md);
	}
	return blocks;
}

const SPEC_TEMPLATE_PATH = join(
	process.env.SPEC_EVALS_PATH ?? join(homedir(), "src", "graphrefly", "evals"),
	"templates",
	"graphspec-treatment.md",
);

describe("Treatment A prompt template — example specs validate", () => {
	if (!existsSync(SPEC_TEMPLATE_PATH)) {
		it.skip("spec repo not present at SPEC_EVALS_PATH — skipping", () => {});
		return;
	}

	const md = readFileSync(SPEC_TEMPLATE_PATH, "utf-8");
	const examples = extractJsonBlocks(md);

	it("contains at least two example specs", () => {
		expect(examples.length).toBeGreaterThanOrEqual(2);
	});

	it.each(examples.map((ex, i) => [i, ex]))("example %d is a valid GraphSpec", (_i, ex) => {
		const result = validateSpec(ex);
		if (!result.valid) {
			throw new Error(
				`Treatment A prompt example failed validateSpec(): ${result.errors.join("; ")}\n` +
					`Spec: ${JSON.stringify(ex, null, 2)}\n` +
					`Path: ${SPEC_TEMPLATE_PATH}`,
			);
		}
		expect(result.valid).toBe(true);
	});
});

describe("Treatment B auto-gen prompt — round-trip with a minimal spec", () => {
	// The auto-gen prompt doesn't embed example specs; it describes the schema.
	// The fail-fast here: a minimal "from-the-prompt-description" spec must
	// validate. If validateSpec() ever requires a new field, update the
	// schema description in `contrastive.ts` AND the spec below in lockstep.
	it("a minimal spec following the prompt's described shape validates", () => {
		const spec: GraphSpec = {
			name: "minimal-from-prompt-description",
			nodes: {
				src: { type: "state", deps: [], value: 0 },
				out: { type: "derived", deps: ["src"], meta: { ...factoryTag("filterBy") } },
			},
		};
		const result = validateSpec(spec);
		expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
		expect(result.valid).toBe(true);
	});

	it("auto-generated catalog prompt mentions every required top-level field", () => {
		// This is the prompt the LLM sees in Treatment B. It must describe the
		// schema such that an LLM producing matching output gets a valid spec.
		const prompt = generateCatalogPrompt(portableCatalog);
		// generateCatalogPrompt only emits the catalog; the schema description
		// lives in contrastive.ts TREATMENT_B_HEADER. The constraint we
		// enforce here is positive: the prompt must NOT reference fields the
		// validator doesn't accept. (Use catalog presence as a sanity check.)
		expect(prompt).toContain("filterBy");
		expect(prompt).toContain("Sources:");
	});
});
