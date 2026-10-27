/**
 * Turning one turn's hunks back into whole-file text.
 *
 * The recorder hands the browser a comparison, never the two files it compared.
 * That is enough to revert, because a diff states its own inverse: every line a
 * hunk does not mention is identical on both sides, so replaying the hunk body
 * backwards over the current file reconstructs the file as it was.
 *
 * Two directions, one function:
 *
 *   reverseApply(hunks, current)  undo the turn's change  (new side -> old side)
 *   forwardApply(hunks, before)   redo it                 (old side -> new side)
 *
 * Nothing here trusts the file to still be the one that was compared. Every
 * context line and every consumed line is checked against what the hunk says
 * should be there, so a file edited after the turn refuses to apply instead of
 * being silently rewritten with the wrong content.
 *
 * Line endings: the comparer terminates both sides before diffing
 * (`terminated()` in the recorder), so both directions work on a terminated
 * copy of the text and the caller decides what to write back.
 */

/** The one line terminator the comparer produces and splits on. */
const NEWLINE = '\n'

/** The marker jsdiff emits for a side whose last line has no terminator. */
const NO_NEWLINE = '\\ No newline at end of file'

/**
 * A typed refusal, carrying a code the route reports per file.
 * `STALE` means the file on disk is not the side these hunks describe.
 * `MALFORMED` means the hunks themselves cannot be replayed.
 */
export class PatchError extends Error {
  /**
   * @param {'STALE' | 'MALFORMED'} code - why the patch was refused.
   * @param {string} message - readable reason, safe to show.
   */
  constructor(code, message) {
    super(message)
    this.name = 'PatchError'
    this.code = code
  }
}

/**
 * A side's text with every line terminated, so the last line compares by
 * content alone. Mirrors the recorder's own rule exactly.
 * @param {string} text - file text, terminated or not.
 * @returns {string} the same text, terminated.
 */
export function terminate(text) {
  return text === '' || text.endsWith(NEWLINE) ? text : text + NEWLINE
}

/**
 * Content lines of a terminated text; empty text is zero lines.
 * @param {string} text - terminated text.
 * @returns {string[]} its lines.
 */
function lines(text) {
  return text === '' ? [] : text.slice(0, -1).split(NEWLINE)
}

/**
 * Which side of a hunk a direction reads from, and which it writes.
 * Undoing reads the new side and writes the old one.
 */
const SIDES = {
  reverse: { want: '+', give: '-', start: 'newStart', count: 'newLines', name: 'new' },
  forward: { want: '-', give: '+', start: 'oldStart', count: 'oldLines', name: 'old' },
}

/**
 * Replay hunks over a whole-file text.
 * @param {ReadonlyArray<{ oldStart: number, oldLines: number, newStart: number,
 *   newLines: number, lines: string[] }>} hunks - one turn's comparison.
 * @param {string} text - the file as it is now.
 * @param {'forward' | 'reverse'} direction - which way to replay.
 * @returns {string} the other side's text, terminated.
 * @throws {PatchError} when the text is not the side these hunks describe.
 */
export function applyHunks(hunks, text, direction) {
  const side = SIDES[direction]
  if (side === undefined) throw new PatchError('MALFORMED', 'unknown replay direction')
  if (!Array.isArray(hunks)) throw new PatchError('MALFORMED', 'no hunks to replay')
  const source = lines(terminate(typeof text === 'string' ? text : ''))
  const out = []
  let cursor = 0
  for (const hunk of hunks) {
    const start = Number(hunk?.[side.start])
    const count = Number(hunk?.[side.count])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 1 || count < 0) {
      throw new PatchError('MALFORMED', 'a hunk has no usable position')
    }
    const at = start - 1
    // Hunks arrive in file order; a position behind the cursor would replay the
    // same lines twice, which only happens when the hunk list is corrupt.
    if (at < cursor) throw new PatchError('MALFORMED', 'hunks overlap or run backwards')
    if (at > source.length) {
      throw new PatchError('STALE', 'the file is shorter than the change expects')
    }
    out.push(...source.slice(cursor, at))
    cursor = at
    let seen = 0
    for (const raw of Array.isArray(hunk.lines) ? hunk.lines : []) {
      if (typeof raw !== 'string' || raw === '') {
        throw new PatchError('MALFORMED', 'a hunk line is empty')
      }
      if (raw === NO_NEWLINE) continue
      const mark = raw.slice(0, 1)
      const body = raw.slice(1)
      if (mark === ' ') {
        if (source[cursor] !== body) {
          throw new PatchError('STALE', `line ${cursor + 1} is not what the change expects`)
        }
        out.push(body)
        cursor += 1
        seen += 1
      } else if (mark === side.want) {
        if (source[cursor] !== body) {
          throw new PatchError('STALE', `line ${cursor + 1} is not what the change expects`)
        }
        cursor += 1
        seen += 1
      } else if (mark === side.give) {
        out.push(body)
      } else {
        throw new PatchError('MALFORMED', `unknown line mark "${mark}"`)
      }
    }
    if (seen !== count) {
      throw new PatchError(
        'MALFORMED',
        `a hunk covers ${seen} ${side.name} lines but declares ${count}`,
      )
    }
  }
  out.push(...source.slice(cursor))
  return out.length === 0 ? '' : out.join(NEWLINE) + NEWLINE
}

/**
 * The file as it was before the turn.
 * @param {ReadonlyArray<object>} hunks - the turn's comparison.
 * @param {string} current - the file as it is now.
 * @returns {string} the previous text, terminated.
 * @throws {PatchError} when the file is no longer the compared one.
 */
export function reverseApply(hunks, current) {
  return applyHunks(hunks, current, 'reverse')
}

/**
 * The file as the turn left it.
 * @param {ReadonlyArray<object>} hunks - the turn's comparison.
 * @param {string} before - the file as it was before the turn.
 * @returns {string} the later text, terminated.
 * @throws {PatchError} when the text is not the side these hunks describe.
 */
export function forwardApply(hunks, before) {
  return applyHunks(hunks, before, 'forward')
}

/**
 * The safety valve before anything is written: replaying the reverted text
 * forward must land exactly on the file we are about to replace.
 * @param {ReadonlyArray<object>} hunks - the turn's comparison.
 * @param {string} reverted - text produced by `reverseApply`.
 * @param {string} current - the file as it is now.
 * @returns {boolean} whether the two directions agree byte for byte.
 */
export function roundTrips(hunks, reverted, current) {
  try {
    return forwardApply(hunks, reverted) === terminate(current)
  } catch {
    return false
  }
}

/**
 * Give the reverted text the same last-line ending the current file has, so a
 * file that never ended with a newline does not gain one just by being reverted.
 * Only the ending of the final line is touched, and only when that line is
 * unchanged, which is the case a plain slice would otherwise disturb.
 * @param {string} next - reverted text.
 * @param {string} current - the file as it is now.
 * @returns {string} `next`, ending the way `current` does.
 */
export function keepEnding(next, current) {
  if (next === '' || current === '' || current.endsWith(NEWLINE)) return next
  const trimmed = next.endsWith(NEWLINE) ? next.slice(0, -1) : next
  const tail = (text) => text.slice(text.lastIndexOf(NEWLINE) + 1)
  return tail(trimmed) === tail(current) ? trimmed : next
}
