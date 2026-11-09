// Procedural Canvas-2D textures + the material library.
//
// SWAPPING FOR REAL PBR SETS (e.g. Poly Haven):
// Every surface in the scene asks `createMaterials()` for a material by name
// ('wall', 'floor', 'ceiling', ...). To use downloaded sets, replace the body of
// the matching entry with TextureLoader loads, e.g.
//   const tl = new THREE.TextureLoader();
//   wall: new THREE.MeshStandardMaterial({
//     map: srgb(tl.load('/pbr/plaster/diff_1k.jpg')),
//     normalMap: tl.load('/pbr/plaster/nor_gl_1k.jpg'),
//     roughnessMap: tl.load('/pbr/plaster/rough_1k.jpg'),
//   })
// Geometry UVs are already scaled in metres-per-tile (see TILE in main.js), so
// tiling stays correct as long as each set covers TILE metres.

import * as THREE from 'three';

// ---------------------------------------------------------------- helpers
export function rng(seed = 1) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function mk(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

// Periodic value-noise fBm: tiles perfectly at `size`.
export function tileNoise(size, cells, octaves, r, persistence = 0.5) {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0, c = cells;
  for (let o = 0; o < octaves; o++) {
    const L = new Float32Array(c * c);
    for (let i = 0; i < L.length; i++) L[i] = r();
    const s = c / size;
    for (let y = 0; y < size; y++) {
      const fy = y * s, y0 = Math.floor(fy);
      let ty = fy - y0; ty = ty * ty * (3 - 2 * ty);
      const ya = (y0 % c) * c, yb = ((y0 + 1) % c) * c;
      for (let x = 0; x < size; x++) {
        const fx = x * s, x0 = Math.floor(fx);
        let tx = fx - x0; tx = tx * tx * (3 - 2 * tx);
        const xa = x0 % c, xb = (x0 + 1) % c;
        const v = lerp(lerp(L[ya + xa], L[ya + xb], tx), lerp(L[yb + xa], L[yb + xb], tx), ty);
        out[y * size + x] += v * amp;
      }
    }
    total += amp; amp *= persistence; c *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// call fn at the 9 wrapped copies so features tile seamlessly
function wrap9(size, fn) {
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) fn(dx * size, dy * size);
}
function wrapX(size, fn) { for (let dx = -1; dx <= 1; dx++) fn(dx * size, 0); }

function blobPath(g, cx, cy, rad, r, irr = 0.5, n = 16) {
  // smooth irregular blob (quadratic curves through edge midpoints)
  irr = Math.min(irr, 0.32);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, k = 1 + (r() - 0.5) * irr * 2;
    pts.push([cx + Math.cos(a) * rad * k, cy + Math.sin(a) * rad * k * 0.85]);
  }
  g.beginPath();
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  let m0 = mid(pts[n - 1], pts[0]);
  g.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) { const p = pts[i], m = mid(p, pts[(i + 1) % n]); g.quadraticCurveTo(p[0], p[1], m[0], m[1]); }
  g.closePath();
}

function crackPoints(x, y, len, r, ang = r() * Math.PI * 2) {
  const pts = [[x, y]];
  let a = ang;
  const steps = Math.max(4, Math.floor(len / 6));
  for (let i = 0; i < steps; i++) {
    a += (r() - 0.5) * 0.9;
    x += Math.cos(a) * (len / steps); y += Math.sin(a) * (len / steps);
    pts.push([x, y]);
  }
  return pts;
}
function strokePts(g, pts, ox = 0, oy = 0) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x + ox, y + oy) : g.moveTo(x + ox, y + oy)));
  g.stroke();
}

function speckle(g, size, count, r, colors, maxR = 1.6) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    const x = r() * size, y = r() * size, rr = 0.4 + r() * maxR;
    g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
  }
}

// Tangent-space (OpenGL, +Y up) normal map from a grey height canvas. Real per-pixel
// relief instead of bump mapping; also the slot a downloaded *_nor_gl map would fill.
export function heightToNormal(src, strength = 3, wrapY = true) {
  const w = src.width, h = src.height;
  const d = src.getContext('2d').getImageData(0, 0, w, h).data;
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) H[i] = d[i * 4] / 255;
  const [c, g] = mk(w, h), img = g.createImageData(w, h), o = img.data;
  for (let y = 0; y < h; y++) {
    const yu = wrapY ? (y - 1 + h) % h : Math.max(0, y - 1), yd = wrapY ? (y + 1) % h : Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w, xr = (x + 1) % w;
      const dx = (H[y * w + xr] - H[y * w + xl]) * strength;
      const dy = (H[yd * w + x] - H[yu * w + x]) * strength;   // canvas y runs opposite to texture v
      const nx = -dx, ny = dy, nz = 1, l = Math.hypot(nx, ny, nz), k = (y * w + x) * 4;
      o[k] = (nx / l * 0.5 + 0.5) * 255; o[k + 1] = (ny / l * 0.5 + 0.5) * 255; o[k + 2] = (nz / l * 0.5 + 0.5) * 255; o[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// soft contact-shadow gradient (dark edge -> clear), used for fake ambient occlusion strips
export function aoGradientTexture(darkAtTop = true) {
  const [c, g] = mk(4, 128);
  const gr = g.createLinearGradient(0, 0, 0, 128);
  const stops = [[0, 1], [0.12, 0.62], [0.35, 0.25], [0.7, 0.06], [1, 0]];
  for (const [t, a] of stops) gr.addColorStop(darkAtTop ? t : 1 - t, `rgba(255,255,255,${a})`);
  g.fillStyle = '#000'; g.fillRect(0, 0, 4, 128);
  g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
  return c;
}

// ---------------------------------------------------------------- walls
export function wallTextures(size = 1024, seed = 11) {
  const r = rng(seed);
  const n1 = tileNoise(size, 4, 6, r), n2 = tileNoise(size, 32, 3, r), n3 = tileNoise(size, 8, 4, r);
  const [c, g] = mk(size), [b, bg] = mk(size), [rc, rg] = mk(size);
  const ci = g.createImageData(size, size), bi = bg.createImageData(size, size), ri = rg.createImageData(size, size);
  // texture v runs top (0) -> floor (1) over the 3 m wall height
  const RAIL0 = 1 - 1.23 / 3, RAIL1 = 1 - 1.18 / 3, SKIRT = 1 - 0.13 / 3;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    const zone = v < RAIL0 ? 0 : v < RAIL1 ? 1 : v < SKIRT ? 2 : 3;   // upper plaster, rail, gloss dado, skirting
    const base = [[214, 199, 163], [78, 70, 56], [104, 114, 94], [46, 41, 36]][zone];
    for (let x = 0; x < size; x++) {
      const i = y * size + x, o = i * 4;
      const a = n1[i], f = n2[i], m = n3[i];
      const s = 0.86 + (a - 0.5) * 0.3 + (f - 0.5) * (zone === 0 ? 0.1 : 0.04);
      let R = base[0] * s, G = base[1] * s, B = base[2] * s;
      const dv = v + (m - 0.5) * 0.22;
      const damp = sstep(0.7, 0.98, dv);
      R = lerp(R, 116, damp * 0.6); G = lerp(G, 96, damp * 0.6); B = lerp(B, 64, damp * 0.6);
      const tl = Math.exp(-Math.pow((dv - 0.7) / 0.007, 2));
      R -= tl * 38; G -= tl * 38; B -= tl * 32;
      const soot = sstep(0.2, 0.0, v + (a - 0.5) * 0.14);
      R *= 1 - soot * 0.5; G *= 1 - soot * 0.52; B *= 1 - soot * 0.55;
      ci.data[o] = R; ci.data[o + 1] = G; ci.data[o + 2] = B; ci.data[o + 3] = 255;
      // height: rough plaster above, smooth oil paint below, raised rail and skirting
      let h = 128 + (a - 0.5) * 40 + (m - 0.5) * 30 + (f - 0.5) * (zone === 0 ? 120 : 30);
      if (zone === 1) h += 60 * Math.sin(((v - RAIL0) / (RAIL1 - RAIL0)) * Math.PI);
      if (zone === 3) h += 45 - Math.min(40, (v - SKIRT) * size * 4);
      bi.data[o] = bi.data[o + 1] = bi.data[o + 2] = h; bi.data[o + 3] = 255;
      // roughness: matte distemper above, satin gloss paint below; damp patches go matte
      let rough = [236, 150, 108, 140][zone] + (f - 0.5) * 30 + damp * 60;
      ri.data[o] = ri.data[o + 1] = ri.data[o + 2] = Math.min(255, rough); ri.data[o + 3] = 255;
    }
  }
  g.putImageData(ci, 0, 0); bg.putImageData(bi, 0, 0); rg.putImageData(ri, 0, 0);

  // broad stains
  for (let k = 0; k < 45; k++) {
    const x = r() * size, y = r() * size, rad = 20 + r() * 140, al = 0.04 + r() * 0.1;
    wrapX(size, (dx) => {
      const gr = g.createRadialGradient(x + dx, y, 0, x + dx, y, rad);
      gr.addColorStop(0, `rgba(96,74,42,${al})`); gr.addColorStop(1, 'rgba(96,74,42,0)');
      g.fillStyle = gr; g.fillRect(x + dx - rad, y - rad, rad * 2, rad * 2);
    });
  }
  // water drips from the top and from stain sources
  for (let k = 0; k < 90; k++) {
    const x = r() * size;
    const y0 = r() < 0.65 ? r() * size * 0.12 : r() * size * 0.55;
    const len = size * (0.06 + r() * 0.5), w = 0.8 + r() * 2.8, al = 0.12 + r() * 0.3;
    wrapX(size, (dx) => {
      const gr = g.createLinearGradient(0, y0, 0, y0 + len);
      gr.addColorStop(0, `rgba(88,66,36,${al})`);
      gr.addColorStop(0.6, `rgba(88,66,36,${al * 0.6})`);
      gr.addColorStop(1, 'rgba(88,66,36,0)');
      g.strokeStyle = gr; g.lineWidth = w;
      g.beginPath(); g.moveTo(x + dx, y0);
      const steps = 24, ph = r() * 10;
      for (let i = 1; i <= steps; i++) g.lineTo(x + dx + Math.sin(ph + i * 0.7) * 1.2, y0 + (len * i) / steps);
      g.stroke();
    });
  }
  // peeled paint patches
  for (let k = 0; k < 14; k++) {
    const x = r() * size, y = size * (0.08 + r() * 0.86), rad = 6 + r() * 36;
    const sd = Math.floor(r() * 1e9);
    const onDado = y / size > 1 - 1.23 / 3;
    // what shows underneath: grey plaster above, an older faded coat on the gloss dado
    const fillCol = onDado ? `rgba(${118 + r() * 12},${120 + r() * 10},${104 + r() * 8},0.75)` : `rgba(${168 + r() * 16},${162 + r() * 12},${146 + r() * 10},0.9)`;
    const edgeCol = onDado ? 'rgba(150,160,138,0.35)' : 'rgba(240,232,212,0.45)';
    wrapX(size, (dx) => {
      const pr = rng(sd);
      blobPath(g, x + dx + 1.5, y + 2, rad, pr, 0.55, 18);
      g.strokeStyle = 'rgba(40,32,22,0.25)'; g.lineWidth = 2.5; g.stroke();
      blobPath(g, x + dx, y, rad, rng(sd), 0.55, 18);
      g.fillStyle = fillCol; g.fill();
      g.strokeStyle = edgeCol; g.lineWidth = 1.1; g.stroke();
      blobPath(bg, x + dx, y, rad, rng(sd), 0.55, 18);
      bg.fillStyle = 'rgb(100,100,100)'; bg.fill();
      bg.strokeStyle = 'rgb(175,175,175)'; bg.lineWidth = 2; bg.stroke();
      blobPath(rg, x + dx, y, rad, rng(sd), 0.55, 18);
      rg.fillStyle = 'rgb(250,250,250)'; rg.fill();                       // bare plaster is fully matte
    });
  }
  // cracks
  for (let k = 0; k < 11; k++) {
    const pts = crackPoints(r() * size, r() * size, 60 + r() * 220, r, Math.PI * 0.5 + (r() - 0.5) * 1.6);
    wrapX(size, (dx) => {
      g.strokeStyle = 'rgba(52,42,30,0.75)'; g.lineWidth = 1.2; strokePts(g, pts, dx);
      bg.strokeStyle = 'rgb(18,18,18)'; bg.lineWidth = 1.8; strokePts(bg, pts, dx);
      const mid = pts[Math.floor(pts.length / 2)];
      const br = crackPoints(mid[0], mid[1], 30 + r() * 60, r);
      g.lineWidth = 0.8; strokePts(g, br, dx); bg.lineWidth = 1.2; strokePts(bg, br, dx);
    });
  }
  // cart scuffs low on the wall
  for (let k = 0; k < 40; k++) {
    const x = r() * size, y = size * (0.8 + r() * 0.15), w = 20 + r() * 120;
    wrapX(size, (dx) => {
      g.strokeStyle = `rgba(30,24,18,${0.05 + r() * 0.18})`; g.lineWidth = 1 + r() * 4;
      g.beginPath(); g.moveTo(x + dx, y); g.lineTo(x + dx + w, y + (r() - 0.5) * 6); g.stroke();
    });
  }
  return { color: c, bump: b, rough: rc };
}

// ---------------------------------------------------------------- floor
export function floorTextures(size = 1024, seed = 23) {
  const r = rng(seed);
  const n1 = tileNoise(size, 4, 6, r), n2 = tileNoise(size, 64, 2, r), n3 = tileNoise(size, 8, 4, r);
  const [c, g] = mk(size), [b, bg] = mk(size), [rc, rg] = mk(size);
  const ci = g.createImageData(size, size), bi = bg.createImageData(size, size), ri = rg.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const i = y * size + x, o = i * 4;
      const a = n1[i], f = n2[i], m = n3[i];
      const s = 0.74 + (a - 0.5) * 0.4 + (f - 0.5) * 0.22;
      let R = 126 * s, G = 118 * s, B = 104 * s;
      const e = Math.min(u, 1 - u);
      const dirt = sstep(0.16, 0.0, e + (m - 0.5) * 0.1);
      R = lerp(R, 52, dirt * 0.65); G = lerp(G, 44, dirt * 0.65); B = lerp(B, 34, dirt * 0.65);
      const grime = sstep(0.55, 0.8, m) * 0.35;
      R *= 1 - grime; G *= 1 - grime; B *= 1 - grime * 1.1;
      ci.data[o] = R; ci.data[o + 1] = G; ci.data[o + 2] = B; ci.data[o + 3] = 255;
      const h = 128 + (f - 0.5) * 150 + (a - 0.5) * 40;
      bi.data[o] = bi.data[o + 1] = bi.data[o + 2] = h; bi.data[o + 3] = 255;
      const wear = Math.exp(-Math.pow((u - 0.5) / 0.18, 2));
      const rough = 238 - wear * 75 + (f - 0.5) * 34;          // foot traffic polishes the middle
      ri.data[o] = ri.data[o + 1] = ri.data[o + 2] = rough; ri.data[o + 3] = 255;
    }
  }
  g.putImageData(ci, 0, 0); bg.putImageData(bi, 0, 0); rg.putImageData(ri, 0, 0);

  speckle(g, size, 9000, r, ['rgba(175,168,150,0.55)', 'rgba(58,52,46,0.55)', 'rgba(140,120,96,0.5)'], 1.4);
  speckle(bg, size, 3000, r, ['rgb(200,200,200)', 'rgb(60,60,60)'], 1.2);
  // grime + oil stains
  for (let k = 0; k < 34; k++) {
    const x = r() * size, y = r() * size, rad = 20 + r() * 130, al = 0.08 + r() * 0.22;
    wrap9(size, (dx, dy) => {
      const gr = g.createRadialGradient(x + dx, y + dy, rad * 0.1, x + dx, y + dy, rad);
      gr.addColorStop(0, `rgba(30,24,16,${al})`); gr.addColorStop(0.7, `rgba(34,28,20,${al * 0.6})`); gr.addColorStop(1, 'rgba(34,28,20,0)');
      g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
    });
  }
  for (let k = 0; k < 6; k++) {
    const x = r() * size, y = r() * size, rad = 10 + r() * 30;
    wrap9(size, (dx, dy) => {
      g.strokeStyle = 'rgba(20,16,12,0.35)'; g.lineWidth = 2;
      g.beginPath(); g.ellipse(x + dx, y + dy, rad, rad * 0.8, r(), 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(18,14,10,0.25)'; g.fill();
    });
  }
  // puddles: darker + glossy
  for (let k = 0; k < 5; k++) {
    const x = size * (0.25 + r() * 0.5), y = r() * size, rad = 25 + r() * 70;
    const pr = Math.floor(r() * 1e9);
    wrap9(size, (dx, dy) => {
      blobPath(g, x + dx, y + dy, rad, rng(pr), 0.35, 20); g.fillStyle = 'rgba(30,26,20,0.4)'; g.fill();
      blobPath(rg, x + dx, y + dy, rad, rng(pr), 0.35, 20); rg.fillStyle = 'rgb(40,40,40)'; rg.fill();
      blobPath(bg, x + dx, y + dy, rad, rng(pr), 0.35, 20); bg.fillStyle = 'rgba(128,128,128,0.85)'; bg.fill();
    });
  }
  // cracks
  for (let k = 0; k < 14; k++) {
    const pts = crackPoints(r() * size, r() * size, 80 + r() * 300, r);
    wrap9(size, (dx, dy) => {
      g.strokeStyle = 'rgba(28,22,16,0.8)'; g.lineWidth = 1.4; strokePts(g, pts, dx, dy);
      bg.strokeStyle = 'rgb(10,10,10)'; bg.lineWidth = 2.2; strokePts(bg, pts, dx, dy);
    });
  }
  // control joint every tile
  g.fillStyle = 'rgba(22,18,14,0.85)'; g.fillRect(0, 0, size, 3);
  g.fillStyle = 'rgba(160,150,130,0.3)'; g.fillRect(0, 3, size, 1);
  bg.fillStyle = 'rgb(0,0,0)'; bg.fillRect(0, 0, size, 4);
  return { color: c, bump: b, rough: rc };
}

