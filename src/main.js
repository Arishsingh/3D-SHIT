import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { AudioEngine } from './audio.js';
import { PORTFOLIO } from './portfolio.js';

// ============================================================ constants
const HALL = { x0: -1.5, x1: 1.5, h: 3, z0: 0, z1: -40 };
const TILE = 3;                 // metres covered by one texture tile
const EYE = 1.38;               // chest-mounted camera height
const WIN = { x0: -0.95, x1: 0.95, y0: 1.0, y1: 2.75, z: -40 };
const SLATS = [1.1, 1.31, 1.52, 1.94, 2.15, 2.36, 2.57, 2.7];  // one missing board around 1.73
const SLAT_H = 0.085;
const SUN = new THREE.Vector3(0.6, 4.6, -62);
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const DPR = Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1.5 : 2);          // full native sharpness

// ============================================================ renderer
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let resScale = 1;                       // lowered automatically if the machine can't hold the frame rate
const PR = () => DPR * resScale;
renderer.setPixelRatio(PR());
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc8873e);
scene.fog = new THREE.FogExp2(0xb97c3c, 0.0105);          // warm sunset haze

const camera = new THREE.PerspectiveCamera(88, innerWidth / innerHeight, 0.05, 260);
camera.rotation.order = 'YXZ';
scene.add(camera);

const M = TX.createMaterials(renderer);

const solids = [];               // raycast targets

// ============================================================ helpers
function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}
function mesh(geo, mat, { pos, rot, cast = true, receive = true, solid = true, parent = scene, kind = 'hard' } = {}) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  m.castShadow = cast; m.receiveShadow = receive;
  m.userData.kind = kind;
  parent.add(m);
  if (solid) solids.push(m);
  return m;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const obstacles = [];            // {x, z, r} circles for collision
const R = TX.rng(99);

// ---- reusable props
function barrel(x, z, mat, tipped = false) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  const b = mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 20), mat, { parent: g, pos: [0, 0.44, 0], cast: true, kind: 'metal' });
  mesh(new THREE.TorusGeometry(0.29, 0.012, 6, 24), M.metal, { parent: g, pos: [0, 0.86, 0], rot: [Math.PI / 2, 0, 0], solid: false });
  if (tipped) { g.rotation.z = Math.PI / 2; g.position.y = 0.29; g.rotation.y = R() * 3; obstacles.push({ x, z, r: 0.55 }); }
  else { g.rotation.y = R() * 6; obstacles.push({ x, z, r: 0.38 }); }
  return b;
}
function crate(x, z, s, ry, y = 0) {
  mesh(box(s, s, s), M.crate, { pos: [x, y + s / 2, z], rot: [0, ry, 0], cast: true, kind: 'wood' });
  if (y === 0) obstacles.push({ x, z, r: s * 0.68 });
}

// ============================================================ level: an overcast yard around an old clapboard house
// Original layout. Origin = middle of the yard, the house sits to the north (-z),
// you spawn to the south looking at it.
const LEVEL = { spawn: [0, 12], bounds: 23.4, fence: 24 };   // a picket fence encloses the yard
const boxes = [];                                   // axis-aligned collision boxes
const solidBox = (x0, x1, z0, z1) => boxes.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) });
// world-space AABB of a rotated w x d footprint
const footprint = (x, z, w, d, ry, pad = 0) => {
  const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry)), hx = (w * c + d * s) / 2 + pad, hz = (w * s + d * c) / 2 + pad;
  solidBox(x - hx, x + hx, z - hz, z + hz);
};

// ---- sky dome (follows the camera) with drifting overcast cloud
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { uTime: { value: 0 } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform float uTime; varying vec3 vDir;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + 1.0), f.x), f.y); }
    float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
    void main() {
      float y = vDir.y;
      vec2 uv = vDir.xz / (max(y, 0.0) + 0.18) * 0.9 + vec2(uTime * 0.004, uTime * 0.0015);
      float cl = fbm(uv) * 0.7 + fbm(uv * 3.1) * 0.3;
      // sunset: gold at the horizon, amber above, dusky violet overhead; brightest toward the low sun
      vec3 L = normalize(vec3(-0.85, 0.16, -0.5));
      float sd = max(dot(normalize(vDir), L), 0.0);
      float yy = clamp(y, 0.0, 1.0);
      vec3 horizon = vec3(1.0, 0.66, 0.2), mid = vec3(0.95, 0.5, 0.2), zenith = vec3(0.42, 0.3, 0.36);
      vec3 col = mix(horizon, mid, smoothstep(0.0, 0.22, yy));
      col = mix(col, zenith, smoothstep(0.15, 0.85, yy));
      col += vec3(1.0, 0.62, 0.18) * pow(sd, 6.0) * 0.45 + vec3(1.0, 0.82, 0.45) * pow(sd, 60.0) * 0.6;
      // clouds: dark bellies away from the sun, edges lit gold toward it
      float lit = 0.6 + 0.6 * pow(sd, 3.0);
      col = mix(col * (0.7 + 0.25 * cl), col * (0.85 + 0.5 * cl) * lit, cl);
      col += vec3(1.0, 0.92, 0.7) * smoothstep(0.9993, 0.9997, sd) * 2.5;     // the sun itself, low and soft
      col = mix(col, vec3(0.8, 0.52, 0.26), smoothstep(0.04, -0.12, y));
      gl_FragColor = vec4(col * 0.95, 1.0);
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), skyMat);
sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

// ---- ground: dead grass everywhere, a muddy gravel yard in the middle fading into it
mesh(scaleUV(new THREE.PlaneGeometry(360, 360), 120, 120), M.grass, { rot: [-Math.PI / 2, 0, 0], cast: false });
mesh(new THREE.PlaneGeometry(52, 52), M.mud, { pos: [0, 0.012, 0], rot: [-Math.PI / 2, 0, 0], cast: false }).renderOrder = 0;

// soft contact shadow where a wall meets the ground
const AO_TEX = new THREE.CanvasTexture(TX.aoGradientTexture(true));
const aoMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: AO_TEX, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
function groundAO(x, z, len, ry, depth = 0.7) {
  const m = mesh(new THREE.PlaneGeometry(len, depth), aoMat, { pos: [x + Math.sin(ry) * depth / 2, 0.02, z + Math.cos(ry) * depth / 2], rot: [-Math.PI / 2, ry, 0], cast: false, receive: false, solid: false });
  m.rotation.order = 'YXZ'; m.renderOrder = 1;
}

// ---- the house
function windowUnit(parent, x, y, z, ry, w = 0.95, h = 1.35, boarded = false) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g);
  const t = 0.09, o = { parent: g, kind: 'wood' };
  mesh(box(w + t * 2, t, 0.07), M.trim, { ...o, pos: [0, h / 2 + t / 2, 0.035] });
  mesh(box(w + t * 2.6, t * 0.8, 0.12), M.trim, { ...o, pos: [0, -h / 2 - t / 2, 0.06] });      // sill
  mesh(box(t, h, 0.07), M.trim, { ...o, pos: [-w / 2 - t / 2, 0, 0.035] });
  mesh(box(t, h, 0.07), M.trim, { ...o, pos: [w / 2 + t / 2, 0, 0.035] });
  mesh(new THREE.PlaneGeometry(w, h), M.windowGlass, { parent: g, pos: [0, 0, 0.01], kind: 'glass' });
  mesh(box(w, 0.04, 0.03), M.trim, { ...o, pos: [0, 0, 0.02] });                               // muntins
  mesh(box(0.04, h, 0.03), M.trim, { ...o, pos: [0, 0, 0.02] });
  if (boarded) {
    mesh(box(w + 0.1, h + 0.08, 0.025), M.plywood, { ...o, pos: [0, 0, 0.06], rot: [0, 0, 0.02] });
    for (const yy of [-h * 0.3, h * 0.3]) mesh(box(w + 0.3, 0.12, 0.03), M.deck, { ...o, pos: [0, yy, 0.08], rot: [0, 0, (R() - 0.5) * 0.2] });
  }
  // dark shutters on some windows
  if (!boarded && R() < 0.6) for (const sx of [-1, 1]) mesh(box(w * 0.48, h, 0.04), M.containerTeal, { ...o, pos: [sx * (w / 2 + t + w * 0.26), 0, 0.03], rot: [0, sx * 0.05, 0] });
}

const HOUSE = { x: -2, z: -10, W: 10, D: 7, H: 3.2, base: 0.5, roof: 2.4 };
{
  const { x: hx, z: hz, W, D, H, base, roof } = HOUSE;
  const g = new THREE.Group(); g.position.set(hx, 0, hz); scene.add(g);
  const o = { parent: g, kind: 'wood' };
  // block foundation
  mesh(scaleUV(box(W + 0.15, base, D + 0.15), 3, 0.3), M.concrete, { parent: g, pos: [0, base / 2, 0], kind: 'hard' });
  // clapboard walls (2 m texture tiles)
  const wallPlane = (len, x, z, ry) => mesh(scaleUV(new THREE.PlaneGeometry(len, H), len / 2, H / 2), M.clapboard, { ...o, pos: [x, base + H / 2, z], rot: [0, ry, 0] });
  wallPlane(W, 0, D / 2, 0); wallPlane(W, 0, -D / 2, Math.PI); wallPlane(D, -W / 2, 0, -Math.PI / 2); wallPlane(D, W / 2, 0, Math.PI / 2);
  // gable triangles on the short ends
  const tri = new THREE.Shape(); tri.moveTo(-D / 2, 0); tri.lineTo(D / 2, 0); tri.lineTo(0, roof); tri.closePath();
  const gableGeo = new THREE.ShapeGeometry(tri);
  { const uv = gableGeo.attributes.uv, p = gableGeo.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 2, p.getY(i) / 2); }
  mesh(gableGeo, M.clapboard, { ...o, pos: [W / 2, base + H, 0], rot: [0, Math.PI / 2, 0] });
  mesh(gableGeo, M.clapboard, { ...o, pos: [-W / 2, base + H, 0], rot: [0, -Math.PI / 2, 0] });
  // roof: two slopes with an overhang
  const run = D / 2 + 0.45, slope = Math.atan2(roof, D / 2), rlen = run / Math.cos(slope);
  for (const sz of [1, -1]) {
    const r = mesh(scaleUV(box(W + 0.9, 0.08, rlen), (W + 0.9) / 2, rlen / 2), M.shingles, { ...o, pos: [0, base + H + roof / 2 - 0.02 + (0.45 * Math.tan(slope)) * -0.5, sz * run / 2] });
    r.rotation.x = sz * slope;
    // fascia board along the eave
    mesh(box(W + 0.9, 0.18, 0.04), M.trim, { ...o, pos: [0, base + H - 0.45 * Math.tan(slope) - 0.06, sz * (D / 2 + 0.47)] });
  }
  mesh(box(W + 0.95, 0.1, 0.14), M.trim, { ...o, pos: [0, base + H + roof + 0.02, 0] });     // ridge cap
  // brick chimney
  mesh(box(0.7, 2.4, 0.7), M.brick, { ...o, pos: [W * 0.28, base + H + roof * 0.55, -D * 0.18], kind: 'hard' });
  mesh(box(0.82, 0.1, 0.82), M.concrete, { ...o, pos: [W * 0.28, base + H + roof * 0.55 + 1.22, -D * 0.18], kind: 'hard' });
  // corner boards
  for (const [cx, cz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) mesh(box(0.14, H, 0.14), M.trim, { ...o, pos: [cx * W / 2, base + H / 2, cz * D / 2] });
  // windows + front door
  const wy = base + 1.65;
  windowUnit(g, -3.3, wy, D / 2 + 0.005, 0); windowUnit(g, 2.9, wy, D / 2 + 0.005, 0, 0.95, 1.35, true);
  windowUnit(g, -2.8, wy, -D / 2 - 0.005, Math.PI); windowUnit(g, 2.6, wy, -D / 2 - 0.005, Math.PI);
  windowUnit(g, -W / 2 - 0.005, wy, 1.2, -Math.PI / 2); windowUnit(g, -W / 2 - 0.005, wy, -1.8, -Math.PI / 2, 0.95, 1.35, true);
  windowUnit(g, W / 2 + 0.005, wy, 0.6, Math.PI / 2); windowUnit(g, W / 2 + 0.005, base + H + 0.9, 0, Math.PI / 2, 0.7, 0.8);   // attic
  // door: panelled, with a dark inset window
  mesh(box(1.0, 2.1, 0.06), M.doorPaint, { ...o, pos: [-0.2, base + 1.05, D / 2 + 0.02] });
  mesh(new THREE.PlaneGeometry(0.5, 0.55), M.windowGlass, { parent: g, pos: [-0.2, base + 1.6, D / 2 + 0.055], kind: 'glass' });
  for (const yy of [0.35, 0.95]) mesh(box(0.7, 0.4, 0.02), M.doorPaint, { ...o, pos: [-0.2, base + yy, D / 2 + 0.06] });
  mesh(new THREE.SphereGeometry(0.035, 8, 6), M.metal, { parent: g, pos: [0.18, base + 1.0, D / 2 + 0.08], kind: 'metal' });
  for (const sx of [-1, 1]) mesh(box(0.1, 2.25, 0.08), M.trim, { ...o, pos: [-0.2 + sx * 0.55, base + 1.12, D / 2 + 0.03] });
  mesh(box(1.25, 0.1, 0.08), M.trim, { ...o, pos: [-0.2, base + 2.2, D / 2 + 0.03] });

  // covered porch along the front
  const PD = 2.3, pz = D / 2 + PD / 2;
  mesh(scaleUV(box(W, 0.12, PD), W / 3, 1), M.deck, { ...o, pos: [0, base - 0.06, pz] });
  mesh(box(W, base - 0.12, 0.08), M.trim, { ...o, pos: [0, (base - 0.12) / 2, D / 2 + PD - 0.04] });           // skirt
  const postX = [-W / 2 + 0.1, -2.6, 2.2, W / 2 - 0.1], postH = H - 0.3;
  for (const px of postX) mesh(box(0.13, postH, 0.13), M.trim, { ...o, pos: [px, base + postH / 2, D / 2 + PD - 0.12] });
  // porch roof, shallow slope from the wall out to the posts
  const prl = Math.hypot(PD + 0.3, 0.4);
  const pr = mesh(scaleUV(box(W + 0.4, 0.07, prl), (W + 0.4) / 2, prl / 2), M.shingles, { ...o, pos: [0, base + postH + 0.22, D / 2 + (PD + 0.3) / 2] });
  pr.rotation.x = Math.atan2(0.4, PD + 0.3);
  mesh(box(W + 0.4, 0.16, 0.12), M.trim, { ...o, pos: [0, base + postH + 0.02, D / 2 + PD - 0.12] });          // beam
  // railings with balusters between the posts (gap at the steps)
  const rail = (x0, x1) => {
    const len = x1 - x0, cx = (x0 + x1) / 2, rz = D / 2 + PD - 0.12;
    mesh(box(len, 0.07, 0.09), M.trim, { ...o, pos: [cx, base + 0.92, rz] });
    mesh(box(len, 0.05, 0.07), M.trim, { ...o, pos: [cx, base + 0.12, rz] });
    const count = Math.floor(len / 0.14);
    const inst = new THREE.InstancedMesh(box(0.035, 0.78, 0.035), M.trim, count);
    const mm = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const missing = R() < 0.06;
      mm.makeRotationZ(missing ? 0 : (R() - 0.5) * 0.05);
      mm.setPosition(x0 + (i + 0.5) * (len / count), base + 0.52, rz);
      if (missing) mm.makeScale(0, 0, 0);
      inst.setMatrixAt(i, mm);
    }
    inst.castShadow = true; inst.receiveShadow = true; inst.userData.kind = 'wood'; g.add(inst); solids.push(inst);
  };
  rail(postX[0], postX[1]); rail(postX[2], postX[3]);
  // side railings at the porch ends
  for (const sx of [-1, 1]) mesh(box(0.07, 0.07, PD - 0.2), M.trim, { ...o, pos: [sx * (W / 2 - 0.1), base + 0.92, D / 2 + PD / 2] });
  // steps
  for (let i = 0; i < 3; i++) mesh(box(1.9, 0.17, 0.32), M.deck, { ...o, pos: [-0.2, base - 0.17 * (i + 0.5) - 0.02, D / 2 + PD + 0.16 + i * 0.3] });

  // collision: the house itself, and the porch edge everywhere except the steps (you can walk up onto the porch)
  solidBox(hx - W / 2 - 0.15, hx + W / 2 + 0.15, hz - D / 2 - 0.15, hz + D / 2 + 0.7);      // keeps the lens off the door
  const front = hz + D / 2 + PD, sx0 = hx - 0.2 - 0.95, sx1 = hx - 0.2 + 0.95;
  solidBox(hx - W / 2 - 0.1, sx0, front - 0.2, front);
  solidBox(sx1, hx + W / 2 + 0.1, front - 0.2, front);
  solidBox(hx - W / 2 - 0.15, hx - W / 2 + 0.05, hz + D / 2, front);
  solidBox(hx + W / 2 - 0.05, hx + W / 2 + 0.15, hz + D / 2, front);
  // stair stringers so you come up the steps, not over their sides
  solidBox(sx0 - 0.1, sx0, front, front + 0.95);
  solidBox(sx1, sx1 + 0.1, front, front + 0.95);
  groundAO(hx, hz + D / 2 + PD + 0.04, W + 0.2, 0, 1.0);
  groundAO(hx, hz - D / 2 - 0.08, W + 0.2, Math.PI);
  groundAO(hx - W / 2 - 0.08, hz + 1.1, D + PD, -Math.PI / 2);
  groundAO(hx + W / 2 + 0.08, hz + 1.1, D + PD, Math.PI / 2);
}

// ---- shipping containers
function container(x, z, ry, mat, y = 0) {
  const L = 6.06, Wd = 2.44, Ht = 2.59;
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; scene.add(g);
  mesh(box(Wd, Ht, L), mat, { parent: g, pos: [0, Ht / 2, 0], kind: 'metal' });
  const dark = M.metal;
  for (const cx of [-1, 1]) for (const cz of [-1, 1]) for (const cy of [0, 1]) mesh(box(0.18, 0.12, 0.18), dark, { parent: g, pos: [cx * (Wd / 2 - 0.05), cy * Ht + (cy ? -0.06 : 0.06), cz * (L / 2 - 0.05)], kind: 'metal', solid: false });
  // door end: locking bars and hinges
  for (const bx of [-0.85, -0.35, 0.35, 0.85]) mesh(new THREE.CylinderGeometry(0.022, 0.022, Ht - 0.3, 6), dark, { parent: g, pos: [bx, Ht / 2, L / 2 + 0.04], kind: 'metal' });
  mesh(box(0.02, Ht - 0.2, 0.02), dark, { parent: g, pos: [0, Ht / 2, L / 2 + 0.01], solid: false });
  if (y === 0) { footprint(x, z, Wd, L, ry, 0.05); groundAO(x, z, 0.01, 0, 0.01); }
  return g;
}
container(10.5, -9, 0.12, M.containerRed);
container(13.4, -7.6, -0.04, M.containerTeal);
container(12.1, -8.2, 0.05, M.containerRed, 2.59);                  // one stacked on top

// ---- pallets, crates, barrels, blocks
function flatPallet(x, y, z, ry) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; scene.add(g);
  for (let i = 0; i < 6; i++) mesh(box(1.2, 0.02, 0.1), M.crate, { parent: g, pos: [0, 0.13, -0.45 + i * 0.18], kind: 'wood' });
  for (const sx of [-0.55, 0, 0.55]) mesh(box(0.1, 0.1, 1.0), M.wood, { parent: g, pos: [sx, 0.07, 0], kind: 'wood' });
  for (let i = 0; i < 3; i++) mesh(box(1.2, 0.02, 0.1), M.crate, { parent: g, pos: [0, 0.01, -0.45 + i * 0.45], kind: 'wood' });
}
const palletStack = (x, z, n, ry) => { for (let i = 0; i < n; i++) flatPallet(x + (R() - 0.5) * 0.06, i * 0.145, z + (R() - 0.5) * 0.06, ry + (R() - 0.5) * 0.08); footprint(x, z, 1.2, 1.0, ry, 0.1); };
palletStack(6.4, 1.8, 6, 0.3); palletStack(7.9, 1.2, 3, -0.2); palletStack(-11.5, -6.0, 4, 0.9);
crate(8.6, -4.2, 0.9, 0.2); crate(8.65, -4.2, 0.6, -0.3, 0.9); crate(9.9, -3.8, 0.7, 0.6);
crate(-8.2, -2.0, 0.75, 0.4);
barrel(-9.0, 2.2, M.barrelRust); barrel(-8.35, 2.75, M.barrelBlue); barrel(-9.4, 3.3, M.barrelRust, true);
barrel(15.5, -3.0, M.barrelBlue);
for (const [bx, bz, ry] of [[3.6, -2.2, 0.2], [4.1, -2.6, 0.9], [-5.5, 4.8, 0.3]]) { mesh(box(0.4, 0.2, 0.2), M.concrete, { pos: [bx, 0.1, bz], rot: [0, ry, 0], kind: 'hard' }); }
// leaning pallet against the house side
{
  const g = new THREE.Group(); g.position.set(HOUSE.x + HOUSE.W / 2 + 0.25, 0, HOUSE.z - 1.5); g.rotation.set(0, 0, 0.2); scene.add(g);
  for (let i = 0; i < 5; i++) mesh(box(0.02, 1.2, 0.14), M.crate, { parent: g, pos: [-0.06, 0.6, -0.48 + i * 0.24], kind: 'wood' });
  for (const y of [0.08, 0.6, 1.12]) mesh(box(0.09, 0.1, 1.1), M.wood, { parent: g, pos: [0, y, 0], kind: 'wood' });
}

// ---- picket fence
function picketFence(x0, z0, x1, z1, gapAt = -1) {
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), ry = Math.atan2(dx, dz) - Math.PI / 2;
  const g = new THREE.Group(); g.position.set(x0, 0, z0); g.rotation.y = ry; scene.add(g);
  const n = Math.floor(len / 0.15);
  const inst = new THREE.InstancedMesh(box(0.08, 1.05, 0.02), M.trim, n);
  const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const d = (i + 0.5) * (len / n), gone = (gapAt >= 0 && Math.abs(d - gapAt) < 1.0) || R() < 0.05;
    e.set(0, 0, (R() - 0.5) * 0.12 + (R() < 0.05 ? 0.4 : 0)); q.setFromEuler(e);
    sc.setScalar(gone ? 0 : 1); pos.set(d, 0.55, 0);
    mm.compose(pos, q, sc); inst.setMatrixAt(i, mm);
  }
  inst.castShadow = true; inst.receiveShadow = true; inst.userData.kind = 'wood'; g.add(inst); solids.push(inst);
  for (const yy of [0.3, 0.8]) mesh(box(len, 0.07, 0.04), M.trim, { parent: g, pos: [len / 2, yy, -0.03], kind: 'wood' });
  for (let d = 0; d <= len; d += 2.4) mesh(box(0.1, 1.2, 0.1), M.deck, { parent: g, pos: [d, 0.6, -0.05], kind: 'wood' });
  // collision along the fence (axis-aligned fences only), leaving any gap open
  const along = (a, b) => (Math.abs(dx) > Math.abs(dz)) ? solidBox(x0 + a * Math.sign(dx), x0 + b * Math.sign(dx), z0 - 0.15, z0 + 0.15) : solidBox(x0 - 0.15, x0 + 0.15, z0 + a * Math.sign(dz), z0 + b * Math.sign(dz));
  if (gapAt >= 0) { along(0, gapAt - 1.0); along(gapAt + 1.0, len); } else along(0, len);
}
// perimeter: the yard is fenced in on all four sides
{
  const F = LEVEL.fence;
  picketFence(-F, F, F, F); picketFence(F, F, F, -F); picketFence(F, -F, -F, -F); picketFence(-F, -F, -F, F);
}
picketFence(-18, 9, -6, 9, 5);
picketFence(-18, 9, -18, -14);

