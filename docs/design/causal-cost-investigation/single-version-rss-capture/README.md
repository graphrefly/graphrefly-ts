# RSS repair capture — incomplete, retained

User authorized repair through complete evidence collection. The first repaired attempt qualified29
of32processes, dispatched30, stopped remaining2, and made no within-attempt retry. At job29 ps returned
samePID19728, state`?Es`, RSS0; both immediate polls were pending. Cleanup signal returned EPERM and
original cleanup skipped wait, so the retained exit code is null. A subsequent read-only ps query found
that PID absent; it does not rewrite the failed exit receipt or prove its original exact exit time.

Attempt45.986585s, maximum positive observed RSS157.75MiB, no demonstrated memory excess.
[report.json](report.json) is a failed, nonnumerical report. It cannot yield a32process comparison.
546-file [archive](../../../../archive/evals/causal-single-version-rss-capture-v1/artifact-index.json)
was hash-verified and reproduced the failed report byte-identically without executing consumers.

The retained process-state evidence motivated a bounded E/Z exit settlement repair. Local Darwin
ps(1) documents E as trying to exit. The second repaired tool waits at most0.5s for confirmed exit,
retains that interval and result, and still rejects unknown/timeout/error; cleanup always attempts wait
when signal delivery errors. See [v2 result](../single-version-rss-v2-capture/README.md).
Old samples are not spliced into a later attempt and this failure remains failed. No library changes.
