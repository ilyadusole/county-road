import * as T from 'three'
import { HALF_WORLD, LANDMARKS, PAD, ROAD_HALF, roads, isPaved } from './roads.js'

const matte = color => new T.MeshStandardMaterial({ color, roughness: 0.83 })
let seed = 7392
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 4294967296
}

function texture(rgb, variance) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const context = canvas.getContext('2d')
  const pixels = context.createImageData(256, 256)
  for (let i = 0; i < pixels.data.length; i += 4) {
    const value = (random() - 0.5) * variance
    rgb.forEach((channel, offset) => { pixels.data[i + offset] = channel + value })
    pixels.data[i + 3] = 255
  }
  context.putImageData(pixels, 0, 0)
  const map = new T.CanvasTexture(canvas)
  map.colorSpace = T.SRGBColorSpace
  map.wrapS = map.wrapT = T.RepeatWrapping
  map.anisotropy = 8
  return map
}

function box(parent, material, sx, sy, sz, x, y, z) {
  const mesh = new T.Mesh(new T.BoxGeometry(sx, sy, sz), material)
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function groundGeometry(positions, indices) {
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3))
  const uv = []
  for (let i = 0; i < positions.length; i += 3) uv.push(positions[i] / 12, positions[i + 2] / 12)
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function ribbon(points, half, height) {
  const positions = []
  const indices = []
  points.forEach((p, i) => {
    const tangent = points[Math.min(i + 1, points.length - 1)].clone()
      .sub(points[Math.max(0, i - 1)]).normalize()
    const nx = tangent.z * half
    const nz = -tangent.x * half
    positions.push(p.x - nx, height, p.z - nz, p.x + nx, height, p.z + nz)
    if (i > 0) {
      const a = i * 2 - 2
      indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1)
    }
  })
  return groundGeometry(positions, indices)
}

function disk(radius, x, z, material, height) {
  const mesh = new T.Mesh(new T.CircleGeometry(radius, 96), material)
  mesh.geometry.rotateX(-Math.PI / 2)
  const p = mesh.geometry.attributes.position
  const uv = mesh.geometry.attributes.uv
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + x) / 12, (p.getZ(i) + z) / 12)
  mesh.position.set(x, height, z)
  mesh.receiveShadow = true
  return mesh
}

export function buildWorld(scene) {
  scene.background = new T.Color(0xa9c9d7)
  scene.fog = new T.FogExp2(0xb6cdd2, 0.00145)
  scene.add(new T.HemisphereLight(0xe4f2ff, 0x8c9161, 2.05))
  const sun = new T.DirectionalLight(0xffedcc, 2.3)
  sun.castShadow = true
  sun.shadow.mapSize.set(1536, 1536)
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 0.5, far: 135 })
  sun.shadow.normalBias = 0.035
  sun.shadow.bias = -0.00025
  scene.add(sun, sun.target)

  const grass = new T.MeshStandardMaterial({ map: texture([91, 109, 68], 35), roughness: 1 })
  const asphalt = new T.MeshStandardMaterial({ map: texture([54, 58, 57], 18), roughness: 0.95 })
  const shoulder = matte(0x9c9675)
  const ground = new T.Mesh(new T.PlaneGeometry(3600, 3600), grass)
  ground.rotation.x = -Math.PI / 2
  ground.material.map.repeat.set(300, 300)
  ground.receiveShadow = true
  scene.add(ground)
  const joints = [[0, -360], [0, 360], [-428, 0], [0, 28], [320, 0], [0, -238]]
  const paint = new T.MeshBasicMaterial({ color: 0xe0dac1 })
  const dashGeometry = new T.PlaneGeometry(0.13, 3.1).rotateX(-Math.PI / 2)
  const dashTransforms = []
  const transforms = new T.Object3D()
  for (const points of roads) {
    for (const [width, height, material] of [[5.42, 0.008, shoulder], [ROAD_HALF, 0.016, asphalt]]) {
      const mesh = new T.Mesh(ribbon(points, width, height), material)
      mesh.receiveShadow = true
      scene.add(mesh)
    }
    if (points === roads.at(-1)) continue
    for (let i = 2; i < points.length - 1; i += 3) {
      const p = points[i]
      if (joints.some(([x, z]) => Math.hypot(p.x - x, p.z - z) < 10)) continue
      const next = points[i + 1]
      transforms.rotation.y = Math.atan2(next.x - p.x, next.z - p.z)
      transforms.position.set(p.x, 0.026, p.z)
      transforms.updateMatrix()
      dashTransforms.push(transforms.matrix.clone())
    }
  }
  const markings = new T.InstancedMesh(dashGeometry, paint, dashTransforms.length)
  dashTransforms.forEach((matrix, i) => markings.setMatrixAt(i, matrix))
  scene.add(markings)
  for (const [x, z] of joints) scene.add(disk(ROAD_HALF, x, z, asphalt, 0.019))
  scene.add(disk(PAD.radius, PAD.x, PAD.z, asphalt, 0.02))
  for (const radius of [10, 18]) {
    const ring = new T.Mesh(new T.RingGeometry(radius - 0.05, radius + 0.05, 80), paint)
    ring.rotation.x = -Math.PI / 2
    ring.position.set(PAD.x, 0.027, PAD.z)
    scene.add(ring)
  }

  const barn = new T.Group()
  barn.position.set(LANDMARKS[0].x, 0, LANDMARKS[0].z)
  scene.add(barn)
  box(barn, matte(0x8c4432), 16, 5, 12, 0, 2.5, 0)
  box(barn, matte(0x3b312c), 4.5, 3.6, 0.14, 0, 1.8, 6.02)
  const roof = matte(0x555e5d)
  for (const side of [-1, 1]) {
    const pitch = box(barn, roof, 17, 0.22, 7.15, 0, 6.1, side * 3.1)
    pitch.rotation.x = side * 0.35
  }

  const tower = new T.Group()
  tower.position.set(LANDMARKS[1].x, 0, LANDMARKS[1].z)
  scene.add(tower)
  const steel = matte(0x777b70)
  for (const x of [-2.5, 2.5]) for (const z of [-2.5, 2.5]) box(tower, steel, 0.32, 18, 0.32, x, 9, z)
  const tank = new T.Mesh(new T.CylinderGeometry(3.8, 3.15, 5.5, 16), matte(0xc2c2a5))
  tank.position.y = 19.2
  tank.castShadow = true
  tower.add(tank)
  const lid = new T.Mesh(new T.ConeGeometry(3.95, 1.45, 16), steel)
  lid.position.y = 22.65
  tower.add(lid)

  for (const [geometry, material, count] of [
    [new T.IcosahedronGeometry(1, 1), matte(0x697f4b), 530],
    [new T.IcosahedronGeometry(1, 1), matte(0x506843), 300],
  ]) {
    const trees = new T.InstancedMesh(geometry, material, count)
    for (let i = 0; i < count; i++) {
      const x = (random() - 0.5) * 2400
      const z = (random() - 0.5) * 2400
      if (Math.max(Math.abs(x), Math.abs(z)) < HALF_WORLD + 14 || isPaved(x, z)) {
        i--
        continue
      }
      const scale = 2.8 + random() * 6
      transforms.position.set(x, scale * 0.68, z)
      transforms.scale.set(scale * 0.86, scale * 1.38, scale * 0.82)
      transforms.rotation.y = random() * Math.PI
      transforms.updateMatrix()
      trees.setMatrixAt(i, transforms.matrix)
    }
    scene.add(trees)
  }
  return sun
}

