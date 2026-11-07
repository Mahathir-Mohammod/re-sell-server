import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env, isProd } from "./config/env.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import routes from "./routes/index.js";

const app = express();

// Render/Railway sit behind a proxy; trust it so rate limiting and req.ip are correct.
app.set("trust proxy", 1);

app.use(helmet());
app.use(cors({ origin: [env.CLIENT_URL] }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan(isProd ? "combined" : "dev"));

app.use("/api", apiLimiter, routes);

app.use(notFound);
app.use(errorHandler);

export default app;