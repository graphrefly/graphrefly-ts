import { derived, state } from "@graphrefly/graphrefly/core";

// Shared graph state — nodes outlive React mount/unmount. ROM state: cache
// persists across subscriber churn (spec §2.6).
export const count = state(0, { name: "count" });
export const doubled = derived([count], ([n]) => (n as number) * 2, {
	name: "doubled",
});
