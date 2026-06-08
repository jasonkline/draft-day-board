import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@shared/types";

// Same-origin connection. In dev, Vite proxies /socket.io to the backend.
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  autoConnect: true,
  transports: ["websocket", "polling"],
});

type Ack<E extends keyof ClientToServerEvents> = Parameters<
  Parameters<ClientToServerEvents[E]>[1]
>[0];

type Payload<E extends keyof ClientToServerEvents> = Parameters<
  ClientToServerEvents[E]
>[0];

/** Promise-based emit with the server's ack callback. */
export function emit<E extends keyof ClientToServerEvents>(
  event: E,
  payload: Payload<E>
): Promise<Ack<E>> {
  return new Promise((resolve) => {
    // @ts-expect-error — variadic socket typings don't narrow nicely here.
    socket.emit(event, payload, (ack: Ack<E>) => resolve(ack));
  });
}
