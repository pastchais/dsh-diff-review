/**
 * Headless contract test for the Host half.
 *
 * Mounts `lib/index.js` against a fake Cordis context: an effect registry, a
 * `connection.fetch` that records routes, a `workspaceChanges` double, and a
 * `storageDomain` double. Then it drives every route end to end. This catches
 * the failures that are otherwise only visible as a 404 in the browser.
 *
 * Run: node test/host-contract.mjs
 */

import assert from 'node:assert/strict'

const routes = new Map()

/** Records one decision in a Map, keyed exactly as the domain table would. */
const decisions = new Map()
/** Records notes in a Map of their own: the two tables never share a table. */
const notes = new Map()

/** A table double with the two methods the plugin uses. */
const tableOf = (rows) => ({
  get: (key) => rows.get(key),
  entries: () => rows.entries(),
  put: async (key, value) => {
    rows.set(key, value)
  },
  delete: async (key) => rows.delete(key),
})

const domainTable = tableOf(decisions)
const noteTable = tableOf(notes)

const storageDomain = {
  open: async (spec) => {
    assert.equal(spec.name, 'diff_review')
    assert.ok(spec.tables.decisions, 'the decisions table is declared')
    assert.ok(spec.tables.notes, 'the notes table is declared')
    // Version 1 keeps the file that is already on disk readable; a bump would
    // make the storage backend refuse to open it.
    assert.equal(spec.version, 1, 'adding a table does not bump the version')
    const schema = spec.tables.decisions.valueSchema
    // The facility validates every stored record against this schema.
    assert.equal(typeof schema.parse, 'function')
    assert.throws(() => schema.parse({ sessionId: '', seq: 0, path: 'x', state: 'confirmed', at: 1 }))
    assert.throws(() => schema.parse({ sessionId: 's', seq: 0, path: 'x', state: 'bogus', at: 1 }))
    schema.parse({ sessionId: 's', seq: 0, path: 'x', state: 'confirmed', at: 1 })
    const noteSchema = spec.tables.notes.valueSchema
    assert.equal(typeof noteSchema.parse, 'function')
    assert.throws(() => noteSchema.parse({ sessionId: 's', seq: 0, path: 'x', text: '   ', at: 1 }))
    assert.throws(() => noteSchema.parse({ sessionId: 's', seq: 0, path: 'x', at: 1 }))
    noteSchema.parse({ sessionId: 's', seq: 0, path: 'x', text: 'ok', at: 1 })
    return {
      table: (name) => (name === 'notes' ? noteTable : domainTable),
      close: async () => undefined,
    }
  },
}

/** Two recorded turns; only the second is still served. Both have ended. */
const events = [
  { type: 'turn/start', seq: 1, data: { turn: 1 } },
  { type: 'workspace/changes', seq: 4, data: { turn: 1 } },
  { type: 'turn/end', seq: 5, data: { turn: 1, reason: { kind: 'completed' } } },
  { type: 'turn/start', seq: 6, data: { turn: 2 } },
  { type: 'workspace/changes', seq: 9, data: { turn: 2 } },
  { type: 'turn/end', seq: 10, data: { turn: 2, reason: { kind: 'completed' } } },
]

/** The turn the pane shows, and the one the revert tests drive. */
const summaries = new Map([
  [
    'session-1/9',
    {
      turn: 2,
      cwd: 'D:/work/demo',
      files: [
        { path: 'src/a.ts', display: 'src/a.ts', added: 3, deleted: 1 },
        { path: 'src/b.ts', display: 'src/b.ts', added: 1, deleted: 0, binary: true },
      ],
      total: 2,
      added: 4,
      deleted: 1,
    },
  ],
  [
    'session-revert/12',
    {
      turn: 5,
      cwd: 'D:/repo',
      files: [
        { path: 'src/edited.ts', display: 'src/edited.ts', added: 1, deleted: 1 },
        { path: 'src/added.ts', display: 'src/added.ts', added: 2, deleted: 0 },
        { path: 'src/gone.ts', display: 'src/gone.ts', added: 0, deleted: 2 },
        { path: 'src/coarse.ts', display: 'src/coarse.ts', added: 1, deleted: 1 },
        { path: 'src/stale.ts', display: 'src/stale.ts', added: 1, deleted: 1 },
        { path: 'src/blob.bin', display: 'src/blob.bin', added: 0, deleted: 0, binary: true },
      ],
      total: 6,
      added: 5,
      deleted: 5,
    },
  ],
])

