// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The source archive (AGPL §13): the allowlist keeps secrets, data and build
 * output out, and the system `tar` reads back exactly what was packed, long
 * paths included.
 */
import { assert, assertEquals } from "@std/assert";
import * as path from "node:path";
import { packSource, sourceFiles } from "./pack_source.ts";

Deno.test("pack source - the repository's files, never secrets, data or output", () => {
  const files = sourceFiles();
  for (
    const needed of [
      "LICENSE",
      "deno.lock",
      "Dockerfile",
      "server/main.ts",
      "client/src/App.svelte",
      "client/public/privacy.html",
      "client/public/methodology.html",
      "tools/pack_source.ts",
    ]
  ) {
    assert(files.includes(needed), needed);
  }
  for (const f of files) {
    assert(
      !/(^|\/)(\.env|node_modules|dist|report|data|data-dev|bin)(\/|$)/.test(
        f,
      ),
      f,
    );
    assert(!/\.sqlite/.test(f), f);
  }
  assertEquals(files.includes("plan.md"), false);
  assertEquals(files.includes("ideas.md"), false);
  assertEquals([...files].sort(), files);
});

Deno.test("pack source - tar reads back every file byte for byte, long paths too", async () => {
  const root = await Deno.makeTempDir({ prefix: "emo-pack-" });
  const out = await Deno.makeTempDir({ prefix: "emo-unpack-" });
  try {
    const deep = `server/${"d".repeat(60)}/${"e".repeat(60)}/file.ts`;
    const files = ["LICENSE", "server/main.ts", deep];
    const content = (f: string) => `// ${f}\n${"x".repeat(f.length * 7)}\n`;
    for (const f of files) {
      await Deno.mkdir(path.join(root, path.dirname(f)), { recursive: true });
      await Deno.writeTextFile(path.join(root, f), content(f));
    }
    const archive = await packSource(root, "emo-9.9.9", files);
    const tgz = path.join(out, "s.tar.gz");
    await Deno.writeFile(tgz, archive);
    const tar = await new Deno.Command("tar", {
      args: ["-xzf", tgz, "-C", out],
    })
      .output();
    assert(tar.success, new TextDecoder().decode(tar.stderr));
    for (const f of files) {
      assertEquals(
        await Deno.readTextFile(path.join(out, "emo-9.9.9", f)),
        content(f),
        f,
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(out, { recursive: true });
  }
});
