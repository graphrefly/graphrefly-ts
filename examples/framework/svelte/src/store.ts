import { derived, state } from "@graphrefly/graphrefly/core";

export const count = state(0, { name: "count" });
export const doubled = derived([count], ([n]) => (n as number) * 2, {
	name: "doubled",
});
