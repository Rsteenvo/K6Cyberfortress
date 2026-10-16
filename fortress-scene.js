/**
 * k6 Sparta // Total War — 3D Ancient Siege & Medieval Fortress Visualizer
 * Features:
 *  - Dynamic 1..16 3D "Load Agent" Siege Legion Camps & Stone Causeway Lanes based on actual runners used
 *  - 1,100+ 3D Ancient Spartan/Roman Soldiers (crested helmet, bronze hoplon shield, crimson cloak, spear)
 *    marching in phalanx formation along each Load Agent lane into the Medieval Fortress gates
 *  - Central SUT Medieval Stone Fortress with crenellated curtain walls, 8 watchtowers, inner Keep,
 *    and flaming war braziers that intensify from Bronze/Gold -> Fiery Orange -> Crimson Inferno
 *  - Real-time LIVE VIEW mode & End-of-Test Battle Scroll Summary rendered onto the 1080p canvas
 */

import * as THREE from 'https://esm.sh/three@0.169.0';
import { EffectComposer } from 'https://esm.sh/three@0.169.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://esm.sh/three@0.169.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://esm.sh/three@0.169.0/examples/jsm/postprocessing/UnrealBloomPass.js';
import { computeThermalState } from './demo-data.js';

const MAX_HIGHWAY_BOTS = 140;
const MAX_CAVALRY_BOTS = 48;
const MAX_QUEUE_BOTS = 70;
const MAX_CASTLE_ARROWS = 80;
const MAX_CATAPULT_BOULDERS = 18;
const MAX_THERMAL_PARTICLES = 320;
const LOAD_AGENT_RADIUS = 82;

/**
 * Converts a 2D heightmap canvas into a true RGB Tangent-Space Normal Map CanvasTexture
 * via Sobel horizontal/vertical gradients so stone masonry joints and terrain ruts catch
 * razor-sharp directional sunlight and torchlight.
 */
