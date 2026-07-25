import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Dashboard from "./workspaces/Dashboard.jsx";
import HotspotMap from "./workspaces/HotspotMap.jsx";
import TrendsForecast from "./workspaces/TrendsForecast.jsx";
import RiskVulnerability from "./workspaces/RiskVulnerability.jsx";
import PatternsMO from "./workspaces/PatternsMO.jsx";
import NetworkLink from "./workspaces/NetworkLink.jsx";
import SocioEconomic from "./workspaces/SocioEconomic.jsx";
import StrategicHub from "./workspaces/StrategicHub.jsx";
import DataQualityAudit from "./workspaces/DataQualityAudit.jsx";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/hotspots" element={<HotspotMap />} />
        <Route path="/trends" element={<TrendsForecast />} />
        <Route path="/risk" element={<RiskVulnerability />} />
        <Route path="/patterns" element={<PatternsMO />} />
        <Route path="/network" element={<NetworkLink />} />
        <Route path="/socio" element={<SocioEconomic />} />
        <Route path="/hub" element={<StrategicHub />} />
        <Route path="/audit" element={<DataQualityAudit />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
