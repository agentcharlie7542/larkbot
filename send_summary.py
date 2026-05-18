"""
Daily Slack -> Lark summary script.

1. Read the past 24 hours of messages from every Slack channel the configured
   token can see (works with both bot xoxb- and user xoxp- tokens).
2. Summarize the activity in Korean using the Anthropic Claude API.
3. Push the formatted summary to a Lark group via the incoming webhook.

Environment variables (set as GitHub Actions secrets):
  - SLACK_TOKEN           Slack bot or user token (xoxb-... or xoxp-...)
  - ANTHROPIC_API_KEY     Anthropic API key (sk-ant-...)
  - LARK_WEBHOOK_URL      Lark custom-bot incoming webhook
  - ANTHROPIC_MODEL       (optional) override; defaults to claude-sonnet-4-6
  - SLACK_CHANNEL_TYPES   (optional) comma list, default "public_channel,private_channel"
  - INCLUDE_BOT_MESSAGES  (optional) "true" to keep bot messages; default false
  - LOOKBACK_HOURS        (optional) int, default 24
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import requests

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SLACK_TOKEN = os.environ["SLACK_TOKEN"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
LARK_WEBHOOK_URL = os.environ["LARK_WEBHOOK_URL"]

ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")
CHANNEL_TYPES = os.environ.get(
    "SLACK_CHANNEL_TYPES", "public_channel,private_channel"
)
INCLUDE_BOT_MESSAGES = os.environ.get("INCLUDE_BOT_MESSAGES", "false").lower() == "true"
LOOKBACK_HOURS = int(os.environ.get("LOOKBACK_HOURS", "24"))

KST = timezone(timedelta(hours=9))
NOW = datetime.now(KST)
SINCE = NOW - timedelta(hours=LOOKBACK_HOURS)
SINCE_TS = SINCE.timestamp()

SLACK_API = "https://slack.com/api"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"

slack = requests.Session()
slack.headers.update({"Authorization": f"Bearer {SLACK_TOKEN}"})


# ---------------------------------------------------------------------------
# Slack helpers
# ---------------------------------------------------------------------------
def slack_call(path: str, params: dict | None = None) -> dict:
    """GET a Slack web API endpoint and handle the 429 retry header."""
    for attempt in range(5):
        resp = slack.get(f"{SLACK_API}/{path}", params=params, timeout=30)
        if resp.status_code == 429:
            wait = int(resp.headers.get("Retry-After", "2"))
            print(f"  rate-limited on {path}, sleeping {wait}s")
            time.sleep(wait + 1)
            continue
        resp.raise_for_status()
        data = resp.json()
        if not data.get("ok"):
            err = data.get("error")
            if err in {"ratelimited"}:
                time.sleep(2)
                continue
            raise RuntimeError(f"Slack API error on {path}: {err}")
        return data
    raise RuntimeError(f"Slack API repeatedly failed on {path}")


def list_accessible_channels() -> list[dict]:
    """Return channels the token can actually read history from."""
    channels: list[dict] = []
    cursor: str | None = None
    while True:
        params = {
            "exclude_archived": "true",
            "limit": 200,
            "types": CHANNEL_TYPES,
        }
        if cursor:
            params["cursor"] = cursor
        data = slack_call("conversations.list", params=params)
        for ch in data.get("channels", []):
            # Bot tokens need is_member; user tokens generally include all visible.
            if SLACK_TOKEN.startswith("xoxb-") and not ch.get("is_member"):
                continue
            channels.append(ch)
        cursor = data.get("response_metadata", {}).get("next_cursor")
        if not cursor:
            break
    return channels


def fetch_channel_history(channel_id: str) -> list[dict]:
    """Return all messages newer than SINCE_TS for the given channel."""
    messages: list[dict] = []
    cursor: str | None = None
    while True:
        params = {
            "channel": channel_id,
            "oldest": f"{SINCE_TS:.6f}",
            "limit": 200,
        }
        if cursor:
            params["cursor"] = cursor
        try:
            data = slack_call("conversations.history", params=params)
        except RuntimeError as exc:
            print(f"  skipping {channel_id}: {exc}")
            return []
        batch = data.get("messages", [])
        messages.extend(batch)
        if not data.get("has_more"):
            break
        cursor = data.get("response_metadata", {}).get("next_cursor")
        if not cursor:
            break
        time.sleep(1.1)  # be polite to Slack's rate limits
    return messages


# ---------------------------------------------------------------------------
# Activity collection
# ---------------------------------------------------------------------------
def keep_message(m: dict) -> bool:
    if m.get("subtype") in {"channel_join", "channel_leave"}:
        return False
    if not INCLUDE_BOT_MESSAGES and (m.get("bot_id") or m.get("subtype") == "bot_message"):
        return False
    if not (m.get("text") or "").strip():
        return False
    return float(m.get("ts", 0)) >= SINCE_TS


def collect_activity() -> list[dict]:
    channels = list_accessible_channels()
    print(f"채널 {len(channels)}개 점검 중 (지난 {LOOKBACK_HOURS}시간)…")
    activity: list[dict] = []
    for ch in channels:
        cid, name = ch["id"], ch.get("name", ch["id"])
        msgs = fetch_channel_history(cid)
        msgs = [m for m in msgs if keep_message(m)]
        if not msgs:
            continue
        msgs.sort(key=lambda m: float(m.get("ts", 0)))
        activity.append({"channel": f"#{name}", "messages": msgs})
        print(f"  #{name}: {len(msgs)}건")
        time.sleep(0.3)
    return activity


def render_for_llm(activity: list[dict]) -> str:
    blocks: list[str] = []
    for entry in activity:
        block = [f"=== {entry['channel']} ==="]
        for m in entry["messages"]:
            ts = datetime.fromtimestamp(float(m["ts"]), KST).strftime("%H:%M")
            speaker = m.get("user") or m.get("username") or m.get("bot_id") or "?"
            text = (m.get("text") or "").strip().replace("\n", " ")
            block.append(f"[{ts}] {speaker}: {text}")
        blocks.append("\n".join(block))
    return "\n\n".join(blocks)


# ---------------------------------------------------------------------------
# Anthropic summarization
# ---------------------------------------------------------------------------
SUMMARY_INSTRUCTIONS = """다음은 지난 24시간 동안 Slack 여러 채널에서 오간 메시지입니다.
이를 토대로 한국어 일일 요약 보고서를 작성하세요.