// ---- utility pole with sagging wires
{
  const px = -13, pz = 1.5, top = 8.5;
  mesh(new THREE.CylinderGeometry(0.13, 0.17, top, 10), M.bark, { pos: [px, top / 2, pz], kind: 'wood' });
  mesh(box(1.8, 0.12, 0.12), M.bark, { pos: [px, top - 0.6, pz], kind: 'wood' });
  mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.5, 10), M.metal, { pos: [px + 0.3, top - 1.4, pz + 0.22], kind: 'metal' });  // transformer
  obstacles.push({ x: px, z: pz, r: 0.35 });
  const wireMat = new THREE.LineBasicMaterial({ color: 0x1a1a1a });
  const wire = (a, b, sag) => {
    const pts = []; for (let i = 0; i <= 24; i++) { const t = i / 24; const p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * sag; pts.push(p); }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat));
  };
  for (const ox of [-0.8, 0, 0.8]) {
    wire(new THREE.Vector3(px + ox, top - 0.55, pz), new THREE.Vector3(px + ox - 60, top - 0.3, pz + 6), 1.6);
    wire(new THREE.Vector3(px + ox, top - 0.55, pz), new THREE.Vector3(px + ox + 70, top - 0.4, pz - 4), 1.8);
  }
  wire(new THREE.Vector3(px, top - 0.55, pz), new THREE.Vector3(HOUSE.x - HOUSE.W / 2, HOUSE.base + HOUSE.H + 0.6, HOUSE.z + 1), 0.7);
}

// ---- bare, wind-bent trees
function treeGeometry(h, r0, seed, depthMax) {
  const rnd = TX.rng(seed), parts = [], up = new THREE.Vector3(0, 1, 0), wind = new THREE.Vector3(0.35, 0.12, 0.1);
  const q = new THREE.Quaternion(), axis = new THREE.Vector3();
  const branch = (start, dir, len, rad, depth) => {
    const geo = new THREE.CylinderGeometry(rad * 0.62, rad, len, depth < 2 ? 7 : 4, 1, true);
    geo.translate(0, len / 2, 0);
    geo.applyQuaternion(q.setFromUnitVectors(up, dir)); geo.translate(start.x, start.y, start.z);
    parts.push(geo);
    if (depth >= depthMax) return;
    const kids = depth === 0 ? 3 + Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 2);
    for (let k = 0; k < kids; k++) {
      const s = start.clone().addScaledVector(dir, len * (depth === 0 ? 0.55 + rnd() * 0.45 : 0.65 + rnd() * 0.35));
      axis.set(rnd() - 0.5, 0, rnd() - 0.5).normalize();
      const nd = dir.clone().applyAxisAngle(axis, 0.45 + rnd() * 0.55).add(wind).normalize();
      branch(s, nd, len * (0.6 + rnd() * 0.2), rad * 0.58, depth + 1);
    }
  };
  branch(new THREE.Vector3(), new THREE.Vector3((rnd() - 0.5) * 0.15, 1, (rnd() - 0.5) * 0.15).normalize(), h * 0.42, r0, 0);
  return mergeGeometries(parts);
}
{
  // a few close trees inside the yard, a ring along its edge, and a dim tree line far out
  const place = (x, z, h, depth) => {
    const t = mesh(treeGeometry(h, 0.1 + h * 0.018, Math.floor(x * 131 + z * 17 + 999), depth), M.bark, { pos: [x, -0.1, z], kind: 'wood', cast: depth >= 4 });
    t.rotation.y = R() * 6.28;
    if (Math.abs(x) < LEVEL.bounds && Math.abs(z) < LEVEL.bounds) obstacles.push({ x, z, r: 0.3 + h * 0.012 });
  };
  for (const [x, z, h] of [[-15, -12, 10], [16, 9, 9], [-6, 15, 8], [18, -16, 11], [3, -19, 9.5]]) place(x, z, h, 5);
  // a point in the square band between Chebyshev distances r0..r1 from the centre
  const band = (r0, r1) => {
    const d = r0 + R() * (r1 - r0), t = (R() * 2 - 1) * d, side = Math.floor(R() * 4);
    return side === 0 ? [t, d] : side === 1 ? [t, -d] : side === 2 ? [d, t] : [-d, t];
  };
  for (let i = 0; i < 40; i++) { const [x, z] = band(25.5, 30); place(x, z, 7 + R() * 5, 4); }      // a few trees past the fence
  for (let i = 0; i < 150; i++) { const [x, z] = band(31, 40); place(x, z, 8 + R() * 6, 3); }      // dense tree wall: nothing beyond

}

// ---- distant rolling hills
{
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x55584c, roughness: 1 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + R() * 0.3, rr = 120 + R() * 25;
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10), hillMat);
    m.position.set(Math.cos(a) * rr, -6, Math.sin(a) * rr); m.scale.set(40 + R() * 30, 14 + R() * 10, 30 + R() * 20); m.rotation.y = a;
    scene.add(m);
  }
}

// a random point in the yard (used for dust)
function levelPoint() { return [(R() - 0.5) * LEVEL.bounds * 2, (R() - 0.5) * LEVEL.bounds * 2]; }

