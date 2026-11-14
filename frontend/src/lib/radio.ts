import { API_URL } from "./api";
import { callMcpTool } from "./mcpClient";

/** What `request_taxi` returns (backend TaxiOutcome). */
export interface Taxi {
  flight: string;
  decision: "allow" | "needs_approval" | "deny" | "arrived";
  gate: string;
  gate_name: string;
  route: string[];
  reason?: string;
  reassigned_from?: string;
}

const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "niner"];
const ALPHABET: Record<string, string> = Object.fromEntries(
  "Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliet Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whiskey Xray Yankee Zulu".split(" ").map((w, i) => [String.fromCharCode(65 + i), w]),
);
const digits = (s: string) => s.replace(/\d/g, (d) => ` ${DIGITS[Number(d)]} `).replace(/\s+/g, " ").trim();

/** "AC101" -> "Air Canada one zero one". */
export function spokenCallsign(callsign: string): string {
  const m = callsign.replace(/\s/g, "").toUpperCase().match(/^([A-Z]+)(\d.*)$/);
  if (!m) return callsign;
  const airline = ({ AC: "Air Canada", WJ: "WestJet" } as Record<string, string>)[m[1]] ?? [...m[1]].map((c) => ALPHABET[c]).join(" ");
  return `${airline} ${digits(m[2])}`;
}

/** "Gate 2" -> "gate two". */
export const spokenGate = (name: string) => digits(name).toLowerCase();

/** ["H1", "A", "D2", "Spur 2"] -> "Hotel one, Alpha, Delta two". A final spur that only leads to the gate is dropped. */
export function spokenRoute(route: string[]): string {
  const names = route.length > 1 && /^spur/i.test(route[route.length - 1]) ? route.slice(0, -1) : route;
  return names.map((n) => (/^[A-Z]{1,2}\d*$/.test(n) ? digits([...n.replace(/\d+$/, "")].map((c) => ALPHABET[c]).join(" ") + " " + (n.match(/\d+$/)?.[0] ?? "")) : digits(n))).join(", ");
}

export const pilotRequest = (flight: string, gateName: string) =>
  `Ground, ${spokenCallsign(flight)}, clear of the runway, request taxi to ${spokenGate(gateName)}.`;

/** Ground's transmission for a taxi decision, in the phraseology of the agent's prompt. */
export function groundReply(t: Taxi): string {
  const cs = spokenCallsign(t.flight);
  const gate = spokenGate(t.gate_name);
  switch (t.decision) {
    case "allow": return `${cs}, ${t.reassigned_from ? `${spokenGate(t.reassigned_from)} is occupied, ` : ""}taxi to ${gate} via ${spokenRoute(t.route)}.`;
    case "needs_approval": return `${cs}, hold position, runway crossing requires clearance, standby.`;
    case "deny": return `${cs}, unable, ${t.reason ?? "not permitted"}, hold position.`;
    case "arrived": return `${cs}, you are at ${gate}, monitor Ground.`;
  }
}

/** The pilot's readback of that transmission. */
export function pilotReadback(t: Taxi, crossing = false): string {
  const cs = spokenCallsign(t.flight);
  if (t.decision === "allow") return `${crossing ? "Cross runway two seven, " : ""}taxi to ${spokenGate(t.gate_name)} via ${spokenRoute(t.route)}, ${cs}.`;
  if (t.decision === "arrived") return `Monitoring Ground, ${cs}.`;
  return `Hold position, ${cs}.`;
}

/** Ground's call once the supervisor has answered a held flight. */
export function approvalReply(flight: string, status: { gate_name: string; route: string[] }, approved: boolean): string {
  const cs = spokenCallsign(flight);
  return approved ? `${cs}, cross runway two seven, taxi to ${spokenGate(status.gate_name)} via ${spokenRoute(status.route)}.` : `${cs}, unable runway crossing, hold position.`;
}

export interface RadioLine { id: number; who: "Pilot" | "Ground" | "System"; text: string }

