/**
 * Text to speech for the radio demo: `POST /api/voice/speak` turns one transmission into audio.
 * The ElevenLabs key stays here on Brain; the browser only ever sees the audio.
 */
import { HttpError } from "./world";

export type Speaker = "pilot" | "atc";

// ElevenLabs premade voices: Adam for the pilot, Rachel for Ground. Override with PILOT_VOICE_ID / ATC_VOICE_ID.
const DEFAULT_VOICES: Record<Speaker, string> = { pilot: "pNInz6obpgDQGcFmaJgB", atc: "21m00Tcm4TlvDq8ikWAM" };
const MODEL = process.env.TTS_MODEL || "eleven_flash_v2_5"; // lowest latency
const cache = new Map<string, Buffer>();

export async function speak(speaker: Speaker, text: string): Promise<Buffer> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new HttpError(503, "voice_unavailable", "ELEVENLABS_API_KEY is not set");
  const voice = (speaker === "pilot" ? process.env.PILOT_VOICE_ID : process.env.ATC_VOICE_ID) || DEFAULT_VOICES[speaker];
  const cacheKey = `${voice}|${text}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODEL }),
  });
  if (!res.ok) throw new HttpError(502, "voice_failed", `ElevenLabs answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const audio = Buffer.from(await res.arrayBuffer());
  if (cache.size >= 200) cache.delete(cache.keys().next().value!);
  cache.set(cacheKey, audio);
  return audio;
}
