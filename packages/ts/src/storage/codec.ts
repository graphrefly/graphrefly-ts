/**
 * Storage codec re-exports.
 *
 * D96 moves stable/strict JSON to the neutral json module; storage keeps these public
 * names stable for existing D82 binding consumers.
 */

export {
	assertStrictJsonObject,
	assertStrictJsonValue,
	type Codec,
	jsonCodec,
	jsonCodecFor,
	type StrictJsonObject,
	type StrictJsonScalar,
	type StrictJsonValue,
	stableJsonString,
	strictJsonCodec,
	strictJsonCodecFor,
} from "../json/codec.js";
