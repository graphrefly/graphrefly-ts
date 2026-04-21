import { useMemo } from "react";
import { splitContentParagraphs } from "../lib/paragraphs";

export default function PaperPane({
	title,
	author,
	url,
	body,
	currentParagraph,
}: {
	title: string;
	author?: string;
	url?: string;
	body: string;
	currentParagraph: string;
}) {
	const paragraphs = useMemo(() => splitContentParagraphs(body), [body]);
	return (
		<div className="paper-pane" data-paper-text>
			<div>
				<h4>Paper</h4>
				<div className="paper-meta" data-paper-meta>
					<strong>{title}</strong>
					{author ? ` — ${author}` : null}
					{url ? (
						<>
							{" · "}
							<a href={url} target="_blank" rel="noreferrer noopener">
								source
							</a>
						</>
					) : null}
				</div>
			</div>
			<div className="paper-text">
				{paragraphs.map((p) => (
					// Key from a content prefix — paragraphs are unique within a
					// paper at this length. (If a paper truly repeats two
					// 64-char openings verbatim, React's reconciliation degrades
					// to a no-op for the dupe; visually identical so harmless.)
					<div
						key={p.slice(0, 64)}
						className={`paragraph${p === currentParagraph ? " current" : ""}`}
						data-current-paragraph={p === currentParagraph ? "true" : undefined}
					>
						{p}
					</div>
				))}
			</div>
		</div>
	);
}
