// Hot water in the boiler tank, from the top and bottom sensors (#1984).
//
// The tank is cut into horizontal layers of equal volume. A "gradual
// profile" gives each layer a temperature: a straight line through the two
// sensors, extended down to the bottom (never colder than the cold water)
// and kept at the top reading above the top sensor. A simulated draw then
// gives the litres of water at bathTempC that the tap can take before the
// outlet falls under bathTempC. A simulated heating with the element's real
// power gives the minutes until one more bath is ready.
//
// The model, its numbers and its limits are in
// docker/automations/docs/boiler-controller.md.

// The Eldom FV20060S21 (184 L net): 16 layers of 11.5 L over 1157 mm of
// water. Layer 0 is the bottom.
const DEFAULT_TANK = {
  litres: 184,
  layers: 16,
  heightMm: 1157,
  outletLayer: 14, // hot water outlet; the layer above it is not drawn off
  elementLayer: 1, // the element flange, about 250 mm up
  bottomSensorMm: 371, // sensor heights inside the tank
  topSensorMm: 915,
  inletMixLayers: 1.07, // how far up the cold inlet water mixes, in layers
  maxTopC: 75 // the heating simulation gives up when the top layer is this hot
}

// Water: kWh per litre per kelvin, and kJ per litre per kelvin
const KWH_PER_L_K = 1.163 / 1000
const KJ_PER_L_K = 4.186

const layerVolume = (tank) => tank.litres / tank.layers

const gradualProfile = (bottom, top, cold, tank = DEFAULT_TANK) => {
  const dz = tank.heightMm / tank.layers
  const slope = (top - bottom) / (tank.topSensorMm - tank.bottomSensorMm)
  const hi = Math.max(top, bottom)
  return Array.from({ length: tank.layers }, (_, j) => {
    const z = (j + 0.5) * dz
    const v = z > tank.topSensorMm ? top : bottom + slope * (z - tank.bottomSensorMm)
    return Math.min(Math.max(v, cold), hi)
  })
}

// Warm water rises: a layer warmer than the one above mixes with it, and
// the mixed block grows up while it is still warmer than the next layer.
const mixInversions = (T) => {
  const n = T.length
  for (let pass = 0; pass < 2 * n; pass++) {
    let changed = false
    for (let j = 0; j < n - 1; j++) {
      if (T[j] > T[j + 1] + 1e-6) {
        const a = j
        let b = j + 1
        let sum = T[j] + T[j + 1]
        while (b < n - 1 && sum / (b - a + 1) > T[b + 1]) { b++; sum += T[b] }
        for (let q = a; q <= b; q++) T[q] = sum / (b - a + 1)
        changed = true
        j = b
      }
    }
    if (!changed) break
  }
}

// Draws `litres` from the outlet: the water moves up towards the outlet, and
// the cold water mixes into the lowest layers (layer j takes the share
// exp(-j / inletMixLayers)). In steps of at most 4 L.
const draw = (T, litres, cold, tank) => {
  const vol = layerVolume(tank)
  const weights = []
  let weightSum = 0
  for (let j = 0; j <= tank.outletLayer; j++) {
    weights[j] = Math.exp(-j / tank.inletMixLayers)
    weightSum += weights[j]
  }
  const steps = Math.ceil(litres / 4)
  const dv = litres / steps
  for (let s = 0; s < steps; s++) {
    const old = T.slice()
    let flow = 0
    for (let j = 0; j <= tank.outletLayer; j++) {
      const inflow = dv * weights[j] / weightSum
      T[j] = old[j] + (inflow * (cold - old[j]) + (j > 0 ? flow * (old[j - 1] - old[j]) : 0)) / vol
      flow += inflow
    }
  }
}

// Litres of water at bathTempC at the tap before the outlet falls under
// bathTempC: draws of 6 L, each counted as the tap water it makes when mixed
// with cold water.
const usableLitres = (profile, cold, bathTempC, tank = DEFAULT_TANK) => {
  if (!(bathTempC > cold)) return 0
  const T = profile.slice()
  let total = 0
  for (let i = 0; i < 80 && T[tank.outletLayer] >= bathTempC; i++) {
    total += 6 * (T[tank.outletLayer] - cold) / (bathTempC - cold)
    draw(T, 6, cold, tank)
  }
  return total
}

