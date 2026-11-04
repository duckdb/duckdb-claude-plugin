# duckdb-dialect

A Claude Code plugin that teaches Claude the DuckDB 2.0 dialect. It complements
[`duckdb-skills`](https://github.com/duckdb/duckdb-skills), which runs queries and reads files
for you: that plugin is the hands, this one is the knowledge.

Language models were trained on years of DuckDB 1.x documentation, PostgreSQL and SQLite.
DuckDB 2.0 (October 2026) changed things they get wrong every time: lambdas are written
`lambda x: x + 1`, the `~` operator matches partially, `//` by zero is an error, the Python
client dropped `fetchone()` on relations. This plugin puts the current dialect in front of
Claude whenever it writes DuckDB SQL or Python, and shows how to drive the CLI's agent mode.

## Skills

| Skill | Loads when | Teaches |
|---|---|---|
| `duckdb-sql` | Claude writes or fixes SQL for DuckDB, in any client | The 2.0 changes, friendly SQL idioms, files as tables, the CLI in agent mode, performance settings |
| `duckdb-python` | Claude writes Python that imports `duckdb` | `sql` versus `execute`, lazy relations, fetching, DataFrame interop, parameters, the appender, threads, the methods removed in 2.0 |
| `duckdb-upgrade` | The user upgrades, or hits a post-upgrade error | Symptom to fix tables for SQL and Python, storage versions, a procedure for a code base |

The first two are background knowledge and do not appear in the `/` menu. The third can be
invoked as `/duckdb-dialect:duckdb-upgrade`.

## The `duckdb-results` mod

[`duckdb-results/`](duckdb-results/) is a second plugin in this repository: a Claude Code
[mod](https://code.claude.com/docs/en/plugins/mods/overview) that draws what agent mode prints.
When Claude runs the `duckdb` CLI, the model reads the compact Markdown table, and you see the
same result as an aligned table under the tool call: types dimmed under the names, numbers
right-aligned, `NULL` dimmed, the omission marker and row count as a footer, errors with their
type and position. `/duckdb` opens a pane with the last 20 results, and `/duckdb SELECT 42`
runs SQL through the CLI without a Claude turn. Its [README](duckdb-results/README.md) has the
details; `claude plugin test duckdb-results` runs its tests.

## Install

```
/plugin marketplace add duckdb/duckdb-claude-plugin
/plugin install duckdb-dialect@duckdb-dialect
/plugin install duckdb-results@duckdb-dialect
```

The first plugin is the knowledge, the second the table rendering; install either or both.
For one session while developing: `claude --plugin-dir /path/to/duckdb-claude-plugin` loads the
skills, `claude --plugin-dir /path/to/duckdb-claude-plugin/duckdb-results` the mod.

## Every example is tested

`tests/check_examples.sh` extracts every SQL and Python code block from the skills and runs
them against the installed `duckdb` CLI and Python package. A skill never shows code that
does not run on DuckDB 2.0.

```
tests/check_examples.sh            # python3 must have duckdb 2.0 installed
tests/check_examples.sh .venv/bin/python
```

## Evals

`evals/` holds cases for `claude plugin eval`. Most are knowledge questions that run without
tools, so they are cheap, and each has graders that distinguish the 1.x answer from the 2.0
answer. One case drives the real CLI.

```
claude plugin eval . --runs 1 --tag knowledge --no-publish       # the cheap cases, no tools
claude plugin eval . --runs 1 --tag cli --allow-tools Bash --no-publish   # drives the real CLI
```

The report shows each case with the plugin, without it, and the difference. The `cli` case
grants Bash to the sandboxed session, which `claude plugin eval` refuses on a machine whose
AWS config uses a `credential_process`; run it elsewhere or drop that profile first.

## Status

Prototype. Content is drawn from the 2.0 release notes, the migration guides and the
documentation at https://duckdb.org/docs/2.0/, and checked against DuckDB 2.0.0.
