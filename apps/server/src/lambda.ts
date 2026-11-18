import { handle, streamHandle } from "@hono/aws-lambda";
import { app } from "./app";

// Node Lambda uses the same request-time Hono renderer as the existing Bun listener.
export const handler = streamHandle(app);
export const bufferedHandler = handle(app);
