import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  integrations: [mdx()],
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
