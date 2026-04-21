import { useEffect, useRef } from "react";

export default function CodePane({
	source,
	highlightLine,
}: {
	source: string;
	highlightLine: number | null;
}) {
	const ref = useRef<HTMLPreElement | null>(null);
	const lines = source.split("\n");

	useEffect(() => {
		if (highlightLine == null) return;
		const el = ref.current?.querySelector<HTMLElement>(`[data-line='${highlightLine}']`);
		el?.scrollIntoView({ behavior: "auto", block: "nearest" });
	}, [highlightLine]);

	return (
		<pre className="code-pre" ref={ref}>
			{lines.map((l, i) => {
				const n = i + 1;
				const active = highlightLine === n;
				return (
					<div key={n} data-line={n} className={`code-line${active ? " active" : ""}`}>
						<span className="code-lineno">{n}</span>
						<span className="code-linetext">{l || "\u00a0"}</span>
					</div>
				);
			})}
		</pre>
	);
}
