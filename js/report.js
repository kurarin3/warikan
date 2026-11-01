// 精算結果を LINE などに貼り付けるためのテキストレポート。
// スマホの吹き出しで折り返さないよう、1 行を短く保つ。表や桁揃えは
// プロポーショナルフォントで崩れるので使わない。
import { computeBalances, settle, yen } from "./calc.js";
import { formatDate } from "./date.js";

/** 1 行の幅の目安（全角換算）。 */
const MAX_WIDTH = 16;
const INDENT = "　";

/** 全角を 1、半角を 0.5 として数えた表示幅。 */
const width = (s) =>
  [...s].reduce((w, ch) => w + (/[\x20-\x7e｡-ﾟ]/.test(ch) ? 0.5 : 1), 0);

const signed = (n) => (n > 0 ? `+${yen(n)}` : n < 0 ? `-${yen(-n)}` : yen(0));

/** 名前の並びを「、」でつなぎ、幅に収まるように折り返す。 */
function wrapNames(names, indent) {
  const lines = [];
  let line = "";
  for (const name of names) {
    const next = line ? `${line}、${name}` : name;
    if (line && width(indent + next) > MAX_WIDTH) {
      lines.push(`${indent}${line}、`);
      line = name;
    } else {
      line = next;
    }
  }
  if (line) lines.push(indent + line);
  return lines;
}

/** 見出しと金額を 1 行にし、収まらなければ金額を次の行に送る。 */
function headWithAmount(head, amount) {
  const line = `${head} ${yen(amount)}`;
  return width(line) <= MAX_WIDTH ? [line] : [head, `${INDENT}${yen(amount)}`];
}

/**
 * @param {object} p
 * @param {string} p.roomName
 * @param {string} p.scopeLabel  "全期間" や "11/1(土)" など
 * @param {boolean} p.singleDate 1 日分だけのときは日付ごとの見出しを省く
 * @param {{id: string, name: string}[]} p.members 表示順に並んだメンバー
 * @param {object[]} p.items
 * @param {object[]} p.payments
 * @param {string} [p.url]
 */
export function buildReport({ roomName, scopeLabel, singleDate, members, items, payments, url }) {
  const order = new Map(members.map((m, i) => [m.id, i]));
  const name = (id) => members.find((m) => m.id === id)?.name ?? "(削除済み)";
  const byMemberOrder = (ids) =>
    [...ids].sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity));

  const out = [];
  const total = items.reduce((a, item) => a + item.amount, 0);
  out.push(`【${roomName}】`);
  out.push(`${scopeLabel}・${members.length}人`);
  out.push(`合計 ${yen(total)}（${items.length}件）`);

  // --- 項目 ---
  if (items.length) {
    out.push("", "■項目");
    const sorted = [...items].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt ?? 0) - (b.createdAt ?? 0));
    let lastDate = null;
    for (const item of sorted) {
      if (!singleDate && item.date !== lastDate) {
        out.push(`［${formatDate(item.date)}］`);
        lastDate = item.date;
      }
      out.push(...headWithAmount(`・${item.title}`, item.amount));

      const payers = Object.entries(item.payers || {});
      const change = Object.entries(item.change || {});
      if (payers.length === 1 && change.length === 0) {
        out.push(`${INDENT}立替 ${name(payers[0][0])}`);
      } else {
        for (const [id, amount] of payers) out.push(`${INDENT}立替 ${name(id)} ${yen(amount)}`);
      }
      for (const [id, amount] of change) out.push(`${INDENT}おつり ${name(id)} ${yen(amount)}`);

      const shareIds = byMemberOrder(Object.keys(item.shares || {}));
      const amounts = shareIds.map((id) => item.shares[id]);
      const allEqual = amounts.every((a) => a === amounts[0]);
      const everyone = shareIds.length === members.length &&
        members.every((m) => m.id in (item.shares || {}));
      if (allEqual) {
        const who = everyone ? "全員" : `${shareIds.length}人`;
        out.push(`${INDENT}負担 ${who} 各${yen(amounts[0] ?? 0)}`);
        if (!everyone) out.push(...wrapNames(shareIds.map(name), INDENT + INDENT));
      } else {
        out.push(`${INDENT}負担`);
        for (const id of shareIds) out.push(`${INDENT}${INDENT}${name(id)} ${yen(item.shares[id])}`);
      }
    }
  }

  // --- 収支 ---
  const rows = computeBalances(items, members.map((m) => m.id), payments);
  out.push("", "■収支（+は受け取る）");
  for (const id of byMemberOrder(Object.keys(rows))) {
    const row = rows[id];
    out.push(`${name(id)} ${signed(row.balance)}`);
    out.push(`${INDENT}立替${yen(row.paid)} 負担${yen(row.owed)}`);
    if (row.change) out.push(`${INDENT}おつり受取${yen(row.change)}`);
    const settled = [
      row.sentBack ? `送金済${yen(row.sentBack)}` : "",
      row.receivedBack ? `受取済${yen(row.receivedBack)}` : ""
    ].filter(Boolean);
    if (settled.length) out.push(`${INDENT}${settled.join(" ")}`);
  }

  // --- 送金 ---
  const transfers = settle(rows);
  out.push("", "■送金");
  if (transfers.length) {
    for (const tx of transfers) out.push(`${name(tx.from)}→${name(tx.to)} ${yen(tx.amount)}`);
    if (payments.length) {
      out.push("", "■送金済み");
      const sortedPayments = [...payments].sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt ?? 0) - (b.createdAt ?? 0));
      for (const p of sortedPayments) out.push(`${name(p.from)}→${name(p.to)} ${yen(p.amount)}`);
    }
  } else {
    out.push(payments.length ? "✅ 精算完了" : "精算の必要はありません");
  }

  if (url) out.push("", "詳細はこちら", url);
  return out.join("\n");
}
