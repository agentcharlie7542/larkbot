// 기능 A: 대화 요약 + 업무 정리 → 지정 웹훅 발송
import { Router } from "express";
import { summarizeConversation, isLlmConfigured } from "../services/llm.js";
import { getWebhook } from "../store/store.js";
import { sendToWebhook } from "../services/lark.js";

const router = Router();

// POST /api/summary/run  body: { webhookId?, rawText }
//  · rawText: 붙여넣은 대화 원문 (현재 1차 경로). Lark API 직접 수집은 후순위.
//  · webhookId 가 있으면 요약 결과를 해당 웹훅으로 발송, 없으면 요약만 반환(미리보기).
router.post("/run", async (req, res, next) => {
  try {
    if (!isLlmConfigured()) {
      return res.status(400).json({ error: "ANTHROPIC_API_KEY 가 설정되지 않아 요약을 수행할 수 없습니다." });
    }
    const { webhookId, rawText } = req.body || {};
    if (!rawText || !String(rawText).trim()) {
      return res.status(400).json({ error: "rawText(대화 원문)가 필요합니다. 관리 페이지에서 대화를 붙여넣어 주세요." });
    }

    const summary = await summarizeConversation(String(rawText));

    let sent = false;
    let larkResponse = null;
    let webhookName = null;
    if (webhookId) {
      const hook = await getWebhook(webhookId);
      if (!hook) return res.status(404).json({ error: "지정한 웹훅을 찾을 수 없습니다.", summary });
      webhookName = hook.name;
      larkResponse = await sendToWebhook(hook.webhookUrl, `📊 주간 대화 요약 — ${hook.name}\n\n${summary}`);
      sent = larkResponse.ok;
    }

    res.json({ summary, sent, webhook: webhookName, larkResponse });
  } catch (e) {
    next(e);
  }
});

export default router;
