import type { ContentBlock, PositionedBlock } from "@graphrefly/ts/solutions/reactive-layout";
import { useState } from "react";
import { type BlocksChapter, buildBlocksChapter } from "../../lib/chapters/blocks";
import { type ChapterProps, hoverProps } from "../../lib/chapters/types";
import { LAYOUT_FONT, LAYOUT_LINE_HEIGHT } from "../../lib/measure-adapter";
import { useNodeValue } from "../../lib/use-node-value";

let cached: BlocksChapter | null = null;
export function getBlocksChapter(): BlocksChapter {
	if (!cached) cached = buildBlocksChapter();
	return cached;
}

function textStyleForBlock(index: number): { font: string; lineHeight: number } {
	const chapter = getBlocksChapter();
	const blocks = chapter.bundle.input.blocks.cache as readonly ContentBlock[] | undefined;
	const src = blocks?.[index];
	if (src?.kind === "text") {
		return {
			font: src.font ?? LAYOUT_FONT,
			lineHeight: src.lineHeight ?? LAYOUT_LINE_HEIGHT,
		};
	}
	return { font: LAYOUT_FONT, lineHeight: LAYOUT_LINE_HEIGHT };
}

function BlockRender({ block, index }: { block: PositionedBlock; index: number }) {
	if (block.kind === "text") {
		const lines = block.lineBreaks?.lines ?? [];
		const { font, lineHeight } = textStyleForBlock(index);
		return (
			<div
				style={{
					position: "absolute",
					left: block.x,
					top: block.y,
					width: block.width,
					height: block.height,
					font,
					lineHeight: `${lineHeight}px`,
				}}
				className="block block-text"
			>
				{lines.map((l, i) => (
					<div
						key={`${i}-${l.text}`}
						className="paragraph-line"
						style={{
							width: `${Math.min(l.width, block.width)}px`,
							height: lineHeight,
							lineHeight: `${lineHeight}px`,
						}}
					>
						{l.text || "\u00a0"}
					</div>
				))}
			</div>
		);
	}
	if (block.kind === "svg") {
		const src = block.block.kind === "svg" ? block.block.svg : "";
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
				background: "linear-gradient(135deg, rgba(200, 255, 0, 0.25), rgba(155, 196, 0, 0.15))",
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
				{(blockFlow ?? []).map((b, index) => (
					<BlockRender key={b.id ?? index} block={b} index={index} />
				))}
			</div>
		</div>
	);
}
