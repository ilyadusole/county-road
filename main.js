import * as T from 'three'
import { createControls, deviceKey, loadBindings } from './controls.js'
import { createSettings, keyLabel } from './settings.js'
import { createCar, createStepper, interpolateCarPose, shiftGear, stepCar } from './vehicle.js'
import { HALF_WORLD, LANDMARKS, PAD, SPAWN, isPaved, nearestRoad, resolveLandmarks, roads } from './roads.js'
import { buildCar, buildWorld } from './scenery.js'

const select = id => document.getElementById(id)
const notice = select('notice')
const view = select('view')
const scene = new T.Scene()
const camera = new T.PerspectiveCamera(56, 1, 0.15, 2100)
const MAX_RENDER_PIXELS = 1920 * 1080
let renderer
try {
  renderer = new T.WebGLRenderer({ antialias: true })
} catch (error) {
  notice.textContent = 'County Road needs a browser with WebGL 2 and hardware acceleration.'
  notice.hidden = false
  throw error
}
renderer.toneMapping = T.ACESFilmicToneMapping
view.append(renderer.domElement)
const touch = createTouchDriving(select('game'))
const drivingAudio = createDrivingAudio(select('open-settings'))

function resize() {
  const { clientWidth, clientHeight } = view
  if (!clientWidth || !clientHeight) return
  const mobile = touch.isActive()
  const pixelBudget = mobile ? 1024 * 768 : MAX_RENDER_PIXELS
  const pixelRatio = Math.min(devicePixelRatio, mobile ? 1 : 1.25, Math.sqrt(pixelBudget / (clientWidth * clientHeight)))
  renderer.setDrawingBufferSize(clientWidth, clientHeight, pixelRatio)
  camera.aspect = clientWidth / clientHeight
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

buildWorld(scene)
const model = buildCar(scene)
const bindings = loadBindings()
const settings = createSettings(bindings, updateBindingHints)
const controls = createControls(bindings, settings.isOpen)
const controllerStatus = select('controller')
const standardBindings = select('standard-bindings')
const speed = select('speed')
const gear = select('gear')
const rpm = select('rpm')

const map = select('map')
const mapContext = map.getContext('2d')
const staticMap = document.createElement('canvas')
staticMap.width = map.width
staticMap.height = map.height
const base = staticMap.getContext('2d')
const mapScale = 0.219
const mapX = x => map.width / 2 + x * mapScale
const mapZ = z => map.height / 2 + z * mapScale
base.lineWidth = 3.3
base.lineJoin = 'round'
base.lineCap = 'round'
base.strokeStyle = '#c0c8ad'
for (const road of roads) {
  base.beginPath()
  road.forEach(({ x, z }, index) => {
    if (index === 0) base.moveTo(mapX(x), mapZ(z))
    else base.lineTo(mapX(x), mapZ(z))
  })
  base.stroke()
}
for (const { x, z, radius = 2.6 } of [...LANDMARKS, { ...PAD, radius: PAD.radius * mapScale }]) {
  base.fillStyle = '#e8b270'
  base.beginPath()
  base.arc(mapX(x), mapZ(z), radius, 0, Math.PI * 2)
  base.fill()
}

let car = createCar(SPAWN)
const gearboxButton = document.createElement('button')
gearboxButton.type = 'button'
gearboxButton.className = 'settings-toggle'
select('open-settings').parentElement.append(gearboxButton)
gearboxButton.addEventListener('click', () => setManualMode(!car.manual))
setManualMode(false)
const previousCar = { ...car }
const pose = {}
let input = controls()
let cameraYaw
let noticeUntil = 0
let lastControllerStatus
let lastHudAt = -Infinity
let lastRpmPercent
let lastMapX, lastMapZ, lastMapHeading
const focus = new T.Vector3()
updateBindingHints()

function setManualMode(manual) {
  car.manual = manual
  gearboxButton.textContent = manual ? 'Manual gears' : 'Auto gears'
  gearboxButton.title = manual ? 'Switch to automatic gears' : 'Switch to manual gears'
  touch.showManual(manual)
}

function updateBindingHints() {
  const label = action => keyLabel(bindings.keys[action].find(Boolean))
  select('keyboard-hint').textContent = `Keyboard · ${label('throttle')} throttle · ${label('brake')} brake · ${label('left')} / ${label('right')} steer · ${label('reverse')} reverse · ${label('reset')} recover · ${label('gearbox')} gearbox · ${label('shiftDown')} / ${label('shiftUp')} shift`
}

function announce(message) {
  notice.textContent = message
  notice.hidden = false
  noticeUntil = performance.now() + 2100
}

function recover(message) {
  const manual = car.manual
  car = createCar(nearestRoad(car.x, car.z, car.heading))
  car.manual = manual
  Object.assign(previousCar, car)
  cameraYaw = undefined
  announce(message)
}

const advance = createStepper(() => {
  Object.assign(previousCar, car)
  stepCar(car, input, isPaved)
  resolveLandmarks(car, previousCar.x, previousCar.z)
  if (Math.max(Math.abs(car.x), Math.abs(car.z)) > HALF_WORLD) recover('Map edge · returned to the nearest road')
})

function renderCar() {
  model.root.position.set(pose.x, 0.024, pose.z)
  model.root.rotation.y = pose.heading
  model.body.rotation.x = -pose.ax * 0.0055
  model.body.rotation.z = -pose.ay * 0.006
  model.brakeMaterial.emissiveIntensity = 0.55 + 2.4 * input.brake
  for (const { pivot, spin, front } of model.wheels) {
    if (front) pivot.rotation.y = -pose.steer
    spin.rotation.x = pose.wheelAngle
  }
}

function updateCamera(delta) {
  const desiredYaw = pose.heading - input.lookX * Math.PI * 0.9
  cameraYaw ??= desiredYaw
  const difference = desiredYaw - cameraYaw
  cameraYaw += Math.atan2(Math.sin(difference), Math.cos(difference)) * (1 - Math.exp(-8 * delta))
  const sin = Math.sin(cameraYaw)
  const cos = Math.cos(cameraYaw)
  const distance = 7.2 + Math.min(1.8, Math.abs(pose.u) * 0.035)
  camera.position.set(pose.x - sin * distance, 3.26 + input.lookY * 1.3, pose.z - cos * distance)
  focus.set(pose.x + sin * 2.3, 0.88, pose.z + cos * 2.3)
  camera.lookAt(focus)
}

function updateHud(now) {
  if (!notice.hidden && now >= noticeUntil) notice.hidden = true
  if (now - lastHudAt < 50) return
  lastHudAt = now
  const speedLabel = String(Math.round(Math.hypot(car.u, car.v) * 3.6))
  const gearLabel = car.reverse ? 'R' : car.gear === 0 ? 'N' : String(car.gear)
  const rpmPercent = Math.round(car.rpm / 69)
  if (speed.textContent !== speedLabel) speed.textContent = speedLabel
  if (gear.textContent !== gearLabel) gear.textContent = gearLabel
  if (rpmPercent !== lastRpmPercent) {
    rpm.style.transform = `scaleX(${rpmPercent / 100})`
    lastRpmPercent = rpmPercent
  }
  const custom = input.devices.some(device => device.mapping !== 'standard' || bindings.devices[deviceKey(device)])
  const status = custom ? 'Controller / wheel · see Settings for bindings'
    : input.connected ? 'Controller connected' : 'Press a button on your controller'
  if (lastControllerStatus !== status) {
    controllerStatus.textContent = status
    standardBindings.hidden = custom
    lastControllerStatus = status
  }
  if (car.x === lastMapX && car.z === lastMapZ && car.heading === lastMapHeading) return
  lastMapX = car.x
  lastMapZ = car.z
  lastMapHeading = car.heading
  mapContext.clearRect(0, 0, map.width, map.height)
  mapContext.drawImage(staticMap, 0, 0)
  mapContext.save()
  mapContext.translate(mapX(car.x), mapZ(car.z))
  mapContext.rotate(-car.heading)
  mapContext.fillStyle = '#ffbf75'
  mapContext.strokeStyle = '#131c17'
  mapContext.lineWidth = 2
  mapContext.beginPath()
  mapContext.moveTo(0, 8)
  mapContext.lineTo(-5, -6)
  mapContext.lineTo(0, -3)
  mapContext.lineTo(5, -6)
  mapContext.closePath()
  mapContext.stroke()
  mapContext.fill()
  mapContext.restore()
}

let last = performance.now()
renderer.setAnimationLoop(now => {
  const delta = Math.max(0, Math.min(0.1, (now - last) / 1000))
  last = now
  input = controls()
  const paused = settings.isOpen()
  touch.apply(input, paused)
  settings.update(input.devices)
  if (paused) {
    drivingAudio.update(now, car, input, true)
    return
  }
  if (input.reset) recover('Recovered to the nearest road')
  if (input.gearbox) setManualMode(!car.manual)
  if (input.reverse) {
    if (Math.hypot(car.u, car.v) < 0.5) {
      car.reverse = !car.reverse
      car.gear = 1
      car.shiftDelay = 0
    } else {
      announce('Stop before changing direction')
    }
  }
  if (input.shiftUp !== input.shiftDown) shiftGear(car, input.shiftUp ? 1 : -1)
  const fraction = advance(delta)
  drivingAudio.update(now, car, input, false)
  interpolateCarPose(previousCar, car, fraction, pose)
  renderCar()
  updateCamera(delta)
  updateHud(now)
  renderer.render(scene, camera)
})

function createDrivingAudio(settingsButton) {
  const toolbar = document.createElement('div')
  toolbar.className = 'drive-toolbar'
  settingsButton.before(toolbar)
  toolbar.append(settingsButton)
  const Audio = window.AudioContext || window.webkitAudioContext
  if (!Audio) return { update() {} }
  const root = import.meta.env.BASE_URL + 'audio/'
  const credits = document.createElement('a')
  credits.className = 'audio-credits'
  credits.href = root + 'credits.txt'
  credits.target = '_blank'
  credits.rel = 'noopener'
  credits.textContent = 'Audio credits'
  credits.hidden = true
  select('settings').querySelector('.settings-footer').append(credits)

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'settings-toggle'
  button.textContent = 'Enable sound'
  toolbar.append(button)
  let graph
  let enabled = false
  let audible = false
  let lastMix = -Infinity

  function buildGraph(context) {
    const master = context.createGain()
    master.gain.value = 0
    const limiter = context.createDynamicsCompressor()
    limiter.threshold.value = -8
    limiter.knee.value = 8
    limiter.ratio.value = 4
    limiter.attack.value = 0.01
    limiter.release.value = 0.15
    master.connect(limiter)
    limiter.connect(context.destination)
    const engine = context.createOscillator()
    // The second harmonic represents two combustion pulses per crank revolution.
    const harmonics = new Float32Array([0, 0.32, 1, 0.24, 0.59, 0.17, 0.38, 0.13, 0.26, 0.09, 0.17, 0.06, 0.11])
    engine.setPeriodicWave(context.createPeriodicWave(new Float32Array(harmonics.length), harmonics))
    const noise = context.createBufferSource()
    noise.buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate)
    const samples = noise.buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
    noise.loop = true

    function voice(source, type, frequency, resonance) {
      const filter = context.createBiquadFilter()
      filter.type = type
      filter.frequency.value = frequency
      filter.Q.value = resonance
      const level = context.createGain()
      level.gain.value = 0
      source.connect(filter)
      filter.connect(level)
      level.connect(master)
      return { frequency: filter.frequency, level: level.gain }
    }

    const exhaust = voice(engine, 'lowpass', 260, 0.7)
    const rolling = voice(noise, 'bandpass', 1150, 0.65)
    const sliding = voice(noise, 'bandpass', 1750, 7.5)
    const intake = voice(noise, 'bandpass', 860, 1.2)
    const braking = voice(noise, 'bandpass', 900, 1.6)
    engine.start()
    noise.start()
    return {
      context, master: master.gain, output: master, pitch: engine.frequency,
      exhaust, rolling, sliding, intake, braking, recordings: {}, engines: [],
    }
  }

  function fade(play) {
    if (!graph || audible === play) return
    audible = play
    graph.master.setTargetAtTime(play ? 0.62 : 0, graph.context.currentTime, 0.035)
  }

  button.addEventListener('click', async () => {
    if (enabled) {
      enabled = false
      fade(false)
      button.textContent = 'Unmute sound'
      return
    }
    button.disabled = true
    try {
      graph ??= buildGraph(new Audio())
      await graph.context.resume()
      if (!graph.recordingLoad) {
        graph.recordingLoad = loadCarRecordings(graph, root).then(count => {
          credits.hidden = count === 0
          button.title = count ? count + ' of 6 recorded car sounds loaded' : 'Synthesised audio'
        })
      }
      enabled = true
      button.textContent = 'Mute sound'
    } catch {
      button.textContent = 'Retry sound'
    } finally {
      button.disabled = false
    }
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) fade(false)
  })

  return {
    update(now, car, input, paused) {
      const play = enabled && !paused && !document.hidden
      fade(play)
      if (!play || now - lastMix < 1000 / 30) return
      lastMix = now
      const { context, pitch, exhaust, rolling, sliding, intake, braking } = graph
      const { throttle, brake } = input
      const time = context.currentTime
      const speed = Math.hypot(car.u, car.v)
      const road = isPaved(car.x, car.z)
      const shift = Math.min(1, car.shiftDelay / 0.18)
      const load = throttle * (1 - 0.56 * shift)
      const motion = Math.min(1, speed / 34)
      const slip = Math.min(1, Math.max(0, (car.pavedSlip - 0.045) / 0.17))
      const { recordings } = graph
      const hasEngines = graph.engines.length > 0 && time >= graph.engineStart
      if (hasEngines) mixRecordedEngine(graph, car.rpm, 0.68 + load * 0.62, time)
      const synth = hasEngines ? 0.08 : 1
      pitch.setTargetAtTime(car.rpm / 60, time, 0.065)
      exhaust.frequency.setTargetAtTime(270 + car.rpm * 0.12 + load * 1100, time, 0.065)
      exhaust.level.setTargetAtTime(synth * (0.12 + load * 0.30 + car.rpm * 0.000014), time, 0.065)
      intake.frequency.setTargetAtTime(540 + car.rpm * 0.15, time, 0.07)
      intake.level.setTargetAtTime(synth * load * (0.045 + car.rpm * 0.000012), time, 0.07)
      rolling.frequency.setTargetAtTime((road ? 830 : 370) + motion * 470, time, 0.08)
      rolling.level.setTargetAtTime(motion * (road ? 0.12 : 0.28), time, 0.075)
      sliding.frequency.setTargetAtTime(1450 + slip * 650 + motion * 180, time, 0.06)
      const squeal = slip * Math.min(1, speed / 8)
      sliding.level.setTargetAtTime(squeal * (recordings.tyre ? 0.08 : 0.42), time, 0.05)
      recordings.tyre?.level.setTargetAtTime(squeal * 0.68, time, 0.07)
      recordings.tyre?.source.playbackRate.setTargetAtTime(0.86 + motion * 0.24 + slip * 0.08, time, 0.09)
      braking.frequency.setTargetAtTime(720 + motion * 630, time, 0.09)
      const brakeNoise = brake * Math.min(1, speed / 8)
      braking.level.setTargetAtTime(brakeNoise * (recordings.brake ? 0.025 : 0.11), time, 0.075)
      recordings.brake?.level.setTargetAtTime(brakeNoise * 0.32, time, 0.09)
      recordings.brake?.source.playbackRate.setTargetAtTime(0.86 + motion * 0.19, time, 0.095)
    },
  }
}

