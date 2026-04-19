import type { DATA as _DATA } from "@graphrefly/graphrefly/core";
import type { ReactiveLayoutBundle } from "@graphrefly/graphrefly/patterns/reactive-layout";
import { useState } from "react";
import { buildPlaygroundChapter, type PlaygroundChapter } from "../../lib/chapters/playground";
import { type ChapterProps, hoverProps } from "../../lib/chapters/types";
import { LAYOUT_LINE_HEIGHT } from "../../lib/measure-adapter";
import { useNodeValue } from "../../lib/use-node-value";

// Module-level singleton so remounting the chapter (tab switches) preserves the
// bundles' caches + state. Build exactly once per page.
let cached: PlaygroundChapter | null = null;
export function getPlaygroundChapter(): PlaygroundChapter {
	if (!cached) cached = buildPlaygroundChapter();
	return cached;
}

function ParagraphCard({
	bundle,
	id,
	onHover,
}: {
	bundle: ReactiveLayoutBundle;
	id: string;
	onHover: ChapterProps["onHover"];
}) {
	const lineBreaks = useNodeValue(bundle.lineBreaks);
	const height = useNodeValue(bundle.height);
	const segments = useNodeValue(bundle.segments);

	const [text, setText] = useState<string>(() => {
		const s = bundle.graph.resolve("text").cache;
		return (s as string) ?? "";
	});
	const [maxWidth, setMaxWidth] = useState<number>(() => {
		const s = bundle.graph.resolve("max-width").cache;
		return (s as number) ?? 480;
	});
	const [fontSize, setFontSize] = useState<number>(14);
	const [lineHeight, setLineHeight] = useState<number>(LAYOUT_LINE_HEIGHT);

	const applyText = (t: string) => {
		setText(t);
		bundle.setText(t);
	};
	const applyMaxWidth = (w: number) => {
		setMaxWidth(w);
		bundle.setMaxWidth(w);
	};
	const applyFontSize = (size: number) => {
		setFontSize(size);
		bundle.setFont(`${size}px "Fira Code", ui-monospace, monospace`);
	};
	const applyLineHeight = (lh: number) => {
		setLineHeight(lh);
		bundle.setLineHeight(lh);
	};

	const bodyPath = `${id}.body`;

	return (
		<div className="paragraph-card" data-chapter={id}>
			<div className="controls">
				<label data-field={`${id}.text`} {...hoverProps(onHover, "text")}>
					<span>text</span>
					<textarea
						rows={3}
						value={text}
						onChange={(e) => applyText(e.target.value)}
						onFocus={() => onHover({ pane: "visual", id: "text" })}
						onBlur={() => onHover(null)}
					/>
				</label>
				<div className="slider-row">
					<label data-field={`${id}.mw`} {...hoverProps(onHover, "max-width")}>
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
					<label data-field={`${id}.font`} {...hoverProps(onHover, "font")}>
						<span>
							font-size <em>{fontSize}px</em>
						</span>
						<input
							type="range"
							min={10}
							max={22}
							value={fontSize}
							onChange={(e) => applyFontSize(Number(e.target.value))}
						/>
					</label>
					<label data-field={`${id}.lh`} {...hoverProps(onHover, "line-height")}>
						<span>
							line-height <em>{lineHeight}px</em>
						</span>
						<input
							type="range"
							min={14}
							max={40}
							value={lineHeight}
							onChange={(e) => applyLineHeight(Number(e.target.value))}
						/>
					</label>
				</div>
			</div>

			<div
				className="paragraph-render"
				data-output={bodyPath}
				{...hoverProps(onHover, "line-breaks")}
				style={{
					maxWidth,
					lineHeight: `${lineHeight}px`,
					fontSize: `${fontSize}px`,
					minHeight: `${height ?? 0}px`,
				}}
			>
				{(lineBreaks?.lines ?? []).map((line, i) => (
					<div
						key={`${i}-${line.text}`}
						className="paragraph-line"
						style={{ height: `${lineHeight}px`, width: `${line.width}px` }}
					>
						{line.text || "\u00a0"}
					</div>
				))}
			</div>

			<div className="meta-strip">
				<span data-output={`${id}.segments`} {...hoverProps(onHover, "segments")}>
					segments: <strong>{segments?.length ?? 0}</strong>
				</span>
				<span data-output={`${id}.lines`} {...hoverProps(onHover, "line-breaks")}>
					lines: <strong>{lineBreaks?.lineCount ?? 0}</strong>
				</span>
				<span data-output={`${id}.height`} {...hoverProps(onHover, "height")}>
					height: <strong>{height ?? 0}px</strong>
				</span>
			</div>
		</div>
	);
}

export default function PlaygroundChapterUI({ onHover }: ChapterProps) {
	const chapter = getPlaygroundChapter();
	const [intro, cjk, emoji] = chapter.bundles;
	return (
		<div className="chapter playground-chapter">
			<p className="chapter-lede">
				Three independent <code>reactiveLayout</code> graphs share one measurement adapter and its
				cache. Edit any control — only the dependent derived nodes re-run, and the side panes follow
				whichever paragraph you hover.
			</p>
			<ParagraphCard bundle={intro} id="intro" onHover={onHover} />
			<ParagraphCard bundle={cjk} id="cjk" onHover={onHover} />
			<ParagraphCard bundle={emoji} id="emoji" onHover={onHover} />
		</div>
	);
}
