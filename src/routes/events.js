// 기능 B: 이벤트 스케줄 — 이미지 파싱/확정, 기간 조회, 스케줄 설정, 미리보기/즉시발송
import { Router } from "express";
import multer from "multer";
import { parseScheduleImage } from "../services/scheduleParser.js";
import { readEvents, writeEvents, getSchedule, setSchedule } from "../store/store.js";
import { eventsInRange } from "../services/eventsUtil.js";
import { previewSend, runDailyJob, applySchedule } from "../services/dailyJob.js";
import { isLlmConfigured } from "../services/llm.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12MB
});

// 현재 저장된 이벤트 전체
router.get("/", async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const data = await readEvents();
    if (from && to) {
      return res.json({ source: data.source, note: data.note, range: { from, to }, days: eventsInRange(data.events, String(from), String(to)) });
    }
    res.json(data);
  } catch (e) {
    next(e);
  }
});

// 이미지 업로드 → 파싱 결과 반환 (저장은 confirm 에서)
router.post("/parse", upload.single("image"), async (req, res, next) => {
  try {
    if (!isLlmConfigured()) {
      return res.status(400).json({ error: "ANTHROPIC_API_KEY 가 설정되지 않아 이미지 파싱을 수행할 수 없습니다." });
    }
    if (!req.file) return res.status(400).json({ error: "image 파일이 필요합니다 (multipart/form-data, 필드명 'image')." });
    const mediaType = req.file.mimetype || "image/png";
    const base64 = req.file.buffer.toString("base64");
    const parsed = await parseScheduleImage(base64, mediaType);
    res.json(parsed);
  } catch (e) {
    next(e);
  }
});

// 파싱·수정 완료된 이벤트 확정 저장
router.post("/confirm", async (req, res, next) => {
  try {
    const { events, source = "", note = "" } = req.body || {};
    if (!Array.isArray(events)) return res.status(400).json({ error: "events(배열)가 필요합니다." });
    const saved = await writeEvents({ source, events, note });
    res.json({ saved: true, count: saved.events.length });
  } catch (e) {
    next(e);
  }
});

// 일일 발송 메시지 미리보기 (실발송 X). ?date=YYYY-MM-DD 로 특정 날짜 지정 가능.
router.post("/preview-send", async (req, res, next) => {
  try {
    const dateIso = (req.body && req.body.date) || undefined;
    const result = await previewSend(dateIso);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// 즉시 발송 (수동 트리거). force=true 면 이벤트 없어도 발송.
router.post("/send-now", async (req, res, next) => {
  try {
    const force = Boolean(req.body && req.body.force);
    const result = await runDailyJob({ force });
    res.status(result.sent ? 200 : 200).json(result);
  } catch (e) {
    next(e);
  }
});

// 스케줄 설정 조회/변경
router.get("/schedule", async (_req, res, next) => {
  try {
    res.json({ schedule: await getSchedule() });
  } catch (e) {
    next(e);
  }
});

router.put("/schedule", async (req, res, next) => {
  try {
    const allowed = ["cron", "timezone", "targetWebhookId", "sendTarget", "sendWhenEmpty", "bilingual"];
    const patch = {};
    for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
    const schedule = await setSchedule(patch);
    await applySchedule(); // cron 재등록
    res.json({ schedule });
  } catch (e) {
    next(e);
  }
});

export default router;
