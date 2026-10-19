# Pure Markdown document checkpoint B

This checkpoint adds two finite adapters and their owned tests. It does not
change a route, preview, font, loader, session, result, offline behavior or
download. PDF to Markdown/Word, Word to PDF, Extract Text, Markdown to PDF and
Markdown Viewer remain separately open integration tasks. No saved PDF or
visible Unicode typography support is claimed here.

The accepted DOCX/plain-text/model/ZIP sources and old Markdown parser/layout/
renderer remain unchanged. The two new cores import only
`validateDocumentModel`/`DOCUMENT_LIMITS` from document-model and
`imageDimensions(bytes,type)` from composition-state. There is no dependency,
DOM, network request, URL creation, adoption, history write or auto-download.

## API and ownership

```js
readMarkdownDocument(source, { assets = [], signal } = {})
// {model, modelBytes, sourceBytes, assets, report, usage, dispose}

documentToMarkdown(model, { assets = [], signal } = {})
// {text, bytes, type: 'text/markdown', images, report, usage, dispose}
```

Both functions are async. Source is a primitive, valid UTF-16 string. A future
caller must guard file decoding and every subsequent await against newer native
file, Clear and chained-file intents. File acquisition is not part of this API.
Original sourceBytes are owned UTF-8 bytes, including original CR/CRLF and BOM
characters. They are separate from canonical exported Markdown.

Reader asset records are `{name,type,bytes,width,height}`. Writer records are
`{id,type,bytes,width,height}`, matching the accepted DOCX asset seam. Actual
Uint8Array, Buffer, cross-realm Uint8Array, ArrayBuffer and Blob/File bytes are
supported. Intrinsic brand getters/copy methods bypass instance slice, species,
iterator and length overrides. Duck-typed producers are rejected. MIME and
declared pixel dimensions must match the owned PNG/JPEG dimension header.

Plain records and standard dense arrays require exact own enumerable data
descriptors. Hidden keys, symbols, getters, sparse arrays and own traversal
overrides cannot bypass validation. Reader model direction is auto on each
paragraph/run and source pages are empty. Generated IDs are finite and unique.
modelBytes and all returned bytes are fresh standard Uint8Arrays. Returned
reader assets are `{id,type,bytes,width,height}`; writer images additionally
have `name`. No arbitrary caller arrays are returned.

All supplied assets are admitted deterministically before parsing/serialization;
only referenced assets are retained. Every image copy belongs to the returned
bundle. dispose is idempotent and captures its own buffers, so changing a
returned array or overriding its members' fill method cannot redirect cleanup.
Original Buffer/ArrayBuffer/Blob bytes are never erased. JavaScript strings are
not erasable; disposal makes no claim otherwise.

## Finite budgets and cooperative work

Raw source and output each admit at most8 Mi UTF-16 units and8 MiB UTF-8.
Logical text, including image alternate text, retains the accepted1,000,000
UTF-16-unit limit. Escaped literal exports can exceed1M raw units while reopening
within that logical cap. The accepted serialized model cap remains16 MiB.

Source physical lines are capped at100000. Explicit indexed scanning charges
at most32 Mi visits and2,000,000 immediately consumed tokens/atoms; there is no
source-wide split, AST or token array. Delimiter nesting is16 and list nesting9.
Backtick/fence delimiters are at most64 characters; code info is at most100
units. Image destinations are at most1024 units and admitted local names100
ASCII bytes. Text chunks coalesce into bounded runs. Indexed whitespace and
table-separator scans avoid suffix regex rescans.

Model admission retains10,000 paragraphs,50,000 runs,500 tables,10,000 aggregate
table rows,100 columns and200,000 cells. The total block cap is the accepted
paragraph/table/asset aggregate. Writer empty-cell normalization also counts
against the reader paragraph cap. Writer physical-line admission prevents
returning code exports that this reader cannot reopen.

At most48 images,16 MiB each and48 MiB aggregate are admitted, with4096-pixel
edges and16,000,000 pixels. Alt text is at most10000 units and shares logical
text. Prospective retained reader buffers are sourceBytes + modelBytes + image
bytes; writer buffers are Markdown bytes + images. Each is capped at96 MiB and
128 resources. These are ephemeral bundle bounds. Later integration must still
reserve against the existing joint96 MiB/128 resources and retained512 MiB;
this module grants no additional session capacity or heap guarantee.

usage contains exact finite numeric fields sourceUnits, sourceBytes, visits,
tokens, logicalTextUnits, paragraphs, runs, tables, rows, cells, assets,
assetBytes, modelBytes, outputBytes, resourceBytes and resourceCount. Reader
outputBytes and writer sourceUnits/sourceBytes are0. Buffer counts do not
pretend strings and model objects are resource buffers; those have separate
finite bounds. Model admission is conservatively reserved incrementally, then
the accepted validator checks the actual final shape/serialized bound.

