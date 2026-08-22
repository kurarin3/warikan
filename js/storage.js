// ブラウザ側だけに置く情報（訪問したルーム、入室済みフラグ）。
const RECENT_KEY = "warikan.recentRooms";
const UNLOCK_KEY = "warikan.unlocked";

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* プライベートモード等では黙って諦める */ }
};

export const recentRooms = () => read(RECENT_KEY, []);

export function rememberRoom(roomId, name) {
  const rooms = recentRooms().filter((r) => r.id !== roomId);
  rooms.unshift({ id: roomId, name, visitedAt: Date.now() });
  write(RECENT_KEY, rooms.slice(0, 20));
}

export function forgetRoom(roomId) {
  write(RECENT_KEY, recentRooms().filter((r) => r.id !== roomId));
  const unlocked = read(UNLOCK_KEY, {});
  delete unlocked[roomId];
  write(UNLOCK_KEY, unlocked);
}

export const isUnlocked = (roomId, hash) => read(UNLOCK_KEY, {})[roomId] === hash;

export function markUnlocked(roomId, hash) {
  write(UNLOCK_KEY, { ...read(UNLOCK_KEY, {}), [roomId]: hash });
}

export function clearUnlocked(roomId) {
  const unlocked = read(UNLOCK_KEY, {});
  delete unlocked[roomId];
  write(UNLOCK_KEY, unlocked);
}
