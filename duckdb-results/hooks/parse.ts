import type { DuckDBColumn, DuckDBError, DuckDBTable } from '../types'

export type Parsed = {
  tables: DuckDBTable[]
  errors: DuckDBError[]
  notes: string[]
}

/**
 * Whether a shell command runs the duckdb CLI: `duckdb`, `~/.local/bin/duckdb`,
 * `duckdb db.duckdb -c ...`, `echo ... | duckdb`. `import duckdb` in a Python
 * one-liner is not followed by whitespace or the end, so it does not match.
 */
export function isDuckDBCommand(command: string): boolean {
  return /(^|[\s;&|(`$/])duckdb(\s|$)/.test(command)
}

const ROW = /^\|.*\|$/
const SEPARATOR = /^\|(?:-+\|)+$/
const OMITTED = /^…\s*(\d+)\s+rows?\s+omitted\s*…$/
const FOOTER = /^(?:first\s+\d+(?:\s+and\s+last\s+\d+)?\s+of\s+(at least\s+)?(\d+)\s+rows?|(\d+)\s+rows?)\b/

/**
 * Parses what the duckdb CLI prints in agent mode: compact markdown tables
 * with `name:TYPE` headers, an omission marker row, a footer with the row
 * count, and errors as JSON lines on stderr.
 */
export function parseDuckDB(stdout: string, stderr: string): Parsed {
  return {
    tables: parseTables(stdout),
    ...parseStderr(stderr),
  }
}

function parseTables(stdout: string): DuckDBTable[] {
  const lines = stdout.split('\n').map(line => line.trimEnd())
  const tables: DuckDBTable[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    const nextLine = lines[i + 1] ?? ''
    if (!(ROW.test(line) && SEPARATOR.test(nextLine))) {
      i += 1
      continue
    }
    const columns = splitCells(line).map(parseHeader)
    i += 2
    const rows: string[][] = []
    let omitted = 0
    let omittedAt: number | null = null
    // A row followed by a separator is the next table's header, not a row.
    while (i < lines.length && ROW.test(lines[i] ?? '') && !SEPARATOR.test(lines[i + 1] ?? '')) {
      const cells = splitCells(lines[i] ?? '')
      const marker = cells.length === 1 ? OMITTED.exec(cells[0] ?? '') : null
      if (marker) {
        omitted += Number(marker[1])
        omittedAt = rows.length
      } else {
        rows.push(fit(cells, columns.length))
      }
      i += 1
    }
    let footer: string | null = null
    let total: number | null = null
    let isLowerBound = false
    const footerLine = (lines[i] ?? '').trim()
    const match = FOOTER.exec(footerLine)
    if (match) {
      footer = footerLine
      total = Number(match[2] ?? match[3])
      isLowerBound = match[1] !== undefined
      i += 1
    }
    tables.push({ columns, rows, omitted, omittedAt, footer, total, isLowerBound })
  }
  return tables
}

function parseStderr(stderr: string): { errors: DuckDBError[]; notes: string[] } {
  const errors: DuckDBError[] = []
  const notes: string[] = []
  for (const raw of stderr.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    if (line.startsWith('{') && line.endsWith('}')) {
      const error = parseJsonError(line)
      if (error) {
        errors.push(error)
        continue
      }
    }
    if (/^(estimate|progress):/.test(line)) {
      notes.push(line)
      continue
    }
    // Agent mode off (a -json or -csv flag): errors are plain text.
    const plain = /^(\w+(?:\s\w+)?) Error:\s*(.*)$/s.exec(line)
    if (plain) {
      errors.push({ type: plain[1] ?? 'Error', message: plain[2] ?? '', subtype: null, position: null })
    }
  }
  return { errors, notes }
}

function parseJsonError(line: string): DuckDBError | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.exception_type !== 'string') return null
  return {
    type: record.exception_type,
    message: typeof record.exception_message === 'string' ? record.exception_message : '',
    subtype: typeof record.error_subtype === 'string' ? record.error_subtype : null,
    position: typeof record.position === 'string' ? record.position : null,
  }
}

/** `name:TYPE`, split at the last colon so `(1 / 0):DOUBLE` keeps its name. */
function parseHeader(cell: string): DuckDBColumn {
  const at = cell.lastIndexOf(':')
  if (at <= 0) return { name: cell, type: '' }
  return { name: cell.slice(0, at), type: cell.slice(at + 1) }
}

/** Splits `| a | b\|c |` into `['a', 'b|c']`; `\n` in a cell is a newline. */
export function splitCells(line: string): string[] {
  const inner = line.trim().slice(1, -1)
  const cells: string[] = []
  let cell = ''
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i]
    const following = inner[i + 1]
    if (char === '\\' && following === '|') {
      cell += '|'
      i += 1
    } else if (char === '\\' && following === 'n') {
      cell += '\n'
      i += 1
    } else if (char === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell.trim())
  return cells
}

function fit(cells: string[], width: number): string[] {
  if (cells.length === width) return cells
  if (cells.length > width) return cells.slice(0, width)
  return [...cells, ...Array<string>(width - cells.length).fill('')]
}

export function summarize(parsed: Parsed): string {
  const parts: string[] = []
  for (const table of parsed.tables) {
    const total = table.total ?? table.rows.length
    const bound = table.isLowerBound ? 'at least ' : ''
    parts.push(`${bound}${total} row${total === 1 ? '' : 's'} × ${table.columns.length} column${table.columns.length === 1 ? '' : 's'}`)
  }
  for (const error of parsed.errors) {
    parts.push(`${error.type} Error: ${error.message.split('\n')[0] ?? ''}`)
  }
  return parts.join('; ')
}
