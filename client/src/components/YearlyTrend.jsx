import ReactECharts from "echarts-for-react";

// Yearly FIR volume; 2024 flagged partial (amber). Saffron gradient area.
export default function YearlyTrend({ perYear }) {
  const years = Object.keys(perYear || {}).sort();
  const data = years.map((y) => ({
    value: perYear[y],
    itemStyle: { color: y === "2024" ? "#f59e0b" : "#f98125", borderColor: "#0a0f1e", borderWidth: 2 },
  }));
  const option = {
    grid: { left: 58, right: 22, top: 22, bottom: 30 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(10,15,30,0.92)",
      borderColor: "rgba(231,178,75,0.32)",
      textStyle: { color: "#e5e9f0" },
      formatter: (p) => {
        const it = p[0];
        const partial = it.axisValue === "2024" ? " <span style='color:#f59e0b'>(partial)</span>" : "";
        return `<b>${it.axisValue}</b>${partial}<br/>${Number(it.value).toLocaleString()} FIRs`;
      },
    },
    xAxis: {
      type: "category",
      data: years,
      axisLine: { lineStyle: { color: "rgba(148,163,184,0.4)" } },
      axisLabel: { color: "#94a3b8" },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#94a3b8", formatter: (v) => `${v / 1000}k` },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.12)" } },
    },
    series: [
      {
        type: "line",
        data,
        smooth: true,
        symbolSize: 9,
        lineStyle: { color: "#f98125", width: 3, shadowColor: "rgba(249,129,37,0.5)", shadowBlur: 12 },
        areaStyle: {
          color: {
            type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(249,129,37,0.35)" },
              { offset: 1, color: "rgba(249,129,37,0.02)" },
            ],
          },
        },
      },
    ],
  };
  return <ReactECharts option={option} style={{ height: 280 }} notMerge />;
}
