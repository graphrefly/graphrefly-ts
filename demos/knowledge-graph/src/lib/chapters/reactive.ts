// Chapter 2 — the reactive turn. THIS is the moment users understand why a
// knowledgeGraph() is a Graph, not just a Map.
//
// Topology:
//
//   paper-text (state)
//        │
//        ▼
//   paragraphs (derived)
//        │            ┌── paragraph-idx (state)
//        ▼            ▼
//      current-paragraph (derived)
//        │
//        ▼
//   extraction (promptNode → JSON)
//        │
//        ▼
//   apply-extraction (effect — calls kg.upsertEntity / kg.link)
//        │
//        ▼
//   kg/{entities,edges,adjacency}  ← UI subscribes here, never polls.

import { batch, derived, effect, type Node, state } from "@graphrefly/graphrefly/core";
import { type LLMAdapter, promptNode } from "@graphrefly/graphrefly/patterns/ai";
import type { NodeRegistry } from "@graphrefly/graphrefly/patterns/demo-shell";
import { buildUserPrompt, EXTRACTION_SYSTEM_PROMPT } from "../extraction-schema.js";
import { splitContentParagraphs } from "../paragraphs.js";
import type { Entity, ExtractionResult } from "../types.js";
import { applyExtractionToKG, type DemoKG, makeKG } from "./_shared.js";

export const REACTIVE_SOURCE = `// 1. The KG is the same factory as chapter 1 — but now it's the END of a
//    pipeline, not the whole story.
const kg = knowledgeGraph<Entity, Relation>("reactive");

// 2. Reactive sources for the paper and the current cursor into it.
const paperText      = state(SAMPLE_PAPER, { name: "paper-text" });
const paragraphIdx   = state(0,             { name: "paragraph-idx" });

// 3. Pure derived nodes — split + index.
const paragraphs = derived([paperText], ([t]) => splitParagraphs(t),
  { name: "paragraphs" });
const currentParagraph = derived([paragraphs, paragraphIdx],
  ([ps, i]) => ps[i] ?? "",
  { name: "current-paragraph" });

// 4. promptNode — universal LLM transform. Re-fires whenever current-paragraph
//    changes. Output is a JSON ExtractionResult shaped by responseConstraint.
const extraction = promptNode<ExtractionResult>(
  llmAdapter,                 // chrome-nano OR mock — same contract
  [currentParagraph],
  (p) => buildUserPrompt(p as string),
  { name: "extraction", format: "json", systemPrompt: EXTRACTION_SYSTEM_PROMPT },
);

// 5. The bridge — an effect that funnels each new extraction into the KG.
//    THIS is the only imperative line in the pipeline. Everything downstream
//    (entities / edges / adjacency / your visualization) is reactive.
const applyExtraction = effect([extraction], ([result]) => {
  if (!result) return;
  applyExtractionToKG(kg, result);
});

// 6. Advance the cursor → step 4 re-fires → step 5 writes to kg → adjacency
//    re-derives → your KG visualization re-renders. No polling, no triggers.
shell.advance(); // → paragraphIdx + 1
`;

export type ReactiveChapter = {
	id: "reactive";
	graph: DemoKG; // the KG IS the chapter graph; upstream nodes are added to it
	kg: DemoKG;
	sourceCode: string;
	registry: NodeRegistry;
	paperText: Node<string>;
	paragraphIdx: Node<number>;
	paragraphs: Node<readonly string[]>;
	currentParagraph: Node<string>;
	extraction: Node<ExtractionResult | null>;
	setPaperText: (text: string) => void;
	setParagraphIdx: (i: number) => void;
	advance: () => void;
	reset: () => void;
};

