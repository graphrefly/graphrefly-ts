import mermaid from "mermaid";
import {
	createNextMermaidId,
	initMermaidRenderer,
	MERMAID_NODE_STROKE_DEFAULT,
	MERMAID_NODE_STROKE_MATCH,
	MERMAID_THEME_VARIABLES,
} from "../../../shared/lib/mermaid-theme";

export { MERMAID_NODE_STROKE_DEFAULT, MERMAID_NODE_STROKE_MATCH, MERMAID_THEME_VARIABLES };

export function initMermaid(): void {
	initMermaidRenderer(mermaid as Parameters<typeof initMermaidRenderer>[0]);
}

export const nextMermaidId = createNextMermaidId("reactive-layout");

export { mermaid };
