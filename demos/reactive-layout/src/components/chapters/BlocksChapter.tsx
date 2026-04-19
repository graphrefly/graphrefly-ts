import type { PositionedBlock } from "@graphrefly/graphrefly/patterns/reactive-layout";
import { useState } from "react";
import { type BlocksChapter, buildBlocksChapter } from "../../lib/chapters/blocks";
import { type ChapterProps, hoverProps } from "../../lib/chapters/types";
import { useNodeValue } from "../../lib/use-node-value";

let cached: BlocksChapter | null = null;
export function getBlocksChapter(): BlocksChapter {
	if (!cached) cached = buildBlocksChapter();
	return cached;
}

function BlockRender({ block }: { block: PositionedBlock }) {
	if (block.type === "text") {
		const lines = block.textLineBreaks?.lines ?? [];
		return (
			<div
				style={{
					position: "absolute",
					left: block.x,
					top: block.y,
					width: block.width,
					height: block.height,
				}}
				className="block block-text"
			>
				{lines.map((l, i) => (
					<div key={`${i}-${l.text}`} className="paragraph-line" style={{ width: `${l.width}px` }}>
						{l.text || "\u00a0"}
					</div>
				))}
			</div>
		);
	}
	if (block.type === "svg") {
		const chapter = getBlocksChapter();
		const raw = chapter.bundle.graph.resolve("blocks").cache as Array<{
			type: string;
			content?: string;
		}>;
		const src = raw?.[block.index]?.content ?? "";
		return (
			<div
				style={{ position: "absolute", left: block.x, top: block.y, width: block.width }}
				className="block block-svg"
				dangerouslySetInnerHTML={{ __html: src }}
			/>
		);
	}
	// image — placeholder gradient, no network fetch
	return (
		<div
			style={{
				position: "absolute",
				left: block.x,
				top: block.y,
				width: block.width,
				height: block.height,
				background: "linear-gradient(135deg, #4de8c233, #9b59b633)",
				border: "1px dashed var(--color-border)",
				borderRadius: 6,
			}}
			className="block block-image"
		>
			<span className="block-image-label">
				image · {block.width.toFixed(0)}×{block.height.toFixed(0)}
			</span>
		</div>
	);
}

export default function BlocksChapterUI({ onHover }: ChapterProps) {
	const chapter = getBlocksChapter();
	const blockFlow = useNodeValue(chapter.bundle.blockFlow);
	const totalHeight = useNodeValue(chapter.bundle.totalHeight);

	const [maxWidth, setMaxWidth] = useState<number>(520);
	const applyWidth = (w: number) => {
		setMaxWidth(w);
		chapter.setMaxWidth(w);
	};

	return (
		<div className="chapter blocks-chapter">
			<p className="chapter-lede">
				<code>reactiveBlockLayout</code> stacks heterogeneous content — text, inline SVG, images —
				into a vertical flow that re-positions every child reactively when the container constraint
				changes.
			</p>
			<div className="controls">
				<label data-field="blocks.mw" {...hoverProps(onHover, "max-width")}>
					<span>
						max-width <em>{maxWidth}px</em>
					</span>
					<input
						type="range"
						min={240}
						max={720}
						value={maxWidth}
						onChange={(e) => applyWidth(Number(e.target.value))}
						onFocus={() => onHover({ pane: "visual", id: "max-width" })}
						onBlur={() => onHover(null)}
					/>
				</label>
				<div className="block-total" data-block-total {...hoverProps(onHover, "total-height")}>
					total-height: <strong>{totalHeight ?? 0}px</strong>
				</div>
			</div>

			<div
				className="block-frame"
				data-block="all"
				style={{ width: maxWidth, height: totalHeight ?? 0 }}
			>
				{(blockFlow ?? []).map((b) => (
					<BlockRender key={b.index} block={b} />
				))}
			</div>
		</div>
	);
}
