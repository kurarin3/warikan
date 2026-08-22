import { firebaseConfig, appCheckConfig } from "./config.js";
import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  initializeAppCheck, ReCaptchaV3Provider, ReCaptchaEnterpriseProvider
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app-check.js";
import {
  getDatabase, ref, push, set, update, remove, get, onValue, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const app = initializeApp(firebaseConfig);

// App Check は他のサービスより先に初期化する。siteKey が未設定なら何もしない。
if (appCheckConfig.siteKey) {
  // ローカル開発では reCAPTCHA を通せないので、デバッグトークンを使う。
  // 本番で有効にすると誰でも通過できてしまうため、localhost のときだけにする。
  if (["localhost", "127.0.0.1"].includes(location.hostname)) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  initializeAppCheck(app, {
    provider: appCheckConfig.provider === "enterprise"
      ? new ReCaptchaEnterpriseProvider(appCheckConfig.siteKey)
      : new ReCaptchaV3Provider(appCheckConfig.siteKey),
    isTokenAutoRefreshEnabled: true
  });
}

const db = getDatabase(app);

const roomRef = (roomId, ...path) => ref(db, ["rooms", roomId, ...path].join("/"));

/** パスワードは roomId を混ぜてハッシュ化する（同じ 4 桁でもルームごとに別の値になる）。 */
export async function hashPassword(roomId, password) {
  const data = new TextEncoder().encode(`warikan:${roomId}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generatePassword() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
  return String(n).padStart(4, "0");
}

export async function createRoom(name, password, memberNames = []) {
  const newRef = push(ref(db, "rooms"));
  const roomId = newRef.key;
  const members = {};
  memberNames.forEach((memberName, i) => {
    members[push(roomRef(roomId, "members")).key] = { name: memberName, order: i };
  });
  await set(newRef, {
    name,
    passwordHash: await hashPassword(roomId, password),
    createdAt: serverTimestamp(),
    ...(Object.keys(members).length ? { members } : {})
  });
  return roomId;
}

export async function fetchRoomName(roomId) {
  const snap = await get(roomRef(roomId, "name"));
  return snap.exists() ? snap.val() : null;
}

export async function fetchPasswordHash(roomId) {
  const snap = await get(roomRef(roomId, "passwordHash"));
  return snap.exists() ? snap.val() : null;
}

export async function checkPassword(roomId, password) {
  const snap = await get(roomRef(roomId, "passwordHash"));
  if (!snap.exists()) return false;
  return snap.val() === (await hashPassword(roomId, password));
}

export async function changePassword(roomId, password) {
  await set(roomRef(roomId, "passwordHash"), await hashPassword(roomId, password));
}

/** ルーム全体を購読する。戻り値を呼ぶと購読解除。 */
export function subscribeRoom(roomId, onData, onError) {
  return onValue(roomRef(roomId), (snap) => onData(snap.val()), onError);
}

export const addMember = (roomId, name, order) =>
  set(push(roomRef(roomId, "members")), { name, order });

export const renameMember = (roomId, memberId, name) =>
  update(roomRef(roomId, "members", memberId), { name });

export const removeMember = (roomId, memberId) =>
  remove(roomRef(roomId, "members", memberId));

export const addItem = (roomId, item) =>
  set(push(roomRef(roomId, "items")), { ...item, createdAt: serverTimestamp() });

export const updateItem = (roomId, itemId, item) =>
  set(roomRef(roomId, "items", itemId), { ...item, updatedAt: serverTimestamp() });

export const removeItem = (roomId, itemId) =>
  remove(roomRef(roomId, "items", itemId));