/** One text comparison, carrying the two booleans and the hunks. */
const textDiff = (path, before, after, hunks, extra = {}) => ({
  kind: 'text',
  path,
  display: path,
  before,
  after,
  coarse: false,
  hunks,
  ...extra,
})

/** One file per shape reverting has to handle. */
const revertDiffs = [
  textDiff('src/edited.ts', true, true, [
    { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' alpha', '-beta', '+BETA'] },
  ]),
  textDiff('src/added.ts', false, true, [
    { oldStart: 1, oldLines: 0, newStart: 1, newLines: 2, lines: ['+one', '+two'] },
  ]),
  textDiff('src/gone.ts', true, false, [
    { oldStart: 1, oldLines: 2, newStart: 1, newLines: 0, lines: ['-x', '-y'] },
  ]),
  textDiff(
    'src/coarse.ts',
    true,
    true,
    [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-was', '+now'] }],
    { coarse: true },
  ),
  textDiff('src/stale.ts', true, true, [
    { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' keep', '-old', '+new'] },
  ]),
  { kind: 'binary', path: 'src/blob.bin', display: 'src/blob.bin' },
]

const workspaceChanges = {
  summary: (sessionId, seq) => summaries.get(`${sessionId}/${seq}`),
  diff: async (sessionId, seq, index, signal) => {
    diffSignals.push(signal)
    if (sessionId === 'session-1' && seq === 9) {
      return index === 0
        ? textDiff('src/a.ts', true, true, [
            { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] },
          ])
        : undefined
    }
    if (sessionId === 'session-revert' && seq === 12) return revertDiffs[index]
    return undefined
  },
}

/**
 * An in-memory filesystem honouring the real contract: `createIfAbsent`
 * refuses a file that is there, `replaceIfVersion` refuses one whose version
 * moved since it was read. Versions advance on every write.
 */
const disk = new Map()
const writeIntents = []
/** Every signal the recorder double was handed, to prove none was missing. */
const diffSignals = []
let enableFs = true

/**
 * The policy double: the plugin has to resolve one for the session rather than
 * letting the backend fall back to the deployment default, so this records
 * what it was asked for and hands back a matching mode.
 */
const policyCalls = []
const sandboxPolicy = {
  resolve: (request = {}) => {
    policyCalls.push(request.session)
    return { mode: 'workspace-write', workspaceRoot: '/work', ...(request.session === undefined ? {} : { sessionId: request.session.id }) }
  },
}

/** Put a file on the fake disk with version 1. */
const seed = (path, content) => disk.set(path, { content, version: 1 })

const fsDouble = {
  resolve: async (path, options = {}) => {
    const cwd = typeof options.cwd === 'string' ? options.cwd : ''
    const full = path.startsWith('/') ? path : `${cwd.replace(/\/+$/, '')}/${path}`
    return { path: full }
  },
  stat: async (target) => {
    const file = disk.get(target.path)
    return file === undefined ? undefined : { type: 'file', version: file.version, size: file.content.length }
  },
  readText: async (target) => {
    const file = disk.get(target.path)
    if (file === undefined) throw Object.assign(new Error('no such file'), { code: 'FS_NOT_FOUND' })
    return file.content
  },
  writeText: async (target, content, expected) => {
    writeIntents.push({ path: target.path, kind: expected?.kind })
    const file = disk.get(target.path)
    if (expected?.kind === 'createIfAbsent') {
      if (file !== undefined) throw Object.assign(new Error('already present'), { code: 'FS_NOT_OBSERVED' })
      disk.set(target.path, { content, version: 1 })
      return { before: undefined, after: { version: 1 } }
    }
    if (expected?.kind === 'replaceIfVersion') {
      if (file === undefined) throw Object.assign(new Error('vanished'), { code: 'FS_STALE_VERSION' })
      if (file.version !== expected.version) throw Object.assign(new Error('moved'), { code: 'FS_STALE_VERSION' })
      disk.set(target.path, { content, version: file.version + 1 })
      return { before: { version: file.version }, after: { version: file.version + 1 } }
    }
    throw Object.assign(new Error('unexpected intent'), { code: 'FS_BAD_INTENT' })
  },
}

