import { readdirSync, readFileSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import type { AstroIntegration } from "astro";
import { defineConfig } from "astro/config";
import rehypeExternalLinks from "rehype-external-links";

// Walk every emitted entry script, follow its static imports one level deep,
// and inject <link rel="modulepreload"> tags for them. Eliminates the
// HTML → entry → vendor (e.g. numpy-ts/core trig chunk) request waterfall.
function preloadStaticImports(): AstroIntegration {
  return {
    name: "preload-static-imports",
    hooks: {
      "astro:build:done": async ({ dir }) => {
        const outDir = fileURLToPath(dir);
        const astroDir = `${outDir}/_astro`;
        const importRe = /import\s*(?:[\s\S]*?from\s*)?["']\.\/([\w.-]+\.js)["']/g;

        const chunkImports = new Map<string, string[]>();
        for (const name of await readdir(astroDir)) {
          if (!name.endsWith(".js")) continue;
          const src = await readFile(`${astroDir}/${name}`, "utf8");
          const deps = new Set<string>();
          for (const m of src.matchAll(importRe)) deps.add(m[1]);
          chunkImports.set(name, [...deps]);
        }

        async function walk(d: string) {
          for (const entry of await readdir(d, { withFileTypes: true })) {
            const p = `${d}/${entry.name}`;
            if (entry.isDirectory()) await walk(p);
            else if (entry.name.endsWith(".html")) await rewrite(p);
          }
        }

        async function rewrite(file: string) {
          const html = await readFile(file, "utf8");
          const entries = [...html.matchAll(/<script type="module" src="\/_astro\/([^"]+)"/g)].map(
            (m) => m[1],
          );
          if (!entries.length) return;
          const preloads = new Set<string>();
          for (const entry of entries) {
            for (const dep of chunkImports.get(entry) ?? []) preloads.add(dep);
          }
          if (!preloads.size) return;
          const tags = [...preloads]
            .map((d) => `<link rel="modulepreload" href="/_astro/${d}">`)
            .join("");
          await writeFile(file, html.replace("</head>", `${tags}</head>`));
        }

        await walk(outDir);
      },
    },
  };
}

// @astrojs/sitemap emits bare <loc> entries. Google only honors <lastmod> when
// it's consistently accurate
function postLastmods() {
  const dir = new URL("./src/content/blog/", import.meta.url);
  const dates = new Map<string, string>();

  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".mdx")) continue;
    const frontmatter = readFileSync(new URL(name, dir), "utf8").split(/^---$/m)[1] ?? "";
    const raw = (
      frontmatter.match(/^updatedDate:\s*(.+)$/m)?.[1] ??
      frontmatter.match(/^pubDate:\s*(.+)$/m)?.[1]
    )
      ?.trim()
      .replace(/^["']|["']$/g, "");
    if (!raw) continue;
    const date = new Date(raw);
    if (Number.isNaN(date.valueOf())) continue;
    dates.set(name.replace(/\.mdx$/, ""), date.toISOString());
  }

  return dates;
}

const lastmods = postLastmods();

// Astro hardcodes the client target to "esnext", shipping raw `using` Safari can't parse.
// ES-year targets only — browser targets like "safari16" skip the transform.
function clientBuildTarget(target: string) {
  return {
    name: "client-build-target",
    configEnvironment(name: string) {
      if (name === "client") return { build: { target } };
    },
  };
}

export default defineConfig({
  site: "https://nico.codes",
  integrations: [
    mdx(),
    sitemap({
      serialize(item) {
        const slug = new URL(item.url).pathname.match(/^\/notes\/([^/]+)\/?$/)?.[1];
        const lastmod = slug ? lastmods.get(slug) : undefined;
        return lastmod ? { ...item, lastmod } : item;
      },
    }),
    preloadStaticImports(),
  ],
  markdown: {
    rehypePlugins: [
      () => rehypeExternalLinks({ target: "_blank", rel: ["noopener", "noreferrer"] }),
    ],
  },
  vite: {
    plugins: [tailwindcss(), clientBuildTarget("es2022")],
    server: {
      hmr: {
        protocol: "ws",
      },
    },
    build: {
      target: "es2022",
    },
    esbuild: {
      target: "es2022",
    },
  },
});
