import * as T from 'three'
import { createControls, deviceKey, loadBindings } from './controls.js'
import { createSettings, keyLabel } from './settings.js'
import { createCar, createStepper, stepCar } from './vehicle.js'
import { HALF_WORLD, LANDMARKS, PAD, SPAWN, isPaved, nearestRoad, resolveLandmarks, roads } from './roads.js'
import { buildCar, buildWorld } from './scenery.js'

const select = id => document.getElementById(id)
const notice = select('notice')
const view = select('view')
const scene = new T.Scene()
const camera = new T.PerspectiveCamera(56, 1, 0.15, 2100)
let renderer
try {
  renderer = new T.WebGLRenderer({ antialias: true })
} catch (error) {
  notice.textContent = 'County Road needs a browser with WebGL 2 and hardware acceleration.'
  notice.hidden = false
  throw error
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = T.PCFShadowMap
renderer.toneMapping = T.ACESFilmicToneMapping
view.append(renderer.domElement)

function resize() {
  const { clientWidth, clientHeight } = view
  renderer.setSize(clientWidth, clientHeight, false)
  camera.aspect = clientWidth / Math.max(1, clientHeight)
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

const sun = buildWorld(scene)
const model = buildCar(scene)
const bindings = loadBindings()
const settings = createSettings(bindings, updateBindingHints)
const controls = createControls(bindings, settings.isOpen)
const controllerStatus = select('controller')
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
let input = controls()
let cameraYaw
let noticeUntil = 0
let lastControllerStatus
const cameraPosition = new T.Vector3()
const focus = new T.Vector3()
const nextFocus = new T.Vector3()
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
  cameraYaw = undefined
  announce(message)
}

const advance = createStepper(() => {
  const { x, z } = car
  stepCar(car, input, isPaved)
  resolveLandmarks(car, x, z)
  if (Math.max(Math.abs(car.x), Math.abs(car.z)) > HALF_WORLD) recover('Map edge · returned to the nearest road')
})

function renderCar(delta) {
  model.root.position.set(car.x, 0.024, car.z)
  model.root.rotation.y = car.heading
  model.body.rotation.x = -car.ax * 0.0055
  model.body.rotation.z = -car.ay * 0.006
  model.brakeMaterial.emissiveIntensity = 0.55 + 2.4 * input.brake
  for (const { pivot, spin, front } of model.wheels) {
    if (front) pivot.rotation.y = -car.steer
    spin.rotation.x += car.u / 0.33 * delta
  }
}

function updateCamera(delta) {
  const desiredYaw = car.heading - input.lookX * Math.PI * 0.9
  const snap = cameraYaw === undefined
  cameraYaw ??= desiredYaw
  const difference = desiredYaw - cameraYaw
  cameraYaw += Math.atan2(Math.sin(difference), Math.cos(difference)) * (1 - Math.exp(-8 * delta))
  const sin = Math.sin(cameraYaw)
  const cos = Math.cos(cameraYaw)
  const distance = 7.2 + Math.min(1.8, Math.abs(car.u) * 0.035)
  cameraPosition.set(car.x - sin * distance, 3.26 + input.lookY * 1.3, car.z - cos * distance)
  nextFocus.set(car.x + sin * 2.3, 0.88, car.z + cos * 2.3)
  const blend = snap ? 1 : 1 - Math.exp(-13 * delta)
  camera.position.lerp(cameraPosition, blend)
  focus.lerp(nextFocus, blend)
  camera.lookAt(focus)
  sun.position.set(car.x - 29, 43, car.z - 18)
  sun.target.position.set(car.x, 0, car.z)
}

function updateHud(now) {
  speed.textContent = String(Math.round(Math.hypot(car.u, car.v) * 3.6))
  gear.textContent = car.reverse ? 'R' : String(car.gear)
  rpm.style.transform = `scaleX(${car.rpm / 6900})`
  const custom = input.devices.some(device => device.mapping !== 'standard' || bindings.devices[deviceKey(device)])
  const status = custom ? 'Controller / wheel · see Settings for bindings'
    : input.connected ? 'Controller connected' : 'Press a button on your controller'
  if (lastControllerStatus !== status) {
    controllerStatus.textContent = status
    select('standard-bindings').hidden = custom
    lastControllerStatus = status
  }
  if (now >= noticeUntil) notice.hidden = true
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
  advance(delta)
  renderCar(delta)
  updateCamera(delta)
  updateHud(now)
  renderer.render(scene, camera)
})