// ---------------------------------------------------------------- ceiling
export function ceilingTextures(size = 512, seed = 37) {
  const r = rng(seed);
  const n1 = tileNoise(size, 4, 6, r), n2 = tileNoise(size, 32, 3, r);
  const [c, g] = mk(size), [b, bg] = mk(size);
  const ci = g.createImageData(size, size), bi = bg.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4, a = n1[i], f = n2[i];
    const s = 0.78 + (a - 0.5) * 0.4 + (f - 0.5) * 0.12;
    ci.data[o] = 176 * s; ci.data[o + 1] = 170 * s; ci.data[o + 2] = 156 * s; ci.data[o + 3] = 255;
    bi.data[o] = bi.data[o + 1] = bi.data[o + 2] = 128 + (f - 0.5) * 140; bi.data[o + 3] = 255;
  }
  g.putImageData(ci, 0, 0); bg.putImageData(bi, 0, 0);
  for (let k = 0; k < 30; k++) {
    const x = r() * size, y = r() * size, rad = 15 + r() * 110, al = 0.12 + r() * 0.3;
    wrap9(size, (dx, dy) => {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
      gr.addColorStop(0, `rgba(20,16,12,${al})`); gr.addColorStop(1, 'rgba(20,16,12,0)');
      g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
    });
  }
  for (let k = 0; k < 7; k++) {
    const x = r() * size, y = r() * size, rad = 15 + r() * 50;
    wrap9(size, (dx, dy) => {
      for (let j = 0; j < 3; j++) {
        g.strokeStyle = `rgba(110,72,30,${0.25 - j * 0.06})`; g.lineWidth = 2 + j;
        g.beginPath(); g.ellipse(x + dx, y + dy, rad * (1 + j * 0.25), rad * (0.8 + j * 0.2), 0.3, 0, Math.PI * 2); g.stroke();
      }
      g.fillStyle = 'rgba(120,85,40,0.12)'; g.fill();
    });
  }
  for (let k = 0; k < 8; k++) {
    const pts = crackPoints(r() * size, r() * size, 40 + r() * 150, r);
    wrap9(size, (dx, dy) => {
      g.strokeStyle = 'rgba(40,32,24,0.8)'; g.lineWidth = 1; strokePts(g, pts, dx, dy);
      bg.strokeStyle = 'rgb(10,10,10)'; bg.lineWidth = 1.5; strokePts(bg, pts, dx, dy);
    });
  }
  return { color: c, bump: b };
}

// ---------------------------------------------------------------- generic surfaces
export function paintTexture(rgb, seed = 5, size = 256, opts = {}) {
  const r = rng(seed);
  const { chips = 40, rust = 0.4, grime = 0.5 } = opts;
  const n1 = tileNoise(size, 4, 5, r), n2 = tileNoise(size, 16, 3, r);
  const [c, g] = mk(size);
  const ci = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4, y = Math.floor(i / size) / size;
    const s = 0.85 + (n1[i] - 0.5) * 0.35 + (n2[i] - 0.5) * 0.12;
    const gr = 1 - sstep(0.55, 1.0, y + (n1[i] - 0.5) * 0.3) * grime * 0.5;
    ci.data[o] = rgb[0] * s * gr; ci.data[o + 1] = rgb[1] * s * gr; ci.data[o + 2] = rgb[2] * s * gr; ci.data[o + 3] = 255;
  }
  g.putImageData(ci, 0, 0);
  for (let k = 0; k < chips; k++) {
    const x = r() * size, y = r() * size, rad = 1 + r() * 6;
    wrap9(size, (dx, dy) => {
      blobPath(g, x + dx, y + dy, rad, r, 0.6, 9);
      g.fillStyle = r() < rust ? `rgba(${110 + r() * 40},${55 + r() * 20},${25},0.9)` : 'rgba(95,92,88,0.9)'; g.fill();
    });
  }
  for (let k = 0; k < 25; k++) {
    const x = r() * size, y = r() * size, len = 10 + r() * 60;
    wrap9(size, (dx, dy) => {
      g.strokeStyle = `rgba(20,16,12,${0.1 + r() * 0.2})`; g.lineWidth = 0.6 + r();
      g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + (r() - 0.5) * len, y + dy + (r() - 0.5) * len * 0.3); g.stroke();
    });
  }
  if (rust > 0) {
    for (let k = 0; k < 12 * rust; k++) {
      const x = r() * size, y = r() * size, len = 20 + r() * 80;
      wrap9(size, (dx, dy) => {
        const gr = g.createLinearGradient(0, y + dy, 0, y + dy + len);
        gr.addColorStop(0, 'rgba(120,60,24,0.45)'); gr.addColorStop(1, 'rgba(120,60,24,0)');
        g.strokeStyle = gr; g.lineWidth = 1 + r() * 2.5;
        g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + (r() - 0.5) * 3, y + dy + len); g.stroke();
      });
    }
  }
  return c;
}

