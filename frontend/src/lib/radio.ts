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
  /** Set when cleared only as far as the hold short line; the runway crossing waits for the supervisor. */
  hold_short?: string;
  reassigned_from?: string;
}

const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "niner"];
const ALPHABET: Record<string, string> = Object.fromEntries(
  "Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliet Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whiskey Xray Yankee Zulu".split(" ").map((w, i) => [String.fromCharCode(65 + i), w]),
);
const digits = (s: string) => s.replace(/\d/g, (d) => ` ${DIGITS[Number(d)]} `).replace(/\s+/g, " ").trim();

/** Airlines seeded for the demo, spoken by their plain names so anyone listening recognises them. */
export const AIRLINES: Record<string, string> = {
  // Canada
  AC: "Air Canada", WJ: "WestJet", PD: "Porter", TS: "Air Transat",
  // United States
  UA: "United", AA: "American", DL: "Delta", WN: "Southwest", B6: "JetBlue", AS: "Alaska",
  // Europe
  BA: "British Airways", LH: "Lufthansa", AF: "Air France", KL: "KLM", IB: "Iberia",
  VS: "Virgin Atlantic", LX: "Swiss", SK: "Scandinavian", FR: "Ryanair", U2: "easyJet",
};

/** A random flight such as "BA286", never one already used by a flight on the ground. */
export function randomFlight(taken: ReadonlySet<string> = new Set(), rand: () => number = Math.random): string {
  const codes = Object.keys(AIRLINES);
  for (;;) {
    const name = `${codes[Math.floor(rand() * codes.length)]}${1 + Math.floor(rand() * 999)}`;
    if (!taken.has(name)) return name;
  }
}

/** "BA286" -> "British Airways two eight six". */
export function spokenCallsign(callsign: string): string {
  const cs = callsign.replace(/\s/g, "").toUpperCase();
  const code = Object.keys(AIRLINES).find((c) => cs.startsWith(c) && /^\d/.test(cs.slice(c.length)));
  if (code) return `${AIRLINES[code]} ${digits(cs.slice(code.length))}`;
  const m = cs.match(/^([A-Z]+)(\d.*)$/);
  return m ? `${[...m[1]].map((c) => ALPHABET[c]).join(" ")} ${digits(m[2])}` : callsign;
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
    case "allow":
      if (t.hold_short) return `${cs}, taxi via ${spokenRoute(t.route)}, hold short of runway two seven.`;
      return `${cs}, ${t.reassigned_from ? `${spokenGate(t.reassigned_from)} is occupied, ` : ""}taxi to ${gate} via ${spokenRoute(t.route)}.`;
    case "needs_approval": return `${cs}, hold position, runway crossing requires clearance, standby.`;
    case "deny": return `${cs}, unable, ${t.reason ?? "not permitted"}, hold position.`;
    case "arrived": return `${cs}, you are at ${gate}, monitor Ground.`;
  }
}

/** The pilot's readback of that transmission. */
export function pilotReadback(t: Taxi, crossing = false): string {
  const cs = spokenCallsign(t.flight);
  if (t.decision === "allow" && t.hold_short) return `Taxi via ${spokenRoute(t.route)}, hold short of runway two seven, ${cs}.`;
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
  d.note(`Policy gate: ${taxi.decision}${taxi.reason && (taxi.decision !== "allow" || taxi.hold_short) ? ` (${taxi.reason})` : ""}`);
  const waits = taxi.decision === "needs_approval" || !!taxi.hold_short;
  // Listen before speaking: the supervisor may answer while the radio is still talking.
  const supervisor = waits ? d.waitForSupervisor(flight) : null;
  d.prefetch("Pilot", pilotReadback(taxi)); // generate the readback while Ground is still talking
  await d.say("Ground", groundReply(taxi));
  await d.say("Pilot", pilotReadback(taxi));
  if (!supervisor) return;

  const answer = await supervisor;
  d.note(`Supervisor: ${answer}`);
  if (answer === "deny") { await d.say("Ground", approvalReply(flight, taxi, false)); await d.say("Pilot", `Unable, holding position, ${spokenCallsign(flight)}.`); return; }
  d.note(`MCP get_flight_status(${flight})`);
  const status = parse<{ gate_name: string; route: string[] }>(await d.tool("get_flight_status", { flight }));
  await d.say("Ground", approvalReply(flight, status, true));
  await d.say("Pilot", pilotReadback({ ...taxi, hold_short: undefined, decision: "allow", gate_name: status.gate_name, route: status.route }, true));
}

// ------------------------------------------------------------------ browser side

/** Fetch one transmission's audio from Brain (which holds the ElevenLabs key). Null when voice is unavailable. */
async function fetchAudio(speaker: "pilot" | "atc", text: string, voice: number): Promise<Blob | null> {
  try {
    const res = await fetch(`${API_URL}/api/voice/speak`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ speaker, text, voice }) });
    return res.ok ? await res.blob() : null;
  } catch { return null; }
}

