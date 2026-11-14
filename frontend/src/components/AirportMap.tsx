import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Graph, GraphEdge, GraphNode, VehicleKind, VehicleStatus } from "@contract/types";
import { makeProjection, type Projection } from "../lib/projection";
import { createMotionController } from "../lib/motionController";
import { orientedRoute } from "../lib/routeGeometry";
import { closureOctagon, closureReason } from "../lib/closureGeometry";
import { api } from "../lib/api";
import { store, useSelector } from "../state/store";
import { ClosureLayer } from "./ClosureLayer";
import { ClosureControls, HaltBanner } from "./MapOverlays";

type XY = [number, number];

const TAXIWAY_W = 16;
const RUNWAY_W = 30;
const APRON_W = 46;
const RUNWAY_OVERRUN = 100;
const PAD = 80;

const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const add = (a: XY, b: XY): XY => [a[0] + b[0], a[1] + b[1]];
const mul = (a: XY, k: number): XY => [a[0] * k, a[1] * k];
const unit = (a: XY): XY => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
const perp = (a: XY): XY => [-a[1], a[0]];
const pts = (list: XY[]) => list.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

/** Intersection of two infinite lines (point + direction). */
function intersect(p: XY, d: XY, q: XY, e: XY): XY {
  const det = d[0] * e[1] - d[1] * e[0] || 1e-9;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / det;
  return add(p, mul(d, t));
}

const SIGN_SKIP = /^(Spur|Apron|Runway|Crossing|Taxilane)/;

const Halo = ({ x, y, children }: { x: number; y: number; children: string }) => (
  <text x={x} y={y} className="map-label">{children}</text>
);

