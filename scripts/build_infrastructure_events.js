const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const outputPath = path.join(rootDir, "data", "derived", "2026", "belfast_infrastructure_events_2016_2026.json");
const planningDir = path.join(rootDir, "data", "raw", "planning_statistics");

const bbox = [-6.08, 54.52, -5.78, 54.7];
const years = Array.from({ length: 11 }, (_, index) => 2016 + index);

const categoryConfigs = [
  {
    category: "traffic",
    signal: "traffic",
    assetLabel: "road",
    derivedPath: "data/derived/2026/belfast_ni_roads_osm_2026.geojson",
    metaPath: "data/raw/overpass/belfast_road_assets_overpass_meta_2026.json",
    tagKeys: ["highway", "name", "ref"]
  },
  {
    category: "buildings",
    signal: "buildings",
    assetLabel: "building",
    derivedPath: "data/derived/2026/belfast_ni_buildings_3d_core.geojson",
    metaPath: "data/raw/overpass/belfast_building_assets_overpass_meta_2026.json",
    tagKeys: ["building", "name"]
  },
  {
    category: "electricity",
    signal: "electricity",
    assetLabel: "power asset",
    derivedPath: "data/derived/2026/belfast_ni_power_grid_osm_2026.geojson",
    metaPath: "data/raw/overpass/belfast_power_assets_overpass_meta_2026.json",
    tagKeys: ["power", "substation", "voltage", "operator", "name"]
  },
  {
    category: "services",
    signal: "services",
    assetLabel: "service",
    derivedPath: "data/derived/2026/belfast_ni_services_osm_2026.geojson",
    metaPath: "data/raw/overpass/belfast_service_assets_overpass_meta_2026.json",
    tagKeys: ["amenity", "shop", "leisure", "name"]
  }
];

