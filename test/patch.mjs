/**
 * Round-trip test for the patch maths.
 *
 * The interesting property is not "reverseApply returns a string" — it is that
 * replaying a real comparison backwards and then forwards lands exactly on the
 * text we started from. So most of this builds unified hunks and checks the
 * round trip, including the awkward inputs (empty file, no trailing newline,
 * several hunks, a file that only grew).
 *
 * The plugin ships without dependencies, so the comparison is built here
 * instead of imported from jsdiff. `RECORDED` below holds hunks captured from
 * the real recorder, and those are the cases that pin the wire format down.
 *
 * Run: node test/patch.mjs
 */

import assert from 'node:assert/strict'

import {
  PatchError,
  applyHunks,
  forwardApply,
  keepEnding,
  reverseApply,
  roundTrips,
  terminate,
} from '../lib/patch.js'

/* ── building a comparison the way the recorder does ─────────────────── */

/** Context lines around each change, the unified-diff default. */
const CONTEXT = 3

/**
 * Longest common subsequence of two line arrays, as index pairs.
 * @param {string[]} a - old side.
 * @param {string[]} b - new side.
 * @returns {Array<[number, number]>} matched positions.
 */
function common(a, b) {
  const width = b.length + 1
  const table = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }
  const pairs = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i += 1
      j += 1
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i += 1
    else j += 1
  }
  return pairs
}

/**
 * Compare two texts into unified hunks.
 * @param {string} before - old text.
 * @param {string} after - new text.
 * @returns {Array<{ oldStart: number, oldLines: number, newStart: number,
 *   newLines: number, lines: string[] }>} hunks, or none when equal.
 */
function compare(before, after) {
  const oldText = terminate(before)
  const newText = terminate(after)
  const a = oldText === '' ? [] : oldText.slice(0, -1).split('\n')
  const b = newText === '' ? [] : newText.slice(0, -1).split('\n')

  // One entry per line of either side, in file order, with the 0-based
  // position it occupies on each side (absent when that side has no line).
  const ops = []
  let i = 0
  let j = 0
  const context = (count) => {
    for (let k = 0; k < count; k += 1) {
      ops.push({ mark: ' ', text: a[i], at: i, of: j })
      i += 1
      j += 1
    }
  }
  for (const [ai, bj] of common(a, b)) {
    for (let k = i; k < ai; k += 1) ops.push({ mark: '-', text: a[k], at: k })
    for (let k = j; k < bj; k += 1) ops.push({ mark: '+', text: b[k], of: k })
    i = ai
    j = bj
    context(1)
  }
  for (let k = i; k < a.length; k += 1) ops.push({ mark: '-', text: a[k], at: k })
  for (let k = j; k < b.length; k += 1) ops.push({ mark: '+', text: b[k], of: k })

  const changed = ops.map((op) => op.mark !== ' ')

  // A hunk is a run of changes widened by CONTEXT unchanged lines on both
  // sides; runs that end up overlapping become one hunk.
  const hunks = []
  let cursor = 0
  while (cursor < ops.length) {
    if (!changed[cursor]) {
      cursor += 1
      continue
    }
    let first = cursor
    let last = cursor
    let scan = cursor + 1
    while (scan < ops.length && scan - last <= CONTEXT * 2) {
      if (changed[scan]) last = scan
      scan += 1
    }
    first = Math.max(0, first - CONTEXT)
    last = Math.min(ops.length - 1, last + CONTEXT)

    // Start numbers are the side's own count of lines before the hunk, which
    // is what a recorder emits for a hunk that begins with an addition.
    const body = ops.slice(first, last + 1)
    const oldBefore = ops.slice(0, first).filter((op) => op.mark !== '+').length
    const newBefore = ops.slice(0, first).filter((op) => op.mark !== '-').length
    hunks.push({
      oldStart: oldBefore + 1,
      oldLines: body.filter((op) => op.mark !== '+').length,
      newStart: newBefore + 1,
      newLines: body.filter((op) => op.mark !== '-').length,
      lines: body.map((op) => op.mark + op.text),
    })
    cursor = last + 1
  }
  return hunks
}

/* ── hunks captured from the real recorder ───────────────────────────── */

// Verbatim `structuredPatch` output for '' -> 'a\nb\n'. It is the case that
// pins down what `oldStart` means when a hunk adds lines and consumes none.
const RECORDED = {
  emptyToTwoLines: [
    { oldStart: 1, oldLines: 0, newStart: 1, newLines: 2, lines: ['+a', '+b'] },
  ],
  // 'a\nb' -> 'a\nb\n': jsdiff marks the missing terminator explicitly.
  newlineAdded: [
    {
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      lines: ['-noeol', '\\ No newline at end of file', '+noeol'],
    },
  ],
  // A coarse hunk after a comparison timeout: every old line, then every new.
  coarse: [
    {
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 2,
      lines: ['-alpha', '-beta', '+alpha', '+BETA'],
    },
  ],
}