Indexed loops yield around16k charged visits and128 structural actions, within
the contract's65536/256 ceiling, with checks before/after awaits. Native Blob
reads remain awaited through their first promise before abort rejection. There
are no detached jobs or partially published results. Synchronous finite model
validation, scalar regex checks, final JSON and encoding are bounded sections,
not interruptible parser work. Cleanup preserves input/prior caller state.

## Grammar and readable literal export

This is a documented subset, not general CommonMark/GFM conformance. Primary
references consulted are [CommonMark0.31.2 escapes](https://spec.commonmark.org/0.31.2/#backslash-escapes),
[code spans](https://spec.commonmark.org/0.31.2/#code-spans),
[soft line breaks](https://spec.commonmark.org/0.31.2/#soft-line-breaks),
[lists](https://github.github.com/gfm/#lists) and
[GFM tables](https://github.github.com/gfm/#tables-extension-).

Supported blocks are ordinary paragraphs, ATX headings1-6, rules, fenced code,
one-paragraph list items with nested lists, strict pipe tables and owned images.
Supported inline styles are regular, bold, italic, boldItalic and code, using
bounded paired delimiters. More complex constructs are literal with finite
issues or precisely rejected when structural/style fidelity cannot be kept.
Unsupported blockquotes, indented code, tasks, setext headings and general HTML
blocks retain their source text. Unsupported links retain syntax and URL as
inert text. Nothing creates an anchor or fetches an image URL.

CRLF/CR source endings normalize to LF with a report while sourceBytes remain
exact. Paragraph soft breaks retain LF rather than joining words. Hard-break
syntax consumes its marker spaces/backslash. Plain spaces and tabs do not
collapse. Extra blank-line layout receives an issue. Numeric references decode
once; supported named references are amp, lt, gt, quot, apos and nbsp. Invalid
scalar/control references reject instead of emitting replacement characters.

The writer never feeds literal run.text through a Markdown parser. Ordinary
unambiguous spaces and punctuation remain readable, as do ordinary pipe cells.
It escapes actual syntax risks and uses numeric references at boundaries that
would otherwise lose whitespace, including styled edges, table edges and CR.
Normal code ending LF uses a readable fence, with a longer fence when needed.
It does not turn normal prose into numeric entities or normal code into HTML.

Four exact, nonexecuting grammar exceptions preserve otherwise missing model
semantics: br tokens represent body LF; standalone `<p></p>` is one empty
paragraph; exact `<pre><code>...</code></pre>` preserves rare exact code that
fences cannot represent; and exact `<!-- -->` separates delimiter/list groups.
The code wrapper is used for absent final LF, CR or a required fence over64,
with a finite safe-HTML issue. Wrapper payload decodes entities without treating
backslashes as Markdown escapes. Inline code with CR/LF or a needed delimiter
over64 rejects before output. A first inline span needing three or more
backticks uses the empty-comment grammar guard to avoid a fence ambiguity.
Adjacent style flanking gets a separator only where required; ordinary
`Hello **bold** world.` stays that readable text.

Literal strings resembling these exceptions are escaped once and remain
literal after one parse. Arbitrary HTML, hidden direction/JSON attributes or
execution are unsupported. Third-party rendering of the rare safe-HTML forms,
especially when HTML is disabled, is not promised. The future application
preview must consume the model and use the shared layout seam.

Ordered list starts1..1000000 are supported; later written markers advance the
group's counter and mismatches get an issue. Dynamic content-column indentation
preserves parent7, first child12, parent8. A standalone empty comment at root
ends the root group; one at the parent's content column ends child/deeper
groups while retaining the parent. Writer emits these for same-level explicit
restarts, including7 to20. Invalid jumps, interrupted implicit continuations or
bullet counters that cannot be represented reject. Original list IDs are
unrepresented metadata and reported.

Pipe headers/separators and all rows must have the same positive column count;
malformed/ragged tables reject instead of padding or dropping cells. Header/
alignment semantics absent from the model receive reports; reader weights are
uniform and writer reports header inference/width loss. In cells, br tokens
separate paragraphs, consecutive tokens retain empty paragraphs, and numeric LF
is a newline inside one paragraph. Literal lookalikes remain literal. Empty
paragraph arrays normalize with a report and cap check. Cell block kinds other
than ordinary paragraphs reject. A literal backslash immediately before a pipe
inside a code span is precisely unsupported. Paragraph spacing/whitespace in
external renderers receives finite fidelity reports.

Image names are flat ASCII basenames with lowercase png/jpg/jpeg extension,
matching MIME; exact and case-fold collisions reject. One optional `./` is
allowed in a local image destination. Writer uses image-001.png/image-002.jpg
in first-use order, reusing names for repeated asset IDs. It preserves owned
bytes and alt, reports physical-size loss, and infers reader size at96 DPI.
One model asset cannot represent conflicting alt text for repeated source
images, so that case rejects. Inline images may split ordinary paragraphs with
a report; images in lists/cells reject. Remote, traversal, absolute and other
nonadmitted targets stay literal with a blocked-target issue and are never
fetched. Missing required owned bytes reject transactionally.

Reports are dense exact `{code}`/`{code,blockId}` records, deduplicated by fixed
code, capped100, with codes below64 units and optional existing first block ID.
The source enums are fixed; they carry no arbitrary warning strings or URLs.
Explicit paragraph/run direction, source/page geometry, source warnings and
pagination have precise unrepresented reports. Strings are never reversed and
no model text is silently replaced. Typed adapter errors use the fixed
MARKDOWN_INPUT_SHAPE/LIMIT/TEXT_UNICODE/ASSET_MISSING/ASSET_MISMATCH/
UNSUPPORTED_STRUCTURE/UNSUPPORTED_STYLE/UNSUPPORTED_LIST_CONTINUATION/
UNSUPPORTED_TABLE codes. Original abort reasons and accepted validator
TypeError/RangeError identity are retained.

## Proof boundary

Run only the owned Node tests:

```sh
rtk proxy node --test tests/markdown-document.unit.mjs tests/document-markdown.unit.mjs
```

Optional BROWSERPDF_MARKDOWN_ARTIFACT_DIR writes generated artifacts to an
explicit caller directory. Tests require no private /tmp inputs. They include
independently expected readable .md bytes, direct source list7/12/8, saved marker
assertions, rare escape/style cases, exact code fallback, separate table
paragraph/LF artifacts, one-million-character literal reopening, actual PNG
CRC/decompressed red-blue pixels, embedded actual JPEG, cross-realm/Buffer/
ArrayBuffer ownership, controlled traversal rejection and held actual Blob
drain followed by positive successors.

The owner retains first18 (14 pass/4 fail), corrected controls and the initial
200-case deterministic literal/style probe (193 pass/7 fail), then corrected
replay200/200, under `/tmp/browserpdf-markdown-owner-20261019`. Original failures
are evidence, not overwritten acceptance claims. Stable test/hash/artifact
reports there retain the original pure-module checkpoint. Final scoped
acceptance is recorded below. Browser, caller/layout/font/session integration,
manual downloads and each service's acceptance remain separate gates.

## Focused review corrections

The first independent review retained two correctness failures: regular
paragraphs beginning `~~~`/`~~~~js` exported active fences, and a punctuation
followed by a letter was incorrectly accepted at a closing emphasis boundary.
The new portable controls first reproduced both failures (25 pass/2 fail),
without changing the original25/200 evidence or private probe artifacts.

The writer now escapes the first tilde only at an actual ordinary-paragraph
fence boundary. Ordinary `ordinary ~ prose`, interior tilde runs, and one/two
leading tildes stay readable. The intentional reader tilde-fence syntax is
unchanged. Saved literal Markdown bytes and paragraph/text/style reopening are
checked against independent expected values.

Closing emphasis candidates now apply the same punctuation-aware right-flanking
condition promised by this subset: punctuation immediately before a marker
requires whitespace, punctuation or the end after it. Existing underscore
restrictions remain. Direct single/double/triple marker negatives stay wholly
literal; neighboring valid whitespace/punctuation/end boundaries retain their
requested styles. This is a finite grammar correction, not a broader
CommonMark conformance claim. Corrected27-case tests, redirected original probe
replay, saved literal artifacts and the revised five-path manifest are retained
under `/tmp/browserpdf-markdown-corrections-20261019` as acceptance evidence.

## Final scoped acceptance

Root accepted pure Markdown checkpoint B after the focused corrected review
passed in `/tmp/browserpdf-markdown-document-corrected-review-20261019.md`.
That review closes both retained findings, verifies the original six-case
probe and neighboring positive controls, and confirms unchanged runtime/test
hashes and original failing evidence. The owner corrected suite remains27/27
and the corrected literal/style corpus200/200. Initial14/18,193/200 and the
later25/27 regression prefixes remain retained as historical failures.

Root separately passed the actual DOCX reader to Markdown/named-image output
to Markdown reader path. Its corrected report is
`/tmp/browserpdf-root-markdown-independent-corrected-20261019/report.json`.
The saved908-byte Markdown is byte-identical to the original independently
inspected artifact, SHA-256
`0f87b676e5100c32101fd61e91d969e49f2d8c2e15ba721f4d97186f28dc19db`.
Literal text/style sequence, ordered start7 followed by8 and named media are
preserved within the declared finite reports. The actual nine-file source
closure stayed unchanged. This is independent pure-module artifact evidence.

This acceptance authorizes the bounded parser/serializer checkpoint only.
Shared PDF layout, font/typography support, browser/native module allocation,
tool routes, guarded file intents, session/resource/output-group integration,
actual paginated previews, manual downloads and individual document-service
acceptance remain open. No saved-PDF, broad script support, offline or completed
service claim follows. Root owns the separate checkpoint commit and sync.
