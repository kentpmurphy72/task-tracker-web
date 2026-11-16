import { NextResponse } from "next/server";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { categories, projects, tasks, taskHistory, taskNotes } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";
type Database = ReturnType<typeof getDb>;
const statuses = ["Open", "In Progress", "Blocked", "Complete"] as const;
const priorities = ["High", "Medium", "Low"] as const;
type TaskInput = { title?: unknown; categoryId?: unknown; projectId?: unknown; priority?: unknown; status?: unknown; dueDate?: unknown; description?: unknown; publicId?: unknown; sortOrder?: unknown; note?: unknown };

const now = () => new Date().toISOString();
const validStatus = (value: unknown) => statuses.includes(value as typeof statuses[number]);
const validPriority = (value: unknown) => priorities.includes(value as typeof priorities[number]);
const validDate = (value: unknown) => value === null || value === "" || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).valueOf()));
const message = (text: string, status = 400) => NextResponse.json({ error: text }, { status });
const safeInt = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

async function ensureCategories(db: Database, ownerId: string) {
  await db.insert(categories).values([
    { ownerId, name: "Personal", prefix: "P", sortOrder: 0 },
    { ownerId, name: "Work", prefix: "W", sortOrder: 1 },
  ]).onConflictDoNothing();
}

async function ownsCategory(db: Database, ownerId: string, id: number) {
  const [row] = await db.select().from(categories).where(and(eq(categories.id, id), eq(categories.ownerId, ownerId)));
  return row;
}

async function ownsProject(db: Database, ownerId: string, id: number) {
  const [row] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, ownerId)));
  return row;
}

async function ownsTask(db: Database, ownerId: string, id: number) {
  const [row] = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.ownerId, ownerId), isNull(tasks.deletedAt)));
  return row;
}

async function addHistory(db: Database, ownerId: string, taskId: number, action: string, field: string | null, oldValue: string | null, newValue: string | null) {
  await db.insert(taskHistory).values({ ownerId, taskId, action, field, oldValue, newValue, createdAt: now() });
}

