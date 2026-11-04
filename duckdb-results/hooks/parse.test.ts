import { expect, test } from 'claude-code/testing'

import { isDuckDBCommand, parseDuckDB, splitCells, summarize } from './parse'

const SMALL = `| x:INTEGER | y:VARCHAR |
|---|---|
| 42 | hi |
`

const CAPPED = `| range:BIGINT |
|---|
| 0 |
| 1 |
| … 4996 rows omitted … |
| 4998 |
| 4999 |
first 20 and last 20 of 5000 rows (.maxrows -1 for all), hash 3c5dca59d725c463
`

const EMPTY = `| x:BIGINT |
|---|
0 rows, hash 0000000000000000
`

const BINDER = `{"exception_type":"Binder","exception_message":"Referenced column \\"foo\\" not found in FROM clause!\\nCandidate bindings: \\"range\\"","error_subtype":"COLUMN_NOT_FOUND","location":"[17,3]","position":"17","name":"foo"}`

test('a small table keeps names, types and cells', () => {
  const { tables, errors } = parseDuckDB(SMALL, '')
  expect(errors).toEqual([])
  expect(tables.length).toBe(1)
  expect(tables[0]?.columns).toEqual([
    { name: 'x', type: 'INTEGER' },
    { name: 'y', type: 'VARCHAR' },
  ])
  expect(tables[0]?.rows).toEqual([['42', 'hi']])
  expect(tables[0]?.total).toBe(null)
})

test('a capped result reads the marker and the footer', () => {
  const [table] = parseDuckDB(CAPPED, '').tables
  expect(table?.rows.length).toBe(4)
  expect(table?.omitted).toBe(4996)
  expect(table?.omittedAt).toBe(2)
  expect(table?.total).toBe(5000)
  expect(table?.isLowerBound).toBe(false)
  expect(summarize(parseDuckDB(CAPPED, ''))).toBe('5000 rows × 1 column')
})

test('an empty result still has its columns', () => {
  const [table] = parseDuckDB(EMPTY, '').tables
  expect(table?.columns).toEqual([{ name: 'x', type: 'BIGINT' }])
  expect(table?.rows).toEqual([])
  expect(table?.total).toBe(0)
})

test('two statements give two tables, and a JSON error is read', () => {
  const stdout = `| 1:INTEGER |\n|---|\n| 1 |\n${SMALL}`
  const stderr = `duckdb agent mode on: CLAUDECODE is set and stdout is not a terminal\n${BINDER}\n`
  const parsed = parseDuckDB(stdout, stderr)
  expect(parsed.tables.length).toBe(2)
  expect(parsed.errors).toEqual([
    {
      type: 'Binder',
      message: 'Referenced column "foo" not found in FROM clause!\nCandidate bindings: "range"',
      subtype: 'COLUMN_NOT_FOUND',
      position: '17',
    },
  ])
  expect(parsed.notes).toEqual([])
})

test('a name holding a colon splits at the last colon', () => {
  const [table] = parseDuckDB(`| (1 / 0):DOUBLE | a:b:VARCHAR |\n|---|---|\n| inf | x |\n`, '').tables
  expect(table?.columns).toEqual([
    { name: '(1 / 0)', type: 'DOUBLE' },
    { name: 'a:b', type: 'VARCHAR' },
  ])
})

test('escaped pipes and newlines in cells', () => {
  expect(splitCells('| q\\|r | a\\nb | NULL |')).toEqual(['q|r', 'a\nb', 'NULL'])
})

test('a plain-text error when agent mode is off', () => {
  const { errors } = parseDuckDB('', 'Parser Error: syntax error at or near "1"\n')
  expect(errors[0]?.type).toBe('Parser')
})

test('which shell commands run the duckdb CLI', () => {
  expect(isDuckDBCommand('duckdb -c "select 1"')).toBe(true)
  expect(isDuckDBCommand('~/.local/bin/duckdb db.duckdb -c ".tables"')).toBe(true)
  expect(isDuckDBCommand('cat q.sql | duckdb')).toBe(true)
  expect(isDuckDBCommand('duckdb mydb.duckdb <<\'SQL\'\nFROM t;\nSQL')).toBe(true)
  expect(isDuckDBCommand('python3 -c "import duckdb; print(duckdb.sql(\'select 1\'))"')).toBe(false)
  expect(isDuckDBCommand('pip install duckdb')).toBe(true)
  expect(isDuckDBCommand('ls')).toBe(false)
})
