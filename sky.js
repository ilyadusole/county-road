// Sky, sun, moon, stars, haze and clouds, ported from RC Flight Sim
// (src/world/world.js, sun.js, clouds.js): a Preetham daylight sky tuned for
// clear English summer air, a gradient dome for twilight and night, a layer
// of fair-weather cumulus whose shadows drift across the ground, and the
// lights and horizon haze for the time of day.
import * as T from 'three'
import { Sky } from 'three/addons/objects/Sky.js'

const LATITUDE = 52
const deg = Math.PI / 180
// Everything in the sky is drawn inside the camera's far plane.
const DOME = 3200
export const CLOUD_HEIGHT = 700

/**
 * Sun elevation and azimuth (degrees; azimuth 0 = north, 90 = east) for a
 * local solar time in hours (12 = noon) on a day of the year.
 */
export function sunPosition(hours, day = 172, latitude = LATITUDE) {
  const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (day + 10)) * deg
  const lat = latitude * deg
  const ha = (hours - 12) * 15 * deg
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha)
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)))
  const y = -Math.sin(ha) * Math.cos(decl)
  const x = Math.cos(lat) * Math.sin(decl) - Math.sin(lat) * Math.cos(decl) * Math.cos(ha)
  let az = Math.atan2(y, x) / deg
  if (az < 0) az += 360
  return { elevation: el / deg, azimuth: az }
}

/** A full moon: opposite the sun, a little higher, so there is moonlight all night. */
export function moonPosition(hours, day) {
  const s = sunPosition((hours + 12) % 24, day)
  return { elevation: s.elevation + 8, azimuth: s.azimuth }
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/** Unit direction (+y up) for an elevation/azimuth in degrees (azimuth 0 = north/-z). */
function skyDir(elevationDeg, azimuthDeg, out) {
  const el = elevationDeg * deg
  const az = azimuthDeg * deg
  return out.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az))
}

// Horizon haze by sun elevation: night, deep twilight, sunset, golden hour, day.
const HAZE = [
  [-12, new T.Color('#070b16')],
  [-5, new T.Color('#28334f')],
  [0, new T.Color('#d39a72')],
  [8, new T.Color('#e3c7a4')],
  [20, new T.Color('#a9c7ec')],
]
function hazeColour(el, out) {
  if (el <= HAZE[0][0]) return out.copy(HAZE[0][1])
  for (let i = 1; i < HAZE.length; i++) {
    if (el <= HAZE[i][0]) {
      const [e0, c0] = HAZE[i - 1]
      const [e1, c1] = HAZE[i]
      return out.copy(c0).lerp(c1, (el - e0) / (e1 - e0))
    }
  }
  return out.copy(HAZE.at(-1)[1])
}

const TWILIGHT_ZENITH = new T.Color('#2a4069')
const NIGHT_ZENITH = new T.Color('#02050d')
const TWILIGHT_HORIZON = new T.Color('#8b6f86')
const NIGHT_HORIZON = new T.Color('#0c1528')
const TWILIGHT_GLOW = new T.Color('#e08a4a')

function daySky() {
  const sky = new Sky()
  sky.scale.setScalar(DOME)
  const u = sky.material.uniforms
  // Clear summer air: deeper blue overhead, paler down to the horizon.
  u.turbidity.value = 2.2
  u.rayleigh.value = 2.0
  u.mieCoefficient.value = 0.0025
  u.mieDirectionalG.value = 0.85
  // The Preetham sky is very bright; scaled down (and its blue deepened)
  // before tone mapping, the blue survives instead of washing out.
  u.skyGain = { value: 0.36 }
  u.skyFogColor = { value: new T.Color() }
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace('void main() {', 'uniform float skyGain;\nuniform vec3 skyFogColor;\nvoid main() {')
    .replace('#include <tonemapping_fragment>', `{
      vec3 c = gl_FragColor.rgb * skyGain;
      float l = dot(c, vec3(0.3, 0.55, 0.15));
      gl_FragColor.rgb = max(mix(vec3(l), c, 1.4), 0.0);
    }
    #include <tonemapping_fragment>`)
    // Down to the horizon the sky turns into the haze the distant ground
    // fades into (same colour, mixed the same way), so there's no seam.
    .replace('#include <colorspace_fragment>', `#include <colorspace_fragment>
    {
      vec3 sd = normalize(vWorldPosition - cameraPosition);
      float toHaze = 1.0 - smoothstep(-0.01, 0.16, sd.y);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, skyFogColor, toHaze);
    }`)
  return sky
}

