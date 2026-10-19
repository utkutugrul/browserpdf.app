# Initial handoff read continuity checkpoint

This is the approved first platform continuity checkpoint after a28b4ee. It does
not close Metadata, Privacy, Doctor, Protect, Unlock, Workflows, locales or the
32-service program. The implementing owner has not run a browser, globalSetup, fixture writer,
server lifecycle, commit, push or deploy. Root-owned native gates are recorded
separately below.

## Runtime contract

`tool-ui.takeChainedFile(options = {})` keeps `Promise<File|null>` compatibility.
Its new runtime-only fields are `signal` and `isCurrent`. Empty and unrelated
URLs return before loading handoff/session/store support. The wrapper captures
its exact pre-read canonical owner and intake generation, checks before/after
optional module loading and after helper completion. The internal helper keeps
its third environment argument and adds the fourth optional guard argument.
It checks before loading and after session/store/cleanup/workflow/file awaits,
before File construction and before delivery. Aborted/stale/error reads return
null. Storage/module retry behavior and typed descriptors remain compatible.

`readPdfFile` retains its validation and synchronous commit timing. Its existing
`{bytes,baseName}` return adds `owner:{taskId,revision,generation}`, extracted
immediately from the successful `documentSession.begin` return. It never samples
a later unrelated snapshot to identify its own commit.

The four old entry patterns now capture native choice intent before validation
or awaits, including rejected candidates. Initial consumers retain the owner
captured before their descriptor read. Each read operation combines exact
precommit owner and local intent. Only its own returned commit owner may install
a surface. Accepted module/workspace construction has a separate lifetime from
a newer candidate choice: that construction drains before replacement validation,
so a rejected replacement leaves the accepted surface usable. Fully installed
surfaces retain their own ordinary edits/history through task lifetime checks.

Object/page/effect/Reader adapters release a previous surface only after a
replacement validates and begins. Successful native Reader installation also
removes the preceding workflow URL, while rejection and inherited intake retain it. Page effects retain their existing suspend and
resume behavior. The initial implementation changed no shared workspace API;
the later Root-approved rejection-feedback option is described below. Initial descriptor reads stay
outside the accepted-construction drain, so an old held IndexedDB read cannot
block newer native B.

Merge invalidates initial intent on every native file choice and Clear, before
admission checks. Clear is reachable while an initial descriptor is pending.
Its initial mutating `readPdfFile` is guarded before source-queue admission;
the accepted initial source batch transfers to its exact canonical owner and
import-epoch lifetime through external read/parser awaits. Later native additive
choices, including a rejected source, retain accepted A. Clear releases that
initial canonical A only when its task/revision/generation and import epoch still
match; a newer chosen or unrelated task survives Clear. Ordinary native batches remain additive and keep existing reservations,
ordering and cancellation. Accepted native source imports and Clear remove the
old workflow URL; rejected native files retain it.

`stashForChain` is byte-for-byte unchanged. Store/session/result/font/loader APIs,
resource limits and same-task newer-bundle write guards are unchanged. No new
persisted property, password, arbitrary URL or metadata bag is introduced.

## Source ownership

Product paths: document-handoff.js, tool-ui.js, object-route.js, page-route.js,
page-effects-route.js, view-pdf.js and merge.js. The later rejection-feedback
correction also owns the explicitly approved page-effects-workspace.js path. Tests: document-handoff.unit.mjs
and initial-handoff.spec.mjs. This checkpoint document belongs to this owner;
Root owns the independent evidence ledger. Concurrent P3 core files and all
forty untracked audit files are outside the checkpoint.

## Verification so far

The first owned handoff file passed 22/22 in 58.037917 ms, zero failed/skipped/
canceled. It retains all five prior stash/composition cases and adds fifteen
held read-boundary versus native-B/Clear/rejected-B cases, abort/storage retry
with exact typed descriptors, and actual tool-ui intake owner replacement via
microtask before the caller resumes.

After the final wrapper/caller pre-read owner checks, the affected Node gate
passed 44/44 in 422.612209 ms, zero failed/skipped/canceled:

```
rtk proxy node --test tests/document-handoff.unit.mjs tests/document-display-name.unit.mjs tests/composition-state.unit.mjs tests/reader-text.unit.mjs
```

Retained output: `/tmp/browserpdf-initial-handoff-owned-node-first-20261019.tap`.
All seven product files and two owned tests pass `node --check`.
`git diff --check` passes. Source lengths/SHA-256 values are recorded in
`/tmp/browserpdf-initial-handoff-source-20261019.json`. These are Node/source
checks only. No browser artifact or route acceptance is claimed yet.

## Proposed allocated native gate

