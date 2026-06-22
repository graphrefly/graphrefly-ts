import type { Node } from "@graphrefly/ts/core";
import { graph, type StateNode } from "@graphrefly/ts/graph";
import {
	type BlockAdapters,
	blockMeasurementProvider,
	type ContentBlock,
	type FlowColumns,
	type FlowContainer,
	type MeasurementAdapter,
	type Measurements,
	type Obstacle,
	type ReactiveBlockLayoutBundle,
	type ReactiveFlowLayoutBundle,
	type ReactiveLayoutBundle,
	reactiveBlockLayout as reactiveBlockLayoutCore,
	reactiveFlowLayout as reactiveFlowLayoutCore,
	reactiveLayout as reactiveLayoutCore,
	textMeasurementProvider,
} from "@graphrefly/ts/solutions/reactive-layout";

export type DemoReactiveLayoutBundle = ReactiveLayoutBundle & {
	readonly input: ReactiveLayoutBundle["input"] & {
		readonly text: StateNode<string>;
		readonly font: StateNode<string>;
		readonly adapter: StateNode<MeasurementAdapter>;
	};
	setText(text: string): void;
	setFont(font: string): void;
};

export type DemoReactiveBlockLayoutBundle = ReactiveBlockLayoutBundle & {
	readonly input: ReactiveBlockLayoutBundle["input"] & {
		readonly blocks: StateNode<readonly ContentBlock[]>;
		readonly maxWidth: StateNode<number>;
		readonly adapters: StateNode<BlockAdapters>;
		readonly font: StateNode<string>;
		readonly lineHeight: StateNode<number>;
	};
	setBlocks(blocks: readonly ContentBlock[]): void;
	setMaxWidth(maxWidth: number): void;
	setFont(font: string): void;
	setLineHeight(lineHeight: number): void;
};

export type DemoReactiveFlowLayoutBundle = ReactiveFlowLayoutBundle & {
	readonly input: ReactiveFlowLayoutBundle["input"] & {
		readonly text: StateNode<string>;
		readonly font: StateNode<string>;
		readonly adapter: StateNode<MeasurementAdapter>;
	};
	setText(text: string): void;
	setFont(font: string): void;
};

export interface DemoReactiveLayoutOptions {
	readonly adapter: MeasurementAdapter;
	readonly name: string;
	readonly text: string;
	readonly font: string;
	readonly lineHeight: number;
	readonly maxWidth: number;
}

export interface DemoReactiveBlockLayoutOptions {
	readonly adapters: BlockAdapters;
	readonly name: string;
	readonly blocks: readonly ContentBlock[];
	readonly maxWidth: number;
	readonly gap: number;
	readonly defaultFont: string;
	readonly defaultLineHeight: number;
}

export interface DemoReactiveFlowLayoutOptions {
	readonly adapter: MeasurementAdapter;
	readonly name: string;
	readonly text: string;
	readonly font: string;
	readonly lineHeight: number;
	readonly container: FlowContainer;
	readonly columns: FlowColumns;
	readonly obstacles: readonly Obstacle[];
	readonly minSlotWidth: number;
}

function scopedName(scope: string, local: string): string {
	return `${scope}:${local}`;
}

function textMeasurements(
	g: ReturnType<typeof graph>,
	name: string,
	text: Node<string>,
	font: Node<string>,
	adapter: Node<MeasurementAdapter>,
): Node<Measurements> {
	return textMeasurementProvider({
		graph: g,
		text,
		font,
		adapter,
		name: scopedName(name, "measurements"),
	});
}

export function createDemoReactiveLayout(
	opts: DemoReactiveLayoutOptions,
): DemoReactiveLayoutBundle {
	const g = graph({ name: opts.name });
	const text = g.state(opts.text, { name: "text" });
	const font = g.state(opts.font, { name: "font" });
	const adapter = g.state(opts.adapter, { name: "adapter" });
	const measurements = textMeasurements(g, opts.name, text, font, adapter);
	const bundle = reactiveLayoutCore({
		graph: g,
		measurements,
		name: opts.name,
		lineHeight: opts.lineHeight,
		maxWidth: opts.maxWidth,
	});
	return {
		...bundle,
		input: { ...bundle.input, text, font, adapter },
		setText: (next) => text.set(next),
		setFont: (next) => font.set(next),
	};
}

export function createDemoReactiveBlockLayout(
	opts: DemoReactiveBlockLayoutOptions,
): DemoReactiveBlockLayoutBundle {
	const g = graph({ name: opts.name });
	const blocks = g.state(opts.blocks, { name: "blocks" });
	const maxWidth = g.state(opts.maxWidth, { name: "max-width" });
	const adapters = g.state(opts.adapters, { name: "adapters" });
	const font = g.state(opts.defaultFont, { name: "font" });
	const lineHeight = g.state(opts.defaultLineHeight, { name: "line-height" });
	const measurements = blockMeasurementProvider({
		graph: g,
		blocks,
		maxWidth,
		adapters,
		font,
		lineHeight,
		name: scopedName(opts.name, "measurements"),
	});
	const bundle = reactiveBlockLayoutCore({
		graph: g,
		measurements,
		name: opts.name,
		gap: opts.gap,
	});
	return {
		...bundle,
		input: { ...bundle.input, blocks, maxWidth, adapters, font, lineHeight },
		setBlocks: (next) => blocks.set(next),
		setMaxWidth: (next) => maxWidth.set(next),
		setFont: (next) => font.set(next),
		setLineHeight: (next) => lineHeight.set(next),
	};
}

export function createDemoReactiveFlowLayout(
	opts: DemoReactiveFlowLayoutOptions,
): DemoReactiveFlowLayoutBundle {
	const g = graph({ name: opts.name });
	const text = g.state(opts.text, { name: "text" });
	const font = g.state(opts.font, { name: "font" });
	const adapter = g.state(opts.adapter, { name: "adapter" });
	const measurements = textMeasurements(g, opts.name, text, font, adapter);
	const bundle = reactiveFlowLayoutCore({
		graph: g,
		measurements,
		name: opts.name,
		lineHeight: opts.lineHeight,
		container: opts.container,
		columns: opts.columns,
		obstacles: opts.obstacles,
		minSlotWidth: opts.minSlotWidth,
	});
	return {
		...bundle,
		input: { ...bundle.input, text, font, adapter },
		setText: (next) => text.set(next),
		setFont: (next) => font.set(next),
	};
}
