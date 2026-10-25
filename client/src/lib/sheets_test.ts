// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * lib/sheets.ts against a small history that behaves like a browser's:
 * pushState and replaceState at once, back/go later, then popstate. The
 * person's Back closes the top sheet; a sheet that closes by itself takes
 * its entry away without App seeing a pop; orphans are stepped over. Stacked
 * sheets know their depth and which one is on top.
 */
import { assert, assertEquals } from "@std/assert";
import {
  closeTopSheet,
  dropStale,
  handlePopstate,
  hasOpenSheet,
  isSheetEntry,
  openSheet,
  settled,
  unwindAll,
} from "./sheets.ts";

class FakeHistory {
  entries: unknown[];
  index = 0;
  /** Every traversal asked for (back = −1) */
  gos: number[] = [];
  /** The pops App would have handled: handlePopstate said false */
  appPops: unknown[] = [];

  constructor(state: unknown) {
    this.entries = [state];
  }
  get state(): unknown {
    return this.entries[this.index];
  }
  get length(): number {
    return this.entries.length;
  }
  pushState(state: unknown, _unused: string) {
    this.entries.splice(this.index + 1, Infinity, structuredClone(state));
    this.index++;
  }
  replaceState(state: unknown, _unused: string) {
    this.entries[this.index] = structuredClone(state);
  }
  back() {
    this.go(-1);
  }
  forward() {
    this.go(1);
  }
  /** As in a browser: the state changes later, then popstate */
  go(delta: number) {
    this.gos.push(delta);
    setTimeout(() => {
      const next = Math.max(
        0,
        Math.min(this.entries.length - 1, this.index + delta),
      );
      if (next === this.index) return;
      this.index = next;
      if (!handlePopstate(new Event("popstate") as PopStateEvent)) {
        this.appPops.push(this.state);
      }
    }, 0);
  }
  /** The person's Back: not counted with the traversals asked for here */
  userBack() {
    this.go(-1);
    this.gos.pop();
  }
  userForward() {
    this.go(1);
    this.gos.pop();
  }
}

const PANE = { emo: "settings" };

function install(): FakeHistory {
  const fake = new FakeHistory(PANE);
  Object.defineProperty(globalThis, "history", {
    value: fake,
    configurable: true,
    writable: true,
  });
  return fake;
}

/** Long enough for every queued traversal and the ones they start */
const pops = () => new Promise((resolve) => setTimeout(resolve, 20));

/** A sheet that counts how often Back closed it, and hears its new depths */
function sheet() {
  const s = {
    closed: 0,
    depths: [] as number[],
    handle: openSheet(() => void s.closed++, (d) => void s.depths.push(d)),
  };
  return s;
}

Deno.test("sheets - an entry on the same state, App's marker kept", async () => {
  const h = install();
  const a = sheet();
  assertEquals(h.length, 2);
  assertEquals(h.state, { emo: "settings", sheet: a.handle.token, depth: 1 });
  assert(isSheetEntry(h.state));
  assert(!isSheetEntry(PANE));
  assert(!isSheetEntry(null));
  assert(hasOpenSheet());
  a.handle.release();
  await settled();
  assert(!hasOpenSheet());
});

Deno.test("sheets - the person's Back closes the open sheet; App sees no pop", async () => {
  const h = install();
  const a = sheet();
  h.userBack();
  await pops();
  assertEquals(a.closed, 1);
  assert(!hasOpenSheet());
  assertEquals(h.index, 0);
  assertEquals(h.appPops, []);
  // The sheet then goes away and releases: nothing more is popped
  a.handle.release();
  await settled();
  assertEquals(h.gos, []);
  assertEquals(h.index, 0);
});

