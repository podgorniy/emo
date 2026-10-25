// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * An on-screen keyboard for headless Chromium (ui.md §4.5,
 * Reach v2): `window.visualViewport` becomes a fake the test moves. It
 * mirrors the window (innerWidth, innerHeight, no offset, scale 1) until a
 * value is set; `showKeyboard` shrinks its height as a keyboard would, and
 * `lib/viewport.ts` (which reads `visualViewport` when the page starts)
 * writes --kb and data-kb from it. Install it before the page loads.
 */
import type { BrowserContext, Page } from "playwright-core";

/** What a test may set; unset values mirror the window */
export interface FakeViewport {
  width?: number;
  height?: number;
  /** A keyboard's height: `height` follows the window, this much shorter */
  keyboard?: number;
  offsetTop?: number;
  offsetLeft?: number;
  scale?: number;
}

/** The page's handle on the fake */
interface Handle {
  /** Sets values (`undefined` mirrors the window again), then fires resize and scroll */
  set(patch: FakeViewport): void;
  /** Everything mirrors the window again, then fires resize and scroll */
  reset(): void;
}

const HANDLE = "__emoViewport";

/** Runs in the page, before its scripts */
function stub(handle: string) {
  const set: FakeViewport = {};
  class FakeVisualViewport extends EventTarget {
    onresize: ((e: Event) => void) | null = null;
    onscroll: ((e: Event) => void) | null = null;
    onscrollend: ((e: Event) => void) | null = null;
    get width() {
      return set.width ?? innerWidth;
    }
    get height() {
      return set.height ?? innerHeight - (set.keyboard ?? 0);
    }
    get offsetTop() {
      return set.offsetTop ?? 0;
    }
    get offsetLeft() {
      return set.offsetLeft ?? 0;
    }
    get pageTop() {
      return scrollY + this.offsetTop;
    }
    get pageLeft() {
      return scrollX + this.offsetLeft;
    }
    get scale() {
      return set.scale ?? 1;
    }
    fire() {
      for (const type of ["resize", "scroll"] as const) {
        const e = new Event(type);
        this.dispatchEvent(e);
        if (type === "resize") this.onresize?.(e);
        else this.onscroll?.(e);
      }
    }
  }
  const fake = new FakeVisualViewport();
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    get: () => fake,
  });
  // The real one resizes with the window
  addEventListener("resize", () => {
    const e = new Event("resize");
    fake.dispatchEvent(e);
    fake.onresize?.(e);
  });
  const h: Handle = {
    set(patch) {
      Object.assign(set, patch);
      fake.fire();
    },
    reset() {
      for (const key of Object.keys(set)) delete set[key as keyof FakeViewport];
      fake.fire();
    },
  };
  Object.defineProperty(window, handle, { value: h });
}

/** Installs the fake for every page of `target` (or the next loads of a page) */
export async function installKeyboardStub(
  target: BrowserContext | Page,
): Promise<void> {
  await (target as Page).addInitScript(stub, HANDLE);
}

/** Two frames: the viewport watch applies a change on the next one */
function frames(page: Page): Promise<void> {
  return page.evaluate(() =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
  );
}

/** Sets the fake's values (zoom, an iOS offset), then waits two frames */
export async function setViewport(
  page: Page,
  patch: FakeViewport,
): Promise<void> {
  await page.evaluate(([handle, patch]) => {
    (window as unknown as Record<string, Handle>)[handle].set(patch);
  }, [HANDLE, patch] as const);
  await frames(page);
}

/**
 * A `px` high keyboard comes up: the visual viewport is that much shorter
 * than the window, also once the window is resized (`offsetTop`: how far
 * iOS has moved it up to show a low field, 0 by default)
 */
export async function showKeyboard(
  page: Page,
  px: number,
  { offsetTop = 0 }: { offsetTop?: number } = {},
): Promise<void> {
  await setViewport(page, { height: undefined, keyboard: px, offsetTop });
}

/** The keyboard goes: the fake mirrors the window again */
export async function hideKeyboard(page: Page): Promise<void> {
  await page.evaluate((handle) => {
    (window as unknown as Record<string, Handle>)[handle].reset();
  }, HANDLE);
  await frames(page);
}
