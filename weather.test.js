import assert from 'node:assert/strict'
import test from 'node:test'
import { LowCloud, moonAge, moonIllumination, seasonFor, weatherFor } from './weather.js'

test('the moon is full and new on known dates', () => {
  // Full moon 2024-01-25 17:54 UTC, new moon 2024-02-09 22:59 UTC.
  assert.ok(Math.abs(moonAge(new Date(Date.UTC(2024, 0, 25, 17, 54))) - 0.5) < 0.02)
  const newMoon = moonAge(new Date(Date.UTC(2024, 1, 9, 22, 59)))
  assert.ok(Math.min(newMoon, 1 - newMoon) < 0.02)
  assert.ok(moonIllumination(0.5) > 0.99)
  assert.ok(moonIllumination(0) < 0.01)
})

test('overcast low cloud closes over everywhere', () => {
  const cloud = new LowCloud()
  const { amount, base, top } = weatherFor({ lowCloud: 'overcast', mist: 'off' }, 172, 16).lowCloud
  cloud.set(amount, base, top)
  for (let x = -600; x <= 600; x += 37) {
    for (let z = -600; z <= 600; z += 41) assert.ok(cloud.coverAt(x, z) >= 0.85)
  }
  assert.ok(cloud.inside({ x: 0, y: (base + top) / 2, z: 0 }) > 0.5)
  assert.equal(cloud.inside({ x: 0, y: 2, z: 0 }), 0)
})

test('mist and low cloud can be switched off or forced', () => {
  for (let day = 1; day <= 365; day += 7) {
    const clear = weatherFor({ mist: 'off', lowCloud: 'off' }, day, 7)
    assert.equal(clear.mist, 0)
    assert.equal(clear.lowCloud.amount, 0)
  }
  assert.equal(weatherFor({ mist: 'thick', lowCloud: 'off' }, 172, 15).mist, 1)
})

test('trees are bare in winter, in leaf in summer, turning in autumn', () => {
  assert.ok(seasonFor(20).bare > 0.95)
  assert.ok(seasonFor(190).bare < 0.05)
  assert.ok(seasonFor(295).autumn > 0.8)
  assert.ok(seasonFor(220).dry > 0.5)
})
