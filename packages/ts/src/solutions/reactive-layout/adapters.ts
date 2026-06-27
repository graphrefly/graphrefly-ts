import { isCJK, measuredWidth, metricKey } from "./segment.js";
import type {
	CellMeasureAdapterOptions,
	ImageMeasurer,
	ImageSizeLookup,
	InjectedMeasureAdapterOptions,
	MeasureFn,
	MeasurementAdapter,
	PrecomputedMeasureAdapterOptions,
	Size,
	SvgMeasurer,
	TextMeasureCapability,
} from "./types.js";
import { nonNegativeFinite } from "./utils.js";

/** Adapter that wraps a caller-owned synchronous measurement function. */
export class InjectedMeasureAdapter implements MeasurementAdapter {
	private readonly measure: MeasureFn;
	private readonly shouldCache: boolean;
	private readonly cache = new Map<string, number>();

	constructor(measure: MeasureFn, opts: InjectedMeasureAdapterOptions = {}) {
		this.measure = measure;
		this.shouldCache = opts.cache ?? true;
	}

	measureSegment(text: string, font: string): { readonly width: number } {
		const key = metricKey(text, font);
		if (this.shouldCache) {
			const cached = this.cache.get(key);
			if (cached !== undefined) return { width: cached };
		}
		const width = measuredWidth(this.measure(text, font));
		if (this.shouldCache) this.cache.set(key, width);
		return { width };
	}

	clearCache(): void {
		this.cache.clear();
	}
}

/** Deterministic adapter backed by caller-supplied width metrics. */
export class PrecomputedMeasureAdapter implements MeasurementAdapter {
	private readonly metrics: ReadonlyMap<string, number>;
	private readonly fallback: "per-char" | "error";
	private readonly cellWidth: number;

	constructor(opts: PrecomputedMeasureAdapterOptions) {
		this.metrics =
			opts.metrics instanceof Map ? opts.metrics : new Map(Object.entries(opts.metrics));
		this.fallback = opts.fallback ?? "error";
		this.cellWidth = nonNegativeFinite(opts.cellWidth ?? 8, 8);
	}

	measureSegment(text: string, font: string): { readonly width: number } {
		const fontScoped = this.metrics.get(metricKey(text, font));
		if (fontScoped !== undefined) return { width: nonNegativeFinite(fontScoped, 0) };
		const unscoped = this.metrics.get(text);
		if (unscoped !== undefined) return { width: nonNegativeFinite(unscoped, 0) };
		if (this.fallback === "per-char") {
			return { width: Array.from(text).length * this.cellWidth };
		}
		throw new Error(`No precomputed metric for segment ${JSON.stringify(text)}`);
	}
}

/** Fixed-cell adapter for CLI, snapshots, and tests. */
export class CellMeasureAdapter implements MeasurementAdapter {
	private readonly cellWidth: number;
	private readonly wideCellWidth: number;
	private readonly tabCells: number;

	constructor(opts: CellMeasureAdapterOptions = {}) {
		this.cellWidth = nonNegativeFinite(opts.cellWidth ?? 8, 8);
		this.wideCellWidth = nonNegativeFinite(
			opts.wideCellWidth ?? this.cellWidth * 2,
			this.cellWidth * 2,
		);
		this.tabCells = Math.max(1, Math.floor(nonNegativeFinite(opts.tabCells ?? 4, 4)));
	}

	measureSegment(text: string): { readonly width: number } {
		let width = 0;
		for (const char of text) {
			if (char === "\t") width += this.cellWidth * this.tabCells;
			else width += isCJK(char) ? this.wideCellWidth : this.cellWidth;
		}
		return { width };
	}
}

/** Adapter over a caller-owned platform capability such as NodeCanvas, Skia, or RN text APIs. */
export class CapabilityMeasureAdapter implements MeasurementAdapter {
	private readonly capability: TextMeasureCapability;

	constructor(capability: TextMeasureCapability) {
		this.capability = capability;
	}

	measureSegment(text: string, font: string): { readonly width: number } {
		return { width: measuredWidth(this.capability.measureText(text, font)) };
	}

	clearCache(): void {
		this.capability.clearCache?.();
	}
}

function stripSvgIgnoredContent(svg: string): string {
	return svg.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
}

function readSvgRootTag(svg: string): string | null {
	return /<svg\b[^>]*>/i.exec(svg)?.[0] ?? null;
}

function readNumericAttr(tag: string, attr: string): number | null {
	const pattern = new RegExp(`(?:^|\\s)${attr}\\s*=\\s*["']?(-?\\d+(?:\\.\\d+)?)`, "i");
	const match = pattern.exec(tag);
	if (!match) return null;
	const value = Number(match[1]);
	return Number.isFinite(value) && value >= 0 ? value : null;
}

function readViewBox(tag: string): Size | null {
	const match =
		/\bviewBox\s*=\s*["']\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*["']/i.exec(
			tag,
		);
	if (!match) return null;
	const width = Number(match[3]);
	const height = Number(match[4]);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
		return null;
	}
	return { width, height };
}

/**
 * Minimal string-based SVG bounds reader for explicit width/height or viewBox.
 *
 * This is not a DOM SVG parser and does not resolve external resources.
 */
export class SvgBoundsAdapter implements SvgMeasurer {
	measureSvg(svg: string): Size {
		const cleaned = stripSvgIgnoredContent(svg);
		const rootTag = readSvgRootTag(cleaned);
		if (rootTag === null) throw new Error("Cannot measure SVG without a root <svg> element");
		const width = readNumericAttr(rootTag, "width");
		const height = readNumericAttr(rootTag, "height");
		if (width !== null && height !== null) return { width, height };
		const viewBox = readViewBox(rootTag);
		if (viewBox) return viewBox;
		throw new Error("Cannot measure SVG without width/height or viewBox");
	}
}

/** Image measurer backed by explicit caller-provided dimensions; it never loads images. */
export class ImageSizeAdapter implements ImageMeasurer {
	private readonly sizes: ImageSizeLookup;

	constructor(sizes: ImageSizeLookup | Record<string, Size>) {
		this.sizes = isImageSizeLookup(sizes) ? sizes : new Map(Object.entries(sizes));
	}

	measureImage(src: string): Size {
		const size = this.sizes.get(src);
		if (!size) throw new Error(`No image size registered for ${JSON.stringify(src)}`);
		return size;
	}
}

function isImageSizeLookup(value: unknown): value is ImageSizeLookup {
	if (value === null) return false;
	const valueType = typeof value;
	if (valueType !== "object" && valueType !== "function") return false;
	return typeof (value as { readonly get?: unknown }).get === "function";
}
