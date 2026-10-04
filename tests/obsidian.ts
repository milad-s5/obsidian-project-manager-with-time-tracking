// A test double for the "obsidian" module.
//
// The real module only exists inside the app, so the tests bundle this file in
// its place. It is not a full reimplementation: it models what the plugin
// leans on — files with frontmatter, a metadata cache that catches up a tick
// after each write, link-updating renames — closely enough that the managers
// behave here the way they do in a vault.

/* eslint-disable @typescript-eslint/no-explicit-any */

export function normalizePath(p: string): string {
  return String(p ?? "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "")
    .replace(/ | /g, " ")
    .normalize("NFC");
}

// ── Events ──────────────────────────────────────────────────────────────

export interface EventRef { name: string; fn: (...args: any[]) => any; owner: Events }

export class Events {
  private handlers = new Map<string, EventRef[]>();
  on(name: string, fn: (...args: any[]) => any): EventRef {
    const ref = { name, fn, owner: this };
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), ref]);
    return ref;
  }
  off(name: string, fn: (...args: any[]) => any): void {
    this.handlers.set(name, (this.handlers.get(name) ?? []).filter((r) => r.fn !== fn));
  }
  offref(ref: EventRef): void {
    this.handlers.set(ref.name, (this.handlers.get(ref.name) ?? []).filter((r) => r !== ref));
  }
  trigger(name: string, ...args: any[]): void {
    for (const r of [...(this.handlers.get(name) ?? [])]) r.fn(...args);
  }
  tryTrigger(ref: EventRef, args: any[]): void { ref.fn(...args); }
}

// ── Files ───────────────────────────────────────────────────────────────

export class TAbstractFile {
  path = "";
  name = "";
  parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
  basename = "";
  extension = "";
  stat = { ctime: Date.now(), mtime: Date.now(), size: 0 };
  constructor(path: string) {
    super();
    this.setPath(path);
  }
  setPath(path: string): void {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
    const dot = this.name.lastIndexOf(".");
    this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
    this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  constructor(path: string) {
    super();
    this.path = path;
    this.name = path.split("/").pop() ?? path;
  }
  isRoot(): boolean { return this.path === ""; }
}

// ── A tiny YAML subset: flat maps of scalars and string lists ───────────

function parseScalar(raw: string): any {
  const v = raw.trim();
  if (v === "" || v === "~" || v === "null") return null;
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    try { return JSON.parse(v); } catch { return v.slice(1, -1); }
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'");
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return splitFlow(inner).map(parseScalar);
  }
  return v;
}

function splitFlow(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let depth = 0;
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function parseYaml(text: string): any {
  const out: Record<string, any> = {};
  let listKey: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = line.match(/^\s*-\s+(.*)$|^\s*-$/);
    if (item && listKey) {
      if (!Array.isArray(out[listKey])) out[listKey] = [];
      out[listKey].push(parseScalar(item[1] ?? ""));
      continue;
    }
    const kv = line.match(/^([^:\s][^:]*):(?:\s+(.*))?\s*$/);
    if (!kv) continue;
    const key = kv[1].trim();
    const rest = kv[2] ?? "";
    // An empty value is null, unless list items follow on the next lines
    listKey = rest.trim() === "" ? key : null;
    out[key] = rest.trim() === "" ? null : parseScalar(rest);
  }
  return out;
}

