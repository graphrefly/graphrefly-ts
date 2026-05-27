import { useEffect, useMemo, useState } from "react";
import { readKGSnapshot } from "../../lib/chapters/_shared";
import { buildBaselineChapter } from "../../lib/chapters/baseline";
import type { ChapterUIProps } from "../../lib/chapters/types";
import KGPane from "../KGPane";

let cached: ReturnType<typeof buildBaselineChapter> | null = null;
export function getBaselineChapter() {
	if (!cached) cached = buildBaselineChapter();
	return cached;
}

export default function BaselineChapterUI({ hoverTarget, onHover }: ChapterUIProps) {
	const c = useMemo(() => getBaselineChapter(), []);
	const [snap, setSnap] = useState(() => readKGSnapshot(c.kg));

	useEffect(() => {
		const a = c.kg.resolve("entities").subscribe(() => setSnap(readKGSnapshot(c.kg)));
		const b = c.kg.resolve("edges").subscribe(() => setSnap(readKGSnapshot(c.kg)));
		return () => {
			a();
			b();
		};
	}, [c]);

	return (
		<div className="chapter">
			<p className="chapter-lede">
				A <code>knowledgeGraph()</code> is a <code>Graph</code> with three named nodes —{" "}
				<code>entities</code>, <code>edges</code>, <code>adjacency</code> — plus four imperative
				methods. Hand-seeded here. <strong>This is just a fancy Map so far</strong> — the next
				chapter is the contrast.
			</p>
			<div className="baseline-note">
				The user-facing data type is whatever you set as <code>TEntity</code> (here:{" "}
				<code>Entity</code>) and <code>TRelation</code> (here: <code>Relation</code>). The names
				<code> entities</code>/<code>edges</code>/<code>adjacency</code> are internal node names —
				the schema of the container, not vocabulary your users see.
			</div>
			<div className="controls">
				<button type="button" className="secondary" onClick={() => c.reseed()}>
					Re-seed
				</button>
			</div>
			<KGPane
				entities={snap.entities}
				edges={snap.edges}
				hoverId={hoverTarget?.id ?? null}
				onHover={(id) => onHover(id ? { pane: "visual", id } : null)}
			/>
		</div>
	);
}
