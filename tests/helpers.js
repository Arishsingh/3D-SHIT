import { expect } from '@playwright/test';
import { PNG } from 'pngjs';

export async function boot(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.goto('/');
  await page.waitForFunction(() => window.__bodycam && window.__bodycam.renderer);
  await page.waitForTimeout(1200);           // let procedural textures + first frames settle
  return errors;
}
export const state = (page) => page.evaluate(() => window.__bodycam.state());
export const teleport = (page, x, z, yaw = 0, pitch = 0) =>
  page.evaluate(([x, z, yaw, pitch]) => { const p = window.__bodycam.player; p.pos.set(x, 0, z); p.vel.set(0, 0, 0); p.yaw = yaw; p.pitch = pitch; }, [x, z, yaw, pitch]);

export async function takeControl(page) {
  const box = page.viewportSize();
  await page.mouse.click(box.width / 2, box.height / 2);
  await expect.poll(async () => (await state(page)).started).toBe(true);
  await page.waitForTimeout(150);
}

// luminance statistics of a screenshot region (0..255)
export async function luminance(page, clip) {
  const png = PNG.sync.read(await page.screenshot(clip ? { clip } : {}));
  let sum = 0, max = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const l = 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2];
    sum += l; if (l > max) max = l;
  }
  return { mean: sum / (png.data.length / 4), max };
}

export async function fps(page, ms = 2000) {
  return page.evaluate((ms) => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else r((n * 1000) / ms); }; requestAnimationFrame(f); }), ms);
}

// Known places in the yard level: [x, z, yaw, pitch]
export const SPOTS = {
  wall: [-3.6, -2.2, 0, 0.12],      // facing plain clapboard between the front window and the door
  open: [0, 22, 0, 0],              // south end of the yard, facing the house with a long clear run
  lookout: [0, 5, Math.PI, 0.02],   // facing away from the house toward the tree line
};
export const at = (page, spot) => teleport(page, ...spot);
