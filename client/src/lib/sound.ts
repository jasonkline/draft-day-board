// Procedurally-generated sounds via the Web Audio API — no asset files needed.
// Browsers require a user gesture before audio can play; call unlockAudio() from
// a click handler (e.g. when opening the board or arming the draft).

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

// Static audio samples served from /public/sounds, decoded once into
// AudioBuffers and played through the same (gesture-unlocked) AudioContext as
// the procedural sounds.
const PICK_SOUND_URL = "/sounds/pick.mp3"; // "the pick is in" chime
const HURRY_SOUND_URL = "/sounds/htfu.mp3"; // NSFW "hurry the f*** up" clip

const sampleBuffers = new Map<string, AudioBuffer>();
const sampleLoading = new Map<string, Promise<AudioBuffer | null>>();

function loadSample(c: AudioContext, url: string): Promise<AudioBuffer | null> {
  const cached = sampleBuffers.get(url);
  if (cached) return Promise.resolve(cached);
  let pending = sampleLoading.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((data) => c.decodeAudioData(data))
      .then((buf) => {
        sampleBuffers.set(url, buf);
        return buf;
      })
      .catch(() => null);
    sampleLoading.set(url, pending);
  }
  return pending;
}

/** Play a decoded sample now if ready; otherwise warm it for next time. */
function playSample(url: string, gain = 0.9): boolean {
  const c = getCtx();
  if (!c) return false;
  if (c.state === "suspended") void c.resume();
  const buf = sampleBuffers.get(url);
  if (!buf) {
    void loadSample(c, url);
    return false;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(g);
  g.connect(c.destination);
  src.start();
  return true;
}

export function unlockAudio(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  // Warm the caches so the first play uses the real sample, not a fallback.
  void loadSample(c, PICK_SOUND_URL);
  void loadSample(c, HURRY_SOUND_URL);
}

function tone(
  c: AudioContext,
  freq: number,
  start: number,
  duration: number,
  gain = 0.25,
  type: OscillatorType = "sine"
): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime + start);
  g.gain.setValueAtTime(0.0001, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(
    0.0001,
    c.currentTime + start + duration
  );
  osc.connect(g);
  g.connect(c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + duration + 0.02);
}

/** Plays the extracted sample announcing a pick is in. */
export function playDing(): void {
  // Real sample if decoded; otherwise a procedural ding while it loads.
  if (playSample(PICK_SOUND_URL)) return;
  const c = getCtx();
  if (!c) return;
  tone(c, 880, 0, 0.18, 0.3, "triangle");
  tone(c, 1318.5, 0.12, 0.3, 0.28, "triangle");
}

/** Plays the NSFW "hurry the f*** up" clip (no fallback — it's the whole joke). */
export function playHurryUp(): void {
  playSample(HURRY_SOUND_URL, 1.0);
}

/** A short triumphant fanfare for the dramatic reveal. */
export function playFanfare(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C E G C
  notes.forEach((f, i) => tone(c, f, i * 0.13, 0.35, 0.26, "sawtooth"));
  // sparkle
  tone(c, 1567.98, 0.55, 0.5, 0.18, "triangle");
}

/** A soft tick for the draft clock (optional). */
export function playTick(): void {
  const c = getCtx();
  if (!c) return;
  tone(c, 440, 0, 0.05, 0.12, "square");
}