/** A turn still in flight: started, not ended, nothing recorded yet. */
const runningEvents = [{ type: 'turn/start', seq: 1, data: { turn: 3 } }]
/** A turn that ended without touching any file: no record was written. */
const emptyEvents = [
  { type: 'turn/start', seq: 1, data: { turn: 4 } },
  { type: 'turn/end', seq: 2, data: { turn: 4, reason: { kind: 'completed' } } },
]

const fixtures = new Map([
  ['session-1', events],
  ['session-running', runningEvents],
  ['session-empty', emptyEvents],
  ['session-revert', events],
])

const sessions = {
  get: (id) => {
    const own = fixtures.get(id)
    return own === undefined ? undefined : { id, ownEvents: () => own }
  },
}

const ctx = {
  effect: (callback) => {
    const disposer = callback()
    return () => {
      if (typeof disposer === 'function') disposer()
    }
  },
  inject: (services, callback) => {
    callback(ctx)
    return () => undefined
  },
  get: (name) => {
    if (name === 'storageDomain') return storageDomain
    if (name === 'workspaceChanges') return workspaceChanges
    if (name === 'sessions') return sessions
    if (name === 'sandboxPolicy') return sandboxPolicy
    if (name === 'fs') return enableFs ? fsDouble : undefined
    if (name === 'connection') return { fetch: { register: (route) => { routes.set(route.path, route); return () => undefined } } }
    return undefined
  },
}

const plugin = await import('../lib/index.js')
assert.equal(typeof plugin.apply, 'function')
plugin.apply(ctx)

/** Call one route the way Connection would, with a Request and no cookie. */
async function call(path, { query = {}, method = 'GET', body, accept } = {}) {
  const route = routes.get(path)
  assert.ok(route, `route ${path} is registered`)
  assert.ok(route.methods.includes(method), `${path} accepts ${method}`)
  const url = new URL('http://127.0.0.1:3080' + path)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value))
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (accept !== undefined) headers.accept = accept
  const request = new Request(url, {
    method,
    signal: new AbortController().signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
  })
  return route.fetch(request)
}

/* ── the routes exist ───────────────────────────────────────────────── */

for (const path of [
  '/api/diff-review.latest',
  '/api/diff-review.summary',
  '/api/diff-review.diff',
  '/api/diff-review.state',
  '/api/diff-review.confirm',
]) {
  assert.ok(routes.has(path), `${path} registered`)
}

/* ── latest ─────────────────────────────────────────────────────────── */

let response = await call('/api/diff-review.latest', { query: { sessionId: 'session-1' } })
assert.equal(response.status, 200)
assert.deepEqual(
  await response.json(),
  { state: 'recorded', seq: 9, turn: 2 },
  'the newest ended turn with a record wins',
)

response = await call('/api/diff-review.latest', { query: { sessionId: 'session-running' } })
assert.equal(response.status, 200)
assert.deepEqual(
  await response.json(),
  { state: 'running' },
  'a turn that has not ended reads as running, not as an error',
)

response = await call('/api/diff-review.latest', { query: { sessionId: 'session-empty' } })
assert.equal(response.status, 200)
assert.deepEqual(
  await response.json(),
  { state: 'empty', turn: 4 },
  'a turn that ended without changes is distinct from one still running',
)

response = await call('/api/diff-review.latest', { query: { sessionId: 'nope' } })
assert.equal(response.status, 404, 'only an unknown session answers 404')

response = await call('/api/diff-review.latest')
assert.equal(response.status, 400)

/* ── summary: cwd is stripped ───────────────────────────────────────── */

response = await call('/api/diff-review.summary', { query: { sessionId: 'session-1', seq: 9 } })
assert.equal(response.status, 200)
const summary = await response.json()
assert.equal(summary.turn, 2)
assert.equal(summary.files.length, 2)
assert.equal('cwd' in summary, false, 'the Host working directory never reaches the browser')

response = await call('/api/diff-review.summary', { query: { sessionId: 'session-1', seq: 4 } })
assert.equal(response.status, 404, 'a turn whose snapshots are gone answers 404')

