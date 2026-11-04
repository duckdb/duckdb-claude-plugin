import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'duckdb-results',
  component: 'Pane',
  requestId: 'duckdb',
  props: {
    title: 'DuckDB',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const STDOUT = `| name:VARCHAR | n:BIGINT |
|---|---|
| alpha | 1 |
| NULL | 22 |
`

test('a duckdb Bash call fills the pane with an aligned table', async ($, on) => {
  // Nothing sits beneath the plugin: each hook here stands for the engine.
  on('command.register', () => ({ value: { command: 'duckdb' } }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: { stdout: STDOUT, stderr: '', interrupted: false } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'duckdb -c "FROM t"' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /FROM t/ })).toBeDefined()
    const row = await ui.find({ type: 'Text', text: /alpha/ })
    expect(row?.text).toBe('alpha   │      1')
    expect((await ui.find({ type: 'Text', text: /^NULL/ }))?.text).toBe('NULL    │     22')
    expect(await ui.find({ type: 'Text', text: /2 rows/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a drawn result tells the model not to repeat the table', async ($, on) => {
  on('command.register', () => ({ value: { command: 'duckdb' } }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', (_, e) =>
    e.command === 'duckdb -c "FROM t"'
      ? { result: { stdout: STDOUT, stderr: '', interrupted: false }, context: ['engine note'] }
      : { result: { stdout: 'not a table', stderr: '', interrupted: false } },
  )

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.tool.call({ tool: 'Bash', command: 'duckdb -c "FROM t"' })
  expect(ran.deny).toBe(undefined)
  // The engine's own context stays, the mod's note comes after it.
  expect(ran.context?.[0]).toBe('engine note')
  expect(ran.context?.[1]).toMatch(/Do not repeat the rows/)

  // No table (an error, or output that is not agent mode): nothing added.
  const plain = await $.tool.call({ tool: 'Bash', command: 'duckdb -c "SET x"' })
  expect(plain.context).toBe(undefined)
})

test('a Bash call that is not duckdb leaves the pane empty', async ($, on) => {
  on('command.register', () => ({ value: { command: 'duckdb' } }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: { stdout: STDOUT, stderr: '', interrupted: false } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'cat table.md' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /No DuckDB results yet/ })).toBeDefined()
  await ui.unmount()
})

test('the result block under a duckdb row draws the table', async ($, on) => {
  on('command.register', () => ({ value: { command: 'duckdb' } }))
  on('clock.now', () => ({ value: 1_700_000_000_000 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: { stdout: STDOUT, stderr: '', interrupted: false } }))
  // The engine's own drawing of a result block, for a row the mod leaves alone.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.tool.call({ tool: 'Bash', tool_use_id: 'call-1', command: 'duckdb -c "FROM t"' })
  expect(ran.deny).toBe(undefined)

  const ui = await $.ui.mount({
    plugin: 'duckdb-results',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'call-1',
    props: {
      tool_use_id: 'call-1',
      tool: 'Bash',
      output: { stdout: STDOUT, stderr: '', interrupted: false },
      isErrored: false,
    },
  })
  expect(await ui.find({ type: 'Text', text: /alpha/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /engine/ })).toBe(undefined)
  await ui.unmount()

  // Another Bash row, not duckdb's: the engine draws it.
  const other = await $.ui.mount({
    plugin: 'duckdb-results',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'call-2',
    props: { tool_use_id: 'call-2', tool: 'Bash', output: { stdout: 'x', stderr: '', interrupted: false }, isErrored: false },
  })
  expect((await other.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await other.unmount()
})