const officialEvents = [
  {
    id: "official-2018-glider-launch",
    year: 2018,
    month: "Sep 2018",
    signal: "traffic",
    category: "traffic",
    title: "Belfast Glider rapid transit service launched",
    subtitle: "Belfast Rapid Transit introduced Glider services across East-West and Titanic Quarter corridors.",
    area: "City Centre",
    coordinates: [-5.9301, 54.5973],
    confidence: "high",
    sourceBasis: "official project/service launch",
    sourceName: "Department for Infrastructure / Translink public information",
    sourceUrl: "https://www.infrastructure-ni.gov.uk/articles/belfast-rapid-transit",
    impactNote: "Use the traffic lens to inspect where bus-priority corridors and city-centre access changes overlap the replay grid."
  },
  {
    id: "official-2023-templemore-baths",
    year: 2023,
    month: "Jun 2023",
    signal: "services",
    category: "services",
    title: "Templemore Baths reopened after restoration",
    subtitle: "A restored leisure and community facility re-entered Belfast's public service network.",
    area: "East Belfast",
    coordinates: [-5.9107, 54.5946],
    confidence: "high",
    sourceBasis: "official council project opening",
    sourceName: "Belfast City Council",
    sourceUrl: "https://www.belfastcity.gov.uk/leisure/centres/templemore-baths",
    impactNote: "Use the services lens to inspect public-service access around East Belfast and the Lagan corridor."
  },
  {
    id: "official-2024-grand-central",
    year: 2024,
    month: "Sep 2024",
    signal: "traffic",
    category: "traffic",
    title: "Belfast Grand Central Station opened",
    subtitle: "The new integrated bus and rail station changed access patterns around the city centre.",
    area: "City Centre",
    coordinates: [-5.9391, 54.5943],
    confidence: "high",
    sourceBasis: "official station opening",
    sourceName: "Translink",
    sourceUrl: "https://www.translink.co.uk/usingtranslink/stations/belfastgrandcentral",
    impactNote: "Use the traffic and jobs lenses to inspect city-centre accessibility and interchange pressure."
  },
  {
    id: "official-2024-york-street-station",
    year: 2024,
    month: "Apr 2024",
    signal: "traffic",
    category: "traffic",
    title: "York Street rail station opened",
    subtitle: "The station replaced Yorkgate and added a new north Belfast rail access point.",
    area: "Cathedral Quarter",
    coordinates: [-5.9238, 54.6092],
    confidence: "high",
    sourceBasis: "official station opening",
    sourceName: "Translink",
    sourceUrl: "https://www.translink.co.uk/usingtranslink/stations/yorkstreet",
    impactNote: "Use the traffic and jobs lenses to inspect access changes between York Street, Cathedral Quarter and north Belfast."
  },
  {
    id: "official-2022-ulster-belfast-campus",
    year: 2022,
    month: "Sep 2022",
    signal: "jobs",
    category: "buildings",
    title: "Ulster University Belfast campus opened to students",
    subtitle: "The expanded city-centre campus created a major education and employment-access anchor.",
    area: "Cathedral Quarter",
    coordinates: [-5.928, 54.6047],
    confidence: "high",
    sourceBasis: "official institutional opening",
    sourceName: "Ulster University",
    sourceUrl: "https://www.ulster.ac.uk/campuses/belfast",
    impactNote: "Use the jobs and buildings lenses to inspect education, employment and development pressure around Cathedral Quarter."
  },
  {
    id: "official-2020-andersonstown-leisure",
    year: 2020,
    month: "Mar 2020",
    signal: "services",
    category: "services",
    title: "Andersonstown Leisure Centre reopened after redevelopment",
    subtitle: "A major leisure redevelopment changed service access in west Belfast.",
    area: "West Belfast",
    coordinates: [-5.999, 54.584],
    confidence: "high",
    sourceBasis: "official council leisure programme",
    sourceName: "Belfast City Council",
    sourceUrl: "https://www.belfastcity.gov.uk/leisure/centres/andersonstown-leisure-centre",
    impactNote: "Use the services lens to inspect civic-service access in west Belfast."
  },
  {
    id: "official-2017-olympia-leisure",
    year: 2017,
    month: "Jan 2017",
    signal: "services",
    category: "services",
    title: "Olympia Leisure Centre entered the new leisure estate",
    subtitle: "The Olympia redevelopment created a new public leisure and community-service anchor.",
    area: "South Belfast",
    coordinates: [-5.955, 54.588],
    confidence: "high",
    sourceBasis: "official council leisure programme",
    sourceName: "Belfast City Council",
    sourceUrl: "https://www.belfastcity.gov.uk/leisure/centres/olympia-leisure-centre",
    impactNote: "Use the services lens to inspect leisure and community access around south Belfast."
  },
  {
    id: "official-2021-transport-hub-works",
    year: 2021,
    month: "Feb 2021",
    signal: "traffic",
    category: "traffic",
    title: "Belfast Transport Hub works advanced at Weavers Cross",
    subtitle: "Construction activity around the transport hub reshaped city-centre access and development pressure.",
    area: "City Centre",
    coordinates: [-5.9391, 54.5943],
    confidence: "medium-high",
    sourceBasis: "official transport-hub project record",
    sourceName: "Translink Weavers Cross",
    sourceUrl: "https://www.weaverscross.co.uk/",
    impactNote: "Use the traffic and buildings lenses to inspect the station district and nearby development cells."
  }
];

