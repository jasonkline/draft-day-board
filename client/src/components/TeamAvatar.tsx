// Renders a team's avatar: the imported logo image when present, otherwise the
// procedurally-assigned emoji. Drop-in replacement for a bare `{team.emoji}` —
// inherits sizing from the surrounding font-size so it slots into every spot the
// emoji used to live (setup list, board, grid, reveal, etc.).

type AvatarTeam = { emoji: string; name?: string; logoUrl?: string };

export function TeamAvatar({
  team,
  className = "",
}: {
  team: AvatarTeam;
  className?: string;
}) {
  if (team.logoUrl) {
    return (
      <img
        className={`team-logo ${className}`.trim()}
        src={team.logoUrl}
        alt=""
        aria-hidden="true"
      />
    );
  }
  return <span className={className}>{team.emoji}</span>;
}