export interface RadioDeps {
  /** Say a line. Resolves when the transmission has finished. */
  say: (who: "Pilot" | "Ground", text: string) => Promise<void>;
  /** Start generating a line's audio early. */
  prefetch: (who: "Pilot" | "Ground", text: string) => void;
  /** Show a line without speaking it, e.g. the MCP call. */
  note: (text: string) => void;
  /** Ground tool calls: the same MCP endpoint the voice agent uses. */
  tool: (name: "request_taxi" | "get_flight_status", args: Record<string, unknown>) => Promise<string>;
  /** Resolves with `approve` or `deny` when the supervisor answers this flight's held crossing. */
  waitForSupervisor: (flight: string) => Promise<"approve" | "deny">;
}

const parse = <T,>(text: string): T => {
  if (text.startsWith("ERROR")) throw new Error(text);
  return JSON.parse(text) as T;
};

/**
 * The whole exchange for one arrival: pilot calls, Ground asks the policy gate through MCP, Ground answers,
 * the pilot reads back. A held crossing waits for the supervisor, then Ground clears or refuses it.
 */
export async function runRadioFlow(flight: string, gateId: string, gateName: string, d: RadioDeps): Promise<void> {
  await d.say("Pilot", pilotRequest(flight, gateName));
  d.note(`MCP request_taxi(${flight}, ${gateId})`);
  const taxi = parse<Taxi>(await d.tool("request_taxi", { flight, gate: gateId }));
  d.note(`Policy gate: ${taxi.decision}${taxi.reason && taxi.decision !== "allow" ? ` (${taxi.reason})` : ""}`);
  d.prefetch("Pilot", pilotReadback(taxi)); // generate the readback while Ground is still talking
  await d.say("Ground", groundReply(taxi));
  await d.say("Pilot", pilotReadback(taxi));
  if (taxi.decision !== "needs_approval") return;

  const answer = await d.waitForSupervisor(flight);
  d.note(`Supervisor: ${answer}`);
  if (answer === "deny") { await d.say("Ground", approvalReply(flight, taxi, false)); await d.say("Pilot", `Unable, holding position, ${spokenCallsign(flight)}.`); return; }
  d.note(`MCP get_flight_status(${flight})`);
  const status = parse<{ gate_name: string; route: string[] }>(await d.tool("get_flight_status", { flight }));
  await d.say("Ground", approvalReply(flight, status, true));
  await d.say("Pilot", pilotReadback({ ...taxi, decision: "allow", gate_name: status.gate_name, route: status.route }, true));
}

// ------------------------------------------------------------------ browser side

/** Fetch one transmission's audio from Brain (which holds the ElevenLabs key). Null when voice is unavailable. */
async function fetchAudio(speaker: "pilot" | "atc", text: string): Promise<Blob | null> {
  try {
    const res = await fetch(`${API_URL}/api/voice/speak`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ speaker, text }) });
    return res.ok ? await res.blob() : null;
  } catch { return null; }
}

function play(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const done = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onended = done; audio.onerror = done;
    audio.play().catch(done);
  });
}

/** Radio transmissions play one at a time, in order. Audio is fetched ahead so each line follows the last without a gap. */
export function makeSpeaker(onLine: (who: "Pilot" | "Ground", text: string) => void, onOffline: () => void) {
  const pending = new Map<string, Promise<Blob | null>>();
  const key = (who: string, text: string) => `${who}|${text}`;
  return {
    /** Start generating a line's audio early. */
    prefetch(who: "Pilot" | "Ground", text: string) { pending.set(key(who, text), fetchAudio(who === "Pilot" ? "pilot" : "atc", text)); },
    async say(who: "Pilot" | "Ground", text: string) {
      const k = key(who, text);
      const audio = await (pending.get(k) ?? fetchAudio(who === "Pilot" ? "pilot" : "atc", text));
      pending.delete(k);
      onLine(who, text);
      if (audio) await play(audio);
      else { onOffline(); await new Promise((r) => setTimeout(r, Math.min(6000, 600 + text.length * 55))); } // captions only, paced like speech
    },
  };
}

export const mcpTool: RadioDeps["tool"] = (name, args) => callMcpTool(name, args);