const CYCLE_FRAMES = 2048

function repeatCorrelation(samples, start, end, lag, step) {
  let sum = 0
  let previous = 0
  let current = 0
  for (let i = start + lag; i < end; i += step) {
    const a = samples[i]
    const b = samples[i - lag]
    sum += a * b
    current += a * a
    previous += b * b
  }
  const energy = Math.sqrt(current * previous)
  return energy > 0.0001 ? sum / energy : -1
}

function findEnginePeriod(samples, rate, targetRpm) {
  const stride = Math.max(1, Math.round(rate / 4800))
  const analysis = new Float32Array(Math.floor(samples.length / stride))
  for (let i = 0; i < analysis.length; i++) {
    let sum = 0
    for (let j = 0; j < stride; j++) sum += samples[i * stride + j]
    analysis[i] = sum / stride
  }
  const expected = rate * 20 / (stride * targetRpm)
  const window = Math.min(analysis.length, Math.round(rate / stride * 0.42))
  const hop = Math.max(1, Math.floor((analysis.length - window) / 96))
  const candidates = new Set(Array.from({ length: 13 }, (_, i) => Math.round(expected * (0.82 + i * 0.03))))
  let best = -Infinity
  let start = 0
  let period = Math.round(expected)
  for (let offset = 0; offset + window <= analysis.length; offset += hop) {
    let power = 0
    for (let i = offset; i < offset + window; i += 4) power += analysis[i] ** 2
    if (power < 0.005) continue
    const split = offset + Math.floor(window / 2)
    for (const lag of candidates) {
      const first = repeatCorrelation(analysis, offset, split, lag, 3)
      const second = repeatCorrelation(analysis, split, offset + window, lag, 3)
      const score = 0.68 * Math.min(first, second) + 0.16 * (first + second)
        - 0.24 * Math.abs(Math.log(lag / expected)) + 0.042 * Math.log1p(power)
      if (score <= best) continue
      best = score
      start = offset
      period = lag
    }
  }

  const begin = start * stride
  const end = Math.min(samples.length, begin + window * stride)
  const coarse = period * stride
  const compare = lag => repeatCorrelation(samples, begin, end, lag, stride)
  let fine = coarse
  let fineScore = -Infinity
  for (let lag = Math.max(2, coarse - stride * 2); lag <= coarse + stride * 2; lag++) {
    const score = compare(lag)
    if (score <= fineScore) continue
    fineScore = score
    fine = lag
  }
  const left = compare(fine - 1)
  const right = compare(fine + 1)
  const curvature = left + right - 2 * fineScore
  const fraction = curvature < -1e-8 ? Math.max(-0.5, Math.min(0.5, (left - right) / (2 * curvature))) : 0
  return { begin, end, period: fine + fraction }
}

