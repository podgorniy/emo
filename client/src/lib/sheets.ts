// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Sheets and the browser's Back (ui.md §2.2): every open sheet
 * has a history entry of its own on the same URL, so a system Back closes
 * the top sheet instead of leaving the pane, and a sheet that closes by
 * itself (a button, Esc, the backdrop) takes its entry away again. An entry
 * copies the state under it, so App's `emo` marker stays, and adds `sheet`
 * (a token) and `depth`.
 *
 * Every traversal started here (a release, an unwind, a skip) is counted,
 * and the popstate it causes is consumed here, so App never reads it as the
 * person's Back. An orphan is a sheet entry with no open sheet: one released
 * while another sheet stood on it, or one reached by Forward. A pop that
 * lands on one steps over it. App calls `handlePopstate` first, and awaits
 * `settled()` or `unwindAll()` before it pushes, backs or replaces for a
 * view change.
 *
 * Stacked sheets: each knows its depth (1 = the bottom one) and whether it
 * is on top; a sheet lifts itself by its depth (ConfirmSheet's z-index), and
 * only the top one takes Esc, a backdrop tap and Tab (ui.md §2.2).
 */

export interface SheetHandle {
  /** The token of the sheet's entry (a new one if it is pushed again) */
  readonly token: string;
  /** Its place among the open sheets, 1 = the bottom one; 0 once closed */
  readonly depth: number;
  /** It is the top open sheet: the one Esc, the backdrop and Tab are for */
  readonly top: boolean;
  /**
   * The sheet closes by itself (or is destroyed): its entry goes when it is
   * on top; otherwise it is forgotten, and skipped once a pop lands on it.
   * Idempotent; nothing after Back or `unwindAll` closed it.
   */
  release(): void;
}

/** Closes the sheet on Back; `false` keeps it open (busy), with a new entry */
type Close = () => void | boolean;

/** Told the sheet's new depth when one under it goes */
type OnDepth = (depth: number) => void;

interface Open {
  token: string;
  close: Close;
  onDepth?: OnDepth;
  /** The depth last given out */
  depth: number;
  /** Its entry is in the history; not yet while a traversal of ours runs */
  pushed: boolean;
  /** The path it was opened on */
  path: string;
}

/** This page load; a sheet entry from an earlier one (a reload) is stale */
const LOAD = crypto.randomUUID().slice(0, 8);
/** A popstate that never comes stops holding App up after this long */
const POP_TIMEOUT_MS = 1500;

let seq = 0;
/** The open sheets, bottom first */
const open: Open[] = [];
/** Traversals started here whose popstate has not come yet */
let expected = 0;
let watchdog: ReturnType<typeof setTimeout> | undefined;
let waiters: { ready: () => boolean; resolve: () => void }[] = [];

const hist = () => globalThis.history;

function here(): string {
  try {
    return globalThis.location.pathname;
  } catch {
    return ""; // No location (a test)
  }
}

export function isSheetEntry(state: unknown): boolean {
  return typeof state === "object" && state !== null &&
    typeof (state as { sheet?: unknown }).sheet === "string";
}

const sheetOf = (state: unknown): string | null =>
  isSheetEntry(state) ? (state as { sheet: string }).sheet : null;

/** Push order in this load; 0 for a pane entry or a stale sheet entry */
function order(token: string | null): number {
  if (!token) return 0;
  const [load, n] = token.split(":");
  return load === LOAD ? Number(n) || 0 : 0;
}

/** The state under the entries: without `sheet` and `depth` */
function plain(state: unknown): Record<string, unknown> {
  if (typeof state !== "object" || state === null) return {};
  const { sheet: _sheet, depth: _depth, ...rest } = state as Record<
    string,
    unknown
  >;
  return rest;
}

function push(o: Open) {
  const state = hist().state;
  o.token = `${LOAD}:${++seq}`;
  o.pushed = true;
  hist().pushState(
    {
      ...(typeof state === "object" && state !== null ? state : {}),
      sheet: o.token,
      depth: open.indexOf(o) + 1,
    },
    "",
  );
}

/** The entries of sheets opened (or kept) while a traversal of ours ran */
function flush() {
  if (expected > 0) return;
  for (const o of open) if (!o.pushed) push(o);
}

/** The open sheets told their depths again, after one left the stack */
function restack() {
  open.forEach((o, i) => {
    if (o.depth === i + 1) return;
    o.depth = i + 1;
    o.onDepth?.(o.depth);
  });
}

function back(n = 1) {
  expected++;
  clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    // The browser dropped it: nothing waits for it any longer
    watchdog = undefined;
    expected = 0;
    flush();
    notify();
  }, POP_TIMEOUT_MS);
  if (n === 1) hist().back();
  else hist().go(-n);
}

function notify() {
  if (expected === 0 && watchdog !== undefined) {
    clearTimeout(watchdog);
    watchdog = undefined;
  }
  const waiting = waiters;
  waiters = [];
  for (const w of waiting) {
    if (w.ready()) w.resolve();
    else waiters.push(w);
  }
}

