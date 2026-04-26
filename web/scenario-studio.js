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

  const SIMULATION_SIGNALS = [
    { id: "traffic", label: "Traffic", metric: "mobilityStrain", tone: "traffic", direction: "down", copy: "movement and corridor pressure" },
    { id: "population", label: "Population", metric: "populationPressure", tone: "population", direction: "growth", copy: "local growth and density change" },
    { id: "jobs", label: "Jobs / Opportunity", metric: "economicOpportunity", tone: "jobs", direction: "up", copy: "direct and indirect opportunity uplift" },
    { id: "services", label: "Services", metric: "servicePressure", tone: "services", direction: "down", copy: "schools, health, amenities and utilities pressure" },
    { id: "electricity", label: "Electricity", metric: "electricityDemand", tone: "electricity", direction: "down", copy: "local grid and energy demand" },
    { id: "environment", label: "Environment", metric: "environmentalExposure", tone: "environment", direction: "down", copy: "exposure, green pressure and mitigation need" },
    { id: "fairness", label: "Fairness", metric: "fairnessScore", tone: "fairness", direction: "up", copy: "who benefits and inclusion reach" }
  ];

  const studioState = {
    placing: false,
    busy: false,
    validating: false,
    error: "",
    decision: "",
    justDropped: false,
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

  let dropMarker = null;

  const els = {
    panel: document.querySelector("#scenarioStudio"),
    branches: document.querySelector("#scenarioBranches"),
    reasoning: document.querySelector("#agentReasoning"),
    proposalImpact: document.querySelector("#proposalImpact"),
    studioTool: document.querySelector("#studioTool"),
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

  function signalDelta(branch, signal) {
    return Number(branch?.diffFromBaseline?.[signal.metric] || 0);
  }

  function signalIsGood(value, signal) {
    if (Math.abs(value) < 0.005) return "neutral";
    if (signal.direction === "growth") return "neutral";
    return signal.direction === "down" ? (value < 0 ? "good" : "risk") : (value > 0 ? "good" : "risk");
  }

  function magnitudeLabel(value, signal) {
    const absolute = Math.abs(Number(value) || 0);
    const direction = value < -0.005 ? "decrease" : value > 0.005 ? "increase" : "limited change";
    if (signal.id === "population" && value > 0.005) {
      if (absolute >= 0.08) return "High density increase";
      if (absolute >= 0.035) return "Significant growth node";
      return "Small local uplift";
    }
    if (absolute >= 0.08) return direction === "increase" ? "High pressure" : "Strong improvement";
    if (absolute >= 0.035) return direction === "increase" ? "Moderate strain" : "Moderate improvement";
    if (absolute >= 0.01) return direction === "increase" ? "Low to moderate impact" : "Small improvement";
    return "Low impact";
  }

  function getBelfastArea(location = studioState.location) {
    if (!location) return "Belfast";
    if (location.lng > -5.91) return "East Belfast";
    if (location.lng < -5.955) return "West Belfast";
    if (location.lat > 54.61) return "North Belfast";
    if (location.lat < 54.585) return "South Belfast";
    return "Central Belfast";
  }

  function typeLabel(type) {
    return {
      apartments: "Apartments",
      mixed_use: "Mixed-use",
      office: "Office-led",
      community: "Community/public"
    }[type] || label(type);
  }

  function proposalName(stats = deriveBuildingStats()) {
    return `${getBelfastArea()} ${typeLabel(stats.buildingType)}`;
  }

  function activityStatement(stats) {
    if (stats.buildingType === "mixed_use") {
      return "This building adds residents, local jobs and neighbourhood services, creating a more balanced activity pattern than a single-use block.";
    }
    if (stats.buildingType === "office") {
      return "This building adds jobs and commuter flow, increasing daytime movement and electricity demand while improving economic opportunity.";
    }
    if (stats.buildingType === "community") {
      return "This building adds service value and public access, with lower population growth but stronger fairness and local support benefits.";
    }
    return "This building adds new residents and housing capacity, increasing demand on roads, transit, schools, shops, services and electricity.";
  }

  function firstOrderCopy(signal, stats, value) {
    const type = stats.buildingType;
    if (signal.id === "traffic") {
      return type === "office"
        ? "Office-led activity creates commuter peaks and extra transit load around the site."
        : "New residents create daily trips and local movement demand on nearby corridors.";
    }
    if (signal.id === "population") return "The proposal becomes a local growth point and changes where future residential pressure lands.";
    if (signal.id === "jobs") {
      return type === "mixed_use" || type === "office"
        ? "Commercial floorspace creates direct employment and local economic activation."
        : "Housing mainly creates indirect opportunity by placing people closer to city jobs and shops.";
    }
    if (signal.id === "services") return "More activity increases demand for schools, health, amenities and day-to-day support systems.";
    if (signal.id === "electricity") return "The building adds a local demand signal to the grid, strongest for larger and office-led schemes.";
    if (signal.id === "environment") return "Urban intensity rises around the site, with green or exposure risks depending on local context.";
    if (signal.id === "fairness") {
      return stats.affordabilityMix === "social" || stats.affordabilityMix === "affordable"
        ? "The access mix improves who benefits, especially where local need is higher."
        : "Fairness gain is limited unless affordability or public access is strengthened.";
    }
    return signal.copy;
  }

  function rippleCopy(stats, validation) {
    const warnings = validation?.warnings || [];
    const parts = [];
    if (stats.estimatedResidents > 0) parts.push("More residents create more movement demand and service pressure.");
    if (stats.estimatedJobs > 0) parts.push("Jobs and visitors add daytime flow but can strengthen local opportunity.");
    if (stats.buildingType === "mixed_use") parts.push("Mixed use can reduce some trip burden because more needs are nearby.");
    if (stats.affordabilityMix === "affordable" || stats.affordabilityMix === "social") parts.push("Affordable access can improve fairness even where traffic pressure rises.");
    if (warnings.some((item) => /transport|road/i.test(item))) parts.push("The site needs mobility support because access is already constrained.");
    if (warnings.some((item) => /green|environment|flood/i.test(item))) parts.push("Green mitigation would improve the environmental branch.");
    return parts.length ? parts : ["This is a proxy scenario: it explores plausible consequences rather than claiming exact forecasts."];
  }

  function branchForImpact() {
    const branches = studioState.simulationResult?.simulation?.branches || [];
    return branches.find((branch) => branch.objective === "user_proposal") || selectedBranch();
  }

  function directEstimate(signal, stats) {
    const residents = Math.min(1, stats.estimatedResidents / 800);
    const jobs = Math.min(1, stats.estimatedJobs / 1000);
    const energy = Math.min(1, stats.estimatedElectricityDemand / 1000);
    const fairness = stats.affordabilityMix === "social" ? 0.07 : stats.affordabilityMix === "affordable" ? 0.045 : 0.018;
    return {
      mobilityStrain: 0.08 * residents + (stats.buildingType === "office" ? 0.035 : 0),
      populationPressure: 0.13 * residents,
      economicOpportunity: 0.11 * jobs + (stats.buildingType === "community" ? 0.04 : 0),
      servicePressure: 0.05 * residents - (stats.buildingType === "community" ? 0.035 : 0),
      electricityDemand: 0.11 * energy,
      environmentalExposure: 0.018 + (stats.floors > 12 ? 0.012 : 0),
      fairnessScore: fairness
    }[signal.metric] || 0;
  }

  function impactValue(signal, branch, stats) {
    const value = branch?.diffFromBaseline?.[signal.metric];
    return Number.isFinite(Number(value)) ? Number(value) : directEstimate(signal, stats);
  }

  function renderSignalDeltas(branch) {
    return SIMULATION_SIGNALS.map((signal) => {
      const value = signalDelta(branch, signal);
      const quality = signalIsGood(value, signal);
      return `
        <b class="signal-delta ${escapeHtml(signal.tone)} ${quality}">
          <span>${escapeHtml(signal.label)}</span>
          <em>${escapeHtml(signedPct(value))}</em>
        </b>
      `;
    }).join("");
  }

  function renderSelectedImpact(branch) {
    if (!branch) return "";
    return `
      <section class="selected-impact">
        <strong>${escapeHtml(branch.name)} impact vs 2036 baseline</strong>
        <div class="impact-signal-grid">
          ${SIMULATION_SIGNALS.map((signal) => {
            const value = signalDelta(branch, signal);
            const quality = signalIsGood(value, signal);
            const magnitude = Math.min(100, Math.max(8, Math.round(Math.abs(value) * 900)));
            return `
              <div class="impact-signal ${escapeHtml(signal.tone)} ${quality}">
                <span><b>${escapeHtml(signal.label)}</b><em>${escapeHtml(signedPct(value))}</em></span>
                <i style="--impact-width:${magnitude}%"></i>
                <small>${escapeHtml(signal.copy)}</small>
              </div>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }

  function renderProposalImpact() {
    if (!els.proposalImpact) return;
    if (!studioState.location) {
      els.proposalImpact.innerHTML = `
        <div class="empty-state">
          <strong>No proposed building yet</strong>
          <span>Drag Building onto Belfast or click Add Building, then click a site.</span>
        </div>
      `;
      return;
    }
    const stats = deriveBuildingStats();
    const branch = branchForImpact();
    const validation = studioState.validation;
    els.proposalImpact.innerHTML = `
      <section class="proposal-summary">
        <span class="proposal-status">This is now a proposed 2036 intervention</span>
        <h3>${escapeHtml(proposalName(stats))}</h3>
        <dl>
          <div><dt>Type</dt><dd>${escapeHtml(typeLabel(stats.buildingType))}</dd></div>
          <div><dt>Size</dt><dd>${escapeHtml(label(stats.size))}</dd></div>
          <div><dt>Access mix</dt><dd>${escapeHtml(label(stats.affordabilityMix))}</dd></div>
          <div><dt>Scenario</dt><dd>Housing Growth Branch</dd></div>
          <div><dt>Status</dt><dd>${studioState.busy ? "Simulation running" : branch ? "Draft simulation ready" : "Draft ready"}</dd></div>
        </dl>
        <p>${escapeHtml(activityStatement(stats))}</p>
      </section>
      <section class="impact-card-grid" aria-label="Building impact cards">
        ${SIMULATION_SIGNALS.map((signal) => {
          const value = impactValue(signal, branch, stats);
          const quality = signalIsGood(value, signal);
          return `
            <article class="impact-card ${escapeHtml(signal.tone)} ${quality}">
              <header>
                <span>${escapeHtml(signal.label)}</span>
                <b>${escapeHtml(magnitudeLabel(value, signal))}</b>
              </header>
              <strong>${escapeHtml(signedPct(value))}</strong>
              <p>${escapeHtml(firstOrderCopy(signal, stats, value))}</p>
            </article>
          `;
        }).join("")}
      </section>
      <section class="ripple-panel">
        <strong>Second-order ripple effects</strong>
        ${rippleCopy(stats, validation).map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
      </section>
    `;
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
    if (!currentMap.getSource("studio-building-handles")) {
      currentMap.addSource("studio-building-handles", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
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
    if (!currentMap.getLayer("studio-building-handles")) {
      currentMap.addLayer({
        id: "studio-building-handles",
        type: "circle",
        source: "studio-building-handles",
        paint: {
          "circle-color": "#ffffff",
          "circle-radius": 5,
          "circle-stroke-color": statusColorExpression(),
          "circle-stroke-width": 2.5,
          "circle-opacity": 0.95
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
      currentMap?.getSource("studio-building-handles")?.setData({ type: "FeatureCollection", features: [] });
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
    currentMap?.getSource("studio-building-handles")?.setData(handleFeaturesFromGeometry(geometry, status));
  }

  function handleFeaturesFromGeometry(geometry, status) {
    const ring = geometry?.coordinates?.[0] || [];
    return {
      type: "FeatureCollection",
      features: ring.slice(0, 4).map((coord, index) => ({
        type: "Feature",
        properties: { status, handle: index + 1 },
        geometry: { type: "Point", coordinates: coord }
      }))
    };
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
    await placeBuildingAt(event.lngLat);
  }

  async function placeBuildingAt(lngLat) {
    const stats = deriveBuildingStats();
    studioState.location = { lng: Number(lngLat.lng.toFixed(6)), lat: Number(lngLat.lat.toFixed(6)) };
    studioState.geometry = buildSquareFootprint(studioState.location, stats.footprintSqm);
    studioState.validation = null;
    studioState.error = "";
    studioState.simulationResult = null;
    studioState.selectedBranchName = "";
    playDropAnimation(studioState.location);
    setPlacementMode(false);
    window.BelfastGitModeA?.setYear?.(2036);
    await validatePlacement();
    if (studioState.validation?.status !== "invalid") {
      await generateSimulations();
    }
    renderBranches();
  }

  function playDropAnimation(location) {
    const currentMap = map();
    if (!currentMap || !window.mapboxgl) return;
    if (dropMarker) dropMarker.remove();
    const markerElement = document.createElement("div");
    markerElement.className = "studio-drop-marker";
    markerElement.innerHTML = "<span></span>";
    dropMarker = new window.mapboxgl.Marker({ element: markerElement, anchor: "center" })
      .setLngLat([location.lng, location.lat])
      .addTo(currentMap);
    studioState.justDropped = true;
    els.app?.classList.add("studio-drop-active");
    window.setTimeout(() => {
      dropMarker?.remove();
      dropMarker = null;
      studioState.justDropped = false;
      els.app?.classList.remove("studio-drop-active");
      renderStudioPanel();
    }, 1400);
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
      renderProposalImpact();
    }
  }

  async function generateSimulations() {
    if (!studioState.location || !studioState.geometry || studioState.validation?.status === "invalid") return;
    studioState.busy = true;
    studioState.error = "";
    studioState.simulationResult = null;
    studioState.selectedBranchName = "";
    studioState.decision = "";
    els.app?.classList.add("studio-simulating");
    renderStudioPanel();
    renderBranches();
    renderReasoning();
    renderProposalImpact();
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
      els.app?.classList.remove("studio-simulating");
      renderStudioPanel();
      renderBranches();
      renderReasoning();
      renderProposalImpact();
    }
  }

  function renderStudioPanel() {
    if (!els.panel) return;
    const stats = deriveBuildingStats();
    const validation = studioState.validation;
    const status = studioState.validating ? "Checking site..." : validation?.siteLabel || validation?.site_label || (studioState.location ? "Site selected" : "Drag Building onto Belfast or click a site");
    const warningList = validation?.warnings || [];
    els.panel.classList.toggle("has-placement", Boolean(studioState.location));
    els.studioTool?.classList.toggle("active", studioState.placing || appState()?.activeView === "studio");
    els.panel.innerHTML = `
      <header class="studio-head">
        <div>
          <strong>2036 Scenario Studio</strong>
          <span>Drop a building into Belfast and test 2036 impact branches.</span>
        </div>
        <b>${escapeHtml(validation?.status || (studioState.placing ? "placing" : "ready"))}</b>
      </header>
      <div class="build-tool-grid">
        <button type="button" data-studio-action="add-building" draggable="true" class="${studioState.placing ? "active" : ""}">Add Building</button>
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
      ${studioState.location ? `
        <div class="simulation-preview ${studioState.justDropped ? "dropped" : ""}">
          <strong>${studioState.justDropped ? "New proposed development added" : "Draft simulation ready"}</strong>
          <span>${escapeHtml(proposalName(stats))}: ${escapeHtml(activityStatement(stats))}</span>
        </div>
      ` : ""}
      ${studioState.error ? `<p class="studio-error">${escapeHtml(studioState.error)}</p>` : ""}
      <button type="button" class="generate-simulations" data-studio-action="generate" ${!studioState.location || studioState.validating || studioState.busy || validation?.status === "invalid" ? "disabled" : ""}>
        ${studioState.busy ? "Simulation agents running..." : "Run / refresh simulation"}
      </button>
      <div class="studio-flow">Buildings work now. Roads, parks and hubs are disabled until their scenario models are ready.</div>
    `;
    renderProposalImpact();
  }

  function renderBranches() {
    if (!els.branches) return;
    if (studioState.busy) {
      els.branches.innerHTML = `
        <div class="simulation-progress">
          <strong>Gemini agents are building futures</strong>
          <span>Coordinator -> specialists -> variants -> deterministic impacts -> critic -> reporter</span>
          <div class="simulation-sweep"><i></i></div>
          <div class="simulation-steps">
            <b>Traffic</b><b>Population</b><b>Jobs</b><b>Services</b><b>Grid</b><b>Environment</b><b>Fairness</b>
          </div>
        </div>
      `;
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
          <span class="branch-deltas simulation-signals">
            ${renderSignalDeltas(branch)}
          </span>
        </button>
      `;
    }).join("");
    renderProposalImpact();
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
    const branch = selectedBranch();
    els.reasoning.innerHTML = `
      <section class="reporter-note">
        <strong>${escapeHtml(report.headline || "Reporter Agent summary")}</strong>
        <p>${escapeHtml(report.summary || "")}</p>
      </section>
      ${renderSelectedImpact(branch)}
      <div class="agent-note">
        <strong>Mobility view <span>Trade-off</span></strong>
        <span>${escapeHtml(branch?.diffFromBaseline?.mobilityStrain > 0 ? "This building adds demand to nearby corridors. Pairing it with transport support improves the branch." : "Mobility pressure is contained by the selected branch assumptions.")}</span>
      </div>
      <div class="agent-note">
        <strong>Fairness view <span>Inclusion</span></strong>
        <span>${escapeHtml(deriveBuildingStats().affordabilityMix === "market" ? "Market-rate delivery has limited inclusion benefit unless affordability is improved." : "The access mix gives the proposal a stronger inclusion benefit than a market-rate version.")}</span>
      </div>
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
      <div class="scenario-actions">
        <button type="button" data-scenario-decision="merge">Merge scenario</button>
        <button type="button" data-scenario-decision="revise">Revise</button>
        <button type="button" data-scenario-decision="reject">Reject</button>
      </div>
      ${studioState.decision ? `<div class="scenario-decision">${escapeHtml(studioState.decision)}</div>` : ""}
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

  function handlePanelDragStart(event) {
    const button = event.target.closest("[data-studio-action='add-building']");
    if (!button) return;
    event.dataTransfer?.setData("text/plain", "add-building");
    event.dataTransfer.effectAllowed = "copy";
    setPlacementMode(true);
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
    renderReasoning();
  }

  function handleReasoningClick(event) {
    const decision = event.target.closest("[data-scenario-decision]")?.dataset.scenarioDecision;
    if (!decision) return;
    const selected = selectedBranch()?.name || "the recommended branch";
    if (decision === "merge") {
      studioState.decision = `${selected} marked for planner merge after review.`;
    } else if (decision === "revise") {
      studioState.decision = `${selected} kept open for revision. Adjust the building config or move the site, then rerun Gemini.`;
    } else {
      studioState.decision = `${selected} rejected for this scenario session.`;
    }
    renderReasoning();
  }

  function init() {
    if (!els.panel) return;
    renderStudioPanel();
    renderBranches();
    renderReasoning();
    renderProposalImpact();
    els.panel.addEventListener("click", handlePanelClick);
    els.panel.addEventListener("change", handlePanelChange);
    els.panel.addEventListener("dragstart", handlePanelDragStart);
    els.reasoning?.addEventListener("click", handleReasoningClick);
    els.studioTool?.addEventListener("click", () => {
      const nextView = appState()?.activeView === "studio" ? "overview" : "studio";
      window.BelfastGitModeA?.setView?.(nextView);
      renderStudioPanel();
    });
    els.branches?.addEventListener("click", handleBranchClick);
    whenMapReady((currentMap) => {
      addStudioLayers(currentMap);
      attachDropHandlers(currentMap);
      currentMap.on("style.load", () => {
        window.setTimeout(() => addStudioLayers(currentMap), 0);
      });
    });
  }

  function attachDropHandlers(currentMap) {
    const canvas = currentMap.getCanvas();
    if (canvas.dataset.studioDropReady === "true") return;
    canvas.dataset.studioDropReady = "true";
    canvas.addEventListener("dragover", (event) => {
      if (event.dataTransfer?.types?.includes("text/plain")) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    });
    canvas.addEventListener("drop", (event) => {
      const value = event.dataTransfer?.getData("text/plain");
      if (value !== "add-building") return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const point = [event.clientX - rect.left, event.clientY - rect.top];
      placeBuildingAt(currentMap.unproject(point));
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
