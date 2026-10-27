/**
 * Headless contract test for the browser half.
 *
 * Loads `lib/client.js` the way `window.__ModuleLoader__` does, hands it a
 * fake Cordis context whose services record what gets registered, and asserts
 * the three registrations happen with the expected keys. Then it renders the
 * components directly against fixed data, which is where a wrong field name or
 * a bad address parse would otherwise show up as a blank pane in the page.
 *
 * Run: node test/client-contract.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const log = { tabs: [], typed: [], effects: [], dicts: [], opened: [] }

/** A tiny React stand-in: enough for module load and a direct render. */
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => [initial, () => undefined],
  useRef: (initial) => ({ current: initial }),
  useEffect: () => undefined,
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
}

const fakeRequire = (name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require("${name}")`)
}

const T = (key) => key

const locale = {
  register: (ns, dicts) => {
    log.dicts.push({ ns, locales: Object.keys(dicts) })
    // Kept so copy can be asserted, not just that a dictionary arrived.
    log.dictionaries = dicts
    return () => undefined
  },
  bind: () => T,
}

const slots = {
  inject: (slotName, callback) => {
    callback()
    return () => undefined
  },
  register: (options, component) => {
    log.typed.push({ ...options, component })
    return () => undefined
  },
}

const sidebarRightTabs = {
  register: (definition) => {
    log.tabs.push({ kind: definition.kind, id: definition.id, priority: definition.priority })
    definition.title()
    for (const entry of definition.guide ?? []) {
      entry.title()
      entry.description?.()
    }
    assert.equal(definition.canOpen('dsh-resource://diff-review/session/s1/7/2'), true)
    assert.equal(definition.canOpen('dsh-resource://file/x'), false, 'a file address is not claimed')
    assert.equal(definition.canOpen('dsh-resource://changes-review/session/s1/7/2'), false, 'the shipped kind is not claimed')
    return () => undefined
  },
}

const sidebarRight = { openResource: (address) => log.opened.push(address) }

const ctx = {
  effect: (callback) => {
    const disposer = callback()
    return () => {
      if (typeof disposer === 'function') disposer()
    }
  },
  inject: () => () => undefined,
  on: () => () => undefined,
  get: (name) => (name === 'locale' ? locale : undefined),
  locale,
  slots,
  sidebarRightTabs,
  sidebarRight,
}

globalThis.window = {
  __ModuleLoader__: {
    load: ({ id, factory }) => {
      assert.equal(id, 'dsh-diff-review')
      globalThis.__loaded = factory(fakeRequire)
    },
  },
}

globalThis.document = {
  head: { appendChild: () => undefined },
  getElementById: () => null,
  createElement: () => ({ id: '', textContent: '' }),
}

await import('../lib/client.js')

const plugin = globalThis.__loaded
assert.ok(plugin, 'the module registered itself with the loader')
assert.deepEqual(plugin.inject, [
  'slots',
  'locale',
  'sidebarRightTabs',
  'sidebarRight',
  // The composer handoff: a note is written into the Session's input box, and
  // that needs the Session scope plus the conversation service.
  'sessions',
  'conversation',
])
assert.equal(typeof plugin.apply, 'function')

plugin.apply(ctx)

/* ── registrations ──────────────────────────────────────────────────── */

const tabType = log.tabs.find((entry) => entry.kind === 'diff-review')
assert.ok(tabType, 'a tab type named diff-review was registered')
assert.equal(tabType.id, 'dsh-diff-review')
assert.notEqual(tabType.kind, 'changes-review', 'the shipped deliverables kind is not reused')
assert.equal(tabType.priority, 'builtin', 'the builtin band displaces nothing')

const bodies = log.typed.filter((entry) => entry.name === 'sidebar.right.pane.tab')
assert.equal(bodies.length, 1, 'exactly one tab body')
assert.equal(bodies[0].key, 'dsh-diff-review', 'the body is keyed by the type id')
assert.equal(typeof bodies[0].component, 'function')

const tails = log.typed.filter((entry) => entry.name === 'conversation.chat.turnTail')
assert.equal(tails.length, 1, 'exactly one turn-tail entry')
assert.equal(tails[0].id, 'dsh-diff-review-turn-entry')
assert.notEqual(
  tails[0].id,
  '@deepseek-ai/dsh-client-ui-deliverables',
  'the shipped card id is not replaced',
)

assert.deepEqual(log.dicts, [{ ns: 'diffReview', locales: ['zh', 'en'] }])
assert.ok(log.effects.length === 0 || true)

/* ── address handling ───────────────────────────────────────────────── */

const { parseAddress, reviewAddress, hunkHeader, basename, dirname, hunkRows, hunkBlocks, segments, planDiff, countBlocks, createdByTurn, prefetchQueue, mergeCount, mergeNew, tally, stepIndex, allReverted, ownsKey, refusalKey, pickTurn, noteDigest, mergeDraft, takeLines, readStep, DiffPane, ReviewBody, ReviewEntry } =
  plugin.__test

assert.deepEqual(parseAddress('dsh-resource://diff-review/session/s1/7/2'), {
  sessionId: 's1',
  seq: 7,
  turn: 2,
})
assert.equal(parseAddress('dsh-resource://file/s1/x.ts'), undefined)
assert.equal(parseAddress('dsh-resource://diff-review/session/s1/7'), undefined, 'three segments are required')
assert.equal(parseAddress('dsh-resource://diff-review/session/s1/x/2'), undefined, 'seq must be numeric')
assert.equal(reviewAddress('s1', 7, 2), 'dsh-resource://diff-review/session/s1/7/2')

assert.equal(hunkHeader({ oldStart: 3, oldLines: 2, newStart: 4, newLines: 5 }), '@@ -3,2 +4,5 @@')
assert.equal(basename('src/deep/a.ts'), 'a.ts')
assert.equal(dirname('src/deep/a.ts'), 'src/deep/')

/* ── a hunk numbers its rows and splits into its changed blocks ──────── */

const numbered = hunkRows({
  oldStart: 10,
  oldLines: 3,
  newStart: 10,
  newLines: 3,
  lines: [' keep', '-drop', '+take', ' tail'],
})
assert.deepEqual(
  numbered.map((row) => [row.kind, row.old, row.new, row.text]),
  [
    ['ctx', 10, 10, 'keep'],
    ['del', 11, undefined, 'drop'],
    ['add', undefined, 11, 'take'],
    ['ctx', 12, 12, 'tail'],
  ],
  'each side counts only the lines it actually contains',
)

const blocks = hunkBlocks(numbered)
assert.equal(blocks.length, 1, 'the removed and added lines between context lines are one block')
assert.equal(blocks[0].dels.length, 1)
assert.equal(blocks[0].adds.length, 1)
assert.equal(numbered[0].block, undefined, 'a context line belongs to no block')
assert.equal(numbered[1].block, 0)
assert.equal(numbered[2].block, 0)

/* ── the body renders its loading state before any read lands ───────── */

const tabSignal = new AbortController().signal
const bodyProps = (address, index) => ({
  sessionId: 's1',
  t: T,
  useTabInfo: () => ({
    tab: {
      id: 'tab-1',
      contentId: address,
      navigation: { address, params: { index }, revision: 0 },
      signal: tabSignal,
    },
  }),
})

globalThis.fetch = () => new Promise(() => undefined)

let tree = ReviewBody(bodyProps('dsh-resource://diff-review/session/s1/7/2', 0))
assert.equal(tree.props.className, 'dr-empty')
assert.deepEqual(tree.children, ['review.loading'])

/* ── DiffPane draws every comparison kind ───────────────────────────── */

const paneTree = (diff) => DiffPane({ diff, t: T })

assert.deepEqual(paneTree('loading').children, ['review.loading'])
assert.deepEqual(paneTree('missing').children, ['review.summaryGone'])
// A comparison shape this build does not know yet still has to draw something.
const emptyPane = paneTree({ kind: 'text', hunks: [] })
assert.equal(emptyPane.props.className, 'dr-pane', 'an empty comparison still draws its frame')
assert.equal(emptyPane.children[0], null, 'no block counter when there is nothing to walk')
assert.deepEqual(paneTree({ kind: 'future' }).children, ['review.loading'], 'an unknown kind falls back instead of crashing')

const dictionaries = log.dictionaries
assert.deepEqual(
  Object.keys(dictionaries.zh).sort(),
  Object.keys(dictionaries.en).sort(),
  'both locales carry the same keys',
)

// A key written twice in one literal is silently overwritten by the later
// value; that already happened once, so the source is checked directly.
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
for (const [locale, range] of [
  ['zh', source.slice(source.indexOf('const ZH = {'), source.indexOf('const EN = {'))],
  ['en', source.slice(source.indexOf('const EN = {'), source.indexOf('const CSS = '))],
]) {
  const keys = [...range.matchAll(/'([a-zA-Z]+\.[a-zA-Z]+)':/g)].map((match) => match[1])
  const seen = new Set()
  for (const key of keys) {
    assert.equal(seen.has(key), false, `dictionary ${locale} defines ${key} only once`)
    seen.add(key)
  }
}

// A turn still running has no record yet; that is not the same as a record
// that aged out, and the pane says so while it polls.
assert.notEqual(
  dictionaries.zh['review.running'],
  dictionaries.zh['review.summaryGone'],
  'a pending turn and a missing record do not share wording',
)
assert.deepEqual(paneTree('error').children, ['review.loadFailed'])
assert.notEqual(
  dictionaries.zh['review.unchanged'],
  dictionaries.zh['review.running'],
  'a finished turn and a running one do not share wording',
)
assert.deepEqual(paneTree({ kind: 'binary' }).children, ['review.binary'])
assert.deepEqual(paneTree({ kind: 'oversized' }).children, ['review.oversized'])

const text = paneTree({
  kind: 'text',
  coarse: false,
  hunks: [
    {
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 2,
      lines: [' context', '-gone', '+fresh'],
    },
  ],
})
assert.equal(text.props.className, 'dr-pane', 'the pane keeps the nav and the scroll area apart')

const nav = text.children[0]
assert.equal(nav.props.className, 'dr-nav')
const navText = nav.children[1]
assert.equal(navText.children[0], '1 / 1review.blocks', 'the count reads position over total')

const scroll = text.children[1]
assert.equal(scroll.props.className, 'dr-diff')
// The hunk container is handed one array child, so unwrap it.
const hunk = scroll.children[1].children[0][0]
assert.equal(hunk.children[0].children[0], '@@ -1,1 +1,2 @@')

const rows = hunk.children[1]
assert.deepEqual(
  rows.map((line) => line.props['data-k']),
  ['ctx', 'del', 'add'],
  'line prefixes map to the three row kinds',
)

/** Flattened text of a rendered node, whatever its segment structure. */
const flatten = (node) => {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(flatten).join('')
  if (node === null || node === undefined) return ''
  return (node.children ?? []).map(flatten).join('')
}

const codeOf = (line) => flatten(line.children[3])
assert.deepEqual(
  rows.map(codeOf),
  ['context', 'gone', 'fresh'],
  'the +/- prefix is stripped from the drawn text',
)

// Two number columns: the old side only where the line exists in the old file.
// The context line consumes old 1 / new 1, so both sides advance past it.
assert.deepEqual(
  rows.map((line) => line.children[0].children[0]),
  ['1', '2', ''],
  'the old-side number is blank on an added line',
)
assert.deepEqual(
  rows.map((line) => line.children[1].children[0]),
  ['1', '', '2'],
  'the new-side number is blank on a removed line',
)

/* ── word highlighting covers only what changed inside a line ────────── */

const shared = segments('const value = 1', 'const value = 2', 400)
const other = segments('const value = 2', 'const value = 1', 400)
assert.deepEqual(
  shared.filter((part) => part.changed).map((part) => part.text),
  ['1'],
  'only the differing token is marked on the old side',
)
assert.deepEqual(
  other.filter((part) => part.changed).map((part) => part.text),
  ['2'],
  'and the same token is marked on the new side',
)
assert.equal(
  shared.map((part) => part.text).join(''),
  'const value = 1',
  'segmentation never drops or reorders text',
)
assert.deepEqual(
  segments('one', undefined, 400),
  [{ text: 'one', changed: true }],
  'an unpaired line is wholly changed',
)
assert.deepEqual(
  segments('abcdefgh', 'abcdefgz', 3),
  [{ text: 'abcdefgh', changed: true }],
  'a line past the cap falls back to one plain run',
)

/* ── one plan over the whole comparison ─────────────────────────────── */

// Two hunks, one changed block each. The second hunk's block must be numbered
// 1, not 0: a per-hunk counter made F7 jump to the wrong block on any file
// with more than one hunk.
const twice = {
  kind: 'text',
  hunks: [
    { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] },
    { oldStart: 9, oldLines: 1, newStart: 9, newLines: 1, lines: ['-bee', '+boo'] },
  ],
}
const plan = planDiff(twice)
assert.equal(plan.blocks.length, 2, 'both hunks contribute a block')
assert.equal(plan.hunks.length, 2, 'both hunks are kept')
assert.deepEqual(
  plan.blocks.map((block) => block.dels.concat(block.adds).map((row) => row.block)),
  [
    [0, 0],
    [1, 1],
  ],
  'blocks are numbered across the comparison, and every row of a block carries its number',
)
assert.deepEqual(
  plan.hunks[1].rows.map((row) => [row.kind, row.old, row.new]),
  [
    ['del', 9, undefined],
    ['add', undefined, 9],
  ],
  'the second hunk numbers from its own header',
)
assert.equal(planDiff('loading'), null, 'nothing to plan before the comparison settles')
assert.equal(planDiff({ kind: 'binary', path: 'a.png' }), null, 'a binary file has no blocks to walk')

/* ── the walk that fills the list's per-file counts ─────────────────── */

// The list cannot count a file it has not compared, so opening the tab walks
// the summary and reads each comparison in the background. Two things used to
// be wrong here and neither showed up in a render: the walk could run past its
// own limit, and it re-read files whose count it already had.
const listed = [
  { path: 'a.ts' },
  { path: 'b.png', binary: true },
  { path: 'c.ts' },
  { path: 'd.bin', oversized: true },
  { path: 'e.ts' },
]
const queue = prefetchQueue(listed)
assert.deepEqual(
  queue.map((item) => [item.position, item.entry.path]),
  [
    [0, 'a.ts'],
    [2, 'c.ts'],
    [4, 'e.ts'],
  ],
  'the walk skips refused kinds and keeps each file in its summary position',
)

// A long list is sliced, not walked whole: every read is a Host round trip.
const many = Array.from({ length: 80 }, (_, i) => ({ path: `f${i}.ts` }))
const sliced = prefetchQueue(many)
assert.ok(sliced.length < many.length, 'a long list is bounded')
assert.ok(sliced.length > 0, 'but a long list is still walked')
assert.equal(sliced[0].entry.path, 'f0.ts', 'and it starts at the top')
assert.deepEqual(
  sliced.map((item) => item.position),
  sliced.map((_, i) => i),
  'a list with nothing refused keeps consecutive positions',
)

// Counting is a map update, and an unchanged count must keep the same object:
// a fresh one on every read would re-render the whole list each time.
const first = mergeCount({}, 'a.ts', 3)
assert.deepEqual(first, { 'a.ts': 3 }, 'a count lands under its path')
assert.equal(mergeCount(first, 'a.ts', 3), first, 'the same count keeps the same map')
assert.deepEqual(mergeCount(first, 'a.ts', 4), { 'a.ts': 4 }, 'a new count replaces it')
assert.deepEqual(mergeCount(first, 'b.ts', 1), { 'a.ts': 3, 'b.ts': 1 }, 'other files are kept')

// The count a file shows is the number of blocks F7 would walk in it.
assert.equal(countBlocks(twice), 2, 'a comparison counts its blocks, not its rows')
assert.equal(countBlocks({ kind: 'binary' }), undefined, 'a refused comparison has no count')
assert.equal(countBlocks('loading'), undefined, 'an unsettled comparison has no count')

// A file the turn created has no before side, which is what decides that
// reverting it empties the file instead of restoring one. The row says so
// before the click, so the distinction has to survive a spread of shapes.
assert.equal(createdByTurn({ kind: 'text', before: false, after: true }), true, 'a created file is recognised')
assert.equal(createdByTurn({ kind: 'text', before: true, after: true }), false, 'an edited file is not created')
assert.equal(createdByTurn({ kind: 'text', before: true, after: false }), false, 'a removed file is not created')
assert.equal(createdByTurn({ kind: 'binary', before: false }), false, 'a refused comparison says nothing')
assert.equal(createdByTurn('loading'), false, 'an unsettled comparison says nothing')
assert.equal(createdByTurn(undefined), false, 'no comparison says nothing')

// Recording it is the same map-update rule as the counts: repeating the same
// answer must keep the object, or every prefetch read re-renders the list.
const known = mergeNew({}, 'a.ts', true)
assert.deepEqual(known, { 'a.ts': true }, 'a created file lands under its path')
assert.equal(mergeNew(known, 'a.ts', true), known, 'the same answer keeps the same map')
assert.deepEqual(mergeNew(known, 'a.ts', false), { 'a.ts': false }, 'a later answer replaces it')
assert.deepEqual(mergeNew(known, 'b.ts', false), { 'a.ts': true, 'b.ts': false }, 'other files are kept')

/* ── who F7 belongs to ──────────────────────────────────────────────── */

// The listener is on `window`, so it also fires for a pane behind another tab.
// Taking F7 there swallows the key an editor in the visible tab wanted.
const shown = { offsetParent: {} }
const hidden = { offsetParent: null }
const field = { closest: (selector) => (selector.includes('textarea') ? {} : null) }
const plain = { closest: () => null }

assert.equal(ownsKey(shown, null), true, 'a shown pane with no caret takes F7')
assert.equal(ownsKey(shown, plain), true, 'and so does one focused anywhere harmless')
assert.equal(ownsKey(shown, field), false, 'but never while the caret is in a text field')
assert.equal(ownsKey(hidden, null), false, 'a pane behind another tab stands down')
assert.equal(ownsKey(null, null), false, 'and a pane that never mounted takes nothing')
assert.equal(ownsKey(shown, shown), true, 'the pane itself holding focus is fine')

/* ── a refused write says why, in the reader's language ─────────────── */

// The Host reports a code per file, never prose, so the wording lives here and
// has to cover every refusal the routes can produce.
assert.equal(refusalKey('STALE'), 'review.refusedStale', 'a file edited after the turn says so')
assert.equal(refusalKey('COARSE'), 'review.refusedCoarse', 'a timed-out comparison says so')
assert.equal(refusalKey('UNSUPPORTED'), 'review.refusedUnsupported', 'a binary file says so')
assert.equal(refusalKey('MISSING'), 'review.refusedMissing', 'a vanished file says so')
assert.equal(refusalKey('WRITE_FAILED'), 'review.refusedOther', 'an unknown code falls back')
assert.equal(refusalKey(undefined), 'review.refusedOther', 'and so does no code at all')
for (const code of ['STALE', 'COARSE', 'UNSUPPORTED', 'MISSING', 'WRITE_FAILED', undefined]) {
  const key = refusalKey(code)
  assert.equal(typeof log.dictionaries.zh[key], 'string', `zh has ${key}`)
  assert.equal(typeof log.dictionaries.en[key], 'string', `en has ${key}`)
}

/* ── which turn a picked number stands for ──────────────────────────── */

// The offered list grows at the front as the session continues, so the pane
// remembers the turn NUMBER, never its position: a position would silently
// point at a different turn the next time a turn is recorded.
const offeredTurns = [
  { turn: 12, seq: 7675 },
  { turn: 11, seq: 5402 },
  { turn: 9, seq: 4557 },
]
assert.deepEqual(pickTurn(offeredTurns, undefined), { turn: 12, seq: 7675 }, 'no pick means the newest')
assert.deepEqual(pickTurn(offeredTurns, 11), { turn: 11, seq: 5402 }, 'a pick keeps its turn number')
assert.equal(pickTurn(offeredTurns, 7), undefined, 'a turn the recorder no longer keeps is not offered')
assert.equal(pickTurn([], undefined), undefined, 'nothing offered, nothing to show')
assert.equal(pickTurn(undefined, 11), undefined, 'an unread list offers nothing')
// A turn recorded after the pick arrives at the front; the pick must not move.
const grown = [{ turn: 13, seq: 8000 }, ...offeredTurns]
assert.deepEqual(pickTurn(grown, 11), { turn: 11, seq: 5402 }, 'a newer turn does not shift the pick')

/* ── notes become one instruction for the next turn ─────────────────── */

// The digest is what the reviewer will see in the composer, so it has to read
// as an instruction and follow the review order, not the order notes landed.
const noteFiles = [{ path: 'b.ts' }, { path: 'a.ts' }]
assert.equal(noteDigest([], noteFiles, 'H'), undefined, 'no notes, no message')
assert.equal(noteDigest(undefined, noteFiles, 'H'), undefined, 'an unread list is not a message')
assert.equal(
  noteDigest([{ path: 'a.ts', text: 'split it' }], noteFiles, 'H'),
  'H\n\n- a.ts\n  - split it',
  'one file, one heading, one line',
)
assert.equal(
  noteDigest(
    [
      { path: 'a.ts', text: 'first' },
      { path: 'b.ts', text: 'second' },
      { path: 'a.ts', text: 'third' },
    ],
    noteFiles,
    'H',
  ),
  'H\n\n- b.ts\n  - second\n\n- a.ts\n  - first\n  - third',
  'notes group per file in review order, notes of a file keep their own order',
)
assert.equal(
  noteDigest([{ path: 'gone.ts', text: 'x' }, { path: 'a.ts', text: 'y' }], noteFiles, 'H'),
  'H\n\n- a.ts\n  - y\n\n- gone.ts\n  - x',
  'a file the turn no longer lists keeps its notes, at the end',
)

/* ── the progress stream is read a line at a time ───────────────────── */

// A whole-turn revert streams one record per file. Chunks split wherever the
// transport wants, so a half-written record must never be parsed as one.
assert.deepEqual(takeLines(''), { lines: [], rest: '' }, 'an empty chunk holds no line')
assert.deepEqual(
  takeLines('{"a":1}\n{"b":2}\n'),
  { lines: ['{"a":1}', '{"b":2}'], rest: '' },
  'complete lines leave nothing behind',
)
assert.deepEqual(
  takeLines('{"a":1}\n{"b":'),
  { lines: ['{"a":1}'], rest: '{"b":' },
  'a half-written record is kept, not parsed',
)
assert.deepEqual(takeLines('{"a":1}'), { lines: [], rest: '{"a":1}' }, 'a line without its newline waits')
assert.equal(readStep('{"step":"done"}').step, 'done', 'a record is parsed as it is')
assert.equal(readStep('   '), undefined, 'a blank line is not a record')
assert.equal(readStep('not json'), undefined, 'a broken line is dropped, not fatal')
assert.equal(readStep('null'), undefined, 'a JSON null is not a record')
assert.equal(readStep('[1,2]').length, 2, 'a JSON array is still an object to the reader')

/* ── the composer keeps what the reviewer already typed ─────────────── */

assert.equal(mergeDraft('', 'D'), 'D', 'an empty composer takes the digest alone')
assert.equal(mergeDraft(undefined, 'D'), 'D', 'an unread composer is treated as empty')
assert.equal(mergeDraft('   ', 'D'), 'D', 'whitespace is not a draft')
assert.equal(mergeDraft('mine', 'D'), 'mine\n\nD', 'a draft is kept above the digest')
assert.equal(mergeDraft('mine\n\n', 'D'), 'mine\n\nD', 'trailing blank lines do not double up')
assert.equal(mergeDraft('mine', ''), 'mine', 'nothing to add leaves the draft untouched')

/* ── how far through the turn the reviewer is ───────────────────────── */

// The footer answers "how much is left" without opening every file, so the
// count has to read the same decisions the dots do.
const tallyFiles = [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }]
assert.deepEqual(tally(tallyFiles, {}), { done: 0, total: 3 }, 'nothing settled yet')
assert.deepEqual(
  tally(tallyFiles, { 'a.ts': { state: 'confirmed' }, 'b.ts': { state: 'reverted' } }),
  { done: 1, total: 3 },
  'only confirmations count as done; a revert is a different decision',
)
assert.deepEqual(tally([], {}), { done: 0, total: 0 }, 'an empty turn has nothing to settle')
assert.deepEqual(
  tally([{ path: 'a.ts' }], { 'a.ts': { state: 'confirmed' } }),
  { done: 1, total: 1 },
  'one confirmed file reads as finished',
)

// A whole-turn revert and a whole-turn restore share one button, so their
// labels depend on whether the turn as a whole is back where it started.
assert.equal(allReverted(tallyFiles, {}), false, 'a turn nothing was done to is not reverted')
assert.equal(
  allReverted(tallyFiles, { 'a.ts': { state: 'reverted' }, 'b.ts': { state: 'reverted' } }),
  false,
  'one pending file keeps the turn from reading as reverted',
)
assert.equal(
  allReverted(tallyFiles, {
    'a.ts': { state: 'reverted' },
    'b.ts': { state: 'reverted' },
    'c.ts': { state: 'reverted' },
  }),
  true,
  'every file reverted reads as a reverted turn',
)
assert.equal(
  allReverted([{ path: 'a.ts', binary: true }, { path: 'b.ts' }], { 'b.ts': { state: 'reverted' } }),
  true,
  'a file with no line comparison can never be reverted, so it is skipped rather than blocking',
)
assert.equal(
  allReverted([{ path: 'a.ts', binary: true }], {}),
  false,
  'a turn of nothing but binary files has nothing to turn around',
)
assert.equal(allReverted([], {}), false, 'an empty turn has no revert to undo')

/* ── the list's keyboard move ───────────────────────────────────────── */

assert.equal(stepIndex(0, 1, 3), 1, 'down walks the list')
assert.equal(stepIndex(2, -1, 3), 1, 'up walks it back')
assert.equal(stepIndex(0, -1, 3), 0, 'the top row does not wrap to the bottom')
assert.equal(stepIndex(2, 1, 3), 2, 'the bottom row does not wrap to the top')
assert.equal(stepIndex(0, 1, 0), 0, 'an empty list has nowhere to move')

/* ── the turn-tail entry ────────────────────────────────────────────── */

const entry = ReviewEntry({ sessionId: 's1', turn: { turn: 1 }, t: T, openResource: () => undefined })
assert.equal(entry, null, 'a turn with no served summary renders nothing')

console.log('client contract: OK')
console.log('  tab kind      :', tabType.kind, '(' + tabType.priority + ')')
console.log('  body key      :', bodies[0].key)
console.log('  turn-tail id  :', tails[0].id)
console.log('  dictionaries  :', log.dicts[0].locales.join(', '))
console.log('  diff kinds    : loading, missing, error, binary, oversized, text')