async function createTask(db: Database, ownerId: string, input: TaskInput, importMode = false) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 240) throw new Error("Task title must be between 1 and 240 characters.");
  const categoryId = safeInt(input.categoryId);
  const category = categoryId && await ownsCategory(db, ownerId, categoryId);
  if (!category) throw new Error("Select a valid category.");
  const priority = input.priority ?? "Medium";
  const status = input.status ?? "Open";
  if (!validPriority(priority) || !validStatus(status)) throw new Error("Invalid priority or status.");
  if (!validDate(input.dueDate)) throw new Error("Due date must be YYYY-MM-DD.");
  const projectId = input.projectId ? safeInt(input.projectId) : null;
  if (projectId) {
    const project = await ownsProject(db, ownerId, projectId);
    if (!project || (project.categoryId && project.categoryId !== category.id)) throw new Error("Invalid project for this category.");
  }
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (description.length > 20000) throw new Error("Description is too long.");

  let publicId: string;
  if (importMode && typeof input.publicId === "string" && new RegExp(`^${category.prefix}[1-9][0-9]*$`).test(input.publicId)) {
    publicId = input.publicId;
    const [duplicate] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.ownerId, ownerId), eq(tasks.publicId, publicId)));
    if (duplicate) throw new Error(`Task ID ${publicId} already exists.`);
    const number = Number(publicId.slice(category.prefix.length));
    if (number >= category.nextNumber) await db.update(categories).set({ nextNumber: number + 1 }).where(eq(categories.id, category.id));
  } else {
    // Reserve an ID with a compare-and-set, so concurrent creates cannot claim the same number.
    let number = category.nextNumber;
    let reserved = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const result = await db.update(categories).set({ nextNumber: number + 1 })
        .where(and(eq(categories.id, category.id), eq(categories.nextNumber, number))).returning({ id: categories.id });
      if (result.length) { reserved = true; break; }
      const current = await ownsCategory(db, ownerId, category.id);
      number = current?.nextNumber ?? number + 1;
    }
    if (!reserved) throw new Error("Could not reserve a task ID. Please retry.");
    publicId = `${category.prefix}${number}`;
  }
  const [max] = await db.select({ value: sql<number>`coalesce(max(${tasks.sortOrder}), 0)` }).from(tasks)
    .where(and(eq(tasks.ownerId, ownerId), eq(tasks.categoryId, category.id)));
  const desiredOrder = importMode && Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : (max?.value ?? 0) + 10;
  const createdAt = now();
  const [created] = await db.insert(tasks).values({
    ownerId, categoryId: category.id, projectId, publicId, title, description,
    status: String(status), priority: String(priority), dueDate: input.dueDate ? String(input.dueDate) : null,
    sortOrder: desiredOrder, createdAt, updatedAt: createdAt,
    // Historical imports should not masquerade as tasks completed today.
    // Their exact completion dates may be unknown; preserve that as null.
    completedAt: status === "Complete" && !importMode ? createdAt : null,
  }).returning();
  await addHistory(db, ownerId, created.id, "Created", null, null, title);
  if (typeof input.note === "string" && input.note.trim()) {
    if (input.note.length > 10000) throw new Error("Imported note exceeds 10,000 characters.");
    await db.insert(taskNotes).values({ ownerId, taskId: created.id, body: input.note.trim(), createdAt: now() });
    await addHistory(db, ownerId, created.id, "Note added", null, null, null);
  }
  return created;
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return message("Sign in with ChatGPT to use this task manager.", 401);
  try {
    const db = getDb();
    await ensureCategories(db, user.userId);
    const [categoryRows, projectRows, taskRows, noteRows, historyRows] = await Promise.all([
      db.select().from(categories).where(eq(categories.ownerId, user.userId)).orderBy(asc(categories.sortOrder)),
      db.select().from(projects).where(eq(projects.ownerId, user.userId)).orderBy(asc(projects.name)),
      db.select().from(tasks).where(and(eq(tasks.ownerId, user.userId), isNull(tasks.deletedAt))).orderBy(asc(tasks.sortOrder)),
      db.select().from(taskNotes).where(eq(taskNotes.ownerId, user.userId)).orderBy(asc(taskNotes.createdAt)),
      db.select().from(taskHistory).where(eq(taskHistory.ownerId, user.userId)).orderBy(asc(taskHistory.createdAt)),
    ]);
    return NextResponse.json({ user: { name: user.displayName, email: user.email }, categories: categoryRows, projects: projectRows, tasks: taskRows, notes: noteRows, history: historyRows });
  } catch (error) {
    console.error("Failed to load task data", error);
    return message("Could not load tasks. Please try again.", 500);
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return message("Sign in with ChatGPT to use this task manager.", 401);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return message("Invalid JSON request."); }
  const action = body.action;
  const db = getDb();
  const ownerId = user.userId;
  try {
    await ensureCategories(db, ownerId);
    if (action === "task.create") {
      return NextResponse.json({ task: await createTask(db, ownerId, body) });
    }
    if (action === "task.update") {
      const id = safeInt(body.id);
      const original = id && await ownsTask(db, ownerId, id);
      if (!original) return message("Task not found.", 404);
      const fields = ["title", "description", "priority", "status", "dueDate", "categoryId", "projectId"] as const;
      const changes: Record<string, string | number | null> = {};
      for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
        const value = body[field];
        if (field === "title") {
          if (typeof value !== "string" || !value.trim() || value.trim().length > 240) return message("Task title must be between 1 and 240 characters.");
          changes.title = value.trim();
        } else if (field === "description") {
          if (typeof value !== "string" || value.length > 20000) return message("Description is too long.");
          changes.description = value.trim();
        } else if (field === "priority") {
          if (!validPriority(value)) return message("Invalid priority.");
          changes.priority = String(value);
        } else if (field === "status") {
          if (!validStatus(value)) return message("Invalid status.");
          changes.status = String(value);
        } else if (field === "dueDate") {
          if (!validDate(value)) return message("Invalid due date.");
          changes.dueDate = value ? String(value) : null;
        } else if (field === "categoryId") {
          const categoryId = safeInt(value);
          if (!categoryId || !await ownsCategory(db, ownerId, categoryId)) return message("Invalid category.");
          changes.categoryId = categoryId;
        } else if (field === "projectId") {
          const projectId = value ? safeInt(value) : null;
          if (projectId && !await ownsProject(db, ownerId, projectId)) return message("Invalid project.");
          changes.projectId = projectId;
        }
      }
      const categoryId = Number(changes.categoryId ?? original.categoryId);
      if (changes.categoryId && categoryId !== original.categoryId) return message("Category changes are not supported because task IDs are permanent.");
      const projectId = changes.projectId === undefined ? original.projectId : changes.projectId;
      if (projectId) {
        const project = await ownsProject(db, ownerId, Number(projectId));
        if (project?.categoryId && project.categoryId !== categoryId) return message("Project belongs to another category.");
      }
      const nextStatus = changes.status ?? original.status;
      const completedAt = nextStatus === "Complete" ? (original.status === "Complete" ? original.completedAt : now()) : null;
      const updates = { ...changes, completedAt, updatedAt: now() };
      await db.update(tasks).set(updates).where(and(eq(tasks.id, original.id), eq(tasks.ownerId, ownerId)));
      for (const [field, next] of Object.entries(changes)) {
        const previous = original[field as keyof typeof original];
        if (String(previous ?? "") !== String(next ?? "")) await addHistory(db, ownerId, original.id, "Updated", field, previous == null ? null : String(previous), next == null ? null : String(next));
      }
      return NextResponse.json({ ok: true });
    }
    if (action === "task.reorder") {
      if (!Array.isArray(body.ids) || body.ids.length > 2000 || !body.ids.every((x) => safeInt(x))) return message("Invalid task order.");
      const ids = body.ids.map(Number);
      if (new Set(ids).size !== ids.length) return message("Duplicate task IDs in order.");
      const owned = await db.select({ id: tasks.id, categoryId: tasks.categoryId, status: tasks.status }).from(tasks).where(and(eq(tasks.ownerId, ownerId), isNull(tasks.deletedAt)));
      const lookup = new Map(owned.map((task) => [task.id, task]));
      const selected = ids.map((id) => lookup.get(id));
      if (selected.some((item) => !item) || selected.some((item) => item?.categoryId !== selected[0]?.categoryId || item?.status === "Complete")) return message("Can only reorder active tasks in the same category.");
      for (let i = 0; i < ids.length; i++) await db.update(tasks).set({ sortOrder: (i + 1) * 10, updatedAt: now() }).where(and(eq(tasks.id, ids[i]), eq(tasks.ownerId, ownerId)));
      return NextResponse.json({ ok: true });
    }
    if (action === "task.delete") {
      const id = safeInt(body.id);
      const task = id && await ownsTask(db, ownerId, id);
      if (!task) return message("Task not found.", 404);
      await addHistory(db, ownerId, task.id, "Deleted", null, task.title, null);
      await db.update(tasks).set({ deletedAt: now(), updatedAt: now() }).where(and(eq(tasks.id, task.id), eq(tasks.ownerId, ownerId)));
      return NextResponse.json({ ok: true });
    }
    if (action === "note.add") {
      const taskId = safeInt(body.taskId);
      if (!taskId || !await ownsTask(db, ownerId, taskId)) return message("Task not found.", 404);
      const note = typeof body.body === "string" ? body.body.trim() : "";
      if (!note || note.length > 10000) return message("Note must be between 1 and 10,000 characters.");
      const [saved] = await db.insert(taskNotes).values({ ownerId, taskId, body: note, createdAt: now() }).returning();
      await addHistory(db, ownerId, taskId, "Note added", null, null, null);
      return NextResponse.json({ note: saved });
    }
    if (action === "note.delete") {
      const id = safeInt(body.id);
      const [note] = id ? await db.select().from(taskNotes).where(and(eq(taskNotes.id, id), eq(taskNotes.ownerId, ownerId))) : [];
      if (!note) return message("Note not found.", 404);
      await db.delete(taskNotes).where(and(eq(taskNotes.id, note.id), eq(taskNotes.ownerId, ownerId)));
      await addHistory(db, ownerId, note.taskId, "Note removed", null, null, null);
      return NextResponse.json({ ok: true });
    }
    if (action === "project.create") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 140) return message("Project name must be between 1 and 140 characters.");
      const categoryId = body.categoryId ? safeInt(body.categoryId) : null;
      if (categoryId && !await ownsCategory(db, ownerId, categoryId)) return message("Invalid category.");
      const description = typeof body.description === "string" ? body.description.slice(0, 3000) : "";
      const [project] = await db.insert(projects).values({ ownerId, name, categoryId, description, createdAt: now() }).returning();
      return NextResponse.json({ project });
    }
    if (action === "project.update") {
      const id = safeInt(body.id);
      const project = id && await ownsProject(db, ownerId, id);
      if (!project) return message("Project not found.", 404);
      const changes: { name?: string; description?: string; status?: string } = {};
      if (body.name !== undefined) {
        if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 140) return message("Invalid project name.");
        changes.name = body.name.trim();
      }
      if (body.description !== undefined) {
        if (typeof body.description !== "string" || body.description.length > 3000) return message("Invalid project description.");
        changes.description = body.description;
      }
      if (body.status !== undefined) {
        if (!['Active', 'Archived'].includes(String(body.status))) return message("Invalid project status.");
        changes.status = String(body.status);
      }
      await db.update(projects).set(changes).where(and(eq(projects.id, project.id), eq(projects.ownerId, ownerId)));
      return NextResponse.json({ ok: true });
    }
    if (action === "tasks.import") {
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 250) return message("Import 1–250 tasks at a time.");
      // Validate and reject duplicate IDs before writing any rows.
      const items = body.items as TaskInput[];
      const categoryRows = await db.select().from(categories).where(eq(categories.ownerId, ownerId));
      const allowed = new Map(categoryRows.map((category) => [category.id, category]));
      const known = new Set((await db.select({ publicId: tasks.publicId }).from(tasks).where(eq(tasks.ownerId, ownerId))).map((item) => item.publicId));
      const incoming = new Set<string>();
      for (const item of items) {
        const category = allowed.get(Number(item.categoryId));
        const title = typeof item.title === "string" ? item.title.trim() : "";
        if (!category || !title || title.length > 240 || !validStatus(item.status ?? "Open") || !validPriority(item.priority ?? "Medium") || !validDate(item.dueDate) || (typeof item.note === "string" && item.note.length > 10000)) return message("Import contains an invalid category, title, status, priority, date, or note.");
        if (item.publicId) {
          const publicId = String(item.publicId);
          if (!new RegExp(`^${category.prefix}[1-9][0-9]*$`).test(publicId) || known.has(publicId) || incoming.has(publicId)) return message(`Duplicate or invalid task ID: ${publicId}`);
          incoming.add(publicId);
        }
      }
      let imported = 0;
      for (const item of items) { await createTask(db, ownerId, item, true); imported++; }
      return NextResponse.json({ ok: true, imported });
    }
    return message("Unknown action.");
  } catch (error) {
    console.error("Task action failed", error);
    if (error instanceof Error && !/UNIQUE|constraint|D1|SQLITE|database/i.test(error.message)) return message(error.message);
    return message("Could not save the change. Please retry.", 500);
  }
}
