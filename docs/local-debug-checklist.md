# Local debug checklist

Use `python3 -m http.server 8000` and open <http://localhost:8000>.

## Required browser checks

- [x] Initial national map and price cards load without console errors
- [x] `广东省 → 广州市 → 天河区` drill-down works
- [x] Selecting a district preserves the current map zoom and selection
- [x] `北京市 → 西城区` works for a municipality that goes directly to districts
- [x] New-home and second-hand toggles update district cards while retaining the selected area
- [x] Breadcrumb navigation works from `全国 / 广东省 / 广州市 / 天河区`
- [x] `上一级` returns from city to province
- [x] `Esc` returns to the national map
- [x] DataV province and district GeoJSON requests return HTTP 200
- [x] Loading overlay is removed after data initialization
- [x] Mobile layout at 390×844 has no horizontal overflow
- [x] No browser console errors or warnings

## Current local result

Passed on 2026-09-27 against `main` after the province/city/district drill-down implementation.

Deployment policy during debugging: the GitHub Pages workflow is manual-only. Do not dispatch it or push until local QA is accepted.
