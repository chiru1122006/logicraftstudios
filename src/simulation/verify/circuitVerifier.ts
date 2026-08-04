/**
 * circuitVerifier — pre-flight safety check run when the user presses Run.
 *
 * Runs a one-shot ngspice solve against the current canvas and inspects the
 * branch currents for real-world fault conditions:
 *
 *   - **Short circuit**: any voltage source delivering current well above what
 *     a sensible circuit needs (default threshold: 500 mA). Catches the
 *     classic "5 V tied straight to GND" bug.
 *   - **LED overcurrent**: forward current above the datasheet absolute max
 *     (20 mA for standard 5 mm LEDs). Catches missing or undersized series
 *     resistors.
 *   - **Resistor overpower**: I²·R > rated power (1/4 W default). Catches
 *     load resistors that would burn out in the real world.
 *   - **Disconnected indicator**: an LED that's fully wired but carries
 *     zero current — usually means the user forgot a switch / power tie.
 *
 * Results are split into `errors` (severe enough to block the user with a
 * confirm dialog) and `warnings` (non-blocking — the simulation can proceed).
 *
 * The verifier never throws; if ngspice fails to converge it returns a
 * single solver-error warning and the rest of the rules are skipped.
 */
import { buildNetlist } from '../spice/NetlistBuilder';
import { runNetlist as runSpice } from '../spice/runNetlist';
import type { BuildNetlistInput, ElectricalSolveResult } from '../spice/types';
import { COMPONENT_RATINGS } from './componentRatings';

export type WarningSeverity = 'error' | 'warning';
export type WarningCode =
  | 'solver-failed'
  | 'unstable-solve'
  | 'short-circuit'
  | 'source-overload'
  | 'led-overcurrent'
  | 'over-voltage'
  | 'reverse-polarity'
  | 'missing-connection'
  | 'power-short'
  | 'shorted-component'
  | 'resistor-overpower'
  | 'led-no-current';

export interface CircuitWarning {
  severity: WarningSeverity;
  code: WarningCode;
  /** Component this warning is attached to (when applicable). */
  componentId?: string;
  /** Human-readable message — already includes units and the actual value. */
  message: string;
  /** Extra diagnostic value (current in A, power in W, …). */
  metric?: number;
}

export interface VerificationResult {
  errors: CircuitWarning[];
  warnings: CircuitWarning[];
  /** Number of components inspected — useful for "nothing to check" UI. */
  componentsChecked: number;
  /** The full solve result, surfaced so callers can do extra checks. */
  solve?: ElectricalSolveResult;
}

// ── Rule thresholds (overridable per call) ────────────────────────────────

export interface VerifierConfig {
  /** Source current above this is flagged as a probable short circuit (A). */
  shortCircuitAmps: number;
  /** LED forward current above this is flagged as overcurrent (A). */
  ledMaxAmps: number;
  /** Default resistor power rating, W. Used when no property override. */
  resistorMaxWatts: number;
  /** Below this the LED is "wired but dark" — surface a hint. */
  ledMinAmps: number;
}

export const DEFAULT_CONFIG: VerifierConfig = {
  shortCircuitAmps: 0.5,
  ledMaxAmps: 0.02,
  resistorMaxWatts: 0.25,
  ledMinAmps: 1e-6,
};

// ── Public API ───────────────────────────────────────────────────────────

