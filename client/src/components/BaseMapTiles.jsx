import { TileLayer } from "react-leaflet";

// The public OpenStreetMap standard tile layer is intentionally keyless. Keeping the
// provider in one component prevents one workspace from silently retaining a
// credentialed tile URL when the others are updated.
const OPEN_STREET_MAP_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OPEN_STREET_MAP_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export default function BaseMapTiles() {
  return <TileLayer url={OPEN_STREET_MAP_URL} attribution={OPEN_STREET_MAP_ATTRIBUTION} maxZoom={19} />;
}
