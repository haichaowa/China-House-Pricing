# China House Pricing

China House Pricing is a lightweight interactive prototype for exploring China housing prices on a map. Click a province to zoom in and inspect monitored-city prices, month-over-month change, and year-over-year change. The prototype also compares new-home and second-hand markets and shows a 12-month national trend.

> Repository name follows the requested project title: **China House Pricing**.

**Online demo:** <https://haichaowa.github.io/China-House-Pricing/>

## Features

- China province map with animated zoom on click
- Province → city → district drill-down with dynamically loaded administrative boundaries
- Twelve-month time slider and playback for historical national, province, and monitored-city prices
- New-home and second-hand market toggle
- Province color based on the median monitored-city sample price
- City cards with sample average price, MoM, and YoY
- 12-month national sample-price trend
- Esc returns to the national map; mouse wheel and drag support roaming
- Full source inventory and credibility notes in [`docs/data-sources.md`](./docs/data-sources.md)

## Run locally

Because the app fetches local JSON and GeoJSON, use a local HTTP server rather than opening `index.html` directly:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

During interactive debugging, keep changes local. The GitHub Pages workflow is manual-only and should not be run until the province/city/district flows have passed local QA.

No build system is required. ECharts is loaded from jsDelivr.

## Refresh public data

The current snapshot is from the public China Index Academy pages and is stored in `data/prices.json`.

Refresh it with:

```bash
python3 scripts/fetch_data.py
python3 scripts/validate.py
```

The script reads:

- <https://www.cih-index.com/data/index/newHouse.html>
- <https://www.cih-index.com/data/index/esfHouse.html>
- <https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json>

## Data caveats

This is a visualization prototype, not an official statistical release.

- City values are China Index Academy sample average prices, not transaction records.
- District boundaries come from DataV GeoAtlas. There is no single authoritative nationwide district-level housing-price open dataset, so district prices are shown as pending data. A parent city's sample price is displayed only as a clearly labeled reference.
- Historical city values are collected from China Index Academy city detail pages. The current public source exposes 12-month histories for 99 of the 100 monitored cities; missing values are shown as `--`.
- Province colors use the median of monitored cities and are not an official province-wide average.
- The 100 monitored cities over-represent Jiangsu, Guangdong, Shandong, Zhejiang, and Hebei, so province comparisons are indicative only.
- Tibet has no city in the current monitored sample and is therefore shown as no-data.
- The China Index Academy series and the NBS 70-city price index have different methods and cannot be mixed in one trend line.
- For official trend analysis, use [National Bureau of Statistics 70-city price indices](https://www.stats.gov.cn/sj/zxfb/).
- For formal publication inside China, replace the DataV GeoAtlas demo boundary with a compliant official map service.

## Project structure

```text
index.html
styles.css
app.js
data/prices.json
data/china-provinces.geojson
docs/data-sources.md
scripts/fetch_data.py
scripts/validate.py
```