/** Build a netlist, solve, and return any safety warnings. */
export async function verifyCircuit(
  input: BuildNetlistInput,
  partialConfig: Partial<VerifierConfig> = {},
): Promise<VerificationResult> {
  const config = { ...DEFAULT_CONFIG, ...partialConfig };
  const errors: CircuitWarning[] = [];
  const warnings: CircuitWarning[] = [];

  // Branch-current vectors that the solver returned as NaN / Infinity.
  // A non-finite branch current is not "no current" — it means ngspice
  // could not find a stable operating point for that source (the classic
  // case: a forward-biased LED with no series resistor, or a dead short).
  // We must NOT silently treat these as 0 A; they get surfaced as a
  // blocking "cannot emulate" fault below.
  const nonFiniteBranches = new Set<string>();

  // Run a forced .op solve so currents are scalar and deterministic.
  const opInput: BuildNetlistInput = { ...input, analysis: { kind: 'op' } };
  const { netlist, pinNetMap } = buildNetlist(opInput);

  // ── Board over-voltage (graph-based, no solve) ─────────────────────────
  // Runs BEFORE the solve so it still reports even when an external source on
  // a board's vcc rail makes the .op singular. A board's supply pins (3V3 /
  // 5V / VIN / VBUS / VSYS) all collapse to the single self-driven `vcc_rail`
  // net, so an over-voltage can't be read from node voltages — instead check
  // the wiring directly: a power source wired to a board supply pin whose
  // nominal voltage exceeds that pin's rating. Non-blocking.
  const boardWarned = new Set<string>();
  for (const board of input.boards) {
    if (!board.boardKind) continue;
    const rating = COMPONENT_RATINGS[board.boardKind];
    if (!rating) continue;
    for (const wire of input.wires) {
      if (boardWarned.has(board.id)) break;
      for (const [boardEnd, srcEnd] of [
        [wire.start, wire.end],
        [wire.end, wire.start],
      ] as const) {
        if (boardEnd.componentId !== board.id) continue;
        const sp = rating.supplyPins.find((p) => p.name === boardEnd.pinName);
        if (!sp) continue;
        const src = input.components.find((c) => c.id === srcEnd.componentId);
        if (!src) continue;
        const info = sourceInfo(src);
        if (!info || !info.posPins.includes(srcEnd.pinName)) continue;
        if (info.volts > sp.absMaxVoltage) {
          boardWarned.add(board.id);
          warnings.push({
            severity: 'warning',
            code: 'over-voltage',
            componentId: board.id,
            message: `${rating.label} ${board.id} has ${formatVolts(info.volts)} wired to its ${sp.name} pin — above its ${formatVolts(
              sp.absMaxVoltage,
            )} maximum. Real hardware would likely be damaged. Use the correct supply voltage (a regulator or level shifter).`,
            metric: info.volts,
          });
          break;
        }
      }
    }
  }

  // ── Wiring ERC (graph-based, no solve) ─────────────────────────────────
  // Bad-connection checks that don't need a solve, so they run even when the
  // circuit is too incomplete to solve. Build a per-component set of wired pin
  // names from the wires first.
  const wiredPins = new Map<string, Set<string>>();
  for (const wire of input.wires) {
    for (const end of [wire.start, wire.end]) {
      let s = wiredPins.get(end.componentId);
      if (!s) {
        s = new Set();
        wiredPins.set(end.componentId, s);
      }
      s.add(end.pinName);
    }
  }
  const pinWired = (set: Set<string> | undefined, name: string): boolean => {
    if (!set) return false;
    if (set.has(name)) return true;
    // Tolerate ASCII '-' vs the Unicode minus on an electrolytic cap's "−" pin.
    if (name === '−' && set.has('-')) return true;
    if (name === '-' && set.has('−')) return true;
    return false;
  };

  // Missing power: a rated peripheral wired into the circuit but missing its
  // supply or ground connection won't work. (Boards live in input.boards, not
  // input.components, so they're correctly excluded — a board self-powers.)
  for (const comp of input.components) {
    const rating = COMPONENT_RATINGS[comp.metadataId];
    if (!rating) continue;
    const set = wiredPins.get(comp.id);
    if (!set || set.size === 0) continue; // not connected yet — not a mistake
    if (!rating.supplyPins.some((sp) => pinWired(set, sp.name))) {
      warnings.push({
        severity: 'warning',
        code: 'missing-connection',
        componentId: comp.id,
        message: `${rating.label} ${comp.id} is wired up but its power (VCC) pin isn't connected — connect it to a supply or it won't work.`,
      });
    }
    if (!rating.gndPins.some((g) => pinWired(set, g))) {
      warnings.push({
        severity: 'warning',
        code: 'missing-connection',
        componentId: comp.id,
        message: `${rating.label} ${comp.id} is wired up but its ground (GND) pin isn't connected — connect GND or it won't work.`,
      });
    }
  }

  // Dangling two-terminal part: a resistor / LED / capacitor / diode connected
  // on only one side has no current path through it.
  for (const comp of input.components) {
    const pins = twoTerminalPins(comp.metadataId);
    if (!pins) continue;
    const set = wiredPins.get(comp.id);
    if (!set) continue;
    if (pinWired(set, pins[0]) !== pinWired(set, pins[1])) {
      warnings.push({
        severity: 'warning',
        code: 'missing-connection',
        componentId: comp.id,
        message: `${comp.metadataId} ${comp.id} is connected on only one side — its other terminal is floating, so no current can flow through it.`,
      });
    }
  }

  // Power rail tied to ground: a wire directly joining a VCC-type pin and a
  // GND-type pin shorts the supply to ground. When a board drives the rail and
  // no battery/signal-generator source is present, the current-based
  // short-circuit rule (which only inspects those sources) misses it — so name
  // it structurally here. Blocking error.
  const VCC_PIN_RE = /^(vcc|vdd|vcc_rail|5v|3v3|3\.3v)$/i;
  const GND_PIN_RE = /^(gnd|vss|vee|ground|gnd\.\d+)$/i;
  let powerShortReported = false;
  for (const wire of input.wires) {
    const a = wire.start.pinName;
    const b = wire.end.pinName;
    const shorted = (VCC_PIN_RE.test(a) && GND_PIN_RE.test(b)) || (GND_PIN_RE.test(a) && VCC_PIN_RE.test(b));
    if (shorted && !powerShortReported) {
      powerShortReported = true;
      errors.push({
        severity: 'error',
        code: 'power-short',
        message: `Power is shorted to ground — a wire connects a VCC pin (${a}) directly to a ground pin (${b}). Remove that connection; it would dump the full supply current through the wire.`,
      });
    }
  }

  // Two-terminal part shorted across itself: both terminals on the same net, so
  // it carries no voltage and has no effect on the circuit. Non-blocking hint.
  for (const comp of input.components) {
    const pins = twoTerminalPins(comp.metadataId);
    if (!pins) continue;
    const n0 = pinNetMap.get(`${comp.id}:${pins[0]}`) ?? (pins[0] === '−' ? pinNetMap.get(`${comp.id}:-`) : undefined);
    const n1 = pinNetMap.get(`${comp.id}:${pins[1]}`) ?? (pins[1] === '−' ? pinNetMap.get(`${comp.id}:-`) : undefined);
    if (n0 !== undefined && n1 !== undefined && n0 === n1) {
      warnings.push({
        severity: 'warning',
        code: 'shorted-component',
        componentId: comp.id,
        message: `${comp.metadataId} ${comp.id} has both terminals on the same node — it is shorted out and has no effect on the circuit.`,
      });
    }
  }

  let solve: ElectricalSolveResult | undefined;
  try {
    const cooked = await runSpice(netlist);
    // Re-shape into the same flat dictionaries that the live store uses.
    const nodeVoltages: Record<string, number> = { '0': 0 };
    const branchCurrents: Record<string, number> = {};
    for (const name of cooked.variableNames) {
      if (name.startsWith('v(')) {
        const v = cooked.dcValue(name);
        if (Number.isFinite(v)) nodeVoltages[name.slice(2, -1)] = v;
      } else if (name.startsWith('i(')) {
        const v = cooked.dcValue(name);
        const key = name.slice(2, -1);
        if (Number.isFinite(v)) branchCurrents[key] = v;
        else nonFiniteBranches.add(key);
      }
    }
    solve = {
      nodeVoltages,
      branchCurrents,
      converged: true,
      error: null,
      solveMs: 0,
      submittedNetlist: netlist,
      pinNetMap: new Map(),
      analysisMode: 'op',
    };
  } catch (err) {
    warnings.push({
      severity: 'warning',
      code: 'solver-failed',
      message: `Circuit solver could not converge (${
        err instanceof Error ? err.message : String(err)
      }). Pre-flight checks were skipped.`,
    });
    return { errors, warnings, componentsChecked: 0, solve };
  }

  const branchCurrents = solve.branchCurrents;

  // ── Rule 1: short circuit / power source overload ──────────────────────
  // Every voltage source (battery / signal-generator / power-supply) emits
  // a branch current `i(v_<id>)`. SPICE convention: V-source's current is
  // measured + → − INTERNALLY, so external current draw is the absolute
  // value.
  //
  // power-supply components carry a per-instance `currentLimit` property
  // that overrides the global short-circuit threshold — that matches what
  // a real bench supply does: a 100mA-limited supply trips at 100mA, a
  // 5A-limited supply tolerates up to 5A before flagging fault.
  const sourceComponents = input.components.filter((c) =>
    /^(battery|signal-generator|power-supply)/.test(c.metadataId),
  );
  for (const src of sourceComponents) {
    // A non-finite source current means ngspice could not find a stable
    // operating point — treat it as a blocking "cannot emulate" fault
    // rather than waving the circuit through as 0 A.
    if (nonFiniteBranches.has(`v_${src.id}`)) {
      errors.push({
        severity: 'error',
        code: 'unstable-solve',
        componentId: src.id,
        message: `Could not solve a stable current for ${src.metadataId} ${src.id} — the circuit has no stable operating point. This usually means a short circuit, or a part driven with no current limit (for example an LED with no series resistor). Check the wiring or add a series resistor.`,
      });
      continue;
    }
    const i = Math.abs(branchCurrents[`v_${src.id}`] ?? 0);
    const perInstanceLimit =
      src.metadataId === 'power-supply'
        ? Number(src.properties?.currentLimit ?? config.shortCircuitAmps)
        : config.shortCircuitAmps;
    const threshold = Number.isFinite(perInstanceLimit) && perInstanceLimit > 0
      ? perInstanceLimit
      : config.shortCircuitAmps;
    if (i >= threshold) {
      const isPsu = src.metadataId === 'power-supply';
      errors.push({
        severity: 'error',
        code: isPsu ? 'source-overload' : 'short-circuit',
        componentId: src.id,
        message: isPsu
          ? `Power supply ${src.id} is being asked for ${formatAmps(i)} — past its ${formatAmps(threshold)} current limit. A real bench supply would foldback or cut out. Raise the currentLimit or add more series resistance to the load.`
          : `Possible short circuit — ${src.metadataId} ${src.id} is delivering ${formatAmps(i)} (threshold ${formatAmps(threshold)}). Check for power tied directly to GND.`,
        metric: i,
      });
    }
  }

  // ── Rule 2: LED forward current above absolute max ─────────────────────
  // Every LED emits a 0V sense source: `V_<id>_sense`. The branch current of
  // that source is the LED forward current.
  const leds = input.components.filter((c) => c.metadataId === 'led');
  for (const led of leds) {
    if (nonFiniteBranches.has(`v_${led.id}_sense`)) {
      errors.push({
        severity: 'error',
        code: 'unstable-solve',
        componentId: led.id,
        message: `LED ${led.id} could not be solved — its forward current has no stable value. This almost always means the LED is wired with no series resistor (a near-short across the supply). Add a series resistor between the supply and the LED.`,
      });
      continue;
    }
    const i = Math.abs(branchCurrents[`v_${led.id}_sense`] ?? 0);
    if (i > config.ledMaxAmps) {
      errors.push({
        severity: 'error',
        code: 'led-overcurrent',
        componentId: led.id,
        message: `LED ${led.id} is carrying ${formatAmps(i)} — above the 20 mA absolute maximum. Add or increase the series resistor.`,
        metric: i,
      });
    } else if (i > 0 && i < config.ledMinAmps) {
      warnings.push({
        severity: 'warning',
        code: 'led-no-current',
        componentId: led.id,
        message: `LED ${led.id} appears wired but is carrying almost no current (${formatAmps(
          i,
        )}). It will not light visibly.`,
        metric: i,
      });
    }
  }

  // ── Rule 3: resistor power above its rating ────────────────────────────
  // Resistors don't have a built-in sense source, so we recover their
  // current from the voltage drop across their two terminals and the
  // resistance value. Pin → net resolution piggy-backs on the netlist
  // text via a quick scan of the emitted R_<id> card.
  const resistorPattern = /^R_(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/gm;
  let m: RegExpExecArray | null;
  while ((m = resistorPattern.exec(netlist)) !== null) {
    const [, id, n1, n2, valStr] = m;
    // Skip the sense / internal helpers (e.g. R_<comp>_sense).
    if (id.endsWith('_sense') || id.endsWith('_load') || id.endsWith('_esr')) continue;
    const comp = input.components.find((c) => c.id === id);
    if (!comp || comp.metadataId !== 'resistor') continue;
    const R = parseResistance(valStr);
    if (!Number.isFinite(R) || R <= 0) continue;
    const v1 = solve.nodeVoltages[n1] ?? 0;
    const v2 = solve.nodeVoltages[n2] ?? 0;
    const power = Math.pow(v1 - v2, 2) / R;
    const rating =
      typeof comp.properties.power === 'number'
        ? (comp.properties.power as number)
        : config.resistorMaxWatts;
    if (power > rating) {
      // Severity 'warning' (not 'error'): SPICE doesn't physically burn the
      // part out, and many teaching-circuit examples deliberately use a
      // small fixed load resistor across higher rails for clarity. We
      // surface it as a non-blocking hint so the user knows their physical
      // build needs a beefier resistor, but they can still click Run.
      warnings.push({
        severity: 'warning',
        code: 'resistor-overpower',
        componentId: id,
        message: `Resistor ${id} (${formatResistance(R)}) is dissipating ${formatPower(
          power,
        )} — above the ${formatPower(rating)} rating. A real ${formatResistance(R)} resistor at this current would overheat; pick a higher-power part or larger resistance.`,
        metric: power,
      });
    }
  }

  // ── Rule 4: over-voltage on a rated supply pin ─────────────────────────
  // Components with a rated input voltage (sensors, displays, NeoPixels, …)
  // warn when their supply pin carries more than the datasheet absolute
  // maximum — the "fed too much voltage" mistake (e.g. a 3.3 V module wired to
  // a 9 V battery). Non-blocking: the solve is still meaningful, but the real
  // part would be damaged, so we surface it and flag that this operating point
  // isn't emulated accurately. (Boards aren't checked yet — BoardForSpice
  // doesn't carry its boardKind; that's a follow-up.)
  for (const comp of input.components) {
    const rating = COMPONENT_RATINGS[comp.metadataId];
    if (!rating) continue;
    // Ground reference: first wired gnd pin, else circuit ground (0 V).
    let gndV = 0;
    for (const g of rating.gndPins) {
      const gnet = pinNetMap.get(`${comp.id}:${g}`);
      if (gnet !== undefined) {
        gndV = gnet === '0' ? 0 : (solve.nodeVoltages[gnet] ?? 0);
        break;
      }
    }
    for (const sp of rating.supplyPins) {
      const net = pinNetMap.get(`${comp.id}:${sp.name}`);
      if (net === undefined || net === '0') continue; // pin not wired / tied to GND
      const sv = solve.nodeVoltages[net];
      if (sv === undefined || !Number.isFinite(sv)) continue; // net floating / unsolved
      const v = Math.abs(sv - gndV);
      if (v > sp.absMaxVoltage) {
        warnings.push({
          severity: 'warning',
          code: 'over-voltage',
          componentId: comp.id,
          message: `${rating.label} ${comp.id} is seeing ${formatVolts(v)} on its ${sp.name} pin — above its ${formatVolts(
            sp.absMaxVoltage,
          )} absolute maximum. Real hardware would likely be damaged; this voltage is not emulated accurately. Use a level shifter or the correct supply voltage.`,
          metric: v,
        });
        break; // one over-voltage warning per part is enough
      }
    }
  }

  // ── Rule 6: electrolytic capacitor over-voltage / reverse polarity ─────
  // Electrolytic caps have a voltage rating (over it they vent / burst) and a
  // polarity (reverse-biasing destroys them). Their +/- pins are normal nets,
  // so the DC voltage across them is read straight from the solve.
  for (const c of input.components) {
    if (!isElectrolyticCap(c.metadataId)) continue;
    const posNet = pinNetMap.get(`${c.id}:+`);
    const negNet = pinNetMap.get(`${c.id}:−`) ?? pinNetMap.get(`${c.id}:-`);
    if (posNet === undefined || negNet === undefined) continue; // not fully wired
    const vPos = posNet === '0' ? 0 : solve.nodeVoltages[posNet];
    const vNeg = negNet === '0' ? 0 : solve.nodeVoltages[negNet];
    if (vPos === undefined || vNeg === undefined || !Number.isFinite(vPos) || !Number.isFinite(vNeg)) {
      continue; // a terminal net is floating / unsolved
    }
    const v = vPos - vNeg;
    const rating = parseVolts(c.properties.voltage) ?? 25;
    if (v > rating) {
      warnings.push({
        severity: 'warning',
        code: 'over-voltage',
        componentId: c.id,
        message: `Electrolytic capacitor ${c.id} has ${formatVolts(v)} across it — above its ${formatVolts(
          rating,
        )} rating. A real capacitor would vent or burst; use a higher-voltage part.`,
        metric: v,
      });
    } else if (v < -0.5) {
      warnings.push({
        severity: 'warning',
        code: 'reverse-polarity',
        componentId: c.id,
        message: `Electrolytic capacitor ${c.id} is reverse-biased (${formatVolts(
          Math.abs(v),
        )} backwards). Polarized capacitors are destroyed when connected backwards — swap its + and - terminals.`,
        metric: v,
      });
    }
  }

  return {
    errors,
    warnings,
    componentsChecked: input.components.length,
    solve,
  };
}

/** Nominal positive-output voltage + positive pin names of a power source. */
function sourceInfo(
  comp: BuildNetlistInput['components'][number],
): { posPins: string[]; volts: number } | null {
  const id = comp.metadataId;
  if (id === 'battery-9v') return { posPins: ['+'], volts: 9 };
  if (id === 'battery-aa') return { posPins: ['+'], volts: 1.5 };
  if (id === 'battery-coin-cell') return { posPins: ['+'], volts: 3 };
  if (id === 'power-supply') {
    return { posPins: ['+', 'SIG', 'VCC'], volts: Math.abs(Number(comp.properties.voltage ?? 5)) };
  }
  if (id === 'signal-generator') {
    const off = Number(comp.properties.offset ?? 0);
    const amp = String(comp.properties.waveform ?? 'sine').toLowerCase() === 'dc'
      ? 0
      : Number(comp.properties.amplitude ?? 0);
    return { posPins: ['SIG', '+'], volts: Math.abs(off) + Math.abs(amp) };
  }
  return null;
}

function isElectrolyticCap(metadataId: string): boolean {
  return metadataId === 'capacitor-electrolytic' || metadataId.startsWith('cap-elec');
}

/** The two terminal pin names of a 2-terminal part, or null if not 2-terminal. */
function twoTerminalPins(id: string): [string, string] | null {
  if (id === 'capacitor-electrolytic' || id.startsWith('cap-elec')) return ['+', '−'];
  if (
    id === 'resistor' ||
    id.startsWith('resistor-') ||
    id === 'capacitor' ||
    (id.startsWith('cap-') && !id.startsWith('cap-elec')) ||
    id === 'inductor'
  ) {
    return ['1', '2'];
  }
  if (id === 'analog-resistor' || id === 'analog-capacitor' || id === 'analog-inductor') {
    return ['A', 'B'];
  }
  if (id === 'led' || id === 'diode' || id.startsWith('diode-') || id.startsWith('zener-')) {
    return ['A', 'C'];
  }
  return null;
}

/** Parse a voltage rating like '25', '25V', '6.3' → volts (null if unparseable). */
function parseVolts(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const m = /^\s*([0-9]*\.?[0-9]+)/.exec(String(raw));
  return m ? parseFloat(m[1]!) : null;
}

// ── Formatting helpers ────────────────────────────────────────────────────

function formatAmps(a: number): string {
  if (a >= 1) return `${a.toFixed(2)} A`;
  if (a >= 1e-3) return `${(a * 1e3).toFixed(1)} mA`;
  if (a >= 1e-6) return `${(a * 1e6).toFixed(1)} µA`;
  return `${a.toExponential(2)} A`;
}

function formatVolts(v: number): string {
  if (v >= 1) return `${v.toFixed(1)} V`;
  if (v >= 1e-3) return `${(v * 1e3).toFixed(0)} mV`;
  return `${v.toExponential(2)} V`;
}

function formatPower(w: number): string {
  if (w >= 1) return `${w.toFixed(2)} W`;
  return `${(w * 1e3).toFixed(0)} mW`;
}

function formatResistance(r: number): string {
  if (r >= 1e6) return `${(r / 1e6).toFixed(1)} MΩ`;
  if (r >= 1e3) return `${(r / 1e3).toFixed(1)} kΩ`;
  return `${r.toFixed(0)} Ω`;
}

/** Parse `'10k'`, `'2.2K'`, `'4.7M'`, `'470'` into ohms. */
function parseResistance(raw: string): number {
  const s = raw.trim();
  const m = /^([-+]?[0-9]*\.?[0-9]+)([kKmMgG]?)/.exec(s);
  if (!m) return NaN;
  const base = parseFloat(m[1]);
  const suffix = m[2];
  const mult =
    suffix === 'k' || suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : suffix === 'g' || suffix === 'G' ? 1e9 : suffix === 'm' ? 1e-3 : 1;
  return base * mult;
}
