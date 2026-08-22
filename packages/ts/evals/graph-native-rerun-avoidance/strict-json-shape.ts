import type { StrictJsonValue } from "../../src/json/codec.js";
import {
	array,
	boolean,
	coordinate,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	fail,
	finiteNumber,
	literal,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
	string,
} from "./canonical.js";
import type {
	EmpiricalOutputSchemaCatalogEntryV1,
	EmpiricalSchemaCatalogV1,
	EmpiricalStrictJsonShapeV1,
	EmpiricalToolSchemaCatalogEntryV1,
} from "./contracts.js";

export const EMPIRICAL_STRICT_JSON_SHAPE_SCHEMA_VERSION =
	"graphrefly.private-solution-eval.strict-json-shape.v1" as const;

const MAX_SHAPE_DEPTH = 12;
const MAX_SHAPE_NODES = 512;
const MAX_PROPERTIES = 128;
const MAX_VARIANTS = 16;
const MAX_COLLECTION_ITEMS = 256;
const MAX_STRING_LENGTH = 32_768;

interface ShapeValidationState {
	nodes: number;
}

export function validateEmpiricalStrictJsonShape(
	value: unknown,
	path = "shape",
	state: ShapeValidationState = { nodes: 0 },
	depth = 0,
): EmpiricalStrictJsonShapeV1 {
	state.nodes += 1;
	if (state.nodes > MAX_SHAPE_NODES) fail(path, "exceeds the strict-json-shape node limit");
	if (depth > MAX_SHAPE_DEPTH) fail(path, "exceeds the strict-json-shape depth limit");
	const shape = record(value, path);
	const kind = string(shape.kind, `${path}.kind`);
	if (kind === "null" || kind === "boolean") {
		exactKeys(shape, ["kind"], path);
		return strictSnapshot({ kind });
	}
	if (kind === "number" || kind === "integer") {
		exactKeys(shape, ["kind", "maximum", "minimum"], path);
		const minimum = shape.minimum === null ? null : finiteNumber(shape.minimum, `${path}.minimum`);
		const maximum = shape.maximum === null ? null : finiteNumber(shape.maximum, `${path}.maximum`);
		if (minimum !== null && maximum !== null && minimum > maximum) {
			fail(path, "minimum cannot exceed maximum");
		}
		if (
			kind === "integer" &&
			((minimum !== null && !Number.isSafeInteger(minimum)) ||
				(maximum !== null && !Number.isSafeInteger(maximum)))
		) {
			fail(path, "integer bounds must be safe integers");
		}
		return strictSnapshot({ kind, minimum, maximum });
	}
	if (kind === "string") {
		exactKeys(shape, ["enum", "kind", "maxLength", "minLength"], path);
		const minLength = safeInteger(shape.minLength, `${path}.minLength`, {
			max: MAX_STRING_LENGTH,
		});
		const maxLength = safeInteger(shape.maxLength, `${path}.maxLength`, {
			max: MAX_STRING_LENGTH,
		});
		if (minLength > maxLength) fail(path, "minLength cannot exceed maxLength");
		let enumValues: readonly string[] | null = null;
		if (shape.enum !== null) {
			const values = array(shape.enum, `${path}.enum`);
			if (values.length === 0 || values.length > 128) {
				fail(`${path}.enum`, "expected between 1 and 128 values");
			}
			enumValues = values.map((entry, index) => string(entry, `${path}.enum[${index}]`, maxLength));
			if (new Set(enumValues).size !== enumValues.length) {
				fail(`${path}.enum`, "values must be unique");
			}
			if (enumValues.some((entry) => entry.length < minLength || entry.length > maxLength)) {
				fail(`${path}.enum`, "values must satisfy the declared string bounds");
			}
		}
		return strictSnapshot({ kind, minLength, maxLength, enum: enumValues });
	}
	if (kind === "array") {
		exactKeys(shape, ["items", "kind", "maxItems", "minItems"], path);
		const minItems = safeInteger(shape.minItems, `${path}.minItems`, {
			max: MAX_COLLECTION_ITEMS,
		});
		const maxItems = safeInteger(shape.maxItems, `${path}.maxItems`, {
			max: MAX_COLLECTION_ITEMS,
		});
		if (minItems > maxItems) fail(path, "minItems cannot exceed maxItems");
		return strictSnapshot({
			kind,
			items: validateEmpiricalStrictJsonShape(shape.items, `${path}.items`, state, depth + 1),
			minItems,
			maxItems,
		});
	}
	if (kind === "object") {
		exactKeys(shape, ["additionalProperties", "kind", "properties"], path);
		literal(shape.additionalProperties, false, `${path}.additionalProperties`);
		const propertyValues = array(shape.properties, `${path}.properties`);
		if (propertyValues.length > MAX_PROPERTIES) {
			fail(`${path}.properties`, `expected at most ${MAX_PROPERTIES} properties`);
		}
		const properties = propertyValues.map((entry, index) => {
			const propertyPath = `${path}.properties[${index}]`;
			const property = record(entry, propertyPath);
			exactKeys(property, ["name", "required", "shape"], propertyPath);
			return {
				name: string(property.name, `${propertyPath}.name`, 256),
				required: boolean(property.required, `${propertyPath}.required`),
				shape: validateEmpiricalStrictJsonShape(
					property.shape,
					`${propertyPath}.shape`,
					state,
					depth + 1,
				),
			};
		});
		if (new Set(properties.map((property) => property.name)).size !== properties.length) {
			fail(`${path}.properties`, "property names must be unique");
		}
		return strictSnapshot({ kind, properties, additionalProperties: false as const });
	}
	if (kind === "one-of") {
		exactKeys(shape, ["kind", "variants"], path);
		const variantValues = array(shape.variants, `${path}.variants`);
		if (variantValues.length < 2 || variantValues.length > MAX_VARIANTS) {
			fail(`${path}.variants`, `expected between 2 and ${MAX_VARIANTS} variants`);
		}
		return strictSnapshot({
			kind,
			variants: variantValues.map((variant, index) =>
				validateEmpiricalStrictJsonShape(variant, `${path}.variants[${index}]`, state, depth + 1),
			),
		});
	}
	return fail(
		`${path}.kind`,
		"expected null, boolean, number, integer, string, array, object, or one-of",
	);
}

