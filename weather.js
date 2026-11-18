// Mist, fog, low cloud and the seasons, ported from RC Flight Sim
// (src/world/mist.js, volfog.js, seasons.js).
//
// One density field in the air, drawn into three.js's fog shader code so
// every built-in material gets it:
//   haze   the clear-day haze, everywhere (exponential-squared with distance)
//   mist   over the ground: dense up to its top, thinning above, in banks
//   cloud  low cloud between a base and a top, in lumps
// Every fogged pixel samples the field along its line of sight and fogs by
// how much it passes through: grey-white mist, cloud grey from below and
// sunlit from above. The sky (sky.js) does the same, so they match.
import { ShaderChunk, ShaderLib, Vector2 } from 'three'

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// --- Seasons -----------------------------------------------------------------

/**
 * What the day of the year (1-366) does to the plants, for England:
 * bare (0 in leaf .. 1 bare), autumn colour, fresh spring green, a grass
 * colour multiplier, how dried out (dry) and long the grass is.
 */
export function seasonFor(day) {
  const leafOut = smooth(92, 135, day)
  const leafFall = smooth(285, 345, day)
  const bare = 1 - leafOut + leafFall
  const autumn = smooth(262, 300, day) * (1 - smooth(340, 355, day))
  const fresh = smooth(100, 120, day) * (1 - smooth(140, 170, day))
  const winter = Math.max(1 - smooth(60, 110, day), smooth(310, 350, day))
  const dry = smooth(185, 220, day) * (1 - smooth(255, 285, day))
  const regrow = smooth(255, 285, day) * (1 - smooth(315, 340, day))
  const grass = [
    1 - 0.08 * winter + 0.1 * dry + 0.02 * fresh,
    1 - 0.14 * winter + 0.05 * fresh + 0.04 * regrow,
    1 - 0.05 * winter - 0.05 * dry - 0.03 * regrow,
  ]
  const length = Math.min(1, 0.35 * smooth(105, 140, day) * (1 - smooth(160, 190, day))
    + smooth(255, 300, day) * (1 - smooth(330, 360, day)))
  return { bare: Math.min(1, Math.max(0, bare)), autumn, fresh, grass, dry, length }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "21 Jun" for a day of the year (a non-leap year). */
export function formatDay(day) {
  const d = new Date(Date.UTC(2025, 0, 1) + (Math.round(day) - 1) * 86400000)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** Day of the year (1-366) for a Date. */
export function dayOfYear(date) {
  const start = Date.UTC(date.getFullYear(), 0, 0)
  const now = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return Math.round((now - start) / 86400000)
}

/** Local time of day, in hours. */
export function clockHours(date = new Date()) {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600
}

/** "14:30" */
export function formatHours(h) {
  const m = Math.round((((h % 24) + 24) % 24) * 60)
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// --- Moon phase -----------------------------------------------------------------

const SYNODIC = 29.530588853
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14) // a known new moon

/** The moon's age as a fraction of its cycle (0 new, 0.25 first quarter, 0.5 full). */
export function moonAge(date) {
  const days = (date.getTime() - NEW_MOON) / 86400000
  return (((days / SYNODIC) % 1) + 1) % 1
}

/** How much of the moon's face is lit (0-1). */
export const moonIllumination = age => (1 - Math.cos(age * 2 * Math.PI)) / 2

// --- Mist and low cloud --------------------------------------------------------
// The low cloud's pattern comes from noise worked out the same way here (to
// know when the camera is inside it) and on the GPU: a sine-free hash in
// 32-bit floats, step by step.

const f = Math.fround
const fract = x => f(x - Math.floor(x))

function hash(x, y) {
  let a = fract(f(x * f(0.1031)))
  let b = fract(f(y * f(0.1031)))
  let c = a
  const d = f(f(f(a * f(b + f(33.33))) + f(b * f(c + f(33.33)))) + f(c * f(a + f(33.33))))
  a = f(a + d)
  b = f(b + d)
  c = f(c + d)
  return fract(f(f(a + b) * c))
}

function vnoise(x, y) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy)
  const b = hash(ix + 1, iy)
  const c = hash(ix, iy + 1)
  const d = hash(ix + 1, iy + 1)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

/**
 * The weather for a day and time: mist (0-1), its depth (mistTop, m) and
 * low cloud ({ amount, base, top }). 'seasonal' gives misty spring and
 * autumn mornings and some low-cloud days, different every day.
 */
export function weatherFor(settings, day, hours) {
  const spring = smooth(60, 85, day) * (1 - smooth(130, 155, day))
  const autumn = smooth(245, 275, day) * (1 - smooth(320, 345, day))
  const season = Math.max(spring * 0.7, autumn)
  const r = k => fract(Math.sin(day * 12.9898 + k * 78.233) * 43758.5453)
  const morning = 1 - smooth(8.5, 11.5, hours) + 0.35 * smooth(18, 21.5, hours)
  let mist = 0
  if (settings.mist === 'light') mist = 0.55
  else if (settings.mist === 'thick') mist = 1
  else if (settings.mist !== 'off' && r(1) < 0.55 * season) mist = Math.min(1, morning) * (0.3 + 0.7 * r(2))
  let amount = 0
  if (settings.lowCloud === 'broken') amount = 0.5
  else if (settings.lowCloud === 'overcast') amount = 1
  else if (settings.lowCloud !== 'off' && r(3) < 0.45 * season) amount = 0.35 + 0.55 * r(4)
  const base = 45 + r(5) * 45 + smooth(10, 15, hours) * 20
  const mistTop = settings.mist === 'thick' ? 30 : settings.mist === 'light' ? 55 : 25 + r(7) * 35
  return { mist, mistTop, lowCloud: { amount, base, top: base + 30 + r(6) * 25 } }
}

export class LowCloud {
  constructor() {
    this.offset = new Vector2()
    this.amount = 0
    this.base = 60
    this.top = 100
  }

  /** Cover (0-1) at world (x, z), as drawn (vfCover). */
  coverAt(x, z) {
    const px = (x + this.offset.x) / 260
    const py = (z + this.offset.y) / 260
    const n = (0.5 * vnoise(px, py) + 0.25 * vnoise(px * 2.1 + 5.3, py * 2.1 + 1.7)) / 0.75
    const t = 0.7 + (0.16 - 0.7) * this.amount
    // (Overcast: a closed deck, no holes.)
    const solid = 0.85 * smooth(0.85, 1, this.amount)
    const c = smooth(t - 0.12, t + 0.3, n)
    return c + (1 - c) * solid
  }

  /** How far into the cloud a point is (0 clear .. 1 inside). */
  inside(p) {
    if (this.amount <= 0) return 0
    const inBand = smooth(this.base - 10, this.base + 10, p.y) * (1 - smooth(this.top - 12, this.top + 6, p.y))
    if (inBand <= 0) return 0
    const c = this.coverAt(p.x, p.z)
    return inBand * c * c
  }

  set(amount, base, top) {
    this.amount = amount
    this.base = base
    this.top = top
  }

  /** Drift with the wind (velocity, m/s: x and y = world x and z). */
  update(dt, wind) {
    this.offset.x -= wind.x * 1.2 * dt
    this.offset.y -= wind.y * 1.2 * dt
  }
}

// --- The fog field in the shaders ----------------------------------------------

/** Shared by every fogged material and the sky. Plain objects: x, y, z, w. */
export const fog4 = {
  a: { x: 0, y: 0, z: 0, w: 0 }, // mist density (/m), mist top (m), cloud amount, cloud density (/m)
  b: { x: 60, y: 100, z: 0, w: 0 }, // cloud base, top (m), drift x, z (m)
  sun: { x: 0, y: 1, z: 0, w: 0 }, // towards the sun, w: forward-scatter strength
  under: { x: 0.6, y: 0.62, z: 0.66, w: 0 }, // cloud colour from below (screen colours)
  top: { x: 1, y: 1, z: 1, w: 0 }, // ... sunlit, from above
}

export const fogUniforms = () => ({
  fogMistA: { value: fog4.a },
  fogMistB: { value: fog4.b },
  fogSun: { value: fog4.sun },
  fogUnder: { value: fog4.under },
  fogTop: { value: fog4.top },
})

export const FIELD_GLSL = /* glsl */ `
uniform vec4 fogMistA;
uniform vec4 fogMistB;
uniform vec4 fogSun;
uniform vec4 fogUnder;
uniform vec4 fogTop;
float vfHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vfNoise(vec2 p) {
  vec2 i = floor(p), f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = vfHash(i), b = vfHash(i + vec2(1.0, 0.0)), c = vfHash(i + vec2(0.0, 1.0)), d = vfHash(i + vec2(1.0, 1.0));
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}
float vfCover(vec2 xz) {
  vec2 p = (xz + fogMistB.zw) / 260.0;
  float n = 0.5 * vfNoise(p) + 0.25 * vfNoise(p * 2.1 + vec2(5.3, 1.7));
  n *= 1.0 / 0.75;
  float t = mix(0.7, 0.16, fogMistA.z);
  float solid = 0.85 * smoothstep(0.85, 1.0, fogMistA.z);
  return mix(smoothstep(t - 0.12, t + 0.3, n), 1.0, solid);
}
vec2 vfDensity(vec3 p, float ground) {
  vec2 d = vec2(0.0);
  if (fogMistA.x > 0.0) {
    float bank = vfNoise((p.xz + fogMistB.zw * 0.3) / 140.0);
    float top = fogMistA.y + (vfNoise(p.xz / 90.0 + 7.0) - 0.5) * fogMistA.y * 0.6;
    float H = max(top * 0.3, 4.0);
    d.x = fogMistA.x * (0.35 + 1.3 * bank) * exp(-max(p.y - ground - top, 0.0) / H);
  }
  if (fogMistA.z > 0.0) {
    float c = vfCover(p.xz);
    if (c > 0.0) {
      float lump = (c - 0.5) * 14.0;
      float band = smoothstep(fogMistB.x - lump - 10.0, fogMistB.x - lump + 10.0, p.y) * (1.0 - smoothstep(fogMistB.y + lump - 12.0, fogMistB.y + lump + 6.0, p.y));
      float thick = 0.4 + 1.0 * vfNoise((p.xz + fogMistB.zw) / 70.0 + 3.0);
      // (Overcast: a solid deck, no thin spots for the sky to show through.)
      d.y = fogMistA.w * c * c * thick * band * (1.0 + 2.0 * smoothstep(0.85, 1.0, fogMistA.z));
    }
  }
  return d;
}
// Fog along the line of sight from the camera to a point: how much (.x)
// and the colour it takes on (.yzw), given the haze colour.
vec4 vfAlong(vec3 from, vec3 to, vec3 hazeCol) {
  vec3 ray = to - from;
  float len = length(ray);
  vec3 dir = ray / max(len, 1e-4);
  float ymax = max(fogMistA.y * 1.6 + 30.0, fogMistA.z > 0.0 ? fogMistB.y + 14.0 : 0.0);
  float t0 = 0.0, t1 = len;
  if (abs(dir.y) > 1e-4) {
    float tTop = (ymax - from.y) / dir.y;
    if (dir.y > 0.0) t1 = min(t1, max(tTop, 0.0)); else t0 = max(t0, tTop);
  } else if (from.y > ymax) t1 = 0.0;
  float odMist = 0.0, odCloud = 0.0;
  if (t1 > t0) {
    const int N = 10;
    float step = (t1 - t0) / float(N);
    for (int i = 0; i < N; i++) {
      vec3 p = from + dir * (t0 + (float(i) + 0.5) * step);
      vec2 d = vfDensity(p, 0.0);
      odMist += d.x * step;
      odCloud += d.y * step;
    }
  }
  float fromAbove = smoothstep(fogMistB.x, fogMistB.y, from.y);
  vec3 cloudCol = mix(fogUnder.rgb, fogTop.rgb, fromAbove);
  float od = odMist + odCloud;
  vec3 col = od > 0.0 ? mix(hazeCol, cloudCol, odCloud / od) : hazeCol;
  float s = max(dot(dir, fogSun.xyz), 0.0);
  col *= 1.0 + fogSun.w * pow(s, 8.0);
  return vec4(od, col);
}
`

/** Build the field into three.js's fog shader code (before any material compiles). */
export function installVolumetricFog(hazeDensity) {
  for (const lib of Object.values(ShaderLib)) {
    if (lib.uniforms?.fogColor) Object.assign(lib.uniforms, fogUniforms())
  }
  ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogWorld;
#endif`
  ShaderChunk.fog_vertex = `#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogWorld = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );
#endif`
  ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorld;
	uniform float fogNear;
	uniform float fogFar;
	uniform float fogDensity;
	${FIELD_GLSL}
#endif`
  ShaderChunk.fog_fragment = `#ifdef USE_FOG
	{
		float hz = ${hazeDensity.toFixed(7)} * vFogDepth;
		float od = hz * hz;
		vec3 col = fogColor;
		if ( fogMistA.x > 0.0 || fogMistA.z > 0.0 ) {
			vec4 f = vfAlong( cameraPosition, vFogWorld, fogColor );
			col = mix( fogColor, f.yzw, f.x / max( f.x + od, 1e-5 ) );
			od += f.x;
		}
		gl_FragColor.rgb = mix( gl_FragColor.rgb, col, 1.0 - exp( - od ) );
	}
#endif`
}
