// Short "ping" for PR event toasts. WebAudio only, no audio asset. The AudioContext is created
// lazily on first use (autoplay policies require a user gesture before audio can play), and any
// failure is swallowed — a missing ping should never break the app.

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

function tone(context: AudioContext, freq: number, startAt: number, duration: number) {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.value = 0.2;
  osc.connect(gain);
  gain.connect(context.destination);
  osc.start(startAt);
  osc.stop(startAt + duration);
}

/** Two quick sine notes (~150ms), gain 0.2. Degrades silently when audio is unavailable. */
export function playPing(): void {
  try {
    const context = getContext();
    if (!context) return;
    if (context.state === "suspended") void context.resume().catch(() => {});
    const now = context.currentTime;
    tone(context, 880, now, 0.075);
    tone(context, 1320, now + 0.08, 0.075);
  } catch {
    // ignore — audio is a nice-to-have
  }
}