function until(ready: () => boolean): Promise<void> {
  if (ready()) return Promise.resolve();
  return new Promise((resolve) => waiters.push({ ready, resolve }));
}

/**
 * Nothing open, nothing on its way, yet a sheet entry on top: one from
 * before a reload. It becomes the pane's entry again, so nothing waits on it.
 */
function tidy() {
  const state = hist().state;
  if (open.length === 0 && expected === 0 && isSheetEntry(state)) {
    hist().replaceState(plain(state), "");
  }
}

/**
 * At start: a sheet entry from before a reload (or a restored tab) is on
 * top. Its sheet is gone, and the view's entry is under it (and under any
 * sheet entries below it): Back over them, counted as ours, so the next view
 * is written on the view's entry and no later Back lands on a dead entry or
 * reopens the pane. True when it went; App then awaits `settled()` before
 * it writes history. (`tidy` replacing the entry would leave the view's
 * entry under it: one Back too many, onto the pane again.)
 */
export function dropStale(): boolean {
  const state = hist().state;
  const token = sheetOf(state);
  if (open.length > 0 || expected > 0 || !token || order(token) > 0) {
    return false;
  }
  // Its depth counts the sheet entries down to the view's; an orphan among
  // them is stepped over when the pop lands on it (`handlePopstate`)
  const depth = Number((state as { depth?: unknown }).depth);
  back(Number.isInteger(depth) && depth > 0 ? depth : 1);
  return true;
}

/**
 * A sheet opens on top: it gets its entry and is closed by the person's
 * Back. `onDepth` hears of each later change of its depth while it is open.
 */
export function openSheet(close: Close, onDepth?: OnDepth): SheetHandle {
  tidy();
  const o: Open = {
    token: "",
    close,
    onDepth,
    depth: open.length + 1,
    pushed: false,
    path: here(),
  };
  open.push(o);
  flush();
  return {
    get token() {
      return o.token;
    },
    get depth() {
      return open.indexOf(o) + 1;
    },
    get top() {
      return open[open.length - 1] === o;
    },
    release() {
      const i = open.indexOf(o);
      if (i < 0) return;
      open.splice(i, 1);
      if (o.pushed && expected === 0 && sheetOf(hist().state) === o.token) {
        back();
      }
      restack();
      notify();
    },
  };
}

export function hasOpenSheet(): boolean {
  return open.length > 0;
}

/**
 * App's popstate handler calls this first and stops when it returns true.
 * A pop started here is consumed; the person's Back closes the sheets whose
 * entries it left, top first; a pop onto an orphan steps over it. False:
 * App's own pop (a pane), or Back went past the sheets to another path.
 */
export function handlePopstate(_e?: PopStateEvent): boolean {
  const ours = expected > 0;
  if (ours) expected--;
  const at = sheetOf(hist().state);
  // The sheets whose entries this traversal left behind, top first
  const left = open.filter((o) => o.pushed && order(o.token) > order(at))
    .reverse();
  // Back went past them to another path: App changes the view
  const moved = left.some((o) => o.path !== here());
  const kept: Open[] = [];
  for (const o of left) {
    open.splice(open.indexOf(o), 1);
    if (o.close() === false && !moved) kept.unshift(o);
  }
  // A sheet that stays (busy) gets a new entry on top
  for (const o of kept) {
    o.pushed = false;
    open.push(o);
  }
  restack();
  const orphan = at !== null && !open.some((o) => o.pushed && o.token === at);
  if (orphan) back();
  else flush();
  notify();
  return ours || orphan || (left.length > 0 && !moved);
}

/**
 * Closes the top open sheet, as the person's Back would, and pops its
 * entry; resolves once that pop has landed (so the caller may write history
 * then). A sheet that would rather stay (busy) stays, with its entry. With
 * none open, or its entry not on top (its push is still waiting behind a
 * pop of ours), nothing is popped for it.
 */
export async function closeTopSheet(): Promise<void> {
  const o = open[open.length - 1];
  if (!o) return;
  if (o.close() === false) return;
  // Unless closing it already released it
  const i = open.indexOf(o);
  if (i >= 0) {
    open.splice(i, 1);
    if (o.pushed && expected === 0 && sheetOf(hist().state) === o.token) {
      back();
    }
    restack();
    notify();
  }
  await until(() => expected === 0);
}

/**
 * Closes every open sheet (top first) and pops their entries with one
 * `history.go(-n)`; resolves once that has landed and history is settled.
 */
export async function unwindAll(): Promise<void> {
  const all = open.splice(0).reverse();
  // The view goes: a sheet that would rather stay is not asked
  for (const o of all) o.close();
  await until(() => expected === 0);
  const at = order(sheetOf(hist().state));
  const n =
    all.filter((o) => o.pushed && order(o.token) > 0 && order(o.token) <= at)
      .length;
  if (n > 0) back(n);
  await settled();
}

/** Resolves when no pop of ours is pending and no sheet entry is on top */
export function settled(): Promise<void> {
  tidy();
  return until(() => expected === 0 && !isSheetEntry(hist().state));
}
