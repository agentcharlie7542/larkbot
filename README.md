# larkbot

Lark(라크) 봇 자동화 허브. 단일 Node 프로세스가 정적 관리 페이지 + API + 스케줄러를 모두 서빙한다.

- **기능 A — 대화 요약 봇**: 지정한 정보 방의 대화를 요약 + 업무(액션아이템) 정리하여 웹훅으로 발송. (관리 페이지에서 원문 붙여넣기)
- **기능 B — 큐텐 이벤트 스케줄 봇**: 큐텐(Qoo10) 프로모션 캘린더 이미지를 Claude Vision 으로 읽어 날짜별 이벤트로 구조화하고, 매일 아침 "내일(또는 오늘) 이벤트 현황"을 지정 웹훅으로 자동 발송.

운영자는 코드 수정 없이 관리 페이지에서 웹훅·발송 시각·발송 대상을 추가/변경할 수 있다.

---

## 기술 스택

- 백엔드: Node.js (ESM) + Express
- 스케줄러: node-cron (타임존 지원)
- LLM: Anthropic Claude API (`@anthropic-ai/sdk`) — 요약 + 이미지(Vision) 파싱, 기본 모델 `claude-sonnet-4-6`
- 이미지 업로드: multer (메모리 저장)
- 저장소: 파일 기반 `data/config.json`, `data/events.json` (추후 SQLite 전환 여지)
- 프론트: 정적 `public/index.html` (Vanilla JS, 빌드 없음) — 백엔드가 함께 서빙

## 디렉토리 구조

```
larkbot/
├── src/
│   ├── server.js              # Express 진입점: 정적 서빙 + API + cron 기동
│   ├── routes/
│   │   ├── summary.js         # 기능 A: 요약/업무정리 트리거
│   │   ├── events.js          # 기능 B: 이미지 파싱·스케줄·미리보기·발송
│   │   └── webhooks.js        # 웹훅 등록/목록/삭제/테스트
│   ├── services/
│   │   ├── lark.js            # Lark 웹훅 전송
│   │   ├── llm.js             # Claude 요약 + 공용 클라이언트/모델
│   │   ├── scheduleParser.js  # 이미지 → 이벤트 JSON (Vision)
│   │   ├── dailyJob.js        # 일일 발송 cron + 메시지 빌더
│   │   └── eventsUtil.js      # 날짜 계산 + 카테고리 캠페인 기간 전개
│   └── store/store.js         # config.json / events.json 읽기·쓰기 (원자적 쓰기)
├── public/index.html          # 관리 페이지(탭 2개)
├── data/
│   ├── events.json            # 파싱된 이벤트(시드 포함, 커밋됨)
│   ├── config.json            # 웹훅·스케줄 설정 (gitignore — 실 URL 포함)
│   └── config.example.json    # config 템플릿(커밋됨)
├── .env.example
├── package.json
└── README.md
```

## 셋업 & 실행

```bash
npm install
cp .env.example .env      # ANTHROPIC_API_KEY 등 입력
npm start                 # http://localhost:3000
# 개발: npm run dev (파일 변경 자동 재시작)
```

브라우저에서 `http://localhost:3000` 접속 → 관리 페이지.

> `ANTHROPIC_API_KEY` 가 없어도 서버는 뜨고 일일 발송(룰베이스)은 동작하지만, **요약·이미지 파싱은 비활성**된다.

## API 요약

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/status` | 모델/LLM 설정/스케줄 상태 |
| GET | `/api/webhooks` | 웹훅 목록 |
| POST | `/api/webhooks` | 웹훅 추가 `{ name, webhookUrl, sourceChannelId? }` |
| DELETE | `/api/webhooks/:id` | 웹훅 삭제 |
| POST | `/api/webhooks/:id/test` | 테스트 메시지 발송 |
| POST | `/api/summary/run` | 요약 `{ rawText, webhookId? }` — webhookId 있으면 발송 |
| POST | `/api/events/parse` | 이미지 업로드(multipart `image`) → 파싱 JSON 반환 |
| POST | `/api/events/confirm` | `{ source?, events, note? }` 저장 |
| GET | `/api/events?from=&to=` | 기간 조회(날짜별 활성 이벤트) |
| POST | `/api/events/preview-send` | 발송 메시지 미리보기(실발송 X). `{ date? }` |
| POST | `/api/events/send-now` | 즉시 발송. `{ force? }` |
| GET / PUT | `/api/events/schedule` | 스케줄 조회/변경(변경 시 cron 재등록) |

## 이벤트 저장 규약

- **MEGAPO·카트/일일 쿠폰**: 적용되는 날짜마다 한 항목씩 저장(이미 전개됨).
- **카테고리 캠페인**(`type:"category"`, 예: 熱中症対策 7/13~8/23): **시작일 한 항목**에만 두고 `period` 로 기간 표기. 기간 내 모든 날짜로의 전개는 **선택 시점**(`eventsForDate`)에 코드가 처리하며, 시작일이 아니면 `[継続]` 로 표시된다.

## 일일 발송 메시지 예시

```
【Qoo10 イベント案内】2026-07-08 (火)
・MEGAPO 第3弾 10%クーポン 100円以上/最大10,000円割引 ×5枚  ※7/7 00:00~7/9 23:59
・カートクーポン 500円(5,000円以上) / 1,500円(15,000円以上)
```

`SEND_BILINGUAL=true`(또는 스케줄 설정의 병기 옵션)이면 상단에 `🇰🇷 ... 큐텐 이벤트 안내` 헤더가 추가된다.

## 보안

- `ANTHROPIC_API_KEY` 등 민감정보는 `.env` 에만 둔다(코드/깃 하드코딩 금지).
- `.gitignore` 가 `.env` 와 `data/config.json`(실 웹훅 URL 포함)을 제외한다. `events.json` 시드와 `config.example.json` 만 커밋된다.
