# spending-alerts

This directory contains two different examples. The original five-hop pipeline
explains how an anomalous transaction produces an alert message. The private Causal
integration demonstrates admission, retained obligations and graded consumption
with an **offline simulated writer**. Neither command writes a real inbox.

## Original five-hop pipeline

```sh
pnpm --filter @graphrefly-examples/spending-alerts start
```

```text
txFeed → anomalyScore → thresholdGate → reasonFactors → alertMessage
             ↑
      vendorStats + userProfile
```

The original [pipeline](pipeline.ts) uses
`graph.describe({ explain: { from: "txFeed", to: "alertMessage" } })` to explain
its dependency chain. It does not provide the complete Causal admission and host
lifecycle proof described below.

## Private Causal integration

Run from the repository root:

```sh
node --import tsx examples/spending-alerts/causal-graded-demo.ts
```

The output contains the complete graph plus a `composition` summary. It runs two
instances, A and B, in the same Graph: A waits for its simulated result while the
panel switches to B; B succeeds without settling A; A then completes while its
panel is detached, and reconnecting does not write again. Expect
`aPendingAfterB: 1`, `bSucceededWhileAPending: "succeeded"` and
`writes: { "a": 1, "b": 1 }`. `evidenceNavigation` connects each actual publication
to its request, admission, outcome and fixture verification reference. These are
executed assertions, not a human usability experiment.

These are consumer-private source imports, **not published package subpaths**.
The fixture oracle supplies independent expected results for this finite example;
it is not a production verification service. The writer simulates completion in
memory. Input messages in the demo are test-boundary facts, not new public
feed/publish/approve methods.

Choose a reading path:

| Your task | Start here | What remains with the application |
|---|---|---|
| Display business values | [ordinary panel](causal-ordinary-panel.ts), then [value binding](causal-view-binding.ts) | Construction, input sources, permissions, resource and running owner |
| Integrate or compose components | [complete application demo](causal-graded-demo.ts), then [creation entry](causal-entry.ts) and [role examples](causal-audience.examples.ts) | Verification and permission provenance, original capabilities, lifecycle ownership |
| Understand the executing system | The demo's actual graph and request records, then [host](causal-focused-host.ts) and [authority construction](../../packages/ts/src/solutions/causal-occurrence/construction.ts) | Interpreting exact source, admission, outcome and evidence bindings |

The application creates five actual input Nodes in four groups:

| Input group | Explicit source responsibility |
|---|---|
| evaluations | Immutable evaluation pack, arrivals and current input/policy facts |
| verification | Receipt from the independent fixture verifier, bound to the evaluated material |
| localAuthority | Permission grants, logical tick and stop facts; no default approval |
| inbox | The separately prepared `OfflineAlertResource` with its exact binding |

It then calls `spendingAlertsFor(graph, { name: "alerts" }).compose(inputs)`.
Configuration allocates no graph nodes; compose creates a complete runtime.
Defaults are immutable, diagnostics defaults to off, and local overrides only
select name/diagnostics. Distinct instances use distinct names, input Nodes and
resource bindings. A name is not an authorization token.

Display components receive only the original `.view`; frameworks pass the original
identity/execution/retained capabilities; maintainers inspect the same Graph.
Showing an identity subset does not remove lifecycle or retained-evidence nodes.
Capabilities have no arbitrary I/O execution method. The application keeps the
original owner and diagnostics. Fixed wiring passes the intended instance's
original references without introducing another identity registry.

## Interpret observations accurately

| Observation | Meaning |
|---|---|
| Missing value or ERROR/INVALIDATE | No current usable fact on that port; do not retain the old displayed value |
| Startup says started | The instance started; it does not prove authorization, success or run completion |
| Assessment flags a transaction | The business condition is met; evidence and permission are still required |
| Publication says succeeded | That exact request reports success in the simulated writer; other obligations and coverage remain separate |
| Coverage/issues | Facts for their associated scope; the five latest port values are not an atomic snapshot |
| Panel detach | Observation stops; the running instance retains outstanding obligations |
| Application `runEndReady` / `inspect().normalEndReady` | Current graph/host readiness conditions, not proof that lifecycle termination or resource release occurred |

For integrators, this host supports at most 64 retained distinct request records
per owned epoch, including refusals, and one in-flight write. A busy or exhausted
write budget produces an exact cancelled/no-submit result; there is no queue or
automatic retry. An unknown or reconciliation-required outcome is not success or
proof of no submission, and it prevents normal-end readiness. The application
must preserve those records instead of treating panel cleanup as recovery.

The ordinary panel does not poll diagnostics or claim that the whole run ended.
The protocol has no END message: business stop, node COMPLETE and run termination
are distinct. Retention remains bounded by the existing contract, not by whether
someone is viewing the graph. The demo's final forced test cleanup does not prove
normal lifecycle completion.

The private value binding clears stale values on INVALIDATE and ERROR. The existing
public `subscribeNodeValues` adapter currently ignores INVALIDATE, so it is not a
direct substitute for this particular view contract.

## Inspect code changes and evidence

Follow the actual request, admission and outcome references in the demo output to
the running graph. Then distinguish these three questions:

| Question | Evidence required |
|---|---|
| Did this node's implementation change despite unchanged ID/edges? | Revision-bound source mapping within its declared coverage |
| Who changed it? | Separate provenance; an implementation digest alone gives no attribution |
| Which consequences remain unchanged? | Independent verification bound to the current revision and inputs |

Missing source binding means uncovered; missing provenance means unknown. An old
receipt does not verify a new implementation. Existing bounded source-change and
mutation evidence can be inspected in the [implementation review](../../docs/design/causal-graded-entry-implementation/README.md).
Those retained artifacts describe their own revisions; the new demo does not
requalify them or attest the loaded production source.

The example and offline tests demonstrate available composition paths, not a
human usability result or superiority to a complete plain-code host. B121's real
inbox qualification, independent human/agent comparisons and aggregate acceptance
remain separate.
