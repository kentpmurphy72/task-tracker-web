"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowDown, ArrowRight, ArrowUp, CalendarDays, Check, CheckCheck,
  CheckCircle2, ChevronRight, Circle, Clock3, Download, FileUp,
  FolderKanban, Home, LayoutDashboard, ListTodo, LoaderCircle, Menu,
  Plus, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, X,
} from "lucide-react";

type Category = { id: number; name: string; prefix: string; sortOrder: number };
type Project = { id: number; name: string; description: string; status: string; categoryId: number | null };
type Task = { id: number; categoryId: number; projectId: number | null; publicId: string; title: string; description: string; status: string; priority: string; dueDate: string | null; sortOrder: number; createdAt: string; updatedAt: string; completedAt: string | null };
type Note = { id: number; taskId: number; body: string; createdAt: string };
type History = { id: number; taskId: number; action: string; field: string | null; oldValue: string | null; newValue: string | null; createdAt: string };
type Data = { categories: Category[]; projects: Project[]; tasks: Task[]; notes: Note[]; history: History[]; user: { name: string; email: string } };
type Page = "Overview" | "All Tasks" | "Personal" | "Work" | "Projects" | "Completed" | "Activity";
type TaskForm = { title: string; categoryId: number; projectId: string; priority: string; status: string; dueDate: string; description: string };

const PRIORITIES = ["High", "Medium", "Low"];
const STATUSES = ["Open", "In Progress", "Blocked", "Complete"];
const EMPTY_FORM: TaskForm = { title: "", categoryId: 0, projectId: "", priority: "Medium", status: "Open", dueDate: "", description: "" };
const NAV: { page: Page; icon: typeof Home }[] = [
  { page: "Overview", icon: LayoutDashboard }, { page: "All Tasks", icon: ListTodo },
  { page: "Personal", icon: Home }, { page: "Work", icon: FolderKanban },
  { page: "Projects", icon: FolderKanban }, { page: "Completed", icon: CheckCheck },
  { page: "Activity", icon: Activity },
];

const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; };
const formatDate = (value: string | null) => !value ? "—" : new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const formatMoment = (value: string) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const isOverdue = (task: Task) => !!task.dueDate && task.dueDate < today() && task.status !== "Complete";
const inSevenDays = () => { const date = new Date(`${today()}T12:00:00`); date.setDate(date.getDate() + 7); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; };
const taskOrder = (a: Task, b: Task) => a.sortOrder - b.sortOrder || a.id - b.id;
const prettyField = (field: string | null) => ({ dueDate: "Due date", projectId: "Project", categoryId: "Category", priority: "Priority", status: "Status", description: "Description", title: "Title" }[field || ""] || field || "Task");

function Badge({ label, kind = "default" }: { label: string; kind?: "priority" | "status" | "default" }) {
  const map: Record<string, string> = {
    High: "bg-rose-50 text-rose-700 ring-rose-200", Medium: "bg-amber-50 text-amber-700 ring-amber-200", Low: "bg-slate-100 text-slate-600 ring-slate-200",
    Open: "bg-slate-100 text-slate-600 ring-slate-200", "In Progress": "bg-blue-50 text-blue-700 ring-blue-200", Blocked: "bg-orange-50 text-orange-700 ring-orange-200", Complete: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  };
  return <span className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${kind === "default" ? "bg-slate-100 text-slate-600 ring-slate-200" : map[label] || "bg-slate-100 text-slate-600 ring-slate-200"}`}>{kind === "priority" && <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${label === "High" ? "bg-rose-500" : label === "Medium" ? "bg-amber-500" : "bg-slate-400"}`} />}{label}</span>;
}

