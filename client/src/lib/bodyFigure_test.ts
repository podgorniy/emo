// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The body figure's zones and their hit targets (ui.md §7.2):
 * every dictionary zone but the two null answers (whole body, nowhere) is
 * drawn in a view and has targets there, each
 * zone's first target is ≥ 44 units tall (the 44 px rule at 1×), and no
 * later target covers its centre, where a tap or a click lands.
 */
import { assert, assertEquals } from "@std/assert";
import { BODY_ZONES } from "../../../shared/dictionaries.ts";
import { BANDS, HITS, type View, ZONE_ORDER } from "./bodyFigure.ts";

const VIEWS: View[] = ["front", "back"];

Deno.test("bodyFigure: every zone is drawn, listed and has targets in its views", () => {
  const drawn = new Set(VIEWS.flatMap((v) => Object.keys(BANDS[v])));
  const zones = BODY_ZONES.map((z) => z.key).filter((k) =>
    k !== "whole_body" && k !== "nowhere"
  );
  assertEquals([...drawn].sort(), zones.sort());
  assertEquals([...ZONE_ORDER].sort(), [...drawn].sort());
  for (const v of VIEWS) {
    assertEquals(
      HITS[v].map(([k]) => k).sort(),
      Object.keys(BANDS[v]).sort(),
      v,
    );
  }
});

Deno.test("bodyFigure: a zone's first target is ≥ 44 tall and nothing covers its centre", () => {
  for (const v of VIEWS) {
    HITS[v].forEach(([key, [[x, y, w, h]]], i) => {
      assert(h >= 44, `${v} ${key}: first target ${h} tall`);
      const cx = x + w / 2;
      const cy = y + h / 2;
      for (const [later, rects] of HITS[v].slice(i + 1)) {
        for (const [rx, ry, rw, rh] of rects) {
          assert(
            !(cx >= rx && cx < rx + rw && cy >= ry && cy < ry + rh),
            `${v} ${key}: centre covered by ${later}`,
          );
        }
      }
    });
  }
});
