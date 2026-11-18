import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { styles } from "../src/styles";

// The S3 artifact and the local Hono route share this one stylesheet source.
const client = fileURLToPath(new URL("../dist/client/", import.meta.url));
await mkdir(client, { recursive: true });
await writeFile(`${client}/styles.css`, styles);