export function woodTexture(seed = 9, size = 512, tone = [118, 86, 56], planks = 4) {
  const r = rng(seed);
  const n = tileNoise(size, 4, 5, r), n2 = tileNoise(size, 32, 2, r);
  const [c, g] = mk(size);
  const ci = g.createImageData(size, size);
  const pw = size / planks;
  const offs = Array.from({ length: planks }, () => r() * 50);
  const tones = Array.from({ length: planks }, () => 0.8 + r() * 0.35);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, o = i * 4;
    const p = Math.floor(x / pw);
    const grain = Math.sin((x * 0.11 + n[i] * 14 + offs[p]) + Math.sin(y * 0.013 + offs[p]) * 1.8) * 0.5 + 0.5;
    const fine = n2[i];
    const s = (0.62 + grain * 0.3 + fine * 0.15) * tones[p];
    const gr = 1 - sstep(0.6, 1.0, y / size + (n[i] - 0.5) * 0.3) * 0.35;
    ci.data[o] = tone[0] * s * gr; ci.data[o + 1] = tone[1] * s * gr; ci.data[o + 2] = tone[2] * s * gr; ci.data[o + 3] = 255;
  }
  g.putImageData(ci, 0, 0);
  g.fillStyle = 'rgba(20,14,8,0.85)';
  for (let p = 0; p <= planks; p++) g.fillRect(p * pw - 1.5, 0, 3, size);
  // nails / knots / dirt
  for (let p = 0; p < planks; p++) {
    for (const yy of [0.08, 0.92]) {
      g.fillStyle = 'rgba(40,36,34,0.95)'; g.beginPath(); g.arc(p * pw + pw * 0.5, size * yy, 3, 0, 7); g.fill();
      g.fillStyle = 'rgba(110,60,30,0.5)'; g.beginPath(); g.arc(p * pw + pw * 0.5 + 1, size * yy + 4, 4, 0, 7); g.fill();
    }
    if (r() < 0.7) {
      const kx = p * pw + r() * pw, ky = r() * size;
      g.strokeStyle = 'rgba(40,24,12,0.6)'; g.lineWidth = 2;
      g.beginPath(); g.ellipse(kx, ky, 4 + r() * 4, 9 + r() * 8, 0, 0, 7); g.stroke();
    }
  }
  for (let k = 0; k < 18; k++) {
    const x = r() * size, y = r() * size, rad = 20 + r() * 80;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(20,14,8,${0.1 + r() * 0.25})`); gr.addColorStop(1, 'rgba(20,14,8,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return c;
}

export function concreteBlockTexture(seed = 3) {
  const r = rng(seed), size = 128;
  const n = tileNoise(size, 4, 4, r);
  const [c, g] = mk(size);
  const ci = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4, s = 0.6 + n[i] * 0.5 + (r() - 0.5) * 0.12;
    ci.data[o] = 130 * s; ci.data[o + 1] = 124 * s; ci.data[o + 2] = 112 * s; ci.data[o + 3] = 255;
  }
  g.putImageData(ci, 0, 0);
  return c;
}

export function barrelTexture(rgb, seed = 13) {
  const r = rng(seed), W = 512, H = 256;
  const c = paintTexture(rgb, seed, 256, { chips: 70, rust: 1, grime: 0.8 });
  const [o, g] = mk(W, H);
  g.drawImage(c, 0, 0, 256, 256); g.drawImage(c, 256, 0, 256, 256);
  for (const v of [0.08, 0.33, 0.66, 0.92]) {
    g.fillStyle = 'rgba(15,12,10,0.55)'; g.fillRect(0, v * H - 3, W, 3);
    g.fillStyle = 'rgba(255,240,220,0.18)'; g.fillRect(0, v * H, W, 2);
  }
  for (let k = 0; k < 14; k++) {
    const x = r() * W, y = r() * H, rad = 8 + r() * 36;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(105,48,18,0.85)'); gr.addColorStop(0.6, 'rgba(120,60,24,0.5)'); gr.addColorStop(1, 'rgba(120,60,24,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // faded hazard label
  g.save(); g.translate(W * 0.25, H * 0.5); g.rotate(Math.PI / 4);
  g.fillStyle = 'rgba(220,200,120,0.55)'; g.fillRect(-22, -22, 44, 44);
  g.strokeStyle = 'rgba(20,16,12,0.6)'; g.lineWidth = 3; g.strokeRect(-18, -18, 36, 36);
  g.restore();
  return o;
}

export function doorTexture(type, seed = 1) {
  const r = rng(seed), W = 256, H = 512;
  const [c, g] = mk(W, H);
  if (type === 'wood') {
    g.drawImage(woodTexture(seed, 512, [112, 76, 46], 3), 0, 0, W, H);
    g.strokeStyle = 'rgba(15,10,6,0.6)'; g.lineWidth = 4;
    g.strokeRect(W * 0.16, H * 0.07, W * 0.68, H * 0.38); g.strokeRect(W * 0.16, H * 0.53, W * 0.68, H * 0.38);
    g.strokeStyle = 'rgba(255,220,180,0.12)'; g.lineWidth = 2;
    g.strokeRect(W * 0.16 + 3, H * 0.07 + 3, W * 0.68, H * 0.38); g.strokeRect(W * 0.16 + 3, H * 0.53 + 3, W * 0.68, H * 0.38);
    // taped notice
    g.save(); g.translate(W * 0.5, H * 0.24); g.rotate(-0.05);
    g.fillStyle = '#d9d3c0'; g.fillRect(-40, -28, 80, 56);
    g.fillStyle = '#9b2a22'; g.font = 'bold 13px monospace'; g.textAlign = 'center'; g.fillText('STAFF', 0, -8); g.fillText('ONLY', 0, 8);
    g.fillStyle = 'rgba(60,50,40,0.5)'; for (let i = 0; i < 3; i++) g.fillRect(-30, 14 + i * 4, 60 * (0.5 + r() * 0.5), 1.5);
    g.fillStyle = 'rgba(230,220,170,0.55)'; g.fillRect(-46, -32, 20, 9); g.fillRect(26, -32, 20, 9);
    g.restore();
  } else {
    const base = type === 'red' ? [150, 32, 26] : [222, 216, 196];
    g.drawImage(paintTexture(base, seed, 256, { chips: 90, rust: type === 'red' ? 0.6 : 0.3, grime: 1 }), 0, 0, W, H);
    // kick plate & marks
    g.fillStyle = 'rgba(120,118,112,0.9)'; g.fillRect(6, H * 0.86, W - 12, H * 0.12);
    g.strokeStyle = 'rgba(30,28,24,0.6)'; g.lineWidth = 2; g.strokeRect(6, H * 0.86, W - 12, H * 0.12);
    for (let k = 0; k < 30; k++) {
      g.fillStyle = `rgba(20,18,14,${0.1 + r() * 0.3})`;
      g.fillRect(r() * W, H * (0.78 + r() * 0.2), 4 + r() * 30, 1 + r() * 3);
    }
    // grime around handle
    const gr = g.createRadialGradient(W * 0.86, H * 0.52, 0, W * 0.86, H * 0.52, 60);
    gr.addColorStop(0, 'rgba(30,24,16,0.5)'); gr.addColorStop(1, 'rgba(30,24,16,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    if (type === 'white') {
      g.strokeStyle = 'rgba(30,30,30,0.85)'; g.lineWidth = 5;
      g.strokeRect(W * 0.36, H * 0.17, W * 0.28, H * 0.18);
      g.fillStyle = 'rgba(40,40,40,0.7)'; g.font = 'bold 22px monospace'; g.textAlign = 'center';
      g.fillText('B-' + (10 + Math.floor(r() * 30)), W * 0.5, H * 0.45);
    } else {
      g.fillStyle = 'rgba(240,232,214,0.85)'; g.font = 'bold 26px monospace'; g.textAlign = 'center';
      g.fillText('KEEP', W * 0.5, H * 0.3); g.fillText('CLEAR', W * 0.5, H * 0.36);
      g.globalCompositeOperation = 'destination-out';
      for (let k = 0; k < 120; k++) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(W * 0.2 + r() * W * 0.6, H * 0.25 + r() * H * 0.13, 1 + r() * 4, 1 + r() * 3); }
      g.globalCompositeOperation = 'source-over';
      // repaint underlying (destination-out punched to transparent) with base
      const [t, tg] = mk(W, H); tg.fillStyle = 'rgb(140,30,24)'; tg.fillRect(0, 0, W, H); tg.drawImage(c, 0, 0);
      g.clearRect(0, 0, W, H); g.drawImage(t, 0, 0);
    }
  }
  return c;
}

export function paperTexture(seed = 2) {
  const r = rng(seed), W = 128, H = 168;
  const [c, g] = mk(W, H);
  g.fillStyle = `rgb(${218 + r() * 20},${212 + r() * 20},${192 + r() * 20})`; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(40,40,46,0.55)';
  if (r() < 0.5) { g.fillRect(14, 14, 60, 6); }
  for (let y = 30; y < H - 16; y += 7) g.fillRect(14, y, (W - 28) * (0.55 + r() * 0.45), 2);
  for (let k = 0; k < 6; k++) {
    const x = r() * W, y = r() * H, rad = 10 + r() * 40;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(80,60,30,${0.1 + r() * 0.25})`); gr.addColorStop(1, 'rgba(80,60,30,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  // boot print
  if (r() < 0.6) {
    g.save(); g.translate(W * (0.3 + r() * 0.4), H * (0.3 + r() * 0.4)); g.rotate(r() * 6);
    g.fillStyle = 'rgba(40,32,24,0.35)';
    for (let i = 0; i < 6; i++) g.fillRect(-16, -40 + i * 9, 32, 5);
    g.fillRect(-14, 18, 28, 20);
    g.restore();
  }
  return c;
}

export function exitSignTexture() {
  const [c, g] = mk(256, 96);
  g.fillStyle = '#0f8a3c'; g.fillRect(0, 0, 256, 96);
  g.strokeStyle = '#d8ffe4'; g.lineWidth = 4; g.strokeRect(5, 5, 246, 86);
  g.fillStyle = '#eaffef'; g.font = 'bold 54px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('EXIT', 112, 50);
  g.beginPath(); g.moveTo(196, 32); g.lineTo(226, 48); g.lineTo(196, 64); g.closePath(); g.fill();
  g.fillRect(180, 43, 20, 10);
  return c;
}

export function firstAidTexture() {
  const [c, g] = mk(128);
  g.fillStyle = '#d9d8cc'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#1f7a45'; g.fillRect(28, 18, 72, 72);
  g.fillStyle = '#ecece2'; g.fillRect(56, 26, 16, 56); g.fillRect(36, 46, 56, 16);
  g.fillStyle = '#1f3a2a'; g.font = 'bold 13px monospace'; g.textAlign = 'center'; g.fillText('FIRST AID', 64, 110);
  const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, 'rgba(40,30,20,0.25)'); gr.addColorStop(0.3, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(40,30,20,0.35)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return c;
}

export function wireGlassTexture() {
  const [c, g] = mk(64);
  g.fillStyle = '#121615'; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(150,150,140,0.55)'; g.lineWidth = 1;
  for (let i = 0; i <= 64; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke(); }
  return c;
}

export function bulletHoleTexture() {
  const r = rng(77), S = 128;
  const [c, g] = mk(S);
  const cx = S / 2;
  let gr = g.createRadialGradient(cx, cx, 4, cx, cx, cx);
  gr.addColorStop(0, 'rgba(30,26,22,0.55)'); gr.addColorStop(0.5, 'rgba(40,34,28,0.22)'); gr.addColorStop(1, 'rgba(40,34,28,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  blobPath(g, cx, cx, 17, r, 0.4, 14); g.fillStyle = 'rgba(190,180,160,0.65)'; g.fill();
  g.strokeStyle = 'rgba(20,16,12,0.7)'; g.lineWidth = 1.2;
  for (let k = 0; k < 9; k++) {
    const a = r() * Math.PI * 2, l = 14 + r() * 30;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * 8, cx + Math.sin(a) * 8);
    g.lineTo(cx + Math.cos(a + (r() - 0.5) * 0.4) * l, cx + Math.sin(a + (r() - 0.5) * 0.4) * l); g.stroke();
  }
  blobPath(g, cx, cx, 9, r, 0.3, 12); g.fillStyle = 'rgba(12,10,8,1)'; g.fill();
  gr = g.createRadialGradient(cx, cx, 0, cx, cx, 6); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0.8)');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cx, 6, 0, 7); g.fill();
  return c;
}

export function flashTexture() {
  const S = 128, [c, g] = mk(S), cx = S / 2;
  g.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + Math.random() * 0.4, l = cx * (0.6 + Math.random() * 0.4), w = 0.16;
    g.beginPath(); g.moveTo(cx, cx);
    g.lineTo(cx + Math.cos(a - w) * l * 0.3, cx + Math.sin(a - w) * l * 0.3);
    g.lineTo(cx + Math.cos(a) * l, cx + Math.sin(a) * l);
    g.lineTo(cx + Math.cos(a + w) * l * 0.3, cx + Math.sin(a + w) * l * 0.3);
    g.closePath(); g.fillStyle = 'rgba(255,170,70,0.75)'; g.fill();
  }
  const gr = g.createRadialGradient(cx, cx, 0, cx, cx, cx * 0.6);
  gr.addColorStop(0, 'rgba(255,250,230,1)'); gr.addColorStop(0.25, 'rgba(255,200,110,0.9)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return c;
}

export function softDotTexture(inner = 'rgba(255,255,255,1)') {
  const S = 64, [c, g] = mk(S);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return c;
}