const planningCategoryToSignal = {
  Residential: "buildings",
  Commercial: "jobs",
  Industrial: "jobs",
  "Mixed Use": "buildings",
  Civic: "services",
  "Change of Use": "buildings",
  "Electricity Generation": "electricity",
  "Renewable Energy": "electricity"
};

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), "utf8"));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function normaliseEastingNorthing(value) {
  const cleaned = String(value || "").replace(/[^0-9.-]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function niGridToApproxLonLat(easting, northing) {
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) return null;
  return [
    -5.93 + (easting - 333000) / 65000,
    54.6 + (northing - 374000) / 111000,
  ];
}

function parsePlanningDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
    const [day, month, year] = raw.split("/").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parts = raw.split("-");
  if (parts.length !== 3) return null;
  const [day, monthName, yearRaw] = parts;
  const months = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };
  const year = Number(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw);
  const month = months[monthName.slice(0, 3)];
  const date = new Date(Date.UTC(year, month, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date;
}

function planningEvents() {
  if (!fs.existsSync(planningDir)) return [];
  const events = [];
  for (const file of fs.readdirSync(planningDir).filter((name) => name.endsWith(".csv"))) {
    const rows = parseCsv(fs.readFileSync(path.join(planningDir, file), "latin1"));
    const header = rows.shift() || [];
    const index = Object.fromEntries(header.map((name, position) => [name, position]));
    for (const row of rows) {
      const authority = row[index.Authority];
      const lpa = row[index.LPA19NM];
      if (authority !== "Belfast" && lpa !== "Belfast LPA") continue;
      const decision = row[index.Decision_Withdrawal] || row[index["Status@31Mar"]] || "";
      if (!/approved/i.test(decision)) continue;
      const date = parsePlanningDate(row[index.DecisionIssuedDate] || row[index.DateValid] || row[index.DateReceived]);
      if (!date) continue;
      const year = Math.max(2016, Math.min(2026, date.getUTCFullYear()));
      if (!years.includes(year)) continue;
      const easting = normaliseEastingNorthing(row[index.Easting]);
      const northing = normaliseEastingNorthing(row[index.Northing]);
      const point = niGridToApproxLonLat(easting, northing);
      if (!inBelfast(point)) continue;
      const category = row[index.StatsCategory] || "Planning";
      const signal = planningCategoryToSignal[category] || "buildings";
      const appId = row[index.ID] || row[index.Id] || `planning-${file}-${events.length}`;
      const proposal = row[index.Proposal] || "Planning application approved";
      events.push({
        id: `planning-${String(appId).replace(/[^A-Za-z0-9_-]/g, "-")}`,
        sourceId: appId,
        year,
        month: date.toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }),
        signal,
        category: signal,
        title: `${category} planning approval: ${proposal.slice(0, 90)}${proposal.length > 90 ? "..." : ""}`,
        subtitle: `${decision} planning record from Belfast planning statistics dataset.`,
        area: row[index.SiteAddress] || "Belfast",
        coordinates: point.map((value) => Number(value.toFixed(6))),
        confidence: "high",
        sourceBasis: "official planning statistics record",
        sourceName: `Northern Ireland planning statistics ${file}`,
        sourceUrl: "https://www.infrastructure-ni.gov.uk/articles/planning-activity-statistics",
        planningApplicationId: appId,
        planningDecisionDate: row[index.DecisionIssuedDate],
        planningCategory: category,
        planningClassification: row[index.Classification],
        tags: {
          appType: row[index.AppType],
          category,
          classification: row[index.Classification],
          status: row[index["Status@31Mar"]],
        },
        impactNote: "Use the buildings, jobs, services or electricity lens to inspect replay-impact cells around this approved planning record."
      });
    }
  }
  return events;
}

function sourceIdForElement(element) {
  return `${element.type}/${element.id}`;
}

function buildMetaMap(metaPath) {
  const filePath = path.join(rootDir, metaPath);
  if (!fs.existsSync(filePath)) return new Map();
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return new Map((payload.elements || []).map((element) => [sourceIdForElement(element), element]));
}

function walkCoords(value, coords = []) {
  if (!Array.isArray(value)) return coords;
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    coords.push([value[0], value[1]]);
    return coords;
  }
  for (const item of value) walkCoords(item, coords);
  return coords;
}

function centroid(feature) {
  const coords = walkCoords(feature.geometry?.coordinates || []);
  if (!coords.length) return null;
  return [
    coords.reduce((sum, item) => sum + item[0], 0) / coords.length,
    coords.reduce((sum, item) => sum + item[1], 0) / coords.length,
  ];
}

function inBelfast(point) {
  if (!point) return false;
  return point[0] >= bbox[0] && point[0] <= bbox[2] && point[1] >= bbox[1] && point[1] <= bbox[3];
}

function eventYear(timestamp) {
  const year = Number(String(timestamp || "").slice(0, 4));
  if (!Number.isFinite(year)) return null;
  return Math.max(2016, Math.min(2026, year));
}

function titleFor(config, feature, meta) {
  const props = feature.properties || {};
  const tags = meta.tags || {};
  const name = props.name || tags.name;
  const assetType = tags.power || tags.highway || tags.building || tags.amenity || tags.shop || tags.leisure || config.assetLabel;
  if (name) return `${name} ${config.assetLabel} mapped in OSM`;
  return `${assetType} ${config.assetLabel} mapped in OSM`;
}

