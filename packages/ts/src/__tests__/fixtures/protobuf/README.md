# GraphReFly Protobuf Golden Vectors

These fixtures exercise the D497 canonical protobuf wire profile over
`spec/protocol.proto`.

Fixture records use JSONL so each runtime can stream the same vectors:

- `schema`: always `graphrefly.protobuf.golden.v1`.
- `id`: stable vector id.
- `message`: protobuf message under test.
- `description`: short human-readable purpose.
- `hex`: raw protobuf bytes as lowercase hex.
- `canonical`: `true` for positive vectors, `false` for negative vectors.
- `errorCategory`: required when `canonical` is `false`.
- `expect`: optional small expectation hint for positive vectors.

The fixture values inside bridge DATA payloads use `StrictJsonFixtureValueV1`
bytes for readability only. They are not a production value codec, value
registry, storage hydration format, checkpoint replay format, or analytics
export format.

Current vector files:

- `wire_bridge_envelope.v1.jsonl`
- `wire_edge_cause.v1.jsonl`

`wire_edge_cause.v1.jsonl` replaced `wire_edge_frame.v1.jsonl` on 2026-11-11 (graphrefly:D803): a
wire edge group's cause is one `WireEdgeCause` frame (R-bridge@1), not one `WireEdgeFrame` per edge,
and the envelope's wire-edge payload moved to field 3, with field 2 reserved. The envelope vectors
that carried a wire-edge payload were rewritten with the same metadata. The `invalid_wire_edge`
vectors are frames a receiver's gate refuses whole: a kernel-only message, a terminal not last, an
array after the edge's terminal, an edge twice, or an edge with no array. The bytes were written by
hand from `spec/protocol.proto`; each runtime's decoder is their check.
