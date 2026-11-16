import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { categories, projects, taskHistory, taskNotes, tasks } from "../db/schema";

type Arguments = Record<string, unknown>;
type RpcId = string | number | null;
type ActionHandler = (action: Arguments) => Promise<Response>;
type Tool = { name: string; description: string; inputSchema: Arguments };

const statuses = ["Open", "In Progress", "Blocked", "Complete"];
const priorities = ["High", "Medium", "Low"];
const categoriesList = ["Personal", "Work"];
const schema = (properties: Arguments, required: string[] = []): Arguments => ({
  type: "object", properties, required, additionalProperties: false,
});
const text = (description: string, maxLength = 240): Arguments => ({ type: "string", description, minLength: 1, maxLength });
const taskId = text("Permanent task identifier, for example W24 or P7.", 24);
const date = { type: ["string", "null"], description: "Due date in YYYY-MM-DD format; use null to clear it." };

export const taskTrackerTools: Tool[] = [
  {
    name: "list_tasks",
    description: "List the owner's Task Tracker tasks in their saved order. By default excludes completed tasks. Use filters to find priority work, overdue tasks, or completed items. Returns permanent P/W IDs.",
    inputSchema: schema({
      category: { type: "string", enum: categoriesList },
      status: { type: "string", enum: statuses },
      priority: { type: "string", enum: priorities },
      includeCompleted: { type: "boolean", description: "Set true to include completed tasks when not filtering for a specific status." },
      dueBefore: { type: "string", description: "Inclusive upper due-date boundary, YYYY-MM-DD." },
      query: { type: "string", maxLength: 200, description: "Case-insensitive search in task titles and descriptions." },
      limit: { type: "integer", minimum: 1, maximum: 200, description: "Maximum tasks returned; defaults to 100." },
    }),
  },
  {
    name: "get_task",
    description: "Retrieve one task by its permanent P/W ID, including full description, notes, project, and recent change history.",
    inputSchema: schema({ taskId }, ["taskId"]),
  },
  {
    name: "task_summary",
    description: "Summarize the current personal/work backlog: status counts, active high-priority tasks, overdue tasks, and tasks due in the next week.",
    inputSchema: schema({}),
  },
  {
    name: "create_task",
    description: "Create a new Work or Personal task. The application assigns a permanent P/W identifier, records its history, and optionally saves the initial note.",
    inputSchema: schema({
      category: { type: "string", enum: categoriesList },
      title: text("Task title."),
      priority: { type: "string", enum: priorities },
      status: { type: "string", enum: statuses },
      dueDate: date,
      description: { type: "string", maxLength: 20000 },
      note: { type: "string", maxLength: 10000, description: "Optional initial note; appended to task notes." },
    }, ["category", "title"]),
  },
  {
    name: "update_task",
    description: "Edit a task using its permanent P/W ID. May change title, priority, status (including Complete or reopening), due date, or description. Only supplied fields are changed.",
    inputSchema: schema({
      taskId,
      title: text("Replacement task title."),
      priority: { type: "string", enum: priorities },
      status: { type: "string", enum: statuses },
      dueDate: date,
      description: { type: "string", maxLength: 20000 },
    }, ["taskId"]),
  },
  {
    name: "complete_task",
    description: "Mark a task complete by permanent P/W ID, recording its completion and history. Do not use until the user asks to complete it.",
    inputSchema: schema({ taskId }, ["taskId"]),
  },
  {
    name: "add_task_note",
    description: "Append a note to an existing task; notes are retained with their creation timestamps.",
    inputSchema: schema({ taskId, note: text("Note to append to the task.", 10000) }, ["taskId", "note"]),
  },
  {
    name: "move_task",
    description: "Change an active task's order within its Personal or Work list. Move to top/bottom, or immediately before/after another active task in the same category.",
    inputSchema: schema({
      taskId,
      position: { type: "string", enum: ["top", "bottom", "before", "after"] },
      relativeTo: { ...taskId, description: "Anchor P/W task ID, required when position is before or after." },
    }, ["taskId", "position"]),
  },
];

type TaskRow = Awaited<ReturnType<typeof allTasks>>[number];

