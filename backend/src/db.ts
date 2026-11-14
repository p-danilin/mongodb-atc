import { MongoClient, type Collection, type Db } from "mongodb";
import { config } from "./config";

/** Every document uses a string `_id`. Dates are stored as Date and sent as ISO strings (see `wire`). */
export interface Doc { _id: string; [key: string]: any }

export const COLLECTIONS = ["nodes", "edges", "zones", "identities", "vehicles", "policies", "actions", "ledger", "runs"] as const;
export type CollectionName = (typeof COLLECTIONS)[number];

export interface Database {
  client: MongoClient;
  db: Db;
  col: Record<CollectionName, Collection<Doc>>;
}

export async function connect(): Promise<Database> {
  const client = new MongoClient(config.mongoUri, { appName: "ground-control-brain", serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  const db = client.db(config.dbName);
  const col = Object.fromEntries(COLLECTIONS.map((n) => [n, db.collection<Doc>(n)])) as Database["col"];
  return { client, db, col };
}

/** Mongo document -> wire shape: every Date becomes an ISO string. */
export function wire<T = any>(value: unknown): T {
  if (value instanceof Date) return value.toISOString() as T;
  if (Array.isArray(value)) return value.map((v) => wire(v)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wire(v)])) as T;
  return value as T;
}