// ============================================================ yard clutter (fills the open ground)
const EXTRA = (() => {
  const tex = M.textures.tex;
  // small procedural textures for the new props
  const canvasTex = (w, h, draw, srgb = true) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return tex(c, srgb); };
  const strawTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#8f7a4a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const v = 90 + R() * 90; g.strokeStyle = `rgba(${v + 40},${v + 20},${v * 0.5},0.6)`; g.lineWidth = 0.6 + R(); const x = R() * w, y = R() * h, a = (R() - 0.5) * 0.8; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14); g.stroke(); }
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(40,34,20,0.45)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const rustTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#5d6a6c'; g.fillRect(0, 0, w, h);                         // faded blue-grey paint
    for (let i = 0; i < 70; i++) { const x = R() * w, y = R() * h, r = 4 + R() * 30, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(120,58,22,0.95)'); gr.addColorStop(0.7, 'rgba(100,50,22,0.6)'); gr.addColorStop(1, 'rgba(100,50,22,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(${60 + R() * 60},${30 + R() * 30},15,0.5)`; g.fillRect(R() * w, R() * h, 1 + R() * 3, 1 + R() * 3); }
  });
  const clothTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#bdb9ae'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) { const y = R() * h, gr = g.createLinearGradient(0, y - 20, 0, y + 20); gr.addColorStop(0, 'rgba(110,96,70,0)'); gr.addColorStop(0.5, 'rgba(110,96,70,0.25)'); gr.addColorStop(1, 'rgba(110,96,70,0)'); g.fillStyle = gr; g.fillRect(0, y - 20, w, 40); }
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0.6, 'rgba(80,70,50,0)'); gr.addColorStop(1, 'rgba(80,70,50,0.45)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const fabricTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#5b4a3c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(150,120,80,0.35)'; g.lineWidth = 3;
    for (let x = 0; x < w; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let i = 0; i < 20; i++) { const x = R() * w, y = R() * h, r = 4 + R() * 18, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(25,20,15,0.6)'); gr.addColorStop(1, 'rgba(25,20,15,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  });
  const tuftTex = canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const x0 = w * (0.2 + R() * 0.6), lean = (R() - 0.5) * 60, top = h * (0.05 + R() * 0.55), v = R();
      g.strokeStyle = v < 0.55 ? `rgba(${150 + R() * 40},${132 + R() * 30},${86 + R() * 20},1)` : v < 0.85 ? `rgba(${100 + R() * 30},${92 + R() * 20},${56},1)` : 'rgba(70,64,40,1)';
      g.lineWidth = 1 + R() * 1.6;
      g.beginPath(); g.moveTo(x0, h); g.quadraticCurveTo(x0 + lean * 0.3, h * 0.6, x0 + lean, top); g.stroke();
    }
  }, true);
  const mat = {
    hay: new THREE.MeshStandardMaterial({ map: strawTex, roughness: 1 }),
    rust: new THREE.MeshStandardMaterial({ map: rustTex, roughness: 0.75, metalness: 0.35 }),
    cloth: new THREE.MeshStandardMaterial({ map: clothTex, roughness: 0.95, side: THREE.DoubleSide }),
    fabric: new THREE.MeshStandardMaterial({ map: fabricTex, roughness: 1 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x1a1918, roughness: 0.92 }),
    stone: new THREE.MeshStandardMaterial({ map: M.concrete.map, color: 0xe2ddd4, roughness: 0.95 }),
    tuft: new THREE.MeshStandardMaterial({ map: tuftTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 }),
    glass: M.windowGlass,
  };
  const G = (x, z, ry = 0) => { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g); return g; };

  // ---- tool shed with a woodpile
  {
    const sx = -21, sz = -3, g = G(sx, sz, Math.PI / 2), o = { parent: g, kind: 'wood' };
    const W = 3.2, D = 2.4, H = 2.3;
    mesh(scaleUV(box(W, H, D), W / 2, H / 2), M.clapboard, { ...o, pos: [0, H / 2, 0] });
    const rl = Math.hypot(D / 2 + 0.3, 0.5);
    for (const s of [1, -1]) { const r = mesh(scaleUV(box(W + 0.4, 0.06, rl), (W + 0.4) / 2, rl / 2), M.shingles, { ...o, pos: [0, H + 0.25, s * (D / 4 + 0.07)] }); r.rotation.x = s * Math.atan2(0.5, D / 2 + 0.3); }
    mesh(box(1.0, 1.9, 0.05), M.plywood, { ...o, pos: [0.4, 0.95, D / 2 + 0.03], rot: [0, -0.35, 0] });          // door hanging ajar
    mesh(new THREE.PlaneGeometry(0.9, 1.85), new THREE.MeshBasicMaterial({ color: 0x050505 }), { parent: g, pos: [0.4, 0.95, D / 2 + 0.005], solid: false, cast: false });
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) mesh(box(0.1, H, 0.1), M.trim, { ...o, pos: [cx * W / 2, H / 2, cz * D / 2] });
    footprint(sx, sz, D, W, 0, 0.1);
    groundAO(sx + D / 2 + 0.05, sz, W, Math.PI / 2, 0.8);
    // woodpile: stacked split logs
    const wp = G(-21.2, 2.2, 0.1);
    for (let row = 0; row < 5; row++) for (let i = 0; i < 9 - row; i++) {
      const l = mesh(new THREE.CylinderGeometry(0.11 + R() * 0.03, 0.12, 1.1, 7), M.bark, { parent: wp, pos: [-1 + i * 0.25 + row * 0.12, 0.12 + row * 0.21, (R() - 0.5) * 0.08], rot: [Math.PI / 2, 0, 0], kind: 'wood' });
      l.rotation.y = (R() - 0.5) * 0.1;
    }
    footprint(-21.2, 2.2, 2.3, 1.2, 0.1, 0.05);
  }

  // ---- wrecked pickup truck: flat tyres, rust, missing door
  {
    const tx = 14, tz = 15, ry = 0.45, g = G(tx, tz, ry), o = { parent: g, kind: 'metal' };
    const y0 = 0.42;
    mesh(box(1.9, 0.55, 5.0), mat.rust, { ...o, pos: [0, y0 + 0.35, 0] });                                       // body
    mesh(box(1.85, 0.62, 1.7), mat.rust, { ...o, pos: [0, y0 + 0.93, -0.35] });                                   // cab
    mesh(new THREE.PlaneGeometry(1.6, 0.5), mat.glass, { parent: g, pos: [0, y0 + 0.97, -1.21], rot: [0.25 + Math.PI, 0, 0], kind: 'glass' });
    mesh(box(1.9, 0.5, 0.06), mat.rust, { ...o, pos: [0, y0 + 0.85, 2.48] });                                     // tailgate
    for (const sx of [-1, 1]) mesh(box(0.06, 0.45, 2.0), mat.rust, { ...o, pos: [sx * 0.93, y0 + 0.85, 1.45] }); // bed sides
    mesh(box(1.95, 0.25, 0.25), M.metal, { ...o, pos: [0, y0 + 0.2, -2.55] });                                   // bumper
    mesh(box(1.5, 0.35, 0.05), M.metal, { ...o, pos: [0, y0 + 0.55, -2.51] });                                   // grille
    for (const sx of [-0.65, 0.65]) mesh(new THREE.CircleGeometry(0.1, 12), new THREE.MeshStandardMaterial({ color: 0x9aa0a0, roughness: 0.2, metalness: 0.6 }), { parent: g, pos: [sx, y0 + 0.6, -2.54], rot: [0, Math.PI, 0], solid: false });
    for (const [wx, wz, flat] of [[-0.95, -1.6, 0.06], [0.95, -1.6, 0], [-0.95, 1.6, 0], [0.95, 1.6, 0.1]]) {
      mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.26, 16), mat.tire, { ...o, pos: [wx, 0.38 - flat, wz], rot: [0, 0, Math.PI / 2] });
      mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.27, 10), M.metal, { ...o, pos: [wx, 0.38 - flat, wz], rot: [0, 0, Math.PI / 2], solid: false });
    }
    g.rotation.z = 0.03;                                                    // sagging on one side
    // junk in the bed
    mesh(box(0.6, 0.4, 0.5), M.crate, { parent: g, pos: [0.3, y0 + 0.82, 1.4], rot: [0, 0.4, 0], kind: 'wood' });
    mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 16), M.barrelRust, { parent: g, pos: [-0.4, y0 + 0.62, 2.0], rot: [Math.PI / 2, 0, 0.3], kind: 'metal' });
    footprint(tx, tz, 2.0, 5.2, ry, 0.1);
  }

  // ---- rusty swing set (one swing still moving)
  const swings = [];
  {
    const g = G(-8, 17.5, 0.2), o = { parent: g, kind: 'metal' };
    for (const sx of [-1.6, 1.6]) for (const sz of [-0.6, 0.6]) { const leg = mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.5, 8), mat.rust, { ...o, pos: [sx, 1.2, sz * 0.5], rot: [sz > 0 ? 0.25 : -0.25, 0, 0] }); void leg; }
    mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.4, 8), mat.rust, { ...o, pos: [0, 2.4, 0], rot: [0, 0, Math.PI / 2] });
    for (const sx of [-0.8, 0.6]) {
      const pivot = new THREE.Group(); pivot.position.set(sx, 2.38, 0); g.add(pivot);
      for (const cx of [-0.22, 0.22]) mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.9, 4), M.metal, { parent: pivot, pos: [cx, -0.95, 0], solid: false, cast: false });
      mesh(box(0.5, 0.04, 0.18), M.rubber, { parent: pivot, pos: [0, -1.9, 0], kind: 'hard' });
      swings.push({ pivot, phase: R() * 6, amp: sx < 0 ? 0.22 : 0.04 });
    }
    footprint(-8, 17.5, 3.6, 1.0, 0.2, 0.1);
  }

  // ---- picnic table and a burnt-out fire pit
  {
    const g = G(4.5, 16.5, -0.3), o = { parent: g, kind: 'wood' };
    mesh(box(1.8, 0.06, 0.8), M.deck, { ...o, pos: [0, 0.76, 0] });
    for (const sz of [-0.62, 0.62]) mesh(box(1.8, 0.05, 0.28), M.deck, { ...o, pos: [0, 0.45, sz] });
    for (const sx of [-0.7, 0.7]) for (const r of [0.45, -0.45]) mesh(box(0.08, 0.95, 0.08), M.deck, { ...o, pos: [sx, 0.42, 0], rot: [r, 0, 0] });
    footprint(4.5, 16.5, 1.9, 1.6, -0.3, 0.05);
    const fp = G(8.5, 13.5);
    for (let i = 0; i < 11; i++) { const a = (i / 11) * Math.PI * 2; mesh(new THREE.DodecahedronGeometry(0.17, 0), mat.stone, { parent: fp, pos: [Math.cos(a) * 0.6, 0.1, Math.sin(a) * 0.6], rot: [R() * 3, R() * 3, R() * 3], kind: 'hard' }); }
    mesh(new THREE.CircleGeometry(0.55, 16), new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 1 }), { parent: fp, pos: [0, 0.025, 0], rot: [-Math.PI / 2, 0, 0], cast: false, kind: 'hard' });
    for (let i = 0; i < 4; i++) mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.7, 6), new THREE.MeshStandardMaterial({ color: 0x1e1a16, roughness: 1 }), { parent: fp, pos: [(R() - 0.5) * 0.4, 0.08, (R() - 0.5) * 0.4], rot: [Math.PI / 2, R() * 3, 0.15], kind: 'wood' });
    obstacles.push({ x: 8.5, z: 13.5, r: 0.8 });
  }

  // ---- clothesline behind the house; sheets sway in the wind
  const sheets = [];
  {
    const y = 1.9, x0 = -5, x1 = 6, z = -18.5;
    for (const x of [x0, x1]) { mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.1, 8), M.deck, { pos: [x, 1.05, z], kind: 'wood' }); mesh(box(0.7, 0.06, 0.06), M.deck, { pos: [x, 2.0, z], kind: 'wood' }); obstacles.push({ x, z, r: 0.2 }); }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 21 }, (_, i) => { const t = i / 20; return new THREE.Vector3(x0 + (x1 - x0) * t, y + 0.06 - Math.sin(t * Math.PI) * 0.12, z); })), new THREE.LineBasicMaterial({ color: 0x222222 }));
    scene.add(line);
    for (const [cx, w, h] of [[-2.6, 1.6, 1.2], [0.2, 1.3, 1.0], [3.4, 1.7, 1.3]]) {
      const geo = new THREE.PlaneGeometry(w, h, 16, 8); geo.translate(0, -h / 2, 0);
      const m = mesh(geo, mat.cloth, { pos: [cx, y + 0.02 - Math.sin(((cx - x0) / (x1 - x0)) * Math.PI) * 0.12, z], kind: 'paper', cast: true });
      sheets.push({ m, base: geo.attributes.position.array.slice(), h, phase: R() * 6 });
    }
  }

  // ---- stone well with a little roof
  {
    const g = G(17.5, -18.5, 0.3), o = { parent: g, kind: 'hard' };
    mesh(new THREE.CylinderGeometry(0.85, 0.9, 0.8, 18, 1, true), mat.stone, { ...o, pos: [0, 0.4, 0] });
    mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.82, 18, 1, true), mat.stone, { ...o, pos: [0, 0.4, 0] }).material.side = THREE.BackSide;
    mesh(new THREE.TorusGeometry(0.8, 0.08, 6, 18), mat.stone, { ...o, pos: [0, 0.82, 0], rot: [Math.PI / 2, 0, 0] });
    mesh(new THREE.CircleGeometry(0.72, 18), new THREE.MeshBasicMaterial({ color: 0x020202 }), { parent: g, pos: [0, 0.5, 0], rot: [-Math.PI / 2, 0, 0], solid: false, cast: false });
    for (const sx of [-0.8, 0.8]) mesh(box(0.1, 1.9, 0.1), M.bark, { ...o, kind: 'wood', pos: [sx, 1.3, 0] });
    for (const s of [1, -1]) { const r = mesh(box(2.0, 0.05, 0.9), M.shingles, { ...o, pos: [0, 2.35, s * 0.3] }); r.rotation.x = s * 0.6; }
    mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 8), M.bark, { ...o, kind: 'wood', pos: [0, 1.65, 0], rot: [0, 0, Math.PI / 2] });
    mesh(new THREE.CylinderGeometry(0.15, 0.13, 0.25, 10), M.metal, { ...o, kind: 'metal', pos: [0.15, 1.15, 0] });          // bucket
    obstacles.push({ x: 17.5, z: -18.5, r: 1.1 });
  }

  // ---- hay bales, tyre stack, doghouse, wheelbarrow, mailbox, abandoned sofa
  for (const [x, z, y, ry] of [[-14, 15, 0, 0.2], [-12.5, 16.2, 0, 1.4], [-13.3, 15.5, 1.1, 0.7], [-15.6, 13.2, 0, 0.9]]) {
    mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.1, 18), mat.hay, { pos: [x, y + 0.62, z], rot: [0, ry, Math.PI / 2], kind: 'wood' });
    if (y === 0) obstacles.push({ x, z, r: 0.75 });
  }
  for (let i = 0; i < 5; i++) mesh(new THREE.TorusGeometry(0.34, 0.13, 8, 18), mat.tire, { pos: [18.4 + (R() - 0.5) * 0.08, 0.13 + i * 0.25, -2.4 + (R() - 0.5) * 0.08], rot: [Math.PI / 2, 0, 0], kind: 'hard' });
  mesh(new THREE.TorusGeometry(0.34, 0.13, 8, 18), mat.tire, { pos: [19.3, 0.45, -1.4], rot: [0.3, 0.6, 1.2], kind: 'hard' });
  obstacles.push({ x: 18.4, z: -2.4, r: 0.55 });
  {
    const g = G(4.4, -15.2, -0.6), o = { parent: g, kind: 'wood' };
    mesh(box(0.9, 0.7, 1.1), M.deck, { ...o, pos: [0, 0.35, 0] });
    for (const s of [1, -1]) { const r = mesh(box(1.02, 0.04, 0.68), M.shingles, { ...o, pos: [0, 0.88, s * 0.25] }); r.rotation.x = s * 0.6; }
    mesh(new THREE.PlaneGeometry(0.4, 0.45), new THREE.MeshBasicMaterial({ color: 0x050403 }), { parent: g, pos: [0, 0.3, 0.556], solid: false, cast: false });
    mesh(new THREE.TorusGeometry(0.12, 0.012, 6, 16), M.metal, { parent: g, pos: [0.6, 0.02, 0.4], rot: [Math.PI / 2, 0, 0], kind: 'metal' });  // chain ring
    footprint(4.4, -15.2, 1.0, 1.2, -0.6, 0.05);
  }
  {
    const g = G(-7, 4, 2.2), o = { parent: g, kind: 'metal' };
    mesh(box(0.6, 0.25, 0.85), mat.rust, { ...o, pos: [0, 0.5, 0], rot: [-0.1, 0, 0] });
    mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 14), mat.tire, { ...o, pos: [0, 0.18, -0.55], rot: [0, 0, Math.PI / 2] });
    for (const sx of [-0.22, 0.22]) mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 6), M.metal, { ...o, pos: [sx, 0.45, 0.35], rot: [1.35, 0, 0] });
    obstacles.push({ x: -7, z: 4, r: 0.6 });
  }
  {
    const g = G(-14.2, 10.2, 0.2);
    mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), M.deck, { parent: g, pos: [0, 0.55, 0], kind: 'wood' });
    mesh(box(0.25, 0.25, 0.5), mat.rust, { parent: g, pos: [0, 1.2, 0], kind: 'metal' });
    mesh(box(0.03, 0.18, 0.06), M.redPaint, { parent: g, pos: [0.14, 1.32, 0.1], kind: 'metal' });           // little red flag
    obstacles.push({ x: -14.2, z: 10.2, r: 0.25 });
  }
  {
    const g = G(19.2, 8.5, -1.9), o = { parent: g, kind: 'wood' };
    mesh(box(2.0, 0.42, 0.9), mat.fabric, { ...o, pos: [0, 0.32, 0] });
    mesh(box(2.0, 0.6, 0.22), mat.fabric, { ...o, pos: [0, 0.75, -0.36], rot: [-0.15, 0, 0] });
    for (const sx of [-0.95, 0.95]) mesh(box(0.22, 0.32, 0.9), mat.fabric, { ...o, pos: [sx, 0.62, 0] });
    for (const sx of [-0.6, 0.6]) mesh(box(0.85, 0.12, 0.62), mat.fabric, { ...o, pos: [sx * 0.85, 0.57, 0.08], rot: [0.05, 0, (R() - 0.5) * 0.15] });
    g.rotation.z = 0.06;
    footprint(19.2, 8.5, 2.1, 1.0, -1.9, 0.1);
  }

  // ---- fallen logs and scattered rocks
  for (const [x, z, ry, l] of [[-16.5, -20, 0.6, 4.2], [10, 20.5, -0.3, 3.4], [-19.5, 19, 1.3, 3.0]]) {
    mesh(new THREE.CylinderGeometry(0.22, 0.28, l, 9), M.bark, { pos: [x, 0.24, z], rot: [0, ry, Math.PI / 2], kind: 'wood' });
    obstacles.push({ x: x + Math.cos(ry) * l * 0.3, z: z - Math.sin(ry) * l * 0.3, r: 0.4 }, { x: x - Math.cos(ry) * l * 0.3, z: z + Math.sin(ry) * l * 0.3, r: 0.4 });
  }
  const freeAt = (x, z, pad = 0.6) => !boxes.some((b) => x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad) && !obstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + pad);
  {
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), mat.stone, 60), mm = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    let n = 0;
    while (n < 60) {
      const x = (R() - 0.5) * 46, z = (R() - 0.5) * 46; if (!freeAt(x, z, 0.3)) continue;
      const s = 0.06 + R() * R() * 0.3;
      e.set(R() * 3, R() * 3, R() * 3); q.setFromEuler(e);
      mm.compose(new THREE.Vector3(x, s * 0.4, z), q, new THREE.Vector3(s * (1 + R() * 0.6), s * 0.7, s)); rocks.setMatrixAt(n++, mm);
    }
    rocks.castShadow = true; rocks.receiveShadow = true; rocks.userData.kind = 'hard'; scene.add(rocks); solids.push(rocks);
  }

  // ---- dead grass and weed clumps: thick along fences and walls, sparse in the open
  {
    const N = IS_TOUCH ? 1400 : 2600;
    const geo = mergeGeometries([0, Math.PI / 3, (2 * Math.PI) / 3].map((a) => new THREE.PlaneGeometry(0.7, 0.55).translate(0, 0.27, 0).rotateY(a)));
    const tufts = new THREE.InstancedMesh(geo, mat.tuft, N), mm = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    let n = 0, guard = 0;
    while (n < N && guard++ < N * 20) {
      let x, z;
      if (R() < 0.45) { const F = LEVEL.fence - 0.4 - R() * 1.5, t = (R() * 2 - 1) * F, side = Math.floor(R() * 4); [x, z] = side === 0 ? [t, F] : side === 1 ? [t, -F] : side === 2 ? [F, t] : [-F, t]; }
      else { x = (R() - 0.5) * 47; z = (R() - 0.5) * 47; if (Math.max(Math.abs(x), Math.abs(z)) < 18 && R() < 0.6) continue; }
      if (!freeAt(x, z, 0.15)) continue;
      const s = 0.6 + R() * 1.1;
      e.set(0, R() * 6.28, (R() - 0.5) * 0.15); q.setFromEuler(e);
      mm.compose(new THREE.Vector3(x, 0.02, z), q, new THREE.Vector3(s, s * (0.7 + R() * 0.8), s)); tufts.setMatrixAt(n++, mm);
    }
    tufts.count = n; tufts.receiveShadow = true; scene.add(tufts);
  }

  return {
    update(t) {
      for (const s of swings) s.pivot.rotation.x = Math.sin(t * 1.9 + s.phase) * s.amp;
      for (const sh of sheets) {
        const p = sh.m.geometry.attributes.position, b = sh.base;
        for (let i = 0; i < p.count; i++) {
          const x = b[i * 3], y = b[i * 3 + 1], k = -y / sh.h;            // 0 at the line, 1 at the hem
          // billow in the wind + vertical folds that ripple, hem lags behind the line
          p.setZ(i, Math.sin(t * 2.3 + x * 2.1 + sh.phase) * 0.28 * k + Math.sin(x * 9 + t * 1.3) * 0.045 * (0.3 + k) + Math.sin(t * 6.1 + x * 4 + y * 3) * 0.05 * k + 0.18 * k);
        }
        p.needsUpdate = true; sh.m.geometry.computeVertexNormals();
      }
    },
  };
})();

// paper litter blowing around the yard
for (let i = 0; i < 16; i++) {
  const [x, z] = levelPoint();
  mesh(new THREE.PlaneGeometry(0.21, 0.28), M.paper[i % 4], { pos: [x, 0.03 + i * 0.0003, z], rot: [-Math.PI / 2 + (R() - 0.5) * 0.3, 0, R() * 6], kind: 'paper', cast: false });
}

// ============================================================ inside the house (and the cellar under it)
// The interior is built off to the side of the world (x = 300) and you reach it through a
// fade to black at the front door, the way a body camera cuts when it is bumped.
const IN = { x: 300, z: 0, W: 18, D: 14, H: 3 };          // ground floor: x -9..9, z -7..7 (front door at +z)
const LOOP = { bx: 6.4, bz: 4.4 };                          // the solid block the corridors run round
const CEL = { x: 300, z: 40, W: 8, D: 7, H: 2.3 };         // cellar: x -4..4, z -3.5..3.5
// ---- blood decals: thin planes laid on floors and walls (they never block shots or movement)
const BLOOD = (() => {
  const T = TX.bloodTextures();
  const mk = (canvas) => {
    const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    // low roughness: still wet, so it catches the bulb
    return new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, roughness: 0.55, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  };
  return { pool: mk(T.pool), splat: mk(T.splat), smear: mk(T.smear), hand: mk(T.hand), drips: mk(T.drips) };
})();
function floorBlood(parent, kind, x, z, w, h = w, spin = 0, y = 0.003) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), BLOOD[kind]);
  m.rotation.order = 'YXZ'; m.rotation.set(-Math.PI / 2, spin, 0); m.position.set(x, y, z);
  m.receiveShadow = true; m.renderOrder = 2; parent.add(m); return m;
}
// a smear trail from (x0,z0) to (x1,z1), heavy end first
function bloodTrail(parent, x0, z0, x1, z1, width = 0.45) {
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
  return floorBlood(parent, 'smear', (x0 + x1) / 2, (z0 + z1) / 2, len, width, Math.atan2(-dz, dx), 0.0035);
}
function wallBlood(parent, kind, x, y, z, ry, w, h = w, tilt = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), BLOOD[kind]);
  m.position.set(x, y, z); m.rotation.set(0, ry, tilt); m.receiveShadow = true; m.renderOrder = 2; parent.add(m); return m;
}

const ZONES = { house: IN, cellar: CEL };                  // every walkable interior, by zone name (rooms are added below)
const INTERIOR = (() => {
  const hg = new THREE.Group(); hg.position.set(IN.x, 0, IN.z); scene.add(hg);
  const cg = new THREE.Group(); cg.position.set(CEL.x, 0, CEL.z); scene.add(cg);
  const fp = (g, x, z, w, d, ry = 0, pad = 0.05) => footprint(g.position.x + x, g.position.z + z, w, d, ry, pad);
  const circ = (g, x, z, r) => obstacles.push({ x: g.position.x + x, z: g.position.z + z, r });
  const ao = (g, x, z, len, ry, depth = 0.45) => groundAO(g.position.x + x, g.position.z + z, len, ry, depth);
  let cellarSwing = null, cellarChains = [];
  const black = new THREE.MeshBasicMaterial({ color: 0x030303 });

  // continuous wallpaper: u runs along the wall in 2 m tiles, v spans floor -> ceiling
  function wallUV(geo, H, tile = 2) {
    const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const u = Math.abs(n.getX(i)) > 0.5 ? p.getZ(i) : p.getX(i);
      uv.setXY(i, u / tile, p.getY(i) / H);
    }
    return geo;
  }
  // axis-aligned wall from (x0,z0) to (x1,z1); mats = [face toward -axis, face toward +axis]; gaps = doorways
  function wall(g, H, x0, z0, x1, z1, mats, gaps = [], thick = 0.12, tile = 2) {
    const alongX = Math.abs(z1 - z0) < 1e-6;
    const a0 = alongX ? Math.min(x0, x1) : Math.min(z0, z1), a1 = alongX ? Math.max(x0, x1) : Math.max(z0, z1), c = alongX ? z0 : x0;
    const [neg, pos] = Array.isArray(mats) ? mats : [mats, mats];
    const side = M.plaster;
    const mm = alongX ? [side, side, side, side, pos, neg] : [pos, neg, side, side, side, side];
    const piece = (a, b, y0, y1) => {
      if (b - a < 0.01 || y1 - y0 < 0.01) return;
      const geo = alongX ? box(b - a, y1 - y0, thick) : box(thick, y1 - y0, b - a);
      geo.translate(alongX ? (a + b) / 2 : c, (y0 + y1) / 2, alongX ? c : (a + b) / 2);
      mesh(wallUV(geo, H, tile), mm, { parent: g, kind: 'hard' });
      if (y0 === 0) {
        if (alongX) solidBox(g.position.x + a, g.position.x + b, g.position.z + c - thick / 2, g.position.z + c + thick / 2);
        else solidBox(g.position.x + c - thick / 2, g.position.x + c + thick / 2, g.position.z + a, g.position.z + b);
      }
    };
    let cur = a0;
    for (const gp of gaps.sort((p, q) => p.c - q.c)) {
      const g0 = gp.c - gp.w / 2, g1 = gp.c + gp.w / 2, gh = gp.h || 2.1;
      piece(cur, g0, 0, H); piece(g0, g1, gh, H); cur = g1;
      if (gp.win) { piece(g0, g1, 0, gp.y0); if (alongX) solidBox(g.position.x + g0, g.position.x + g1, g.position.z + c - thick / 2, g.position.z + c + thick / 2); else solidBox(g.position.x + c - thick / 2, g.position.x + c + thick / 2, g.position.z + g0, g.position.z + g1); continue; }
      // painted casing round the opening, both faces
      const T = thick + 0.05;
      for (const e of [g0, g1]) mesh(alongX ? box(0.08, gh, T) : box(T, gh, 0.08), M.trim, { parent: g, pos: alongX ? [e, gh / 2, c] : [c, gh / 2, e], kind: 'wood' });
      mesh(alongX ? box(gp.w + 0.16, 0.09, T) : box(T, 0.09, gp.w + 0.16), M.trim, { parent: g, pos: alongX ? [gp.c, gh + 0.04, c] : [c, gh + 0.04, gp.c], kind: 'wood' });
      // a door leaf left standing open
      if (gp.leaf) {
        const hinge = new THREE.Group(); g.add(hinge);
        const hx = alongX ? g0 : c, hz = alongX ? c : g0;
        hinge.position.set(hx, 0, hz); hinge.rotation.y = (alongX ? 0 : -Math.PI / 2) + gp.leaf;
        mesh(box(gp.w - 0.04, gh - 0.03, 0.04), M.doorPaint, { parent: hinge, pos: [(gp.w - 0.04) / 2, (gh - 0.03) / 2, 0], kind: 'wood' });
        mesh(new THREE.SphereGeometry(0.03, 8, 6), M.metal, { parent: hinge, pos: [gp.w - 0.12, 0.98, 0.04], kind: 'metal' });
      }
    }
    piece(cur, a1, 0, H);
  }
  // a closed door painted onto a wall face (the ones you can use)
  function door(g, x, z, ry, { w = 0.92, h = 2.08, mat = M.doorPaint, glass = false, bolt = false } = {}) {
    const d = new THREE.Group(); d.position.set(x, 0, z); d.rotation.y = ry; g.add(d);
    const o = { parent: d, kind: 'wood' };
    mesh(box(w, h, 0.05), mat, { ...o, pos: [0, h / 2, 0.03] });
    for (const yy of [0.45, 1.15]) mesh(box(w * 0.68, 0.5, 0.02), mat, { ...o, pos: [0, yy, 0.06] });
    if (glass) mesh(new THREE.PlaneGeometry(w * 0.5, 0.45), M.windowView, { parent: d, pos: [0, 1.7, 0.062], kind: 'glass', cast: false });
    for (const sx of [-1, 1]) mesh(box(0.09, h + 0.1, 0.06), M.trim, { ...o, pos: [sx * (w / 2 + 0.045), (h + 0.1) / 2, 0.03] });
    mesh(box(w + 0.28, 0.1, 0.06), M.trim, { ...o, pos: [0, h + 0.1, 0.03] });
    mesh(new THREE.SphereGeometry(0.034, 10, 8), M.metal, { parent: d, pos: [w / 2 - 0.1, 0.98, 0.09], kind: 'metal' });
    mesh(box(0.05, 0.14, 0.012), M.metal, { parent: d, pos: [w / 2 - 0.1, 0.98, 0.058], kind: 'metal' });
    if (bolt) { mesh(box(0.2, 0.035, 0.03), M.metal, { parent: d, pos: [w / 2 - 0.05, 1.45, 0.07], kind: 'metal' }); mesh(box(0.05, 0.08, 0.03), M.metal, { parent: d, pos: [w / 2 + 0.07, 1.45, 0.05], kind: 'metal' }); }
    return d;
  }
  // window seen from inside: the grey overcast through dirty glass, maybe boarded, maybe curtained
  function inWindow(g, x, y, z, ry, { w = 0.95, h = 1.3, boarded = false, curtain = null } = {}) {
    const q = new THREE.Group(); q.position.set(x, y, z); q.rotation.y = ry; g.add(q);
    const o = { parent: q, kind: 'wood' }, t = 0.08;
    mesh(new THREE.PlaneGeometry(w, h), M.windowView, { parent: q, pos: [0, 0, 0.004], kind: 'glass', cast: false });
    mesh(box(w + t * 2, t, 0.06), M.trim, { ...o, pos: [0, h / 2 + t / 2, 0.03] });
    mesh(box(w + t * 3, 0.05, 0.16), M.trim, { ...o, pos: [0, -h / 2 - 0.025, 0.08] });            // sill
    for (const sx of [-1, 1]) mesh(box(t, h, 0.06), M.trim, { ...o, pos: [sx * (w / 2 + t / 2), 0, 0.03] });
    mesh(box(w, 0.035, 0.03), M.trim, { ...o, pos: [0, 0, 0.02] });
    mesh(box(0.035, h, 0.03), M.trim, { ...o, pos: [0, 0, 0.02] });
    if (boarded) {
      // planks nailed across from the inside, light leaking between them
      let yy = -h / 2 + 0.08;
      while (yy < h / 2) { mesh(box(w + 0.25, 0.15, 0.025), M.deck, { ...o, pos: [(R() - 0.5) * 0.05, yy, 0.07], rot: [0, 0, (R() - 0.5) * 0.12] }); yy += 0.19 + R() * 0.05; }
    }
    if (curtain) {
      for (const sx of [-1, 1]) {
        if (curtain.torn && sx > 0) continue;
        const cw = w * (curtain.torn ? 0.75 : 0.42), geo = new THREE.PlaneGeometry(cw, h + 0.35, 10, 1);
        const p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 22) * 0.025 + (p.getY(i) < 0 ? (R() - 0.5) * 0.02 : 0));
        geo.computeVertexNormals();
        mesh(geo, curtain.mat, { parent: q, pos: [sx * (w / 2 - cw / 2 + 0.12), -0.1, 0.12], rot: [0, 0, sx * 0.015], kind: 'paper' });
      }
      mesh(new THREE.CylinderGeometry(0.012, 0.012, w + 0.5, 6), M.metal, { parent: q, pos: [0, h / 2 + 0.16, 0.13], rot: [0, 0, Math.PI / 2], kind: 'metal' });
    }
  }
  function photo(g, x, y, z, ry, k, w = 0.32, h = 0.4, tilt = 0) {
    const f = new THREE.Group(); f.position.set(x, y, z); f.rotation.set(0, ry, tilt); g.add(f);
    mesh(box(w + 0.06, h + 0.06, 0.025), M.darkWood, { parent: f, pos: [0, 0, 0.013], kind: 'wood' });
    mesh(new THREE.PlaneGeometry(w, h), M.photos[k % 3], { parent: f, pos: [0, 0, 0.027], kind: 'paper', cast: false });
  }
  // ceiling light: cord, shade, bulb. Returns the bulb position (local).
  function pendant(g, x, z, H, drop = 0.55, shade = true) {
    mesh(new THREE.CylinderGeometry(0.006, 0.006, drop, 4), M.cord, { parent: g, pos: [x, H - drop / 2, z], cast: false, solid: false });
    mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 12), M.trim, { parent: g, pos: [x, H - 0.015, z], solid: false });
    if (shade) mesh(new THREE.CylinderGeometry(0.07, 0.24, 0.2, 20, 1, true), M.shade, { parent: g, pos: [x, H - drop - 0.02, z], solid: false, cast: false });
    const b = mesh(new THREE.SphereGeometry(0.045, 12, 8), M.bulb, { parent: g, pos: [x, H - drop - 0.07, z], solid: false, cast: false });
    return b;
  }
  const point = (color, dist) => { const l = new THREE.PointLight(color, 0, dist, 1.7); l.visible = false; scene.add(l); return l; };

  // ================================================================ ground floor: a square loop of corridors
  // Four 2.6 m corridors run round a solid central block, the way the old building did.
  //
  //   z=-7  +------------------------------+  north corridor (cellar door)
  //         |   +----------------------+   |
  //   west  |   |     solid block      |   |  east (boarded window, sun through the slats)
  //         |   +----------------------+   |
  //   z=+7  +------------------------------+  south corridor (front door)
  //       x=-9                            x=9
  const fixtures = [];
  const roomDoors = [];          // world position + facing of each portfolio door in the loop
  let sun = null;
  {
    const g = hg, H = IN.H, { W, D } = IN, hw = W / 2, hd = D / 2, bx = LOOP.bx, bz = LOOP.bz, T = 3, wm = M.wall;
    const lx = (x) => IN.x + x, lz = (z) => IN.z + z;
    mesh(scaleUV(new THREE.PlaneGeometry(W, D), W / T, D / T), M.floor, { parent: g, rot: [-Math.PI / 2, 0, 0], cast: false, kind: 'hard' });
    mesh(scaleUV(new THREE.PlaneGeometry(W, D), W / T, D / T), M.ceiling, { parent: g, pos: [0, H, 0], rot: [Math.PI / 2, 0, 0], kind: 'hard' });
    // outer walls; the east one has the window opening
    wall(g, H, -hw - 0.1, hd + 0.1, hw + 0.1, hd + 0.1, wm, [], 0.2, T);
    wall(g, H, -hw - 0.1, -hd - 0.1, hw + 0.1, -hd - 0.1, wm, [], 0.2, T);
    wall(g, H, -hw - 0.1, -hd, -hw - 0.1, hd, wm, [], 0.2, T);
    wall(g, H, hw + 0.1, -hd, hw + 0.1, hd, wm, [{ c: 0, w: 1.9, y0: 1.0, h: 2.75, win: true }], 0.2, T);
    // the central block
    wall(g, H, -bx, bz, bx, bz, wm, [], 0.2, T); wall(g, H, -bx, -bz, bx, -bz, wm, [], 0.2, T);
    wall(g, H, -bx, -bz, -bx, bz, wm, [], 0.2, T); wall(g, H, bx, -bz, bx, bz, wm, [], 0.2, T);
    solidBox(lx(-bx), lx(bx), lz(-bz), lz(bz));
    for (const [x, z, len, ry] of [[0, hd, W, Math.PI], [0, -hd, W, 0], [-hw, 0, D, Math.PI / 2], [hw, 0, D, -Math.PI / 2],
      [0, bz + 0.1, 2 * bx, 0], [0, -bz - 0.1, 2 * bx, Math.PI], [-bx - 0.1, 0, 2 * bz, -Math.PI / 2], [bx + 0.1, 0, 2 * bz, Math.PI / 2]]) ao(g, x, z, len, ry, 0.6);

    // boarded window in the east wall: warm daylight outside, slats nailed across, one board missing
    {
      const wz = 0, wx = hw + 0.02;
      for (const y of [0.98, 2.77]) mesh(box(0.08, 0.06, 2.0), M.grey, { parent: g, pos: [wx, y, wz], kind: 'metal' });
      mesh(box(0.06, 1.75, 0.05), M.grey, { parent: g, pos: [wx + 0.03, 1.875, wz], kind: 'metal' });
      for (const y of SLATS) mesh(box(0.025, SLAT_H, 2.04), M.crate, { parent: g, pos: [wx - 0.04, y, wz + (R() - 0.5) * 0.04], rot: [(R() - 0.5) * 0.03, 0, 0], kind: 'wood' });
      const outside = mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.82, 0.55).multiplyScalar(2.4), fog: false }), { parent: g, pos: [hw + 1.4, 2, wz], rot: [0, -Math.PI / 2, 0], cast: false, receive: false });
      outside.userData.sky = true;
      sun = new THREE.SpotLight(0xffc27a, 0, 0, 0.11, 0.25, 0);
      sun.position.set(lx(hw + 22), 8, lz(0.6));
      sun.target.position.set(lx(hw), 1.9, lz(wz));
      sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.near = 12; sun.shadow.camera.far = 40; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
      sun.visible = false; scene.add(sun, sun.target);
    }

    // the doors you can use: front door (south), cellar door (north)
    door(g, -0.2, hd, Math.PI, { glass: true });
    door(g, -0.3, -hd, 0, { w: 0.82, mat: M.darkWood, bolt: true });
    // the rest stay shut (or open onto nothing)
    const cdoor = (x, z, ry, type) => {
      const d = new THREE.Group(); d.position.set(x, 0, z); d.rotation.y = ry; g.add(d);
      const o = { parent: d, kind: 'metal' };
      mesh(box(0.08, 2.18, 0.08), M.teal, { ...o, pos: [-0.515, 1.09, 0.03] });
      mesh(box(0.08, 2.18, 0.08), M.teal, { ...o, pos: [0.515, 1.09, 0.03] });
      mesh(box(1.11, 0.08, 0.08), M.teal, { ...o, pos: [0, 2.14, 0.03] });
      if (type === 'open') { mesh(new THREE.PlaneGeometry(0.95, 2.1), M.void, { parent: d, pos: [0, 1.05, 0.004], kind: 'void', cast: false }); return; }
      const mat = { wood: M.doorWood, white: M.doorWhite, white2: M.doorWhite2, red: M.doorRed }[type];
      mesh(box(0.95, 2.1, 0.04), mat, { parent: d, pos: [0, 1.05, 0.012], kind: type === 'wood' ? 'wood' : 'metal' });
      mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8), M.metal, { ...o, pos: [0.38, 1.02, 0.055], rot: [Math.PI / 2, 0, 0] });
      mesh(box(0.13, 0.022, 0.022), M.metal, { ...o, pos: [0.33, 1.02, 0.08] });
      if (type.startsWith('white')) mesh(new THREE.PlaneGeometry(0.25, 0.36), M.glass, { parent: d, pos: [0, 1.55, 0.034], kind: 'glass', cast: false });
    };
    const S = Math.PI, N = 0, Wf = Math.PI / 2, E = -Math.PI / 2;      // which way the door faces
    // door slots in walking order round the loop, starting to your left as you come in.
    // Each portfolio section gets the next slot; every door you see opens into a room.
    const SLOTS = [
      [-3, bz + 0.1, N], [-6, hd, S], [-hw, 2.5, Wf], [-bx - 0.1, 0.4, E], [-hw, -2, Wf], [-5, -hd, N], [-4, -bz - 0.1, S],
      [1.5, -bz - 0.1, S], [5, -hd, N], [hw, -3.5, E], [bx + 0.1, -1.5, Wf], [hw, 3.6, E], [3.5, bz + 0.1, N], [4, hd, S],
    ];
    const TYPES = ['wood', 'white', 'red', 'white2'];
    PORTFOLIO.slice(0, SLOTS.length).forEach((sec, i) => {
      const [x, z, ry] = SLOTS[i];
      cdoor(x, z, ry, TYPES[i % 4]);
      roomDoors.push({ x: lx(x), z: lz(z), ry });
    });

    // ceiling beams across every corridor, pipes round the outer walls and along the block
    const corr = [
      { axis: 'x', c: (hd + bz) / 2, a0: -hw, a1: hw }, { axis: 'x', c: -(hd + bz) / 2, a0: -hw, a1: hw },
      { axis: 'z', c: -(hw + bx) / 2, a0: -hd, a1: hd }, { axis: 'z', c: (hw + bx) / 2, a0: -hd, a1: hd },
    ];
    const cw = hw - bx;
    for (const s of corr) for (let d = s.a0 + 1.4; d < s.a1 - 1; d += 3) {
      if (s.axis === 'x') { if (Math.abs(d) > bx) continue; mesh(box(0.26, 0.24, cw), M.grey, { parent: g, pos: [d, H - 0.12, s.c], kind: 'metal', cast: false }); }
      else { if (Math.abs(d) > bz) continue; mesh(box(cw, 0.24, 0.26), M.grey, { parent: g, pos: [s.c, H - 0.12, d], kind: 'metal', cast: false }); }
    }
    const pipe = (r, mat, a, b, y) => {
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      const m = mesh(new THREE.CylinderGeometry(r, r, L, 10), mat, { parent: g, pos: [(a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2], kind: 'metal', cast: false });
      m.rotation.order = 'YXZ'; m.rotation.set(Math.PI / 2, Math.atan2(dx, dz), 0);
    };
    const ring = [[-hw + 0.14, -hd + 0.14], [-hw + 0.14, hd - 0.14], [hw - 0.14, hd - 0.14], [hw - 0.14, -hd + 0.14], [-hw + 0.14, -hd + 0.14]];
    for (let i = 0; i < 4; i++) pipe(0.03, M.grey, ring[i], ring[i + 1], 2.8);
    pipe(0.055, M.pipe, [-bx - 0.18, -bz], [-bx - 0.18, bz], 2.62); pipe(0.035, M.pipe, [-bx - 0.14, -bz], [-bx - 0.14, bz], 2.78);
    pipe(0.055, M.pipe, [-bx, bz + 0.18], [bx, bz + 0.18], 2.6);
    for (let z = -bz + 0.5; z < bz; z += 2.5) mesh(box(0.22, 0.03, 0.04), M.metal, { parent: g, pos: [-bx - 0.21, 2.55, z], solid: false, cast: false });
    mesh(new THREE.CylinderGeometry(0.035, 0.035, H, 10), M.pipe, { parent: g, pos: [hw - 0.12, H / 2, -5.6], kind: 'metal' });

    // fluorescent fixtures: some fine, some failing, some dead. Every corner has one so the loop reads.
    const FIX = [
      [-0.2, 5.7, 'x', 'on'], [-5, 5.7, 'x', 'dead'], [4.5, 5.7, 'x', 'flicker'],
      [7.7, 5.7, 'z', 'on'], [7.7, 2.5, 'z', 'dead'], [7.7, -2.2, 'z', 'flicker'], [7.7, -5.7, 'z', 'on'],
      [3.5, -5.7, 'x', 'dead'], [-0.3, -5.7, 'x', 'flicker'], [-4.5, -5.7, 'x', 'dead'],
      [-7.7, -5.7, 'z', 'flicker'], [-7.7, -1.5, 'z', 'on'], [-7.7, 2.5, 'z', 'dead'], [-7.7, 5.7, 'z', 'on'],
    ];
    for (const [x, z, axis, state] of FIX) {
      const f = new THREE.Group(); f.position.set(x, H, z); if (axis === 'x') f.rotation.y = Math.PI / 2; g.add(f);
      mesh(box(0.3, 0.07, 1.3), M.metal, { parent: f, pos: [0, -0.04, 0], kind: 'metal', cast: false });
      const tubeMat = state === 'dead' ? M.tubeDead : M.tube.clone();
      for (const tx of [-0.07, 0.07]) mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.2, 8), tubeMat, { parent: f, pos: [tx, -0.1, 0], rot: [Math.PI / 2, 0, 0], solid: false, cast: false });
      if (state === 'dead' && R() < 0.5) f.children[f.children.length - 1].rotation.z = 0.35;     // a tube hanging loose
      fixtures.push({ x: lx(x), z: lz(z), state, tubeMat, level: state === 'dead' ? 0 : 1, ft: Math.random() * 3, burst: 0 });
    }

    // ---- props along the walls (kept to the sides so the loop stays walkable)
    barrel(lx(-8.55), lz(-3.9), M.barrelBlue); barrel(lx(-8.6), lz(-3.25), M.barrelRust);
    barrel(lx(8.45), lz(-6.4), M.barrelRust, true); barrel(lx(2.1), lz(4.85), M.barrelBlue);
    crate(lx(-6.85), lz(3.6), 0.7, 0.1); crate(lx(-6.85), lz(3.6), 0.46, 0.5, 0.7); crate(lx(8.55), lz(5.4), 0.6, 0.3); crate(lx(-3.6), lz(-6.6), 0.55, -0.2);
    const pallet = (x, z, ry) => {
      const p = new THREE.Group(); p.position.set(x, 0, z); p.rotation.set(0, ry, -0.16, 'YXZ'); g.add(p);
      for (let i = 0; i < 5; i++) mesh(box(0.02, 1.2, 0.14), M.crate, { parent: p, pos: [0.06, 0.6, -0.48 + i * 0.24], kind: 'wood' });
      for (const y of [0.08, 0.6, 1.12]) mesh(box(0.09, 0.1, 1.1), M.wood, { parent: p, pos: [0, y, 0], kind: 'wood' });
    };
    pallet(-hw + 0.14, 0.9, 0); pallet(hw - 0.14, -5.0, Math.PI);
    const ladder = (x, z) => {
      const l = new THREE.Group(); l.position.set(x, 0, z); l.rotation.set(0, 0, 0.11, 'YXZ'); g.add(l);
      for (const q of [-0.22, 0.22]) mesh(box(0.05, 2.6, 0.06), M.metal, { parent: l, pos: [0, 1.3, q], kind: 'metal' });
      for (let y = 0.3; y < 2.5; y += 0.3) mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.44, 6), M.metal, { parent: l, pos: [0, y, 0], rot: [Math.PI / 2, 0, 0], kind: 'metal' });
      circ(g, x, z, 0.3);
    };
    ladder(hw - 0.3, 1.5);
    const extinguisher = (x, z, side) => {
      const e = new THREE.Group(); e.position.set(x, 0.62, z); g.add(e);
      mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.5, 14), M.redPaint, { parent: e, pos: [0, 0.25, 0], kind: 'metal' });
      mesh(new THREE.SphereGeometry(0.075, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.redPaint, { parent: e, pos: [0, 0.5, 0], kind: 'metal' });
      mesh(box(0.05, 0.08, 0.05), M.metal, { parent: e, pos: [0, 0.6, 0], kind: 'metal' });
      mesh(box(0.03, 0.2, 0.12), M.metal, { parent: e, pos: [-side * 0.09, 0.45, 0], solid: false });
    };
    extinguisher(-hw + 0.1, 4.2, -1); extinguisher(-bx - 0.2, -2.8, 1); extinguisher(hw - 0.1, -1.6, 1);
    mesh(box(0.12, 0.36, 0.36), M.firstAid, { parent: g, pos: [-bx - 0.16, 1.5, 2.2], kind: 'metal' });
    const exitSign = (x, z, ry) => {
      const s = new THREE.Group(); s.position.set(x, 0, z); s.rotation.y = ry; g.add(s);
      mesh(box(0.66, 0.24, 0.07), M.exitSign, { parent: s, pos: [0, 2.52, 0], kind: 'glass', cast: false });
      for (const sx of [-0.25, 0.25]) mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.36, 4), M.metal, { parent: s, pos: [sx, 2.82, 0], solid: false, cast: false });
    };
    exitSign(-0.2, 6.6, 0); exitSign(7.7, -4.2, Math.PI / 2); exitSign(-7.7, 4.0, -Math.PI / 2);
    // old family photos still hanging, crooked, along the block
    photo(g, -1.5, 1.6, bz + 0.105, 0, 0, 0.3, 0.38, 0.08); photo(g, 1.2, 1.55, bz + 0.105, 0, 2, 0.26, 0.32, -0.12);
    photo(g, bx + 0.105, 1.6, 2.2, Math.PI / 2, 1, 0.34, 0.28, 0.05); photo(g, -2.2, 1.65, -bz - 0.105, Math.PI, 0, 0.28, 0.36, -0.2);
    photo(g, -bx - 0.105, 1.5, -1.6, -Math.PI / 2, 2, 0.3, 0.4, 0.15);
    // a chair left in the far corner, facing the wall
    {
      const c = new THREE.Group(); c.position.set(-8.35, 0, -6.35); c.rotation.y = Math.PI * 0.75; g.add(c);
      const o = { parent: c, kind: 'wood' };
      mesh(box(0.42, 0.04, 0.42), M.darkWood, { ...o, pos: [0, 0.46, 0] });
      for (const [a, b] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) mesh(box(0.035, 0.46, 0.035), M.darkWood, { ...o, pos: [a, 0.23, b] });
      for (const a of [-0.18, 0.18]) mesh(box(0.035, 0.5, 0.035), M.darkWood, { ...o, pos: [a, 0.73, -0.19] });
      mesh(box(0.38, 0.1, 0.02), M.darkWood, { ...o, pos: [0, 0.9, -0.19] });
      circ(g, -8.35, -6.35, 0.32);
    }
    // blood: something was dragged round the loop toward the cellar door
    bloodTrail(g, -7.6, 4.2, -7.8, -1.6, 0.5);
    bloodTrail(g, -7.8, -1.6, -7.2, -5.6, 0.45);
    bloodTrail(g, -7.2, -5.7, -0.6, -6.1, 0.42);
    floorBlood(g, 'pool', -7.7, 4.6, 1.3, 1.3, 0.3);
    floorBlood(g, 'splat', 7.4, -1.4, 1.0, 1.0, 1.2);
    wallBlood(g, 'hand', -bx - 0.104, 1.3, 2.9, -Math.PI / 2, 0.24, 0.24, 0.2);
    wallBlood(g, 'hand', -hw + 0.004, 1.15, -3.4, Math.PI / 2, 0.24, 0.24, -0.25);
    wallBlood(g, 'drips', 0.7, 1.6, -hd + 0.004, 0, 0.5, 1.0);
    wallBlood(g, 'hand', -0.05, 1.18, -hd + 0.075, 0, 0.22, 0.22, 0.1);                    // on the cellar door itself
    wallBlood(g, 'splat', -2.3, 1.4, bz + 0.104, 0, 1.0, 1.0);
    // paper, and rubble under two holes in the ceiling
    const corridorPoint = (bias = 0) => {
      const s = corr[Math.floor(R() * 4)], along = s.a0 + 0.6 + R() * (s.a1 - s.a0 - 1.2);
      const across = bias ? (R() < 0.5 ? -1 : 1) * (cw / 2 - 0.15 - R() * bias) : (R() - 0.5) * (cw - 0.4);
      return s.axis === 'x' ? [along, s.c + across] : [s.c + across, along];
    };
    for (let i = 0; i < 30; i++) {
      const [x, z] = corridorPoint();
      mesh(new THREE.PlaneGeometry(0.21, 0.28), M.paper[i % 4], { parent: g, pos: [x, 0.004 + i * 0.0002, z], rot: [-Math.PI / 2 + (R() < 0.3 ? (R() - 0.5) * 0.25 : 0), 0, R() * 6], kind: 'paper', cast: false });
    }
    const geos = [new THREE.DodecahedronGeometry(1, 0), new THREE.IcosahedronGeometry(1, 0), new THREE.BoxGeometry(1.4, 0.7, 1)];
    const chunk = (x, z, s) => mesh(geos[Math.floor(R() * 3)], M.rubble, { parent: g, pos: [x, s * 0.5, z], rot: [R() * 6, R() * 6, R() * 6], kind: 'hard', cast: s > 0.05 }).scale.set(s * (0.7 + R() * 0.6), s * (0.5 + R() * 0.4), s * (0.7 + R() * 0.6));
    for (let i = 0; i < 110; i++) { const [x, z] = corridorPoint(0.35); chunk(x, z, 0.02 + R() * 0.05); }
    for (const [cx, cz] of [[-7.5, -3.2], [5.2, -5.6]]) {
      for (let i = 0; i < 30; i++) { const a = R() * 6.28, d = Math.pow(R(), 1.5) * 0.7; chunk(cx + Math.cos(a) * d, cz + Math.sin(a) * d, 0.03 + R() * 0.09 * (1 - d)); }
      mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ color: 0x050403 }), { parent: g, pos: [cx, H - 0.003, cz], rot: [Math.PI / 2, 0, R() * 3], solid: false, cast: false }).scale.set(0.5, 0.35, 1);
    }
  }

  // ================================================================ cellar
  {
    const g = cg, H = CEL.H, { W, D } = CEL, hw = W / 2, hd = D / 2, cw = M.cellarWall;
    mesh(scaleUV(new THREE.PlaneGeometry(W, D), W / 2.5, D / 2.5), M.cellarFloor, { parent: g, rot: [-Math.PI / 2, 0, 0], cast: false, kind: 'hard' });
    // underside of the floorboards above, with joists
    mesh(scaleUV(new THREE.PlaneGeometry(W, D), W / 2, D / 2), M.floorboards, { parent: g, pos: [0, H, 0], rot: [Math.PI / 2, 0, 0], kind: 'wood' });
    for (let x = -hw + 0.3; x < hw; x += 0.6) mesh(box(0.06, 0.2, D), M.darkWood, { parent: g, pos: [x, H - 0.1, 0], kind: 'wood', cast: false });
    mesh(box(W, 0.22, 0.18), M.darkWood, { parent: g, pos: [0, H - 0.11, -0.5], kind: 'wood', cast: false });       // beam
    wall(g, H, -hw - 0.1, hd + 0.1, hw + 0.1, hd + 0.1, cw, [], 0.2);
    wall(g, H, -hw - 0.1, -hd - 0.1, hw + 0.1, -hd - 0.1, cw, [], 0.2);
    wall(g, H, -hw - 0.1, -hd, -hw - 0.1, hd, cw, [], 0.2);
    wall(g, H, hw + 0.1, -hd, hw + 0.1, hd, cw, [], 0.2);
    for (const [x, z, len, ry] of [[0, hd, W, Math.PI], [0, -hd, W, 0], [-hw, 0, D, Math.PI / 2], [hw, 0, D, -Math.PI / 2]]) ao(g, x, z, len, ry, 0.6);
    // stairs down from the hall, along the east wall
    {
      const s = new THREE.Group(); s.position.set(hw - 0.5, 0, 0); g.add(s);
      const n = 11, top = -hd, bottom = -0.6, rise = H / n, runZ = (bottom - top) / n;
      for (let i = 0; i < n; i++) {
        const y = H - (i + 1) * rise, z = top + (i + 0.5) * runZ;
        mesh(box(0.95, 0.04, runZ + 0.04), M.paleWood, { parent: s, pos: [0, y, z], kind: 'wood' });
        mesh(box(0.95, rise, 0.02), M.darkWood, { parent: s, pos: [0, y + rise / 2, z - runZ / 2], kind: 'wood' });
      }
      const sl = Math.hypot(H, bottom - top), ang = Math.atan2(H, bottom - top);
      for (const sx of [-0.5, 0.5]) { const st = mesh(box(0.05, 0.3, sl), M.darkWood, { parent: s, pos: [sx, H / 2, (top + bottom) / 2], kind: 'wood' }); st.rotation.x = ang; }
      // handrail on posts
      const hr = mesh(box(0.05, 0.05, sl), M.paleWood, { parent: s, pos: [-0.52, H / 2 + 0.85, (top + bottom) / 2], kind: 'wood' }); hr.rotation.x = ang;
      mesh(box(0.06, 0.95, 0.06), M.paleWood, { parent: s, pos: [-0.52, 0.48, bottom - 0.05], kind: 'wood' });
      // a crack of light under the door at the top
      mesh(new THREE.PlaneGeometry(0.8, 0.02), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 1.3) }), { parent: s, pos: [0, H - 0.08, top + 0.01], cast: false, solid: false });
      solidBox(CEL.x + hw - 1.0, CEL.x + hw, CEL.z + top, CEL.z + bottom + 0.05);
    }
    // high window well, almost no light
    inWindow(g, -1.5, H - 0.4, -hd, 0, { w: 0.8, h: 0.35 });
    // shelves of old jars
    {
      const s = new THREE.Group(); s.position.set(-hw + 0.25, 0, -1.0); s.rotation.y = Math.PI / 2; g.add(s);
      for (const yy of [0.35, 0.85, 1.35, 1.85]) mesh(box(2.4, 0.03, 0.4), M.paleWood, { parent: s, pos: [0, yy, 0], kind: 'wood' });
      for (const sx of [-1.18, 0, 1.18]) mesh(box(0.05, 2.0, 0.4), M.paleWood, { parent: s, pos: [sx, 1.0, 0], kind: 'wood' });
      const n = 40, jars = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 10), new THREE.MeshStandardMaterial({ roughness: 0.15, metalness: 0.0, transparent: true, opacity: 0.85 }), n);
      const mm = new THREE.Matrix4(), col = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const yy = [0.35, 0.85, 1.35, 1.85][i % 4];
        mm.makeTranslation(-1.1 + R() * 2.2, yy + 0.095, (R() - 0.5) * 0.25);
        jars.setMatrixAt(i, mm); jars.setColorAt(i, col.setHSL(0.05 + R() * 0.12, 0.6, 0.12 + R() * 0.15));
      }
      jars.castShadow = true; jars.userData.kind = 'glass'; s.add(jars); solids.push(jars);
      fp(g, -hw + 0.25, -1.0, 0.42, 2.45);
    }
    { // furnace with ducts running into the ceiling
      const f = new THREE.Group(); f.position.set(-2.2, 0, -hd + 0.6); g.add(f);
      mesh(box(1.1, 1.5, 0.9), M.grey, { parent: f, pos: [0, 0.75, 0], kind: 'metal' });
      mesh(box(0.4, 0.25, 0.02), black, { parent: f, pos: [0, 0.5, 0.46], kind: 'metal' });
      mesh(new THREE.CylinderGeometry(0.18, 0.18, H - 1.5, 14), M.pipe, { parent: f, pos: [0.2, 1.5 + (H - 1.5) / 2, 0], kind: 'metal' });
      mesh(new THREE.CylinderGeometry(0.13, 0.13, 2.4, 12), M.pipe, { parent: f, pos: [1.4, H - 0.35, 0.1], rot: [0, 0, Math.PI / 2], kind: 'metal' });
      fp(g, -2.2, -hd + 0.6, 1.15, 0.95);
    }
    { // water heater
      mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.5, 18), M.enamel, { parent: g, pos: [-0.6, 0.75, -hd + 0.4], kind: 'metal' });
      mesh(new THREE.CylinderGeometry(0.04, 0.04, H - 1.5, 8), M.metal, { parent: g, pos: [-0.6, 1.5 + (H - 1.5) / 2, -hd + 0.4], kind: 'metal' });
      circ(g, -0.6, -hd + 0.4, 0.38);
    }
    { // workbench with a vice and scattered tools
      const b = new THREE.Group(); b.position.set(0.6, 0, hd - 0.4); b.rotation.y = Math.PI; g.add(b);
      const o = { parent: b, kind: 'wood' };
      mesh(box(2.0, 0.07, 0.7), M.crate, { ...o, pos: [0, 0.88, 0] });
      for (const [lx, lz] of [[-0.92, -0.3], [0.92, -0.3], [-0.92, 0.3], [0.92, 0.3]]) mesh(box(0.08, 0.86, 0.08), M.crate, { ...o, pos: [lx, 0.43, lz] });
      mesh(box(1.9, 0.03, 0.6), M.crate, { ...o, pos: [0, 0.2, 0] });
      mesh(box(0.18, 0.14, 0.2), M.grey, { ...o, pos: [0.75, 0.98, 0.25], kind: 'metal' });
      mesh(box(0.3, 0.02, 0.04), M.metal, { ...o, pos: [-0.3, 0.925, 0.1], rot: [0, 0.6, 0], kind: 'metal' });
      mesh(box(0.25, 0.03, 0.06), M.darkWood, { ...o, pos: [-0.1, 0.93, -0.12], rot: [0, -0.3, 0] });
      mesh(box(1.4, 0.8, 0.02), M.darkWood, { parent: b, pos: [0, 1.55, -0.33], kind: 'wood' });   // pegboard
      fp(g, 0.6, hd - 0.4, 2.05, 0.75);
    }
    { // a chair in the middle of the floor, facing the corner. Rope on the floor.
      const c = new THREE.Group(); c.position.set(-2.9, 0, 2.3); c.rotation.y = Math.PI * 0.78; g.add(c);
      const o = { parent: c, kind: 'wood' };
      mesh(box(0.42, 0.04, 0.42), M.darkWood, { ...o, pos: [0, 0.46, 0] });
      for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) mesh(box(0.035, 0.46, 0.035), M.darkWood, { ...o, pos: [lx, 0.23, lz] });
      for (const lx of [-0.18, 0.18]) mesh(box(0.035, 0.5, 0.035), M.darkWood, { ...o, pos: [lx, 0.73, -0.19] });
      mesh(box(0.38, 0.1, 0.02), M.darkWood, { ...o, pos: [0, 0.9, -0.19] });
      mesh(new THREE.TorusGeometry(0.22, 0.015, 6, 20), M.cord, { parent: g, pos: [-2.6, 0.015, 2.0], rot: [Math.PI / 2, 0, 0], kind: 'wood', cast: false });
      circ(g, -2.9, 2.3, 0.32);
    }
    { // old striped mattress on the floor, sagging and lumpy, soaked through on one side
      const geo = new THREE.BoxGeometry(0.95, 0.2, 1.9, 10, 2, 20), p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (y > 0) {
          const edge = Math.min(0.475 - Math.abs(x), 0.95 - Math.abs(z));                 // soft rounded top edge
          const round = edge < 0.05 ? (0.05 - edge) * 0.7 : 0;
          p.setY(i, y - round + Math.sin(x * 11 + z * 7) * 0.004 - Math.exp(-((z + 0.25) ** 2) * 4 - x * x * 6) * 0.025);   // a shallow body-shaped dip
        }
      }
      geo.computeVertexNormals();
      const mt = new THREE.CanvasTexture(TX.mattressTexture()); mt.colorSpace = THREE.SRGBColorSpace; mt.anisotropy = 8;
      const mat = new THREE.MeshStandardMaterial({ map: mt, roughness: 0.95 });
      const mg = new THREE.Group(); mg.position.set(1.8, 0, 1.4); mg.rotation.y = 0.25; g.add(mg);
      mesh(geo, mat, { parent: mg, pos: [0, 0.1, 0], kind: 'wood' });
      // a flattened pillow at the head end
      const pg = new THREE.SphereGeometry(0.5, 16, 8);
      pg.scale(0.6, 0.12, 0.36);
      mesh(pg, M.linen, { parent: mg, pos: [0.05, 0.215, 0.66], rot: [0, 0.15, 0], kind: 'wood' });
      floorBlood(mg, 'pool', -0.08, -0.25, 0.85, 0.85, 0.7, 0.18);
      wallBlood(mg, 'drips', -0.476, 0.1, -0.3, -Math.PI / 2, 0.25, 0.3);           // run off the side
      fp(g, 1.8, 1.4, 1.0, 1.95, 0.25, 0.0);
    }
    // ---- blood: a pool by the mattress, a drag trail to the chair, prints on the walls and furnace
    floorBlood(g, 'pool', 1.15, 1.0, 1.2, 1.2, 1.9);
    bloodTrail(g, 1.0, 1.15, -2.55, 2.15, 0.5);
    floorBlood(g, 'splat', -2.9, 2.35, 1.1, 1.1, 0.4);
    wallBlood(g, 'splat', -3.3, 1.15, hd - 0.004, Math.PI, 1.2, 1.2);
    wallBlood(g, 'drips', -2.6, 1.55, hd - 0.004, Math.PI, 0.5, 1.0);
    wallBlood(g, 'drips', -hw + 0.004, 1.5, 2.5, Math.PI / 2, 0.45, 0.9);
    wallBlood(g, 'hand', hw - 0.004, 1.25, 0.35, -Math.PI / 2, 0.24, 0.24, 0.3);       // grabbed the wall at the foot of the stairs
    wallBlood(g, 'hand', hw - 0.004, 1.05, 0.75, -Math.PI / 2, 0.24, 0.24, -0.2);
    wallBlood(g, 'hand', -2.35, 0.95, -hd + 0.6 + 0.456, 0, 0.22, 0.22, 0.15);           // on the furnace door
    floorBlood(g, 'splat', 3.3, -0.2, 0.6, 0.6, 2.2);
    // ================================================================ horror dressing
    {
      const tex = (canvas) => { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
      const decal = (canvas, opacity = 1) => new THREE.MeshStandardMaterial({ map: tex(canvas), transparent: true, opacity, depthWrite: false, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const plane = (mat, w, h, x, y, z, ry, rx = 0, rz = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(x, y, z); m.rotation.order = 'YXZ'; m.rotation.set(rx, ry, rz); m.receiveShadow = true; m.renderOrder = 2; g.add(m); return m; };

      // GET OUT, daubed across the west wall; tally marks scratched by the chair
      plane(decal(TX.bloodWritingTexture('GET OUT')), 2.5, 0.94, -hw + 0.006, 1.55, 1.65, Math.PI / 2, 0, -0.03);
      plane(decal(TX.tallyTexture()), 0.9, 0.45, -1.3, 0.75, hd - 0.006, Math.PI);

      // bloody footprints walking from the chair to the foot of the stairs, fading as the blood ran out
      const fpTex = tex(TX.footprintTexture());
      const prints = [0.95, 0.8, 0.65, 0.5, 0.35].map((o) => new THREE.MeshStandardMaterial({ map: fpTex, transparent: true, opacity: o, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      { const a = [-2.5, 1.9], b = [3.3, -0.25], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), n = Math.floor(L / 0.36);
        const yaw = Math.atan2(-dx, -dz), px = -dz / L, pz = dx / L;
        for (let i = 0; i < n; i++) {
          const t = i / n, side = i % 2 ? 1 : -1;
          plane(prints[Math.min(4, Math.floor(t * 5))], 0.13, 0.27, a[0] + dx * t + px * side * 0.11, 0.004, a[1] + dz * t + pz * side * 0.11, yaw, -Math.PI / 2);
        } }

      // chains with meat hooks hanging from the joists, dripping
      const link = new THREE.TorusGeometry(0.03, 0.007, 5, 10);
      const chain = (x, z, len) => {
        const c = new THREE.Group(); c.position.set(x, H - 0.2, z); g.add(c);
        const n = Math.floor(len / 0.05);
        for (let i = 0; i < n; i++) { const l = new THREE.Mesh(link, M.metal); l.position.y = -i * 0.05; l.rotation.y = i % 2 ? Math.PI / 2 : 0; l.castShadow = true; c.add(l); }
        const hook = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 14, Math.PI * 1.4), M.metal);
        hook.position.y = -n * 0.05 - 0.06; hook.rotation.z = Math.PI * 0.8; hook.castShadow = true; c.add(hook);
        mesh(new THREE.SphereGeometry(0.025, 6, 4), new THREE.MeshStandardMaterial({ color: 0x2a0303, roughness: 0.3 }), { parent: c, pos: [0.05, -n * 0.05 - 0.12, 0], solid: false, cast: false });
        floorBlood(g, 'splat', x + 0.05, z, 0.5, 0.5, x * 3);
        return c;
      };
      const chains = [chain(0.3, 0.1, 1.0), chain(-1.3, 1.1, 0.7), chain(0.9, -1.9, 1.25)];

      // plastic sheeting hung across the corner by the bench, smeared; a tarp-wrapped bundle behind it
      { const sg = new THREE.PlaneGeometry(1.75, H - 0.25, 18, 10), sp = sg.attributes.position;
        for (let i = 0; i < sp.count; i++) { const x = sp.getX(i), y = sp.getY(i); sp.setZ(i, Math.sin(x * 7 + y * 1.5) * 0.04 + Math.sin(x * 17) * 0.015 + (y < -0.6 ? (R() - 0.5) * 0.03 : 0)); }
        sg.computeVertexNormals();
        const sheet = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: 0xc9cfc4, transparent: true, opacity: 0.2, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false }));
        sheet.position.set(3.1, (H - 0.25) / 2 + 0.05, 2.45); sheet.renderOrder = 1; g.add(sheet);
        // smeared on the side facing the room
        const sy = -(H - 0.25) / 2 - 0.05;
        wallBlood(sheet, 'hand', -0.4, 1.2 + sy, -0.075, Math.PI, 0.26, 0.26, 0.3);
        wallBlood(sheet, 'hand', -0.15, 1.45 + sy, -0.075, Math.PI, 0.26, 0.26, -0.2);
        wallBlood(sheet, 'smear', 0.2, 1.0 + sy, -0.075, Math.PI, 1.0, 0.26, 0.5);
        wallBlood(sheet, 'drips', 0.55, 1.6 + sy, -0.075, Math.PI, 0.4, 0.8);
        wallBlood(sheet, 'splat', -0.1, 0.55 + sy, -0.075, Math.PI, 0.7, 0.7);
        solidBox(CEL.x + 2.2, CEL.x + hw, CEL.z + 2.4, CEL.z + 2.5);
        // the bundle: a long shape wrapped in a dark tarp and tied with rope
        const bg = new THREE.CapsuleGeometry(0.22, 1.2, 6, 12); bg.rotateZ(Math.PI / 2); bg.scale(1, 0.75, 1);
        const bundle = mesh(bg, new THREE.MeshStandardMaterial({ color: 0x2c3a34, roughness: 0.55 }), { parent: g, pos: [3.0, 0.17, 3.05], rot: [0, 0.12, 0], kind: 'wood' });
        for (const bx of [-0.45, 0, 0.45]) mesh(new THREE.TorusGeometry(0.2, 0.012, 5, 16), M.cord, { parent: bundle, pos: [bx, 0, 0], rot: [0, Math.PI / 2, 0], solid: false });
        floorBlood(g, 'pool', 3.1, 3.0, 1.2, 0.9, 0.2);
        solidBox(CEL.x + 2.2, CEL.x + hw, CEL.z + 2.5, CEL.z + hd); }

      // the bench: a cleaver and a saw left out, bloody rags, a bucket on the floor
      { const b = new THREE.Group(); b.position.set(0.6, 0.92, hd - 0.4); b.rotation.y = Math.PI; g.add(b);
        const blade = new THREE.MeshStandardMaterial({ color: 0x8a8c88, metalness: 0.85, roughness: 0.35 });
        mesh(box(0.22, 0.012, 0.12), blade, { parent: b, pos: [-0.5, 0.01, 0.05], rot: [0, 0.3, 0], kind: 'metal' });
        mesh(box(0.12, 0.03, 0.035), M.darkWood, { parent: b, pos: [-0.33, 0.015, 0.1], rot: [0, 0.3, 0], kind: 'wood' });
        mesh(box(0.4, 0.004, 0.09), blade, { parent: b, pos: [0.15, 0.004, -0.15], rot: [0, -0.2, 0], kind: 'metal' });
        floorBlood(b, 'splat', -0.45, 0.06, 0.5, 0.5, 0.4, 0.013);
        floorBlood(b, 'smear', 0.1, -0.05, 0.8, 0.25, 0.1, 0.014);
        for (const [x, z] of [[0.45, 0.15], [0.62, 0.05]]) { const rg = new THREE.SphereGeometry(0.08, 8, 6); rg.scale(1.2, 0.35, 0.9);
          mesh(rg, new THREE.MeshStandardMaterial({ color: 0x4a0a07, roughness: 0.9 }), { parent: b, pos: [x, 0.02, z], kind: 'wood' }); }
        wallBlood(g, 'splat', 0.4, 1.45, hd - 0.006, Math.PI, 1.1, 1.1);
        // bucket with blood in it
        mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.32, 16, 1, true), M.metal, { parent: g, pos: [-0.75, 0.16, 2.9], kind: 'metal' });
        mesh(new THREE.CircleGeometry(0.15, 16), new THREE.MeshStandardMaterial({ color: 0x220202, roughness: 0.15 }), { parent: g, pos: [-0.75, 0.26, 2.9], rot: [-Math.PI / 2, 0, 0], solid: false });
        circ(g, -0.75, 2.9, 0.22); floorBlood(g, 'splat', -0.75, 2.85, 0.6, 0.6, 1.1); }

      // a floor drain in the middle, blood pooled around it
      mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.01, 16), new THREE.MeshStandardMaterial({ color: 0x1e1d1b, metalness: 0.7, roughness: 0.6 }), { parent: g, pos: [-0.7, 0.005, 1.7], kind: 'metal', cast: false });
      for (let k = -2; k <= 2; k++) mesh(box(0.2, 0.012, 0.012), M.metal, { parent: g, pos: [-0.7, 0.011, 1.7 + k * 0.04], solid: false, cast: false });
      floorBlood(g, 'pool', -0.7, 1.7, 0.95, 0.95, 2.6, 0.0025);

      // rope still tied round the chair; blood under it and up the corner
      { const c = new THREE.Group(); c.position.set(-2.9, 0, 2.3); c.rotation.y = Math.PI * 0.78; g.add(c);
        for (const y of [0.3, 0.62]) mesh(new THREE.TorusGeometry(0.24, 0.012, 5, 18), M.cord, { parent: c, pos: [0, y, 0], rot: [Math.PI / 2, 0, 0], solid: false });
        floorBlood(g, 'pool', -2.95, 2.4, 0.9, 0.9, 0.9, 0.0028); }

      // spray up the walls and across the underside of the floor above
      wallBlood(g, 'splat', -hw + 0.006, 0.9, -0.35 + 1.7, Math.PI / 2, 0.8, 0.8);
      wallBlood(g, 'hand', -hw + 0.006, 1.0, 0.75, Math.PI / 2, 0.24, 0.24, 0.6);
      wallBlood(g, 'hand', -hw + 0.006, 0.7, 0.95, Math.PI / 2, 0.24, 0.24, -0.4);
      wallBlood(g, 'drips', 1.9, 1.45, -hd + 0.006, 0, 0.45, 0.9);
      for (const [x, z, s] of [[-2.6, 2.0, 1.1], [0.2, 0.3, 0.8], [1.6, 1.2, 0.9]]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), BLOOD.splat); m.position.set(x, H - 0.004, z); m.rotation.set(Math.PI / 2, 0, R() * 6); m.renderOrder = 2; g.add(m);
      }
      cellarChains = chains;
    }
    // ---- cobwebs in the ceiling corners and between joists
    {
      const t = new THREE.CanvasTexture(TX.cobwebTexture()); t.colorSpace = THREE.SRGBColorSpace;
      const web = new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, fog: true });
      for (const [cx, cz] of [[-1, -1], [1, 1], [-1, 1]]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), web);
        m.position.set(cx * (hw - 0.32), H - 0.36, cz * (hd - 0.32));
        m.rotation.set(0, Math.atan2(-cx, -cz) + Math.PI / 4 * 0, 0);
        m.lookAt(g.position.x, H - 0.36, g.position.z);                                   // face into the room
        m.rotateZ(cx * cz > 0 ? Math.PI / 4 * 3 : -Math.PI / 4);
        g.add(m);
      }
    }
    crate(CEL.x - 3.4, CEL.z + 2.9, 0.6, 0.2); crate(CEL.x - 2.75, CEL.z + 3.0, 0.5, -0.3);
    barrel(CEL.x + 1.6, CEL.z - 3.0, M.barrelBlue); barrel(CEL.x - 0.9, CEL.z - 0.7, M.barrelRust, true);
    // the bulb on a pull chain, swinging a little
    const swing = new THREE.Group(); swing.position.set(-0.6, H, 0.5); g.add(swing);
    mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.5, 4), M.cord, { parent: swing, pos: [0, -0.25, 0], cast: false, solid: false });
    mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.06, 10), M.metal, { parent: swing, pos: [0, -0.52, 0], solid: false, cast: false });
    const cb = mesh(new THREE.SphereGeometry(0.045, 12, 8), M.bulb, { parent: swing, pos: [0, -0.59, 0], solid: false, cast: false });
    cellarSwing = swing;
  }

  // ================================================================ portfolio rooms, one behind every corridor door
  // Same tired plaster and terrazzo as the corridors, one working tube, a title on the far wall
  // and framed notices on the side walls. Content comes from src/portfolio.js.
  const rooms = [], linkTargets = [];
  PORTFOLIO.slice(0, roomDoors.length).forEach((sec, i) => {
    const Z = { x: 300 + (i % 5) * 16, z: 100 + Math.floor(i / 5) * 16, W: 6, D: 5, H: 3 };
    const name = 'room' + i;
    ZONES[name] = Z;
    const g = new THREE.Group(); g.position.set(Z.x, 0, Z.z); scene.add(g);
    const { W, D, H } = Z, hw = W / 2, hd = D / 2, T = 3, wm = M.wall;
    mesh(scaleUV(new THREE.PlaneGeometry(W, D), W / T, D / T), M.floor, { parent: g, rot: [-Math.PI / 2, 0, 0], cast: false, kind: 'hard' });
    mesh(scaleUV(new THREE.PlaneGeometry(W, D), W / T, D / T), M.ceiling, { parent: g, pos: [0, H, 0], rot: [Math.PI / 2, 0, 0], kind: 'hard' });
    wall(g, H, -hw - 0.1, hd + 0.1, hw + 0.1, hd + 0.1, wm, [], 0.2, T);
    wall(g, H, -hw - 0.1, -hd - 0.1, hw + 0.1, -hd - 0.1, wm, [], 0.2, T);
    wall(g, H, -hw - 0.1, -hd, -hw - 0.1, hd, wm, [], 0.2, T);
    wall(g, H, hw + 0.1, -hd, hw + 0.1, hd, wm, [], 0.2, T);
    for (const [x, z, len, ry] of [[0, hd, W, Math.PI], [0, -hd, W, 0], [-hw, 0, D, Math.PI / 2], [hw, 0, D, -Math.PI / 2]]) ao(g, x, z, len, ry, 0.6);
    door(g, 0, hd, Math.PI, {});                                                    // the way back out
    // one fluorescent fixture in the middle of the ceiling
    const f = new THREE.Group(); f.position.set(0, H, 0.3); g.add(f);
    mesh(box(0.3, 0.07, 1.3), M.metal, { parent: f, pos: [0, -0.04, 0], kind: 'metal', cast: false });
    for (const tx of [-0.07, 0.07]) mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.2, 8), M.tube, { parent: f, pos: [tx, -0.1, 0], rot: [Math.PI / 2, 0, 0], solid: false, cast: false });
    // framed boards: the title on the far wall, notices on the side walls
    const frame = (x, y, z, ry, w, h, canvas, link) => {
      const q = new THREE.Group(); q.position.set(x, y, z); q.rotation.y = ry; g.add(q);
      mesh(box(w + 0.1, h + 0.1, 0.04), M.darkWood, { parent: q, pos: [0, 0, 0.02], kind: 'wood' });
      const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      const mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.22 });
      const panel = mesh(new THREE.PlaneGeometry(w, h), mat, { parent: q, pos: [0, 0, 0.042], kind: 'paper', cast: false });
      for (const sx of [-1, 1]) mesh(new THREE.SphereGeometry(0.015, 6, 4), M.metal, { parent: q, pos: [sx * (w / 2 - 0.06), h / 2 - 0.06, 0.05], solid: false, cast: false });   // pins
      if (link) { panel.userData.link = link; linkTargets.push(panel); }
      return panel;
    };
    frame(0, 1.65, -hd + 0.005, 0, 3.4, 1.7, TX.titleBoardTexture(sec.title, sec.subtitle, 141 + i));
    const spots = [[-hw + 0.005, -0.9, Math.PI / 2], [hw - 0.005, -0.9, -Math.PI / 2], [-hw + 0.005, 1.2, Math.PI / 2], [hw - 0.005, 1.2, -Math.PI / 2]];
    (sec.boards || []).slice(0, 4).forEach((b, k) => {
      const [x, z, ry] = spots[k];
      frame(x, 1.55, z, ry, 1.5, 1.125, TX.noticeTexture(b, 151 + i * 7 + k), b.link);
    });
    // a little life: a chair, loose paper, a crate in a corner
    {
      const c = new THREE.Group(); c.position.set(hw - 0.7, 0, hd - 0.8); c.rotation.y = -2.4; g.add(c);
      const o = { parent: c, kind: 'wood' };
      mesh(box(0.42, 0.04, 0.42), M.darkWood, { ...o, pos: [0, 0.46, 0] });
      for (const [a, b] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) mesh(box(0.035, 0.46, 0.035), M.darkWood, { ...o, pos: [a, 0.23, b] });
      for (const a of [-0.18, 0.18]) mesh(box(0.035, 0.5, 0.035), M.darkWood, { ...o, pos: [a, 0.73, -0.19] });
      mesh(box(0.38, 0.1, 0.02), M.darkWood, { ...o, pos: [0, 0.9, -0.19] });
      circ(g, hw - 0.7, hd - 0.8, 0.32);
    }
    for (let k = 0; k < 6; k++) mesh(new THREE.PlaneGeometry(0.21, 0.28), M.paper[k % 4], { parent: g, pos: [(R() - 0.5) * (W - 1.2), 0.004 + k * 0.0002, (R() - 0.5) * (D - 1.2)], rot: [-Math.PI / 2, 0, R() * 6], kind: 'paper', cast: false });
    crate(Z.x - hw + 0.45, Z.z + hd - 0.45, 0.55, 0.3);
    const d = roomDoors[i];
    rooms.push({
      zone: name, title: sec.title, label: sec.door || sec.title,
      // corridor side: stand in front of the door; room side: just inside the room's door
      outside: { x: d.x, z: d.z, at: [d.x + Math.sin(d.ry) * 0.9, d.z + Math.cos(d.ry) * 0.9], yaw: d.ry + Math.PI },
      inside: { x: Z.x, z: Z.z + hd, at: [Z.x, Z.z + hd - 0.8], yaw: 0 },
      light: new THREE.Vector3(Z.x, H - 0.3, Z.z + 0.3), board: new THREE.Vector3(Z.x, H - 0.6, Z.z - hd + 1.3),
    });
  });

  // ================================================================ lights per zone (only the active zone's are visible)
  // A small pool of real lights; in the corridors it is handed to the nearest working tubes every frame.
  const L = {
    living: point(0xffc98e, 11), kitchen: point(0xffd6a0, 10), hall: point(0xffd68a, 10), lamp: point(0xffd68a, 10),
  };
  const pool = [L.living, L.kitchen, L.hall, L.lamp];
  L.living.shadow.mapSize.set(512, 512); L.living.shadow.bias = -0.002; L.living.shadow.normalBias = 0.03; L.living.shadow.camera.near = 0.1;
  const cellarBulb = new THREE.Vector3(CEL.x - 0.6, CEL.H - 0.62, CEL.z + 0.5);
  let zoneNow = null, cellarNextOut = 4, cellarOutUntil = 0;
  const TUBE = 4.4;
  return {
    house: hg, cellar: cg, lights: L, fixtures, rooms, linkTargets,
    set(zone) {
      zoneNow = zone;
      const on = zone !== 'yard';
      for (const l of pool) { l.visible = on; l.intensity = 0; l.distance = zone === 'cellar' ? 11 : 9; l.decay = zone === 'cellar' ? 1.7 : 2; }
      sun.visible = zone === 'house'; sun.intensity = zone === 'house' ? 2.6 : 0;
      L.living.castShadow = zone === 'cellar' && !IS_TOUCH;
      if (zone === 'cellar') { L.living.position.copy(cellarBulb); L.kitchen.position.set(CEL.x + 3.5, CEL.H - 0.1, CEL.z - 3.4); L.living.intensity = 9; L.kitchen.intensity = 0.9; }
      const room = rooms.find((r) => r.zone === zone);
      if (room) { L.living.position.copy(room.light); L.living.intensity = 5.5; L.kitchen.position.copy(room.board); L.kitchen.intensity = 2.2; }
    },
    // returns the electrical hum/buzz for the audio engine
    update(t, zone, camPos) {
      if (zone === 'house') {
        let buzz = 0;
        for (const f of fixtures) {
          if (f.state === 'dead') continue;
          if (f.state === 'flicker') {
            if (t > f.ft) { f.burst = t + 0.1 + Math.random() * 0.9; f.ft = t + 1.5 + Math.random() * 5; }
            const target = t < f.burst ? (Math.random() < 0.5 ? 0.04 : 0.6 + Math.random() * 0.4) : 1;
            f.level += (target - f.level) * 0.7;
          }
          f.tubeMat.emissiveIntensity = 2.2 * f.level;
          f.d = Math.hypot(f.x - camPos.x, f.z - camPos.z);
          if (f.state === 'flicker' && f.d < 6 && t < f.burst) buzz = Math.max(buzz, 1 - f.d / 6);
        }
        const live = fixtures.filter((f) => f.state !== 'dead').sort((a, b) => a.d - b.d);
        pool.forEach((l, i) => { const f = live[i]; l.position.set(f.x, IN.H - 0.3, f.z); l.intensity = TUBE * f.level; });
        return { hum: 0.6, buzz };
      }
      if (zone === 'cellar' && cellarSwing) {
        const sw = cellarSwing;
        sw.rotation.z = Math.sin(t * 1.3) * 0.12; sw.rotation.x = Math.sin(t * 0.9 + 1) * 0.06;
        L.living.position.set(cellarBulb.x + Math.sin(sw.rotation.z) * 0.59, cellarBulb.y + 0.02, cellarBulb.z - Math.sin(sw.rotation.x) * 0.59);
        // the bulb stutters: mostly steady, now and then it drops out for a moment
        if (t > cellarNextOut) { cellarOutUntil = t + 0.05 + Math.random() * 0.35; cellarNextOut = t + 3 + Math.random() * 7; }
        const out = t < cellarOutUntil && Math.random() < 0.7;
        const k = out ? 0.04 : 0.92 + Math.random() * 0.08;
        L.living.intensity = 9 * k;
        sw.children[2].material = out ? M.bulbDead : M.bulb;
        cellarChains.forEach((c, i) => { c.rotation.z = Math.sin(t * 0.7 + i * 2) * 0.03; c.rotation.x = Math.sin(t * 0.5 + i) * 0.02; });
        return { hum: 0.45, buzz: out ? 0.9 : 0.25 };
      }
      if (zone.startsWith('room')) return { hum: 0.5, buzz: 0 };
      return { hum: 0, buzz: 0 };
    },
  };
})();

// standard material copy with a different side/opacity (for curtains and blankets)
function std2(base, opacity) {
  const m = base.clone(); m.side = THREE.DoubleSide;
  if (opacity < 1) { m.transparent = true; m.opacity = opacity; m.depthWrite = false; }
  return m;
}

// ============================================================ lights: overcast daylight
const hemi = new THREE.HemisphereLight(0xd8b088, 0x4c3a28, 1.3);
scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xffb468, 1.6);      // low sunset sun from the west: warm, long shadows
sunLight.position.set(-34, 9, -20);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 90 });
sunLight.shadow.bias = -0.0005; sunLight.shadow.normalBias = 0.04;
scene.add(sunLight, sunLight.target);

// muzzle flash light (always present so light count never changes -> no shader recompiles)
const muzzleLight = new THREE.PointLight(0xffb060, 0, 9, 2);
scene.add(muzzleLight);


// reflections: the overcast sky over dark ground (glass, wet puddles and container steel pick it up)
{
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat));
  const gd = new THREE.Mesh(new THREE.CircleGeometry(50, 24), new THREE.MeshBasicMaterial({ color: 0x3e3226 }));
  gd.rotation.x = -Math.PI / 2; gd.position.y = -1; env.add(gd);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.02).texture;
  scene.environmentIntensity = 0.6;
  pm.dispose();
}

// ============================================================ paper cut-out character
const character = (() => {
  const C = TX.characterTextures();
  const front = new THREE.CanvasTexture(C.front); front.colorSpace = THREE.SRGBColorSpace; front.anisotropy = 4;
  const back = new THREE.CanvasTexture(C.back); back.colorSpace = THREE.SRGBColorSpace;
  const H = 1.8, W = H * (C.w / C.h);
  const geo = new THREE.PlaneGeometry(W, H).translate(0, H / 2, 0);
  const pivot = new THREE.Group();
  pivot.position.set(1.7, 0, HOUSE.z + HOUSE.D / 2 + 2.3 + 1.4);
  pivot.rotation.order = 'YXZ';
  const base = { y: -0.25, x: -0.1 };
  scene.add(pivot);
  const fm = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: front, alphaTest: 0.5, roughness: 0.88 }));
  fm.castShadow = true; fm.receiveShadow = true;
  fm.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: front, alphaTest: 0.5 });
  fm.userData = { kind: 'paper', character: true, alpha: { data: C.frontAlpha, w: C.w, h: C.h } };
  const bm = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: back, alphaTest: 0.5, roughness: 0.95 }));
  bm.rotation.y = Math.PI; bm.position.z = -0.003; bm.receiveShadow = true;
  bm.userData = { kind: 'paper', character: true, alpha: { data: C.backAlpha, w: C.w, h: C.h } };
  // a little cardboard easel foot behind
  const foot = new THREE.Mesh(box(0.04, 0.9, 0.012), new THREE.MeshStandardMaterial({ color: 0x9c8b6a, roughness: 1 }));
  foot.position.set(0, 0.44, -0.2); foot.rotation.x = 0.45; foot.castShadow = true;
  pivot.add(fm, bm, foot);
  solids.push(fm, bm);
  obstacles.push({ x: pivot.position.x, z: pivot.position.z, r: 0.42 });
  const tilt = new Spring(42, 2.0), roll = new Spring(36, 1.8), twist = new Spring(30, 1.6);
  return {
    pivot, tilt, roll, twist,
    hit(localPoint) {
      const h = THREE.MathUtils.clamp(localPoint.y / H, 0, 1);
      tilt.v -= 1.3 + h * 2.0;
      roll.v += (localPoint.x / W) * 5 * (0.4 + h);
      twist.v += (localPoint.x / W) * 4;
    },
    creep(camPos, camDir) {
      const dx = camPos.x - pivot.position.x, dz = camPos.z - pivot.position.z, d = Math.hypot(dx, dz);
      const seen = (-dx * camDir.x - dz * camDir.z) / d > 0.35;
      if (!seen && d > 4) base.y = THREE.MathUtils.clamp(Math.atan2(dx, dz), -1.3, 1.3);   // the porch is behind him
    },
    update(dt) {
      tilt.update(dt); roll.update(dt); twist.update(dt);
      pivot.rotation.set(base.x + THREE.MathUtils.clamp(tilt.x, -0.5, 0.35), base.y + twist.x, roll.x);
    },
  };
})();

// ============================================================ springs
function Spring(k, d) { this.x = 0; this.v = 0; this.k = k; this.d = d; }
Spring.prototype.update = function (dt, target = 0) {
  const steps = Math.ceil(dt / 0.008), h = dt / steps;
  for (let i = 0; i < steps; i++) { this.v += (-this.k * (this.x - target) - this.d * this.v) * h; this.x += this.v * h; }
  return this.x;
};

// ============================================================ shared GLSL: sun mask through the boarded window
const SUN_GLSL = /* glsl */`
  const vec3 SUN = vec3(${SUN.x.toFixed(3)}, ${SUN.y.toFixed(3)}, ${SUN.z.toFixed(3)});
  const vec4 WINR = vec4(${WIN.x0.toFixed(3)}, ${WIN.x1.toFixed(3)}, ${WIN.y0.toFixed(3)}, ${WIN.y1.toFixed(3)});
  const float WINZ = ${WIN.z.toFixed(3)};
  float sunMask(vec3 P) {
    if (P.z < WINZ || abs(P.x) > 1.5 || P.y < 0.0 || P.y > 3.0) return 0.0;
    float t = (WINZ - SUN.z) / (P.z - SUN.z);
    vec2 w = SUN.xy + (P.xy - SUN.xy) * t;
    if (w.x < WINR.x || w.x > WINR.y || w.y < WINR.z || w.y > WINR.w) return 0.0;
    if (abs(w.x) < 0.028) return 0.0;
    float m = 1.0;
    ${SLATS.map((y) => `m *= smoothstep(${(SLAT_H * 0.5).toFixed(3)}, ${(SLAT_H * 0.5 + 0.012).toFixed(3)}, abs(w.y - ${y.toFixed(3)}));`).join('\n    ')}
    return m;
  }
`;

// ============================================================ dust
const dust = (() => {
  const N = IS_TOUCH ? 1600 : 2800;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    // a third concentrated in the sunlit end of the west corridor, the rest spread round the loop
    let x, z;
    [x, z] = levelPoint();
    pos[i * 3] = x; pos[i * 3 + 1] = R() * 3; pos[i * 3 + 2] = z;
    seed[i] = R();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.5, 0), 40);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 300 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform float uTime; uniform float uScale; attribute float aSeed; varying float vA;
      ${SUN_GLSL}
      void main() {
        vec3 p = position;
        float s = aSeed * 6.2831;
        p.x += sin(uTime * 0.11 + s) * 0.22 + sin(uTime * 0.37 + s * 3.0) * 0.04;
        p.y = mod(p.y + sin(uTime * 0.09 + s * 2.0) * 0.25 - uTime * 0.012 * (0.3 + aSeed), 3.0);
        p.z += cos(uTime * 0.07 + s * 5.0) * 0.3;
        float m = sunMask(p) * 0.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        vA = (0.035 + m * 0.75) * smoothstep(0.15, 0.8, d) * exp(-d * 0.05);
        gl_PointSize = uScale * (0.5 + aSeed) / max(d, 0.1);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.25, 0.0, dot(c, c)) * vA;
        gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * a * 1.4, a);
      }`,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
  mat.userData.points = pts;
  return mat;
})();

// ============================================================ decals, sparks, puffs
const decals = (() => {
  const t = new THREE.CanvasTexture(TX.bulletHoleTexture()); t.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 1 });
  const geo = new THREE.PlaneGeometry(0.1, 0.1);
  const pool = []; let i = 0;
  for (let k = 0; k < 80; k++) { const m = new THREE.Mesh(geo, mat); m.visible = false; m.renderOrder = 2; scene.add(m); pool.push(m); }
  return {
    get count() { return pool.filter((m) => m.visible).length; },
    place(point, normal, attachTo) {
      const d = pool[i++ % pool.length];
      scene.attach(d);
      d.position.copy(point).addScaledVector(normal, 0.002);
      d.lookAt(point.clone().add(normal));
      d.rotateZ(Math.random() * 6.28);
      d.scale.setScalar(0.75 + Math.random() * 0.5);
      d.visible = true;
      if (attachTo) attachTo.attach(d);
    },
  };
})();

