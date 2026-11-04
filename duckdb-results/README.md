# duckdb-results

A Claude Code mod that draws DuckDB results as real tables. When Claude runs the
`duckdb` CLI in a Bash call, DuckDB 2.0 detects the agent and switches on
[agent mode](https://duckdb.org/2026/10/09/agent-mode): compact Markdown tables
with the type in the header, a row cap with a footer, and errors as JSON on
stderr. That output is cheap for the model to read and hard for a person to
read. This mod keeps what the model sees unchanged and draws the same result
for you: aligned columns, numbers right-aligned, types dimmed under the names,
`NULL` dimmed, the omission marker and the row count as a footer, and errors
with their type, subtype and position.

## What it adds

- **Under the tool call.** The result block of a Bash call that ran `duckdb`
  is drawn as an aligned table (up to 15 rows). `ctrl+o` still shows the raw
  text the model read.
- **A pane.** `/duckdb` opens a pane that shows the latest result in full and
  keeps the last 20. With several results, press `1` to `9` in the focused pane
  to switch between them.
- **A command.** `/duckdb SELECT 42` runs SQL through the `duckdb` CLI right
  away, without a Claude turn, shows the result in the pane, and records the
  compact agent-mode text for the model so Claude knows what you looked at.

## Settings

Both appear in `/config` under the plugin's name.

| Setting | Default | Meaning |
|---|---|---|
| `database` | empty | Database file that `/duckdb <sql>` opens. Empty runs in memory. |
| `autoOpenPane` | `false` | Also open the pane whenever a `duckdb` command produces a result. Off by default: the table is already under the tool call, and an open pane would show the same run twice. `/duckdb` opens the pane when you want the full result. |

## Requirements

DuckDB 2.0 or later on `PATH` as `duckdb`. The mod reads agent-mode output,
so a Bash command that passes `-csv`, `-json` or another format flag switches
agent mode off and is drawn as plain text, as before.

## Install

From a terminal session of Claude Code:

```
/plugin marketplace add duckdb/duckdb-claude-plugin
/plugin install duckdb-results@duckdb-dialect
```

Or, for one session while developing: `claude --plugin-dir /path/to/duckdb-results`.

## Files

- `hooks/register.tsx`: the hooks. A `tool.call` hook on Bash keeps each
  duckdb result, a `ui.render` hook on `ToolResult` draws it under the call,
  another on `Pane` draws the pane, and a `command.run` hook serves `/duckdb`.
- `hooks/parse.ts`: the agent-mode parser (tables, marker row, footer, JSON
  errors). `hooks/parse.test.ts` covers it.
- `hooks/draw.tsx`: the table layout, shared by the tool row and the pane.
- `types/index.d.ts`: the state contract (`runs`, `selected`).

Run the tests with `claude plugin test .` and the checks with
`claude plugin validate .`.
