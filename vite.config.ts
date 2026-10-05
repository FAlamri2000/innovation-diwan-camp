import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";

export default defineConfig(({ command }) => ({
  server: { port: 8080, host: "127.0.0.1" },
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // src/server.ts wraps the generated entry (error page + the scheduler).
      server: { entry: "server" },
    }),
    // A self-contained Node server at .output/server/index.mjs.
    command === "build" ? nitro({ preset: "node-server" }) : null,
    viteReact(),
  ],
}));
