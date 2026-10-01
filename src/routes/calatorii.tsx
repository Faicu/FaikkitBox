import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Car, MapPin } from "lucide-react";

import { PageShell } from "@/components/PageShell";
import { TehnicSubNav } from "@/components/tehnic/TehnicSubNav";
import { TripMap } from "@/components/vw/TripMap";
import { TripChart } from "@/components/vw/TripChart";
import { CarPosition } from "@/components/vw/CarPosition";
import { Maintenance } from "@/components/vw/Maintenance";
import { FuelLog } from "@/components/vw/FuelLog";
import { vwCarQuery, vwFuelQuery, vwTripPointsQuery, vwTripsQuery } from "@/lib/queries";
import type { VwTrip } from "@/lib/vw/vw-trips.functions";
import { requireAdminBeforeLoad } from "@/lib/auth/admin-route-guard";

export const Route = createFileRoute("/calatorii")({
  beforeLoad: requireAdminBeforeLoad,
  head: () => ({ meta: [{ title: "Călătorii — Monitor Server" }] }),
  component: TripsPage,
});

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("ro-RO", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function hm(iso: string): string {
  return new Date(iso).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
}

function duration(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  return `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`;
}

function liters(n: number): string {
  return `${n.toLocaleString("ro-RO", { maximumFractionDigits: n < 10 ? 2 : 1 })} L`;
}

function lei(n: number): string {
  return `${n.toLocaleString("ro-RO", { maximumFractionDigits: n < 100 ? 2 : 0 })} lei`;
}

/** „≈ 0,38 L · 2,66 lei” pentru lista de călătorii. */
function fuelLine(t: VwTrip): string {
  if (t.fuelL === null) return "";
  return ` · ≈ ${liters(t.fuelL)}${t.cost !== null ? ` · ${lei(t.cost)}` : ""}`;
}

function TripsPage() {
  const { data, isLoading } = useQuery(vwTripsQuery);
  const { data: car } = useQuery(vwCarQuery);
  const { data: fuel } = useQuery(vwFuelQuery);
  const trips = data ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const current = trips.find((t) => t.start === selected) ?? trips[0];

  const month = trips.filter((t) => Date.now() - new Date(t.start).getTime() < 30 * 86_400_000);
  const km = month.reduce((s, t) => s + t.distanceKm, 0);
  const min = month.reduce((s, t) => s + t.durationMin, 0);
  const monthL = month.reduce((s, t) => s + (t.fuelL ?? 0), 0);
  const monthCost = month.some((t) => t.cost !== null)
    ? month.reduce((s, t) => s + (t.cost ?? 0), 0)
    : null;

  return (
    <PageShell title="Călătorii" subtitle="Golf 6 · VW Welcome">
      <TehnicSubNav />

      <div className="flex items-center justify-between">
        <Link to="/vw" className="text-sm text-sky-400 hover:underline">
          ← Jurnalul VW
        </Link>
      </div>

      {car && <CarPosition position={car.position} />}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Călătorii (30 zile)" value={String(month.length)} />
        <Stat label="Distanță" value={`${Math.round(km)} km`} />
        <Stat label="Timp la volan" value={duration(min)} />
        <Stat label="Combustibil (est.)" value={`≈ ${liters(monthL)}`} />
        <Stat
          label="Consum (est.)"
          value={
            km >= 1
              ? `${((monthL / km) * 100).toLocaleString("ro-RO", { maximumFractionDigits: 1 })} L/100`
              : "—"
          }
        />
        <Stat label="Cost (est.)" value={monthCost !== null ? lei(monthCost) : "—"} />
      </div>

      {isLoading && <div className="h-40 skeleton-sweep rounded-2xl" />}
      {!isLoading && trips.length === 0 && (
        <p className="rounded-2xl glass-card p-4 text-sm text-muted-foreground">
          Nicio călătorie încă. Aplicația VW Welcome trimite traseul automat când mașina merge.
        </p>
      )}

      {current && <TripDetail trip={current} />}

      {fuel && <FuelLog fuel={fuel} />}

      {car && <Maintenance reminders={car.reminders} odometer={car.odometer} />}

      <div className="space-y-2">
        {trips.map((t) => (
          <button
            key={t.start}
            type="button"
            onClick={() => setSelected(t.start)}
            className={`block w-full rounded-2xl glass-card glass-card-hover press-tile p-3 text-left ${
              t.start === current?.start ? "ring-1 ring-sky-400/60" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold">
                {day(t.start)} · {hm(t.start)}–{hm(t.end)}
              </span>
              <span className="text-sm text-sky-400">{t.distanceKm} km</span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {duration(t.durationMin)}
              {t.avgSpeed !== null ? ` · medie ${t.avgSpeed} km/h` : ""}
              {t.maxSpeed !== null ? ` · max ${t.maxSpeed} km/h` : ""}
              {fuelLine(t)}
            </p>
          </button>
        ))}
      </div>
    </PageShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl glass-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function TripDetail({ trip }: { trip: VwTrip }) {
  const { data: points } = useQuery(vwTripPointsQuery(trip.start, trip.end));
  return (
    <div className="space-y-2">
      <div className="rounded-2xl glass-card p-4">
        <div className="flex items-center gap-2">
          <Car className="h-5 w-5 text-sky-400" />
          <span className="font-semibold">
            {day(trip.start)} · {hm(trip.start)}–{hm(trip.end)}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <Info label="Distanță" value={`${trip.distanceKm} km`} />
          <Info label="Durată" value={duration(trip.durationMin)} />
          <Info
            label="Viteză medie"
            value={trip.avgSpeed !== null ? `${trip.avgSpeed} km/h` : "—"}
          />
          <Info label="Viteză max" value={trip.maxSpeed !== null ? `${trip.maxSpeed} km/h` : "—"} />
          <Info label="Turație max" value={trip.maxRpm !== null ? `${trip.maxRpm} rpm` : "—"} />
          <Info label="Baterie min" value={trip.minVolt !== null ? `${trip.minVolt} V` : "—"} />
          <Info label="Temp. exterioară" value={trip.tempC !== null ? `${trip.tempC} °C` : "—"} />
          <Info
            label="Kilometraj"
            value={trip.odoEnd !== null ? `${trip.odoEnd.toLocaleString("ro-RO")} km` : "—"}
          />
          <Info
            label="Combustibil (est.)"
            value={trip.fuelL !== null ? `≈ ${liters(trip.fuelL)}` : "—"}
          />
          <Info
            label="Consum (est.)"
            value={
              trip.lPer100 !== null
                ? `${trip.lPer100.toLocaleString("ro-RO", { maximumFractionDigits: 1 })} L/100 km`
                : "—"
            }
          />
          <Info label="Cost (est.)" value={trip.cost !== null ? lei(trip.cost) : "—"} />
          <Info label="Pe loc, motor pornit" value={duration(trip.idleMin)} />
          <Info
            label="Rezervor (CAN)"
            value={
              trip.fuelStart !== null && trip.fuelEnd !== null
                ? `${trip.fuelStart} → ${trip.fuelEnd} L`
                : "—"
            }
          />
          <Info label="Puncte" value={String(trip.points)} />
        </div>
        {trip.startPos && (
          <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" /> verde = plecare, roșu = sosire
          </p>
        )}
      </div>
      {points && <TripMap points={points} />}
      {points && <TripChart points={points} />}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