export function validateEmpiricalToolSchemaCatalogEntry(
	value: unknown,
	path: string,
): EmpiricalToolSchemaCatalogEntryV1 {
	const entry = record(value, path);
	exactKeys(entry, ["inputSchema", "inputSchemaDigest", "schemaRevision", "toolRef"], path);
	const inputSchema = validateEmpiricalStrictJsonShape(entry.inputSchema, `${path}.inputSchema`);
	const inputSchemaDigest = digest(entry.inputSchemaDigest, `${path}.inputSchemaDigest`);
	if (inputSchemaDigest !== empiricalStrictJsonDigest(inputSchema)) {
		fail(`${path}.inputSchemaDigest`, "does not match inputSchema");
	}
	return strictSnapshot({
		toolRef: coordinate(entry.toolRef, `${path}.toolRef`),
		schemaRevision: coordinate(entry.schemaRevision, `${path}.schemaRevision`),
		inputSchema,
		inputSchemaDigest,
	});
}

export function validateEmpiricalOutputSchemaCatalogEntry(
	value: unknown,
	path: string,
): EmpiricalOutputSchemaCatalogEntryV1 {
	const entry = record(value, path);
	exactKeys(entry, ["role", "schema", "schemaDigest", "schemaRef", "schemaRevision"], path);
	const schema = validateEmpiricalStrictJsonShape(entry.schema, `${path}.schema`);
	if (strictJsonShapeMatchesNull(schema)) {
		fail(`${path}.schema`, "role output schema root must not accept null");
	}
	const schemaDigest = digest(entry.schemaDigest, `${path}.schemaDigest`);
	if (schemaDigest !== empiricalStrictJsonDigest(schema)) {
		fail(`${path}.schemaDigest`, "does not match schema");
	}
	return strictSnapshot({
		schemaRef: coordinate(entry.schemaRef, `${path}.schemaRef`),
		role: oneOf(
			entry.role,
			["actor", "auxiliary-judge", "semantic-redactor"] as const,
			`${path}.role`,
		),
		schemaRevision: coordinate(entry.schemaRevision, `${path}.schemaRevision`),
		schema,
		schemaDigest,
	});
}

function strictJsonShapeMatchesNull(shape: EmpiricalStrictJsonShapeV1): boolean {
	if (shape.kind === "null") return true;
	if (shape.kind !== "one-of") return false;
	return shape.variants.filter(strictJsonShapeMatchesNull).length === 1;
}