const BaseLayer = memo(function BaseLayer({ graph, projection }: { graph: Graph; projection: Projection }) {
  const toXY = (c: number[]) => projection.toSvg(c as [number, number]);
  const edgePts = (e: GraphEdge) => e.geometry.coordinates.map(toXY);
  const nodes = graph.nodes;
  const nodePos = new Map(nodes.map((n) => [n._id, toXY(n.location.coordinates)]));

  // The runway may be several edges (split at the high-speed exits); draw it as one strip end to end.
  const runways = graph.edges.filter((e) => e.kind === "runway");
  const runway = runways[0];
  const rw = runways.length ? [edgePts(runways[0])[0], edgePts(runways[runways.length - 1]).at(-1)!] : null;
  const rwDir = rw ? unit(sub(rw[rw.length - 1], rw[0])) : ([1, 0] as XY);
  const rwStart = rw ? sub(rw[0], mul(rwDir, RUNWAY_OVERRUN)) : null;
  const rwEnd = rw ? add(rw[rw.length - 1], mul(rwDir, RUNWAY_OVERRUN)) : null;
  const rwNormal = perp(rwDir);
  const rwBearing = rw ? ((Math.atan2(rwDir[0], -rwDir[1]) * 180) / Math.PI + 360) % 360 : 0;
  const rwNum = (deg: number) => String(Math.round(((deg + 360) % 360) / 10) || 36).padStart(2, "0");

  const gates = nodes.filter((n) => n.type === "gate");
  const rwY = rw ? rw[0][1] : 0;
  const sides = [gates.filter((g) => nodePos.get(g._id)![1] > rwY), gates.filter((g) => nodePos.get(g._id)![1] <= rwY)];
  const terminals = sides.filter((s) => s.length).map((s) => {
    const ps = s.map((g) => nodePos.get(g._id)!);
    const xs = ps.map((p) => p[0]);
    const gy = ps[0][1];
    const below = gy > rwY;
    return { x: Math.min(...xs) - 30, w: Math.max(...xs) - Math.min(...xs) + 60, y: below ? gy + 30 : gy - 30 - 40, h: 40 };
  });

  const aprons = graph.edges.filter((e) => e.kind === "apron" || (e.kind === "taxiway" && /^(Spur|Taxilane)/.test(e.name)));
  const roads = graph.edges.filter((e) => e.kind === "taxiway" || e.kind === "runway_crossing");

  const seenSigns = new Set<string>();
  const signs = roads.flatMap((e) => {
    if (SIGN_SKIP.test(e.name) || seenSigns.has(e.name)) return [];
    seenSigns.add(e.name);
    const p = edgePts(e);
    const a = p[0], b = p[p.length - 1];
    const mid = mul(add(a, b), 0.5);
    const n = perp(unit(sub(b, a)));
    return [{ name: e.name, at: add(mid, mul(n, 17)) }];
  });

  const holds = graph.edges.filter((e) => e.kind === "runway_crossing").flatMap((e) => {
    if (!rw) return [];
    const p = edgePts(e);
    const d = unit(sub(p[p.length - 1], p[0]));
    const c = intersect(p[0], d, rw[0], rwDir);
    return [-1, 1].map((side) => ({ key: `${e._id}${side}`, at: add(c, mul(d, side * (RUNWAY_W / 2 + 14))), n: perp(d) }));
  });

  const [vx, vy, vw, vh] = projection.viewBox;
  const barUnits = 200 / projection.metersPerUnit;

  return (
    <g>
      <rect x={vx} y={vy} width={vw} height={vh} fill="var(--map-ground)" />
      {terminals.map((t, i) => (
        <g key={i}>
          <rect x={t.x} y={t.y} width={t.w} height={t.h} rx="6" fill="#cdd3da" stroke="#b6bec7" strokeWidth="1.5" />
          <text x={t.x + t.w / 2} y={t.y + t.h / 2 + 4} className="map-area-label" textAnchor="middle">Terminal</text>
        </g>
      ))}
      <g stroke="var(--map-apron)" strokeWidth={APRON_W} strokeLinecap="round" strokeLinejoin="round" fill="none">
        {aprons.map((e) => <polyline key={e._id} points={pts(edgePts(e))} />)}
      </g>
      <g data-layer="taxiways" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {roads.map((e) => <polyline key={`o${e._id}`} points={pts(edgePts(e))} stroke="#aab2bb" strokeWidth={TAXIWAY_W + 3} />)}
        {roads.map((e) => <polyline key={`f${e._id}`} data-edge={e._id} data-kind={e.kind} points={pts(edgePts(e))} stroke="var(--map-taxi)" strokeWidth={TAXIWAY_W} />)}
        {aprons.map((e) => <polyline key={`l${e._id}`} {...(e.kind === "apron" ? { "data-edge": e._id, "data-kind": e.kind } : {})} points={pts(edgePts(e))} stroke="#aeb6bf" strokeWidth="1.5" strokeDasharray="3 6" />)}
        {roads.map((e) => <polyline key={`c${e._id}`} points={pts(edgePts(e))} stroke="var(--map-centerline)" strokeWidth="2" strokeLinecap="butt" />)}
      </g>
      {runway && rwStart && rwEnd && (
        <g data-edge={runways.map((e) => e._id).join(" ")} data-kind="runway">
          <polyline points={pts([rwStart, rwEnd])} stroke="var(--map-runway)" strokeWidth={RUNWAY_W} fill="none" />
          {[-1, 1].map((s) => (
            <polyline key={s} points={pts([add(rwStart, mul(rwNormal, s * (RUNWAY_W / 2 - 2))), add(rwEnd, mul(rwNormal, s * (RUNWAY_W / 2 - 2)))])} stroke="#f4f6f8" strokeWidth="1.5" fill="none" />
          ))}
          <polyline points={pts([add(rwStart, mul(rwDir, 66)), sub(rwEnd, mul(rwDir, 66))])} stroke="#f4f6f8" strokeWidth="2" strokeDasharray="16 12" fill="none" />
          {[rwStart, rwEnd].map((end, i) => {
            const inward = mul(rwDir, i === 0 ? 1 : -1);
            return (
              <g key={i}>
                {[-9, -5, -1, 3, 7].map((o) => (
                  <polyline key={o} points={pts([add(add(end, mul(inward, 8)), mul(rwNormal, o)), add(add(end, mul(inward, 20)), mul(rwNormal, o))])} stroke="#f4f6f8" strokeWidth="1.8" fill="none" />
                ))}
                <text transform={`translate(${add(end, mul(inward, 40)).join(" ")}) rotate(${i === 0 ? 90 : -90})`} className="map-runway-num" textAnchor="middle" dominantBaseline="central">
                  {rwNum(i === 0 ? rwBearing : rwBearing + 180)}
                </text>
              </g>
            );
          })}
        </g>
      )}
      {holds.map((h) => (
        <g key={h.key}>
          <polyline points={pts([add(h.at, mul(h.n, TAXIWAY_W / 2 + 1)), sub(h.at, mul(h.n, TAXIWAY_W / 2 + 1))])} stroke="var(--map-hold)" strokeWidth="3" />
          <polyline points={pts([add(add(h.at, mul(h.n, TAXIWAY_W / 2 + 1)), mul(unit(perp(h.n)), 4)), add(sub(h.at, mul(h.n, TAXIWAY_W / 2 + 1)), mul(unit(perp(h.n)), 4))])} stroke="var(--map-hold)" strokeWidth="1.5" strokeDasharray="3 3" />
        </g>
      ))}
      {signs.map((s) => (
        <g key={s.name} transform={`translate(${s.at[0]} ${s.at[1]})`}>
          <rect x="-11" y="-9" width="22" height="18" rx="3" fill="var(--map-centerline)" stroke="#16202b" strokeWidth="1" />
          <text className="map-sign" textAnchor="middle" dominantBaseline="central">{s.name}</text>
        </g>
      ))}
      {nodes.map((n: GraphNode) => {
        const [x, y] = nodePos.get(n._id)!;
        return (
          <g key={n._id} data-node={n._id} data-type={n.type}>
            {n.type === "gate" && (
              <g>
                <rect x={x - 15} y={y - 10} width="30" height="20" rx="4" fill="#16202b" />
                <text x={x} y={y} className="map-gate" textAnchor="middle" dominantBaseline="central">{n._id}</text>
              </g>
            )}
            {n.type === "junction" && (
              <g>
                <circle cx={x} cy={y} r="4" fill="#ffffff" stroke="#16202b" strokeWidth="1.5" />
                <Halo x={x + 8} y={y - 8}>{n.name}</Halo>
              </g>
            )}
            {n.type === "runway_exit" && (
              <g>
                <rect x={x - 5} y={y - 5} width="10" height="10" fill="#ffffff" stroke="#16202b" strokeWidth="1.5" transform={`rotate(45 ${x} ${y})`} />
                <Halo x={x + 10} y={y - 22}>{n._id}</Halo>
              </g>
            )}
          </g>
        );
      })}
      <g transform={`translate(${vx + 26} ${vy + vh - 26})`}>
        <polyline points={`0,-5 0,0 ${barUnits},0 ${barUnits},-5`} fill="none" stroke="#5b6875" strokeWidth="1.5" />
        <text x="0" y="-10" className="map-area-label">200 m</text>
      </g>
      <g transform={`translate(${vx + vw - 34} ${vy + 38})`}>
        <polygon points="0,-16 7,6 0,2 -7,6" fill="#16202b" />
        <text x="0" y="22" className="map-area-label" textAnchor="middle">N</text>
      </g>
    </g>
  );
});

