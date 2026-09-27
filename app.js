const priceFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const compactFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const GEO_BASE = "https://geo.datav.aliyun.com/areas_v3/bound";

const state = {
  market: "newHouse",
  prices: null,
  districtPrices: null,
  nationalGeo: null,
  geoCache: new Map(),
  mapChart: null,
  trendChart: null,
  path: [],
  selectedName: null,
  timeIndex: null,
  playbackTimer: null,
  mapCenter: [104.8, 36.2],
  mapZoom: 1.18,
};

const labels = {
  newHouse: { name: "新建住宅", short: "新房" },
  esfHouse: { name: "二手住宅", short: "二手房" },
};

async function loadJson(url, cacheMode = "default") {
  const response = await fetch(url, { cache: cacheMode });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function loadAreaGeo(adcode) {
  if (state.geoCache.has(adcode)) return state.geoCache.get(adcode);
  setStatus("正在加载行政区边界…");
  const geo = await loadJson(`${GEO_BASE}/${adcode}_full.json`);
  state.geoCache.set(adcode, geo);
  setStatus("");
  return geo;
}

function setStatus(message) {
  const element = document.querySelector("#map-status");
  element.textContent = message;
  element.classList.toggle("is-visible", Boolean(message));
}

function median(values) {
  const nums = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return null;
  const middle = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[middle] : (nums[middle - 1] + nums[middle]) / 2;
}

function average(values) {
  const nums = values.filter(Number.isFinite);
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
}

function normalizeAreaName(name) {
  return String(name || "")
    .replace(/(市|特别行政区|自治区|维吾尔|回族|壮族|自治州|地区|盟|林区)$/u, "")
    .replace(/(壮族|回族|维吾尔)?自治[区县]$/u, "");
}

function provinceStats(data, province = null) {
  const cities = province ? data.cities.filter((city) => city.province === province) : data.cities;
  return {
    cities,
    count: cities.filter((city) => Number.isFinite(city.average)).length,
    medianPrice: median(cities.map((city) => city.average)),
    averagePrice: average(cities.map((city) => city.average)),
    averageMom: average(cities.map((city) => city.mom)),
    averageYoy: average(cities.map((city) => city.yoy)),
  };
}

function allProvinceStats(data) {
  return new Map(
    [...new Set(data.cities.map((city) => city.province))].map((province) => [
      province,
      provinceStats(data, province),
    ]),
  );
}

function currentPathItem(levelOffset = 0) {
  return state.path.at(Math.max(0, state.path.length - 1 + levelOffset)) ?? null;
}

function activeTrend() {
  return [...state.prices[state.market].trend].sort((a, b) => a.date.localeCompare(b.date));
}

function activeDate() {
  const trend = activeTrend();
  if (!trend.length) return state.prices[state.market].date;
  const index = Math.min(Math.max(state.timeIndex ?? trend.length - 1, 0), trend.length - 1);
  return trend[index].date;
}

function activeNationalRecord() {
  return activeTrend().find((item) => item.date === activeDate()) ?? state.prices[state.market].summary;
}

function cityAtTime(city) {
  const date = activeDate();
  const history = city.history?.find((item) => item.date === date);
  if (history) {
    return {
      ...city,
      average: history.average,
      mom: history.mom,
      yoy: history.yoy,
      median: history.median,
    };
  }
  if (date === state.prices[state.market].date) return city;
  return { ...city, average: NaN, mom: NaN, yoy: NaN, median: NaN };
}

function activeMarketData() {
  const base = state.prices[state.market];
  const national = activeNationalRecord();
  return {
    ...base,
    date: activeDate(),
    summary: {
      ...base.summary,
      average: national.average,
      median: national.median,
      averageHuanBi: national.averageHuanBi,
      averageTongBi: national.averageTongBi,
    },
    cities: base.cities.map(cityAtTime),
  };
}

function findCityRecord(name, provinceName = null) {
  const data = activeMarketData();
  const target = normalizeAreaName(name);
  return data.cities.find((city) => {
    const provinceMatches = !provinceName || city.province === provinceName;
    return provinceMatches && normalizeAreaName(city.city) === target;
  }) ?? null;
}

function districtPriceContext() {
  const provinceName = currentProvinceName();
  return currentCityName() ?? provinceName;
}

function findDistrictRecord(districtName, cityName = districtPriceContext()) {
  if (state.market !== "esfHouse" || !districtName || !cityName) return null;
  const cityEntries = Object.entries(state.districtPrices?.cities ?? {});
  const cityEntry = cityEntries.find(([name, item]) => (
    normalizeAreaName(name) === normalizeAreaName(cityName)
    && (!currentProvinceName() || item.province === currentProvinceName())
  )) ?? cityEntries.find(([name]) => normalizeAreaName(name) === normalizeAreaName(cityName));
  const districts = cityEntry?.[1]?.districts ?? [];
  return districts.find((item) => normalizeAreaName(item.name) === normalizeAreaName(districtName)) ?? null;
}

function currentProvinceName() {
  return state.path.find((item) => item.level === "province")?.name ?? null;
}

function currentCityName() {
  return state.path.findLast((item) => item.level === "city")?.name ?? null;
}

function activeFeature(name = state.selectedName) {
  const current = currentPathItem();
  if (!current?.geo) return null;
  return current.geo.features.find((feature) => feature.properties?.name === name) ?? null;
}

function currentMapData() {
  const data = activeMarketData();
  const current = currentPathItem();
  const mapCurrent = current?.level === "selected" ? currentPathItem(-1) : current;

  if (!mapCurrent || mapCurrent.level === "country") {
    return [...allProvinceStats(data)].map(([name, stats]) => ({
      name,
      value: stats.medianPrice,
      count: stats.count,
      averageMom: stats.averageMom,
      averageYoy: stats.averageYoy,
      scope: "province",
    }));
  }

  return mapCurrent.geo.features
    .filter((feature) => feature.properties?.name)
    .map((feature) => {
      const properties = feature.properties;
      const provinceName = currentProvinceName();
      let city = null;
      let scope = "district";

      if (mapCurrent.level === "province") {
        if (properties.level === "district") {
          city = findCityRecord(provinceName ?? properties.name, provinceName);
          scope = "district-in-municipality";
        } else {
          city = findCityRecord(properties.name, provinceName);
          scope = "city";
        }
      } else if (mapCurrent.level === "city") {
        city = findCityRecord(mapCurrent.name, provinceName);
      }

      const isDistrict = scope === "district" || scope === "district-in-municipality";
      const districtRecord = isDistrict ? findDistrictRecord(properties.name) : null;

      return {
        name: properties.name,
        value: isDistrict
          ? districtRecord?.price ?? NaN
          : city?.average ?? NaN,
        count: city ? 1 : 0,
        referencePrice: city?.average ?? null,
        averageMom: isDistrict ? null : city?.mom ?? null,
        averageYoy: isDistrict ? null : city?.yoy ?? null,
        referenceMom: city?.mom ?? null,
        referenceYoy: city?.yoy ?? null,
        city: city?.city ?? null,
        districtSource: districtRecord ? "房天下二手房挂牌参考价" : null,
        districtPeriod: districtRecord ? state.districtPrices.period : null,
        scope,
        itemStyle: properties.name === state.selectedName
          ? {
              areaColor: "rgba(75, 212, 196, 0.65)",
              borderColor: "#eef3ff",
              borderWidth: 1.5,
            }
          : undefined,
      };
    });
}

function setMapOption(animation = true, preserveView = false) {
  const current = currentPathItem();
  const mapName = current?.mapName ?? "china";
  const level = current?.level ?? "country";
  const mapData = currentMapData();

  if (preserveView) {
    const existingSeries = state.mapChart?.getOption()?.series?.find((series) => series.id === "admin-map");
    if (existingSeries?.zoom) state.mapZoom = existingSeries.zoom;
    if (Array.isArray(existingSeries?.center)) state.mapCenter = existingSeries.center;
  }

  state.mapChart.setOption({
    backgroundColor: "transparent",
    tooltip: {
      trigger: "item",
      backgroundColor: "rgba(8, 12, 24, 0.94)",
      borderColor: "rgba(125, 154, 210, 0.35)",
      textStyle: { color: "#eef3ff", fontSize: 12 },
      formatter: (params) => {
        const isDistrict = ["district", "district-in-municipality"].includes(params.data.scope);
        if (isDistrict) {
          if (Number.isFinite(params.value)) {
            return [
              `<strong>${params.name}</strong>`,
              `区县二手挂牌参考价：${priceFormatter.format(params.value)} 元/㎡`,
              `口径：房天下房价地图 ${params.data.districtPeriod}`,
              "注意：挂牌参考价，非官方成交价",
            ].join("<br/>");
          }
          return [
            `<strong>${params.name}</strong>`,
            "区县样本价：待接入",
            `所属城市：${params.data.city ?? "--"}`,
            `城市参考价：${Number.isFinite(params.data.referencePrice) ? `${priceFormatter.format(params.data.referencePrice)} 元/㎡` : "--"}`,
            `城市环比：${formatChange(params.data.referenceMom)}`,
            `城市同比：${formatChange(params.data.referenceYoy)}`,
          ].join("<br/>");
        }
        if (!Number.isFinite(params.value)) return `<strong>${params.name}</strong><br/>该行政区未在百城样本中`;
        return [
          `<strong>${params.name}</strong>`,
          isDistrict ? `所属城市：${params.data.city ?? "--"}` : "城市样本",
          `样本均价：${priceFormatter.format(params.value)} 元/㎡`,
          `环比：${formatChange(params.data.averageMom)}`,
          `同比：${formatChange(params.data.averageYoy)}`,
        ].join("<br/>");
      },
    },
      visualMap: {
      type: "piecewise",
      min: 5000,
      max: 65000,
        splitNumber: 7,
        show: mapData.some((item) => Number.isFinite(item.value)),
      left: 14,
      bottom: 52,
      calculable: true,
      orient: "vertical",
      itemWidth: 12,
      itemHeight: 12,
      textStyle: { color: "#9dacc8", fontSize: 10 },
      inRange: { color: ["#155e75", "#0f766e", "#65a30d", "#d97706", "#dc2626", "#7c1d6f"] },
      formatter: (value) => `${Math.round(value / 1000)}k`,
    },
    series: [{
      id: "admin-map",
      type: "map",
      map: mapName,
      roam: true,
      scaleLimit: { min: 0.65, max: 12 },
      zoom: state.mapZoom,
      center: state.mapCenter,
      selectedMode: false,
      aspectScale: 0.82,
      label: {
        show: level !== "country",
        color: "rgba(238,243,255,0.82)",
        fontSize: level === "city" ? 10 : 11,
      },
      labelLayout: { hideOverlap: true },
      emphasis: {
        label: { show: true, fontWeight: 700 },
        itemStyle: { areaColor: "#4bd4c4", shadowBlur: 18, shadowColor: "rgba(75,212,196,0.5)" },
      },
      itemStyle: {
        areaColor: "rgba(38, 48, 73, 0.72)",
        borderColor: "rgba(169, 190, 229, 0.42)",
        borderWidth: 0.7,
      },
          data: mapData,
    }],
    animation,
    animationDuration: 850,
    animationDurationUpdate: 800,
    animationEasing: "cubicInOut",
  }, { lazyUpdate: true, replaceMerge: ["series"] });
}

function formatPrice(value) {
  return Number.isFinite(value) ? `${priceFormatter.format(value)} 元/㎡` : "暂无数据";
}

function formatChange(value) {
  if (!Number.isFinite(value)) return "--";
  return `${value > 0 ? "+" : ""}${compactFormatter.format(value)}%`;
}

function changeClass(value) {
  if (!Number.isFinite(value)) return "";
  return value > 0 ? "up" : value < 0 ? "down" : "";
}

function summaryCard(label, value, meta, valueClass = "") {
  return `<article class="summary-card">
    <p class="label">${label}</p>
    <span class="value ${valueClass}">${value}</span>
    <span class="meta">${meta}</span>
  </article>`;
}

function renderBreadcrumb() {
  const items = [{ level: "country", name: "全国" }, ...state.path];
  document.querySelector("#breadcrumb").innerHTML = items.map((item, index) => {
    const content = index === items.length - 1
      ? `<span class="current">${item.name}</span>`
      : `<button type="button" data-index="${index}">${item.name}</button>`;
    return `${index ? '<span class="separator">/</span>' : ""}${content}`;
  }).join("");

  document.querySelectorAll("#breadcrumb button").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      if (index === 0) goCountry();
      else goToPathIndex(index);
    });
  });
}

