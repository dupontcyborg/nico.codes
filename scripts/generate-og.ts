import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

const ROOT = new URL("..", import.meta.url).pathname;
const BLOG_DIR = join(ROOT, "src/content/blog");
const OUT_DIR = join(ROOT, "public/social");
const FONT_CACHE = join(ROOT, "node_modules/.cache/og-fonts");

const WIDTH = 1200;
const HEIGHT = 630;

type Post = {
  slug: string;
  title: string;
  description: string;
  pubDate: Date;
  draft: boolean;
};

function parseFrontmatter(raw: string): Record<string, string> {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    out[kv[1]] = v;
  }
  return out;
}

async function loadPosts(): Promise<Post[]> {
  const files = (await readdir(BLOG_DIR)).filter((f) => f.endsWith(".mdx"));
  const posts: Post[] = [];
  for (const f of files) {
    const raw = await readFile(join(BLOG_DIR, f), "utf8");
    const fm = parseFrontmatter(raw);
    if (fm.draft === "true") continue;
    posts.push({
      slug: basename(f, ".mdx"),
      title: fm.title ?? "",
      description: fm.description ?? "",
      pubDate: fm.pubDate ? new Date(fm.pubDate) : new Date(),
      draft: false,
    });
  }
  return posts;
}

async function fetchFont(family: string, weight: number): Promise<ArrayBuffer> {
  await mkdir(FONT_CACHE, { recursive: true });
  const cacheFile = join(FONT_CACHE, `${family}-${weight}.ttf`);
  if (existsSync(cacheFile)) {
    const buf = await readFile(cacheFile);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }
  const cssUrl = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}&display=swap`;
  const css = await fetch(cssUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
  }).then((r) => r.text());
  const urlMatch = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|woff2)'\)/);
  if (!urlMatch) throw new Error(`Could not find font URL for ${family} ${weight}`);
  const fontRes = await fetch(urlMatch[1]);
  const buf = Buffer.from(await fontRes.arrayBuffer());
  await writeFile(cacheFile, buf);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function formatDate(d: Date) {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function card(title: string, description: string, eyebrow: string) {
  return {
    type: "div",
    props: {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background: "rgb(5,6,7)",
        backgroundImage:
          "radial-gradient(circle at 85% 15%, rgba(120,140,180,0.18), transparent 55%), radial-gradient(circle at 10% 95%, rgba(80,90,120,0.12), transparent 50%)",
        color: "rgb(245,247,250)",
        fontFamily: "Inter",
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              fontSize: 22,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "rgba(245,247,250,0.5)",
              fontFamily: "JetBrains Mono",
            },
            children: eyebrow,
          },
        },
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", gap: 24 },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    fontSize: 64,
                    fontWeight: 600,
                    lineHeight: 1.1,
                    letterSpacing: "-0.02em",
                    color: "rgb(245,247,250)",
                  },
                  children: title,
                },
              },
              description && {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    fontSize: 28,
                    lineHeight: 1.4,
                    color: "rgba(245,247,250,0.6)",
                    maxWidth: 980,
                  },
                  children: description,
                },
              },
            ].filter(Boolean),
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 22,
              color: "rgba(245,247,250,0.55)",
              fontFamily: "JetBrains Mono",
            },
            children: [
              { type: "div", props: { style: { display: "flex" }, children: "nico.codes" } },
            ],
          },
        },
      ],
    },
  };
}

async function renderPng(node: any, fonts: any[], outPath: string) {
  const svg = await satori(node, { width: WIDTH, height: HEIGHT, fonts });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } }).render().asPng();
  await writeFile(outPath, png);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log("[og] loading fonts…");
  const [interRegular, interSemi, mono] = await Promise.all([
    fetchFont("Inter", 400),
    fetchFont("Inter", 600),
    fetchFont("JetBrains Mono", 400),
  ]);
  const fonts = [
    { name: "Inter", data: interRegular, weight: 400, style: "normal" as const },
    { name: "Inter", data: interSemi, weight: 600, style: "normal" as const },
    { name: "JetBrains Mono", data: mono, weight: 400, style: "normal" as const },
  ];

  const posts = await loadPosts();
  console.log(`[og] generating ${posts.length + 1} images…`);

  await renderPng(
    card("nico.codes", "Personal site and notes.", "nico.codes"),
    fonts,
    join(OUT_DIR, "og-default.png"),
  );

  for (const post of posts) {
    const node = card(post.title, post.description, formatDate(post.pubDate));
    await renderPng(node, fonts, join(OUT_DIR, `og-${post.slug}.png`));
    console.log(`[og]   og-${post.slug}.png`);
  }

  console.log("[og] done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