const sparks = (() => {
  const N = 260;
  const pos = new Float32Array(N * 6), col = new Float32Array(N * 6);
  const P = Array.from({ length: N }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1 }));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
  lines.frustumCulled = false; scene.add(lines);
  let head = 0, active = 0;
  return {
    burst(point, normal, count, hot = 1) {
      for (let k = 0; k < count; k++) {
        const s = P[head++ % N];
        s.p.copy(point).addScaledVector(normal, 0.01);
        s.v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.6).add(normal).normalize().multiplyScalar(1.5 + Math.random() * 4.5);
        s.max = s.life = (0.15 + Math.random() * 0.35) * hot;
      }
      active = 0.8;
    },
    update(dt) {
      if (active <= 0) return; active -= dt;
      for (let k = 0; k < N; k++) {
        const s = P[k], o = k * 6;
        if (s.life <= 0) { col.fill(0, o, o + 6); continue; }
        s.life -= dt; s.v.y -= 9.8 * dt; s.v.multiplyScalar(1 - 2 * dt); s.p.addScaledVector(s.v, dt);
        if (s.p.y < 0.01) { s.p.y = 0.01; s.v.y *= -0.35; s.v.x *= 0.6; s.v.z *= 0.6; }
        const f = Math.max(0, s.life / s.max);
        pos[o] = s.p.x; pos[o + 1] = s.p.y; pos[o + 2] = s.p.z;
        pos[o + 3] = s.p.x - s.v.x * 0.014; pos[o + 4] = s.p.y - s.v.y * 0.014; pos[o + 5] = s.p.z - s.v.z * 0.014;
        const c = f * f * 6;
        col[o] = c; col[o + 1] = c * 0.62; col[o + 2] = c * 0.25;
        col[o + 3] = c * 0.6; col[o + 4] = c * 0.3; col[o + 5] = c * 0.08;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    },
  };
})();

