import { useEffect, useRef, useState } from "react";
import { Conversation, type Mode, type Status } from "@elevenlabs/client";
import { MicIcon, MicOffIcon, RadioIcon, SquareIcon } from "lucide-react";
import type { LedgerEntry } from "@contract/types";
import { callMcpTool } from "../lib/mcpClient";
import { store } from "../state/store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** The ElevenLabs agent that plays Ground. Created by `npm run voice:setup` in backend/. */
const AGENT_ID: string | undefined = import.meta.env.VITE_ELEVENLABS_AGENT_ID;

/** Marks a message as coming from the tower system rather than a pilot. The agent's prompt knows this prefix. */
export const TOWER_PREFIX = "[TOWER SYSTEM]";

/**
 * Things that happen without a pilot asking, which Ground must radio to the pilot: the supervisor answered
 * an approval, or a closure changed a flight's route. Returns the line to give the agent, or null.
 */
export function towerNotice(entry: LedgerEntry): string | null {
  if (entry.event === "approval.resolved") return `${TOWER_PREFIX} ${entry.summary}. Check the flight's status and transmit the result to that pilot now.`;
  if (entry.event === "route.replanned" && /rerouted around|resumed after/.test(entry.summary))
    return `${TOWER_PREFIX} ${entry.summary}. Transmit the amended taxi instruction to that pilot now.`;
  return null;
}

interface Line { id: number; who: "Pilot" | "Ground" | "Tower"; text: string }

/** The radio: the person at the mic is a pilot, and the ElevenLabs agent answers as Ground. */
export function VoicePanel() {
  const conversation = useRef<Conversation | null>(null);
  const nextId = useRef(1);
  const [status, setStatus] = useState<Status>("disconnected");
  const [mode, setMode] = useState<Mode>("listening");
  const [muted, setMuted] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  /** No microphone: the pilot types and Ground answers in text only. */
  const [textOnly, setTextOnly] = useState(false);
  const say = (who: Line["who"], text: string) => setLines((l) => [...l.slice(-7), { id: nextId.current++, who, text }]);

  // While the frequency is open, pass tower events to the agent so it calls the pilot unprompted.
  useEffect(() => store.onMessage((m) => {
    const c = conversation.current;
    if (!c?.isOpen() || m.type !== "ledger.appended") return;
    const notice = towerNotice(m.data);
    if (!notice) return;
    c.sendUserMessage(notice);
    setLines((l) => [...l.slice(-7), { id: nextId.current++, who: "Tower", text: m.data.summary }]);
  }), []);
  useEffect(() => () => { void conversation.current?.endSession(); }, []);

  async function open() {
    setError(null);
    try {
      // Without a microphone the frequency still opens, in text.
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => { stream.getTracks().forEach((t) => t.stop()); return true; }, () => false);
      setTextOnly(!mic);
      conversation.current = await Conversation.startSession({
        agentId: AGENT_ID!,
        ...(mic ? {} : { textOnly: true }),
        // The agent's tools run here and call Brain's MCP endpoint, so Brain never has to be reachable from outside.
        clientTools: {
          get_airport_state: () => callMcpTool("get_airport_state"),
          request_taxi: (p: { flight: string; gate?: string }) => callMcpTool("request_taxi", { flight: p.flight, ...(p.gate ? { gate: p.gate } : {}) }),
          get_flight_status: (p: { flight: string }) => callMcpTool("get_flight_status", { flight: p.flight }),
        },
        onStatusChange: ({ status }) => setStatus(status),
        onModeChange: ({ mode }) => setMode(mode),
        onMessage: ({ message, role }) => {
          if (role === "agent") say("Ground", message);
          else if (!message.startsWith(TOWER_PREFIX)) say("Pilot", message); // tower notices are shown when they are sent
        },
        onError: (message) => setError(String(message)),
        onDisconnect: () => { conversation.current = null; setStatus("disconnected"); setMuted(false); },
      });
    } catch (e) {
      setError((e as Error).message || "Could not open the frequency");
      setStatus("disconnected");
    }
  }

  async function close() {
    await conversation.current?.endSession();
    conversation.current = null;
  }

  /** A typed transmission, for a loud room or a machine with no microphone. */
  function transmit(e: React.FormEvent) {
    e.preventDefault();
    const text = typed.trim();
    if (!text || !conversation.current?.isOpen()) return;
    conversation.current.sendUserMessage(text);
    if (textOnly) say("Pilot", text); // in voice mode the transcript event echoes it back
    setTyped("");
  }

  function toggleMute() {
    const next = !muted;
    conversation.current?.setMicMuted(next);
    setMuted(next);
  }

  const live = status === "connected";
  const state = !live ? (status === "connecting" ? "Connecting…" : "Frequency closed") : textOnly ? "No microphone: text only" : mode === "speaking" ? "Ground transmitting" : muted ? "Mic muted" : "Listening for pilots";

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Ground frequency</CardTitle>
        <CardDescription>Speak as a pilot: “Ground, Air Canada 101, request taxi to gate 2.”</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!AGENT_ID ? (
          <p className="text-sm text-muted-foreground">Voice is not set up. Run <code>npm run voice:setup</code> in <code>backend/</code>, then restart Tower.</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              {live || status === "connecting" ? (
                <Button variant="outline" onClick={close} disabled={status !== "connected"}><SquareIcon data-icon="inline-start" />Close</Button>
              ) : (
                <Button onClick={open}><RadioIcon data-icon="inline-start" />Open frequency</Button>
              )}
              <Button variant="outline" onClick={toggleMute} disabled={!live || textOnly} aria-pressed={muted}>
                {muted ? <MicOffIcon data-icon="inline-start" /> : <MicIcon data-icon="inline-start" />}{muted ? "Unmute" : "Mute"}
              </Button>
              <span className="text-xs text-muted-foreground" data-testid="voice-state">{state}</span>
            </div>
            {live && (
              <form onSubmit={transmit} className="flex gap-2">
                <input
                  value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type as a pilot"
                  placeholder="Or type as a pilot…"
                  className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button type="submit" variant="outline" disabled={!typed.trim()}>Transmit</Button>
              </form>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {lines.length > 0 && (
              <ol className="flex flex-col gap-1.5 text-sm" aria-live="polite">
                {lines.map((l) => (
                  <li key={l.id} className={l.who === "Tower" ? "text-xs text-muted-foreground" : undefined}>
                    <span className="font-medium">{l.who}:</span> {l.text}
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
