import nextEnv from "@next/env";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

nextEnv.loadEnvConfig(process.cwd(), false);

const secrets = Object.entries(process.env).filter(([name, value]) =>
  !name.startsWith("NEXT_PUBLIC_") && /(?:SERVICE_ROLE_KEY|API_KEY|SECRET_KEY|INITIAL_PASSWORD)$/.test(name) && value?.length >= 8);
let checked = 0;
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (/\.(?:js|map|json|html|css)$/.test(entry.name)) {
      const content = await readFile(path, "utf8");
      checked++;
      for (const [name, value] of secrets) {
        if (content.includes(value)) throw new Error(`Private credential ${name} found in browser output. Rotate it and remove the exposure.`);
      }
    }
  }
}
await scan(".next/static");
console.log(`Checked ${checked} browser assets against ${secrets.length} configured private credentials. No matching values found.`);
