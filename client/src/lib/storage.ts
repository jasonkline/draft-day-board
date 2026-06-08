// Capability tokens persisted in localStorage so a refresh keeps your seat.

const KEY = "draftday";

interface Stored {
  admin: Record<string, string>; // code -> adminToken
  team: Record<string, { teamId: string; teamToken: string }>; // code -> team creds
}

function read(): Stored {
  if (typeof localStorage === "undefined") return { admin: {}, team: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { admin: {}, team: {} };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return { admin: parsed.admin ?? {}, team: parsed.team ?? {} };
  } catch {
    return { admin: {}, team: {} };
  }
}

function write(data: Stored): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function saveAdminToken(code: string, token: string): void {
  const d = read();
  d.admin[code] = token;
  write(d);
}

export function getAdminToken(code: string): string | undefined {
  return read().admin[code];
}

export function saveTeamCreds(
  code: string,
  teamId: string,
  teamToken: string
): void {
  const d = read();
  d.team[code] = { teamId, teamToken };
  write(d);
}

export function getTeamCreds(
  code: string
): { teamId: string; teamToken: string } | undefined {
  return read().team[code];
}
