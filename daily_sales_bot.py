import asyncio
import os
import requests
from datetime import datetime, timedelta
from playwright.async_api import async_playwright

LARK_WEBHOOK_URL = os.environ["LARK_WEBHOOK_URL"]
QOO10_ID = os.environ["QOO10_ID"]
QOO10_PW = os.environ["QOO10_PW"]

LOGIN_URL = "https://qsm.qoo10.jp/GMKT.INC.Gsm.Web/login.aspx"


async def scrape_sales(page, yesterday: str) -> dict:
    data = {
        "date": yesterday,
        "sales": "수집 실패",
        "orders": "수집 실패",
        "visits": "수집 실패",
        "cancels": "수집 실패",
    }

    # 로그인
    await page.goto(LOGIN_URL)
    await page.wait_for_load_state("networkidle")

    await page.fill("input[name='id']", QOO10_ID)
    await page.fill("input[name='pwd']", QOO10_PW)
    await page.click("a.btn_login, input[type='submit'], button[type='submit']")
    await page.wait_for_load_state("networkidle")

    # 판매 통계 페이지 이동
    stats_url = "https://qsm.qoo10.jp/GMKT.INC.Gsm.Web/Goods/GoodsSalesStat.aspx"
    await page.goto(stats_url)
    await page.wait_for_load_state("networkidle")

    # 날짜 범위를 어제로 설정
    start_date = yesterday
    end_date = yesterday

    try:
        await page.fill("input#ctl00_ContentPlaceHolder1_txtFromDt", start_date)
        await page.fill("input#ctl00_ContentPlaceHolder1_txtToDt", end_date)
        await page.click("input[type='button'][value='검색'], a.btn_search")
        await page.wait_for_load_state("networkidle")
    except Exception:
        pass

    # 매출 / 주문수 수집 (셀렉터는 실제 페이지 확인 후 조정 필요)
    try:
        data["sales"] = await page.inner_text("td.total_sales, td.sales_amount")
    except Exception:
        pass

    try:
        data["orders"] = await page.inner_text("td.total_orders, td.order_count")
    except Exception:
        pass

    # 방문량 페이지
    try:
        visit_url = "https://qsm.qoo10.jp/GMKT.INC.Gsm.Web/Statistic/VisitorStat.aspx"
        await page.goto(visit_url)
        await page.wait_for_load_state("networkidle")
        data["visits"] = await page.inner_text("td.visit_count, td.visitor_count")
    except Exception:
        pass

    # 취소/환불 페이지
    try:
        cancel_url = "https://qsm.qoo10.jp/GMKT.INC.Gsm.Web/Order/ClaimList.aspx"
        await page.goto(cancel_url)
        await page.wait_for_load_state("networkidle")
        data["cancels"] = await page.inner_text("td.cancel_count, td.claim_count")
    except Exception:
        pass

    return data


def send_to_lark(data: dict):
    message = (
        f"[큐텐 재팬 데일리 리포트]\n"
        f"날짜: {data['date']}\n"
        f"매출: {data['sales']}\n"
        f"주문수: {data['orders']}\n"
        f"방문량: {data['visits']}\n"
        f"취소/환불: {data['cancels']}"
    )

    payload = {
        "msg_type": "text",
        "content": {"text": message},
    }

    response = requests.post(LARK_WEBHOOK_URL, json=payload, timeout=10)
    print(f"Lark 전송 결과: {response.status_code} / {response.text}")


async def main():
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        try:
            data = await scrape_sales(page, yesterday)
        finally:
            await browser.close()

    send_to_lark(data)


if __name__ == "__main__":
    asyncio.run(main())
