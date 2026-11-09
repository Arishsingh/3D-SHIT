// Touch controls on a phone-sized viewport.
import { test, expect } from '@playwright/test';
import { boot, state, SPOTS } from './helpers.js';

// one CDP session per page so the browser keeps track of active touches
const sessions = new WeakMap();
async function touch(page, type, points) {
  if (!sessions.has(page)) sessions.set(page, await page.context().newCDPSession(page));
  await sessions.get(page).send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
}

test.describe('mobile', () => {
  test('no instruction overlay on phones', async ({ page }) => {
    const errors = await boot(page);
    await expect(page.locator('#hint')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('tap starts, drag looks, tap fires, two fingers walk', async ({ page }) => {
    await boot(page);
    const { width: W, height: H } = page.viewportSize();
    await page.touchscreen.tap(W / 2, H / 2);
    await expect.poll(async () => (await state(page)).started).toBe(true);
    // drag to look
    await page.evaluate((s) => { const p = window.__bodycam.player; p.pos.set(s[0], 0, s[1]); p.yaw = s[2]; p.pitch = s[3]; }, SPOTS.wall);
    const y0 = (await state(page)).yaw;
    await touch(page, 'touchStart', [[W / 2, H / 2]]);
    for (let i = 1; i <= 6; i++) await touch(page, 'touchMove', [[W / 2 + i * 12, H / 2]]);
    await touch(page, 'touchEnd', []);
    const y1 = (await state(page)).yaw;
    expect(Math.abs(y1 - y0), 'drag rotates view').toBeGreaterThan(0.15);
    // tap fires
    await page.evaluate((s) => { const p = window.__bodycam.player; p.pos.set(s[0], 0, s[1]); p.yaw = s[2]; p.pitch = s[3]; }, SPOTS.wall);
    await page.waitForTimeout(200);
    const d0 = (await state(page)).decals;
    await page.touchscreen.tap(W / 2, H / 2);
    await expect.poll(async () => (await state(page)).decals).toBe(d0 + 1);
    // two-finger hold walks forward
    await page.evaluate((s) => { const p = window.__bodycam.player; p.pos.set(s[0], 0, s[1]); p.yaw = s[2]; }, SPOTS.open);
    const z0 = (await state(page)).pos[1];
    await touch(page, 'touchStart', [[W * 0.3, H * 0.6], [W * 0.7, H * 0.6]]);
    await page.waitForTimeout(1200);
    await touch(page, 'touchEnd', []);
    const z1 = (await state(page)).pos[1];
    expect(z1, 'walked forward').toBeLessThan(z0 - 0.6);
    expect((await state(page)).decals, 'two-finger walk did not fire').toBe(d0 + 1);
  });
});
