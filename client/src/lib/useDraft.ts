import { useEffect, useState } from "react";
import { socket } from "./socket";
import type { PickRevealEvent, SessionState } from "@shared/types";

/** Subscribe to authoritative session state pushed by the server. */
export function useSessionState(initial: SessionState | null = null) {
  const [state, setState] = useState<SessionState | null>(initial);
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const onState = (s: SessionState) => setState(s);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on("state:update", onState);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("state:update", onState);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  return { state, setState, connected };
}

/** Register a handler for the dramatic pick reveal event. */
export function useReveal(handler: (e: PickRevealEvent) => void) {
  useEffect(() => {
    socket.on("pick:reveal", handler);
    return () => {
      socket.off("pick:reveal", handler);
    };
  }, [handler]);
}

/** A live countdown (seconds remaining) toward a deadline epoch-ms, or null. */
export function useCountdown(deadline: number | null): number | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (deadline == null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);
  if (deadline == null) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
