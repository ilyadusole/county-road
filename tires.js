const ASPHALT = {
  friction: 1.15,
  rollingResistance: 0.014,
  corneringResponse: 13,
  peakSlipAngle: 0.15,
  slideLoss: 0.12,
  speedLoss: 0.045,
  speedReference: 42,
}

const GRASS = {
  friction: 0.68,
  rollingResistance: 0.074,
  corneringResponse: 7.5,
  peakSlipAngle: 0.19,
  slideLoss: 0.27,
  speedLoss: 0.22,
  speedReference: 24,
}

export function tireForces(paved, load, longitudinal, lateral, driveForce, brakeForce, front, stopRate) {
  const surface = paved ? ASPHALT : GRASS
  const speedSquared = longitudinal ** 2 + lateral ** 2
  const speedFactor = 1 - surface.speedLoss * speedSquared / (speedSquared + surface.speedReference ** 2)
  const grip = surface.friction * load * (load / 3550) ** -0.09 * speedFactor
  const slipAngle = Math.atan2(lateral, Math.max(Math.abs(longitudinal), 3.4))
  const drag = load * surface.rollingResistance + brakeForce
  const resistance = Math.sign(longitudinal) * Math.min(Math.abs(longitudinal) * stopRate, drag)
  const longitudinalDemand = driveForce - resistance
  const stiffness = surface.corneringResponse * (front ? 1 : 14 / 13)
  const lateralDemand = -Math.tanh(slipAngle * stiffness) * grip
  const slide = Math.min(1, Math.max(0, (Math.abs(slipAngle) - surface.peakSlipAngle) / 0.5))
  const tractionLimit = grip * (1 - surface.slideLoss * slide)
  const demand = Math.hypot(longitudinalDemand, lateralDemand)
  const scale = demand > tractionLimit ? tractionLimit / demand : 1
  return { fx: longitudinalDemand * scale, fy: lateralDemand * scale, slipAngle }
}
