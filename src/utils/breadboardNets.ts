/**
 * Breadboard internal-connectivity helpers.
 *
 * A solderless breadboard electrically joins holes in fixed groups:
 *   - each terminal-strip column of 5 holes is one net
 *     (full board: rows a-e form the top bank, f-j the bottom bank), and
 *   - each power rail (full board only) is one net running the whole length.
 *
 * Pin names follow the Wokwi convention so imported diagram.json wires work
 * verbatim (e.g. "18t.d" = column 18, top bank, row d; "bn.15" = bottom
 * negative rail, hole 15):
 *   holes:  `${col}t.${a-e}`   |   `${col}b.${f-j}`
 *   rails:  `tp.N` / `tn.N` (top +/-)   |   `bp.N` / `bn.N` (bottom +/-)
 *
 * Consumers (NetlistBuilder union-find, DynamicComponent digital trace) use
 * `breadboardGroupKey` to decide which pins are internally shorted: two pins
 * on the same breadboard belong to the same net iff their group keys match.
 */

const BREADBOARD_IDS = new Set(['breadboard', 'breadboard-mini']);

/** True when the metadataId is one of the breadboard parts. */
export function isBreadboard(metadataId: string): boolean {
  return BREADBOARD_IDS.has(metadataId);
}

const HOLE_RE = /^(\d+)([tb])\.([a-j])$/;
const RAIL_RE = /^([tb][pn])\.(\d+)$/;

/**
 * Group key for a breadboard pin, or null when the pin name is not a valid
 * breadboard hole/rail. Pins with equal keys are internally connected.
 */
export function breadboardGroupKey(metadataId: string, pinName: string): string | null {
  if (!isBreadboard(metadataId)) return null;
  const hole = HOLE_RE.exec(pinName);
  if (hole) return `col${hole[1]}${hole[2]}`; // e.g. "col18t" — one 5-hole strip
  const rail = RAIL_RE.exec(pinName);
  if (rail) return `rail${rail[1]}`; // e.g. "railbn" — the whole rail is one net
  return null;
}