/* ── diff ───────────────────────────────────────────────────────────── */

response = await call('/api/diff-review.diff', {
  query: { sessionId: 'session-1', seq: 9, index: 0 },
})
assert.equal(response.status, 200)
assert.equal((await response.json()).kind, 'text')

response = await call('/api/diff-review.diff', {
  query: { sessionId: 'session-1', seq: 9, index: 1 },
})
assert.equal(response.status, 404)

/* ── state + confirm round trip ─────────────────────────────────────── */

response = await call('/api/diff-review.state', { query: { sessionId: 'session-1', seq: 9 } })
assert.equal(response.status, 200)
assert.deepEqual(await response.json(), {})

response = await call('/api/diff-review.confirm', {
  method: 'POST',
  body: { sessionId: 'session-1', seq: 9, path: 'src/a.ts', state: 'confirmed' },
})
assert.equal(response.status, 200)
const record = await response.json()
assert.equal(record.state, 'confirmed')

response = await call('/api/diff-review.state', { query: { sessionId: 'session-1', seq: 9 } })
assert.deepEqual(await response.json(), {
  'src/a.ts': { state: 'confirmed', at: record.at },
})

/* ── the decisions do not leak across turns ─────────────────────────── */

response = await call('/api/diff-review.state', { query: { sessionId: 'session-1', seq: 4 } })
assert.deepEqual(await response.json(), {}, 'a later turn re-reading the same path starts clean')

/* ── bad input is refused, not stored ───────────────────────────────── */

for (const body of [
  { sessionId: 'session-1', seq: 9, path: 'src/a.ts', state: 'approved' },
  { sessionId: 'session-1', seq: -1, path: 'src/a.ts', state: 'confirmed' },
  { sessionId: 'session-1', seq: 9, path: '', state: 'confirmed' },
  { sessionId: '', seq: 9, path: 'src/a.ts', state: 'confirmed' },
]) {
  response = await call('/api/diff-review.confirm', { method: 'POST', body })
  assert.equal(response.status, 400, `refused: ${JSON.stringify(body)}`)
}
assert.equal(decisions.size, 1, 'only the valid decision was written')

/* ── taking a decision back leaves no record behind ─────────────────── */

response = await call('/api/diff-review.confirm', {
  method: 'POST',
  body: { sessionId: 'session-1', seq: 9, path: 'src/a.ts', undo: true },
})
assert.equal(response.status, 200)
assert.deepEqual(await response.json(), { path: 'src/a.ts', existed: true })
assert.equal(decisions.size, 0, 'an undone file carries no record, which is how pending is spelled')

response = await call('/api/diff-review.state', { query: { sessionId: 'session-1', seq: 9 } })
assert.deepEqual(await response.json(), {}, 'the pane reads the file as pending again')

/* ── confirming every file settles the whole turn ───────────────────── */

response = await call('/api/diff-review.confirm', {
  method: 'POST',
  body: { sessionId: 'session-1', seq: 9, all: true, state: 'confirmed' },
})
assert.equal(response.status, 200)
const batch = await response.json()
assert.deepEqual(
  batch.map((entry) => entry.path),
  ['src/a.ts', 'src/b.ts'],
  'every changed file of the turn is settled, not just the shown one',
)
response = await call('/api/diff-review.state', { query: { sessionId: 'session-1', seq: 9 } })
assert.deepEqual(Object.keys(await response.json()).sort(), ['src/a.ts', 'src/b.ts'])

response = await call('/api/diff-review.confirm', {
  method: 'POST',
  body: { sessionId: 'session-1', seq: 4, all: true, state: 'confirmed' },
})
assert.equal(response.status, 404, 'a turn with no served summary cannot be settled in bulk')

/* ── reverting one file writes the other side to disk ───────────────── */

/** The last write the route aimed at one path, to check how it was guarded. */
const intentFor = (path) => writeIntents.filter((entry) => entry.path === path).at(-1)

seed('D:/repo/src/edited.ts', 'alpha\nBETA\n')
seed('D:/repo/src/added.ts', 'one\ntwo\n')
seed('D:/repo/src/coarse.ts', 'now\n')
seed('D:/repo/src/stale.ts', 'keep\nnewer\n')
// `src/gone.ts` is deliberately absent: the turn deleted it.

