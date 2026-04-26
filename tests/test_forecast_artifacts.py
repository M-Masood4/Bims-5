import json
import subprocess
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
MODE_A = REPO_ROOT / "web" / "data" / "mode-a"
METRICS = [
    "traffic",
    "population",
    "jobs",
    "economy",
    "housingPressure",
    "services",
    "electricity",
    "environmentAir",
    "greenScore",
    "fairness",
    "fiscalBalance",
    "planningViability",
]


class ForecastArtifactTests(unittest.TestCase):
    def test_forecast_artifacts_cover_2026_to_2036(self) -> None:
        model = json.loads((MODE_A / "forecast_model.json").read_text(encoding="utf-8"))
        baseline = json.loads((MODE_A / "baseline_2025_forecast.json").read_text(encoding="utf-8"))

        self.assertEqual(model["kind"], "belfast.forecastModel")
        self.assertEqual(model["baselineYear"], 2025)
        self.assertEqual(model["metrics"], METRICS)
        self.assertEqual(baseline["kind"], "belfast.baseline2025Forecast")
        self.assertEqual(baseline["years"], list(range(2026, 2037)))
        self.assertGreaterEqual(len(baseline["cells"]), 100)

    def test_forecast_values_are_normalized(self) -> None:
        baseline = json.loads((MODE_A / "baseline_2025_forecast.json").read_text(encoding="utf-8"))
        for year in baseline["years"]:
            summary = baseline["summaryByYear"][str(year)]
            for metric in METRICS:
                self.assertGreaterEqual(summary[metric], 0, f"{year} {metric}")
                self.assertLessEqual(summary[metric], 1, f"{year} {metric}")

        for cell in baseline["cells"][:25]:
            for year in baseline["years"]:
                row = cell["forecastByYear"][str(year)]
                for metric in METRICS:
                    self.assertGreaterEqual(row[metric], 0, f"{cell['cellId']} {year} {metric}")
                    self.assertLessEqual(row[metric], 1, f"{cell['cellId']} {year} {metric}")

    def test_forecast_accepts_staged_road_and_transformer(self) -> None:
        script = r"""
const scenario = require('./lib/scenario-studio');
const result = scenario.runForecastScenario({
  postcode: 'BT7 1NN',
  building: {
    config: {
      size: 'medium',
      buildingType: 'apartments',
      affordabilityMix: 'affordable',
      floors: 8,
      footprintSqm: 1500
    }
  },
  interventions: [
    {
      id: 'road-test',
      type: 'road',
      path: [[-5.935, 54.59], [-5.932, 54.592], [-5.929, 54.594]],
      radiusM: 850
    },
    {
      id: 'tx-test',
      type: 'transformer',
      location: { lng: -5.931, lat: 54.593 },
      radiusM: 650
    }
  ],
  startYear: 2026,
  baselineYear: 2025,
  horizonYear: 2036
}, process.cwd());
const branch = result.scenarioBranches.find((item) => item.objective === 'user_proposal') || result.scenarioBranches[0];
const concrete = branch.timelineByYear['2036'].concreteImpacts;
console.log(JSON.stringify({
  userInterventions: result.userInterventions.map((item) => item.type),
  branchInterventions: branch.interventions.map((item) => item.type),
  diff2036: branch.timelineByYear['2036'].diffFromBaseline,
  concrete2036: concrete
}));
"""
        completed = subprocess.run(
            ["node", "-e", script],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        data = json.loads(completed.stdout)
        self.assertEqual(data["userInterventions"], ["road", "transformer"])
        self.assertIn("road", data["branchInterventions"])
        self.assertIn("transformer", data["branchInterventions"])
        self.assertLess(data["diff2036"]["traffic"], 0)
        self.assertLess(data["diff2036"]["electricity"], 0)
        self.assertNotEqual(data["diff2036"]["services"], 0)
        concrete = data["concrete2036"]
        self.assertEqual(concrete["modelBasis"], "2016-2026 transformer impact artifact plus trained forecast planners")
        for metric in ("traffic", "jobs", "electricity", "services"):
            self.assertIn("method", concrete[metric])
        self.assertIsInstance(concrete["traffic"]["netDailyTrips"], (int, float))
        self.assertIsInstance(concrete["jobs"]["netJobsEstimate"], (int, float))
        self.assertIsInstance(concrete["electricity"]["peakKwChange"], (int, float))
        self.assertIsInstance(concrete["services"]["netServiceDemand"], (int, float))
        self.assertLess(concrete["traffic"]["netDailyTrips"], concrete["traffic"]["dailyTripsAdded"])
        self.assertGreater(concrete["electricity"]["transformerReliefKw"], 0)
        self.assertIn("overloadRiskDelta", concrete["electricity"])
        self.assertIn("loadIndexDelta", concrete["electricity"])
        self.assertIn("p10", concrete["electricity"])
        self.assertIn("p50", concrete["electricity"])
        self.assertIn("p90", concrete["electricity"])
        self.assertIn("temporaryConstructionJobs", concrete["jobs"])
        self.assertIn("operationsJobs", concrete["jobs"])
        self.assertIn("capacityEnabledJobs", concrete["jobs"])


if __name__ == "__main__":
    unittest.main()