// The element's mean power (kW) at the water temperature at the element:
// the first row whose `belowC` is above it; a row without `belowC` is the
// last one. The element cuts out and cycles by itself as the water warms.
const elementPowerKw = (table, tempC) => {
  const row = table.find(({ belowC }) => belowC === undefined || belowC === null || tempC < belowC)
  return row ? row.kw : 0
}

// Minutes until the tap has `extraLitres` more, with the element on from
// now. Steps of 5 min; null when it takes over 10 h or the top layer reaches
// maxTopC first.
const STEP_MIN = 5
const minutesToMore = (profile, cold, bathTempC, extraLitres, powerTable, tank = DEFAULT_TANK) => {
  const T = profile.slice()
  const target = usableLitres(T, cold, bathTempC, tank) + extraLitres
  const vol = layerVolume(tank)
  for (let m = 0; m < 600; m += STEP_MIN) {
    if (usableLitres(T, cold, bathTempC, tank) >= target) return m
    if (T[tank.layers - 1] >= tank.maxTopC) return null
    const kw = elementPowerKw(powerTable, T[tank.elementLayer])
    T[tank.elementLayer] += kw * STEP_MIN * 60 / (vol * KJ_PER_L_K)
    mixInversions(T)
  }
  return null
}

const round1 = (x) => Math.round(x * 10) / 10

// The one function the controller calls. It is the place to switch to
// metered litres when the flow meter on the cold inlet comes.
//
// heating: the element runs now. boostAllowed: a boost would start the
// element now. Each `null` means "no number": readings missing (top or
// bottom not a number) give all nulls.
const bathEstimate = ({
  top,
  bottom,
  cold,
  heating,
  boostAllowed,
  bathLitres,
  bathTempC,
  elementPowerByTempKw,
  tank = DEFAULT_TANK
}) => {
  const none = {
    bathsReady: null,
    usableLitres: null,
    minutesToNextBath: null,
    boostMinutesToNextBath: null
  }
  if (![top, bottom, cold, bathLitres, bathTempC].every(Number.isFinite) || bathLitres <= 0) return none
  const profile = gradualProfile(bottom, top, cold, tank)
  const litres = usableLitres(profile, cold, bathTempC, tank)
  const toNext = () => minutesToMore(profile, cold, bathTempC, bathLitres, elementPowerByTempKw, tank)
  return {
    bathsReady: round1(litres / bathLitres),
    usableLitres: Math.round(litres),
    minutesToNextBath: heating ? toNext() : null,
    // Boost does not make the element stronger, it only starts it now: the
    // same number, but only while the element is off and a boost would start.
    boostMinutesToNextBath: !heating && boostAllowed ? toNext() : null
  }
}

// One bath's energy in kWh at a cold water temperature.
const bathKwh = (bathLitres, bathTempC, cold) => bathLitres * KWH_PER_L_K * (bathTempC - cold)

// The cold water temperature of the month (1-12) of `ms` on the wall clock
// of `timeZone`, from a 12-value table (January first).
const coldWaterAt = (coldWaterByMonth, ms, timeZone) => {
  const month = Number(new Intl.DateTimeFormat('en-GB', { timeZone, month: 'numeric' }).format(ms))
  return coldWaterByMonth[month - 1]
}

// A number in Bulgarian: a decimal comma, no ".0".
const bgNumber = (x) => String(round1(x)).replace('.', ',')

// The short Bulgarian sentence for the Home Assistant sensor, or null when
// there is no number. Exactly 1 is "баня", any other number "бани".
const bathSentence = ({ bathsReady, minutesToNextBath, boostMinutesToNextBath }, boostButtonName) => {
  if (!Number.isFinite(bathsReady)) return null
  const ready = `Готови: ${bgNumber(bathsReady)} ${bathsReady === 1 ? 'баня' : 'бани'}.`
  if (Number.isFinite(minutesToNextBath)) return `${ready} Още една след ~${minutesToNextBath} мин.`
  if (Number.isFinite(boostMinutesToNextBath)) {
    return `${ready} С „${boostButtonName}“ още една след ~${boostMinutesToNextBath} мин.`
  }
  return ready
}

module.exports = {
  DEFAULT_TANK,
  gradualProfile,
  mixInversions,
  usableLitres,
  elementPowerKw,
  minutesToMore,
  bathEstimate,
  bathKwh,
  coldWaterAt,
  bathSentence
}
