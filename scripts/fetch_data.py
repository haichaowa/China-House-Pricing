#!/usr/bin/env python3
"""Fetch public China Index Academy price index data and refresh data/prices.json."""

from __future__ import annotations

import datetime as dt
import json
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36"

CITY_TO_PROVINCE = {
    "三亚": "海南省", "上海": "上海市", "东莞": "广东省", "东营": "山东省",
    "中山": "广东省", "临沂": "山东省", "乌鲁木齐": "新疆维吾尔自治区", "佛山": "广东省",
    "保定": "河北省", "兰州": "甘肃省", "包头": "内蒙古自治区", "北京": "北京市",
    "北海": "广西壮族自治区", "南京": "江苏省", "南宁": "广西壮族自治区", "南昌": "江西省",
    "南通": "江苏省", "厦门": "福建省", "台州": "浙江省", "合肥": "安徽省",
    "呼和浩特": "内蒙古自治区", "哈尔滨": "黑龙江省", "唐山": "河北省", "嘉兴": "浙江省",
    "大连": "辽宁省", "天津": "天津市", "太原": "山西省", "威海": "山东省",
    "宁波": "浙江省", "宜昌": "湖北省", "宿迁": "江苏省", "常州": "江苏省",
    "常熟": "江苏省", "广州": "广东省", "廊坊": "河北省", "张家口": "河北省",
    "张家港": "江苏省", "徐州": "江苏省", "德州": "山东省", "惠州": "广东省",
    "成都": "四川省", "扬州": "江苏省", "新乡": "河南省", "无锡": "江苏省",
    "昆山": "江苏省", "昆明": "云南省", "杭州": "浙江省", "柳州": "广西壮族自治区",
    "株洲": "湖南省", "桂林": "广西壮族自治区", "武汉": "湖北省", "汕头": "广东省",
    "江门": "广东省", "江阴": "江苏省", "沈阳": "辽宁省", "泉州": "福建省",
    "泰州": "江苏省", "洛阳": "河南省", "济南": "山东省", "济宁": "山东省",
    "海口": "海南省", "淄博": "山东省", "淮安": "江苏省", "深圳": "广东省",
    "温州": "浙江省", "湖州": "浙江省", "湘潭": "湖南省", "湛江": "广东省",
    "漳州": "福建省", "潍坊": "山东省", "烟台": "山东省", "珠海": "广东省",
    "盐城": "江苏省", "石家庄": "河北省", "福州": "福建省", "秦皇岛": "河北省",
    "绍兴": "浙江省", "绵阳": "四川省", "聊城": "山东省", "肇庆": "广东省",
    "芜湖": "安徽省", "苏州": "江苏省", "菏泽": "山东省", "衡水": "河北省",
    "西宁": "青海省", "西安": "陕西省", "贵阳": "贵州省", "赣州": "江西省",
    "连云港": "江苏省", "邯郸": "河北省", "郑州": "河南省", "重庆": "重庆市",
    "金华": "浙江省", "银川": "宁夏回族自治区", "镇江": "江苏省", "长春": "吉林省",
    "长沙": "湖南省", "阜阳": "安徽省", "青岛": "山东省", "马鞍山": "安徽省",
}


