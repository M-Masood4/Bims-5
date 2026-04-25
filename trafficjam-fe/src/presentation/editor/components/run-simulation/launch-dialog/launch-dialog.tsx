import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { Play, Loader2 } from "lucide-react";
import styles from "./launch-dialog.module.css";
import { useSimulation } from "@/hooks/use-simulation";
import type { Building, Scenario, Network } from "@/types";
import { calculateBounds } from "@/utils";
import { networkToMatsim } from "@/utils/matsim-serializer";
import { Dialog } from "@/components";

interface LaunchInitialValues {
  iterations: number;
  randomSeed?: number;
  note?: string;
}

interface LaunchDialogProps {
  activeScenario: Scenario | null;
  network: Network | null;
  onLaunch: (info: { scenarioId: string; runId: string }) => void;
  onClose: () => void;
  onBeforeLaunch?: () => Promise<void> | void;
  initialValues?: LaunchInitialValues;
}

interface LaunchForm {
  iterations: number;
  randomSeed?: number;
  note: string;
}

function getNetworkPositions(network: Network): [number, number][] {
  const nodePositions = Array.from(network.nodes.values()).map(
    (node) => node.position,
  );
  if (nodePositions.length > 0) return nodePositions;

  return Array.from(network.links.values()).flatMap((link) => link.geometry);
}

function buildSyntheticBuildings(network: Network): Building[] {
  const positions = getNetworkPositions(network);
  const sampled = positions.filter((_, index) => index % 8 === 0).slice(0, 48);

  return sampled.map((position, index) => {
    const isResidential = index % 4 !== 0;
    return {
      id: `synthetic-building-${index}`,
      position,
      geometry: [position],
      type: isResidential ? "residential" : "retail",
      tags: isResidential
        ? { building: "residential" }
        : { building: "retail", shop: "clothes" },
    };
  });
}

function getSimulationBuildings(network: Network): Building[] {
  const buildings = network.buildings
    ? Array.from(network.buildings.values())
    : [];
  return buildings.length > 0 ? buildings : buildSyntheticBuildings(network);
}

function prepareSimulationData(network: Network) {
  const xml = networkToMatsim(network);
  const networkFile = new File([xml], "network.xml", {
    type: "application/xml",
  });
  const buildings = getSimulationBuildings(network);
  const bounds = calculateBounds(network);
  return { networkFile, buildings, bounds };
}

export function LaunchDialog({
  activeScenario,
  network,
  onLaunch,
  onClose,
  onBeforeLaunch,
  initialValues,
}: LaunchDialogProps) {
  const queryClient = useQueryClient();
  const start = useSimulation();
  const [error, setError] = useState<string | null>(null);

  const { register, handleSubmit } = useForm<LaunchForm>({
    defaultValues: {
      iterations: initialValues?.iterations ?? 1,
      randomSeed: initialValues?.randomSeed,
      note: initialValues?.note ?? "",
    },
  });

  const onSubmit = useCallback(
    async (data: LaunchForm) => {
      if (!network || !activeScenario) return;
      setError(null);

      try {
        await onBeforeLaunch?.();

        const { networkFile, buildings, bounds } =
          prepareSimulationData(network);

        const responseData = await start.mutateAsync({
          scenarioId: activeScenario.id,
          networkFile,
          buildings,
          bounds,
          iterations: data.iterations,
          randomSeed:
            data.randomSeed !== undefined && !isNaN(data.randomSeed)
              ? data.randomSeed
              : undefined,
          note: data.note || undefined,
        });

        await queryClient.invalidateQueries({ queryKey: ["runs"] });
        onLaunch({
          scenarioId: responseData.scenarioId,
          runId: responseData.runId,
        });
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Failed to start simulation",
        );
      }
    },
    [network, activeScenario, onBeforeLaunch, start, queryClient, onLaunch],
  );

  const dialogTitle = (
    <>
      Run Simulation
      <div className={styles.scenarioBadge}>{activeScenario?.name}</div>
    </>
  );

  const buildingCount = network?.buildings?.size ?? 0;
  const nodeCount = network?.nodes?.size ?? 0;
  const linkCount = network?.links?.size ?? 0;
  const hasNoBuildings = buildingCount === 0;
  const syntheticBuildingCount = network
    ? buildSyntheticBuildings(network).length
    : 0;

  const dialogFooter = (
    <>
      <button className={styles.cancelButton} onClick={onClose} type="button">
        Cancel
      </button>
      <button
        className={styles.launchButton}
        onClick={handleSubmit(onSubmit)}
        disabled={start.isPending || !network || !activeScenario}
        type="button"
      >
        {start.isPending ? (
          <Loader2 size={16} className={styles.spinner} />
        ) : (
          <Play size={16} />
        )}
        {start.isPending ? "Launching..." : "Launch"}
      </button>
    </>
  );

  return (
    <Dialog
      title={dialogTitle}
      footer={dialogFooter}
      onClose={onClose}
      maxWidth={480}
    >
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className={styles.networkSummary}>
          <div className={styles.stat}>
            <span className={styles.statValue}>{nodeCount.toLocaleString()}</span>
            <span className={styles.statLabel}>Nodes</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{linkCount.toLocaleString()}</span>
            <span className={styles.statLabel}>Links</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{buildingCount.toLocaleString()}</span>
            <span className={styles.statLabel}>Buildings</span>
          </div>
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>Run Note (optional)</label>
          <input
            type="text"
            className={styles.input}
            placeholder="e.g. Closed bridge experiment"
            {...register("note")}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Iterations</label>
            <input
              type="number"
              className={styles.input}
              min={1}
              max={100}
              {...register("iterations", { valueAsNumber: true, min: 1 })}
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.label}>Random Seed</label>
            <input
              type="number"
              className={styles.input}
              placeholder="Random"
              {...register("randomSeed", { valueAsNumber: true })}
            />
          </div>
        </div>

        {hasNoBuildings && (
          <p className={styles.error}>
            No building footprints were loaded, so this run will use {" "}
            {syntheticBuildingCount} generated Belfast demand anchors from the
            road network. Re-run the Belfast OSM data loader for richer plans.
          </p>
        )}
        {error && <p className={styles.error}>{error}</p>}
      </form>
    </Dialog>
  );
}
