import ReactECharts from "echarts-for-react";

// Yearly FIR volume; indigo line + area, 2024 flagged partial (orange point). Light theme.
export default function YearlyTrend({ perYear }) {
  const years = Object.keys(perYear || {}).sort();
  const data = years.map((y) => ({
    value: perYear[y],
    itemStyle: { color: y === "2024" ? "#f97316" : "#6366f1", borderColor: "#ffffff", borderWidth: 2 },
  }));
  const option = {
    grid: { left: 58, right: 22, top: 22, bottom: 30 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(255,255,255,0.97)",
      borderColor: "rgba(15,23,42,0.12)",
      textStyle: { color: "#0f172a" },
      formatter: (p) => {
        const it = p[0];
        const partial = it.axisValue === "2024" ? " <span style='color:#ea580c'>(partial)</span>" : "";
        return `<b>${it.axisValue}</b>${partial}<br/>${Number(it.value).toLocaleString()} FIRs`;
      },
    },
    xAxis: {
      type: "category",
      data: years,
      axisLine: { lineStyle: { color: "rgba(15,23,42,0.18)" } },
      axisLabel: { color: "#64748b" },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#64748b", formatter: (v) => `${v / 1000}k` },
      splitLine: { lineStyle: { color: "rgba(15,23,42,0.08)" } },
    },
    series: [
      {
        type: "line",
        data,
        smooth: true,
        symbolSize: 9,
        lineStyle: { color: "#6366f1", width: 3 },
        areaStyle: {
          color: {
            type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(99,102,241,0.28)" },
              { offset: 1, color: "rgba(99,102,241,0.02)" },
            ],
          },
        },
      },
    ],
  };
  return <ReactECharts option={option} style={{ height: 280 }} notMerge />;
}