function needsQuotes(s: string): boolean {
  if (s === "") return true;
  if (/^[\s]|[\s]$/.test(s)) return true;
  if (/^[[\]{}"'*&!|>%@`#,?:-]/.test(s)) return true;
  if (/: |\s#/.test(s)) return true;
  if (/^(true|false|null|~|-?\d+(\.\d+)?)$/i.test(s)) return true;
  return false;
}

function emitScalar(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v);
  return needsQuotes(s) ? JSON.stringify(s) : s;
}

export function stringifyYaml(obj: any): string {
  let out = "";
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (Array.isArray(v)) {
      if (!v.length) { out += `${k}: []\n`; continue; }
      out += `${k}:\n`;
      for (const item of v) out += `  - ${emitScalar(item)}\n`;
    } else {
      const s = emitScalar(v);
      out += s === "" ? `${k}:\n` : `${k}: ${s}\n`;
    }
  }
  return out;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;

function splitFrontmatter(content: string): { fm: Record<string, any> | null; body: string } {
  const m = content.match(FM_RE);
  if (!m) return { fm: null, body: content };
  return { fm: parseYaml(m[1]), body: content.slice(m[0].length) };
}

// ── The app ─────────────────────────────────────────────────────────────

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export interface MockOptions {
  /** Artificial latency on every disk operation, in ms — races need it */
  latency?: number;
}

export class MockApp {
  vault: MockVault;
  metadataCache: MockMetadataCache;
  fileManager: MockFileManager;
  workspace: any;
  constructor(opts: MockOptions = {}) {
    this.vault = new MockVault(this, opts.latency ?? 0);
    this.metadataCache = new MockMetadataCache(this);
    this.fileManager = new MockFileManager(this);
    this.workspace = new MockWorkspace();
  }
}

class MockWorkspace extends Events {
  layoutReady = true;
  activeFile: TFile | null = null;
  getActiveFile(): TFile | null { return this.activeFile; }
  getLeavesOfType(): any[] { return []; }
  onLayoutReady(fn: () => void): void { fn(); }
  getLeaf(): any { return { openFile: async () => {}, setViewState: async () => {} }; }
  revealLeaf(): Promise<void> { return Promise.resolve(); }
}

export class MockVault extends Events {
  private files = new Map<string, TFile>();
  private folders = new Map<string, TFolder>();
  private contents = new Map<TFile, string>();
  adapter: any;
  constructor(private app: MockApp, private latency: number) {
    super();
    const root = new TFolder("");
    this.folders.set("", root);
    this.adapter = {
      exists: async (p: string) => this.files.has(p) || this.folders.has(p),
      stat: async (p: string) => {
        const f = this.files.get(p);
        return f ? { type: "file", ...f.stat } : this.folders.has(p) ? { type: "folder" } : null;
      },
      read: async (p: string) => this.contents.get(this.files.get(p)!) ?? "",
      write: async (p: string, data: string) => {
        const f = this.files.get(p);
        if (f) await this.modify(f, data);
        else await this.create(p, data);
      },
    };
  }

  private async io(): Promise<void> {
    if (this.latency) await tick(this.latency);
    else await Promise.resolve();
  }

  getName(): string { return "test-vault"; }
  getRoot(): TFolder { return this.folders.get("")!; }
  getAbstractFileByPath(p: string): TAbstractFile | null {
    return this.files.get(p) ?? this.folders.get(p) ?? null;
  }
  getFileByPath(p: string): TFile | null { return this.files.get(p) ?? null; }
  getFolderByPath(p: string): TFolder | null { return this.folders.get(p) ?? null; }
  getMarkdownFiles(): TFile[] { return [...this.files.values()].filter((f) => f.extension === "md"); }
  getFiles(): TFile[] { return [...this.files.values()]; }
  getAllLoadedFiles(): TAbstractFile[] { return [...this.folders.values(), ...this.files.values()]; }

  /** Synchronous seeding for test setup — no events, cache filled at once */
  seed(path: string, content: string): TFile {
    this.ensureParents(path);
    const f = new TFile(path);
    this.files.set(path, f);
    this.contents.set(f, content);
    this.attach(f);
    this.app.metadataCache.reindex(f, content, false);
    return f;
  }

  contentOf(f: TFile | string): string {
    const file = typeof f === "string" ? this.files.get(f) : f;
    return file ? this.contents.get(file) ?? "" : "";
  }

  private ensureParents(path: string): void {
    const parts = path.split("/");
    parts.pop();
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!this.folders.has(cur)) {
        const folder = new TFolder(cur);
        this.folders.set(cur, folder);
        const parentPath = cur.includes("/") ? cur.slice(0, cur.lastIndexOf("/")) : "";
        const parent = this.folders.get(parentPath)!;
        folder.parent = parent;
        parent.children.push(folder);
      }
    }
  }

  private attach(f: TFile): void {
    const parentPath = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
    const parent = this.folders.get(parentPath)!;
    f.parent = parent;
    if (!parent.children.includes(f)) parent.children.push(f);
  }

  private detach(f: TAbstractFile): void {
    if (f.parent) f.parent.children = f.parent.children.filter((c) => c !== f);
  }

  async create(path: string, content: string): Promise<TFile> {
    await this.io();
    path = normalizePath(path);
    if (this.files.has(path) || this.folders.has(path)) throw new Error("File already exists.");
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (!this.folders.has(parentPath)) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    const f = new TFile(path);
    f.stat = { ctime: Date.now(), mtime: Date.now(), size: content.length };
    this.files.set(path, f);
    this.contents.set(f, content);
    this.attach(f);
    this.trigger("create", f);
    this.app.metadataCache.reindex(f, content);
    return f;
  }

  async createFolder(path: string): Promise<TFolder> {
    await this.io();
    path = normalizePath(path);
    if (this.folders.has(path) || this.files.has(path)) throw new Error("Folder already exists.");
    this.ensureParents(`${path}/x`);
    return this.folders.get(path)!;
  }

  async read(f: TFile): Promise<string> { await this.io(); return this.contents.get(f) ?? ""; }
  async cachedRead(f: TFile): Promise<string> { return this.contents.get(f) ?? ""; }

  async modify(f: TFile, content: string): Promise<void> {
    await this.io();
    this.write(f, content);
  }

  /** The write itself, shared by modify and process */
  write(f: TFile, content: string): void {
    if (!this.files.has(f.path)) throw new Error("File does not exist.");
    this.contents.set(f, content);
    f.stat = { ...f.stat, mtime: Math.max(Date.now(), f.stat.mtime + 1), size: content.length };
    this.trigger("modify", f);
    this.app.metadataCache.reindex(f, content);
  }

  async process(f: TFile, fn: (data: string) => string): Promise<string> {
    await this.io();
    const next = fn(this.contents.get(f) ?? "");
    this.write(f, next);
    return next;
  }

  async delete(f: TAbstractFile): Promise<void> {
    await this.io();
    if (f instanceof TFile) {
      this.files.delete(f.path);
      this.contents.delete(f);
      this.detach(f);
      this.app.metadataCache.drop(f);
      this.trigger("delete", f);
    } else if (f instanceof TFolder) {
      for (const child of [...f.children]) await this.delete(child);
      this.folders.delete(f.path);
      this.detach(f);
      this.trigger("delete", f);
    }
  }

  async trash(f: TAbstractFile): Promise<void> { await this.delete(f); }

  async rename(f: TAbstractFile, newPath: string): Promise<void> {
    await this.io();
    newPath = normalizePath(newPath);
    if (this.files.has(newPath)) throw new Error("Destination file already exists!");
    if (!(f instanceof TFile)) throw new Error("folder rename not modelled");
    const oldPath = f.path;
    this.ensureParents(newPath);
    this.files.delete(oldPath);
    this.detach(f);
    f.setPath(newPath);
    this.files.set(newPath, f);
    this.attach(f);
    this.app.metadataCache.move(f, oldPath);
    this.trigger("rename", f, oldPath);
  }
}