function centerAndLevel(data) {
  let dc = 0
  for (const value of data) dc += value
  dc /= data.length
  let power = 0
  let peak = 0
  for (let i = 0; i < data.length; i++) {
    const value = data[i] - dc
    data[i] = value
    power += value * value
    peak = Math.max(peak, Math.abs(value))
  }
  if (peak === 0) return data
  const gain = Math.min(10, 0.22 / Math.sqrt(power / data.length), 0.9 / peak)
  for (let i = 0; i < data.length; i++) data[i] *= gain
  return data
}

function engineCycle(samples, rate, targetRpm) {
  const { begin, end, period } = findEnginePeriod(samples, rate, targetRpm)
  const cycle = period * 6
  const repeats = Math.floor((end - begin - 1) / cycle)
  if (repeats < 2) throw new Error('Recording is too short for a V6 cycle')
  const wave = new Float32Array(CYCLE_FRAMES)
  // Fold full 720-degree cycles from the recording with a Hann-weighted overlap.
  // The weights vanish at the ends, so phase 1 joins phase 0 continuously.
  for (let i = 0; i < wave.length; i++) {
    const phase = i / wave.length
    let weightSum = 0
    let total = 0
    for (let n = 0; n < repeats; n++) {
      const position = begin + (n + phase) * cycle
      const index = Math.floor(position)
      const sample = samples[index] + (samples[index + 1] - samples[index]) * (position - index)
      const weight = Math.sin(Math.PI * (n + phase) / repeats) ** 2
      total += sample * weight
      weightSum += weight
    }
    wave[i] = total / weightSum
  }
  return { wave: centerAndLevel(wave), rpm: rate * 20 / period }
}

