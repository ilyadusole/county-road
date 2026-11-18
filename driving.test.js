import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createControls, defaultKeys, deviceKey, loadBindings, newBinding, readGamepad, saveBindings } from './controls.js'
import { tireForces } from './tires.js'
import { createCar, createStepper, interpolateCarPose, NEUTRAL, STEP, stepCar } from './vehicle.js'
import { PAD, SPAWN, isPaved, nearestRoad, roads } from './roads.js'

const asphalt = () => true
function drive(car, seconds, input, surface = asphalt) {
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    stepCar(car, { ...NEUTRAL, ...input }, surface)
  }
  return car
}

test('analog throttle affects acceleration and brakes hold a complete stop', () => {
  const partial = drive(createCar(), 4, { throttle: 0.25 })
  const full = drive(createCar(), 4, { throttle: 1 })
  assert.ok(partial.u > 4 && full.u > partial.u * 2)
  assert.ok(full.gear > 1)
  assert.equal(full.heading, 0)
  drive(full, 4, { brake: 1 })
  assert.equal(full.u, 0)
  const stoppedWheelAngle = full.wheelAngle
  full.reverse = true
  drive(full, 1, { throttle: 0.4 })
  assert.ok(full.u < -1)
  assert.ok(full.wheelAngle < stoppedWheelAngle)
})

test('a throttle-induced slide can be caught with early countersteer', () => {
  const car = drive(createCar(), 3, { throttle: 0.9 })
  drive(car, 1, { steer: 0.65, throttle: 0.12 })
  const settledSlip = car.slip
  const moderate = drive({ ...car }, 0.45, { steer: 0.65, throttle: 0.55 })
  drive(car, 0.45, { steer: 0.65, throttle: 1 })
  assert.ok(settledSlip < moderate.slip && moderate.slip < car.slip)
  assert.ok(car.slip > settledSlip * 2)
  for (let i = 0; i < 120; i++) {
    const steer = Math.max(-1, Math.min(1, 5 * Math.atan2(car.v, Math.abs(car.u)) + 0.06))
    stepCar(car, { steer, throttle: 0.03, brake: 0 }, asphalt)
  }
  assert.ok(car.u > 12)
  assert.ok(car.slip < settledSlip)
})

test('a brisk road corner holds near 0.7 g with modest rear slip', () => {
  const car = drive(createCar(), 3, { throttle: 0.9 })
  drive(car, 1, { steer: 0.48, throttle: 0.12 })
  assert.ok(car.ay > 6.4 && car.ay < 7.7)
  assert.ok(car.slip < 0.07)
  drive(car, 0.45, { steer: 0.48, throttle: 0.55 })
  assert.ok(car.slip < 0.07)
  assert.ok(car.u > 18)
})

test('right steering turns toward screen-right from spawn', () => {
  const start = { ...createCar(SPAWN), u: 10 }
  const right = drive({ ...start }, 0.6, { steer: 0.5 })
  const left = drive({ ...start }, 0.6, { steer: -0.5 })
  assert.ok(right.x < SPAWN.x && right.heading < SPAWN.heading)
  assert.ok(left.x > SPAWN.x && left.heading > SPAWN.heading)
})

test('fixed-step replay matches between 30 and 60 FPS', () => {
  function replay(fps) {
    const car = createCar()
    let tick = 0
    const frame = createStepper(() => {
      const throttle = tick < 480 ? 0.7 : 0
      const steer = tick >= 360 && tick < 480 ? 0.19 : 0
      const brake = tick >= 480 ? 0.8 : 0
      stepCar(car, { steer, throttle, brake }, asphalt)
      tick++
    })
    for (let i = 0; i < fps * 8; i++) frame(1 / fps)
    assert.equal(tick, 960)
    assert.equal(car.u, 0)
    return [car.x, car.z, car.heading]
  }
  assert.deepEqual(replay(30), replay(60))
})

