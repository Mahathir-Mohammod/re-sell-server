import { MongoClient } from "mongodb";
import { env } from "./env.js";
import { createIndexes } from "../models/indexes.js";

// A single client for the whole process; the driver pools connections itself.
const client = new MongoClient(env.MONGODB_URI, { maxPoolSize: 10 });
let db;

export async function connectDB() {
  await client.connect();
  db = client.db();
  await db.command({ ping: 1 });
  await createIndexes(db);
  console.log(`MongoDB connected: ${db.databaseName}`);
}

export function getDb() {
  if (!db) throw new Error("Database not connected. Call connectDB() first.");
  return db;
}

export async function pingDB() {
  await client.db().command({ ping: 1 });
}

export async function closeDB() {
  await client.close();
}