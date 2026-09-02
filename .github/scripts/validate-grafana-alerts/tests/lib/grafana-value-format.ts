/**
 * Grafana 9.5.21's value formatter, transcribed.
 *
 * Not a model of what Grafana might do - a transcription of what the deployed
 * image does. `scaledUnits`, `toFixed`, `toFixedUnit`, `SI_PREFIXES` and
 * `SIPrefix` below are copied from
 * `packages/grafana-data/src/valueFormats/{valueFormats,symbolFormatters}.ts`
 * as read out of the source maps shipped in
 * `ghcr.io/groupsky/homy/grafana:9.5.21`'s own `public/build`, and the
 * per-unit formatter table is copied from `categories.ts` in the same place.
 *
 * Grafana's `size === null | undefined -> { text: '' }` guards are the only
 * thing dropped: `format()` is typed to take a number, so they are unreachable
 * here. Everything else is as shipped.
 *
 * It exists so the claim in issue #1481 - that `pressurebar` renders a flat
 * tyre as `800.00 mbar` while `suffix: bar` renders it as `0.80 bar` - is a
 * test that runs, not a screenshot someone has to trust. Only the paths the
 * repository's dashboards actually take are transcribed; anything else throws
 * rather than guessing.
 *
 * Re-derive this file if the Grafana version in docker-compose.yml changes.
 */

export interface FormattedValue {
  text: string;
  prefix?: string;
  suffix?: string;
}

type ValueFormatter = (value: number, decimals?: number) => FormattedValue;

/** lodash `clamp`, which `scaledUnits` uses. */
function clamp (value: number, lower: number, upper: number): number {
  return Math.min(Math.max(value, lower), upper);
}

const logb = (b: number, x: number): number => Math.log10(x) / Math.log10(b);

/**
 * `getDecimalsForValue`, used when a panel sets no `decimals`.
 *
 * Ten of the panels this check excuses set none - `boiler-controller` 9 and 10,
 * `heatpump` 2 and 3, `reminders` 1 and 2, `sunseeker-battery` 1, 3, 8 and 9 -
 * so this branch is reached in practice and is transcribed rather than assumed.
 */
function getDecimalsForValue (value: number): number {
  const absValue = Math.abs(value);
  const log10 = Math.floor(Math.log(absValue) / Math.LN10);
  let dec = -log10 + 1;
  const magn = Math.pow(10, -dec);
  const norm = absValue / magn; // norm is between 1.0 and 10.0

  // special case for 2.5, requires an extra decimal
  if (norm > 2.25) {
    ++dec;
  }

  if (value % 1 === 0) {
    dec = 0;
  }

  return Math.max(0, dec);
}

/** `toFixed`. Grafana's `null` guard is dropped - `format()` never passes one. */
function toFixed (value: number, decimals?: number): string {
  if (decimals === undefined) {
    decimals = getDecimalsForValue(value);
  }

  if (value === Number.NEGATIVE_INFINITY || value === Number.POSITIVE_INFINITY) {
    return value.toLocaleString();
  }
  if (value === 0) {
    return value.toFixed(decimals);
  }

  const factor = decimals ? Math.pow(10, Math.max(0, decimals)) : 1;
  const formatted = String(Math.round(value * factor) / factor);

  if (formatted.indexOf('e') !== -1) {
    return formatted;
  }

  const decimalPos = formatted.indexOf('.');
  const precision = decimalPos === -1 ? 0 : formatted.length - decimalPos - 1;
  if (precision < decimals) {
    return (precision ? formatted : formatted + '.') + String(factor).slice(1, decimals - precision + 1);
  }

  return formatted;
}

/** `toFixedUnit`, behind every fixed-suffix unit including `suffix: x`. */
function toFixedUnit (unit: string): ValueFormatter {
  return (value, decimals) => {
    const text = toFixed(value, decimals);
    return unit ? { text, suffix: ' ' + unit } : { text };
  };
}

/** The formatter behind `short`, `pressurepsi` and, via SIPrefix, the SI units. */
function scaledUnits (factor: number, extArray: string[], offset = 0): ValueFormatter {
  return (size, decimals) => {
    if (size === Number.NEGATIVE_INFINITY || size === Number.POSITIVE_INFINITY || isNaN(size)) {
      return { text: size.toLocaleString() };
    }

    const siIndex = size === 0 ? 0 : Math.floor(logb(factor, Math.abs(size)));
    const suffix = extArray[clamp(offset + siIndex, 0, extArray.length - 1)];

    return {
      text: toFixed(size / factor ** clamp(siIndex, -offset, extArray.length - offset - 1), decimals),
      suffix,
    };
  };
}

const SI_PREFIXES = ['f', 'p', 'n', 'µ', 'm', '', 'k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];
const SI_BASE_INDEX = SI_PREFIXES.indexOf('');

/** The whole bug in four lines: a thousand-based scale, in both directions. */
function SIPrefix (unit: string, offset = 0): ValueFormatter {
  const units = SI_PREFIXES.map((p) => ' ' + p + unit);
  return scaledUnits(1000, units, SI_BASE_INDEX + offset);
}

/**
 * `categories.ts` entries for every unit the repository's dashboards use that
 * is not a fixed suffix. Transcribed verbatim, including the offsets.
 */
const FORMATTERS: Readonly<Record<string, ValueFormatter>> = {
  amp: SIPrefix('A'),
  kwatt: SIPrefix('W', 1),
  kwatth: SIPrefix('Wh', 1),
  mvolt: SIPrefix('V', -1),
  pressurebar: SIPrefix('bar'),
  volt: SIPrefix('V'),
  watt: SIPrefix('W'),
  celsius: toFixedUnit('°C'),
  kelvin: toFixedUnit('K'),
  none: toFixedUnit(''),
  pressurepsi: scaledUnits(1000, ['psi', 'ksi', 'Mpsi']),
  short: scaledUnits(1000, ['', ' K', ' Mil', ' Bil', ' Tri', ' Quadr', ' Quint', ' Sext', ' Sept']),
};

/**
 * `getValueFormat(unit)(value, decimals)`, for the units under test.
 *
 * The `suffix:` branch is Grafana's own: an unknown id containing `:` is split
 * on the first colon and `suffix` maps to `toFixedUnit(sub)` - where `sub`
 * keeps the space in `"suffix: bar"`, which is why the rendered suffix carries
 * two spaces.
 */
export function format (unit: string, value: number, decimals?: number): FormattedValue {
  const known = FORMATTERS[unit];
  if (known) return known(value, decimals);

  const colon = unit.indexOf(':');
  if (colon > 0 && unit.substring(0, colon) === 'suffix') {
    return toFixedUnit(unit.substring(colon + 1))(value, decimals);
  }

  throw new Error(`Unit "${unit}" is not transcribed - add it from the deployed image's categories.ts`);
}

/** `formattedValueToString`, verbatim. */
export function formattedValueToString (val: FormattedValue): string {
  return `${val.prefix ?? ''}${val.text}${val.suffix ?? ''}`;
}

/** What the browser shows: HTML collapses the runs of whitespace above. */
export function rendered (unit: string, value: number, decimals?: number): string {
  return formattedValueToString(format(unit, value, decimals)).replace(/\s+/g, ' ').trim();
}