function selectedAreaItems() {
  const province = state.path.find((item) => item.level === "province") ?? null;
  const city = state.path.findLast((item) => item.level === "city") ?? null;
  const district = state.path.findLast((item) => item.level === "selected") ?? null;
  return { province, city, district };
}

function childFeatures(item) {
  return item?.geo?.features?.filter((feature) => feature.properties?.name) ?? [];
}

function setSelectOptions(select, placeholder, options, selectedName = null) {
  select.innerHTML = `<option value="">${placeholder}</option>` + options
    .map((feature) => {
      const name = feature.properties.name;
      return `<option value="${name}" ${name === selectedName ? "selected" : ""}>${name}</option>`;
    })
    .join("");
  select.disabled = options.length === 0;
}

function renderAreaControls() {
  const provinceSelect = document.querySelector("#area-province");
  const citySelect = document.querySelector("#area-city");
  const districtSelect = document.querySelector("#area-district");
  const { province, city, district } = selectedAreaItems();
  const selectedCityName = district?.feature?.properties?.level === "city"
    ? district.name
    : city?.name;
  const provinceFeatures = state.nationalGeo.features
    .filter((feature) => feature.properties?.level === "province" && feature.properties?.name);

  setSelectOptions(provinceSelect, "请选择省份", provinceFeatures, province?.name);

  const municipalityDistricts = province?.geo.features.some((feature) => feature.properties?.level === "district");
  const cityFeatures = province && !municipalityDistricts
    ? childFeatures(province).filter((feature) => feature.properties.level === "city")
    : [];
  setSelectOptions(
    citySelect,
    municipalityDistricts ? "直辖市：请选择区县" : province ? "请选择市 / 州 / 县" : "请先选择省份",
    cityFeatures,
    selectedCityName,
  );

  const districtFeatures = city
    ? childFeatures(city).filter((feature) => feature.properties.level === "district")
    : municipalityDistricts
      ? childFeatures(province).filter((feature) => feature.properties.level === "district")
      : [];
  setSelectOptions(
    districtSelect,
    city || municipalityDistricts ? "请选择区县 / 县级市" : "请先选择城市",
    districtFeatures,
    district?.feature?.properties?.level === "district" ? district.name : null,
  );
}