function shell(parent, material, sections) {
  const positions = sections.flatMap(([z, width, bottom, top]) =>
    [-width, bottom, z, width, bottom, z, width * 0.86, top, z, -width * 0.86, top, z])
  const indices = [0, 2, 1, 0, 3, 2]
  for (let base = 0; base < positions.length / 3 - 4; base += 4) {
    for (let side = 0; side < 4; side++) {
      const a = base + side
      const b = base + (side + 1) % 4
      indices.push(a, b, a + 4, b, b + 4, a + 4)
    }
  }
  const end = positions.length / 3 - 4
  indices.push(end, end + 1, end + 2, end, end + 2, end + 3)
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const mesh = new T.Mesh(geometry, material)
  mesh.castShadow = true
  parent.add(mesh)
}

export function buildCar(scene) {
  const root = new T.Group()
  const body = new T.Group()
  root.add(body)
  scene.add(root)
  const red = new T.MeshStandardMaterial({ color: 0xc54e31, metalness: 0.32, roughness: 0.32 })
  const glass = new T.MeshStandardMaterial({ color: 0x203337, metalness: 0.38, roughness: 0.18 })
  const trim = matte(0x242729)
  const tire = matte(0x1b2020)
  const alloy = new T.MeshStandardMaterial({ color: 0x8d999d, metalness: 0.67, roughness: 0.34 })
  shell(body, red, [[-2.12, 0.82, 0.28, 0.68], [-1.55, 0.97, 0.24, 0.79],
    [0.25, 0.92, 0.23, 0.75], [1.5, 0.96, 0.23, 0.66], [2.15, 0.79, 0.29, 0.51]])
  shell(body, glass, [[-1.49, 0.76, 0.73, 0.78], [-0.63, 0.71, 0.74, 1.24],
    [0.27, 0.66, 0.71, 1.24], [1.00, 0.79, 0.69, 0.75]])
  box(body, red, 1.2, 0.055, 0.94, 0, 1.245, -0.18)
  box(body, trim, 1.51, 0.13, 0.06, 0, 0.34, -2.13)
  box(body, trim, 1.18, 0.12, 0.06, 0, 0.35, 2.15)
  const brakeMaterial = new T.MeshStandardMaterial({ color: 0xff3e2c, emissive: 0xe71908, emissiveIntensity: 0.6 })
  const lamps = new T.MeshStandardMaterial({ color: 0xe7f6ff, emissive: 0xc2e3ff, emissiveIntensity: 0.6 })
  const wheels = []
  for (const side of [-1, 1]) {
    box(body, brakeMaterial, 0.46, 0.09, 0.045, side * 0.53, 0.56, -2.13)
    box(body, lamps, 0.43, 0.075, 0.045, side * 0.54, 0.46, 2.15)
    box(body, trim, 0.23, 0.09, 0.19, side * 0.9, 0.88, 0.65)
    for (const z of [-1.39, 1.23]) {
      const pivot = new T.Group()
      const spin = new T.Group()
      for (const [radius, width, material] of [[0.33, 0.26, tire], [0.215, 0.28, alloy]]) {
        const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, width, 24).rotateZ(Math.PI / 2), material)
        mesh.castShadow = true
        spin.add(mesh)
      }
      for (let i = 0; i < 5; i++) {
        const spoke = box(spin, trim, 0.019, 0.07, 0.125, side * 0.148,
          Math.sin(i * Math.PI * 0.4) * 0.115, Math.cos(i * Math.PI * 0.4) * 0.115)
        spoke.rotation.x = -i * Math.PI * 0.4
      }
      pivot.add(spin)
      pivot.position.set(side * 0.85, 0.33, z)
      root.add(pivot)
      wheels.push({ pivot, spin, front: z > 0 })
    }
  }
  return { root, body, wheels, brakeMaterial }
}