function alignEngineCycle(wave, reference) {
  if (!reference) return { wave, correlation: 1 }
  let bestShift = 0
  let best = -Infinity
  for (let shift = 0; shift < wave.length; shift++) {
    let sum = 0
    for (let i = 0; i < wave.length; i += 8) sum += reference[i] * wave[(i + shift) % wave.length]
    if (sum <= best) continue
    best = sum
    bestShift = shift
  }
  const aligned = new Float32Array(wave.length)
  let cross = 0
  let aPower = 0
  let bPower = 0
  for (let i = 0; i < wave.length; i++) {
    const a = reference[i]
    const b = wave[(i + bestShift) % wave.length]
    aligned[i] = b
    cross += a * b
    aPower += a * a
    bPower += b * b
  }
  const correlation = Math.max(0, Math.min(1, cross / (Math.sqrt(aPower * bPower) || 1)))
  return { wave: aligned, correlation }
}

function frictionLoop(samples, rate, seconds) {
  const length = Math.min(samples.length, Math.round(rate * seconds))
  const step = Math.max(1, Math.round(rate / 5200))
  const overlap = Math.min(Math.floor(length / 4), Math.round(rate * 0.16))
  const hop = Math.max(1, Math.round(rate * 0.085))
  let bestOffset = 0
  let best = -Infinity
  for (let offset = 0; offset + length <= samples.length; offset += hop) {
    const energy = [0, 0, 0, 0]
    for (let i = step; i < length; i += step) {
      const edge = samples[offset + i] - samples[offset + i - step]
      energy[Math.floor(i * 4 / length)] += edge * edge
    }
    // Prefer sustained friction over sections dominated by a single loud transient.
    const score = Math.min(...energy) + 0.17 * energy.reduce((sum, band) => sum + band, 0)
    if (score <= best) continue
    best = score
    bestOffset = offset
  }
  const data = samples.slice(bestOffset + overlap, bestOffset + length)
  for (let i = 0; i < overlap; i++) {
    const index = data.length - overlap + i
    const fade = 0.5 - 0.5 * Math.cos(Math.PI * i / Math.max(1, overlap - 1))
    const a = 1 - fade
    data[index] = (data[index] * a + samples[bestOffset + i] * fade) / Math.hypot(a, fade)
  }
  return centerAndLevel(data)
}

