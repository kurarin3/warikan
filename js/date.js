// 日付まわり。日付は "YYYY-MM-DD" の文字列で扱う。

/**
 * この時刻より前は前日として扱う。飲み会が日付をまたいでも、
 * 同じ日の項目としてまとまるようにするため。
 */
export const DAY_START_HOUR = 6;

/** 「今日」の日付。0:00〜5:59 は前日になる。 */
export function todayStr(now = new Date()) {
  const d = new Date(now);
  d.setHours(d.getHours() - DAY_START_HOUR);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
export function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${wd})`;
}
