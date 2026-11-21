// ============================================================ the rooms behind the corridor doors
// Realistic, lived-in rooms in the same worn-out house: a study, a bedroom, a workroom, a bathroom ...
// Portfolio rooms carry your content on the walls; the others are plain rooms with nothing to read.
//
// A room is picked with `style: '<name>'` in src/portfolio.js. Room space (metres, origin = room centre):
//   x -3 .. 3, z -2.5 .. 2.5 (door in the south wall at z = +2.5, you walk in facing -z), height 3.
//   The title wall is the north wall (z = -2.5, board at y 0.8 .. 2.5); notice boards sit on the side walls
//   (x = ±3) around z -1.65 .. -0.15 and 0.45 .. 1.95, so furniture lives in the middle or along the north/south walls.
//
// theme fields:  wall (tint multiplied onto the plaster), floorKey / ceilKey (a material from createMaterials),
//   light / fill (colours of the two room lights), lightK (brightness), title (function(sec) -> canvas, 'paper', or null for no board),
//   build(ctx) places furniture.
import * as THREE from 'three';

// ---------------------------------------------------------------- helpers
const std = (color, roughness = 0.85, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const canvasOf = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; };
const texOf = (canvas) => { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
const rngOf = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
const HAND = '"Marker Felt", "Bradley Hand", "Segoe Print", "Chalkboard SE", cursive';
const PRINT = '"Courier New", "American Typewriter", monospace';
const fitText = (g, text, weight, size, family, maxW) => { for (;;) { g.font = `${weight} ${size}px ${family}`; if (g.measureText(text).width <= maxW || size <= 18) return size; size -= 3; } };

// a lit-from-inside screen: black base colour with the picture as an emissive map, so it glows softly like a real monitor
function screenMat(canvas, k = 0.75) {
  const t = texOf(canvas);
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: k, roughness: 0.3 });
}
function paperMat(canvas) { return new THREE.MeshStandardMaterial({ map: texOf(canvas), roughness: 0.95 }); }

// ---------------------------------------------------------------- title walls
function corkBoard(sec) {
  return canvasOf(2048, 1024, (g, W, H) => {
    const r = rngOf(11);
    g.fillStyle = '#a97c50'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9000; i++) { const v = 110 + r() * 80; g.fillStyle = `rgba(${v + 40},${v},${v - 50},${0.2 + r() * 0.3})`; g.fillRect(r() * W, r() * H, 2 + r() * 6, 2 + r() * 5); }
    for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(60,36,18,${0.15 + r() * 0.2})`; g.fillRect(r() * W, r() * H, 2 + r() * 3, 2 + r() * 3); }
    g.strokeStyle = '#4b3220'; g.lineWidth = 26; g.strokeRect(13, 13, W - 26, H - 26);
    // a hand-lettered header strip
    g.save(); g.translate(W / 2, 112); g.rotate(-0.012);
    g.fillStyle = '#efe6cf'; g.fillRect(-380, -62, 760, 124); g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3; g.strokeRect(-380, -62, 760, 124);
    g.fillStyle = '#1a1a1a'; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, sec.title, 'bold', 96, HAND, 700); g.fillText(sec.title, 0, 6); g.restore();
    const cards = [
      ['CROMA', 'chrome extension that explains your code', 'live'], ['IMMORTAL', 'horror survival game. no checkpoints.', 'live'], ['NEURIX STUDIO', 'software + the story around it', 'live'], ['ARIENA', 'studio for games, films & stories', 'live'],
      ['VELOCITY', 'plain english to n8n workflows', 'live'], ['NEXA', 'any codebase as a 3D map', 'live'], ['ONE', 'agentic AI career roadmap', 'live'], ['FIRST BLOCKCHAIN', 'from scratch, in Go', 'live'],
    ];
    const tones = ['#f3ecd6', '#fff3a8', '#e8f0e0', '#f6e1d3'];
    cards.forEach(([t, d, st], i) => {
      const col = i % 4, row = Math.floor(i / 4), cx = 270 + col * 495 + (r() - 0.5) * 30, cy = 380 + row * 340 + (r() - 0.5) * 24;
      g.save(); g.translate(cx, cy); g.rotate((r() - 0.5) * 0.09);
      g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 18; g.shadowOffsetX = 6; g.shadowOffsetY = 8;
      g.fillStyle = tones[(i + row) % 4]; g.fillRect(-205, -135, 410, 270); g.shadowColor = 'transparent';
      g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2; g.strokeRect(-205, -135, 410, 270);
      g.fillStyle = '#16181c'; g.textAlign = 'center'; g.textBaseline = 'middle';
      fitText(g, t, 'bold', 58, HAND, 360); g.fillText(t, 0, -52);
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(-150, -18, 300, 3);
      g.fillStyle = '#2a2d33'; fitText(g, d, 'normal', 30, HAND, 360);
      // wrap the description onto two lines
      const words = d.split(' '); let a = '', b = ''; for (const w of words) { if ((a + ' ' + w).length < 24 && !b) a += (a ? ' ' : '') + w; else b += (b ? ' ' : '') + w; }
      g.font = `30px ${HAND}`; g.fillText(a, 0, 34); g.fillText(b, 0, 74);
      g.fillStyle = '#b3261e'; g.font = `bold 30px ${PRINT}`; g.fillText(st.toUpperCase(), 0, 115);
      const pc = ['#c0392b', '#2e6fbf', '#e0b400', '#2f8f4a'][(i * 3) % 4];
      g.fillStyle = pc; g.beginPath(); g.arc(0, -118, 14, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.arc(-4, -122, 4, 0, 7); g.fill();
      g.restore();
    });
  });
}

function whiteboard(sec) {
  return canvasOf(2048, 1024, (g, W, H) => {
    const r = rngOf(21);
    g.fillStyle = '#f1f1ec'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(90,90,90,${0.03 + r() * 0.05})`; g.lineWidth = 8 + r() * 30; g.beginPath(); const x = r() * W, y = r() * H; g.moveTo(x, y); g.lineTo(x + 100 + r() * 300, y + (r() - 0.5) * 60); g.stroke(); }   // ghosted old marker
    g.strokeStyle = '#9aa0a6'; g.lineWidth = 22; g.strokeRect(11, 11, W - 22, H - 22);
    g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillStyle = '#16213a'; g.font = `bold 120px ${HAND}`; g.save(); g.rotate(-0.01); g.fillText('UPCOMING PLANS', 150, 150); g.restore();
    g.strokeStyle = '#16213a'; g.lineWidth = 7; g.beginPath(); g.moveTo(150, 232); g.bezierCurveTo(600, 250, 1200, 215, 1700, 238); g.stroke();
    const items = [['#16213a', '1.  ECLIPSE PROTOCOL', 'coming soon'], ['#16213a', '2.  more worlds with Ariena', 'games, films, stories'], ['#16213a', '3.  keep shipping dev tools', 'Croma, Velocity, Nexa'], ['#16213a', '4.  write it all down', 'blog posts on dev.to']];
    items.forEach(([col, t, note], i) => {
      const y = 360 + i * 150;
      g.fillStyle = col; g.font = `88px ${HAND}`; g.save(); g.translate(150, y); g.rotate((r() - 0.5) * 0.02); g.fillText(t, 0, 0); g.restore();
      g.fillStyle = i === 0 ? '#c0392b' : '#2e6fbf'; g.font = `52px ${HAND}`; g.fillText(note, 1180, y + 10);
    });
    g.strokeStyle = '#c0392b'; g.lineWidth = 8; g.beginPath(); g.ellipse(520, 360, 430, 62, -0.01, 0, 7); g.stroke();                            // circled: the next thing
    g.beginPath(); g.moveTo(1650, 350); g.lineTo(1810, 350); g.lineTo(1775, 322); g.moveTo(1810, 350); g.lineTo(1775, 378); g.stroke();
    g.fillStyle = '#d0d0cb'; g.fillRect(W / 2 - 300, H - 40, 600, 18);                                                                              // marker tray
    void sec;
  });
}

