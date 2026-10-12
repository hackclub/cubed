import { cors } from "hono/cors";
import { config } from "../config.js";

// Explicit allowlist only — never '*', never a reflected-origin wildcard.
export const corsMiddleware = cors({
  origin: (origin) => (config.frontendOrigins.includes(origin) ? origin : undefined),
  credentials: true,
  allowHeaders: ["Content-Type", "X-Requested-With"],
  allowMethods: ["GET", "POST", "PATCH", "DELETE"],
});
