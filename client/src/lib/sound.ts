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

// The "pick is in" chime, extracted from a screen recording and served as a
// static asset. Decoded once into an AudioBuffer and played through the same
// (gesture-unlocked) AudioContext as the procedural sounds.
const PICK_SOUND_URL = "/sounds/pick.mp3";
let pickBuffer: AudioBuffer | null = null;
let pickBufferLoading: Promise<AudioBuffer | null> | null = null;

function loadPickSound(c: AudioContext): Promise<AudioBuffer | null> {
  if (pickBuffer) return Promise.resolve(pickBuffer);
  if (!pickBufferLoading) {
    pickBufferLoading = fetch(PICK_SOUND_URL)
      .then((r) => r.arrayBuffer())
      .then((data) => c.decodeAudioData(data))
      .then((buf) => {
        pickBuffer = buf;
        return buf;
      })
      .catch(() => null);
  }
  return pickBufferLoading;
}

export function unlockAudio(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  // Warm the cache so the first pick plays the real sample, not the fallback.
  void loadPickSound(c);
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
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  if (pickBuffer) {
    const src = c.createBufferSource();
    src.buffer = pickBuffer;
    const g = c.createGain();
    g.gain.value = 0.9;
    src.connect(g);
    g.connect(c.destination);
    src.start();
    return;
  }
  // Sample not decoded yet — fall back to the procedural ding and kick off
  // the load so the next pick uses the real sound.
  void loadPickSound(c);
  tone(c, 880, 0, 0.18, 0.3, "triangle");
  tone(c, 1318.5, 0.12, 0.3, 0.28, "triangle");
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