/** A gradient dome for twilight and night (the day sky model only does day). */
function nightDome() {
  const material = new T.ShaderMaterial({
    uniforms: {
      zenith: { value: new T.Color('#02050d') },
      horizon: { value: new T.Color('#0c1528') },
      glow: { value: new T.Color('#3a2a3a') },
      sunDir: { value: new T.Vector3(0, -1, 0) },
      opacity: { value: 0 },
    },
    vertexShader: `varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; uniform vec3 glow; uniform vec3 sunDir; uniform float opacity;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(horizon, zenith, pow(h, 0.45));
        vec2 a = normalize(vDir.xz + 1e-5);
        vec2 b = normalize(sunDir.xz + 1e-5);
        float toward = max(0.0, dot(a, b));
        c += glow * pow(toward, 3.0) * exp(-h * 8.0) * clamp(1.0 + sunDir.y * 6.0, 0.0, 1.0);
        gl_FragColor = vec4(c, opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: T.BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
  })
  const dome = new T.Mesh(new T.SphereGeometry(DOME * 0.98, 32, 16), material)
  dome.renderOrder = -2
  dome.frustumCulled = false
  return dome
}

function starField() {
  const position = []
  const color = []
  let seed = 7
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const radius = DOME * 0.95
  for (let i = 0; i < 2500; i++) {
    const y = random() * 1.1 - 0.1
    const a = random() * Math.PI * 2
    const r = Math.sqrt(1 - y * y)
    position.push(Math.cos(a) * r * radius, y * radius, Math.sin(a) * r * radius)
    const b = 0.18 + random() ** 6 * 0.82
    const warm = random()
    color.push(b, b * (0.92 + warm * 0.08), b * (0.85 + (1 - warm) * 0.15))
  }
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3))
  geometry.setAttribute('color', new T.Float32BufferAttribute(color, 3))
  const material = new T.PointsMaterial({
    size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false,
  })
  const stars = new T.Points(geometry, material)
  stars.renderOrder = -1
  stars.frustumCulled = false
  return stars
}

function moonSprite() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const g = canvas.getContext('2d')
  const glow = g.createRadialGradient(64, 64, 18, 64, 64, 64)
  glow.addColorStop(0, 'rgba(220,230,255,0.35)')
  glow.addColorStop(1, 'rgba(220,230,255,0)')
  g.fillStyle = glow
  g.fillRect(0, 0, 128, 128)
  g.fillStyle = '#eef0f4'
  g.beginPath()
  g.arc(64, 64, 20, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = 'rgba(150,155,170,0.5)'
  for (const [x, y, r] of [[58, 58, 6], [70, 66, 5], [62, 72, 4], [72, 55, 3]]) {
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  const map = new T.CanvasTexture(canvas)
  map.colorSpace = T.SRGBColorSpace
  const moon = new T.Sprite(new T.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false }))
  moon.scale.setScalar(DOME * 0.106)
  moon.renderOrder = -1
  return moon
}

// --- Clouds --------------------------------------------------------------------
// Fair-weather cumulus on one big plane, drawn by a noise shader. The same
// noise dims the sunlight on the ground below, so shadows always match.

/** Shared by the cloud layer and every material that shows cloud shadows. */
export const cloudUniforms = {
  cloudOffset: { value: new T.Vector2() },
  cloudCover: { value: 0.35 },
  cloudSunDir: { value: new T.Vector3(0, 1, 0) },
  cloudShadowStrength: { value: 0.6 },
}

const NOISE = /* glsl */ `
float cHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash(i), cHash(i + vec2(1, 0)), u.x), mix(cHash(i + vec2(0, 1)), cHash(i + vec2(1, 1)), u.x), u.y);
}
float cFbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * cNoise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
  return s;
}
float cloudDensity(vec2 xz) {
  vec2 p = (xz + cloudOffset) / 700.0;
  float n = cFbm(p) * 0.8 + cFbm(p * 3.7 + 4.0) * 0.2;
  float t = mix(0.66, 0.30, cloudCover);
  return smoothstep(t, t + 0.09, n);
}
`

const UNIFORM_DECLS = /* glsl */ `
uniform vec2 cloudOffset;
uniform float cloudCover;
uniform vec3 cloudSunDir;
uniform float cloudShadowStrength;
`

function cloudLayer() {
  const uniforms = {
    ...cloudUniforms,
    lightColor: { value: new T.Color(1, 1, 1) },
    shadeColor: { value: new T.Color(0.62, 0.66, 0.72) },
    hazeColor: { value: new T.Color('#c3d5e8') },
    night: { value: 0 },
  }
  const material = new T.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${UNIFORM_DECLS}
      uniform vec3 lightColor; uniform vec3 shadeColor; uniform vec3 hazeColor; uniform float night;
      varying vec3 vWorld;
      ${NOISE}
      void main() {
        float d = cloudDensity(vWorld.xz);
        if (d < 0.01) discard;
        // Thicker parts are darker underneath; thin edges catch the light.
        float thick = cloudDensity(vWorld.xz + cloudSunDir.xz * 120.0);
        vec3 c = mix(lightColor, shadeColor, clamp(thick * 0.9, 0.0, 1.0));
        float dist = length(vWorld.xz - cameraPosition.xz);
        c = mix(c, hazeColor, smoothstep(700.0, ${(DOME * 0.95).toFixed(1)}, dist) * 0.85);
        float a = min(1.0, d * 1.5) * (1.0 - smoothstep(${(DOME * 0.75).toFixed(1)}, ${(DOME * 1.1).toFixed(1)}, dist)) * mix(1.0, 0.8, night);
        gl_FragColor = vec4(c, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
    fog: false,
  })
  const mesh = new T.Mesh(new T.PlaneGeometry(DOME * 2.6, DOME * 2.6).rotateX(-Math.PI / 2), material)
  mesh.position.y = CLOUD_HEIGHT
  mesh.renderOrder = -1
  mesh.frustumCulled = false
  return { mesh, uniforms }
}

/** Let a lit material show cloud shadows: direct sunlight dims under a cloud. */
export function addCloudShadows(material) {
  const prev = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer)
    Object.assign(shader.uniforms, cloudUniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCloudWorld;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vCloudWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #ifdef USE_INSTANCING
          vCloudWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #endif`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${UNIFORM_DECLS}\nvarying vec3 vCloudWorld;\n${NOISE}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          // Follow the sun ray up to the cloud layer.
          float up = max(cloudSunDir.y, 0.08);
          vec2 at = vCloudWorld.xz + cloudSunDir.xz / up * (${CLOUD_HEIGHT.toFixed(1)} - vCloudWorld.y);
          float shade = 1.0 - cloudShadowStrength * cloudDensity(at);
          reflectedLight.directDiffuse *= shade;
          reflectedLight.directSpecular *= shade;
        }`)
  }
  const prevKey = material.customProgramCacheKey?.bind(material)
  material.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|cloudShadows`
  material.needsUpdate = true
  return material
}