function publicOsmUrl(sourceId) {
  const [type, id] = String(sourceId).split("/");
  return `https://www.openstreetmap.org/${type}/${id}`;
}

function changesetUrl(changeset) {
  return changeset ? `https://www.openstreetmap.org/changeset/${changeset}` : null;
}

function eventForFeature(config, feature, meta) {
  const props = feature.properties || {};
  const sourceId = props.source_id;
  const year = eventYear(meta.timestamp);
  const point = centroid(feature);
  if (!sourceId || !year || year < 2016 || !inBelfast(point)) return null;
  const tags = meta.tags || {};
  const sourceUrl = publicOsmUrl(sourceId);
  const osmChangesetUrl = changesetUrl(meta.changeset);
  return {
    id: `osm-${config.category}-${sourceId.replace("/", "-")}`,
    sourceId,
    year,
    month: meta.timestamp ? new Date(meta.timestamp).toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) : String(year),
    signal: config.signal,
    category: config.category,
    title: titleFor(config, feature, meta),
    subtitle: `Public OSM mapped-event record for ${config.assetLabel}; use as mapped change evidence, not a confirmed construction/opening date.`,
    area: props.name || tags.name || config.assetLabel,
    coordinates: point.map((value) => Number(value.toFixed(6))),
    confidence: "medium",
    sourceBasis: "OSM mapped infrastructure event",
    sourceName: "OpenStreetMap / Overpass API",
    sourceUrl,
    osmChangesetUrl,
    osmTimestamp: meta.timestamp,
    osmVersion: meta.version,
    osmChangeset: meta.changeset,
    osmUser: meta.user,
    tags: Object.fromEntries(config.tagKeys.map((key) => [key, tags[key] || props[key]]).filter((entry) => entry[1])),
    impactNote: `Use the ${config.signal} lens to inspect cells around this mapped ${config.assetLabel} record.`
  };
}

function jobsEventFrom(event) {
  const tags = event.tags || {};
  const jobLike = Boolean(
    tags.shop ||
      ["commercial", "retail", "office", "university", "college", "school", "hospital", "hotel"].includes(String(tags.building || "")) ||
      ["university", "college", "school", "hospital", "restaurant", "cafe", "bank"].includes(String(tags.amenity || ""))
  );
  if (!jobLike) return null;
  return {
    ...event,
    id: event.id.replace(/^osm-/, "osm-jobs-"),
    signal: "jobs",
    category: "jobs",
    title: event.title.replace(/ mapped in OSM$/, " employment/service anchor mapped in OSM"),
    subtitle: "Public OSM mapped-event record for a commercial, education, health or service anchor used by the jobs/opportunity lens.",
    impactNote: "Use the jobs lens to inspect employment and opportunity access around this mapped public-source record."
  };
}

function dedupe(events) {
  const byId = new Map();
  for (const event of events) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
}

const events = [...officialEvents, ...planningEvents()];
for (const config of categoryConfigs) {
  const source = readJson(config.derivedPath);
  const meta = buildMetaMap(config.metaPath);
  for (const feature of source.features || []) {
    const element = meta.get(feature.properties?.source_id);
    if (!element) continue;
    const event = eventForFeature(config, feature, element);
    if (event) {
      events.push(event);
      const jobsEvent = jobsEventFrom(event);
      if (jobsEvent) events.push(jobsEvent);
    }
  }
}

const compact = dedupe(events);
const payload = {
  schemaVersion: "1.0.0",
  kind: "belfast.infrastructureEventCatalog",
  generatedAt: new Date().toISOString(),
  eventCount: compact.length,
  years,
  basis: [
    "Official public project/opening records for named major events.",
    "OpenStreetMap Overpass metadata timestamp/version/changeset records for asset-level mapped additions.",
    "OSM timestamps prove public mapped visibility, not construction/opening dates."
  ],
  events: compact
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
console.log(`Wrote ${compact.length} infrastructure event(s) to ${outputPath}`);