function renderSummary() {
  const data = activeMarketData();
  const current = currentPathItem();
  const provinceName = currentProvinceName();
  const selectedFeature = activeFeature();
  let title = "全国百城";
  let listTitle = "价格最高监测城市";
  let rows = [...data.cities]
    .sort((a, b) => (b.average ?? -1) - (a.average ?? -1))
    .slice(0, 8)
    .map((city) => ({
      name: city.city,
      price: city.average,
      mom: city.mom,
      yoy: city.yoy,
      note: "城市样本",
      level: "city",
    }));
  let summary;

  if (current?.level === "province") {
    summary = provinceStats(data, current.name);
    title = current.name;
    listTitle = current.geo.features.some((feature) => feature.properties?.level === "district")
      ? "直辖市辖区 / 新区"
      : "城市 / 行政单位";
    rows = current.geo.features.filter((feature) => feature.properties?.name).map((feature) => {
      const properties = feature.properties;
      const city = properties.level === "district"
        ? findCityRecord(current.name, current.name)
        : findCityRecord(properties.name, current.name);
      const isDistrictRow = properties.level === "district";
      const districtRecord = isDistrictRow ? findDistrictRecord(properties.name, current.name) : null;
      return {
        name: properties.name,
        price: isDistrictRow ? districtRecord?.price ?? NaN : city?.average,
        mom: isDistrictRow ? NaN : city?.mom,
        yoy: isDistrictRow ? NaN : city?.yoy,
        note: isDistrictRow
          ? districtRecord ? `房天下挂牌参考 ${state.districtPrices.period}` : "区县价格待接入"
          : city ? "城市样本" : "未监测",
        level: properties.level,
      };
    }).sort((a, b) => (b.price ?? -1) - (a.price ?? -1) || a.name.localeCompare(b.name, "zh-CN"));
  } else if (current?.level === "city" || selectedFeature) {
    const effectiveCurrent = current?.level === "selected" ? currentPathItem(-1) : current;
    const isMunicipalityDistrict = effectiveCurrent?.level === "province"
      && selectedFeature?.properties?.level === "district";
    const cityRecord = isMunicipalityDistrict
      ? findCityRecord(effectiveCurrent.name, effectiveCurrent.name)
      : findCityRecord(currentCityName() ?? effectiveCurrent?.name, provinceName)
        ?? findCityRecord(selectedFeature?.properties?.name, provinceName)
        ?? findCityRecord(effectiveCurrent?.name, provinceName);
    const sourceFeatures = effectiveCurrent?.level === "city"
      ? effectiveCurrent.geo.features
      : current?.level === "selected" && selectedFeature?.properties?.level === "city"
        ? [selectedFeature]
      : (currentPathItem(-1)?.geo.features ?? []);
    title = selectedFeature?.properties?.name ?? current?.name ?? title;
    summary = {
      count: 1,
      medianPrice: cityRecord?.average ?? null,
      averageMom: cityRecord?.mom ?? null,
      averageYoy: cityRecord?.yoy ?? null,
      city: cityRecord,
    };
    listTitle = effectiveCurrent?.level === "city" ? "区县 / 县级行政区" : "当前层级行政区";
    rows = sourceFeatures.filter((feature) => feature.properties?.name).map((feature) => {
      const districtRecord = feature.properties.level === "district"
        ? findDistrictRecord(feature.properties.name, districtPriceContext())
        : null;
      return {
        name: feature.properties.name,
        price: feature.properties.level === "district" ? districtRecord?.price ?? NaN : cityRecord?.average,
        mom: feature.properties.level === "district" ? NaN : cityRecord?.mom,
        yoy: feature.properties.level === "district" ? NaN : cityRecord?.yoy,
        note: feature.properties.level === "district"
          ? districtRecord ? `房天下挂牌参考 ${state.districtPrices.period}` : "区县价格待接入"
          : cityRecord ? "城市样本" : "未监测",
        level: feature.properties.level,
      };
    }).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  } else {
    summary = {
      count: data.cities.length,
      medianPrice: data.summary.average,
      averageMom: data.summary.averageHuanBi,
      averageYoy: data.summary.averageTongBi,
    };
  }

  document.querySelector("#region-title").textContent = title;
  document.querySelector("#region-type").textContent = labels[state.market].name;
  document.querySelector("#city-list-title").textContent = listTitle;
  document.querySelector("#city-count").textContent = `${rows.length} 个行政区`;

  const isDistrict = selectedFeature?.properties?.level === "district";
  const selectedDistrictRecord = isDistrict ? findDistrictRecord(selectedFeature.properties.name) : null;
  document.querySelector("#summary-cards").innerHTML = [
    summaryCard(
      isDistrict
        ? state.market === "esfHouse" ? "区县挂牌参考价" : "区县新房价格"
        : "样本价格",
      isDistrict
        ? selectedDistrictRecord
          ? formatPrice(selectedDistrictRecord.price)
          : "待接入"
        : formatPrice(summary.medianPrice),
      isDistrict
        ? selectedDistrictRecord
          ? `房天下 ${state.districtPrices.period} · 挂牌参考`
          : state.market === "esfHouse"
            ? "该区县暂无公开挂牌参考价"
            : "暂无统一区县级新房公开价"
        : summary.city ? "城市样本均价" : "样本均价 / 中位数",
    ),
    summaryCard(
      isDistrict ? "所属城市参考价" : "监测样本",
      isDistrict ? formatPrice(summary.city?.average) : `${summary.count} 个`,
      isDistrict
        ? `${summary.city?.city ?? "--"}样本均价`
        : current?.level === "province"
          ? "该省有历史数据的监测城市"
          : current?.level === "city"
            ? "该市监测样本"
            : "全国监测城市",
    ),
    summaryCard(
      isDistrict ? "城市参考环比" : "环比变化",
      formatChange(summary.averageMom),
      isDistrict ? "所属城市样本，非区县环比" : "当前口径环比",
      changeClass(summary.averageMom),
    ),
    summaryCard(
      isDistrict ? "城市参考同比" : "同比变化",
      formatChange(summary.averageYoy),
      isDistrict
        ? "所属城市样本，非区县同比"
        : current?.level === "province"
          ? "该省监测城市同比均值"
          : current?.level === "city"
            ? "该市样本同比"
            : "全国百城同比",
      changeClass(summary.averageYoy),
    ),
  ].join("");

  document.querySelector("#city-list").innerHTML =
    `<div class="city-header"><span>行政区</span><span>${
      state.market === "esfHouse" && rows.some((row) => row.level === "district") ? "挂牌参考价" : "样本均价"
    }</span><span>环比</span><span>同比</span></div>` +
    rows.map((row) => `<div class="city-row ${row.name === state.selectedName ? "is-selected" : ""}" data-name="${row.name}" data-level="${row.level ?? "district"}">
      <span class="city-name">${row.name}<small>${row.note}</small></span>
      <span class="city-price">${Number.isFinite(row.price) ? priceFormatter.format(row.price) : "--"}</span>
      <span class="city-change ${changeClass(row.mom)}">${formatChange(row.mom)}</span>
      <span class="city-change ${changeClass(row.yoy)}">${formatChange(row.yoy)}</span>
    </div>`).join("");

  document.querySelectorAll(".city-row").forEach((row) => {
    row.addEventListener("click", () => selectOrEnterByName(row.dataset.name));
  });
}

