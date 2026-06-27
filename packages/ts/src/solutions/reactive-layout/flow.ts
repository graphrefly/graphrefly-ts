import { carveTextLineSlots, layoutNextLine } from "./line.js";
import { getDefaultSegmentAdapter } from "./segment.js";
import type {
	CircleObstacle,
	ComputeFlowLinesOptions,
	FlowColumns,
	FlowContainer,
	FlowLinesResult,
	Interval,
	LayoutCursor,
	Obstacle,
	PositionedLine,
	PreparedSegment,
	RectObstacle,
} from "./types.js";
import { finiteNumber, nonNegativeFinite, positiveFinite } from "./utils.js";

export function columnGeometry(
	container: FlowContainer,
	columns: FlowColumns | undefined,
): {
	readonly paddingX: number;
	readonly paddingY: number;
	readonly count: number;
	readonly gap: number;
	readonly width: number;
	readonly height: number;
	readonly columnWidth: number;
} {
	const paddingX = nonNegativeFinite(container.paddingX ?? 0, 0);
	const paddingY = nonNegativeFinite(container.paddingY ?? 0, 0);
	const count = Math.max(1, Math.floor(nonNegativeFinite(columns?.count ?? 1, 1)));
	const gap = nonNegativeFinite(columns?.gap ?? 0, 0);
	const width = nonNegativeFinite(container.width, 0);
	const height = nonNegativeFinite(container.height, 0);
	const innerWidth = Math.max(0, width - paddingX * 2 - gap * (count - 1));
	const columnWidth = count > 0 ? innerWidth / count : 0;
	return { paddingX, paddingY, count, gap, width, height, columnWidth };
}

export function sanitizeFlowContainer(container: FlowContainer): FlowContainer {
	return {
		width: nonNegativeFinite(container.width, 0),
		height: nonNegativeFinite(container.height, 0),
		paddingX:
			container.paddingX === undefined ? undefined : nonNegativeFinite(container.paddingX, 0),
		paddingY:
			container.paddingY === undefined ? undefined : nonNegativeFinite(container.paddingY, 0),
	};
}

export function sanitizeFlowColumns(columns: FlowColumns): FlowColumns {
	return {
		count:
			columns.count === undefined
				? undefined
				: Math.max(1, Math.floor(nonNegativeFinite(columns.count, 1))),
		gap: columns.gap === undefined ? undefined : nonNegativeFinite(columns.gap, 0),
	};
}

export function sanitizeObstacles(obstacles: readonly Obstacle[]): readonly Obstacle[] {
	return obstacles.map((obstacle) => {
		if (obstacle.kind === "circle") {
			return {
				kind: obstacle.kind,
				cx: finiteNumber(obstacle.cx, 0),
				cy: finiteNumber(obstacle.cy, 0),
				r: nonNegativeFinite(obstacle.r, 0),
			};
		}
		return {
			kind: obstacle.kind,
			x: finiteNumber(obstacle.x, 0),
			y: finiteNumber(obstacle.y, 0),
			width: nonNegativeFinite(obstacle.width, 0),
			height: nonNegativeFinite(obstacle.height, 0),
		};
	});
}

/** Intersect a circle obstacle with a horizontal line band. */
export function circleIntervalForBand(
	obstacle: CircleObstacle,
	bandTop: number,
	bandBottom: number,
): Interval | null {
	const radius = nonNegativeFinite(obstacle.r, 0);
	const centerY = obstacle.cy;
	const nearestY = Math.max(bandTop, Math.min(centerY, bandBottom));
	const dy = nearestY - centerY;
	if (Math.abs(dy) > radius) return null;
	const dx = Math.sqrt(Math.max(0, radius * radius - dy * dy));
	return { left: obstacle.cx - dx, right: obstacle.cx + dx };
}

/** Intersect a rectangle obstacle with a horizontal line band. */
export function rectIntervalForBand(
	obstacle: RectObstacle,
	bandTop: number,
	bandBottom: number,
): Interval | null {
	const left = obstacle.x;
	const right = obstacle.x + nonNegativeFinite(obstacle.width, 0);
	const top = obstacle.y;
	const bottom = obstacle.y + nonNegativeFinite(obstacle.height, 0);
	if (bottom <= bandTop || top >= bandBottom || right <= left) return null;
	return { left, right };
}

export function blockedIntervalsForBand(
	obstacles: readonly Obstacle[],
	bandTop: number,
	bandBottom: number,
): Interval[] {
	const intervals: Interval[] = [];
	for (const obstacle of obstacles) {
		const interval =
			obstacle.kind === "circle"
				? circleIntervalForBand(obstacle, bandTop, bandBottom)
				: rectIntervalForBand(obstacle, bandTop, bandBottom);
		if (interval) intervals.push(interval);
	}
	return intervals.sort((a, b) => a.left - b.left);
}

/** Flow prepared text through columns and carved obstacle slots. */
export function computeFlowLines(
	segments: readonly PreparedSegment[],
	opts: ComputeFlowLinesOptions,
): FlowLinesResult {
	const geometry = columnGeometry(opts.container, opts.columns);
	const lineHeight = positiveFinite(opts.lineHeight, 20);
	const minSlotWidth = nonNegativeFinite(opts.minSlotWidth ?? 0, 0);
	const obstacles = opts.obstacles ?? [];
	const segmentAdapter = opts.segmentAdapter ?? getDefaultSegmentAdapter();
	const lines: PositionedLine[] = [];
	let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
	const contentBottom = Math.max(geometry.paddingY, geometry.height - geometry.paddingY);
	for (let columnIndex = 0; columnIndex < geometry.count; columnIndex += 1) {
		const columnLeft = geometry.paddingX + columnIndex * (geometry.columnWidth + geometry.gap);
		const columnRight = columnLeft + geometry.columnWidth;
		for (
			let y = geometry.paddingY;
			y + lineHeight <= contentBottom + 1e-3 && cursor.segmentIndex < segments.length;
			y += lineHeight
		) {
			const blocked = blockedIntervalsForBand(obstacles, y, y + lineHeight);
			const slots = carveTextLineSlots(
				{ left: columnLeft, right: columnRight },
				blocked,
				Math.max(minSlotWidth, 1e-6),
			);
			for (const slot of slots) {
				if (cursor.segmentIndex >= segments.length) break;
				const slotWidth = slot.right - slot.left;
				const next = layoutNextLine(segments, cursor, slotWidth, {
					hyphenWidth: opts.hyphenWidth,
					segmentAdapter,
				});
				if (next === null) {
					cursor = { segmentIndex: segments.length, graphemeIndex: 0 };
					break;
				}
				if (
					next.end.segmentIndex === cursor.segmentIndex &&
					next.end.graphemeIndex === cursor.graphemeIndex
				) {
					break;
				}
				cursor = next.end;
				if (next.text.length === 0 && next.width === 0) break;
				lines.push({
					text: next.text,
					width: next.width,
					startSegment: next.start.segmentIndex,
					startGrapheme: next.start.graphemeIndex,
					endSegment: next.end.segmentIndex,
					endGrapheme: next.end.graphemeIndex,
					x: slot.left,
					y,
					slotWidth,
					columnIndex,
				});
			}
		}
	}
	return {
		lines,
		cursor,
		done: cursor.segmentIndex >= segments.length,
	};
}
