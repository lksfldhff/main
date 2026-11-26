// Loads the game in headless Chromium (dev server must run: npx vite --port 5173) and writes
// the placement registry of the real scene to docs/qa/scene_dump.json.
// Usage: node tools/qa/dump_scene.cjs [url]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const url = process.argv[2] || 'http://localhost:5173/';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));
  await page.goto(url);
  await page.waitForSelector('.btn-primary:not([disabled])', { timeout: 600000 });
  const dump = await page.evaluate(() => window.game.runtime.world.district.qa?.() ?? null);
  const out = path.resolve(__dirname, '../../docs/qa/scene_dump.json');
  fs.writeFileSync(out, JSON.stringify(dump));
  console.log(`wrote ${out}: ${dump?.placements?.length ?? 0} placements`);
  await browser.close();
})();