Deno.test("sheets - a sheet closed by its button pops its own entry, not read as Back", async () => {
  const h = install();
  const a = sheet();
  a.handle.release();
  a.handle.release(); // idempotent
  await settled();
  assertEquals(a.closed, 0);
  assertEquals(h.gos, [-1]);
  assertEquals(h.index, 0);
  assertEquals(h.appPops, []);
  assertEquals(h.state, PANE);

  // Forward onto the entry it left: an orphan, stepped over
  h.userForward();
  await pops();
  assertEquals(h.index, 0);
  assertEquals(h.appPops, []);
  await settled();
});

Deno.test("sheets - nested: Back closes the top one, then the one under it", async () => {
  const h = install();
  const a = sheet();
  const b = sheet();
  assertEquals((h.state as { depth: number }).depth, 2);
  h.userBack();
  await pops();
  assertEquals([a.closed, b.closed], [0, 1]);
  assert(hasOpenSheet());
  assertEquals(h.state, { emo: "settings", sheet: a.handle.token, depth: 1 });
  b.handle.release(); // its destroy: nothing to pop
  await pops();
  assertEquals(h.gos, []);

  h.userBack();
  await pops();
  assertEquals([a.closed, b.closed], [1, 1]);
  assert(!hasOpenSheet());
  a.handle.release();
  await settled();
  assertEquals(h.index, 0);
  assertEquals(h.appPops, []);
});

Deno.test("sheets - nested sheets closed by their buttons in one go pop both entries", async () => {
  const h = install();
  const a = sheet();
  const b = sheet();
  b.handle.release();
  a.handle.release();
  await settled();
  assertEquals(h.index, 0);
  assertEquals(h.state, PANE);
  assertEquals(h.appPops, []);
  assertEquals([a.closed, b.closed], [0, 0]);
});

Deno.test("sheets - unwindAll closes both sheets, top first, with one go(-2)", async () => {
  const h = install();
  const order: string[] = [];
  const a = openSheet(() => void order.push("a"));
  const b = openSheet(() => void order.push("b"));
  await unwindAll();
  assertEquals(order, ["b", "a"]);
  assertEquals(h.gos, [-2]);
  assertEquals(h.index, 0);
  assertEquals(h.state, PANE);
  assertEquals(h.appPops, []);
  assert(!hasOpenSheet());
  // Their destroy afterwards pops nothing
  b.release();
  a.release();
  await pops();
  assertEquals(h.gos, [-2]);
  // Nothing open: it resolves at once
  await unwindAll();
  assertEquals(h.gos, [-2]);
});

Deno.test("sheets - released while not on top: forgotten, its entry stepped over later", async () => {
  const h = install();
  const a = sheet();
  const b = sheet();
  // A is destroyed under B (its parent went): B's entry is on top
  a.handle.release();
  await pops();
  assertEquals(h.gos, []);
  assertEquals(h.index, 2);
  // Back closes B and lands on A's orphan, which is skipped
  h.userBack();
  await pops();
  assertEquals(b.closed, 1);
  assertEquals(a.closed, 0);
  assertEquals(h.index, 0);
  assertEquals(h.state, PANE);
  assertEquals(h.appPops, []);
  b.handle.release();
  await settled();
});

Deno.test("sheets - a sheet that is busy stays open on Back, with a new entry", async () => {
  const h = install();
  let busy = true;
  let closed = 0;
  const a = openSheet(() => {
    if (busy) return false;
    closed++;
  });
  const first = a.token;
  h.userBack();
  await pops();
  assertEquals(closed, 0);
  assert(hasOpenSheet());
  assert(a.token !== first);
  assertEquals(h.state, { emo: "settings", sheet: a.token, depth: 1 });
  busy = false;
  h.userBack();
  await pops();
  assertEquals(closed, 1);
  assert(!hasOpenSheet());
  a.release();
  await settled();
  assertEquals(h.appPops, []);
});

