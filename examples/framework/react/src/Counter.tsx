import { useStore, useSubscribe } from "@graphrefly/graphrefly/compat/react";
import { count, doubled } from "./store";

export function Counter() {
	// `useStore` returns a `[value, setter]` tuple backed by a state node.
	const [value, setValue] = useStore(count);
	// `useSubscribe` returns a read-only value for any node (here: a derived).
	const dbl = useSubscribe(doubled);
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