function renderTrend() {
  const data = activeMarketData();
  const trend = [...data.trend].sort((a, b) => a.date.localeCompare(b.date));
  const current = currentPathItem();
  const provinceName = currentProvinceName();
  const selected = activeFeature();
  const focusCityName = currentCityName()
    ?? (selected?.properties?.level === "city" ? selected.name : null)
    ?? (selected?.properties?.level === "district" ? provinceName : null);
  const focusCity = focusCityName ? findCityRecord(focusCityName, provinceName) : null;
  const districtSelected = selected?.properties?.level === "district";
  const focusName = current?.level === "province"
    ? provinceName
    : districtSelected
      ? `${focusCity?.city ?? "所属城市"}参考`
      : focusCity?.city ?? "当前地区";
  const provinceTrend = provinceName ? trend.map((item) => {
    const values = state.prices[state.market].cities
      .filter((city) => city.province === provinceName)
      .map((city) => city.history?.find((history) => history.date === item.date)?.average ?? (
        item.date === state.prices[state.market].date ? city.average : NaN
      ));
    return median(values);
  }) : [];

  state.trendChart.setOption({
    backgroundColor: "transparent",
    grid: { left: 42, right: 14, top: 42, bottom: 28 },
    legend: {
      data: ["全国百城", focusName],
      textStyle: { color: "#9dacc8", fontSize: 10 },
      itemWidth: 12,
      itemHeight: 7,
      top: 0,
      right: 0,
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(8, 12, 24, 0.94)",
      borderColor: "rgba(125, 154, 210, 0.35)",
      textStyle: { color: "#eef3ff" },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: trend.map((item) => item.date),
      axisLine: { lineStyle: { color: "rgba(125,154,210,0.25)" } },
      axisLabel: { color: "#9dacc8", fontSize: 10 },
    },
    yAxis: {
      type: "value",
      scale: true,
      axisLabel: { color: "#9dacc8", fontSize: 10, formatter: (value) => `${Math.round(value / 1000)}k` },
      splitLine: { lineStyle: { color: "rgba(125,154,210,0.1)" } },
    },
    series: [{
      name: "全国百城",
      type: "line",
      smooth: true,
      symbolSize: 6,
      data: trend.map((item) => item.average),
      lineStyle: { width: 3, color: "#4bd4c4" },
      itemStyle: { color: "#4bd4c4" },
      markLine: {
        symbol: "none",
        label: { show: false },
        lineStyle: { color: "rgba(255,104,122,0.75)", type: "dashed", width: 1.5 },
        data: [{ xAxis: activeDate() }],
      },
      areaStyle: {
        color: {
          type: "linear",
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: "rgba(75,212,196,0.32)" },
            { offset: 1, color: "rgba(75,212,196,0)" },
          ],
        },
      },
    }, {
      name: focusName,
      type: "line",
      smooth: true,
      symbolSize: 5,
      data: current?.level === "province"
        ? provinceTrend
        : trend.map((item) => focusCity?.history?.find((history) => history.date === item.date)?.average ?? NaN),
      lineStyle: { width: 2, color: "#ff687a", type: "dashed" },
      itemStyle: { color: "#ff687a" },
      connectNulls: false,
    }],
    animationDuration: 1000,
  });
  document.querySelector("#trend-range").textContent = trend.length
    ? `${trend[0].date} 至 ${trend.at(-1).date}`
    : "";
}

