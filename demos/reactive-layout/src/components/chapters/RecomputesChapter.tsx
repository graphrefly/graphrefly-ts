import { useEffect, useRef, useState } from "react";
import {
	buildRecomputesChapter,
	type RecomputesChapter,
	runBaseline,
	timedReactive,
} from "../../lib/chapters/recomputes";
import { type ChapterProps, hoverProps } from "../../lib/chapters/types";
import { LAYOUT_FONT, LAYOUT_LINE_HEIGHT } from "../../lib/measure-adapter";
import { useNodeValue } from "../../lib/use-node-value";

let cached: RecomputesChapter | null = null;
export function getRecomputesChapter(): RecomputesChapter {
	if (!cached) cached = buildRecomputesChapter();
	return cached;
}

function pretty(ns: bigint): string {
	const n = Number(ns);
	if (n < 1_000) return `${n} ns`;
	if (n < 1_000_000) return `${(n / 1_000).toFixed(1)} µs`;
	return `${(n / 1_000_000).toFixed(2)} ms`;
}

export default function RecomputesChapterUI({ onHover }: ChapterProps) {
	const chapter = getRecomputesChapter();
	const lineBreaks = useNodeValue(chapter.bundle.lineBreaks);

	const [text, setText] = useState<string>(() => {
		return (chapter.bundle.graph.resolve("text").cache as string) ?? "";
	});
	const [maxWidth, setMaxWidth] = useState<number>(() => {
		return (chapter.bundle.graph.resolve("max-width").cache as number) ?? 520;
	});

	// Live counters — kept in React state via a tick so renders pick up refs.
	const [, forceTick] = useState(0);
	const tickRef = useRef<() => void>(() => forceTick((n) => n + 1));
	useEffect(() => {
		// Tick whenever either bundle emits a derived value — we read from the
		// mutable counter refs (no shadow state) so this is just a re-render prod.
		const u1 = chapter.bundle.segments.subscribe(() => tickRef.current());
		const u2 = chapter.bundle.lineBreaks.subscribe(() => tickRef.current());
		return () => {
			u1();
			u2();
		};
	}, [chapter]);

	const applyText = (t: string) => {
		setText(t);
		// Wrap the reactive setter so lastWallNs captures the full cascade
		// for whichever nodes re-run this tick (fixes a prior bug where
		// `lastWallNs` grew with wall-clock between non-segments edits).
		timedReactive(chapter.reactiveStats, () => chapter.bundle.setText(t));
		runBaseline(t, LAYOUT_FONT, maxWidth, LAYOUT_LINE_HEIGHT, chapter.baselineStats);
		tickRef.current();
	};
	const applyMaxWidth = (w: number) => {
		setMaxWidth(w);
		timedReactive(chapter.reactiveStats, () => chapter.bundle.setMaxWidth(w));
		runBaseline(text, LAYOUT_FONT, w, LAYOUT_LINE_HEIGHT, chapter.baselineStats);
		tickRef.current();
	};

	return (
		<div className="chapter recomputes-chapter">
			<p className="chapter-lede">
				Every input change emits one DATA through reactive mode — but only the derived nodes whose
				deps actually changed re-run. The imperative baseline runs every stage, every time.
			</p>

			<div className="controls">
				<label>
					<span>text</span>
					<textarea rows={3} value={text} onChange={(e) => applyText(e.target.value)} />
				</label>
				<label>
					<span>
						max-width <em>{maxWidth}px</em>
					</span>
					<input
						type="range"
						min={120}
						max={720}
						value={maxWidth}
						onChange={(e) => applyMaxWidth(Number(e.target.value))}
					/>
				</label>
				<button
					type="button"
					onClick={() => {
						chapter.resetStats();
						tickRef.current();
					}}
				>
					reset counters
				</button>
			</div>

			<div className="compare-grid">
				<div className="compare-col">
					<h4>Reactive mode — fan-out only where deps changed</h4>
					<table className="counter-table">
						<tbody>
							<tr data-counter="segments" {...hoverProps(onHover, "segments")}>
								<td>segments</td>
								<td>
									<strong>{chapter.reactiveStats.segmentsRuns}</strong>
								</td>
							</tr>
							<tr data-counter="line-breaks" {...hoverProps(onHover, "line-breaks")}>
								<td>line-breaks</td>
								<td>
									<strong>{chapter.reactiveStats.lineBreaksRuns}</strong>
								</td>
							</tr>
							<tr data-counter="height" {...hoverProps(onHover, "height")}>
								<td>height</td>
								<td>
									<strong>{chapter.reactiveStats.heightRuns}</strong>
								</td>
							</tr>
							<tr data-counter="char-positions" {...hoverProps(onHover, "char-positions")}>
								<td>char-positions</td>
								<td>
									<strong>{chapter.reactiveStats.charPositionsRuns}</strong>
								</td>
							</tr>
						</tbody>
					</table>
					<div className="wall-time">last run: {pretty(chapter.reactiveStats.lastWallNs)}</div>
				</div>

				<div className="compare-col">
					<h4>Baseline — everything re-runs on every edit</h4>
					<table className="counter-table">
						<tbody>
							<tr>
								<td>analyzeAndMeasure</td>
								<td>
									<strong>{chapter.baselineStats.segmentsRuns}</strong>
								</td>
							</tr>
							<tr>
								<td>computeLineBreaks</td>
								<td>
									<strong>{chapter.baselineStats.lineBreaksRuns}</strong>
								</td>
							</tr>
							<tr>
								<td>height calc</td>
								<td>
									<strong>{chapter.baselineStats.heightRuns}</strong>
								</td>
							</tr>
							<tr>
								<td>computeCharPositions</td>
								<td>
									<strong>{chapter.baselineStats.charPositionsRuns}</strong>
								</td>
							</tr>
						</tbody>
					</table>
					<div className="wall-time">last run: {pretty(chapter.baselineStats.lastWallNs)}</div>
				</div>
			</div>

			<div className="paragraph-render" style={{ maxWidth, lineHeight: `${LAYOUT_LINE_HEIGHT}px` }}>
				{(lineBreaks?.lines ?? []).map((l, i) => (
					<div key={`${i}-${l.text}`} className="paragraph-line" style={{ width: `${l.width}px` }}>
						{l.text || "\u00a0"}
					</div>
				))}
			</div>
		</div>
	);
}
