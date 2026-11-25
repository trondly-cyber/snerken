"""Fetch daily price history for a personal Finansradar report."""

import argparse
import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

SYMBOL = re.compile(r"[A-Z0-9.^=/_-]{1,30}")
PRICES = ["Open", "High", "Low", "Close"]


def instruments(text):
    symbols = list(dict.fromkeys(filter(None, re.split(r"[\s,;]+", text.upper()))))
    if not 1 <= len(symbols) <= 12 or not all(SYMBOL.fullmatch(symbol) for symbol in symbols):
        raise ValueError("Oppgi 1–12 symboler, for eksempel EQNR.OL,DNB.OL,MSFT.")
    return symbols


def instrument_data(yf, symbol, period, now):
    ticker = yf.Ticker(symbol)
    history = ticker.history(period=period, interval="1d", auto_adjust=False, actions=False, timeout=20)
    if history.empty:
        raise ValueError("ingen dagskurser")
    metadata = ticker.get_history_metadata()
    currency = str(metadata.get("currency", "")).upper()
    subunits = {"GBp": ("GBP", 0.01), "GBX": ("GBP", 0.01), "ZAc": ("ZAR", 0.01), "ILA": ("ILS", 0.01)}
    currency, multiplier = subunits.get(metadata.get("currency"), (currency, 1))
    if not re.fullmatch(r"[A-Z]{3}", currency):
        raise ValueError("ukjent kursvaluta")
    try:
        market_now = now.astimezone(ZoneInfo(metadata.get("exchangeTimezoneName") or "UTC"))
    except ZoneInfoNotFoundError:
        market_now = now
    cutoff = market_now.date()
    bars = []
    for stamp, opening, high, low, close in history[PRICES].sort_index().itertuples(index=True, name=None):
        day = stamp.date()
        if day >= cutoff or not all(math.isfinite(value) and 0 < value <= 1e12 for value in (opening, high, low, close)):
            continue
        if low > min(opening, close) or high < max(opening, close):
            continue
        bars.append([day.isoformat(), *[float(value * multiplier) for value in (opening, high, low, close)]])
    if not bars:
        raise ValueError("ingen ferdige kursdager")
    if len({bar[0] for bar in bars}) != len(bars):
        raise ValueError("flere dagskurser for samme dato")
    name = metadata.get("shortName") or metadata.get("longName") or symbol
    return {"symbol": symbol, "name": str(name), "currency": currency, "bars": bars}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbols", required=True)
    parser.add_argument("--period", choices=["1y", "2y", "5y"], default="2y")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        symbols = instruments(args.symbols)
    except ValueError as error:
        parser.error(str(error))

    import yfinance as yf

    yf.config.debug.hide_exceptions = False
    now = datetime.now(timezone.utc)
    series = []
    warnings = []
    for symbol in symbols:
        try:
            item = instrument_data(yf, symbol, args.period, now)
            series.append(item)
            print(f"{symbol}: {len(item['bars'])} kursdager, sist {item['bars'][-1][0]}.")
        except Exception as error:
            warning = f"{symbol}: Kurser kunne ikke hentes ({type(error).__name__})."
            warnings.append(warning)
            print(warning, file=sys.stderr)
    if not series:
        parser.exit(1, "Ingen kurser ble hentet. Sjekk symbolene eller prøv igjen senere. Du kan også importere CSV i appen.\n")

    payload = {"source": "market", "fetched": now.date().isoformat(), "series": series, "warnings": warnings}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")


if __name__ == "__main__":
    main()
