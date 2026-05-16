import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://nico.codes",
  integrations: [mdx(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
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
