// ---------------------------------------------------------------------------
// Estimarea combustibilului pe călătorie (VW Welcome), fără senzor de consum:
// din viteză și turație, cu un model fizic simplu (linia Willans):
//   litri = lucru mecanic la roți / (energia unui litru × randament)
//         + rotații ale motorului × litri pe rotație (frecări, mers în gol).
// Modelul dă o valoare brută; factorul de calibrare din alimentări (plin → plin)
// o aduce la litrii reali. Fără dependențe de server, ca să poată fi testat.
// ---------------------------------------------------------------------------

/** Golf 6 1.2 TSI (CBZB), cu șofer. Valorile absolute contează puțin: calibrarea le corectează. */
export const FUEL_MODEL = {
  massKg: 1350,
  cdA: 0.69, // Cd 0,31 × 2,22 m²
  airDensity: 1.2,
  rollingCoef: 0.012,
  // Energia unui litru de benzină (~32 MJ) × randamentul motor + transmisie.
  joulesPerLiter: 32e6 * 0.27,
  // ~0,6 L/h la relanti (750 rpm = 45.000 rotații/h).
  litersPerRev: 1.33e-5,
};

/** Peste atâtea secunde între două puncte nu știm ce s-a întâmplat (motor oprit, fără date). */
const MAX_GAP_S = 60;

export interface FuelSample {
  t: number; // epoch ms
  speed: number | null; // km/h
  rpm: number | null;
}

export interface FuelEstimate {
  liters: number; // brut, necalibrat
  idleMin: number; // pe loc cu motorul pornit
}

export function estimateFuel(samples: FuelSample[]): FuelEstimate {
  const m = FUEL_MODEL;
  let work = 0;
  let revs = 0;
  let idleS = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const dt = (b.t - a.t) / 1000;
    if (!(dt > 0) || dt > MAX_GAP_S) continue;
    const rpm = a.rpm ?? b.rpm;
    if (rpm === null || rpm <= 0) continue; // motorul oprit: nu consumă
    revs += (rpm / 60) * dt;
    const v1 = (a.speed ?? 0) / 3.6;
    const v2 = (b.speed ?? 0) / 3.6;
    const v = (v1 + v2) / 2;
    if (v < 0.3) {
      idleS += dt;
      continue;
    }
    // Puterea la roți: accelerare + aer + rulare; la frânare/rulare liberă nu se consumă lucru.
    const power =
      (m.massKg * (v2 - v1) * v) / dt +
      0.5 * m.airDensity * m.cdA * v ** 3 +
      m.rollingCoef * m.massKg * 9.81 * v;
    if (power > 0) work += power * dt;
  }
  return {
    liters: work / m.joulesPerLiter + revs * m.litersPerRev,
    idleMin: idleS / 60,
  };
}

export interface FuelRefuel {
  id: number;
  at: string; // ISO
  odo: number | null;
  liters: number;
  price: number | null; // lei / litru
  full: boolean;
}

export interface FuelInterval {
  fromId: number;
  toId: number;
  liters: number; // alimentat între două plinuri
  modelLiters: number; // estimarea brută a călătoriilor dintre ele
  km: number | null;
  lPer100: number | null;
}

export interface FuelCalibration {
  factor: number;
  calibrated: boolean; // false = încă fără destule date (nivel sau două plinuri)
  source: "level" | "refuels" | null; // de unde vine factorul
  intervals: FuelInterval[];
  level: LevelConsumption | null;
}

/** O citire a nivelului din rezervor (CAN c104, litri întregi), cu motorul pornit. */
export interface LevelReading {
  t: string; // ISO
  fuel: number;
  odo: number | null;
}

export interface LevelConsumption {
  from: string;
  to: string;
  liters: number; // consumați: nivelul de la început − cel de la sfârșit + alimentările
  refills: number; // litri alimentați (salturile în sus)
  km: number | null;
  lPer100: number | null;
}

/** Un salt în sus de atâția litri e o alimentare; sub atât e combustibil care se mișcă. */
const REFILL_JUMP = 3;
/** Sub atâția litri consumați, rezoluția de 1 L a nivelului strică factorul. */
const MIN_LEVEL_LITERS = 8;