assert.equal(reverseApply(RECORDED.emptyToTwoLines, 'a\nb\n'), '', 'a new file reverts to empty')
assert.equal(forwardApply(RECORDED.emptyToTwoLines, ''), 'a\nb\n', 'and comes back')
assert.equal(
  reverseApply(RECORDED.newlineAdded, 'noeol\n'),
  'noeol\n',
  'the no-newline marker does not consume a line',
)
assert.equal(reverseApply(RECORDED.coarse, 'alpha\nBETA\n'), 'alpha\nbeta\n', 'a coarse hunk reverts')
assert.equal(forwardApply(RECORDED.coarse, 'alpha\nbeta\n'), 'alpha\nBETA\n', 'and redoes')

/* ── every shape of change ───────────────────────────────────────────── */

const CASES = [
  ['a modified line', 'a\nb\nc\n', 'a\nB\nc\n'],
  ['an inserted line', 'a\nc\n', 'a\nb\nc\n'],
  ['a removed line', 'a\nb\nc\n', 'a\nc\n'],
  ['a file that only grew', 'a\n', 'a\nb\nc\nd\ne\nf\n'],
  ['a file that only shrank', 'a\nb\nc\nd\ne\nf\n', 'a\n'],
  ['a new file', '', 'one\ntwo\n'],
  ['a emptied file', 'one\ntwo\n', ''],
  ['no trailing newline, same lines', 'a\nb', 'a\nb'],
  ['no trailing newline, edited', 'a\nb', 'a\nB'],
  ['CRLF endings', 'a\r\nb\r\n', 'a\r\nB\r\n'],
  ['a change at the very start', 'a\nb\nc\n', 'A\nb\nc\n'],
  ['a change at the very end', 'a\nb\n', 'a\nb\nc\n'],
  ['two distant changes', '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n16\n', '1\nX\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\nY\n'],
  ['three nearby changes', '1\n2\n3\n4\n5\n6\n7\n8\n9\n', '1\nX\n3\nY\n5\n6\n7\n8\nZ\n'],
]

for (const [label, before, after] of CASES) {
  const hunks = compare(before, after)
  const back = reverseApply(hunks, after)
  assert.equal(back, terminate(before), `reverseApply restores ${label}`)
  const forth = forwardApply(hunks, back)
  assert.equal(forth, terminate(after), `forwardApply redoes ${label}`)
  assert.equal(roundTrips(hunks, back, after), true, `the round trip holds for ${label}`)
}

// Two distant changes must stay two blocks, or the F7 walk and the per-file
// counts stop matching what the pane draws.
const distant = compare(
  '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n16\n',
  '1\nX\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\nY\n',
)
assert.equal(distant.length, 2, 'distant changes are separate hunks')

/* ── the safety valve actually refuses ───────────────────────────────── */

const hunks = compare('alpha\nbeta\n', 'alpha\nBETA\n')

const refused = (text, code, why) => {
  assert.throws(
    () => reverseApply(hunks, text),
    (error) => error instanceof PatchError && error.code === code,
    why,
  )
}

refused('alpha\nGAMMA\n', 'STALE', 'a file edited after the turn is refused, not overwritten')
refused('', 'STALE', 'a truncated file is refused')
refused('alpha\nbeta\nomega\n', 'STALE', 'a file with a line added after the turn is refused')
refused('ALPHA\nbeta\n', 'STALE', 'a change to an unrelated line is refused')

assert.throws(
  () => applyHunks(hunks, 'alpha\nbeta\n', 'sideways'),
  (error) => error instanceof PatchError && error.code === 'MALFORMED',
  'an unknown direction is a programming error, not a stale file',
)
assert.throws(
  () => reverseApply([{ oldStart: 1, oldLines: 1, newStart: 9, newLines: 1, lines: ['-x', '+y'] }], 'y\n'),
  (error) => error instanceof PatchError && error.code === 'STALE',
  'a hunk pointing past the end of the file is refused',
)
assert.throws(
  () => reverseApply([{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 3, lines: ['-x', '+y'] }], 'y\n'),
  (error) => error instanceof PatchError && error.code === 'MALFORMED',
  'a hunk whose declared size disagrees with its body is refused',
)
assert.throws(
  () => reverseApply([{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['?x', '+y'] }], 'y\n'),
  (error) => error instanceof PatchError && error.code === 'MALFORMED',
  'an unknown line mark is refused',
)

// A stale file must never be half written: the refusal happens before the
// caller gets any text back at all.
assert.equal(roundTrips(hunks, 'alpha\nGAMMA\n', 'alpha\nGAMMA\n'), false, 'a wrong basis fails the trip')

/* ── endings ─────────────────────────────────────────────────────────── */

assert.equal(terminate(''), '', 'empty text stays empty')
assert.equal(terminate('a'), 'a\n', 'an unterminated line gains its newline')
assert.equal(terminate('a\n'), 'a\n', 'a terminated line is left alone')

assert.equal(keepEnding('a\nb\n', 'a\nb'), 'a\nb', 'a file without a final newline keeps that shape')
assert.equal(keepEnding('a\nb\n', 'a\nb\n'), 'a\nb\n', 'and a terminated file keeps its own')
assert.equal(keepEnding('', 'a\nb'), '', 'an emptied file stays empty')
assert.equal(keepEnding('a\nc\n', 'a\nb'), 'a\nc\n', 'a changed last line keeps the newline it was given')

console.log('patch: OK')
console.log('  cases         :', CASES.length)
console.log('  refusals      : stale file, truncated file, short hunk, bad body, bad direction')
console.log('  coarse hunk   : reverts and redoes')