export function validateEmpiricalSchemaCatalog(value: unknown): EmpiricalSchemaCatalogV1 {
	const catalog = record(value, "manifest.schemaCatalog");
	exactKeys(
		catalog,
		["catalogRevision", "outputs", "schemaVersion", "tools"],
		"manifest.schemaCatalog",
	);
	literal(
		catalog.schemaVersion,
		EMPIRICAL_STRICT_JSON_SHAPE_SCHEMA_VERSION,
		"manifest.schemaCatalog.schemaVersion",
	);
	const toolValues = array(catalog.tools, "manifest.schemaCatalog.tools");
	const outputValues = array(catalog.outputs, "manifest.schemaCatalog.outputs");
	if (toolValues.length === 0 || toolValues.length > 64) {
		fail("manifest.schemaCatalog.tools", "expected between 1 and 64 entries");
	}
	if (outputValues.length === 0 || outputValues.length > 16) {
		fail("manifest.schemaCatalog.outputs", "expected between 1 and 16 entries");
	}
	const tools = toolValues.map((entry, index) =>
		validateEmpiricalToolSchemaCatalogEntry(entry, `manifest.schemaCatalog.tools[${index}]`),
	);
	const outputs = outputValues.map((entry, index) =>
		validateEmpiricalOutputSchemaCatalogEntry(entry, `manifest.schemaCatalog.outputs[${index}]`),
	);
	if (new Set(tools.map((entry) => entry.toolRef)).size !== tools.length) {
		fail("manifest.schemaCatalog.tools", "toolRef values must be unique");
	}
	if (new Set(outputs.map((entry) => entry.schemaRef)).size !== outputs.length) {
		fail("manifest.schemaCatalog.outputs", "schemaRef values must be unique");
	}
	return strictSnapshot({
		schemaVersion: EMPIRICAL_STRICT_JSON_SHAPE_SCHEMA_VERSION,
		catalogRevision: coordinate(catalog.catalogRevision, "manifest.schemaCatalog.catalogRevision"),
		tools,
		outputs,
	});
}

export function assertEmpiricalStrictJsonShapeMatch(
	value: StrictJsonValue,
	shapeValue: EmpiricalStrictJsonShapeV1,
	path: string,
): void {
	const shape = validateEmpiricalStrictJsonShape(shapeValue);
	if (shape.kind === "null") {
		if (value !== null) fail(path, "expected null");
		return;
	}
	if (shape.kind === "boolean") {
		if (typeof value !== "boolean") fail(path, "expected boolean");
		return;
	}
	if (shape.kind === "number" || shape.kind === "integer") {
		if (
			typeof value !== "number" ||
			!Number.isFinite(value) ||
			(shape.kind === "integer" && !Number.isSafeInteger(value)) ||
			(shape.minimum !== null && value < shape.minimum) ||
			(shape.maximum !== null && value > shape.maximum)
		) {
			fail(path, `does not match ${shape.kind} bounds`);
		}
		return;
	}
	if (shape.kind === "string") {
		if (
			typeof value !== "string" ||
			value.length < shape.minLength ||
			value.length > shape.maxLength ||
			(shape.enum !== null && !shape.enum.includes(value))
		) {
			fail(path, "does not match string bounds");
		}
		return;
	}
	if (shape.kind === "array") {
		if (!Array.isArray(value) || value.length < shape.minItems || value.length > shape.maxItems) {
			fail(path, "does not match array bounds");
		}
		for (let index = 0; index < value.length; index += 1) {
			assertEmpiricalStrictJsonShapeMatch(
				value[index] as StrictJsonValue,
				shape.items,
				`${path}[${index}]`,
			);
		}
		return;
	}
	if (shape.kind === "object") {
		if (value === null || typeof value !== "object" || Array.isArray(value)) {
			fail(path, "expected object");
		}
		const objectValue = value as Readonly<Record<string, StrictJsonValue>>;
		const allowed = new Set(shape.properties.map((property) => property.name));
		for (const key of Object.keys(objectValue)) {
			if (!allowed.has(key)) fail(`${path}.${key}`, "additional property is forbidden");
		}
		for (const property of shape.properties) {
			if (!Object.hasOwn(objectValue, property.name)) {
				if (property.required) fail(`${path}.${property.name}`, "required property is missing");
				continue;
			}
			assertEmpiricalStrictJsonShapeMatch(
				objectValue[property.name] as StrictJsonValue,
				property.shape,
				`${path}.${property.name}`,
			);
		}
		return;
	}
	if (shape.kind !== "one-of") fail(path, "unsupported strict-json-shape kind");
	let matches = 0;
	for (const variant of shape.variants) {
		try {
			assertEmpiricalStrictJsonShapeMatch(value, variant, path);
			matches += 1;
		} catch (error) {
			if (!(error instanceof TypeError)) throw error;
		}
	}
	if (matches !== 1) fail(path, `expected exactly one matching variant, got ${matches}`);
}
