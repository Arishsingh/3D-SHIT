// The house: walk up the porch, press Enter at the door, cut to black, explore inside, go down to the cellar and back out.
import { test, expect } from '@playwright/test';
import { boot, state, teleport, takeControl, luminance, fps } from './helpers.js';

const zoneOf = async (page) => (await state(page)).zone;
const fadeOpacity = (page) => page.evaluate(() => +getComputedStyle(document.getElementById('fade')).opacity);
const promptShown = (page) => page.evaluate(() => document.getElementById('prompt').classList.contains('show'));
const promptText = (page) => page.evaluate(() => [...document.getElementById('prompt').children].map((e) => e.textContent.trim()).join(' '));

// stand on the porch in front of the door, facing it
async function atFrontDoor(page) {
  const d = await page.evaluate(() => window.__bodycam.DOORS[0]);
  await teleport(page, d.x, d.z + 1.2, 0, 0);
  await page.waitForTimeout(300);
}
async function goThrough(page, to) {
  await expect.poll(() => promptShown(page)).toBe(true);
  await page.keyboard.press('Enter');
  await expect.poll(() => fadeOpacity(page), { timeout: 2000 }).toBeGreaterThan(0.9);      // screen goes black
  await expect.poll(() => zoneOf(page), { timeout: 3000 }).toBe(to);
  await expect.poll(() => fadeOpacity(page), { timeout: 3000 }).toBeLessThan(0.05);        // and comes back
  await expect.poll(async () => (await state(page)).fading).toBe(false);
}

