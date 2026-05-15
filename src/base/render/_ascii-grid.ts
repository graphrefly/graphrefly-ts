/**
 * Character-grid blitter for the ASCII describe renderer.
 *
 * Given a [LayoutResult](./_layout-sugiyama.ts) (boxes + polyline edges on
 * an integer cell grid), produce a newline-joined string using Unicode
 * box-drawing glyphs (or plain ASCII when `charset: "ascii"` is requested).
 *
 * Invariants:
 *   - Multi-cell CJK labels still count as 2 cells via
 *     [_ascii-width.ts](./_ascii-width.ts).
 *   - Edge crossings (two segments perpendicular at the same cell) collapse
 *     to `┼` / `+`. Corner-vs-line collisions resolve to a corner glyph.
 *   - Boxes overwrite edge glyphs — boxes are blitted last so an edge that
 *     happens to pass under a box body is hidden.
 */

import { countCells } from "./_ascii-width.js";
import type { LayoutBox, LayoutEdge, LayoutResult } from "./_layout-sugiyama.js";

export type AsciiCharset = "unicode" | "ascii";

export type GridOptions = {
	readonly charset: AsciiCharset;
	readonly labelOf: (id: string) => string;
};

type Glyphs = {
	readonly horizontal: string;
	readonly vertical: string;
	readonly cornerTL: string;
	readonly cornerTR: string;
	readonly cornerBL: string;
	readonly cornerBR: string;
	readonly tDown: string;
	readonly tUp: string;
	readonly tRight: string;
	readonly tLeft: string;
	readonly cross: string;
	readonly arrowRight: string;
	readonly arrowDown: string;
	readonly arrowLeft: string;
	readonly arrowUp: string;
	readonly boxTL: string;
	readonly boxTR: string;
	readonly boxBL: string;
	readonly boxBR: string;
	readonly boxH: string;
	readonly boxV: string;
};

const UNICODE: Glyphs = {
	horizontal: "─",
	vertical: "│",
	cornerTL: "┌",
	cornerTR: "┐",
	cornerBL: "└",
	cornerBR: "┘",
	tDown: "┬",
	tUp: "┴",
	tRight: "├",
	tLeft: "┤",
	cross: "┼",
	arrowRight: "▶",
	arrowDown: "▼",
	arrowLeft: "◀",
	arrowUp: "▲",
	boxTL: "┌",
	boxTR: "┐",
	boxBL: "└",
	boxBR: "┘",
	boxH: "─",
	boxV: "│",
};

const ASCII: Glyphs = {
	horizontal: "-",
	vertical: "|",
	cornerTL: "+",
	cornerTR: "+",
	cornerBL: "+",
	cornerBR: "+",
	tDown: "+",
	tUp: "+",
	tRight: "+",
	tLeft: "+",
	cross: "+",
	arrowRight: ">",
	arrowDown: "v",
	arrowLeft: "<",
	arrowUp: "^",
	boxTL: "+",
	boxTR: "+",
	boxBL: "+",
	boxBR: "+",
	boxH: "-",
	boxV: "|",
};

// Set of glyphs considered "edge lines" when resolving collisions. A later
// put() into an edge cell that conflicts produces `cross`; corners and
// T-junctions are preserved (they carry more information).
type CellKind =
	| "empty"
	| "boxH"
	| "boxV"
	| "boxCorner"
	| "edgeH"
	| "edgeV"
	| "edgeCorner"
	| "arrow"
	| "label";

export function renderGrid(layout: LayoutResult, options: GridOptions): string {
	const glyphs = options.charset === "ascii" ? ASCII : UNICODE;
	const width = layout.width;
	const height = layout.height;
	const grid: string[][] = Array.from({ length: height }, () =>
		Array.from({ length: width }, () => " "),
	);
	const kind: CellKind[][] = Array.from({ length: height }, () =>
		Array.from({ length: width }, () => "empty" as CellKind),
	);

	// 1. Draw edges first (boxes overwrite).
	for (const edge of layout.edges) {
		drawEdge(grid, kind, glyphs, edge);
	}

	// 2. Draw boxes on top.
	for (const box of layout.boxes) {
		drawBox(grid, kind, glyphs, box, options.labelOf(box.id));
	}

	return grid.map((row) => stripTrailing(row.join(""))).join("\n");
}

// ---------------------------------------------------------------------------
// Box drawing
// ---------------------------------------------------------------------------