// --- The whole sky -------------------------------------------------------------

/**
 * Build the sky, lights and haze in a scene. Returns setTime(hours, day),
 * setClouds(cover) and update(dt, camera) for every frame.
 */
export function createSky(scene, { haze = 0.0006 } = {}) {
  scene.background = new T.Color('#9cc3e6')
  scene.fog = new T.FogExp2('#c3d5e8', haze)
  const sky = daySky()
  // Night dome, stars and moon follow the camera.
  const night = new T.Group()
  const dome = nightDome()
  const stars = starField()
  const moon = moonSprite()
  night.add(dome, stars, moon)
  const clouds = cloudLayer()
  scene.add(sky, night, clouds.mesh)

  const hemi = new T.HemisphereLight('#cfe3ff', '#4d5a33', 1.1)
  const sun = new T.DirectionalLight('#fff3df', 2.6)
  scene.add(hemi, sun, sun.target)

  const sunDir = new T.Vector3()
  const moonDir = new T.Vector3()
  const lightDir = new T.Vector3()
  const hazeBase = new T.Color()
  const wind = new T.Vector2(2.5, 1.2) // m/s at ground level; clouds drift faster aloft
  const state = { exposure: 0.9, night: 0, hours: 15, day: 172 }

  function setTime(hours, day = state.day) {
    state.hours = hours
    state.day = day
    const s = sunPosition(hours, day)
    const m = moonPosition(hours, day)
    skyDir(s.elevation, s.azimuth, sunDir)
    skyDir(m.elevation, m.azimuth, moonDir)
    const el = s.elevation
    sky.material.uniforms.sunPosition.value.copy(sunDir)
    const dark = smooth(2, -10, el)
    state.night = dark
    const daylight = smooth(-3, 14, el)
    const warm = 1 - smooth(2, 22, el)
    const moonUp = smooth(-3, 8, m.elevation)
    if (el > -3) {
      lightDir.copy(sunDir)
      lightDir.y = Math.max(lightDir.y, 0.03)
      sun.intensity = 2.8 * daylight
      sun.color.setRGB(1, 0.95 - warm * 0.3, 0.88 - warm * 0.5)
    } else {
      lightDir.copy(moonDir)
      lightDir.y = Math.max(lightDir.y, 0.05)
      sun.intensity = 0.32 * moonUp * dark
      sun.color.setRGB(0.62, 0.72, 1)
    }
    lightDir.normalize()
    // Sky light: blue by day, deep blue at night (never quite black).
    hemi.intensity = 0.12 + 1.0 * daylight + 0.08 * (1 - dark)
    hemi.color.setRGB(0.81 - 0.45 * dark, 0.89 - 0.42 * dark, 1 - 0.3 * dark)
    hemi.groundColor.setRGB(0.3 * (1 - dark) + 0.03, 0.35 * (1 - dark) + 0.04, 0.2 * (1 - dark) + 0.06)
    hazeColour(el, hazeBase)
    scene.fog.color.copy(hazeBase)
    scene.background.copy(hazeBase)
    sky.material.uniforms.skyFogColor.value.copy(hazeBase).convertLinearToSRGB()
    // Twilight: deep blue overhead, a warm band where the sun went down.
    const u = dome.material.uniforms
    u.opacity.value = smooth(3, -3, el)
    u.zenith.value.copy(TWILIGHT_ZENITH).lerp(NIGHT_ZENITH, smooth(-2, -12, el))
    u.horizon.value.copy(TWILIGHT_HORIZON).lerp(NIGHT_HORIZON, smooth(0, -9, el))
    u.glow.value.copy(TWILIGHT_GLOW).multiplyScalar(1 - smooth(-4, -14, el))
    u.sunDir.value.copy(sunDir)
    stars.material.opacity = dark
    moon.visible = m.elevation > -2
    moon.material.opacity = 0.25 + 0.75 * smooth(0, -8, el)
    moon.position.copy(moonDir).multiplyScalar(DOME * 0.9)
    // Eyes adapt a little at night.
    state.exposure = 0.9 + 0.5 * dark
    // Clouds: lit by the light of the moment; their shadows follow the sun.
    cloudUniforms.cloudSunDir.value.copy(lightDir)
    cloudUniforms.cloudShadowStrength.value = 0.75 * daylight + 0.2 * dark
    const cu = clouds.uniforms
    const k = Math.min(1, sun.intensity / 2.2)
    const dim = 1 - 0.85 * dark
    cu.lightColor.value.copy(sun.color).multiplyScalar((0.35 + 0.75 * k) * dim).addScalar(0.08 * (1 - dark))
    cu.shadeColor.value.setRGB(0.5, 0.54, 0.6).multiplyScalar((0.25 + 0.85 * k) * dim).lerp(hazeBase, 0.25)
    cu.hazeColor.value.copy(hazeBase)
    cu.night.value = dark
  }

  function setClouds(cover) {
    cloudUniforms.cloudCover.value = cover
    clouds.mesh.visible = cover > 0.01
  }

  function update(dt, camera) {
    const o = cloudUniforms.cloudOffset.value
    o.x -= wind.x * 1.8 * dt
    o.y -= wind.y * 1.8 * dt
    night.position.copy(camera.position)
    clouds.mesh.position.x = camera.position.x
    clouds.mesh.position.z = camera.position.z
    // Keep the sun's light aimed from the right direction wherever the car is.
    sun.target.position.copy(camera.position)
    sun.position.copy(camera.position).addScaledVector(lightDir, 100)
  }

  setTime(state.hours, state.day)
  return { setTime, setClouds, update, state, hemi, sun }
}