export interface CachedMetadata { frontmatter?: Record<string, any>; tags?: { tag: string }[] }

export class MockMetadataCache extends Events {
  private cache = new Map<string, CachedMetadata>();
  /** How long after a write the cache catches up — 0 is "next tick" */
  delay = 0;
  constructor(private app: MockApp) { super(); }

  reindex(f: TFile, content: string, async = true): void {
    const apply = () => {
      if (this.app.vault.getAbstractFileByPath(f.path) !== f) return;
      const { fm } = splitFrontmatter(content);
      this.cache.set(f.path, fm ? { frontmatter: fm } : {});
      this.trigger("changed", f, content, this.cache.get(f.path));
      this.trigger("resolved");
    };
    if (async) setTimeout(apply, this.delay);
    else apply();
  }
  drop(f: TFile): void { this.cache.delete(f.path); this.trigger("deleted", f); }
  move(f: TFile, oldPath: string): void {
    const c = this.cache.get(oldPath);
    this.cache.delete(oldPath);
    if (c) this.cache.set(f.path, c);
  }
  getFileCache(f: TFile | null): CachedMetadata | null {
    if (!f) return null;
    return this.cache.get(f.path) ?? null;
  }
  getCache(path: string): CachedMetadata | null { return this.cache.get(path) ?? null; }
  getFirstLinkpathDest(linkpath: string, _source: string): TFile | null {
    const target = linkpath.replace(/\.md$/i, "");
    const files = this.app.vault.getMarkdownFiles();
    return (
      files.find((f) => f.path === `${target}.md`) ??
      files.find((f) => f.path.endsWith(`/${target}.md`)) ??
      files.find((f) => f.basename === target.split("/").pop()) ??
      null
    );
  }
  fileToLinktext(f: TFile): string { return f.basename; }
}

export class MockFileManager {
  constructor(private app: MockApp) {}

  async processFrontMatter(f: TFile, fn: (fm: any) => void): Promise<void> {
    await this.app.vault.process(f, (content) => {
      const { fm, body } = splitFrontmatter(content);
      const data = { ...(fm ?? {}) };
      fn(data);
      return `---\n${stringifyYaml(data)}---\n${fm ? body : content}`;
    });
  }

  /** Like Obsidian: moves the file and rewrites [[links]] whose target name changed */
  async renameFile(f: TAbstractFile, newPath: string): Promise<void> {
    if (!(f instanceof TFile)) throw new Error("folder rename not modelled");
    const oldBase = f.basename;
    await this.app.vault.rename(f, newPath);
    const newBase = (f as TFile).basename;
    if (oldBase === newBase) return;
    const re = new RegExp(`\\[\\[${oldBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\|[^\\]]*)?\\]\\]`, "g");
    for (const other of this.app.vault.getMarkdownFiles()) {
      const text = this.app.vault.contentOf(other);
      if (re.test(text)) {
        re.lastIndex = 0;
        this.app.vault.write(other, text.replace(re, (_m, alias) => `[[${newBase}${alias ?? ""}]]`));
      }
    }
  }

