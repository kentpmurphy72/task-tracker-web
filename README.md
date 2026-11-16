# Task Tracker

A private task-tracking application for a combined Personal and Work executive view. The public source repository intentionally contains **no personal or MiTek task records**.

## Stack

- React 19 + TypeScript, styled with Tailwind CSS
- Vinext / Next.js App Router on Cloudflare Workers
- Cloudflare D1 with Drizzle ORM
- ChatGPT Sites hosting and Sign in with ChatGPT

## Features

- Personal and Work task categories, with permanent `P1`, `P2`, `W1`, `W2` identifiers
- Active tasks, Completed Tasks, and an executive overview
- Independent task ordering (up/down controls), priority, status, due dates and projects
- Task descriptions, notes, and a recorded change history
- Search, filters, per-task editing, and completed-task reopening
- CSV import and export, including notes and original task IDs
- Private ChatGPT MCP integration for listing, creating, updating, completing, annotating, and prioritizing tasks directly in a chat
- Soft deletion: removed tasks are hidden, not destroyed
- Database rows owned by the authenticated ChatGPT user

## Data model

The five D1 tables are `categories`, `projects`, `tasks`, `task_notes`, and `task_history`. Generated migrations live under `drizzle/`.

## Local development

Requires Node.js 22.13 or later.

```bash
npm ci
npm run db:generate
npm run dev
```

The checked-in `.openai/hosting.json` is specific to the published ChatGPT Site. Local D1 setup requires applying the generated SQL migrations with Wrangler, after a build has generated `dist/server/wrangler.json`:

```bash
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_lazy_pyro.sql
```

In portable local preview, Sign in with ChatGPT is simulated with the starter's development sign-in route. In hosted environments, authentication is managed by ChatGPT Sites. Never trust a client-provided user ID: the API uses authenticated request headers supplied by the hosting environment.

## CSV format

Column headers: `id,category,title,priority,status,due_date,project,description,sort_order,notes`.

- Category is `Personal` or `Work`.
- Status is `Open`, `In Progress`, `Blocked`, or `Complete`.
- Priority is `High`, `Medium`, or `Low`.
- Due date is `YYYY-MM-DD` or blank.
- `id` can be blank to auto-assign a new permanent ID.
- A named project must already exist in the app before it is referenced in a CSV import.
- Import adds tasks; it does not overwrite IDs that already exist. Up to 250 rows per import.

## Security and hosting

The repository includes only code and schema, not a production database or production task exports. The Site is configured owner-private. The API checks the Site-authenticated user on reads and writes, and records are scoped to that user's stable Site ID. Do not commit task exports, secrets, `.env` files, or production logs.

## ChatGPT integration

The hosted Site exposes an MCP endpoint at `POST /mcp`. Sites authenticates callers and limits access to the private Site owner; each data tool additionally requires the signed-in user's Site-scoped identity and filters all records to that owner. The `tools/list` operation advertises `list_tasks`, `get_task`, `task_summary`, `create_task`, `update_task`, `complete_task`, `add_task_note`, and `move_task`.

After publication, install or connect the **Task Tracker** plugin under ChatGPT **Plugins → Personal → Created by you** if it is not already connected. Select or @mention that plugin when asking ChatGPT to work with tasks. Task changes are written directly to D1 and appear in the website. No Markdown synchronization is required.

## Scope

Version 1 focuses on a reliable master list that can also be managed from ChatGPT. Recurring tasks, notifications, and Microsoft 365 integrations can be added later.
