/** Example-local value binding. Observes the original view; owns no runtime or business state. */
import type { Node } from "../../packages/ts/src/node/node.js";
import type { SpendingAlertsView } from "./causal-preset.js";

type ValueOf<N> = N extends Node<infer T> ? T : never;
export type SpendingViewValues = {
	readonly [K in keyof SpendingAlertsView]?: ValueOf<SpendingAlertsView[K]>;
};
export interface SpendingViewObservation {
	/** Latest values per port, not an atomic multi-port snapshot or independent evidence. */
	readonly values: SpendingViewValues;
	readonly unavailable: readonly (keyof SpendingAlertsView)[];
}
const ports = ["assessment", "publication", "coverage", "issues", "startup"] as const;

/** The returned function ends observation only. Run ownership stays with the application. */
export function mountSpendingView(
	view: SpendingAlertsView,
	render: (observation: SpendingViewObservation) => void,
): () => void {
	const values: Record<string, unknown> = {};
	const stops: (() => void)[] = [];
	let mounting = true;
	let closed = false;
	const publish = () =>
		render(
			Object.freeze({
				values: Object.freeze({ ...values }) as SpendingViewValues,
				unavailable: Object.freeze(ports.filter((port) => !Object.hasOwn(values, port))),
			}),
		);
	const stop = () => {
		if (closed) return;
		closed = true;
		for (const unsubscribe of stops.splice(0).reverse()) unsubscribe();
	};
	try {
		for (const port of ports) {
			stops.push(
				view[port].subscribe((message) => {
					if (closed) return;
					if (message[0] === "DATA") values[port] = message[1];
					else if (message[0] === "INVALIDATE" || message[0] === "ERROR") delete values[port];
					else return;
					if (!mounting) publish();
				}),
			);
		}
		mounting = false;
		publish();
		return stop;
	} catch (error) {
		stop();
		throw error;
	}
}
