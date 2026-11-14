/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@contract": path.resolve(__dirname, "../docs/contract"), "@": path.resolve(__dirname, "src") } },
  server: { fs: { allow: [".."] }, host: true },
  test: { environment: "node" },
});
