// Express 진입점: 정적 프론트(public) 서빙 + API + 매일 아침 cron 기동.
import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";

import webhooksRouter from "./routes/webhooks.js";
import summaryRouter from "./routes/summary.js";
import eventsRouter from "./routes/events.js";
import { applySchedule } from "./services/dailyJob.js";
import { isLlmConfigured } from "./services/llm.js";
import { getSchedule } from "./store/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.json({ limit: "2mb" }));

// API
app.use("/api/webhooks", webhooksRouter);
app.use("/api/summary", summaryRouter);
app.use("/api/events", eventsRouter);

app.get("/api/status", async (_req, res, next) => {
  try {
    res.json({
      ok: true,
      llmConfigured: isLlmConfigured(),
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
      schedule: await getSchedule(),
    });
  } catch (e) {
    next(e);
  }
});

// 정적 프론트
app.use(express.static(PUBLIC_DIR));

// 공통 에러 핸들러 (라우트에서 next(e) 로 넘어온 것 처리)
app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  res.status(500).json({ error: err.message || "내부 오류" });
});

const server = app.listen(PORT, async () => {
  console.log(`larkbot 서버 기동: http://localhost:${PORT}`);
  console.log(`  · LLM 설정됨: ${isLlmConfigured() ? "예" : "아니오(요약/파싱 비활성)"}`);
  try {
    await applySchedule(); // 저장된 스케줄로 cron 등록
  } catch (e) {
    console.error("[cron] 초기 스케줄 등록 실패:", e.message);
  }
});

// 종료 시그널에서 깔끔히 닫기
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`\n${sig} 수신 → 서버 종료`);
    server.close(() => process.exit(0));
  });
}

export default app;
