/**
 * dsh-diff-review — Host half.
 *
 * Owns three things and nothing else:
 *
 *  1. Authenticated routes the browser half reads and writes:
 *       GET  /api/diff-review.latest   ?sessionId
 *       GET  /api/diff-review.summary  ?sessionId&seq
 *       GET  /api/diff-review.diff     ?sessionId&seq&index
 *       GET  /api/diff-review.state    ?sessionId&seq
 *       POST /api/diff-review.confirm  { sessionId, seq, path, state }
 *       POST /api/diff-review.revert   { sessionId, seq, path?, all? }
 *       POST /api/diff-review.restore  { sessionId, seq, path?, all? }
 *       GET  /api/diff-review.turns    ?sessionId
 *       POST /api/diff-review.note     { sessionId, seq, path, text, hunk? }
 *       POST /api/diff-review.enote    { sessionId, seq, path, at, text }
 *       POST /api/diff-review.unote    { sessionId, seq, path, at }
 *       GET  /api/diff-review.notes    ?sessionId&seq
 *
 *  2. A durable per-file decision record in this plugin's own storage domain,
 *     plus the review notes ("what still has to change here") the browser half
 *     hands to the next turn. Confirming a file writes there and nowhere else;
 *     no file content moves.
 *
 *  3. Reverting a file: the turn's comparison is replayed backwards over the
 *     file on disk, after a round-trip check that refuses to write when the
 *     file is no longer the one that was compared. See `./patch.js`.
 *
 *  4. Nothing about diffs: the turn snapshots come from
 *     `@deepseek-ai/dsh-workspace-changes` through `ctx.workspaceChanges`.
 *     Without that plugin the routes answer 404 and the browser half shows its
 *     empty state, so nothing here hard-depends on another plugin.
 *
 * Conflict avoidance: the route namespace is `diff-review.*`, the storage
 * domain is `diff_review`, and no tab kind, slot id, or resource address that
 * another plugin owns is reused or shadowed.
 *
 * Dependency note: apart from its own `./patch.js`, this module imports
 * NOTHING. A plugin installed into a profile cannot resolve `@deepseek-ai/dsh-*`
 * packages (only the harness's own modules can), so the domain spec and its
 * record schema are declared here by hand. The domain facility duck-types both:
 * a spec is `{ name, version, tables }`, a table is `{ valueSchema }`, and a
 * schema is anything with a `parse(value)` that throws on an invalid record.
 */

import { forwardApply, keepEnding, reverseApply, roundTrips, terminate } from './patch.js'

/** Domain names must satisfy the storage unit-name rule (/^[a-z][a-z0-9_]*$/). */
const DOMAIN_NAME = 'diff_review'

/** The settled states one file can hold. "No decision yet" is an absent record. */
const STATES = new Set(['confirmed', 'reverted', 'edited'])

const NUMERIC = /^\d+$/
const JSON_HEADERS = { 'cache-control': 'no-store' }

/**
 * Validate and normalize one stored decision.
 * @param {unknown} raw - a record read from the medium.
 * @returns {{ sessionId: string, seq: number, path: string, state: string, at: number }}
 * @throws when the record does not describe a decision.
 */
function parseDecision(raw) {
  if (typeof raw !== 'object' || raw === null) throw new Error('decision record is not an object')
  const { sessionId, seq, path, state, at } = /** @type {Record<string, unknown>} */ (raw)
  if (typeof sessionId !== 'string' || sessionId === '') throw new Error('decision.sessionId')
  if (!Number.isSafeInteger(seq) || seq < 0) throw new Error('decision.seq')
  if (typeof path !== 'string' || path === '') throw new Error('decision.path')
  if (typeof state !== 'string' || !STATES.has(state)) throw new Error('decision.state')
  if (typeof at !== 'number') throw new Error('decision.at')
  return { sessionId, seq, path, state, at }
}

/**
 * Validate and normalize one stored review note.
 *
 * A note is prose, so the only rule that matters is that it has something to
 * say. The optional `hunk` pins the remark to one change block, which lets a
 * later turn be told *where* in the file to look.
 *
 * @param {unknown} raw - a record read from the medium.
 * @returns {{ sessionId: string, seq: number, path: string, hunk: number | undefined, text: string, at: number }}
 * @throws when the record does not describe a note.
 */
function parseNote(raw) {
  if (typeof raw !== 'object' || raw === null) throw new Error('note record is not an object')
  const { sessionId, seq, path, hunk, text, at } = /** @type {Record<string, unknown>} */ (raw)
  if (typeof sessionId !== 'string' || sessionId === '') throw new Error('note.sessionId')
  if (!Number.isSafeInteger(seq) || seq < 0) throw new Error('note.seq')
  if (typeof path !== 'string' || path === '') throw new Error('note.path')
  if (hunk !== undefined && (!Number.isSafeInteger(hunk) || hunk < 0)) throw new Error('note.hunk')
  if (typeof text !== 'string' || text.trim() === '') throw new Error('note.text')
  if (typeof at !== 'number') throw new Error('note.at')
  return { sessionId, seq, path, hunk, text, at }
}

