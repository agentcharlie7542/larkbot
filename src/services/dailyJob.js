// 매일 아침 cron 발송 + 일일 이벤트 메시지 빌더.
import cron from "node-cron";
import { readEvents, getSchedule, getWebhook } from "../store/store.js";
import { sendToWebhook } from "./lark.js";
import { eventsForDate, todayInTz, addDays, jpWeekday } from "./eventsUtil.js";

// 이벤트 한 줄 포맷 (일본어 운영용)
function formatLine(ev) {
  let prefix = "";
  if (ev.type === "category") prefix = ev.ongoing ? "[継続] " : "[開始] ";
  const detail = ev.detail ? ` ${ev.detail}` : "";
  const period = ev.period ? `  ※${ev.period}` : "";
  return `・${prefix}${ev.title}${detail}${period}`.trimEnd();
}

// 특정 날짜의 발송 메시지 텍스트 생성. count=0 이면 "발행 없음" 안내.
export function buildDailyMessage(allEvents, dateIso, { bilingual = false, emptyLabel = "本日" } = {}) {
  const evs = eventsForDate(allEvents, dateIso);
  const header = `【Qoo10 イベント案内】${dateIso} (${jpWeekday(dateIso)})`;
  const body = evs.length
    ? evs.map(formatLine)
    : [`・${emptyLabel}発行のクーポンはありません。`];

  let text = [header, ...body].join("\n");
  if (bilingual) {
    text = `🇰🇷 ${dateIso} 큐텐 이벤트 안내\n${text}`;
  }
  return { text, count: evs.length, dateIso };
}

// 스케줄 설정에 따라 발송 대상 날짜("YYYY-MM-DD") 결정
export function resolveTargetDate(schedule) {
  const today = todayInTz(schedule.timezone);
  return schedule.sendTarget === "today" ? today : addDays(today, 1);
}

// 미리보기: 발송 없이 대상 날짜의 메시지만 반환. dateIso 를 주면 그 날짜로.
export async function previewSend(dateIso) {
  const schedule = await getSchedule();
  const { events } = await readEvents();
  const target = dateIso || resolveTargetDate(schedule);
  const emptyLabel = schedule.sendTarget === "today" && !dateIso ? "本日" : "当日";
  const built = buildDailyMessage(events, target, { bilingual: schedule.bilingual, emptyLabel });
  return { ...built, schedule };
}

// 실제 발송. force=true 면 sendWhenEmpty 무시하고 강제 발송(수동 트리거용).
export async function runDailyJob({ force = false } = {}) {
  const schedule = await getSchedule();
  const { events } = await readEvents();
  const dateIso = resolveTargetDate(schedule);
  const emptyLabel = schedule.sendTarget === "today" ? "本日" : "翌日";
  const { text, count } = buildDailyMessage(events, dateIso, { bilingual: schedule.bilingual, emptyLabel });

  if (count === 0 && !schedule.sendWhenEmpty && !force) {
    return { sent: false, reason: "이벤트 없음 + sendWhenEmpty=false", dateIso, count, text };
  }
  if (!schedule.targetWebhookId) {
    return { sent: false, reason: "발송 대상 웹훅 미설정(targetWebhookId)", dateIso, count, text };
  }
  const hook = await getWebhook(schedule.targetWebhookId);
  if (!hook) {
    return { sent: false, reason: "대상 웹훅을 찾을 수 없음", dateIso, count, text };
  }
  const res = await sendToWebhook(hook.webhookUrl, text);
  return { sent: res.ok, dateIso, count, text, webhook: hook.name, larkResponse: res };
}

// ── cron 관리 ─────────────────────────────────────────────
let task = null;

// 현재 저장된 스케줄로 cron 작업을 (재)등록. 설정 변경 시마다 호출.
export async function applySchedule() {
  if (task) {
    task.stop();
    task = null;
  }
  const schedule = await getSchedule();
  if (!cron.validate(schedule.cron)) {
    console.warn(`[cron] 잘못된 cron 식 "${schedule.cron}" → 스케줄 미등록`);
    return null;
  }
  task = cron.schedule(
    schedule.cron,
    () => {
      runDailyJob()
        .then((r) =>
          console.log(`[cron] 일일 발송 결과:`, JSON.stringify({ sent: r.sent, dateIso: r.dateIso, count: r.count, reason: r.reason })),
        )
        .catch((e) => console.error("[cron] 발송 중 오류:", e));
    },
    { timezone: schedule.timezone },
  );
  console.log(`[cron] 등록됨: "${schedule.cron}" (${schedule.timezone}), target=${schedule.sendTarget}`);
  return schedule;
}
