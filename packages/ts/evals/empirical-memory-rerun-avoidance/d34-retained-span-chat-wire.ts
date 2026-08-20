import { empiricalSha256, empiricalStrictJsonDigest, record, strictSnapshot } from "./canonical.js";
import type { D34RetainedSpanDirectiveV1 } from "./d34-retained-span-mutation-authority.js";

export const D34_CHAT_WIRE_REVISION = "graphrefly-ts.d34.retained-span-chat-wire.v1" as const;
export const D34_MAX_WIRE_BYTES = 2 * 1_048_576;

export interface D34LoweredChatWireV1 {
	readonly revision: typeof D34_CHAT_WIRE_REVISION;
	readonly directiveDigest: string;
	readonly bodyDigest: string;
	readonly bytes: Uint8Array;
}

export interface D34ProjectedProposalV1 {
	readonly revision: typeof D34_CHAT_WIRE_REVISION;
	readonly directiveDigest: string;
	readonly responseDigest: string;
	readonly proposalCount: number;
	readonly newTextProposals: readonly string[];
	readonly projectionDigest: string;
}

function decode(bytesValue: Uint8Array, path: string): Record<string, unknown> {
	if (!(bytesValue instanceof Uint8Array) || bytesValue.byteLength > D34_MAX_WIRE_BYTES)
		throw new TypeError(`${path} exceeded its byte bound`);
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(new Uint8Array(bytesValue)));
	} catch (error) {
		throw new TypeError(`${path} is not JSON`, { cause: error });
	}
	return record(value, path);
}

function exactFunction(value: unknown, path: string): Record<string, unknown> {
	const tool = record(value, path);
	const fn = record(tool.function, `${path}.function`);
	if (typeof fn.name !== "string") throw new TypeError(`${path}.function.name is invalid`);
	return fn;
}

export function lowerD34RetainedSpanChatBody(input: {
	readonly bodyBytes: Uint8Array;
	readonly directive: D34RetainedSpanDirectiveV1;
}): D34LoweredChatWireV1 {
	const body = decode(input.bodyBytes, "D34 Chat request");
	if (!Array.isArray(body.tools) || body.tools.length < 1 || body.tools.length > 16)
		throw new TypeError("D34 Chat request tools are invalid");
	const matches = body.tools.filter(
		(tool, index) =>
			exactFunction(tool, `D34 Chat request.tools[${index}]`).name === "replace_exact",
	);
	if (matches.length !== 1)
		throw new TypeError("D34 Chat request does not contain one exact mutation tool");
	const proposalTool = strictSnapshot({
		type: "function" as const,
		function: {
			name: input.directive.namedToolName,
			description:
				"Propose only byte-different replacement text for the exact Graph-retained current span.",
			parameters: {
				type: "object",
				additionalProperties: false,
				required: ["newText"],
				properties: {
					newText: {
						type: "string",
						minLength: 1,
						maxLength: input.directive.maxNewTextBytes,
					},
				},
			},
		},
	});
	const lowered = strictSnapshot({
		...body,
		tools: [proposalTool],
		tool_choice: {
			type: "function" as const,
			function: { name: input.directive.namedToolName },
		},
	});
	const bytes = Buffer.from(JSON.stringify(lowered), "utf8");
	if (bytes.byteLength > D34_MAX_WIRE_BYTES)
		throw new TypeError("D34 lowered Chat request exceeded its byte bound");
	return Object.freeze({
		revision: D34_CHAT_WIRE_REVISION,
		directiveDigest: input.directive.directiveDigest,
		bodyDigest: empiricalSha256(bytes),
		bytes: new Uint8Array(bytes),
	});
}

export function projectD34RetainedSpanChatResponse(input: {
	readonly responseBytes: Uint8Array;
	readonly directive: D34RetainedSpanDirectiveV1;
}): D34ProjectedProposalV1 {
	const body = decode(input.responseBytes, "D34 Chat response");
	if (!Array.isArray(body.choices) || body.choices.length !== 1)
		throw new TypeError("D34 Chat response choices are invalid");
	const choice = record(body.choices[0], "D34 Chat response.choices[0]");
	const message = record(choice.message, "D34 Chat response message");
	const calls = message.tool_calls;
	if (calls === undefined) {
		const material = strictSnapshot({
			revision: D34_CHAT_WIRE_REVISION,
			directiveDigest: input.directive.directiveDigest,
			responseDigest: empiricalSha256(input.responseBytes),
			proposalCount: 0,
			newTextProposals: [] as const,
		});
		return Object.freeze({ ...material, projectionDigest: empiricalStrictJsonDigest(material) });
	}
	if (!Array.isArray(calls) || calls.length > 4)
		throw new TypeError("D34 Chat response proposal count exceeded its bound");
	const proposals = calls.map((call, index) => {
		const fn = exactFunction(call, `D34 Chat response.tool_calls[${index}]`);
		if (fn.name !== input.directive.namedToolName || typeof fn.arguments !== "string")
			throw new TypeError("D34 Chat response used a wrong proposal tool");
		if (Buffer.byteLength(fn.arguments, "utf8") > 262_144)
			throw new TypeError("D34 Chat proposal arguments exceeded their bound");
		let argsValue: unknown;
		try {
			argsValue = JSON.parse(fn.arguments);
		} catch (error) {
			throw new TypeError("D34 Chat proposal arguments are not JSON", { cause: error });
		}
		const args = record(argsValue, `D34 Chat response.tool_calls[${index}].arguments`);
		if (Object.keys(args).length !== 1 || typeof args.newText !== "string")
			throw new TypeError("D34 Chat proposal arguments are not exact");
		if (
			args.newText.length === 0 ||
			Buffer.byteLength(args.newText, "utf8") > input.directive.maxNewTextBytes
		)
			throw new TypeError("D34 Chat newText exceeded its bound");
		return args.newText;
	});
	const material = strictSnapshot({
		revision: D34_CHAT_WIRE_REVISION,
		directiveDigest: input.directive.directiveDigest,
		responseDigest: empiricalSha256(input.responseBytes),
		proposalCount: proposals.length,
		newTextProposals: proposals,
	});
	return Object.freeze({ ...material, projectionDigest: empiricalStrictJsonDigest(material) });
}
