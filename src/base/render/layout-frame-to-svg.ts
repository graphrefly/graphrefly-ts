/**
 * `layoutFrameToSvg(frame, opts?)` — render a {@link LayoutFrame} as an SVG
 * markup string.
 *
 * Universal-safe — emits a string, not a DOM tree. Browser code embeds via
 * `el.innerHTML = svg`; Node code writes to a file. Cell-grid coordinates from
 * the layout are scaled by `cellWidth` / `cellHeight` (default 12 × 18 px,
 * roughly matching a monospace baseline).
 *
 * Each box gets `data-id="<path>"` for change-event highlighting; each edge
 * gets `data-from="<from>" data-to="<to>"` so renderers can animate flowing
 * data per `LayoutFrame.changes`.
 *
 * @category extra
 */

import type { LayoutFrame } from "./layout-types.js";

export interface LayoutFrameToSvgOptions {
	/** Pixel width of one cell. Default: `12`. */
	readonly cellWidth?: number;
	/** Pixel height of one cell. Default: `18`. */
	readonly cellHeight?: number;
	/** Outer margin in pixels. Default: `16`. */
	readonly padding?: number;
	/** Box stroke color. Default: `"#444"`. */
	readonly boxStroke?: string;
	/** Box fill color. Default: `"#fff"`. */
	readonly boxFill?: string;
	/** Edge stroke color. Default: `"#888"`. */
	readonly edgeStroke?: string;
	/** Box label text color. Default: `"#111"`. */
	readonly textColor?: string;
	/** Font family. Default: `"ui-monospace, monospace"`. */
	readonly fontFamily?: string;
	/** Font size in pixels. Default: `12`. */
	readonly fontSize?: number;
}

const SPECIAL_CHARS: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&apos;",
};

function escapeXml(s: string): string {
	return s.replace(/[&<>"']/g, (c) => SPECIAL_CHARS[c] ?? c);
}

/**
 * Render a {@link LayoutFrame} to SVG markup. Pure function — call from
 * `derived` to drive a live `<svg>` element from a `topologyView` output.
 */
export function layoutFrameToSvg(frame: LayoutFrame, opts?: LayoutFrameToSvgOptions): string {
	const cellW = opts?.cellWidth ?? 12;
	const cellH = opts?.cellHeight ?? 18;
	const pad = opts?.padding ?? 16;
	// /qa F-10: route option-bag string attributes through escapeXml so that
	// user-supplied themes (URL params, dashboard config, etc.) cannot inject
	// `"/><script>...` and break out of the attribute. Numeric `fontSize` has
	// no XSS surface; escape only when caller passes a string.
	const boxStroke = escapeXml(opts?.boxStroke ?? "#444");
	const boxFill = escapeXml(opts?.boxFill ?? "#fff");
	const edgeStroke = escapeXml(opts?.edgeStroke ?? "#888");
	const textColor = escapeXml(opts?.textColor ?? "#111");
	const fontFamily = opts?.fontFamily ?? "ui-monospace, monospace";
	const fontSize = opts?.fontSize ?? 12;

	let maxX = 0;
	let maxY = 0;
	for (const b of frame.boxes) {
		maxX = Math.max(maxX, b.x + b.w);
		maxY = Math.max(maxY, b.y + b.h);
	}
	for (const e of frame.edges) {
		for (const [x, y] of e.points) {
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
	}
	const width = Math.max(1, maxX) * cellW + pad * 2;
	const height = Math.max(1, maxY) * cellH + pad * 2;

	const lines: string[] = [];
	lines.push(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
	);

	// Edges first (so boxes overlay them at endpoints).
	for (const e of frame.edges) {
		if (e.points.length < 2) continue;
		const pts = e.points.map(([x, y]) => `${x * cellW + pad},${y * cellH + pad}`).join(" ");
		lines.push(
			`  <polyline points="${pts}" fill="none" stroke="${edgeStroke}" stroke-width="1" data-from="${escapeXml(e.from)}" data-to="${escapeXml(e.to)}" data-dep-index="${e.depIndex}" />`,
		);
	}

	// Boxes.
	for (const b of frame.boxes) {
		const px = b.x * cellW + pad;
		const py = b.y * cellH + pad;
		const pw = Math.max(1, b.w) * cellW;
		const ph = Math.max(1, b.h) * cellH;
		// Local segment for label so deeply-mounted nodes stay readable.
		const local = b.id.includes("::") ? (b.id.split("::").pop() ?? b.id) : b.id;
		lines.push(
			`  <g data-id="${escapeXml(b.id)}">`,
			`    <rect x="${px}" y="${py}" width="${pw}" height="${ph}" fill="${boxFill}" stroke="${boxStroke}" stroke-width="1" />`,
			`    <text x="${px + pw / 2}" y="${py + ph / 2}" fill="${textColor}" font-family="${escapeXml(fontFamily)}" font-size="${fontSize}" text-anchor="middle" dominant-baseline="central">${escapeXml(local)}</text>`,
			`  </g>`,
		);
	}

	lines.push("</svg>");
	return lines.join("\n");
}
