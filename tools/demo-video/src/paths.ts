import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const at = (rel: string) => {
  const p = fileURLToPath(new URL(rel, import.meta.url));
  mkdirSync(p, { recursive: true });
  return p;
};
export const CACHE_DIR = at("../.cache/");
/** Final videos land in <repo>/demo-output. */
export const OUT_DIR = at("../../../demo-output/");
export const RAW_DIR = at("../../../demo-output/raw/");
export const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