The first `tests/initial-handoff.spec.mjs` matrix defined twenty cases:

- Ten native completed-READ/ready-B cases: shared object, page, effect, Reader
  and Merge patterns, each in English and Turkish with entry-local module URLs.
- Native Merge Clear while completed initial READ delivery is held.
- Rejected native B invalidating old initial A, followed by usable fresh B.
- Four cold accepted-A module/opening versus rejected-B cases, one per shared
  workspace pattern.
- Four late initial Merge source cases after canonical A has committed: native
  Clear followed by B before stale A drains; additive valid B; actually malformed
  PDF B rejected after native read; and Clear preserving a newer unrelated
  canonical task selected through the actual public validated intake API.

Each test creates its own in-memory PDFs. The initial-read harness pauses the
consumer of an actually completed native readonly IndexedDB transaction.
A delegation-only observer awaits the actual handoff helper Promise; it does
not replace storage, parser, guard, File or caller behavior. It asserts old A's
File was never read after losing intent, exact B canonical/task/original SHA
where the route owns a current PDF, stable URL and no navigation, then a native
editor continuation, fresh edit and one actual explicit downloaded/reopened PDF.
Merge preserves its source-list model and produces B plus an explicit added C
as a three-page result. Other ready-B outputs retain two pages. Cold rejected-B
cases retain A and export a fresh edit through their working surface.
Every case checks zero page errors/non-GET requests and one explicit download.

Root allocated the first twenty-case window with frozen source, workers1 and
retries0. Its retained result and cause-backed corrections are recorded below.
The focused correction gate and retained handoff/storage/expiry/route/idle
regressions still require Root allocation.
The observed Privacy idle baseline was 97,413 local source bytes/twelve requests;
static deltas are estimates, and the unchanged <100,000-byte/<=16-request budget
still needs an actual allocated gate after this shared tool-ui change.

## Fresh review corrections, pending native verification

The read-only review at
`/tmp/browserpdf-initial-handoff-fresh-review-20261019.md` found three issues:
Reader query cleanup, Merge late accepted-source ownership and the test helper's
undefined-name assertion. All three source corrections are now applied only in
View/Merge/the owned spec. The VM controls in the retained review were read as
control-flow evidence, not native acceptance. `ready()` checks a filename only
when its caller supplies one; saved-artifact assertions remain unchanged.

The late Merge harness releases the earlier completed workflow READ and holds
A's second actual `File.arrayBuffer` result, after native bytes finish and after
canonical A commits. This is the real external source intake boundary. A
second delegation-only observer awaits the actual external helper Promise;
controls verify settlement, queue readiness, exact task/current/original SHA,
source order and actual final downloaded/reopened PDF content. Clear followed
by ready native B must remain empty canonically until a result is chosen; stale
A cannot reinsert or revive. Additive valid/rejected B preserves accepted A and
its immutable original. The unrelated-task control uses the real public
File/PDF validators because Merge's native file input is additive; it is an API
ownership control alongside the three native source controls.

The qualified opening latency noted by the reviewer remains explicit: a valid
replacement waits for the preceding accepted module/workspace construction
before validation. Current cold-open tests cover rejection restoration, not a
bounded responsiveness promise for a held optional module. Root owns the
separate scheduling/drain policy decision; shared entry helpers remain frozen.

During these corrections Root runs the independent AddText-only original-prefix
postfix. This owner edited only excluded View/Merge/spec/doc paths and ran only
syntax/source checks. No browser/globalSetup/server/shared fixture activity or
new native acceptance is claimed here. The previous 44/44 Node result remains
retained for the unchanged helper/session/name paths; it does not establish the
new late Merge or Reader route behavior.


## Independent Root Add Text original-prefix postfix

Root reports the original native Add Text prefix passed on its first postfix
invocation at `/tmp/browserpdf-root-initial-handoff-postfix-first/report.json`
and `source-closure.json`. All 244 frozen source hashes remained unchanged;
concurrently permitted View/Merge/spec paths were never requested. The real
helper settled, stale A File reads were zero, fully ready B retained its exact
task/current SHA and clean URL, and a fresh edit produced an actual two-page
5,960-byte PDF, SHA-256
`c8304ea02ebd29348e28730e221dc591d9cec909ba6af05074b74187ede02ec9`.
Root independently reopened new B markers plus the new edit and no old A.
That journey recorded zero page errors/non-GET requests and two explicit
Downloads, including its original reference artifact. Root closed the browser.
This is independent Add Text evidence only; the corrected twenty-case portable
matrix and late Merge/Reader native acceptance remain pending.


## First twenty-case native gate and seven corrections