function createRecordingVoice(context, output, data, rate, highpass) {
  const source = context.createBufferSource()
  const gain = context.createGain()
  source.buffer = context.createBuffer(1, data.length, rate)
  source.buffer.copyToChannel(data, 0)
  source.loop = true
  gain.gain.value = 0
  source.connect(gain)
  if (highpass) {
    const filter = context.createBiquadFilter()
    filter.type = 'highpass'
    filter.frequency.value = highpass
    gain.connect(filter)
    filter.connect(output)
  } else {
    gain.connect(output)
  }
  return { source, level: gain.gain, duration: source.buffer.duration }
}

async function loadCarRecordings(graph, root) {
  const { context, output } = graph
  const engineClips = [['idle', 850], ['rev', 1650], ['mid', 2900], ['high', 5300]]
  const frictionClips = [['tyre', 0.94, 950], ['brake', 0.8, 650]]
  let count = 0
  async function decode(name) {
    const response = await fetch(root + name + '.mp3')
    if (!response.ok) throw Error('HTTP ' + response.status)
    return context.decodeAudioData(await response.arrayBuffer())
  }
  const cycles = []
  for (const [name, targetRpm] of engineClips) {
    try {
      const buffer = await decode(name)
      cycles.push(engineCycle(buffer.getChannelData(0), buffer.sampleRate, targetRpm))
      count++
    } catch (error) {
      console.warn('Could not load recorded engine sound ' + name, error)
    }
  }
  cycles.sort((a, b) => a.rpm - b.rpm)
  let reference
  const start = context.currentTime + 0.04
  for (const { wave, rpm } of cycles) {
    const aligned = alignEngineCycle(wave, reference)
    reference = aligned.wave
    const voice = createRecordingVoice(context, output, reference, context.sampleRate)
    voice.source.playbackRate.value = voice.duration * 850 / 120
    voice.source.start(start)
    graph.engines.push({ ...voice, rpm, correlation: aligned.correlation })
  }
  graph.engineStart = start

  for (const [name, seconds, highpass] of frictionClips) {
    try {
      const buffer = await decode(name)
      const data = frictionLoop(buffer.getChannelData(0), buffer.sampleRate, seconds)
      const voice = createRecordingVoice(context, output, data, buffer.sampleRate, highpass)
      voice.source.start()
      graph.recordings[name] = voice
      count++
    } catch (error) {
      console.warn('Could not load recorded friction sound ' + name, error)
    }
  }
  return count
}

