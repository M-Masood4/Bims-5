$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $repoRoot "data\2026"
$rawDir = Join-Path $dataDir "_raw_osm"
$manifestPath = Join-Path $dataDir "source_manifest_2026.json"

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
New-Item -ItemType Directory -Force -Path $rawDir | Out-Null

$overpassEndpoints = @(
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
)

$nominatimUri = "https://nominatim.openstreetmap.org/search?q=Belfast%2C+Northern+Ireland&format=jsonv2&limit=1&polygon_geojson=1"
$nominatimRawPath = Join-Path $rawDir "belfast_boundary_nominatim.json"
Invoke-WebRequest -Uri $nominatimUri -Method Get -UserAgent "Codex-Belfast-Data-Fetcher/1.0" -OutFile $nominatimRawPath

$nominatimResult = Get-Content -LiteralPath $nominatimRawPath -Raw | ConvertFrom-Json
if (-not $nominatimResult -or $nominatimResult.Count -lt 1) {
  throw "Nominatim did not return a Belfast, Northern Ireland boundary record"
}

$boundaryRecord = $nominatimResult[0]

function Format-OverpassNumber {
  param([Parameter(Mandatory = $true)][double]$Value)
  return $Value.ToString([System.Globalization.CultureInfo]::InvariantCulture)
}

$south = Format-OverpassNumber ([double]$boundaryRecord.boundingbox[0])
$north = Format-OverpassNumber ([double]$boundaryRecord.boundingbox[1])
$west = Format-OverpassNumber ([double]$boundaryRecord.boundingbox[2])
$east = Format-OverpassNumber ([double]$boundaryRecord.boundingbox[3])
$bboxClause = "($south,$west,$north,$east)"