export function voidTexture() {
  const W = 128, H = 256, [c, g] = mk(W, H);
  g.fillStyle = '#030202'; g.fillRect(0, 0, W, H);
  const gr = g.createLinearGradient(0, 0, W, 0);
  gr.addColorStop(0, 'rgba(40,32,24,0.5)'); gr.addColorStop(0.15, 'rgba(0,0,0,0)'); gr.addColorStop(0.85, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(40,32,24,0.5)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const gr2 = g.createLinearGradient(0, H, 0, H * 0.8);
  gr2.addColorStop(0, 'rgba(50,42,32,0.6)'); gr2.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr2; g.fillRect(0, 0, W, H);
  return c;
}

// ---------------------------------------------------------------- the paper cut-out
// An original character ("Pip"): a lanky, sleepy guy in a mustard overcoat,
// teal beanie and striped scarf, hands in pockets, ankles crossed, toothpick.
export function characterTextures() {
  const W = 512, H = 1024;
  const r = rng(4242);
  const INK = '#1c1611';
  const [art, a] = mk(W, H);
  a.lineJoin = 'round'; a.lineCap = 'round';

  const part = (path, fill, lw = 6) => {
    a.beginPath(); path(a); a.closePath();
    a.fillStyle = fill; a.fill();
    a.strokeStyle = INK; a.lineWidth = lw; a.stroke();
    // sketchy second pass
    a.save(); a.translate(1.6, -1.2); a.globalAlpha = 0.35; a.lineWidth = 2; a.stroke(); a.restore();
  };
  const line = (path, lw = 4, col = INK) => { a.beginPath(); path(a); a.strokeStyle = col; a.lineWidth = lw; a.stroke(); };
  const hatch = (clipPath, x0, y0, x1, y1, spacing = 7, ang = -0.8, alpha = 0.32) => {
    a.save(); a.beginPath(); clipPath(a); a.closePath(); a.clip();
    a.strokeStyle = `rgba(35,26,18,${alpha})`; a.lineWidth = 1.4;
    const dx = Math.cos(ang), dy = Math.sin(ang), L = 900;
    for (let t = -L; t < L; t += spacing) {
      const px = (x0 + x1) / 2 - dy * t + (r() - 0.5) * 2, py = (y0 + y1) / 2 + dx * t;
      a.beginPath(); a.moveTo(px - dx * L, py - dy * L); a.lineTo(px + dx * L, py + dy * L); a.stroke();
    }
    a.restore();
  };

  // --- legs
  const legA = (g) => { g.moveTo(196, 676); g.lineTo(248, 676); g.lineTo(244, 934); g.lineTo(203, 934); };
  part(legA, '#3b4866');
  hatch(legA, 196, 676, 248, 934, 6, -0.9, 0.28);
  const legB = (g) => { g.moveTo(250, 676); g.lineTo(310, 682); g.quadraticCurveTo(304, 810, 266, 926); g.lineTo(226, 918); g.quadraticCurveTo(262, 806, 250, 676); };
  part(legB, '#44527a');
  // socks
  part((g) => { g.moveTo(204, 920); g.lineTo(244, 920); g.lineTo(244, 940); g.lineTo(204, 940); }, '#e8dcc2', 4);
  line((g) => { g.moveTo(206, 929); g.lineTo(242, 929); }, 4, '#b8322b');
  // shoes
  part((g) => { g.moveTo(246, 936); g.lineTo(246, 958); g.quadraticCurveTo(242, 976, 198, 976); g.quadraticCurveTo(146, 976, 150, 954); g.quadraticCurveTo(156, 934, 204, 934); }, '#6b3f22');
  line((g) => { g.moveTo(170, 948); g.quadraticCurveTo(180, 942, 192, 946); }, 3, 'rgba(255,230,200,0.6)');
  part((g) => { g.moveTo(226, 912); g.lineTo(268, 920); g.quadraticCurveTo(276, 956, 258, 978); g.quadraticCurveTo(238, 994, 224, 972); g.quadraticCurveTo(218, 944, 226, 912); }, '#7a4828');

  // --- coat
  const coat = (g) => { g.moveTo(170, 326); g.quadraticCurveTo(138, 500, 136, 702); g.quadraticCurveTo(256, 716, 374, 706); g.quadraticCurveTo(374, 500, 344, 326); g.quadraticCurveTo(258, 298, 170, 326); };
  part(coat, '#c79b4a', 7);
  hatch(coat, 300, 320, 380, 710, 7, -0.85, 0.34);
  hatch((g) => { g.moveTo(136, 640); g.lineTo(380, 640); g.lineTo(380, 720); g.lineTo(136, 720); }, 136, 640, 380, 720, 9, 0.7, 0.18);
  line((g) => { g.moveTo(258, 332); g.quadraticCurveTo(264, 520, 254, 708); }, 4);
  line((g) => { g.moveTo(204, 322); g.lineTo(256, 448); g.lineTo(314, 322); }, 4);
  for (const [bx, by] of [[242, 484], [243, 562], [241, 640]]) {
    a.beginPath(); a.arc(bx, by, 8, 0, 7); a.fillStyle = '#4a2e1a'; a.fill(); a.lineWidth = 3; a.strokeStyle = INK; a.stroke();
  }
  // patch on coat
  part((g) => { g.moveTo(170, 610); g.lineTo(205, 606); g.lineTo(208, 640); g.lineTo(172, 643); }, '#7f9a6a', 3);
  line((g) => { for (let i = 0; i < 5; i++) { g.moveTo(168 + i * 9, 604); g.lineTo(172 + i * 9, 612); } }, 1.5);

  // --- arms into pockets
  const armL = (g) => { g.moveTo(174, 334); g.quadraticCurveTo(122, 430, 148, 566); g.lineTo(206, 566); g.quadraticCurveTo(190, 450, 208, 364); };
  part(armL, '#b98d3f');
  const armR = (g) => { g.moveTo(340, 334); g.quadraticCurveTo(394, 430, 366, 566); g.lineTo(308, 566); g.quadraticCurveTo(326, 450, 308, 364); };
  part(armR, '#b08439');
  hatch(armR, 308, 334, 394, 566, 6, -0.8, 0.3);
  part((g) => { g.moveTo(138, 552); g.lineTo(218, 548); g.lineTo(220, 582); g.lineTo(140, 586); }, '#a77c34', 5);
  part((g) => { g.moveTo(298, 548); g.lineTo(380, 552); g.lineTo(378, 586); g.lineTo(296, 582); }, '#a77c34', 5);

  // --- neck + scarf
  part((g) => { g.moveTo(236, 270); g.lineTo(280, 270); g.lineTo(282, 312); g.lineTo(234, 312); }, '#e9c49a', 5);
  const scarfTail = (g) => { g.moveTo(286, 336); g.lineTo(332, 340); g.lineTo(326, 528); g.lineTo(290, 522); };
  part(scarfTail, '#b8322b');
  a.save(); a.beginPath(); scarfTail(a); a.clip();
  a.fillStyle = '#efe4c8'; for (let y = 360; y < 530; y += 34) a.fillRect(280, y, 60, 13);
  a.restore();
  a.beginPath(); scarfTail(a); a.closePath(); a.strokeStyle = INK; a.lineWidth = 5; a.stroke();
  line((g) => { for (let i = 0; i < 6; i++) { g.moveTo(292 + i * 6, 524); g.lineTo(290 + i * 6, 546); } }, 3);
  const scarf = (g) => { g.moveTo(176, 300); g.quadraticCurveTo(258, 336, 342, 298); g.lineTo(348, 340); g.quadraticCurveTo(258, 378, 170, 340); };
  part(scarf, '#b8322b');
  a.save(); a.beginPath(); scarf(a); a.clip();
  a.fillStyle = '#efe4c8'; for (let x = 182; x < 350; x += 36) { a.save(); a.translate(x, 320); a.rotate(0.15); a.fillRect(-6, -40, 13, 80); a.restore(); }
  a.restore();
  a.beginPath(); scarf(a); a.closePath(); a.strokeStyle = INK; a.lineWidth = 6; a.stroke();
  hatch(scarf, 176, 320, 348, 378, 6, -0.9, 0.25);

  // --- head
  for (const ex of [160, 352]) { a.beginPath(); a.ellipse(ex, 206, 18, 26, 0, 0, 7); a.fillStyle = '#e9c49a'; a.fill(); a.lineWidth = 5; a.strokeStyle = INK; a.stroke(); }
  const head = (g) => { g.ellipse(256, 186, 98, 108, 0, 0, Math.PI * 2); };
  part(head, '#f1cfa6', 7);
  hatch((g) => { g.ellipse(256, 186, 98, 108, 0, -0.9, 1.4); }, 300, 100, 360, 300, 6, -0.7, 0.2);
  // blush, freckles
  for (const [bx, by] of [[200, 246], [316, 244]]) {
    const gr = a.createRadialGradient(bx, by, 0, bx, by, 24); gr.addColorStop(0, 'rgba(220,110,90,0.45)'); gr.addColorStop(1, 'rgba(220,110,90,0)');
    a.fillStyle = gr; a.fillRect(bx - 24, by - 24, 48, 48);
  }
  a.fillStyle = 'rgba(120,70,40,0.6)';
  for (let i = 0; i < 9; i++) { a.beginPath(); a.arc(190 + r() * 30, 236 + r() * 16, 1.6, 0, 7); a.fill(); a.beginPath(); a.arc(306 + r() * 30, 234 + r() * 16, 1.6, 0, 7); a.fill(); }
  // eyes: sleepy half lids
  for (const [ex, ey, px] of [[216, 214, 224], [296, 212, 304]]) {
    a.beginPath(); a.ellipse(ex, ey, 25, 21, 0, 0, 7); a.fillStyle = '#fbf6ea'; a.fill(); a.lineWidth = 4; a.strokeStyle = INK; a.stroke();
    a.beginPath(); a.arc(px, ey + 8, 8.5, 0, 7); a.fillStyle = INK; a.fill();
    a.beginPath(); a.arc(px + 3, ey + 5, 2.4, 0, 7); a.fillStyle = '#fff'; a.fill();
    a.beginPath(); a.ellipse(ex, ey, 27, 23, 0, Math.PI, Math.PI * 2); a.lineTo(ex + 27, ey + 3); a.lineTo(ex - 27, ey + 3); a.closePath();
    a.fillStyle = '#ecc49a'; a.fill();
    line((g) => { g.moveTo(ex - 26, ey + 3); g.quadraticCurveTo(ex, ey + 6, ex + 26, ey + 3); }, 5);
    line((g) => { g.moveTo(ex - 16, ey + 30); g.quadraticCurveTo(ex, ey + 35, ex + 14, ey + 29); }, 2, 'rgba(40,28,20,0.55)');
  }
  line((g) => { g.moveTo(194, 176); g.quadraticCurveTo(214, 166, 238, 174); }, 5);
  line((g) => { g.moveTo(276, 162); g.quadraticCurveTo(298, 150, 320, 166); }, 5);
  // long droopy nose
  part((g) => { g.moveTo(254, 214); g.quadraticCurveTo(262, 248, 288, 258); g.quadraticCurveTo(306, 270, 288, 282); g.quadraticCurveTo(268, 288, 256, 272); g.quadraticCurveTo(248, 262, 254, 214); }, '#eab98e', 4);
  // smirk + toothpick + stubble
  line((g) => { g.moveTo(222, 284); g.quadraticCurveTo(248, 296, 276, 280); }, 4);
  line((g) => { g.moveTo(276, 280); g.lineTo(320, 266); }, 6);
  line((g) => { g.moveTo(276, 280); g.lineTo(320, 266); }, 3, '#e3c88e');
  a.fillStyle = 'rgba(40,30,22,0.5)';
  for (let i = 0; i < 40; i++) { const t = r() * Math.PI, rr = 70 + r() * 18; a.fillRect(256 + Math.cos(t) * rr * 0.75, 200 + Math.sin(t) * rr, 1.6, 1.6); }

  // --- beanie (tilted)
  a.save(); a.translate(256, 120); a.rotate(-0.09); a.translate(-256, -120);
  const hat = (g) => { g.moveTo(158, 168); g.quadraticCurveTo(166, 56, 256, 50); g.quadraticCurveTo(348, 56, 354, 168); g.quadraticCurveTo(256, 142, 158, 168); };
  part(hat, '#2f807a', 7);
  hatch(hat, 290, 50, 354, 170, 6, -0.7, 0.3);
  const cuff = (g) => { g.moveTo(150, 170); g.quadraticCurveTo(256, 138, 362, 170); g.lineTo(358, 202); g.quadraticCurveTo(256, 172, 154, 202); };
  part(cuff, '#256963', 6);
  line((g) => { for (let x = 166; x < 350; x += 13) { const yy = 168 - Math.sin(((x - 150) / 212) * Math.PI) * 20; g.moveTo(x, yy + 6); g.lineTo(x, yy + 28); } }, 2, 'rgba(15,40,38,0.6)');
  a.beginPath(); a.arc(262, 46, 26, 0, 7); a.fillStyle = '#ebe2cb'; a.fill(); a.lineWidth = 5; a.strokeStyle = INK; a.stroke();
  line((g) => { for (let i = 0; i < 14; i++) { const t = r() * 6.28, rr = 8 + r() * 16; g.moveTo(262 + Math.cos(t) * rr, 46 + Math.sin(t) * rr); g.lineTo(262 + Math.cos(t + 0.4) * (rr + 6), 46 + Math.sin(t + 0.4) * (rr + 6)); } }, 1.6);
  a.restore();
  // hair tufts
  line((g) => { g.moveTo(166, 196); g.quadraticCurveTo(150, 214, 160, 230); g.moveTo(176, 196); g.quadraticCurveTo(164, 222, 174, 236); }, 4, '#5a3a22');
  line((g) => { g.moveTo(346, 196); g.quadraticCurveTo(362, 214, 352, 230); }, 4, '#5a3a22');

  // --- cut-out composite: art + scissor margin + paper edge
  const dilate = (src, rad, color, steps = 36) => {
    const [d, dg] = mk(W, H);
    for (let i = 0; i < steps; i++) {
      const ang = (i / steps) * Math.PI * 2;
      const wob = rad * (0.92 + 0.16 * Math.abs(Math.sin(i * 1.7)));
      dg.drawImage(src, Math.cos(ang) * wob, Math.sin(ang) * wob);
    }
    dg.drawImage(src, 0, 0);
    dg.globalCompositeOperation = 'source-in';
    dg.fillStyle = color; dg.fillRect(0, 0, W, H);
    return d;
  };
  const edge = dilate(art, 19, '#a89c84');
  const margin = dilate(art, 16, '#f3eee0');
  const [front, f] = mk(W, H);
  f.drawImage(edge, 0, 0); f.drawImage(margin, 0, 0); f.drawImage(art, 0, 0);

  // paper grain + fold crease, only where there is paper
  const grain = (ctx) => {
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    const nz = tileNoise(256, 16, 3, r);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (d[o + 3] < 8) { d[o + 3] = 0; continue; }
      d[o + 3] = d[o + 3] > 110 ? 255 : 0; // crisp scissor edge
      const k = 0.94 + (Math.random() - 0.5) * 0.08 + (nz[(y & 255) * 256 + (x & 255)] - 0.5) * 0.1;
      d[o] *= k; d[o + 1] *= k; d[o + 2] *= k * 0.98;
    }
    ctx.putImageData(img, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(0, 598, W, 2);
    ctx.fillStyle = 'rgba(60,40,20,0.18)'; ctx.fillRect(0, 600, W, 3);
    ctx.strokeStyle = 'rgba(120,100,70,0.08)'; ctx.lineWidth = 1;
    for (let i = 0; i < 140; i++) { const x = Math.random() * W, y = Math.random() * H; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (Math.random() - 0.5) * 14, y + (Math.random() - 0.5) * 14); ctx.stroke(); }
    ctx.globalCompositeOperation = 'source-over';
    return ctx.getImageData(0, 0, W, H).data;
  };
  const fdata = grain(f);

  // back side: mirrored silhouette in plain cardboard with pencil notes
  const [back, bk] = mk(W, H);
  bk.save(); bk.translate(W, 0); bk.scale(-1, 1); bk.drawImage(front, 0, 0); bk.restore();
  bk.globalCompositeOperation = 'source-atop';
  bk.fillStyle = '#cbbd9c'; bk.fillRect(0, 0, W, H);
  bk.fillStyle = 'rgba(60,50,40,0.55)'; bk.font = 'italic 26px "Comic Sans MS", cursive, sans-serif'; bk.textAlign = 'center';
  bk.fillText('pip — v3', W / 2, 470); bk.font = 'italic 18px "Comic Sans MS", cursive, sans-serif';
  bk.fillText('do not move (again)', W / 2, 505);
  bk.globalCompositeOperation = 'source-over';
  const bdata = grain(bk);

  const alphaOf = (d) => { const A = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) A[i] = d[i * 4 + 3]; return A; };
  return { front, back, w: W, h: H, frontAlpha: alphaOf(fdata), backAlpha: alphaOf(bdata) };
}

