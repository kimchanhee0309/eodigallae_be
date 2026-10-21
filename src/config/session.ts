export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function getRoomSessionCookieName(roomId: string) {
  return `eg_session_${roomId}`;
}
