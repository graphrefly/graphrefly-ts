import { createNodeInput, createNodeValue } from "@graphrefly/ts/adapters/solid";
import type { Component } from "solid-js";
import { count, doubled } from "./store";

export const Counter: Component = () => {
	const [value, setValue] = createNodeInput(count);
	const dbl = createNodeValue(doubled);
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
