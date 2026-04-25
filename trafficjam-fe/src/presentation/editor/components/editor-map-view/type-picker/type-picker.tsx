import styles from "./type-picker.module.css";
import type { EditorTool } from "../editor-tool";
import { ROAD_STYLES, DEFAULT_STYLE } from "@/constants/road-styles";
import { BUILDING_COLORS, BUILDING_TYPE_LABELS } from "@/constants/building";
import type { HighwayType } from "@/constants/road-styles";
import type { BuildingType } from "@/types";

const ROAD_CHIPS: { type: HighwayType; label: string }[] = [
  { type: "motorway", label: "Motorway" },
  { type: "trunk", label: "Trunk" },
  { type: "primary", label: "Primary" },
  { type: "secondary", label: "Secondary" },
  { type: "tertiary", label: "Tertiary" },
  { type: "residential", label: "Residential" },
  { type: "service", label: "Service" },
  { type: "living_street", label: "Living Street" },
  { type: "pedestrian", label: "Pedestrian" },
  { type: "cycleway", label: "Cycleway" },
  { type: "footway", label: "Footway" },
  { type: "path", label: "Path" },
];

const BUILDING_CHIPS = Object.entries(BUILDING_TYPE_LABELS).map(
  ([type, label]) => ({ type: type as BuildingType, label }),
);

const ELEC_CHIPS = [
  { id: "lines", label: "Power Lines", color: "#f59e0b" },
  { id: "substations", label: "Substations", color: "#ef4444" },
  { id: "heatmap", label: "Consumption Map", color: "#8b5cf6" },
  { id: "faults", label: "Fault Zones", color: "#dc2626" },
];

const TRANSPORT_CHIPS = [
  { id: "bus", label: "Bus Routes", color: "#e74c3c" },
  { id: "tram", label: "Tram / Light Rail", color: "#3498db" },
  { id: "rail", label: "Heavy Rail", color: "#2ecc71" },
  { id: "walk", label: "Pedestrian Zones", color: "#95a5a6" },
];

function getRoadColor(type: HighwayType): string {
  return ROAD_STYLES[type]?.color ?? DEFAULT_STYLE.color;
}

interface TypePickerProps {
  activeTool: EditorTool;
  selectedRoadType: HighwayType;
  onSelectRoadType: (type: HighwayType) => void;
  selectedBuildingType: BuildingType;
  onSelectBuildingType: (type: BuildingType) => void;
  selectedElecLayer: string;
  onSelectElecLayer: (id: string) => void;
  selectedTransportLayer: string;
  onSelectTransportLayer: (id: string) => void;
}

function Chip({
  color,
  label,
  active,
  onClick,
}: {
  color: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`${styles.chip} ${active ? styles.chipActive : ""}`}
      onClick={onClick}
      style={active ? { borderColor: color, color } : undefined}
    >
      <span className={styles.dot} style={{ background: color }} />
      {label}
    </button>
  );
}

export function TypePicker({
  activeTool,
  selectedRoadType,
  onSelectRoadType,
  selectedBuildingType,
  onSelectBuildingType,
  selectedElecLayer,
  onSelectElecLayer,
  selectedTransportLayer,
  onSelectTransportLayer,
}: TypePickerProps) {
  if (activeTool === "select" || activeTool === "demolish") return null;

  return (
    <div className={styles.panel}>
      {activeTool === "roads" && (
        <>
          <span className={styles.panelLabel}>Road type</span>
          <div className={styles.chips}>
            {ROAD_CHIPS.map(({ type, label }) => (
              <Chip
                key={type}
                color={getRoadColor(type)}
                label={label}
                active={selectedRoadType === type}
                onClick={() => onSelectRoadType(type)}
              />
            ))}
          </div>
        </>
      )}

      {activeTool === "buildings" && (
        <>
          <span className={styles.panelLabel}>Building type</span>
          <div className={styles.chips}>
            {BUILDING_CHIPS.map(({ type, label }) => (
              <Chip
                key={type}
                color={BUILDING_COLORS[type]}
                label={label}
                active={selectedBuildingType === type}
                onClick={() => onSelectBuildingType(type)}
              />
            ))}
          </div>
        </>
      )}

      {activeTool === "electricity" && (
        <>
          <span className={styles.panelLabel}>Electricity layer</span>
          <div className={styles.chips}>
            {ELEC_CHIPS.map(({ id, label, color }) => (
              <Chip
                key={id}
                color={color}
                label={label}
                active={selectedElecLayer === id}
                onClick={() => onSelectElecLayer(id)}
              />
            ))}
          </div>
          <span className={styles.hint}>
            Electricity grid visualization — connect backend data to activate
          </span>
        </>
      )}

      {activeTool === "transport" && (
        <>
          <span className={styles.panelLabel}>Transport layer</span>
          <div className={styles.chips}>
            {TRANSPORT_CHIPS.map(({ id, label, color }) => (
              <Chip
                key={id}
                color={color}
                label={label}
                active={selectedTransportLayer === id}
                onClick={() => onSelectTransportLayer(id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