function activeFocusTrend() {
  const trend = activeTrend();
  const current = currentPathItem();
  const provinceName = currentProvinceName();
  const selected = activeFeature();

  if (current?.level === "province" && provinceName) {
    return {
      name: provinceName,
      records: trend.map((item) => {
        const provinceCities = state.prices[state.market].cities
          .filter((city) => city.province === provinceName)
          .map((city) => city.history?.find((history) => history.date === item.date));
        return {
          date: item.date,
          average: median(provinceCities.map((history) => history?.average)),
          mom: average(provinceCities.map((history) => history?.mom)),
          yoy: average(provinceCities.map((history) => history?.yoy)),
        };
      }),
    };
  }

  const focusCityName = currentCityName()
    ?? (selected?.properties?.level === "city" ? selected.name : null)
    ?? (selected?.properties?.level === "district" ? provinceName : null);
  const city = focusCityName
    ? state.prices[state.market].cities.find((item) => item.province === (provinceName ?? item.province) && normalizeAreaName(item.city) === normalizeAreaName(focusCityName))
    : null;

  if (city) {
    const districtSelected = selected?.properties?.level === "district";
    return {
      name: districtSelected ? `${city.city}参考` : city.city,
      records: trend.map((item) => {
        const history = city.history?.find((history) => history.date === item.date);
        return history ?? {
          date: item.date,
          average: item.date === state.prices[state.market].date ? city.average : NaN,
          mom: item.date === state.prices[state.market].date ? city.mom : NaN,
          yoy: item.date === state.prices[state.market].date ? city.yoy : NaN,
        };
      }),
    };
  }

  return {
    name: "全国百城",
    records: trend.map((item) => ({
      date: item.date,
      average: item.average,
      mom: item.averageHuanBi,
      yoy: item.averageTongBi,
    })),
  };
}

