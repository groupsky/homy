/**
 * Grafana units that silently change the unit they display.
 *
 * A unit built with `SIPrefix(base, offset)` is not a fixed suffix. It is
 * `scaledUnits(1000, [' f'+base, ' p'+base, ... ' k'+base, ...], 5 + offset)`,
 * and for any |value| < 1 the exponent `Math.floor(log1000(|value|))` goes
 * negative: the number is multiplied by 1000 and the suffix picks up a smaller
 * prefix. `pressurebar` therefore renders 0.80 as `800.00 mbar`, in a panel
 * whose siblings, thresholds and alert text are all in bar. That is issue
 * #1481, and it bit the one tile that most needed to be unambiguous - a flat
 * tyre.
 *
 * The ids below are every `SIPrefix(...)` unit in
 * `packages/grafana-data/src/valueFormats/categories.ts` as shipped in
 * `ghcr.io/groupsky/homy/grafana:9.5.21`, read out of the source maps in that
 * image's own `public/build` rather than from upstream source. If the Grafana
 * version changes, re-derive this list from the new image.
 *
 * Not on this list, and safe:
 * - `toFixedUnit(...)` units - `celsius`, `kelvin`, `humidity`, `degree`,
 *   `none`, and any custom `suffix: x` / `prefix: x`. A fixed string, always.
 * - `scaledUnits` units with offset 0 - `short`, `pressurepsi`. The suffix
 *   index is clamped at 0, so they scale up but never down.
 */
/**
 * The Grafana version `SI_SCALING_UNITS` was read out of.
 *
 * `runGrafanaVersionPin()` fails the check when `docker/grafana/Dockerfile` no
 * longer pins this tag, because a version bump can add, rename or re-base a
 * unit and there is nothing else tying the list to the image it describes.
 */
export const DERIVED_FROM_GRAFANA = '9.5.21';

const SI_SCALING_UNIT_IDS: readonly string[] = [
  'flops', 'mflops', 'gflops', 'tflops', 'pflops', 'eflops', 'zflops', 'yflops', 'decbytes',
  'decbits', 'deckbytes', 'decmbytes', 'decgbytes', 'dectbytes', 'decpbytes', 'pps', 'Bps', 'bps',
  'KBs', 'Kbits', 'MBs', 'Mbits', 'GBs', 'Gbits', 'TBs', 'Tbits', 'PBs', 'Pbits', 'watt', 'kwatt',
  'megwatt', 'gwatt', 'mwatt', 'voltamp', 'kvoltamp', 'voltampreact', 'kvoltampreact', 'watth',
  'watthperkg', 'kwatth', 'kwattm', 'amph', 'kamph', 'mamph', 'joule', 'ev', 'amp', 'kamp',
  'mamp', 'volt', 'kvolt', 'mvolt', 'dBm', 'ohm', 'kohm', 'Mohm', 'farad', 'µfarad', 'nfarad',
  'pfarad', 'ffarad', 'henry', 'mhenry', 'µhenry', 'lumens', 'forceNm', 'forcekNm', 'forceN',
  'forcekN', 'Hs', 'KHs', 'MHs', 'GHs', 'THs', 'PHs', 'EHs', 'massmg', 'massg', 'masskg',
  'lengthmm', 'lengthm', 'lengthkm', 'pressurembar', 'pressurebar', 'pressurekbar', 'pressurepa',
  'radbq', 'radci', 'radgy', 'radrad', 'radsv', 'radmsv', 'radusv', 'radrem', 'radexpckg', 'radr',
  'radsvh', 'radmsvh', 'radusvh', 'rothz', 'hertz', 'mlitre', 'litre',
];

export const SI_SCALING_UNITS: ReadonlySet<string> = new Set(SI_SCALING_UNIT_IDS);

/**
 * Whether a unit id rescales itself below 1.
 *
 * Covers the fixed ids above and Grafana's dynamic `si: <unit>` spelling, which
 * `getValueFormat` turns into `SIPrefix(unit, offset)` for an arbitrary base -
 * `"unit": "si: bar"` behaves exactly like `pressurebar` and would otherwise
 * slip past an exact-id lookup.
 */
export function isSelfRescaling (unit: string): boolean {
  if (SI_SCALING_UNITS.has(unit)) return true;
  const colon = unit.indexOf(':');
  return colon > 0 && unit.substring(0, colon) === 'si';
}

/** One panel that is allowed to keep an SI-scaling unit, and why. */
export interface UnitException {
  /** Dashboard path relative to `config/grafana/dashboards`, with `/` separators. */
  file: string;
  /** Panel `id`. */
  panelId: number;
  /** The SI-scaling unit id the panel uses, in `fieldConfig.defaults` or in an override. */
  unit: string;
  /** Why auto-scaling below 1 is acceptable, or cannot happen, on this series. */
  reason: string;
}

/**
 * The determinations made when every dashboard was audited for issue #1481.
 *
 * Each reason answers one question about one series: can it legitimately land
 * between 0 and 1 in the unit it is written in, and if it can, is the smaller
 * SI prefix a problem there? The four Ioniq tyre tiles are absent because they
 * were fixed rather than excused - a tyre at 0.8 bar rendered `800.00 mbar`
 * sits beside three sibling tiles, a threshold set and an alert that are all
 * denominated in bar.
 */
