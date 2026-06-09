import type { Component } from "solid-js";
import { useStore, useSubscribe } from "./hooks";
import { count, doubled } from "./store";

export const Counter: Component = () => {
	// Example-local hook glue over @graphrefly/ts/adapters/subscribeNodeValues.
	const [value, setValue] = useStore(count);
	const dbl = useSubscribe(doubled);
	return (
		<section>
			<h1>GraphReFly · Solid</h1>
			<div class="row">
				<button type="button" onClick={() => setValue((value() ?? 0) - 1)}>
					−
				</button>
				<span class="value">{value() ?? 0}</span>
				<button type="button" onClick={() => setValue((value() ?? 0) + 1)}>
					+
				</button>
			</div>
			<p>
				doubled = <strong>{dbl() ?? 0}</strong>
			</p>
		</section>
	);
};