let ctx: AudioContext | null = null;

/** A short burst of noise with a quick decay: the squelch when a mic keys or unkeys. */
function click(c: AudioContext, out: AudioNode, at: number, level: number) {
  const len = Math.floor(c.sampleRate * 0.04);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len / 6));
  const src = c.createBufferSource(); src.buffer = buf;
  const g = c.createGain(); g.gain.value = level;
  src.connect(g).connect(out); src.start(at);
}

function distortion(amount: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) { const x = (i / 512) - 1; curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x)); }
  return curve;
}

/** Play a transmission through a VHF radio: narrow band, squashed dynamics, a little clipping, hiss and mic clicks. */
async function play(blob: Blob, who: "Pilot" | "Ground"): Promise<void> {
  try {
    ctx ??= new AudioContext();
    await ctx.resume();
    const c = ctx;
    const voice = await c.decodeAudioData(await blob.arrayBuffer());
    const start = c.currentTime + 0.12;
    const end = start + voice.duration;
    const pilot = who === "Pilot"; // the pilot is farther away: noisier, more clipped

    const out = c.createGain(); out.gain.value = 0.9;
    const bus = c.createBiquadFilter(); bus.type = "highpass"; bus.frequency.value = 180;
    const low = c.createBiquadFilter(); low.type = "lowpass"; low.frequency.value = pilot ? 4500 : 5000;
    const mid = c.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 1500; mid.gain.value = 2.4; mid.Q.value = 0.8;
    const drive = c.createWaveShaper(); drive.curve = distortion(pilot ? 4 : 2.4); drive.oversample = "2x";
    const squash = c.createDynamicsCompressor();
    squash.threshold.value = -32; squash.ratio.value = 6; squash.attack.value = 0.003; squash.release.value = 0.12; squash.knee.value = 6;
    bus.connect(low).connect(mid).connect(drive).connect(squash).connect(out).connect(c.destination);

    const src = c.createBufferSource(); src.buffer = voice;
    const pre = c.createGain(); pre.gain.value = 1.3; // push into the compressor and shaper
    src.connect(pre).connect(bus);
    src.start(start);

    // Hiss under the whole transmission, through the same narrow band.
    const hissLen = Math.ceil(voice.duration + 0.5) * c.sampleRate;
    const hissBuf = c.createBuffer(1, hissLen, c.sampleRate);
    const h = hissBuf.getChannelData(0);
    for (let i = 0; i < hissLen; i++) h[i] = Math.random() * 2 - 1;
    const hiss = c.createBufferSource(); hiss.buffer = hissBuf;
    const hissGain = c.createGain(); hissGain.gain.value = pilot ? 0.018 : 0.009;
    hiss.connect(hissGain).connect(bus);
    hiss.start(start - 0.08); hiss.stop(end + 0.2);

    click(c, bus, start - 0.07, 0.15);   // key up
    click(c, bus, end + 0.02, 0.11);    // key down

    await new Promise<void>((resolve) => setTimeout(resolve, (end + 0.3 - c.currentTime) * 1000));
  } catch {
    // No Web Audio: play it clean rather than not at all.
    await new Promise<void>((resolve) => {
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      const done = () => { URL.revokeObjectURL(url); resolve(); };
      audio.onended = done; audio.onerror = done;
      audio.play().catch(done);
    });
  }
}

/** Radio transmissions play one at a time, in order. Audio is fetched ahead so each line follows the last without a gap. */
/** `pilotVoice` is this flight's pilot: an index into the backend's pilot voices. */
export function makeSpeaker(pilotVoice: number, onLine: (who: "Pilot" | "Ground", text: string) => void, onOffline: () => void, onEnd: (who: "Pilot" | "Ground", text: string) => void = () => {}) {
  const pending = new Map<string, Promise<Blob | null>>();
  const key = (who: string, text: string) => `${who}|${text}`;
  return {
    /** Start generating a line's audio early. */
    prefetch(who: "Pilot" | "Ground", text: string) { pending.set(key(who, text), fetchAudio(who === "Pilot" ? "pilot" : "atc", text, pilotVoice)); },
    async say(who: "Pilot" | "Ground", text: string) {
      const k = key(who, text);
      const audio = await (pending.get(k) ?? fetchAudio(who === "Pilot" ? "pilot" : "atc", text, pilotVoice));
      pending.delete(k);
      onLine(who, text);
      if (audio) await play(audio, who);
      else { onOffline(); await new Promise((r) => setTimeout(r, Math.min(6000, 600 + text.length * 55))); } // captions only, paced like speech
      onEnd(who, text);
    },
  };
}

export const mcpTool: RadioDeps["tool"] = (name, args) => callMcpTool(name, args);
