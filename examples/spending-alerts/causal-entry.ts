/** Consumer-private graded entry. Configuration never creates or owns a running instance. */
import type { Graph } from "../../packages/ts/src/graph/graph.js";
import { composeSpendingHost } from "./causal-focused-host.js";
import type { SpendingInputs } from "./causal-inputs.js";
import { SpendingResource } from "./causal-resource.js";

export interface SpendingDefaults {
	readonly name: string;
	readonly diagnostics?: "off" | "summary";
}
export interface SpendingOverrides {
	readonly name?: string;
	readonly diagnostics?: "off" | "summary";
}
export interface SpendingCreationInputs extends Omit<SpendingInputs, "inbox"> {
	readonly inbox: Readonly<{ resource: SpendingResource }>;
}

function ownValues(raw: unknown, allowed: readonly string[]): Record<string, unknown> {
	if (
		raw === null ||
		typeof raw !== "object" ||
		(Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)
	)
		throw new TypeError("spending entry requires a plain data object");
	const values: Record<string, unknown> = Object.create(null);
	for (const key of Reflect.ownKeys(raw)) {
		if (typeof key !== "string" || !allowed.includes(key))
			throw new TypeError("unknown spending entry field");
		const descriptor = Object.getOwnPropertyDescriptor(raw, key)!;
		if (!("value" in descriptor)) throw new TypeError("spending entry accessor field");
		values[key] = descriptor.value;
	}
	return values;
}
function configuration(raw: unknown, inherited?: Readonly<Required<SpendingDefaults>>) {
	const values = ownValues(raw, ["name", "diagnostics"]);
	const name = values.name === undefined ? inherited?.name : values.name;
	const diagnostics =
		values.diagnostics === undefined ? (inherited?.diagnostics ?? "off") : values.diagnostics;
	if (typeof name !== "string" || name.length === 0 || name.length > 256)
		throw new TypeError("spending entry requires a bounded instance name");
	if (diagnostics !== "off" && diagnostics !== "summary")
		throw new TypeError("spending entry diagnostics");
	return Object.freeze({ name, diagnostics });
}

/** Bind immutable defaults; each compose invokes the existing complete host construction. */
export function spendingAlertsFor(graph: Graph, defaults: SpendingDefaults) {
	const settings = configuration(defaults);
	return Object.freeze({
		compose(inputs: SpendingCreationInputs, overrides: SpendingOverrides = {}) {
			const options = configuration(overrides, settings);
			const groups = ownValues(inputs, ["evaluations", "verification", "localAuthority", "inbox"]);
			const inbox = ownValues(groups.inbox, ["resource"]);
			if (!SpendingResource.is(inbox.resource))
				throw new TypeError("spending entry requires a prepared resource");
			const resource = inbox.resource;
			const host = composeSpendingHost(
				graph,
				{
					evaluations: groups.evaluations as SpendingInputs["evaluations"],
					verification: groups.verification as SpendingInputs["verification"],
					localAuthority: groups.localAuthority as SpendingInputs["localAuthority"],
				},
				resource.binding,
				resource,
				options,
			);
			return Object.freeze({
				...host,
				view: host.consume.view,
				capabilities: host.consume.capabilities,
			});
		},
	});
}