function renderTimeFeedback() {
  const focus = activeFocusTrend();
  const records = focus.records;
  const max = Math.max(0, records.length - 1);
  const index = Math.min(Math.max(state.timeIndex ?? max, 0), max);
  const record = records[index] ?? {};
  const progress = max ? index / max : 0;

  document.querySelector("#time-input-wrap").style.setProperty("--time-progress", String(progress));
  const tooltip = document.querySelector("#time-tooltip");
  tooltip.classList.toggle("is-start", progress === 0);
  tooltip.classList.toggle("is-end", progress === 1);
  document.querySelector("#time-focus-name").textContent = focus.name;
  document.querySelector("#time-tooltip-price").textContent = formatPrice(record.average);
  document.querySelector("#time-tooltip-change").textContent = `环比 ${formatChange(record.mom)}`;
  const districtSelected = activeFeature()?.properties?.level === "district";

  document.querySelector("#time-metrics").innerHTML = [
    { label: districtSelected ? "城市参考均价" : "当前均价", value: formatPrice(record.average), className: "" },
    { label: districtSelected ? "城市环比" : "环比", value: formatChange(record.mom), className: changeClass(record.mom) },
    { label: districtSelected ? "城市同比" : "同比", value: formatChange(record.yoy), className: changeClass(record.yoy) },
  ].map((metric) => `<div class="time-metric">
    <span>${metric.label}</span>
    <strong class="${metric.className}">${metric.value}</strong>
  </div>`).join("");

  const values = records.map((item) => item.average).filter(Number.isFinite);
  const min = Math.min(...values);
  const maxPrice = Math.max(...values);
  const points = records.map((item, itemIndex) => {
    if (!Number.isFinite(item.average)) return null;
    const x = max ? (itemIndex / max) * 240 : 120;
    const normalized = maxPrice === min ? 0.5 : (item.average - min) / (maxPrice - min);
    const y = 38 - normalized * 30;
    return { x, y };
  }).filter(Boolean);
  const pointText = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const currentPoint = points[index] ?? points.at(-1) ?? { x: 120, y: 19 };
  const first = points[0] ?? currentPoint;
  const last = points.at(-1) ?? currentPoint;

  document.querySelector("#time-sparkline").innerHTML = `
    <svg viewBox="0 0 240 45" preserveAspectRatio="none" role="presentation">
      <defs>
        <linearGradient id="time-spark-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(75,212,196,0.35)" />
          <stop offset="100%" stop-color="rgba(75,212,196,0)" />
        </linearGradient>
      </defs>
      <path d="M ${first.x},45 L ${pointText.replaceAll(" ", " L ")} L ${last.x},45 Z" fill="url(#time-spark-gradient)" />
      <polyline points="${pointText}" fill="none" stroke="#4bd4c4" stroke-width="2" vector-effect="non-scaling-stroke" />
      <line x1="${currentPoint.x}" y1="3" x2="${currentPoint.x}" y2="42" stroke="rgba(255,104,122,0.9)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
    </svg>
  `;
}

