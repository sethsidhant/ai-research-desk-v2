import requests
from bs4 import BeautifulSoup
import statistics
import json
import sys
import os
import time

CODES_PATH = os.path.join(os.path.dirname(__file__), "industry_codes.json")
with open(CODES_PATH) as f:
    INDUSTRY_CODES = json.load(f)

def scrape_page(url, headers, pe_idx, mcap_idx):
    r = requests.get(url, headers=headers, timeout=10)
    if r.status_code != 200:
        return [], None

    soup = BeautifulSoup(r.text, "html.parser")
    table = soup.find("table")
    if not table:
        return [], None

    stocks = []
    for row in table.find_all("tr")[1:]:
        cells = [td.get_text(strip=True) for td in row.find_all("td")]
        if not cells: continue
        try:
            pe = float(cells[pe_idx].replace(",", "")) if pe_idx < len(cells) and cells[pe_idx] else None
            mcap = float(cells[mcap_idx].replace(",", "")) if mcap_idx and mcap_idx < len(cells) and cells[mcap_idx] else 0
            # Company name is typically in 2nd cell (index 1)
            name = cells[1] if len(cells) > 1 else "Unknown"
            if pe and pe > 0:
                stocks.append({"pe": pe, "mcap": mcap, "name": name})
        except:
            pass

    next_url = None
    for a in soup.find_all("a", href=True):
        if a.get_text(strip=True).lower() in ["next", "›", "»", "next »"]:
            href = a["href"]
            if href.startswith("http"):
                next_url = href
            elif href.startswith("/"):
                next_url = "https://www.screener.in" + href
            else:
                base = url.split("?")[0].rstrip("/") + "/"
                next_url = base + href
            break

    return stocks, next_url


def fetch_industry_pe(industry_name, screener_cookie, verbose=False):
    code = INDUSTRY_CODES.get(industry_name)
    if not code:
        return None

    parts = [code[:4], code[:6], code[:8], code]
    base_url = "https://www.screener.in/market/" + "/".join(parts) + "/"

    headers = {
        "User-Agent": "Mozilla/5.0",
        "Cookie": screener_cookie,
        "Referer": "https://www.screener.in",
    }

    # Get column indices from first page
    r = requests.get(base_url, headers=headers, timeout=10)
    if r.status_code != 200: return None
    soup = BeautifulSoup(r.text, "html.parser")
    table = soup.find("table")
    if not table: return None

    headers_list = [th.get_text(strip=True) for th in table.find("tr").find_all("th")]
    pe_idx = next((i for i, h in enumerate(headers_list) if "P/E" in h), None)
    mcap_idx = next((i for i, h in enumerate(headers_list) if "Mar Cap" in h), None)
    if pe_idx is None: return None

    # Paginate through all pages
    all_stocks = []
    url = base_url
    page = 1

    while url:
        if verbose: print(f"  Page {page}...")
        stocks, next_url = scrape_page(url, headers, pe_idx, mcap_idx)
        all_stocks.extend(stocks)
        url = next_url
        page += 1
        if next_url: time.sleep(0.5)
        if page > 20: break

    if not all_stocks: return None

    # Sort by mcap descending
    all_stocks.sort(key=lambda x: x["mcap"], reverse=True)

    # Filter: mcap > 5000 Cr AND valid PE
    MCAP_THRESHOLD = 5000
    # Only use stocks with mcap > 5000 Cr AND valid PE - no fallback
    filtered = [s for s in all_stocks if s["mcap"] >= MCAP_THRESHOLD and s["pe"]]
    top = filtered

    pes = [s["pe"] for s in top]
    result = round(statistics.median(pes), 2)

    # High and low PE companies from filtered set
    top_sorted_pe = sorted(top, key=lambda x: x["pe"])
    low_co  = top_sorted_pe[0]
    high_co = top_sorted_pe[-1]

    if verbose:
        print(f"  Total with valid PE: {len(all_stocks)}")
        print(f"  Companies used (mcap > {MCAP_THRESHOLD} Cr): {len(top)}")
        print(f"  Industry PE: {result}")
        print(f"  High PE: {high_co['name']} ({high_co['pe']}x) | Low PE: {low_co['name']} ({low_co['pe']}x)", flush=True)

    return {
        "median_pe": result,
        "high_pe_company": f"{high_co['name']} ({high_co['pe']}x)",
        "low_pe_company":  f"{low_co['name']} ({low_co['pe']}x)",
    }


if __name__ == "__main__":
    industry = sys.argv[1] if len(sys.argv) > 1 else "Tyres & Rubber Products"
    cookie = os.environ.get("SCREENER_COOKIE",
        "csrftoken=m8SJswMgEKkAsfTCfocRfmRxlQnviF1u; sessionid=3rltnrfllx431fu6f2uor258bys7s717")
    result = fetch_industry_pe(industry, cookie, verbose=True)
    if result:
        print(f"  Median: {result['median_pe']} | High: {result['high_pe_company']} | Low: {result['low_pe_company']}")
