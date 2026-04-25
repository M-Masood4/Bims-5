(function () {
  const SIZE_PRESETS = {
    small: { footprintSqm: 600, floors: 4 },
    medium: { footprintSqm: 1500, floors: 8 },
    large: { footprintSqm: 3500, floors: 15 }
  };

  const TYPE_PRESETS = {
    apartments: { residentialShare: 1, commercialShare: 0, communityShare: 0 },
    mixed_use: { residentialShare: 0.6, commercialShare: 0.3, communityShare: 0.1 },
    office: { residentialShare: 0, commercialShare: 1, communityShare: 0 },
    community: { residentialShare: 0, commercialShare: 0, communityShare: 1 }
  };

  const studioState = {
    placing: false,
    busy: false,
    validating: false,
    error: "",
    location: null,
    geometry: null,
    validation: null,
    simulationResult: null,
    selectedBranchName: "",
    config: {
      size: "medium",
      buildingType: "apartments",
      affordabilityMix: "affordable",
      floors: 8,
      footprintSqm: 1500
    }
  };

  const els = {
    panel: document.querySelector("#scenarioStudio"),
    branches: document.querySelector("#scenarioBranches"),
    reasoning: document.querySelector("#agentReasoning"),
    app: document.querySelector(".replay-app")
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function label(value) {
    return String(value || "").replace(/_/g, " ");
  }

  function signedPct(value) {
    const rounded = Math.round((Number(value) || 0) * 100);
    return `${rounded >= 0 ? "+" : ""}${rounded}%`;
  }

  function score(value) {
    return Math.round((Number(value) || 0) * 100);
  }

  function metersPerLng(lat) {
    return 111320 * Math.cos((lat * Math.PI) / 180);
  }

  function buildSquareFootprint(location, footprintSqm) {
    const sideM = Math.sqrt(Math.max(100, Number(footprintSqm) || 1500));
    const halfLat = sideM / 2 / 111320;
    const halfLng = sideM / 2 / Math.max(1, metersPerLng(location.lat));
    return {
      type: "Polygon",
      coordinates: [[
        [location.lng - halfLng, location.lat - halfLat],
        [location.lng + halfLng, location.lat - halfLat],
        [location.lng + halfLng, location.lat + halfLat],
        [location.lng - halfLng, location.lat + halfLat],
        [location.lng - halfLng, location.lat - halfLat]
      ]]
    };
  }

  function deriveBuildingStats() {
    const sizePreset = SIZE_PRESETS[studioState.config.size] || {
      footprintSqm: Number(studioState.config.footprintSqm) || 1500,
      floors: Number(studioState.config.floors) || 8
    };
    const type = TYPE_PRESETS[studioState.config.buildingType] || TYPE_PRESETS.apartments;
    const footprintSqm = studioState.config.size === "custom" ? Number(studioState.config.footprintSqm) || sizePreset.footprintSqm : sizePreset.footprintSqm;
    const floors = studioState.config.size === "custom" ? Number(studioState.config.floors) || sizePreset.floors : sizePreset.floors;
    const grossFloorAreaSqm = footprintSqm * floors;
    const residentialArea = grossFloorAreaSqm * type.residentialShare;
    const commercialArea = grossFloorAreaSqm * type.commercialShare;
    const communityArea = grossFloorAreaSqm * type.communityShare;
    const units = Math.round(residentialArea / 85);
    return {
      ...studioState.config,
      footprintSqm,
      floors,
      grossFloorAreaSqm,
      units,
      estimatedResidents: Math.round(units * 2.2),
      estimatedJobs: Math.round(commercialArea / 18),
      estimatedElectricityDemand: Math.round(residentialArea * 0.035 + commercialArea * 0.08 + communityArea * 0.05)
    };
  }

  async function postJson(url, payload, allowNonOk = false) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok && !allowNonOk) {
      throw new Error(json.detail || json.error || `${response.status} ${response.statusText}`);
    }
    return json;
  }

  function appState() {
    return window.BelfastGitModeA?.state;
  }

  function map() {
    return appState()?.map;
  }

  function whenMapReady(callback) {
    const currentMap = map();
    if (currentMap?.loaded()) {
      callback(currentMap);
      return;
    }
    window.setTimeout(() => whenMapReady(callback), 150);
  }

  function featureCollection(feature) {
    return {
      type: "FeatureCollection",
      features: feature ? [feature] : []
    };
  }

  function addStudioLayers(currentMap) {
    if (!currentMap.getSource("studio-affected-cells")) {
      currentMap.addSource("studio-affected-cells", { type: "geojson", data: featureCollection() });
    }
    if (!currentMap.getLayer("studio-affected-fill")) {
      currentMap.addLayer({
        id: "studio-affected-fill",
        type: "fill",
        source: "studio-affected-cells",
        paint: {
          "fill-color": "#1155c9",
          "fill-opacity": ["interpolate", ["linear"], ["coalesce", ["to-number", ["get", "intensity"]], 0.1], 0, 0.04, 0.12, 0.18, 0.3, 0.34]
        }
      });
    }
    if (!currentMap.getLayer("studio-affected-line")) {
      currentMap.addLayer({
        id: "studio-affected-line",
        type: "line",
        source: "studio-affected-cells",
        paint: {
          "line-color": "#1155c9",
          "line-width": 1.2,
          "line-dasharray": [2, 2],
          "line-opacity": 0.7
        }
      });
    }

    if (!currentMap.getSource("studio-building")) {
      currentMap.addSource("studio-building", { type: "geojson", data: featureCollection() });
    }
    if (!currentMap.getLayer("studio-building-fill")) {
      currentMap.addLayer({
        id: "studio-building-fill",
        type: "fill",
        source: "studio-building",
        paint: {
          "fill-color": statusColorExpression(),
          "fill-opacity": ["match", ["get", "status"], "ghost", 0.22, "invalid", 0.28, "warning", 0.32, 0.34]
        }
      });
    }
    if (!currentMap.getLayer("studio-building-line")) {
      currentMap.addLayer({
        id: "studio-building-line",
        type: "line",
        source: "studio-building",
        paint: {
          "line-color": statusColorExpression(),
          "line-width": 2.4,
          "line-dasharray": ["match", ["get", "status"], "ghost", ["literal", [2, 2]], ["literal", [1, 0]]]
        }
      });
    }
    if (!currentMap.getLayer("studio-building-extrusion")) {
      currentMap.addLayer({
        id: "studio-building-extrusion",
        type: "fill-extrusion",
        source: "studio-building",
        minzoom: 12,
        paint: {
          "fill-extrusion-color": statusColorExpression(),
          "fill-extrusion-height": ["*", ["coalesce", ["to-number", ["get", "floors"]], 8], 3.1],
          "fill-extrusion-opacity": 0.5
        }
      });
    }
    updateBuildingSource();
    updateAffectedCells();
  }

  function statusColorExpression() {
    return [
      "match",
      ["get", "status"],
      "valid",
      "#1155c9",
      "warning",
      "#d97706",
      "invalid",
      "#dc2626",
      "ghost",
      "#0284c7",
      "#1155c9"
    ];
  }

  function updateBuildingSource(statusOverride) {
    const currentMap = map();
    const source = currentMap?.getSource("studio-building");
    if (!source) return;
    const geometry = studioState.geometry;
    if (!geometry) {
      source.setData(featureCollection());
      return;
    }
    const stats = deriveBuildingStats();
    const status = statusOverride || studioState.validation?.status || "ghost";
    source.setData(featureCollection({
      type: "Feature",
      properties: {
        status,
        floors: stats.floors,
        size: stats.size,
        buildingType: stats.buildingType,
        affordabilityMix: stats.affordabilityMix
      },
      geometry
    }));
  }

  function updateAffectedCells() {
    const currentMap = map();
    const source = currentMap?.getSource("studio-affected-cells");
    if (!source) return;
    const selected = selectedBranch();
    source.setData(selected?.affectedCells || featureCollection());
  }

  function selectedBranch() {
    const branches = studioState.simulationResult?.simulation?.branches || [];
    return branches.find((branch) => branch.name === studioState.selectedBranchName) || branches.find((branch) => branch.recommended) || branches[1] || branches[0];
  }

  function setPlacementMode(enabled) {
    const currentMap = map();
    if (!currentMap) return;
    studioState.placing = enabled;
    currentMap.getCanvas().style.cursor = enabled ? "crosshair" : "";
    if (enabled) {
      currentMap.on("mousemove", handleMouseMove);
      currentMap.on("click", handleMapClick);
      window.BelfastGitModeA?.setView?.("studio");
    } else {
      currentMap.off("mousemove", handleMouseMove);
      currentMap.off("click", handleMapClick);
    }
    renderStudioPanel();
  }

  function handleMouseMove(event) {
    if (!studioState.placing) return;
    const stats = deriveBuildingStats();
    studioState.geometry = buildSquareFootprint(event.lngLat, stats.footprintSqm);
    updateBuildingSource("ghost");
  }

  async function handleMapClick(event) {
    if (!studioState.placing) return;
    event.originalEvent?.stopPropagation?.();
    const stats = deriveBuildingStats();
    studioState.location = { lng: Number(event.lngLat.lng.toFixed(6)), lat: Number(event.lngLat.lat.toFixed(6)) };
    studioState.geometry = buildSquareFootprint(studioState.location, stats.footprintSqm);
    studioState.validation = null;
    studioState.error = "";
    setPlacementMode(false);
    await validatePlacement();
  }

  async function validatePlacement() {
    if (!studioState.location || !studioState.geometry) return;
    studioState.validating = true;
    renderStudioPanel();
    updateBuildingSource("ghost");
    try {
      const validation = await postJson("/api/building/validate-placement", {
        location: studioState.location,
        geometry: studioState.geometry,
        config: deriveBuildingStats()
      }, true);
      studioState.validation = validation;
      studioState.error = validation.status === "invalid" ? "This placement is invalid. Move the building to continue." : "";
    } catch (error) {
      studioState.error = error.message;
    } finally {
      studioState.validating = false;
      updateBuildingSource();
      renderStudioPanel();
      renderReasoning();
    }
  }

  async function generateSimulations() {
    if (!studioState.location || !studioState.geometry || studioState.validation?.status === "invalid") return;
    studioState.busy = true;
    studioState.error = "";
    studioState.simulationResult = null;
    studioState.selectedBranchName = "";
    renderStudioPanel();
    renderBranches();
    renderReasoning();
    try {
      const result = await postJson("/api/scenario-studio/run", {
        activeScenario: "Housing Growth",
        building: {
          location: studioState.location,
          geometry: studioState.geometry,
          config: deriveBuildingStats(),
          validation: studioState.validation
        }
      });
      studioState.simulationResult = result;
      studioState.selectedBranchName = result.critic?.recommendedBranch || result.simulation?.recommendedBranch || result.simulation?.branches?.[1]?.name || "";
      updateAffectedCells();
    } catch (error) {
      studioState.error = error.message;
    } finally {
      studioState.busy = false;
      renderStudioPanel();
      renderBranches();
      renderReasoning();
    }
  }

  function renderStudioPanel() {
    if (!els.panel) return;
    const stats = deriveBuildingStats();
    const validation = studioState.validation;
    const status = studioState.validating ? "Checking site..." : validation?.siteLabel || validation?.site_label || (studioState.location ? "Site selected" : "Click Add Building, then click the map");
    const warningList = validation?.warnings || [];
    els.panel.classList.toggle("has-placement", Boolean(studioState.location));
    els.panel.innerHTML = `
      <header class="studio-head">
        <div>
          <strong>2036 Scenario Studio</strong>
          <span>Gemini designs branches. The simulation engine calculates them.</span>
        </div>
        <b>${escapeHtml(validation?.status || (studioState.placing ? "placing" : "ready"))}</b>
      </header>
      <div class="build-tool-grid">
        <button type="button" data-studio-action="add-building" class="${studioState.placing ? "active" : ""}">Add Building</button>
        <button type="button" disabled>Mobility Corridor</button>
        <button type="button" disabled>Green Corridor</button>
        <button type="button" disabled>Opportunity Hub</button>
      </div>
      <section class="placement-status ${escapeHtml(validation?.status || "idle")}">
        <strong>Placement status</strong>
        <span>${escapeHtml(status)}</span>
        ${warningList.length ? `<ul>${warningList.slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      </section>
      <section class="building-config">
        <label>Size
          <select data-studio-field="size">
            ${["small", "medium", "large", "custom"].map((value) => `<option value="${value}" ${stats.size === value ? "selected" : ""}>${escapeHtml(label(value))}</option>`).join("")}
          </select>
        </label>
        <label>Type
          <select data-studio-field="buildingType">
            ${["apartments", "mixed_use", "office", "community"].map((value) => `<option value="${value}" ${stats.buildingType === value ? "selected" : ""}>${escapeHtml(label(value))}</option>`).join("")}
          </select>
        </label>
        <label>Access mix
          <select data-studio-field="affordabilityMix">
            ${["market", "affordable", "social", "student"].map((value) => `<option value="${value}" ${stats.affordabilityMix === value ? "selected" : ""}>${escapeHtml(label(value))}</option>`).join("")}
          </select>
        </label>
        <label class="${stats.size === "custom" ? "" : "muted-field"}">Floors
          <input data-studio-field="floors" type="number" min="1" max="60" value="${escapeHtml(stats.floors)}" ${stats.size === "custom" ? "" : "disabled"}>
        </label>
        <label class="${stats.size === "custom" ? "" : "muted-field"}">Footprint sqm
          <input data-studio-field="footprintSqm" type="number" min="100" max="20000" value="${escapeHtml(stats.footprintSqm)}" ${stats.size === "custom" ? "" : "disabled"}>
        </label>
      </section>
      <div class="building-stats">
        <span><b>${escapeHtml(stats.units)}</b> units</span>
        <span><b>${escapeHtml(stats.estimatedResidents)}</b> residents</span>
        <span><b>${escapeHtml(stats.estimatedJobs)}</b> jobs</span>
        <span><b>${escapeHtml(stats.estimatedElectricityDemand)}</b> demand proxy</span>
      </div>
      ${studioState.error ? `<p class="studio-error">${escapeHtml(studioState.error)}</p>` : ""}
      <button type="button" class="generate-simulations" data-studio-action="generate" ${!studioState.location || studioState.validating || studioState.busy || validation?.status === "invalid" ? "disabled" : ""}>
        ${studioState.busy ? "Gemini agents running..." : "Generate simulations"}
      </button>
      <div class="studio-flow">2016 history -> 2026 present -> 2036 scenario target</div>
    `;
  }

  function renderBranches() {
    if (!els.branches) return;
    if (studioState.busy) {
      els.branches.innerHTML = `<div class="empty-state"><strong>Gemini agents are building futures</strong><span>Coordinator, specialist agents, critic, and reporter are running before deterministic metrics are shown.</span></div>`;
      return;
    }
    const branches = studioState.simulationResult?.simulation?.branches || [];
    if (!branches.length) {
      els.branches.innerHTML = `
        <div class="empty-state">
          <strong>No scenario branches yet</strong>
          <span>Drop a building and run Gemini-powered simulations to compare 2036 futures.</span>
        </div>
      `;
      return;
    }
    els.branches.innerHTML = branches.map((branch) => {
      const active = selectedBranch()?.name === branch.name;
      return `
        <button type="button" class="branch-card ${active ? "active" : ""}" data-branch-name="${escapeHtml(branch.name)}">
          <span class="branch-topline"><strong>${escapeHtml(branch.name)}</strong>${branch.recommended ? "<em>Recommended</em>" : ""}</span>
          <small>${escapeHtml(branch.description || branch.objective)}</small>
          <span class="branch-deltas">
            <b>Pop ${escapeHtml(signedPct(branch.diffFromBaseline?.populationPressure))}</b>
            <b>Mob ${escapeHtml(signedPct(branch.diffFromBaseline?.mobilityStrain))}</b>
            <b>Opp ${escapeHtml(signedPct(branch.diffFromBaseline?.economicOpportunity))}</b>
            <b>Exp ${escapeHtml(signedPct(branch.diffFromBaseline?.environmentalExposure))}</b>
            <b>Fair ${escapeHtml(signedPct(branch.diffFromBaseline?.fairnessScore))}</b>
          </span>
        </button>
      `;
    }).join("");
  }

  function renderReasoning() {
    if (!els.reasoning) return;
    const result = studioState.simulationResult;
    if (!result) {
      const validation = studioState.validation;
      els.reasoning.innerHTML = validation
        ? `
          <div class="agent-note">
            <strong>Site Agent input</strong>
            <span>${escapeHtml(validation.siteLabel || validation.site_label || validation.status)}</span>
          </div>
          ${(validation.positiveFactors || validation.positive_factors || []).slice(0, 3).map((item) => `<div class="agent-note ok"><strong>Site factor</strong><span>${escapeHtml(item)}</span></div>`).join("")}
        `
        : `<div class="empty-state"><strong>Gemini agents ready</strong><span>Run a simulation to see the reasoning trail.</span></div>`;
      return;
    }
    const report = result.report || {};
    const critic = result.critic || {};
    const specialists = result.specialistAgents || [];
    els.reasoning.innerHTML = `
      <section class="reporter-note">
        <strong>${escapeHtml(report.headline || "Reporter Agent summary")}</strong>
        <p>${escapeHtml(report.summary || "")}</p>
      </section>
      ${specialists.slice(0, 6).map((agent) => `
        <div class="agent-note">
          <strong>${escapeHtml(agent.agent || "Specialist Agent")} <span>${escapeHtml(agent.risk || "")}</span></strong>
          <span>${escapeHtml(agent.reason || "")}</span>
        </div>
      `).join("")}
      <div class="agent-note critic">
        <strong>Critic Agent <span>${critic.humanReviewRequired ? "Planner Review" : "Review Clear"}</span></strong>
        <span>${escapeHtml((critic.warnings || [])[0] || "Uncertainty checked against deterministic outputs.")}</span>
      </div>
      <div class="city-commit-mini">
        ${(report.city_commits || report.cityCommits || []).slice(0, 4).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
    `;
  }

  function handlePanelClick(event) {
    const action = event.target.closest("[data-studio-action]")?.dataset.studioAction;
    if (action === "add-building") {
      setPlacementMode(!studioState.placing);
    } else if (action === "generate") {
      generateSimulations();
    }
  }

  function handlePanelChange(event) {
    const field = event.target.dataset.studioField;
    if (!field) return;
    const value = event.target.type === "number" ? Number(event.target.value) : event.target.value;
    studioState.config[field] = value;
    if (field === "size" && SIZE_PRESETS[value]) {
      studioState.config.floors = SIZE_PRESETS[value].floors;
      studioState.config.footprintSqm = SIZE_PRESETS[value].footprintSqm;
    }
    if (studioState.location) {
      const stats = deriveBuildingStats();
      studioState.geometry = buildSquareFootprint(studioState.location, stats.footprintSqm);
      validatePlacement();
    } else {
      renderStudioPanel();
      updateBuildingSource("ghost");
    }
  }

  function handleBranchClick(event) {
    const branchName = event.target.closest("[data-branch-name]")?.dataset.branchName;
    if (!branchName) return;
    studioState.selectedBranchName = branchName;
    updateAffectedCells();
    renderBranches();
  }

  function init() {
    if (!els.panel) return;
    renderStudioPanel();
    renderBranches();
    renderReasoning();
    els.panel.addEventListener("click", handlePanelClick);
    els.panel.addEventListener("change", handlePanelChange);
    els.branches?.addEventListener("click", handleBranchClick);
    whenMapReady((currentMap) => {
      addStudioLayers(currentMap);
      currentMap.on("style.load", () => {
        window.setTimeout(() => addStudioLayers(currentMap), 0);
      });
    });
  }

  window.BelfastScenarioStudio = {
    state: studioState,
    deriveBuildingStats,
    generateSimulations,
    validatePlacement
  };

  init();
})();
