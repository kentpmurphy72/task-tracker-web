import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  nextNumber: integer("next_number").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
}, (table) => [uniqueIndex("categories_owner_name_unique").on(table.ownerId, table.name)]);

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  categoryId: integer("category_id").references(() => categories.id),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("Active"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("projects_owner_idx").on(table.ownerId)]);

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  categoryId: integer("category_id").notNull().references(() => categories.id),
  projectId: integer("project_id").references(() => projects.id),
  publicId: text("public_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("Open"),
  priority: text("priority").notNull().default("Medium"),
  dueDate: text("due_date"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
  deletedAt: text("deleted_at"),
}, (table) => [
  uniqueIndex("tasks_owner_public_id_unique").on(table.ownerId, table.publicId),
  index("tasks_owner_category_sort_idx").on(table.ownerId, table.categoryId, table.sortOrder),
]);

export const taskNotes = sqliteTable("task_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  taskId: integer("task_id").notNull().references(() => tasks.id),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("task_notes_owner_task_idx").on(table.ownerId, table.taskId)]);

export const taskHistory = sqliteTable("task_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  taskId: integer("task_id").notNull().references(() => tasks.id),
  action: text("action").notNull(),
  field: text("field"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("task_history_owner_task_idx").on(table.ownerId, table.taskId)]);
