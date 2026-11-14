import { memo, useEffect, useMemo } from "react";
import type { EdgeKind, Graph, NodeType, VehicleKind } from "@contract/types";
import { makeProjection } from "../lib/projection";
import { createMotionController } from "../lib/motionController";
import { store, useSelector } from "../state/store";

const EDGE_STYLE: Record<EdgeKind, { stroke: string; width: number; dash?: string }> = {
  taxiway: { stroke: "#7d8794", width: 6 },
  apron: { stroke: "#4b5563", width: 5, dash: "4 6" },
  runway: { stroke: "#c9ced6", width: 16 },
  runway_crossing: { stroke: "#f59e0b", width: 6, dash: "10 6" },
};
const NODE_STYLE: Record<NodeType, { r: number; fill: string }> = {
  gate: { r: 9, fill: "#38bdf8" },
  junction: { r: 5, fill: "#e5e7eb" },
  runway_exit: { r: 8, fill: "#a78bfa" },
};

/** Sprite per Vehicle kind (UI-only mapping). Drawn nose-up; the motion loop rotates it by heading. */
function Sprite({ kind }: { kind: VehicleKind }) {
  if (kind === "aircraft")
    return <path d="M0,-16 L3,-4 L15,3 L15,6 L3,3 L2,12 L6,15 L6,17 L0,15.5 L-6,17 L-6,15 L-2,12 L-3,3 L-15,6 L-15,3 L-3,-4 Z" fill="#fbbf24" stroke="#111" strokeWidth="1.5" />;
  if (kind === "fuel_truck") return <rect x="-6" y="-10" width="12" height="20" rx="2" fill="#f87171" stroke="#111" strokeWidth="1.5" />;
  return <circle r="8" fill="#34d399" stroke="#111" strokeWidth="1.5" />;
}

const BaseLayer = memo(function BaseLayer({ graph, toSvg }: { graph: Graph; toSvg: (p: [number, number]) => [number, number] }) {
  const nodeById = new Map(graph.nodes.map((n) => [n._id, n]));
  const pts = (coords: [number, number][]) => coords.map((c) => toSvg(c).join(",")).join(" ");
  return (
    <g>
      {graph.edges.map((e) => {
        const s = EDGE_STYLE[e.kind];
        const [mx, my] = toSvg(e.geometry.coordinates[Math.floor(e.geometry.coordinates.length / 2)] as [number, number]);
        return (
          <g key={e._id} data-edge={e._id} data-kind={e.kind}>
            <polyline points={pts(e.geometry.coordinates as [number, number][])} fill="none" stroke={s.stroke} strokeWidth={s.width} strokeDasharray={s.dash} strokeLinecap="round" />
            {(e.kind === "runway" || e.kind === "runway_crossing") && (
              <text x={mx} y={my - 12} className="edge-label">{e.kind === "runway" ? "RUNWAY" : "RUNWAY CROSSING"}</text>
            )}
          </g>
        );
      })}
      {graph.nodes.map((n) => {
        const s = NODE_STYLE[n.type];
        const [x, y] = toSvg(n.location.coordinates as [number, number]);
        return (
          <g key={n._id} data-node={n._id} data-type={n.type}>
            <circle cx={x} cy={y} r={s.r} fill={s.fill} stroke="#0b1220" strokeWidth="2" />
            <text x={x + s.r + 5} y={n.type === "runway_exit" ? y - 14 : y + 4} className="node-label">{n.name}</text>
          </g>
        );
      })}
    </g>
  );
});

interface VehicleMeta { id: string; kind: VehicleKind; route: string[] }
const metaEqual = (a: VehicleMeta[], b: VehicleMeta[]) =>
  a.length === b.length && a.every((m, i) => m.id === b[i].id && m.kind === b[i].kind && m.route.join() === b[i].route.join());

export function AirportMap({ graph }: { graph: Graph }) {
  const projection = useMemo(() => makeProjection(graph.bounds), [graph]);
  const controller = useMemo(() => createMotionController(store, projection), [projection]);
  useEffect(() => () => controller.destroy(), [controller]);
  // Re-renders only when a Vehicle appears/disappears or its kind/route changes, never on position updates.
  const metas = useSelector(
    (s) => Object.values(s.vehicles).map((v): VehicleMeta => ({ id: v._id, kind: v.kind, route: v.route })),
    metaEqual,
  );
  const edgeById = useMemo(() => new Map(graph.edges.map((e) => [e._id, e])), [graph]);
  const [x, y, w, h] = projection.viewBox;
  return (
    <svg className="map" viewBox={`${x} ${y} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Airport map">
      <BaseLayer graph={graph} toSvg={projection.toSvg} />
      <g className="routes">
        {metas.flatMap((m) =>
          m.route.map((eid) => {
            const e = edgeById.get(eid);
            if (!e) return null;
            return <polyline key={`${m.id}-${eid}`} data-route={m.id} points={e.geometry.coordinates.map((c) => projection.toSvg(c as [number, number]).join(",")).join(" ")} fill="none" stroke="#22d3ee" strokeWidth="5" strokeOpacity="0.8" strokeLinecap="round" />;
          }),
        )}
      </g>
      <g className="vehicles">
        {metas.map((m) => (
          <g key={m.id} data-vehicle={m.id} ref={(el) => controller.attach(m.id, el)}>
            <Sprite kind={m.kind} />
          </g>
        ))}
      </g>
    </svg>
  );
}