response = await call('/api/diff-review.revert', {
  method: 'POST',
  body: { sessionId: 'session-revert', seq: 12, path: 'src/edited.ts' },
})
assert.equal(response.status, 200)
let settleResult = await response.json()
assert.deepEqual(settleResult.results, [{ path: 'src/edited.ts', ok: true, shape: 'rewrite' }])
assert.equal(settleResult.failed, 0)
assert.equal(settleResult.reverted, 1)
assert.equal(disk.get('D:/repo/src/edited.ts').content, 'alpha\nbeta\n', 'the turn is undone on disk')
assert.equal(
  intentFor('D:/repo/src/edited.ts').kind,
  'replaceIfVersion',
  'an existing file is written against the version that was read',
)

response = await call('/api/diff-review.state', { query: { sessionId: 'session-revert', seq: 12 } })
assert.equal(
  (await response.json())['src/edited.ts'].state,
  'reverted',
  'reverting records the decision so the pane can show it',
)

/* ── undoing the revert puts the turn's version back ────────────────── */

response = await call('/api/diff-review.restore', {
  method: 'POST',
  body: { sessionId: 'session-revert', seq: 12, path: 'src/edited.ts' },
})
assert.equal(response.status, 200)
assert.equal((await response.json()).failed, 0)
assert.equal(disk.get('D:/repo/src/edited.ts').content, 'alpha\nBETA\n', 'restoring redoes the change')
response = await call('/api/diff-review.state', { query: { sessionId: 'session-revert', seq: 12 } })
assert.deepEqual(await response.json(), {}, 'a restored file is pending again, not merely unset')

/* ── one request settles every file of the turn ─────────────────────── */

response = await call('/api/diff-review.revert', {
  method: 'POST',
  body: { sessionId: 'session-revert', seq: 12, all: true },
})
assert.equal(response.status, 200)
settleResult = await response.json()
const byPath = new Map(settleResult.results.map((entry) => [entry.path, entry]))
assert.equal(byPath.get('src/edited.ts').ok, true)
assert.equal(disk.get('D:/repo/src/edited.ts').content, 'alpha\nbeta\n')
// Added by the turn: the way back is an empty file, not a deletion.
assert.equal(byPath.get('src/added.ts').ok, true)
assert.equal(disk.get('D:/repo/src/added.ts').content, '', 'an added file reverts to empty, never to gone')
// The shape travels with the outcome: the pane tells the reviewer a file was
// emptied rather than removed, and only the Host knows which case this was.
assert.equal(byPath.get('src/added.ts').shape, 'empty', 'an emptied file says so in its outcome')
assert.equal(byPath.get('src/edited.ts').shape, 'rewrite', 'a rewritten file says so in its outcome')
// A refused file carries no shape: nothing was written, so nothing happened.
assert.equal(byPath.get('src/coarse.ts').shape, undefined, 'a refusal reports no shape')
// Deleted by the turn: the patch rebuilds the file without needing a template.
assert.equal(byPath.get('src/gone.ts').ok, true)
assert.equal(disk.get('D:/repo/src/gone.ts').content, 'x\ny\n', 'a deleted file comes back byte for byte')
assert.equal(
  intentFor('D:/repo/src/gone.ts').kind,
  'createIfAbsent',
  'a file that is not there is created, not replaced',
)

/* ── what cannot be reverted is refused, per file and by code ───────── */

assert.equal(byPath.get('src/coarse.ts').ok, false)
assert.equal(byPath.get('src/coarse.ts').code, 'COARSE', 'a timed-out comparison is not replayed')
assert.equal(disk.get('D:/repo/src/coarse.ts').content, 'now\n', 'a refused file is left untouched')
assert.equal(byPath.get('src/stale.ts').ok, false)
assert.equal(byPath.get('src/stale.ts').code, 'STALE', 'a file edited after the turn is not overwritten')
assert.equal(disk.get('D:/repo/src/stale.ts').content, 'keep\nnewer\n', 'the stale file keeps its own text')
assert.equal(byPath.get('src/blob.bin').ok, false)
assert.equal(byPath.get('src/blob.bin').code, 'UNSUPPORTED', 'binary files have no line comparison')
assert.equal(settleResult.failed, 3)
assert.equal(settleResult.reverted, 3, 'the three valid files still settle while three are refused')