/**
 * The storage-domain declaration. Shape mirrors `defineDomain`'s output: the
 * facility reads only `name`, `version`, `tables`, and each table's
 * `valueSchema`.
 *
 * The version stays 1 while the `notes` table is added, and that is deliberate:
 * a profile that already wrote decisions has `diff_review.json` stamped
 * version 1, and the JSON backend's `single` layout rejects a stamp that is not
 * exactly the declared version (`compatibleVersions` is honoured only by the
 * per-record layout). A declared table that the stored document does not carry
 * loads as empty, so adding one at the same version is the only change that
 * does not orphan existing records.
 */
const diffReviewDomain = {
  name: DOMAIN_NAME,
  version: 1,
  tables: {
    decisions: { valueSchema: { parse: parseDecision } },
    notes: { valueSchema: { parse: parseNote } },
  },
}

/**
 * Read a non-negative integer query coordinate.
 * @param {string | null} value - raw query value.
 * @returns {number | undefined} the coordinate, or undefined when malformed.
 */
function coordinate(value) {
  if (value === null || !NUMERIC.test(value)) return undefined
  const n = Number(value)
  return Number.isSafeInteger(n) ? n : undefined
}

/**
 * Host plugin body.
 * @param {object} ctx - Cordis plugin context.
 */
export function apply(ctx) {
  /** Opened lazily so a profile without the storage services still boots. */
  let domainPromise

  /**
   * Open the decision domain once and hold it for the plugin's lifetime.
   * @returns {Promise<object | undefined>} the domain, or undefined when this
   *   profile composes no storage domain facility.
   */
  function domain() {
    if (domainPromise !== undefined) return domainPromise
    const facility = ctx.get('storageDomain')
    if (facility === undefined) {
      domainPromise = Promise.resolve(undefined)
      return domainPromise
    }
    domainPromise = Promise.resolve(facility.open(diffReviewDomain)).catch((error) => {
      console.error('[diff-review] could not open the decision domain:', error)
      return undefined
    })
    ctx.effect(
      () => async () => {
        const opened = await domainPromise
        if (opened !== undefined) await opened.close()
      },
      'diff-review: decision domain',
    )
    return domainPromise
  }

  /**
   * Every decision recorded for one turn.
   * @param {string} sessionId - owning session.
   * @param {number} seq - the turn's `workspace/changes` event sequence.
   * @returns {Promise<Record<string, { state: string, at: number }>>}
   */
  async function decisionsFor(sessionId, seq) {
    const opened = await domain()
    if (opened === undefined) return {}
    const prefix = `${sessionId}/${seq}/`
    const out = {}
    for (const [key, value] of opened.table('decisions').entries()) {
      if (!key.startsWith(prefix)) continue
      out[value.path] = { state: value.state, at: value.at }
    }
    return out
  }

  /**
   * Every review note written for one turn, in the order it was written.
   *
   * Notes are returned as a flat list rather than per file because the caller
   * composes them into one block of prose; the path is carried on each entry
   * instead of being the key.
   *
   * @param {string} sessionId - owning session.
   * @param {number} seq - the turn's `workspace/changes` event sequence.
   * @returns {Promise<Array<object>>} the notes, oldest first.
   */
  async function notesFor(sessionId, seq) {
    const opened = await domain()
    if (opened === undefined) return []
    const prefix = `${sessionId}/${seq}/`
    const out = []
    for (const [key, value] of opened.table('notes').entries()) {
      if (!key.startsWith(prefix)) continue
      out.push(value)
    }
    out.sort((left, right) => left.at - right.at)
    return out
  }

  /**
   * What reverting one file would do, decided before anything is written.
   *
   * The comparison is read from the recorder (it holds the two snapshots), then
   * replayed backwards over what is on disk right now. Both steps are pure
   * reads: the only writes in this file happen after every file has been
   * planned, so one stale file cannot leave the turn half reverted by surprise.
   *
   * @param {string} sessionId - session id.
   * @param {number} seq - the turn's `workspace/changes` sequence.
   * @param {number} index - the file's position in the turn's summary.
   * @param {AbortSignal} [signal] - cancellation, forwarded to the recorder.
   * @returns {Promise<object>} a plan, or `{ ok: false, code, message }`.
   */
  async function planRevert(sessionId, seq, index, signal) {
    const service = changes()
    const fs = files()
    if (service === undefined) return { ok: false, code: 'NO_RECORDER', message: '没有可用的改动记录。' }
    if (fs === undefined) return { ok: false, code: 'NO_FS', message: '当前环境不能读写文件。' }
    const root = turnRoot(sessionId, seq)
    if (root === undefined) return { ok: false, code: 'NO_ROOT', message: '不知道这一轮的工作目录。' }

    // The recorder fuses this signal with its own lifetime through
    // `AbortSignal.any`, which rejects a missing entry: passing nothing is not
    // the same as passing "no cancellation".
    const diff = await service.diff(sessionId, seq, index, signal)
    if (diff === undefined) return { ok: false, code: 'NO_DIFF', message: '取不到这个文件的改动。' }
    if (diff.kind !== 'text') return { ok: false, code: 'UNSUPPORTED', message: '这个文件没有行级对比，不能回退。' }
    if (diff.coarse === true) return { ok: false, code: 'COARSE', message: '行比对超时，整文件按替换展示，不能安全回退。' }

    const target = await fs.resolve(diff.path, { cwd: root })
    const own = await fs.stat(target)

    // Three shapes, from the two booleans the recorder reports.
    if (diff.after === false) {
      // The turn deleted the file. Reverting brings it back: replaying the
      // comparison backwards over the empty file rebuilds the old side, since
      // a deletion hunk is nothing but removed lines.
      if (own !== undefined) {
        return { ok: false, code: 'STALE', message: '文件已经存在，不像是被这一轮删除的那个。' }
      }
      let restored
      try {
        restored = reverseApply(diff.hunks, '')
      } catch (error) {
        return { ok: false, code: 'MALFORMED', message: error?.message ?? '改动记录不完整。' }
      }
      return { ok: true, path: diff.path, display: diff.display, target, own, write: restored, shape: 'restore' }
    }

    const current = own === undefined ? '' : await fs.readText(target)

    if (diff.before === false) {
      // Added by this turn: the way back is an empty file, not a deletion —
      // `ctx.fs` has no remove, and an empty file is what the user chose.
      if (own === undefined) {
        return { ok: false, code: 'MISSING', message: '文件已经不在了，无需回退。' }
      }
      if (!roundTrips(diff.hunks, '', current)) {
        return { ok: false, code: 'STALE', message: '文件在本轮之后被改过，无法安全回退。' }
      }
      return { ok: true, path: diff.path, display: diff.display, target, own, write: '', shape: 'empty' }
    }

    let reverted
    try {
      reverted = reverseApply(diff.hunks, current)
    } catch (error) {
      const code = error?.code === 'MALFORMED' ? 'MALFORMED' : 'STALE'
      return { ok: false, code, message: error?.message ?? '文件与本轮的改动不符。' }
    }
    // The safety valve: replaying the reverted text forward has to land exactly
    // on what is on disk, or this is not the file the comparison describes.
    if (!roundTrips(diff.hunks, reverted, current)) {
      return { ok: false, code: 'STALE', message: '文件在本轮之后被改过，无法安全回退。' }
    }
    const next = keepEnding(reverted, current)
    return { ok: true, path: diff.path, display: diff.display, target, own, write: next, shape: 'rewrite' }
  }

  /**
   * Undo a revert: put the file back the way the turn left it.
   * @param {string} sessionId - session id.
   * @param {number} seq - the turn's `workspace/changes` sequence.
   * @param {number} index - the file's position in the turn's summary.
   * @param {AbortSignal} [signal] - cancellation, forwarded to the recorder.
   * @returns {Promise<object>} a plan, or `{ ok: false, code, message }`.
   */
  async function planRestore(sessionId, seq, index, signal) {
    const service = changes()
    const fs = files()
    if (service === undefined) return { ok: false, code: 'NO_RECORDER', message: '没有可用的改动记录。' }
    if (fs === undefined) return { ok: false, code: 'NO_FS', message: '当前环境不能读写文件。' }
    const root = turnRoot(sessionId, seq)
    if (root === undefined) return { ok: false, code: 'NO_ROOT', message: '不知道这一轮的工作目录。' }

    const diff = await service.diff(sessionId, seq, index, signal)
    if (diff === undefined) return { ok: false, code: 'NO_DIFF', message: '取不到这个文件的改动。' }
    if (diff.kind !== 'text') return { ok: false, code: 'UNSUPPORTED', message: '这个文件没有行级对比，不能撤销回退。' }
    if (diff.coarse === true) return { ok: false, code: 'COARSE', message: '行比对超时，整文件按替换展示，不能安全恢复。' }

    const target = await fs.resolve(diff.path, { cwd: root })
    const own = await fs.stat(target)
    if (own === undefined) return { ok: false, code: 'MISSING', message: '文件已经不在了。' }
    const current = await fs.readText(target)

    let next
    try {
      next = forwardApply(diff.hunks, current)
    } catch (error) {
      const code = error?.code === 'MALFORMED' ? 'MALFORMED' : 'STALE'
      return { ok: false, code, message: error?.message ?? '文件不是回退后的样子。' }
    }
    if (reverseApply(diff.hunks, next) !== terminate(current)) {
      return { ok: false, code: 'STALE', message: '文件不是回退后的样子，无法恢复。' }
    }
    return {
      ok: true,
      path: diff.path,
      display: diff.display,
      target,
      own,
      write: keepEnding(next, current),
      shape: 'rewrite',
    }
  }

  /**
   * The file-effect policy this session's own tools write under.
   *
   * Reverting is the undo of a write the agent already made, so it must be
   * judged by exactly the same policy that allowed that write: resolving with
   * the session keeps the plugin no more privileged than the turn itself, and
   * avoids falling back to the deployment default (which is usually narrower
   * than the session's own mode and would refuse every revert).
   *
   * @param {string} sessionId - session id.
   * @returns {object | undefined} the per-call policy, when the profile has one.
   */
  function policyFor(sessionId) {
    const policy = ctx.get('sandboxPolicy')
    if (policy === undefined || typeof policy.resolve !== 'function') return undefined
    const session = ctx.get('sessions')?.get(sessionId)
    return policy.resolve(session === undefined ? {} : { session })
  }

  /**
   * Write one planned file, guarded by the version that was read.
   * @param {object} fs - the filesystem service.
   * @param {object} plan - a plan from `planRevert` / `planRestore`.
   * @param {object} [policy] - the file-effect policy to write under.
   * @returns {Promise<{ path: string, ok: boolean, shape?: string, code?: string, message?: string }>}
   */
  async function commit(fs, plan, policy) {
    const expected =
      plan.own === undefined
        ? { kind: 'createIfAbsent' }
        : { kind: 'replaceIfVersion', version: plan.own.version }
    try {
      await fs.writeText(plan.target, plan.write, expected, undefined, policy)
      // `shape` travels back with the outcome so the pane can say what happened
      // to the file itself: a file this turn created is emptied rather than
      // removed, because the filesystem seam has no delete, and the reviewer
      // is the one who can remove it.
      return { path: plan.path, ok: true, shape: plan.shape }
    } catch (error) {
      return {
        path: plan.path,
        ok: false,
        code: typeof error?.code === 'string' ? error.code : 'WRITE_FAILED',
        message: error?.message ?? '写入失败。',
      }
    }
  }

  /**
   * The files a revert/restore request names, as summary positions.
   * @param {object} body - the parsed request body.
   * @param {object} summary - the turn's summary.
   * @returns {Array<{ index: number, path: string }> | undefined} the selection.
   */
  function selection(body, summary) {
    const all = body?.all === true
    const named = typeof body?.path === 'string' && body.path !== '' ? body.path : undefined
    if (!all && named === undefined) return undefined
    const out = []
    summary.files.forEach((entry, index) => {
      if (typeof entry?.path !== 'string' || entry.path === '') return
      if (!all && entry.path !== named) return
      out.push({ index, path: entry.path })
    })
    return out.length === 0 ? undefined : out
  }

  /** Change summaries come from the recorder plugin when it is composed in. */
  const changes = () => ctx.get('workspaceChanges')

  /** The filesystem the turn's files live in, when this profile provides one. */
  const files = () => ctx.get('fs')

  /**
   * The working directory a turn's relative paths are relative to.
   * @param {string} sessionId - session id.
   * @param {number} seq - the turn's `workspace/changes` sequence.
   * @returns {string | undefined} the directory, when the recorder knows it.
   */
  function turnRoot(sessionId, seq) {
    const summary = changes()?.summary(sessionId, seq)
    return typeof summary?.cwd === 'string' && summary.cwd !== '' ? summary.cwd : undefined
  }

  /**
   * The newest turn of one session, and whether it has ended.
   * @param {string} sessionId - session id.
   * @returns {{ state: 'running' } | { state: 'empty', turn: number } |
   *   { state: 'recorded', seq: number, turn: number } | undefined}
   *   the turn's state, or undefined for a session this Host does not know.
   */
  function latestTurn(sessionId) {
    const session = ctx.get('sessions')?.get(sessionId)
    if (session === undefined) return undefined
    const events = typeof session.ownEvents === 'function' ? session.ownEvents() : []
    // The last turn to start is the one the tab shows; whether it ended is a
    // separate fact, and a turn that changed nothing never writes a record, so
    // "no record" alone cannot mean "still running".
    let last = undefined
    for (const event of events) {
      if (event?.type !== 'turn/start') continue
      const turn = event.data?.turn
      if (Number.isSafeInteger(turn)) last = turn
    }
    if (last === undefined) return { state: 'running' }
    const ended = events.some(
      (event) => event?.type === 'turn/end' && event.data?.turn === last,
    )
    if (!ended) return { state: 'running' }
    const service = changes()
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i]
      if (event?.type !== 'workspace/changes') continue
      if (event.data?.turn !== last) continue
      if (service?.summary(sessionId, event.seq) === undefined) continue
      return { state: 'recorded', seq: Number(event.seq), turn: last }
    }
    // Ended with nothing recorded: the turn left the tree untouched.
    return { state: 'empty', turn: last }
  }

  /** How many of the newest recorded turns the tab offers to walk back to. */
  const RECENT_TURNS = 5

  /**
   * The newest recorded turns of one session, newest first.
   *
   * A turn is only offered when the recorder still serves its summary: the
   * records live in memory for the life of the process, so an older turn can
   * be gone while its event is still in the log. Offering one that cannot be
   * read would open a pane that says nothing but "unavailable".
   *
   * @param {string} sessionId - session id.
   * @returns {Array<{ turn: number, seq: number, files: number, added: number, deleted: number }> | undefined}
   *   the offered turns, or undefined for a session this Host does not know.
   */
  function recentTurns(sessionId) {
    const session = ctx.get('sessions')?.get(sessionId)
    if (session === undefined) return undefined
    const events = typeof session.ownEvents === 'function' ? session.ownEvents() : []
    const service = changes()
    const seen = new Set()
    const turns = []
    for (let i = events.length - 1; i >= 0 && turns.length < RECENT_TURNS; i -= 1) {
      const event = events[i]
      if (event?.type !== 'workspace/changes') continue
      const turn = event.data?.turn
      if (!Number.isSafeInteger(turn) || seen.has(turn)) continue
      const summary = service?.summary(sessionId, event.seq)
      if (summary === undefined) continue
      seen.add(turn)
      turns.push({
        turn,
        seq: Number(event.seq),
        files: Array.isArray(summary.files) ? summary.files.length : 0,
        added: summary.added,
        deleted: summary.deleted,
      })
    }
    return turns
  }

  ctx.inject(['connection'], (connectionCtx) => {
    const connection = connectionCtx.get('connection') ?? connectionCtx.connection
    const fetch = connection?.fetch
    if (fetch === undefined || typeof fetch.register !== 'function') return

    /** Register one route for the plugin's lifetime. */
    const route = (path, methods, handler, label) =>
      connectionCtx.effect(
        () => fetch.register({ path, methods, requestBody: 'buffered', fetch: handler }),
        label,
      )

    route(
      '/api/diff-review.latest',
      ['GET'],
      (request) => {
        const sessionId = new URL(request.url).searchParams.get('sessionId')
        if (!sessionId) return Promise.resolve(new Response('Invalid session.', { status: 400 }))
        const found = latestTurn(sessionId)
        if (found === undefined) {
          return Promise.resolve(new Response('Unknown session.', { status: 404 }))
        }
        // The state travels with the answer: a turn with nothing recorded used
        // to look exactly like a turn that had not finished yet.
        return Promise.resolve(Response.json(found, { headers: JSON_HEADERS }))
      },
      'diff-review: latest route',
    )

    route(
      '/api/diff-review.summary',
      ['GET'],
      (request) => {
        const query = new URL(request.url).searchParams
        const sessionId = query.get('sessionId')
        const seq = coordinate(query.get('seq'))
        if (!sessionId || seq === undefined) {
          return Promise.resolve(new Response('Invalid coordinates.', { status: 400 }))
        }
        const summary = changes()?.summary(sessionId, seq)
        if (summary === undefined) {
          return Promise.resolve(new Response('Summary unavailable.', { status: 404 }))
        }
        // `cwd` is deliberately dropped: the browser never needs a Host path.
        return Promise.resolve(
          Response.json(
            {
              turn: summary.turn,
              files: summary.files,
              total: summary.total,
              added: summary.added,
              deleted: summary.deleted,
            },
            { headers: JSON_HEADERS },
          ),
        )
      },
      'diff-review: summary route',
    )

    route(
      '/api/diff-review.diff',
      ['GET'],
      async (request) => {
        const query = new URL(request.url).searchParams
        const sessionId = query.get('sessionId')
        const seq = coordinate(query.get('seq'))
        const index = coordinate(query.get('index'))
        if (!sessionId || seq === undefined || index === undefined) {
          return new Response('Invalid coordinates.', { status: 400 })
        }
        const service = changes()
        if (service === undefined) return new Response('No recorder.', { status: 404 })
        try {
          const diff = await service.diff(sessionId, seq, index, request.signal)
          if (diff === undefined) return new Response('Comparison unavailable.', { status: 404 })
          return Response.json(diff, { headers: JSON_HEADERS })
        } catch {
          request.signal.throwIfAborted()
          return new Response('Comparison failed.', { status: 404 })
        }
      },
      'diff-review: diff route',
    )

    route(
      '/api/diff-review.state',
      ['GET'],
      async (request) => {
        const query = new URL(request.url).searchParams
        const sessionId = query.get('sessionId')
        const seq = coordinate(query.get('seq'))
        if (!sessionId || seq === undefined) {
          return new Response('Invalid coordinates.', { status: 400 })
        }
        return Response.json(await decisionsFor(sessionId, seq), { headers: JSON_HEADERS })
      },
      'diff-review: state route',
    )

    route(
      '/api/diff-review.confirm',
      ['POST'],
      async (request) => {
        let body
        try {
          body = await request.json()
        } catch {
          return new Response('Invalid body.', { status: 400 })
        }
        const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined
        const seq =
          Number.isSafeInteger(body?.seq) && body.seq >= 0 ? body.seq : undefined
        if (!sessionId || seq === undefined) {
          return new Response('Invalid decision.', { status: 400 })
        }
        // Three shapes share this route: one file (`path`), every file of the
        // turn (`all`), and taking a decision back (`undo`). An undone file
        // goes back to carrying no record at all, which is how "pending" is
        // spelled in the first place.
        const undo = body?.undo === true
        const all = body?.all === true
        const state =
          typeof body?.state === 'string' && STATES.has(body.state) ? body.state : undefined
        if (!undo && state === undefined) {
          return new Response('Invalid decision.', { status: 400 })
        }
        const opened = await domain()
        if (opened === undefined) return new Response('Decision store unavailable.', { status: 503 })
        const table = opened.table('decisions')
        const key = (path) => `${sessionId}/${seq}/${path}`

        if (all) {
          const summary = changes()?.summary(sessionId, seq)
          if (summary === undefined) return new Response('Summary unavailable.', { status: 404 })
          const at = Date.now()
          const written = []
          for (const entry of summary.files) {
            if (typeof entry?.path !== 'string' || entry.path === '') continue
            if (undo) {
              await table.delete(key(entry.path))
              continue
            }
            const record = { sessionId, seq, path: entry.path, state, at }
            await table.put(key(entry.path), record)
            written.push(record)
          }
          return Response.json(undo ? { cleared: true } : written, { headers: JSON_HEADERS })
        }

        const path = typeof body?.path === 'string' && body.path !== '' ? body.path : undefined
        if (!path) return new Response('Invalid decision.', { status: 400 })
        if (undo) {
          const existed = await table.delete(key(path))
          return Response.json({ path, existed }, { headers: JSON_HEADERS })
        }
        const record = { sessionId, seq, path, state, at: Date.now() }
        await table.put(key(path), record)
        return Response.json(record, { headers: JSON_HEADERS })
      },
      'diff-review: confirm route',
    )

    /**
     * Revert or restore one file, or every file of the turn.
     *
     * Both directions share this shape: pick the files, plan every one of them
     * without writing, then write what could be planned. A file that cannot be
     * planned is reported and left alone rather than aborting the whole batch,
     * because a turn whose files were partly edited since is the normal case,
     * not an error state.
     *
     * A whole turn can take a while — one comparison read per file — so a
     * caller may ask for `Accept: application/x-ndjson` and get one JSON line
     * per file instead of a single answer at the end. The transport streams the
     * body chunk by chunk, so the pane can say which file it is on. The write
     * order is unchanged: nothing is touched until every file has been planned.
     */
    const settle = (direction) => async (request) => {
      let body
      try {
        body = await request.json()
      } catch {
        return new Response('Invalid body.', { status: 400 })
      }
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined
      const seq = Number.isSafeInteger(body?.seq) && body.seq >= 0 ? body.seq : undefined
      if (!sessionId || seq === undefined) {
        return new Response('Invalid request.', { status: 400 })
      }
      const summary = changes()?.summary(sessionId, seq)
      if (summary === undefined) return new Response('Summary unavailable.', { status: 404 })
      const wanted = selection(body, summary)
      if (wanted === undefined) return new Response('No file named.', { status: 400 })

      const fs = files()
      if (fs === undefined) return new Response('No filesystem.', { status: 503 })

      // `AbortSignal.any` rejects an undefined entry, so a request without a
      // signal still has to hand the recorder something real.
      const signal = request.signal ?? new AbortController().signal
      const settleOne = direction === 'revert' ? planRevert : planRestore
      const total = wanted.length

      /** Plan every file, then write what could be planned. */
      const walk = async (emit) => {
        const results = []
        const writable = []
        for (let at = 0; at < wanted.length; at += 1) {
          const item = wanted[at]
          let plan
          try {
            plan = await settleOne(sessionId, seq, item.index, signal)
          } catch (error) {
            plan = { ok: false, code: 'READ_FAILED', message: error?.message ?? '读取失败。' }
          }
          emit({ step: 'plan', at, total, path: item.path })
          if (plan.ok !== true) {
            results.push({ path: item.path, ok: false, code: plan.code, message: plan.message })
            continue
          }
          writable.push(plan)
        }

        // Everything is planned; only now does anything touch the disk.
        const opened = await domain()
        const table = opened?.table('decisions')
        const policy = policyFor(sessionId)
        for (const plan of writable) {
          const outcome = await commit(fs, plan, policy)
          results.push(outcome)
          emit({ step: 'write', ...outcome })
          if (outcome.ok !== true || table === undefined) continue
          const key = `${sessionId}/${seq}/${plan.path}`
          if (direction === 'revert') {
            await table.put(key, { sessionId, seq, path: plan.path, state: 'reverted', at: Date.now() })
          } else {
            // Restoring returns the file to "no decision yet", which is how
            // pending is spelled: an absent record.
            await table.delete(key)
          }
        }
        const failed = results.filter((entry) => entry.ok !== true)
        return {
          results,
          reverted: direction === 'revert' ? results.length - failed.length : 0,
          failed: failed.length,
        }
      }

      if (request.headers.get('accept') !== 'application/x-ndjson') {
        const answer = await walk(() => undefined)
        return Response.json(answer, { headers: JSON_HEADERS })
      }

      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        async start(controller) {
          const emit = (record) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(record)}\n`))
          }
          try {
            const answer = await walk(emit)
            emit({ step: 'done', ...answer })
          } catch (error) {
            emit({ step: 'failed', message: error?.message ?? '回退失败。' })
          } finally {
            controller.close()
          }
        },
      })
      return new Response(stream, {
        headers: { ...JSON_HEADERS, 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' },
      })
    }

    route('/api/diff-review.revert', ['POST'], settle('revert'), 'diff-review: revert route')
    route('/api/diff-review.restore', ['POST'], settle('restore'), 'diff-review: restore route')

    route(
      '/api/diff-review.turns',
      ['GET'],
      (request) => {
        const sessionId = new URL(request.url).searchParams.get('sessionId')
        if (!sessionId) return Promise.resolve(new Response('Invalid session.', { status: 400 }))
        const turns = recentTurns(sessionId)
        if (turns === undefined) {
          return Promise.resolve(new Response('Unknown session.', { status: 404 }))
        }
        return Promise.resolve(Response.json({ turns }, { headers: JSON_HEADERS }))
      },
      'diff-review: turns route',
    )

    route(
      '/api/diff-review.note',
      ['POST'],
      async (request) => {
        let body
        try {
          body = await request.json()
        } catch {
          return new Response('Invalid body.', { status: 400 })
        }
        const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined
        const seq = Number.isSafeInteger(body?.seq) && body.seq >= 0 ? body.seq : undefined
        const path = typeof body?.path === 'string' && body.path !== '' ? body.path : undefined
        const text = typeof body?.text === 'string' && body.text.trim() !== '' ? body.text.trim() : undefined
        const hunk =
          body?.hunk === undefined
            ? undefined
            : Number.isSafeInteger(body.hunk) && body.hunk >= 0
              ? body.hunk
              : null
        if (!sessionId || seq === undefined || path === undefined || text === undefined || hunk === null) {
          return new Response('Invalid note.', { status: 400 })
        }
        // A note names a file of a turn, so the turn has to be the one the
        // recorder still holds. Accepting an arbitrary path would let a typo
        // park prose next to a file that this review never showed.
        const summary = changes()?.summary(sessionId, seq)
        if (summary === undefined) return new Response('Summary unavailable.', { status: 404 })
        if (!summary.files.some((entry) => entry?.path === path)) {
          return new Response('Unknown file.', { status: 404 })
        }
        const opened = await domain()
        if (opened === undefined) return new Response('Note store unavailable.', { status: 503 })
        const table = opened.table('notes')
        // The timestamp is part of the key so one file can carry several
        // notes; two notes written in the same millisecond still get distinct
        // keys because the stamp is nudged forward until it is free.
        const taken = new Set()
        for (const [entryKey] of table.entries()) taken.add(entryKey)
        let at = Date.now()
        while (taken.has(`${sessionId}/${seq}/${path}/${at}`)) at += 1
        const record = { sessionId, seq, path, ...(hunk === undefined ? {} : { hunk }), text, at }
        await table.put(`${sessionId}/${seq}/${path}/${at}`, record)
        // A noted file also carries the `edited` decision, so the list can mark
        // which files already have their say queued without a second request.
        const decisions = opened.table('decisions')
        await decisions.put(`${sessionId}/${seq}/${path}`, {
          sessionId,
          seq,
          path,
          state: 'edited',
          at,
        })
        return Response.json({ note: record, notes: await notesFor(sessionId, seq) }, { headers: JSON_HEADERS })
      },
      'diff-review: note route',
    )

    route(
      '/api/diff-review.unote',
      ['POST'],
      async (request) => {
        let body
        try {
          body = await request.json()
        } catch {
          return new Response('Invalid body.', { status: 400 })
        }
        const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : undefined
        const seq = Number.isSafeInteger(body?.seq) && body.seq >= 0 ? body.seq : undefined
        const path = typeof body?.path === 'string' && body.path !== '' ? body.path : undefined
        const at = Number.isSafeInteger(body?.at) && body.at >= 0 ? body.at : undefined
        if (sessionId === undefined || seq === undefined || path === undefined || at === undefined) {
          return new Response('Invalid note.', { status: 400 })
        }
        const opened = await domain()
        if (opened === undefined) return new Response('Note store unavailable.', { status: 503 })
        const table = opened.table('notes')
        // Removed by its full identity, not by position: a note is addressed by
        // the file it belongs to and the stamp that made its key unique.
        await table.delete(`${sessionId}/${seq}/${path}/${at}`)
        const left = await notesFor(sessionId, seq)
        // The `edited` mark means "this file has notes waiting". Once the last
        // one is gone that is no longer true, so the mark goes with it — but
        // only when the decision is still the note's; a reviewer who has since
        // confirmed or reverted the file keeps that decision.
        if (!left.some((note) => note.path === path)) {
          const decisions = opened.table('decisions')
          const held = (await decisionsFor(sessionId, seq))[path]
          if (held !== undefined && held.state === 'edited') {
            await decisions.delete(`${sessionId}/${seq}/${path}`)
          }
        }
        return Response.json({ notes: left }, { headers: JSON_HEADERS })
      },
      'diff-review: unote route',
    )

    route(
      '/api/diff-review.enote',
      ['POST'],
      async (request) => {
        let body
        try {
          body = await request.json()
        } catch {
          return new Response('Invalid body.', { status: 400 })
        }
        const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : undefined
        const seq = Number.isSafeInteger(body?.seq) && body.seq >= 0 ? body.seq : undefined
        const path = typeof body?.path === 'string' && body.path !== '' ? body.path : undefined
        const at = Number.isSafeInteger(body?.at) && body.at >= 0 ? body.at : undefined
        const text = typeof body?.text === 'string' && body.text.trim() !== '' ? body.text.trim() : undefined
        if (
          sessionId === undefined ||
          seq === undefined ||
          path === undefined ||
          at === undefined ||
          text === undefined
        ) {
          return new Response('Invalid note.', { status: 400 })
        }
        const summary = changes()?.summary(sessionId, seq)
        if (summary === undefined) return new Response('Summary unavailable.', { status: 404 })
        if (!summary.files.some((entry) => entry?.path === path)) {
          return new Response('Unknown file.', { status: 404 })
        }
        const opened = await domain()
        if (opened === undefined) return new Response('Note store unavailable.', { status: 503 })
        const table = opened.table('notes')
        const key = `${sessionId}/${seq}/${path}/${at}`
        const held = table.get(key)
        // Rewriting a note keeps its `at`, so the key stays the address the
        // browser already holds and no other note of the same file is touched.
        // A note that is no longer there is a 404 rather than a fresh insert:
        // the text belongs to something the reviewer was looking at, and that
        // thing is gone.
        if (held === undefined) return new Response('Unknown note.', { status: 404 })
        const record = { ...held, text }
        await table.put(key, record)
        return Response.json({ note: record, notes: await notesFor(sessionId, seq) }, { headers: JSON_HEADERS })
      },
      'diff-review: enote route',
    )

    route(
      '/api/diff-review.notes',
      ['GET'],
      async (request) => {
        const query = new URL(request.url).searchParams
        const sessionId = query.get('sessionId')
        const seq = coordinate(query.get('seq'))
        if (!sessionId || seq === undefined) {
          return new Response('Invalid coordinates.', { status: 400 })
        }
        return Response.json({ notes: await notesFor(sessionId, seq) }, { headers: JSON_HEADERS })
      },
      'diff-review: notes route',
    )
  })
}