/**
 * Consumul real din nivelul rezervorului: fluctuațiile mici se anulează între capete, deci
 * eroarea rămâne ~1 L oricât de lungă e perioada. `readings` crescător după timp, fuel > 0.
 */
export function levelConsumption(readings: LevelReading[]): LevelConsumption | null {
  if (readings.length < 2) return null;
  let refills = 0;
  for (let i = 1; i < readings.length; i++) {
    const jump = readings[i].fuel - readings[i - 1].fuel;
    if (jump >= REFILL_JUMP) refills += jump;
  }
  const first = readings[0];
  const last = readings[readings.length - 1];
  const liters = first.fuel - last.fuel + refills;
  const odos = readings.map((r) => r.odo).filter((o): o is number => o !== null && o > 0);
  const km =
    odos.length >= 2 && odos[odos.length - 1] > odos[0] ? odos[odos.length - 1] - odos[0] : null;
  return {
    from: first.t,
    to: last.t,
    liters,
    refills,
    km,
    lPer100: km !== null && km >= 50 ? (liters / km) * 100 : null,
  };
}

/** Câte intervale plin → plin recente intră în factor (consumul se schimbă cu anotimpul). */
const CALIBRATION_INTERVALS = 5;
const FACTOR_MIN = 0.4;
const FACTOR_MAX = 2.5;

/**
 * Intervalele plin → plin și factorul de calibrare. `refuels` crescător după dată; `trips`
 * cu începutul și estimarea brută. Litrii unui interval = toate alimentările de după primul
 * plin, până la plinul următor inclusiv (și cele parțiale dintre ele).
 */
export function calibrate(
  refuels: FuelRefuel[],
  trips: Array<{ start: string; modelLiters: number }>,
  readings: LevelReading[] = [],
): FuelCalibration {
  const intervals: FuelInterval[] = [];
  let from: FuelRefuel | null = null;
  let liters = 0;
  for (const r of refuels) {
    if (from) liters += r.liters;
    if (!r.full) continue;
    if (from) {
      const a = from.at;
      const b = r.at;
      const modelLiters = trips
        .filter((t) => t.start >= a && t.start < b)
        .reduce((s, t) => s + t.modelLiters, 0);
      const km = from.odo !== null && r.odo !== null && r.odo > from.odo ? r.odo - from.odo : null;
      intervals.push({
        fromId: from.id,
        toId: r.id,
        liters,
        modelLiters,
        km,
        lPer100: km !== null ? (liters / km) * 100 : null,
      });
    }
    from = r;
    liters = 0;
  }
  const used = intervals.filter((i) => i.modelLiters > 0).slice(-CALIBRATION_INTERVALS);
  const model = used.reduce((s, i) => s + i.modelLiters, 0);
  const real = used.reduce((s, i) => s + i.liters, 0);
  const clamp = (x: number) => Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, x));
  // Nivelul din rezervor are prioritate: nu cere plinuri și acoperă toate drumurile.
  const level = levelConsumption(readings);
  if (level && level.liters >= MIN_LEVEL_LITERS) {
    const levelModel = trips
      .filter((t) => t.start >= level.from && t.start <= level.to)
      .reduce((s, t) => s + t.modelLiters, 0);
    if (levelModel > 0) {
      return {
        factor: clamp(level.liters / levelModel),
        calibrated: true,
        source: "level",
        intervals,
        level,
      };
    }
  }
  return {
    factor: model > 0 ? clamp(real / model) : 1,
    calibrated: model > 0,
    source: model > 0 ? "refuels" : null,
    intervals,
    level,
  };
}

/** Prețul ultimei alimentări de dinainte de `at` (sau al primei, dacă toate sunt după). */
export function priceAt(refuels: FuelRefuel[], at: string): number | null {
  let price: number | null = null;
  for (const r of refuels) {
    if (r.price === null) continue;
    if (r.at <= at || price === null) price = r.price;
    if (r.at > at) break;
  }
  return price;
}
