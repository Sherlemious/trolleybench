#!/usr/bin/env node
/**
 * Browser smoke tests for the website, against any running build:
 *
 *   pnpm --filter @trolleybench/web build && pnpm --filter @trolleybench/web start &
 *   node scripts/smoke.mjs                       # http://localhost:3000
 *   node scripts/smoke.mjs https://trolley-bench.sherlemious.com
 *
 * For a scale check, start the server on a fixture first:
 *   node scripts/fake-models.mjs /tmp/fx 200 && TROLLEYBENCH_SAMPLES_DIR=/tmp/fx pnpm --filter @trolleybench/web build
 *
 * Needs Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`).
 * It checks what visual review kept catching by hand: every page renders without script
 * errors, nothing scrolls sideways on a phone, the design's stylesheets actually apply,
 * highlighted models survive a reload, the theme menu applies a theme, and Play runs end
 * to end. Exits non-zero on the first failing page, with every failure listed.
 */
import { createRequire } from "node:module";

const BASE = (process.argv[2] ?? process.env.BASE ?? "http://localhost:3000").replace(/\/+$/, "");
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("playwright is not installed: npm i -g playwright && npx playwright install chromium");
  process.exit(2);
}

const PAGES = ["/", "/play", "/results", "/run", "/docs", "/workbench", "/sources", "/sitemap.xml", "/robots.txt"];
const failures = [];
const fail = (what) => {
  failures.push(what);
  console.log(`  FAIL ${what}`);
};
const pass = (what) => console.log(`  ok   ${what}`);

const browser = await chromium.launch();

async function page(width, scheme = "light") {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  // Third-party requests (analytics) may be blocked where this runs; only our own errors count.
  p.on("console", (m) => m.type() === "error" && !/google|gtag|Failed to load resource/i.test(m.text()) && errors.push(m.text()));
  return { ctx, p, errors };
}

const go = (p, path) => p.goto(BASE + path, { waitUntil: "load", timeout: 60_000 }).then(() => p.waitForTimeout(500));

console.log(`smoke: ${BASE}`);

// 1. Every page renders, at desktop and phone width, with no script errors or sideways scroll.
for (const width of [1440, 390]) {
  console.log(`pages at ${width}px`);
  const { ctx, p, errors } = await page(width);
  for (const path of PAGES) {
    let resp = null;
    try {
      resp = await p.goto(BASE + path, { waitUntil: "load", timeout: 60_000 });
      await p.waitForTimeout(500);
    } catch (e) {
      fail(`${path} @${width}: ${e.message}`);
      continue;
    }
    if (!resp || !resp.ok()) {
      fail(`${path} @${width}: HTTP ${resp?.status()}`);
      continue;
    }
    if (path.endsWith(".xml") || path.endsWith(".txt")) {
      pass(`${path}`);
      continue;
    }
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    overflow > 1 ? fail(`${path} @${width}: scrolls sideways by ${overflow}px`) : pass(`${path} @${width}`);
  }
  if (errors.length) fail(`script errors @${width}: ${errors.slice(0, 3).join(" | ")}`);
  await ctx.close();
}

// 2. The design's stylesheets apply: a regression here once shipped a reordered cascade.
{
  console.log("styles");
  const { ctx, p } = await page(1440);
  await go(p, "/");
  const s = await p.evaluate(() => {
    const btn = document.querySelector(".hero-cta a.primary");
    const hero = document.querySelector(".hero");
    return {
      brand: getComputedStyle(document.documentElement).getPropertyValue("--brand").trim(),
      button: btn ? getComputedStyle(btn).backgroundColor : null,
      heroGrid: hero ? getComputedStyle(hero).gridTemplateColumns : null,
      font: getComputedStyle(document.body).fontFamily,
    };
  });
  if (!s.brand) fail("design tokens missing (--brand empty)");
  else if (s.button !== "rgb(244, 180, 0)") fail(`primary button is ${s.button}, not the amber brand`);
  else if (!s.heroGrid || s.heroGrid === "none" || s.heroGrid.split(" ").length < 2) fail(`hero is not two columns (${s.heroGrid})`);
  else if (!/Inter/.test(s.font)) fail(`body font is ${s.font}`);
  else pass("tokens, brand button, two-column hero, Inter");
  await ctx.close();
}

// 3. Highlighted models survive a reload, through the URL.
{
  console.log("focus");
  const { ctx, p } = await page(1440);
  await go(p, "/results");
  const key = await p.evaluate(() => {
    const pin = document.querySelector("[data-pack]:not([style*='none']) .mt-pin");
    pin?.click();
    return new URL(location.href).searchParams.get("focus");
  });
  if (!key) pass("fewer than two models: no picker to test");
  else {
    await p.reload({ waitUntil: "load" });
    await p.waitForTimeout(800);
    const chips = await p.evaluate(() => document.querySelectorAll(".picker-chips li:not(.picker-clear)").length);
    chips >= 1 ? pass(`?focus=${key} survives reload`) : fail("focus chip missing after reload");
  }
  await ctx.close();
}

// 4. The theme menu applies a theme and an accent, and they persist.
{
  console.log("themes");
  const { ctx, p } = await page(1440);
  await go(p, "/");
  await p.click(".theme-toggle");
  await p.click('.theme-opt:has-text("Midnight")');
  await p.click('.accent-opt[aria-label="Rail blue"]');
  await p.reload({ waitUntil: "load" });
  const t = await p.evaluate(() => ({ ...document.documentElement.dataset, paper: getComputedStyle(document.documentElement).getPropertyValue("--paper").trim() }));
  t.theme === "midnight" && t.mode === "dark" && t.accent === "blue" && t.paper === "#0a0f1e"
    ? pass("midnight + blue applied before paint and kept")
    : fail(`theme not applied: ${JSON.stringify(t)}`);
  await ctx.close();
}

// 5. Play end to end: five answers reach the summary.
{
  console.log("play");
  const { ctx, p, errors } = await page(1440);
  await go(p, "/play");
  for (let i = 0; i < 5; i++) {
    await p.click(`.play-opt >> nth=${i % 2}`);
    await p.waitForTimeout(300);
    await p.click(".play-nav .primary");
    await p.waitForTimeout(400);
  }
  const h1 = await p.textContent("h1");
  /sided with most people/i.test(h1 ?? "") && errors.length === 0 ? pass(`summary: "${h1?.trim()}"`) : fail(`play did not finish: ${h1} ${errors.join(" | ")}`);
  await ctx.close();
}

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nall smoke checks passed");
