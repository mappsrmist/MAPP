import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const logo = (file: string) =>
  `data:image/png;base64,${readFileSync(fileURLToPath(new URL(`../../../public/brand/${file}`, import.meta.url))).toString("base64")}`;

/** A 1920x1080 title card in the portal's own look (SRM + CTECH logos, primary green). */
export async function renderCard(title: string, subtitle: string, out: string): Promise<void> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;width:1920px;height:1080px;display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-family:"Segoe UI",system-ui,sans-serif;background:#f7f9f8;color:#1b2b28}
    .logos{display:flex;gap:96px;align-items:center;margin-bottom:72px}
    .logos img{height:120px}
    .dept{font-size:30px;letter-spacing:.12em;font-weight:600;color:#35665e}
    h1{font-size:76px;margin:28px 0 18px;font-weight:700;text-align:center}
    .rule{width:160px;height:6px;border-radius:3px;background:#35665e;margin:8px 0 34px}
    p{font-size:38px;margin:0;color:#4b5d59;text-align:center;max-width:1500px;line-height:1.4}
  </style></head><body>
    <div class="logos"><img src="${logo("srm-logo.png")}"><img src="${logo("ctech-logo.png")}"></div>
    <div class="dept">DEPARTMENT OF COMPUTING TECHNOLOGIES</div>
    <h1>${title}</h1><div class="rule"></div><p>${subtitle}</p>
  </body></html>`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: out });
  await browser.close();
}
