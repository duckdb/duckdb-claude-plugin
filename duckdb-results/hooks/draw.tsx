import type { BoxProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'

import type { DuckDBError, DuckDBTable, QueryRun } from '../types'

export type Drawing = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
}

export type DrawOptions = {
  /** Cells available across. */
  width: number
  /** Rows of one table drawn before the rest is counted in a line. */
  maxRows: number
}

const NUMERIC = /^(U?(TINY|SMALL|BIG|HUGE)?INT(EGER)?|DOUBLE|FLOAT4?|FLOAT8|REAL|DECIMAL.*|NUMERIC.*)$/i
const MAX_CELL = 48
const MIN_CELL = 4
const GAP = 3 // ' │ '

/** The transcript's or pane's view of one run: every table, then every error. */
export function drawRun(ui: Drawing, run: QueryRun, options: DrawOptions): RenderElement {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" gap={1}>
      {run.tables.map(table => drawTable(ui, table, options))}
      {run.errors.map(error => drawError(ui, error))}
      {run.notes.length > 0 && (
        <Box flexDirection="column">
          {run.notes.map(note => (
            <Text dimColor>{note}</Text>
          ))}
        </Box>
      )}
    </Box>
  )
}

export function drawTable(ui: Drawing, table: DuckDBTable, options: DrawOptions): RenderElement {
  const { Box, Text } = ui
  const shown = table.rows.slice(0, options.maxRows)
  const widths = columnWidths(table, shown, options.width)
  const isNumeric = table.columns.map(column => NUMERIC.test(column.type))
  const total = table.total ?? table.rows.length
  const hidden = table.rows.length - shown.length

  const line = (cells: string[], style: (text: string, index: number) => RenderElement) => (
    <Text wrap="truncate-end">
      {cells.map((cell, index) => {
        const width = widths[index] ?? MIN_CELL
        const text = pad(clip(display(cell), width), width, isNumeric[index] === true)
        return (
          <Text>
            {style(text, index)}
            {index < cells.length - 1 && <Text dimColor> │ </Text>}
          </Text>
        )
      })}
    </Text>
  )

  return (
    <Box flexDirection="column">
      {line(
        table.columns.map(column => column.name),
        text => <Text weight="semibold">{text}</Text>,
      )}
      {line(
        table.columns.map(column => column.type),
        text => <Text dimColor>{text}</Text>,
      )}
      <Text dimColor>{widths.map(width => '─'.repeat(width)).join('─┼─')}</Text>
      {shown.map((row, rowIndex) => (
        <Box flexDirection="column">
          {table.omittedAt === rowIndex && table.omitted > 0 && (
            <Text dimColor italic>
              … {table.omitted} rows omitted by agent mode …
            </Text>
          )}
          {line(row, (text, index) =>
            row[index] === 'NULL' ? <Text dimColor>{text}</Text> : <Text>{text}</Text>,
          )}
        </Box>
      ))}
      {table.omittedAt !== null && table.omittedAt >= shown.length && table.omitted > 0 && hidden === 0 && (
        <Text dimColor italic>
          … {table.omitted} rows omitted by agent mode …
        </Text>
      )}
      <Text dimColor>
        {table.isLowerBound ? 'at least ' : ''}
        {total} row{total === 1 ? '' : 's'}
        {hidden > 0 ? `, ${hidden} more not drawn here (/duckdb shows all)` : ''}
        {table.omitted > 0 && hidden === 0 ? `, ${table.omitted} omitted by agent mode` : ''}
      </Text>
    </Box>
  )
}

export function drawError(ui: Drawing, error: DuckDBError): RenderElement {
  const { Box, Text } = ui
  const [first = '', ...rest] = error.message.split('\n')
  return (
    <Box flexDirection="column">
      <Text color="error">
        <Text weight="semibold">{error.type} Error</Text>
        {error.subtype ? <Text dimColor> {error.subtype}</Text> : null}
        {error.position ? <Text dimColor> at position {error.position}</Text> : null}
      </Text>
      <Text wrap="wrap">{first}</Text>
      {rest.map(more => (
        <Text dimColor wrap="wrap">
          {more}
        </Text>
      ))}
    </Box>
  )
}

/** One cell's text on one line: newlines shown as ↵, nothing else changed. */
function display(cell: string): string {
  return cell.replace(/\n/g, '↵')
}

function clip(text: string, width: number): string {
  const chars = Array.from(text)
  if (chars.length <= width) return text
  return chars.slice(0, Math.max(0, width - 1)).join('') + '…'
}

function pad(text: string, width: number, right: boolean): string {
  const length = Array.from(text).length
  const fill = ' '.repeat(Math.max(0, width - length))
  return right ? fill + text : text + fill
}

/**
 * Widths that fit the room: each column as wide as its widest cell (capped),
 * then the widest columns shrunk together until the row fits.
 */
export function columnWidths(table: DuckDBTable, rows: string[][], width: number): number[] {
  const widths = table.columns.map((column, index) => {
    let widest = Math.max(Array.from(column.name).length, Array.from(column.type).length)
    for (const row of rows) {
      widest = Math.max(widest, Array.from(display(row[index] ?? '')).length)
    }
    return Math.min(widest, MAX_CELL)
  })
  const room = Math.max(width, MIN_CELL * widths.length + GAP * (widths.length - 1))
  let used = widths.reduce((sum, w) => sum + w, 0) + GAP * (widths.length - 1)
  while (used > room) {
    let widestIndex = 0
    widths.forEach((w, index) => {
      if (w > (widths[widestIndex] ?? 0)) widestIndex = index
    })
    const widest = widths[widestIndex] ?? MIN_CELL
    if (widest <= MIN_CELL) break
    widths[widestIndex] = widest - 1
    used -= 1
  }
  return widths
}