// The undo path names its shape too, so the pane can report it in the same
// vocabulary whichever direction it went.
response = await call('/api/diff-review.restore', {
  method: 'POST',
  body: { sessionId: 'session-revert', seq: 12, path: 'src/added.ts' },
})
assert.equal(response.status, 200)
const restored = (await response.json()).results[0]
assert.equal(restored.ok, true, 'an emptied file can be restored')
assert.equal(restored.shape, 'rewrite', 'restoring always rebuilds content from the patch')

/* ── the same file cannot be reverted twice in a row ────────────────── */

response = await call('/api/diff-review.revert', {
  method: 'POST',
  body: { sessionId: 'session-revert', seq: 12, path: 'src/edited.ts' },
})
assert.equal(response.status, 200)
settleResult = await response.json()
assert.equal(settleResult.results[0].ok, false, 'reverting an already reverted file is refused')
assert.equal(settleResult.results[0].code, 'STALE')

/* ── bad requests are refused before anything is written ────────────── */

const writesBefore = writeIntents.length
response = await call('/api/diff-review.revert', {
  method: 'POST',
  body: { sessionId: 'session-revert', seq: 99, path: 'src/edited.ts' },
})
assert.equal(response.status, 404, 'a turn with no served summary cannot be reverted')

response = await call('/api/diff-review.revert', {
  method: 'POST',
  body: { sessionId: 'session-revert', seq: 12, path: 'src/unknown.ts' },
})
assert.equal(response.status, 400, 'a path the turn did not touch is refused')

response = await call('/api/diff-review.revert', {
  method: 'POST',
  body: { sessionId: 'session-revert', seq: 12 },
})
assert.equal(response.status, 400, 'a request naming no file is refused')

enableFs = false
response = await call('/api/diff-review.revert', {
  method: 'POST',
  body: { sessionId: 'session-revert', seq: 12, path: 'src/edited.ts' },
})
assert.equal(response.status, 503, 'without a filesystem the route says so instead of pretending')
enableFs = true
assert.equal(writeIntents.length, writesBefore, 'none of the refused requests reached the disk')

/* ── the same call streamed, one line per file ─────────────────────── */

// A whole turn is one comparison read per file, which is slow enough to need
// progress. Asking for NDJSON gives one JSON line per step and ends with a
// `done` line carrying the same summary the plain call would have returned.
seed('src/edited.ts', 'alpha\nBETA\n')
seed('src/added.ts', 'kept\n')
seed('src/gone.ts', 'x\ny\n')
seed('src/coarse.ts', 'coarse\n')
seed('src/stale.ts', 'drifted\n')
response = await call('/api/diff-review.revert', {
  method: 'POST',
  body: { sessionId: 'session-revert', seq: 12, all: true },
  accept: 'application/x-ndjson',
})
assert.equal(response.status, 200)
assert.equal(
  response.headers.get('content-type'),
  'application/x-ndjson',
  'the streamed answer says what it is',
)
const lines = (await response.text())
  .split('\n')
  .filter((line) => line !== '')
  .map((line) => JSON.parse(line))
assert.ok(lines.length > 0, 'the stream carries lines instead of one late answer')
assert.deepEqual(
  lines.at(-1).step,
  'done',
  'the stream ends with the summary line',
)
const streamResult = lines.at(-1)
assert.equal(
  lines.filter((one) => one.step === 'plan').length,
  revertDiffs.length,
  'every file of the turn reports its planning step',
)
const written = lines.filter((one) => one.step === 'write')
assert.equal(written.length, streamResult.reverted, 'only the files that were written report a write')
assert.equal(
  written.every((one) => one.ok === true),
  true,
  'a write step is emitted after the write, so it carries its outcome',
)
assert.equal(
  streamResult.results.length,
  revertDiffs.length,
  'the done line carries one result per file',
)
assert.equal(
  streamResult.results.filter((one) => one.ok !== true).length,
  streamResult.failed,
  'the counts on the done line agree with its own results',
)

/* ── the recorder is always handed a real signal, and the write a policy ── */

