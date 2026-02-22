import asyncio
from playwright.async_api import async_playwright
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 900}, locale="he-IL")
        page = await context.new_page()
        await page.goto("http://localhost:3334/index.html", wait_until="load", timeout=10000)
        await asyncio.sleep(2)
        await page.screenshot(path=r"C:\Users\noyj\Desktop\tofaat-teva\test_home.png", full_page=True)
        print("Done")
        await browser.close()

asyncio.run(main())
