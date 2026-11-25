"""Build the standalone browser app, with optional private market data."""

import argparse
import json
import math
import random
import re
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def demo_data():
    generator = random.Random(612)
    days = [
        date(2023, 1, 2) + timedelta(days=offset)
        for offset in range(940)
        if (date(2023, 1, 2) + timedelta(days=offset)).weekday() < 5
    ]
    series = []
    for symbol, name, currency, initial, phase in [
        ("FJORD", "Fjord Energi", "NOK", 206, 0),
        ("NORD", "Nord Industri", "NOK", 122, 41),
        ("VIKA", "Vika Finans", "NOK", 84, 22),
        ("SUMMIT", "Summit Tech", "USD", 112, 77),
    ]:
        last = initial
        bars = []
        for index, day in enumerate(days):
            wave = 0.10 * math.sin((index + phase) / 18) + 0.045 * math.sin((index + phase) / 5)
            close = round(initial * (1 + index * 0.00046 + wave + generator.uniform(-0.013, 0.013)), 2)
            opening = round(last * (1 + generator.uniform(-0.012, 0.012)), 2)
            high = round(max(opening, close) * (1 + generator.uniform(0.002, 0.020)), 2)
            low = round(min(opening, close) * (1 - generator.uniform(0.002, 0.020)), 2)
            bars.append([day.isoformat(), opening, high, low, close])
            last = close
        series.append({"symbol": symbol, "name": name, "currency": currency, "bars": bars})
    return {"source": "demo", "series": series}


def inline_json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).replace("<", r"\u003c")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "docs" / "index.html")
    args = parser.parse_args()
    market = json.loads(args.data.read_text(encoding="utf-8")) if args.data else None
    source = ROOT / "src"
    chunks = {
        "CSS": (source / "styles.css").read_text(encoding="utf-8"),
        "MARKET": inline_json(market),
        "DEMO": inline_json(demo_data()),
        "STRATEGY": (source / "strategy.js").read_text(encoding="utf-8"),
        "APP": (source / "app.js").read_text(encoding="utf-8"),
    }
    html = (source / "index.html").read_text(encoding="utf-8")
    html = re.sub(r"@@([A-Z]+)@@", lambda match: chunks[match[1]], html)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(html, encoding="utf-8")


if __name__ == "__main__":
    main()