const REASONS = {
  VOLT_ABOVE_ONE:
    'Never legitimately between 0 and 1 V - a 12 V battery, a 300-400 V traction pack, 2.5-4.2 V '
    + 'cells, 230 V mains. The mV branch is unreachable, and a missing reading is 0, which renders '
    + '"0 V". Every threshold on these panels (11.8, 12.2, 2.5, 3.0, 20, 24, 210, 247) is above 1 V, '
    + 'so tile and threshold are always read in the same unit.',
  AMP_CROSSES_ONE:
    'Current sits near zero whenever the machine is idle, so this series does cross below 1 A and '
    + 'renders in mA there. mA is the conventional unit for a small current, and these panels set no '
    + 'numeric threshold and drive no alert in amps for it to disagree with. The two mower panels that '
    + 'did carry amp thresholds (5 A, 10 A) were moved to a fixed suffix instead of being excused.',
  POWER_SPANS_DECADES:
    'Power spans standby to kilowatts, and reading both ends off one panel is the reason this unit was '
    + 'chosen over a fixed suffix. A fixed kW suffix would flatten everything below 5 W to "0.00 kW". '
    + 'These panels set no numeric threshold; heatpump.json\'s Power panel, which did (25 W, 3000 W), '
    + 'was moved to a fixed suffix instead of being excused.',
  ENERGY_MONOTONIC:
    'A monotonically rising energy total. It starts at 0 and only grows, so the sub-1 branch is reached '
    + 'once, at the origin, where it renders "0 Wh".',
  ENERGY_WINDOWED:
    'Energy over a dashboard window spans watt-hours to tens of kilowatt-hours depending on the range '
    + 'selected. Wh is the conventional smaller unit and nothing else on the panel is denominated in kWh.',
  MVOLT_QUANTISED:
    'The BMS reports cell voltages quantised to 20 mV, so the spread is either exactly 0 or at least '
    + '20 mV. It cannot land between 0 and 1 mV, and 0 renders "0 mV".',
} as const;

export const SI_UNIT_EXCEPTIONS: readonly UnitException[] = [
  // Ioniq EV - 12 V / LDC
  { file: 'Ioniq EV/ioniq-12v-ldc.json', panelId: 1, unit: 'volt', reason: REASONS.VOLT_ABOVE_ONE },
  { file: 'Ioniq EV/ioniq-12v-ldc.json', panelId: 4, unit: 'volt', reason: REASONS.VOLT_ABOVE_ONE },
  { file: 'Ioniq EV/ioniq-12v-ldc.json', panelId: 5, unit: 'volt', reason: REASONS.VOLT_ABOVE_ONE },
  { file: 'Ioniq EV/ioniq-12v-ldc.json', panelId: 6, unit: 'volt', reason: REASONS.VOLT_ABOVE_ONE },
  { file: 'Ioniq EV/ioniq-12v-ldc.json', panelId: 9, unit: 'volt', reason: REASONS.VOLT_ABOVE_ONE },

  // Ioniq EV - traction battery
  { file: 'Ioniq EV/ioniq-battery.json', panelId: 2, unit: 'volt', reason: REASONS.VOLT_ABOVE_ONE },
  { file: 'Ioniq EV/ioniq-battery.json', panelId: 3, unit: 'mvolt', reason: REASONS.MVOLT_QUANTISED },
  { file: 'Ioniq EV/ioniq-battery.json', panelId: 8, unit: 'kwatth', reason: REASONS.ENERGY_MONOTONIC },
  { file: 'Ioniq EV/ioniq-battery.json', panelId: 9, unit: 'kwatth', reason: REASONS.ENERGY_WINDOWED },

  // Ioniq EV - overview
  { file: 'Ioniq EV/ioniq-overview.json', panelId: 2, unit: 'volt', reason: REASONS.VOLT_ABOVE_ONE },
  { file: 'Ioniq EV/ioniq-overview.json', panelId: 3, unit: 'amp', reason: REASONS.AMP_CROSSES_ONE },
  { file: 'Ioniq EV/ioniq-overview.json', panelId: 4, unit: 'kwatt', reason: REASONS.POWER_SPANS_DECADES },
  { file: 'Ioniq EV/ioniq-overview.json', panelId: 5, unit: 'volt', reason: REASONS.VOLT_ABOVE_ONE },

  // Boiler
  { file: 'boiler-controller.json', panelId: 9, unit: 'watt', reason: REASONS.POWER_SPANS_DECADES },
  { file: 'boiler-controller.json', panelId: 10, unit: 'kwatth', reason: REASONS.ENERGY_MONOTONIC },

  // Heat pump
  { file: 'heatpump.json', panelId: 3, unit: 'volt', reason: REASONS.VOLT_ABOVE_ONE },

  // Appliance reminders
  { file: 'reminders.json', panelId: 1, unit: 'watt', reason: REASONS.POWER_SPANS_DECADES },
  { file: 'reminders.json', panelId: 2, unit: 'watt', reason: REASONS.POWER_SPANS_DECADES },

  // Sunseeker mower
  { file: 'sunseeker-battery.json', panelId: 1, unit: 'volt', reason: REASONS.VOLT_ABOVE_ONE },
  { file: 'sunseeker-battery.json', panelId: 7, unit: 'volt', reason: REASONS.VOLT_ABOVE_ONE },
  { file: 'sunseeker-battery.json', panelId: 9, unit: 'volt', reason: REASONS.VOLT_ABOVE_ONE },
  { file: 'sunseeker-battery.json', panelId: 11, unit: 'volt', reason: REASONS.VOLT_ABOVE_ONE },
  { file: 'sunseeker-battery.json', panelId: 11, unit: 'amp', reason: REASONS.AMP_CROSSES_ONE },
  { file: 'sunseeker-navigation.json', panelId: 8, unit: 'watt', reason: REASONS.POWER_SPANS_DECADES },
];

/** Key identifying one exception, so lookups and staleness checks agree. */
export function exceptionKey (file: string, panelId: number, unit: string): string {
  return `${file}#${panelId}#${unit}`;
}