Deno.test("sheets - a sheet opened while a pop is on its way gets its entry after it", async () => {
  const h = install();
  const a = sheet();
  a.handle.release();
  const b = sheet(); // the pop of A has not landed yet
  assertEquals(h.length, 2);
  await pops();
  assertEquals(h.index, 1);
  assertEquals(h.state, { emo: "settings", sheet: b.handle.token, depth: 1 });
  h.userBack();
  await pops();
  assertEquals(b.closed, 1);
  b.handle.release();
  await settled();
  assertEquals(h.index, 0);
  assertEquals(h.appPops, []);
});

Deno.test("sheets - closeTopSheet closes the top one and resolves once its entry is popped", async () => {
  const h = install();
  const a = sheet();
  const b = sheet();
  let done = false;
  const closing = closeTopSheet().then(() => (done = true));
  assertEquals(b.closed, 1);
  assertEquals(a.closed, 0);
  assertEquals(done, false); // its pop has not landed yet
  await closing;
  assertEquals(h.index, 1);
  assertEquals(h.state, { emo: "settings", sheet: a.handle.token, depth: 1 });
  assertEquals(h.gos, [-1]);
  assertEquals(h.appPops, []);
  assertEquals(a.handle.top, true);
  // The sheet then goes away and releases: nothing more is popped
  b.handle.release();
  await closeTopSheet();
  assertEquals(a.closed, 1);
  a.handle.release();
  await settled();
  assertEquals(h.gos, [-1, -1]);
  assertEquals(h.index, 0);
  assertEquals(h.appPops, []);
  await closeTopSheet(); // none open: at once
  assertEquals(h.gos, [-1, -1]);
});

Deno.test("sheets - closeTopSheet: a busy sheet stays; one whose entry waits is not popped", async () => {
  const h = install();
  const busy = openSheet(() => false);
  await closeTopSheet();
  assert(hasOpenSheet());
  assertEquals(h.gos, []);
  busy.release();
  await settled();

  // Opened while a pop of ours is on its way: no entry of its own yet
  const a = sheet();
  a.handle.release();
  const b = sheet();
  await closeTopSheet();
  assertEquals(b.closed, 1);
  assert(!hasOpenSheet());
  await settled();
  assertEquals(h.index, 0);
  assertEquals(h.gos, [-1, -1]);
  assertEquals(h.appPops, []);
});

Deno.test("sheets - with no sheet, a pop is App's", async () => {
  const h = install();
  h.pushState({ emo: "history" }, "");
  h.userBack();
  await pops();
  assertEquals(h.appPops, [PANE]);
  await settled();
});

Deno.test("sheets - a sheet entry kept over a reload is the pane's again", async () => {
  const h = install();
  h.replaceState({ emo: "settings", sheet: "0ld0ld00:3", depth: 1 }, "");
  await settled();
  assertEquals(h.state, PANE);
  assertEquals(h.gos, []);
});

Deno.test("sheets - at start, a sheet entry from before a reload is popped, not left under the next view", async () => {
  const h = install();
  h.pushState({ emo: "settings", sheet: "0ld0ld00:3", depth: 1 }, "");
  assert(dropStale());
  await settled();
  // Back on the pane's own entry: App writes the next view over it, and
  // nothing reopens the pane later
  assertEquals(h.index, 0);
  assertEquals(h.state, PANE);
  assertEquals(h.gos, [-1]);
  assertEquals(h.appPops, []);
  assert(!dropStale());
});

Deno.test("sheets - at start, stacked stale sheet entries go in one, an orphan among them stepped over", async () => {
  const h = install();
  // Two open (depths 1 and 2), the bottom one released (an orphan), a
  // third opened at depth 2: three entries, the top one says 2
  h.pushState({ emo: "settings", sheet: "0ld0ld00:1", depth: 1 }, "");
  h.pushState({ emo: "settings", sheet: "0ld0ld00:2", depth: 2 }, "");
  h.pushState({ emo: "settings", sheet: "0ld0ld00:3", depth: 2 }, "");
  assert(dropStale());
  await settled();
  assertEquals(h.index, 0);
  assertEquals(h.gos, [-2, -1]);
  assertEquals(h.appPops, []);
});

