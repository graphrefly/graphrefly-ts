// Shared types across chapters and UI.

export type EntityKind = "concept" | "method" | "risk" | "actor" | "metric" | "other";

export type Entity = {
	id: string;
	label: string;
	kind: EntityKind;
};

export type Relation = "is_a" | "part_of" | "addresses" | "uses" | "causes" | "contrasts_with";

export type ExtractionResult = {
	entities: readonly Entity[];
	relations: ReadonlyArray<{
		from: string;
		to: string;
		relation: Relation;
	}>;
};

export type AdapterStatus = "ready" | "downloading" | "unavailable";

export type AdapterInfo = {
	name: "chrome-nano" | "mock";
	status: AdapterStatus;
	note: string;
};