test('rendered motion follows frame time at 216 km/h with uneven frame intervals', () => {
  const metersPerSecond = 60
  const car = { ...createCar(), u: metersPerSecond }
  const previous = { ...car }
  const pose = {}
  const frame = createStepper(() => {
    Object.assign(previous, car)
    car.z += metersPerSecond * STEP
    car.wheelAngle += metersPerSecond * STEP / 0.33
  })
  let renderTime = -STEP
  for (const elapsed of [1 / 60, 1 / 144, 1 / 120, 1 / 50, 1 / 144, 1 / 90, 1 / 40]) {
    renderTime += elapsed
    const fraction = frame(elapsed)
    interpolateCarPose(previous, car, fraction, pose)
    const expectedDistance = metersPerSecond * renderTime
    assert.ok(Math.abs(pose.z - expectedDistance) < 1e-9)
    assert.ok(Math.abs(pose.wheelAngle * 0.33 - expectedDistance) < 1e-9)
  }
})

test('roads connect at the junctions and recovery points face along paved road', () => {
  assert.ok(isPaved(SPAWN.x, SPAWN.z))
  assert.ok(isPaved(PAD.x, PAD.z))
  assert.ok(!isPaved(100, 100))
  for (const road of roads) {
    for (const { x, z } of road) assert.ok(isPaved(x, z))
  }
  for (const loop of [roads[1], roads[2]]) {
    assert.ok(loop[0].distanceTo(roads[0][0]) < 0.001)
    assert.ok(loop.at(-1).distanceTo(roads[0].at(-1)) < 0.001)
  }
  const recovery = nearestRoad(42, 130, Math.PI)
  assert.ok(isPaved(recovery.x, recovery.z))
  assert.ok(isPaved(recovery.x + Math.sin(recovery.heading), recovery.z + Math.cos(recovery.heading)))
})

test('a two-wheel verge has an intermediate effect on braking and induces yaw', () => {
  const start = { ...createCar({ x: 4.7, z: 100 }), u: 18 }
  const paved = drive({ ...start }, 0.3, { brake: 0.85 })
  const grass = drive({ ...start }, 0.3, { brake: 0.85 }, () => false)
  const mixed = drive({ ...start }, 0.3, { brake: 0.85 }, isPaved)
  assert.ok(paved.u < mixed.u && mixed.u < grass.u)
  assert.ok(Math.abs(mixed.heading) > 0.01 && Math.abs(mixed.heading) < 0.3)
})

test('the four wheel contacts sample the surface independently', () => {
  const car = { ...createCar({ x: 4.7, z: 100, heading: 0.1 }), u: 15 }
  const contacts = []
  stepCar(car, { ...NEUTRAL, steer: 0.3, throttle: 0.5 }, (x, z) => {
    contacts.push({ x, z, paved: isPaved(x, z) })
    return isPaved(x, z)
  })
  assert.equal(new Set(contacts.map(({ x, z }) => `${x},${z}`)).size, 4)
  assert.deepEqual(contacts.map(contact => contact.paved), [false, true, false, true])
  assert.ok(contacts[0].z > contacts[2].z)
})

test('surface, contact speed, slip angle and drive load have distinct effects on each tire', () => {
  const tire = (paved, speed, angle, drive = 0) => tireForces(
    paved, 3550, speed, speed * Math.tan(angle), drive, 0, false, 43_500,
  )
  assert.ok(Math.abs(tire(false, 12, 0).fx) > Math.abs(tire(true, 12, 0).fx))
  assert.ok(Math.abs(tire(true, 12, 0.05).fy) > Math.abs(tire(false, 12, 0.05).fy))
  assert.ok(Math.abs(tire(true, 12, 0.1).fy) > Math.abs(tire(true, 12, 0.05).fy))
  assert.ok(Math.abs(tire(true, 12, 0.1, 6000).fy) < Math.abs(tire(true, 12, 0.1).fy))
  const gripAtSpeed = paved => tire(paved, 40, 0.16).fy / tire(paved, 12, 0.16).fy
  assert.ok(gripAtSpeed(false) < gripAtSpeed(true) && gripAtSpeed(true) < 1)
})