// weapon-light cookie: hot centre, faint ring, soft spill, a few lens imperfections
export function torchCookieTexture() {
  const S = 256, [c, g] = mk(S), cx = S / 2;
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  let gr = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(250,250,250,0.95)');
  gr.addColorStop(0.3, 'rgba(150,150,150,0.55)'); gr.addColorStop(0.42, 'rgba(190,190,190,0.6)');
  gr.addColorStop(0.5, 'rgba(90,90,90,0.3)'); gr.addColorStop(0.85, 'rgba(30,30,30,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const r = rng(808);
  for (let i = 0; i < 6; i++) {
    const a = r() * 6.28, d = r() * 40, x = cx + Math.cos(a) * d, y = cx + Math.sin(a) * d, rad = 6 + r() * 14;
    gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(0,0,0,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return c;
}

// ---------------------------------------------------------------- outdoor yard surfaces
// Muddy gravel yard: wet/dry mud, gravel stones, standing puddles. Tiles every 4 m.
export function mudTextures(size = 1024, seed = 61) {
  const r = rng(seed);
  const n1 = tileNoise(size, 4, 6, r), n2 = tileNoise(size, 64, 2, r), n3 = tileNoise(size, 6, 4, r);
  const [c, g] = mk(size), [b, bg] = mk(size), [rc, rg] = mk(size);
  const ci = g.createImageData(size, size), bi = bg.createImageData(size, size), ri = rg.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const o = i * 4, a = n1[i], f = n2[i], m = n3[i];
    const wet = sstep(0.42, 0.62, a);
    let R = lerp(138, 78, wet), G = lerp(118, 62, wet), B = lerp(90, 44, wet);
    const s = 0.86 + (f - 0.5) * 0.35;
    R *= s; G *= s; B *= s;
    const pud = sstep(0.66, 0.7, m);                               // standing water
    R = lerp(R, 44, pud * 0.8); G = lerp(G, 44, pud * 0.8); B = lerp(B, 42, pud * 0.8);
    ci.data[o] = R; ci.data[o + 1] = G; ci.data[o + 2] = B; ci.data[o + 3] = 255;
    const h = lerp(128 + (f - 0.5) * 110 + (a - 0.5) * 60, 96, pud);
    bi.data[o] = bi.data[o + 1] = bi.data[o + 2] = h; bi.data[o + 3] = 255;
    const rough = lerp(lerp(225, 150, wet), 18, pud) + (f - 0.5) * 30;
    ri.data[o] = ri.data[o + 1] = ri.data[o + 2] = rough; ri.data[o + 3] = 255;
  }
  g.putImageData(ci, 0, 0); bg.putImageData(bi, 0, 0); rg.putImageData(ri, 0, 0);
  // gravel: thousands of small stones, raised in the height map
  for (let k = 0; k < 14000; k++) {
    const x = r() * size, y = r() * size, rad = 0.8 + r() * r() * 4.5;
    const v = 95 + r() * 80, wt = r() < 0.4;
    wrap9(size, (dx, dy) => {
      if (x + dx < -8 || x + dx > size + 8 || y + dy < -8 || y + dy > size + 8) return;
      g.fillStyle = `rgba(${v},${v * 0.96},${v * 0.9},${wt ? 0.55 : 0.9})`;
      g.beginPath(); g.ellipse(x + dx, y + dy, rad, rad * (0.6 + r() * 0.4), r() * 3, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,250,240,0.18)'; g.beginPath(); g.arc(x + dx - rad * 0.3, y + dy - rad * 0.3, rad * 0.4, 0, 7); g.fill();
      bg.fillStyle = `rgb(${180 + r() * 60},${180 + r() * 60},${180 + r() * 60})`;
      bg.beginPath(); bg.arc(x + dx, y + dy, rad, 0, 7); bg.fill();
      rg.fillStyle = 'rgb(200,200,200)'; rg.beginPath(); rg.arc(x + dx, y + dy, rad, 0, 7); rg.fill();
    });
  }
  // boot prints and tyre tread marks pressed into the mud
  for (let k = 0; k < 22; k++) {
    const x = r() * size, y = r() * size, a = r() * 6.28;
    wrap9(size, (dx, dy) => {
      for (const ctx of [g, bg]) {
        ctx.save(); ctx.translate(x + dx, y + dy); ctx.rotate(a);
        ctx.fillStyle = ctx === g ? 'rgba(30,24,18,0.35)' : 'rgba(70,70,70,0.6)';
        for (let i = 0; i < 5; i++) ctx.fillRect(-9, -26 + i * 8, 18, 4);
        ctx.fillRect(-7, 16, 14, 10);
        ctx.restore();
      }
    });
  }
  return { color: c, bump: b, rough: rc };
}

// soft, ragged edge so the gravel yard fades into the grass instead of ending in a square
export function yardEdgeTexture(seed = 63) {
  const S = 512, r = rng(seed), [c, g] = mk(S);
  const n = tileNoise(S, 8, 4, r);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, u = x / S - 0.5, v = y / S - 0.5;
    const d = Math.max(Math.abs(u), Math.abs(v)) * 2 + (n[i] - 0.5) * 0.35;
    const a = 1 - sstep(0.7, 0.98, d);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = a * 255; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// flattened dead grass, tiles every 3 m
export function grassTexture(size = 512, seed = 65) {
  const r = rng(seed), n = tileNoise(size, 8, 4, r);
  const [c, g] = mk(size);
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const s = 0.75 + n[i] * 0.45, o = i * 4;
    img.data[o] = 92 * s; img.data[o + 1] = 86 * s; img.data[o + 2] = 58 * s; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let k = 0; k < 9000; k++) {
    const x = r() * size, y = r() * size, a = -0.6 + (r() - 0.5) * 1.2, l = 4 + r() * 12;
    const t = r();
    g.strokeStyle = t < 0.5 ? `rgba(${150 + r() * 40},${135 + r() * 30},${90 + r() * 20},0.5)` : t < 0.8 ? 'rgba(48,44,30,0.5)' : 'rgba(96,104,60,0.45)';
    g.lineWidth = 0.6 + r() * 1.2;
    wrap9(size, (dx, dy) => {
      if (x + dx < -20 || x + dx > size + 20 || y + dy < -20 || y + dy > size + 20) return;
      g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l); g.stroke();
    });
  }
  return c;
}

// weathered white lap siding (clapboard): 13 boards per 2 m tile, mildew streaks, peeling
export function clapboardTextures(size = 512, seed = 67) {
  const r = rng(seed), n = tileNoise(size, 4, 5, r), n2 = tileNoise(size, 32, 2, r);
  const [c, g] = mk(size), [b, bg] = mk(size), [rc, rg] = mk(size);
  const ci = g.createImageData(size, size), bi = bg.createImageData(size, size), ri = rg.createImageData(size, size);
  const BOARDS = 13, bh = size / BOARDS;
  const tone = Array.from({ length: BOARDS }, () => 0.92 + r() * 0.1);
  for (let y = 0; y < size; y++) {
    const k = Math.floor(y / bh), fr = (y % bh) / bh;
    for (let x = 0; x < size; x++) {
      const i = y * size + x, o = i * 4;
      let s = tone[k] * (0.92 + (n[i] - 0.5) * 0.16 + (n2[i] - 0.5) * 0.06);
      if (fr > 0.86) s *= 0.62 + (1 - fr) * 1.4;                 // shadow under the lip of the board above
      if (fr < 0.05) s *= 1.06;                                     // lit top edge
      ci.data[o] = 228 * s; ci.data[o + 1] = 226 * s; ci.data[o + 2] = 216 * s; ci.data[o + 3] = 255;
      const h = fr > 0.88 ? 30 : 60 + fr * 170 + (n2[i] - 0.5) * 20;  // wedge-shaped boards
      bi.data[o] = bi.data[o + 1] = bi.data[o + 2] = h; bi.data[o + 3] = 255;
      ri.data[o] = ri.data[o + 1] = ri.data[o + 2] = 205 + (n2[i] - 0.5) * 40; ri.data[o + 3] = 255;
    }
  }
  g.putImageData(ci, 0, 0); bg.putImageData(bi, 0, 0); rg.putImageData(ri, 0, 0);
  // board butt joints
  for (let k = 0; k < BOARDS; k++) {
    const x = r() * size;
    g.fillStyle = 'rgba(70,66,58,0.6)'; g.fillRect(x, k * bh, 1.5, bh * 0.88);
  }
  // mildew / rain streaks running down from the top, splash-back dirt at the bottom
  for (let k = 0; k < 40; k++) {
    const x = r() * size, len = size * (0.15 + r() * 0.7), w = 3 + r() * 14;
    wrapX(size, (dx) => {
      const gr = g.createLinearGradient(0, 0, 0, len);
      gr.addColorStop(0, `rgba(96,104,84,${0.18 + r() * 0.25})`); gr.addColorStop(1, 'rgba(96,104,84,0)');
      g.fillStyle = gr; g.fillRect(x + dx, 0, w, len);
    });
  }
  const gr = g.createLinearGradient(0, size * 0.8, 0, size);
  gr.addColorStop(0, 'rgba(70,58,40,0)'); gr.addColorStop(1, 'rgba(70,58,40,0.35)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  // peeling paint showing grey wood
  for (let k = 0; k < 26; k++) {
    const kk = Math.floor(r() * BOARDS), x = r() * size, w = 8 + r() * 50, y = kk * bh + bh * (0.15 + r() * 0.5), h = bh * (0.15 + r() * 0.3);
    wrapX(size, (dx) => {
      g.fillStyle = `rgba(${132 + r() * 20},${124 + r() * 16},${108 + r() * 12},0.9)`; g.fillRect(x + dx, y, w, h);
      g.fillStyle = 'rgba(255,255,250,0.5)'; g.fillRect(x + dx, y - 1, w, 1);
      rg.fillStyle = 'rgb(250,250,250)'; rg.fillRect(x + dx, y, w, h);
    });
  }
  return { color: c, bump: b, rough: rc };
}

// dark asphalt roof shingles with moss
export function shingleTextures(size = 512, seed = 69) {
  const r = rng(seed), n = tileNoise(size, 8, 4, r);
  const [c, g] = mk(size), [b, bg] = mk(size);
  const rows = 12, rh = size / rows;
  for (let k = 0; k < rows; k++) {
    const off = (k % 2) * 0.5, tabs = 8, tw = size / tabs;
    for (let t = -1; t <= tabs; t++) {
      const x = (t + off) * tw, v = 52 + r() * 30;
      g.fillStyle = `rgb(${v},${v * 0.98},${v * 0.95})`; g.fillRect(x, k * rh, tw - 2, rh);
      const gr = bg.createLinearGradient(0, k * rh, 0, (k + 1) * rh);
      gr.addColorStop(0, 'rgb(70,70,70)'); gr.addColorStop(1, 'rgb(200,200,200)');
      bg.fillStyle = gr; bg.fillRect(x, k * rh, tw - 2, rh);
    }
    g.fillStyle = 'rgba(10,10,10,0.7)'; g.fillRect(0, (k + 1) * rh - 2, size, 2);
  }
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) { const s = 0.85 + n[i] * 0.3; img.data[i * 4] *= s; img.data[i * 4 + 1] *= s; img.data[i * 4 + 2] *= s; }
  g.putImageData(img, 0, 0);
  for (let k = 0; k < 18; k++) {
    const x = r() * size, y = r() * size, rad = 10 + r() * 40;
    wrap9(size, (dx, dy) => {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
      gr.addColorStop(0, 'rgba(70,86,46,0.6)'); gr.addColorStop(1, 'rgba(70,86,46,0)');
      g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
    });
  }
  return { color: c, bump: b };
}

// corrugated steel shipping-container side panel (fictional reporting mark)
export function containerTextures(rgb, seed = 71, mark = 'KTLU 482193 5') {
  const r = rng(seed), W = 1024, H = 512, n = tileNoise(512, 8, 4, r);
  const [c, g] = mk(W, H), [b, bg] = mk(W, H);
  const img = g.createImageData(W, H), bimg = bg.createImageData(W, H);
  const P = 36;                                                    // rib pitch in px
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4, ph = (x % P) / P;
    const rib = ph < 0.35 ? 1 : ph < 0.5 ? 1 - (ph - 0.35) / 0.15 : ph < 0.85 ? 0 : (ph - 0.85) / 0.15;
    const nn = n[(y % 512) * 512 + (x % 512)];
    const shade = 0.78 + rib * 0.2 + (nn - 0.5) * 0.25;
    img.data[o] = rgb[0] * shade; img.data[o + 1] = rgb[1] * shade; img.data[o + 2] = rgb[2] * shade; img.data[o + 3] = 255;
    bimg.data[o] = bimg.data[o + 1] = bimg.data[o + 2] = 60 + rib * 150; bimg.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); bg.putImageData(bimg, 0, 0);
  // top and bottom rails
  for (const [y, h] of [[0, 18], [H - 22, 22]]) { g.fillStyle = 'rgba(30,24,20,0.55)'; g.fillRect(0, y, W, h); bg.fillStyle = 'rgb(220,220,220)'; bg.fillRect(0, y, W, h); }
  // rust: patches and streaks running down from the top rail
  for (let k = 0; k < 40; k++) {
    const x = r() * W, y = r() * H, rad = 6 + r() * 40;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(${110 + r() * 30},${52 + r() * 16},20,0.8)`); gr.addColorStop(1, 'rgba(120,60,24,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let k = 0; k < 60; k++) {
    const x = r() * W, len = 30 + r() * 220;
    const gr = g.createLinearGradient(0, 18, 0, 18 + len);
    gr.addColorStop(0, 'rgba(118,58,22,0.55)'); gr.addColorStop(1, 'rgba(118,58,22,0)');
    g.fillStyle = gr; g.fillRect(x, 18, 2 + r() * 5, len);
  }
  // faded stencilled reporting mark
  g.save(); g.globalAlpha = 0.65; g.fillStyle = '#ece8de'; g.font = 'bold 54px "Arial Narrow", Arial, sans-serif'; g.fillText(mark, 60, 110);
  g.font = 'bold 26px Arial, sans-serif'; g.fillText('22G1   MAX GROSS 30,480 KG', 60, 150); g.restore();
  g.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 400; k++) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(40 + r() * 600, 60 + r() * 100, 1 + r() * 4, 1 + r() * 3); }
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = `rgb(${rgb[0] * 0.8},${rgb[1] * 0.8},${rgb[2] * 0.8})`; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
  return { color: c, bump: b };
}

// overcast-sky gradient for reflections and the background
export function bricksTexture(seed = 73) {
  const r = rng(seed), S = 256, [c, g] = mk(S);
  g.fillStyle = '#5a5048'; g.fillRect(0, 0, S, S);
  const bh = S / 8, bw = S / 4;
  for (let row = 0; row < 8; row++) for (let i = -1; i < 5; i++) {
    const x = i * bw + (row % 2) * bw / 2, v = 0.75 + r() * 0.35;
    g.fillStyle = `rgb(${126 * v},${64 * v},${48 * v})`; g.fillRect(x + 2, row * bh + 2, bw - 4, bh - 4);
  }
  return c;
}

// ---------------------------------------------------------------- material library
// ================================================================ portfolio rooms
// Aged paper with typed lettering. Text always fits: long lines wrap, big words shrink.
function agedPaper(g, W, H, seed) {
  const r = rng(seed);
  g.fillStyle = '#d9cfb6'; g.fillRect(0, 0, W, H);
  for (let k = 0; k < 40; k++) {
    const x = r() * W, y = r() * H, rad = 30 + r() * 160;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(150,118,70,${0.04 + r() * 0.08})`); gr.addColorStop(1, 'rgba(150,118,70,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
  v.addColorStop(0, 'rgba(60,40,20,0)'); v.addColorStop(1, 'rgba(60,40,20,0.35)');
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  speckle(g, Math.max(W, H), 400, r, ['rgba(60,40,20,0.25)'], 1.5);
}
function fitFont(g, text, style, size, family, maxW) {
  g.font = `${style} ${size}px ${family}`;
  const w = g.measureText(text).width;
  if (w > maxW) { size = Math.floor(size * maxW / w); g.font = `${style} ${size}px ${family}`; }
  return size;
}
function wrapLines(g, text, maxW) {
  const out = []; let line = '';
  for (const word of text.split(/\s+/)) {
    const t = line ? line + ' ' + word : word;
    if (g.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
  }
  if (line) out.push(line);
  return out;
}
const TYPE = '"Courier New", Courier, monospace', HEAD = '"Arial Black", "Helvetica Neue", Arial, sans-serif';
export function titleBoardTexture(title, subtitle = '', seed = 141) {
  const W = 2048, H = 1024;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  agedPaper(g, W, H, seed);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(24,18,12,0.92)';
  fitFont(g, title, '900', 300, HEAD, W * 0.86);
  g.fillText(title, W / 2, H * (subtitle ? 0.42 : 0.5));
  if (subtitle) { g.fillStyle = 'rgba(110,26,20,0.9)'; fitFont(g, subtitle, 'bold', 110, TYPE, W * 0.8); g.fillText(subtitle, W / 2, H * 0.72); }
  return c;
}
export function noticeTexture({ title = '', body = '', link = '' }, seed = 151) {
  const W = 1024, H = 768, pad = 70;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  agedPaper(g, W, H, seed);
  g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillStyle = 'rgba(24,18,12,0.94)';
  fitFont(g, title, '900', 76, HEAD, W - pad * 2);
  g.fillText(title, pad, pad);
  g.fillRect(pad, pad + 100, W - pad * 2, 4);
  // body: shrink until it fits the space left
  let size = 58, lines;
  const room = H - pad * 2 - 130 - (link ? 90 : 0);
  for (;;) { g.font = `bold ${size}px ${TYPE}`; lines = wrapLines(g, body, W - pad * 2); if (lines.length * size * 1.3 <= room || size <= 22) break; size -= 3; }
  g.fillStyle = 'rgba(16,12,8,1)';
  lines.forEach((l, i) => g.fillText(l, pad, pad + 135 + i * size * 1.3));
  if (link) {
    const shown = link.replace(/^https?:\/\//, '').replace(/\/$/, '');
    g.fillStyle = 'rgba(30,48,110,0.95)';
    const ls = fitFont(g, '↗ ' + shown, 'bold', 44, TYPE, W - pad * 2);
    g.fillText('↗ ' + shown, pad, H - pad - ls);
    g.fillRect(pad, H - pad + 6, Math.min(W - pad * 2, g.measureText('↗ ' + shown).width), 3);
  }
  return c;
}

// ================================================================ house interior
// Wallpapered plaster for one wall tile: 2 m wide, floor to ceiling (canvas top = ceiling).
// Faded stripes with a small printed motif, smoke near the ceiling, water stains, peeling seams
// and a painted skirting board along the bottom.
export function wallpaperTextures(seed = 91, tint = [200, 186, 148], ink = [126, 118, 78], size = 1024, H = 2.65) {
  const r = rng(seed);
  const n1 = tileNoise(size, 4, 6, r), n2 = tileNoise(size, 48, 2, r), n3 = tileNoise(size, 8, 4, r);
  const [c, g] = mk(size), [b, bg] = mk(size), [rc, rg] = mk(size);
  const ci = g.createImageData(size, size), bi = bg.createImageData(size, size), ri = rg.createImageData(size, size);
  const skirt = Math.round((0.15 / H) * size), period = size / 8;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x, o = i * 4, a = n1[i], f = n2[i], m = n3[i];
      let R, G, B, h, ro;
      if (y > size - skirt) {
        // skirting board: old cream gloss paint gone grey
        const k = (y - (size - skirt)) / skirt;
        const s = 0.62 + (a - 0.5) * 0.25 + (f - 0.5) * 0.06 - (k < 0.08 ? 0.18 : 0);
        R = 150 * s; G = 140 * s; B = 118 * s; h = k < 0.08 ? 200 : 160 + (f - 0.5) * 20; ro = 120;
      } else {
        const xm = x % period;
        // pin stripes either side of each column
        const stripe = (xm < 3 || (xm > 8 && xm < 10) || xm > period - 3) ? 1 : 0;
        const s = 0.9 + (a - 0.5) * 0.25 + (f - 0.5) * 0.08;
        R = tint[0] * s; G = tint[1] * s; B = tint[2] * s;
        if (stripe) { R = lerp(R, ink[0], 0.55); G = lerp(G, ink[1], 0.55); B = lerp(B, ink[2], 0.55); }
        // smoke at the ceiling, grime toward the floor
        const smoke = sstep(0.16, 0.0, v + (a - 0.5) * 0.1);
        const grime = sstep(0.75, 1.0, v + (m - 0.5) * 0.2);
        const dk = 1 - smoke * 0.45 - grime * 0.35;
        R *= dk; G *= dk * 0.98; B *= dk * 0.92;
        // overall nicotine yellowing in blotches
        const y2 = (m - 0.5) * 0.3; R *= 1 + y2 * 0.1; B *= 1 - Math.abs(y2) * 0.4;
        h = 128 + (f - 0.5) * 60 + (a - 0.5) * 30 + (stripe ? 6 : 0);
        ro = 225 + (f - 0.5) * 30;
      }
      ci.data[o] = R; ci.data[o + 1] = G; ci.data[o + 2] = B; ci.data[o + 3] = 255;
      bi.data[o] = bi.data[o + 1] = bi.data[o + 2] = h; bi.data[o + 3] = 255;
      ri.data[o] = ri.data[o + 1] = ri.data[o + 2] = Math.min(255, ro); ri.data[o + 3] = 255;
    }
  }
  g.putImageData(ci, 0, 0); bg.putImageData(bi, 0, 0); rg.putImageData(ri, 0, 0);
  // printed motif: a small four-petal sprig in the middle of each column, staggered
  g.fillStyle = `rgba(${ink[0]},${ink[1]},${ink[2]},0.42)`;
  const rowH = period * 1.1;
  for (let col = 0; col < 8; col++) for (let row = 0; row * rowH < size - skirt; row++) {
    const cx = col * period + period / 2, cy = row * rowH + (col % 2 ? rowH / 2 : 0) + 20;
    if (cy > size - skirt - 10) continue;
    for (let k = 0; k < 4; k++) {
      const an = k * Math.PI / 2 + Math.PI / 4;
      g.beginPath(); g.ellipse(cx + Math.cos(an) * 7, cy + Math.sin(an) * 7, 6, 3, an, 0, 7); g.fill();
    }
    g.beginPath(); g.arc(cx, cy, 2.2, 0, 7); g.fill();
    g.fillRect(cx - 0.8, cy + 8, 1.6, 14);
  }
  // water stains with dark tide lines running down from the ceiling
  for (let k = 0; k < 5; k++) {
    const x = r() * size, y = -20 + r() * size * 0.3, rad = 60 + r() * 150;
    wrapX(size, (dx) => {
      for (let j = 0; j < 3; j++) {
        blobPath(g, x + dx, y + j * 8, rad * (1 - j * 0.2), rng(k * 31 + 7), 0.35, 16);
        g.fillStyle = `rgba(120,88,40,${0.08 + j * 0.03})`; g.fill();
        g.strokeStyle = `rgba(92,62,26,${0.22 - j * 0.04})`; g.lineWidth = 2.5 - j * 0.5; g.stroke();
      }
    });
  }
  for (let k = 0; k < 40; k++) {
    const x = r() * size, y0 = r() * size * 0.35, len = size * (0.08 + r() * 0.4), al = 0.06 + r() * 0.16;
    wrapX(size, (dx) => {
      const gr = g.createLinearGradient(0, y0, 0, y0 + len);
      gr.addColorStop(0, `rgba(96,70,34,${al})`); gr.addColorStop(1, 'rgba(96,70,34,0)');
      g.strokeStyle = gr; g.lineWidth = 1 + r() * 3;
      g.beginPath(); g.moveTo(x + dx, y0); g.lineTo(x + dx + (r() - 0.5) * 4, y0 + len); g.stroke();
    });
  }
  // peeled paper at the seams (every 0.5 m), showing grey plaster underneath
  for (let seam = 0; seam < 4; seam++) {
    const sx = seam * size / 4 + 2;
    g.fillStyle = 'rgba(60,50,34,0.35)'; g.fillRect(sx - 1, 0, 2, size - skirt);
    bg.fillStyle = 'rgb(96,96,96)'; bg.fillRect(sx - 1, 0, 2, size - skirt);
    for (let k = 0; k < 2; k++) {
      if (r() < 0.35) continue;
      const y = r() * (size - skirt - 200), hgt = 60 + r() * 260, w = 14 + r() * 50, side = r() < 0.5 ? -1 : 1;
      g.beginPath(); g.moveTo(sx, y);
      for (let t = 0; t <= 1; t += 0.1) g.lineTo(sx + side * w * Math.sin(t * Math.PI) * (0.6 + r() * 0.4), y + t * hgt);
      g.closePath();
      g.fillStyle = 'rgba(150,146,134,0.95)'; g.fill();
      g.strokeStyle = 'rgba(40,30,18,0.5)'; g.lineWidth = 2; g.stroke();
      bg.beginPath(); bg.moveTo(sx, y);
      for (let t = 0; t <= 1; t += 0.1) bg.lineTo(sx + side * w * Math.sin(t * Math.PI) * 0.8, y + t * hgt);
      bg.closePath(); bg.fillStyle = 'rgb(108,108,108)'; bg.fill();
      rg.fillStyle = 'rgb(250,250,250)'; rg.fillRect(sx - w, y, w * 2, hgt);
    }
  }
  // mould speckle low on the wall
  speckle(g, size, 900, r, ['rgba(34,40,26,0.35)', 'rgba(26,24,18,0.3)'], 2.4);
  g.fillStyle = 'rgba(0,0,0,0)';
  // scuffs and a few dark finger smears at hand height
  for (let k = 0; k < 30; k++) {
    const x = r() * size, y = size - skirt - r() * 140, w = 20 + r() * 90;
    g.strokeStyle = `rgba(30,24,18,${0.05 + r() * 0.15})`; g.lineWidth = 1 + r() * 3;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y + (r() - 0.5) * 6); g.stroke();
  }
  for (let k = 0; k < 3; k++) {
    const x = r() * size, y = size * (0.4 + r() * 0.15);
    for (let f = 0; f < 4; f++) {
      const gr = g.createLinearGradient(0, y, 0, y + 90 + r() * 80);
      gr.addColorStop(0, 'rgba(40,26,18,0.3)'); gr.addColorStop(1, 'rgba(40,26,18,0)');
      g.strokeStyle = gr; g.lineWidth = 5; g.beginPath(); g.moveTo(x + f * 11, y + Math.abs(f - 1.5) * 6); g.lineTo(x + f * 12 + 6, y + 150); g.stroke();
    }
  }
  return { color: c, bump: b, rough: rc };
}