const STATUS_COLOR: Record<VehicleStatus, string> = {
  idle: "#8693a0", moving: "#1d5fd8", awaiting_approval: "#d99200", halted: "#c8352a",
};

/** Sprite per Vehicle kind (UI-only mapping). Drawn nose-up; the motion loop rotates it by heading. */
function Sprite({ kind }: { kind: VehicleKind }) {
  const stroke = { stroke: "#ffffff", strokeWidth: 2.5, paintOrder: "stroke" as const, strokeLinejoin: "round" as const };
  if (kind === "aircraft")
    return <path d="M0,-17 L2.6,-6 L16,3 L16,6.5 L2.6,3.5 L2,12 L6.5,15.5 L6.5,18 L0,16 L-6.5,18 L-6.5,15.5 L-2,12 L-2.6,3.5 L-16,6.5 L-16,3 L-2.6,-6 Z" fill="#1d5fd8" {...stroke} />;
  if (kind === "fuel_truck") return <rect x="-6" y="-11" width="12" height="22" rx="2.5" fill="#d99200" {...stroke} />;
  return <circle r="8" fill="#16202b" {...stroke} />;
}

interface VehicleMeta { id: string; kind: VehicleKind; route: string[]; status: VehicleStatus; callsign: string }
const metaEqual = (a: VehicleMeta[], b: VehicleMeta[]) =>
  a.length === b.length && a.every((m, i) => m.id === b[i].id && m.kind === b[i].kind && m.status === b[i].status && m.callsign === b[i].callsign && m.route.join() === b[i].route.join());

/** Amber ring (awaiting approval) and red flash (denied). The motion loop sets their opacity by reference. */
function VehicleFx({ id, controller }: { id: string; controller: ReturnType<typeof createMotionController> }) {
  const ring = useRef<SVGCircleElement>(null), flash = useRef<SVGCircleElement>(null);
  useEffect(() => {
    controller.attachFx(id, { ring: ring.current!, flash: flash.current! });
    return () => controller.attachFx(id, null);
  }, [id, controller]);
  return (
    <g pointerEvents="none">
      <circle ref={ring} r="26" fill="none" stroke="var(--map-pending)" strokeWidth="4" opacity="0" />
      <circle ref={flash} r="24" fill="var(--map-closure)" fillOpacity="0.35" stroke="var(--map-closure)" strokeWidth="4" opacity="0" />
    </g>
  );
}