export function buildReactiveChapter(
	adapter: LLMAdapter,
	initialPaperText: string,
): ReactiveChapter {
	const kg = makeKG("reactive");

	const paperText = state(initialPaperText, { name: "paper-text" });
	const paragraphIdx = state(0, { name: "paragraph-idx" });

	const paragraphs = derived([paperText], ([t]) => splitContentParagraphs((t as string) ?? ""), {
		name: "paragraphs",
		initial: [] as readonly string[],
	});

	const currentParagraph = derived(
		[paragraphs, paragraphIdx],
		([ps, i]) => {
			const list = (ps as readonly string[]) ?? [];
			const idx = (i as number) ?? 0;
			return list[idx] ?? "";
		},
		{ name: "current-paragraph", initial: "" },
	);

	const extraction = promptNode<ExtractionResult>(
		adapter,
		[currentParagraph],
		(p) => buildUserPrompt((p as string) ?? ""),
		{
			name: "extraction",
			format: "json",
			systemPrompt: EXTRACTION_SYSTEM_PROMPT,
			temperature: 0.2,
		},
	);

	const applyExtraction = effect(
		[extraction],
		([result]) => {
			const r = result as ExtractionResult | null;
			if (!r) return;
			applyExtractionToKG(kg, r);
		},
		{ name: "apply-extraction" },
	);

	// Mount the upstream pipeline onto the kg Graph so demo-shell's
	// `graph/mermaid` shows the WHOLE causal chain, not just the KG nodes.
	kg.add("paper-text", paperText);
	kg.add("paragraph-idx", paragraphIdx);
	kg.add("paragraphs", paragraphs);
	kg.add("current-paragraph", currentParagraph);
	kg.add("extraction", extraction);
	kg.add("apply-extraction", applyExtraction);

	// Keep the lazy chain warm: subscribe to the terminal effect so each push
	// from `paper-text` actually walks the topology. The effect's dep on
	// `extraction` activates `extraction` upstream automatically per
	// COMPOSITION-GUIDE §1 — no need to subscribe `extraction` separately.
	void applyExtraction.subscribe(() => undefined);

	const registry: NodeRegistry = new Map([
		["paper-text", { codeLine: 6, visualSelector: "[data-paper-text]" }],
		["paragraph-idx", { codeLine: 7, visualSelector: "[data-current-paragraph]" }],
		["paragraphs", { codeLine: 10, visualSelector: "[data-paper-text]" }],
		["current-paragraph", { codeLine: 12, visualSelector: "[data-current-paragraph]" }],
		["extraction", { codeLine: 18, visualSelector: "[data-kg-pane]" }],
		["apply-extraction", { codeLine: 33, visualSelector: "[data-kg-pane]" }],
		["entities", { codeLine: 33, visualSelector: "[data-kg-pane]" }],
		["edges", { codeLine: 33, visualSelector: "[data-kg-pane]" }],
		["adjacency", { codeLine: 33, visualSelector: "[data-kg-pane]" }],
	]);

	return {
		id: "reactive",
		graph: kg,
		kg,
		sourceCode: REACTIVE_SOURCE,
		registry,
		paperText,
		paragraphIdx,
		paragraphs,
		currentParagraph,
		extraction,
		setPaperText(text: string) {
			// Atomic — reset paragraph cursor so we don't index past the end of
			// a (potentially shorter) new paper. Without this, an external
			// caller hitting `setPaperText` directly would silently freeze the
			// pipeline at currentParagraph === "".
			batch(() => {
				kg.set("paper-text", text);
				kg.set("paragraph-idx", 0);
			});
		},
		setParagraphIdx(i: number) {
			kg.set("paragraph-idx", i);
		},
		advance() {
			const ps = (paragraphs.cache as readonly string[] | undefined) ?? [];
			const cur = (paragraphIdx.cache as number | undefined) ?? 0;
			if (ps.length === 0) return;
			kg.set("paragraph-idx", (cur + 1) % ps.length);
		},
		reset() {
			// Reset KG only — clears entities/edges but leaves the paragraph
			// cursor where the user left it. Two reasons:
			//   1. Re-extracting the same paragraph wouldn't fire promptNode
			//      anyway (currentParagraph value unchanged), so resetting idx
			//      to 0 would just confuse the "Extract next" button label.
			//   2. Users intuit "Reset KG" as "clear the graph", not "rewind
			//      the cursor". Advancing extracts the next paragraph as
			//      expected, repopulating from there.
			// Defensive `[...keys()]` copy — `removeEntity` mutates the same
			// Map we're iterating over.
			batch(() => {
				const ents = kg.resolve("entities").cache as ReadonlyMap<string, Entity> | undefined;
				if (ents) for (const id of [...ents.keys()]) kg.removeEntity(id);
			});
		},
	};
}
