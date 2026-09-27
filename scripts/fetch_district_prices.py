#!/usr/bin/env python3
"""Fetch Fang.com district-level second-hand listing reference prices."""

from __future__ import annotations

import datetime as dt
import json
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36"
HOME_URL = "https://fangjia.fang.com/"
GEO_BASE = "https://geo.datav.aliyun.com/areas_v3/bound"


def curl(url: str, marker: str | None = None, attempts: int = 5) -> str:
    last_error = None
    for _attempt in range(attempts):
        result = subprocess.run(
            [
                "curl", "--fail", "--location", "--silent", "--show-error",
                "--max-time", "30", "--retry", "2", "--retry-all-errors",
                "-A", UA, "-H", "Accept-Language: zh-CN,zh;q=0.9", url,
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0 and (marker is None or marker in result.stdout):
            return result.stdout
        last_error = result.stderr.strip() or f"missing marker {marker!r}"
    raise RuntimeError(f"Failed to fetch {url}: {last_error}")


def city_slugs() -> dict[str, str]:
    html = curl(HOME_URL, marker='id="cityi010"')
    mappings: dict[str, str] = {}
    for href, text in re.findall(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html, re.S):
        name = re.sub(r"<.*?>", "", text).strip()
        match = re.match(r"^/?([a-z0-9]+)/?$", href)
        if name and match and name not in mappings:
            mappings[name] = match.group(1)
    mappings["北京"] = "bj"
    return mappings


def fetch_map_data(city: str, slug: str) -> dict:
    url = (
        f"https://fangjia.fang.com/fangjia/map/getmapdata/{slug}"
        "?district=&commerce=&x1=undefined&y1=undefined&x2=undefined&y2=undefined&v=20150116&newcode="
    )
    try:
        payload = json.loads(curl(url, marker='"project"', attempts=4))
        projects = payload.get("project")
        if not isinstance(projects, list):
            raise RuntimeError("project is not a list")
        return {"city": city, "slug": slug, "projects": projects, "error": None}
    except Exception as error:
        return {"city": city, "slug": slug, "projects": [], "error": str(error)}


def fetch_geo(adcode: int) -> dict:
    return json.loads(curl(f"{GEO_BASE}/{adcode}_full.json", marker='"FeatureCollection"'))


def normalize_name(name: str) -> str:
    return re.sub(r"(市|特别行政区|自治区|维吾尔|回族|壮族|自治州|地区|盟|林区)$", "", name or "")


def match_district(source_name: str, feature_names: list[str]) -> str | None:
    source = normalize_name(source_name)
    for name in feature_names:
        if source_name == name or source == normalize_name(name):
            return name
    for suffix in ("区", "县", "市"):
        if source_name + suffix in feature_names:
            return source_name + suffix
    return None


def code_from_url(url: str) -> str | None:
    match = re.search(r"/a([0-9]+)/?(?:index\.html)?$", url or "")
    return f"a{match.group(1)}" if match else None


def main() -> None:
    prices = json.loads((DATA_DIR / "prices.json").read_text(encoding="utf-8"))
    province_geo = json.loads((DATA_DIR / "china-provinces.geojson").read_text(encoding="utf-8"))
    slugs = city_slugs()
    monitored = prices["newHouse"]["cities"]

    # The Fang page has a Taizhou/Taizhou pinyin collision. Its API resolves to
    # Zhejiang Taizhou, so do not misattribute that series to Jiangsu Taizhou.
    slug_tasks = [(city["city"], slugs[city["city"]]) for city in monitored if city["city"] in slugs]
    slug_tasks = [(city, slug) for city, slug in slug_tasks if not (city == "泰州" and slug == "taizhou")]

    map_results: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = [executor.submit(fetch_map_data, city, slug) for city, slug in slug_tasks]
        for future in as_completed(futures):
            result = future.result()
            if result["projects"]:
                map_results[result["city"]] = result

    province_by_name = {
        feature["properties"]["name"]: feature
        for feature in province_geo["features"]
        if feature.get("properties", {}).get("name")
    }
    province_geo_cache: dict[int, dict] = {}
    output_cities: dict[str, dict] = {}
    warnings: list[str] = []

    for city in monitored:
        city_name = city["city"]
        province_name = city["province"]
        result = map_results.get(city_name)
        if not result:
            warnings.append(f"{city_name}: no Fang map data or supported slug")
            continue

        province_feature = province_by_name.get(province_name)
        if not province_feature:
            warnings.append(f"{city_name}: province feature not found: {province_name}")
            continue

        province_adcode = province_feature.get("properties", {}).get("adcode")
        try:
            if province_adcode not in province_geo_cache:
                province_geo_cache[province_adcode] = fetch_geo(province_adcode)
            province_children = province_geo_cache[province_adcode].get("features", [])
        except Exception as error:
            warnings.append(f"{city_name}: province GeoJSON failed: {error}")
            continue

        # Municipalities expose districts directly in their province GeoJSON.
        municipality_districts = [
            feature for feature in province_children
            if feature.get("properties", {}).get("level") == "district"
        ]
        if municipality_districts:
            city_geo = province_feature
            city_geo_features = municipality_districts
        else:
            city_geo = next((
                feature for feature in province_children
                if normalize_name(feature.get("properties", {}).get("name", "")) == normalize_name(city_name)
            ), None)
            if not city_geo:
                warnings.append(f"{city_name}: city feature not found in {province_name}")
                continue

            # County-level cities without official district subdivisions have
            # no DataV children; Fang often returns towns/functional areas, so
            # skip rather than mapping them to incorrect counties.
            if int(city_geo.get("properties", {}).get("childrenNum", 0) or 0) <= 0:
                warnings.append(f"{city_name}: no county-level administrative children")
                continue
            city_adcode = city_geo.get("properties", {}).get("adcode")
            try:
                city_geo_payload = fetch_geo(city_adcode)
                city_geo_features = city_geo_payload.get("features", [])
            except Exception as error:
                warnings.append(f"{city_name}: district GeoJSON failed: {error}")
                continue

        feature_names = [
            feature.get("properties", {}).get("name")
            for feature in city_geo_features
            if feature.get("properties", {}).get("name")
        ]
        districts: list[dict] = []
        unmatched: list[str] = []
        for project in result["projects"]:
            source_name = str(project.get("name", "")).strip()
            price = project.get("price")
            matched_name = match_district(source_name, feature_names)
            if not matched_name or not isinstance(price, (int, float)) or price <= 0:
                unmatched.append(source_name)
                continue
            districts.append({
                "name": matched_name,
                "sourceName": source_name,
                "price": price,
                "unit": "元/平方米",
                "sourceUrl": unquote(project.get("url", "").replace("//fangjia.fang.com", "https://fangjia.fang.com")),
                "fangCode": code_from_url(project.get("url", "")),
            })

        if not districts:
            warnings.append(f"{city_name}: map data could not be matched to administrative districts")
            continue

        output_cities[city_name] = {
            "province": province_name,
            "fangSlug": result["slug"],
            "sourceUrl": f"https://fangjia.fang.com/{result['slug']}/",
            "districts": sorted(districts, key=lambda item: item["name"]),
            "unmatchedSourceNames": sorted(set(unmatched)),
        }

    output = {
        "schemaVersion": 1,
        "source": "Fang.com housing-price map API",
        "sourceUrlTemplate": "https://fangjia.fang.com/fangjia/map/getmapdata/{citySlug}",
        "indicator": "区县二手房挂牌参考均价",
        "period": f"{dt.date.today():%Y-%m}",
        "scrapedAt": dt.datetime.now().replace(microsecond=0).isoformat(),
        "cityCoverage": len(output_cities),
        "districtCoverage": sum(len(item["districts"]) for item in output_cities.values()),
        "cities": output_cities,
        "warnings": warnings,
    }
    (DATA_DIR / "district-prices.json").write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"District coverage: {output['districtCoverage']} districts in {output['cityCoverage']} cities")
    print(f"Warnings: {len(warnings)}")
    for warning in warnings:
        print(f"WARNING: {warning}")


if __name__ == "__main__":
    main()
