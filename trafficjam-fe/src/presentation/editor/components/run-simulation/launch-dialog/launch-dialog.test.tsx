import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LaunchDialog } from "./launch-dialog";
import type { Network, Scenario } from "@/types";

vi.mock("./launch-dialog.module.css", () => ({ default: {} }));

vi.mock("@/components", () => ({
  Dialog: ({
    title,
    children,
    footer,
  }: {
    title: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) => (
    <div data-testid="dialog">
      <div data-testid="dialog-title">{title}</div>
      <div data-testid="dialog-content">{children}</div>
      {footer && <div data-testid="dialog-footer">{footer}</div>}
    </div>
  ),
}));

const mockMutateAsync = vi.fn();
vi.mock("@/hooks/use-simulation", () => ({
  useSimulation: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

const PAYLOAD_LIMIT_ERROR =
  "Simulation payload exceeds 1048576-byte multipart part limit for buildings";

function makeNetwork(): Network {
  const nodes = new Map([
    ["n1", { id: "n1", position: [54.6, -5.9] as [number, number], connectionCount: 1 }],
    ["n2", { id: "n2", position: [54.61, -5.91] as [number, number], connectionCount: 1 }],
  ]);
  const links = new Map([
    [
      "l1",
      {
        id: "l1",
        from: "n1",
        to: "n2",
        geometry: [
          [54.6, -5.9] as [number, number],
          [54.61, -5.91] as [number, number],
        ],
        tags: { highway: "primary", lanes: 2, maxspeed: 50, oneway: false },
      },
    ],
  ]);
  return { nodes, links };
}

const activeScenario: Scenario = {
  id: "scenario-1",
  name: "Test Scenario",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  agentConfig: {
    populationDensity: 1,
    shoppingProbability: 0.5,
    maxShoppingDistanceKm: 5,
    healthcareChance: 0.1,
    elderlyAgeThreshold: 65,
    kindergartenAge: 5,
    minIndependentSchoolAge: 10,
    errandMinMinutes: 10,
    errandMaxMinutes: 30,
    childDropoffMinMinutes: 5,
    childDropoffMaxMinutes: 15,
  },
};

function renderDialog(overrides: {
  onLaunch?: () => void;
  onClose?: () => void;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onLaunch = overrides.onLaunch ?? vi.fn();
  const onClose = overrides.onClose ?? vi.fn();

  render(
    <QueryClientProvider client={queryClient}>
      <LaunchDialog
        activeScenario={activeScenario}
        network={makeNetwork()}
        onLaunch={onLaunch}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );

  return { onLaunch, onClose };
}

afterEach(() => {
  cleanup();
});

describe("LaunchDialog — payload-limit error surfacing", () => {
  it("displays the exact payload-limit error message when mutateAsync rejects", async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error(PAYLOAD_LIMIT_ERROR));

    renderDialog({});

    const launchBtn = screen.getByRole("button", { name: /launch/i });
    fireEvent.click(launchBtn);

    await waitFor(() => {
      expect(screen.getByText(PAYLOAD_LIMIT_ERROR)).toBeTruthy();
    });
  });

  it("does not call onLaunch when mutateAsync rejects with payload-limit error", async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error(PAYLOAD_LIMIT_ERROR));

    const { onLaunch } = renderDialog({});

    const launchBtn = screen.getByRole("button", { name: /launch/i });
    fireEvent.click(launchBtn);

    await waitFor(() => {
      expect(screen.getByText(PAYLOAD_LIMIT_ERROR)).toBeTruthy();
    });

    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("calls onLaunch when mutateAsync resolves successfully", async () => {
    mockMutateAsync.mockResolvedValueOnce({
      scenarioId: "scenario-1",
      runId: "run-1",
      simulationId: "sim-1",
      status: "RUNNING",
    });

    const { onLaunch } = renderDialog({});

    const launchBtn = screen.getByRole("button", { name: /launch/i });
    fireEvent.click(launchBtn);

    await waitFor(() => {
      expect(onLaunch).toHaveBeenCalledWith({
        scenarioId: "scenario-1",
        runId: "run-1",
      });
    });
  });

  it("surfaces a generic error message for non-Error rejections", async () => {
    mockMutateAsync.mockRejectedValueOnce("unexpected string error");

    renderDialog({});

    const launchBtn = screen.getByRole("button", { name: /launch/i });
    fireEvent.click(launchBtn);

    await waitFor(() => {
      expect(screen.getByText("Failed to start simulation")).toBeTruthy();
    });
  });
});
