// The Sky & weather tab in Settings: every sky option, saved in this browser.
import { CLOUD_TYPES } from './sky.js'
import { formatDay, formatHours } from './weather.js'

const KEY = 'county-road-weather'

export const SKY_DEFAULTS = {
  timeOfDay: 15, // hours, local solar time
  dayOfYear: 172, // 21 Jun: the sun's path, the moon, the trees and grass
  useClock: false, // follow the computer's clock (time and date) instead
  cloudCover: 0.35, // 0 clear .. 1 overcast
  cloudType: 'cumulus',
  mist: 'seasonal', // 'seasonal' | 'off' | 'light' | 'thick'
  lowCloud: 'seasonal', // 'seasonal' | 'off' | 'broken' | 'overcast'
  windSpeed: 3, // m/s: the clouds and mist drift with it
  windDir: 270, // degrees it blows from
  moonPhase: 'date', // 'date' | 'new' | 'crescent' | 'quarter' | 'gibbous' | 'full'
  stars: 'dark', // 'dark' | 'town' | 'off'
  sunGlare: true,
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const compass = v => `${COMPASS[Math.round(v / 45) % 8]} (${v}°)`

const OPTIONS = [
  { heading: 'Sun and time' },
  { key: 'timeOfDay', label: 'Time of day', range: [0, 24, 0.25], format: formatHours },
  { key: 'dayOfYear', label: 'Time of year', range: [1, 365, 1], format: formatDay },
  { key: 'useClock', label: 'Use my clock (time and date)', check: true },
  { key: 'sunGlare', label: 'Sun glare', check: true },
  { heading: 'Clouds' },
  { key: 'cloudCover', label: 'Cloud cover', range: [0, 1, 0.05], format: v => (v < 0.05 ? 'Clear' : v > 0.85 ? 'Overcast' : `${Math.round(v * 100)}%`) },
  { key: 'cloudType', label: 'Cloud type', options: Object.fromEntries(Object.entries(CLOUD_TYPES).map(([k, t]) => [k, t.label])) },
  { key: 'lowCloud', label: 'Low cloud', options: { seasonal: 'Seasonal (spring and autumn)', off: 'Off', broken: 'Broken', overcast: 'Overcast' } },
  { heading: 'Weather' },
  { key: 'mist', label: 'Mist and fog', options: { seasonal: 'Seasonal (spring and autumn mornings)', off: 'Off', light: 'Light mist', thick: 'Thick fog' } },
  { key: 'windSpeed', label: 'Wind speed', range: [0, 12, 0.5], format: v => `${v} m/s` },
  { key: 'windDir', label: 'Wind from', range: [0, 355, 5], format: compass },
  { heading: 'Night sky' },
  { key: 'moonPhase', label: 'Moon', options: { date: 'Follows the date', new: 'New moon', crescent: 'Crescent', quarter: 'Half (first quarter)', gibbous: 'Gibbous', full: 'Full moon' } },
  { key: 'stars', label: 'Stars', options: { dark: 'Dark countryside', town: 'Town glow (fewer)', off: 'Off' } },
]

export function loadSkySettings() {
  let saved = {}
  try { saved = JSON.parse(localStorage.getItem(KEY)) ?? {} } catch {}
  // (Earlier versions saved only the time and cloud cover.)
  try {
    const old = JSON.parse(localStorage.getItem('county-road-sky'))
    if (old && !Object.keys(saved).length) saved = { timeOfDay: old.hours, cloudCover: old.clouds }
  } catch {}
  return { ...SKY_DEFAULTS, ...saved }
}

/** Build the tab's controls; onChange(settings) after every change. */
export function createSkySettings(root, settings, onChange) {
  const inputs = {}
  const outputs = {}
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch {}
  }
  function refresh() {
    for (const option of OPTIONS) {
      if (!option.key) continue
      const input = inputs[option.key]
      if (option.check) input.checked = Boolean(settings[option.key])
      else input.value = settings[option.key]
      if (option.format) outputs[option.key].textContent = option.format(Number(settings[option.key]))
    }
    // The clock sets the time and date.
    inputs.timeOfDay.disabled = inputs.dayOfYear.disabled = settings.useClock
  }
  for (const option of OPTIONS) {
    if (option.heading) {
      const heading = document.createElement('h3')
      heading.className = 'sky-heading'
      heading.textContent = option.heading
      root.append(heading)
      continue
    }
    const row = document.createElement('label')
    row.className = option.check ? 'sky-row sky-check' : 'sky-row'
    const name = document.createElement('span')
    name.textContent = option.label
    let input
    if (option.range) {
      input = document.createElement('input')
      input.type = 'range'
      ;[input.min, input.max, input.step] = option.range
    } else if (option.options) {
      input = document.createElement('select')
      for (const [value, label] of Object.entries(option.options)) input.append(new Option(label, value))
    } else {
      input = document.createElement('input')
      input.type = 'checkbox'
    }
    input.id = `sky-${option.key}`
    input.addEventListener(option.range ? 'input' : 'change', () => {
      settings[option.key] = option.check ? input.checked : option.options ? input.value : Number(input.value)
      refresh()
      save()
      onChange(settings)
    })
    inputs[option.key] = input
    if (option.check) row.append(input, name)
    else row.append(name, input)
    if (option.format) {
      outputs[option.key] = document.createElement('output')
      row.append(outputs[option.key])
    }
    root.append(row)
  }
  const reset = document.createElement('button')
  reset.type = 'button'
  reset.className = 'sky-reset'
  reset.textContent = 'Restore sky defaults'
  reset.addEventListener('click', () => {
    Object.assign(settings, SKY_DEFAULTS)
    refresh()
    save()
    onChange(settings)
  })
  root.append(reset)
  refresh()
  return { refresh }
}
