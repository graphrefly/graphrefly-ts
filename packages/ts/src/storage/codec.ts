/**
 * Storage codec re-exports.
 *
 * D96 moves stable/strict JSON to the neutral json module; storage keeps these public
 * names stable for existing D82 binding consumers.
 */

export {
	type Codec,
	jsonCodec,
	jsonCodecFor,
	stableJsonString,
	strictJsonCodec,
	strictJsonCodecFor,
} from "../json/codec.js";