function drawBox(
	grid: string[][],
	kind: CellKind[][],
	glyphs: Glyphs,
	box: LayoutBox,
	label: string,
): void {
	const { x, y, w, h } = box;
	if (w < 2 || h < 2) {
		// Degenerate — just paint the label.
		if (h > 0) writeLabel(grid, kind, x, y, w, label);
		return;
	}
	// Top border
	putBoxCell(grid, kind, x, y, glyphs.boxTL);
	for (let cx = x + 1; cx < x + w - 1; cx += 1) putBoxCell(grid, kind, cx, y, glyphs.boxH);
	putBoxCell(grid, kind, x + w - 1, y, glyphs.boxTR);
	// Middle rows — side borders + content (only middle row carries the label)
	for (let cy = y + 1; cy < y + h - 1; cy += 1) {
		putBoxCell(grid, kind, x, cy, glyphs.boxV);
		for (let cx = x + 1; cx < x + w - 1; cx += 1) {
			putBoxCellAs(grid, kind, cx, cy, " ", "empty");
		}
		putBoxCell(grid, kind, x + w - 1, cy, glyphs.boxV);
	}
	// Bottom border
	putBoxCell(grid, kind, x, y + h - 1, glyphs.boxBL);
	for (let cx = x + 1; cx < x + w - 1; cx += 1) putBoxCell(grid, kind, cx, y + h - 1, glyphs.boxH);
	putBoxCell(grid, kind, x + w - 1, y + h - 1, glyphs.boxBR);
	// Label in vertical middle (h >= 3 expected)
	const midY = y + Math.floor(h / 2);
	writeLabel(grid, kind, x + 1, midY, w - 2, label);
}

function putBoxCell(
	grid: string[][],
	kind: CellKind[][],
	x: number,
	y: number,
	glyph: string,
): void {
	const k: CellKind =
		glyph === " "
			? "empty"
			: glyph === "─" || glyph === "-"
				? "boxH"
				: glyph === "│" || glyph === "|"
					? "boxV"
					: "boxCorner";
	putBoxCellAs(grid, kind, x, y, glyph, k);
}

function putBoxCellAs(
	grid: string[][],
	kind: CellKind[][],
	x: number,
	y: number,
	glyph: string,
	k: CellKind,
): void {
	if (y < 0 || y >= grid.length) return;
	const row = grid[y]!;
	if (x < 0 || x >= row.length) return;
	row[x] = glyph;
	kind[y]![x] = k;
}

function writeLabel(
	grid: string[][],
	kind: CellKind[][],
	x: number,
	y: number,
	maxWidthCells: number,
	label: string,
): void {
	// The grid is cell-indexed (one array slot per terminal cell). Wide
	// characters (CJK, fullwidth) occupy TWO cells visually; we store the
	// char in the first slot and an empty string in the second slot so
	// join("") collapses to a single visible wide glyph and neighboring
	// writes don't add spurious narrow spaces next to the wide char.
	if (y < 0 || y >= grid.length) return;
	let cursor = x;
	let cellsLeft = maxWidthCells;
	for (const ch of label) {
		const cw = countCells(ch);
		if (cw === 0) continue;
		if (cellsLeft < cw) break;
		if (cursor >= 0 && cursor < grid[y]!.length) {
			grid[y]![cursor] = ch;
			kind[y]![cursor] = "label";
			if (cw === 2 && cursor + 1 < grid[y]!.length) {
				grid[y]![cursor + 1] = "";
				kind[y]![cursor + 1] = "label";
			}
		}
		cursor += cw;
		cellsLeft -= cw;
	}
	// Pad remaining cells with spaces so any edge glyphs lurking under the
	// box body don't leak into the label row.
	while (cellsLeft > 0) {
		if (cursor >= 0 && cursor < grid[y]!.length) {
			grid[y]![cursor] = " ";
			kind[y]![cursor] = "empty";
		}
		cursor += 1;
		cellsLeft -= 1;
	}
}

// ---------------------------------------------------------------------------
// Edge drawing
// ---------------------------------------------------------------------------

function drawEdge(grid: string[][], kind: CellKind[][], glyphs: Glyphs, edge: LayoutEdge): void {
	const pts = edge.points;
	if (pts.length < 2) return;
	// Draw segments
	for (let i = 0; i + 1 < pts.length; i += 1) {
		drawSegment(grid, kind, glyphs, pts[i]!, pts[i + 1]!);
	}
	// Draw corners at interior points
	for (let i = 1; i + 1 < pts.length; i += 1) {
		const a = pts[i - 1]!;
		const b = pts[i]!;
		const c = pts[i + 1]!;
		const corner = cornerGlyph(a, b, c, glyphs);
		if (corner) putEdgeCell(grid, kind, b.x, b.y, corner, "edgeCorner");
	}
	// Arrow tip at the final point, aimed from the penultimate point.
	// Four cardinal directions — covers backward and upward tips produced
	// by routing past virtual nodes or dense-gutter fallbacks.
	const tip = pts[pts.length - 1]!;
	const prev = pts[pts.length - 2]!;
	const arrow = arrowGlyph(prev, tip, glyphs);
	if (arrow) putEdgeCell(grid, kind, tip.x, tip.y, arrow, "arrow");
}