  async trashFile(f: TAbstractFile): Promise<void> { await this.app.vault.trash(f); }
  generateMarkdownLink(f: TFile): string { return `[[${f.basename}]]`; }
}

/** Waits until the metadata cache has caught up with every pending write */
export async function settle(ms = 5): Promise<void> {
  await tick(ms);
  await tick(ms);
}

// ── UI stand-ins: enough for modules to load; not driven by unit tests ──

export class Component {
  private cleanups: (() => void)[] = [];
  load(): void {}
  onload(): void {}
  unload(): void { this.cleanups.forEach((c) => c()); this.cleanups = []; }
  onunload(): void {}
  addChild<T extends Component>(c: T): T { return c; }
  removeChild<T extends Component>(c: T): T { return c; }
  register(cb: () => void): void { this.cleanups.push(cb); }
  registerEvent(_ref: EventRef): void {}
  registerDomEvent(el: any, type: string, cb: any): void { el?.addEventListener?.(type, cb); }
  registerInterval(id: number): number { this.cleanups.push(() => clearInterval(id)); return id; }
}

export class Plugin extends Component {
  app: any;
  manifest: any;
  private stored: any = null;
  constructor(app: any, manifest: any = { id: "project-manager-with-time-tracking", version: "0.0.0" }) {
    super();
    this.app = app;
    this.manifest = manifest;
  }
  async loadData(): Promise<any> { return this.stored; }
  async saveData(d: any): Promise<void> { this.stored = JSON.parse(JSON.stringify(d)); }
  addCommand(c: any): any { return c; }
  addRibbonIcon(): any { return { remove() {} }; }
  addStatusBarItem(): any { return null; }
  addSettingTab(): void {}
  registerView(): void {}
  registerObsidianProtocolHandler(): void {}
  registerMarkdownCodeBlockProcessor(): any { return null; }
  registerHoverLinkSource(): void {}
  registerEditorSuggest(): void {}
}

export class ItemView extends Component {
  app: any;
  leaf: any;
  containerEl: any;
  contentEl: any;
  constructor(leaf: any) { super(); this.leaf = leaf; this.app = leaf?.app; }
  addAction(): any { return null; }
}

export class Modal {
  app: any;
  contentEl: any = null;
  titleEl: any = null;
  modalEl: any = null;
  scope: any = { register() {} };
  constructor(app: any) { this.app = app; }
  open(): void {}
  close(): void {}
  setTitle(): this { return this; }
}

export class FuzzySuggestModal<T> extends Modal {
  setPlaceholder(): void {}
  getItems(): T[] { return []; }
  getItemText(_i: T): string { return ""; }
}

export class SuggestModal<T> extends Modal {
  setPlaceholder(): void {}
  getSuggestions(_q: string): T[] { return []; }
}

export class AbstractInputSuggest<T> {
  constructor(public app: any, public inputEl: any) {}
  setValue(): void {}
  close(): void {}
  onSelect(): this { return this; }
  getSuggestions(_q: string): T[] | Promise<T[]> { return []; }
}

export class PluginSettingTab {
  containerEl: any = null;
  constructor(public app: any, public plugin: any) {}
}

export class Setting { constructor(_el: any) {} }
export class Menu { addItem(): this { return this; } addSeparator(): this { return this; } showAtMouseEvent(): void {} showAtPosition(): void {} }
export class MarkdownRenderChild extends Component { constructor(public containerEl: any) { super(); } }
export class ButtonComponent {}
export class WorkspaceLeaf {}

export const Platform = { isMobile: false, isDesktop: true, isMobileApp: false, isDesktopApp: true, isIosApp: false, isAndroidApp: false };

export class Notice {
  static messages: string[] = [];
  noticeEl: any = null;
  constructor(message: string | any, _timeout?: number) {
    Notice.messages.push(typeof message === "string" ? message : String(message?.textContent ?? message));
  }
  setMessage(): this { return this; }
  hide(): void {}
}

export function setIcon(): void {}
export function addIcon(): void {}
export function getLanguage(): string { return "en"; }
export function debounce<T extends (...a: any[]) => any>(fn: T, wait = 0, _resetTimer = false): T & { cancel(): void; run(): void } {
  let t: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: any[] = [];
  const d: any = (...args: any[]) => {
    lastArgs = args;
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...lastArgs); }, wait);
  };
  d.cancel = () => { if (t) clearTimeout(t); t = null; };
  d.run = () => { if (t) { clearTimeout(t); t = null; fn(...lastArgs); } };
  return d;
}
export async function requestUrl(): Promise<any> { throw new Error("no network in tests"); }
