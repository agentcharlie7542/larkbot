// Claude API 호출 레이어 — 공식 @anthropic-ai/sdk 사용.
// 대화 요약(summarizeConversation)과, scheduleParser 가 쓰는 공용 클라이언트/모델을 제공.
import Anthropic from "@anthropic-ai/sdk";

// 기본 모델은 claude-sonnet-4-6 (이미지 파싱·요약 모두). 더 높은 파싱 정확도가 필요하면
// .env 의 ANTHROPIC_MODEL 을 claude-opus-4-8 로 바꾸면 됨.
export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

let _client = null;
export function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY 가 설정되지 않았습니다. (.env 확인)");
  }
  if (!_client) _client = new Anthropic(); // ANTHROPIC_API_KEY 환경변수에서 자동 인식
  return _client;
}

export function isLlmConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// 응답 content 블록(여러 개일 수 있음)에서 text 만 이어붙임
export function extractText(message) {
  return (message.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

const SUMMARY_SYSTEM = `당신은 한국어 비즈니스 대화 요약 비서입니다.
한 업무 채팅방의 최근 대화를 입력받아, 아래 형식의 한국어 보고체로 정리합니다.
출력은 반드시 아래 4개 섹션을 이 순서·이 헤더(이모지 포함)로 작성하세요. 내용이 없는 섹션은 "- 없음" 한 줄로 둡니다.
설명·머리말·코드블록 없이 본문만 출력하세요.

📌 핵심 요약
- (3~5줄, 한 줄에 하나의 핵심)

✅ 결정 사항
- (확정/합의된 사항만)

📋 To-Do
- (할 일. 담당자·기한을 추정할 수 있으면 "(담당: 이름, ~기한)" 형태로 덧붙임)

❓ 미결/확인 필요
- (결론 안 난 논의, 확인이 필요한 항목)

규칙: 중국어 한자·일본어 가나는 쓰지 말 것(고유명사도 한국어로). 추측이 과하지 않게, 대화에 근거해 작성.`;

// 대화 원문(text)을 받아 위 형식의 요약 문자열을 반환.
export async function summarizeConversation(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) throw new Error("요약할 대화 원문이 비어 있습니다.");

  const client = getClient();
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SUMMARY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `다음은 한 업무 채팅방의 최근 대화입니다. 위 형식대로 요약·정리해 주세요.\n\n---\n${trimmed}\n---`,
      },
    ],
  });

  const out = extractText(message);
  if (!out) throw new Error("요약 결과가 비어 있습니다. (모델 응답 없음)");
  return out;
}
