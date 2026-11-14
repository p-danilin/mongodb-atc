/**
 * Text to speech for the radio demo: `POST /api/voice/speak` turns one transmission into audio.
 * The ElevenLabs key stays here on Brain; the browser only ever sees the audio.
 */
import { HttpError } from "./world";

export type Speaker = "pilot" | "atc";

// ElevenLabs library voices. Ground is "Penfist - Military Broadcaster" (radio-trained, flat and clipped); override with ATC_VOICE_ID.
const ATC_VOICE = "PODaWQBE9fnXYis1ztG8";
// Pilots: David (British man), Lisa C (British woman), Dean (American man). Override with PILOT_VOICE_IDS=id1,id2,...
const PILOT_VOICES = (process.env.PILOT_VOICE_IDS?.split(",").map((v) => v.trim()).filter(Boolean)) ?? ["EaCGZNIZYoLgxVzmLOPI", "k5o05luU9jyX4sn92sFW", "mF5WrdU1593fy3PUKaSW"];
// Brisk, steady and flat, style at zero: a controller reading a clearance, not an actor. Ground is the faster, flatter one.
const SETTINGS: Record<Speaker, object> = {
  atc: { stability: 0.8, similarity_boost: 0.75, style: 0, speed: 1.15, use_speaker_boost: false },
  pilot: { stability: 0.7, similarity_boost: 0.75, style: 0, speed: 1.1, use_speaker_boost: false },
};
const MODEL = process.env.TTS_MODEL || "eleven_flash_v2_5"; // lowest latency
const cache = new Map<string, Buffer>();

/** `voice` picks which pilot is talking (an index into the pilot pool); each flight keeps its own. */
export async function speak(speaker: Speaker, text: string, voice = 0): Promise<Buffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new HttpError(503, "voice_unavailable", "ELEVENLABS_API_KEY is not set");
  const voiceId = speaker === "pilot" ? PILOT_VOICES[Math.abs(Math.trunc(voice)) % PILOT_VOICES.length] : process.env.ATC_VOICE_ID || ATC_VOICE;
  const cacheKey = `${voiceId}|${speaker}|${text}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODEL, voice_settings: SETTINGS[speaker] }),
  });
  if (!res.ok) throw new HttpError(502, "voice_failed", `ElevenLabs answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const audio = Buffer.from(await res.arrayBuffer());
  if (cache.size >= 200) cache.delete(cache.keys().next().value!);
  cache.set(cacheKey, audio);
  return audio;
}
