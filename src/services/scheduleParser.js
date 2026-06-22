// 큐텐 이벤트 스케줄 이미지 → 날짜별 이벤트 JSON (Claude Vision).
// llm.js 의 공용 클라이언트/모델을 재사용.
import { getClient, MODEL, extractText } from "./llm.js";

const PARSER_SYSTEM = `당신은 큐텐(Qoo10) 프로모션 캘린더 이미지를 읽어 날짜별 이벤트로 구조화하는 파서입니다.
이미지에는 달력 표(셀마다 날짜)와, 여러 날짜에 걸친 이벤트 바(기간형 이벤트)가 함께 있습니다.

추출 규칙:
1) 달력 셀의 날짜와, 그 위에 걸친 기간형 이벤트 바를 모두 인식한다.
2) MEGAPO(第N弾)·카트/일일 쿠폰 같은 "일일성" 이벤트는 시작~종료 기간의 **모든 날짜에 각각 한 항목씩** 전개한다.
   - 시작일 title 끝에 " 開始", 종료일 title 끝에 "(最終日)" 표기 권장.
3) "熱中症対策キャンペーン", "サマーファッションキャンペーン" 같은 **카테고리 캠페인**은 type:"category" 로,
   **시작일에 한 항목만** 만들고 period 에 전체 기간을 넣는다. (날짜별 전개는 하지 않는다)
4) 쿠폰 발행이 없는 날(クーポン発行無し)은 항목을 만들지 않는다.

출력은 아래 스키마의 JSON **객체 하나만** 출력한다. 설명·마크다운·코드펜스 금지. 첫 글자는 반드시 '{'.
{
  "source": "이미지 제목/출처 (예: 26Q3 July 2026 Key Promotions)",
  "events": [
    { "date": "YYYY-MM-DD", "type": "megapo|coupon|cart|category|none", "title": "string", "detail": "string", "period": "string|null" }
  ],
  "note": "전개 규칙 등 참고 메모(선택)"
}
원문 표기(일본어)는 title/detail 에 그대로 유지한다.`;

const VALID_TYPES = new Set(["megapo", "coupon", "cart", "category", "none"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function stripToJson(text) {
  if (!text) return null;
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(s);
  } catch {
    /* fall through */
  }
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

function normalizeEvents(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => {
      const date = String(e?.date || "").trim();
      if (!ISO_DATE.test(date)) return null; // 날짜 형식 불량 항목은 버림
      const type = VALID_TYPES.has(e?.type) ? e.type : "none";
      return {
        date,
        type,
        title: String(e?.title || "").trim(),
        detail: String(e?.detail || "").trim(),
        period: e?.period ? String(e.period).trim() : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// imageBase64: data URI 없는 순수 base64 문자열. mediaType: image/png 등.
export async function parseScheduleImage(imageBase64, mediaType = "image/png") {
  if (!imageBase64) throw new Error("이미지 데이터가 비어 있습니다.");
  const client = getClient();

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: PARSER_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: "이 큐텐 프로모션 캘린더를 위 스키마의 JSON 객체 하나로 변환하세요." },
        ],
      },
    ],
  });

  const parsed = stripToJson(extractText(message));
  if (!parsed) throw new Error("모델 응답에서 JSON 을 추출하지 못했습니다.");

  return {
    source: String(parsed.source || "").trim(),
    events: normalizeEvents(parsed.events),
    note: String(parsed.note || "").trim(),
  };
}

export { normalizeEvents };
