import path from "node:path";

/** Repo root: backend/src -> backend -> repo. */
export const ROOT = path.resolve(import.meta.dirname, "../..");

// Credentials live in the repo-level .env (gitignored). Real environment variables win.
try { process.loadEnvFile(path.join(ROOT, ".env")); } catch { /* no .env: rely on the environment */ }

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Copy .env.example to .env at the repo root and fill it in.`);
  return v;
}

export const config = {
  mongoUri: required("MONGODB_URI"),
  dbName: process.env.MONGODB_DB || "ground_control",
  /** The mock uses 4000; Brain defaults to 4100 so both can run side by side. */
  port: Number(process.env.PORT ?? 4100),
  /** Sim tick. The UI eases over about one tick. */
  tickMs: Number(process.env.TICK_MS ?? 500),
  /** Metres travelled per tick. */
  stepM: Number(process.env.STEP_M ?? 25),
};
