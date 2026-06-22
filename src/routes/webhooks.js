// 웹훅(정보 방) 등록/목록/삭제/테스트 발송
import { Router } from "express";
import { getWebhooks, addWebhook, deleteWebhook, getWebhook } from "../store/store.js";
import { testWebhook } from "../services/lark.js";

const router = Router();

router.get("/", async (_req, res, next) => {
  try {
    res.json({ webhooks: await getWebhooks() });
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { name, webhookUrl, sourceChannelId } = req.body || {};
    if (!name || !webhookUrl) {
      return res.status(400).json({ error: "name, webhookUrl 은 필수입니다." });
    }
    const hook = await addWebhook({ name, webhookUrl, sourceChannelId });
    res.status(201).json({ webhook: hook });
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const ok = await deleteWebhook(req.params.id);
    if (!ok) return res.status(404).json({ error: "해당 웹훅을 찾을 수 없습니다." });
    res.json({ deleted: true });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/test", async (req, res, next) => {
  try {
    const hook = await getWebhook(req.params.id);
    if (!hook) return res.status(404).json({ error: "해당 웹훅을 찾을 수 없습니다." });
    const result = await testWebhook(hook.webhookUrl);
    res.status(result.ok ? 200 : 502).json({ ...result, webhook: hook.name });
  } catch (e) {
    next(e);
  }
});

export default router;
