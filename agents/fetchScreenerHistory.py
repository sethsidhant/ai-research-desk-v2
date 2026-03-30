"""
fetchScreenerHistory.py — scrape historical financials from Screener.in
Sections: Quarterly Results, P&L (Annual), Balance Sheet, Cash Flow, Ratios, Shareholding

Usage: python3 fetchScreenerHistory.py LT
Output: JSON with all 6 sections
"""

import requests
from bs4 import BeautifulSoup
import sys
import json
import re

SECTIONS = [
    ("quarterly",    "quarters"),
    ("annual_pl",    "profit-loss"),
    ("balance_sheet","balance-sheet"),
    ("cash_flow",    "cash-flow"),
    ("ratios",       "ratios"),
    ("shareholding", "shareholding"),
]

def to_num(text):
    if not text:
        return None
    text = str(text).replace(",", "").strip()
    text = re.sub(r'[^\d\.\-]', '', text)
    try:
        v = float(text)
        return v if v != 0.0 else None
    except (ValueError, TypeError):
        return None

def extract_table(section_el):
    """Extract all rows and headers from a Screener section table."""
    if not section_el:
        return None
    table = section_el.find("table")
    if not table:
        return None

    # Headers from thead
    thead = table.find("thead")
    headers = []
    if thead:
        for th in thead.find_all("th"):
            text = th.get_text(strip=True).lstrip("+").strip()
            headers.append(text)
    # First header is the row-label column — skip it
    period_headers = headers[1:] if headers else []

    # Rows from tbody
    rows = []
    tbody = table.find("tbody")
    if tbody:
        for tr in tbody.find_all("tr"):
            cells = tr.find_all("td")
            if not cells:
                continue
            label = cells[0].get_text(strip=True).rstrip("+").strip()
            values = []
            for cell in cells[1:]:
                raw = cell.get_text(strip=True).replace("%", "").replace(",", "").strip()
                values.append(to_num(raw))
            if label:
                rows.append({"label": label, "values": values})

    return {"headers": period_headers, "rows": rows}

def fetch_screener_history(ticker):
    ticker = ticker.replace(".NS", "").upper()
    req_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    html = None
    used_url = None
    for url in [
        f"https://www.screener.in/company/{ticker}/consolidated/",
        f"https://www.screener.in/company/{ticker}/",
    ]:
        try:
            r = requests.get(url, headers=req_headers, timeout=20)
            if r.status_code == 200 and len(r.text) > 5000:
                soup_test = BeautifulSoup(r.text, "html.parser")
                ul = soup_test.find("ul", id="top-ratios")
                if ul:
                    nums = [s.get_text(strip=True) for s in ul.find_all("span", class_="number")]
                    if any(nums):
                        html = r.text
                        used_url = url
                        break
        except Exception:
            continue

    if not html:
        return None

    soup = BeautifulSoup(html, "html.parser")
    result = {"ticker": ticker, "url": used_url}

    for key, section_id in SECTIONS:
        section_el = soup.find("section", id=section_id)
        result[key] = extract_table(section_el)

    return result


if __name__ == "__main__":
    ticker = sys.argv[1] if len(sys.argv) > 1 else "LT"
    data = fetch_screener_history(ticker)
    print(json.dumps(data, indent=2))
