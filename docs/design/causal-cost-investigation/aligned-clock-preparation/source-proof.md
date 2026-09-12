# Fixed-platform clock qualification proof

Preparation only under aligned-runtime-design.md at 8ae1cffd and the user's “好的，继续”. No consumer, provider, or performance qualification.

The downloaded Node v24.18.0 source bytes are indexed by URL and SHA-256 in sources.json; platform.json binds the executable and Darwin timebase. This is source correspondence for the installed version, not a reproducible binary-build attestation.

node_perf.cc performanceNow subtracts performance_process_start from uv_hrtime and converts nanoseconds to milliseconds. uv.gyp selects unix/darwin.c, where uv__hrtime multiplies mach_continuous_time by numer then divides by denom. V8 time.cc TimeTicks::Now uses mach_absolute_time, truncates ticks/1000 before timebase conversion, and adds one microsecond. profile-generator.cc captures start/finish TimeTicks, and v8-profiler-agent-impl.cc exposes these with integer sample deltas. Both profiler timestamps occur within their respective JavaScript request/reply brackets. The copied SDK mach_time.h documents continuous time advancing across system sleep unlike absolute time.

Thus exact fixed offset cannot be assumed. Parent native reads enclose the entire child: A_before, C, A_after. C-A is accumulated sleep, nondecreasing. Its full in-child variation is bounded by max-final(C-A_before) minus max(0,initial(C-A_after)), converted to ms. Native call scheduling widens this bound; it cannot improve acceptance.

V8 integer conversion has full error variation strictly below (999*numer/(1000*denom)+1) microseconds. libuv adds less than 1ns variation. A conservative 16-ulp timestamp arithmetic allowance is also included. ε is the sum of these full variations and the sleep bound. Each instantaneous offset therefore belongs to BOTH expanded endpoint intervals; their intersection encloses all offsets, without fitting a slope or selecting a midpoint. Width must be nonnegative and <=0.1ms. Native overflow is rejected. Platform assumptions are Darwin's shared Mach epoch, fixed timebase and nondecreasing accumulated sleep.

Five synthetic tests cover exact fractional rounding residues, malformed profiles, sleep widening, a wide bracket rejection, and launcher stop/single-use/resource limits with a fake supervisor (zero subprocesses). Independent read-only review accepted the full-variation proof and identified the libuv rounding term, now included. Its suggested relaxation of A_after<=C was already satisfied by the inspected implementation (which checks A_before<=C).

The probe plan allows at most three independent CPU probes (two known 75ms functions each, 250us requested sampling) followed by one two-forced-GC probe. Stop at first failure, no retry: 10s per child, 40s total, observed RSS/directory <=256MiB; profile <=1s/32MiB/200k samples/100k nodes. Single-use claim precedes dispatch. Real consumer executions remain zero. Passing probes alone would not qualify capture tooling.
