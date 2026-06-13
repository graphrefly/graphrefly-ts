import { type Ctx, depLatest } from "../../../ctx/types.js";
import type { Graph } from "../../../graph/graph.js";
import type { Node } from "../../../node/node.js";
import {
	capabilityTextMeasurements,
	type Measurements,
	type SegmentAdapter,
	type TextMeasureCapability,
} from "../index.js";

/** Minimal caller-owned NodeCanvas-style 2D text context. */
export interface NodeCanvasTextContextLike {
	measureText(text: string): { readonly width: number };
	font: string;
}

/** Dependency-free NodeCanvas focused subpath options. */
export interface NodeCanvasTextMeasurementsOptions {
	readonly graph: Graph;
	readonly text: Node<string>;
	readonly font: Node<string>;
	readonly context: Node<NodeCanvasTextContextLike>;
	readonly segmentAdapter?: Node<SegmentAdapter>;
	readonly targetId?: string;
	readonly source?: string;
	readonly name?: string;
}

/**
 * NodeCanvas provider helper for caller-injected 2D contexts.
 *
 * This subpath does not import `canvas`; hosts create and own the native context.
 */
export function nodeCanvasTextMeasurements(
	opts: NodeCanvasTextMeasurementsOptions,
): Node<Measurements> {
	const targetId = opts.targetId ?? "text";
	const capability = opts.graph.node<TextMeasureCapability>(
		[opts.context],
		(ctx: Ctx) => {
			const context = depLatest(ctx, 0) as NodeCanvasTextContextLike;
			const value: TextMeasureCapability = {
				measureText(text: string, font: string): { readonly width: number } {
					const previousFont = context.font;
					context.font = font;
					try {
						return context.measureText(text);
					} finally {
						context.font = previousFont;
					}
				},
			};
			ctx.down([["DATA", value]]);
		},
		{
			name: opts.name
				? `${opts.name}:node-canvas-measure-capability`
				: `${targetId}-node-canvas-measure-capability`,
		},
	);
	return capabilityTextMeasurements({
		graph: opts.graph,
		text: opts.text,
		font: opts.font,
		capability,
		segmentAdapter: opts.segmentAdapter,
		targetId: opts.targetId,
		source: opts.source ?? "nodeCanvasTextMeasurements",
		name: opts.name,
	});
}
