# nico.codes — architecture

## Overview

Personal site and blog. Static, deployed on Cloudflare Pages, auto-deployed from GitHub on push to `main`.

## Stack 

| Layer | Choice |
|---|---|
| Framework | Astro 5 |
| Content | MDX via `@astrojs/mdx` + Astro Content Collections |
| Styling | Tailwind CSS |
| Syntax highlighting | Shiki (Astro native) |
| OG images | Satori (build-time) |
| Hosting | Cloudflare Pages |
| Source control | GitHub |

## Site structure

```
src/
  content/
    blog/
      config.ts         # Zod frontmatter schema
      *.mdx             # Blog posts
  components/
    FlowField.ts        # Canvas hero — vanilla TS, no framework
    Header.astro
    Footer.astro
  layouts/
    Base.astro
    BlogPost.astro
  pages/
    index.astro         # Homepage — canvas hero + nav
    about.astro
    blog/
      index.astro       # Post list — pinned + chronological
      [slug].astro      # Individual post
    rss.xml.ts
public/
  social/               # Generated OG images (build-time)
scripts/
  generate-og.ts        # Satori OG generation script
```

## Routing

| File | Route |
|---|---|
| `pages/index.astro` | `/` |
| `pages/about.astro` | `/about` |
| `pages/blog/index.astro` | `/blog` |
| `pages/blog/[slug].astro` | `/blog/[slug]` |

## Content model

```mdx
---
title: "Post title"
description: "Short summary"
pubDate: 2026-04-13
updatedDate: 2026-04-13   # optional
tags: ["typescript", "wasm"]
pinned: false
draft: false
ogImage: "/social/post-slug.png"
---
```

The `pinned` field drives the blog index — pinned posts appear in a fixed list at the top, remaining posts in reverse chronological order below.

## OG image generation

OG images are generated at build time using Satori directly. The generation script runs as part of the build, reads the content collection, renders each post's title and description into a shared template, and writes static PNGs to `public/social/`.

```ts
// scripts/generate-og.ts
import satori from 'satori';
import { writeFileSync } from 'fs';

for (const post of posts) {
  const svg = await satori(OGTemplate({ title: post.data.title }), {
    width: 1200,
    height: 630,
    fonts: [...],
  });
  // convert SVG → PNG via resvg-js
  writeFileSync(`public/social/${post.slug}.png`, png);
}
```

The homepage gets a single static OG image with no dynamic text.

## Blog index

Two sections rendered from the same content collection, filtered by `pinned`:

1. Pinned posts — small fixed list at top, manually curated via frontmatter
2. Recent posts — all non-pinned posts, reverse chronological

## JavaScript strategy

- The canvas hero is vanilla TypeScript, mounted on a `<canvas>` via a plain `<script>` tag — no framework, no hydration
- Everything else is `.astro` components — no client JS
- No React islands needed for v1

## Deployment

Cloudflare Pages, connected to GitHub. Every push to `main` triggers a build.

```
Build command:  npm run build
Output dir:     dist/
```

```json
{
  "scripts": {
    "dev": "astro dev",
    "build": "npm run og && astro build",
    "og": "tsx scripts/generate-og.ts",
    "preview": "astro preview"
  }
}
```

## Non-goals (v1)

- SSR
- CMS
- Comments
- Search
- Analytics
- User accounts