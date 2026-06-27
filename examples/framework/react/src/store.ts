import { graph } from "@graphrefly/ts";

const g = graph({ name: "react-example" });

// Shared graph state: nodes outlive React mount/unmount. ROM state: cache
// persists across subscriber churn (spec §2.6).
export const count = g.state(0, { name: "count" });
export const doubled = g.derived([count], (n) => n * 2, { name: "doubled" });