// Worn floorboards running along u. One tile = 2 m x 2 m, 16 boards of 12.5 cm.
export function floorboardTextures(seed = 93, tone = [104, 78, 54], size = 1024) {
  const r = rng(seed);
  const n1 = tileNoise(size, 4, 6, r), n2 = tileNoise(size, 64, 2, r), n3 = tileNoise(size, 8, 4, r);
  const [c, g] = mk(size), [b, bg] = mk(size), [rc, rg] = mk(size);
  const ci = g.createImageData(size, size), bi = bg.createImageData(size, size), ri = rg.createImageData(size, size);
  const N = 16, bw = size / N;
  // each board row is cut into lengths with butt joints at random places
  const rows = Array.from({ length: N }, () => {
    const cuts = [r() * size]; if (r() < 0.6) cuts.push((cuts[0] + size * (0.35 + r() * 0.3)) % size);
    return { cuts, tone: 0.75 + r() * 0.4, off: r() * 100, hue: (r() - 0.5) * 0.12 };
  });
  for (let y = 0; y < size; y++) {
    const row = rows[Math.floor(y / bw)], yb = (y % bw) / bw;
    for (let x = 0; x < size; x++) {
      const i = y * size + x, o = i * 4, a = n1[i], f = n2[i], m = n3[i];
      let seg = 0; for (const cx of row.cuts) if (x > cx) seg++;
      const t = row.tone * (1 + ((seg * 0.37) % 0.2) - 0.1);
      const grain = Math.sin(y * 0.9 + row.off + Math.sin(x * 0.012 + row.off + seg) * 3 + a * 8) * 0.5 + 0.5;
      let s = (0.7 + grain * 0.18 + (f - 0.5) * 0.2 + (a - 0.5) * 0.3) * t;
      // foot traffic wears the finish pale and grey
      const wear = sstep(0.35, 0.75, m);
      let R = tone[0] * s * (1 + row.hue), G = tone[1] * s, B = tone[2] * s * (1 - row.hue);
      R = lerp(R, 128, wear * 0.3); G = lerp(G, 112, wear * 0.3); B = lerp(B, 92, wear * 0.3);
      const gap = yb < 0.035 || yb > 0.965;
      let joint = false; for (const cx of row.cuts) if (Math.abs(x - cx) < 1.6) joint = true;
      if (gap || joint) { R *= 0.25; G *= 0.22; B *= 0.2; }
      ci.data[o] = R; ci.data[o + 1] = G; ci.data[o + 2] = B; ci.data[o + 3] = 255;
      const cup = Math.sin(yb * Math.PI) * 30;
      bi.data[o] = bi.data[o + 1] = bi.data[o + 2] = gap || joint ? 20 : 110 + cup + grain * 18 + (f - 0.5) * 20; bi.data[o + 3] = 255;
      ri.data[o] = ri.data[o + 1] = ri.data[o + 2] = Math.min(255, 150 + wear * 80 + (f - 0.5) * 40); ri.data[o + 3] = 255;
    }
  }
  g.putImageData(ci, 0, 0); bg.putImageData(bi, 0, 0); rg.putImageData(ri, 0, 0);
  // nail heads at the joists, dark spills, dust
  g.fillStyle = 'rgba(24,20,16,0.9)';
  for (let j = 0; j < 5; j++) for (let k = 0; k < N; k++) { const x = (j + 0.5) * size / 5, y = k * bw + bw / 2; g.fillRect(x - 3, y - 12, 4, 4); g.fillRect(x - 3, y + 8, 4, 4); }
  for (let k = 0; k < 9; k++) {
    const x = r() * size, y = r() * size, rad = 20 + r() * 90;
    wrap9(size, (dx, dy) => {
      blobPath(g, x + dx, y + dy, rad, rng(k + 5), 0.5, 14);
      g.fillStyle = `rgba(30,20,12,${0.12 + r() * 0.25})`; g.fill();
      blobPath(rg, x + dx, y + dy, rad, rng(k + 5), 0.5, 14); rg.fillStyle = 'rgb(120,120,120)'; rg.fill();
    });
  }
  speckle(g, size, 1500, r, ['rgba(160,150,130,0.25)', 'rgba(20,16,12,0.3)'], 1.4);
  return { color: c, bump: b, rough: rc };
}

