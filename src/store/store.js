// 파일 기반 저장소 — data/config.json (웹훅·스케줄 설정), data/events.json (파싱된 이벤트).
// 추후 SQLite 전환 여지를 남기기 위해 모든 접근을 이 모듈 함수로만 한다.
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const EVENTS_FILE = path.join(DATA_DIR, "events.json");

// .env 기반 스케줄 기본값 (config.json에 값이 없을 때만 사용)
function scheduleDefaults() {
  return {
    cron: process.env.DAILY_SEND_CRON || "0 8 * * *",
    timezone: process.env.DEFAULT_TZ || "Asia/Tokyo",
    targetWebhookId: null, // 어느 웹훅으로 일일 이벤트를 보낼지 (없으면 발송 스킵)
    sendTarget: process.env.SEND_TARGET === "today" ? "today" : "tomorrow",
    sendWhenEmpty: process.env.SEND_WHEN_EMPTY !== "false",
    bilingual: process.env.SEND_BILINGUAL === "true", // 일본어 + 한국어 병기
  };
}

const DEFAULT_CONFIG = () => ({ webhooks: [], schedule: scheduleDefaults() });
const DEFAULT_EVENTS = () => ({ source: "", events: [], note: "" });

async function ensureDataDir() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
}

async function readJson(file, fallbackFactory) {
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return fallbackFactory();
    throw new Error(`${path.basename(file)} 파싱 실패: ${err.message}`);
  }
}

// 같은 디렉토리에 임시 파일로 쓴 뒤 rename → 부분 기록(반쪽 파일) 방지
async function writeJsonAtomic(file, data) {
  await ensureDataDir();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, file);
}

// ── Config ────────────────────────────────────────────────
export async function readConfig() {
  const cfg = await readJson(CONFIG_FILE, DEFAULT_CONFIG);
  if (!Array.isArray(cfg.webhooks)) cfg.webhooks = [];
  cfg.schedule = { ...scheduleDefaults(), ...(cfg.schedule || {}) };
  return cfg;
}

export async function writeConfig(cfg) {
  await writeJsonAtomic(CONFIG_FILE, cfg);
  return cfg;
}

export async function getWebhooks() {
  return (await readConfig()).webhooks;
}

export async function getWebhook(id) {
  return (await getWebhooks()).find((w) => w.id === id) || null;
}

export async function addWebhook({ name, webhookUrl, sourceChannelId = "" }) {
  if (!name || !webhookUrl) throw new Error("name, webhookUrl 은 필수입니다.");
  const cfg = await readConfig();
  const hook = {
    id: randomUUID(),
    name: String(name).trim(),
    webhookUrl: String(webhookUrl).trim(),
    sourceChannelId: String(sourceChannelId || "").trim(),
    createdAt: new Date().toISOString(),
  };
  cfg.webhooks.push(hook);
  await writeConfig(cfg);
  return hook;
}

export async function deleteWebhook(id) {
  const cfg = await readConfig();
  const before = cfg.webhooks.length;
  cfg.webhooks = cfg.webhooks.filter((w) => w.id !== id);
  // 삭제된 웹훅이 일일 발송 대상이었다면 대상 해제
  if (cfg.schedule.targetWebhookId === id) cfg.schedule.targetWebhookId = null;
  await writeConfig(cfg);
  return before !== cfg.webhooks.length;
}

export async function getSchedule() {
  return (await readConfig()).schedule;
}

export async function setSchedule(patch) {
  const cfg = await readConfig();
  cfg.schedule = { ...cfg.schedule, ...patch };
  await writeConfig(cfg);
  return cfg.schedule;
}

// ── Events ────────────────────────────────────────────────
export async function readEvents() {
  const ev = await readJson(EVENTS_FILE, DEFAULT_EVENTS);
  if (!Array.isArray(ev.events)) ev.events = [];
  return ev;
}

export async function writeEvents({ source = "", events = [], note = "" }) {
  if (!Array.isArray(events)) throw new Error("events 는 배열이어야 합니다.");
  await writeJsonAtomic(EVENTS_FILE, { source, events, note });
  return { source, events, note };
}

export { DATA_DIR, CONFIG_FILE, EVENTS_FILE };