function heightCanvasToNormalTexture(heightCanvas, strength = 3.2, repeatX = 2, repeatY = 2) {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const srcCtx = heightCanvas.getContext('2d');
  const srcData = srcCtx.getImageData(0, 0, w, h).data;

  const normCanvas = document.createElement('canvas');
  normCanvas.width = w;
  normCanvas.height = h;
  const nCtx = normCanvas.getContext('2d');
  const outImg = nCtx.createImageData(w, h);
  const dst = outImg.data;

  const sample = (x, y) => {
    const wx = (x + w) % w;
    const wy = (y + h) % h;
    return srcData[(wy * w + wx) * 4] / 255.0;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dX = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
      const dY = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);

      let nx = -dX * strength;
      let ny = -dY * strength;
      let nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1.0;
      nx /= len;
      ny /= len;
      nz /= len;

      const idx = (y * w + x) * 4;
      dst[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      dst[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      dst[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      dst[idx + 3] = 255;
    }
  }

  nCtx.putImageData(outImg, 0, 0);
  const normalMap = new THREE.CanvasTexture(normCanvas);
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(repeatX, repeatY);
  normalMap.anisotropy = 4;
  return normalMap;
}

/**
 * Generates photorealistic Ashlar Cut-Stone Masonry Diffuse, Tangent-Space Normal, and Roughness Maps
 * with deep recessed mortar joints, beveled stone blocks, micro-pitting, moss, and rainwater streaks.
 */
function createStoneMasonryTextures() {
  const w = 512;
  const h = 512;
  const diffCanvas = document.createElement('canvas');
  diffCanvas.width = w;
  diffCanvas.height = h;
  const dCtx = diffCanvas.getContext('2d');

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = w;
  heightCanvas.height = h;
  const hCtx = heightCanvas.getContext('2d');

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = w;
  roughCanvas.height = h;
  const rCtx = roughCanvas.getContext('2d');

  // Deep recessed mortar bed
  dCtx.fillStyle = '#191715';
  dCtx.fillRect(0, 0, w, h);
  hCtx.fillStyle = '#101010';
  hCtx.fillRect(0, 0, w, h);
  rCtx.fillStyle = '#f2f2f2'; // Mortar is very rough
  rCtx.fillRect(0, 0, w, h);

  const rows = 12;
  const cols = 6;
  const rowH = h / rows;
  const colW = w / cols;

  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let r = 0; r < rows; r++) {
    const stagger = (r % 2) * (colW * 0.5);
    for (let c = -1; c <= cols; c++) {
      const x = c * colW + stagger + (rand() - 0.5) * 3.0;
      const y = r * rowH + (rand() - 0.5) * 1.5;
      const bw = colW - 4.5 + (rand() - 0.5) * 3.0;
      const bh = rowH - 4.0 + (rand() - 0.5) * 1.5;

      // Photorealistic quarried limestone / sandstone tones
      const baseL = 82 + Math.floor(rand() * 34);
      const warmR = baseL + 6 + Math.floor((rand() - 0.35) * 12);
      const warmG = baseL + 2 + Math.floor((rand() - 0.45) * 10);
      const warmB = baseL - 5 + Math.floor((rand() - 0.5) * 12);

      dCtx.fillStyle = `rgb(${warmR}, ${warmG}, ${warmB})`;
      dCtx.fillRect(x, y, bw, bh);

      // Outer beveled stone edge & raised inner block face on height map
      const hVal = 175 + Math.floor(rand() * 65);
      hCtx.fillStyle = `rgb(${Math.round(hVal * 0.65)}, ${Math.round(hVal * 0.65)}, ${Math.round(hVal * 0.65)})`;
      hCtx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      hCtx.fillStyle = `rgb(${hVal}, ${hVal}, ${hVal})`;
      hCtx.fillRect(x + 4, y + 4, Math.max(2, bw - 8), Math.max(2, bh - 8));

      // Per-block roughness variation (some stones slightly damp/polished, others rough)
      const rVal = 155 + Math.floor(rand() * 75);
      rCtx.fillStyle = `rgb(${rVal}, ${rVal}, ${rVal})`;
      rCtx.fillRect(x + 1, y + 1, bw - 2, bh - 2);

      // Chisel & pitting micro-grain inside each stone block
      for (let p = 0; p < 34; p++) {
        const px = x + 3 + rand() * Math.max(2, bw - 6);
        const py = y + 3 + rand() * Math.max(2, bh - 6);
        const pw = 2 + rand() * 8;
        const ph = 2 + rand() * 5;
        const delta = (rand() - 0.5) * 28;
        const pr = Math.max(25, Math.min(155, warmR + delta));
        const pg = Math.max(25, Math.min(155, warmG + delta));
        const pb = Math.max(25, Math.min(155, warmB + delta));
        dCtx.fillStyle = `rgba(${pr}, ${pg}, ${pb}, 0.58)`;
        dCtx.fillRect(px, py, pw, ph);

        const hGrain = Math.max(55, Math.min(252, hVal + delta * 2.1));
        hCtx.fillStyle = `rgba(${hGrain}, ${hGrain}, ${hGrain}, 0.72)`;
        hCtx.fillRect(px, py, pw, ph);
      }
    }
  }

  // Vertical rainwater / soot / moss weathering streaks down the castle walls
  for (let s = 0; s < 42; s++) {
    const sx = rand() * w;
    const sy = rand() * h * 0.5;
    const sw = 6 + rand() * 18;
    const sh = 65 + rand() * 190;
    const grad = dCtx.createLinearGradient(sx, sy, sx, sy + sh);
    grad.addColorStop(0, 'rgba(16, 15, 12, 0.42)');
    grad.addColorStop(1, 'rgba(16, 15, 12, 0.0)');
    dCtx.fillStyle = grad;
    dCtx.fillRect(sx, sy, sw, sh);

    // Damp streaks are smoother (lower roughness = wet specular sheen)
    const rGrad = rCtx.createLinearGradient(sx, sy, sx, sy + sh);
    rGrad.addColorStop(0, 'rgba(85, 85, 85, 0.45)');
    rGrad.addColorStop(1, 'rgba(180, 180, 180, 0.0)');
    rCtx.fillStyle = rGrad;
    rCtx.fillRect(sx, sy, sw, sh);
  }

  const map = new THREE.CanvasTexture(diffCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2, 2);
  map.anisotropy = 4;

  const bumpMap = new THREE.CanvasTexture(heightCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(2, 2);
  bumpMap.anisotropy = 4;

  const normalMap = heightCanvasToNormalTexture(heightCanvas, 3.8, 2, 2);

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(2, 2);
  roughnessMap.anisotropy = 4;

  return { map, bumpMap, normalMap, roughnessMap };
}

/**
 * Generates photorealistic muddy, rain-slicked medieval battlefield terrain textures
 * (Diffuse, Normal Map, Roughness Map with wet mud puddles that reflect firelight).
 */
function createBattlefieldTerrainTextures() {
  const size = 512;
  const diffCanvas = document.createElement('canvas');
  diffCanvas.width = size;
  diffCanvas.height = size;
  const ctx = diffCanvas.getContext('2d');

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const hCtx = heightCanvas.getContext('2d');

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d');

  ctx.fillStyle = '#241f19';
  ctx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#787878';
  hCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#d8d8d8';
  rCtx.fillRect(0, 0, size, size);

  let seed = 4201;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  // Organic earth, wet mud puddles, scorched ash & battlefield turf
  for (let i = 0; i < 1800; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const rad = 3 + rand() * 24;
    const tone = rand();
    let r = 34;
    let g = 30;
    let b = 24;
    let roughVal = 215;
    if (tone < 0.30) {
      // Wet dark mud puddle (low roughness -> reflects torches & sky!)
      r = 22 + Math.floor(rand() * 10);
      g = 19 + Math.floor(rand() * 8);
      b = 15 + Math.floor(rand() * 7);
      roughVal = 55 + Math.floor(rand() * 45);
    } else if (tone < 0.68) {
      // Weathered stony dirt
      r = 44 + Math.floor(rand() * 16);
      g = 39 + Math.floor(rand() * 14);
      b = 32 + Math.floor(rand() * 12);
      roughVal = 200 + Math.floor(rand() * 45);
    } else {
      // Desaturated olive-brown heath grass
      r = 32 + Math.floor(rand() * 12);
      g = 36 + Math.floor(rand() * 14);
      b = 23 + Math.floor(rand() * 9);
      roughVal = 225;
    }
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.32)`;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();

    rCtx.fillStyle = `rgba(${roughVal}, ${roughVal}, ${roughVal}, 0.38)`;
    rCtx.beginPath();
    rCtx.arc(x, y, rad, 0, Math.PI * 2);
    rCtx.fill();

    const hVal = 75 + Math.floor((rand() - 0.5) * 95);
    hCtx.fillStyle = `rgba(${hVal}, ${hVal}, ${hVal}, 0.35)`;
    hCtx.beginPath();
    hCtx.arc(x, y, rad * 0.65, 0, Math.PI * 2);
    hCtx.fill();
  }

  // Fine gravel & stones
  for (let p = 0; p < 2600; p++) {
    const px = rand() * size;
    const py = rand() * size;
    const l = 48 + Math.floor(rand() * 48);
    ctx.fillStyle = `rgba(${l}, ${l - 3}, ${l - 6}, 0.48)`;
    ctx.fillRect(px, py, 2, 2);
    hCtx.fillStyle = `rgba(${160 + Math.floor(rand() * 90)}, 190, 190, 0.65)`;
    hCtx.fillRect(px, py, 2, 2);
  }

  const map = new THREE.CanvasTexture(diffCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(14, 14);
  map.anisotropy = 4;

  const bumpMap = new THREE.CanvasTexture(heightCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(14, 14);
  bumpMap.anisotropy = 4;

  const normalMap = heightCanvasToNormalTexture(heightCanvas, 3.2, 14, 14);

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(14, 14);
  roughnessMap.anisotropy = 4;

  return { map, bumpMap, normalMap, roughnessMap };
}

/**
 * Generates a soft volumetric fire/smoke/glow radial CanvasTexture for photorealistic braziers,
 * torches, and atmospheric smoke plumes (replacing geometric cone flames).
 */
function createFireGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createRadialGradient(size / 2, size * 0.56, 2, size / 2, size / 2, size * 0.48);
  grad.addColorStop(0.0, 'rgba(255, 250, 220, 1.0)');
  grad.addColorStop(0.24, 'rgba(255, 185, 65, 0.92)');
  grad.addColorStop(0.55, 'rgba(235, 85, 15, 0.48)');
  grad.addColorStop(0.82, 'rgba(140, 25, 5, 0.14)');
  grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  return new THREE.CanvasTexture(canvas);
}

/**
 * Generates a high-dynamic-range style atmospheric twilight sky & firelit horizon reflection map.
 */
function createRealisticEnvMapTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Dramatic cinematic twilight sky (deep slate-indigo zenith -> storm clouds -> warm amber horizon glow -> dark earth)
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#0d131d');
  grad.addColorStop(0.28, '#1d283a');
  grad.addColorStop(0.44, '#3d4858');
  grad.addColorStop(0.51, '#9e6b43');
  grad.addColorStop(0.56, '#382416');
  grad.addColorStop(1.0, '#0e0c0a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  // Volumetric storm cloud bands & warm horizon firelight reflections
  for (let i = 0; i < 14; i++) {
    const x = (i * 41) % 512;
    const y = 112 + (i % 3) * 10;
    const radGrad = ctx.createRadialGradient(x, y, 4, x, y, 54);
    radGrad.addColorStop(0, 'rgba(255, 220, 155, 0.85)');
    radGrad.addColorStop(0.45, 'rgba(225, 120, 48, 0.38)');
    radGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = radGrad;
    ctx.fillRect(x - 54, y - 54, 108, 108);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}

/**
 * Merges an array of { geo, colorHex, colorJitter } into a single BufferGeometry with realistic
 * micro-shaded vertex colors (ambient occlusion at ground level + directional zenith lighting + per-part patina).
 */
function mergeColoredGeometries(parts) {
  const positions = [];
  const normals = [];
  const colors = [];
  const c = new THREE.Color();

  for (const part of parts) {
    const nonIndexed = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    nonIndexed.computeVertexNormals();
    const posAttr = nonIndexed.getAttribute('position');
    const normAttr = nonIndexed.getAttribute('normal');
    c.setHex(part.colorHex);

    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vy = posAttr.getY(i);
      const vz = posAttr.getZ(i);
      positions.push(vx, vy, vz);

      let nx = 0;
      let ny = 1;
      let nz = 0;
      if (normAttr) {
        nx = normAttr.getX(i);
        ny = normAttr.getY(i);
        nz = normAttr.getZ(i);
      }
      normals.push(nx, ny, nz);

      // Realistic baked vertex Ambient Occlusion (darker near boots/hooves, brighter at shoulders/helm)
      // plus subtle normal-based cavity shading so armor plates and musculature have crisp 3D depth
      const heightAo = Math.min(1.12, 0.62 + Math.max(0, vy) * 0.22);
      const cavityShade = 0.88 + Math.max(-0.3, ny * 0.16 + nz * 0.08);
      const shade = heightAo * cavityShade;

      colors.push(
        Math.min(1, c.r * shade),
        Math.min(1, c.g * shade),
        Math.min(1, c.b * shade)
      );
    }
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return merged;
}

/**
 * Builds a realistic, articulated 3D Ancient Heavy Infantry Soldier (Spartan / Roman Legionary) facing +Z
 * in an authentic mid-stride combat march:
 * - Weathered bronze greaves, knee guards, leather sandals & muscular calves in alternating stride
 * - Layered leather pteruges (strips) & deep blood-crimson wool tunic
 * - anatomically sculpted antique bronze/steel cuirass with pauldrons & leather baldric belt
 * - Corinthian/Imperial helmet with cheek-guards, brow ridge, eye slit, and horsehair crest
 * - Domed, battle-worn bronze Hoplon shield with iron rim & embossed boss
 * - Ash-wood heavy war spear with counter-weight butt-spike & leaf-shaped steel blade
 */
function createAncientSoldierGeometry() {
  const parts = [];

  // 1. Left Leg (Stepping forward +Z) — Leather boot, bronze greave, knee guard & thigh
  const bootL = new THREE.BoxGeometry(0.15, 0.12, 0.26);
  bootL.translate(-0.16, 0.06, 0.16);
  parts.push({ geo: bootL, colorHex: 0x3b2314 });

  const calfL = new THREE.CylinderGeometry(0.095, 0.075, 0.44, 10);
  calfL.rotateX(-0.18);
  calfL.translate(-0.16, 0.28, 0.12);
  parts.push({ geo: calfL, colorHex: 0x9a7b4f }); // Weathered antique bronze greave

  const kneeL = new THREE.SphereGeometry(0.095, 8, 8);
  kneeL.translate(-0.16, 0.50, 0.08);
  parts.push({ geo: kneeL, colorHex: 0xb08d57 });

  const thighL = new THREE.CylinderGeometry(0.115, 0.095, 0.38, 10);
  thighL.rotateX(-0.12);
  thighL.translate(-0.16, 0.66, 0.04);
  parts.push({ geo: thighL, colorHex: 0x5c4033 });

  // 2. Right Leg (Pushing off -Z)
  const bootR = new THREE.BoxGeometry(0.15, 0.12, 0.26);
  bootR.translate(0.16, 0.06, -0.10);
  parts.push({ geo: bootR, colorHex: 0x3b2314 });

  const calfR = new THREE.CylinderGeometry(0.095, 0.075, 0.44, 10);
  calfR.rotateX(0.20);
  calfR.translate(0.16, 0.28, -0.12);
  parts.push({ geo: calfR, colorHex: 0x9a7b4f });

  const kneeR = new THREE.SphereGeometry(0.095, 8, 8);
  kneeR.translate(0.16, 0.50, -0.07);
  parts.push({ geo: kneeR, colorHex: 0xb08d57 });

  const thighR = new THREE.CylinderGeometry(0.115, 0.095, 0.38, 10);
  thighR.rotateX(0.14);
  thighR.translate(0.16, 0.66, -0.04);
  parts.push({ geo: thighR, colorHex: 0x5c4033 });

  // 3. Layered Leather Pteruges (Armored Waist Skirt) & Studded Cingulum Belt
  const tunicSkirt = new THREE.CylinderGeometry(0.27, 0.34, 0.36, 12);
  tunicSkirt.translate(0, 0.84, 0);
  parts.push({ geo: tunicSkirt, colorHex: 0x4a2e1b });

  const belt = new THREE.CylinderGeometry(0.29, 0.29, 0.10, 12);
  belt.translate(0, 0.99, 0);
  parts.push({ geo: belt, colorHex: 0x8c6d3f });

  // 4. Sculpted Bronze/Steel Cuirass (Chest & Backplate)
  const lowerTorso = new THREE.CylinderGeometry(0.31, 0.27, 0.36, 12);
  lowerTorso.translate(0, 1.18, 0);
  parts.push({ geo: lowerTorso, colorHex: 0x8f754f });

  const upperChest = new THREE.CylinderGeometry(0.35, 0.31, 0.40, 12);
  upperChest.scale(1.12, 1.0, 0.86);
  upperChest.translate(0, 1.48, 0.02);
  parts.push({ geo: upperChest, colorHex: 0xa6895b });

  // Layered Shoulder Pauldrons (Epomides)
  const pauldronL = new THREE.SphereGeometry(0.16, 10, 8);
  pauldronL.scale(1.1, 0.75, 1.15);
  pauldronL.translate(-0.34, 1.62, 0);
  parts.push({ geo: pauldronL, colorHex: 0x947950 });

  const pauldronR = new THREE.SphereGeometry(0.16, 10, 8);
  pauldronR.scale(1.1, 0.75, 1.15);
  pauldronR.translate(0.34, 1.62, 0);
  parts.push({ geo: pauldronR, colorHex: 0x947950 });

  // 5. Heavy Weathered Crimson Wool War Cloak draped from shoulders
  const cloakUpper = new THREE.BoxGeometry(0.64, 0.45, 0.09);
  cloakUpper.rotateX(0.15);
  cloakUpper.translate(0, 1.42, -0.24);
  parts.push({ geo: cloakUpper, colorHex: 0x6b141a });

  const cloakLower = new THREE.BoxGeometry(0.70, 0.68, 0.08);
  cloakLower.rotateX(0.24);
  cloakLower.translate(0, 0.92, -0.35);
  parts.push({ geo: cloakLower, colorHex: 0x581015 });

  // 6. Articulated Arms & Vambraces
  const armR = new THREE.CylinderGeometry(0.085, 0.07, 0.56, 8);
  armR.rotateX(0.55);
  armR.translate(-0.36, 1.32, 0.14);
  parts.push({ geo: armR, colorHex: 0x7c5836 });

  const armL = new THREE.CylinderGeometry(0.085, 0.07, 0.52, 8);
  armL.rotateX(0.75);
  armL.translate(0.34, 1.34, 0.16);
  parts.push({ geo: armL, colorHex: 0x7c5836 });

  // 7. Corinthian / Imperial War Helmet with Visor Slit, Cheek Guards & Horsehair Crest
  const neck = new THREE.CylinderGeometry(0.11, 0.13, 0.16, 8);
  neck.translate(0, 1.72, 0);
  parts.push({ geo: neck, colorHex: 0x6e4f3a });

  const helmSkull = new THREE.SphereGeometry(0.22, 12, 10);
  helmSkull.scale(0.95, 1.08, 1.08);
  helmSkull.translate(0, 1.90, 0);
  parts.push({ geo: helmSkull, colorHex: 0xa88b5c });

  const helmVisor = new THREE.CylinderGeometry(0.21, 0.22, 0.20, 10);
  helmVisor.translate(0, 1.82, 0.04);
  parts.push({ geo: helmVisor, colorHex: 0x8c7044 });

  // Dark eye slit recess
  const eyeSlit = new THREE.BoxGeometry(0.28, 0.045, 0.12);
  eyeSlit.translate(0, 1.88, 0.17);
  parts.push({ geo: eyeSlit, colorHex: 0x141210 });

  // Bronze Crest Holder & Dyed Crimson Horsehair Plume
  const crestHolder = new THREE.BoxGeometry(0.06, 0.12, 0.44);
  crestHolder.translate(0, 2.12, -0.02);
  parts.push({ geo: crestHolder, colorHex: 0x8c6d3f });

  const crestPlume = new THREE.BoxGeometry(0.09, 0.24, 0.56);
  crestPlume.rotateX(-0.10);
  crestPlume.translate(0, 2.26, -0.06);
  parts.push({ geo: crestPlume, colorHex: 0x7f1d1d });

  // 8. Domed Bronze Hoplon Shield with Forged Iron Rim & Central Boss
  const shieldRim = new THREE.CylinderGeometry(0.54, 0.54, 0.06, 18);
  shieldRim.rotateZ(Math.PI / 2);
  shieldRim.rotateY(0.30);
  shieldRim.translate(0.42, 1.26, 0.22);
  parts.push({ geo: shieldRim, colorHex: 0x5c4930 });

  const shieldFace = new THREE.CylinderGeometry(0.49, 0.49, 0.075, 18);
  shieldFace.rotateZ(Math.PI / 2);
  shieldFace.rotateY(0.30);
  shieldFace.translate(0.43, 1.26, 0.22);
  parts.push({ geo: shieldFace, colorHex: 0xa68652 });

  const shieldBoss = new THREE.SphereGeometry(0.14, 10, 8);
  shieldBoss.scale(0.65, 1.0, 1.0);
  shieldBoss.translate(0.47, 1.26, 0.24);
  parts.push({ geo: shieldBoss, colorHex: 0xc2a36b });

  // 9. Heavy Ash-Wood Dory Spear with Bronze Sauroter Butt-Spike & Forged Steel Head
  const spearShaft = new THREE.CylinderGeometry(0.032, 0.036, 2.95, 8);
  spearShaft.rotateX(Math.PI / 2);
  spearShaft.translate(-0.38, 1.26, 0.62);
  parts.push({ geo: spearShaft, colorHex: 0x5c3a21 });

  const buttSpike = new THREE.ConeGeometry(0.048, 0.24, 6);
  buttSpike.rotateX(-Math.PI / 2);
  buttSpike.translate(-0.38, 1.26, -0.95);
  parts.push({ geo: buttSpike, colorHex: 0x8c7044 });

  const spearSocket = new THREE.CylinderGeometry(0.042, 0.034, 0.18, 8);
  spearSocket.rotateX(Math.PI / 2);
  spearSocket.translate(-0.38, 1.26, 2.12);
  parts.push({ geo: spearSocket, colorHex: 0x71717a });

  const spearBlade = new THREE.ConeGeometry(0.075, 0.42, 8);
  spearBlade.scale(0.65, 1.0, 1.0);
  spearBlade.rotateX(Math.PI / 2);
  spearBlade.translate(-0.38, 1.26, 2.38);
  parts.push({ geo: spearBlade, colorHex: 0xd4d4d8 });

  return mergeColoredGeometries(parts);
}

/**
 * Builds an anatomical 3D Warhorse (Destrier) with a Full-Plate Armored Medieval Knight facing +Z:
 * - Sculpted chest, ribcage barrel, hindquarters, arched neck, tapered muzzle, ears, mane & tail
 * - Articulated upper thighs/forearms, cannon bones, and iron-shod hooves in a 3-beat canter stride
 * - Weathered steel & brass barding armor over dark crimson quilted caparison
 * - Full-plate Gothic/Crusader Knight in the saddle with sallet/great helm, steel pauldrons,
 *   weathered heraldic heater shield, and heavy ash/steel couched war lance
 */
function createMountedKnightGeometry() {
  const parts = [];

  // --- ANATOMICAL DESTRIER WARHORSE ---
  // 1. Articulated Forelegs (Left extended forward, Right flexed back)
  const foreUpperL = new THREE.CylinderGeometry(0.11, 0.08, 0.56, 8);
  foreUpperL.rotateX(-0.42);
  foreUpperL.translate(-0.24, 0.78, 0.68);
  parts.push({ geo: foreUpperL, colorHex: 0x4a3728 }); // Dark bay warhorse coat

  const foreLowerL = new THREE.CylinderGeometry(0.072, 0.06, 0.52, 8);
  foreLowerL.rotateX(-0.15);
  foreLowerL.translate(-0.24, 0.34, 0.84);
  parts.push({ geo: foreLowerL, colorHex: 0x2e2016 });

  const hoofFL = new THREE.CylinderGeometry(0.075, 0.085, 0.10, 8);
  hoofFL.translate(-0.24, 0.08, 0.88);
  parts.push({ geo: hoofFL, colorHex: 0x181615 });

  const foreUpperR = new THREE.CylinderGeometry(0.11, 0.08, 0.56, 8);
  foreUpperR.rotateX(0.28);
  foreUpperR.translate(0.24, 0.78, 0.52);
  parts.push({ geo: foreUpperR, colorHex: 0x4a3728 });

  const foreLowerR = new THREE.CylinderGeometry(0.072, 0.06, 0.52, 8);
  foreLowerR.rotateX(0.52);
  foreLowerR.translate(0.24, 0.36, 0.34);
  parts.push({ geo: foreLowerR, colorHex: 0x2e2016 });

  // 2. Articulated Hindlegs (Powerful gaskin & hock joint pushing off)
  const hindUpperL = new THREE.CylinderGeometry(0.14, 0.09, 0.60, 8);
  hindUpperL.rotateX(0.32);
  hindUpperL.translate(-0.25, 0.82, -0.62);
  parts.push({ geo: hindUpperL, colorHex: 0x4a3728 });

  const hindLowerL = new THREE.CylinderGeometry(0.078, 0.062, 0.54, 8);
  hindLowerL.rotateX(0.18);
  hindLowerL.translate(-0.25, 0.34, -0.76);
  parts.push({ geo: hindLowerL, colorHex: 0x2e2016 });

  const hindUpperR = new THREE.CylinderGeometry(0.14, 0.09, 0.60, 8);
  hindUpperR.rotateX(-0.24);
  hindUpperR.translate(0.25, 0.82, -0.54);
  parts.push({ geo: hindUpperR, colorHex: 0x4a3728 });

  const hindLowerR = new THREE.CylinderGeometry(0.078, 0.062, 0.54, 8);
  hindLowerR.rotateX(0.08);
  hindLowerR.translate(0.25, 0.32, -0.48);
  parts.push({ geo: hindLowerR, colorHex: 0x2e2016 });

  // 3. Sculpted Horse Barrel, Muscular Chest & Croup (Hindquarters)
  const horseBarrel = new THREE.CylinderGeometry(0.42, 0.40, 1.55, 12);
  horseBarrel.rotateX(Math.PI / 2);
  horseBarrel.scale(0.92, 1.05, 1.0);
  horseBarrel.translate(0, 1.22, 0);
  parts.push({ geo: horseBarrel, colorHex: 0x4a3728 });

  const horseChest = new THREE.SphereGeometry(0.43, 12, 10);
  horseChest.scale(0.88, 1.05, 1.05);
  horseChest.translate(0, 1.26, 0.68);
  parts.push({ geo: horseChest, colorHex: 0x523d2d });

  const horseCroup = new THREE.SphereGeometry(0.42, 12, 10);
  horseCroup.scale(0.90, 1.02, 1.10);
  horseCroup.translate(0, 1.28, -0.68);
  parts.push({ geo: horseCroup, colorHex: 0x4a3728 });

  // 4. Quilted Crimson & Steel Barding Caparison + Crinet Armor
  const bardingSkirt = new THREE.CylinderGeometry(0.45, 0.52, 0.56, 12);
  bardingSkirt.scale(0.88, 1.0, 1.85);
  bardingSkirt.translate(0, 1.02, -0.02);
  parts.push({ geo: bardingSkirt, colorHex: 0x6b141a });

  const peytralPlate = new THREE.CylinderGeometry(0.44, 0.46, 0.44, 12, 1, false, -Math.PI * 0.45, Math.PI * 0.9);
  peytralPlate.translate(0, 1.24, 0.56);
  parts.push({ geo: peytralPlate, colorHex: 0x8f96a0 }); // Steel chest barding

  // 5. Arched Muscular Horse Neck, Skull, Tapered Muzzle & Steel Chamfron
  const horseNeck = new THREE.CylinderGeometry(0.20, 0.30, 0.92, 10);
  horseNeck.rotateX(0.52);
  horseNeck.scale(0.76, 1.0, 1.1);
  horseNeck.translate(0, 1.72, 0.88);
  parts.push({ geo: horseNeck, colorHex: 0x4a3728 });

  const horseMane = new THREE.BoxGeometry(0.08, 0.86, 0.18);
  horseMane.rotateX(0.52);
  horseMane.translate(0, 1.82, 0.72);
  parts.push({ geo: horseMane, colorHex: 0x1a1512 });

  const horseHead = new THREE.CylinderGeometry(0.13, 0.21, 0.68, 10);
  horseHead.rotateX(1.12);
  horseHead.scale(0.82, 1.0, 1.05);
  horseHead.translate(0, 2.08, 1.26);
  parts.push({ geo: horseHead, colorHex: 0x4a3728 });

  const chamfron = new THREE.CylinderGeometry(0.14, 0.22, 0.58, 8);
  chamfron.rotateX(1.12);
  chamfron.scale(0.78, 1.0, 0.55);
  chamfron.translate(0, 2.16, 1.28);
  parts.push({ geo: chamfron, colorHex: 0xa1a1aa });

  const horseTail = new THREE.CylinderGeometry(0.06, 0.16, 0.88, 8);
  horseTail.rotateX(-0.48);
  horseTail.translate(0, 1.02, -1.16);
  parts.push({ geo: horseTail, colorHex: 0x1a1512 });

  // --- FULL-PLATE ARMORED KNIGHT RIDER ---
  // 6. High-Cantled War Saddle & Armored Cuisses/Greaves in Stirrups
  const saddle = new THREE.BoxGeometry(0.52, 0.26, 0.58);
  saddle.translate(0, 1.56, -0.04);
  parts.push({ geo: saddle, colorHex: 0x3b2314 });

  const riderLegL = new THREE.CylinderGeometry(0.10, 0.08, 0.68, 8);
  riderLegL.rotateX(0.18);
  riderLegL.translate(-0.42, 1.28, 0.08);
  parts.push({ geo: riderLegL, colorHex: 0x8f96a0 });

  const riderLegR = new THREE.CylinderGeometry(0.10, 0.08, 0.68, 8);
  riderLegR.rotateX(0.18);
  riderLegR.translate(0.42, 1.28, 0.08);
  parts.push({ geo: riderLegR, colorHex: 0x8f96a0 });

  // 7. Fluted Steel Breastplate, Faulds & Pauldrons
  const knightTorso = new THREE.CylinderGeometry(0.31, 0.25, 0.78, 12);
  knightTorso.scale(1.08, 1.0, 0.86);
  knightTorso.translate(0, 1.92, -0.04);
  parts.push({ geo: knightTorso, colorHex: 0xb4bcc4 });

  const surcoatTabard = new THREE.BoxGeometry(0.42, 0.76, 0.48);
  surcoatTabard.translate(0, 1.88, -0.04);
  parts.push({ geo: surcoatTabard, colorHex: 0x7f1d1d });

  const pauldronL = new THREE.SphereGeometry(0.17, 10, 8);
  pauldronL.translate(-0.36, 2.20, -0.04);
  parts.push({ geo: pauldronL, colorHex: 0xc4ccd4 });

  const pauldronR = new THREE.SphereGeometry(0.17, 10, 8);
  pauldronR.translate(0.36, 2.20, -0.04);
  parts.push({ geo: pauldronR, colorHex: 0xc4ccd4 });

  const knightCape = new THREE.BoxGeometry(0.62, 0.96, 0.08);
  knightCape.rotateX(0.32);
  knightCape.translate(0, 1.84, -0.38);
  parts.push({ geo: knightCape, colorHex: 0x5c1015 });

  // 8. Visored Bascinet / Great Helm with Brass Cross Trim & Plume
  const greatHelm = new THREE.CylinderGeometry(0.21, 0.23, 0.38, 12);
  greatHelm.translate(0, 2.50, -0.02);
  parts.push({ geo: greatHelm, colorHex: 0xc4ccd4 });

  const helmDome = new THREE.SphereGeometry(0.21, 10, 8);
  helmDome.translate(0, 2.68, -0.02);
  parts.push({ geo: helmDome, colorHex: 0xd4dce4 });

  const houndskullVisor = new THREE.ConeGeometry(0.18, 0.24, 8);
  houndskullVisor.rotateX(Math.PI / 2);
  houndskullVisor.translate(0, 2.50, 0.20);
  parts.push({ geo: houndskullVisor, colorHex: 0x9fa6b0 });

  const knightPlume = new THREE.BoxGeometry(0.10, 0.28, 0.48);
  knightPlume.rotateX(-0.18);
  knightPlume.translate(0, 2.86, -0.14);
  parts.push({ geo: knightPlume, colorHex: 0x7f1d1d });

  // 9. Curved Steel & Brass Heater Shield on Left Arm
  const knightShield = new THREE.BoxGeometry(0.08, 0.72, 0.52);
  knightShield.rotateY(0.28);
  knightShield.translate(0.46, 1.94, 0.16);
  parts.push({ geo: knightShield, colorHex: 0x8c6d3f });

  // 10. Heavy Couched Ash-Wood & Steel War Lance (+Z) with Steel Vamplate & Swallowtail Pennon
  const lanceShaft = new THREE.CylinderGeometry(0.036, 0.058, 3.60, 8);
  lanceShaft.rotateX(Math.PI / 2);
  lanceShaft.translate(-0.46, 1.92, 1.15);
  parts.push({ geo: lanceShaft, colorHex: 0x5c3a21 });

  const vamplate = new THREE.ConeGeometry(0.19, 0.28, 10);
  vamplate.rotateX(Math.PI / 2);
  vamplate.translate(-0.46, 1.92, 0.36);
  parts.push({ geo: vamplate, colorHex: 0xb4bcc4 });

  const lanceTip = new THREE.ConeGeometry(0.075, 0.52, 8);
  lanceTip.rotateX(Math.PI / 2);
  lanceTip.translate(-0.46, 1.92, 3.16);
  parts.push({ geo: lanceTip, colorHex: 0xe4e4e7 });

  const pennon = new THREE.BoxGeometry(0.03, 0.24, 0.56);
  pennon.translate(-0.46, 2.08, 2.55);
  parts.push({ geo: pennon, colorHex: 0x7f1d1d });

  return mergeColoredGeometries(parts);
}

/**
 * Builds a realistic 3D Flaming War Arrow facing +Z:
 * - Dark ash-wood shaft
 * - Natural goose-feather fletching
 * - Tar-soaked pitch bundle wrapped behind a forged bodkin steel arrowhead
 */
function createFlamingArrowGeometry() {
  const parts = [];

  const shaft = new THREE.CylinderGeometry(0.032, 0.032, 2.25, 6);
  shaft.rotateX(Math.PI / 2);
  parts.push({ geo: shaft, colorHex: 0x785230 });

  const fletchH = new THREE.BoxGeometry(0.26, 0.03, 0.44);
  fletchH.translate(0, 0, -0.92);
  parts.push({ geo: fletchH, colorHex: 0xd6d3d1 });

  const fletchV = new THREE.BoxGeometry(0.03, 0.26, 0.44);
  fletchV.translate(0, 0, -0.92);
  parts.push({ geo: fletchV, colorHex: 0xd6d3d1 });

  const fireWrap = new THREE.SphereGeometry(0.14, 8, 8);
  fireWrap.scale(1.0, 1.0, 1.7);
  fireWrap.translate(0, 0, 0.88);
  parts.push({ geo: fireWrap, colorHex: 0xff5500 });

  const fireCore = new THREE.SphereGeometry(0.10, 6, 6);
  fireCore.translate(0, 0, 1.02);
  parts.push({ geo: fireCore, colorHex: 0xffd580 });

  const tip = new THREE.ConeGeometry(0.09, 0.42, 6);
  tip.rotateX(Math.PI / 2);
  tip.translate(0, 0, 1.32);
  parts.push({ geo: tip, colorHex: 0xd4d4d8 });

  return mergeColoredGeometries(parts);
}

/**
 * Builds a realistic 3D Flaming Catapult Siege Boulder:
 * - Craggy dark basalt quarry stone soaked in burning pitch
 */
function createCatapultBoulderGeometry() {
  const parts = [];

  const stoneCore = new THREE.DodecahedronGeometry(0.64, 1);
  parts.push({ geo: stoneCore, colorHex: 0x3f3c38 });

  const fireCrust = new THREE.DodecahedronGeometry(0.58, 0);
  fireCrust.rotateY(0.6);
  fireCrust.rotateX(0.4);
  parts.push({ geo: fireCrust, colorHex: 0xd9480f });

  const flameTail = new THREE.ConeGeometry(0.48, 1.25, 8);
  flameTail.rotateX(-Math.PI / 2);
  flameTail.translate(0, 0, -0.62);
  parts.push({ geo: flameTail, colorHex: 0xff922b });

  return mergeColoredGeometries(parts);
}

export class CyberFortressDirector {
  constructor(masterCanvas, options = {}) {
    this.masterCanvas = masterCanvas;
    this.ctx = masterCanvas.getContext('2d');
    this.width = 1920;
    this.height = 1080;
    this.masterCanvas.width = this.width;
    this.masterCanvas.height = this.height;

    this.thresholds = options.thresholds || {
      nominalMs: 180,
      warningMs: 500,
      criticalMs: 1100
    };

    this.numLoadAgents = options.numLoadAgents || 1;
    this.loadAgentNames = [];
    this.isLiveMode = false;
    this.hasData = false;
    this.noDataMessage = 'NO DATA — CONNECT INFLUXDB 1.8 / GRAFANA TO MUSTER THE LEGIONS';

    this.cameraMode = 'auto'; // 'auto' | 'orbit' | 'highway' | 'agents' | 'core' | 'top'
    this.showHudInCanvas = true;
    this.showSummaryOverlay = false;
    this.sutName = 'SUT // FORTRESS CITADEL';
    this.testTitle = 'NO BATTLE LOADED';
    this.sourceLabel = 'AWAITING INFLUXDB 1.8 CONNECTION';
    this.endpoints = [];

    this.currentFrame = {
      noData: true,
      index: 0,
      elapsedSec: 0,
      vus: 0,
      rps: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      errorRate: 0,
      failedReqs: 0,
      checksPassRate: 0
    };
    this.allFrames = [];
    this.summaryStats = null;
    this.thermal = computeThermalState(this.currentFrame, this.thresholds);
    this.smoothedHeat = 0;
    this.smoothedBreach = 0;
    this.smoothedRps = 0;
    this.smoothedVus = 0;
    this.smoothedP95 = 0;

    this.zoomDistance = 68; // 22 (close-up) .. 125 (wide)
    this.fortressPosX = 0;  // -45 .. 45
    this.fortressPosY = 0;  // -30 .. 40
    this.orbitAngleDeg = 25; // -180 .. 180
    this.onViewChange = options.onViewChange || null;

    this.clockTime = 0;
    this.shockwaves = [];

    this._initThreeScene();
    this._buildStaticFortressCore();
    this._rebuildDynamicLoadAgentsAndHighways(this.numLoadAgents);
    this._initBotSwarms();
    this._initThermalParticles();
    this._bindPointerControls();
  }

  _initThreeScene() {
    this.webglCanvas = document.createElement('canvas');
    this.webglCanvas.width = this.width;
    this.webglCanvas.height = this.height;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.webglCanvas,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true
    });
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();

    // Pre-filtered PMREM Environment Map & Skybox for photorealistic reflections on wet stone & steel armor
    const rawEnvTex = createRealisticEnvMapTexture();
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();
    this.envRT = pmremGenerator.fromEquirectangular(rawEnvTex);
    this.scene.environment = this.envRT.texture;
    this.scene.background = rawEnvTex;
    this.scene.backgroundIntensity = 0.55;
    this.scene.fog = new THREE.FogExp2(0x0c0f14, 0.0048);
    pmremGenerator.dispose();

    this.camera = new THREE.PerspectiveCamera(44, this.width / this.height, 0.5, 340);
    this.camera.position.set(0, 34, 58);
    this.cameraTarget = new THREE.Vector3(0, 5, 0);

    // Post-processing optical pipeline: RenderPass + UnrealBloomPass for photorealistic fire & torch halation
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.width, this.height),
      0.34, // optical bloom strength
      0.55, // bloom radius
      0.78  // high luminance threshold so only real flames, embers & hot steel bloom
    );
    this.composer.addPass(this.bloomPass);

    // Natural sky/ground hemisphere illumination (cool slate sky zenith + warm scorched earth bounce)
    this.hemiLight = new THREE.HemisphereLight(0x788ba8, 0x2b2118, 1.4);
    this.scene.add(this.hemiLight);

    // Central Fortress War Brazier PointLight (casts warm firelight across the castle courtyard & battlements)
    this.coreLight = new THREE.PointLight(0xff9d3b, 14.0, 135, 1.25);
    this.coreLight.position.set(0, 16.5, 0);
    this.scene.add(this.coreLight);

    // Key Directional Sun/Moon & Fire Rim Light with high-resolution Soft Shadows
    this.rimLight1 = new THREE.DirectionalLight(0xffe6c2, 2.55);
    this.rimLight1.position.set(52, 74, 42);
    this.rimLight1.castShadow = true;
    this.rimLight1.shadow.mapSize.width = 2048;
    this.rimLight1.shadow.mapSize.height = 2048;
    this.rimLight1.shadow.camera.near = 10;
    this.rimLight1.shadow.camera.far = 210;
    this.rimLight1.shadow.camera.left = -90;
    this.rimLight1.shadow.camera.right = 90;
    this.rimLight1.shadow.camera.top = 90;
    this.rimLight1.shadow.camera.bottom = -90;
    this.rimLight1.shadow.bias = -0.0004;
    this.scene.add(this.rimLight1);

    // Secondary Atmospheric Rim Backlight
    this.rimLight2 = new THREE.DirectionalLight(0x88a4c8, 1.05);
    this.rimLight2.position.set(-55, 38, -45);
    this.scene.add(this.rimLight2);

    // Generate shared PBR Stone Masonry, Battlefield Terrain & Volumetric Fire textures
    this.stoneTextures = createStoneMasonryTextures();
    this.terrainTextures = createBattlefieldTerrainTextures();
    this.fireGlowTex = createFireGlowTexture();
  }

  _buildStaticFortressCore() {
    this.fortressGroup = new THREE.Group();
    this.scene.add(this.fortressGroup);

    // 1. Photorealistic Muddy & Rain-Slicked Medieval Battlefield Ground with Normal & Roughness Mapping
    const groundGeo = new THREE.CircleGeometry(155, 72);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x7a7268,
      map: this.terrainTextures.map,
      normalMap: this.terrainTextures.normalMap,
      normalScale: new THREE.Vector2(1.35, 1.35),
      roughnessMap: this.terrainTextures.roughnessMap,
      roughness: 0.88,
      metalness: 0.06,
      envMapIntensity: 1.15
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.position.y = -0.04;
    groundMesh.receiveShadow = true;
    this.scene.add(groundMesh);

    // Subtle Siege Range Distance Markers etched in weathered stone
    this.radarRings = [];
    const ringRadii = [11, 17.5, 28, 44, 64, 82];
    ringRadii.forEach((r, idx) => {
      const geo = new THREE.RingGeometry(r - 0.14, r + 0.14, 72);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: idx < 2 ? 0x8c734b : 0x2c2824,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: idx < 2 ? 0.34 : 0.15
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = 0.02;
      this.fortressGroup.add(mesh);
      this.radarRings.push(mesh);
    });

    // Photorealistic PBR Ashlar Cut-Stone Masonry Materials with Tangent-Space Normal & Roughness Maps
    const stoneWallMat = new THREE.MeshStandardMaterial({
      color: 0xbcb6ac,
      map: this.stoneTextures.map,
      normalMap: this.stoneTextures.normalMap,
      normalScale: new THREE.Vector2(1.45, 1.45),
      roughnessMap: this.stoneTextures.roughnessMap,
      roughness: 0.82,
      metalness: 0.08,
      envMapIntensity: 1.1,
      emissive: 0x0c0906,
      emissiveIntensity: 0.08
    });
    const darkStoneMat = new THREE.MeshStandardMaterial({
      color: 0x767168,
      map: this.stoneTextures.map,
      normalMap: this.stoneTextures.normalMap,
      normalScale: new THREE.Vector2(1.6, 1.6),
      roughnessMap: this.stoneTextures.roughnessMap,
      roughness: 0.86,
      metalness: 0.14,
      envMapIntensity: 1.15
    });
    const slitMat = new THREE.MeshBasicMaterial({ color: 0x090807 });

    this.citadelBaseMat = stoneWallMat;
    this.darkStoneMat = darkStoneMat;
    this.staticThermalEdgeMaterials = [];

    // 2. Outer Medieval Curtain Wall built from 16 Destructible Ashlar Stone Wall Slabs (r = 14.2)
    // Includes Battered Stone Plinth Base, Wall Walk Cornice, Machicolation Corbels & Arrow Slits
    this.wallSegmentPieces = [];
    const wallSlabGeo = new THREE.BoxGeometry(5.68, 5.8, 1.45);
    const wallPlinthGeo = new THREE.BoxGeometry(5.76, 1.35, 1.85);
    const wallCorniceGeo = new THREE.BoxGeometry(5.78, 0.48, 1.75);
    const arrowSlitGeo = new THREE.BoxGeometry(0.22, 1.45, 1.52);

    for (let w = 0; w < 16; w++) {
      const wAngle = (w * Math.PI * 2) / 16;
      const wx = Math.cos(wAngle) * 14.2;
      const wz = Math.sin(wAngle) * 14.2;
      const baseRotY = -wAngle + Math.PI / 2;

      const slabMesh = new THREE.Mesh(wallSlabGeo, stoneWallMat);
      slabMesh.position.set(wx, 3.1, wz);
      slabMesh.rotation.y = baseRotY;
      slabMesh.castShadow = true;
      slabMesh.receiveShadow = true;

      // Sloped stone talus/plinth at the base of the wall
      const plinth = new THREE.Mesh(wallPlinthGeo, darkStoneMat);
      plinth.position.set(0, -2.35, 0);
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      slabMesh.add(plinth);

      // Overhanging machicolation cornice at top of the wall
      const cornice = new THREE.Mesh(wallCorniceGeo, darkStoneMat);
      cornice.position.set(0, 2.85, 0);
      cornice.castShadow = true;
      slabMesh.add(cornice);

      // Two recessed vertical archer embrasures (arrow loops) per wall slab
      [-1.4, 1.4].forEach((sx) => {
        const slit = new THREE.Mesh(arrowSlitGeo, slitMat);
        slit.position.set(sx, 0.45, 0);
        slabMesh.add(slit);
      });

      this.fortressGroup.add(slabMesh);

      this.wallSegmentPieces.push({
        mesh: slabMesh,
        angle: wAngle,
        baseX: wx,
        baseY: 3.1,
        baseZ: wz,
        baseRotY,
        fallDir: w % 3 === 0 ? -0.65 : 1.0,
        outSpeed: 4.5 + (w % 4) * 2.4,
        twistSign: w % 2 === 0 ? 1 : -1
      });
    }

    // Inner Bailey Courtyard Flagstone Floor
    const baileyGeo = new THREE.CylinderGeometry(14.1, 14.5, 0.5, 24);
    const baileyMesh = new THREE.Mesh(baileyGeo, darkStoneMat);
    baileyMesh.position.y = 0.25;
    baileyMesh.receiveShadow = true;
    this.fortressGroup.add(baileyMesh);

    // 24 Crenellated Stone Battlements (Merlons with Copings) atop the Outer Curtain Wall
    this.merlonPieces = [];
    const merlonGeo = new THREE.BoxGeometry(1.38, 1.15, 0.95);
    const merlonCapGeo = new THREE.BoxGeometry(1.48, 0.18, 1.08);
    for (let m = 0; m < 24; m++) {
      const mAngle = (m * Math.PI * 2) / 24;
      const baseX = Math.cos(mAngle) * 14.2;
      const baseZ = Math.sin(mAngle) * 14.2;
      const baseY = 6.65;
      const baseRotY = -mAngle + Math.PI / 2;
      const merlon = new THREE.Mesh(merlonGeo, stoneWallMat);
      merlon.position.set(baseX, baseY, baseZ);
      merlon.rotation.y = baseRotY;
      merlon.castShadow = true;
      merlon.receiveShadow = true;

      const cap = new THREE.Mesh(merlonCapGeo, darkStoneMat);
      cap.position.set(0, 0.62, 0);
      merlon.add(cap);

      this.fortressGroup.add(merlon);
      this.merlonPieces.push({
        mesh: merlon,
        angle: mAngle,
        baseX,
        baseY,
        baseZ,
        baseRotY,
        outDist: 3.5 + (m % 5) * 1.4,
        tumbleSpeed: (m % 2 === 0 ? 1 : -1) * (1.8 + (m % 4) * 0.6)
      });
    }

    // 8 High-Detail Cylindrical Stone Flanking Watchtowers with Corbelled Parapets, Arrow Loops & Volumetric Fire Braziers
    this.watchTowerPieces = [];
    const watchTowerGeo = new THREE.CylinderGeometry(1.85, 2.25, 9.2, 16);
    const towerCrownGeo = new THREE.CylinderGeometry(2.12, 1.88, 1.1, 16);
    const brazierBowlGeo = new THREE.CylinderGeometry(0.95, 0.55, 0.65, 12);

    for (let t = 0; t < 8; t++) {
      const tAngle = (t * Math.PI * 2) / 8 + Math.PI / 8;
      const tx = Math.cos(tAngle) * 14.4;
      const tz = Math.sin(tAngle) * 14.4;

      const towerGroup = new THREE.Group();
      towerGroup.position.set(tx, 0, tz);

      const towerMesh = new THREE.Mesh(watchTowerGeo, stoneWallMat);
      towerMesh.position.set(0, 4.6, 0);
      towerMesh.castShadow = true;
      towerMesh.receiveShadow = true;
      towerGroup.add(towerMesh);

      const crownMesh = new THREE.Mesh(towerCrownGeo, darkStoneMat);
      crownMesh.position.set(0, 9.3, 0);
      crownMesh.castShadow = true;
      towerGroup.add(crownMesh);

      // Arrow slit facing outward on each Watchtower
      const tSlit = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.5, 0.35), slitMat);
      tSlit.position.set(Math.cos(tAngle) * 1.92, 5.8, Math.sin(tAngle) * 1.92);
      tSlit.rotation.y = -tAngle + Math.PI / 2;
      towerGroup.add(tSlit);

      const bowlMesh = new THREE.Mesh(brazierBowlGeo, darkStoneMat);
      bowlMesh.position.set(0, 10.0, 0);
      towerGroup.add(bowlMesh);

      // Volumetric Additive Fire Sprite (replaces geometric cone)
      const flameMat = new THREE.SpriteMaterial({
        map: this.fireGlowTex,
        color: 0xffaa33,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.95
      });
      const flameSprite = new THREE.Sprite(flameMat);
      flameSprite.position.set(0, 11.15, 0);
      flameSprite.scale.set(2.4, 3.3, 1);
      towerGroup.add(flameSprite);
      this.staticThermalEdgeMaterials.push(flameMat);

      this.fortressGroup.add(towerGroup);
      this.watchTowerPieces.push({
        group: towerGroup,
        angle: tAngle,
        baseX: tx,
        baseZ: tz,
        tiltSign: t % 2 === 0 ? 1 : -0.85
      });
    }

    // 3. Central Norman / Crusader Stone Keep (3 Stepped Masonry Tiers with Cornice Mouldings & Buttresses)
    this.keepTierPieces = [];
    for (let tier = 0; tier < 3; tier++) {
      const radius = 8.4 - tier * 1.85;
      const height = 3.3 - tier * 0.25;
      const baseY = tier * 3.0 + height / 2;
      const keepGeo = new THREE.CylinderGeometry(radius * 0.95, radius, height, 8);
      const keepMesh = new THREE.Mesh(keepGeo, stoneWallMat);
      keepMesh.position.y = baseY;
      keepMesh.castShadow = true;
      keepMesh.receiveShadow = true;

      // Projecting dark-stone cornice band atop each Keep tier
      const bandGeo = new THREE.CylinderGeometry(radius * 0.99, radius * 0.96, 0.36, 8);
      const bandMesh = new THREE.Mesh(bandGeo, darkStoneMat);
      bandMesh.position.y = height * 0.5 - 0.12;
      keepMesh.add(bandMesh);

      this.fortressGroup.add(keepMesh);
      this.keepTierPieces.push({
        mesh: keepMesh,
        tier,
        baseY
      });
    }

    // 4 Corner Keep Turrets with Realistic Dark Slate Conical Roofs (Destructible on 30s Breach)
    this.keepTurretPieces = [];
    const keepTurretGeo = new THREE.CylinderGeometry(1.42, 1.62, 11.4, 16);
    const keepRoofGeo = new THREE.ConeGeometry(1.88, 3.1, 16);
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x2c3038,
      normalMap: this.stoneTextures.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughnessMap: this.stoneTextures.roughnessMap,
      roughness: 0.62,
      metalness: 0.28
    });
    for (let k = 0; k < 4; k++) {
      const kAngle = (k * Math.PI) / 2 + Math.PI / 4;
      const kx = Math.cos(kAngle) * 5.8;
      const kz = Math.sin(kAngle) * 5.8;
      const turretGroup = new THREE.Group();
      turretGroup.position.set(kx, 0, kz);

      const turret = new THREE.Mesh(keepTurretGeo, stoneWallMat);
      turret.position.set(0, 5.7, 0);
      turret.castShadow = true;
      turret.receiveShadow = true;
      turretGroup.add(turret);

      const roof = new THREE.Mesh(keepRoofGeo, roofMat);
      roof.position.set(0, 12.8, 0);
      roof.castShadow = true;
      turretGroup.add(roof);

      this.fortressGroup.add(turretGroup);
      this.keepTurretPieces.push({
        group: turretGroup,
        roofMesh: roof,
        angle: kAngle,
        baseX: kx,
        baseZ: kz
      });
    }

    // 4. The Great Iron War Brazier & Volumetric Signal Pyre atop the Keep
    const greatBowlGeo = new THREE.CylinderGeometry(3.1, 1.8, 1.6, 16);
    const greatBowl = new THREE.Mesh(greatBowlGeo, darkStoneMat);
    greatBowl.position.y = 9.8;
    greatBowl.castShadow = true;
    this.fortressGroup.add(greatBowl);
    this.greatBowlMesh = greatBowl;

    // Sculpted glowing coal bed + volumetric fire billboard sprite for the Great Keep Pyre
    const coreGeo = new THREE.DodecahedronGeometry(1.85, 2);
    this.coreMat = new THREE.MeshStandardMaterial({
      color: 0xffaa33,
      emissive: 0xff5500,
      emissiveIntensity: 2.6,
      roughness: 0.4,
      metalness: 0.1
    });
    this.coreMesh = new THREE.Mesh(coreGeo, this.coreMat);
    this.coreMesh.position.y = 11.2;
    this.fortressGroup.add(this.coreMesh);

    this.coreFireSpriteMat = new THREE.SpriteMaterial({
      map: this.fireGlowTex,
      color: 0xffaa33,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.95
    });
    this.coreFireSprite = new THREE.Sprite(this.coreFireSpriteMat);
    this.coreFireSprite.position.set(0, 1.4, 0);
    this.coreFireSprite.scale.set(6.2, 8.4, 1);
    this.coreMesh.add(this.coreFireSprite);

    const coreShellGeo = new THREE.DodecahedronGeometry(2.1, 1);
    this.coreShellMat = new THREE.MeshBasicMaterial({
      color: 0xffd89b,
      wireframe: true,
      transparent: true,
      opacity: 0.04
    });
    this.coreShellMesh = new THREE.Mesh(coreShellGeo, this.coreShellMat);
    this.coreMesh.add(this.coreShellMesh);

    // Subtle Wrought-Iron Brazier Rings around the Keep Pyre
    this.gimbalRings = [];
    for (let i = 0; i < 3; i++) {
      const torusGeo = new THREE.TorusGeometry(3.8 + i * 0.95, 0.08, 10, 48);
      const torusMat = new THREE.MeshBasicMaterial({
        color: 0xb8860b,
        transparent: true,
        opacity: 0.22
      });
      const ring = new THREE.Mesh(torusGeo, torusMat);
      ring.position.y = 11.4;
      this.fortressGroup.add(ring);
      this.gimbalRings.push(ring);
      this.staticThermalEdgeMaterials.push(torusMat);
    }

    // Subtle Rising Heat Plume Column
    const beamGeo = new THREE.CylinderGeometry(0.6, 2.0, 38, 16, 1, true);
    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0xff7700,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.plasmaBeam = new THREE.Mesh(beamGeo, this.beamMat);
    this.plasmaBeam.position.y = 26;
    this.fortressGroup.add(this.plasmaBeam);

    // Subtle Heat Shimmer Aura (almost invisible until severe breach)
    const domeGeo = new THREE.IcosahedronGeometry(20.5, 2);
    this.shieldDomeMat = new THREE.MeshBasicMaterial({
      color: 0xe6c687,
      wireframe: true,
      transparent: true,
      opacity: 0.015,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.shieldDome = new THREE.Mesh(domeGeo, this.shieldDomeMat);
    this.shieldDome.position.y = 1.0;
    this.fortressGroup.add(this.shieldDome);

    // 5. Exploding Castle Stone Rubble Boulders & Fireball Detonation (Triggered when response times breach 30,000ms / 30s)
    const fireballGeo = new THREE.SphereGeometry(2.2, 24, 24);
    this.fireballMat = new THREE.MeshBasicMaterial({
      color: 0xff5500,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.explosionSphereMesh = new THREE.Mesh(fireballGeo, this.fireballMat);
    this.explosionSphereMesh.position.set(0, 7.5, 0);
    this.fortressGroup.add(this.explosionSphereMesh);

    const blastRingGeo = new THREE.RingGeometry(1.8, 3.6, 48);
    blastRingGeo.rotateX(-Math.PI / 2);
    this.blastRingMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.explosionRingMesh = new THREE.Mesh(blastRingGeo, this.blastRingMat);
    this.explosionRingMesh.position.set(0, 0.4, 0);
    this.fortressGroup.add(this.explosionRingMesh);

    this.explosionProgress = 0;

    const rubbleCount = 140;
    const rubbleGeo = new THREE.DodecahedronGeometry(0.85, 0);
    const rubbleMat = new THREE.MeshStandardMaterial({
      color: 0x8c857b,
      map: this.stoneTextures.map,
      normalMap: this.stoneTextures.normalMap,
      normalScale: new THREE.Vector2(1.3, 1.3),
      roughnessMap: this.stoneTextures.roughnessMap,
      roughness: 0.85,
      metalness: 0.12,
      emissive: 0x331100,
      emissiveIntensity: 0.2
    });
    this.rubbleMat = rubbleMat;
    this.rubbleMesh = new THREE.InstancedMesh(rubbleGeo, rubbleMat, rubbleCount);
    this.rubbleMesh.frustumCulled = false;
    this.rubbleMesh.castShadow = true;
    this.rubbleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fortressGroup.add(this.rubbleMesh);
    this.rubbleBlocks = [];
    for (let r = 0; r < rubbleCount; r++) {
      const angle = (r * 2.39996) % (Math.PI * 2);
      const startR = r % 2 === 0 ? 4.5 + (r % 5) * 1.4 : 13.0 + (r % 3) * 0.8;
      const startY = 2.5 + (r % 9) * 1.2;
      this.rubbleBlocks.push({
        angle,
        startR,
        startY,
        velOut: 14.0 + (r % 7) * 4.5,
        arcHeight: 11.0 + (r % 6) * 3.8,
        scale: 0.55 + (r % 5) * 0.32,
        rotSpeed: 2.2 + (r % 4) * 1.6
      });
    }
  }

  /**
   * Dynamically builds `count` (1..16) 3D Load Agent (Siege Legion) War Camps,
   * Roman Stone Causeways, and Medieval Fortress Gatehouses based on the actual Load Agents used.
   */
  setLoadAgentCount(count, agentNames = []) {
    const clamped = Math.max(1, Math.min(16, Math.round(Number(count) || 6)));
    this.numLoadAgents = clamped;
    if (Array.isArray(agentNames) && agentNames.length) {
      this.loadAgentNames = agentNames.slice(0, clamped);
    }
    this._rebuildDynamicLoadAgentsAndHighways(clamped);

    if (this.highwayBots) {
      this.highwayBots.forEach((b, idx) => {
        b.lane = idx % clamped;
      });
    }
    if (this.cavalryBots) {
      this.cavalryBots.forEach((c, idx) => {
        c.lane = idx % clamped;
      });
    }
    if (this.castleArrows) {
      this.castleArrows.forEach((a, idx) => {
        a.lane = idx % clamped;
      });
    }
    if (this.catapultBoulders) {
      this.catapultBoulders.forEach((cb, idx) => {
        cb.lane = idx % clamped;
      });
    }
    this.summaryStats = this._computeSummaryStats();
  }

  _rebuildDynamicLoadAgentsAndHighways(numAgents) {
    if (this.dynamicPerimeterGroup) {
      this.fortressGroup.remove(this.dynamicPerimeterGroup);
    }
    this.dynamicPerimeterGroup = new THREE.Group();
    this.fortressGroup.add(this.dynamicPerimeterGroup);

    this.dynamicThermalEdgeMaterials = [];
    this.bastionPylons = [];
    this.gateWorldPositions = [];
    this.loadAgentWorldPositions = [];
    this.loadAgentRings = [];
    this.loadAgentCores = [];
    this.catapultArms = [];
    this.gatehousePieces = [];

    const stoneMat = this.citadelBaseMat;
    const darkStoneMat = this.darkStoneMat;
    const campEarthMat = new THREE.MeshStandardMaterial({
      color: 0x3b3228,
      normalMap: this.terrainTextures.normalMap,
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughnessMap: this.terrainTextures.roughnessMap,
      roughness: 0.9,
      metalness: 0.08
    });
    const crimsonTentMat = new THREE.MeshStandardMaterial({
      color: 0x7c1d26,
      normalMap: this.terrainTextures.normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughness: 0.78,
      metalness: 0.08,
      emissive: 0x1a0408,
      emissiveIntensity: 0.15
    });
    const goldTrimMat = new THREE.MeshStandardMaterial({
      color: 0xb89758,
      roughness: 0.32,
      metalness: 0.88
    });
    const timberMat = new THREE.MeshStandardMaterial({
      color: 0x5c3c20,
      normalMap: this.stoneTextures.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.82,
      metalness: 0.08
    });
    const wheelMat = new THREE.MeshStandardMaterial({
      color: 0x3f3c38,
      roughness: 0.48,
      metalness: 0.72
    });
    const firePayloadMat = new THREE.MeshStandardMaterial({
      color: 0xffaa33,
      emissive: 0xff5500,
      emissiveIntensity: 2.2,
      roughness: 0.5
    });

    const gateRadius = 18;
    const laneLen = LOAD_AGENT_RADIUS - gateRadius;
    const midR = gateRadius + laneLen / 2;

    for (let i = 0; i < numAgents; i++) {
      const angle = (i * Math.PI * 2) / numAgents;
      const gx = Math.cos(angle) * gateRadius;
      const gz = Math.sin(angle) * gateRadius;
      this.gateWorldPositions.push(new THREE.Vector3(gx, 2.0, gz));

      // 1. Twin-Towered Medieval Stone Barbican Gatehouse at r = 18 (Destructible Towers, Bridge Lintel & Portcullis)
      const gateGroup = new THREE.Group();
      gateGroup.position.set(gx, 0, gz);
      gateGroup.rotation.y = -angle + Math.PI / 2;

      const gateTowerGeo = new THREE.CylinderGeometry(1.65, 1.92, 9.6, 16);
      const crenelGeo = new THREE.CylinderGeometry(1.98, 1.72, 0.95, 16);
      const towerPair = [];

      [-3.25, 3.25].forEach((offsetX, tSideIdx) => {
        const subTowerGroup = new THREE.Group();
        subTowerGroup.position.set(offsetX, 0, 0);

        const tower = new THREE.Mesh(gateTowerGeo, stoneMat);
        tower.position.set(0, 4.8, 0);
        tower.castShadow = true;
        tower.receiveShadow = true;
        subTowerGroup.add(tower);

        const crenel = new THREE.Mesh(crenelGeo, darkStoneMat);
        crenel.position.set(0, 9.7, 0);
        crenel.castShadow = true;
        subTowerGroup.add(crenel);

        // Volumetric Fire Brazier Sprite atop each Gatehouse Tower
        const flameMat = new THREE.SpriteMaterial({
          map: this.fireGlowTex,
          color: 0xffaa33,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          opacity: 0.92
        });
        const flame = new THREE.Sprite(flameMat);
        flame.position.set(0, 10.75, 0);
        flame.scale.set(1.9, 2.6, 1);
        subTowerGroup.add(flame);
        this.bastionPylons.push(flameMat);

        gateGroup.add(subTowerGroup);
        towerPair.push({
          group: subTowerGroup,
          baseX: offsetX,
          sideSign: tSideIdx === 0 ? -1 : 1
        });
      });

      // Fortified Stone Gatehouse Bridge Lintel & Forged Iron Portcullis Grate
      const lintelGeo = new THREE.BoxGeometry(8.2, 2.0, 2.1);
      const lintel = new THREE.Mesh(lintelGeo, stoneMat);
      lintel.position.set(0, 8.2, 0);
      lintel.castShadow = true;
      lintel.receiveShadow = true;
      gateGroup.add(lintel);

      const portcullisGroup = new THREE.Group();
      portcullisGroup.position.set(0, 6.1, 0);
      const portcullisBarGeo = new THREE.CylinderGeometry(0.055, 0.055, 3.4, 8);
      for (let p = -2.0; p <= 2.0; p += 0.66) {
        const bar = new THREE.Mesh(portcullisBarGeo, wheelMat);
        bar.position.set(p, 0, 0);
        portcullisGroup.add(bar);
      }
      // Horizontal iron crossbars on the portcullis
      const crossGrateGeo = new THREE.BoxGeometry(4.4, 0.09, 0.09);
      [-0.9, 0, 0.9].forEach((cy) => {
        const cBar = new THREE.Mesh(crossGrateGeo, wheelMat);
        cBar.position.set(0, cy, 0);
        portcullisGroup.add(cBar);
      });
      gateGroup.add(portcullisGroup);

      this.dynamicPerimeterGroup.add(gateGroup);
      this.gatehousePieces.push({
        towers: towerPair,
        lintel,
        portcullis: portcullisGroup,
        idx: i
      });

      // 2. Paved Roman Flagstone Siege Causeway connecting Load Agent Camp i -> Fortress Gatehouse i
      const laneGeo = new THREE.PlaneGeometry(5.6, laneLen);
      laneGeo.rotateX(-Math.PI / 2);
      const laneMat = new THREE.MeshStandardMaterial({
        color: 0x625d54,
        map: this.stoneTextures.map,
        normalMap: this.stoneTextures.normalMap,
        normalScale: new THREE.Vector2(1.25, 1.25),
        roughnessMap: this.stoneTextures.roughnessMap,
        roughness: 0.8,
        metalness: 0.1,
        envMapIntensity: 1.15,
        side: THREE.DoubleSide
      });
      const laneMesh = new THREE.Mesh(laneGeo, laneMat);
      laneMesh.position.set(Math.cos(angle) * midR, 0.03, Math.sin(angle) * midR);
      laneMesh.rotation.y = -angle + Math.PI / 2;
      laneMesh.receiveShadow = true;
      this.dynamicPerimeterGroup.add(laneMesh);

      // Raised Cut-Stone Kerb Stones along both sides of the Siege Road
      const railGeo = new THREE.BoxGeometry(0.36, 0.18, laneLen);
      const railMat = new THREE.MeshStandardMaterial({
        color: 0x6e685f,
        normalMap: this.stoneTextures.normalMap,
        normalScale: new THREE.Vector2(0.85, 0.85),
        roughness: 0.85,
        metalness: 0.1
      });

      [-2.85, 2.85].forEach((railOffset) => {
        const rail = new THREE.Mesh(railGeo, railMat);
        const perpAngle = angle + Math.PI / 2;
        rail.position.set(
          Math.cos(angle) * midR + Math.cos(perpAngle) * railOffset,
          0.09,
          Math.sin(angle) * midR + Math.sin(perpAngle) * railOffset
        );
        rail.rotation.y = -angle + Math.PI / 2;
        rail.receiveShadow = true;
        this.dynamicPerimeterGroup.add(rail);
      });

      // Standing Roadside Iron Siege Torches along the Causeway with Volumetric Fire Billboards
      const torchPostGeo = new THREE.CylinderGeometry(0.07, 0.09, 2.4, 8);
      for (let dist = 28; dist <= 70; dist += 14) {
        [-3.25, 3.25].forEach((sideOffset) => {
          const perpAngle = angle + Math.PI / 2;
          const tx = Math.cos(angle) * dist + Math.cos(perpAngle) * sideOffset;
          const tz = Math.sin(angle) * dist + Math.sin(perpAngle) * sideOffset;

          const post = new THREE.Mesh(torchPostGeo, timberMat);
          post.position.set(tx, 1.2, tz);
          post.castShadow = true;
          this.dynamicPerimeterGroup.add(post);

          const tFlameMat = new THREE.SpriteMaterial({
            map: this.fireGlowTex,
            color: 0xffaa33,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            transparent: true,
            opacity: 0.92
          });
          const tFlame = new THREE.Sprite(tFlameMat);
          tFlame.position.set(tx, 2.65, tz);
          tFlame.scale.set(1.1, 1.55, 1);
          this.dynamicPerimeterGroup.add(tFlame);
          this.dynamicThermalEdgeMaterials.push(tFlameMat);
        });
      }

      // 2b. Single Attacker 3D Siege Catapult (Heavy Oak & Forged Iron Onager) stationed alongside each Road
      const catChassisGeo = new THREE.BoxGeometry(2.3, 0.42, 3.5);
      const catWheelGeo = new THREE.CylinderGeometry(0.68, 0.68, 0.26, 16);
      catWheelGeo.rotateZ(Math.PI / 2);
      const catStanchionGeo = new THREE.BoxGeometry(0.28, 2.3, 0.34);
      const catCrossbarGeo = new THREE.CylinderGeometry(0.22, 0.22, 2.5, 10);
      catCrossbarGeo.rotateZ(Math.PI / 2);
      const catArmBeamGeo = new THREE.BoxGeometry(0.24, 3.6, 0.24);
      const catSpoonGeo = new THREE.CylinderGeometry(0.55, 0.36, 0.34, 12);
      const catBoulderGeo = new THREE.DodecahedronGeometry(0.46, 1);

      const catDist = 52;
      const sideOffset = -5.2;
      const perpAngle = angle + Math.PI / 2;
      const cx = Math.cos(angle) * catDist + Math.cos(perpAngle) * sideOffset;
      const cz = Math.sin(angle) * catDist + Math.sin(perpAngle) * sideOffset;

      const catGroup = new THREE.Group();
      catGroup.position.set(cx, 0, cz);
      catGroup.rotation.y = -angle - Math.PI / 2;

      const chassis = new THREE.Mesh(catChassisGeo, timberMat);
      chassis.position.set(0, 0.68, 0);
      chassis.castShadow = true;
      chassis.receiveShadow = true;
      catGroup.add(chassis);

      [
        [-1.25, 0.68, 1.15],
        [1.25, 0.68, 1.15],
        [-1.25, 0.68, -1.15],
        [1.25, 0.68, -1.15]
      ].forEach(([wx, wy, wz]) => {
        const wheel = new THREE.Mesh(catWheelGeo, wheelMat);
        wheel.position.set(wx, wy, wz);
        wheel.castShadow = true;
        catGroup.add(wheel);
      });

      [-0.95, 0.95].forEach((sx) => {
        const stanchion = new THREE.Mesh(catStanchionGeo, timberMat);
        stanchion.position.set(sx, 1.75, 0.45);
        stanchion.castShadow = true;
        catGroup.add(stanchion);
      });
      const crossbar = new THREE.Mesh(catCrossbarGeo, wheelMat);
      crossbar.position.set(0, 2.65, 0.45);
      catGroup.add(crossbar);

      const armPivot = new THREE.Group();
      armPivot.position.set(0, 1.1, 0.35);

      const armBeam = new THREE.Mesh(catArmBeamGeo, timberMat);
      armBeam.position.set(0, 1.65, 0);
      armBeam.castShadow = true;
      armPivot.add(armBeam);

      const spoon = new THREE.Mesh(catSpoonGeo, wheelMat);
      spoon.rotation.x = Math.PI / 2;
      spoon.position.set(0, 3.35, -0.18);
      armPivot.add(spoon);

      const loadedFireball = new THREE.Mesh(catBoulderGeo, firePayloadMat);
      loadedFireball.position.set(0, 3.35, -0.34);
      armPivot.add(loadedFireball);

      catGroup.add(armPivot);
      this.dynamicPerimeterGroup.add(catGroup);

      this.catapultArms.push({
        pivot: armPivot,
        fireball: loadedFireball,
        phaseOffset: (i * 1.37) % (Math.PI * 2),
        cycleSpeed: 0.65 + (i % 3) * 0.14
      });

      // 3. Outer 3D Load Agent (Siege Legion) Fortified War Encampment at r = LOAD_AGENT_RADIUS
      const ax = Math.cos(angle) * LOAD_AGENT_RADIUS;
      const az = Math.sin(angle) * LOAD_AGENT_RADIUS;
      this.loadAgentWorldPositions.push(new THREE.Vector3(ax, 12.5, az));

      const agentGroup = new THREE.Group();
      agentGroup.position.set(ax, 0, az);
      agentGroup.rotation.y = -angle + Math.PI / 2;

      // Earthen Timber-Walet Palisade Earthwork Mound
      const padGeo = new THREE.CylinderGeometry(5.6, 6.8, 1.5, 16);
      const padMesh = new THREE.Mesh(padGeo, campEarthMat);
      padMesh.position.y = 0.75;
      padMesh.receiveShadow = true;
      padMesh.castShadow = true;
      agentGroup.add(padMesh);

      // Medieval Canvas Command Pavilion Tent
      const tentBaseGeo = new THREE.CylinderGeometry(3.4, 3.8, 2.7, 8);
      const tentBase = new THREE.Mesh(tentBaseGeo, crimsonTentMat);
      tentBase.position.y = 2.85;
      tentBase.castShadow = true;
      tentBase.receiveShadow = true;
      agentGroup.add(tentBase);

      const tentRoofGeo = new THREE.ConeGeometry(3.9, 3.1, 8);
      const tentRoof = new THREE.Mesh(tentRoofGeo, crimsonTentMat);
      tentRoof.position.y = 5.75;
      tentRoof.castShadow = true;
      agentGroup.add(tentRoof);

      // Aged Bronze Legion Aquila / Shield Standard atop the Command Pavilion
      const poleGeo = new THREE.CylinderGeometry(0.09, 0.11, 4.5, 8);
      const poleMesh = new THREE.Mesh(poleGeo, timberMat);
      poleMesh.position.y = 8.4;
      agentGroup.add(poleMesh);

      const standardShieldGeo = new THREE.CylinderGeometry(1.25, 1.25, 0.18, 18);
      standardShieldGeo.rotateX(Math.PI / 2);
      const standardMesh = new THREE.Mesh(standardShieldGeo, goldTrimMat);
      standardMesh.position.set(0, 10.1, 0);
      standardMesh.castShadow = true;
      agentGroup.add(standardMesh);
      this.loadAgentCores.push(standardMesh);

      // Timber Siege Camp Gate Frame in front of the Camp
      const portalGeo = new THREE.TorusGeometry(2.8, 0.14, 8, 24);
      const portalMat = new THREE.MeshStandardMaterial({
        color: 0x8c6d3f,
        roughness: 0.5,
        metalness: 0.7
      });
      const portalRing = new THREE.Mesh(portalGeo, portalMat);
      portalRing.position.set(0, 3.4, -3.8);
      agentGroup.add(portalRing);
      this.loadAgentRings.push(portalRing);

      this.dynamicPerimeterGroup.add(agentGroup);
    }
  }

  _initBotSwarms() {
    const soldierGeo = createAncientSoldierGeometry();
    const cavalryGeo = createMountedKnightGeometry();
    const arrowGeo = createFlamingArrowGeometry();
    const boulderGeo = createCatapultBoulderGeometry();

    // Realistic PBR forged bronze & steel armor material with environment specular reflections
    this.highwayBotMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.42,
      metalness: 0.58,
      emissive: 0x120c06,
      emissiveIntensity: 0.14
    });

    // 1. Foot Soldiers (Spartan/Roman Heavy Infantry with Shields & Spears)
    this.highwayBotMesh = new THREE.InstancedMesh(soldierGeo, this.highwayBotMat, MAX_HIGHWAY_BOTS);
    this.highwayBotMesh.frustumCulled = false;
    this.highwayBotMesh.castShadow = true;
    this.highwayBotMesh.receiveShadow = true;
    this.highwayBotMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.highwayBotMesh);

    this.highwayBots = [];
    const dummyColor = new THREE.Color(0xffffff);
    for (let i = 0; i < MAX_HIGHWAY_BOTS; i++) {
      const lane = i % this.numLoadAgents;
      const rankCol = (i % 3) - 1; // Center 3 ranks for foot phalanx
      this.highwayBots.push({
        lane,
        distance: 18 + Math.random() * (LOAD_AGENT_RADIUS - 18),
        laneOffset: rankCol * 0.92 + (Math.random() - 0.5) * 0.18,
        stridePhase: Math.random() * Math.PI * 2,
        speedFactor: 0.88 + Math.random() * 0.24,
        isErrorBot: false
      });
      this.highwayBotMesh.setColorAt(i, dummyColor);
    }

    // 2. Mounted Knights on Warhorses (Heavy Cavalry charging along the outer wings of each lane)
    this.cavalryBotMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.36,
      metalness: 0.64,
      emissive: 0x120c06,
      emissiveIntensity: 0.16
    });
    this.cavalryBotMesh = new THREE.InstancedMesh(cavalryGeo, this.cavalryBotMat, MAX_CAVALRY_BOTS);
    this.cavalryBotMesh.frustumCulled = false;
    this.cavalryBotMesh.castShadow = true;
    this.cavalryBotMesh.receiveShadow = true;
    this.cavalryBotMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.cavalryBotMesh);

    this.cavalryBots = [];
    for (let i = 0; i < MAX_CAVALRY_BOTS; i++) {
      const lane = i % this.numLoadAgents;
      const wing = i % 2 === 0 ? -1 : 1;
      this.cavalryBots.push({
        lane,
        distance: 18 + Math.random() * (LOAD_AGENT_RADIUS - 18),
        laneOffset: wing * (1.75 + (i % 3) * 0.26),
        gallopPhase: Math.random() * Math.PI * 2,
        speedFactor: 1.28 + Math.random() * 0.28,
        isErrorBot: false
      });
      this.cavalryBotMesh.setColorAt(i, dummyColor);
    }

    // 3. Inner Fortress Courtyard Siege Melee Soldiers & Mounted Knights (Queue around the Keep)
    this.queueBotMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.42,
      metalness: 0.58,
      emissive: 0x120c06,
      emissiveIntensity: 0.14
    });
    this.queueBotMesh = new THREE.InstancedMesh(soldierGeo, this.queueBotMat, MAX_QUEUE_BOTS);
    this.queueBotMesh.frustumCulled = false;
    this.queueBotMesh.castShadow = true;
    this.queueBotMesh.receiveShadow = true;
    this.queueBotMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.queueBotMesh);

    this.queueBots = [];
    for (let i = 0; i < MAX_QUEUE_BOTS; i++) {
      this.queueBots.push({
        angle: Math.random() * Math.PI * 2,
        radius: 8.4 + Math.random() * 5.6,
        altitude: 0.45,
        orbitSpeed: (0.28 + Math.random() * 0.35) * (i % 2 === 0 ? 1 : -1),
        verticalPhase: Math.random() * Math.PI * 2
      });
      this.queueBotMesh.setColorAt(i, dummyColor);
    }

    this.cavalryQueueCount = 24;
    this.cavalryQueueMesh = new THREE.InstancedMesh(cavalryGeo, this.cavalryBotMat, this.cavalryQueueCount);
    this.cavalryQueueMesh.frustumCulled = false;
    this.cavalryQueueMesh.castShadow = true;
    this.cavalryQueueMesh.receiveShadow = true;
    this.cavalryQueueMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.cavalryQueueMesh);

    this.cavalryQueueBots = [];
    for (let i = 0; i < this.cavalryQueueCount; i++) {
      this.cavalryQueueBots.push({
        angle: Math.random() * Math.PI * 2,
        radius: 9.2 + Math.random() * 5.2,
        altitude: 0.45,
        orbitSpeed: (0.45 + Math.random() * 0.45) * (i % 2 === 0 ? 1 : -1),
        gallopPhase: Math.random() * Math.PI * 2
      });
      this.cavalryQueueMesh.setColorAt(i, dummyColor);
    }

    // 4. Castle Defensive Flaming Arrow Volleys (Launched from Castle Towers & Walls outward at Attackers)
    this.castleArrowMat = new THREE.MeshBasicMaterial({
      vertexColors: true
    });
    this.castleArrowMesh = new THREE.InstancedMesh(arrowGeo, this.castleArrowMat, MAX_CASTLE_ARROWS);
    this.castleArrowMesh.frustumCulled = false;
    this.castleArrowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.castleArrowMesh);

    this.castleArrows = [];
    for (let i = 0; i < MAX_CASTLE_ARROWS; i++) {
      this.castleArrows.push({
        lane: i % this.numLoadAgents,
        progress: Math.random(),
        speed: 0.55 + Math.random() * 0.55,
        startR: 6.5 + (i % 4) * 2.4,
        startY: 8.5 + (i % 5) * 1.4,
        targetR: 22.0 + Math.random() * 52.0,
        laneOffset: (Math.random() - 0.5) * 5.2,
        arcHeight: 9.5 + Math.random() * 11.5
      });
      this.castleArrowMesh.setColorAt(i, dummyColor);
    }

    // 5. Attacker Catapult Flaming Siege Boulders (Hurled from Siege Catapults into the Castle Walls & Keep)
    this.catapultBoulderMat = new THREE.MeshBasicMaterial({
      vertexColors: true
    });
    this.catapultBoulderMesh = new THREE.InstancedMesh(boulderGeo, this.catapultBoulderMat, MAX_CATAPULT_BOULDERS);
    this.catapultBoulderMesh.frustumCulled = false;
    this.catapultBoulderMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.catapultBoulderMesh);

    this.catapultBoulders = [];
    for (let i = 0; i < MAX_CATAPULT_BOULDERS; i++) {
      this.catapultBoulders.push({
        lane: i % this.numLoadAgents,
        progress: Math.random(),
        speed: 0.38 + Math.random() * 0.28,
        startR: 52,
        sideOffset: -5.2,
        startY: 4.2,
        targetR: 3.5 + Math.random() * 13.5,
        targetY: 3.5 + Math.random() * 8.5,
        arcHeight: 14.0 + Math.random() * 13.0
      });
      this.catapultBoulderMesh.setColorAt(i, dummyColor);
    }
  }

  _initThermalParticles() {
    const particleGeo = new THREE.DodecahedronGeometry(0.24, 0);
    this.thermalParticleMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      blending: THREE.AdditiveBlending
    });
    this.thermalParticleMesh = new THREE.InstancedMesh(
      particleGeo,
      this.thermalParticleMat,
      MAX_THERMAL_PARTICLES
    );
    this.thermalParticleMesh.frustumCulled = false;
    this.thermalParticleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.thermalParticleMesh);

    this.thermalParticles = [];
    const c = new THREE.Color(0xffaa00);
    for (let i = 0; i < MAX_THERMAL_PARTICLES; i++) {
      const r = 1.5 + Math.random() * 14.5;
      const theta = Math.random() * Math.PI * 2;
      this.thermalParticles.push({
        r,
        theta,
        y: Math.random() * 34,
        speedY: 3.5 + Math.random() * 8.0,
        swirl: (Math.random() - 0.5) * 1.8
      });
      this.thermalParticleMesh.setColorAt(i, c);
    }
  }

  _bindPointerControls() {
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;

    this.masterCanvas.addEventListener('pointerdown', (e) => {
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      this.masterCanvas.setPointerCapture(e.pointerId);
    });

    this.masterCanvas.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      if (e.shiftKey || e.buttons === 2) {
        this.orbitAngleDeg = Math.max(-180, Math.min(180, Math.round(this.orbitAngleDeg - dx * 0.35)));
      } else {
        this.fortressPosX = Math.max(-45, Math.min(45, Math.round((this.fortressPosX - dx * 0.12) * 10) / 10));
        this.fortressPosY = Math.max(-30, Math.min(40, Math.round((this.fortressPosY + dy * 0.12) * 10) / 10));
      }
      if (typeof this.onViewChange === 'function') this.onViewChange();
    });

    this.masterCanvas.addEventListener('pointerup', (e) => {
      isDragging = false;
      try {
        this.masterCanvas.releasePointerCapture(e.pointerId);
      } catch (_) {}
    });

    this.masterCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomDistance = Math.max(22, Math.min(125, Math.round(this.zoomDistance + e.deltaY * 0.05)));
      if (typeof this.onViewChange === 'function') this.onViewChange();
    }, { passive: false });
  }

  resetView() {
    this.zoomDistance = 68;
    this.fortressPosX = 0;
    this.fortressPosY = 0;
    this.orbitAngleDeg = 25;
    if (typeof this.onViewChange === 'function') this.onViewChange();
  }

  setNoDataState(message = 'NO DATA — CONNECT INFLUXDB 1.8 / GRAFANA TO MUSTER THE LEGIONS') {
    this.hasData = false;
    this.noDataMessage = message;
    this.testTitle = 'NO DATA';
    this.sourceLabel = 'NO INFLUXDB 1.8 DATA LOADED';
    this.allFrames = [];
    this.summaryStats = null;
    this.showSummaryOverlay = false;
    this.currentFrame = {
      noData: true,
      index: 0,
      elapsedSec: 0,
      vus: 0,
      rps: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      errorRate: 0,
      failedReqs: 0,
      checksPassRate: 0
    };
    this.thermal = computeThermalState(this.currentFrame, this.thresholds);
  }

  setDataset(frames, metadata = {}) {
    if (!frames || !frames.length) {
      this.setNoDataState(metadata.noDataMessage);
      return;
    }
    this.hasData = true;
    this.allFrames = frames;
    if (metadata.title) this.testTitle = metadata.title.toUpperCase();
    if (metadata.sourceLabel) this.sourceLabel = metadata.sourceLabel.toUpperCase();
    if (metadata.sutName) this.sutName = metadata.sutName.toUpperCase();
    if (metadata.endpoints && metadata.endpoints.length) {
      this.endpoints = metadata.endpoints.slice(0, 16);
    }
    if (metadata.numLoadAgents) {
      this.setLoadAgentCount(metadata.numLoadAgents, metadata.loadAgentNames || []);
    }
    this.showSummaryOverlay = false;
    this.summaryStats = this._computeSummaryStats();
    this.setFrameData(this.isLiveMode ? this.allFrames[this.allFrames.length - 1] : this.allFrames[0]);
  }

  updateLiveFrames(frames, metadata = {}) {
    if (!frames || !frames.length) {
      this.setNoDataState(metadata.noDataMessage || 'NO LIVE DATA — AWAITING ACTIVE K6 SIEGE IN INFLUXDB');
      return;
    }
    this.hasData = true;
    this.allFrames = frames;
    if (metadata.title) this.testTitle = metadata.title.toUpperCase();
    if (metadata.sourceLabel) this.sourceLabel = metadata.sourceLabel.toUpperCase();
    if (metadata.endpoints && metadata.endpoints.length) {
      this.endpoints = metadata.endpoints.slice(0, 16);
    }
    if (metadata.numLoadAgents && metadata.numLoadAgents !== this.numLoadAgents) {
      this.setLoadAgentCount(metadata.numLoadAgents, metadata.loadAgentNames || []);
    }
    this.summaryStats = this._computeSummaryStats();
    this.setFrameData(this.allFrames[this.allFrames.length - 1]);
  }

  setThresholds(thresholds) {
    this.thresholds = { ...this.thresholds, ...thresholds };
    this.thermal = computeThermalState(this.currentFrame, this.thresholds);
    this.summaryStats = this._computeSummaryStats();
  }

  setFrameData(frame) {
    if (!frame) return;
    this.currentFrame = frame;
    this.thermal = computeThermalState(frame, this.thresholds);
  }

  _getAgentWeights(n) {
    const raw = [];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const w = 1.0 - (i / Math.max(1, n * 2.8));
      raw.push(w);
      sum += w;
    }
    return raw.map((w) => w / sum);
  }

  _computeSummaryStats() {
    const frames = this.allFrames || [];
    if (!frames.length) return null;

    let totalReqs = 0;
    let totalFailed = 0;
    let maxVus = 0;
    let peakRps = 0;
    let sumRps = 0;
    let sumP50 = 0;
    let sumP95 = 0;
    let peakP95 = 0;
    let peakP99 = 0;
    let peakErrorRate = 0;
    let maxCoreTempC = 38;

    const bucketSec = frames.length > 1
      ? Math.max(1, (frames[frames.length - 1].elapsedSec - frames[0].elapsedSec) / (frames.length - 1))
      : 1;

    frames.forEach((f) => {
      totalReqs += Math.round((f.rps || 0) * bucketSec);
      totalFailed += Math.round((f.failedReqs || 0) * bucketSec);
      if (f.vus > maxVus) maxVus = f.vus;
      if (f.rps > peakRps) peakRps = f.rps;
      sumRps += f.rps || 0;
      sumP50 += f.p50 || 0;
      sumP95 += f.p95 || 0;
      if (f.p95 > peakP95) peakP95 = f.p95;
      if (f.p99 > peakP99) peakP99 = f.p99;
      if (f.errorRate > peakErrorRate) peakErrorRate = f.errorRate;

      const tState = computeThermalState(f, this.thresholds);
      if (tState.coreTempC > maxCoreTempC) maxCoreTempC = tState.coreTempC;
    });

    const n = frames.length;
    const avgRps = Math.round(sumRps / n);
    const avgP50 = Math.round(sumP50 / n);
    const avgP95 = Math.round(sumP95 / n);
    const overallErrorPct = totalReqs > 0 ? Number(((totalFailed / totalReqs) * 100).toFixed(2)) : 0;
    const durationSec = frames[frames.length - 1].elapsedSec || n;

    let verdict = 'VICTORY // FORTRESS WALLS HELD';
    let verdictColor = '#10b981';
    if (peakP95 >= 30000 || peakP99 >= 30000) {
      verdict = '💥 CASTLE EXPLODED // >30s BREACH';
      verdictColor = '#f43f5e';
    } else if (peakP95 >= this.thresholds.criticalMs || peakErrorRate >= 5.0) {
      verdict = 'THIS IS SPARTA! // FORTRESS BREACHED';
      verdictColor = '#f43f5e';
    } else if (peakP95 >= this.thresholds.nominalMs || peakErrorRate >= 1.0) {
      verdict = 'HEAVY SIEGE // SHIELDS STRAINED';
      verdictColor = '#f59e0b';
    }

    const numAgents = this.numLoadAgents;
    const weights = this._getAgentWeights(numAgents);
    const agentBreakdown = [];
    for (let i = 0; i < numAgents; i++) {
      const w = weights[i];
      const customRunnerName = this.loadAgentNames[i];
      const ep = this.endpoints[i % this.endpoints.length] || `/api/stream-${i + 1}`;
      const cleanRunner = customRunnerName
        ? (customRunnerName.length > 18 ? `${customRunnerName.slice(0, 17)}…` : customRunnerName)
        : '';
      agentBreakdown.push({
        agentId: cleanRunner
          ? `LEGION ${String(i + 1).padStart(2, '0')} · ${cleanRunner}`
          : `LEGION-AGENT-${String(i + 1).padStart(2, '0')}`,
        endpoint: ep,
        peakVus: Math.max(1, Math.round(maxVus * w)),
        totalReqs: Math.round(totalReqs * w),
        peakRps: Math.round(peakRps * w),
        avgP95: Math.round(avgP95 * (0.9 + (i % 4) * 0.04)),
        errorPct: Number((overallErrorPct * (0.88 + (i % 3) * 0.12)).toFixed(2))
      });
    }

    return {
      durationSec,
      totalReqs,
      totalFailed,
      maxVus,
      peakRps,
      avgRps,
      avgP50,
      avgP95,
      peakP95,
      peakP99,
      peakErrorRate: Number(peakErrorRate.toFixed(2)),
      overallErrorPct,
      maxCoreTempC,
      verdict,
      verdictColor,
      agentBreakdown
    };
  }

  _spawnErrorShockwave() {
    const lane = Math.floor(Math.random() * this.numLoadAgents);
    const angle = (lane * Math.PI * 2) / this.numLoadAgents + (Math.random() - 0.5) * 0.4;
    const hitPos = new THREE.Vector3(
      Math.cos(angle) * 18.2,
      4.5 + Math.random() * 6,
      Math.sin(angle) * 18.2
    );

    const ringGeo = new THREE.RingGeometry(0.45, 1.1, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff2200,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending
    });
    const mesh = new THREE.Mesh(ringGeo, ringMat);
    mesh.position.copy(hitPos);
    mesh.lookAt(0, 6, 0);
    this.scene.add(mesh);

    this.shockwaves.push({
      mesh,
      mat: ringMat,
      age: 0,
      maxAge: 0.65
    });
  }

  updateAndRender(dt, isSimulating = true) {
    const frameDt = Math.min(0.1, Math.max(0.001, dt));
    const safeDt = isSimulating ? frameDt : 0;
    this.clockTime += safeDt;

    const targetHeat = this.thermal.heat;
    const targetBreach = this.thermal.breachFracture || 0;
    this.smoothedHeat += (targetHeat - this.smoothedHeat) * Math.min(1, frameDt * 5.0);
    this.smoothedBreach += (targetBreach - this.smoothedBreach) * Math.min(1, frameDt * 4.2);
    this.smoothedRps += ((this.currentFrame.rps || 0) - this.smoothedRps) * Math.min(1, frameDt * 6.0);
    this.smoothedVus += ((this.currentFrame.vus || 0) - this.smoothedVus) * Math.min(1, frameDt * 6.0);
    this.smoothedP95 += ((this.currentFrame.p95 || 0) - this.smoothedP95) * Math.min(1, frameDt * 6.0);

    const heat = this.smoothedHeat;
    const breach = this.smoothedBreach;

    // Color of the Fortress braziers & fire scales from Champagne Gold -> Blazing Orange -> Blood Crimson
    const thermalColor = new THREE.Color();
    if (heat < 0.33) {
      thermalColor.lerpColors(new THREE.Color(0xe6c687), new THREE.Color(0xff9900), heat / 0.33);
    } else if (heat < 0.72) {
      thermalColor.lerpColors(new THREE.Color(0xff9900), new THREE.Color(0xff3300), (heat - 0.33) / 0.39);
    } else {
      thermalColor.lerpColors(new THREE.Color(0xff3300), new THREE.Color(0xff1e42), (heat - 0.72) / 0.28);
    }

    // 1. Update Central Keep War Brazier Flame & Lighting
    const flicker = 1 + Math.sin(this.clockTime * (7 + heat * 16)) * (0.06 + heat * 0.16);
    const coreScale = (1 + heat * 0.55 + breach * 0.85) * flicker;
    this.coreMesh.scale.set(1 + heat * 0.3 + breach * 0.65, coreScale, 1 + heat * 0.3 + breach * 0.65);
    this.coreMesh.position.y = 12.4 - breach * 3.1;
    this.coreMesh.rotation.y += safeDt * (0.8 + heat * 3.2 + breach * 4.0);

    if (this.greatBowlMesh) {
      this.greatBowlMesh.position.y = 9.6 - breach * 3.2;
      this.greatBowlMesh.rotation.z = breach * 0.32;
    }

    this.coreMat.color.copy(thermalColor);
    this.coreMat.emissive.copy(thermalColor);
    this.coreMat.emissiveIntensity = 1.6 + heat * 2.8 + breach * 2.5;
    if (this.coreFireSpriteMat) {
      this.coreFireSpriteMat.color.copy(thermalColor);
    }
    if (this.bloomPass) {
      this.bloomPass.strength = 0.30 + heat * 0.18 + breach * 0.22;
    }

    this.coreLight.color.copy(thermalColor);
    this.coreLight.intensity = 12.0 + heat * 16.0 + breach * 14.0;

    this.citadelBaseMat.emissive.copy(thermalColor);
    this.citadelBaseMat.emissiveIntensity = 0.04 + Math.pow(heat, 1.8) * 0.28 + breach * 0.45;

    // 1b. Animate Structural Castle Fracture & Full Detonation Explosion when Response Times breach 30s (30,000 ms)
    if (this.thermal.castleBroken) {
      this.explosionProgress = Math.min(1, this.explosionProgress + frameDt * 1.45);
    } else {
      this.explosionProgress = Math.max(0, this.explosionProgress - frameDt * 2.5);
    }
    const exp = this.explosionProgress;

    // 3D Fireball Blast Sphere & Ground Shockwave Ring
    if (this.explosionSphereMesh && this.fireballMat) {
      if (exp > 0.01) {
        const pulse = 1 + Math.sin(this.clockTime * 16) * 0.14;
        const sphereScale = (1 + exp * 8.5) * pulse;
        this.explosionSphereMesh.scale.setScalar(sphereScale);
        this.fireballMat.color.setHex(exp < 0.35 ? 0xffffff : 0xff4400);
        this.fireballMat.opacity = Math.max(0.18, (1 - exp * 0.65) * 0.85);
      } else {
        this.fireballMat.opacity = 0;
        this.explosionSphereMesh.scale.setScalar(0.01);
      }
    }

    if (this.explosionRingMesh && this.blastRingMat) {
      if (exp > 0.01) {
        const waveCycle = (this.clockTime * 1.35) % 1;
        this.explosionRingMesh.scale.setScalar(1 + waveCycle * 18.0);
        this.blastRingMat.opacity = (1 - waveCycle) * 0.9 * Math.min(1, exp * 2.5);
      } else {
        this.blastRingMat.opacity = 0;
      }
    }

    const quakeJitter = isSimulating && breach > 0.2 ? Math.sin(this.clockTime * 38) * breach * 0.22 : 0;

    // 16 Outer Curtain Wall Slabs crack apart, blast outward/inward, and topple flat onto the ground
    if (this.wallSegmentPieces) {
      this.wallSegmentPieces.forEach((ws, idx) => {
        const radialShift = (breach * 1.8 + exp * ws.outSpeed) * ws.fallDir;
        const arcLift = Math.sin(exp * Math.PI) * 3.8;
        const curR = 14.2 + radialShift;
        const curY = Math.max(0.65, ws.baseY - breach * 1.35 - exp * 2.35 + arcLift + quakeJitter);
        ws.mesh.position.set(
          Math.cos(ws.angle) * curR,
          curY,
          Math.sin(ws.angle) * curR
        );
        const fallAngle = (breach * 0.42 + exp * 1.38) * ws.fallDir;
        ws.mesh.rotation.order = 'YXZ';
        ws.mesh.rotation.set(
          fallAngle,
          ws.baseRotY + (breach * 0.15 + exp * 0.55) * ws.twistSign,
          (breach * 0.18 + exp * 0.48) * ws.twistSign
        );
      });
    }

    // N Outer Fortress Gatehouses: Towers split & topple sideways while stone lintel bridge crashes down
    if (this.gatehousePieces) {
      this.gatehousePieces.forEach((gh, gIdx) => {
        const gDir = gIdx % 2 === 0 ? 1 : -1;
        gh.towers.forEach((tw) => {
          const shiftX = tw.baseX + tw.sideSign * (breach * 1.35 + exp * 5.8);
          const shiftZ = tw.sideSign * (breach * 0.6 + exp * 3.2) * gDir;
          const dropY = -(breach * 1.1 + exp * 3.4) + Math.sin(exp * Math.PI) * 3.2;
          tw.group.position.set(shiftX, dropY + quakeJitter, shiftZ);
          tw.group.rotation.set(
            (breach * 0.22 + exp * 0.85) * gDir,
            tw.sideSign * exp * 0.65,
            -tw.sideSign * (breach * 0.38 + exp * 1.32)
          );
        });
        if (gh.lintel) {
          gh.lintel.position.set(
            gDir * (breach * 0.8 + exp * 3.4),
            Math.max(0.85, 8.2 - breach * 3.1 - exp * 7.2 + Math.sin(exp * Math.PI) * 4.5),
            breach * 0.9 + exp * 4.2
          );
          gh.lintel.rotation.set(
            breach * 0.45 + exp * 1.35,
            gDir * (breach * 0.3 + exp * 0.95),
            gDir * (breach * 0.38 + exp * 0.78)
          );
        }
        if (gh.portcullis) {
          gh.portcullis.position.set(
            -gDir * (breach * 0.6 + exp * 2.8),
            Math.max(0.5, 6.2 - breach * 2.8 - exp * 6.0),
            -(breach * 0.7 + exp * 3.1)
          );
          gh.portcullis.rotation.set(
            -(breach * 0.5 + exp * 1.42),
            0,
            gDir * (breach * 0.35 + exp * 0.9)
          );
        }
      });
    }

    if (this.merlonPieces) {
      this.merlonPieces.forEach((mp) => {
        const blastR = 14.2 + breach * mp.outDist + exp * (mp.outDist * 4.2);
        const arcLift = Math.sin(breach * Math.PI) * 2.4 + Math.sin(exp * Math.PI) * 14.0;
        const curY = Math.max(0.55, mp.baseY - (breach * 2.8 + exp * 6.1) + arcLift);
        mp.mesh.position.set(
          Math.cos(mp.angle) * blastR,
          curY,
          Math.sin(mp.angle) * blastR
        );
        const spin = breach * mp.tumbleSpeed + exp * mp.tumbleSpeed * 5.5;
        mp.mesh.rotation.set(
          spin * 1.6,
          mp.baseRotY + spin,
          spin * 1.2
        );
      });
    }

    if (this.watchTowerPieces) {
      this.watchTowerPieces.forEach((wt, idx) => {
        const radialShift = breach * 1.8 + exp * (12.5 + (idx % 3) * 4.0);
        const liftArc = Math.sin(exp * Math.PI) * (5.5 + (idx % 2) * 3.0);
        const sinkY = -breach * 1.4 - exp * 3.6 + liftArc;
        wt.group.position.set(
          wt.baseX + Math.cos(wt.angle) * radialShift,
          sinkY + quakeJitter,
          wt.baseZ + Math.sin(wt.angle) * radialShift
        );
        const tiltAmt = (breach * 0.42 + exp * 1.42) * wt.tiltSign;
        wt.group.rotation.set(
          Math.sin(wt.angle) * tiltAmt,
          exp * 1.2 * wt.tiltSign,
          -Math.cos(wt.angle) * tiltAmt
        );
      });
    }

    if (this.keepTierPieces) {
      this.keepTierPieces.forEach((kt) => {
        const tierFactor = kt.tier + 1;
        const dir = kt.tier % 2 === 0 ? 1 : -1;
        const expOut = exp * (3.8 + kt.tier * 4.6);
        const expLift = Math.sin(exp * Math.PI) * (tierFactor * 4.8);
        kt.mesh.position.set(
          dir * (breach * tierFactor * 0.85 + expOut),
          Math.max(0.55, kt.baseY - breach * 1.2 - exp * (2.6 + kt.tier * 2.8) + expLift + quakeJitter),
          -dir * (breach * tierFactor * 0.75 + expOut * 0.9)
        );
        kt.mesh.rotation.set(
          (breach * 0.26 + exp * 1.42) * dir,
          (breach * 0.32 + exp * 2.1) * dir,
          -(breach * 0.28 + exp * 1.38) * dir
        );
      });
    }

    if (this.keepTurretPieces) {
      this.keepTurretPieces.forEach((tur, idx) => {
        const outShift = breach * 2.2 + exp * 16.5;
        const turLift = Math.sin(exp * Math.PI) * 7.5;
        tur.group.position.set(
          tur.baseX + Math.cos(tur.angle) * outShift,
          -breach * 1.5 - exp * 4.2 + turLift,
          tur.baseZ + Math.sin(tur.angle) * outShift
        );
        const tilt = breach * 0.45 + exp * 1.52;
        tur.group.rotation.set(
          Math.sin(tur.angle) * tilt,
          (breach * 0.25 + exp * 1.8) * (idx % 2 === 0 ? 1 : -1),
          -Math.cos(tur.angle) * tilt
        );
        if (tur.roofMesh) {
          tur.roofMesh.position.set(
            (breach * 1.6 + exp * 11.5),
            Math.max(0.8, 12.4 + Math.sin(exp * Math.PI) * 16.0 - breach * 2.5 - exp * 11.2),
            (breach * 1.4 + exp * 9.5)
          );
          tur.roofMesh.rotation.z = breach * 1.2 + exp * 6.5;
          tur.roofMesh.rotation.x = exp * 4.8;
        }
      });
    }

    this.gimbalRings.forEach((ring, idx) => {
      const speed = (idx + 1) * (0.25 + heat * 1.1 + breach * 1.8 + exp * 4.0) * (idx % 2 === 0 ? 1 : -1);
      ring.position.y = 11.4 - breach * 1.5 + exp * (idx * 3.5);
      ring.scale.setScalar(1 + breach * 0.35 + exp * 2.2);
      ring.rotation.x += safeDt * speed;
      ring.rotation.y += safeDt * speed * 0.75;
    });

    this.staticThermalEdgeMaterials.forEach((mat) => mat.color.copy(thermalColor));
    this.dynamicThermalEdgeMaterials.forEach((mat) => mat.color.copy(thermalColor));
    this.bastionPylons.forEach((mat) => mat.color.copy(thermalColor));

    // Subtle wind sway on the Legion Standards atop the N Load Agent War Camps
    this.loadAgentCores.forEach((standard, idx) => {
      standard.rotation.y = Math.sin(this.clockTime * 1.8 + idx) * 0.14;
    });

    this.beamMat.color.copy(thermalColor);
    this.beamMat.opacity = 0.05 + heat * 0.18 + breach * 0.22 + exp * 0.32;
    this.plasmaBeam.scale.set(1 + heat * 1.1 + breach * 1.2 + exp * 2.8, 1, 1 + heat * 1.1 + breach * 1.2 + exp * 2.8);

    const errRate = this.currentFrame.errorRate || 0;
    this.shieldDome.rotation.y -= safeDt * 0.08;
    this.shieldDome.scale.setScalar(1 + breach * 0.25 + exp * 1.4);
    this.shieldDomeMat.color.copy(errRate > 2 || breach > 0.3 ? new THREE.Color(0xff1e42) : thermalColor);
    this.shieldDomeMat.opacity = 0.01 + heat * 0.04 + (errRate > 2 ? Math.abs(Math.sin(this.clockTime * 12)) * 0.05 : 0);

    this.radarRings.forEach((ring, idx) => {
      ring.material.color.copy(idx < 2 ? thermalColor : new THREE.Color(0x2c2824).lerp(thermalColor, heat * 0.35));
      ring.material.opacity = idx < 2 ? 0.26 + heat * 0.18 : 0.14 + heat * 0.12;
    });

    const dummy = new THREE.Object3D();

    // 1c. Update Exploding Stone Rubble Boulders when Castle Fractures & Explodes
    if (this.rubbleMesh && this.rubbleBlocks) {
      this.rubbleMat.emissive.copy(thermalColor);
      this.rubbleMat.emissiveIntensity = 0.08 + breach * 0.45 + exp * 0.9;
      const intensity = Math.max(breach * 0.45, exp);
      for (let r = 0; r < this.rubbleBlocks.length; r++) {
        if (intensity < 0.05) {
          dummy.position.set(0, -500, 0);
          dummy.scale.setScalar(0.001);
          dummy.updateMatrix();
          this.rubbleMesh.setMatrixAt(r, dummy.matrix);
          continue;
        }
        const rb = this.rubbleBlocks[r];
        const cycle = (this.clockTime * (0.65 + intensity * 1.25) + r * 0.17) % 1;
        const burst = intensity * cycle;
        const rad = rb.startR + burst * rb.velOut;
        const y = Math.max(
          0.4,
          rb.startY + Math.sin(cycle * Math.PI) * rb.arcHeight * intensity - cycle * cycle * 6.5
        );
        dummy.position.set(
          Math.cos(rb.angle) * rad,
          y,
          Math.sin(rb.angle) * rad
        );
        dummy.rotation.set(
          this.clockTime * rb.rotSpeed * 2.0,
          this.clockTime * rb.rotSpeed * 2.4,
          r
        );
        dummy.scale.setScalar(rb.scale * Math.min(1.35, intensity * 1.8));
        dummy.updateMatrix();
        this.rubbleMesh.setMatrixAt(r, dummy.matrix);
      }
      this.rubbleMesh.instanceMatrix.needsUpdate = true;
    }

    if (isSimulating && (breach > 0.55 || exp > 0.1) && this.shockwaves.length < 24 && Math.random() < 0.45) {
      this._spawnErrorShockwave();
    }

    // 2. Update Marching Heavy Infantry & Cantering Warhorses with Grounded Physical Kinematics
    const activeHighwayCount = this.hasData
      ? Math.min(
          MAX_HIGHWAY_BOTS,
          Math.max(24, Math.round((this.smoothedRps / 4500) * MAX_HIGHWAY_BOTS * 0.8 + (this.smoothedVus / 2500) * 32))
        )
      : 0;
    const activeCavalryCount = this.hasData
      ? Math.min(
          MAX_CAVALRY_BOTS,
          Math.max(12, Math.round((this.smoothedRps / 4500) * MAX_CAVALRY_BOTS * 0.8 + (this.smoothedVus / 2500) * 14))
        )
      : 0;

    // Grounded, realistic heavy-infantry double-time march pace & warhorse canter speed
    const marchSpeed = 5.2 + Math.min(11.5, (this.smoothedRps / 4000) * 10.5);
    const tintColor = new THREE.Color();
    const numLanes = Math.max(1, this.numLoadAgents);

    // When the castle breaks, soldiers and cavalry charge deeper past the outer wall straight into the shattered keep!
    const minMarchRadius = breach > 0.5 ? 6.5 : 16.5;

    // 2a. Heavy Infantry Phalanx (Realistic weighted heel-strike cadence, forward combat lean & upper-torso counter-twist)
    for (let i = 0; i < MAX_HIGHWAY_BOTS; i++) {
      if (i >= activeHighwayCount) {
        dummy.position.set(0, -500, 0);
        dummy.scale.setScalar(0.001);
        dummy.updateMatrix();
        this.highwayBotMesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      const b = this.highwayBots[i];
      b.lane = i % numLanes;
      b.distance -= safeDt * marchSpeed * b.speedFactor;

      if (b.distance <= minMarchRadius) {
        b.distance = LOAD_AGENT_RADIUS - 3.5 - Math.random() * 4;
        b.isErrorBot = Math.random() * 100 < (this.currentFrame.errorRate || 0) * 1.4;
        if (b.isErrorBot && this.shockwaves.length < 18 && Math.random() < 0.35) {
          this._spawnErrorShockwave();
        }
      }

      const angle = (b.lane * Math.PI * 2) / numLanes;
      const perpAngle = angle + Math.PI / 2;
      const x = Math.cos(angle) * b.distance + Math.cos(perpAngle) * b.laneOffset;
      const z = Math.sin(angle) * b.distance + Math.sin(perpAngle) * b.laneOffset;

      // Grounded bipedal walking/marching gait: subtle vertical hip displacement (8cm), forward lean, and torso yaw
      const stepCycle = this.clockTime * 6.8 * b.speedFactor + b.stridePhase;
      const marchVertical = Math.pow(Math.abs(Math.sin(stepCycle)), 1.4) * 0.085;
      const strideYaw = Math.sin(stepCycle) * 0.045;
      const strideRoll = Math.cos(stepCycle) * 0.028;
      const forwardLean = 0.08 + Math.sin(stepCycle * 2) * 0.018;

      dummy.position.set(x, marchVertical, z);
      dummy.rotation.order = 'YXZ';
      dummy.rotation.set(forwardLean, -angle - Math.PI / 2 + strideYaw, strideRoll);
      dummy.scale.setScalar(1.22);
      dummy.updateMatrix();
      this.highwayBotMesh.setMatrixAt(i, dummy.matrix);

      if (b.isErrorBot) {
        tintColor.setHex(0xd93838);
      } else if (b.distance < 30 && heat > 0.55) {
        tintColor.setHex(0xffffff).lerp(thermalColor, (heat - 0.55) * 0.35);
      } else {
        tintColor.setHex(0xffffff);
      }
      this.highwayBotMesh.setColorAt(i, tintColor);
    }
    this.highwayBotMesh.instanceMatrix.needsUpdate = true;
    if (this.highwayBotMesh.instanceColor) this.highwayBotMesh.instanceColor.needsUpdate = true;

    // 2b. Mounted Knights on Destrier Warhorses (Authentic 3-beat equine canter: suspension phase + rocking pitch)
    if (this.cavalryBotMesh) {
      for (let i = 0; i < MAX_CAVALRY_BOTS; i++) {
        if (i >= activeCavalryCount) {
          dummy.position.set(0, -500, 0);
          dummy.scale.setScalar(0.001);
          dummy.updateMatrix();
          this.cavalryBotMesh.setMatrixAt(i, dummy.matrix);
          continue;
        }

        const c = this.cavalryBots[i];
        c.lane = i % numLanes;
        // Surging forward velocity pulse during each canter stride
        const gallopCycle = this.clockTime * 8.2 * c.speedFactor + c.gallopPhase;
        const surgeFactor = 1.0 + Math.sin(gallopCycle) * 0.16;
        c.distance -= safeDt * marchSpeed * c.speedFactor * surgeFactor;

        if (c.distance <= minMarchRadius) {
          c.distance = LOAD_AGENT_RADIUS - 3.0 - Math.random() * 4.5;
          c.isErrorBot = Math.random() * 100 < (this.currentFrame.errorRate || 0) * 1.4;
          if (c.isErrorBot && this.shockwaves.length < 18 && Math.random() < 0.35) {
            this._spawnErrorShockwave();
          }
        }

        const angle = (c.lane * Math.PI * 2) / numLanes;
        const perpAngle = angle + Math.PI / 2;
        const x = Math.cos(angle) * c.distance + Math.cos(perpAngle) * c.laneOffset;
        const z = Math.sin(angle) * c.distance + Math.sin(perpAngle) * c.laneOffset;

        // Realistic equine canter mechanics: hind-push -> fore-reach rocking pitch (0.095 rad) & suspension lift (0.18m)
        const canterLift = Math.max(0, Math.sin(gallopCycle) * 0.16 + Math.sin(gallopCycle * 2) * 0.04);
        const canterPitch = Math.cos(gallopCycle) * 0.095;
        const canterRoll = Math.sin(gallopCycle * 0.5) * 0.022;

        dummy.position.set(x, canterLift, z);
        dummy.rotation.order = 'YXZ';
        dummy.rotation.set(canterPitch, -angle - Math.PI / 2, canterRoll);
        dummy.scale.setScalar(1.28);
        dummy.updateMatrix();
        this.cavalryBotMesh.setMatrixAt(i, dummy.matrix);

        if (c.isErrorBot) {
          tintColor.setHex(0xd93838);
        } else if (c.distance < 30 && heat > 0.55) {
          tintColor.setHex(0xffffff).lerp(thermalColor, (heat - 0.55) * 0.35);
        } else {
          tintColor.setHex(0xffffff);
        }
        this.cavalryBotMesh.setColorAt(i, tintColor);
      }
      this.cavalryBotMesh.instanceMatrix.needsUpdate = true;
      if (this.cavalryBotMesh.instanceColor) this.cavalryBotMesh.instanceColor.needsUpdate = true;
    }

    // 3. Update Inner Courtyard Siege Melee Infantry & Cavalry (Realistic shield-wall & spear thrusting around the Keep)
    const activeQueueCount = this.hasData
      ? Math.min(
          MAX_QUEUE_BOTS,
          Math.max(10, Math.round(Math.pow(heat, 1.05) * MAX_QUEUE_BOTS))
        )
      : 0;

    for (let i = 0; i < MAX_QUEUE_BOTS; i++) {
      if (i >= activeQueueCount) {
        dummy.position.set(0, -500, 0);
        dummy.scale.setScalar(0.001);
        dummy.updateMatrix();
        this.queueBotMesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      const qb = this.queueBots[i];
      qb.angle += safeDt * qb.orbitSpeed * (0.45 + heat * 0.85);
      const thrustLunge = Math.sin(this.clockTime * 4.8 + qb.verticalPhase) * 0.32;
      const r = qb.radius * (1 - heat * 0.12) - thrustLunge;
      const x = Math.cos(qb.angle) * r;
      const z = Math.sin(qb.angle) * r;
      const combatStep = Math.abs(Math.sin(this.clockTime * 5.2 + qb.verticalPhase)) * 0.06;

      dummy.position.set(x, qb.altitude + combatStep, z);
      // Face inward toward the central Keep with combat lunge pitch
      dummy.rotation.order = 'YXZ';
      dummy.rotation.set(
        0.10 + Math.sin(this.clockTime * 4.8 + qb.verticalPhase) * 0.08,
        -qb.angle - Math.PI / 2,
        Math.cos(this.clockTime * 3.6 + i) * 0.04
      );
      dummy.scale.setScalar(1.16);
      dummy.updateMatrix();
      this.queueBotMesh.setMatrixAt(i, dummy.matrix);

      tintColor.setHex(0xffffff).lerp(thermalColor, heat * 0.28);
      this.queueBotMesh.setColorAt(i, tintColor);
    }
    this.queueBotMesh.instanceMatrix.needsUpdate = true;
    if (this.queueBotMesh.instanceColor) this.queueBotMesh.instanceColor.needsUpdate = true;

    if (this.cavalryQueueMesh) {
      const activeCavQueue = this.hasData
        ? Math.min(
            this.cavalryQueueCount,
            Math.max(4, Math.round(Math.pow(heat, 1.05) * this.cavalryQueueCount))
          )
        : 0;

      for (let i = 0; i < this.cavalryQueueCount; i++) {
        if (i >= activeCavQueue) {
          dummy.position.set(0, -500, 0);
          dummy.scale.setScalar(0.001);
          dummy.updateMatrix();
          this.cavalryQueueMesh.setMatrixAt(i, dummy.matrix);
          continue;
        }

        const cqb = this.cavalryQueueBots[i];
        cqb.angle += safeDt * cqb.orbitSpeed * (0.55 + heat * 0.95);
        const r = cqb.radius * (1 - heat * 0.10);
        const x = Math.cos(cqb.angle) * r;
        const z = Math.sin(cqb.angle) * r;
        const gallopCycle = this.clockTime * 7.5 + cqb.gallopPhase;
        const canterLift = Math.max(0, Math.sin(gallopCycle) * 0.14);

        dummy.position.set(x, cqb.altitude + canterLift, z);
        dummy.rotation.order = 'YXZ';
        dummy.rotation.set(Math.cos(gallopCycle) * 0.085, -cqb.angle - Math.PI / 2, 0);
        dummy.scale.setScalar(1.22);
        dummy.updateMatrix();
        this.cavalryQueueMesh.setMatrixAt(i, dummy.matrix);

        tintColor.setHex(0xffffff).lerp(thermalColor, heat * 0.25);
        this.cavalryQueueMesh.setColorAt(i, tintColor);
      }
      this.cavalryQueueMesh.instanceMatrix.needsUpdate = true;
      if (this.cavalryQueueMesh.instanceColor) this.cavalryQueueMesh.instanceColor.needsUpdate = true;
    }

    // 3b. Castle Defensive Flaming Arrow Volleys (Raining outward from Castle Towers & Battlements onto Attackers)
    if (this.castleArrowMesh) {
      const activeArrowCount = this.hasData
        ? Math.min(
            MAX_CASTLE_ARROWS,
            Math.max(18, Math.round(18 + (this.smoothedRps / 4200) * (MAX_CASTLE_ARROWS - 18)))
          )
        : 0;
      const nextPos = new THREE.Vector3();

      for (let i = 0; i < MAX_CASTLE_ARROWS; i++) {
        if (i >= activeArrowCount) {
          dummy.position.set(0, -500, 0);
          dummy.scale.setScalar(0.001);
          dummy.updateMatrix();
          this.castleArrowMesh.setMatrixAt(i, dummy.matrix);
          continue;
        }

        const a = this.castleArrows[i];
        a.lane = i % numLanes;
        a.progress += safeDt * a.speed * (0.9 + heat * 0.75);
        if (a.progress >= 1.0) {
          a.progress %= 1.0;
          a.targetR = 20.0 + Math.random() * 54.0;
          a.laneOffset = (Math.random() - 0.5) * 5.6;
          a.arcHeight = 9.0 + Math.random() * 12.5;
        }

        const t = a.progress;
        const tNext = Math.min(1.0, t + 0.035);
        const angle = (a.lane * Math.PI * 2) / numLanes;
        const perpAngle = angle + Math.PI / 2;

        const rCur = a.startR + (a.targetR - a.startR) * t;
        const xCur = Math.cos(angle) * rCur + Math.cos(perpAngle) * (a.laneOffset * t);
        const zCur = Math.sin(angle) * rCur + Math.sin(perpAngle) * (a.laneOffset * t);
        const yCur = a.startY * (1 - t) + 0.6 * t + Math.sin(t * Math.PI) * a.arcHeight;

        const rNext = a.startR + (a.targetR - a.startR) * tNext;
        const xNext = Math.cos(angle) * rNext + Math.cos(perpAngle) * (a.laneOffset * tNext);
        const zNext = Math.sin(angle) * rNext + Math.sin(perpAngle) * (a.laneOffset * tNext);
        const yNext = a.startY * (1 - tNext) + 0.6 * tNext + Math.sin(tNext * Math.PI) * a.arcHeight;

        dummy.position.set(xCur, yCur, zCur);
        nextPos.set(xNext, yNext, zNext);
        dummy.lookAt(nextPos);
        dummy.scale.setScalar(0.95);
        dummy.updateMatrix();
        this.castleArrowMesh.setMatrixAt(i, dummy.matrix);
      }
      this.castleArrowMesh.instanceMatrix.needsUpdate = true;
    }

    // 3c. Animate Attacker Siege Catapult Throwing Arms & Flying Flaming Catapult Boulders
    if (this.catapultArms && this.catapultArms.length) {
      const fireSpeed = this.hasData ? (0.85 + heat * 1.15) : 0;
      this.catapultArms.forEach((cat) => {
        if (!this.hasData) {
          cat.pivot.rotation.x = -0.85;
          cat.fireball.visible = false;
          return;
        }
        const cyc = (this.clockTime * cat.cycleSpeed * fireSpeed + cat.phaseOffset) % 1.0;
        if (cyc < 0.72) {
          // Winching the catapult arm back down and loading a blazing boulder
          const winchT = cyc / 0.72;
          cat.pivot.rotation.x = 0.35 - winchT * 1.50;
          cat.fireball.visible = winchT > 0.25;
        } else {
          // Violent torsion release hurling the flaming boulder at the Castle!
          const snapT = Math.min(1, (cyc - 0.72) / 0.14);
          cat.pivot.rotation.x = -1.15 + snapT * 1.55;
          cat.fireball.visible = snapT < 0.45;
        }
      });
    }

    if (this.catapultBoulderMesh) {
      const activeBoulderCount = this.hasData
        ? Math.min(
            MAX_CATAPULT_BOULDERS,
            Math.max(4, Math.round(4 + (this.smoothedRps / 4200) * 8 + heat * 6))
          )
        : 0;
      const nextBoulderPos = new THREE.Vector3();

      for (let i = 0; i < MAX_CATAPULT_BOULDERS; i++) {
        if (i >= activeBoulderCount) {
          dummy.position.set(0, -500, 0);
          dummy.scale.setScalar(0.001);
          dummy.updateMatrix();
          this.catapultBoulderMesh.setMatrixAt(i, dummy.matrix);
          continue;
        }

        const cb = this.catapultBoulders[i];
        cb.lane = i % numLanes;
        cb.progress += safeDt * cb.speed * (0.85 + heat * 0.85);
        if (cb.progress >= 1.0) {
          cb.progress %= 1.0;
          cb.targetR = 3.0 + Math.random() * 14.5;
          cb.targetY = 3.0 + Math.random() * 9.0;
          cb.arcHeight = 14.0 + Math.random() * 14.0;
          if (this.shockwaves.length < 28 && Math.random() < 0.45) {
            this._spawnErrorShockwave();
          }
        }

        const t = cb.progress;
        const tNext = Math.min(1.0, t + 0.04);
        const angle = (cb.lane * Math.PI * 2) / numLanes;
        const perpAngle = angle + Math.PI / 2;

        const rCur = cb.startR + (cb.targetR - cb.startR) * t;
        const sideCur = cb.sideOffset * (1 - t * 0.75);
        const xCur = Math.cos(angle) * rCur + Math.cos(perpAngle) * sideCur;
        const zCur = Math.sin(angle) * rCur + Math.sin(perpAngle) * sideCur;
        const yCur = cb.startY * (1 - t) + cb.targetY * t + Math.sin(t * Math.PI) * cb.arcHeight;

        const rNext = cb.startR + (cb.targetR - cb.startR) * tNext;
        const sideNext = cb.sideOffset * (1 - tNext * 0.75);
        const xNext = Math.cos(angle) * rNext + Math.cos(perpAngle) * sideNext;
        const zNext = Math.sin(angle) * rNext + Math.sin(perpAngle) * sideNext;
        const yNext = cb.startY * (1 - tNext) + cb.targetY * tNext + Math.sin(tNext * Math.PI) * cb.arcHeight;

        dummy.position.set(xCur, yCur, zCur);
        nextBoulderPos.set(xNext, yNext, zNext);
        dummy.lookAt(nextBoulderPos);
        dummy.scale.setScalar(1.05 + heat * 0.35);
        dummy.updateMatrix();
        this.catapultBoulderMesh.setMatrixAt(i, dummy.matrix);
      }
      this.catapultBoulderMesh.instanceMatrix.needsUpdate = true;
    }

    // 4. Update Rising Fire Embers & War Brazier Sparks
    const activeParticleCount = this.hasData
      ? Math.min(
          MAX_THERMAL_PARTICLES,
          Math.round(70 + heat * (MAX_THERMAL_PARTICLES - 70))
        )
      : 35;

    for (let i = 0; i < MAX_THERMAL_PARTICLES; i++) {
      if (i >= activeParticleCount) {
        dummy.position.set(0, -500, 0);
        dummy.scale.setScalar(0.001);
        dummy.updateMatrix();
        this.thermalParticleMesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      const p = this.thermalParticles[i];
      p.y += safeDt * p.speedY * (0.5 + heat * 2.1);
      p.theta += safeDt * p.swirl * (1 + heat * 2.5);
      if (p.y > 36) p.y = 2.0;

      const x = Math.cos(p.theta) * p.r;
      const z = Math.sin(p.theta) * p.r;
      const lifeScale = Math.sin((p.y / 36) * Math.PI) * (0.6 + heat * 1.1);

      dummy.position.set(x, p.y, z);
      dummy.rotation.set(this.clockTime * 2, this.clockTime * 3, 0);
      dummy.scale.setScalar(Math.max(0.05, lifeScale));
      dummy.updateMatrix();
      this.thermalParticleMesh.setMatrixAt(i, dummy.matrix);

      tintColor.copy(thermalColor);
      if (i % 3 === 0) tintColor.setHex(0xffdd77);
      this.thermalParticleMesh.setColorAt(i, tintColor);
    }
    this.thermalParticleMesh.instanceMatrix.needsUpdate = true;
    if (this.thermalParticleMesh.instanceColor) this.thermalParticleMesh.instanceColor.needsUpdate = true;

    // 5. Update Catapult / Siege Impact Shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.age += safeDt;
      if (sw.age >= sw.maxAge) {
        this.scene.remove(sw.mesh);
        sw.mesh.geometry.dispose();
        sw.mat.dispose();
        this.shockwaves.splice(i, 1);
      } else {
        const progress = sw.age / sw.maxAge;
        const scale = 1 + progress * 6.5;
        sw.mesh.scale.setScalar(scale);
        sw.mat.opacity = (1 - progress) * 0.9;
      }
    }

    // 6. Update Camera Position
    this._updateCamera(frameDt, heat, isSimulating);

    // Render 3D WebGL scene with Post-Processing (UnrealBloomPass optical halation)
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    // 7. Composite 3D WebGL + Spartan/Total War Broadcast HUD + Graph + Battle Scroll Summary
    this._compositeBroadcastFrame(heat);
  }

  _updateCamera(dt, heat, isSimulating = true) {
    const azRad = (this.orbitAngleDeg * Math.PI) / 180;
    const r = Math.max(18, Math.min(135, this.zoomDistance));

    this.activeDirectorShotName = `3D VIEW // ZOOM: ${Math.round(r)}m · POS: (${Math.round(this.fortressPosX)}, ${Math.round(this.fortressPosY)}) · ANGLE: ${Math.round(this.orbitAngleDeg)}°`;

    // Right vector in the horizontal plane perpendicular to the camera's view ray
    const rightX = -Math.sin(azRad);
    const rightZ = Math.cos(azRad);

    // Shift the look-at center so changing Fortress Pos X / Pos Y pans the fortress in 3D space
    const panX = -this.fortressPosX * rightX;
    const panZ = -this.fortressPosX * rightZ;
    const panY = 6 - this.fortressPosY * 0.55;

    const baseElev = Math.max(8, r * 0.46 + this.fortressPosY * 0.65);

    const targetPos = new THREE.Vector3(
      Math.cos(azRad) * r + panX,
      baseElev,
      Math.sin(azRad) * r + panZ
    );
    const targetLook = new THREE.Vector3(panX, panY, panZ);

    if (isSimulating && (heat > 0.72 || this.smoothedBreach > 0.25 || this.explosionProgress > 0.05)) {
      const shakeAmt = (Math.max(0, heat - 0.72) * 0.85) + this.smoothedBreach * 0.95 + this.explosionProgress * 1.65;
      targetPos.x += (Math.random() - 0.5) * shakeAmt;
      targetPos.y += (Math.random() - 0.5) * shakeAmt;
    }

    this.camera.position.lerp(targetPos, Math.min(1, dt * 6.0));
    this.cameraTarget.lerp(targetLook, Math.min(1, dt * 6.5));
    this.camera.lookAt(this.cameraTarget);
  }

  _compositeBroadcastFrame(heat) {
    const ctx = this.ctx;
    const W = this.width;
    const H = this.height;
    const f = this.currentFrame;

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.webglCanvas, 0, 0, W, H);

    // Warm Spartan fire vignette when siege intensifies
    if (heat > 0.35) {
      const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, W * 0.58);
      const alpha = (heat - 0.35) * 0.44 + this.smoothedBreach * 0.18;
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, heat > 0.75 ? `rgba(190, 18, 60, ${alpha})` : `rgba(217, 119, 6, ${alpha * 0.8})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }

    if (!this.showHudInCanvas) return;

    // 1. Project 3D Labels: Fortress Keep + N Outer Legion Camps + N Fortress Gatehouses
    this._draw3DAnchoredLabels(ctx, W, H, f);

    // 1b. Castle Explosion Alert Banner when response times breach 30 seconds (30,000 ms)
    if (this.hasData && (this.thermal.castleBroken || this.explosionProgress > 0.08 || this.smoothedBreach >= 0.75)) {
      ctx.save();
      const alertW = 760;
      const alertH = 44;
      const alertX = (W - alertW) / 2;
      const alertY = 96;
      const pulse = 0.78 + Math.sin(this.clockTime * 14) * 0.22;
      ctx.fillStyle = `rgba(159, 18, 57, ${0.92 * pulse})`;
      ctx.strokeStyle = '#fda4af';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(alertX, alertY, alertW, alertH, 7);
      ctx.fill();
      ctx.stroke();

      ctx.font = '800 15px "Cinzel", Georgia, serif';
      ctx.fillStyle = '#fff1f2';
      ctx.textAlign = 'center';
      const secVal = ((f.p95 || 0) / 1000).toFixed(1);
      const alertLabel = (this.thermal.castleBroken || this.explosionProgress > 0.08)
        ? `💥 CASTLE EXPLODED! // RESPONSE TIME BREACHED 30s: ${secVal}s (${(f.p95 || 0).toLocaleString()} ms)`
        : `⚠️ CASTLE WALLS FRACTURING // RESPONSE TIME: ${secVal}s (${(f.p95 || 0).toLocaleString()} ms)`;
      ctx.fillText(alertLabel, W / 2, alertY + 28);
      ctx.restore();
    }

    // 2. Top Imperial War Header Banner
    ctx.save();
    ctx.fillStyle = 'rgba(15, 15, 21, 0.90)';
    ctx.strokeStyle = this.isLiveMode ? 'rgba(244, 63, 94, 0.78)' : 'rgba(230, 198, 135, 0.42)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(36, 22, W - 72, 62, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = this.isLiveMode
      ? (Math.sin(this.clockTime * 8) > 0 ? '#f43f5e' : '#fda4af')
      : this.thermal.colorHex;
    ctx.beginPath();
    ctx.arc(64, 53, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '800 20px "Cinzel", "Space Grotesk", Georgia, serif';
    ctx.fillStyle = '#f5f3ef';
    ctx.textAlign = 'left';
    const titlePrefix = this.isLiveMode ? '🔴 LIVE SIEGE // ' : '⚔️ ';
    ctx.fillText(`${titlePrefix}${this.testTitle}`, 84, 48);

    ctx.font = '500 12px "JetBrains Mono", monospace';
    ctx.fillStyle = '#a1a0ab';
    ctx.fillText(
      `${this.sourceLabel}  ·  ${this.numLoadAgents} SIEGE LEGION${this.numLoadAgents > 1 ? 'S' : ''} (LOAD AGENTS)  ·  ${this.activeDirectorShotName}`,
      84,
      69
    );

    const badgeW = 370;
    ctx.fillStyle = heat > 0.65 ? 'rgba(225, 29, 72, 0.22)' : 'rgba(230, 198, 135, 0.12)';
    ctx.strokeStyle = this.thermal.colorHex;
    ctx.beginPath();
    ctx.roundRect(W - 36 - badgeW - 16, 33, badgeW, 40, 6);
    ctx.fill();
    ctx.stroke();

    ctx.font = '700 13px "JetBrains Mono", monospace';
    ctx.fillStyle = this.thermal.colorHex;
    ctx.textAlign = 'center';
    ctx.fillText(`FORTRESS: ${this.thermal.label}`, W - 36 - badgeW / 2 - 16, 58);

    // 3. Left Tactical Legion Column (4 KPI Shields)
    const cards = [
      {
        label: 'MARCHING PHALANX (VUs)',
        value: this.hasData ? f.vus.toLocaleString() : '—',
        unit: this.hasData ? 'SOLDIERS' : 'NO DATA',
        sub: `${this.numLoadAgents} SIEGE LEGION LANE${this.numLoadAgents > 1 ? 'S' : ''} ACTIVE`,
        color: '#e6c687'
      },
      {
        label: 'FORTRESS ASSAULT RATE',
        value: this.hasData ? f.rps.toLocaleString() : '—',
        unit: this.hasData ? 'REQ/S' : 'NO DATA',
        sub: this.hasData ? `${Math.round(f.rps * 60).toLocaleString()} STRIKES/MIN` : 'AWAITING INFLUXDB',
        color: '#f59e0b'
      },
      {
        label: 'DEFENSE LATENCY (P95)',
        value: this.hasData ? `${f.p95}` : '—',
        unit: this.hasData ? 'ms' : 'NO DATA',
        sub: this.hasData ? `P50: ${f.p50}ms  ·  P99: ${f.p99}ms` : 'P50: —  ·  P99: —',
        color: this.thermal.colorHex
      },
      {
        label: 'SIEGE CASUALTIES (ERRORS)',
        value: this.hasData ? `${f.errorRate.toFixed(2)}%` : '—',
        unit: this.hasData ? `(${f.failedReqs}/s)` : 'NO DATA',
        sub: this.hasData ? `WALL INTEGRITY: ${f.checksPassRate}%` : 'WALL INTEGRITY: —',
        color: f.errorRate > 1 ? '#f43f5e' : '#10b981'
      }
    ];

    cards.forEach((c, idx) => {
      const cy = 100 + idx * 102;
      ctx.fillStyle = 'rgba(16, 16, 22, 0.88)';
      ctx.strokeStyle = 'rgba(230, 198, 135, 0.28)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(36, cy, 296, 90, 8);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = c.color;
      ctx.fillRect(36, cy + 12, 4, 66);

      ctx.font = '700 11px "Cinzel", serif';
      ctx.fillStyle = '#a1a0ab';
      ctx.textAlign = 'left';
      ctx.fillText(c.label, 52, cy + 23);

      ctx.font = '700 28px "JetBrains Mono", monospace';
      ctx.fillStyle = '#f5f3ef';
      ctx.fillText(c.value, 52, cy + 58);

      const valW = ctx.measureText(c.value).width;
      ctx.font = '600 13px "JetBrains Mono", monospace';
      ctx.fillStyle = c.color;
      ctx.fillText(c.unit, 52 + valW + 8, cy + 58);

      ctx.font = '500 11px "JetBrains Mono", monospace';
      ctx.fillStyle = '#8b8a96';
      ctx.fillText(c.sub, 52, cy + 78);
    });

    // 4. Right Vertical Siege Fury / Brazier Heat Gauge
    const gx = W - 116;
    const gy = 100;
    const gh = 398;
    ctx.fillStyle = 'rgba(16, 16, 22, 0.88)';
    ctx.strokeStyle = 'rgba(230, 198, 135, 0.28)';
    ctx.beginPath();
    ctx.roundRect(gx, gy, 80, gh, 8);
    ctx.fill();
    ctx.stroke();

    ctx.font = '700 11px "Cinzel", serif';
    ctx.fillStyle = '#e6c687';
    ctx.textAlign = 'center';
    ctx.fillText('SIEGE FURY', gx + 40, gy + 24);

    const barX = gx + 28;
    const barY = gy + 40;
    const barW = 24;
    const barH = gh - 105;
    ctx.fillStyle = 'rgba(26, 26, 35, 0.95)';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, 5);
    ctx.fill();

    const fillH = Math.max(8, barH * heat);
    const thermGrad = ctx.createLinearGradient(0, barY + barH, 0, barY);
    thermGrad.addColorStop(0, '#e6c687');
    thermGrad.addColorStop(0.45, '#f59e0b');
    thermGrad.addColorStop(0.8, '#ea580c');
    thermGrad.addColorStop(1, '#e11d48');
    ctx.fillStyle = thermGrad;
    ctx.beginPath();
    ctx.roundRect(barX, barY + barH - fillH, barW, fillH, 5);
    ctx.fill();

    ctx.font = '700 19px "JetBrains Mono", monospace';
    ctx.fillStyle = this.thermal.colorHex;
    ctx.fillText(this.hasData ? `${this.thermal.coreTempC}°C` : '—', gx + 40, gy + gh - 34);

    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#a1a0ab';
    ctx.fillText(this.hasData ? `${Math.round(heat * 100)}% FURY` : 'NO DATA', gx + 40, gy + gh - 14);

    // Centered NO DATA Banner when no InfluxDB data is loaded
    if (!this.hasData) {
      const bw = 780;
      const bh = 98;
      const bx = (W - bw) / 2;
      const by = H / 2 - 90;
      ctx.fillStyle = 'rgba(15, 15, 21, 0.94)';
      ctx.strokeStyle = 'rgba(230, 198, 135, 0.55)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 10);
      ctx.fill();
      ctx.stroke();

      ctx.font = '800 22px "Cinzel", Georgia, serif';
      ctx.fillStyle = '#f5f3ef';
      ctx.textAlign = 'center';
      ctx.fillText('⚔️ NO BATTLE DATA LOADED', W / 2, by + 40);

      ctx.font = '600 13px "JetBrains Mono", monospace';
      ctx.fillStyle = '#e6c687';
      ctx.fillText(this.noDataMessage, W / 2, by + 70);
    }

    // 5. Dedicated K6 Response Times (P50 / P95 / P99) & HTTP Errors Graph Panel
    this._drawResponseTimesAndErrorsGraph(ctx, W, H, f);

    // 6. End-of-Test Battle Scroll Summary Overlay
    if (this.showSummaryOverlay && this.hasData) {
      this._drawTestSummaryOverlay(ctx, W, H);
    }

    ctx.restore();
  }

  _draw3DAnchoredLabels(ctx, W, H, f) {
    ctx.save();

    // N Outer "SIEGE LEGION (LOAD AGENT)" Camp Labels
    const streamWeights = this._getAgentWeights(this.numLoadAgents);
    this.loadAgentWorldPositions.forEach((worldPos, idx) => {
      const proj = worldPos.clone().project(this.camera);
      if (proj.z > 1) return;
      const sx = (proj.x * 0.5 + 0.5) * W;
      const sy = (-proj.y * 0.5 + 0.5) * H;
      if (sx < 340 || sx > W - 140 || sy < 95 || sy > H - 220) return;

      const w = streamWeights[idx] || 1 / this.numLoadAgents;
      const agentVus = this.hasData ? Math.max(1, Math.round((f.vus || 0) * w)) : 0;
      const agentRps = this.hasData ? Math.round((f.rps || 0) * w) : 0;
      const customRunner = this.loadAgentNames[idx];
      const epName = this.endpoints[idx % Math.max(1, this.endpoints.length)] || `/lane-${idx + 1}`;

      const agentTitle = customRunner
        ? `🛡️ LEGION ${String(idx + 1).padStart(2, '0')} (${customRunner.slice(0, 12)})`
        : `🛡️ LEGION AGENT ${String(idx + 1).padStart(2, '0')}`;
      const line1 = this.hasData
        ? `${agentTitle}  [${agentVus} SOLDIERS · ${agentRps} req/s]`
        : `${agentTitle}  [CAMP IDLE]`;
      const line2 = this.hasData ? `MARCHING → ${epName}` : 'STANDBY';

      ctx.font = '700 11px "JetBrains Mono", monospace';
      const tw = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 20;
      const th = 36;

      ctx.fillStyle = 'rgba(16, 16, 22, 0.90)';
      ctx.strokeStyle = 'rgba(230, 198, 135, 0.65)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.roundRect(sx - tw / 2, sy - th / 2, tw, th, 5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#e6c687';
      ctx.textAlign = 'center';
      ctx.fillText(line1, sx, sy - 3);

      ctx.font = '500 10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#f5f3ef';
      ctx.fillText(line2, sx, sy + 12);
    });

    // C. N Inner Fortress Gatehouse Labels
    ctx.font = '600 11px "JetBrains Mono", monospace';
    this.gateWorldPositions.forEach((worldPos, idx) => {
      const projected = worldPos.clone().add(new THREE.Vector3(0, 10.2, 0)).project(this.camera);
      if (projected.z > 1) return;
      const sx = (projected.x * 0.5 + 0.5) * W;
      const sy = (-projected.y * 0.5 + 0.5) * H;
      if (sx < 340 || sx > W - 140 || sy < 100 || sy > H - 220) return;

      const epName = this.endpoints[idx % Math.max(1, this.endpoints.length)] || `GATE-0${idx + 1}`;
      const label = this.hasData
        ? `⛩️ GATE ${String(idx + 1).padStart(2, '0')}: ${epName}`
        : `⛩️ FORTRESS GATE ${String(idx + 1).padStart(2, '0')}`;
      const textWidth = ctx.measureText(label).width;

      ctx.fillStyle = 'rgba(15, 15, 21, 0.86)';
      ctx.strokeStyle = this.thermal.colorHex;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.roundRect(sx - textWidth / 2 - 8, sy - 12, textWidth + 16, 20, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f5f3ef';
      ctx.textAlign = 'center';
      ctx.fillText(label, sx, sy + 2);
    });

    ctx.restore();
  }

  _drawResponseTimesAndErrorsGraph(ctx, W, H, f) {
    const panelX = 36;
    const panelY = H - 188;
    const panelW = W - 72;
    const panelH = 164;

    ctx.save();
    ctx.fillStyle = 'rgba(15, 15, 21, 0.92)';
    ctx.strokeStyle = 'rgba(230, 198, 135, 0.34)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelW, panelH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.font = '700 13px "Cinzel", Georgia, serif';
    ctx.fillStyle = '#f5f3ef';
    ctx.textAlign = 'left';
    const modeTag = !this.hasData
      ? 'NO DATA'
      : (this.isLiveMode ? '🔴 LIVE SIEGE CHRONICLE' : `T+${formatElapsed(f.elapsedSec)}`);
    ctx.fillText(
      `⚔️ SIEGE RESPONSE TIMES (MS) & CASUALTIES (HTTP ERRORS)  —  ${modeTag}`,
      panelX + 18,
      panelY + 24
    );

    const legendItems = [
      { text: this.hasData ? `━ P50: ${f.p50}ms` : '━ P50: —', color: '#e6c687' },
      { text: this.hasData ? `━ P95: ${f.p95}ms` : '━ P95: —', color: '#f97316' },
      { text: this.hasData ? `┅ P99: ${f.p99}ms` : '┅ P99: —', color: '#fbbf24' },
      { text: this.hasData ? `▮ ERRORS: ${f.errorRate.toFixed(2)}% (${f.failedReqs}/s)` : '▮ ERRORS: —', color: '#f43f5e' }
    ];

    let lx = panelX + panelW - 24;
    ctx.font = '700 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    for (let i = legendItems.length - 1; i >= 0; i--) {
      const item = legendItems[i];
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, lx, panelY + 24);
      lx -= ctx.measureText(item.text).width + 26;
    }

    const plotLeft = panelX + 74;
    const plotRight = panelX + panelW - 76;
    const plotTop = panelY + 38;
    const plotBottom = panelY + panelH - 22;
    const plotW = plotRight - plotLeft;
    const plotH = plotBottom - plotTop;

    if (!this.hasData || this.allFrames.length < 2) {
      ctx.font = '600 13px "JetBrains Mono", monospace';
      ctx.fillStyle = '#a1a0ab';
      ctx.textAlign = 'center';
      ctx.fillText('NO DATA — CONNECT INFLUXDB 1.8 TO CHRONICLE THE SIEGE', panelX + panelW / 2, plotTop + plotH / 2 + 6);
      ctx.restore();
      return;
    }

    const maxLatencyMs = Math.max(
      this.thresholds.criticalMs * 1.1,
      ...this.allFrames.map((fr) => Math.max(fr.p99 || 0, fr.p95 || 0))
    );
    const maxErrPct = Math.max(5, ...this.allFrames.map((fr) => fr.errorRate || 0)) * 1.15;

    ctx.lineWidth = 1;
    ctx.font = '500 10px "JetBrains Mono", monospace';
    const gridSteps = 3;
    for (let s = 0; s <= gridSteps; s++) {
      const ratio = s / gridSteps;
      const gy = plotBottom - ratio * plotH;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.beginPath();
      ctx.moveTo(plotLeft, gy);
      ctx.lineTo(plotRight, gy);
      ctx.stroke();

      const msVal = Math.round(ratio * maxLatencyMs);
      ctx.fillStyle = '#a1a0ab';
      ctx.textAlign = 'right';
      ctx.fillText(`${msVal}ms`, plotLeft - 8, gy + 3);

      const errVal = (ratio * maxErrPct).toFixed(1);
      ctx.fillStyle = '#fb7185';
      ctx.textAlign = 'left';
      ctx.fillText(`${errVal}%`, plotRight + 8, gy + 3);
    }

    if (this.thresholds.criticalMs < maxLatencyMs) {
      const critY = plotBottom - (this.thresholds.criticalMs / maxLatencyMs) * plotH;
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.65)';
      ctx.beginPath();
      ctx.moveTo(plotLeft, critY);
      ctx.lineTo(plotRight, critY);
      ctx.stroke();
      ctx.restore();
    }

    const count = this.allFrames.length;
    const barW = Math.max(2, plotW / count - 1);

    this.allFrames.forEach((fr, idx) => {
      if (!fr.errorRate || fr.errorRate <= 0) return;
      const px = plotLeft + (idx / (count - 1)) * plotW;
      const barH = Math.min(plotH, (fr.errorRate / maxErrPct) * plotH);
      ctx.fillStyle = 'rgba(225, 29, 72, 0.42)';
      ctx.fillRect(px - barW / 2, plotBottom - barH, barW, barH);
      ctx.fillStyle = '#f43f5e';
      ctx.fillRect(px - barW / 2, plotBottom - barH, barW, 2);
    });

    const p95Grad = ctx.createLinearGradient(0, plotTop, 0, plotBottom);
    p95Grad.addColorStop(0, 'rgba(249, 115, 22, 0.32)');
    p95Grad.addColorStop(1, 'rgba(249, 115, 22, 0.02)');

    ctx.beginPath();
    this.allFrames.forEach((fr, idx) => {
      const px = plotLeft + (idx / (count - 1)) * plotW;
      const py = plotBottom - (Math.min(maxLatencyMs, fr.p95 || 0) / maxLatencyMs) * plotH;
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.lineTo(plotRight, plotBottom);
    ctx.lineTo(plotLeft, plotBottom);
    ctx.closePath();
    ctx.fillStyle = p95Grad;
    ctx.fill();

    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    this.allFrames.forEach((fr, idx) => {
      const px = plotLeft + (idx / (count - 1)) * plotW;
      const py = plotBottom - (Math.min(maxLatencyMs, fr.p99 || 0) / maxLatencyMs) * plotH;
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    this.allFrames.forEach((fr, idx) => {
      const px = plotLeft + (idx / (count - 1)) * plotW;
      const py = plotBottom - (Math.min(maxLatencyMs, fr.p95 || 0) / maxLatencyMs) * plotH;
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    ctx.strokeStyle = '#e6c687';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    this.allFrames.forEach((fr, idx) => {
      const px = plotLeft + (idx / (count - 1)) * plotW;
      const py = plotBottom - (Math.min(maxLatencyMs, fr.p50 || 0) / maxLatencyMs) * plotH;
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    const progress = Math.min(1, Math.max(0, (f.index || 0) / Math.max(1, count - 1)));
    const playheadX = plotLeft + progress * plotW;

    ctx.strokeStyle = '#f5f3ef';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, plotTop - 4);
    ctx.lineTo(playheadX, plotBottom + 4);
    ctx.stroke();

    const curP95Y = plotBottom - (Math.min(maxLatencyMs, f.p95 || 0) / maxLatencyMs) * plotH;
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.arc(playheadX, curP95Y, 5, 0, Math.PI * 2);
    ctx.fill();

    if (f.errorRate > 0) {
      const curErrY = plotBottom - (Math.min(maxErrPct, f.errorRate) / maxErrPct) * plotH;
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(playheadX, curErrY, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  _truncateText(ctx, text, maxWidth) {
    const str = String(text || '');
    if (ctx.measureText(str).width <= maxWidth) return str;
    let lo = 0;
    let hi = str.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(`${str.slice(0, mid)}…`).width <= maxWidth) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return `${str.slice(0, Math.max(1, lo))}…`;
  }

  _drawTestSummaryOverlay(ctx, W, H) {
    if (!this.summaryStats) {
      this.summaryStats = this._computeSummaryStats();
    }
    const s = this.summaryStats;
    if (!s) return;

    ctx.save();

    // Radial vignette backdrop so the 3D battlefield softly glows behind the summary card
    const bgGrad = ctx.createRadialGradient(W / 2, H / 2, H * 0.1, W / 2, H / 2, W * 0.65);
    bgGrad.addColorStop(0, 'rgba(10, 10, 15, 0.80)');
    bgGrad.addColorStop(1, 'rgba(6, 6, 9, 0.94)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    const cardW = 1240;
    const cardH = 710;
    const cx = Math.round((W - cardW) / 2);
    const cy = Math.round((H - cardH) / 2 - 14);

    // Card drop shadow & base surface
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 48;
    ctx.shadowOffsetY = 18;
    const cardGrad = ctx.createLinearGradient(cx, cy, cx, cy + cardH);
    cardGrad.addColorStop(0, 'rgba(22, 22, 31, 0.98)');
    cardGrad.addColorStop(1, 'rgba(13, 13, 19, 0.98)');
    ctx.fillStyle = cardGrad;
    ctx.beginPath();
    ctx.roundRect(cx, cy, cardW, cardH, 14);
    ctx.fill();
    ctx.restore();

    // Clip all interior drawing strictly inside the rounded card
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(cx, cy, cardW, cardH, 14);
    ctx.clip();

    // Header banner surface
    const headerH = 98;
    const headerGrad = ctx.createLinearGradient(cx, cy, cx + cardW, cy + headerH);
    headerGrad.addColorStop(0, 'rgba(230, 198, 135, 0.12)');
    headerGrad.addColorStop(0.6, 'rgba(24, 24, 34, 0.55)');
    headerGrad.addColorStop(1, 'rgba(244, 63, 94, 0.10)');
    ctx.fillStyle = headerGrad;
    ctx.fillRect(cx, cy, cardW, headerH);

    // Subtle bottom divider on header
    ctx.strokeStyle = 'rgba(230, 198, 135, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy + headerH);
    ctx.lineTo(cx + cardW, cy + headerH);
    ctx.stroke();

    // Verdict Badge on Top-Right (reserved width: 368px)
    const badgeW = 368;
    const badgeH = 44;
    const badgeX = cx + cardW - badgeW - 32;
    const badgeY = cy + 27;

    ctx.fillStyle = s.verdictColor === '#f43f5e'
      ? 'rgba(244, 63, 94, 0.14)'
      : s.verdictColor === '#f59e0b'
        ? 'rgba(245, 158, 11, 0.14)'
        : 'rgba(16, 185, 129, 0.14)';
    ctx.strokeStyle = s.verdictColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.font = '700 13px "JetBrains Mono", monospace';
    ctx.fillStyle = s.verdictColor === '#f43f5e' ? '#fda4af' : s.verdictColor;
    ctx.textAlign = 'center';
    ctx.fillText(this._truncateText(ctx, s.verdict, badgeW - 24), badgeX + badgeW / 2, badgeY + 27);

    // Header Left Column (strictly constrained so it never touches the Verdict Badge)
    const maxTitleW = cardW - badgeW - 96;
    ctx.textAlign = 'left';

    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#e6c687';
    ctx.fillText('📜 IMPERIAL BATTLE SCROLL  ·  POST-SIEGE INTELLIGENCE REPORT', cx + 32, cy + 28);

    ctx.font = '800 21px "Cinzel", "Space Grotesk", Georgia, serif';
    ctx.fillStyle = '#f5f3ef';
    const cleanTitle = this.testTitle.replace(/^DEMO SIEGE \/\/\s*/i, '');
    ctx.fillText(this._truncateText(ctx, cleanTitle, maxTitleW), cx + 32, cy + 56);

    ctx.font = '500 12px "JetBrains Mono", monospace';
    ctx.fillStyle = '#a1a0ab';
    const metaLine = `FORTRESS: ${this.sutName}   ·   SIEGE DURATION: ${formatElapsed(s.durationSec)}   ·   ${this.numLoadAgents} SIEGE LEGION${this.numLoadAgents > 1 ? 'S' : ''} DEPLOYED`;
    ctx.fillText(this._truncateText(ctx, metaLine, maxTitleW), cx + 32, cy + 80);

    // 6 KPI Cards (3x2 grid)
    const fmtLat = (ms) => ms >= 1000
      ? `${ms.toLocaleString()} ms (${(ms / 1000).toFixed(1)}s)`
      : `${ms.toLocaleString()} ms`;

    const kpis = [
      {
        label: 'TOTAL ASSAULT STRIKES (REQS)',
        val: s.totalReqs.toLocaleString(),
        sub: `PEAK: ${s.peakRps.toLocaleString()} REQ/S  ·  AVG: ${s.avgRps.toLocaleString()} REQ/S`,
        color: '#e6c687'
      },
      {
        label: 'PEAK SPARTAN PHALANX',
        val: `${s.maxVus.toLocaleString()} SOLDIERS`,
        sub: `ACROSS ${this.numLoadAgents} SIEGE LEGION LANE${this.numLoadAgents > 1 ? 'S' : ''}`,
        color: '#f59e0b'
      },
      {
        label: 'PEAK FORTRESS LATENCY (P95)',
        val: fmtLat(s.peakP95),
        sub: `AVG P50: ${s.avgP50.toLocaleString()} ms  ·  AVG P95: ${s.avgP95.toLocaleString()} ms`,
        color: '#f97316'
      },
      {
        label: 'HEAVIEST VOLLEY (PEAK P99)',
        val: fmtLat(s.peakP99),
        sub: `CASTLE EXPLOSION THRESHOLD: 30,000 ms (30s)`,
        color: '#fbbf24'
      },
      {
        label: 'TOTAL SIEGE CASUALTIES',
        val: s.totalFailed.toLocaleString(),
        sub: `FAILURE RATE: ${s.overallErrorPct}% (PEAK ${s.peakErrorRate}%)`,
        color: s.overallErrorPct > 1 ? '#f43f5e' : '#10b981'
      },
      {
        label: 'PEAK FORTRESS BRAZIER HEAT',
        val: `${s.maxCoreTempC.toLocaleString()}°C`,
        sub: s.peakP95 >= 30000 ? 'CASTLE DETONATED AT >30s LATENCY' : (s.maxCoreTempC > 850 ? 'WALLS ENGULFED IN FLAME' : 'WALLS HELD STRONG'),
        color: s.verdictColor
      }
    ];

    const gridLeft = cx + 32;
    const gridTop = cy + 118;
    const colGap = 20;
    const rowGap = 16;
    const boxW = Math.floor((cardW - 64 - colGap * 2) / 3);
    const boxH = 102;

    kpis.forEach((k, idx) => {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      const bx = gridLeft + col * (boxW + colGap);
      const by = gridTop + row * (boxH + rowGap);

      const boxGrad = ctx.createLinearGradient(bx, by, bx, by + boxH);
      boxGrad.addColorStop(0, 'rgba(29, 29, 40, 0.92)');
      boxGrad.addColorStop(1, 'rgba(19, 19, 27, 0.92)');
      ctx.fillStyle = boxGrad;
      ctx.strokeStyle = 'rgba(230, 198, 135, 0.20)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(bx, by, boxW, boxH, 9);
      ctx.fill();
      ctx.stroke();

      // Left vertical accent bar
      ctx.fillStyle = k.color;
      ctx.beginPath();
      ctx.roundRect(bx + 1, by + 12, 3.5, boxH - 24, 2);
      ctx.fill();

      ctx.textAlign = 'left';
      ctx.font = '700 10.5px "Cinzel", Georgia, serif';
      ctx.fillStyle = '#a1a0ab';
      ctx.fillText(this._truncateText(ctx, k.label, boxW - 28), bx + 18, by + 25);

      ctx.font = '700 24px "JetBrains Mono", monospace';
      ctx.fillStyle = '#f5f3ef';
      ctx.fillText(this._truncateText(ctx, k.val, boxW - 28), bx + 18, by + 59);

      ctx.font = '500 11px "JetBrains Mono", monospace';
      ctx.fillStyle = k.color;
      ctx.fillText(this._truncateText(ctx, k.sub, boxW - 28), bx + 18, by + 84);
    });

    // Siege Legion Lanes Breakdown Table
    const tableY = cy + 362;
    ctx.font = '700 13px "Cinzel", Georgia, serif';
    ctx.fillStyle = '#e6c687';
    ctx.textAlign = 'left';
    ctx.fillText(
      `🛡️ SIEGE LEGION LANES BREAKDOWN (${this.numLoadAgents} LOAD AGENT${this.numLoadAgents > 1 ? 'S' : ''} DEPLOYED)`,
      cx + 32,
      tableY
    );

    const tableX = cx + 32;
    const tableW = cardW - 64;
    const headerRowY = tableY + 12;
    const headerRowH = 32;

    ctx.fillStyle = 'rgba(230, 198, 135, 0.10)';
    ctx.strokeStyle = 'rgba(230, 198, 135, 0.24)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(tableX, headerRowY, tableW, headerRowH, 6);
    ctx.fill();
    ctx.stroke();

    const cols = [
      { label: 'SIEGE LEGION', x: tableX + 16, w: 250, align: 'left' },
      { label: 'FORTRESS GATE TARGET', x: tableX + 280, w: 255, align: 'left' },
      { label: 'PEAK SOLDIERS', x: tableX + 555, w: 120, align: 'left' },
      { label: 'PEAK RPS', x: tableX + 695, w: 120, align: 'left' },
      { label: 'TOTAL STRIKES', x: tableX + 835, w: 130, align: 'left' },
      { label: 'AVG P95', x: tableX + 980, w: 100, align: 'left' },
      { label: 'CASUALTY %', x: tableX + tableW - 16, w: 95, align: 'right' }
    ];

    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#e6c687';
    cols.forEach((c) => {
      ctx.textAlign = c.align;
      ctx.fillText(c.label, c.x, headerRowY + 20);
    });

    const visibleRows = s.agentBreakdown.slice(0, 7);
    const rowStep = visibleRows.length > 6 ? 30 : 34;

    visibleRows.forEach((ag, rIdx) => {
      const ry = headerRowY + headerRowH + 22 + rIdx * rowStep;
      if (rIdx % 2 === 1) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.028)';
        ctx.beginPath();
        ctx.roundRect(tableX, ry - 19, tableW, rowStep - 2, 4);
        ctx.fill();
      }

      ctx.font = '600 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#e6c687';
      ctx.fillText(this._truncateText(ctx, ag.agentId, cols[0].w), cols[0].x, ry);

      ctx.fillStyle = '#f5f3ef';
      ctx.fillText(this._truncateText(ctx, ag.endpoint, cols[1].w), cols[1].x, ry);

      ctx.fillStyle = '#d4d4dc';
      ctx.fillText(`${ag.peakVus.toLocaleString()} VUs`, cols[2].x, ry);
      ctx.fillText(`${ag.peakRps.toLocaleString()} req/s`, cols[3].x, ry);
      ctx.fillText(ag.totalReqs.toLocaleString(), cols[4].x, ry);

      ctx.fillStyle = ag.avgP95 > this.thresholds.nominalMs ? '#f59e0b' : '#10b981';
      ctx.fillText(`${ag.avgP95.toLocaleString()} ms`, cols[5].x, ry);

      ctx.textAlign = 'right';
      ctx.fillStyle = ag.errorPct > 1 ? '#f43f5e' : '#10b981';
      ctx.fillText(`${ag.errorPct.toFixed(2)}%`, cols[6].x, ry);
    });

    // Footer dismissal hint
    ctx.textAlign = 'center';
    ctx.font = '500 11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#8b8a96';
    ctx.fillText(
      'CLICK ANYWHERE ON THE CANVAS OR PRESS "📜 HIDE SUMMARY" TO RETURN TO THE 3D BATTLEFIELD',
      cx + cardW / 2,
      cy + cardH - 16
    );

    ctx.restore(); // end clip

    // Outer Champagne Gold Frame Border
    ctx.strokeStyle = 'rgba(230, 198, 135, 0.42)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(cx, cy, cardW, cardH, 14);
    ctx.stroke();

    ctx.restore();
  }
}

function formatElapsed(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