const puffs = (() => {
  const t = new THREE.CanvasTexture(TX.softDotTexture());
  const pool = Array.from({ length: 10 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, color: 0x6a6052, transparent: true, depthWrite: false, opacity: 0 }));
    s.userData = { life: 0, vel: new THREE.Vector3() }; scene.add(s); return s;
  });
  let i = 0;
  return {
    spawn(p, n, tint = 0x6a6052) {
      const s = pool[i++ % pool.length];
      s.position.copy(p).addScaledVector(n, 0.04); s.userData.life = 1; s.userData.vel.copy(n).multiplyScalar(0.35);
      s.material.color.set(tint);
    },
    update(dt) {
      for (const s of pool) {
        const u = s.userData; if (u.life <= 0) { s.visible = false; continue; }
        s.visible = true; u.life -= dt * 1.4; s.position.addScaledVector(u.vel, dt); u.vel.multiplyScalar(1 - 3 * dt);
        const k = 1 - u.life; s.scale.setScalar(0.06 + k * 0.45); s.material.opacity = Math.max(0, u.life) * 0.55;
      }
    },
  };
})();

// ============================================================ weapon (separate scene, drawn after a depth clear)
const weaponScene = new THREE.Scene();
const weaponCam = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.01, 10);
{
  const pm = new THREE.PMREMGenerator(renderer);
  weaponScene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  weaponScene.environmentIntensity = 0.7;
}
const wHemi = new THREE.HemisphereLight(0xe2be96, 0x4a3a2a, 0.6);     // sunset sky / muddy ground
const wKey = new THREE.DirectionalLight(0xffcf9a, 1.2); wKey.position.set(0.5, 1, 0.6);
const wSun = new THREE.DirectionalLight(0xffb468, 0); wSun.position.set(-0.2, 0.4, -1);
const wMuzzle = new THREE.PointLight(0xffa850, 0, 2, 2);
weaponScene.add(wHemi, wKey, wSun, wMuzzle);

