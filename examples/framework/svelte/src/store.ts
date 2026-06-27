import { graph } from "@graphrefly/ts";

const g = graph({ name: "svelte-example" });

export const count = g.state(0, { name: "count" });
export const doubled = g.derived([count], (n) => n * 2, { name: "doubled" });
