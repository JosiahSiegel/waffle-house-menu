// Visual smoke test: open the deployed site in headless Chromium
// and take a screenshot, plus dump key DOM state.
//
// Usage:
//   node scripts/snap.mjs [url] [out.png]
//
// Defaults: the latest preview URL (override with arg 1), /tmp/snap.png (arg 2).
//
// Requires: chromium installed (apt: chromium) + puppeteer-core in devDeps.

import puppeteer from "puppeteer-core";

const url = process.argv[2] || "https://cg2bjf82sxir.space.minimax.io/";
const out = process.argv[3] || "/tmp/snap.png";

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
await page.screenshot({ path: out, fullPage: false });

const state = await page.evaluate(() => {
  const loading = document.getElementById("loading");
  const empty = document.getElementById("empty");
  const menu = document.getElementById("menu");
  const jump = document.getElementById("jumpnav");
  return {
    loadingClass: loading?.className,
    loadingVisible: loading ? getComputedStyle(loading).display !== "none" : null,
    emptyClass: empty?.className,
    emptyVisible: empty ? getComputedStyle(empty).display !== "none" : null,
    menuChildren: menu?.children.length,
    firstSection: menu?.querySelector("details.sec")?.id,
    jumpLinks: jump ? Array.from(jump.querySelectorAll("a")).map((a) => a.textContent.trim()) : [],
  };
});
console.log(JSON.stringify(state, null, 2));

// Jump-nav test: click the 4th jump link (Waffles) and report scroll position
const jumpTest = await page.evaluate(() => {
  const a = document.querySelector('a[href="#sec-waffles"]');
  if (!a) return { ok: false, why: "no-link" };
  a.click();
  return { ok: true };
});
if (jumpTest.ok) {
  await new Promise((r) => setTimeout(r, 1200));
  const pos = await page.evaluate(() => ({
    scrollY: window.scrollY,
    controlsHeight: document.querySelector(".controls")?.getBoundingClientRect().height,
    wafflesTop: document.getElementById("sec-waffles")?.getBoundingClientRect().top,
  }));
  console.log("after-jump:", JSON.stringify(pos, null, 2));
  await page.screenshot({ path: out.replace(/\.png$/, "-after-jump.png") });
}

await browser.close();