def curl(url: str) -> str:
    result = subprocess.run(
        [
            "curl",
            "--fail",
            "--location",
            "--silent",
            "--show-error",
            "--max-time",
            "40",
            "--retry",
            "3",
            "--retry-all-errors",
            "-A",
            UA,
            url,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout


def initial_state(html: str) -> dict:
    match = re.search(r"window\.__INITIAL_STATE__\s*=\s*(\{.*?\});?</script>", html, re.S)
    if not match:
        raise RuntimeError("Could not find window.__INITIAL_STATE__")
    return json.loads(match.group(1))["data"]


def initial_state_from_url(url: str, attempts: int = 5) -> dict:
    """Retry CIH pages because the CDN intermittently redirects to a portal page."""
    last_error = None
    for attempt in range(attempts):
        try:
            return initial_state(curl(url))
        except Exception as error:
            last_error = error
    raise RuntimeError(f"Could not parse {url} after {attempts} attempts: {last_error}")


def curl_until_marker(url: str, marker: str, attempts: int = 5) -> str:
    for _attempt in range(attempts):
        html = curl(url)
        if marker in html:
            return html
    raise RuntimeError(f"Could not load expected marker {marker!r} from {url}")


def city_detail_slugs(index_html: str) -> dict[str, str]:
    """Extract CIH city detail slugs from the current data-index bundle."""
    script_match = re.search(
        r'<script[^>]+src="(https://cihwebstatic\.soufunimg\.com/[^"]+data/data-index/index\.[^"]+\.js)"',
        index_html,
    )
    if not script_match:
        raise RuntimeError("Could not find the data-index JavaScript bundle")

    bundle = curl(script_match.group(1))
    mappings = re.findall(
        r'\{credCityId:"([^"]+)",cityName:"([^"]+)",pinyin:"([^"]+)"\}',
        bundle,
    )
    return {
        city_id.lower(): pinyin.replace("’", "").replace("'", "").lower()
        for city_id, _city_name, pinyin in mappings
    }


def normalize_history(rows: list[dict]) -> list[dict]:
    return [
        {
            "date": row["date"],
            "average": row.get("average"),
            "mom": row.get("averageHuanBi"),
            "yoy": row.get("averageTongBi"),
            "median": row.get("median"),
        }
        for row in sorted(rows, key=lambda item: item["date"])
    ]


def fetch_one_city_history(city: dict, slug: str) -> tuple[dict | None, str | None]:
    url = f"https://www.cih-index.com/data/index/city/{slug}.html"
    try:
        page = initial_state_from_url(url, attempts=3)
        if page.get("id", "").lower() != city["cityId"].lower():
            return None, f"{city['city']}: slug {slug} resolves to {page.get('cityName')}"
        if not page.get("newHouseChartData") or not page.get("esfHouseChartData"):
            return None, f"{city['city']}: no 12-month chart data"
        return (
            {
                "city": city["city"],
                "cityId": city["cityId"],
                "newHouse": normalize_history(page["newHouseChartData"]),
                "esfHouse": normalize_history(page["esfHouseChartData"]),
            },
            None,
        )
    except Exception as error:  # return per-city failures rather than losing all data
        return None, f"{city['city']}: {error}"


def fetch_city_histories(current_page: dict, slugs: dict[str, str]) -> tuple[dict[str, dict], list[str]]:
    warnings: list[str] = []
    histories: dict[str, dict] = {}

    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {
            executor.submit(fetch_one_city_history, item, slugs[item["cityId"].lower()]): item
            for item in current_page["cityIndexInfo"]
            if item["cityId"].lower() in slugs
        }
        for future in as_completed(futures):
            history, warning = future.result()
            if history:
                histories[history["city"]] = history
            if warning:
                warnings.append(warning)

    return histories, warnings


def normalize_market(page: dict) -> dict:
    cities = []
    for item in page["cityIndexInfo"]:
        province = CITY_TO_PROVINCE.get(item["city"])
        if not province:
            raise RuntimeError(f"Add a province mapping for {item['city']}")
        cities.append(
            {
                "city": item["city"],
                "province": province,
                "average": item.get("average"),
                "unit": item.get("averageUnit"),
                "mom": item.get("averageHuanBi"),
                "yoy": item.get("averageTongBi"),
                "median": item.get("median"),
            }
        )
    return {
        "date": page["topInfoDate"],
        "summary": page["topInfo"],
        "cities": cities,
        "trend": sorted(page["chartData"], key=lambda item: item["date"]),
        "sourceUrl": f"https://www.cih-index.com/data/index/{page['type']}.html",
    }


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    output = {
        "schemaVersion": 2,
        "source": "China Index Academy public price index pages",
        "sourceUrls": {
            "newHouse": "https://www.cih-index.com/data/index/newHouse.html",
            "esfHouse": "https://www.cih-index.com/data/index/esfHouse.html",
            "cityDetail": "https://www.cih-index.com/data/index/city/<city>.html",
            "map": "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json",
        },
        "scrapedAt": dt.datetime.now().replace(microsecond=0).isoformat(),
    }
    market_pages: dict[str, dict] = {}
    for market in ("newHouse", "esfHouse"):
        market_pages[market] = initial_state_from_url(output["sourceUrls"][market])
        output[market] = normalize_market(market_pages[market])
        if len(output[market]["cities"]) != 100:
            raise RuntimeError(f"Expected 100 cities for {market}, got {len(output[market]['cities'])}")

    slugs = city_detail_slugs(curl_until_marker(
        output["sourceUrls"]["newHouse"],
        "window.__INITIAL_STATE__",
    ))
    histories, warnings = fetch_city_histories(market_pages["newHouse"], slugs)
    for market in ("newHouse", "esfHouse"):
        for city in output[market]["cities"]:
            history = histories.get(city["city"], {}).get(market)
            if history:
                city["history"] = history
        output[market]["historicalCoverage"] = sum(
            1 for city in output[market]["cities"] if city.get("history")
        )
    output["dataWarnings"] = warnings

    map_path = DATA_DIR / "china-provinces.geojson"
    if not map_path.exists():
        map_path.write_text(curl(output["sourceUrls"]["map"]), encoding="utf-8")

    (DATA_DIR / "prices.json").write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Historical coverage: newHouse={output['newHouse']['historicalCoverage']}, esfHouse={output['esfHouse']['historicalCoverage']}")
    for warning in warnings:
        print(f"WARNING: {warning}")
    print(f"Updated {DATA_DIR / 'prices.json'}")


if __name__ == "__main__":
    main()
