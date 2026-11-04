import { atom, read, update } from 'claude-code'
import type { Register, StateDollar } from 'claude-code'

import type { QueryRun } from '../types'
import { drawRun } from './draw'
import { isDuckDBCommand, parseDuckDB, summarize } from './parse'

const PANE = 'duckdb'
const KEEP = 20
const MODEL_CONTEXT_CHARS = 6000

// Bump the shape when QueryRun's fields change: it declines what an earlier
// version stored, which outlives a reload.
const runs = atom({ plugin: 'duckdb-results', key: 'runs' } as const, [], { shape: 'runs-1' })
const selected = atom({ plugin: 'duckdb-results', key: 'selected' } as const, null)

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export const register: Register = (on, options) => {
  const database = typeof options.database === 'string' ? options.database.trim() : ''
  const autoOpen = options.autoOpenPane === true

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'duckdb',
      description: database
        ? `Show DuckDB results in a pane, or run SQL against ${database}`
        : 'Show DuckDB results in a pane, or run SQL in memory: /duckdb SELECT 42',
      argumentHint: '[sql]',
    })
    return next(e)
  })

  // Every Bash call that runs the duckdb CLI: keep what agent mode printed.
  // The table is drawn under the tool row; the pane only opens when asked for,
  // since open it would show the same run a second time.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const command = text(e.command)
    if (ran.deny !== undefined || !isDuckDBCommand(command)) return ran
    const output = ran.result as { stdout?: unknown; stderr?: unknown } | undefined
    const parsed = parseDuckDB(text(output?.stdout), text(output?.stderr))
    if (parsed.tables.length === 0 && parsed.errors.length === 0) return ran

    const run: QueryRun = {
      id: e.tool_use_id,
      source: 'bash',
      command,
      at: await $.clock.now(),
      ...parsed,
    }
    await remember($, run)
    if (autoOpen) void $.ui.open({ id: PANE, title: 'DuckDB' })
    return ran
  }).catch((_, e, next) => next(e))

  // The result block under a duckdb Bash row: the table, aligned, in place of
  // the compact markdown. ctrl+o (isExpanded) shows the raw text.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.props.tool !== 'Bash' || e.props.isExpanded === true) return next(e)
    const run = (await read($, runs)).find(one => one.id === e.props.tool_use_id)
    if (run === undefined) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const width = Math.max(20, (e.viewport?.columns ?? 80) - 6)
    return (
      <Box flexDirection="column" paddingLeft={2}>
        {drawRun({ Box, Text }, run, { width, maxRows: 15 })}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, runs)
    const chosen = await read($, selected)
    const run = list.find(one => one.id === chosen) ?? list[list.length - 1]
    if (run === undefined) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No DuckDB results yet.</Text>
          <Text dimColor>Run a query with the duckdb CLI, or type /duckdb SELECT 42.</Text>
        </Box>
      )
    }
    const recent = list.slice(-9)
    const width = Math.max(20, e.props.bodyColumns - 1)
    return (
      <Box flexDirection="column" gap={1}>
        {recent.length > 1 && (
          <Box gap={1}>
            <Text dimColor>results</Text>
            {recent.map((one, index) => (
              <Button
                key={one.id}
                plain
                hotkey={String(index + 1)}
                label={String(index + 1)}
                dimColor={one.id !== run.id}
                onPress={() => update($, selected, () => one.id)}
              />
            ))}
          </Box>
        )}
        <Text dimColor wrap="truncate-end">
          {run.source === 'command' ? '/duckdb ' : '$ '}
          {run.command.replace(/\s+/g, ' ')}
        </Text>
        {drawRun({ Box, Text }, run, { width, maxRows: 500 })}
      </Box>
    )
  })

  // /duckdb opens the pane; /duckdb <sql> runs the SQL and shows the result.
  on('command.run', { command: 'duckdb' }, async ($, e) => {
    const sql = e.args.trim()
    if (sql === '') {
      const opened = await $.ui.open({ id: PANE, title: 'DuckDB', focus: true })
      return {
        text: opened.isPlaced ? 'DuckDB pane opened.' : `DuckDB pane is waiting: ${opened.reason}`,
      }
    }

    const argv = ['duckdb', '-agent']
    if (database !== '') argv.push(database)
    argv.push('-c', sql)
    let stdout = ''
    let stderr = ''
    try {
      const ran = await $.process.run(argv, { timeoutMs: 120_000 })
      stdout = ran.stdout
      stderr = ran.stderr
    } catch (error) {
      return { text: `duckdb did not run: ${error instanceof Error ? error.message : String(error)}` }
    }

    const parsed = parseDuckDB(stdout, stderr)
    const now = await $.clock.now()
    const run: QueryRun = { id: `command-${now}`, source: 'command', command: sql, at: now, ...parsed }
    await remember($, run)
    const opened = await $.ui.open({ id: PANE, title: 'DuckDB', focus: true })

    const summary = summarize(parsed) || 'no result'
    const compact = (stdout + (stderr ? '\n' + stderr : '')).trim()
    return {
      text: opened.isPlaced ? summary : `${summary}\n${compact}`,
      context: [
        `The user ran this SQL with the duckdb CLI through /duckdb:\n${sql}\n\nResult (agent mode):\n${compact.slice(0, MODEL_CONTEXT_CHARS)}`,
      ],
    }
  })
}

async function remember($: StateDollar, run: QueryRun) {
  await update($, runs, list => [...list.filter(one => one.id !== run.id), run].slice(-KEEP))
  await update($, selected, () => run.id)
}
