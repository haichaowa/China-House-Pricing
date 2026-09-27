# Local debug checklist

Use `python3 -m http.server 8000` and open <http://localhost:8000>.

## Required browser checks

- [x] Initial national map and price cards load without console errors
- [x] `广东省 → 广州市 → 天河区` drill-down works
- [x] Explicit province/city/district dropdowns work when map clicking is impractical
- [x] `广东省 → 东莞市` works for a districtless prefecture-level city
- [x] `海南省 → 五指山市` and `海南省 → 定安县` work for province-direct county-level units
- [x] Selecting a district zooms the viewport to the selected district boundary
- [x] Selecting a district preserves the current map zoom and selection
- [x] `北京市 → 西城区` works for a municipality that goes directly to districts
- [x] New-home and second-hand toggles update district cards while retaining the selected area
- [x] Breadcrumb navigation works from `全国 / 广东省 / 广州市 / 天河区`
- [x] `上一级` returns from city to province
- [x] `Esc` returns to the national map
- [x] DataV province and district GeoJSON requests return HTTP 200
- [x] Loading overlay is removed after data initialization
- [x] Mobile layout at 390×844 has no horizontal overflow
- [x] Twelve-month time slider switches national, province, city, and district cards
- [x] Time playback advances from the oldest month and stops at the latest month
- [x] Dragging the time slider shows a persistent value bubble, mini trend, and current MoM/YoY without hovering the main chart
- [x] Time-panel HTML nesting and slider value-bubble edge alignment corrected
- [x] Overlapping province/city/district map labels are hidden automatically
- [x] District prices are not filled with the parent-city price; pending data and a separate city reference are shown
- [x] Fang.com district reference prices display for second-hand mode and remain pending in new-home mode
- [x] Municipality districts such as `北京市 → 西城区` receive the correct district-level reference price
- [x] Historical coverage reports 99/100 monitored cities
- [x] No browser console errors or warnings

## Current local result

Passed on 2026-09-27 against `main` after the province/city/district drill-down implementation.

Deployment policy during debugging: the GitHub Pages workflow is manual-only. Do not dispatch it or push until local QA is accepted.
