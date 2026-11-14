import { useEffect, useState } from "react";
import type { Zone } from "@contract/types";
import type { Projection } from "../lib/projection";
import { countdown } from "../lib/closureGeometry";
import { store, useSelector } from "../state/store";

const zonesEqual = (a: Zone[], b: Zone[]) => a.length === b.length && a.every((z, i) => z === b[i]);

/** Closures: red hatch, dashed outline and a countdown from the server's `expires_at`. The UI never removes one itself. */
export function ClosureLayer({ projection }: { projection: Projection }) {
  const zones = useSelector((s) => s.zones, zonesEqual);
  const selected = useSelector((s) => s.selectedZone);
  const dropMode = useSelector((s) => s.dropMode);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!zones.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [zones.length]);

  return (
    <g className="closures">
      <defs>
        <pattern id="closure-hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="10" height="10" fill="var(--map-closure)" fillOpacity="0.18" />
          <line x1="0" y1="0" x2="0" y2="10" stroke="var(--map-closure)" strokeWidth="3" strokeOpacity="0.55" />
        </pattern>
      </defs>
      {zones.map((z) => {
        const ring = z.geometry.coordinates[0].map((c) => projection.toSvg(c));
        const points = ring.map((p) => p.join(",")).join(" ");
        const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
        const cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
        const on = z._id === selected;
        return (
          <g key={z._id} data-closure={z._id} data-selected={on || undefined} pointerEvents={dropMode ? "none" : "all"} style={{ cursor: "pointer" }}
            onClick={(e) => { e.stopPropagation(); store.selectZone(on ? null : z._id); }}>
            <polygon points={points} fill="url(#closure-hatch)" stroke="var(--map-closure)" strokeWidth={on ? 4 : 2.5} strokeDasharray="8 5" strokeLinejoin="round" />
            <g transform={`translate(${cx} ${cy})`} pointerEvents="none">
              <rect x="-50" y="-10" width="100" height="20" rx="10" fill="#ffffff" stroke="var(--map-closure)" />
              <text className="map-closure-label" textAnchor="middle" dominantBaseline="central" data-testid="closure-label">
                Closure · {countdown(z.expires_at, now)}
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );
}
