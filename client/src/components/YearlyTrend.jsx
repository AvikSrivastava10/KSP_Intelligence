import ReactECharts from "echarts-for-react";

// Yearly FIR volume; 2024 flagged partial (white point vs gray line). Monochrome.
export default function YearlyTrend({ perYear }) {
  const years = Object.keys(perYear || {}).sort();
  const data = years.map((y) => ({
    value: perYear[y],
    itemStyle: { color: y === "2024" ? "#ffffff" : "#9a9aa2", borderColor: "#0a0a0b", borderWidth: 2 },
  }));
  const option = {
    grid: { left: 58, right: 22, top: 22, bottom: 30 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(10,10,12,0.92)",
      borderColor: "rgba(255,255,255,0.3)",
      textStyle: { color: "#e5e5e8" },
      formatter: (p) => {
        const it = p[0];
        const partial = it.axisValue === "2024" ? " <span style='color:#ffffff'>(partial)</span>" : "";
        return `<b>${it.axisValue}</b>${partial}<br/>${Number(it.value).toLocaleString()} FIRs`;
      },
    },
    xAxis: {
      type: "category",
      data: years,
      axisLine: { lineStyle: { color: "rgba(212,212,216,0.35)" } },
      axisLabel: { color: "#a1a1aa" },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#a1a1aa", formatter: (v) => `${v / 1000}k` },
      splitLine: { lineStyle: { color: "rgba(212,212,216,0.1)" } },
    },
    series: [
      {
        type: "line",
        data,
        smooth: true,
        symbolSize: 9,
        lineStyle: { color: "#e4e4e7", width: 3, shadowColor: "rgba(255,255,255,0.25)", shadowBlur: 12 },
        areaStyle: {
          color: {
            type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(255,255,255,0.26)" },
              { offset: 1, color: "rgba(255,255,255,0.02)" },
            ],
          },
        },
      },
    ],
  };
  return <ReactECharts option={option} style={{ height: 280 }} notMerge />;
}
