import type { HeckleFrom, HeckleKind } from "@shared/types";

interface Props {
  kind: HeckleKind;
  from?: HeckleFrom;
}

// Per-kind board takeover content. `mid` is the enlarged middle line (a censored
// word for hurryUp, an emoji for bruh); `emojis` swarm the corners; `runner`
// sprints across; `theme` swaps the color treatment via a modifier class.
const HECKLE: Record<
  HeckleKind,
  {
    top: string;
    mid: string;
    bottom: string;
    emojis: [string, string, string, string];
    runner: string;
    suffix: string;
    theme: string;
  }
> = {
  hurryUp: {
    top: "HURRY THE",
    mid: "F#@%",
    bottom: "UP!!",
    emojis: ["😤", "⏰", "🙄", "😤"],
    runner: "🏃💨",
    suffix: "is waiting",
    theme: "",
  },
  bruh: {
    top: "BRUH.",
    mid: "🤦",
    bottom: "YOU STUPID",
    emojis: ["🤦", "💀", "🤡", "🙄"],
    runner: "🤡",
    suffix: "is judging you 💀",
    theme: "htfu-bruh",
  },
};

/**
 * The NSFW heckle board takeover: a shaking, flashing demand with a sprinting
 * runner and a swarm of impatient emoji. Purely decorative — the Board mounts
 * it for a beat and the audio plays alongside.
 */
export function HeckleOverlay({ kind, from }: Props) {
  const h = HECKLE[kind];
  return (
    <div className={`htfu-overlay ${h.theme}`}>
      <div className="htfu-runner">{h.runner}</div>
      <div className="htfu-emoji htfu-emoji-1">{h.emojis[0]}</div>
      <div className="htfu-emoji htfu-emoji-2">{h.emojis[1]}</div>
      <div className="htfu-emoji htfu-emoji-3">{h.emojis[2]}</div>
      <div className="htfu-emoji htfu-emoji-4">{h.emojis[3]}</div>
      <div className="htfu-text">
        {h.top}
        <span className="htfu-text-big">{h.mid}</span>
        {h.bottom}
      </div>
      {from && (
        <div className="htfu-from" style={{ color: from.color }}>
          — {from.emoji} {from.name} {h.suffix}
        </div>
      )}
    </div>
  );
}
