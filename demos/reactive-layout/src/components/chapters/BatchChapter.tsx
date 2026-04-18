import { useEffect, useState } from "react";
import { type BatchChapter, buildBatchChapter } from "../../lib/chapters/batch";
import { type ChapterProps, hoverProps } from "../../lib/chapters/types";
import { LAYOUT_LINE_HEIGHT } from "../../lib/measure-adapter";
import { useNodeValue } from "../../lib/use-node-value";

let cached: BatchChapter | null = null;
export function getBatchChapter(): BatchChapter {
	if (!cached) cached = buildBatchChapter();
	return cached;
}

export default function BatchChapterUI({ onHover }: ChapterProps) {
	const chapter = getBatchChapter();
	const batchedBreaks = useNodeValue(chapter.batched.lineBreaks);
	const unbatchedBreaks = useNodeValue(chapter.unbatched.lineBreaks);

	// Re-render on any counter update (counters live on a plain object).
	const [, bump] = useState(0);
	useEffect(() => {
		const unsubs = [
			chapter.batched.segments.subscribe(() => bump((n) => n + 1)),
			chapter.batched.lineBreaks.subscribe(() => bump((n) => n + 1)),
			chapter.unbatched.segments.subscribe(() => bump((n) => n + 1)),
			chapter.unbatched.lineBreaks.subscribe(() => bump((n) => n + 1)),
		];
		return () => {
			for (const u of unsubs) u();
		};
	}, [chapter]);

	const handleRun = () => {
		chapter.applyFiveEdits();
	};

	return (
		<div className="chapter batch-chapter">
			<p className="chapter-lede">
				Two identical <code>reactiveLayout</code> bundles. Click the button to apply the same 5
				writes (text, font, line-height, max-width, text-again) to each. The batched one wraps the
				writes in <code>batch(() =&gt; &hellip;)</code>; the unbatched one doesn't.
			</p>
			<div className="controls">
				<button type="button" onClick={handleRun}>
					apply 5 paired edits
				</button>
				<button
					type="button"
					onClick={() => {
						// The counters are plain refs — mutating them doesn't
						// trigger a React re-render on its own. Bump local state
						// so the table reads the reset values immediately.
						chapter.resetStats();
						bump((n) => n + 1);
					}}
				>
					reset counters
				</button>
			</div>

			<div className="compare-grid">
				<div className="compare-col" data-output="batched">
					<h4>batch(() =&gt; &hellip;) — one coalesced pass</h4>
					<table className="counter-table">
						<tbody>
							<tr data-counter="batched.segments" {...hoverProps(onHover, "segments")}>
								<td>segments runs</td>
								<td>
									<strong>{chapter.batchedStats.segmentsRuns}</strong>
								</td>
							</tr>
							<tr data-counter="batched.line-breaks" {...hoverProps(onHover, "line-breaks")}>
								<td>line-breaks runs</td>
								<td>
									<strong>{chapter.batchedStats.lineBreaksRuns}</strong>
								</td>
							</tr>
						</tbody>
					</table>
					<div
						className="paragraph-render"
						style={{ lineHeight: `${LAYOUT_LINE_HEIGHT}px`, maxWidth: 420 }}
					>
						{(batchedBreaks?.lines ?? []).map((l, i) => (
							<div
								key={`${i}-${l.text}`}
								className="paragraph-line"
								style={{ width: `${l.width}px` }}
							>
								{l.text || "\u00a0"}
							</div>
						))}
					</div>
				</div>

				<div className="compare-col" data-output="unbatched">
					<h4>No batch — writes fan out 5×</h4>
					<table className="counter-table">
						<tbody>
							<tr>
								<td>segments runs</td>
								<td>
									<strong>{chapter.unbatchedStats.segmentsRuns}</strong>
								</td>
							</tr>
							<tr>
								<td>line-breaks runs</td>
								<td>
									<strong>{chapter.unbatchedStats.lineBreaksRuns}</strong>
								</td>
							</tr>
						</tbody>
					</table>
					<div
						className="paragraph-render"
						style={{ lineHeight: `${LAYOUT_LINE_HEIGHT}px`, maxWidth: 420 }}
					>
						{(unbatchedBreaks?.lines ?? []).map((l, i) => (
							<div
								key={`${i}-${l.text}`}
								className="paragraph-line"
								style={{ width: `${l.width}px` }}
							>
								{l.text || "\u00a0"}
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