test.describe('house', () => {
  test('walking up the steps raises you onto the porch', async ({ page }) => {
    const errors = await boot(page);
    await takeControl(page);
    await teleport(page, -2.2, -2.2, 0, 0);
    await page.keyboard.down('KeyW'); await page.waitForTimeout(2200); await page.keyboard.up('KeyW');
    const s = await state(page);
    expect(s.pos[1]).toBeLessThan(-4.4);                 // made it past the porch edge
    expect(s.fy).toBeGreaterThan(0.45);                  // camera is up on the deck
    // you cannot step onto the porch over its edge, only up the steps
    await teleport(page, -5.5, -2.6, 0, 0);
    await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW');
    expect((await state(page)).pos[1]).toBeGreaterThan(-4.2);
    expect(errors).toEqual([]);
  });

  test('a minimal "ENTER  OPEN DOOR" prompt shows only at the door, when facing it', async ({ page }) => {
    await boot(page);
    await takeControl(page);
    await teleport(page, 0, 8, 0, 0);
    await page.waitForTimeout(300);
    expect(await promptShown(page)).toBe(false);
    await atFrontDoor(page);
    await expect.poll(() => promptShown(page)).toBe(true);
    expect(await promptText(page)).toBe('ENTER OPEN DOOR');
    // prompt is small, centred, below the reticle
    const b = await page.locator('#prompt').boundingBox(), vp = page.viewportSize();
    expect(Math.abs(b.x + b.width / 2 - vp.width / 2)).toBeLessThan(4);
    expect(b.y).toBeGreaterThan(vp.height / 2);
    expect(b.height).toBeLessThan(40);
    // turn your back on the door and it goes away
    await page.evaluate(() => { window.__bodycam.player.yaw = Math.PI; });
    await expect.poll(() => promptShown(page)).toBe(false);
  });

  test('Enter at the door fades to black and puts you inside the house', async ({ page }) => {
    const errors = await boot(page);
    await takeControl(page);
    await atFrontDoor(page);
    await goThrough(page, 'house');
    const s = await state(page);
    const IN = await page.evaluate(() => window.__bodycam.IN);
    expect(Math.abs(s.pos[0] - IN.x)).toBeLessThan(IN.W / 2);
    expect(Math.abs(s.pos[1] - IN.z)).toBeLessThan(IN.D / 2);
    expect(s.speed).toBeLessThan(0.1);
    // Enter was used for the door, so you are not left sprinting
    await page.keyboard.down('KeyW'); await page.waitForTimeout(700);
    expect((await state(page)).speed).toBeLessThan(2);
    await page.keyboard.up('KeyW');
    // the corridors are lit, not a black screen (looking up the east corridor past the window)
    await teleport(page, IN.x + 7.6, IN.z + 2.5, 0, -0.03);
    await page.waitForTimeout(500);
    const lum = await luminance(page);
    expect(lum.mean).toBeGreaterThan(14);
    expect(lum.max).toBeGreaterThan(150);
    expect(errors).toEqual([]);
  });

  test('inside is a square loop of corridors round a solid block: you can walk all the way round', async ({ page }) => {
    await boot(page);
    await takeControl(page);
    const { IN, LOOP } = await page.evaluate(() => { const B = window.__bodycam; B.goTo('house', [B.IN.x - 0.2, B.IN.z + 5.7], Math.PI / 2); return { IN: B.IN, LOOP: B.LOOP }; });
    // the block stops you walking north out of the south corridor
    await teleport(page, IN.x + 1, IN.z + 5.7, 0, 0);
    await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW');
    expect((await state(page)).pos[1]).toBeGreaterThan(IN.z + LOOP.bz);
    // and the outer wall stops you going south
    await teleport(page, IN.x + 1, IN.z + 5.7, Math.PI, 0);
    await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW');
    expect((await state(page)).pos[1]).toBeLessThan(IN.z + IN.D / 2);
    // drive round all four corners: each leg ends in the next corridor
    const cx = (IN.W / 2 + LOOP.bx) / 2, cz = (IN.D / 2 + LOOP.bz) / 2;
    const legs = [
      { from: [IN.x - cx, IN.z + cz], yaw: -Math.PI / 2, check: (p) => p[0] > IN.x + LOOP.bx },     // south: west -> east
      { from: [IN.x + cx, IN.z + cz], yaw: 0, check: (p) => p[1] < IN.z - LOOP.bz },               // east: south -> north
      { from: [IN.x + cx, IN.z - cz], yaw: Math.PI / 2, check: (p) => p[0] < IN.x - LOOP.bx },      // north: east -> west
      { from: [IN.x - cx, IN.z - cz], yaw: Math.PI, check: (p) => p[1] > IN.z + LOOP.bz },          // west: north -> south
    ];
    for (const leg of legs) {
      await teleport(page, leg.from[0], leg.from[1], leg.yaw, 0);
      await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
      await expect.poll(async () => leg.check((await state(page)).pos), { timeout: 12000 }).toBe(true);
      await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
    }
  });

  test('cellar door leads down and back up, front door leads back out onto the porch', async ({ page }) => {
    const errors = await boot(page);
    await takeControl(page);
    await atFrontDoor(page);
    await goThrough(page, 'house');
    const { IN, CEL } = await page.evaluate(() => ({ IN: window.__bodycam.IN, CEL: window.__bodycam.CEL }));
    // end of the hall: the cellar door
    await teleport(page, IN.x - 0.3, IN.z - IN.D / 2 + 1.0, 0, 0);
    await expect.poll(() => promptText(page)).toBe('ENTER GO DOWN');
    await goThrough(page, 'cellar');
    let s = await state(page);
    expect(Math.abs(s.pos[0] - CEL.x)).toBeLessThan(CEL.W / 2);
    expect(Math.abs(s.pos[1] - CEL.z)).toBeLessThan(CEL.D / 2);
    // turn round to the stairs and go back up
    await page.evaluate(() => { const B = window.__bodycam, d = B.DOORS.find((d) => d.zone === 'cellar'); const p = B.player; p.yaw = Math.atan2(-(d.x - p.pos.x), -(d.z - p.pos.z)); });
    await expect.poll(() => promptText(page)).toBe('ENTER GO UP');
    await goThrough(page, 'house');
    // back to the front door and outside
    await teleport(page, IN.x - 0.2, IN.z + IN.D / 2 - 1.1, Math.PI, 0);
    await expect.poll(() => promptText(page)).toBe('ENTER GO OUTSIDE');
    await goThrough(page, 'yard');
    s = await state(page);
    expect(s.fy).toBeGreaterThan(0.45);                 // standing on the porch
    expect(Math.abs(s.yaw - Math.PI)).toBeLessThan(0.01); // facing out into the yard
    expect(errors).toEqual([]);
  });

  test('portfolio: every corridor door opens into its own room, and GO BACK returns you to that door', async ({ page }) => {
    const errors = await boot(page);
    await takeControl(page);
    const info = await page.evaluate(() => {
      const B = window.__bodycam;
      return { n: B.PORTFOLIO.length, doors: B.DOORS.filter((d) => d.zone === 'house' && d.to.startsWith('room')).map((d) => ({ to: d.to, label: d.label, x: d.x, z: d.z })) };
    });
    expect(info.doors.length).toBe(Math.min(info.n, 14));
    expect(new Set(info.doors.map((d) => d.to)).size).toBe(info.doors.length);       // one room per door
    // walk through three of them for real: first, middle, last
    for (const k of [0, Math.floor(info.doors.length / 2), info.doors.length - 1]) {
      const d = info.doors[k];
      await page.evaluate((to) => {
        const B = window.__bodycam, back = B.DOORS.find((x) => x.zone === to);
        B.goTo('house', back.at, back.yaw + Math.PI);                                  // in front of the door, facing it
      }, d.to);
      await expect.poll(() => promptText(page)).toBe('ENTER ' + d.label);
      await goThrough(page, d.to);
      // the far wall carries the section title
      await page.waitForTimeout(400);
      expect((await luminance(page)).mean).toBeGreaterThan(12);
      // turn round: GO BACK, and you come out in front of the same door
      await page.evaluate(() => { window.__bodycam.player.yaw = Math.PI; });
      await expect.poll(() => promptText(page)).toBe('ENTER GO BACK');
      await goThrough(page, 'house');
      const s = await state(page);
      expect(Math.hypot(s.pos[0] - d.x, s.pos[1] - d.z)).toBeLessThan(1.3);
    }
    expect(errors).toEqual([]);
  });

  test('portfolio: looking at a board with a link offers to open it', async ({ page }) => {
    await boot(page);
    await takeControl(page);
    // find a room with a linked board and stand facing it
    const ok = await page.evaluate(() => {
      const B = window.__bodycam, T = B.THREE, t = B.INTERIOR.linkTargets[0];
      if (!t) return false;
      const zone = Object.keys(B.ZONES).find((z) => { const Z = B.ZONES[z]; const p = new T.Vector3(); t.getWorldPosition(p); return z.startsWith('room') && Math.abs(p.x - Z.x) < Z.W && Math.abs(p.z - Z.z) < Z.D; });
      const p = new T.Vector3(), n = new T.Vector3(0, 0, 1); t.getWorldPosition(p); n.applyQuaternion(t.getWorldQuaternion(new T.Quaternion()));
      const at = [p.x + n.x * 1.6, p.z + n.z * 1.6];
      B.goTo(zone, at, Math.atan2(n.x, n.z));
      B.player.pitch = Math.atan2(p.y - 1.38, 1.6);
      return true;
    });
    expect(ok).toBe(true);
    await expect.poll(() => promptText(page)).toBe('ENTER OPEN LINK');
    const popup = page.waitForEvent('popup');
    await page.keyboard.press('Enter');
    expect((await popup).url()).toMatch(/^https:\/\//);
  });

  test('smooth: shaders for the house and rooms are built at load, so doors never stall on a compile', async ({ page }) => {
    await boot(page);
    await takeControl(page);
    const keys = () => page.evaluate(() => window.__bodycam.renderer.info.programs.map((p) => p.cacheKey).filter((k) => !/^(depth|distanceRGBA)/.test(k)));
    const before = new Set(await keys());
    for (const z of ['house', 'room0', 'room3']) {
      await page.evaluate((z) => { const B = window.__bodycam; const d = B.DOORS.find((d) => d.to === z); B.goTo(z, d.at, d.yaw); }, z);
      await page.waitForTimeout(500);
    }
    const added = (await keys()).filter((k) => !before.has(k));
    expect(added, 'no new scene shaders compiled after load').toEqual([]);
  });

  test('the figure never appears indoors and the house holds frame rate', async ({ page }) => {
    await boot(page);
    await takeControl(page);
    await page.evaluate(() => { const B = window.__bodycam; B.goTo('house', [B.IN.x - 0.2, B.IN.z + 5.7], Math.PI / 2); B.stalker.summon(); });
    await page.waitForTimeout(1500);
    expect((await state(page)).stalker).toBe(false);
    expect(await fps(page)).toBeGreaterThan(40);
  });
});
