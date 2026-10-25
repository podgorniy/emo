// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "node:path";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import {
  brotliCompressSync,
  constants as zlibConstants,
  gzipSync,
} from "node:zlib";
import { FONT_MANIFEST, fontFileName, SUBSETS } from "../shared/theme/fonts.ts";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The `make dev` server (Makefile DEV_PORT, DEV_BASE_URL): its own port, never
// `make up`'s 8080
const devServer = `http://localhost:${process.env.EMO_DEV_PORT ?? "8081"}`;
const devOrigin = new URL(process.env.EMO_DEV_BASE_URL ?? devServer).origin;
// development.md §7.1: the repository's VERSION file is the single source
const VERSION = readFileSync(path.resolve(__dirname, "../VERSION"), "utf8")
  .trim();

/**
 * The icon URLs in the manifest and in index.html carry a hash of the file
 * (`/icon-192.png?v=1a2b3c4d`): a new icon changes the manifest itself, so
 * the browser's update check of an installed app sees it, and no cache can
 * answer for the new icon with the old one (ui.md §16.2).
 */
function versionIcons(dist: string) {
  const versioned = (url: string) => {
    if (!/^\/[\w.-]+\.(png|svg|ico)$/.test(url)) return url;
    const bytes = readFileSync(path.join(dist, url.slice(1)));
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
    return `${url}?v=${hash}`;
  };
  const manifestFile = path.join(dist, "manifest.webmanifest");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
    icons?: { src: string }[];
    shortcuts?: { icons?: { src: string }[] }[];
  };
  const icons = [
    ...(manifest.icons ?? []),
    ...(manifest.shortcuts ?? []).flatMap((s) => s.icons ?? []),
  ];
  for (const icon of icons) icon.src = versioned(icon.src);
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
  const indexFile = path.join(dist, "index.html");
  writeFileSync(
    indexFile,
    readFileSync(indexFile, "utf8").replace(
      /(<link rel="(?:icon|apple-touch-icon)"[^>]*? href=")([^"]+)"/g,
      (_, head: string, url: string) => `${head}${versioned(url)}"`,
    ),
  );
}

/**
 * Builds `dist/sw.js` from `src/sw.js` after the bundle is written: the
 * precache list is every file of the build (fonts are cached on use), and the
 * cache name carries a hash of their contents, so an unchanged build gives a
 * byte-identical worker (reliability.md §3 "Build").
 */
function emoServiceWorker(): Plugin {
  return {
    name: "emo-service-worker",
    apply: "build",
    closeBundle() {
      const dist = path.resolve(__dirname, "dist");
      // First: the hash and the compressed copies below take the result
      versionIcons(dist);
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = path.join(dir, name);
          const rel = path.relative(dist, full).split(path.sep).join("/");
          if (statSync(full).isDirectory()) {
            if (rel !== ".vite" && rel !== "fonts") walk(full);
          } else if (rel !== "sw.js" && rel !== "source.tar.gz") {
            // The source archive (tools/pack_source.ts) is for download only
            files.push(rel);
          }
        }
      };
      walk(dist);
      files.sort();
      const hash = createHash("sha256");
      for (const rel of files) {
        hash.update(rel);
        hash.update(readFileSync(path.join(dist, rel)));
      }
      // performance.md §2.1: the default theme's fonts are precached;
      // the others are cached when a theme first uses them
      const fonts = FONT_MANIFEST.calm.flatMap((f) =>
        SUBSETS.map((subset) => `fonts/${fontFileName(f, subset)}`)
      );
      for (const rel of fonts) {
        hash.update(rel);
        hash.update(readFileSync(path.join(dist, rel)));
      }
      const build = hash.digest("hex").slice(0, 16);
      // Every font file of the build, by name and bytes
      const fontHash = createHash("sha256");
      const fontDir = path.join(dist, "fonts");
      const fontWalk = (dir: string) => {
        for (const name of readdirSync(dir).sort()) {
          const full = path.join(dir, name);
          if (statSync(full).isDirectory()) fontWalk(full);
          else {
            fontHash.update(path.relative(fontDir, full));
            fontHash.update(readFileSync(full));
          }
        }
      };
      fontWalk(fontDir);
      const precache = [...files, ...fonts].map((rel) => `/${rel}`);
      const source = readFileSync(path.resolve(__dirname, "src/sw.js"), "utf8")
        .replace('"__EMO_BUILD__"', JSON.stringify(build))
        .replace(
          '"__EMO_FONTS__"',
          JSON.stringify(`emo-fonts-${fontHash.digest("hex").slice(0, 12)}`),
        )
        .replace("__EMO_PRECACHE__", JSON.stringify(precache));
      writeFileSync(path.join(dist, "sw.js"), source);

      // performance.md §4.4: brotli and gzip siblings of every
      // compressible file, served by the server when the browser accepts them
      const compressible = /\.(js|css|html|svg|json|webmanifest|txt|wasm)$/;
      const squeeze = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = path.join(dir, name);
          if (statSync(full).isDirectory()) {
            if (name !== ".vite" && name !== "fonts") squeeze(full);
          } else if (compressible.test(name) && statSync(full).size > 1024) {
            const bytes = readFileSync(full);
            writeFileSync(
              `${full}.br`,
              brotliCompressSync(bytes, {
                params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
              }),
            );
            writeFileSync(`${full}.gz`, gzipSync(bytes, { level: 9 }));
          }
        }
      };
      squeeze(dist);
    },
  };
}

export default defineConfig({
  plugins: [svelte(), emoServiceWorker()],
  // The KDF worker loads hash-wasm on demand, which needs ES module output
  worker: { format: "es" },
  define: {
    __EMO_VERSION__: JSON.stringify(VERSION),
  },
  root: __dirname,
  resolve: {
    alias: {
      $shared: path.resolve(__dirname, "../shared"),
      $lib: path.resolve(__dirname, "./src/lib"),
    },
  },
  // `make dev`: HMR on :5173 against the Deno server. The server's CSRF
  // check wants its own origin, so the proxy presents it.
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: devServer,
        configure: (proxy) => {
          proxy.on("proxyReq", (req) => {
            if (req.getHeader("origin")) {
              req.setHeader("origin", devOrigin);
            }
          });
        },
      },
      "/healthz": devServer,
    },
  },
  build: {
    outDir: path.resolve(__dirname, "./dist"),
    emptyOutDir: true,
    // perf/check_budget.ts reads it (performance.md §5)
    manifest: true,
    target: "es2022",
  },
});
