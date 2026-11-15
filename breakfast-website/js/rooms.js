// Same room rules as the server (src/rooms.js), used for instant feedback while typing.
// The server always re-checks, so this copy is only for convenience.
export function parseRoom(input) {
  const room = String(input ?? '').trim();
  if (room === '') return { ok: false, error: 'Please enter a room number.' };
  if (!/^\d{3,4}$/.test(room) || room.startsWith('0')) {
    return { ok: false, error: 'Use 3 or 4 digits, like 512 or 1408.' };
  }
  const floor = Number(room.slice(0, -2));
  const position = Number(room.slice(-2));
  if (floor < 5 || floor > 15) return { ok: false, error: `Floor ${floor} has no guest rooms (floors 5–15 only).` };
  if (position < 1 || position > 18) return { ok: false, error: `Room position ${room.slice(-2)} doesn't exist (01–18 only).` };
  return { ok: true, room, floor, position };
}
