const priceFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const compactFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

const state = {
  market: "newHouse",
  selectedProvince: null,
  prices: null,
  geo: null,
  mapChart: null,
  trendChart: null,
};

const labels = {
  newHouse: { name: "新建住宅", short: "新房" },
  esfHouse: { name: "二手住宅", short: "二手房" },
};

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
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

function provinceStats(data, province = null) {
  const cities = province ? data.cities.filter((city) => city.province === province) : data.cities;
  const prices = cities.map((city) => city.average);
  const moms = cities.map((city) => city.mom);
  const yoys = cities.map((city) => city.yoy);
  return {
    cities,
    count: cities.length,
    medianPrice: median(prices),
    averagePrice: average(prices),
    averageMom: average(moms),
    averageYoy: average(yoys),
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

function mapData(data) {
  return [...allProvinceStats(data)].map(([name, stats]) => ({
    name,
    value: stats.medianPrice,
    count: stats.count,
    averageMom: stats.averageMom,
    averageYoy: stats.averageYoy,
  }));
}

function setMapOption(animation = true) {
  const data = state.prices[state.market];
  state.mapChart.setOption(
    {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(8, 12, 24, 0.94)",
        borderColor: "rgba(125, 154, 210, 0.35)",
        textStyle: { color: "#eef3ff", fontSize: 12 },
        formatter: (params) => {
          if (!Number.isFinite(params.value)) {
            return `<strong>${params.name}</strong><br/>暂无百城监测样本`;
          }
          return [
            `<strong>${params.name}</strong>`,
            `样本城市：${params.data.count} 个`,
            `价格中位数：${priceFormatter.format(params.value)} 元/㎡`,
            `环比均值：${formatChange(params.data.averageMom)}`,
            `同比均值：${formatChange(params.data.averageYoy)}`,
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
      series: [
        {
          type: "map",
          map: "china",
          roam: true,
          scaleLimit: { min: 0.75, max: 9 },
          zoom: state.mapZoom,
          center: state.mapCenter,
          selectedMode: false,
          aspectScale: 0.82,
          projectionScale: 1,
          label: { show: false, color: "rgba(238,243,255,0.82)", fontSize: 10 },
          emphasis: {
            label: { show: true, fontWeight: 700 },
            itemStyle: { areaColor: "#4bd4c4", shadowBlur: 18, shadowColor: "rgba(75,212,196,0.5)" },
          },
          itemStyle: {
            areaColor: "rgba(38, 48, 73, 0.72)",
            borderColor: "rgba(169, 190, 229, 0.42)",
            borderWidth: 0.7,
          },
          data: mapData(data),
        },
      ],
      animation: animation,
      animationDuration: 900,
      animationDurationUpdate: 850,
      animationEasing: "cubicInOut",
    },
    { lazyUpdate: true },
  );
}

function formatPrice(value) {
  return Number.isFinite(value) ? `${priceFormatter.format(value)} 元/㎡` : "暂无数据";
}

function formatChange(value) {
  if (!Number.isFinite(value)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${compactFormatter.format(value)}%`;
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

function renderSummary(region) {
  const data = state.prices[state.market];
  const stats = region ? provinceStats(data, region) : provinceStats(data);
  const source = region ? stats : data.summary;
  const price = region ? stats.medianPrice : source.average;
  const cities = region ? stats.cities : data.cities;
  const ranked = [...cities].sort((a, b) => (b.average ?? -1) - (a.average ?? -1));
  const top = ranked.slice(0, 8);

  document.querySelector("#region-title").textContent = region || "全国百城";
  document.querySelector("#region-type").textContent = labels[state.market].name;
  document.querySelector("#city-list-title").textContent = region ? `${region} 监测城市` : "价格最高监测城市";
  document.querySelector("#city-count").textContent = `${cities.length} 个城市`;

  document.querySelector("#summary-cards").innerHTML = [
    summaryCard("样本价格", formatPrice(price), region ? "城市样本价格中位数" : "全国样本平均价格"),
    summaryCard(
      "样本中位数",
      formatPrice(region ? average(stats.cities.map((city) => city.median)) : source.median),
      region ? "城市样本中位数的均值" : "百城中位数",
    ),
    summaryCard(
      "环比变化",
      formatChange(region ? stats.averageMom : source.averageHuanBi),
      region ? "监测城市环比均值" : "全国样本均价环比",
      changeClass(region ? stats.averageMom : source.averageHuanBi),
    ),
    summaryCard(
      "同比变化",
      formatChange(region ? stats.averageYoy : "--"),
      region ? "监测城市同比均值" : "公开汇总页未提供全国同比",
      changeClass(region ? stats.averageYoy : null),
    ),
  ].join("");

  document.querySelector("#city-list").innerHTML =
    `<div class="city-header"><span>城市</span><span>样本均价</span><span>环比</span><span>同比</span></div>` +
    top
      .map(
        (city) => `<div class="city-row">
          <span class="city-name">${city.city}</span>
          <span class="city-price">${priceFormatter.format(city.average)}</span>
          <span class="city-change ${changeClass(city.mom)}">${formatChange(city.mom)}</span>
          <span class="city-change ${changeClass(city.yoy)}">${formatChange(city.yoy)}</span>
        </div>`,
      )
      .join("");
}

function renderTrend() {
  const data = state.prices[state.market];
  const trend = [...data.trend].sort((a, b) => a.date.localeCompare(b.date));
  const marketName = labels[state.market].name;
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
    series: [
      {
        name: `${marketName}样本均价`,
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
      },
    ],
    animationDuration: 1000,
  });
  document.querySelector("#trend-range").textContent = trend.length
    ? `${trend[0].date} 至 ${trend[trend.length - 1].date}`
    : "";
}

function geometryBBox(geometry) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  function visit(coordinates) {
    if (typeof coordinates[0] === "number") {
      const [x, y] = coordinates;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      return;
    }
    for (const coordinate of coordinates) visit(coordinate);
  }
  if (geometry?.coordinates) visit(geometry.coordinates);
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function featureBBox(feature) {
  if (!feature.geometry) return null;
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

function focusProvince(name) {
  const feature = state.geo.features.find((item) => item.properties?.name === name);
  const box = feature ? featureBBox(feature) : null;
  state.selectedProvince = name;
  document.querySelector("#map-caption").innerHTML = `<strong>${name}</strong><span>已放大到省份视角，右侧查看城市价格</span>`;

  if (!box) {
    state.mapCenter = undefined;
    state.mapZoom = 1.18;
  } else {
    const width = Math.max(0.1, box.maxX - box.minX);
    const height = Math.max(0.1, box.maxY - box.minY);
    const span = Math.max(width, height * 1.35);
    state.mapCenter = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
    state.mapZoom = Math.min(5.8, Math.max(1.7, Math.sqrt(72 / span)));
  }
  setMapOption();
  renderSummary(name);
}

function resetView() {
  state.selectedProvince = null;
  state.mapCenter = [104.8, 36.2];
  state.mapZoom = 1.18;
  document.querySelector("#map-caption").innerHTML = `<strong>全国视角</strong><span>省份颜色 = 该省内监测城市样本价格中位数</span>`;
  setMapOption();
  renderSummary(null);
}

function setMarket(market) {
  state.market = market;
  document.querySelectorAll(".segment").forEach((button) => {
    const active = button.dataset.market === market;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelector("#data-date").textContent = `${labels[market].name} · ${state.prices[market].date}`;
  setMapOption();
  renderSummary(state.selectedProvince);
  renderTrend();
}

function initializeCharts() {
  state.mapChart = echarts.init(document.querySelector("#map"), undefined, { renderer: "canvas" });
  state.trendChart = echarts.init(document.querySelector("#trend"), undefined, { renderer: "canvas" });
  echarts.registerMap("china", state.geo);
  state.mapCenter = [104.8, 36.2];
  state.mapZoom = 1.18;

  state.mapChart.on("click", (params) => {
    if (params.componentType !== "series" || params.seriesType !== "map" || !params.name) return;
    focusProvince(params.name);
  });

  document.querySelector("#reset-map").addEventListener("click", resetView);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") resetView();
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
    [state.prices, state.geo] = await Promise.all([
      loadJson("./data/prices.json"),
      loadJson("./data/china-provinces.geojson"),
    ]);
    initializeCharts();
    setMarket("newHouse");
  } catch (error) {
    console.error(error);
    document.querySelector(".loading-overlay").textContent = `加载失败：${error.message}`;
    return;
  }
  document.querySelector("#loading").classList.add("is-hidden");
}

main();
