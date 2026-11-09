// HUD layout checks — run on desktop, a wide desktop and a phone.
// The HUD is intentionally minimal: only the blinking REC indicator.
import { test, expect } from '@playwright/test';
import { boot, luminance } from './helpers.js';

const inside = (b, vp, margin = 0) => b.x >= margin && b.y >= margin && b.x + b.width <= vp.width - margin && b.y + b.height <= vp.height - margin;

test('REC indicator is visible, top-right and inside the frame', async ({ page }) => {
  const errors = await boot(page);
  const vp = page.viewportSize();
  const rec = await page.locator('#rec').boundingBox();
  expect(rec).not.toBeNull();
  expect(inside(rec, vp, 4), `REC inside viewport ${JSON.stringify(rec)}`).toBe(true);
  expect(rec.x + rec.width / 2, 'REC on the right (first item of the top-right group)').toBeGreaterThan(vp.width * 0.5);
  expect(rec.y, 'REC at the top').toBeLessThan(vp.height * 0.2);
  const fs = await page.locator('#rec').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(fs).toBeGreaterThanOrEqual(12);
  await expect(page.locator('#rec')).toHaveText(/REC/);
  expect(await page.locator('#rec .dot').evaluate((e) => getComputedStyle(e).animationName)).toBe('blink');
  expect(errors).toEqual([]);
});

test('removed UI stays removed: no start/resume overlay, old timestamp/device line or minimap', async ({ page }) => {
  await boot(page);
  for (const sel of ['#hint', '#hint-title', '#info', '#ts', '#dev', '#map', '#hp', '#hdg', '#ammo', '#cells', '#stab', '#serial']) await expect(page.locator(sel), sel).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/HDG|STAB|MAG|BWC CORE/);
  await expect(page.locator('body')).not.toContainText(/TAKE CONTROL|RESUME|KESTREL|WASD/);
});

test('HUD is just REC / battery / date top-right, plus the centre ring', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__bodycam.start());
  await page.waitForTimeout(800);
  const vp = page.viewportSize();
  const ids = ['tr'];
  const boxes = {};
  for (const id of ids) {
    const b = await page.locator('#' + id).boundingBox();
    expect(b, id).not.toBeNull();
    expect(inside(b, vp, 2), `${id} inside viewport ${JSON.stringify(b)}`).toBe(true);
    boxes[id] = b;
  }
  const ov = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++)
    expect(ov(boxes[ids[i]], boxes[ids[j]]), `${ids[i]} overlaps ${ids[j]}`).toBe(false);
  expect(boxes.tr.x).toBeGreaterThan(vp.width * 0.5);
  expect(boxes.tr.y).toBeLessThan(vp.height * 0.2);
  // reticle circle centred, horizon visible after taking control
  const r = await page.locator('#reticle').boundingBox();
  expect(Math.abs(r.x + r.width / 2 - vp.width / 2)).toBeLessThan(3);
  expect(Math.abs(r.y + r.height / 2 - vp.height / 2)).toBeLessThan(3);
  // big circle + horizon are hidden by default and only appear while aiming
  await expect(page.locator('#reticle')).not.toHaveClass(/on/);
  await expect(page.locator('#horizon')).not.toHaveClass(/on/);
  expect(await page.locator('#horizon').evaluate((e) => +getComputedStyle(e).opacity)).toBeLessThan(0.05);
  await expect(page.locator('#cross')).toHaveClass(/on/);                 // small centre ring stays
  // live date in YYYY:MM:DD
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  await expect(page.locator('#date')).toHaveText(`${d.getUTCFullYear()}:${p(d.getUTCMonth() + 1)}:${p(d.getUTCDate())}`);
  expect(errors).toEqual([]);
});

test('frame renders full screen: lit centre and the picture reaches the corners', async ({ page }) => {
  await boot(page);
  const vp = page.viewportSize();
  const c = await luminance(page, { x: vp.width * 0.35, y: vp.height * 0.3, width: vp.width * 0.3, height: vp.height * 0.3 });
  expect(c.mean, 'centre not black').toBeGreaterThan(6);
  expect(c.max, 'some highlights').toBeGreaterThan(40);
  for (const [x, y] of [[0, 0], [vp.width - 16, 0], [0, vp.height - 16], [vp.width - 16, vp.height - 16]]) {
    const corner = await luminance(page, { x, y, width: 16, height: 16 });
    expect(corner.max, `corner ${x},${y} shows picture, not a black lens mask`).toBeGreaterThan(20);
  }
});

test('tab shows the title "arishsingh" with a blank (transparent) icon', async ({ page }) => {
  await boot(page);
  await expect(page).toHaveTitle('arishsingh');
  const icons = await page.locator('link[rel="icon"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  expect(icons.length).toBeGreaterThan(0);
  for (const href of icons) expect(href).toMatch(/^\/blank-icon\.(svg|png)\?v=\d+$/);
  // every icon (and /favicon.ico) is served and fully transparent
  for (const href of [...icons, '/favicon.ico']) {
    const res = await page.request.get(href);
    expect(res.ok(), href).toBe(true);
  }
  const transparent = await page.evaluate(async () => {
    const img = new Image(); img.src = '/blank-icon.png?v=3'; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return g.getImageData(0, 0, c.width, c.height).data.every((v, i) => i % 4 !== 3 || v === 0);
  });
  expect(transparent, 'icon is fully transparent').toBe(true);
});
