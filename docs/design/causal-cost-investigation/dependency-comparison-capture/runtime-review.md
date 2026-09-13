# Attempt runtime binding

Second independent static reviewer `capture_static_guard` identified that the frozen collector's
Node selection is PATH-based, while its executable rechecks are reservation-relative. The frozen
build-tools file retaining the old Node alone does not force selection of that Node.

This attempt pins PATH to the frozen Node bin followed only by system bins. Before dispatch,
runtime-preflight.json records and asserts the absolute Node path and executable SHA256 against
frozen build-tools.json. The wrapper passes this exact environment to the unmodified collector;
the collector dispatches its recorded absolute executable and checks its hash before every child.
Post-capture verification must assert the same reservation path/hash and PATH. This closes the
specific attempt gap; it does not claim the reusable collector independently enforces it.

Reviewer accepted this mitigation and found no other dispatch blocker in approval claim, schedule,
resource/continuity checks, failure handling or numerical-report gating. No consumers were executed
by the reviewer. Prior independent tooling review and its fixes remain recorded in preparation.
