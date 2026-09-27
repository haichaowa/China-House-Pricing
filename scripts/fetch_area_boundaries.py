#!/usr/bin/env python3
"""Cache DataV province/city boundaries locally for GitHub Pages hosting."""

from __future__ import annotations

import json
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AREA_DIR = ROOT / "data" / "areas"
GEO_BASE = "https://geo.datav.aliyun.com/areas_v3/bound"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36"


def fetch(adcode: int) -> tuple[int, bytes | None, str | None]:
    result = subprocess.run(
        [
            "curl", "--fail", "--location", "--silent", "--show-error",
            "--max-time", "30", "--retry", "3", "--retry-all-errors",
            "-A", UA, f"{GEO_BASE}/{adcode}_full.json",
        ],
        capture_output=True,
    )
    if result.returncode != 0:
        return adcode, None, result.stderr.decode(errors="replace").strip()
    try:
        json.loads(result.stdout)
    except Exception as error:
        return adcode, None, str(error)
    return adcode, result.stdout, None


def main() -> None:
    AREA_DIR.mkdir(parents=True, exist_ok=True)
    national = json.loads((ROOT / "data/china-provinces.geojson").read_text(encoding="utf-8"))
    requests = {
        int(feature["properties"]["adcode"])
        for feature in national.get("features", [])
        if int(feature.get("properties", {}).get("childrenNum", 0) or 0) > 0
    }

    # First cache provinces, then discover prefecture-level children.
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(fetch, adcode) for adcode in requests]
        for future in as_completed(futures):
            adcode, content, error = future.result()
            if content is None:
                print(f"WARNING province {adcode}: {error}")
                continue
            (AREA_DIR / f"{adcode}_full.json").write_bytes(content)
            payload = json.loads(content)
            for feature in payload.get("features", []):
                properties = feature.get("properties", {})
                if properties.get("level") == "city" and int(properties.get("childrenNum", 0) or 0) > 0:
                    requests.add(int(properties["adcode"]))

    # Fetch city-level boundaries.
    existing = {int(path.name.split("_", 1)[0]) for path in AREA_DIR.glob("*_full.json")}
    city_codes = requests - existing
    failures: list[tuple[int, str]] = []
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(fetch, adcode) for adcode in city_codes]
        for future in as_completed(futures):
            adcode, content, error = future.result()
            if content is None:
                failures.append((adcode, error or "unknown"))
                continue
            (AREA_DIR / f"{adcode}_full.json").write_bytes(content)

    files = list(AREA_DIR.glob("*_full.json"))
    print(f"Cached {len(files)} area boundary files ({sum(path.stat().st_size for path in files) / 1024 / 1024:.1f} MB)")
    if failures:
        print(f"Warnings: {len(failures)}")
        for adcode, error in sorted(failures):
            print(f"WARNING city {adcode}: {error}")


if __name__ == "__main__":
    main()