// Box-built pistol. To swap for a GLB: load it with GLTFLoader, scale to ~0.19 m long,
// point the barrel down -Z, and return { root, slide, muzzle, port } with the same roles.
function createPistol() {
  const root = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x3e4043, metalness: 0.6, roughness: 0.4 });
  const poly = new THREE.MeshStandardMaterial({ color: 0x2c2c2e, metalness: 0.05, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 });
  const add = (geo, mat, p, r, parent = root) => { const m = new THREE.Mesh(geo, mat); m.position.set(...p); if (r) m.rotation.set(...r); parent.add(m); return m; };

  const slide = new THREE.Group(); root.add(slide);
  add(box(0.03, 0.032, 0.19), steel, [0, 0.036, -0.02], null, slide);
  add(box(0.024, 0.006, 0.17), steel, [0, 0.054, -0.025], null, slide);              // top chamfer
  for (let i = 0; i < 6; i++) add(box(0.031, 0.026, 0.003), dark, [0, 0.036, 0.045 + i * 0.006], null, slide); // serrations
  add(box(0.006, 0.014, 0.04), dark, [0.0135, 0.044, -0.005], null, slide);           // ejection port
  add(box(0.024, 0.008, 0.006), steel, [0, 0.059, 0.066], null, slide);               // rear sight
  add(box(0.005, 0.008, 0.005), steel, [0, 0.059, -0.105], null, slide);              // front sight
  const dot = new THREE.MeshStandardMaterial({ color: 0x0, emissive: 0x6dff8a, emissiveIntensity: 1.6 });
  add(new THREE.SphereGeometry(0.0016, 6, 4), dot, [0, 0.062, -0.1022], null, slide);
  add(new THREE.SphereGeometry(0.0014, 6, 4), dot, [-0.007, 0.061, 0.0632], null, slide);
  add(new THREE.SphereGeometry(0.0014, 6, 4), dot, [0.007, 0.061, 0.0632], null, slide);

  add(new THREE.CylinderGeometry(0.0072, 0.0072, 0.012, 12), steel, [0, 0.036, -0.112], [Math.PI / 2, 0, 0]);
  add(new THREE.CylinderGeometry(0.0045, 0.0045, 0.013, 10), dark, [0, 0.036, -0.1125], [Math.PI / 2, 0, 0]);
  add(box(0.028, 0.022, 0.175), poly, [0, 0.009, -0.012]);                             // frame / dust cover
  add(box(0.026, 0.008, 0.05), poly, [0, -0.006, -0.07]);                              // rail
  const grip = add(box(0.028, 0.115, 0.046), poly, [0, -0.048, 0.048], [-0.3, 0, 0]);
  for (let i = 0; i < 7; i++) add(box(0.0292, 0.004, 0.03), dark, [0, -0.02 - i * 0.012, 0.045 + i * 0.0038], [-0.3, 0, 0]);
  add(box(0.03, 0.012, 0.05), poly, [0, -0.104, 0.064], [-0.3, 0, 0]);                 // mag base
  add(box(0.006, 0.004, 0.045), poly, [0, -0.022, -0.03]);                              // trigger guard
  add(box(0.006, 0.03, 0.005), poly, [0, -0.008, -0.052]);
  add(box(0.004, 0.018, 0.004), steel, [0, -0.008, -0.022], [0.25, 0, 0]);              // trigger
  void grip;

  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.036, -0.13); root.add(muzzle);
  const port = new THREE.Object3D(); port.position.set(0.02, 0.048, -0.005); root.add(port);
  return { root, slide, muzzle, port };
}

function createHands() {
  const g = new THREE.Group();
  const glove = new THREE.MeshStandardMaterial({ color: 0x3d3326, roughness: 0.8, metalness: 0.0 });
  const knuckle = new THREE.MeshStandardMaterial({ color: 0x33291e, roughness: 0.65 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.95 });
  const cuff = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 });
  const Y = new THREE.Vector3(0, 1, 0);
  const cap = (parent, a, b, r, mat = glove) => {
    a = new THREE.Vector3(...a); b = new THREE.Vector3(...b);
    const d = b.clone().sub(a), L = d.length();
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, L), 4, 10), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(Y, d.normalize());
    parent.add(m); return m;
  };
  const finger = (parent, pts, r, mat = glove) => { for (let i = 0; i < pts.length - 1; i++) cap(parent, pts[i], pts[i + 1], r * (1 - i * 0.06), i === 1 ? knuckle : mat); };

  // Grip space: same transform as the pistol grip, so the grip is an axis-aligned box
  // x ±0.014, y ±0.057, z ±0.023 (front strap at -z). Fingers are placed on its faces.
  const grip = new THREE.Group(); grip.position.set(0, -0.048, 0.048); grip.rotation.x = -0.3; g.add(grip);

  // right (firing) hand: palm on the back strap and right panel, web high under the slide
  cap(grip, [0.006, 0.04, 0.036], [0.008, -0.034, 0.036], 0.0145);
  cap(grip, [0.021, 0.036, 0.016], [0.022, -0.036, 0.018], 0.0105);
  cap(grip, [0.012, 0.05, 0.03], [0.02, 0.046, 0.01], 0.011);
  // middle / ring / pinky wrap the front strap and finish on the left panel
  for (const y of [0.016, -0.007, -0.03]) {
    const k = y < -0.02 ? 0.88 : 1;
    finger(grip, [[0.024, y, 0.004], [0.022, y, -0.029], [-0.01, y - 0.001, -0.031], [-0.022, y - 0.002, -0.012]], 0.0086 * k);
  }

  // left (support) hand: heel of the palm fills the left panel, fingers wrap over the right fingers
  cap(grip, [-0.028, 0.03, 0.014], [-0.03, -0.042, 0.02], 0.0155);
  cap(grip, [-0.03, 0.03, 0.03], [-0.028, -0.036, 0.034], 0.012);
  for (const y of [0.012, -0.006, -0.024, -0.041]) {
    const k = y < -0.035 ? 0.86 : 1;
    finger(grip, [[-0.034, y, -0.006], [-0.03, y, -0.045], [0.012, y - 0.001, -0.048], [0.034, y - 0.002, -0.03]], 0.0087 * k);
  }

  // index finger straight along the frame, last joint curled onto the trigger
  finger(g, [[0.021, -0.006, 0.024], [0.0225, -0.004, -0.006], [0.017, -0.006, -0.02], [0.004, -0.011, -0.024]], 0.0082);
  // right thumb rides the left side of the frame; support thumb points forward beneath it
  finger(g, [[-0.006, -0.002, 0.07], [-0.02, 0.002, 0.04], [-0.021, 0.004, 0.012]], 0.0092);
  finger(g, [[-0.03, -0.03, 0.05], [-0.025, -0.017, 0.02], [-0.022, -0.014, -0.012]], 0.0094);

  // wrists, forearms, sleeves (spread into a V like an extended two-hand grip)
  cap(g, [0.012, -0.05, 0.082], [0.016, -0.08, 0.11], 0.021);
  cap(g, [-0.03, -0.062, 0.07], [-0.038, -0.092, 0.1], 0.022);
  cap(g, [0.016, -0.08, 0.11], [0.2, -0.19, 0.43], 0.025);
  cap(g, [-0.038, -0.092, 0.1], [-0.22, -0.2, 0.42], 0.026);
  cap(g, [0.085, -0.122, 0.235], [0.26, -0.24, 0.6], 0.04, sleeve);
  cap(g, [-0.105, -0.13, 0.225], [-0.28, -0.25, 0.59], 0.041, sleeve);
  cap(g, [0.082, -0.12, 0.228], [0.09, -0.125, 0.24], 0.031, cuff);
  cap(g, [-0.102, -0.128, 0.218], [-0.11, -0.133, 0.23], 0.032, cuff);
  return g;
}

const gun = createPistol();
const rig = new THREE.Group();          // sway / bob / recoil node
rig.add(gun.root, createHands());
weaponScene.add(rig);

const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(TX.flashTexture()), color: new THREE.Color(5, 3.6, 2.2), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
flash.visible = false; gun.muzzle.add(flash);