export function AirportMap({ graph }: { graph: Graph }) {
  const projection = useMemo(() => makeProjection(graph.bounds, { padding: PAD }), [graph]);
  const controller = useMemo(() => createMotionController(store, projection), [projection]);
  useEffect(() => () => controller.destroy(), [controller]);
  // Re-renders only when a Vehicle appears/disappears or its kind, route, status or callsign changes, never on position updates.
  const metas = useSelector(
    (s) => Object.values(s.vehicles).map((v): VehicleMeta => ({
      id: v._id, kind: v.kind, route: v.route, status: v.status,
      callsign: "flight" in v.details ? v.details.flight : v._id,
    })),
    metaEqual,
  );
  const pending = useSelector(
    (s) => s.pendingApprovals.map((a) => ({ id: a._id, edges: a.payload.edges })),
    (a, b) => a.length === b.length && a.every((p, i) => p.id === b[i].id && p.edges.join() === b[i].edges.join()),
  );
  const highlighted = useSelector((s) => s.highlightedApproval);
  const edgeById = useMemo(() => new Map(graph.edges.map((e) => [e._id, e])), [graph]);
  const dropMode = useSelector((s) => s.dropMode);
  const [dropError, setDropError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [x, y, w, h] = projection.viewBox;

  const drop = async (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current, m = svg?.getScreenCTM();
    if (!svg || !m) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const click = projection.toLonLat([pt.x, pt.y]);
    setDropError(null);
    try {
      await api.createZone({ type: "closure", geometry: closureOctagon(click, projection), ttl_seconds: store.getState().ttlSeconds, reason: closureReason(click, graph.edges) });
    } catch (err) { setDropError((err as Error).message); }
  };

  return (
    <div className="relative size-full">
    <HaltBanner />
    <ClosureControls message={dropError} clearMessage={() => setDropError(null)} />
    <svg ref={svgRef} className="size-full" style={dropMode ? { cursor: "crosshair" } : undefined}
      onClick={dropMode ? drop : () => store.selectZone(null)} viewBox={`${x} ${y} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Airport diagram">
      <BaseLayer graph={graph} projection={projection} />
      <g className="routes" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {metas.flatMap((m) =>
          orientedRoute(m.route, edgeById).map(({ id: eid, coords }) => {
            const points = coords.map((c) => projection.toSvg(c).join(",")).join(" ");
            return (
              <g key={`${m.id}-${eid}`} data-route={m.id}>
                <polyline points={points} stroke="var(--map-route)" strokeWidth="6" strokeOpacity="0.9" />
                <polyline points={points} stroke="#ffffff" strokeWidth="1.8" strokeDasharray="2 9" className="route-flow" />
              </g>
            );
          }),
        )}
      </g>
      {/* Routes the policy gate marked needs-approval: proposed, not yet cleared to move. */}
      <g className="pending-routes" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {pending.flatMap((p) =>
          orientedRoute(p.edges, edgeById).map(({ id: eid, coords }) => {
            const points = coords.map((c) => projection.toSvg(c).join(",")).join(" ");
            const on = p.id === highlighted;
            return (
              <polyline
                key={`${p.id}-${eid}`}
                data-pending-route={p.id}
                data-highlighted={on || undefined}
                points={points}
                stroke="var(--map-pending)"
                strokeWidth={on ? 9 : 6}
                strokeOpacity={on ? 1 : 0.75}
                strokeDasharray="10 8"
              />
            );
          }),
        )}
      </g>
      <ClosureLayer projection={projection} />
      <g className="vehicles">
        {metas.map((m) => (
          <g key={m.id} data-vehicle={m.id} data-status={m.status} ref={(el) => controller.attach(m.id, el)}>
            <VehicleFx id={m.id} controller={controller} />
            <g className="sprite"><Sprite kind={m.kind} /></g>
          </g>
        ))}
      </g>
      <g className="vehicle-labels">
        {metas.map((m) => (
          <g key={m.id} ref={(el) => controller.attachLabel(m.id, el)} pointerEvents="none">
            <g transform="translate(20 -30)" className="label-in">
              <rect width={m.callsign.length * 7.4 + 30} height="20" rx="10" fill="#ffffff" stroke="#c9d0d7" />
              <circle cx="11" cy="10" r="3.5" fill={STATUS_COLOR[m.status]} />
              <text x="20" y="10" className="map-callsign" dominantBaseline="central">{m.callsign}</text>
            </g>
          </g>
        ))}
      </g>
    </svg>
    </div>
  );
}
