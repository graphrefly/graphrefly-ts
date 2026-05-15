import type { Graph } from "@graphrefly/graphrefly";
import type { HoverTarget, NodeRegistry } from "@graphrefly/graphrefly/utils/demo-shell";
import type { ComponentType } from "react";

/**
 * Props pair for any element that should light up a node-registry entry on
 * hover. Paired enter/leave handlers ensure the shell's `hover/target`
 * goes back to `null` when the pointer leaves — otherwise the previous
 * highlight would persist indefinitely until another hoverable element is
 * entered, which users perceive as "the batch column still highlights when
 * I hover the no-batch column".
 */
export function hoverProps(
	onHover: (t: HoverTarget) => void,
	id: string,
): { onMouseEnter: () => void; onMouseLeave: () => void } {
	return {
		onMouseEnter: () => onHover({ pane: "visual", id }),
		onMouseLeave: () => onHover(null),
	};
}

/** Props every chapter UI receives. */
export type ChapterProps = {
	hoverTarget: HoverTarget;
	onHover: (t: HoverTarget) => void;
	onSelect: (path: string | null) => void;
};

/**
 * A chapter is one side of the argument. It owns:
 *
 * - `graph` — the reactive-layout graph the side panes observe (mermaid + inspect)
 * - `sourceCode` — literal source of the builder (the teaching surface)
 * - `registry` — node path → (code-line, visual selector) for cross-highlighting
 * - `UI` — React component rendered in the main pane
 */
export type Chapter = {
	id: string;
	label: string;
	tagline: string;
	graph: Graph;
	sourceCode: string;
	registry: NodeRegistry;
	UI: ComponentType<ChapterProps>;
};
