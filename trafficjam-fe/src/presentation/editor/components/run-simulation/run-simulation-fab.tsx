import { Play } from "lucide-react";
import styles from "./run-simulation-fab.module.css";

interface RunSimulationFabProps {
  onClick: () => void;
  disabled?: boolean;
}

export function RunSimulationFab({ onClick, disabled }: RunSimulationFabProps) {
  return (
    <button className={styles.fab} onClick={onClick} disabled={disabled}>
      <Play size={18} />
      Run Simulation
    </button>
  );
}