test('raw wheels and pedals use calibrated per-device bindings across a reload', () => {
  const device = {
    id: 'USB steering wheel', connected: true, mapping: '',
    axes: [0.25, 0.8, -0.2], buttons: [{ value: 1, pressed: true }],
  }
  assert.equal(readGamepad(device).throttle, 0)
  const profile = {
    steer: { ...newBinding('steer', 'axis', 0), start: -0.5, end: 0.5, center: 0.25, deadzone: 0, inverted: true },
    throttle: { ...newBinding('throttle', 'axis', 1), start: 0.8, end: -0.8, deadzone: 0 },
    brake: { ...newBinding('brake', 'axis', 2), start: -0.6, end: 0.2, deadzone: 0.1 },
    reset: newBinding('reset', 'button', 0),
  }
  let stored
  const storage = { getItem: () => stored, setItem: (_, value) => { stored = value } }
  const config = { keys: { ...defaultKeys(), throttle: ['KeyE', null] }, devices: { [deviceKey(device)]: profile } }
  assert.equal(saveBindings(config, storage), true)
  const restored = loadBindings(storage)
  assert.deepEqual(restored, config)
  const calibrations = restored.devices[deviceKey(device)]
  const neutral = readGamepad(device, calibrations)
  assert.equal(Math.abs(neutral.steer), 0)
  assert.equal(neutral.throttle, 0)
  assert.equal(neutral.reset, true)
  assert.ok(Math.abs(neutral.brake - 4 / 9) < 1e-9)
  device.axes = [0.5, -0.8, -0.6]
  const pressed = readGamepad(device, calibrations)
  assert.equal(pressed.steer, -1)
  assert.equal(pressed.throttle, 1)
  assert.equal(pressed.brake, 0)
})

test('standard gamepad retains analog inputs and clears them on disconnect', t => {
  const gameWindow = new EventTarget()
  const pad = {
    connected: true, mapping: 'standard', axes: [0.55, 0, 0.04, -0.55],
    buttons: Array.from({ length: 8 }, () => ({ value: 0, pressed: false })),
  }
  pad.buttons[7].value = 0.42
  pad.buttons[6].value = 0.16
  pad.buttons[0].pressed = true
  let pads = [pad]
  Object.defineProperty(globalThis.navigator, 'getGamepads', { configurable: true, value: () => pads })
  const originalWindow = globalThis.window
  globalThis.window = gameWindow
  t.after(() => {
    globalThis.window = originalWindow
    delete globalThis.navigator.getGamepads
  })
  const read = createControls()
  const first = read()
  assert.ok(Math.abs(first.steer - 0.5) < 1e-9)
  assert.equal(first.throttle, 0.42)
  assert.equal(first.brake, 0.16)
  assert.equal(first.lookX, 0)
  assert.equal(first.reverse, true)
  assert.equal(read().reverse, false)
  pads = [null]
  gameWindow.dispatchEvent(new Event('gamepaddisconnected'))
  const lost = read()
  assert.equal(lost.connected, false)
  assert.equal(lost.throttle, 0)
  assert.equal(lost.brake, 0)
  assert.equal(lost.steer, 0)
  pad.buttons[0].pressed = false
  pad.buttons[3].pressed = true
  pads = [pad]
  assert.equal(read().reset, true)
  assert.equal(read().connected, true)
})

test('remapped keyboard and separate pedals work together and settings suppress driving input', t => {
  const gameWindow = new EventTarget()
  const pedals = { id: 'USB pedals', mapping: '', connected: true, axes: [-0.25], buttons: [] }
  const config = {
    keys: { ...defaultKeys(), left: ['KeyQ', null] },
    devices: { [deviceKey(pedals)]: { throttle: newBinding('throttle', 'axis', 0) } },
  }
  let paused = false
  const originalWindow = globalThis.window
  globalThis.window = gameWindow
  Object.defineProperty(globalThis.navigator, 'getGamepads', { configurable: true, value: () => [pedals] })
  t.after(() => {
    globalThis.window = originalWindow
    delete globalThis.navigator.getGamepads
  })
  const sendKey = code => gameWindow.dispatchEvent(Object.assign(new Event('keydown'), { code }))
  const read = createControls(config, () => paused)
  sendKey('KeyA')
  assert.equal(read().steer, 0)
  sendKey('KeyQ')
  const driving = read()
  assert.equal(driving.steer, -1)
  assert.equal(driving.keyboardSteering, true)
  assert.ok(driving.throttle > 0.35 && driving.throttle < 0.38)
  paused = true
  const stopped = read()
  assert.equal(stopped.steer, 0)
  assert.equal(stopped.throttle, 0)
  paused = false
  assert.equal(read().steer, 0)
})
