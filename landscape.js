// Rolling countryside around the drivable area, ported from RC Flight Sim
// (src/sim/terrain.js, src/world/ground.js, the terrain in world.js).
// The drivable square stays flat at y = 0 (the car's physics assume it);
// beyond it gentle hills rise towards the horizon, covered in a patchwork of
// farm fields with hedgerows, all drawn per pixel by the ground shader.
import * as T from 'three'
import { HALF_WORLD } from './roads.js'
import { addCloudShadows } from './sky.js'

// Flat out to here (m from the centre, square), hills fully grown over BLEND.
export const FLAT_EDGE = HALF_WORLD + 50
const BLEND = 320
export const TERRAIN_SIZE = 7200
const TERRAIN_SEGMENTS = 360

function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453
  return s - Math.floor(s)
}

function smoothNoise(x, z) {
  const xi = Math.floor(x)
  const zi = Math.floor(z)
  const xf = x - xi
  const zf = z - zi
  const u = xf * xf * (3 - 2 * xf)
  const v = zf * zf * (3 - 2 * zf)
  const a = hash(xi, zi)
  const b = hash(xi + 1, zi)
  const c = hash(xi, zi + 1)
  const d = hash(xi + 1, zi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

function fbm(x, z) {
  let sum = 0
  let amp = 1
  let freq = 1
  for (let i = 0; i < 4; i++) {
    sum += amp * smoothNoise(x * freq, z * freq)
    amp *= 0.5
    freq *= 2.03
  }
  return sum / 1.875
}

/** Distance outside the flat square, with rounded corners. */
function outside(x, z) {
  const dx = Math.max(0, Math.abs(x) - FLAT_EDGE)
  const dz = Math.max(0, Math.abs(z) - FLAT_EDGE)
  return Math.hypot(dx, dz)
}

/** Ground height (m) at a point. 0 everywhere the car can drive. */
export function heightAt(x, z) {
  const r = outside(x, z)
  if (r <= 0) return 0
  const t = Math.min(1, r / BLEND)
  const blend = t * t * (3 - 2 * t)
  // Hills that never dip below the fields at their foot.
  const hills = Math.max(0, fbm(x / 220, z / 220) * 55 - 14) + fbm(x / 60, z / 60) * 6
  const far = Math.max(0, (r - 500) / 1400) * 140 * fbm(x / 600 + 7, z / 600 + 3)
  return blend * hills + far
}

function grassTexture() {
  // 6 m of lawn: an even mid green with fine, low-contrast blade strokes,
  // so from a distance it reads as smooth grass, not camouflage.
  const N = 512
  const c = document.createElement('canvas')
  c.width = c.height = N
  const ctx = c.getContext('2d')
  let seed = 3
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  ctx.fillStyle = '#6a8c3e'
  ctx.fillRect(0, 0, N, N)
  ctx.lineCap = 'round'
  for (let i = 0; i < 30000; i++) {
    const x = rnd() * N
    const y = rnd() * N
    const len = 1.5 + rnd() * 3.5
    const a = -Math.PI / 2 + (rnd() - 0.5) * 1.2
    const l = 30 + rnd() * 16
    ctx.strokeStyle = `hsla(${80 + rnd() * 16}, ${36 + rnd() * 14}%, ${l}%, 0.55)`
    ctx.lineWidth = 0.8 + rnd() * 0.6
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
    ctx.stroke()
  }
  const t = new T.CanvasTexture(c)
  t.wrapS = t.wrapT = T.RepeatWrapping
  t.colorSpace = T.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/**
 * Close-up grass: a metre of blades as brightness (0.5 = no change), laid
 * over the ground near the camera so close up you see blades.
 */
function grassFineTexture() {
  const N = 512
  const c = document.createElement('canvas')
  c.width = c.height = N
  const g = c.getContext('2d')
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  g.fillStyle = 'rgb(92, 96, 88)'
  g.fillRect(0, 0, N, N)
  g.lineCap = 'round'
  for (let i = 0; i < 14000; i++) {
    const k = i / 14000
    const x = rnd() * N
    const y = rnd() * N
    const len = 6 + rnd() * 14 + k * 8
    const a = rnd() * Math.PI * 2
    const v = 104 + k * 50 + rnd() * 30
    const yel = rnd() * 14
    g.strokeStyle = `rgb(${Math.round(v + yel)}, ${Math.round(v + 4)}, ${Math.round(v - 10 - yel)})`
    g.lineWidth = 1.6 + rnd() * 1.8
    // Drawn wrapping round the edges so the tile repeats seamlessly.
    for (const ox of [-N, 0, N]) {
      for (const oy of [-N, 0, N]) {
        const x0 = x + ox
        const y0 = y + oy
        if (x0 < -40 || x0 > N + 40 || y0 < -40 || y0 > N + 40) continue
        g.beginPath()
        g.moveTo(x0, y0)
        g.quadraticCurveTo(x0 + Math.cos(a) * len * 0.6 + 2, y0 + Math.sin(a) * len * 0.6, x0 + Math.cos(a) * len, y0 + Math.sin(a) * len)
        g.stroke()
      }
    }
  }
  const px = g.getImageData(0, 0, N, N).data
  let sum = 0
  for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2]
  const mean = sum / (px.length / 4) / 3 / 255
  const tex = new T.CanvasTexture(c)
  tex.wrapS = tex.wrapT = T.RepeatWrapping
  tex.colorSpace = T.NoColorSpace
  tex.anisotropy = 8
  return { tex, mean }
}

const GLSL = /* glsl */ `
varying vec3 vGroundWorld;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), u.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), u.x), u.y);
}
float gFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * gNoise(p); p = p * 2.07 + vec2(5.3, 1.7); a *= 0.5; }
  return s;
}
`

/** Add the per-pixel ground detail to the terrain's material. */
function addGroundDetail(material) {
  const fine = grassFineTexture()
  const edge = FLAT_EDGE.toFixed(1)
  material.onBeforeCompile = shader => {
    shader.uniforms.grassFine = { value: fine.tex }
    shader.uniforms.grassFineMean = { value: fine.mean }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL}\nuniform sampler2D grassFine;\nuniform float grassFineMean;`)
      .replace('#include <map_fragment>', /* glsl */ `
        vec2 p = vGroundWorld.xz;
        // Grass texture at two scales and angles, blended by a slow noise,
        // so no repeat pattern shows.
        vec2 q = p / 6.0;
        vec2 uvB = vec2(q.x * 0.81 - q.y * 0.59, q.x * 0.59 + q.y * 0.81) * 0.43 + 0.37;
        float mixAB = smoothstep(0.3, 0.7, gNoise(p / 37.0));
        vec3 g = mix(texture2D(map, vMapUv).rgb, texture2D(map, uvB).rgb, mixAB);
        // Large, soft patches of lighter and darker grass.
        g *= 0.94 + 0.12 * gFbm(p / 31.0);

        // Fields on a jittered grid, each its own crop.
        vec2 fp = vec2(p.x * 0.96 + p.y * 0.28, -p.x * 0.28 + p.y * 0.96);
        vec2 cellSize = vec2(190.0, 140.0);
        vec2 cell = floor(fp / cellSize);
        vec2 f = fract(fp / cellSize);
        vec2 wob = vec2(gNoise(fp / 60.0 + 3.0), gNoise(fp / 60.0 + 9.0)) - 0.5;
        f += wob * 0.08;
        float h = gHash(cell);
        // Where you drive: meadows of slightly different greens, no hedges
        // (nothing there to hit). Beyond: the full patchwork.
        vec2 out2 = max(abs(p) - ${edge}, 0.0);
        float farm = smoothstep(10.0, 110.0, length(out2));
        g *= 1.0 + (gHash(cell + 7.0) - 0.5) * 0.12 * (1.0 - farm);
        if (farm > 0.0) {
          vec3 field;
          if (h < 0.42) field = g * vec3(1.05, 1.08, 0.95);                       // pasture
          else if (h < 0.58) field = vec3(0.62, 0.55, 0.32) * (0.9 + 0.2 * gNoise(fp / 4.0)); // stubble
          else if (h < 0.7) field = vec3(0.36, 0.27, 0.19) * (0.8 + 0.35 * step(0.5, fract(fp.x / 1.6))); // ploughed
          else if (h < 0.86) field = vec3(0.42, 0.58, 0.22) * (0.85 + 0.3 * step(0.5, fract(fp.y / 2.2))); // crop rows
          else field = vec3(0.55, 0.62, 0.3) * (0.9 + 0.2 * gNoise(fp / 8.0));    // hay meadow
          // Hedgerows: 3 m wide, dark and lumpy.
          vec2 e = min(f, 1.0 - f) * cellSize;
          float hedge = 1.0 - smoothstep(1.2, 3.2, min(e.x, e.y));
          vec3 hedgeCol = vec3(0.12, 0.2, 0.08) * (0.7 + 0.6 * gNoise(fp / 2.0));
          field = mix(field, hedgeCol, hedge);
          g = mix(g, field, farm);
        }

        // Close up: blades at two scales and angles, fading with distance.
        float grassy = smoothstep(0.0, 0.06, g.g - max(g.r, g.b));
        {
          float camD = length(vGroundWorld - cameraPosition);
          float near = 1.0 - smoothstep(10.0, 90.0, camD);
          if (near > 0.0 && grassy > 0.0) {
            vec2 r1 = vec2(p.x * 0.94 - p.y * 0.34, p.x * 0.34 + p.y * 0.94);
            vec3 b1 = texture2D(grassFine, r1 / 0.9).rgb;
            vec3 b2 = texture2D(grassFine, vec2(p.y, -p.x) / 0.37 + 0.31).rgb;
            vec3 blades = mix(b1, b2, 0.4) / grassFineMean;
            blades = 1.0 + (blades - 1.0) * 0.95;
            float tuft = 0.92 + 0.16 * gNoise(p / 0.45);
            g *= mix(vec3(1.0), blades * tuft, near * grassy);
          }
        }
        diffuseColor.rgb *= g;
      `)
  }
  material.customProgramCacheKey = () => 'countyGround'
  return material
}

/** The terrain mesh: one big grid following heightAt, with the ground shader. */
export function buildTerrain(scene) {
  const geometry = new T.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS)
  geometry.rotateX(-Math.PI / 2)
  const position = geometry.attributes.position
  const colors = []
  // Vertex colours multiply the grass texture, so they stay light.
  const c1 = new T.Color('#f2ffd8')
  const c2 = new T.Color('#c4d79c')
  const c3 = new T.Color('#e8e2c0')
  const tint = new T.Color()
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const z = position.getZ(i)
    const h = heightAt(x, z)
    position.setY(i, h)
    const n = Math.sin(x * 0.011) * Math.cos(z * 0.013) * 0.5 + 0.5
    tint.copy(c1).lerp(c2, n * 0.8)
    if (h > 40) tint.lerp(c3, Math.min(1, (h - 40) / 120))
    colors.push(tint.r, tint.g, tint.b)
  }
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  const map = grassTexture()
  map.repeat.set(TERRAIN_SIZE / 6, TERRAIN_SIZE / 6)
  const material = addCloudShadows(addGroundDetail(new T.MeshLambertMaterial({ map, vertexColors: true })))
  const ground = new T.Mesh(geometry, material)
  scene.add(ground)
  return ground
}
