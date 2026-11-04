export type DuckDBColumn = { name: string; type: string }

export type DuckDBTable = {
  columns: DuckDBColumn[]
  /** Cell text as the CLI printed it; `NULL` stays the literal string. */
  rows: string[][]
  /** Rows agent mode left out between the first and last rows, 0 when none. */
  omitted: number
  /** Where the omission marker sat, as an index into `rows`; null when none. */
  omittedAt: number | null
  /** The footer line agent mode printed, when it printed one. */
  footer: string | null
  /** Rows the whole result had, from the footer; null when it had no footer. */
  total: number | null
  /** True when the query stopped early and `total` is a lower bound. */
  isLowerBound: boolean
}

export type DuckDBError = {
  type: string
  message: string
  subtype: string | null
  position: string | null
}

export type QueryRun = {
  id: string
  source: 'bash' | 'command'
  command: string
  at: number
  tables: DuckDBTable[]
  errors: DuckDBError[]
  /** estimate: and progress: lines from stderr. */
  notes: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'duckdb-results': {
      runs: Shaped<QueryRun[]>
      selected: string | null
    }
  }
}
