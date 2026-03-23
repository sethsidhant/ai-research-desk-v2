import requests
from bs4 import BeautifulSoup
import sys
import json
import re

def fetch_screener_fundamentals(ticker):
    ticker = ticker.replace(".NS", "").upper()
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

    html = None
    for url in [
        f"https://www.screener.in/company/{ticker}/consolidated/",
        f"https://www.screener.in/company/{ticker}/",
    ]:
        try:
            r = requests.get(url, headers=headers, timeout=20)
            if r.status_code == 200 and len(r.text) > 5000:
                # Verify top-ratios has actual data (consolidated stub pages have empty values)
                from bs4 import BeautifulSoup as _BS
                _soup = _BS(r.text, "html.parser")
                _ul = _soup.find("ul", id="top-ratios")
                if _ul:
                    _nums = [s.get_text(strip=True) for s in _ul.find_all("span", class_="number")]
                    if not any(_nums):
                        continue  # stub page — try next URL
                html = r.text
                break
        except Exception:
            continue

    if not html:
        return None

    soup = BeautifulSoup(html, "html.parser")

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

    def last_val(cells):
        """Get last non-None numeric value from a list of td cells."""
        vals = [to_num(c.get_text(strip=True)) for c in cells[1:]]
        vals = [v for v in vals if v is not None]
        return vals[-1] if vals else None

    f = {
        "ticker": ticker,
        "pe": None, "roe": None, "roce": None, "market_cap": None,
        "industry_hierarchy": None, "current_price": None,
        "high_52w": None, "low_52w": None, "pct_from_52w_high": None,
        "pb": None, "dividend_yield": None, "eps": None,
        "debt_to_equity": None, "promoter_holding": None,
        "fii_holding": None, "dii_holding": None,
        "revenue_growth_1y": None, "revenue_growth_3y": None, "revenue_growth_5y": None,
        "profit_growth_1y": None, "profit_growth_3y": None, "profit_growth_5y": None,
        "operating_cash_flow": None, "free_cash_flow": None, "total_debt": None,
        "current_ratio": None, "interest_coverage": None, "pledged_pct": None,
        "reserves": None, "borrowings": None,
        "bse_code": None,
    }

    # ── Top ratios (#top-ratios) ──────────────────────────────────────────────
    ratios_ul = soup.find("ul", id="top-ratios")
    if ratios_ul:
        for li in ratios_ul.find_all("li"):
            name_el  = li.find("span", class_="name")
            if not name_el:
                continue
            label = name_el.get_text(strip=True)

            # High / Low — two separate number spans
            if label == "High / Low":
                nums = li.find_all("span", class_="number")
                if len(nums) >= 2:
                    f["high_52w"] = to_num(nums[0].get_text(strip=True))
                    f["low_52w"]  = to_num(nums[1].get_text(strip=True))
                elif len(nums) == 1:
                    # Try splitting on "/" in text
                    raw = nums[0].get_text(strip=True)
                    if "/" in raw:
                        parts = raw.split("/")
                        f["high_52w"] = to_num(parts[0])
                        f["low_52w"]  = to_num(parts[1])
                    else:
                        f["high_52w"] = to_num(raw)
                # Also try finding a sub-anchor with the low
                anchors = li.find_all("a")
                if len(anchors) >= 2 and f["low_52w"] is None:
                    f["low_52w"] = to_num(anchors[1].get_text(strip=True))
                continue

            value_el = li.find("span", class_="number")
            if not value_el:
                continue
            raw = value_el.get_text(strip=True)

            if label == "Market Cap":        f["market_cap"]     = to_num(raw)
            elif label == "Current Price":   f["current_price"]  = to_num(raw)
            elif label == "Stock P/E":       f["pe"]             = to_num(raw)
            elif label == "Book Value":
                bv = to_num(raw)
                if bv and f["current_price"] and bv > 0:
                    f["pb"] = round(f["current_price"] / bv, 2)
            elif label == "Dividend Yield":  f["dividend_yield"] = to_num(raw)
            elif label == "ROE":             f["roe"]            = to_num(raw)
            elif label == "ROCE":            f["roce"]           = to_num(raw)

    # Pct from 52W high
    if f["current_price"] and f["high_52w"] and f["high_52w"] > 0:
        f["pct_from_52w_high"] = round(
            (f["current_price"] - f["high_52w"]) / f["high_52w"] * 100, 2
        )

    # ── Industry hierarchy (peers section) ────────────────────────────────────
    peers = soup.find("section", id="peers")
    if peers:
        links = []
        for a in peers.find_all("a"):
            text = a.get_text(strip=True)
            if any(w in text for w in ["BSE", "Nifty", "MSCI", "Sensex", "Index"]):
                break
            if text:
                links.append(text)
        if links:
            seen = []
            for item in links:
                if item not in seen:
                    seen.append(item)
            f["industry_hierarchy"] = seen[-1]

    # ── Ratios section (Current Ratio, Interest Coverage, D/E fallback) ─────
    ratios_section = soup.find("section", id="ratios")
    if ratios_section:
        table = ratios_section.find("table")
        if table:
            for row in table.find_all("tr"):
                cells = row.find_all("td")
                if not cells:
                    continue
                label = cells[0].get_text(strip=True)
                v = last_val(cells)
                if v is None:
                    continue
                if "Current ratio" in label or "Current Ratio" in label:
                    f["current_ratio"] = v
                elif "Interest coverage" in label or "Interest Coverage" in label:
                    f["interest_coverage"] = v
                elif "Debt to equity" in label and f["debt_to_equity"] is None:
                    f["debt_to_equity"] = v
                elif label == "EPS" and f["eps"] is None:
                    f["eps"] = v

    # ── Profit & Loss — compounded growth ─────────────────────────────────────
    # Screener concatenates all growth text in one div with no class
    pl_section = soup.find("section", id="profit-loss")
    if pl_section:
        full_text = pl_section.get_text(separator=" ", strip=True)
        
        # Extract Sales growth block
        sales_m = re.search(r'Compounded Sales Growth(.*?)(?:Compounded Profit Growth|Stock Price CAGR|Return on)', full_text, re.DOTALL)
        if sales_m:
            block = sales_m.group(1)
            m = re.search(r'5 Years?[:\s]+([\-\d\.]+)\s*%', block)
            if m: f["revenue_growth_5y"] = float(m.group(1))
            m = re.search(r'3 Years?[:\s]+([\-\d\.]+)\s*%', block)
            if m: f["revenue_growth_3y"] = float(m.group(1))
            m = re.search(r'TTM[:\s]+([\-\d\.]+)\s*%', block)
            if m: f["revenue_growth_1y"] = float(m.group(1))

        # Extract Profit growth block
        profit_m = re.search(r'Compounded Profit Growth(.*?)(?:Stock Price CAGR|Return on)', full_text, re.DOTALL)
        if profit_m:
            block = profit_m.group(1)
            m = re.search(r'5 Years?[:\s]+([\-\d\.]+)\s*%', block)
            if m: f["profit_growth_5y"] = float(m.group(1))
            m = re.search(r'3 Years?[:\s]+([\-\d\.]+)\s*%', block)
            if m: f["profit_growth_3y"] = float(m.group(1))
            m = re.search(r'TTM[:\s]+([\-\d\.]+)\s*%', block)
            if m: f["profit_growth_1y"] = float(m.group(1))

        # EPS — from P&L table last row with EPS
        table = pl_section.find("table")
        if table:
            for row in table.find_all("tr"):
                cells = row.find_all("td")
                if cells and "EPS" in cells[0].get_text(strip=True):
                    f["eps"] = last_val(cells)
                    break

    # ── Balance Sheet — Borrowings + D/E ────────────────────────────────────
    bs_section = soup.find("section", id="balance-sheet")
    if bs_section:
        table = bs_section.find("table")
        if table:
            equity_cap = None
            reserves   = None
            borrowings = None
            for row in table.find_all("tr"):
                cells = row.find_all("td")
                if not cells:
                    continue
                label = cells[0].get_text(strip=True).rstrip("+").strip()
                v = last_val(cells)
                if v is None:
                    continue
                if label == "Borrowings":       borrowings = v
                elif label == "Equity Capital": equity_cap = v
                elif label == "Reserves":       reserves   = v
            f["total_debt"] = borrowings
            f["borrowings"] = borrowings
            f["reserves"]   = reserves
            # D/E = Borrowings / (Equity Capital + Reserves)
            if borrowings is not None and equity_cap and reserves:
                net_worth = equity_cap + reserves
                if net_worth > 0:
                    f["debt_to_equity"] = round(borrowings / net_worth, 2)
    cf_section = soup.find("section", id="cash-flow")
    if cf_section:
        table = cf_section.find("table")
        if table:
            cfi = None
            for row in table.find_all("tr"):
                cells = row.find_all("td")
                if not cells:
                    continue
                label = cells[0].get_text(strip=True)
                v = last_val(cells)
                if v is None:
                    continue
                if "Operating" in label:
                    f["operating_cash_flow"] = v
                elif "Investing" in label:
                    cfi = v
            if f["operating_cash_flow"] is not None and cfi is not None:
                f["free_cash_flow"] = round(f["operating_cash_flow"] + cfi, 2)

    # ── Shareholding — get latest column value ────────────────────────────────
    sh_section = soup.find("section", id="shareholding")
    if sh_section:
        table = sh_section.find("table")
        if table:
            for row in table.find_all("tr"):
                cells = row.find_all("td")
                if not cells:
                    continue
                label = cells[0].get_text(strip=True).rstrip("+").strip()
                # Get latest (last) non-empty value
                vals = []
                for c in cells[1:]:
                    t = c.get_text(strip=True).replace("%", "").replace(",", "").strip()
                    try:
                        vals.append(float(t))
                    except (ValueError, TypeError):
                        pass
                if not vals:
                    continue
                latest = vals[-1]
                # Only set if not already set (first occurrence = quarterly, most recent)
                if re.match(r'Promoters?$', label, re.IGNORECASE) and f["promoter_holding"] is None:
                    f["promoter_holding"] = latest
                elif re.match(r'FIIs?$', label, re.IGNORECASE) and f["fii_holding"] is None:
                    f["fii_holding"] = latest
                elif re.match(r'DIIs?$', label, re.IGNORECASE) and f["dii_holding"] is None:
                    f["dii_holding"] = latest
                elif re.match(r'Pledged', label, re.IGNORECASE) and f["pledged_pct"] is None:
                    f["pledged_pct"] = latest

    # ── BSE code — from bseindia.com link on page ────────────────────────────
    for a in soup.find_all("a", href=True):
        m = re.search(r'bseindia\.com[^"]*?/(\d{6})/?$', a["href"])
        if m:
            f["bse_code"] = m.group(1)
            break

    return f


if __name__ == "__main__":
    ticker = sys.argv[1] if len(sys.argv) > 1 else "HINDUNILVR"
    data = fetch_screener_fundamentals(ticker)
    print(json.dumps(data))
