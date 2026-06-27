import { useNodeInput, useNodeValue } from "@graphrefly/ts/adapters/react";
import { count, doubled } from "./store";

export function Counter() {
	const [value, setValue] = useNodeInput(count);
	const dbl = useNodeValue(doubled);
	const n = value ?? 0;
	return (
		<section>
			<h1>GraphReFly · React</h1>
			<div className="row">
				<button type="button" onClick={() => setValue(n - 1)}>
					−
				</button>
				<span className="value">{n}</span>
				<button type="button" onClick={() => setValue(n + 1)}>
					+
				</button>
			</div>
			<p>
				doubled = <strong>{dbl ?? 0}</strong>
			</p>
		</section>
	);
}
