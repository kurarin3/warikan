import { isConfigured } from "./config.js";
import { splitEqually, computeBalances, settle, sum, yen } from "./calc.js";
import * as local from "./storage.js";

const $ = (sel) => document.querySelector(sel);
const show = (id) => {
  document.querySelectorAll(".screen").forEach((s) => { s.hidden = s.id !== id; });
};

/** 小さな要素ビルダー。文字列は必ず textContent として入るので、名前に何が入っても安全。 */
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const toInt = (value) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : 0;
};

const todayStr = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${wd})`;
}

let toastTimer;
function toast(message) {
  const box = $("#toast");
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 2400);
}

const ALL = "__all__";

const state = {
  roomId: null,
  roomName: "",
  members: [],
  items: [],
  selectedDate: ALL,
  unsubscribe: null
};

const form = {
  editingId: null,
  payMode: "single",
  splitMode: "equal",
  singlePayerId: null,
  payerAmounts: {},
  participants: new Set(),
  shareAmounts: {}
};

const memberName = (id) =>
  state.members.find((m) => m.id === id)?.name ?? "(削除されたメンバー)";

// ===========================================================================
// 起動
// ===========================================================================
if (!isConfigured()) {
  show("screen-setup");
} else {
  const db = await import("./db.js");
  window.addEventListener("popstate", () => boot(db));
  wireLobby(db);
  wireLock(db);
  wireRoom(db);
  await boot(db);
}

async function boot(db) {
  const roomId = new URLSearchParams(location.search).get("room");
  if (state.unsubscribe) { state.unsubscribe(); state.unsubscribe = null; }

  if (!roomId) {
    renderLobby();
    show("screen-lobby");
    return;
  }

  state.roomId = roomId;
  let name;
  try {
    name = await db.fetchRoomName(roomId);
  } catch (err) {
    $("#lock-error").textContent = `接続に失敗しました：${err.message}`;
    $("#lock-error").hidden = false;
    show("screen-lock");
    return;
  }

  if (name === null) {
    local.forgetRoom(roomId);
    renderLobby();
    show("screen-lobby");
    $("#join-error").textContent = "そのルームは見つかりませんでした。";
    $("#join-error").hidden = false;
    return;
  }

  state.roomName = name;

  // 入室済みかどうかは、保存しておいたハッシュと現在のハッシュの一致で判定する。
  // パスワードそのものはブラウザにも残さない。パスワードが変更されれば再入力になる。
  if (local.isUnlocked(roomId, await db.fetchPasswordHash(roomId))) {
    openRoom(db);
  } else {
    $("#lock-room-name").textContent = name;
    $("#lock-pass").value = "";
    $("#lock-error").hidden = true;
    show("screen-lock");
    $("#lock-pass").focus();
  }
}

// ===========================================================================
// ロビー（ルーム作成 / 参加 / 履歴）
// ===========================================================================
function wireLobby(db) {
  $("#create-pass").value = db.generatePassword();
  $("#create-pass-regen").addEventListener("click", () => {
    $("#create-pass").value = db.generatePassword();
  });

  $("#create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = $("#create-error");
    error.hidden = true;

    const name = $("#create-name").value.trim();
    const password = $("#create-pass").value.trim();
    const members = $("#create-members").value
      .split(/[,、\n]/).map((s) => s.trim()).filter(Boolean);

    if (!/^\d{4}$/.test(password)) {
      error.textContent = "パスワードは 4 桁の数字で入力してください。";
      error.hidden = false;
      return;
    }

    const button = event.submitter;
    button.disabled = true;
    try {
      const roomId = await db.createRoom(name, password, members);
      local.markUnlocked(roomId, await db.hashPassword(roomId, password));
      local.rememberRoom(roomId, name);
      state.roomId = roomId;
      state.roomName = name;
      history.pushState({}, "", `?room=${encodeURIComponent(roomId)}`);
      openRoom(db);
      openShareDialog();
      toast(`パスワードは ${password} です`);
    } catch (err) {
      error.textContent = `作成できませんでした：${err.message}`;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });

  $("#join-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const raw = $("#join-id").value.trim();
    const match = raw.match(/[?&]room=([^&]+)/);
    const roomId = match ? decodeURIComponent(match[1]) : raw;
    if (!roomId) return;
    history.pushState({}, "", `?room=${encodeURIComponent(roomId)}`);
    boot(db);
  });
}

function renderLobby() {
  const rooms = local.recentRooms();
  $("#recent-card").hidden = rooms.length === 0;
  const list = $("#recent-list");
  list.replaceChildren(
    ...rooms.map((room) =>
      h("li", {},
        h("a", { href: `?room=${encodeURIComponent(room.id)}` },
          room.name,
          h("span", { class: "rid" }, room.id)),
        h("button", {
          class: "icon danger",
          title: "履歴から削除",
          onclick: () => { local.forgetRoom(room.id); renderLobby(); }
        }, "履歴を削除")))
  );
}

// ===========================================================================
// パスワード入力
// ===========================================================================
function wireLock(db) {
  $("#lock-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = $("#lock-error");
    error.hidden = true;
    const password = $("#lock-pass").value.trim();
    const button = event.submitter;
    button.disabled = true;
    try {
      if (await db.checkPassword(state.roomId, password)) {
        local.markUnlocked(state.roomId, await db.hashPassword(state.roomId, password));
        local.rememberRoom(state.roomId, state.roomName);
        openRoom(db);
      } else {
        error.textContent = "パスワードが違います。";
        error.hidden = false;
        $("#lock-pass").select();
      }
    } catch (err) {
      error.textContent = `確認できませんでした：${err.message}`;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
}

// ===========================================================================
// ルーム本体
// ===========================================================================
function openRoom(db) {
  show("screen-room");
  $("#f-date").value = todayStr();
  state.selectedDate = ALL;

  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = db.subscribeRoom(
    state.roomId,
    (data) => {
      if (!data) {
        toast("このルームは削除されました");
        leaveRoom();
        return;
      }
      state.roomName = data.name;
      state.members = Object.entries(data.members || {})
        .map(([id, m]) => ({ id, name: m.name, order: m.order ?? 0 }))
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ja"));
      state.items = Object.entries(data.items || {})
        .map(([id, item]) => ({ id, ...item }))
        .sort((a, b) =>
          a.date < b.date ? 1 : a.date > b.date ? -1 : (a.createdAt ?? 0) - (b.createdAt ?? 0));

      local.rememberRoom(state.roomId, state.roomName);
      syncFormWithMembers();
      renderAll(db);
    },
    (err) => toast(`同期エラー：${err.message}`)
  );
}

function leaveRoom() {
  if (state.unsubscribe) { state.unsubscribe(); state.unsubscribe = null; }
  location.href = "./";
}

function renderAll(db) {
  $("#room-name").textContent = state.roomName;
  $("#room-sub").textContent =
    `${state.members.length}人 ・ ${state.items.length}件の項目`;
  renderDatebar(db);
  // 他の端末の更新が届くたびに入力欄を作り直すと、入力中のフォーカスが飛ぶ。
  // フォームの構造が変わるときだけ組み直し、それ以外は金額表示の更新だけにする。
  if (formSig() !== formSignature) renderForm(db);
  else refreshTotals();
  renderItems(db);
  renderSettlement();
  renderMemberAdmin(db);
}

// --- 日付バー --------------------------------------------------------------
function visibleItems() {
  return state.selectedDate === ALL
    ? state.items
    : state.items.filter((item) => item.date === state.selectedDate);
}

function renderDatebar(db) {
  const counts = new Map();
  for (const item of state.items) {
    counts.set(item.date, (counts.get(item.date) ?? 0) + 1);
  }
  if (state.selectedDate !== ALL && !counts.has(state.selectedDate)) {
    counts.set(state.selectedDate, 0);
  }
  const dates = [...counts.keys()].sort().reverse();

  const chip = (value, label, count) =>
    h("button", {
      type: "button",
      class: "datechip",
      "aria-pressed": String(state.selectedDate === value),
      onclick: () => { state.selectedDate = value; renderAll(db); }
    }, label, count !== null && h("span", { class: "cnt" }, count));

  const picker = h("input", {
    type: "date",
    class: "datechip",
    title: "日付を選ぶ",
    value: state.selectedDate === ALL ? "" : state.selectedDate,
    onchange: (event) => {
      if (!event.target.value) return;
      state.selectedDate = event.target.value;
      $("#f-date").value = event.target.value;
      renderAll(db);
    }
  });

  $("#datebar").replaceChildren(
    chip(ALL, "すべて", state.items.length),
    ...dates.map((date) => chip(date, formatDate(date), counts.get(date))),
    picker
  );
}

// --- 入力フォーム ----------------------------------------------------------
/**
 * メンバーが増減しても、フォームの選択状態が破綻しないようにする。
 * 新しく増えたメンバーは自動でチェックが入るが、ユーザーが自分で外したチェックは戻さない。
 */
let knownMemberIds = null;

function syncFormWithMembers() {
  const ids = state.members.map((m) => m.id);
  const idSet = new Set(ids);

  if (form.editingId && !state.items.some((item) => item.id === form.editingId)) {
    resetForm(); // 編集中の項目が他の端末で消された
  } else if (knownMemberIds === null) {
    form.participants = new Set(ids); // 初期表示はデフォルトで全員にチェック
  } else if (!form.editingId) {
    for (const id of ids) if (!knownMemberIds.has(id)) form.participants.add(id);
    for (const id of [...form.participants]) if (!idSet.has(id)) form.participants.delete(id);
  }
  knownMemberIds = idSet;

  if (!form.singlePayerId || !idSet.has(form.singlePayerId)) {
    form.singlePayerId = ids[0] ?? null;
  }
}

function resetForm() {
  form.editingId = null;
  form.payMode = "single";
  form.splitMode = "equal";
  form.payerAmounts = {};
  form.shareAmounts = {};
  form.participants = new Set(state.members.map((m) => m.id));
  form.singlePayerId = state.members[0]?.id ?? null;
  $("#f-title").value = "";
  $("#f-amount").value = "";
  $("#f-date").value = state.selectedDate === ALL ? todayStr() : state.selectedDate;
  $("#form-error").hidden = true;
}

function paidTotal() {
  return form.payMode === "single"
    ? toInt($("#f-amount").value)
    : sum(form.payerAmounts);
}

function currentShares() {
  const ids = [...form.participants];
  if (form.splitMode === "equal") return splitEqually(paidTotal(), ids);
  return Object.fromEntries(ids.map((id) => [id, toInt(form.shareAmounts[id])]));
}

/** フォームを作り直す必要があるかどうかの判定に使う指紋。 */
let formSignature = "";
const formSig = () => JSON.stringify([
  state.members.map((m) => [m.id, m.name]),
  form.editingId, form.payMode, form.splitMode, [...form.participants].sort()
]);

function renderForm(db) {
  $("#form-title").textContent = form.editingId ? "項目を編集" : "項目を追加";
  $("#f-submit").textContent = form.editingId ? "保存する" : "追加する";
  $("#f-cancel").hidden = !form.editingId;

  // 支払いモード
  for (const button of $("#paymode").children) {
    button.setAttribute("aria-pressed", String(button.dataset.value === form.payMode));
  }
  $("#pay-single").hidden = form.payMode !== "single";
  $("#pay-multi").hidden = form.payMode !== "multi";

  // 立て替えた人（単独）
  $("#f-payer").replaceChildren(
    ...state.members.map((m) =>
      h("option", { value: m.id, selected: m.id === form.singlePayerId }, m.name))
  );

  // 立て替えた人（複数）
  $("#payer-rows").replaceChildren(
    ...state.members.map((m) =>
      h("div", { class: "prow" },
        h("label", {}, h("span", { class: "name" }, m.name)),
        h("input", {
          type: "number", min: "0", step: "1", inputMode: "numeric", placeholder: "0",
          value: form.payerAmounts[m.id] ?? "",
          oninput: (event) => {
            form.payerAmounts[m.id] = toInt(event.target.value);
            refreshTotals();
          }
        })))
  );

  // 分割モード
  for (const button of $("#splitmode").children) {
    button.setAttribute("aria-pressed", String(button.dataset.value === form.splitMode));
  }

  renderParticipantRows();
  refreshTotals();
}

function renderParticipantRows() {
  const shares = currentShares();
  const rows = state.members.map((m) => {
    const on = form.participants.has(m.id);
    return h("div", { class: `prow${on ? "" : " off"}`, dataset: { mid: m.id } },
      h("label", {},
        h("input", {
          type: "checkbox",
          checked: on,
          onchange: (event) => {
            if (event.target.checked) form.participants.add(m.id);
            else form.participants.delete(m.id);
            renderParticipantRows();
            refreshTotals();
          }
        }),
        h("span", { class: "name" }, m.name)),
      form.splitMode === "custom" && on
        ? h("input", {
            type: "number", min: "0", step: "1", inputMode: "numeric", placeholder: "0",
            value: form.shareAmounts[m.id] ?? "",
            oninput: (event) => {
              form.shareAmounts[m.id] = toInt(event.target.value);
              refreshTotals();
            }
          })
        : h("span", { class: "readonly-amount" }, on ? yen(shares[m.id] ?? 0) : "—"));
  });
  $("#participant-rows").replaceChildren(
    ...(rows.length ? rows : [h("p", { class: "empty" }, "先にメンバーを追加してください")])
  );
  formSignature = formSig();
}

function refreshTotals() {
  const total = paidTotal();
  const shares = currentShares();
  const shareSum = sum(shares);

  $("#pay-total").textContent = yen(total);
  $("#share-total").textContent = yen(shareSum);

  const warn = $("#share-warn");
  const diff = total - shareSum;
  if (form.splitMode === "custom" && total > 0 && diff !== 0) {
    warn.textContent = diff > 0
      ? `${yen(diff)} 足りません（支払い合計と負担合計を一致させてください）`
      : `${yen(-diff)} 多すぎます（支払い合計と負担合計を一致させてください）`;
    warn.hidden = false;
  } else {
    warn.hidden = true;
  }

  // 均等割の表示額は支払い合計に連動するので、行を作り直さずに文字だけ差し替える。
  for (const row of $("#participant-rows").querySelectorAll(".prow[data-mid]")) {
    const cell = row.querySelector(".readonly-amount");
    if (!cell) continue;
    const id = row.dataset.mid;
    cell.textContent = form.participants.has(id) ? yen(shares[id] ?? 0) : "—";
  }
}

function wireRoom(db) {
  $("#paymode").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-value]");
    if (!button) return;
    form.payMode = button.dataset.value;
    renderForm(db);
  });

  $("#splitmode").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-value]");
    if (!button) return;
    form.splitMode = button.dataset.value;
    if (form.splitMode === "custom" && Object.keys(form.shareAmounts).length === 0) {
      // 均等割の結果を初期値として引き継ぐと編集しやすい。
      Object.assign(form.shareAmounts, splitEqually(paidTotal(), [...form.participants]));
    }
    renderForm(db);
  });

  $("#f-payer").addEventListener("change", (event) => {
    form.singlePayerId = event.target.value;
  });
  $("#f-amount").addEventListener("input", refreshTotals);

  $("#p-all").addEventListener("click", () => {
    form.participants = new Set(state.members.map((m) => m.id));
    renderParticipantRows();
    refreshTotals();
  });
  $("#p-none").addEventListener("click", () => {
    form.participants.clear();
    renderParticipantRows();
    refreshTotals();
  });

  $("#f-cancel").addEventListener("click", () => { resetForm(); renderAll(db); });
  $("#item-form").addEventListener("submit", (event) => submitItem(event, db));

  $("#btn-leave").addEventListener("click", () => {
    local.clearUnlocked(state.roomId);
    leaveRoom();
  });
  $("#btn-members").addEventListener("click", () => $("#dlg-members").showModal());
  $("#btn-share").addEventListener("click", openShareDialog);

  document.querySelectorAll("dialog [data-close]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });

  $("#member-add-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#member-add-name");
    const name = input.value.trim();
    if (!name) return;
    input.value = "";
    await db.addMember(state.roomId, name, state.members.length);
  });

  $("#share-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#share-url").value);
      toast("URL をコピーしました");
    } catch {
      $("#share-url").select();
      toast("コピーできませんでした。手動で選択してください");
    }
  });

  $("#share-pass-save").addEventListener("click", async () => {
    const password = $("#share-pass").value.trim();
    if (!/^\d{4}$/.test(password)) { toast("4 桁の数字を入力してください"); return; }
    await db.changePassword(state.roomId, password);
    local.markUnlocked(state.roomId, await db.hashPassword(state.roomId, password));
    $("#share-pass").value = "";
    toast(`パスワードを ${password} に変更しました`);
  });
}

function openShareDialog() {
  $("#share-url").value =
    `${location.origin}${location.pathname}?room=${encodeURIComponent(state.roomId)}`;
  $("#dlg-share").showModal();
}

async function submitItem(event, db) {
  event.preventDefault();
  const error = $("#form-error");
  error.hidden = true;

  const title = $("#f-title").value.trim();
  const date = $("#f-date").value;
  const total = paidTotal();
  const shares = currentShares();

  const fail = (message) => {
    error.textContent = message;
    error.hidden = false;
  };

  if (!title) return fail("項目名を入力してください。");
  if (!date) return fail("日付を選んでください。");
  if (total <= 0) return fail("支払い金額を入力してください。");
  if (form.participants.size === 0) return fail("対象メンバーを 1 人以上選んでください。");

  let payers;
  if (form.payMode === "single") {
    if (!form.singlePayerId) return fail("立て替えた人を選んでください。");
    payers = { [form.singlePayerId]: total };
  } else {
    payers = Object.fromEntries(
      Object.entries(form.payerAmounts)
        .map(([id, amount]) => [id, toInt(amount)])
        .filter(([, amount]) => amount > 0)
    );
    if (Object.keys(payers).length === 0) return fail("支払った人の金額を入力してください。");
  }

  if (form.splitMode === "custom" && sum(shares) !== total) {
    return fail(`負担合計が支払い合計と一致しません（差額 ${yen(total - sum(shares))}）。`);
  }

  const payload = {
    title, date, amount: total, payers, shares,
    payMode: form.payMode, splitMode: form.splitMode
  };

  const button = event.submitter;
  const editingId = form.editingId;
  button.disabled = true;

  // 書き込みの完了を待ってから入力欄を戻すと、サーバーの応答が返るまでの間に
  // 打ち始めた次の入力が消えてしまう。送信した時点で空にし、失敗したときだけ知らせる。
  resetForm();
  $("#f-date").value = date;
  renderAll(db);
  $("#f-title").focus();

  try {
    if (editingId) await db.updateItem(state.roomId, editingId, payload);
    else await db.addItem(state.roomId, payload);
    toast(editingId ? "保存しました" : "追加しました");
  } catch (err) {
    fail(`保存できませんでした：${err.message}`);
  } finally {
    button.disabled = false;
  }
}

function startEdit(item, db) {
  form.editingId = item.id;
  form.payMode = item.payMode === "multi" ? "multi" : "single";
  form.splitMode = item.splitMode === "custom" ? "custom" : "equal";
  form.payerAmounts = { ...(item.payers || {}) };
  form.shareAmounts = { ...(item.shares || {}) };
  form.participants = new Set(Object.keys(item.shares || {}));
  form.singlePayerId = Object.keys(item.payers || {})[0] ?? state.members[0]?.id ?? null;

  $("#f-title").value = item.title;
  $("#f-date").value = item.date;
  $("#f-amount").value = form.payMode === "single" ? item.amount : "";

  renderAll(db);
  $("#item-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

// --- 項目一覧 --------------------------------------------------------------
function renderItems(db) {
  const items = visibleItems();
  $("#items-summary").textContent = items.length
    ? `${items.length}件 ・ 合計 ${yen(items.reduce((a, i) => a + i.amount, 0))}`
    : "";

  if (!items.length) {
    $("#item-list").replaceChildren(
      h("p", { class: "empty" },
        state.selectedDate === ALL ? "まだ項目がありません" : "この日の項目はありません"));
    return;
  }

  $("#item-list").replaceChildren(...items.map((item) => {
    const payerText = Object.entries(item.payers || {})
      .map(([id, amount]) => `${memberName(id)} ${yen(amount)}`)
      .join(" ・ ");

    const line = (label, amount) =>
      h("div", { class: "line" }, h("span", {}, label), h("span", {}, yen(amount)));

    return h("div", { class: `item${form.editingId === item.id ? " editing" : ""}` },
      h("div", { class: "item-head" },
        h("span", { class: "item-title" }, item.title),
        h("span", { class: "item-amount" }, yen(item.amount))),
      h("div", { class: "item-meta" },
        `${formatDate(item.date)} ・ 立て替え: ${payerText || "—"}`),
      h("details", { class: "item-detail-wrap" },
        h("summary", { class: "muted small" },
          `内訳（${Object.keys(item.shares || {}).length}人）`),
        h("div", { class: "item-detail" },
          h("div", { class: "line head" }, h("span", {}, "支払い"), h("span", {}, "")),
          ...Object.entries(item.payers || {}).map(([id, amount]) => line(memberName(id), amount)),
          h("div", { class: "line head" }, h("span", {}, "負担"), h("span", {}, "")),
          ...Object.entries(item.shares || {}).map(([id, amount]) => line(memberName(id), amount)))),
      h("div", { class: "item-actions" },
        h("button", { class: "icon", type: "button", onclick: () => startEdit(item, db) }, "編集"),
        h("button", {
          class: "icon danger", type: "button",
          onclick: async () => {
            if (!confirm(`「${item.title}」を削除しますか？`)) return;
            if (form.editingId === item.id) resetForm();
            await db.removeItem(state.roomId, item.id);
            toast("削除しました");
          }
        }, "削除")));
  }));
}

// --- 精算 ------------------------------------------------------------------
function renderSettlement() {
  const items = visibleItems();
  $("#settle-scope").textContent =
    state.selectedDate === ALL ? "全期間" : `${formatDate(state.selectedDate)} のみ`;

  const rows = computeBalances(items, state.members.map((m) => m.id));
  const ordered = state.members
    .map((m) => rows[m.id])
    .filter(Boolean)
    .concat(Object.values(rows).filter((r) => !state.members.some((m) => m.id === r.id)));

  if (!items.length) {
    $("#balance-list").replaceChildren(h("p", { class: "empty" }, "項目がありません"));
    $("#transfer-list").replaceChildren(h("p", { class: "empty" }, "—"));
    return;
  }

  $("#balance-list").replaceChildren(...ordered.map((row) => {
    const sign = row.balance > 0 ? "plus" : row.balance < 0 ? "minus" : "";
    const label = row.balance > 0 ? `+${yen(row.balance)}`
      : row.balance < 0 ? `-${yen(-row.balance)}` : yen(0);
    return h("div", { class: "bal" },
      h("span", { class: "who" }, memberName(row.id)),
      h("span", { class: `amt ${sign}` }, label),
      h("span", { class: "detail" }, `支払い ${yen(row.paid)} ・ 負担 ${yen(row.owed)}`));
  }));

  const transfers = settle(rows);
  $("#transfer-list").replaceChildren(
    ...(transfers.length
      ? transfers.map((tx) =>
          h("div", { class: "tx" },
            h("span", {}, memberName(tx.from)),
            h("span", { class: "arrow" }, "→"),
            h("span", {}, memberName(tx.to)),
            h("span", { class: "amt" }, yen(tx.amount))))
      : [h("p", { class: "empty" }, "精算は完了しています 🎉")])
  );
}

// --- メンバー管理 ----------------------------------------------------------
function renderMemberAdmin(db) {
  const usedIds = new Set();
  for (const item of state.items) {
    Object.keys(item.payers || {}).forEach((id) => usedIds.add(id));
    Object.keys(item.shares || {}).forEach((id) => usedIds.add(id));
  }

  $("#member-admin-list").replaceChildren(
    ...(state.members.length
      ? state.members.map((m) =>
          h("div", { class: "prow" },
            h("input", {
              type: "text", value: m.name, maxLength: 40,
              onchange: async (event) => {
                const name = event.target.value.trim();
                if (!name) { event.target.value = m.name; return; }
                await db.renameMember(state.roomId, m.id, name);
              }
            }),
            h("button", {
              class: "icon danger", type: "button",
              onclick: async () => {
                const warning = usedIds.has(m.id)
                  ? `${m.name} さんは既存の項目に含まれています。削除すると、その項目の内訳には名前が残らなくなります。\n削除しますか？`
                  : `${m.name} さんを削除しますか？`;
                if (!confirm(warning)) return;
                await db.removeMember(state.roomId, m.id);
              }
            }, "削除")))
      : [h("p", { class: "empty" }, "メンバーがいません")])
  );
}