const casings = Array.from({ length: 5 }, () => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0046, 0.0046, 0.019, 8), new THREE.MeshStandardMaterial({ color: 0xc8962e, metalness: 1, roughness: 0.3 }));
  m.visible = false; m.userData = { v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0 }; weaponScene.add(m); return m;
});

// ============================================================ post-processing
class SceneVolumePass extends Pass {
  constructor() {
    super();
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    this.rt.depthTexture = new THREE.DepthTexture(1, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null },
        uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() }, uTime: { value: 0 }, uStrength: { value: 0.0 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tColor; uniform sampler2D tDepth;
        uniform mat4 uProjInv; uniform mat4 uCamWorld; uniform vec3 uCamPos; uniform float uTime; uniform float uStrength;
        varying vec2 vUv;
        ${SUN_GLSL}
        float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        void main() {
          vec4 col = texture2D(tColor, vUv);
          if (uStrength <= 0.0) { gl_FragColor = col; return; }
          float depth = texture2D(tDepth, vUv).x;
          vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0); v /= v.w;
          vec3 wp = (uCamWorld * v).xyz;
          vec3 rd = wp - uCamPos; float L = length(rd); rd /= L; L = min(L, 44.0);
          const int STEPS = 30;
          float st = L / float(STEPS);
          float j = hash12(gl_FragCoord.xy + fract(uTime * 13.0) * 97.0);
          float acc = 0.0;
          for (int i = 0; i < STEPS; i++) {
            vec3 p = uCamPos + rd * (float(i) + j) * st;
            acc += sunMask(p) * exp(-(p.z - WINZ) * 0.045);
          }
          acc *= st;
          vec3 toL = normalize(SUN - vec3(0.0, 1.5, -24.0));
          float mu = max(dot(rd, toL), 0.0);
          float phase = 0.3 + 0.8 * pow(mu, 6.0) + 0.35 * pow(mu, 60.0);
          // soft-capped so standing in the beam never whites out the frame
          vec3 haze = vec3(1.0, 0.8, 0.52) * (1.0 - exp(-acc * uStrength * phase * 1.6)) * 0.42;
          col.rgb += haze;
          gl_FragColor = col;
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }
  setSize(w, h) { this.rt.setSize(w, h); }
  render(r, writeBuffer) {
    r.setRenderTarget(this.rt); r.clear(); r.render(scene, camera);
    const u = this.material.uniforms;
    u.tColor.value = this.rt.texture; u.tDepth.value = this.rt.depthTexture;
    u.uProjInv.value.copy(camera.projectionMatrixInverse); u.uCamWorld.value.copy(camera.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld); u.uTime.value = clock.elapsedTime;
    r.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.quad.render(r);
  }
}
class WeaponPass extends Pass {
  constructor() { super(); this.needsSwap = false; }
  render(r, writeBuffer, readBuffer) {
    const ac = r.autoClear; r.autoClear = false;
    r.setRenderTarget(readBuffer); r.clearDepth();
    r.render(weaponScene, weaponCam);
    r.autoClear = ac;
  }
}

