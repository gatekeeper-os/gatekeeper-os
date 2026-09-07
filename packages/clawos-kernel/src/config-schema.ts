import { readFileSync } from "node:fs";
export const schema = JSON.parse(readFileSync(new URL("../config.schema.json", import.meta.url), "utf8"));