// Cracked checkerboard lino for the kitchen and bathroom: 25 cm squares, 2 m tile.
export function linoTexture(seed = 95, size = 512) {
  const r = rng(seed);
  const n1 = tileNoise(size, 4, 5, r), n2 = tileNoise(size, 32, 2, r);
  const [c, g] = mk(size);
  const ci = g.createImageData(size, size), sq = size / 8;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, o = i * 4;
    const dark = (Math.floor(x / sq) + Math.floor(y / sq)) % 2;
    const base = dark ? [74, 86, 76] : [192, 184, 160];
    const s = 0.82 + (n1[i] - 0.5) * 0.4 + (n2[i] - 0.5) * 0.1;
    const dirt = sstep(0.45, 0.8, n1[i]) * 0.35;
    const edge = Math.min(x % sq, sq - x % sq, y % sq, sq - y % sq) < 1.2 ? 0.55 : 1;
    ci.data[o] = base[0] * s * (1 - dirt) * edge; ci.data[o + 1] = base[1] * s * (1 - dirt) * edge; ci.data[o + 2] = base[2] * s * (1 - dirt * 1.2) * edge; ci.data[o + 3] = 255;
  }
  g.putImageData(ci, 0, 0);
  for (let k = 0; k < 10; k++) {
    const pts = crackPoints(r() * size, r() * size, 30 + r() * 120, r);
    wrap9(size, (dx, dy) => { g.strokeStyle = 'rgba(30,26,20,0.8)'; g.lineWidth = 1; strokePts(g, pts, dx, dy); });
  }
  // a few lifted / missing tiles showing black adhesive
  for (let k = 0; k < 3; k++) {
    const tx = Math.floor(r() * 8) * sq, ty = Math.floor(r() * 8) * sq;
    blobPath(g, tx + sq / 2, ty + sq / 2, sq * 0.45, r, 0.5, 12); g.fillStyle = 'rgba(28,24,18,0.92)'; g.fill();
  }
  speckle(g, size, 500, r, ['rgba(20,16,12,0.35)'], 1.5);
  return c;
}