function Empty({ title, detail, onAdd }: { title: string; detail: string; onAdd?: () => void }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-14 text-center">
    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><ListTodo size={24} /></div>
    <h3 className="text-base font-bold text-slate-900">{title}</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{detail}</p>
    {onAdd && <button onClick={onAdd} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"><Plus size={16}/> Add a task</button>}
  </div>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/55 px-4 py-10 backdrop-blur-[3px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5"><h2 className="text-lg font-bold text-slate-900">{title}</h2><button aria-label="Close" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18}/></button></div>
      <div className="p-6">{children}</div>
    </div>
  </div>;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  const normalized = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (char === '"') { if (quoted && normalized[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && normalized[i + 1] === "\n") i++; row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  row.push(cell); if (row.some(Boolean)) rows.push(row);
  return rows;
}

const csvCell = (value: string | number | null | undefined) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export default function TaskManager({ userName }: { userName: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState<Page>("Overview");
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("All priorities");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [taskForm, setTaskForm] = useState<TaskForm>(EMPTY_FORM);
  const [noteDraft, setNoteDraft] = useState("");
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectCategory, setProjectCategory] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [importPreview, setImportPreview] = useState<Record<string, unknown>[] | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const lastAutoRefreshAt = useRef(0);

  const refresh = useCallback((): Promise<void> => {
    if (refreshInFlight.current) return refreshInFlight.current;
    setRefreshing(true);
    const request = (async () => {
      const response = await fetch("/api/data", { cache: "no-store" });
      const payload = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to load tasks.");
      setData(payload);
      setSelectedTask((selected) => selected ? payload.tasks.find((task: Task) => task.id === selected.id) ?? null : null);
    })();
    refreshInFlight.current = request;
    const finish = () => { refreshInFlight.current = null; setRefreshing(false); };
    void request.then(finish, finish);
    return request;
  }, []);
  useEffect(() => { void Promise.resolve().then(refresh).catch((reason) => setError(reason.message)).finally(() => setLoading(false)); }, [refresh]);

  // ChatGPT can update the same D1 database while this page is open. Recheck
  // when the visitor returns, without replacing any unsaved form drafts.
  useEffect(() => {
    const refreshOnReturn = () => {
      if (document.visibilityState !== "visible" || busy || showTaskForm || showProjectForm || importPreview) return;
      if (Date.now() - lastAutoRefreshAt.current < 2000) return; // focus and visibilitychange often fire together
      lastAutoRefreshAt.current = Date.now();
      void refresh().catch(() => setError("Couldn't refresh tasks. Showing the last loaded data; try Refresh."));
    };
    const onVisibilityChange = () => { if (document.visibilityState === "visible") refreshOnReturn(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", refreshOnReturn);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", refreshOnReturn);
    };
  }, [busy, showTaskForm, showProjectForm, importPreview, refresh]);

  const manualRefresh = () => {
    setError(""); setNotice("");
    void refresh().then(() => setNotice("Task list is up to date.")).catch((reason) =>
      setError(reason instanceof Error ? reason.message : "Could not refresh tasks."));
  };

  const mutate = async (action: string, payload: Record<string, unknown>, success?: string) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not save change.");
      await refresh();
      if (success) setNotice(success);
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Something went wrong."); return false; }
    finally { setBusy(false); }
  };

  const categories = data?.categories || [];
  const projects = data?.projects || [];
  const tasks = data?.tasks || [];
  const notes = data?.notes || [];
  const history = data?.history || [];
  const active = tasks.filter((task) => task.status !== "Complete");
  const completed = tasks.filter((task) => task.status === "Complete");
  const overdue = active.filter(isOverdue);
  const upcoming = active.filter((task) => task.dueDate && task.dueDate >= today() && task.dueDate <= inSevenDays());
  const highPriority = active.filter((task) => task.priority === "High");
  const categoryName = (id: number) => categories.find((item) => item.id === id)?.name || "Unknown";
  const projectNameFor = (id: number | null) => projects.find((item) => item.id === id)?.name || "";
  const currentCategory = categories.find((category) => category.name === page);
  const mainTasks = useMemo(() => {
    const source = page === "Completed" ? completed : active;
    const term = search.trim().toLowerCase();
    return source.filter((task) => {
      if (currentCategory && task.categoryId !== currentCategory.id) return false;
      if (priorityFilter !== "All priorities" && task.priority !== priorityFilter) return false;
      if (statusFilter !== "All statuses" && task.status !== statusFilter) return false;
      if (term && !`${task.publicId} ${task.title} ${task.description} ${categoryName(task.categoryId)} ${projectNameFor(task.projectId)}`.toLowerCase().includes(term)) return false;
      return true;
    }).sort((a,b) => page === "Completed" ? (b.completedAt || "").localeCompare(a.completedAt || "") : taskOrder(a,b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, page, search, priorityFilter, statusFilter, categories, projects]);

  const openCreate = (categoryId?: number) => {
    setTaskForm({ ...EMPTY_FORM, categoryId: categoryId || currentCategory?.id || categories[0]?.id || 0 });
    setEditingTask(null); setShowTaskForm(true);
  };
  const openEdit = (task: Task) => {
    setTaskForm({ title: task.title, description: task.description, categoryId: task.categoryId, projectId: task.projectId ? String(task.projectId) : "", priority: task.priority, status: task.status, dueDate: task.dueDate || "" });
    setEditingTask(task); setShowTaskForm(true);
  };
  const saveTask = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload = { ...taskForm, projectId: taskForm.projectId ? Number(taskForm.projectId) : null, dueDate: taskForm.dueDate || null };
    const success = await mutate(editingTask ? "task.update" : "task.create", editingTask ? { id: editingTask.id, ...payload } : payload, editingTask ? "Task updated." : "Task added.");
    if (success) { setShowTaskForm(false); setEditingTask(null); }
  };
  const reorder = async (task: Task, direction: -1 | 1) => {
    const siblings = active.filter((item) => item.categoryId === task.categoryId).sort(taskOrder);
    const index = siblings.findIndex((item) => item.id === task.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= siblings.length) return;
    [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
    await mutate("task.reorder", { ids: siblings.map((item) => item.id) });
  };
  const exportCsv = () => {
    const rows = [["id", "category", "title", "priority", "status", "due_date", "project", "description", "sort_order", "notes"],
      ...tasks.map((task) => [task.publicId, categoryName(task.categoryId), task.title, task.priority, task.status, task.dueDate || "", projectNameFor(task.projectId), task.description, task.sortOrder, notes.filter((note) => note.taskId === task.id).map((note) => note.body).join("\n---\n")])];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `task-tracker-${today()}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("CSV export downloaded.");
  };
  const readImport = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    try {
      if (file.size > 1_000_000) throw new Error("CSV file is too large (maximum 1 MB).");
      const rows = parseCsv(await file.text());
      if (rows.length < 2) throw new Error("CSV needs a header row and at least one task.");
      const headers = rows[0].map((entry) => entry.trim().toLowerCase().replaceAll(" ", "_"));
      const index = (name: string) => headers.indexOf(name);
      if (index("title") < 0 || index("category") < 0) throw new Error("CSV must contain title and category columns.");
      const items = rows.slice(1).map((row, idx) => {
        const read = (name: string) => (index(name) >= 0 ? (row[index(name)] || "").trim() : "");
        const category = categories.find((item) => item.name.toLowerCase() === read("category").toLowerCase());
        if (!category) throw new Error(`Row ${idx + 2}: category must be Personal or Work.`);
        const project = projects.find((item) => item.name.toLowerCase() === read("project").toLowerCase() && (!item.categoryId || item.categoryId === category.id));
        if (read("project") && !project) throw new Error(`Row ${idx + 2}: project \"${read("project")}\" does not exist. Create it before importing.`);
        return { publicId: read("id") || undefined, categoryId: category.id, title: read("title"), priority: read("priority") || "Medium", status: read("status") || "Open", dueDate: read("due_date") || null, projectId: project?.id || null, description: read("description"), sortOrder: read("sort_order") ? Number(read("sort_order")) : undefined, note: read("notes") };
      });
      if (items.length > 250) throw new Error("Import supports a maximum of 250 tasks per file.");
      setImportPreview(items);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not read CSV."); }
    finally { if (importRef.current) importRef.current.value = ""; }
  };

  const openPage = (next: Page) => { setPage(next); setSearch(""); setPriorityFilter("All priorities"); setStatusFilter("All statuses"); setMobileMenu(false); setSelectedTask(null); };
  const activeForCategory = (id: number) => active.filter((task) => task.categoryId === id).length;
  const initials = userName.split(/[\s._-]+/).filter(Boolean).slice(0,2).map((piece) => piece[0]?.toUpperCase()).join("") || "KM";

  const taskRows = (items: Task[], allowReorder = true) => <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_5px_24px_rgba(28,47,82,.035)]">
    <div className="hidden grid-cols-[35px_88px_minmax(230px,1fr)_95px_118px_108px_72px] gap-3 border-b border-slate-100 bg-slate-50/80 px-5 py-3 text-[10px] font-bold uppercase tracking-[.11em] text-slate-400 lg:grid">
      <span/><span>Task ID</span><span>Task</span><span>Priority</span><span>Status</span><span>Due date</span><span className="text-right">Order</span>
    </div>
    {items.map((task) => {
      const siblings = active.filter((item) => item.categoryId === task.categoryId).sort(taskOrder);
      const index = siblings.findIndex((item) => item.id === task.id);
      return <div key={task.id} className="group flex items-center gap-3 border-b border-slate-100 px-4 py-4 transition-colors last:border-b-0 hover:bg-slate-50/70 lg:grid lg:grid-cols-[35px_88px_minmax(230px,1fr)_95px_118px_108px_72px] lg:gap-3 lg:px-5">
        <button title={task.status === "Complete" ? "Reopen task" : "Mark complete"} aria-label={task.status === "Complete" ? `Reopen ${task.publicId}` : `Complete ${task.publicId}`} disabled={busy} onClick={() => mutate("task.update", { id: task.id, status: task.status === "Complete" ? "Open" : "Complete" })} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors ${task.status === "Complete" ? "border-emerald-200 bg-emerald-50 text-emerald-600" : "border-slate-300 text-slate-300 hover:border-emerald-400 hover:text-emerald-500"}`}>
          {task.status === "Complete" ? <Check size={15} strokeWidth={3}/> : <Circle size={18}/>}</button>
        <span className="hidden text-xs font-semibold tracking-wide text-slate-400 lg:block">{task.publicId}</span>
        <button className="min-w-0 flex-1 text-left" onClick={() => setSelectedTask(task)}>
          <div className="mb-0.5 text-xs font-semibold text-slate-400 lg:hidden">{task.publicId} · {categoryName(task.categoryId)}</div>
          <div className={`truncate text-sm font-semibold leading-6 ${task.status === "Complete" ? "text-slate-500 line-through decoration-slate-300" : "text-slate-800"}`}>{task.title}</div>
          {task.projectId && <div className="mt-0.5 truncate text-xs text-slate-400">{projectNameFor(task.projectId)}</div>}
        </button>
        <div className="hidden sm:block"><Badge label={task.priority} kind="priority"/></div>
        <div className="hidden lg:block"><Badge label={task.status} kind="status"/></div>
        <div className={`hidden text-xs font-medium lg:block ${isOverdue(task) ? "text-rose-600" : "text-slate-500"}`}>{formatDate(task.dueDate)}</div>
        <div className="flex items-center justify-end gap-1">
          {allowReorder && task.status !== "Complete" ? <>
            <button disabled={busy || index < 1} title="Move up" onClick={() => reorder(task, -1)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-blue-600 disabled:opacity-20"><ArrowUp size={14}/></button>
            <button disabled={busy || index >= siblings.length - 1} title="Move down" onClick={() => reorder(task, 1)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-blue-600 disabled:opacity-20"><ArrowDown size={14}/></button>
          </> : <button title="Open task" onClick={() => setSelectedTask(task)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100"><ChevronRight size={16}/></button>}
        </div>
      </div>;
    })}
  </div>;

  return <div className="min-h-screen bg-[#f6f8fc] text-slate-900">
    {mobileMenu && <button aria-label="Close navigation" onClick={() => setMobileMenu(false)} className="fixed inset-0 z-30 bg-slate-950/50 lg:hidden"/>}
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-[252px] flex-col bg-[#111d37] px-4 pb-5 pt-7 text-white transition-transform lg:translate-x-0 ${mobileMenu ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="mb-10 flex items-center gap-3 px-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500 text-white shadow-lg shadow-blue-700/30"><CheckCheck size={24} strokeWidth={2.5}/></div><div><div className="text-[15px] font-bold tracking-tight">Task Tracker</div><div className="mt-0.5 text-[10px] font-medium uppercase tracking-[.14em] text-blue-200/70">Personal + Work</div></div></div>
      <div className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.2em] text-slate-500">Workspace</div>
      <nav className="space-y-1" aria-label="Main navigation">{NAV.map(({ page: item, icon: Icon }) => <button key={item} onClick={() => openPage(item)} className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-medium transition-colors ${page === item ? "bg-blue-600 text-white shadow-lg shadow-blue-950/30" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}><span className="flex items-center gap-3"><Icon size={18} strokeWidth={1.9}/>{item}</span>{item === "Personal" || item === "Work" ? <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${page === item ? "bg-white/20" : "bg-white/10 text-slate-400"}`}>{activeForCategory(categories.find((c) => c.name === item)?.id || -1)}</span> : null}</button>)}</nav>
      <div className="mt-auto px-2"><div className="rounded-xl border border-white/10 bg-white/[.06] p-4"><div className="mb-1 flex items-center gap-2 text-xs font-semibold text-blue-200"><ShieldCheck size={15}/> Private workspace</div><p className="text-[11px] leading-5 text-slate-400">Your task data lives in the private database, not the public source repository.</p></div>
        <div className="mt-5 flex items-center gap-3 border-t border-white/10 px-1 pt-5"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 text-xs font-bold">{initials}</span><span className="min-w-0"><span className="block truncate text-xs font-semibold">{userName}</span><span className="block text-[11px] text-slate-400">Task manager</span></span></div>
      </div>
    </aside>

    <div className="min-h-screen lg:pl-[252px]">
      <header className="sticky top-0 z-20 flex h-[73px] items-center justify-between border-b border-slate-200/90 bg-white/95 px-5 backdrop-blur-lg sm:px-8 lg:px-10">
        <div className="flex min-w-0 items-center gap-3"><button aria-label="Open navigation" onClick={() => setMobileMenu(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"><Menu size={20}/></button><span className="text-[13px] text-slate-400">Workspace</span><ChevronRight size={14} className="text-slate-300"/><span className="truncate text-[13px] font-semibold text-slate-700">{page}</span></div>
        <div className="flex items-center gap-3"><span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500"/> Private</span><button type="button" aria-label="Refresh tasks" title="Get the latest tasks from ChatGPT and the website" disabled={busy || refreshing} onClick={manualRefresh} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={16} className={refreshing ? "animate-spin" : ""}/><span className="hidden sm:inline">Refresh</span></button><button onClick={() => openCreate()} className="flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2.5 text-xs font-bold text-white shadow-sm shadow-blue-200 transition-colors hover:bg-blue-700"><Plus size={16}/> <span className="hidden sm:inline">New Task</span><span className="sm:hidden">Add</span></button></div>
      </header>

      <main className="mx-auto max-w-[1430px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.17em] text-blue-600"><span className="h-1.5 w-1.5 rounded-full bg-blue-500"/> Your command center</div><h1 className="text-[28px] font-bold tracking-tight text-[#15213b] sm:text-[34px]">{page === "Overview" ? "Executive Overview" : page}</h1><p className="mt-1.5 text-sm text-slate-500">{page === "Overview" ? "A clear view of everything that needs your attention." : page === "Completed" ? "A record of the work you have finished." : page === "Projects" ? "Organize related tasks into focused initiatives." : page === "Activity" ? "A running history of task changes and progress." : "Keep your priorities organized and moving forward."}</p></div>
          <div className="flex flex-wrap items-center gap-2"><input ref={importRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => readImport(event.target.files?.[0])}/><button onClick={() => importRef.current?.click()} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"><FileUp size={15}/> Import CSV</button><button onClick={exportCsv} disabled={!tasks.length} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"><Download size={15}/> Export</button></div>
        </div>

        {error && <div role="alert" className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError("")}><X size={16}/></button></div>}
        {notice && <div role="status" className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"><span>{notice}</span><button aria-label="Dismiss notice" onClick={() => setNotice("")}><X size={16}/></button></div>}
        {loading ? <div className="flex min-h-[320px] items-center justify-center gap-3 text-sm text-slate-500"><LoaderCircle size={21} className="animate-spin"/> Loading your workspace…</div> : !data ? <Empty title="We couldn't load your workspace" detail="Refresh the page to reconnect to your private task database."/> : <>
          {page === "Overview" && <>
            <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { title: "Active Tasks", value: active.length, icon: ListTodo, sub: `${active.filter((t) => t.status === "In Progress").length} in progress`, color: "blue" },
                { title: "High Priority", value: highPriority.length, icon: Sparkles, sub: "Your most important work", color: "violet" },
                { title: "Due This Week", value: upcoming.length, icon: CalendarDays, sub: "Coming up in 7 days", color: "amber" },
                { title: "Overdue", value: overdue.length, icon: Clock3, sub: overdue.length ? "Needs your attention" : "You're all caught up", color: "rose" },
              ].map((card) => <div key={card.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_5px_24px_rgba(28,47,82,.035)]"><div className="flex items-start justify-between"><span className="text-xs font-semibold text-slate-500">{card.title}</span><span className={`rounded-xl p-2.5 ${card.color === "blue" ? "bg-blue-50 text-blue-600" : card.color === "violet" ? "bg-indigo-50 text-indigo-600" : card.color === "amber" ? "bg-amber-50 text-amber-600" : "bg-rose-50 text-rose-600"}`}><card.icon size={19}/></span></div><div className="mt-2 text-[32px] font-bold tracking-tight text-slate-900">{card.value}</div><div className="mt-1 text-xs text-slate-400">{card.sub}</div></div>)}
            </div>
            <div className="mb-8 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(270px,1fr)]"><div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-base font-bold">Focus now</h2><p className="mt-1 text-xs text-slate-500">High-priority and time-sensitive tasks</p></div><button onClick={() => openPage("All Tasks")} className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">View all <ArrowRight size={14}/></button></div>
              {active.length ? <div className="space-y-1">{[...active].sort((a,b) => Number(isOverdue(b)) - Number(isOverdue(a)) || Number(b.priority === "High") - Number(a.priority === "High") || (a.dueDate || "9999").localeCompare(b.dueDate || "9999")).slice(0,6).map((task) => <button onClick={() => setSelectedTask(task)} key={task.id} className="flex w-full items-center gap-3 rounded-lg border-b border-slate-100 px-1 py-3 text-left last:border-b-0 hover:bg-slate-50"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><ListTodo size={16}/></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-800">{task.title}</span><span className="mt-0.5 block text-xs text-slate-400">{task.publicId} · {categoryName(task.categoryId)}</span></span><Badge label={task.priority} kind="priority"/><ChevronRight size={14} className="text-slate-300"/></button>)}</div> : <div className="py-10 text-center text-sm text-slate-500">Your focus list is clear. Add your first task to get started.</div>}
            </div><div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-base font-bold">By category</h2><p className="mt-1 text-xs text-slate-500">Everything in one place, clearly separated</p>
              <div className="mt-7 space-y-5">{categories.map((category) => { const count = activeForCategory(category.id); const percent = active.length ? (count / active.length) * 100 : 0; return <button key={category.id} onClick={() => openPage(category.name as Page)} className="w-full text-left"><div className="mb-2 flex items-center justify-between text-sm"><span className="flex items-center gap-2 font-semibold text-slate-700"><span className={`h-2.5 w-2.5 rounded-full ${category.name === "Personal" ? "bg-teal-500" : "bg-blue-500"}`}/>{category.name}</span><span className="text-xs font-semibold text-slate-400">{count} tasks</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${category.name === "Personal" ? "bg-teal-500" : "bg-blue-500"}`} style={{ width: `${percent}%` }}/></div></button>; })}</div>
              <div className="mt-8 rounded-xl bg-[#f5f8ff] p-4"><div className="mb-1 flex items-center gap-2 text-xs font-bold text-blue-700"><CheckCircle2 size={15}/> Progress snapshot</div><p className="text-xs leading-5 text-slate-600">{completed.length} completed task{completed.length === 1 ? "" : "s"} are retained with their notes and history.</p></div>
            </div></div>
            <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-bold tracking-tight text-slate-800">Active task list</h2><button onClick={() => openCreate()} className="flex items-center gap-1.5 text-xs font-semibold text-blue-600"><Plus size={15}/> Add task</button></div>
            {active.length ? categories.map((category) => { const rows = active.filter((task) => task.categoryId === category.id).sort(taskOrder); return rows.length ? <section className="mb-6" key={category.id}><div className="mb-3 flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${category.name === "Personal" ? "bg-teal-500" : "bg-blue-500"}`}/><h3 className="text-sm font-bold">{category.name}</h3><span className="text-xs text-slate-400">({rows.length})</span></div>{taskRows(rows)}</section> : null; }) : <Empty title="Let's build your master list" detail="Start by adding a task or import your existing task list from a CSV file. Personal and Work tasks stay together in one private workspace." onAdd={() => openCreate()}/>}
          </>}

          {(page === "All Tasks" || page === "Personal" || page === "Work" || page === "Completed") && <>
            <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4"><div className="relative min-w-[200px] flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by title, ID, description…" className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-xs outline-none transition-colors focus:border-blue-400 focus:bg-white"/></div><div className="flex items-center gap-2 text-slate-400"><SlidersHorizontal size={16}/></div><select aria-label="Filter priority" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-600 outline-none">{["All priorities", ...PRIORITIES].map((item) => <option key={item}>{item}</option>)}</select><select aria-label="Filter status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-600 outline-none">{["All statuses", ...STATUSES].map((item) => <option key={item}>{item}</option>)}</select></div>
            <div className="mb-4 flex items-center justify-between"><p className="text-xs font-semibold text-slate-500">{mainTasks.length} {page === "Completed" ? "completed" : "active"} task{mainTasks.length === 1 ? "" : "s"}</p>{page !== "Completed" && <span className="text-xs text-slate-400">Use ↑ ↓ to change the order within a category</span>}</div>
            {mainTasks.length ? page === "All Tasks" ? categories.map((category) => { const rows = mainTasks.filter((task) => task.categoryId === category.id); return rows.length ? <section className="mb-6" key={category.id}><div className="mb-3 flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${category.name === "Personal" ? "bg-teal-500" : "bg-blue-500"}`}/><h3 className="text-sm font-bold">{category.name}</h3><span className="text-xs text-slate-400">({rows.length})</span></div>{taskRows(rows)}</section> : null; }) : taskRows(mainTasks, page !== "Completed") : <Empty title={page === "Completed" ? "No completed tasks yet" : "No matching tasks"} detail={page === "Completed" ? "Tasks you complete will appear here, with their notes and activity intact." : "Try adjusting your filters, importing a CSV, or adding a new task."} onAdd={page === "Completed" ? undefined : () => openCreate()}/>}
          </>}

          {page === "Projects" && <><div className="mb-5 flex items-center justify-between"><p className="text-sm text-slate-500">Group related work without losing your task IDs.</p><button onClick={() => setShowProjectForm(true)} className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700"><Plus size={15}/> New Project</button></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{projects.map((project) => { const projectTasks = tasks.filter((task) => task.projectId === project.id); const done = projectTasks.filter((task) => task.status === "Complete").length; return <div key={project.id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="mb-4 flex items-start justify-between"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><FolderKanban size={21}/></span><Badge label={project.status}/></div><h3 className="text-base font-bold text-slate-900">{project.name}</h3><p className="mt-1 min-h-[32px] text-xs leading-5 text-slate-500">{project.description || `${project.categoryId ? categoryName(project.categoryId) : "Cross-category"} project`}</p><div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-xs text-slate-500"><span>{projectTasks.length} total · {done} complete</span><button onClick={() => mutate("project.update", { id: project.id, status: project.status === "Active" ? "Archived" : "Active" })} className="font-semibold text-blue-600">{project.status === "Active" ? "Archive" : "Restore"}</button></div></div>; })}<button onClick={() => setShowProjectForm(true)} className="flex min-h-[225px] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 text-sm font-semibold text-slate-500 hover:border-blue-300 hover:bg-blue-50/40 hover:text-blue-700"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100"><Plus size={22}/></span>Create a project</button></div></>}

          {page === "Activity" && <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6">{history.length ? [...history].reverse().slice(0,150).map((item) => { const task = tasks.find((task) => task.id === item.taskId); return <div key={item.id} className="flex gap-4 border-b border-slate-100 py-4 last:border-b-0"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600"><Activity size={16}/></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-800">{task?.publicId || "Task"} · {task?.title || "Removed task"}</p><p className="mt-1 text-xs leading-5 text-slate-500">{item.action}{item.field ? ` ${prettyField(item.field).toLowerCase()}` : ""}{item.action === "Updated" ? `: ${item.oldValue || "None"} → ${item.newValue || "None"}` : ""}</p></div><span className="shrink-0 text-[11px] text-slate-400">{formatMoment(item.createdAt)}</span></div>; }) : <Empty title="No activity yet" detail="Your task changes will be tracked here automatically."/>}</div>}
        </>}
      </main>
    </div>

    {showTaskForm && <Modal title={editingTask ? `Edit ${editingTask.publicId}` : "Add a task"} onClose={() => setShowTaskForm(false)}><form onSubmit={saveTask} className="space-y-4"><label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">Task title *</span><input autoFocus maxLength={240} required value={taskForm.title} onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })} placeholder="What needs to get done?" className="field-input"/></label><div className="grid grid-cols-2 gap-4"><label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">Category</span><select disabled={!!editingTask} value={taskForm.categoryId} onChange={(event) => setTaskForm({ ...taskForm, categoryId: Number(event.target.value), projectId: "" })} className="field-input">{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">Project</span><select value={taskForm.projectId} onChange={(event) => setTaskForm({ ...taskForm, projectId: event.target.value })} className="field-input"><option value="">None</option>{projects.filter((project) => project.status === "Active" && (!project.categoryId || project.categoryId === taskForm.categoryId)).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></div><div className="grid grid-cols-2 gap-4"><label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">Priority</span><select value={taskForm.priority} onChange={(event) => setTaskForm({ ...taskForm, priority: event.target.value })} className="field-input">{PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label><label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">Status</span><select value={taskForm.status} onChange={(event) => setTaskForm({ ...taskForm, status: event.target.value })} className="field-input">{STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label></div><label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">Due date</span><input type="date" value={taskForm.dueDate} onChange={(event) => setTaskForm({ ...taskForm, dueDate: event.target.value })} className="field-input"/></label><label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">Description</span><textarea rows={3} maxLength={20000} value={taskForm.description} onChange={(event) => setTaskForm({ ...taskForm, description: event.target.value })} placeholder="Optional details, context or next steps…" className="field-input resize-y"/></label><div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setShowTaskForm(false)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600">Cancel</button><button disabled={busy} className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy && <LoaderCircle size={15} className="animate-spin"/>}{editingTask ? "Save changes" : "Create task"}</button></div></form></Modal>}

    {showProjectForm && <Modal title="New project" onClose={() => setShowProjectForm(false)}><form onSubmit={async (event) => { event.preventDefault(); if (await mutate("project.create", { name: projectName, categoryId: projectCategory ? Number(projectCategory) : null, description: projectDescription }, "Project created.")) { setProjectName(""); setProjectCategory(""); setProjectDescription(""); setShowProjectForm(false); } }} className="space-y-4"><label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">Project name *</span><input required maxLength={140} autoFocus value={projectName} onChange={(event) => setProjectName(event.target.value)} className="field-input" placeholder="e.g. Kova roadmap"/></label><label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">Category</span><select value={projectCategory} onChange={(event) => setProjectCategory(event.target.value)} className="field-input"><option value="">Both</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">Description</span><textarea rows={3} value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} className="field-input" placeholder="What is this project for?"/></label><div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setShowProjectForm(false)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold">Cancel</button><button disabled={busy} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white">Create project</button></div></form></Modal>}

    {selectedTask && <div className="fixed inset-0 z-40 bg-slate-950/35" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedTask(null); }}><aside role="dialog" aria-modal="true" aria-label={`Details for ${selectedTask.publicId}`} className="absolute inset-y-0 right-0 w-full max-w-[520px] overflow-y-auto bg-white shadow-2xl"><div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-7 py-5"><span className="text-xs font-bold uppercase tracking-[.13em] text-blue-600">Task Details · {selectedTask.publicId}</span><button aria-label="Close details" onClick={() => setSelectedTask(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={19}/></button></div><div className="px-7 py-7"><div className="mb-3 flex flex-wrap gap-2"><Badge label={categoryName(selectedTask.categoryId)}/><Badge label={selectedTask.priority} kind="priority"/><Badge label={selectedTask.status} kind="status"/></div><h2 className="text-[23px] font-bold leading-snug tracking-tight text-slate-900">{selectedTask.title}</h2><p className="mt-3 text-sm leading-6 text-slate-600">{selectedTask.description || "No description yet."}</p><div className="mt-6 grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4"><div><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Due date</div><div className={`mt-1 text-sm font-semibold ${isOverdue(selectedTask) ? "text-rose-600" : "text-slate-700"}`}>{formatDate(selectedTask.dueDate)}</div></div><div><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Project</div><div className="mt-1 text-sm font-semibold text-slate-700">{projectNameFor(selectedTask.projectId) || "None"}</div></div><div><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Created</div><div className="mt-1 text-sm font-semibold text-slate-700">{formatMoment(selectedTask.createdAt)}</div></div><div><div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Completed</div><div className="mt-1 text-sm font-semibold text-slate-700">{selectedTask.completedAt ? formatMoment(selectedTask.completedAt) : "—"}</div></div></div><div className="mt-5 flex flex-wrap gap-2"><button onClick={() => { openEdit(selectedTask); setSelectedTask(null); }} className="rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-bold text-white">Edit task</button><button disabled={busy} onClick={() => mutate("task.update", { id: selectedTask.id, status: selectedTask.status === "Complete" ? "Open" : "Complete" })} className="rounded-lg border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700">{selectedTask.status === "Complete" ? "Reopen" : "Mark complete"}</button><button disabled={busy} onClick={async () => { if (confirm(`Remove ${selectedTask.publicId}? It will be hidden, not permanently erased.`)) { if (await mutate("task.delete", { id: selectedTask.id }, "Task removed.")) setSelectedTask(null); } }} className="ml-auto rounded-lg border border-rose-100 px-3 py-2.5 text-rose-600 hover:bg-rose-50" title="Remove task"><Trash2 size={16}/></button></div>
        <section className="mt-9"><div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-bold">Notes</h3><span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-500">{notes.filter((item) => item.taskId === selectedTask.id).length}</span></div><div className="space-y-3">{notes.filter((item) => item.taskId === selectedTask.id).map((note) => <div key={note.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"><p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{note.body}</p><div className="mt-3 flex items-center justify-between"><span className="text-[11px] text-slate-400">{formatMoment(note.createdAt)}</span><button disabled={busy} onClick={() => { if (confirm("Remove this note?")) mutate("note.delete", { id: note.id }); }} className="text-[11px] font-semibold text-slate-400 hover:text-rose-600">Remove</button></div></div>)}{!notes.some((note) => note.taskId === selectedTask.id) && <p className="py-3 text-xs italic text-slate-400">No notes added yet.</p>}</div><form className="mt-4" onSubmit={async (event) => { event.preventDefault(); if (await mutate("note.add", { taskId: selectedTask.id, body: noteDraft }, "Note added.")) setNoteDraft(""); }}><textarea required maxLength={10000} rows={3} placeholder="Capture a follow-up, decision, or detail…" className="field-input" value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)}/><button disabled={busy || !noteDraft.trim()} className="mt-2 flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"><Plus size={14}/> Add note</button></form></section>
        <section className="mt-10"><h3 className="mb-4 text-sm font-bold">Change history</h3><div className="relative space-y-5 border-l border-slate-200 pl-5">{history.filter((item) => item.taskId === selectedTask.id).slice().reverse().map((item) => <div key={item.id} className="relative"><span className="absolute -left-[25px] top-1 h-2 w-2 rounded-full bg-blue-400 ring-4 ring-white"/><div className="text-xs font-semibold text-slate-700">{item.action}{item.field ? ` ${prettyField(item.field).toLowerCase()}` : ""}</div>{item.action === "Updated" && <div className="mt-1 break-words text-xs text-slate-500">{item.oldValue || "None"} → {item.newValue || "None"}</div>}<div className="mt-1 text-[11px] text-slate-400">{formatMoment(item.createdAt)}</div></div>)}</div></section>
      </div></aside></div>}

    {importPreview && <Modal title="Review CSV import" onClose={() => setImportPreview(null)}><div className="space-y-4"><div className="rounded-xl bg-blue-50 p-4 text-sm leading-6 text-blue-800">Ready to import <strong>{importPreview.length} task{importPreview.length === 1 ? "" : "s"}</strong>. IDs in the file will be preserved when provided. Existing task IDs cannot be imported twice.</div><div className="max-h-[260px] overflow-auto rounded-lg border border-slate-200">{importPreview.slice(0,25).map((item, idx) => <div key={idx} className="flex gap-2 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0"><span className="w-12 shrink-0 font-bold text-slate-400">{String(item.publicId || "New")}</span><span className="truncate text-slate-700">{String(item.title)}</span></div>)}</div><p className="text-xs leading-5 text-slate-500">Make a backup before large imports. Imports add new tasks and do not overwrite existing records.</p><div className="flex justify-end gap-2"><button onClick={() => setImportPreview(null)} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold">Cancel</button><button disabled={busy} onClick={async () => { if (await mutate("tasks.import", { items: importPreview }, `${importPreview.length} tasks imported.`)) setImportPreview(null); }} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white">Import tasks</button></div></div></Modal>}
  </div>;
}