const BodycamShader = {
  uniforms: {
    tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
    uTear: { value: 0 }, uTearY: { value: 0.5 }, uTearH: { value: 0.03 }, uFlash: { value: 0 }, uK: { value: 0.06 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime, uTear, uTearY, uTearH, uFlash, uK;
    varying vec2 vUv;
    float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    vec2 lens(vec2 p, float k, float aspect) {
      vec2 q = vec2(p.x * aspect, p.y);
      float r2 = dot(q, q);
      // normalise so the screen corners map exactly to the image corners: no stretched edges
      float e = aspect * aspect + 1.0;
      float norm = 1.0 + k * e + k * 0.4 * e * e;
      return p * (1.0 + k * r2 + k * 0.4 * r2 * r2) / norm;
    }
    vec3 tap(vec2 uv, vec2 o) { return texture2D(tDiffuse, uv + o).rgb; }
    void main() {
      vec2 uv = vUv;
      float aspect = uRes.x / uRes.y;
      vec2 p = uv * 2.0 - 1.0;
      vec2 pg = lens(p, uK, aspect);
      float r2 = dot(p * vec2(aspect, 1.0), p * vec2(aspect, 1.0));
      float ca = 0.00025 * r2;         // barely-there colour fringing at the far edges
      vec2 uvR = clamp(lens(p, uK + ca * 2.2, aspect) * 0.5 + 0.5, 0.001, 0.999);
      vec2 uvG = clamp(pg * 0.5 + 0.5, 0.001, 0.999);
      vec2 uvB = clamp(lens(p, uK - ca * 2.2, aspect) * 0.5 + 0.5, 0.001, 0.999);
      // one crisp tap per channel (no horizontal smear)
      vec3 c = vec3(texture2D(tDiffuse, uvR).r, texture2D(tDiffuse, uvG).g, texture2D(tDiffuse, uvB).b);
      // grade: desaturated, warm, lifted blacks, slight crush in highlights
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, 0.85);
      c *= vec3(0.99, 1.0, 1.02);
      c = pow(max(c, 0.0), vec3(1.08));
      c = c * 0.93 + vec3(0.035, 0.036, 0.038);
      c += uFlash * vec3(0.25, 0.18, 0.1);
      // soft vignette: darker edges, but the picture fills the whole screen
      vec2 vq = p * vec2(0.82, 0.95);
      float vig = clamp(1.0 - dot(vq, vq) * 0.5, 0.0, 1.0);
      c *= mix(0.55, 1.0, pow(vig, 1.5));
      // grain (stronger in shadows), animated
      float g = hash(gl_FragCoord.xy + fract(uTime * 7.31) * vec2(311.7, 183.3)) - 0.5;
      float g2 = hash(floor(gl_FragCoord.xy / 2.0) + fract(uTime * 3.7) * 71.0) - 0.5;
      c += (g * 0.75 + g2 * 0.3) * (0.03 + 0.06 * (1.0 - clamp(l * 3.0, 0.0, 1.0)));     // fine grain, not mush
      gl_FragColor = vec4(c, 1.0);
    }`,
};

const composer = new EffectComposer(renderer);
composer.setPixelRatio(PR());
composer.setSize(innerWidth, innerHeight);
const volumePass = new SceneVolumePass();
composer.addPass(volumePass);
composer.addPass(new WeaponPass());
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.42, 0.5, 0.95);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const bodycam = new ShaderPass(BodycamShader);
composer.addPass(bodycam);

// ============================================================ player state
const clock = new THREE.Clock();
const keys = {};
const player = {
  pos: new THREE.Vector3(0, 0, 12), vel: new THREE.Vector3(),
  yaw: 0, pitch: -0.03, phase: 0, stepIdx: 0,
  fy: 0,                                // floor height under you (porch, steps)
};
let zone = 'yard';                      // 'yard' | 'house' | 'cellar'
const kick = new Spring(140, 15), kickYaw = new Spring(120, 14), stepJolt = new Spring(180, 16);
const swayX = new Spring(90, 11), swayY = new Spring(90, 11);
const recoilZ = new Spring(320, 24), recoilP = new Spring(260, 19);
let started = false, locked = false, dragMode = IS_TOUCH, holstered = false, holsterT = 0;
// aim down sights (hold Space): 0 = hip, 1 = fully aimed
let aimT = 0, wasAiming = false;
// low-ready: the pistol rests low out of the way and comes up to aim, fire or reload
let readyT = 0;
const READY_HOLD = 1.4;            // seconds the gun stays up after a shot
const CAM_FOV = 88, AIM_FOV = 46;
let weaponFovBase = 78;
const isAiming = () => started && !holstered && !!keys.Space && game.reloadT <= 0;
let lastShot = -1, flashT = 0, slideT = 1, lookDX = 0, lookDY = 0, runT = 0;
let touchWalk = false;
const audio = new AudioEngine();
const cross = document.getElementById('cross');
const reticleEl = document.getElementById('reticle'), horizonEl = document.getElementById('horizon');
// ------------------------------------------------------------ game state behind the HUD
const MAG_SIZE = 17, SPAWN = LEVEL.spawn;
const game = { hp: 100, mag: MAG_SIZE, reserve: MAG_SIZE * 4, reloadT: 0, wins: 0, losses: 0, volt: 12.48, gb: 31.84 };
function startReload() {
  if (game.reloadT > 0 || game.mag === MAG_SIZE || game.reserve === 0 || holstered) return;
  game.reloadT = 1.6; audio.reload();
}
function damage(n) {
  game.hp -= n;
  hud.hurt(); kick.v += 3.5; kickYaw.v += (Math.random() - 0.5) * 3;
  if (game.hp <= 0) {
    game.losses++;
    hud.banner(false, clock.elapsedTime);
    Object.assign(game, { hp: 100, mag: MAG_SIZE, reserve: MAG_SIZE * 4, reloadT: 0 });
    if (zone !== 'yard') setZone('yard');
    player.pos.set(SPAWN[0], 0, SPAWN[1]); player.vel.set(0, 0, 0); player.yaw = 0; player.pitch = -0.03; player.fy = 0;
  }
}

// ============================================================ input
function look(dx, dy, sens = 0.0021) {
  sens *= 1 - 0.55 * aimT;                       // finer control while aiming
  player.yaw -= dx * sens; player.pitch -= dy * sens;
  player.pitch = THREE.MathUtils.clamp(player.pitch, -1.35, 1.35);
  lookDX += dx; lookDY += dy;
}
function start() {
  if (started) return;
  started = true; audio.init();
  cross.classList.add('on');
}
function requestLock() {
  if (IS_TOUCH || !canvas.requestPointerLock) { dragMode = true; return; }
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => { dragMode = true; });
  } catch { dragMode = true; }
}
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) dragMode = false;
});
document.addEventListener('pointerlockerror', () => { dragMode = true; });

let drag = null;
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (!started) { start(); requestLock(); return; }
  if (locked) { fire(); return; }
  if (!dragMode) { requestLock(); return; }
  drag = { x: e.clientX, y: e.clientY, moved: 0 };
});
addEventListener('mousemove', (e) => {
  if (locked) look(e.movementX, e.movementY);
  else if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
    look(dx, dy, 0.004);
  }
});
addEventListener('mouseup', () => { if (drag && drag.moved < 6) fire(); drag = null; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const touches = new Map();
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (!started) { start(); return; }
  for (const t of e.changedTouches) touches.set(t.identifier, { x: t.clientX, y: t.clientY, t0: performance.now(), moved: 0 });
  touchWalk = touches.size >= 2;
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const s = touches.get(t.identifier); if (!s) continue;
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    s.moved += Math.abs(dx) + Math.abs(dy); s.x = t.clientX; s.y = t.clientY;
    if (touches.size === 1) look(dx, dy, 0.0045);
  }
}, { passive: false });
const touchEnd = (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const s = touches.get(t.identifier);
    if (s && touches.size === 1 && !touchWalk && s.moved < 12 && performance.now() - s.t0 < 260) fire();
    touches.delete(t.identifier);
  }
  if (touches.size === 0) touchWalk = false;
};
canvas.addEventListener('touchend', touchEnd, { passive: false });
canvas.addEventListener('touchcancel', touchEnd, { passive: false });

addEventListener('keydown', (e) => {
  // Enter (or E) next to a door opens it instead of sprinting
  if ((e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'KeyE') && !e.repeat && nearDoor && interact()) { e.preventDefault(); return; }
  keys[e.code] = true;
  if (!started && ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) start();
  if (e.code === 'KeyG' && !e.repeat) { holstered = !holstered; audio.holster(); }
  if (e.code === 'KeyR' && !e.repeat) startReload();
  if (e.code === 'Space') e.preventDefault();      // Space aims; never scroll the page
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// ============================================================ shooting
const raycaster = new THREE.Raycaster(); raycaster.far = 60;
const CENTER = new THREE.Vector2(0, 0);
const tmpN = new THREE.Vector3(), tmpV = new THREE.Vector3();
const nm = new THREE.Matrix3();
function fire() {
  const now = clock.elapsedTime;
  if (holstered || holsterT > 0.3 || now - lastShot < 0.14 || game.reloadT > 0 || trans) return;
  if (game.mag <= 0) {                                   // dry fire: click, then reload automatically
    if (now - lastShot > 0.25) { audio.click(0.5); lastShot = now; }
    startReload();
    return;
  }
  game.mag--;
  lastShot = now;
  audio.gunshot();
  flashT = 0.055; slideT = 0;
  flash.material.rotation = Math.random() * 6.28; flash.scale.setScalar(0.09 + Math.random() * 0.07);
  recoilZ.v += 1.5; recoilP.v += 15 + Math.random() * 4;
  kick.v += 2.6 + Math.random() * 0.8; kickYaw.v += (Math.random() - 0.5) * 1.6;
  bodycam.uniforms.uFlash.value = 1;
  if (Math.random() < 0.35) triggerTear(0.006 + Math.random() * 0.012, 0.07);
  // eject a casing
  const c = casings.find((m) => m.userData.life <= 0) || casings[0];
  gun.port.getWorldPosition(c.position); c.visible = true; c.userData.life = 0.7;
  c.userData.v.set(0.9 + Math.random() * 0.5, 1.1 + Math.random() * 0.5, 0.25 + Math.random() * 0.3);
  c.userData.w.set(Math.random() * 30, Math.random() * 30, Math.random() * 30);

  camera.updateMatrixWorld();
  raycaster.setFromCamera(CENTER, camera);
  const hits = raycaster.intersectObjects(solids, false);
  for (const h of hits) {
    const ud = h.object.userData;
    if (ud.sky) break;
    if (ud.stalker) { if (!stalker.group.visible) continue; stalker.vanish(clock.elapsedTime, true, 'shot'); break; }
    if (ud.alpha && h.uv) {
      const px = Math.min(ud.alpha.w - 1, Math.floor(h.uv.x * ud.alpha.w));
      const py = Math.min(ud.alpha.h - 1, Math.floor((1 - h.uv.y) * ud.alpha.h));
      if (ud.alpha.data[py * ud.alpha.w + px] < 128) continue;   // shot passed through the cut-out's empty space
    }
    nm.getNormalMatrix(h.object.matrixWorld);
    tmpN.copy(h.face.normal).applyMatrix3(nm).normalize();
    if (tmpN.dot(raycaster.ray.direction) > 0) tmpN.negate();
    if (ud.kind !== 'void' && ud.kind !== 'glass') decals.place(h.point, tmpN, ud.character ? character.pivot : null);
    if (ud.character) {
      character.pivot.worldToLocal(tmpV.copy(h.point));
      character.hit(tmpV);
      puffs.spawn(h.point, tmpN, 0xd8cfb8);
      sparks.burst(h.point, tmpN, 4, 0.5);
      audio.impact('paper');
    } else if (ud.kind !== 'void') {
      const metal = ud.kind === 'metal';
      sparks.burst(h.point, tmpN, metal ? 22 : 10, metal ? 1 : 0.7);
      puffs.spawn(h.point, tmpN, ud.kind === 'wood' ? 0x5a4630 : 0x6a6052);
      audio.impact(metal ? 'metal' : ud.kind === 'wood' ? 'wood' : 'hard');
    }
    break;
  }
}

// ============================================================ tears / misc
let tearUntil = 0, nextTear = 3;
// screen glitches are switched off: the picture stays clean
function triggerTear() {}

// attract-mode patrol
const patrol = [[0, 6], [6, 0.5], [3.5, -2.0], [-4, -1.2], [-11, 5.5], [-3, 11], [10, 7], [15, -1]].map(([x, z]) => new THREE.Vector2(x, z));
let patrolIdx = 0;
const angleDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

// ============================================================ doors: walk up, press Enter, cut to black, come out somewhere else
const FRONT = { x: HOUSE.x - 0.2, z: HOUSE.z + HOUSE.D / 2 };
const DOORS = [
  { zone: 'yard', x: FRONT.x, z: FRONT.z, label: 'OPEN DOOR', to: 'house', at: [IN.x - 0.2, IN.z + IN.D / 2 - 0.65], yaw: Math.PI / 2 },
  { zone: 'house', x: IN.x - 0.2, z: IN.z + IN.D / 2, label: 'GO OUTSIDE', to: 'yard', at: [FRONT.x, FRONT.z + 0.95], yaw: Math.PI },
  { zone: 'house', x: IN.x - 0.3, z: IN.z - IN.D / 2, label: 'GO DOWN', to: 'cellar', at: [CEL.x + 3.35, CEL.z + 0.25], yaw: 1.9 },
  { zone: 'cellar', x: CEL.x + 3.5, z: CEL.z - 0.75, label: 'GO UP', to: 'house', at: [IN.x - 0.3, IN.z - IN.D / 2 + 0.75], yaw: Math.PI / 2 },
  // every corridor door opens into its portfolio room, and the room's door leads back to that spot
  ...INTERIOR.rooms.flatMap((r) => [
    { zone: 'house', x: r.outside.x, z: r.outside.z, label: r.label, to: r.zone, at: r.inside.at, yaw: r.inside.yaw },
    { zone: r.zone, x: r.inside.x, z: r.inside.z, label: 'GO BACK', to: 'house', at: r.outside.at, yaw: r.outside.yaw },
  ]),
];
const promptEl = document.getElementById('prompt'), promptLbl = document.getElementById('prompt-lbl'), fadeEl = document.getElementById('fade');
if (IS_TOUCH) document.getElementById('prompt-key').textContent = 'TAP';
let nearDoor = null, trans = null;
const linkRay = new THREE.Raycaster(); linkRay.far = 3.5;
// the porch deck is 0.5 m up; the steps ramp you onto it
function floorAt(x, z) {
  if (zone !== 'yard') return 0;
  const { x: hx, z: hz, W, D, base } = HOUSE, front = hz + D / 2 + 2.3;
  if (x < hx - W / 2 || x > hx + W / 2 || z < hz + D / 2 - 0.5) return 0;
  if (z <= front) return base;
  if (z < front + 0.95 && x > hx - 1.15 && x < hx + 0.75) return base * (1 - (z - front) / 0.95);
  return 0;
}
function setZone(z) {
  zone = z;
  const inside = z !== 'yard';
  sunLight.visible = !inside; sky.visible = !inside;
  scene.background.set(inside ? 0x050505 : 0xc8873e);
  scene.fog.color.set(inside ? 0x0d0b09 : 0xb97c3c); scene.fog.density = z === 'cellar' ? 0.085 : inside ? 0.05 : 0.0105;   // the cellar air is thick
  scene.environmentIntensity = inside ? 0.08 : 0.6;
  // far plane just past the walls of wherever you are, so nothing behind them is ever drawn
  camera.far = z === 'yard' ? 260 : z === 'house' ? 26 : z === 'cellar' ? 14 : 12; camera.updateProjectionMatrix();
  renderer.toneMappingExposure = inside ? 1.2 : 1.0;
  INTERIOR.set(z);
  const Z = ZONES[z] || { x: 0, z: 0 };
  dust.userData.points.position.set(Z.x, 0, Z.z);
  audio.setIndoor(z === 'yard' ? 0 : z === 'cellar' ? 2 : 1);
  stalker.group.visible = false;
}
function goTo(z, at, yaw) {
  setZone(z);
  player.pos.set(at[0], 0, at[1]); player.vel.set(0, 0, 0);
  player.yaw = yaw; player.pitch = -0.03; player.fy = floorAt(at[0], at[1]);
}
function interact() {
  if (!started || trans || !nearDoor) return false;
  if (nearDoor.link) { window.open(nearDoor.link, '_blank', 'noopener'); keys.Enter = keys.NumpadEnter = false; return true; }
  trans = { t0: clock.elapsedTime, door: nearDoor, swapped: false };
  keys.Enter = keys.NumpadEnter = false;
  fadeEl.classList.add('on'); promptEl.classList.remove('show');
  audio.door(nearDoor.to !== 'yard');
  return true;
}
const promptTap = (e) => { e.preventDefault(); e.stopPropagation(); interact(); };
promptEl.addEventListener('touchstart', promptTap, { passive: false });
promptEl.addEventListener('mousedown', promptTap);
function updateDoors(t) {
  if (trans) {
    const e = t - trans.t0;
    if (!trans.swapped && e > 0.6) { trans.swapped = true; const d = trans.door; goTo(d.to, d.at, d.yaw); }
    if (trans.swapped && e > 1.3) fadeEl.classList.remove('on');
    if (e > 1.9) trans = null;
    nearDoor = null;
  } else {
    nearDoor = null;
    if (started) {
      const p = player.pos;
      let best = -Infinity;
      for (const d of DOORS) {
        if (d.zone !== zone) continue;
        const dx = d.x - p.x, dz = d.z - p.z, dist = Math.hypot(dx, dz);
        if (dist > 1.8) continue;
        const facing = (fwd.x * dx + fwd.z * dz) / Math.max(dist, 1e-3);
        const score = facing - dist * 0.3;               // the door you are most squarely in front of
        if ((facing > 0.45 || dist < 0.55) && score > best) { best = score; nearDoor = d; }
      }
      // in a room, looking at a board with a link: Enter opens it
      if (!nearDoor && zone.startsWith('room') && INTERIOR.linkTargets.length) {
        camera.updateMatrixWorld(); linkRay.setFromCamera(CENTER, camera);
        const h = linkRay.intersectObjects(INTERIOR.linkTargets, false)[0];
        if (h) nearDoor = { label: 'OPEN LINK', link: h.object.userData.link };
      }
    }
  }
  if (nearDoor && promptLbl.textContent !== nearDoor.label) promptLbl.textContent = nearDoor.label;
  promptEl.classList.toggle('show', !!nearDoor);
}

// ============================================================ frame loop
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), wish = new THREE.Vector3();
function updatePlayer(dt, t) {
  let f = 0, s = 0, run = false;
  if (started) {
    f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + (touchWalk ? 1 : 0);
    s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    run = !!(keys.ShiftLeft || keys.ShiftRight || keys.Enter || keys.NumpadEnter);   // Shift or Enter sprints
    if (trans) { f = 0; s = 0; run = false; }        // frozen while the screen is black
  } else {
    const target = patrol[patrolIdx];
    const dx = target.x - player.pos.x, dz = target.y - player.pos.z;
    if (Math.hypot(dx, dz) < 0.7) patrolIdx = (patrolIdx + 1) % patrol.length;
    const want = Math.atan2(-dx, -dz) + Math.sin(t * 0.31) * 0.35;
    player.yaw += angleDiff(want, player.yaw) * Math.min(1, dt * 0.9);
    player.pitch += (Math.sin(t * 0.23) * 0.07 - 0.04 - player.pitch) * Math.min(1, dt);
    f = Math.abs(angleDiff(want, player.yaw)) < 0.9 ? 0.75 : 0.15;
  }
  fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  wish.set(0, 0, 0).addScaledVector(fwd, f).addScaledVector(right, s);
  if (wish.lengthSq() > 1) wish.normalize();
  if (aimT > 0.3) run = false;                     // no sprinting while aiming
  const speed = (run && f > 0 ? 3.1 : 1.45) * (1 - 0.4 * aimT);
  wish.multiplyScalar(speed);
  const accel = wish.lengthSq() > 0.01 ? 5.5 : 8;
  player.vel.lerp(wish, Math.min(1, accel * dt));
  player.pos.addScaledVector(player.vel, dt);

  // collisions: yard bounds, solid boxes (house, containers, fences), prop circles
  const rad = 0.32, p = player.pos;
  if (zone === 'yard') {
    p.x = THREE.MathUtils.clamp(p.x, -LEVEL.bounds, LEVEL.bounds);
    p.z = THREE.MathUtils.clamp(p.z, -LEVEL.bounds, LEVEL.bounds);
  } else {
    const Z = ZONES[zone];
    p.x = THREE.MathUtils.clamp(p.x, Z.x - Z.W / 2 + rad, Z.x + Z.W / 2 - rad);
    p.z = THREE.MathUtils.clamp(p.z, Z.z - Z.D / 2 + rad, Z.z + Z.D / 2 - rad);
  }
  for (const b of boxes) {
    const bx0 = b.x0 - rad, bx1 = b.x1 + rad, bz0 = b.z0 - rad, bz1 = b.z1 + rad;
    if (p.x > bx0 && p.x < bx1 && p.z > bz0 && p.z < bz1) {
      const pen = [p.x - bx0, bx1 - p.x, p.z - bz0, bz1 - p.z];
      const k = pen.indexOf(Math.min(...pen));
      if (k === 0) p.x = bx0; else if (k === 1) p.x = bx1; else if (k === 2) p.z = bz0; else p.z = bz1;
    }
  }
  for (const o of obstacles) {
    const dx = player.pos.x - o.x, dz = player.pos.z - o.z, d = Math.hypot(dx, dz), min = o.r + rad;
    if (d < min && d > 1e-4) { player.pos.x = o.x + (dx / d) * min; player.pos.z = o.z + (dz / d) * min; }
  }

  player.fy += (floorAt(p.x, p.z) - player.fy) * Math.min(1, dt * 12);
  const v = Math.hypot(player.vel.x, player.vel.z);
  runT += ((run && v > 2 ? 1 : 0) - runT) * Math.min(1, dt * 6);
  const stride = THREE.MathUtils.lerp(0.72, 0.95, runT);
  player.phase += (v * dt * Math.PI) / stride;
  const idx = Math.floor(player.phase / Math.PI);
  if (idx !== player.stepIdx) {
    player.stepIdx = idx;
    if (v > 0.35) { audio.footstep(THREE.MathUtils.clamp(v / 2.2, 0.3, 1.1)); stepJolt.v -= 0.12 + runT * 0.25; }
  }
  return v;
}

function updateCamera(dt, t, v) {
  const amp = THREE.MathUtils.smoothstep(v, 0.05, 1.4) * (1 + runT * 0.9) * (1 - 0.65 * aimT);
  const ph = player.phase;
  const bobY = (Math.abs(Math.sin(ph)) - 0.5) * 0.048 * amp;
  const bobX = Math.sin(ph) * 0.026 * amp;
  const rollB = Math.sin(ph) * 0.016 * amp;
  const yawB = Math.sin(ph) * 0.008 * amp;
  const pitchB = (Math.abs(Math.cos(ph)) - 0.5) * 0.012 * amp;
  const hs = (1 + runT * 1.8 + amp * 0.4) * (1 - 0.45 * aimT);
  const shY = (Math.sin(t * 1.27) + 0.6 * Math.sin(t * 2.83 + 1.3) + 0.25 * Math.sin(t * 7.1 + 2.1) + 0.1 * Math.sin(t * 17.3)) * 0.0028 * hs;
  const shP = (Math.sin(t * 1.61 + 0.7) + 0.5 * Math.sin(t * 3.37 + 2.4) + 0.25 * Math.sin(t * 8.3) + 0.1 * Math.sin(t * 19.1 + 1)) * 0.0024 * hs;
  const shR = (Math.sin(t * 0.93 + 2.0) + 0.5 * Math.sin(t * 2.41)) * 0.004 * hs;
  kick.update(dt); kickYaw.update(dt); stepJolt.update(dt);

  camera.position.set(
    player.pos.x + right.x * bobX + Math.sin(t * 0.7) * 0.004,
    player.fy + EYE + bobY + stepJolt.x * 0.1 + Math.sin(t * 0.53) * 0.004,
    player.pos.z + right.z * bobX,
  );
  camera.rotation.set(player.pitch + pitchB + shP + kick.x * 0.06, player.yaw + yawB + shY + kickYaw.x * 0.03, rollB + shR + kickYaw.x * 0.01);
}

function updateWeapon(dt, t, v) {
  holsterT += ((holstered ? 1 : 0) - holsterT) * Math.min(1, dt * 5);
  let rl = 0;                                            // reload: dip and tilt the pistol
  if (game.reloadT > 0) {
    game.reloadT -= dt;
    rl = Math.sin(Math.min(1, Math.max(0, 1 - game.reloadT / 1.6)) * Math.PI);
    if (game.reloadT <= 0) { const take = Math.min(MAG_SIZE - game.mag, game.reserve); game.mag += take; game.reserve -= take; game.reloadT = 0; }
  }
  swayX.update(dt, THREE.MathUtils.clamp(-lookDX * 0.0006, -0.05, 0.05));
  swayY.update(dt, THREE.MathUtils.clamp(lookDY * 0.0006, -0.05, 0.05));
  lookDX = 0; lookDY = 0;
  recoilZ.update(dt); recoilP.update(dt);
  // aim down sights: raise the pistol so the sights line up with the centre, and zoom in
  const aiming = isAiming();
  if (aiming && !wasAiming) audio.click(0.6);
  wasAiming = aiming;
  cross.classList.toggle('aim', aimT > 0.5);           // the sights replace the centre dot
  // the big reticle circle and horizon lines only appear while aiming (Space)
  reticleEl.classList.toggle('on', aimT > 0.05);
  horizonEl.classList.toggle('on', aimT > 0.05);
  aimT += ((aiming ? 1 : 0) - aimT) * Math.min(1, dt * 9);
  const A = aimT, H = 1 - aimT;
  const wantUp = aiming || clock.elapsedTime - lastShot < READY_HOLD || game.reloadT > 0;
  readyT += ((wantUp ? 1 : 0) - readyT) * Math.min(1, dt * (wantUp ? 14 : 3.5));   // snaps up, settles down slowly
  const low = 1 - readyT;
  camera.fov = THREE.MathUtils.lerp(CAM_FOV, AIM_FOV, A); camera.updateProjectionMatrix();
  weaponCam.fov = THREE.MathUtils.lerp(weaponFovBase, weaponFovBase * 0.9, A); weaponCam.updateProjectionMatrix();
  bodycam.uniforms.uK.value = THREE.MathUtils.lerp(0.06, 0.035, A);
  dust.uniforms.uScale.value = 0.0065 * (innerHeight * PR()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  const amp = THREE.MathUtils.smoothstep(v, 0.05, 1.4) * (1 + runT * 0.8) * (1 - 0.7 * A);
  const ph = player.phase;
  const breath = Math.sin(t * 1.4) * 0.0025 * (1 - 0.5 * A);
  const sw = 1 - 0.6 * A;
  rig.position.set(
    0.05 * H + swayX.x * 0.6 * sw + Math.sin(ph) * 0.012 * amp + runT * 0.05,
    THREE.MathUtils.lerp(-0.085, -0.0655, A) + swayY.x * 0.5 * sw - Math.abs(Math.cos(ph)) * 0.01 * amp + breath - holsterT * 0.42 - runT * 0.05 - rl * 0.09 - low * 0.26,
    THREE.MathUtils.lerp(-0.4, -0.46, A) + recoilZ.x * 0.05 + holsterT * 0.08 + low * 0.06,
  );
  rig.rotation.set(
    0.05 * H + recoilP.x * 0.012 + swayY.x * 1.4 * sw - holsterT * 0.9 - runT * 0.42 - rl * 0.55 - low * 0.75 + Math.sin(ph * 2) * 0.008 * amp,
    swayX.x * 2.2 * sw + 0.11 * H,
    swayX.x * 1.5 * sw + Math.sin(ph) * 0.02 * amp + runT * 0.3 - 0.06 * H + rl * 0.5,
  );
  // slide blowback
  slideT += dt;
  const sl = slideT < 0.025 ? slideT / 0.025 : Math.max(0, 1 - (slideT - 0.025) / 0.06);
  gun.slide.position.z = sl * 0.032;
  // muzzle flash
  flashT -= dt;
  flash.visible = flashT > 0;
  const fl = Math.max(0, flashT / 0.055);
  wMuzzle.intensity = fl * 3.5;
  wMuzzle.position.set(rig.position.x, rig.position.y + 0.04, rig.position.z - 0.15);
  camera.getWorldDirection(tmpV);
  muzzleLight.position.copy(camera.position).addScaledVector(tmpV, 0.55).y -= 0.12;
  muzzleLight.intensity = fl * 30;
  bodycam.uniforms.uFlash.value *= Math.exp(-dt * 30);
  // casings
  for (const c of casings) {
    const u = c.userData; if (u.life <= 0) { c.visible = false; continue; }
    u.life -= dt; u.v.y -= 9.8 * dt; c.position.addScaledVector(u.v, dt);
    c.rotation.x += u.w.x * dt; c.rotation.y += u.w.y * dt; c.rotation.z += u.w.z * dt;
  }
}

// flicker + local brightness estimation for the weapon lighting
let blackoutUntil = 0;
function updateLights(dt, t) {
  // when the figure vanishes the daylight dips for a moment, like a cloud passing fast
  const k = t < blackoutUntil ? 0.3 : 1;
  sunLight.intensity += (1.6 * k - sunLight.intensity) * Math.min(1, dt * 20);
  // indoors only a little grey daylight gets past the windows
  const amb = zone === 'yard' ? 1.3 : zone === 'cellar' ? 0.08 : 0.3;
  hemi.intensity += (amb * k - hemi.intensity) * Math.min(1, dt * 20);
  // the gun and gloves sit in the same light as the room around them
  const wl = zone === 'yard' ? 1 : zone === 'cellar' ? 0.22 : 0.34;
  wHemi.intensity = 2.6 * k * wl; wKey.intensity = 2.2 * k * wl; wSun.intensity = zone === 'yard' ? 0.6 * k : 0;
  return INTERIOR.update(t, zone, camera.position);
}

// ============================================================ the thing at the end of the hall
const stalker = (() => {
  const group = new THREE.Group(); group.visible = false; scene.add(group);
  const mat = new THREE.MeshBasicMaterial({ color: 0x010101, fog: false });
  const Y = new THREE.Vector3(0, 1, 0);
  const limb = (a, b, r) => {
    a = new THREE.Vector3(...a); b = new THREE.Vector3(...b);
    const d = b.clone().sub(a);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, d.length(), 3, 8), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(Y, d.normalize());
    m.userData = { stalker: true, kind: 'void' }; group.add(m); solids.push(m); return m;
  };
  limb([0, 0.95, 0], [0, 1.5, 0.02], 0.17);            // torso
  limb([-0.08, 0.1, 0], [-0.07, 0.9, 0], 0.07);        // legs
  limb([0.08, 0.1, 0], [0.07, 0.9, 0], 0.07);
  limb([-0.21, 1.52, 0], [-0.27, 0.62, 0.04], 0.045);  // too-long arms
  limb([0.21, 1.52, 0], [0.26, 0.6, 0.03], 0.045);
  limb([-0.2, 1.55, 0], [0.2, 1.55, 0], 0.07);         // shoulders
  const head = limb([0.02, 1.74, 0.03], [0.04, 1.82, 0.05], 0.11);
  head.rotation.z += 0.35;                             // head cocked to one side
  const spots = Array.from({ length: 18 }, (_, i) => { const a = (i / 18) * Math.PI * 2; return [Math.cos(a) * 21, Math.sin(a) * 21]; })
    .filter(([x, z]) => !boxes.some((b) => x > b.x0 - 1 && x < b.x1 + 1 && z > b.z0 - 1 && z < b.z1 + 1));
  const los = new THREE.Raycaster(), from = new THREE.Vector3(), to = new THREE.Vector3(), fwdV = new THREE.Vector3();
  const visibleFrom = (camPos, x, z) => {
    to.set(x, 1.4, z); from.copy(camPos);
    const dir = to.clone().sub(from), dist = dir.length(); dir.normalize();
    camera.getWorldDirection(fwdV);
    if (dir.dot(fwdV) < 0.75) return false;                    // must be roughly where you're looking
    los.set(from, dir); los.far = dist - 0.6;
    return los.intersectObjects(solids, false).every((h) => h.object.userData.stalker || h.object.userData.character);
  };
  let until = 0, next = 22 + Math.random() * 20;
  return {
    group,
    update(t, camPos) {
      if (!started || zone !== 'yard') return;
      if (group.visible) {
        const d = Math.hypot(camPos.x - group.position.x, camPos.z - group.position.z);
        if (d < 9) this.vanish(t, true, 'caught'); else if (t > until) this.vanish(t, false, 'timeout');
        return;
      }
      if (t < next) return;
      const options = spots.filter(([x, z]) => { const d = Math.hypot(camPos.x - x, camPos.z - z); return d > 10 && d < 34 && visibleFrom(camPos, x, z); });
      if (!options.length) { next = t + 1.5; return; }
      const [x, z] = options[Math.floor(Math.random() * options.length)];
      group.position.set(x, 0, z);
      group.rotation.y = Math.atan2(camPos.x - x, camPos.z - z);
      group.visible = true; until = t + 3 + Math.random() * 5;
    },
    summon() { next = 0; },
    vanish(t, loud, reason = 'timeout') {
      group.visible = false;
      if (reason === 'shot') { game.wins++; hud.banner(true, t); }
      if (reason === 'caught') damage(34);
      blackoutUntil = t + 0.2 + Math.random() * 0.25;
      if (loud) audio.sting(); else audio.distantThud();
      triggerTear(0.02, 0.15);
      next = t + 35 + Math.random() * 40;
    },
  };
})();

// ============================================================ tactical HUD (DOM overlay, updated per frame)
const hud = (() => {
  const $ = (id) => document.getElementById(id);
  const el = { hp: $('hp'), mag: $('mag'), reserve: $('reserve'), ammo: $('ammo'), volt: $('volt'), gb: $('gb'), hdg: $('hdgv'), dist: $('dist'), stab: $('stab'), date: $('date'), horizon: $('horizon'), reticle: $('reticle'), banner: $('banner'), bTitle: $('banner-title'), bScore: $('banner-score'), hurt: $('hurt') };
  const set = (e, v) => { if (e && e.textContent !== v) e.textContent = v; };
  const tog = (e, c, on) => { if (e) e.classList.toggle(c, on); };
  const p2 = (n) => String(n).padStart(2, '0');
  const ray = new THREE.Raycaster(); ray.far = 80;
  let bannerUntil = 0, n = 0, distTxt = '--m';
  return {
    banner(won, t) {
      el.bTitle.textContent = won ? 'ROUND WON' : 'ROUND LOST';
      el.bScore.textContent = `${game.wins} : ${game.losses}`;
      el.banner.className = `${won ? 'won' : 'lost'} show`;
      bannerUntil = t + 3.2;
    },
    hurt() {
      el.hurt.style.transition = 'none'; el.hurt.style.opacity = '0.9';
      requestAnimationFrame(() => requestAnimationFrame(() => { el.hurt.style.transition = 'opacity 1.4s ease-out'; el.hurt.style.opacity = '0'; }));
    },
    get distance() { return distTxt; },
    update(t, dt) {
      set(el.hp, String(Math.max(0, Math.round(game.hp))));
      tog(el.hp, 'low', game.hp <= 34);
      set(el.mag, String(game.mag)); set(el.reserve, String(game.reserve));
      tog(el.ammo, 'low', game.mag <= 4);
      tog(el.ammo, 'reloading', game.reloadT > 0);
      if (started) { game.volt = Math.max(10.8, game.volt - dt * 0.0016); game.gb = Math.max(0, game.gb - dt * 0.0021); }
      set(el.volt, game.volt.toFixed(2)); set(el.gb, game.gb.toFixed(2));
      // compass heading: 0 = north (+z), 90 = east (+x)
      const hd = (Math.round(THREE.MathUtils.radToDeg(Math.atan2(-Math.sin(player.yaw), -Math.cos(player.yaw)))) + 360) % 360;
      set(el.hdg, String(hd).padStart(3, '0'));
      // range finder: what is under the reticle (every few frames)
      // (the range readout is gone from the screen, so no per-frame raycast against the whole scene)
      tog(el.stab, 'on', aimT > 0.5 || Math.hypot(player.vel.x, player.vel.z) < 0.25);
      const d = new Date();
      set(el.date, `${d.getUTCFullYear()}:${p2(d.getUTCMonth() + 1)}:${p2(d.getUTCDate())}`);
      // artificial horizon follows camera pitch and roll; reticle tightens when aiming
      const pxPerRad = innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      el.horizon.style.transform = `translateY(${(camera.rotation.x * pxPerRad).toFixed(1)}px) rotate(${THREE.MathUtils.radToDeg(camera.rotation.z).toFixed(2)}deg)`;
      el.reticle.style.transform = `translate(-50%, -50%) scale(${(1 - 0.38 * aimT).toFixed(3)})`;
      if (bannerUntil && t > bannerUntil) { el.banner.classList.remove('show'); bannerUntil = 0; }
    },
  };
})();

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  weaponCam.aspect = w / h;
  weaponFovBase = w / h < 1 ? 92 : 78;
  weaponCam.fov = weaponFovBase;
  weaponCam.updateProjectionMatrix();
  bodycam.uniforms.uRes.value.set(w * PR(), h * PR());
  const projScale = (h * PR()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  dust.uniforms.uScale.value = 0.0065 * projScale;
}
addEventListener('resize', resize);
resize();

// ---- smoothness
// Shadows: the sun's shadow map is re-rendered every other frame (the yard barely moves).
renderer.shadowMap.autoUpdate = false;
let frameNo = 0;
// Adaptive resolution: if frames stay slow for a couple of seconds, render fewer pixels.
// It only ever steps down (never up and down), so there is no resolution "pumping".
let slowFor = 0, settleUntil = 0;
function adaptResolution(rawDt, t) {
  if (trans || t < settleUntil || !document.hasFocus()) { slowFor = 0; return; }
  slowFor = rawDt > 1 / 38 ? slowFor + rawDt : Math.max(0, slowFor - rawDt);
  if (slowFor > 3 && resScale > 0.75) {
    resScale = Math.max(0.75, +(resScale - 0.125).toFixed(3));
    renderer.setPixelRatio(PR()); composer.setPixelRatio(PR()); resize();
    slowFor = 0; settleUntil = t + 3;
  }
}
// Warm-up: compile every shader and upload every texture for the yard, house, cellar and rooms
// before the first frame, so walking through a door never stalls on a shader compile.
function warmUp() {
  const seen = new Set(), hidden = [];
  const KEYS = ['map', 'normalMap', 'roughnessMap', 'emissiveMap', 'alphaMap', 'bumpMap'];
  const upload = (root) => root.traverse((o) => {
    if (!o.isLight && !o.visible) { hidden.push(o); o.visible = true; }       // pooled effects (flash, decals, the figure)
    for (const m of o.material ? [].concat(o.material) : []) for (const k of KEYS) if (m[k] && !seen.has(m[k])) { seen.add(m[k]); renderer.initTexture(m[k]); }
  });
  upload(scene); upload(weaponScene);
  const save = { pos: player.pos.clone(), yaw: player.yaw, pitch: player.pitch };
  const room = INTERIOR.rooms[0];
  const views = [['house', [IN.x - 0.2, IN.z + IN.D / 2 - 0.65], Math.PI / 2], ['cellar', [CEL.x + 3.35, CEL.z + 0.25], 1.9]];
  if (room) views.push([room.zone, room.inside.at, 0]);
  views.push(['yard', [save.pos.x, save.pos.z], save.yaw]);
  for (const [z, at, yaw] of views) {
    goTo(z, at, yaw);
    updateCamera(0, 0, 0); camera.updateMatrixWorld();
    renderer.compile(scene, camera); renderer.compile(weaponScene, weaponCam);
    renderer.shadowMap.needsUpdate = true;
    composer.render(0);                                                         // also builds shadow + post-processing programs
  }
  for (const o of hidden) o.visible = false;
  player.pos.copy(save.pos); player.yaw = save.yaw; player.pitch = save.pitch;
}
try { warmUp(); } catch (e) { console.warn('warm-up skipped', e); }

let nextAmbient = 10, lastMoving = 0;
function frame() {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 1 / 20);
  const t = clock.elapsedTime;
  adaptResolution(rawDt, t);
  if ((frameNo++ & 1) === 0 || zone !== 'yard' || trans) renderer.shadowMap.needsUpdate = true;
  const v = updatePlayer(dt, t);
  updateCamera(dt, t, v);
  updateDoors(t);
  updateWeapon(dt, t, v);
  const L = updateLights(dt, t);
  audio.update(L.hum, L.buzz, THREE.MathUtils.clamp(v / 2.5, 0, 1));
  character.update(dt);
  camera.getWorldDirection(tmpV);
  character.creep(camera.position, tmpV);
  stalker.update(t, camera.position);
  if (started) {
    if (t > nextAmbient) { audio.ambientEvent(); nextAmbient = t + 7 + Math.random() * 14; }
    if (v > 0.6) lastMoving = t;
    else if (v < 0.08 && lastMoving > 0 && t - lastMoving < 0.4) { lastMoving = 0; if (Math.random() < 0.18) audio.ghostSteps(2 + Math.floor(Math.random() * 2)); }
  }
  sparks.update(dt);
  puffs.update(dt);
  dust.uniforms.uTime.value = t;
  sky.position.copy(camera.position); skyMat.uniforms.uTime.value = t;
  EXTRA.update(t);

  const u = bodycam.uniforms;
  u.uTime.value = t;
  if (t > tearUntil) u.uTear.value = 0;

  hud.update(t, dt);
  composer.render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// debug hook for automated testing
// test / debug hook (read-mostly; used by tests/ui.spec.js)
window.__bodycam = {
  fire, player, start, stalker, game, damage, camera, rig, weaponScene, weaponCam, renderer, composer, THREE, character, LEVEL, boxes, HOUSE,
  DOORS, IN, CEL, LOOP, ZONES, PORTFOLIO, interact, goTo, setZone, INTERIOR,
  get started() { return started; },
  get zone() { return zone; },
  state() {
    return {
      started, holstered, locked, dragMode, aim: aimT, fov: camera.fov,
      decals: decals.count,
      pos: [player.pos.x, player.pos.z], yaw: player.yaw, pitch: player.pitch,
      speed: Math.hypot(player.vel.x, player.vel.z),
      charRot: [character.pivot.rotation.x, character.pivot.rotation.y, character.pivot.rotation.z],
      audio: audio.ctx ? audio.ctx.state : 'none',
      stalker: stalker.group.visible,
      zone, fy: player.fy, res: resScale, door: nearDoor ? nearDoor.label : null, fading: !!trans,
      ready: readyT, hp: game.hp, mag: game.mag, reserve: game.reserve, reloading: game.reloadT > 0, wins: game.wins, losses: game.losses, dist: hud.distance,
    };
  },
};