$datasets = @(
  @{
    FileName = "belfastcommercial2026.geojson"
    Description = "Commercial amenities, shops, and offices"
    Query = @"
[out:json][timeout:180];
(
  nwr$bboxClause[shop];
  nwr$bboxClause[office];
  nwr$bboxClause[amenity~"^(bank|bar|biergarten|cafe|car_rental|car_wash|casino|cinema|fast_food|food_court|fuel|ice_cream|marketplace|nightclub|pub|restaurant|theatre)$"];
  nwr$bboxClause[tourism~"^(hotel|hostel|guest_house|apartment)$"];
);
out body;
>;
out skel qt;
"@
  },
  @{
    FileName = "belfastdevelopmentland2026.geojson"
    Description = "Sites tagged as development, brownfield, greenfield, or construction"
    Query = @"
[out:json][timeout:180];
(
  nwr$bboxClause[landuse~"^(brownfield|greenfield|construction)$"];
  nwr$bboxClause[construction];
  nwr$bboxClause["proposed"="construction"];
  nwr$bboxClause["brownfield"="yes"];
);
out body;
>;
out skel qt;
"@
  },
  @{
    FileName = "belfasteducation2026.geojson"
    Description = "Education facilities"
    Query = @"
[out:json][timeout:180];
(
  nwr$bboxClause[amenity~"^(college|driving_school|kindergarten|language_school|library|school|training|university)$"];
  nwr$bboxClause[building~"^(college|kindergarten|school|university)$"];
);
out body;
>;
out skel qt;
"@
  },
  @{
    FileName = "belfasthealthcare2026.geojson"
    Description = "Healthcare facilities"
    Query = @"
[out:json][timeout:180];
(
  nwr$bboxClause[amenity~"^(clinic|dentist|doctors|hospital|nursing_home|pharmacy|social_facility|veterinary)$"];
  nwr$bboxClause[healthcare];
);
out body;
>;
out skel qt;
"@
  },
  @{
    FileName = "belfastlandmarks2026.geojson"
    Description = "Landmarks, tourism, and historic features"
    Query = @"
[out:json][timeout:180];
(
  nwr$bboxClause[tourism~"^(artwork|attraction|gallery|museum|viewpoint|zoo)$"];
  nwr$bboxClause[historic];
  nwr$bboxClause[memorial];
  nwr$bboxClause[man_made~"^(lighthouse|tower)$"];
);
out body;
>;
out skel qt;
"@
  },
  @{
    FileName = "belfastlanduse2026.geojson"
    Description = "Land use polygons"
    Query = @"
[out:json][timeout:180];
(
  way$bboxClause[landuse];
  relation$bboxClause[landuse];
);
out body;
>;
out skel qt;
"@
  },
  @{
    FileName = "belfastplaces2026.geojson"
    Description = "Named places and localities"
    Query = @"
[out:json][timeout:180];
(
  node$bboxClause[place];
);
out body;
>;
out skel qt;
"@
  },
  @{
    FileName = "belfastpublicservices2026.geojson"
    Description = "Public service facilities"
    Query = @"
[out:json][timeout:180];
(
  nwr$bboxClause[amenity~"^(community_centre|courthouse|fire_station|grave_yard|jobcentre|library|police|post_box|post_office|public_bath|recycling|social_facility|telephone|townhall|waste_disposal)$"];
  nwr$bboxClause[office~"^(government|administrative)$"];
  nwr$bboxClause[public_service];
);
out body;
>;
out skel qt;
"@
  },
  @{
    FileName = "belfasttransitroutes2026.geojson"
    Description = "Public transport routes"
    Query = @"
[out:json][timeout:180];
(
  relation$bboxClause[route~"^(bus|coach|ferry|light_rail|rail|subway|train|tram|trolleybus)$"];
);
out body;
>;
out skel qt;
"@
  },
  @{
    FileName = "belfast_bridges_2026.geojson"
    Description = "Bridge features"
    Query = @"
[out:json][timeout:180];
(
  nwr$bboxClause[bridge];
  way$bboxClause[man_made="bridge"];
  relation$bboxClause[man_made="bridge"];
);
out body;
>;
out skel qt;
"@
  },
  @{
    FileName = "belfast_buildings_2026.geojson"
    Description = "Building footprints"
    Query = @"
[out:json][timeout:300];
(
  way$bboxClause[building];
  relation$bboxClause[building];
);
out body;
>;
out skel qt;
"@
  },
  @{
    FileName = "belfast_cycleways_2026.geojson"
    Description = "Cycleways and mapped cycle infrastructure"
    Query = @"
[out:json][timeout:180];
(
  way$bboxClause[highway="cycleway"];
  way$bboxClause[cycleway];
  way$bboxClause["cycleway:left"];
  way$bboxClause["cycleway:right"];
  way$bboxClause["cycleway:both"];
  relation$bboxClause[route="bicycle"];
);
out body;
>;
out skel qt;
"@
  },
  @{
    FileName = "belfast_green_spaces_2026.geojson"
    Description = "Green spaces, parks, woods, and recreation grounds"
    Query = @"
[out:json][timeout:180];
(
  nwr$bboxClause[leisure~"^(garden|golf_course|nature_reserve|park|pitch|playground|recreation_ground)$"];
  nwr$bboxClause[landuse~"^(allotments|cemetery|forest|grass|meadow|orchard|village_green)$"];
  nwr$bboxClause[natural~"^(grassland|heath|scrub|tree_row|wood)$"];
);
out body;
>;
out skel qt;
"@
  },
  @{
    FileName = "belfast_major_roads_2026.geojson"
    Description = "Motorways and major roads"
    Query = @"
[out:json][timeout:180];
(
  way$bboxClause[highway~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link)$"];
);
out body;
>;
out skel qt;
"@
  },
  @{
    FileName = "belfast_roads_2026.geojson"
    Description = "Road network excluding paths and dedicated cycleways"
    Query = @"
[out:json][timeout:300];
(
  way$bboxClause[highway~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|service|living_street|unclassified|road)$"];
);
out body;
>;
out skel qt;
"@
  },
  @{
    FileName = "belfast_transportstops2026.json"
    Description = "Public transport stops, stations, and platforms"
    Query = @"
[out:json][timeout:180];
(
  nwr$bboxClause[public_transport];
  nwr$bboxClause[highway="bus_stop"];
  nwr$bboxClause[railway~"^(halt|platform|station|tram_stop)$"];
  nwr$bboxClause[amenity="bus_station"];
);
out body;
>;
out skel qt;
"@
  },
  @{
    FileName = "belfast_water_2026.geojson"
    Description = "Water bodies and reservoir features"
    Query = @"
[out:json][timeout:180];
(
  way$bboxClause[natural="water"];
  relation$bboxClause[natural="water"];
  way$bboxClause[landuse="reservoir"];
  relation$bboxClause[landuse="reservoir"];
  way$bboxClause[water~"^(lake|pond|reservoir|river|basin|canal)$"];
  relation$bboxClause[water~"^(lake|pond|reservoir|river|basin|canal)$"];
);
out body;
>;
out skel qt;
"@
  }
)

