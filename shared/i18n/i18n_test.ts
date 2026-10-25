// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertEquals } from "@std/assert";
import { MESSAGE_KEYS } from "./keys.ts";
import { uiEn } from "./ui.en.ts";
import { uiRu } from "./ui.ru.ts";
import { uiUk } from "./ui.uk.ts";
import { PLURAL_BASES, t, tPlural } from "./format.ts";
import { findForbiddenWord } from "./forbidden.ts";
import { WORD_CONFIDENCE } from "../dictionaries.ts";

Deno.test("i18n - all keys translated in en, ru, and uk", () => {
  assertEquals(MESSAGE_KEYS.length > 300, true);

  // copy.md §2.1: the push has no body text, on purpose
  const intentionallyEmpty = new Set(["push.body"]);
  for (const key of MESSAGE_KEYS) {
    assertEquals(typeof uiEn[key], "string", `Missing en for key ${key}`);
    assertEquals(typeof uiRu[key], "string", `Missing ru for key ${key}`);
    assertEquals(typeof uiUk[key], "string", `Missing uk for key ${key}`);
    if (intentionallyEmpty.has(key)) {
      assertEquals([uiEn[key], uiRu[key], uiUk[key]], ["", "", ""], key);
      continue;
    }
    // copy.md §4: an editorial heading may have no `pre` or `post`
    if (/\.editorial\.(pre|post)$/.test(key)) continue;
    assertEquals(uiEn[key].length > 0, true, `Empty en for key ${key}`);
    assertEquals(uiRu[key].length > 0, true, `Empty ru for key ${key}`);
    assertEquals(uiUk[key].length > 0, true, `Empty uk for key ${key}`);
  }
});

Deno.test("i18n - no forbidden words in any translation", () => {
  for (const key of MESSAGE_KEYS) {
    for (
      const [lang, text] of [["en", uiEn[key]], ["ru", uiRu[key]], [
        "uk",
        uiUk[key],
      ]] as const
    ) {
      const match = findForbiddenWord(text);
      assertEquals(
        match,
        null,
        `Forbidden word "${match}" found in ${lang} key "${key}": "${text}"`,
      );
    }
  }
});

Deno.test("i18n - parameter substitution", () => {
  const rendered = t("en", "checkin.stepLabel", { n: 3 });
  assertEquals(rendered, "Step 3 of 9");
});

Deno.test("i18n - undo keys exist", () => {
  assertEquals(uiEn["checkin.saved.undo"], "Undo");
  assertEquals(uiRu["checkin.saved.undo"], "Отменить");
  assertEquals(uiUk["checkin.saved.undo"], "Скасувати");
});

Deno.test("i18n - plural keys: every form in every language (copy.md §5)", () => {
  for (const base of PLURAL_BASES) {
    for (const locale of ["en", "ru", "uk"] as const) {
      for (const n of [1, 2, 5, 11, 21, 22, 25, 101]) {
        const text = tPlural(locale, base, n, { list: "⟨list⟩" });
        assertEquals(text.length > 0, true, `${base} ${locale} ${n}`);
        assertEquals(
          text.includes("{"),
          false,
          `${base} ${locale} ${n}: ${text}`,
        );
        if (n !== 1 || locale !== "en") {
          assertEquals(
            text.includes(String(n)),
            true,
            `${base} ${locale} ${n}: ${text}`,
          );
        }
      }
    }
  }
  assertEquals(
    tPlural("ru", "settings.devices.signOut.discard", 1),
    "Удалить 1 несинхронизированную запись",
  );
  assertEquals(
    tPlural("ru", "settings.devices.signOut.discard", 3),
    "Удалить 3 несинхронизированные записи",
  );
  assertEquals(
    tPlural("ru", "settings.devices.signOut.discard", 5),
    "Удалить 5 несинхронизированных записей",
  );
  assertEquals(
    tPlural("uk", "auth.notifications.body", 21).includes("21 раз на день"),
    true,
  );
  assertEquals(
    tPlural("en", "settings.devices.signOut.discard", 2),
    "Discard 2 unsynced check-ins",
  );
  // No count in the step-2 summary (2026-10-09): a plain key
  assertEquals(
    t("ru", "checkin.step.2.summary.chosen", { list: "ком" }),
    "Выбрано: ком",
  );
});

Deno.test("i18n - editorial headings rebuild the plain title in every language", () => {
  for (
    const [locale, messages] of Object.entries({ en: uiEn, ru: uiRu, uk: uiUk })
  ) {
    for (let n = 1; n <= 10; n++) {
      const k = `checkin.step.${n}.title` as const;
      const m = messages as Record<string, string>;
      assertEquals(
        m[`${k}.editorial.pre`] + m[`${k}.editorial.em`] +
          m[`${k}.editorial.post`],
        m[k],
        `${locale} step ${n}`,
      );
    }
  }
});

Deno.test("i18n - the certainty buttons show the dictionary's labels", () => {
  // Export labels come from the dictionary, the buttons from ui.*.ts
  const ui = { en: uiEn, ru: uiRu, uk: uiUk } as const;
  for (const item of WORD_CONFIDENCE) {
    for (const locale of ["en", "ru", "uk"] as const) {
      assertEquals(
        ui[locale][`checkin.step.6.confidence.${item.key}`],
        item.label[locale],
        `${locale} ${item.key}`,
      );
    }
  }
});
