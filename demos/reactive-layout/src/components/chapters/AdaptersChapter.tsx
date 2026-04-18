import type { LineBreaksResult } from "@graphrefly/graphrefly/reactive-layout";
import { useEffect, useRef, useState } from "react";
import { type AdaptersChapter, buildAdaptersChapter } from "../../lib/chapters/adapters";
import { type ChapterProps, hoverProps } from "../../lib/chapters/types";
import { LAYOUT_LINE_HEIGHT } from "../../lib/measure-adapter";
import { useNodeValue } from "../../lib/use-node-value";

let cached: AdaptersChapter | null = null;
export function getAdaptersChapter(): AdaptersChapter {
	if (!cached) cached = buildAdaptersChapter();
	return cached;
}

/** Render lines onto a 2D canvas so the pixel path is genuinely exercised. */
function useCanvasRender(
	lineBreaks: LineBreaksResult | null,
	maxWidth: number,
	font: string,
	lineHeight: number,
) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	useEffect(() => {
		const c = canvasRef.current;
		if (!c || !lineBreaks) return;
		const dpr = window.devicePixelRatio || 1;
		const h = lineBreaks.lineCount * lineHeight || lineHeight;
		c.width = maxWidth * dpr;
		c.height = h * dpr;
		c.style.width = `${maxWidth}px`;
		c.style.height = `${h}px`;
		const ctx = c.getContext("2d");
		if (!ctx) return;
		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, maxWidth, h);
		ctx.font = font;
		ctx.fillStyle = "#f0f4ff";
		ctx.textBaseline = "top";
		for (let i = 0; i < lineBreaks.lines.length; i++) {
			ctx.fillText(lineBreaks.lines[i]!.text, 0, i * lineHeight);
		}
	}, [lineBreaks, maxWidth, font, lineHeight]);
	return canvasRef;
}

export default function AdaptersChapterUI({ onHover }: ChapterProps) {
	const chapter = getAdaptersChapter();
	const [text, setText] = useState<string>(() => {
		return (chapter.canvas.graph.resolve("text").cache as string) ?? "";
	});
	const [maxWidth, setMaxWidth] = useState<number>(360);

	const canvasBreaks = useNodeValue(chapter.canvas.lineBreaks);
	const cliBreaks = useNodeValue(chapter.cli.lineBreaks);
	const replayBreaks = useNodeValue(chapter.replay.lineBreaks);

	// Re-derive a CLI-grid approximation: each cell ≈ 8px, CJK glyphs = 2 cells.
	// The CLI adapter already does this at measure-time; we surface it by
	// projecting line widths onto the same 8px grid for visual consistency.
	const canvasRef = useCanvasRender(
		canvasBreaks,
		maxWidth,
		'14px "Fira Code", ui-monospace, monospace',
		LAYOUT_LINE_HEIGHT,
	);

	const applyText = (t: string) => {
		setText(t);
		chapter.setText(t);
	};
	const applyWidth = (w: number) => {
		setMaxWidth(w);
		chapter.setMaxWidth(w);
	};

	const replaySnapshot = JSON.stringify(
		{
			lineCount: replayBreaks?.lineCount ?? 0,
			lines: (replayBreaks?.lines ?? []).map((l) => ({
				text: l.text,
				width: Math.round(l.width * 100) / 100,
			})),
		},
		null,
		2,
	);

	return (
		<div className="chapter adapters-chapter">
			<p className="chapter-lede">
				Same graph topology, three measurement backends. Canvas reports pixel widths; CLI reports
				8px × cell counts (wide CJK = 2 cells); precomputed reads from a snapshotted metrics map —
				the shape you'd ship with SSR output.
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
						min={160}
						max={520}
						value={maxWidth}
						onChange={(e) => applyWidth(Number(e.target.value))}
					/>
				</label>
			</div>

			<div className="adapter-grid">
				<div
					className="adapter-col"
					data-output="adapters.canvas"
					{...hoverProps(onHover, "segments")}
				>
					<h4>CanvasMeasureAdapter</h4>
					<canvas ref={canvasRef} className="adapter-canvas" />
					<div className="adapter-meta">
						lines: <strong>{canvasBreaks?.lineCount ?? 0}</strong> · max-line:{" "}
						<strong>
							{Math.round((canvasBreaks?.lines ?? []).reduce((m, l) => Math.max(m, l.width), 0))}
							px
						</strong>
					</div>
				</div>

				<div
					className="adapter-col"
					data-output="adapters.cli"
					{...hoverProps(onHover, "line-breaks")}
				>
					<h4>CliMeasureAdapter</h4>
					<pre className="adapter-cli">
						{(cliBreaks?.lines ?? []).map((l, i) => `${l.text}\n`).join("") || "\u00a0"}
					</pre>
					<div className="adapter-meta">
						lines: <strong>{cliBreaks?.lineCount ?? 0}</strong> · cells/line max:{" "}
						<strong>
							{Math.round((cliBreaks?.lines ?? []).reduce((m, l) => Math.max(m, l.width), 0) / 8)}
						</strong>
					</div>
				</div>

				<div
					className="adapter-col"
					data-output="adapters.replay"
					{...hoverProps(onHover, "char-positions")}
				>
					<h4>PrecomputedAdapter (SSR replay)</h4>
					<pre className="adapter-snapshot">{replaySnapshot}</pre>
					<div className="adapter-meta">
						lines: <strong>{replayBreaks?.lineCount ?? 0}</strong> · falls back to per-char widths
						if a segment misses the metrics map.
					</div>
				</div>
			</div>
		</div>
	);
}