function drawSegment(
	grid: string[][],
	kind: CellKind[][],
	glyphs: Glyphs,
	a: { x: number; y: number },
	b: { x: number; y: number },
): void {
	if (a.x === b.x && a.y === b.y) return;
	if (a.y === b.y) {
		// Horizontal
		const y = a.y;
		const x0 = Math.min(a.x, b.x);
		const x1 = Math.max(a.x, b.x);
		for (let x = x0; x <= x1; x += 1) {
			putEdgeLine(grid, kind, x, y, glyphs, "h");
		}
	} else if (a.x === b.x) {
		// Vertical
		const x = a.x;
		const y0 = Math.min(a.y, b.y);
		const y1 = Math.max(a.y, b.y);
		for (let y = y0; y <= y1; y += 1) {
			putEdgeLine(grid, kind, x, y, glyphs, "v");
		}
	}
	// Diagonal shouldn't happen — routing is orthogonal.
}

function putEdgeLine(
	grid: string[][],
	kind: CellKind[][],
	x: number,
	y: number,
	glyphs: Glyphs,
	orientation: "h" | "v",
): void {
	if (y < 0 || y >= grid.length) return;
	const row = grid[y]!;
	if (x < 0 || x >= row.length) return;
	const existing = kind[y]![x];
	if (
		existing === "boxH" ||
		existing === "boxV" ||
		existing === "boxCorner" ||
		existing === "label"
	) {
		// Box wins — do nothing. Boxes are drawn after edges, but if order
		// is reversed the edge must not clobber the box.
		return;
	}
	if (existing === "empty") {
		row[x] = orientation === "h" ? glyphs.horizontal : glyphs.vertical;
		kind[y]![x] = orientation === "h" ? "edgeH" : "edgeV";
		return;
	}
	if (existing === "edgeH" && orientation === "v") {
		row[x] = glyphs.cross;
		kind[y]![x] = "edgeCorner";
		return;
	}
	if (existing === "edgeV" && orientation === "h") {
		row[x] = glyphs.cross;
		kind[y]![x] = "edgeCorner";
		return;
	}
	// Same-orientation overlay: keep existing glyph.
}

function putEdgeCell(
	grid: string[][],
	kind: CellKind[][],
	x: number,
	y: number,
	glyph: string,
	k: CellKind,
): void {
	if (y < 0 || y >= grid.length) return;
	const row = grid[y]!;
	if (x < 0 || x >= row.length) return;
	const existing = kind[y]![x];
	if (
		existing === "boxH" ||
		existing === "boxV" ||
		existing === "boxCorner" ||
		existing === "label"
	)
		return;
	row[x] = glyph;
	kind[y]![x] = k;
}

// ---------------------------------------------------------------------------
// Corner + arrow glyph selection
// ---------------------------------------------------------------------------

function cornerGlyph(
	a: { x: number; y: number },
	b: { x: number; y: number },
	c: { x: number; y: number },
	glyphs: Glyphs,
): string | undefined {
	const inHoriz = a.y === b.y;
	const outHoriz = b.y === c.y;
	if (inHoriz === outHoriz) return undefined; // not a turn
	// In from horizontal, out to vertical (or vice versa). Figure out which
	// of the four corners we're at.
	if (inHoriz) {
		// Coming from the left (a.x < b.x) or right (a.x > b.x)
		const fromLeft = a.x < b.x;
		const goingDown = c.y > b.y;
		if (fromLeft && goingDown) return glyphs.cornerTR;
		if (fromLeft && !goingDown) return glyphs.cornerBR;
		if (!fromLeft && goingDown) return glyphs.cornerTL;
		return glyphs.cornerBL;
	}
	// Vertical in, horizontal out
	const fromAbove = a.y < b.y;
	const goingRight = c.x > b.x;
	if (fromAbove && goingRight) return glyphs.cornerBL;
	if (fromAbove && !goingRight) return glyphs.cornerBR;
	if (!fromAbove && goingRight) return glyphs.cornerTL;
	return glyphs.cornerTR;
}

function arrowGlyph(
	prev: { x: number; y: number },
	tip: { x: number; y: number },
	glyphs: Glyphs,
): string | undefined {
	if (tip.x > prev.x) return glyphs.arrowRight;
	if (tip.x < prev.x) return glyphs.arrowLeft;
	if (tip.y > prev.y) return glyphs.arrowDown;
	if (tip.y < prev.y) return glyphs.arrowUp;
	return undefined; // zero-length segment — no tip
}

// ---------------------------------------------------------------------------
// Output trimming
// ---------------------------------------------------------------------------

function stripTrailing(line: string): string {
	// Trim trailing spaces only; preserve internal grid alignment.
	let end = line.length;
	while (end > 0 && line.charCodeAt(end - 1) === 32) end -= 1;
	return line.slice(0, end);
}