function Invoke-OverpassDownload {
  param(
    [Parameter(Mandatory = $true)][string]$Query,
    [Parameter(Mandatory = $true)][string]$OutFile
  )

  foreach ($endpoint in $overpassEndpoints) {
    try {
      $requestUri = $endpoint + "?data=" + [uri]::EscapeDataString($Query)
      Invoke-WebRequest -Uri $requestUri -Method Get -UserAgent "Codex-Belfast-Data-Fetcher/1.0" -OutFile $OutFile
      return $endpoint
    }
    catch {
      Write-Warning "Overpass request failed at ${endpoint}: $($_.Exception.Message)"
    }
  }

  throw "All Overpass endpoints failed for $OutFile"
}

$manifest = [System.Collections.Generic.List[object]]::new()

$boundaryOutputPath = Join-Path $dataDir "belfastboudnary2026.geojson"
$boundaryFeatureCollection = [ordered]@{
  type = "FeatureCollection"
  features = @(
    [ordered]@{
      type = "Feature"
      properties = [ordered]@{
        name = $boundaryRecord.name
        display_name = $boundaryRecord.display_name
        osm_type = $boundaryRecord.osm_type
        osm_id = $boundaryRecord.osm_id
        licence = $boundaryRecord.licence
        source = "Nominatim OpenStreetMap Search"
      }
      geometry = $boundaryRecord.geojson
    }
  )
}
$boundaryFeatureCollection | ConvertTo-Json -Depth 20 | Out-File -LiteralPath $boundaryOutputPath -Encoding utf8
$boundaryFile = Get-Item -LiteralPath $boundaryOutputPath
$manifest.Add([ordered]@{
  file = "belfastboudnary2026.geojson"
  description = "Belfast administrative boundary"
  source = "Nominatim OpenStreetMap Search"
  endpoint = $nominatimUri
  fetched_at_utc = (Get-Date).ToUniversalTime().ToString("o")
  output_bytes = $boundaryFile.Length
  raw_file = [System.IO.Path]::GetFileName($nominatimRawPath)
  bounding_box = @{
    south = $south
    west = $west
    north = $north
    east = $east
  }
}) | Out-Null

foreach ($dataset in $datasets) {
  $name = $dataset.FileName
  $rawPath = Join-Path $rawDir ($name + ".osm.json")
  $outPath = Join-Path $dataDir $name

  Write-Host "Fetching $name"
  $endpointUsed = Invoke-OverpassDownload -Query $dataset.Query -OutFile $rawPath

  & npx --yes osmtogeojson -f json $rawPath | Out-File -LiteralPath $outPath -Encoding utf8
  if ($LASTEXITCODE -ne 0) {
    throw "osmtogeojson conversion failed for $name"
  }

  $fileInfo = Get-Item -LiteralPath $outPath
  $manifest.Add([ordered]@{
    file = $name
    description = $dataset.Description
    source = "OpenStreetMap Overpass API"
    endpoint = $endpointUsed
    fetched_at_utc = (Get-Date).ToUniversalTime().ToString("o")
    output_bytes = $fileInfo.Length
    raw_file = [System.IO.Path]::GetFileName($rawPath)
    query = $dataset.Query.Trim()
  }) | Out-Null
}

$manifest | ConvertTo-Json -Depth 6 | Out-File -LiteralPath $manifestPath -Encoding utf8
Write-Host "Wrote manifest to $manifestPath"
