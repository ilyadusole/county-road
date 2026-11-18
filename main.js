import * as T from 'three'
import { createControls, deviceKey, loadBindings } from './controls.js'
import { createSettings, keyLabel } from './settings.js'
import { createCar, createStepper, interpolateCarPose, stepCar } from './vehicle.js'
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

function resize() {
  const { clientWidth, clientHeight } = view
  if (!clientWidth || !clientHeight) return
  const pixelRatio = Math.min(devicePixelRatio, 1.25, Math.sqrt(MAX_RENDER_PIXELS / (clientWidth * clientHeight)))
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

function updateBindingHints() {
  const label = action => keyLabel(bindings.keys[action].find(Boolean))
  select('keyboard-hint').textContent = `Keyboard · ${label('throttle')} throttle · ${label('brake')} brake · ${label('left')} / ${label('right')} steer · ${label('reverse')} reverse · ${label('reset')} recover`
}

function announce(message) {
  notice.textContent = message
  notice.hidden = false
  noticeUntil = performance.now() + 2100
}

function recover(message) {
  car = createCar(nearestRoad(car.x, car.z, car.heading))
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
  const gearLabel = car.reverse ? 'R' : String(car.gear)
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
  settings.update(input.devices)
  if (settings.isOpen()) return
  if (input.reset) recover('Recovered to the nearest road')
  if (input.reverse) {
    if (Math.hypot(car.u, car.v) < 0.5) {
      car.reverse = !car.reverse
      car.gear = 1
      car.shiftDelay = 0
    } else {
      announce('Stop before changing direction')
    }
  }
  const fraction = advance(delta)
  interpolateCarPose(previousCar, car, fraction, pose)
  renderCar()
  updateCamera(delta)
  updateHud(now)
  renderer.render(scene, camera)
})
