import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { config } from "../config.js";

const queryClient = postgres(config.databaseUrl);

export const db = drizzle(queryClient, { schema });

// Used only by index.ts's graceful-shutdown handler — drains the pool
// instead of letting in-flight queries get killed mid-connection-close.
export const closeDb = () => queryClient.end();
