#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
prices = json.loads((ROOT / "data/prices.json").read_text(encoding="utf-8"))
district_prices = json.loads((ROOT / "data/district-prices.json").read_text(encoding="utf-8"))
geo = json.loads((ROOT / "data/china-provinces.geojson").read_text(encoding="utf-8"))
geo_names = {feature.get("properties", {}).get("name") for feature in geo["features"]}

assert prices["schemaVersion"] == 2
assert district_prices["schemaVersion"] == 1
assert district_prices["cityCoverage"] >= 70
assert district_prices["districtCoverage"] >= 600
assert len(district_prices["cities"]) == district_prices["cityCoverage"]
assert sum(len(city["districts"]) for city in district_prices["cities"].values()) == district_prices["districtCoverage"]
for market in ("newHouse", "esfHouse"):
    assert len(prices[market]["cities"]) == 100
    assert len(prices[market]["trend"]) >= 12
    assert prices[market]["historicalCoverage"] >= 99
    assert prices[market]["date"]
    trend_dates = {item["date"] for item in prices[market]["trend"]}
    for city in prices[market]["cities"]:
        assert city["province"] in geo_names, f"{city['city']} -> {city['province']} is not in GeoJSON"
        assert isinstance(city["average"], (int, float))
        assert city["unit"] == "元/平方米"
        history = city.get("history", [])
        assert len(history) in (0, len(prices[market]["trend"]))
        assert {item["date"] for item in history}.issubset(trend_dates)

print("Validation passed")
