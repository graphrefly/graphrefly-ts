import { createRequire } from "node:module";
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

export interface NodeCanvasLike {
	getContext(type: "2d"): NodeCanvasTextContextLike | null;
}

export interface NodeCanvasPackageLike {
	createCanvas(width: number, height: number): NodeCanvasLike;
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

/** Optional-peer NodeCanvas focused subpath options. */
export interface NodeCanvasPackageTextMeasurementsOptions
	extends Omit<NodeCanvasTextMeasurementsOptions, "context"> {
	readonly canvas?: NodeCanvasPackageLike;
	readonly width?: number;
	readonly height?: number;
}

const requireOptionalPeer = createRequire(`${process.cwd()}/package.json`);

function loadCanvasPackage(): NodeCanvasPackageLike {
	const errors: unknown[] = [];
	if (typeof require === "function") {
		try {
			return require("canvas") as NodeCanvasPackageLike;
		} catch (error) {
			errors.push(error);
		}
	}
	try {
		return requireOptionalPeer("canvas") as NodeCanvasPackageLike;
	} catch (error) {
		errors.push(error);
		throw new TypeError(
			"nodeCanvasPackageTextMeasurements requires optional peer dependency 'canvas'. Install canvas, pass { canvas }, or use nodeCanvasTextMeasurements({ context }) with a caller-owned 2D context.",
			{ cause: errors.at(-1) },
		);
	}
}

class NodeCanvasPackageTextCapability implements TextMeasureCapability {
	private readonly canvasPackage?: NodeCanvasPackageLike;
	private readonly width: number;
	private readonly height: number;
	private context: NodeCanvasTextContextLike | null = null;

	constructor(opts: {
		readonly canvas?: NodeCanvasPackageLike;
		readonly width: number;
		readonly height: number;
	}) {
		this.canvasPackage = opts.canvas;
		this.width = opts.width;
		this.height = opts.height;
	}

	private getContext(): NodeCanvasTextContextLike {
		if (this.context !== null) return this.context;
		const canvas = (this.canvasPackage ?? loadCanvasPackage()).createCanvas(
			this.width,
			this.height,
		);
		const context = canvas.getContext("2d");
		if (context === null) {
			throw new TypeError("nodeCanvasPackageTextMeasurements: failed to create a 2D context");
		}
		this.context = context;
		return context;
	}

	measureText(text: string, font: string): { readonly width: number } {
		const context = this.getContext();
		const previousFont = context.font;
		context.font = font;
		try {
			return context.measureText(text);
		} finally {
			context.font = previousFont;
		}
	}
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

/**
 * NodeCanvas provider helper backed by the optional `canvas` peer package.
 *
 * The native package is loaded only when the graph measures; the universal layout core and
 * caller-injected `nodeCanvasTextMeasurements` helper remain dependency-free.
 */
export function nodeCanvasPackageTextMeasurements(
	opts: NodeCanvasPackageTextMeasurementsOptions,
): Node<Measurements> {
	const targetId = opts.targetId ?? "text";
	const capability = opts.graph.state<TextMeasureCapability>(
		new NodeCanvasPackageTextCapability({
			canvas: opts.canvas,
			width: opts.width ?? 0,
			height: opts.height ?? 0,
		}),
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
		source: opts.source ?? "nodeCanvasPackageTextMeasurements",
		name: opts.name,
	});
}
