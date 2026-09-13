# RSS observation repair

User authorized repair through collection of complete evidence after f967f265. This private observer
repair leaves library, sample body, B/C/input, frozen eight-group order, 32-process workload, timing
metrics, 256MiB cap, 30s/child, 900s/attempt and continuity conditions unchanged. Old failure stays failed.

Each ps query retains start/end, raw stdout/stderr/returncode, PID/state/RSS and Popen poll before/after.
A positive same-PID RSS is retained and checked against the existing cap even if exit follows.
A zero is a terminal observation only with same-PID Z state and a confirmed process exit after query.
An empty response is terminal only with rc1, empty stdout/stderr and confirmed exit. Everything else
nonpositive/malformed remains invalid. Terminal records are retained verbatim, not deleted or counted as
zero memory. Require at least one positive RSS observation; include last-positive-to-exit gap in maximum
observation interval. Existing host observation gap guard remains; polling is not a continuous bound.

Independent verifier reconstructs positive RSS from raw records, checks sticky exit state and final exit
code, rejects post-exit observations and retains terminal records in raw evidence. Numerical formulas
and control thresholds unchanged. Runtime evidence cannot retroactively resolve the original missing
process-state observation. Failures stop remaining dispatches; no result-dependent sample selection.