async function allTasks(ownerId: string) {
  return getDb().select({
    id: tasks.id, publicId: tasks.publicId, title: tasks.title, description: tasks.description,
    category: categories.name, categoryId: tasks.categoryId, project: projects.name,
    status: tasks.status, priority: tasks.priority, dueDate: tasks.dueDate,
    sortOrder: tasks.sortOrder, createdAt: tasks.createdAt, updatedAt: tasks.updatedAt,
    completedAt: tasks.completedAt,
  }).from(tasks)
    .innerJoin(categories, eq(tasks.categoryId, categories.id))
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(eq(tasks.ownerId, ownerId), isNull(tasks.deletedAt)))
    .orderBy(asc(categories.sortOrder), asc(tasks.sortOrder), asc(tasks.id));
}

function normalizeTaskId(value: unknown): string {
  if (typeof value !== "string" || !/^[PW][1-9]\d*$/i.test(value.trim())) throw new Error("Provide a valid task ID such as W24 or P7.");
  return value.trim().toUpperCase();
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be nonempty text.`);
  return value.trim();
}

function requireChoice(value: unknown, choices: string[], field: string): string {
  if (typeof value !== "string" || !choices.includes(value)) throw new Error(`Invalid ${field}. Choose ${choices.join(", ")}.`);
  return value;
}

function validateDate(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}

function readArgs(value: unknown): Arguments {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool arguments must be an object.");
  return value as Arguments;
}

function selectTask(rows: TaskRow[], id: unknown): TaskRow {
  const publicId = normalizeTaskId(id);
  const found = rows.find((row) => row.publicId === publicId);
  if (!found) throw new Error(`Task ${publicId} was not found.`);
  return found;
}

async function performAction(callApp: ActionHandler, action: Arguments) {
  const response = await callApp(action);
  const body = await response.json() as Arguments;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not save the task change.");
  return body;
}

async function detailedTask(ownerId: string, publicId: unknown) {
  const task = selectTask(await allTasks(ownerId), publicId);
  const db = getDb();
  const [notes, history] = await Promise.all([
    db.select({ id: taskNotes.id, body: taskNotes.body, createdAt: taskNotes.createdAt }).from(taskNotes)
      .where(and(eq(taskNotes.ownerId, ownerId), eq(taskNotes.taskId, task.id))).orderBy(asc(taskNotes.createdAt)),
    db.select({ action: taskHistory.action, field: taskHistory.field, oldValue: taskHistory.oldValue, newValue: taskHistory.newValue, createdAt: taskHistory.createdAt })
      .from(taskHistory).where(and(eq(taskHistory.ownerId, ownerId), eq(taskHistory.taskId, task.id)))
      .orderBy(desc(taskHistory.id)).limit(30),
  ]);
  return { task: withoutInternalIds(task), notes, recentHistory: history };
}

function withoutInternalIds(task: TaskRow) {
  const { id: _id, categoryId: _categoryId, ...visible } = task;
  void _id; void _categoryId;
  return visible;
}

function currentCentralDate() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (part: string) => parts.find((item) => item.type === part)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

async function runTool(name: string, args: Arguments, ownerId: string, callApp: ActionHandler): Promise<unknown> {
  if (name === "list_tasks") {
    if (args.category !== undefined) requireChoice(args.category, categoriesList, "category");
    if (args.status !== undefined) requireChoice(args.status, statuses, "status");
    if (args.priority !== undefined) requireChoice(args.priority, priorities, "priority");
    if (args.dueBefore !== undefined && !validateDate(args.dueBefore)) throw new Error("dueBefore must be YYYY-MM-DD.");
    if (args.query !== undefined && (typeof args.query !== "string" || args.query.length > 200)) throw new Error("Search query is too long.");
    const limit = args.limit === undefined ? 100 : Number(args.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("Limit must be between 1 and 200.");
    const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
    const filtered = (await allTasks(ownerId)).filter((task) =>
      (!args.category || task.category === args.category) &&
      (!args.status || task.status === args.status) &&
      (!args.priority || task.priority === args.priority) &&
      (args.includeCompleted === true || args.status === "Complete" || task.status !== "Complete") &&
      (!args.dueBefore || (task.dueDate && task.dueDate <= args.dueBefore)) &&
      (!query || `${task.title} ${task.description}`.toLowerCase().includes(query))
    );
    return { total: filtered.length, returned: Math.min(filtered.length, limit), tasks: filtered.slice(0, limit).map((task) => {
      const { description: _description, ...row } = withoutInternalIds(task);
      void _description;
      return row;
    }) };
  }
  if (name === "get_task") return detailedTask(ownerId, args.taskId);
  if (name === "task_summary") {
    const rows = await allTasks(ownerId);
    const active = rows.filter((task) => task.status !== "Complete");
    const today = currentCentralDate();
    const weekEnd = new Date(`${today}T12:00:00Z`);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
    const week = weekEnd.toISOString().slice(0, 10);
    const counts = (group: TaskRow[]) => ({
      total: group.length,
      open: group.filter((task) => task.status === "Open").length,
      inProgress: group.filter((task) => task.status === "In Progress").length,
      blocked: group.filter((task) => task.status === "Blocked").length,
      complete: group.filter((task) => task.status === "Complete").length,
    });
    return {
      asOf: today, all: counts(rows), personal: counts(rows.filter((task) => task.category === "Personal")),
      work: counts(rows.filter((task) => task.category === "Work")),
      highPriority: active.filter((task) => task.priority === "High").map(withoutInternalIds),
      overdue: active.filter((task) => task.dueDate && task.dueDate < today).map(withoutInternalIds),
      dueWithinSevenDays: active.filter((task) => task.dueDate && task.dueDate >= today && task.dueDate <= week).map(withoutInternalIds),
    };
  }
  if (name === "create_task") {
    const categoryName = requireChoice(args.category, categoriesList, "category");
    const title = requireString(args.title, "Task title");
    if (title.length > 240) throw new Error("Task title exceeds 240 characters.");
    if (args.priority !== undefined) requireChoice(args.priority, priorities, "priority");
    if (args.status !== undefined) requireChoice(args.status, statuses, "status");
    if (args.dueDate !== undefined && !validateDate(args.dueDate)) throw new Error("Due date must be YYYY-MM-DD.");
    if (args.description !== undefined && (typeof args.description !== "string" || args.description.length > 20000)) throw new Error("Description exceeds 20,000 characters.");
    if (args.note !== undefined && (typeof args.note !== "string" || args.note.length > 10000)) throw new Error("Note exceeds 10,000 characters.");
    const db = getDb();
    await db.insert(categories).values([
      { ownerId, name: "Personal", prefix: "P", sortOrder: 0 },
      { ownerId, name: "Work", prefix: "W", sortOrder: 1 },
    ]).onConflictDoNothing();
    const [category] = await db.select({ id: categories.id }).from(categories)
      .where(and(eq(categories.ownerId, ownerId), eq(categories.name, categoryName)));
    if (!category) throw new Error("Task category could not be found.");
    const body: Arguments = { action: "task.create", categoryId: category.id, title };
    for (const field of ["priority", "status", "dueDate", "description", "note"]) {
      if (args[field] !== undefined) body[field] = args[field];
    }
    const response = await performAction(callApp, body);
    const created = response.task as { publicId?: string } | undefined;
    return created?.publicId ? detailedTask(ownerId, created.publicId) : response;
  }
  if (name === "update_task" || name === "complete_task") {
    const task = selectTask(await allTasks(ownerId), args.taskId);
    const body: Arguments = { action: "task.update", id: task.id };
    if (name === "complete_task") {
      body.status = "Complete";
    } else {
      for (const field of ["title", "priority", "status", "dueDate", "description"]) {
        if (args[field] !== undefined) body[field] = args[field];
      }
      if (Object.keys(body).length === 2) throw new Error("Supply at least one field to update.");
      if (body.title !== undefined && (requireString(body.title, "Title").length > 240)) throw new Error("Title is too long.");
      if (body.priority !== undefined) requireChoice(body.priority, priorities, "priority");
      if (body.status !== undefined) requireChoice(body.status, statuses, "status");
      if (body.dueDate !== undefined && !validateDate(body.dueDate)) throw new Error("Due date must be YYYY-MM-DD.");
      if (body.description !== undefined && (typeof body.description !== "string" || body.description.length > 20000)) throw new Error("Description exceeds 20,000 characters.");
    }
    await performAction(callApp, body);
    return detailedTask(ownerId, task.publicId);
  }
  if (name === "add_task_note") {
    const task = selectTask(await allTasks(ownerId), args.taskId);
    const note = requireString(args.note, "Note");
    if (note.length > 10000) throw new Error("Note exceeds 10,000 characters.");
    await performAction(callApp, { action: "note.add", taskId: task.id, body: note });
    return detailedTask(ownerId, task.publicId);
  }
  if (name === "move_task") {
    const rows = await allTasks(ownerId);
    const task = selectTask(rows, args.taskId);
    if (task.status === "Complete") throw new Error("Completed tasks cannot be reordered.");
    const position = requireChoice(args.position, ["top", "bottom", "before", "after"], "position");
    const siblings = rows.filter((item) => item.categoryId === task.categoryId && item.status !== "Complete");
    const ordered = siblings.filter((item) => item.id !== task.id);
    let insertAt = position === "top" ? 0 : ordered.length;
    if (position === "before" || position === "after") {
      const anchor = selectTask(rows, args.relativeTo);
      if (anchor.id === task.id) throw new Error("Cannot move a task relative to itself.");
      if (anchor.categoryId !== task.categoryId || anchor.status === "Complete") throw new Error("The anchor task must be active and in the same category.");
      const index = ordered.findIndex((item) => item.id === anchor.id);
      if (index < 0) throw new Error("Anchor task not found in the current order.");
      insertAt = position === "before" ? index : index + 1;
    }
    ordered.splice(insertAt, 0, task);
    await performAction(callApp, { action: "task.reorder", ids: ordered.map((item) => item.id) });
    return { moved: task.publicId, position, relativeTo: position === "before" || position === "after" ? normalizeTaskId(args.relativeTo) : null,
      order: ordered.map((item) => item.publicId) };
  }
  throw new Error(`Unknown Task Tracker tool: ${name}`);
}

function rpc(id: RpcId, result: unknown, status = 200): Response {
  return Response.json({ jsonrpc: "2.0", id, result }, { status, headers: { "cache-control": "no-store" } });
}

function rpcError(id: RpcId, code: number, detail: string, status = 200): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message: detail } }, { status, headers: { "cache-control": "no-store" } });
}

/** Sites authenticates callers before forwarding requests; data tools additionally require identity. */
export async function handleTaskTrackerMcp(request: Request, callApp: ActionHandler): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  let message: Arguments;
  try {
    message = readArgs(await request.json());
  } catch {
    return rpcError(null, -32700, "Invalid JSON-RPC request.", 400);
  }
  const id: RpcId = typeof message.id === "string" || typeof message.id === "number" ? message.id : null;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") return rpcError(id, -32600, "Invalid JSON-RPC request.", 400);

  if (message.method === "server/discover") return rpc(id, { supportedVersions: ["2026-07-28"], capabilities: { tools: {} } });
  if (message.method === "initialize") return rpc(id, { protocolVersion: "2026-07-28", capabilities: { tools: {} }, serverInfo: { name: "Task Tracker", version: "1.0.0" } });
  if (message.method === "notifications/initialized") return new Response(null, { status: 204 });
  if (message.method === "ping") return rpc(id, {});
  if (message.method === "tools/list") return rpc(id, { tools: taskTrackerTools });
  if (message.method !== "tools/call") return rpcError(id, -32601, "Method not found.");

  const ownerId = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  if (!ownerId || !email) return rpcError(id, -32001, "Sign in with ChatGPT to use Task Tracker.", 401);
  try {
    const params = readArgs(message.params);
    const name = requireString(params.name, "Tool name");
    if (!taskTrackerTools.some((tool) => tool.name === name)) return rpcError(id, -32602, "Unknown tool.");
    const args = readArgs(params.arguments);
    const result = await runTool(name, args, ownerId, callApp);
    return rpc(id, { content: [{ type: "text", text: JSON.stringify(result) }] });
  } catch (error) {
    console.error("Task Tracker MCP tool failed", error);
    const detail = error instanceof Error ? error.message : "Task Tracker could not complete the operation.";
    return rpc(id, { content: [{ type: "text", text: detail }], isError: true });
  }
}