assert.ok(diffSignals.length > 0, 'the recorder was asked for comparisons')
assert.ok(
  diffSignals.every((signal) => signal instanceof AbortSignal),
  'every comparison got an AbortSignal: the recorder fuses it with its own lifetime',
)
assert.ok(policyCalls.length > 0, 'a write resolved a sandbox policy first')
assert.ok(
  policyCalls.every((session) => session !== undefined && session.id === 'session-revert'),
  'the policy is resolved for the session, not for the deployment default',
)

/* ── the turns still on offer ───────────────────────────────────────── */

// The picker lists what the recorder can still answer for, newest first. An
// older turn whose record has aged out must not be offered: opening it would
// show a pane that can only say "no longer available".
response = await call('/api/diff-review.turns', { query: { sessionId: 'session-1' } })
assert.equal(response.status, 200)
assert.deepEqual(
  await response.json(),
  { turns: [{ turn: 2, seq: 9, files: 2, added: 4, deleted: 1 }] },
  'turn 1 has no summary left, so only turn 2 is offered',
)
const offeredBody = await (await call('/api/diff-review.turns', { query: { sessionId: 'session-1' } })).text()
assert.equal(offeredBody.includes('/work'), false, 'the offered turns carry no Host path either')

response = await call('/api/diff-review.turns', { query: { sessionId: 'session-running' } })
assert.deepEqual(await response.json(), { turns: [] }, 'a session with no record offers nothing')

response = await call('/api/diff-review.turns', { query: { sessionId: 'nobody' } })
assert.equal(response.status, 404, 'an unknown session is told so')

response = await call('/api/diff-review.turns')
assert.equal(response.status, 400, 'a request without a session is refused')

/* ── notes: an instruction, never a write ───────────────────────────── */

// The revert tests above already wrote files; notes must add nothing to that.
const writesBeforeNotes = writeIntents.length

// The note route records what the reviewer wants changed next. It has to
// refuse a file this turn never listed: a typo would otherwise hang advice on
// something that was never reviewed.
response = await call('/api/diff-review.note', {
  method: 'POST',
  body: { sessionId: 'session-1', seq: 9, path: 'src/a.ts', text: '  split the parse  ' },
})
assert.equal(response.status, 200, 'a note on a listed file is accepted')
const noted = await response.json()
assert.equal(noted.notes.length, 1, 'the route answers with the turn’s notes')
assert.equal(noted.notes[0].text, 'split the parse', 'the text is trimmed before it is stored')
assert.equal(noted.notes[0].path, 'src/a.ts')
assert.equal(notes.size, 1, 'the note is stored in the notes table')
assert.equal(
  decisions.get('session-1/9/src/a.ts')?.state,
  'edited',
  'the file is marked edited so the list can show it was spoken about',
)

// A second note on the same file keeps the first: they are separate records.
response = await call('/api/diff-review.note', {
  method: 'POST',
  body: { sessionId: 'session-1', seq: 9, path: 'src/a.ts', text: 'and cover the empty case' },
})
assert.equal(response.status, 200)
assert.equal((await response.json()).notes.length, 2, 'notes accumulate per file')
assert.equal(notes.size, 2, 'each note gets its own key, even in the same millisecond')

response = await call('/api/diff-review.note', {
  method: 'POST',
  body: { sessionId: 'session-1', seq: 9, path: 'src/never.ts', text: 'hello' },
})
assert.equal(response.status, 404, 'a file the turn never listed is refused')

response = await call('/api/diff-review.note', {
  method: 'POST',
  body: { sessionId: 'session-1', seq: 9, path: 'src/a.ts', text: '   ' },
})
assert.equal(response.status, 400, 'an empty note is refused')

response = await call('/api/diff-review.note', {
  method: 'POST',
  body: { sessionId: 'session-1', seq: 404, path: 'src/a.ts', text: 'hello' },
})
assert.equal(response.status, 404, 'a turn with no summary is refused')

response = await call('/api/diff-review.notes', { query: { sessionId: 'session-1', seq: 9 } })
assert.equal(response.status, 200)
assert.deepEqual(
  (await response.json()).notes.map((note) => note.text),
  ['split the parse', 'and cover the empty case'],
  'notes come back in the order they were written',
)

response = await call('/api/diff-review.notes', { query: { sessionId: 'session-1' } })
assert.equal(response.status, 400, 'reading notes without coordinates is refused')