Deno.test("sheets - at start, nothing to drop: a pane entry, or a sheet of this load", async () => {
  const h = install();
  assert(!dropStale());
  const a = sheet();
  assert(!dropStale());
  assertEquals(h.gos, []);
  a.handle.release();
  await settled();
});

Deno.test("sheets - depth: nested sheets stack, the last one opened on top", async () => {
  install();
  const a = sheet();
  assertEquals([a.handle.depth, a.handle.top], [1, true]);
  const b = sheet();
  assertEquals([a.handle.depth, a.handle.top], [1, false]);
  assertEquals([b.handle.depth, b.handle.top], [2, true]);
  // The top one closes: the one under it is on top again
  b.handle.release();
  assertEquals([b.handle.depth, b.handle.top], [0, false]);
  assertEquals([a.handle.depth, a.handle.top], [1, true]);
  // A new one takes the depth that was given up
  const c = sheet();
  assertEquals([c.handle.depth, c.handle.top], [2, true]);
  assert(!a.handle.top);
  // Nothing under them moved: no depth was told
  assertEquals([a.depths, b.depths, c.depths], [[], [], []]);
  c.handle.release();
  a.handle.release();
  await settled();
  assert(!hasOpenSheet());
});

Deno.test("sheets - depth: a sheet under another goes; the one above is told it went down", async () => {
  const h = install();
  const a = sheet();
  const b = sheet();
  const c = sheet();
  b.handle.release(); // its parent went, under C
  assertEquals([a.handle.depth, b.handle.depth, c.handle.depth], [1, 0, 2]);
  assertEquals(c.depths, [2]);
  assertEquals([a.depths, b.depths], [[], []]);
  assert(c.handle.top);
  // A new sheet goes over C, never level with it
  const d = sheet();
  assertEquals([c.handle.depth, d.handle.depth], [2, 3]);
  assert(d.handle.top && !c.handle.top);
  d.handle.release();
  await pops();
  // Back closes C, steps over B's orphan, then A is on top
  h.userBack();
  await pops();
  assertEquals(c.closed, 1);
  assertEquals([a.handle.depth, c.handle.depth], [1, 0]);
  assert(a.handle.top);
  c.handle.release();
  a.handle.release();
  await settled();
  assert(!hasOpenSheet());
  assertEquals(h.appPops, []);
});

Deno.test("sheets - depth: Back closes only the top one; unwindAll closes all", async () => {
  const h = install();
  const a = sheet();
  const b = sheet();
  h.userBack();
  await pops();
  assertEquals([a.closed, b.closed], [0, 1]);
  assertEquals([a.handle.depth, b.handle.depth], [1, 0]);
  assert(a.handle.top && !b.handle.top);
  b.handle.release();
  const c = sheet();
  assertEquals(c.handle.depth, 2);
  await unwindAll();
  assertEquals([a.closed, c.closed], [1, 1]);
  assertEquals([a.handle.depth, c.handle.depth], [0, 0]);
  assert(!a.handle.top && !c.handle.top);
  assertEquals([a.depths, c.depths], [[], []]);
  a.handle.release();
  c.handle.release();
  await settled();
  assertEquals(h.appPops, []);
});

Deno.test("sheets - depth: a busy sheet kept on Back stays on top at its depth", async () => {
  const h = install();
  const a = sheet();
  let busy = true;
  const depths: number[] = [];
  const b = openSheet(
    () => (busy ? false : undefined),
    (d) => void depths.push(d),
  );
  h.userBack();
  await pops();
  assertEquals([a.handle.depth, b.depth], [1, 2]);
  assert(b.top);
  assertEquals(depths, []);
  busy = false;
  b.release();
  a.handle.release();
  await settled();
  assertEquals(h.appPops, []);
});
