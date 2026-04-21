import type { Graph } from "@graphrefly/graphrefly/graph";
import type { NodeRegistry } from "@graphrefly/graphrefly/patterns/demo-shell";
import type { ComponentType } from "react";

export type ChapterUIProps = {
	hoverTarget: { pane: string; id: string } | null;
	onHover: (target: { pane: "visual" | "graph" | "code"; id: string } | null) => void;
	onSelect: (path: string | null) => void;
};

export type ChapterResolved = {
	graph: Graph;
	sourceCode: string;
	registry: NodeRegistry;
};

export type Chapter = {
	id: string;
	label: string;
	tagline: string;
	UI: ComponentType<ChapterUIProps>;
	/**
	 * Lazy resolver — returns the chapter's graph + source-code + registry on
	 * first activation. Cached internally by each chapter's `getXChapter()`,
	 * so calling `resolve()` multiple times returns the same instance.
	 *
	 * Lazy construction means visiting only chapter 1 doesn't pay the cost
	 * of building chapters 2/3/4 (including their `promptNode`/`policyEnforcer`
	 * subgraphs) — and a probe failure in one chapter doesn't crash the others.
	 */
	resolve: () => ChapterResolved;
};
