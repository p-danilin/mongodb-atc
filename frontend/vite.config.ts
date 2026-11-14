/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@contract": path.resolve(__dirname, "../docs/contract") } },
  server: { fs: { allow: [".."] }, host: true },
  test: { environment: "node" },
});
