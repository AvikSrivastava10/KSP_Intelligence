import ReactECharts from "echarts-for-react";

// Yearly FIR volume line; 2024 is flagged partial (amber point).
export default function YearlyTrend({ perYear }) {
  const years = Object.keys(perYear || {}).sort();
  const data = years.map((y) => ({
    value: perYear[y],
    itemStyle: y === "2024" ? { color: "#f59e0b" } : { color: "#38bdf8" },
  }));
  const option = {
    grid: { left: 56, right: 20, top: 20, bottom: 30 },
    tooltip: {
      trigger: "axis",
      formatter: (p) => {
        const it = p[0];
        const partial = it.axisValue === "2024" ? " (partial year)" : "";
        return `<b>${it.axisValue}</b>${partial}<br/>${Number(it.value).toLocaleString()} FIRs`;
      },
    },
    xAxis: {
      type: "category",
      data: years,
      axisLine: { lineStyle: { color: "#475569" } },
      axisLabel: { color: "#94a3b8" },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#94a3b8", formatter: (v) => `${v / 1000}k` },
      splitLine: { lineStyle: { color: "#1e293b" } },
    },
    series: [
      {
        type: "line",
        data,
        smooth: true,
        symbolSize: 8,
        lineStyle: { color: "#38bdf8", width: 2 },
        areaStyle: { color: "rgba(56,189,248,0.12)" },
      },
    ],
  };
  return <ReactECharts option={option} style={{ height: 260 }} notMerge={true} />;
}