// Writing a note must never touch the disk: it is advice for the next turn.
assert.equal(writeIntents.length, writesBeforeNotes, 'recording notes writes no file')

// Removing a note takes its `edited` mark with it once nothing is left for
// that file, because the mark means "notes waiting here".
const stuckKey = [...notes.keys()][0]
const stuck = notes.get(stuckKey)
response = await call('/api/diff-review.unote', {
  method: 'POST',
  body: { sessionId: 'session-1', seq: 9, path: 'src/a.ts', at: stuck.at },
})
assert.equal(response.status, 200, 'a note is removed by its own identity')
assert.deepEqual(
  (await response.json()).notes.map((note) => note.text),
  ['and cover the empty case'],
  'only the named note is gone; the other one stays',
)
assert.equal(
  decisions.get('session-1/9/src/a.ts')?.state,
  'edited',
  'the mark stays while the file still has a note',
)

const lastKey = [...notes.keys()][0]
response = await call('/api/diff-review.unote', {
  method: 'POST',
  body: { sessionId: 'session-1', seq: 9, path: 'src/a.ts', at: notes.get(lastKey).at },
})
assert.equal(response.status, 200)
assert.deepEqual((await response.json()).notes, [], 'the last note leaves an empty list')
assert.equal(
  decisions.has('session-1/9/src/a.ts'),
  false,
  'the last note takes its own edited mark with it',
)
assert.equal(notes.size, 0, 'and nothing is left in the notes table')

// Rewriting a note keeps its identity: same key, new text, siblings untouched.
response = await call('/api/diff-review.note', {
  method: 'POST',
  body: { sessionId: 'session-1', seq: 9, path: 'src/a.ts', text: 'first wording' },
})
assert.equal(response.status, 200)
const first = (await response.json()).note
response = await call('/api/diff-review.note', {
  method: 'POST',
  body: { sessionId: 'session-1', seq: 9, path: 'src/a.ts', text: 'second note' },
})
assert.equal(response.status, 200)
response = await call('/api/diff-review.enote', {
  method: 'POST',
  body: { sessionId: 'session-1', seq: 9, path: 'src/a.ts', at: first.at, text: 'reworded' },
})
assert.equal(response.status, 200, 'a note is rewritten in place')
assert.deepEqual(
  (await response.json()).notes.map((note) => note.text),
  ['reworded', 'second note'],
  'rewriting changes that note only and keeps its place in the order',
)
assert.equal(notes.size, 2, 'a rewrite does not add a record')

response = await call('/api/diff-review.enote', {
  method: 'POST',
  body: { sessionId: 'session-1', seq: 9, path: 'src/a.ts', at: first.at + 999999, text: 'ghost' },
})
assert.equal(response.status, 404, 'a note that is no longer there cannot be rewritten')

response = await call('/api/diff-review.enote', {
  method: 'POST',
  body: { sessionId: 'session-1', seq: 9, path: 'src/a.ts', at: first.at, text: '  ' },
})
assert.equal(response.status, 400, 'a rewrite to nothing is refused')

response = await call('/api/diff-review.enote', {
  method: 'POST',
  body: { sessionId: 'session-1', seq: 9, path: 'src/never.ts', at: first.at, text: 'ghost' },
})
assert.equal(response.status, 404, 'a rewrite cannot move a note to a file the turn never listed')
assert.equal(writeIntents.length, writesBeforeNotes, 'rewriting a note writes no file')
for (const [key] of notes.entries()) await notes.delete(key)
await decisions.clear?.()

response = await call('/api/diff-review.unote', { method: 'POST', body: { sessionId: 'session-1' } })
assert.equal(response.status, 400, 'removing without a note identity is refused')

console.log('host contract: OK')
console.log('  routes      :', routes.size)
console.log('  turn pick   : recorded / running / empty all distinct')
console.log('  cwd leaked  : no')
console.log('  decisions   : 1 recorded, 6 invalid bodies refused')
console.log('  undo + bulk : take-back clears the record, bulk writes every file')
console.log('  revert      : rewrites, empties, recreates; refuses stale, coarse, binary')
console.log('  turns       : only turns still served are offered, newest first')
console.log('  notes       : trimmed, grouped per file, never writes a file')
