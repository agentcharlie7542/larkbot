// 날짜 계산 + 이벤트 선택/전개 유틸.
//
// 저장 규약 (data/events.json):
//   · MEGAPO·카트쿠폰 등 일일 쿠폰  → 적용 날짜마다 한 항목씩(이미 전개됨)
//   · 카테고리 캠페인(type:"category") → 시작일 한 항목에만 두고 period 로 기간 표기.
//     기간 내 모든 날짜로의 전개는 "선택 시점"에 코드가 처리(eventsForDate).

// "YYYY-MM-DD" → Date(UTC 자정). 날짜 전용 계산이므로 UTC 로 고정.
function isoToUTC(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function utcToIso(date) {
  return date.toISOString().slice(0, 10);
}
export function addDays(iso, n) {
  const d = isoToUTC(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return utcToIso(d);
}

// 지정 타임존 기준 오늘 날짜 "YYYY-MM-DD"
export function todayInTz(tz) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA 로케일은 YYYY-MM-DD 형태를 반환
  return fmt.format(new Date());
}

// 요일 라벨(일본어 운영 메시지용): 月火水木金土日
const JP_WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];
export function jpWeekday(iso) {
  return JP_WEEKDAY[isoToUTC(iso).getUTCDay()];
}

// period 문자열에서 종료일 추출 → [start, end] ISO. anchorIso 는 해당 이벤트가 저장된 날짜(=시작일).
// 예) "7/13~8/23", "7/1 00:00~7/3 23:59". 연도는 anchor 에서 가져오고, 종료 월<시작 월이면 +1년.
export function parsePeriodToRange(period, anchorIso) {
  if (!anchorIso) return null;
  const start = anchorIso;
  if (!period) return { start, end: start };

  // "~" 또는 "-" 기준 분리 후, 종료 쪽에서 M/D 추출
  const parts = String(period).split(/[~〜\-]/);
  const endPart = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  const md = endPart.match(/(\d{1,2})\s*[\/月]\s*(\d{1,2})/);
  if (!md) return { start, end: start };

  const endMonth = Number(md[1]);
  const endDay = Number(md[2]);
  const [sy, sm] = start.split("-").map(Number);
  const year = endMonth < sm ? sy + 1 : sy; // 연말 걸침 보정
  const end = `${year}-${String(endMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
  return { start, end };
}

// 특정 날짜(dateIso)에 활성인 이벤트 목록.
//  · 일반 이벤트: event.date === dateIso
//  · 카테고리 캠페인: period 기간이 dateIso 를 포함하면 포함 (계속 진행 표시)
export function eventsForDate(allEvents, dateIso) {
  const out = [];
  for (const ev of allEvents || []) {
    if (ev.type === "category") {
      const range = parsePeriodToRange(ev.period, ev.date);
      if (range && dateIso >= range.start && dateIso <= range.end) {
        // 시작일이 아니면 "계속 진행" 표시를 위해 ongoing 플래그를 붙여 반환
        out.push({ ...ev, ongoing: dateIso !== range.start });
      }
    } else if (ev.date === dateIso) {
      out.push(ev);
    }
  }
  return out;
}

// from~to(포함) 범위에 활성인 이벤트들을 날짜별로 묶어 반환: [{ date, events: [...] }]
export function eventsInRange(allEvents, fromIso, toIso) {
  const days = [];
  let cur = fromIso;
  // 안전장치: 최대 400일
  for (let i = 0; i < 400 && cur <= toIso; i++) {
    days.push({ date: cur, events: eventsForDate(allEvents, cur) });
    cur = addDays(cur, 1);
  }
  return days;
}
