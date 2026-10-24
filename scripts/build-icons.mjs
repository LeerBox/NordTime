// Renders icons/icon.svg to the PNG sizes required by the manifest.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const svg = await readFile(`${root}icons/icon.svg`, 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();

for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  await page.screenshot({ path: `${root}icons/icon${size}.png`, omitBackground: true });
  console.log(`icons/icon${size}.png`);
}

await browser.close();