function mixRecordedEngine(graph, rpm, gain, time) {
  const { engines } = graph
  const next = engines.findIndex(engine => engine.rpm >= rpm)
  const upper = next < 0 ? engines.length - 1 : next
  const lower = next <= 0 ? upper : upper - 1
  const span = Math.log(engines[upper].rpm / engines[lower].rpm)
  const progress = span > 0 ? Math.log(rpm / engines[lower].rpm) / span : 0
  const blend = progress * progress * (3 - 2 * progress)
  const partA = 1 - blend
  const partB = blend
  const correlation = engines[upper].correlation
  const level = gain / Math.sqrt(partA ** 2 + partB ** 2 + 2 * partA * partB * correlation)
  for (const [index, engine] of engines.entries()) {
    const weight = index === lower ? partA : index === upper ? partB : 0
    // Every source plays one full engine cycle at the same frequency and phase.
    engine.source.playbackRate.setTargetAtTime(rpm * engine.duration / 120, time, 0.065)
    engine.level.setTargetAtTime(level * weight, time, 0.075)
  }
}

function createTouchDriving(game) {
  const style = document.createElement('style')
  style.textContent = `
    .drive-toolbar { display: flex; flex-wrap: wrap; gap: 0 6px; }
    .touch-game {
      height: 100dvh;
      bottom: auto;
      --touch-size: clamp(52px, min(15vw, 18dvh), 80px);
      --touch-left: max(12px, env(safe-area-inset-left, 0px));
      --touch-right: max(12px, env(safe-area-inset-right, 0px));
      --touch-bottom: max(12px, env(safe-area-inset-bottom, 0px));
      --touch-top: max(10px, env(safe-area-inset-top, 0px));
    }
    .touch-game .controls, .touch-game #open-settings kbd { display: none; }
    .touch-game .title { top: var(--touch-top); left: var(--touch-left); padding: 8px 10px 9px; }
    .touch-game .title h1 { font-size: 20px; }
    .touch-game .drive-toolbar button { min-height: 36px; margin-top: 6px; }
    .touch-game .map { top: var(--touch-top); right: var(--touch-right); padding: 6px 8px; }
    .touch-game #map { width: clamp(64px, 19vw, 102px); }
    .touch-game .dash {
      bottom: calc(var(--touch-bottom) + var(--touch-size) + 53px);
      right: var(--touch-right);
      width: 124px;
      padding: 7px 8px;
      gap: 5px;
    }
    .touch-game #speed { font-size: 30px; }
    .touch-game #notice { top: 30%; width: max-content; max-width: 75%; }
    .touch-driving { position: absolute; inset: 0; pointer-events: none; }
    .touch-driving > div { position: absolute; display: flex; gap: 7px; }
    .touch-driving .steering { left: var(--touch-left); bottom: var(--touch-bottom); }
    .touch-driving .pedals { right: var(--touch-right); bottom: var(--touch-bottom); }
    .touch-driving .drive-actions {
      right: var(--touch-right);
      bottom: calc(var(--touch-bottom) + var(--touch-size) + 7px);
    }
    .touch-driving button {
      pointer-events: auto;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
      -webkit-tap-highlight-color: transparent;
      width: var(--touch-size);
      height: var(--touch-size);
      border-radius: 12px;
      border-color: #ffffff60;
      background: #121b17e0;
      padding: 0;
    }
    .touch-driving .steering button { font-size: 24px; }
    .touch-driving .accelerate { color: var(--accent); }
    .touch-driving .shift-actions {
      left: var(--touch-left);
      bottom: calc(var(--touch-bottom) + var(--touch-size) + 7px);
    }
    .touch-driving .drive-actions button, .touch-driving .shift-actions button { height: 44px; font-size: 11px; }
    .drive-toolbar .settings-toggle { white-space: nowrap; }
    .touch-game .drive-toolbar { max-width: 195px; }
    .audio-credits { color: var(--muted); }
    .touch-driving button[data-held], .touch-driving button:active { color: #232318; background: var(--accent); }
    @media (orientation: landscape) {
      .touch-game .dash { bottom: var(--touch-bottom); left: 50%; right: auto; transform: translateX(-50%); }
      .touch-game #map { width: clamp(64px, 20dvh, 102px); }
    }
  `
  document.head.append(style)

  const pointer = matchMedia('(any-pointer: coarse)')
  const landscape = matchMedia('(orientation: landscape)')
  const overlay = document.createElement('section')
  overlay.className = 'touch-driving'
  overlay.setAttribute('aria-label', 'On-screen driving controls')
  const held = new Map()
  let reverse = false
  let recover = false
  let shift = 0
  let active = false

  function clear() {
    for (const control of held.values()) control.removeAttribute('data-held')
    held.clear()
    reverse = false
    recover = false
    shift = 0
  }

  function updateAvailability() {
    active = pointer.matches || (navigator.maxTouchPoints > 0 && matchMedia('(hover: none)').matches)
    overlay.hidden = !active
    game.classList.toggle('touch-game', active)
    if (!active) clear()
  }

  function controls(className, items) {
    const group = document.createElement('div')
    group.className = className
    for (const [action, text, label, tap] of items) {
      const control = document.createElement('button')
      control.type = 'button'
      control.textContent = text
      control.className = action
      control.setAttribute('aria-label', label)
      control.addEventListener('contextmenu', event => event.preventDefault())
      if (tap) {
        control.addEventListener('click', tap)
      } else {
        control.addEventListener('pointerdown', event => {
          if (event.button !== 0) return
          event.preventDefault()
          control.setPointerCapture(event.pointerId)
          held.set(event.pointerId, control)
          control.setAttribute('data-held', '')
        })
        const release = event => {
          held.delete(event.pointerId)
          if (![...held.values()].includes(control)) control.removeAttribute('data-held')
        }
        for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
          control.addEventListener(event, release)
        }
      }
      group.append(control)
    }
    overlay.append(group)
    return group
  }

  controls('steering', [['left', '←', 'Steer left'], ['right', '→', 'Steer right']])
  controls('pedals', [['brake', 'Brake', 'Brake'], ['accelerate', 'Gas', 'Accelerate']])
  controls('drive-actions', [
    ['reverse', 'Reverse', 'Toggle drive or reverse', () => { reverse = true }],
    ['recover', 'Recover', 'Recover to the nearest road', () => { recover = true }],
  ])
  const shiftButtons = controls('shift-actions', [
    ['downshift', 'Gear −', 'Shift down', () => { shift = -1 }],
    ['upshift', 'Gear +', 'Shift up', () => { shift = 1 }],
  ])
  shiftButtons.hidden = true
  game.append(overlay)
  updateAvailability()
  pointer.addEventListener('change', () => {
    updateAvailability()
    resize()
  })
  landscape.addEventListener('change', clear)
  window.addEventListener('blur', clear)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clear()
  })

  return {
    isActive: () => active,
    showManual(manual) { shiftButtons.hidden = !manual },
    apply(input, paused) {
      if (paused || !active) {
        clear()
        return
      }
      let left = false
      let right = false
      for (const { className } of held.values()) {
        if (className === 'left') left = true
        if (className === 'right') right = true
        if (className === 'brake') input.brake = 1
        if (className === 'accelerate') input.throttle = 1
      }
      if (left || right) {
        input.steer = Number(right) - Number(left)
        input.keyboardSteering = true
      }
      input.reverse ||= reverse
      input.reset ||= recover
      input.shiftDown ||= shift < 0
      input.shiftUp ||= shift > 0
      reverse = false
      recover = false
      shift = 0
    },
  }
}
