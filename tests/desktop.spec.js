import { test, expect } from '@playwright/test';
import { boot, state, teleport, takeControl, fps, SPOTS, at } from './helpers.js';

const hold = async (page, key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(250); };

test.describe('desktop', () => {
  test('loads with no errors and a correctly sized WebGL canvas', async ({ page }) => {
    const errors = await boot(page);
    const info = await page.evaluate(() => { const c = document.getElementById('view'); return { w: c.width, cw: c.clientWidth, ch: c.clientHeight, gl: !!window.__bodycam.renderer.getContext() }; });
    expect(info.gl).toBe(true);
    expect(info.cw).toBe(1280); expect(info.ch).toBe(720);
    expect(info.w).toBeGreaterThan(700); expect(info.w).toBeLessThan(1280 * 2);
    expect(errors).toEqual([]);
  });

  test('spawns in the yard facing the house', async ({ page }) => {
    await boot(page); await takeControl(page);
    const s = await state(page);
    const L = await page.evaluate(() => window.__bodycam.LEVEL);
    expect(Math.hypot(s.pos[0] - L.spawn[0], s.pos[1] - L.spawn[1])).toBeLessThan(3);
  });

  test('first click takes control and shows the reticle (no overlay)', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#cross')).not.toHaveClass(/on/);
    await takeControl(page);
    await expect(page.locator('#cross')).toHaveClass(/on/);
    await expect(page.locator('#hint')).toHaveCount(0);
  });

  test('before the first click the camera holds the spawn view', async ({ page }) => {
    await boot(page);
    const a = await state(page);
    await page.waitForTimeout(1500);
    const b = await state(page);
    const L = await page.evaluate(() => window.__bodycam.LEVEL);
    expect(a.started).toBe(false);
    expect(Math.hypot(b.pos[0] - L.spawn[0], b.pos[1] - L.spawn[1])).toBeLessThan(0.01);
    expect(Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1])).toBeLessThan(0.01);
  });

  test('audio starts on first interaction', async ({ page }) => {
    await boot(page);
    expect((await state(page)).audio).toBe('none');
    await takeControl(page);
    await expect.poll(async () => (await state(page)).audio).toBe('running');
  });

  test('WASD moves relative to view, Shift runs', async ({ page }) => {
    await boot(page); await takeControl(page);
    await at(page, SPOTS.open);                                   // facing -z toward the house
    let s0 = await state(page); await hold(page, 'KeyW', 800); let s1 = await state(page);
    expect(s1.pos[1], 'W moves forward (-z)').toBeLessThan(s0.pos[1] - 0.4);
    s0 = s1; await hold(page, 'KeyS', 800); s1 = await state(page);
    expect(s1.pos[1], 'S moves back').toBeGreaterThan(s0.pos[1] + 0.4);
    s0 = s1; await hold(page, 'KeyD', 600); s1 = await state(page);
    expect(s1.pos[0], 'D strafes right').toBeGreaterThan(s0.pos[0] + 0.2);
    s0 = s1; await hold(page, 'KeyA', 600); s1 = await state(page);
    expect(s1.pos[0], 'A strafes left').toBeLessThan(s0.pos[0] - 0.2);
    await at(page, SPOTS.open);
    await page.keyboard.down('KeyW'); await page.waitForTimeout(900);
    const walk = (await state(page)).speed;
    await page.keyboard.down('Shift'); await page.waitForTimeout(900);
    const run = (await state(page)).speed;
    await page.keyboard.up('Shift'); await page.keyboard.up('KeyW');
    expect(walk).toBeGreaterThan(1.1); expect(walk).toBeLessThan(1.8);
    expect(run).toBeGreaterThan(2.5);
  });

  test('forward + Enter sprints just like Shift', async ({ page }) => {
    await boot(page); await takeControl(page);
    await at(page, SPOTS.open);
    await page.keyboard.down('KeyW'); await page.waitForTimeout(900);
    const walk = (await state(page)).speed;
    await page.keyboard.down('Enter'); await page.waitForTimeout(900);
    const run = (await state(page)).speed;
    await page.keyboard.up('Enter'); await page.waitForTimeout(900);
    const back = (await state(page)).speed;
    await page.keyboard.up('KeyW');
    expect(walk).toBeLessThan(1.8);
    expect(run, 'Enter sprints').toBeGreaterThan(2.5);
    expect(back, 'releasing Enter returns to walking').toBeLessThan(1.8);
  });

  test('solid objects and the yard edge block you', async ({ page }) => {
    await boot(page); await takeControl(page);
    const { boxes, LEVEL, HOUSE } = await page.evaluate(() => ({ boxes: window.__bodycam.boxes, LEVEL: window.__bodycam.LEVEL, HOUSE: window.__bodycam.HOUSE }));
    const insideBox = ([x, z]) => boxes.some((b) => x > b.x0 + 0.01 && x < b.x1 - 0.01 && z > b.z0 + 0.01 && z < b.z1 - 0.01);
    const push = async (x, z, yaw, ms = 2600) => { await teleport(page, x, z, yaw); await page.keyboard.down('KeyW'); await page.waitForTimeout(ms); await page.keyboard.up('KeyW'); await page.waitForTimeout(150); return (await state(page)).pos; };
    const cases = [
      [-4, 2, 0, 'house front / porch'],
      [HOUSE.x - HOUSE.W / 2 - 3, HOUSE.z, -Math.PI / 2, 'house west side'],
      [HOUSE.x, HOUSE.z - HOUSE.D / 2 - 3, Math.PI, 'house back'],
      [7, -8.5, -Math.PI / 2, 'shipping containers'],
      [-12, 12, 0, 'picket fence'],
      [0, 20, Math.PI, 'south yard edge'],
      [20, 0, -Math.PI / 2, 'east yard edge'],
    ];
    for (const [x, z, yaw, name] of cases) {
      const p = await push(x, z, yaw);
      expect(insideBox(p), `${name}: not inside a solid (${p})`).toBe(false);
      expect(Math.abs(p[0]) <= LEVEL.bounds + 0.01 && Math.abs(p[1]) <= LEVEL.bounds + 0.01, `${name}: inside yard bounds (${p})`).toBe(true);
    }
    // specifically: walking at the house front stops at the porch steps
    const p = await push(-0.2, 1.5, 0);
    expect(p[1], 'stopped in front of the porch').toBeGreaterThan(HOUSE.z + HOUSE.D / 2 + 2.3 + 1.1);
  });

  test('a picket fence encloses the yard on all four sides', async ({ page }) => {
    await boot(page); await takeControl(page);
    const L = await page.evaluate(() => window.__bodycam.LEVEL);
    for (const [x, z, yaw] of [[0, 20, Math.PI], [0, -20, 0], [20, 0, -Math.PI / 2], [-20, 4, Math.PI / 2]]) {
      await teleport(page, x, z, yaw);
      await page.keyboard.down('Shift'); await page.keyboard.down('KeyW'); await page.waitForTimeout(2500);
      await page.keyboard.up('KeyW'); await page.keyboard.up('Shift');
      const p = (await state(page)).pos;
      expect(Math.max(Math.abs(p[0]), Math.abs(p[1])), `stopped inside the fence from ${[x, z]}`).toBeLessThan(L.fence);
    }
  });

  test('you can walk all the way around the house', async ({ page }) => {
    await boot(page); await takeControl(page);
    // four legs around the house: west side north, behind it east, east side south, front west
    const legs = [[[-10.5, 0], 0], [[-10.5, -17], -Math.PI / 2], [[6, -17], Math.PI], [[6.5, -1], Math.PI / 2]];
    for (const [[x, z], yaw] of legs) {
      await teleport(page, x, z, yaw);
      await page.keyboard.down('KeyW'); await page.waitForTimeout(2600); await page.keyboard.up('KeyW');
      const p = (await state(page)).pos;
      expect(Math.hypot(p[0] - x, p[1] - z), `leg from ${[x, z]} moved`).toBeGreaterThan(3);
    }
  });

  test('firing leaves decals, is rate-limited, and holster blocks it', async ({ page }) => {
    await boot(page); await takeControl(page);
    await at(page, SPOTS.wall);
    await page.waitForTimeout(250);
    const d0 = (await state(page)).decals;
    await page.mouse.click(640, 360);
    await expect.poll(async () => (await state(page)).decals).toBe(d0 + 1);
    await page.waitForTimeout(300);
    await page.evaluate(() => { window.__bodycam.fire(); window.__bodycam.fire(); });
    await page.waitForTimeout(100);
    expect((await state(page)).decals).toBe(d0 + 2);
    await page.keyboard.press('KeyG');
    await expect.poll(async () => (await state(page)).holstered).toBe(true);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__bodycam.fire());
    await page.waitForTimeout(100);
    expect((await state(page)).decals, 'holstered: no shot').toBe(d0 + 2);
    await page.keyboard.press('KeyG');
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__bodycam.fire());
    await expect.poll(async () => (await state(page)).decals).toBe(d0 + 3);
  });

  test('ammo: each shot uses a round, R reloads from reserve, empty mag dry-fires then auto-reloads', async ({ page }) => {
    await boot(page); await takeControl(page);
    await at(page, SPOTS.wall);
    const s0 = await state(page);
    expect(s0.mag).toBe(17); expect(s0.reserve).toBe(68);
    for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__bodycam.fire()); await page.waitForTimeout(180); }
    await expect.poll(async () => (await state(page)).mag).toBe(14);
    await page.keyboard.press('KeyR');
    await expect.poll(async () => (await state(page)).reloading).toBe(true);
    await page.evaluate(() => window.__bodycam.fire());
    await expect.poll(async () => (await state(page)).reloading, { timeout: 3000 }).toBe(false);
    const s1 = await state(page);
    expect(s1.mag).toBe(17); expect(s1.reserve).toBe(65);
    await page.evaluate(() => { window.__bodycam.game.mag = 0; });
    const dec = (await state(page)).decals;
    await page.evaluate(() => window.__bodycam.fire());
    await page.waitForTimeout(100);
    const s2 = await state(page);
    expect(s2.decals, 'dry fire shoots nothing').toBe(dec);
    expect(s2.reloading, 'empty trigger pull starts a reload').toBe(true);
    await expect.poll(async () => (await state(page)).mag, { timeout: 3000 }).toBe(17);
  });

  test('holding Space aims down the sights and zooms; releasing returns to the hip', async ({ page }) => {
    await boot(page); await takeControl(page);
    await at(page, SPOTS.open);
    expect((await state(page)).fov).toBeCloseTo(88, 0);
    await page.keyboard.down('Space');
    await expect.poll(async () => (await state(page)).aim, { timeout: 2000 }).toBeGreaterThan(0.95);
    expect((await state(page)).fov, 'zoomed in').toBeLessThan(50);
    await expect(page.locator('#cross'), 'centre ring hidden while aiming').toHaveClass(/aim/);
    await expect(page.locator('#reticle'), 'big circle shown while aiming').toHaveClass(/on/);
    await expect(page.locator('#horizon'), 'horizon shown while aiming').toHaveClass(/on/);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.keyboard.down('KeyW'); await page.keyboard.down('Shift'); await page.waitForTimeout(900);
    const aimSpeed = (await state(page)).speed;
    await page.keyboard.up('Shift'); await page.keyboard.up('KeyW');
    expect(aimSpeed, 'no sprint while aiming').toBeLessThan(1.2);
    await at(page, SPOTS.wall); await page.waitForTimeout(250);
    const d0 = (await state(page)).decals;
    await page.evaluate(() => window.__bodycam.fire());
    await expect.poll(async () => (await state(page)).decals).toBe(d0 + 1);
    await page.keyboard.up('Space');
    await expect.poll(async () => (await state(page)).aim, { timeout: 2000 }).toBeLessThan(0.05);
    expect((await state(page)).fov).toBeGreaterThan(86);
    await expect(page.locator('#cross')).not.toHaveClass(/aim/);
    await expect(page.locator('#reticle'), 'big circle hidden again').not.toHaveClass(/on/);
  });

  test('gun rests at low-ready by default, comes up to fire or aim, then lowers again', async ({ page }) => {
    await boot(page); await takeControl(page);
    await at(page, SPOTS.wall);
    await page.waitForTimeout(1500);
    expect((await state(page)).ready, 'lowered by default').toBeLessThan(0.1);
    // the lowered gun leaves the middle of the frame clear
    const rigY = () => page.evaluate(() => window.__bodycam.rig.position.y);
    const lowY = await rigY();
    await page.evaluate(() => window.__bodycam.fire());
    await expect.poll(async () => (await state(page)).ready, { timeout: 1000 }).toBeGreaterThan(0.9);
    expect(await rigY(), 'raised to shoot').toBeGreaterThan(lowY + 0.1);
    await expect.poll(async () => (await state(page)).ready, { timeout: 4000 }).toBeLessThan(0.1);
    await page.keyboard.down('Space');
    await expect.poll(async () => (await state(page)).ready, { timeout: 1000 }).toBeGreaterThan(0.9);
    await page.keyboard.up('Space');
  });

  test('cannot aim while holstered', async ({ page }) => {
    await boot(page); await takeControl(page);
    await page.keyboard.press('KeyG');
    await expect.poll(async () => (await state(page)).holstered).toBe(true);
    await page.keyboard.down('Space'); await page.waitForTimeout(700);
    expect((await state(page)).aim).toBeLessThan(0.05);
    await page.keyboard.up('Space');
  });

  test('mouse look turns the camera (drag fallback when pointer lock is unavailable)', async ({ page }) => {
    await boot(page); await takeControl(page);
    const y0 = (await state(page)).yaw;
    await page.mouse.move(640, 360); await page.mouse.down(); await page.mouse.move(760, 340, { steps: 8 }); await page.mouse.up();
    const s = await state(page);
    if (!s.locked) expect(Math.abs(s.yaw - y0)).toBeGreaterThan(0.2);
  });

  test('shooting the cut-out by the porch makes it wobble and then settle', async ({ page }) => {
    await boot(page); await takeControl(page);
    await page.evaluate(() => {
      const B = window.__bodycam, T = B.THREE, piv = B.character.pivot;
      const target = new T.Vector3(); piv.localToWorld(target.set(0, 1.0, 0));
      const from = new T.Vector3(piv.position.x - 1.1, 1.38, piv.position.z + 2.6);
      const d = target.clone().sub(from);
      B.player.pos.set(from.x, 0, from.z); B.player.vel.set(0, 0, 0);
      B.player.yaw = Math.atan2(-d.x, -d.z); B.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    });
    await page.waitForTimeout(600);
    const before = (await state(page)).charRot;
    const d0 = (await state(page)).decals;
    await page.evaluate(() => window.__bodycam.fire());
    await page.waitForTimeout(120);
    const hit = await state(page);
    expect(hit.decals, 'bullet hole on the cut-out').toBe(d0 + 1);
    expect(Math.abs(hit.charRot[0] - before[0]) + Math.abs(hit.charRot[2] - before[2]), 'it wobbles').toBeGreaterThan(0.02);
    await page.waitForTimeout(4000);
    expect(Math.abs((await state(page)).charRot[0] - before[0]), 'settles back').toBeLessThan(0.03);
  });

  test('the figure appears at the tree line in view and vanishes when approached (costs health)', async ({ page }) => {
    await boot(page); await takeControl(page);
    await at(page, SPOTS.lookout);
    await page.evaluate(() => window.__bodycam.stalker.summon());
    await expect.poll(async () => (await state(page)).stalker, { timeout: 4000 }).toBe(true);
    const pos = await page.evaluate(() => window.__bodycam.stalker.group.position.toArray());
    expect(Math.hypot(pos[0], pos[2]), 'at the tree line').toBeGreaterThan(18);
    await page.evaluate(([x, z]) => { const p = window.__bodycam.player; p.pos.set(x * 0.8, 0, z * 0.8); }, [pos[0], pos[2]]);
    await expect.poll(async () => (await state(page)).stalker, { timeout: 2000 }).toBe(false);
    expect((await state(page)).hp, 'it got you').toBeLessThan(100);
  });

  test('shooting the figure wins the round', async ({ page }) => {
    await boot(page); await takeControl(page);
    await at(page, SPOTS.lookout);
    await page.evaluate(() => window.__bodycam.stalker.summon());
    await expect.poll(async () => (await state(page)).stalker, { timeout: 4000 }).toBe(true);
    await page.evaluate(() => {
      const B = window.__bodycam, g = B.stalker.group.position, p = B.player;
      const dx = g.x - p.pos.x, dz = g.z - p.pos.z, dy = 1.25 - 1.38;
      p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz)); p.vel.set(0, 0, 0);
    });
    await page.waitForTimeout(250);
    await page.evaluate(() => window.__bodycam.fire());
    await expect.poll(async () => (await state(page)).wins, { timeout: 2000 }).toBe(1);
    await expect(page.locator('#banner-title')).toHaveText('ROUND WON');
    await expect(page.locator('#banner')).toHaveClass(/won/);
  });

  test('health: damage counts down, death shows ROUND LOST and respawns', async ({ page }) => {
    await boot(page); await takeControl(page);
    await teleport(page, 15, -2, 0);
    await page.evaluate(() => window.__bodycam.damage(34));
    expect((await state(page)).hp).toBe(66);
    await page.evaluate(() => window.__bodycam.damage(34));
    expect((await state(page)).hp).toBe(32);
    await page.evaluate(() => window.__bodycam.damage(34));
    const s = await state(page);
    const L = await page.evaluate(() => window.__bodycam.LEVEL);
    expect(s.losses).toBe(1); expect(s.hp).toBe(100);
    expect(Math.hypot(s.pos[0] - L.spawn[0], s.pos[1] - L.spawn[1]), 'respawned at the start').toBeLessThan(0.5);
    await expect(page.locator('#banner')).toHaveClass(/show/);
    await expect(page.locator('#banner-title')).toHaveText('ROUND LOST');
    await expect(page.locator('#banner-score')).toHaveText('0 : 1');
    await expect(page.locator('#banner')).not.toHaveClass(/show/, { timeout: 5000 });
  });

  test('the aiming horizon follows the camera', async ({ page }) => {
    await boot(page); await takeControl(page);
    await at(page, SPOTS.wall);
    const y0 = (await page.locator('#horizon').boundingBox()).y;
    await page.evaluate(() => { window.__bodycam.player.pitch = 0.4; });
    await page.waitForTimeout(200);
    const y1 = (await page.locator('#horizon').boundingBox()).y;
    expect(y1, 'horizon drops as you look up').toBeGreaterThan(y0 + 50);
  });

  test('resizing keeps the canvas filling the window without errors', async ({ page }) => {
    const errors = await boot(page);
    await page.setViewportSize({ width: 900, height: 900 });
    await page.waitForTimeout(400);
    const a = await page.evaluate(() => { const c = document.getElementById('view'); return [c.clientWidth, c.clientHeight, window.__bodycam.camera.aspect]; });
    expect(a[0]).toBe(900); expect(a[1]).toBe(900); expect(a[2]).toBeCloseTo(1, 2);
    await page.setViewportSize({ width: 1280, height: 720 });
    expect(errors).toEqual([]);
  });

  test('performance: holds a smooth frame rate in the yard', async ({ page }) => {
    await boot(page); await takeControl(page);
    await at(page, SPOTS.open);
    expect(await fps(page)).toBeGreaterThan(50);
  });
});