Root's first twenty-case invocation finished **13 passed / 7 failed** in
**233,361.636 ms**, zero skipped/flaky/top-level errors. All **272** frozen
source hashes remained unchanged. The original result is
`/tmp/browserpdf-initial-handoff-native-20261019-results.json` with retained
traces in the matching `-output` directory. It is not a clean full gate.

Four Turkish SHA-null failures came from the test observer selecting the
worker-injected absolute i18n module, then a separate root tool-ui session.
All six observer sites now select the actual relative tool entry, preserving
exact task/current/original SHA and native saved-artifact assertions. Two Reader
failures clicked a native continuation button inside closed `#readerModes`;
the helper now opens its real summary before the existing mode button. These
six are test-only corrections, backed by Root's namespace observation and the
retained native traces/source.

The seventh is a product feedback race: after rejected B, the retained A
surface resumes and its successful saved-PDF preview called `hideError`,
erasing the rejection banner. Root approved only this additional workspace
seam: `resume({preserveError=false}={})` passes the flag through that one
schedule/prepare invocation. The rejected-owned entry passes true. Success
retains B's error for that resumed preview; a later user edit schedules with
default false and clears stale feedback after success. A preview failure still
publishes its own error. The flag is captured per invocation, with no new
persisted or task state. The original cold case keeps its strict post-ready
error visibility and actual retained-A artifact checks.

One added native case verifies rejection after resume, successful start 7
clearing it, invalid start -1 producing its exact new core error, successful
start 9 clearing that failure, then actual review/Use/native editor continuation
and one downloaded/reopened two-page PDF with 9/10, source text and a new edit.
The suite now defines **21** cases; the proposed focused gate is the seven
retained failures plus this new case. It has not run. This does not replace
native proof with unit controls or claim a clean full 21-case invocation.

Detailed classification:
`/tmp/browserpdf-initial-handoff-failed7-classification-20261019.md`.
Current ten-path hashes, including the approved workspace, and syntax checks:
`/tmp/browserpdf-initial-handoff-failed7-corrections-source-20261019.json`.
The three corrected JS files pass syntax checks and `git diff --check` passes.
The earlier 44/44 Node result remains historical for its unchanged scope; no
new Node run is claimed or substituted for the pending native correction gate.


## Accepted initial READ continuity, 2026-10-19

Root's corrected native matrix passes **21/21 in 66,839.374 ms**, zero failed,
skipped, flaky or top-level errors. All 21 saved PDFs and traces remain at
`/tmp/browserpdf-initial-handoff-native-corrected-20261019-output`; the result is
`/tmp/browserpdf-initial-handoff-native-corrected-20261019-results.json`.
Root independently reopens all 21 actual artifacts with strict pdf-lib loading
and Node PDF.js text checks, preserving page counts, source identity/order,
edits and page numbers 9/10:
`/tmp/browserpdf-root-continuity-artifacts-20261019.json`.

The separate actual initial-delivery gate passes **1/1 in 756.662 ms**, zero
failed/skipped/flaky/top-level errors, with one retained trace:
`/tmp/browserpdf-initial-handoff-native-idle-20261019-results.json`.
Its unchanged five-route assertions require fewer than 100,000 requested
first-party JavaScript bytes and at most 16 requests; no threshold was raised.
The combined configuration collected zero idle cases, so only this separate
invocation establishes the idle result. Both final closures record all **272**
frozen sources unchanged, exact path inventory/configuration, no excluded DOCX
runtime imports, no globalSetup and no server lifecycle activity. The corrected
matrix and separate idle invocation retain **22 traces** in total.

The original **13 passed / 7 failed in 233,361.636 ms** result and traces remain
unchanged. Four failures were Turkish observers using the wrong module/session
namespace, two were Reader continuation clicks inside a closed disclosure, and
one was the product rejection-feedback race. Their cause-backed corrections
preserve exact ownership and saved-artifact assertions; the added twenty-first
case proves resumed feedback, later successful edits and later validation errors.
The final focused quality review finds no actionable issue, with all ten frozen
runtime/test hashes matching before and after:
`/tmp/browserpdf-initial-handoff-final-corrections-review-20261019.md`.

The earlier independent Add Text original-prefix postfix remains separate
accepted evidence. The retained **44/44 Node** result covers unchanged handoff
reads/held writes, display names, composition, reader text and resource contracts;
it contains no workflow-store unit case. Store/session source and the stash
write prefix remain byte-identical. Existing store/expiry evidence is retained;
no new store/expiry invocation or Node rerun is claimed here.

This accepts only the narrow initial READ continuity checkpoint. The historical
opening-latency qualification remains; remaining platform/conversion services,
complete locales and final all-32 acceptance remain open.
