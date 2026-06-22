// Lark 커스텀 봇 웹훅 전송. 글로벌 fetch(Node 18+) 사용, 외부 HTTP 의존성 없음.
//
// 커스텀 봇 웹훅 페이로드 형식:
//   텍스트      : { msg_type: "text", content: { text: "..." } }
//   인터랙티브  : { msg_type: "interactive", card: {...} }

const TIMEOUT_MS = 15000;

function withTimeout(ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

// content 가 문자열이면 text 메시지, { card } 이면 인터랙티브 카드, 그 외 객체는 그대로 전송.
function buildPayload(content) {
  if (typeof content === "string") {
    return { msg_type: "text", content: { text: content } };
  }
  if (content && content.card) {
    return { msg_type: "interactive", card: content.card };
  }
  return content; // 호출부가 완성된 페이로드를 넘긴 경우
}

export async function sendToWebhook(url, content) {
  if (!url) throw new Error("webhook URL 이 비어 있습니다.");
  const payload = buildPayload(content);
  const t = withTimeout(TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: t.signal,
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
    // 라크는 HTTP 200 + { code: 0 } 이 성공. code != 0 이면 본문에 사유가 담겨 옴.
    const ok = res.ok && (body.code === undefined || body.code === 0 || body.StatusCode === 0);
    return { ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: { error: err.name === "AbortError" ? "timeout" : err.message } };
  } finally {
    t.done();
  }
}

export async function testWebhook(url) {
  const stamp = new Date().toISOString();
  return sendToWebhook(url, `✅ larkbot 연결 테스트\n이 메시지가 보이면 웹훅 설정이 정상입니다. (${stamp})`);
}