// A threadbare rug: border bands, a geometric centre medallion, worn bald patches.
export function rugTexture(seed = 97, size = 512) {
  const r = rng(seed);
  const n = tileNoise(size, 8, 4, r), n2 = tileNoise(size, 64, 2, r);
  const [c, g] = mk(size);
  g.fillStyle = '#5a2620'; g.fillRect(0, 0, size, size);
  const band = (inset, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.strokeRect(inset, inset, size - inset * 2, size - inset * 2); };
  band(14, 22, '#2a2a3a'); band(34, 6, '#b08a50'); band(48, 14, '#3a4a40'); band(62, 4, '#b08a50');
  g.save(); g.translate(size / 2, size / 2);
  for (const [rad, col] of [[150, '#2a2a3a'], [120, '#b08a50'], [96, '#6a3028'], [60, '#3a4a40'], [30, '#b08a50']]) {
    g.beginPath(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, rr = k % 2 ? rad * 0.72 : rad; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    g.closePath(); g.fillStyle = col; g.fill();
  }
  g.restore();
  for (let k = 0; k < 60; k++) { g.fillStyle = r() < 0.5 ? '#b08a50' : '#2a2a3a'; const x = 80 + r() * (size - 160), y = 80 + r() * (size - 160); if (Math.hypot(x - size / 2, y - size / 2) > 170) g.fillRect(x, y, 6, 6); }
  const id = g.getImageData(0, 0, size, size), d = id.data;
  for (let i = 0; i < size * size; i++) {
    const o = i * 4, wear = sstep(0.5, 0.8, n[i]);
    const s = 0.75 + (n2[i] - 0.5) * 0.5;
    for (let k = 0; k < 3; k++) d[o + k] = lerp(d[o + k] * s, [120, 104, 84][k], wear * 0.7);
  }
  g.putImageData(id, 0, 0);
  return c;
}

// Old framed photographs: sepia, scratched, faces worn away.
export function photoTexture(kind = 0, seed = 99) {
  const r = rng(seed), W = 256, Hh = 320;
  const c = document.createElement('canvas'); c.width = W; c.height = Hh;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, Hh);
  gr.addColorStop(0, '#b7a37e'); gr.addColorStop(1, '#6d5b40');
  g.fillStyle = gr; g.fillRect(0, 0, W, Hh);
  g.fillStyle = 'rgba(40,30,20,0.85)';
  if (kind === 0) {
    // a single figure from the chest up
    g.beginPath(); g.ellipse(W / 2, Hh * 0.38, 46, 58, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(W * 0.12, Hh); g.quadraticCurveTo(W * 0.15, Hh * 0.6, W / 2, Hh * 0.58); g.quadraticCurveTo(W * 0.85, Hh * 0.6, W * 0.88, Hh); g.fill();
    // the face has been scratched out
    g.strokeStyle = 'rgba(230,220,200,0.9)'; g.lineWidth = 2;
    for (let k = 0; k < 40; k++) { g.beginPath(); const x = W / 2 + (r() - 0.5) * 70, y = Hh * 0.38 + (r() - 0.5) * 80; g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 40); g.stroke(); }
  } else if (kind === 1) {
    // two figures standing in front of a house
    g.fillRect(W * 0.1, Hh * 0.35, W * 0.8, Hh * 0.35);
    g.beginPath(); g.moveTo(W * 0.05, Hh * 0.36); g.lineTo(W / 2, Hh * 0.18); g.lineTo(W * 0.95, Hh * 0.36); g.fill();
    g.fillStyle = 'rgba(200,184,150,0.9)'; g.fillRect(W * 0.2, Hh * 0.45, 30, 40); g.fillRect(W * 0.65, Hh * 0.45, 30, 40);
    g.fillStyle = 'rgba(20,14,10,0.95)';
    for (const x of [W * 0.38, W * 0.58]) { g.beginPath(); g.arc(x, Hh * 0.6, 12, 0, 7); g.fill(); g.fillRect(x - 15, Hh * 0.64, 30, 90); }
  } else {
    // an empty chair in a bare room
    g.fillStyle = 'rgba(60,46,30,0.6)'; g.fillRect(0, Hh * 0.68, W, Hh * 0.32);
    g.fillStyle = 'rgba(20,14,10,0.9)';
    g.fillRect(W * 0.4, Hh * 0.35, 8, 120); g.fillRect(W * 0.4, Hh * 0.55, 60, 8); g.fillRect(W * 0.4 + 52, Hh * 0.55, 8, 70); g.fillRect(W * 0.4 + 4, Hh * 0.55, 6, 70);
  }
  // age: vignette, foxing, scratches
  const v = g.createRadialGradient(W / 2, Hh / 2, 40, W / 2, Hh / 2, 200);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(30,20,10,0.7)'); g.fillStyle = v; g.fillRect(0, 0, W, Hh);
  for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(110,70,30,${r() * 0.3})`; g.beginPath(); g.arc(r() * W, r() * Hh, 1 + r() * 4, 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(240,230,210,0.35)'; g.lineWidth = 0.8;
  for (let k = 0; k < 14; k++) { g.beginPath(); const x = r() * W; g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 30, Hh); g.stroke(); }
  return c;
}

// What you see through the glass: bright overcast with the bare tree line.
export function windowViewTexture(seed = 101) {
  const r = rng(seed), S = 256;
  const [c, g] = mk(S);
  const gr = g.createLinearGradient(0, 0, 0, S);
  gr.addColorStop(0, '#e6e9ea'); gr.addColorStop(0.62, '#c9cdcd'); gr.addColorStop(0.66, '#8a8a80'); gr.addColorStop(1, '#6d6a5c');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(70,72,72,0.55)';
  for (let k = 0; k < 9; k++) {
    let x = r() * S, y = S * 0.66, w = 3 + r() * 3; g.lineWidth = w;
    g.beginPath(); g.moveTo(x, y);
    for (let j = 0; j < 6; j++) { x += (r() - 0.5) * 14; y -= 14 + r() * 10; g.lineTo(x, y); w *= 0.75; }
    g.stroke();
  }
  return c;
}

// Cellar: poured concrete walls (2 m wide x 2.3 m tile) with form lines, tie holes, damp and efflorescence.
export function cellarTextures(seed = 103, size = 512, floor = false) {
  const r = rng(seed);
  const n1 = tileNoise(size, 4, 6, r), n2 = tileNoise(size, 32, 3, r), n3 = tileNoise(size, 8, 4, r);
  const [c, g] = mk(size), [b, bg] = mk(size);
  const ci = g.createImageData(size, size), bi = bg.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, o = i * 4, a = n1[i], f = n2[i], m = n3[i], v = y / size;
    let s = 0.7 + (a - 0.5) * 0.4 + (f - 0.5) * 0.15;
    const damp = floor ? sstep(0.5, 0.8, m) * 0.5 : sstep(0.55, 1.0, v + (m - 0.5) * 0.35) * 0.6;
    let R = 128 * s, G = 124 * s, B = 114 * s;
    R *= 1 - damp * 0.55; G *= 1 - damp * 0.5; B *= 1 - damp * 0.45;
    if (!floor && Math.abs((y % (size / 4)) - 1) < 1.2) { R *= 0.7; G *= 0.7; B *= 0.7; }
    ci.data[o] = R; ci.data[o + 1] = G; ci.data[o + 2] = B; ci.data[o + 3] = 255;
    bi.data[o] = bi.data[o + 1] = bi.data[o + 2] = 128 + (f - 0.5) * 90 + (a - 0.5) * 30; bi.data[o + 3] = 255;
  }
  g.putImageData(ci, 0, 0); bg.putImageData(bi, 0, 0);
  if (!floor) {
    for (let k = 0; k < 8; k++) { const x = (k % 4 + 0.5) * size / 4, y = (Math.floor(k / 4) + 0.5) * size / 2; g.fillStyle = 'rgba(20,18,16,0.8)'; g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); g.fillStyle = 'rgba(110,60,30,0.3)'; g.fillRect(x - 1.5, y, 3, 30 + r() * 40); }
    for (let k = 0; k < 6; k++) {   // white salt bloom along the damp line
      const x = r() * size, y = size * (0.6 + r() * 0.2), rad = 30 + r() * 60;
      wrapX(size, (dx) => { const gr = g.createRadialGradient(x + dx, y, 0, x + dx, y, rad); gr.addColorStop(0, 'rgba(220,216,200,0.25)'); gr.addColorStop(1, 'rgba(220,216,200,0)'); g.fillStyle = gr; g.fillRect(x + dx - rad, y - rad, rad * 2, rad * 2); });
    }
  }
  for (let k = 0; k < 9; k++) {
    const pts = crackPoints(r() * size, r() * size, 40 + r() * 150, r);
    wrap9(size, (dx, dy) => { g.strokeStyle = 'rgba(30,26,22,0.8)'; g.lineWidth = 1.2; strokePts(g, pts, dx, dy); bg.strokeStyle = 'rgb(20,20,20)'; bg.lineWidth = 1.6; strokePts(bg, pts, dx, dy); });
  }
  speckle(g, size, 700, r, ['rgba(20,18,14,0.4)', 'rgba(180,176,160,0.3)'], 1.6);
  return { color: c, bump: b };
}

export function createMaterials(renderer) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = (canvas, srgb = true, clampT = false) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = clampT ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });

  const mud = mudTextures();
  const clap = clapboardTextures();
  const shingle = shingleTextures();
  const contRed = containerTextures([124, 52, 38], 71, 'KTLU 482193 5');
  const contTeal = containerTextures([52, 92, 88], 75, 'NRSU 207541 8');
  const rep = (t, x, y = x) => { t.repeat.set(x, y); return t; };
  const wood = woodTexture(9);
  const crateWood = woodTexture(31, 512, [140, 108, 70], 5);
  const teal = paintTexture([34, 82, 80], 17, 256, { chips: 60, rust: 0.7 });
  const grey = paintTexture([120, 118, 110], 19, 256, { chips: 40, rust: 0.8 });
  const pipe = paintTexture([96, 104, 92], 21, 256, { chips: 60, rust: 1.0 });
  const red = paintTexture([160, 26, 22], 25, 256, { chips: 20, rust: 0.2, grime: 0.4 });
  const metal = paintTexture([150, 148, 140], 29, 256, { chips: 10, rust: 0.4 });

  const m = {
    // yard ground: UVs stay 0..1 so the soft edge alpha covers the whole plane; detail maps repeat 13x (4 m tiles)
    mud: std({ map: rep(tex(mud.color), 13), normalMap: rep(tex(heightToNormal(mud.bump, 3.4), false), 13), roughnessMap: rep(tex(mud.rough, false), 13), roughness: 1, alphaMap: tex(yardEdgeTexture(), false), transparent: true }),
    grass: std({ map: tex(grassTexture()), roughness: 1 }),
    clapboard: std({ map: tex(clap.color), normalMap: tex(heightToNormal(clap.bump, 2.4), false), roughnessMap: tex(clap.rough, false), roughness: 1 }),
    shingles: std({ map: tex(shingle.color), normalMap: tex(heightToNormal(shingle.bump, 2.0), false), roughness: 0.9 }),
    trim: std({ map: tex(paintTexture([226, 224, 214], 77, 256, { chips: 50, rust: 0, grime: 0.8 })), roughness: 0.75 }),
    deck: std({ map: tex(woodTexture(79, 512, [128, 120, 108], 6)), roughness: 0.9 }),
    containerRed: std({ map: tex(contRed.color), normalMap: tex(heightToNormal(contRed.bump, 2.2), false), roughness: 0.62, metalness: 0.35 }),
    containerTeal: std({ map: tex(contTeal.color), normalMap: tex(heightToNormal(contTeal.bump, 2.2), false), roughness: 0.62, metalness: 0.35 }),
    windowGlass: std({ color: 0x15181b, roughness: 0.06, metalness: 0.1 }),
    bark: std({ color: 0x3b3631, roughness: 0.95 }),
    brick: std({ map: tex(bricksTexture()), roughness: 0.92 }),
    concrete: std({ map: tex(concreteBlockTexture(81)), roughness: 0.95, color: 0xbab4a8 }),
    plywood: std({ map: tex(woodTexture(83, 512, [150, 124, 88], 1)), roughness: 0.9 }),
    wood: std({ map: tex(wood), bumpMap: tex(wood, false), bumpScale: 0.35, roughness: 0.8 }),
    crate: std({ map: tex(crateWood), bumpMap: tex(crateWood, false), bumpScale: 0.35, roughness: 0.82 }),
    teal: std({ map: tex(teal), roughness: 0.6, metalness: 0.15 }),
    grey: std({ map: tex(grey), roughness: 0.7, metalness: 0.2 }),
    pipe: std({ map: tex(pipe), roughness: 0.6, metalness: 0.3 }),
    redPaint: std({ map: tex(red), roughness: 0.45, metalness: 0.1 }),
    metal: std({ map: tex(metal), roughness: 0.5, metalness: 0.5 }),
    rubble: std({ map: tex(concreteBlockTexture()), roughness: 0.95 }),
    barrelBlue: std({ map: tex(barrelTexture([38, 70, 120], 41)), roughness: 0.55, metalness: 0.3 }),
    barrelRust: std({ map: tex(barrelTexture([120, 70, 36], 43)), roughness: 0.7, metalness: 0.25 }),
    doorWood: std({ map: tex(doorTexture('wood', 3)), roughness: 0.8 }),
    doorWhite: std({ map: tex(doorTexture('white', 5)), roughness: 0.55 }),
    doorWhite2: std({ map: tex(doorTexture('white', 8)), roughness: 0.55 }),
    doorRed: std({ map: tex(doorTexture('red', 7)), roughness: 0.5 }),
    glass: std({ map: tex(wireGlassTexture()), roughness: 0.12, metalness: 0.0, color: 0x9aa4a0 }),
    void: new THREE.MeshBasicMaterial({ map: tex(voidTexture()) }),
    tube: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(1.0, 0.84, 0.55), emissiveIntensity: 2.2, roughness: 0.4 }),
    tubeDead: std({ color: 0x8a8578, roughness: 0.5 }),
    exitSign: new THREE.MeshStandardMaterial({ color: 0x0, emissive: 0xffffff, emissiveMap: tex(exitSignTexture()), emissiveIntensity: 2.6 }),
    firstAid: std({ map: tex(firstAidTexture()), roughness: 0.5 }),
    rubber: std({ color: 0x15130f, roughness: 0.9 }),
  };
  // ---- house interior
  const fb = floorboardTextures(93), ceil = ceilingTextures(512, 37);
  const cw = cellarTextures(103), cf = cellarTextures(105, 512, true);
  const wpMat = (t) => std({ map: tex(t.color), normalMap: tex(heightToNormal(t.bump, 1.6, false), false), roughnessMap: tex(t.rough, false), roughness: 1 });
  // the old corridor surfaces: stained plaster over a gloss dado, worn terrazzo, water-marked ceiling (3 m tiles)
  const cwall = wallTextures(), cfloor = floorTextures();
  Object.assign(m, {
    wall: std({ map: tex(cwall.color, true, true), normalMap: tex(heightToNormal(cwall.bump, 2.6, false), false, true), roughnessMap: tex(cwall.rough, false, true), roughness: 1.0 }),
    floor: std({ map: tex(cfloor.color), normalMap: tex(heightToNormal(cfloor.bump, 3.2), false), roughnessMap: tex(cfloor.rough, false), roughness: 1.0 }),
    ceiling: std({ map: tex(ceil.color), normalMap: tex(heightToNormal(ceil.bump, 2.0), false), roughness: 0.95 }),
  });
  Object.assign(m, {
    floorboards: std({ map: tex(fb.color), normalMap: tex(heightToNormal(fb.bump, 2.2), false), roughnessMap: tex(fb.rough, false), roughness: 1 }),
    lino: std({ map: tex(linoTexture()), roughness: 0.55 }),
    plaster: std({ map: tex(ceil.color), normalMap: tex(heightToNormal(ceil.bump, 1.2), false), roughness: 0.95, color: 0xd8d2c4 }),
    rug: std({ map: tex(rugTexture()), roughness: 1 }),
    photos: [0, 1, 2].map((k) => std({ map: tex(photoTexture(k, 99 + k)), roughness: 0.35 })),
    windowView: new THREE.MeshBasicMaterial({ map: tex(windowViewTexture()), color: new THREE.Color(1.5, 1.5, 1.5), fog: false, toneMapped: true }),
    cellarWall: std({ map: tex(cw.color), normalMap: tex(heightToNormal(cw.bump, 2.0), false), roughness: 0.95 }),
    cellarFloor: std({ map: tex(cf.color), normalMap: tex(heightToNormal(cf.bump, 2.0), false), roughness: 0.9 }),
    darkWood: std({ map: tex(woodTexture(107, 512, [76, 52, 34], 3)), roughness: 0.6 }),
    paleWood: std({ map: tex(woodTexture(109, 512, [150, 124, 92], 5)), roughness: 0.75 }),
    cabinet: std({ map: tex(paintTexture([150, 170, 150], 111, 256, { chips: 70, rust: 0.2, grime: 0.9 })), roughness: 0.55 }),
    fabric: std({ map: tex(paintTexture([96, 104, 70], 113, 256, { chips: 0, rust: 0, grime: 0.9 })), roughness: 1 }),
    fabricRed: std({ map: tex(paintTexture([110, 46, 38], 115, 256, { chips: 0, rust: 0, grime: 0.9 })), roughness: 1 }),
    linen: std({ map: tex(paintTexture([196, 188, 166], 117, 256, { chips: 0, rust: 0.3, grime: 1.0 })), roughness: 1 }),
    porcelain: std({ map: tex(paintTexture([222, 220, 208], 119, 256, { chips: 12, rust: 0.6, grime: 0.6 })), roughness: 0.18 }),
    enamel: std({ map: tex(paintTexture([200, 200, 186], 121, 256, { chips: 30, rust: 0.8, grime: 0.7 })), roughness: 0.3, metalness: 0.1 }),
    shade: std({ color: 0xcfb98a, roughness: 0.9, side: THREE.DoubleSide, emissive: 0x3a2a10, emissiveIntensity: 0.6 }),
    bulb: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3.9, 2.4) }),
    bulbDead: std({ color: 0x6c665a, roughness: 0.2 }),
    mirror: std({ color: 0x8a908e, roughness: 0.05, metalness: 1 }),
    screen: std({ color: 0x0a0c0b, roughness: 0.12, emissive: 0x1a2220, emissiveIntensity: 0.5 }),
    cord: std({ color: 0x1a1714, roughness: 0.7 }),
    doorPaint: std({ map: tex(paintTexture([206, 199, 180], 123, 512, { chips: 22, rust: 0.05, grime: 0.9 })), roughness: 0.6 }),
  });
  m.paper = [0, 1, 2, 3].map((i) => std({ map: tex(paperTexture(100 + i)), roughness: 0.9, side: THREE.DoubleSide }));
  m.textures = { tex };
  return m;
}
