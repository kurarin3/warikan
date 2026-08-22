// 金額計算まわり。すべて「円」= 整数で扱う。

/** 端数は先頭のメンバーから 1 円ずつ配分して、合計が total に一致するようにする。 */
export function splitEqually(total, memberIds) {
  const out = {};
  const n = memberIds.length;
  if (n === 0) return out;
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / n);
  const rem = abs - base * n;
  memberIds.forEach((id, i) => {
    out[id] = sign * (base + (i < rem ? 1 : 0));
  });
  return out;
}

/**
 * 項目と精算送金から、メンバーごとの収支を集計する。
 *
 *   balance = 立て替えた額 - 負担すべき額 + 精算で渡した額 - 精算で受け取った額
 *
 * balance が 0 なら、そのメンバーの精算は済んでいる。
 */
export function computeBalances(items, memberIds, payments = []) {
  const ids = new Set(memberIds);
  for (const item of items) {
    Object.keys(item.payers || {}).forEach((id) => ids.add(id));
    Object.keys(item.shares || {}).forEach((id) => ids.add(id));
  }
  for (const payment of payments) {
    ids.add(payment.from);
    ids.add(payment.to);
  }

  const rows = {};
  for (const id of ids) {
    rows[id] = { id, paid: 0, owed: 0, sentBack: 0, receivedBack: 0, balance: 0 };
  }

  for (const item of items) {
    for (const [id, amt] of Object.entries(item.payers || {})) rows[id].paid += amt;
    for (const [id, amt] of Object.entries(item.shares || {})) rows[id].owed += amt;
  }
  for (const payment of payments) {
    rows[payment.from].sentBack += payment.amount;
    rows[payment.to].receivedBack += payment.amount;
  }

  for (const row of Object.values(rows)) {
    row.balance = row.paid - row.owed + row.sentBack - row.receivedBack;
  }
  return rows;
}

/**
 * 差引から送金案を作る。多く払った人（貸し）と払い足りない人（借り）を
 * 大きい順に突き合わせるので、送金回数はほぼ最小になる。
 */
export function settle(balanceRows) {
  const creditors = [];
  const debtors = [];
  for (const row of Object.values(balanceRows)) {
    if (row.balance > 0) creditors.push({ id: row.id, amount: row.balance });
    else if (row.balance < 0) debtors.push({ id: row.id, amount: -row.balance });
  }
  creditors.sort((a, b) => b.amount - a.amount || (a.id < b.id ? -1 : 1));
  debtors.sort((a, b) => b.amount - a.amount || (a.id < b.id ? -1 : 1));

  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    if (amount > 0) {
      transfers.push({ from: debtors[i].id, to: creditors[j].id, amount });
    }
    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (debtors[i].amount === 0) i += 1;
    if (creditors[j].amount === 0) j += 1;
  }
  return transfers;
}

export const sum = (obj) =>
  Object.values(obj || {}).reduce((a, b) => a + (Number(b) || 0), 0);

export const yen = (n) => `¥${Math.round(n).toLocaleString("ja-JP")}`;
