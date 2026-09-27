const priceFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const compactFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const GEO_BASE = "https://geo.datav.aliyun.com/areas_v3/bound";

const state = {
  market: "newHouse",
  prices: null,
  nationalGeo: null,
  geoCache: new Map(),
  mapChart: null,
  trendChart: null,
  path: [],
  selectedName: null,
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
    count: cities.length,
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

function findCityRecord(name, provinceName = null) {
  const data = state.prices[state.market];
  const target = normalizeAreaName(name);
  return data.cities.find((city) => {
    const provinceMatches = !provinceName || city.province === provinceName;
    return provinceMatches && normalizeAreaName(city.city) === target;
  }) ?? null;
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
  const data = state.prices[state.market];
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

      return {
        name: properties.name,
        value: city?.average ?? NaN,
        count: city ? 1 : 0,
        averageMom: city?.mom ?? null,
        averageYoy: city?.yoy ?? null,
        city: city?.city ?? null,
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
        if (!Number.isFinite(params.value)) return `<strong>${params.name}</strong><br/>该行政区未在百城样本中`;
        const isDistrict = ["district", "district-in-municipality"].includes(params.data.scope);
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
      emphasis: {
        label: { show: true, fontWeight: 700 },
        itemStyle: { areaColor: "#4bd4c4", shadowBlur: 18, shadowColor: "rgba(75,212,196,0.5)" },
      },
      itemStyle: {
        areaColor: "rgba(38, 48, 73, 0.72)",
        borderColor: "rgba(169, 190, 229, 0.42)",
        borderWidth: 0.7,
      },
      data: currentMapData(),
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
  const data = state.prices[state.market];
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
      return {
        name: properties.name,
        price: city?.average,
        mom: city?.mom,
        yoy: city?.yoy,
        note: city ? "城市样本" : "未监测",
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
    rows = sourceFeatures.filter((feature) => feature.properties?.name).map((feature) => ({
      name: feature.properties.name,
      price: cityRecord?.average,
      mom: cityRecord?.mom,
      yoy: cityRecord?.yoy,
      note: cityRecord ? `继承${cityRecord.city}样本` : "未监测",
      level: feature.properties.level,
    })).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  } else {
    summary = {
      count: data.cities.length,
      medianPrice: data.summary.average,
      averageMom: data.summary.averageHuanBi,
      averageYoy: null,
    };
  }

  document.querySelector("#region-title").textContent = title;
  document.querySelector("#region-type").textContent = labels[state.market].name;
  document.querySelector("#city-list-title").textContent = listTitle;
  document.querySelector("#city-count").textContent = `${rows.length} 个行政区`;

  const isDistrict = Boolean(selectedFeature);
  document.querySelector("#summary-cards").innerHTML = [
    summaryCard(
      isDistrict ? "所属城市样本价" : "样本价格",
      formatPrice(summary.medianPrice),
      isDistrict ? "全国无统一区县公开价，显示所属城市" : summary.city ? "城市样本均价" : "样本均价 / 中位数",
    ),
    summaryCard(
      "监测样本",
      `${summary.count} 个`,
      isDistrict ? "百城价格指数城市" : current?.level === "province" ? "该省监测城市" : "全国监测城市",
    ),
    summaryCard(
      "环比变化",
      formatChange(summary.averageMom),
      isDistrict ? "所属城市环比" : "当前口径环比",
      changeClass(summary.averageMom),
    ),
    summaryCard(
      "同比变化",
      formatChange(summary.averageYoy),
      isDistrict ? "所属城市同比" : "公开汇总页未提供全国同比",
      changeClass(summary.averageYoy),
    ),
  ].join("");

  document.querySelector("#city-list").innerHTML =
    `<div class="city-header"><span>行政区</span><span>样本均价</span><span>环比</span><span>同比</span></div>` +
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
  const data = state.prices[state.market];
  const trend = [...data.trend].sort((a, b) => a.date.localeCompare(b.date));
  state.trendChart.setOption({
    backgroundColor: "transparent",
    grid: { left: 42, right: 14, top: 28, bottom: 28 },
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
      name: `${labels[state.market].name}样本均价`,
      type: "line",
      smooth: true,
      symbolSize: 6,
      data: trend.map((item) => item.average),
      lineStyle: { width: 3, color: "#4bd4c4" },
      itemStyle: { color: "#4bd4c4" },
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
    }],
    animationDuration: 1000,
  });
  document.querySelector("#trend-range").textContent = trend.length
    ? `${trend[0].date} 至 ${trend.at(-1).date}`
    : "";
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
    setCaption(current.name, "点击区县选择；右侧可查看所属城市样本价格");
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
  if (!silent) {
    setMapOption();
    renderSummary();
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
    setMapOption();
    renderSummary();
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
  setMapOption();
  renderSummary();
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
  setMapOption();
  renderSummary();
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
  document.querySelector("#data-date").textContent = `${labels[market].name} · ${state.prices[market].date}`;
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
  window.addEventListener("resize", () => {
    state.mapChart.resize();
    state.trendChart.resize();
  });
}

async function main() {
  try {
    [state.prices, state.nationalGeo] = await Promise.all([
      loadJson("./data/prices.json", "no-store"),
      loadJson("./data/china-provinces.geojson", "no-store"),
    ]);
    initializeCharts();
    goCountry({ silent: true });
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
