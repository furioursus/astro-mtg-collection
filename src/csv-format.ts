import Papa from 'papaparse';

export class CollectionParseError extends Error {}

export interface RawCsv {
  fields: string[];
  data: Record<string, string>[];
}

/** Reads just the header row, for format auto-detection — cheap even on a large export since Papa stops after the first data row. */
export function peekCsvHeaders(csvText: string): string[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, preview: 1 });
  return parsed.meta.fields ?? [];
}

/** Parses CSV text into a header row + string-keyed data rows, tolerating the occasional ragged row (FieldMismatch) that real-world exports sometimes have. */
export function parseCsv(csvText: string): RawCsv {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header,
  });

  if (parsed.errors.length > 0) {
    const fatal = parsed.errors.find((e) => e.type !== 'FieldMismatch');
    if (fatal) {
      throw new CollectionParseError(`Failed to parse CSV: ${fatal.message}`);
    }
  }

  return { fields: parsed.meta.fields ?? [], data: parsed.data };
}

/**
 * Tolerates the header spelling variance real export tools have across
 * versions: case, surrounding whitespace, and snake_case vs spaced
 * ("scryfall_id" / "Scryfall Id" / "scryfall id" all normalize the same).
 */
export function normalizeHeaderKey(header: string): string {
  return header.trim().toLowerCase().replace(/[_\s]+/g, ' ');
}

/**
 * Maps a CSV's header row to known CollectionRow fields via `headerMap`,
 * ignoring columns the format doesn't recognize — extra platform-specific
 * columns are common and harmless to skip.
 */
export function mapHeaders<K extends string>(
  fields: string[],
  headerMap: Record<string, K>
): Array<[csvHeader: string, mapped: K]> {
  const result: Array<[string, K]> = [];
  for (const f of fields) {
    const mapped = headerMap[normalizeHeaderKey(f)];
    if (mapped !== undefined) result.push([f, mapped]);
  }
  return result;
}

/** Whether the header row contains all of `required` (after normalization) — the basic building block each format's detect() uses for auto-detection. */
export function hasHeaders(fields: string[], required: string[]): boolean {
  const normalized = new Set(fields.map(normalizeHeaderKey));
  return required.every((r) => normalized.has(normalizeHeaderKey(r)));
}

/** Whether the header row contains at least one of `candidates`. */
export function hasAnyHeader(fields: string[], candidates: string[]): boolean {
  const normalized = new Set(fields.map(normalizeHeaderKey));
  return candidates.some((c) => normalized.has(normalizeHeaderKey(c)));
}

/**
 * Builds a normalized-header -> original-header lookup, for formats whose
 * per-row shape doesn't map cleanly onto a single CollectionRow field
 * (e.g. Archidekt splitting nonfoil/foil quantities across two columns
 * into up to two rows) and so can't just use `mapHeaders`. Pass a list of
 * aliases and take the first that resolves, e.g.
 * `lookup('scryfall uuid') ?? lookup('scryfall id')`.
 */
export function headerLookup(fields: string[]): (normalizedKey: string) => string | undefined {
  const map = new Map<string, string>();
  for (const f of fields) {
    const key = normalizeHeaderKey(f);
    if (!map.has(key)) map.set(key, f);
  }
  return (normalizedKey: string) => map.get(normalizedKey);
}
