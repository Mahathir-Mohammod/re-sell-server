import app from "./app.js";
import { env } from "./config/env.js";
import { closeDB, connectDB } from "./config/db.js";

async function start() {
  try {
    await connectDB();
  } catch (err) {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1);
  }

  const server = app.listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = async (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
      await closeDB();
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start();