작성 규칙:
- 전체를 한국어로 씁니다.
- 잡담/사소한 내용은 제외하고 의사결정, 액션 아이템, 중요한 공지, 긴급 이슈, 핵심 논의에만 집중합니다.
- 활동이 없거나 무의미한 채널은 보고서에서 생략합니다.
- 채널마다 2~5개 불릿으로 요약합니다.
- 상단에 "오늘의 핵심 하이라이트"를 두고 전체에서 가장 중요한 3~5개 항목을 뽑아 적습니다.
- 마크다운 표/코드 블록을 쓰지 말고, 라크 메시지로 그대로 붙여 넣어도 가독성이 좋도록 단순 텍스트로 작성합니다.

출력 형식:
📋 오늘의 Slack 주요 요약 ({date})

🔑 오늘의 핵심 하이라이트
• ...
• ...

📢 채널별 요약

#채널명
• ...
• ...

#채널명
• ...
"""


def summarize(messages_text: str) -> str:
    prompt = SUMMARY_INSTRUCTIONS.format(date=NOW.strftime("%Y-%m-%d"))
    payload = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 4096,
        "messages": [
            {
                "role": "user",
                "content": (
                    prompt
                    + "\n\n다음은 메시지 원문입니다:\n---\n"
                    + messages_text[:120000]  # safety cap
                    + "\n---"
                ),
            }
        ],
    }
    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    resp = requests.post(ANTHROPIC_URL, headers=headers, json=payload, timeout=180)
    if resp.status_code >= 400:
        print(f"Anthropic 오류 본문: {resp.text}", file=sys.stderr)
    resp.raise_for_status()
    data = resp.json()
    return data["content"][0]["text"].strip()


# ---------------------------------------------------------------------------
# Lark push
# ---------------------------------------------------------------------------
def push_to_lark(text: str) -> None:
    payload = {"msg_type": "text", "content": {"text": text}}
    resp = requests.post(LARK_WEBHOOK_URL, json=payload, timeout=20)
    print(f"Lark 응답: {resp.status_code} {resp.text}")
    body = {}
    try:
        body = resp.json()
    except Exception:
        pass
    if resp.status_code >= 400 or body.get("code") not in (0, None):
        raise RuntimeError(f"Lark push failed: {resp.status_code} {resp.text}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main() -> None:
    activity = collect_activity()
    if not activity:
        msg = (
            f"📋 오늘의 Slack 주요 요약 ({NOW.strftime('%Y-%m-%d')})\n\n"
            f"지난 {LOOKBACK_HOURS}시간 동안 주목할 만한 활동이 없었습니다."
        )
        push_to_lark(msg)
        return

    rendered = render_for_llm(activity)
    print(f"LLM 입력 길이: {len(rendered)}자")
    summary = summarize(rendered)
    print("--- SUMMARY ---")
    print(summary)
    print("--- END ---")
    push_to_lark(summary)


if __name__ == "__main__":
    main()
