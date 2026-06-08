import type { HurryUpFrom } from "@shared/types";

interface Props {
  from?: HurryUpFrom;
}

/**
 * The NSFW "hurry the f*** up" board takeover: a shaking, flashing demand with
 * a sprinting runner and a swarm of impatient emoji. Purely decorative — the
 * Board mounts it for a beat and the audio plays alongside.
 */
export function HurryUpOverlay({ from }: Props) {
  return (
    <div className="htfu-overlay">
      <div className="htfu-runner">🏃💨</div>
      <div className="htfu-emoji htfu-emoji-1">😤</div>
      <div className="htfu-emoji htfu-emoji-2">⏰</div>
      <div className="htfu-emoji htfu-emoji-3">🙄</div>
      <div className="htfu-emoji htfu-emoji-4">😤</div>
      <div className="htfu-text">
        HURRY THE
        <span className="htfu-text-big">F#@%</span>
        UP!!
      </div>
      {from && (
        <div className="htfu-from" style={{ color: from.color }}>
          — {from.emoji} {from.name} is waiting
        </div>
      )}
    </div>
  );
}