function renderTimeControls() {
  const trend = activeTrend();
  const max = Math.max(0, trend.length - 1);
  const index = Math.min(Math.max(state.timeIndex ?? max, 0), max);
  const slider = document.querySelector("#time-slider");
  slider.min = "0";
  slider.max = String(max);
  slider.value = String(index);
  document.querySelector("#time-label").textContent = activeDate();
  document.querySelector("#time-start").textContent = trend[0]?.date ?? "--";
  document.querySelector("#time-end").textContent = trend.at(-1)?.date ?? "--";
  document.querySelector("#time-coverage").textContent = `城市历史公开覆盖 ${state.prices[state.market].historicalCoverage}/100`;
  document.querySelector("#time-prev").disabled = index === 0;
  document.querySelector("#time-next").disabled = index === max;
  document.querySelector("#data-date").textContent = `${labels[state.market].name} · ${activeDate()}`;
  renderTimeFeedback();
}

function stopPlayback() {
  if (!state.playbackTimer) return;
  window.clearInterval(state.playbackTimer);
  state.playbackTimer = null;
  document.querySelector("#time-play").textContent = "播放";
}

function setTimeIndex(index, { updateChart = true } = {}) {
  const trend = activeTrend();
  state.timeIndex = Math.min(Math.max(index, 0), Math.max(0, trend.length - 1));
  renderTimeControls();
  if (updateChart) {
    setMapOption(false, true);
    renderSummary();
    renderTrend();
  }
}

function startPlayback() {
  if (state.playbackTimer) {
    stopPlayback();
    return;
  }

  const trend = activeTrend();
  if ((state.timeIndex ?? trend.length - 1) >= trend.length - 1) {
    setTimeIndex(0, { updateChart: false });
  }

  document.querySelector("#time-play").textContent = "暂停";
  state.playbackTimer = window.setInterval(() => {
    const next = (state.timeIndex ?? 0) + 1;
    if (next > trend.length - 1) {
      stopPlayback();
      return;
    }
    setTimeIndex(next);
  }, 1200);
  setTimeIndex(state.timeIndex ?? 0);
}

function geometryBBox(geometry) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  function visit(coordinates) {
    if (typeof coordinates?.[0] === "number") {
      const [x, y] = coordinates;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      return;
    }
    for (const coordinate of coordinates ?? []) visit(coordinate);
  }
  if (geometry?.coordinates) visit(geometry.coordinates);
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function featureBBox(feature) {
  if (!feature?.geometry) return null;
  if (feature.geometry.type === "GeometryCollection") {
    const boxes = feature.geometry.geometries.map(geometryBBox).filter(Boolean);
    if (!boxes.length) return null;
    return {
      minX: Math.min(...boxes.map((box) => box.minX)),
      minY: Math.min(...boxes.map((box) => box.minY)),
      maxX: Math.max(...boxes.map((box) => box.maxX)),
      maxY: Math.max(...boxes.map((box) => box.maxY)),
    };
  }
  return geometryBBox(feature.geometry);
}

function fitToFeature(feature) {
  const box = featureBBox(feature) ?? { minX: 73, minY: 18, maxX: 136, maxY: 54 };
  const width = Math.max(0.1, box.maxX - box.minX);
  const height = Math.max(0.1, box.maxY - box.minY);
  const span = Math.max(width, height * 1.35);
  state.mapCenter = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
  state.mapZoom = Math.min(9, Math.max(1.7, Math.sqrt(72 / span)));
}

function setCaption(title, description) {
  document.querySelector("#map-caption").innerHTML = `<strong>${title}</strong><span>${description}</span>`;
}

function updateCaption() {
  const current = currentPathItem();
  if (!current || current.level === "country") {
    setCaption("全国视角", "点击省份进入市级边界；滚轮可连续放大");
  } else if (current.level === "province") {
    const hasDistricts = current.geo.features.some((feature) => feature.properties?.level === "district");
    setCaption(current.name, hasDistricts ? "直辖市已到区县，点击区县选择" : "点击城市进入区县边界");
  } else if (current.level === "city") {
    setCaption(current.name, "区县色块为房天下二手挂牌参考价；城市价仅作参考");
  } else {
    setCaption(current.name, "已选择行政区");
  }
}

function goCountry({ silent = false } = {}) {
  state.path = [];
  state.selectedName = null;
  state.mapCenter = [104.8, 36.2];
  state.mapZoom = 1.18;
  updateCaption();
  renderBreadcrumb();
  renderAreaControls();
  renderTimeFeedback();
  if (!silent) {
    setMapOption();
    renderSummary();
    renderTrend();
  }
}

async function enterFeature(feature) {
  const properties = feature.properties;
  if (!properties?.adcode || Number(properties.childrenNum ?? 0) <= 0) {
    selectFeature(feature);
    return;
  }

  try {
    const geo = await loadAreaGeo(properties.adcode);
    const level = properties.level === "province" ? "province" : "city";
    const item = {
      level,
      name: properties.name,
      adcode: properties.adcode,
      feature,
      geo,
      mapName: `area-${properties.adcode}`,
    };
    echarts.registerMap(item.mapName, geo);
    state.path = level === "province" ? [item] : [state.path[0], item].filter(Boolean);
    state.selectedName = null;
    fitToFeature(feature);
    updateCaption();
    renderBreadcrumb();
    renderAreaControls();
    renderTimeFeedback();
    setMapOption();
    renderSummary();
    renderTrend();
  } catch (error) {
    console.error(error);
    setStatus("行政区边界加载失败，可重试或直接选择");
    selectFeature(feature);
  }
}

