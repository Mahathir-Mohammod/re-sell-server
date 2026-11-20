import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env, isProd } from "./config/env.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import routes from "./routes/index.js";
import { webhook } from "./controllers/paymentController.js";

const app = express();

// Render/Railway sit behind a proxy; trust it so rate limiting and req.ip are correct.
app.set("trust proxy", 1);

app.use(helmet());
app.use(cors({ origin: [env.CLIENT_URL] }));
app.use(morgan(isProd ? "combined" : "dev"));

// Stripe signs the raw request bytes, so this route must be parsed before express.json.
// Mounting it first is what keeps signature verification working.
app.post("/api/payments/webhook", express.raw({ type: "application/json" }), webhook);

app.use(express.json({ limit: "12mb" })); // base64 image uploads go through JSON

app.use("/api", apiLimiter, routes);

app.use(notFound);
app.use(errorHandler);

export default app;