function pegboard(sec) {
  return canvasOf(2048, 1024, (g, W, H) => {
    g.fillStyle = '#b89b6b'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(${90 + (i * 7) % 60},${70 + (i * 5) % 40},40,0.06)`; g.fillRect((i * 97) % W, (i * 53) % H, 6, 2); }
    g.fillStyle = 'rgba(40,28,14,0.8)';
    for (let y = 40; y < H; y += 48) for (let x = 40; x < W; x += 48) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
    const tool = (draw, x, y, rot = 0) => {                                                     // painted outline + the tool itself hanging on its hooks
      g.save(); g.translate(x, y); g.rotate(rot);
      g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 10; g.shadowOffsetX = 8; g.shadowOffsetY = 10; draw(); g.restore();
    };
    tool(() => { g.fillStyle = '#6b4a2b'; g.fillRect(-14, -30, 28, 280); g.fillStyle = '#7e8387'; g.fillRect(-85, -78, 170, 62); g.fillStyle = '#5d6266'; g.fillRect(-85, -42, 170, 10); }, 300, 360);                          // hammer
    tool(() => { g.fillStyle = '#8a8f94'; g.fillRect(-18, -20, 36, 300); g.beginPath(); g.arc(0, -40, 58, 0, 7); g.fill(); g.fillStyle = '#b89b6b'; g.fillRect(-26, -112, 52, 64); }, 520, 340, 0.1);                      // wrench
    tool(() => { g.fillStyle = '#9a2a22'; g.beginPath(); g.moveTo(-18, 0); g.lineTo(18, 0); g.lineTo(26, 250); g.lineTo(-26, 250); g.fill(); g.fillStyle = '#7e8387'; g.fillRect(-30, -90, 26, 100); g.fillRect(4, -90, 26, 100); }, 740, 370, -0.08);         // pliers
    tool(() => { g.fillStyle = '#8d9296'; g.beginPath(); g.moveTo(-210, -20); g.lineTo(210, -50); g.lineTo(210, 40); g.lineTo(-210, 40); g.fill(); g.fillStyle = '#7a4a22'; g.fillRect(210, -50, 90, 90); }, 1140, 330, 0.04);                       // saw
    tool(() => { g.fillStyle = '#d99a1c'; g.fillRect(-16, -60, 32, 330); g.fillStyle = '#7e8387'; g.fillRect(-16, -60, 32, 40); }, 1500, 360, -0.05);                                                                                     // screwdriver
    tool(() => { g.strokeStyle = '#2c2c2c'; g.lineWidth = 14; g.beginPath(); g.arc(0, 0, 90, 0, 7); g.stroke(); g.strokeStyle = '#6a6a6a'; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 90, 0.2, 5.4); g.stroke(); }, 1750, 340);                     // coil of cable
    tool(() => { g.fillStyle = '#1e5aa8'; g.fillRect(-90, -50, 180, 100); g.fillStyle = '#f0f0f0'; g.font = `bold 36px ${PRINT}`; g.textAlign = 'center'; g.fillText('TAPE', 0, 12); }, 1400, 690);
    // hand-painted plank sign
    g.save(); g.translate(W / 2, 112); g.rotate(-0.008); g.fillStyle = '#3a2a1c'; g.fillRect(-420, -66, 840, 132); g.strokeStyle = '#1f150c'; g.lineWidth = 6; g.strokeRect(-420, -66, 840, 132);
    g.fillStyle = '#e8dcc2'; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, sec.title, 'bold', 104, HAND, 760); g.fillText(sec.title, 0, 6); g.restore();
    g.strokeStyle = '#2c1c0e'; g.lineWidth = 24; g.strokeRect(12, 12, W - 24, H - 24);
  });
}

// a weathered wooden plank with a hand-painted word, like a signpost
function signPlank(label, sub) {
  return canvasOf(1024, 400, (g, W, H) => {
    const r = rngOf(label.length * 31 + 5);
    g.fillStyle = '#b9a785'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) { const y = r() * H; g.strokeStyle = `rgba(${70 + r() * 40},${55 + r() * 30},35,${0.1 + r() * 0.22})`; g.lineWidth = 1 + r() * 3; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(W * 0.3, y + (r() - 0.5) * 14, W * 0.7, y + (r() - 0.5) * 14, W, y + (r() - 0.5) * 10); g.stroke(); }
    for (let i = 0; i < 1800; i++) { g.fillStyle = `rgba(60,44,28,${r() * 0.12})`; g.fillRect(r() * W, r() * H, 2 + r() * 8, 1 + r() * 2); }
    const edge = g.createLinearGradient(0, 0, 0, H); edge.addColorStop(0, 'rgba(0,0,0,0.35)'); edge.addColorStop(0.1, 'rgba(0,0,0,0)'); edge.addColorStop(0.9, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(0,0,0,0.4)');
    g.fillStyle = edge; g.fillRect(0, 0, W, H);
    for (const [x, y] of [[40, 40], [W - 40, 40], [40, H - 40], [W - 40, H - 40]]) { g.fillStyle = 'rgba(40,32,24,0.85)'; g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.arc(x - 2, y - 2, 3, 0, 7); g.fill(); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(W / 2, sub ? H * 0.42 : H / 2); g.rotate(-0.02);
    const sz = fitText(g, label, 'bold', 190, HAND, W - 190);
    g.fillStyle = 'rgba(255,245,220,0.35)'; g.fillText(label, 3, 4);                       // engraved edge catch-light
    g.fillStyle = '#2f261c'; g.fillText(label, 0, 0); void sz; g.restore();
    if (sub) { g.fillStyle = '#4a3b2a'; fitText(g, sub, 'normal', 62, HAND, W - 190); g.fillText(sub, W / 2, H * 0.78); }
  });
}

// ---------------------------------------------------------------- furniture bits shared by several rooms
function chair(ctx, x, z, ry, mat) {
  const { g, mesh, box } = ctx, q = new THREE.Group(); q.position.set(x, 0, z); q.rotation.y = ry; g.add(q);
  mesh(box(0.44, 0.05, 0.44), mat, { parent: q, pos: [0, 0.46, 0], kind: 'wood' });
  mesh(box(0.44, 0.5, 0.04), mat, { parent: q, pos: [0, 0.74, -0.2], kind: 'wood' });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(box(0.04, 0.46, 0.04), mat, { parent: q, pos: [sx * 0.19, 0.23, sz * 0.19], kind: 'wood' });
  mesh(box(0.4, 0.03, 0.02), mat, { parent: q, pos: [0, 0.6, -0.2], kind: 'wood' });
  ctx.circ(x, z, 0.3);
  return q;
}
function papers(ctx, parent, n, area, y, seed) {
  const r = rngOf(seed), { M, mesh } = ctx;
  for (let k = 0; k < n; k++) mesh(new THREE.PlaneGeometry(0.21, 0.29), M.paper[k % M.paper.length], { parent, pos: [area[0] + (r() - 0.5) * area[2], y + k * 0.0012, area[1] + (r() - 0.5) * area[3]], rot: [-Math.PI / 2, 0, r() * 6.28], solid: false, cast: false, kind: 'paper' });
}
function books(ctx, parent, x, y, z, count, seed, along = 'x') {
  const r = rngOf(seed), { mesh, box } = ctx, cols = [0x7a2a24, 0x2c4a6a, 0x3a5a3a, 0x8a6a2a, 0x4a3a5a, 0x5a5048, 0x1f2a36, 0x9a8a6a];
  let p = 0;
  for (let i = 0; i < count; i++) {
    const w = 0.025 + r() * 0.03, h = 0.2 + r() * 0.12, d = 0.2 + r() * 0.04, lean = i === count - 1 ? 0.25 : 0;
    const m = mesh(box(along === 'x' ? w : d, h, along === 'x' ? d : w), std(cols[Math.floor(r() * cols.length)], 0.8), { parent, pos: [x + (along === 'x' ? p + w / 2 : 0), y + h / 2, z + (along === 'x' ? 0 : p + w / 2)], solid: false });
    m.rotation.z = lean; p += w + 0.002;
  }
}

// ---------------------------------------------------------------- the rooms
export const THEMES = {
  // ------------------------------------------------------------ INTRODUCTION: a study
  study: {
    wall: 0xe8d4b0, floorKey: 'floorboards', light: 0xffc784, fill: 0xffd6a0, lightK: 1.7, title: 'paper', titleBox: { w: 1.7, h: 0.85, y: 2.0 },
    build(ctx) {
      const { g, mesh, box, circ, M, hw, hd } = ctx;
      mesh(new THREE.PlaneGeometry(2.6, 1.7), M.rug, { parent: g, pos: [0, 0.008, -0.4], rot: [-Math.PI / 2, 0, 0], solid: false, cast: false });
      // desk against the north wall: pale oak top, drawer pedestals with handles, a green leather blotter
      mesh(box(1.7, 0.05, 0.72), M.wood, { parent: g, pos: [0, 0.75, -2.1], kind: 'wood' });
      for (const sx of [-1, 1]) {
        mesh(box(0.5, 0.7, 0.66), M.wood, { parent: g, pos: [sx * 0.6, 0.35, -2.1], kind: 'wood' });
        for (const y of [0.16, 0.38, 0.6]) {
          mesh(box(0.44, 0.19, 0.012), M.cabinet, { parent: g, pos: [sx * 0.6, y, -1.765], solid: false });
          mesh(box(0.1, 0.014, 0.02), M.metal, { parent: g, pos: [sx * 0.6, y + 0.02, -1.752], solid: false });
        }
      }
      mesh(box(0.8, 0.008, 0.45), std(0x2c4a35, 0.7), { parent: g, pos: [0.05, 0.779, -1.98], rot: [0, 0.05, 0], solid: false });
      // old beige CRT monitor with a lit screen facing the room
      const scr = canvasOf(512, 384, (c, W, H) => {
        c.fillStyle = '#071108'; c.fillRect(0, 0, W, H); c.font = '28px "Courier New", monospace'; c.textBaseline = 'top';
        [['#86f08a', '> whoami'], ['#d6f5d6', 'arish singh'], ['#86f08a', '> role'], ['#d6f5d6', 'automation & full stack dev'], ['#86f08a', '> status'], ['#d6f5d6', 'building things that ship_']].forEach(([col, t], i) => { c.fillStyle = col; c.fillText(t, 24, 28 + i * 52); });
      });
      mesh(box(0.5, 0.42, 0.34), std(0xc8c2ae, 0.7), { parent: g, pos: [0.1, 1.03, -2.0], rot: [0, 0.12, 0] });
      mesh(box(0.34, 0.3, 0.26), std(0xbdb7a3, 0.7), { parent: g, pos: [0.1, 1.0, -2.2], rot: [0, 0.12, 0] });
      mesh(new THREE.PlaneGeometry(0.38, 0.29), screenMat(scr), { parent: g, pos: [0.1 + Math.sin(0.12) * 0.173, 1.05, -2.0 + Math.cos(0.12) * 0.173], rot: [0, 0.12, 0], solid: false, cast: false });
      mesh(box(0.44, 0.022, 0.15), std(0xc8c2ae, 0.7), { parent: g, pos: [0.12, 0.79, -1.78], rot: [0, 0.08, 0] });
      mesh(box(0.4, 0.008, 0.1), std(0x45423a, 0.8), { parent: g, pos: [0.12, 0.803, -1.78], rot: [0, 0.08, 0], solid: false });
      papers(ctx, g, 6, [-0.55, -1.95, 0.5, 0.35], 0.776, 5);
      // lamp, mug, books
      mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.02, 14), std(0x2a2a2a, 0.5, 0.6), { parent: g, pos: [-0.62, 0.785, -2.25] });
      mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6), std(0x2a2a2a, 0.5, 0.6), { parent: g, pos: [-0.62, 0.98, -2.25] });
      mesh(new THREE.ConeGeometry(0.12, 0.14, 16, 1, true), M.shade, { parent: g, pos: [-0.55, 1.18, -2.2], rot: [0.5, 0, 0.3], solid: false });
      mesh(new THREE.SphereGeometry(0.035, 8, 6), M.bulb, { parent: g, pos: [-0.55, 1.12, -2.2], solid: false, cast: false });
      mesh(new THREE.CylinderGeometry(0.04, 0.036, 0.09, 12), std(0xdadada, 0.4), { parent: g, pos: [0.55, 0.82, -1.95] });
      books(ctx, g, 0.62, 0.775, -2.3, 5, 3);
      const dc = chair(ctx, 0.15, -1.3, Math.PI + 0.35, M.paleWood);                       // desk chair with a cushion and a spindle back
      mesh(box(0.4, 0.05, 0.4), M.fabricRed, { parent: dc, pos: [0, 0.5, 0], solid: false });
      for (const sx of [-0.14, -0.047, 0.047, 0.14]) mesh(box(0.02, 0.4, 0.02), M.paleWood, { parent: dc, pos: [sx, 0.7, -0.2], solid: false });
      // armchair and a floor lamp by the west wall, a stack of papers and a box on the floor
      const ac = new THREE.Group(); ac.position.set(-2.35, 0, -0.95); ac.rotation.y = Math.PI / 2 + 0.25; g.add(ac);
      mesh(box(0.8, 0.28, 0.78), M.fabricRed, { parent: ac, pos: [0, 0.3, 0] });
      mesh(box(0.8, 0.5, 0.18), M.fabricRed, { parent: ac, pos: [0, 0.62, -0.3] });
      for (const sx of [-1, 1]) mesh(box(0.13, 0.28, 0.7), M.fabricRed, { parent: ac, pos: [sx * 0.34, 0.5, 0.02] });
      mesh(box(0.56, 0.1, 0.5), M.fabric, { parent: ac, pos: [0, 0.5, 0.07] });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(box(0.05, 0.14, 0.05), M.darkWood, { parent: ac, pos: [sx * 0.34, 0.07, sz * 0.32] });
      circ(-2.35, -0.95, 0.55);
      mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.02, 14), std(0x222222, 0.5, 0.6), { parent: g, pos: [-2.5, 0.01, -2.15] });
      mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.5, 6), std(0x222222, 0.5, 0.6), { parent: g, pos: [-2.5, 0.76, -2.15] });
      mesh(new THREE.CylinderGeometry(0.1, 0.17, 0.24, 16, 1, true), M.shade, { parent: g, pos: [-2.5, 1.55, -2.15], solid: false });
      mesh(new THREE.SphereGeometry(0.04, 8, 6), M.bulb, { parent: g, pos: [-2.5, 1.5, -2.15], solid: false, cast: false });
      circ(-2.5, -2.15, 0.22);
      for (let k = 0; k < 8; k++) mesh(box(0.22, 0.004, 0.3), M.paper[k % M.paper.length], { parent: g, pos: [1.0, 0.004 + k * 0.004, 1.4], rot: [0, 0.3 + k * 0.06, 0], solid: false, cast: false });
      mesh(box(0.42, 0.28, 0.34), M.crate, { parent: g, pos: [2.4, 0.14, -1.9], rot: [0, 0.35, 0] }); circ(2.4, -1.9, 0.3);
      // two small frames either side of the name board
      for (const [x, k] of [[-1.5, 1], [1.5, 2]]) { mesh(box(0.34, 0.26, 0.025), M.darkWood, { parent: g, pos: [x, 1.95, -hd + 0.02], solid: false }); mesh(new THREE.PlaneGeometry(0.28, 0.2), M.photos[k], { parent: g, pos: [x, 1.95, -hd + 0.034], solid: false, cast: false }); }
      // bookshelf on the door wall
      mesh(box(1.2, 2.0, 0.3), M.darkWood, { parent: g, pos: [-1.9, 1.0, hd - 0.17], kind: 'wood' });
      for (const [i, y] of [0.12, 0.6, 1.05, 1.5, 1.95].entries()) { mesh(box(1.12, 0.03, 0.28), M.paleWood, { parent: g, pos: [-1.9, y, hd - 0.21], solid: false }); if (i < 4) books(ctx, g, -2.4, y + 0.015, hd - 0.2, 8 + (i % 3), 40 + i); }
      circ(-1.9, hd - 0.2, 0.7); circ(0, -2.0, 0.55); circ(-0.5, -2.0, 0.4); circ(0.55, -2.0, 0.4);
      // framed photo, coat hook, bin
      const f = mesh(box(0.46, 0.36, 0.03), M.darkWood, { parent: g, pos: [1.7, 1.7, hd - 0.02], solid: false }); void f;
      mesh(new THREE.PlaneGeometry(0.38, 0.28), M.photos[0], { parent: g, pos: [1.7, 1.7, hd - 0.04], rot: [0, Math.PI, 0], solid: false, cast: false });
      mesh(new THREE.CylinderGeometry(0.13, 0.1, 0.28, 10, 1, true), std(0x3a3a3a, 0.6, 0.5), { parent: g, pos: [hw - 0.5, 0.14, -1.6], solid: false });
      circ(hw - 0.5, -1.6, 0.18);
    },
  },

  // ------------------------------------------------------------ decoy: a bedroom
  bedroom: {
    wall: 0xcdbfa6, floorKey: 'floorboards', light: 0xffc07a, fill: 0xffcfa0, lightK: 1.0, title: null,
    build(ctx) {
      const { g, mesh, box, circ, M, hw, hd } = ctx;
      mesh(new THREE.PlaneGeometry(2.4, 1.8), M.rug, { parent: g, pos: [0.9, 0.008, 0.2], rot: [-Math.PI / 2, 0, 0], solid: false, cast: false });
      // bed with its head against the north wall
      mesh(box(1.5, 0.3, 2.1), M.darkWood, { parent: g, pos: [-1.1, 0.25, -1.4], kind: 'wood' });
      mesh(box(1.4, 0.2, 2.0), M.linen, { parent: g, pos: [-1.1, 0.5, -1.4] });
      mesh(box(1.42, 0.07, 1.3), M.fabricRed, { parent: g, pos: [-1.1, 0.63, -0.95] });
      for (const sx of [-0.35, 0.35]) mesh(box(0.55, 0.12, 0.35), M.linen, { parent: g, pos: [-1.1 + sx, 0.66, -2.2], rot: [0.1, sx * 0.2, 0] });
      mesh(box(1.5, 0.85, 0.07), M.darkWood, { parent: g, pos: [-1.1, 0.75, -2.46], kind: 'wood' });
      circ(-1.1, -1.4, 0.95); circ(-1.1, -0.7, 0.8);
      // nightstand and lamp
      mesh(box(0.45, 0.55, 0.4), M.cabinet, { parent: g, pos: [-2.3, 0.28, -2.25], kind: 'wood' });
      mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.04, 10), M.metal, { parent: g, pos: [-2.3, 0.57, -2.25] });
      mesh(new THREE.CylinderGeometry(0.08, 0.15, 0.2, 14, 1, true), M.shade, { parent: g, pos: [-2.3, 0.8, -2.25], solid: false });
      mesh(new THREE.SphereGeometry(0.03, 8, 6), M.bulb, { parent: g, pos: [-2.3, 0.74, -2.25], solid: false, cast: false });
      circ(-2.3, -2.25, 0.3);
      // wardrobe against the east wall
      mesh(box(0.6, 2.05, 1.3), M.cabinet, { parent: g, pos: [hw - 0.35, 1.02, -0.6], kind: 'wood' });
      mesh(box(0.012, 1.9, 0.012), std(0x1a120a), { parent: g, pos: [hw - 0.66, 1.0, -0.6], solid: false });
      for (const dz of [-0.1, 0.1]) mesh(new THREE.SphereGeometry(0.018, 6, 4), M.metal, { parent: g, pos: [hw - 0.67, 1.0, -0.6 + dz], solid: false });
      circ(hw - 0.35, -0.6, 0.45); circ(hw - 0.35, -1.0, 0.4);
      // a chair with clothes on it, slippers, a suitcase
      const c = chair(ctx, 1.9, 1.5, Math.PI * 0.8, M.paleWood);
      mesh(box(0.4, 0.05, 0.4), M.fabric, { parent: c, pos: [0.02, 0.52, 0.04], rot: [0, 0.3, 0.1], solid: false });
      mesh(box(0.38, 0.4, 0.05), M.fabric, { parent: c, pos: [0, 0.72, -0.14], rot: [0.1, 0, 0.15], solid: false });
      for (const sx of [-0.1, 0.1]) mesh(box(0.1, 0.05, 0.26), std(0x6a4a3a, 0.95), { parent: g, pos: [-0.2 + sx, 0.025, -0.3], rot: [0, 0.2, 0], solid: false });
      mesh(box(0.7, 0.2, 0.45), std(0x3a2a22, 0.8), { parent: g, pos: [-2.3, 0.1, 1.5], rot: [0, 0.2, 0] }); circ(-2.3, 1.5, 0.4);
      mesh(box(0.5, 0.7, 0.02), M.mirror, { parent: g, pos: [1.5, 1.4, hd - 0.02], rot: [0, Math.PI, 0], solid: false });
    },
  },

  // ------------------------------------------------------------ PROJECTS: a workroom with a cork board
  workroom: {
    wall: 0xd8d4c4, floorKey: 'floor', light: 0xffd8a0, fill: 0xffe6c0, lightK: 1.4, title: corkBoard,
    build(ctx) {
      const { g, mesh, box, circ, M } = ctx;
      // long work table in the middle
      mesh(box(2.4, 0.05, 0.95), M.paleWood, { parent: g, pos: [0, 0.76, -0.35], kind: 'wood' });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(box(0.06, 0.74, 0.06), M.paleWood, { parent: g, pos: [sx * 1.12, 0.37, -0.35 + sz * 0.4], kind: 'wood' });
      mesh(box(2.2, 0.04, 0.8), M.paleWood, { parent: g, pos: [0, 0.22, -0.35], solid: false });
      circ(-0.8, -0.35, 0.6); circ(0, -0.35, 0.6); circ(0.8, -0.35, 0.6);
      // two open laptops with code on screen
      const code = canvasOf(512, 320, (c, W, H) => {
        c.fillStyle = '#1e1f26'; c.fillRect(0, 0, W, H); c.font = '20px "Courier New", monospace'; c.textBaseline = 'top';
        [['#c586c0', 'export default'], ['#569cd6', 'function Page() {'], ['#9cdcfe', '  const data = await'], ['#dcdcaa', '    fetch(url)'], ['#ce9178', "  return <Hero />"], ['#569cd6', '}']].forEach(([col, t], i) => { c.fillStyle = col; c.fillText(t, 20 + (i % 3 ? 12 : 0), 24 + i * 34); });
        c.fillStyle = '#2b2d38'; c.fillRect(0, 0, 130, H); c.fillStyle = '#6a737d'; for (let i = 0; i < 9; i++) c.fillRect(14, 24 + i * 30, 70 + (i * 13) % 40, 8);
      });
      for (const [x, ry] of [[-0.55, 0.15], [0.6, -0.2]]) {
        mesh(box(0.36, 0.018, 0.25), std(0x9a9ea4, 0.4, 0.6), { parent: g, pos: [x, 0.8, -0.3], rot: [0, ry, 0] });
        const lid = new THREE.Group(); lid.position.set(x - Math.sin(ry) * 0.12, 0.81, -0.3 - Math.cos(ry) * 0.12); lid.rotation.set(-0.28, ry, 0); g.add(lid);
        mesh(box(0.36, 0.24, 0.012), std(0x9a9ea4, 0.4, 0.6), { parent: lid, pos: [0, 0.12, 0] });
        mesh(new THREE.PlaneGeometry(0.33, 0.21), screenMat(code, 0.6), { parent: lid, pos: [0, 0.125, 0.007], solid: false, cast: false });
      }
      papers(ctx, g, 9, [0, -0.35, 1.9, 0.7], 0.786, 8);
      for (const [x, z, c] of [[-0.2, -0.1, 0xffe066], [-0.17, -0.12, 0xff9ec4], [0.95, -0.55, 0x9be28f]]) mesh(box(0.07, 0.006, 0.07), std(c, 0.9), { parent: g, pos: [x, 0.79, z], rot: [0, x * 3, 0], solid: false });
      for (const [x, z] of [[0.2, -0.1], [-1.0, -0.6]]) mesh(new THREE.CylinderGeometry(0.04, 0.036, 0.09, 12), std(0xdadada, 0.4), { parent: g, pos: [x, 0.83, z] });
      chair(ctx, -0.6, 0.4, Math.PI, M.darkWood); chair(ctx, 0.7, -1.2, 0.2, M.darkWood);
      // shelf of boxes and rolled plans on the door wall
      mesh(box(1.4, 0.04, 0.3), M.darkWood, { parent: g, pos: [1.7, 1.5, 2.33], solid: false });
      for (let i = 0; i < 4; i++) mesh(box(0.28, 0.24, 0.24), M.crate, { parent: g, pos: [1.2 + i * 0.32, 1.64, 2.32], solid: false });
      for (let i = 0; i < 3; i++) mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 8), std(0xe6e0d0, 0.9), { parent: g, pos: [-2.3 + i * 0.1, 0.45, 2.2], rot: [0.1, 0, 0.12], solid: false });
    },
  },

  // ------------------------------------------------------------ decoy: a bathroom
  bathroom: {
    wall: 0xc2cfca, floorKey: 'lino', light: 0xeef2ff, fill: 0xdce8ff, lightK: 1.0, title: null,
    build(ctx) {
      const { g, mesh, box, circ, M, hw, hd } = ctx;
      // tub along the north wall with a curtain
      mesh(box(1.75, 0.56, 0.78), M.enamel, { parent: g, pos: [-1.0, 0.28, -2.1] });
      mesh(box(1.55, 0.04, 0.58), std(0x24292c, 0.4), { parent: g, pos: [-1.0, 0.56, -2.1], solid: false });
      mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.18, 8), M.metal, { parent: g, pos: [-1.8, 0.95, -2.42] });
      mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.9, 6), M.metal, { parent: g, pos: [-1.0, 1.95, -1.72], rot: [0, 0, Math.PI / 2], solid: false });
      const cur = mesh(new THREE.PlaneGeometry(1.1, 1.8), new THREE.MeshStandardMaterial({ color: 0xd8dcc8, roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: 0.94 }), { parent: g, pos: [-1.5, 1.05, -1.72], solid: false });
      cur.rotation.y = 0.04;
      circ(-1.0, -2.0, 0.6); circ(-1.7, -2.0, 0.4);
      // toilet by the north-east corner
      mesh(box(0.38, 0.4, 0.2), M.porcelain, { parent: g, pos: [1.9, 0.62, -2.35] });
      mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.4, 16), M.porcelain, { parent: g, pos: [1.9, 0.2, -2.1] });
      mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 16), std(0xf2f0ea, 0.5), { parent: g, pos: [1.9, 0.42, -2.05] });
      circ(1.9, -2.1, 0.32);
      // pedestal sink and mirror on the east wall
      mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.7, 12), M.porcelain, { parent: g, pos: [hw - 0.35, 0.35, -0.5] });
      mesh(box(0.5, 0.14, 0.42), M.porcelain, { parent: g, pos: [hw - 0.3, 0.8, -0.5] });
      mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.12, 6), M.metal, { parent: g, pos: [hw - 0.1, 0.92, -0.5] });
      mesh(box(0.03, 0.8, 0.55), M.darkWood, { parent: g, pos: [hw - 0.03, 1.55, -0.5], solid: false });
      mesh(new THREE.PlaneGeometry(0.5, 0.75), M.mirror, { parent: g, pos: [hw - 0.05, 1.55, -0.5], rot: [0, -Math.PI / 2, 0], solid: false, cast: false });
      circ(hw - 0.35, -0.5, 0.35);
      // towel, mat, bin, a laundry basket
      mesh(box(0.02, 0.5, 0.28), std(0xb04a40, 0.95), { parent: g, pos: [hw - 0.02, 1.3, 0.35], solid: false });
      mesh(new THREE.PlaneGeometry(0.7, 0.45), M.rug, { parent: g, pos: [-0.6, 0.008, -1.4], rot: [-Math.PI / 2, 0, 0], solid: false, cast: false });
      mesh(new THREE.CylinderGeometry(0.17, 0.14, 0.28, 12, 1, true), std(0x4a5a5a, 0.7), { parent: g, pos: [-2.5, 0.14, -0.8], solid: false });
      mesh(new THREE.CylinderGeometry(0.25, 0.22, 0.55, 14), std(0xa68a62, 0.95), { parent: g, pos: [-2.5, 0.28, 1.6] }); circ(-2.5, 1.6, 0.28);
      void hd;
    },
  },

  // ------------------------------------------------------------ SKILLS: a workshop with a pegboard
  workshop: {
    wall: 0xb8ad98, floorKey: 'floor', light: 0xffd49a, fill: 0xffe0b0, lightK: 1.4, title: pegboard,
    build(ctx) {
      const { g, mesh, box, circ, M } = ctx;
      // heavy workbench against the north wall
      mesh(box(2.5, 0.07, 0.72), M.wood, { parent: g, pos: [0, 0.9, -2.1], kind: 'wood' });
      for (const sx of [-1, 1]) mesh(box(0.08, 0.88, 0.62), M.darkWood, { parent: g, pos: [sx * 1.15, 0.44, -2.1], kind: 'wood' });
      mesh(box(2.3, 0.04, 0.6), M.wood, { parent: g, pos: [0, 0.3, -2.1], solid: false });
      circ(-0.8, -2.0, 0.5); circ(0, -2.0, 0.5); circ(0.8, -2.0, 0.5);
      mesh(box(0.5, 0.22, 0.2), std(0xa8281f, 0.45, 0.4), { parent: g, pos: [-0.7, 1.04, -2.05] });                                  // red toolbox
      mesh(box(0.54, 0.03, 0.22), std(0x8a2019, 0.45, 0.4), { parent: g, pos: [-0.7, 1.16, -2.05], solid: false });
      mesh(box(0.16, 0.1, 0.12), std(0x2a2a2e, 0.4, 0.7), { parent: g, pos: [0.95, 1.0, -2.05] });                                      // vise
      mesh(box(0.03, 0.02, 0.3), std(0x2a2a2e, 0.4, 0.7), { parent: g, pos: [0.95, 1.05, -1.85], solid: false });
      mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.24, 6), std(0x6b4a2b, 0.8), { parent: g, pos: [0.1, 0.94, -1.95], rot: [0, 0, Math.PI / 2], solid: false });
      mesh(box(0.1, 0.05, 0.05), std(0x7e8387, 0.4, 0.8), { parent: g, pos: [0.22, 0.95, -1.95], solid: false });
      papers(ctx, g, 3, [0.2, -2.1, 0.8, 0.4], 0.94, 77);
      // stool, bucket, sawhorse, oil drum
      const s = new THREE.Group(); s.position.set(0.5, 0, -1.3); g.add(s);
      mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 14), M.wood, { parent: s, pos: [0, 0.6, 0] });
      for (let i = 0; i < 3; i++) { const a = i * 2.09; mesh(box(0.03, 0.6, 0.03), M.wood, { parent: s, pos: [Math.cos(a) * 0.13, 0.3, Math.sin(a) * 0.13], rot: [Math.sin(a) * 0.1, 0, -Math.cos(a) * 0.1] }); }
      circ(0.5, -1.3, 0.25);
      mesh(new THREE.CylinderGeometry(0.17, 0.14, 0.3, 14, 1, true), std(0x7a8a90, 0.5, 0.6), { parent: g, pos: [-1.9, 0.15, -1.7], solid: false }); circ(-1.9, -1.7, 0.2);
      mesh(box(0.9, 0.06, 0.12), M.wood, { parent: g, pos: [-1.2, 0.65, 0.4], kind: 'wood' });
      for (const sx of [-1, 1]) mesh(box(0.06, 0.65, 0.06), M.wood, { parent: g, pos: [-1.2 + sx * 0.36, 0.32, 0.4], rot: [0, 0, sx * 0.25], solid: false });
      circ(-1.2, 0.4, 0.5);
      // a bare work-lamp hanging on a cord
      mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.7, 4), std(0x111111), { parent: g, pos: [0.4, 2.65, -1.0], solid: false });
      mesh(new THREE.SphereGeometry(0.05, 10, 8), M.bulb, { parent: g, pos: [0.4, 2.28, -1.0], solid: false, cast: false });
      mesh(new THREE.SphereGeometry(0.1, 10, 8, 0, 6.3, 0, 1.6), new THREE.MeshStandardMaterial({ color: 0x777777, wireframe: true }), { parent: g, pos: [0.4, 2.28, -1.0], solid: false, cast: false });
    },
  },

  // ------------------------------------------------------------ decoy: a storage room
  storage: {
    wall: 0xb0a690, floorKey: 'cellarFloor', light: 0xffd08a, fill: 0xffdda0, lightK: 0.9, title: null,
    build(ctx) {
      const { g, mesh, box, circ, M, hw } = ctx;
      const rack = (x, z, w) => {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(box(0.04, 1.9, 0.04), std(0x3a4a5a, 0.5, 0.6), { parent: g, pos: [x + sx * w / 2, 0.95, z + sz * 0.22], solid: false });
        for (const y of [0.2, 0.75, 1.3, 1.85]) mesh(box(w, 0.03, 0.46), M.plywood || M.wood, { parent: g, pos: [x, y, z], solid: false });
        const r = rngOf(Math.floor(x * 100 + z));
        for (const y of [0.2, 0.75, 1.3]) { let px = x - w / 2 + 0.2; while (px < x + w / 2 - 0.2) { const bw = 0.28 + r() * 0.2, bh = 0.2 + r() * 0.22; mesh(box(bw, bh, 0.34), std(0xa9835a + Math.floor(r() * 0x101010), 0.95), { parent: g, pos: [px + bw / 2, y + 0.015 + bh / 2, z], solid: false }); px += bw + 0.05; } }
        circ(x, z, w / 2 + 0.1);
      };
      rack(-1.6, -2.15, 1.5); rack(1.5, -2.15, 1.5);
      mesh(box(0.5, 1.2, 0.5), M.linen, { parent: g, pos: [hw - 0.5, 0.6, 0.2], rot: [0, 0.3, 0] }); mesh(box(0.8, 0.6, 0.8), M.linen, { parent: g, pos: [hw - 0.6, 0.3, 1.2], rot: [0, 0.6, 0] }); circ(hw - 0.5, 0.2, 0.45); circ(hw - 0.6, 1.2, 0.5);   // furniture under dust sheets
      mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.3, 14, 1, true), std(0x9aa5aa, 0.5, 0.6), { parent: g, pos: [-2.4, 0.15, 1.5], solid: false });
      mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.3, 6), M.wood, { parent: g, pos: [-2.4, 0.7, 1.45], rot: [0.12, 0, 0.1], solid: false }); circ(-2.4, 1.5, 0.25);
      for (let i = 0; i < 3; i++) mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.17, 10), std([0x8a2a20, 0x2a5a8a, 0xc8c8b0][i], 0.5, 0.4), { parent: g, pos: [-1.6 + i * 0.17, 0.13 + (i === 2 ? 0.17 : 0), -0.4 + (i === 2 ? 0.08 : 0)], solid: false });
      mesh(box(0.5, 0.35, 0.4), M.crate, { parent: g, pos: [0.2, 0.18, 1.5], rot: [0, 0.4, 0] }); circ(0.2, 1.5, 0.35);
    },
  },

  // ------------------------------------------------------------ UPCOMING PLANS: a whiteboard and a desk
  plans: {
    wall: 0xe0d8c4, floorKey: 'floorboards', light: 0xffd49a, fill: 0xffe3b8, lightK: 1.4, title: whiteboard,
    build(ctx) {
      const { g, mesh, box, circ, M, hd } = ctx;
      mesh(new THREE.PlaneGeometry(2.4, 1.6), M.rug, { parent: g, pos: [0, 0.008, 0], rot: [-Math.PI / 2, 0, 0], solid: false, cast: false });
      // a round table with a notebook, coffee and a pen, two chairs
      mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.045, 24), M.paleWood, { parent: g, pos: [0, 0.74, -0.3], kind: 'wood' });
      mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.72, 10), M.paleWood, { parent: g, pos: [0, 0.37, -0.3] });
      mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 18), M.paleWood, { parent: g, pos: [0, 0.015, -0.3], solid: false });
      circ(0, -0.3, 0.6);
      const note = canvasOf(512, 384, (c, W, H) => { c.fillStyle = '#f2eee0'; c.fillRect(0, 0, W, H); c.strokeStyle = 'rgba(60,90,160,0.4)'; c.lineWidth = 2; for (let y = 50; y < H; y += 34) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); } c.strokeStyle = 'rgba(200,60,60,0.5)'; c.beginPath(); c.moveTo(70, 0); c.lineTo(70, H); c.stroke(); c.fillStyle = '#1c2a44'; c.font = `34px ${HAND}`; ['eclipse protocol -', 'finish the build', 'ship the trailer', 'then: next world'].forEach((t, i) => c.fillText(t, 90, 44 + i * 34 * 1.0 + i * 0.5)); });
      mesh(new THREE.PlaneGeometry(0.3, 0.22), paperMat(note), { parent: g, pos: [-0.1, 0.766, -0.25], rot: [-Math.PI / 2, 0, 0.3], solid: false, cast: false });
      mesh(new THREE.CylinderGeometry(0.038, 0.034, 0.09, 12), std(0xdadada, 0.4), { parent: g, pos: [0.25, 0.81, -0.4] });
      mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 5), std(0x203a8a, 0.4), { parent: g, pos: [-0.3, 0.77, -0.45], rot: [Math.PI / 2, 0, 0.6], solid: false });
      chair(ctx, -0.2, 0.45, Math.PI - 0.2, M.darkWood); chair(ctx, 0.6, -0.9, 0.4, M.darkWood);
      // wall calendar and sticky notes on the door wall
      const cal = canvasOf(384, 512, (c, W, H) => {
        c.fillStyle = '#efe9d8'; c.fillRect(0, 0, W, H); c.fillStyle = '#7a2a24'; c.fillRect(0, 0, W, 96); c.fillStyle = '#fff'; c.font = 'bold 54px Georgia, serif'; c.textAlign = 'center'; c.fillText('2027', W / 2, 66);
        c.fillStyle = '#222'; c.font = '26px Helvetica, Arial'; for (let i = 0; i < 7; i++) c.fillText('MTWTFSS'[i], 36 + i * 52, 134);
        for (let d = 0; d < 35; d++) { const x = 36 + (d % 7) * 52, y = 184 + Math.floor(d / 7) * 56; c.fillStyle = d === 12 ? '#c0392b' : '#333'; c.fillText(String((d % 31) + 1), x, y); }
        c.strokeStyle = '#c0392b'; c.lineWidth = 5; c.beginPath(); c.ellipse(36 + 5 * 52 + 12, 184 + 56 - 8, 24, 20, 0, 0, 7); c.stroke();
      });
      mesh(box(0.42, 0.56, 0.02), M.darkWood, { parent: g, pos: [1.8, 1.65, hd - 0.02], solid: false });
      mesh(new THREE.PlaneGeometry(0.38, 0.5), paperMat(cal), { parent: g, pos: [1.8, 1.65, hd - 0.035], rot: [0, Math.PI, 0], solid: false, cast: false });
      for (const [x, y, c] of [[0.9, 1.9, 0xffe066], [1.05, 1.6, 0xff9ec4], [0.85, 1.4, 0x9be28f]]) mesh(box(0.1, 0.1, 0.004), std(c, 0.9), { parent: g, pos: [x, y, hd - 0.012], rot: [0, 0, x * 2], solid: false });
    },
  },

  // ------------------------------------------------------------ decoy: a trapdoor going down
  trapdoor: {
    wall: 0x9a9080, floorKey: 'floorboards', light: 0xffb870, fill: 0xffc890, lightK: 0.85, title: null,
    build(ctx) {
      const { g, mesh, box, circ, M } = ctx;
      mesh(new THREE.PlaneGeometry(0.95, 0.95), new THREE.MeshBasicMaterial({ color: 0x010101 }), { parent: g, pos: [0, 0.012, -0.5], rot: [-Math.PI / 2, 0, 0], solid: false, cast: false });   // the hole: pure black
      for (const [x, z, w, d] of [[0, -0.5 - 0.51, 1.15, 0.1], [0, -0.5 + 0.51, 1.15, 0.1], [-0.51, -0.5, 0.1, 0.95], [0.51, -0.5, 0.1, 0.95]]) mesh(box(w, 0.03, d), M.darkWood, { parent: g, pos: [x, 0.015, z], kind: 'wood' });
      const lid = new THREE.Group(); lid.position.set(0, 0.03, -1.0); lid.rotation.x = -1.25; g.add(lid);            // the hatch, thrown open against the far side
      mesh(box(0.95, 0.05, 0.95), M.wood, { parent: lid, pos: [0, 0, 0.475], kind: 'wood' });
      mesh(box(0.08, 0.02, 0.8), M.darkWood, { parent: lid, pos: [0.25, 0.035, 0.475], solid: false });
      mesh(box(0.08, 0.02, 0.8), M.darkWood, { parent: lid, pos: [-0.25, 0.035, 0.475], solid: false });
      mesh(new THREE.TorusGeometry(0.05, 0.01, 6, 14), M.metal, { parent: lid, pos: [0, 0.04, 0.85], rot: [Math.PI / 2, 0, 0], solid: false });
      for (const sx of [-0.32, 0.32]) mesh(box(0.045, 0.7, 0.045), M.wood, { parent: g, pos: [sx, 0.3, -0.06], rot: [0.32, 0, 0], solid: false });  // ladder rails poking out of the hole
      for (const y of [0.1, 0.35, 0.58]) mesh(box(0.6, 0.03, 0.04), M.wood, { parent: g, pos: [0, y, -0.06 + (y - 0.3) * 0.33], solid: false });
      circ(0, -0.5, 0.62);
      // a hurricane lantern and a coil of rope left beside it
      mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.04, 10), std(0x2a2a2a, 0.5, 0.6), { parent: g, pos: [0.9, 0.02, 0.2] });
      mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.35, roughness: 0.2 }), { parent: g, pos: [0.9, 0.14, 0.2], solid: false });
      mesh(new THREE.SphereGeometry(0.03, 8, 6), M.bulb, { parent: g, pos: [0.9, 0.12, 0.2], solid: false, cast: false });
      mesh(new THREE.TorusGeometry(0.14, 0.03, 8, 20), std(0xb09a6a, 0.95), { parent: g, pos: [-0.9, 0.03, 0.4], rot: [Math.PI / 2, 0, 0], solid: false });
    },
  },

  // ------------------------------------------------------------ CONTACTS: a reception desk with a phone
  reception: {
    wall: 0xd8ccb0, floorKey: 'floorboards', light: 0xffcf90, fill: 0xffdcb0, lightK: 1.4, title: 'paper', titleBox: { w: 2.3, h: 1.15, y: 1.95 },
    build(ctx) {
      const { g, mesh, box, circ, M, hd } = ctx;
      mesh(new THREE.PlaneGeometry(2.2, 1.5), M.rug, { parent: g, pos: [0, 0.008, 0.3], rot: [-Math.PI / 2, 0, 0], solid: false, cast: false });
      // counter against the north wall
      mesh(box(2.0, 0.05, 0.7), M.darkWood, { parent: g, pos: [0, 0.98, -2.1], kind: 'wood' });
      mesh(box(1.9, 0.95, 0.62), M.darkWood, { parent: g, pos: [0, 0.48, -2.1], kind: 'wood' });
      circ(-0.6, -2.0, 0.5); circ(0, -2.0, 0.5); circ(0.6, -2.0, 0.5);
      // rotary phone
      const ph = new THREE.Group(); ph.position.set(0.55, 1.0, -2.0); ph.rotation.y = 0.35; g.add(ph);
      mesh(box(0.22, 0.07, 0.2), std(0x151515, 0.35, 0.2), { parent: ph, pos: [0, 0.035, 0] });
      mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.015, 16), std(0xcfcfcf, 0.3, 0.7), { parent: ph, pos: [0, 0.078, 0.01] });
      mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8), std(0x151515, 0.35, 0.2), { parent: ph, pos: [0, 0.115, -0.02], rot: [0, 0, Math.PI / 2] });
      for (const sx of [-1, 1]) mesh(new THREE.SphereGeometry(0.035, 10, 8), std(0x151515, 0.35, 0.2), { parent: ph, pos: [sx * 0.1, 0.115, -0.02] });
      // ledger, letters, brass bell, lamp
      mesh(box(0.34, 0.03, 0.24), std(0x3a2a22, 0.8), { parent: g, pos: [-0.35, 1.02, -2.0], rot: [0, 0.1, 0] });
      mesh(box(0.3, 0.012, 0.2), std(0xe8e0c8, 0.9), { parent: g, pos: [-0.35, 1.04, -2.0], rot: [0, 0.1, 0], solid: false });
      papers(ctx, g, 5, [-0.8, -2.15, 0.35, 0.3], 1.006, 15);
      mesh(new THREE.SphereGeometry(0.05, 14, 8, 0, 6.3, 0, 1.6), std(0xc8a040, 0.3, 0.9), { parent: g, pos: [0.15, 1.01, -1.9] });
      mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.02, 12), std(0x6a5a20, 0.4, 0.8), { parent: g, pos: [0.9, 1.01, -2.2] });
      mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), std(0x6a5a20, 0.4, 0.8), { parent: g, pos: [0.9, 1.16, -2.2] });
      mesh(new THREE.ConeGeometry(0.1, 0.12, 14, 1, true), M.shade, { parent: g, pos: [0.9, 1.35, -2.2], solid: false });
      mesh(new THREE.SphereGeometry(0.03, 8, 6), M.bulb, { parent: g, pos: [0.9, 1.3, -2.2], solid: false, cast: false });
      // pigeonholes full of letters on the door wall
      mesh(box(1.5, 1.2, 0.2), M.darkWood, { parent: g, pos: [1.2, 1.4, hd - 0.12], kind: 'wood' });
      const r = rngOf(9);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
        mesh(box(0.3, 0.26, 0.17), std(0x120c08, 1), { parent: g, pos: [0.67 + i * 0.35, 1.0 + j * 0.35, hd - 0.2], solid: false });
        if (r() < 0.75) mesh(box(0.24, 0.17, 0.012), std(0xe8e2cc, 0.9), { parent: g, pos: [0.67 + i * 0.35, 1.0 + j * 0.35 - 0.02, hd - 0.255], rot: [0, 0, (r() - 0.5) * 0.3], solid: false });
      }
      circ(1.2, hd - 0.15, 0.8);
      // signposts standing in the room, one per place to find me; look at one and press Enter to open it
      const spots = [[-1.65, 0.15, 0.22], [-0.55, -0.7, -0.12], [0.55, -0.7, 0.1], [1.65, 0.15, -0.2]];
      (ctx.sec.signs || []).slice(0, 4).forEach((sg, i) => {
        const [x, z, ry] = spots[i], q = new THREE.Group(); q.position.set(x, 0, z); q.rotation.y = ry; g.add(q);
        const barrel = mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.62, 18), M.darkWood, { parent: q, pos: [0, 0.31, 0], kind: 'wood' });
        for (const y of [0.12, 0.5]) mesh(new THREE.TorusGeometry(0.285 - (y < 0.3 ? 0.012 : -0.01), 0.011, 6, 28), std(0x3a3a3c, 0.5, 0.7), { parent: q, pos: [0, y, 0], rot: [Math.PI / 2, 0, 0], solid: false });
        mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 18), std(0x4a3a2a, 0.95), { parent: q, pos: [0, 0.625, 0], solid: false });
        const h = 1.25 + (i % 2) * 0.12;
        mesh(box(0.07, h, 0.07), M.wood, { parent: q, pos: [0, 0.6 + h / 2 - 0.1, 0], rot: [0, 0, (i - 1.5) * 0.02], kind: 'wood' });
        const wood = std(0x8a7656, 0.95), face = paperMat(signPlank(sg.label, sg.sub));
        const plank = mesh(box(0.98, 0.39, 0.045), [wood, wood, wood, wood, face, wood], { parent: q, pos: [0, 0.6 + h - 0.3, 0.06], rot: [0, 0, (i % 2 ? -1 : 1) * 0.06], kind: 'wood' });
        ctx.addLink(plank, sg.link);
        void barrel; circ(x, z, 0.36);
      });
      chair(ctx, -2.3, 1.7, 0.7, M.paleWood);
    },
  },

  // ------------------------------------------------------------ BYE: the entrance, coats on the rack, a window to the sunset
  hallway: {
    wall: 0xd8c6a8, floorKey: 'floorboards', light: 0xffb866, fill: 0xffc88a, lightK: 1.2, title: 'paper', titleBox: { w: 2.0, h: 1.0, y: 1.95 },
    build(ctx) {
      const { g, mesh, box, circ, M, hw, hd } = ctx;
      mesh(new THREE.PlaneGeometry(1.4, 0.9), M.rug, { parent: g, pos: [0, 0.008, -0.1], rot: [-Math.PI / 2, 0, 0], solid: false, cast: false });
      // window on the east wall with curtains and warm evening light
      mesh(box(0.06, 1.3, 1.1), M.darkWood, { parent: g, pos: [hw - 0.03, 1.55, 0.2], solid: false });
      mesh(new THREE.PlaneGeometry(1.0, 1.2), M.windowView, { parent: g, pos: [hw - 0.07, 1.55, 0.2], rot: [0, -Math.PI / 2, 0], solid: false, cast: false });
      for (const dz of [-0.6, 1.0]) mesh(box(0.05, 1.6, 0.3), M.fabricRed, { parent: g, pos: [hw - 0.1, 1.45, 0.2 + dz], solid: false });
      mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.6, 6), M.metal, { parent: g, pos: [hw - 0.1, 2.3, 0.2], rot: [Math.PI / 2, 0, 0], solid: false });
      // coat rack with two coats and a hat
      const cx = -2.3, cz = 1.6;
      mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.8, 8), M.darkWood, { parent: g, pos: [cx, 0.9, cz], kind: 'wood' });
      mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.04, 14), M.darkWood, { parent: g, pos: [cx, 0.02, cz] });
      for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.4; mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.16, 5), M.darkWood, { parent: g, pos: [cx + Math.cos(a) * 0.09, 1.7, cz + Math.sin(a) * 0.09], rot: [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], solid: false }); }
      mesh(box(0.34, 0.9, 0.2), std(0x2a3036, 0.95), { parent: g, pos: [cx + 0.14, 1.2, cz + 0.12], rot: [0, 0.5, 0.05] });
      mesh(box(0.3, 0.7, 0.18), std(0x5a4a38, 0.95), { parent: g, pos: [cx - 0.12, 1.28, cz - 0.1], rot: [0, -0.4, -0.05] });
      mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.09, 14), std(0x2a2a2a, 0.9), { parent: g, pos: [cx, 1.85, cz] });
      circ(cx, cz, 0.3);
      // boots by the door, an umbrella stand, a rucksack
      for (const sx of [-0.1, 0.1]) mesh(box(0.1, 0.18, 0.28), std(0x3a2a1a, 0.85), { parent: g, pos: [-1.4 + sx, 0.09, 2.1], rot: [0, 0.2, 0], solid: false });
      mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.55, 14, 1, true), std(0x3a4a58, 0.7, 0.4), { parent: g, pos: [2.5, 0.28, 2.1], solid: false });
      mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 5), std(0x151515, 0.8), { parent: g, pos: [2.5, 0.65, 2.1], rot: [0.1, 0, 0.1], solid: false }); circ(2.5, 2.1, 0.2);
      mesh(box(0.34, 0.5, 0.22), std(0x4a5a3a, 0.9), { parent: g, pos: [-2.3, 0.25, -1.9], rot: [0, 0.5, 0] }); circ(-2.3, -1.9, 0.3);
      // a small table with keys and a note
      mesh(box(0.8, 0.04, 0.35), M.darkWood, { parent: g, pos: [0, 0.8, -2.2], kind: 'wood' });
      for (const sx of [-1, 1]) mesh(box(0.04, 0.8, 0.04), M.darkWood, { parent: g, pos: [sx * 0.36, 0.4, -2.2], solid: false });
      mesh(new THREE.TorusGeometry(0.03, 0.005, 6, 14), M.metal, { parent: g, pos: [-0.15, 0.825, -2.2], rot: [Math.PI / 2, 0, 0], solid: false });
      mesh(box(0.05, 0.004, 0.09), M.metal, { parent: g, pos: [-0.1, 0.823, -2.17], rot: [0, 0.6, 0], solid: false });
      circ(0, -2.15, 0.45);
      void hd;
    },
  },
};