function selectFeature(feature) {
  const current = currentPathItem();
  if (!feature || !current?.geo) return;
  const exists = current.geo.features.some((item) => item.properties?.name === feature.properties?.name);
  if (!exists) return;
  state.selectedName = feature.properties.name;
  state.path = state.path.filter((item) => item.level !== "selected");
  state.path = [...state.path, {
    level: "selected",
    name: feature.properties.name,
    adcode: feature.properties.adcode,
    feature,
    geo: current.geo,
    mapName: current.mapName,
  }];
  fitToFeature(feature);
  updateCaption();
  renderBreadcrumb();
  renderAreaControls();
  renderTimeFeedback();
  setMapOption();
  renderSummary();
  renderTrend();
}

function selectOrEnterByName(name) {
  const current = currentPathItem();
  const feature = current?.geo.features.find((item) => item.properties?.name === name);
  if (!feature) return;
  if (Number(feature.properties.childrenNum ?? 0) > 0) void enterFeature(feature);
  else selectFeature(feature);
}

function goToPathIndex(index) {
  const target = state.path[index - 1];
  if (!target) return goCountry();
  state.path = state.path.slice(0, index);
  state.selectedName = null;
  fitToFeature(target.feature);
  updateCaption();
  renderBreadcrumb();
  renderAreaControls();
  renderTimeFeedback();
  setMapOption();
  renderSummary();
  renderTrend();
}

function goUp() {
  if (state.path.length <= 1) return goCountry();
  goToPathIndex(state.path.length - 1);
}

function handleMapClick(params) {
  if (params.componentType !== "series" || params.seriesType !== "map" || !params.name) return;
  const current = currentPathItem();
  const sourceGeo = current?.geo ?? state.nationalGeo;
  const feature = sourceGeo.features.find((item) => item.properties?.name === params.name);
  if (!feature) return;

  if (!current || current.level === "country") {
    void enterFeature(feature);
    return;
  }
  if (current.level === "province" && feature.properties?.level === "city" && Number(feature.properties.childrenNum ?? 0) > 0) {
    void enterFeature(feature);
    return;
  }
  selectFeature(feature);
}

function setMarket(market) {
  state.market = market;
  document.querySelectorAll(".segment").forEach((button) => {
    const active = button.dataset.market === market;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  renderTimeControls();
  setMapOption(true, true);
  renderSummary();
  renderTrend();
}

function initializeCharts() {
  state.mapChart = echarts.init(document.querySelector("#map"), undefined, { renderer: "canvas" });
  state.trendChart = echarts.init(document.querySelector("#trend"), undefined, { renderer: "canvas" });
  echarts.registerMap("china", state.nationalGeo);

  state.mapChart.on("click", handleMapClick);
  document.querySelector("#reset-map").addEventListener("click", () => goCountry());
  document.querySelector("#up-level").addEventListener("click", goUp);
  document.querySelector("#area-province").addEventListener("change", (event) => {
    const feature = state.nationalGeo.features.find((item) => item.properties?.name === event.target.value);
    if (feature) void enterFeature(feature);
  });
  document.querySelector("#area-city").addEventListener("change", (event) => {
    const { province } = selectedAreaItems();
    const feature = childFeatures(province).find((item) => item.properties?.name === event.target.value);
    if (feature) void enterFeature(feature);
  });
  document.querySelector("#area-district").addEventListener("change", (event) => {
    const { city, province } = selectedAreaItems();
    const source = city ?? province;
    const feature = childFeatures(source).find((item) => item.properties?.name === event.target.value);
    if (feature) selectFeature(feature);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") goCountry();
    if (event.key === "Backspace" && event.target === document.body) goUp();
  });
  document.querySelectorAll(".segment").forEach((button) => {
    button.addEventListener("click", () => setMarket(button.dataset.market));
  });
  document.querySelector("#time-slider").addEventListener("input", (event) => {
    stopPlayback();
    setTimeIndex(Number(event.target.value));
  });
  document.querySelector("#time-prev").addEventListener("click", () => {
    stopPlayback();
    setTimeIndex((state.timeIndex ?? activeTrend().length - 1) - 1);
  });
  document.querySelector("#time-next").addEventListener("click", () => {
    stopPlayback();
    setTimeIndex((state.timeIndex ?? 0) + 1);
  });
  document.querySelector("#time-play").addEventListener("click", startPlayback);
  window.addEventListener("resize", () => {
    state.mapChart.resize();
    state.trendChart.resize();
  });
}

async function main() {
  try {
    [state.prices, state.districtPrices, state.nationalGeo] = await Promise.all([
      loadJson("./data/prices.json", "no-store"),
      loadJson("./data/district-prices.json", "no-store"),
      loadJson("./data/china-provinces.geojson", "no-store"),
    ]);
    initializeCharts();
    goCountry({ silent: true });
    setTimeIndex(activeTrend().length - 1, { updateChart: false });
    setMarket("newHouse");
  } catch (error) {
    console.error(error);
    document.querySelector("#loading").textContent = `加载失败：${error.message}`;
    return;
  }
  const loading = document.querySelector("#loading");
  loading.remove();
}

main();
