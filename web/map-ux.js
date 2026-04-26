/* Map UX layer — Google-Maps-style polish for the placement workflow.
 *
 * - Hover preview: when a tool is active, a translucent ghost of what
 *   you're placing follows the cursor across the map.
 * - Drag-and-drop from the toolbar: grab a tool button and drop it on the
 *   map at the spot you want — the preview attaches to the cursor as soon
 *   as you start dragging.
 * - Placed items can be picked up and dragged to a new location, just like
 *   a Google Maps pin.
 * - Keyboard shortcuts: 1–6 for tools, Esc to cancel, Cmd/Ctrl+Z to undo.
 * - Smooth placement ripple, soft cursor states, focus rings.
 *
 * Hooks into the dashboard via window.BelfastDashboard. Idempotent — safe
 * to init() multiple times (e.g. after the map style reloads).
 */
(function () {
  'use strict';

  const PREVIEW_SOURCE = 'map-ux-preview';
  const PREVIEW_LAYER  = 'map-ux-preview-circle';
  const PREVIEW_OUTLINE = 'map-ux-preview-outline';
  const RIPPLE_SOURCE = 'map-ux-ripple';
  const RIPPLE_LAYER  = 'map-ux-ripple-circle';

  const TOOL_COLORS = {
    building: '#3b82f6',
    park: '#22c55e',
    infrastructure: '#f59e0b',
    road: '#22d3ee',
    remove: '#ef4444',
  };

  // T5.3: when the active tool is "building", use the active preset's color
  // (residential / commercial / industrial / mixed_use) so the hover preview
  // and ripple match what's about to be placed. Mirrors PRESETS.building in
  // dashboard.js — keep the two in sync if a new preset is added.
  const BUILDING_PRESET_COLORS = {
    residential: '#a855f7',
    commercial:  '#06b6d4',
    industrial:  '#fb923c',
    mixed_use:   '#22c55e',
  };
  function colorForTool(tool) {
    if (tool === 'building') {
      const d = dash();
      const preset = d && d.state && d.state.activeBuildingPreset;
      return BUILDING_PRESET_COLORS[preset] || TOOL_COLORS.building;
    }
    return TOOL_COLORS[tool] || '#3b82f6';
  }

  const TOOL_SHORTCUTS = {
    '1': 'select',
    '2': 'building',
    '3': 'road',
    '4': 'park',
    '5': 'infrastructure',
    '6': 'remove',
    'b': 'building',
    'r': 'road',
    'p': 'park',
    'e': 'infrastructure',
    'i': 'infrastructure',
    'd': 'remove',
    's': 'select',
  };

  const state = {
    map: null,
    initialised: false,
    layersAdded: false,
    dragGhostEl: null,
    dragging: null,         // {tool} during HTML5 drag-from-toolbar
    pickingUp: null,        // {itemId} during item-relocate drag
    lastPreview: null,      // [lng, lat]
    history: [],            // {type, item} for undo
  };

  function dash() { return window.BelfastDashboard; }
  function activeTool() {
    const d = dash();
    return d && d.state && d.state.activeTool;
  }

  // ---- Preview & ripple sources/layers ----

  function ensureLayers() {
    if (state.layersAdded || !state.map) return false;
    if (!state.map.isStyleLoaded || !state.map.isStyleLoaded()) return false;
    if (!state.map.getSource(PREVIEW_SOURCE)) {
      state.map.addSource(PREVIEW_SOURCE, { type: 'geojson', data: emptyFC() });
    }
    if (!state.map.getLayer(PREVIEW_OUTLINE)) {
      state.map.addLayer({
        id: PREVIEW_OUTLINE,
        type: 'circle',
        source: PREVIEW_SOURCE,
        paint: {
          'circle-radius': 22,
          'circle-color': 'rgba(255,255,255,0)',
          'circle-stroke-width': 2,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-opacity': 0.65,
          'circle-blur': 0.05,
        },
      });
    }
    if (!state.map.getLayer(PREVIEW_LAYER)) {
      state.map.addLayer({
        id: PREVIEW_LAYER,
        type: 'circle',
        source: PREVIEW_SOURCE,
        paint: {
          'circle-radius': 8,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.55,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
          'circle-stroke-opacity': 0.9,
        },
      });
    }
    if (!state.map.getSource(RIPPLE_SOURCE)) {
      state.map.addSource(RIPPLE_SOURCE, { type: 'geojson', data: emptyFC() });
    }
    if (!state.map.getLayer(RIPPLE_LAYER)) {
      state.map.addLayer({
        id: RIPPLE_LAYER,
        type: 'circle',
        source: RIPPLE_SOURCE,
        paint: {
          'circle-radius': ['get', 'radius'],
          'circle-color': ['get', 'color'],
          'circle-opacity': ['get', 'opacity'],
          'circle-stroke-width': 0,
        },
      });
    }
    state.layersAdded = true;
    return true;
  }

  function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

  function setPreview(coord, tool) {
    if (!state.map) return;
    if (!ensureLayers()) {
      // Try once after the style finishes loading.
      state.map.once && state.map.once('styledata', () => setPreview(coord, tool));
      return;
    }
    const src = state.map.getSource(PREVIEW_SOURCE);
    if (!src) return;
    if (!coord || !tool || tool === 'select') {
      src.setData(emptyFC());
      state.lastPreview = null;
      return;
    }
    src.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { color: colorForTool(tool), tool: tool },
        geometry: { type: 'Point', coordinates: coord },
      }],
    });
    state.lastPreview = coord;
  }

  function clearPreview() { setPreview(null, null); }

  function fireRipple(coord, tool) {
    if (!state.map || !coord) return;
    if (!ensureLayers()) return;
    const src = state.map.getSource(RIPPLE_SOURCE);
    if (!src) return;
    const colour = colorForTool(tool);
    const startedAt = performance.now();
    const duration = 720;
    function tick(now) {
      const t = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const r = 8 + eased * 36;
      const opacity = (1 - eased) * 0.55;
      src.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: { radius: r, color: colour, opacity: opacity },
          geometry: { type: 'Point', coordinates: coord },
        }],
      });
      if (t < 1) requestAnimationFrame(tick);
      else src.setData(emptyFC());
    }
    requestAnimationFrame(tick);
  }

  // ---- Cursor styling ----

  function refreshCursor() {
    if (!state.map) return;
    const canvas = state.map.getCanvas();
    if (!canvas) return;
    const t = state.dragging ? state.dragging.tool : activeTool();
    if (!t || t === 'select') canvas.style.cursor = '';
    else if (t === 'remove') canvas.style.cursor = 'crosshair';
    else canvas.style.cursor = 'crosshair';
  }

  // ---- HTML5 drag-and-drop from toolbar ----

  function attachToolbarDrag() {
    const buttons = document.querySelectorAll('#modifyList .tool-btn, #modifyList .modify-btn');
    buttons.forEach(btn => {
      const tool = btn.getAttribute('data-tool');
      if (!tool || tool === 'select') return;
      btn.setAttribute('draggable', 'true');
      btn.addEventListener('dragstart', (e) => onToolbarDragStart(e, tool, btn));
      btn.addEventListener('dragend',   onToolbarDragEnd);
    });
  }

  function onToolbarDragStart(e, tool, btn) {
    state.dragging = { tool: tool };
    // Show a subtle drag image — duplicate the button text + icon
    const ghost = btn.cloneNode(true);
    ghost.style.position = 'absolute';
    ghost.style.top = '-9999px';
    ghost.style.background = '#fff';
    ghost.style.boxShadow = '0 8px 22px rgba(0,0,0,0.18)';
    ghost.style.border = '1.5px solid ' + (colorForTool(tool));
    ghost.style.color = colorForTool(tool);
    document.body.appendChild(ghost);
    state.dragGhostEl = ghost;
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', tool);
      e.dataTransfer.effectAllowed = 'copy';
      try { e.dataTransfer.setDragImage(ghost, 24, 18); } catch (_) {}
    }
    refreshCursor();
  }

  function onToolbarDragEnd() {
    if (state.dragGhostEl && state.dragGhostEl.parentNode) {
      state.dragGhostEl.parentNode.removeChild(state.dragGhostEl);
    }
    state.dragGhostEl = null;
    state.dragging = null;
    clearPreview();
    refreshCursor();
  }

  function attachMapDropZone() {
    if (!state.map) return;
    const canvas = state.map.getCanvasContainer();
    if (!canvas || canvas.dataset.uxDropArmed === '1') return;
    canvas.dataset.uxDropArmed = '1';
    canvas.addEventListener('dragenter', (e) => { e.preventDefault(); });
    canvas.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      if (!state.dragging) return;
      // Translate the cursor pixel into a lng/lat
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      try {
        const lngLat = state.map.unproject([x, y]);
        setPreview([lngLat.lng, lngLat.lat], state.dragging.tool);
      } catch (_) {}
    });
    canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!state.dragging) return;
      const tool = state.dragging.tool;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      let lngLat;
      try { lngLat = state.map.unproject([x, y]); } catch (_) { return; }
      placeViaDrop(tool, [lngLat.lng, lngLat.lat]);
    });
  }

  function placeViaDrop(tool, coord) {
    const d = dash();
    if (!d) return;
    // Auto-jump to a sim year so the placement counts.
    if (typeof d.setYear === 'function' && d.state && d.state.year < 2026) {
      d.setYear(2026);
    }
    // Roads are special — they need two junctions, so a drop just arms the
    // planner near the drop point and prompts the user.
    if (tool === 'road') {
      if (typeof d.armRoadPlanner === 'function') {
        d.armRoadPlanner(coord);
      } else if (d.state && typeof d.setLens === 'function') {
        // best-effort fallback
      }
      return;
    }
    if (tool === 'remove') return;
    if (typeof d.addItemAt === 'function') {
      d.addItemAt(tool, coord[0], coord[1]);
      fireRipple(coord, tool);
      // Track for undo
      const fresh = d.activeBranch && d.activeBranch();
      const lastItem = fresh && fresh.items && fresh.items[fresh.items.length - 1];
      if (lastItem) state.history.push({ type: 'add', itemId: lastItem.id });
    }
  }

  // ---- Item drag-to-relocate ----

  function attachItemDrag() {
    if (!state.map || state.map._uxItemDragArmed) return;
    state.map._uxItemDragArmed = true;
    const layers = ['items-buildings-circle', 'items-parks-circle', 'items-infra-circle', 'items-infra-symbol'];
    layers.forEach(layerId => {
      state.map.on('mouseenter', layerId, () => {
        if (activeTool()) return; // don't conflict with placement
        state.map.getCanvas().style.cursor = 'grab';
      });
      state.map.on('mouseleave', layerId, () => {
        if (activeTool()) return;
        state.map.getCanvas().style.cursor = '';
      });
      state.map.on('mousedown', layerId, onItemMouseDown);
    });
  }

  function onItemMouseDown(e) {
    if (activeTool()) return;
    if (!e.features || !e.features.length) return;
    const itemId = e.features[0].properties && e.features[0].properties.id;
    if (!itemId) return;
    const d = dash();
    const branch = d && d.activeBranch && d.activeBranch();
    if (!branch || branch.locked) return;
    e.preventDefault();
    state.pickingUp = { itemId: itemId, startLngLat: e.lngLat };
    state.map.getCanvas().style.cursor = 'grabbing';
    state.map.dragPan.disable();
    state.map.on('mousemove', onItemMouseMove);
    state.map.once('mouseup', onItemMouseUp);
  }

  function onItemMouseMove(e) {
    if (!state.pickingUp) return;
    const d = dash();
    const branch = d && d.activeBranch && d.activeBranch();
    if (!branch) return;
    const item = branch.items.find(it => it.id === state.pickingUp.itemId);
    if (!item) return;
    item.lng = e.lngLat.lng;
    item.lat = e.lngLat.lat;
    if (typeof d.renderItemsOnMap === 'function') d.renderItemsOnMap();
  }

  function onItemMouseUp() {
    if (!state.pickingUp) return;
    state.pickingUp = null;
    state.map.getCanvas().style.cursor = '';
    state.map.off('mousemove', onItemMouseMove);
    state.map.dragPan.enable();
    const d = dash();
    if (d && typeof d.afterChange === 'function') d.afterChange();
  }

  // ---- Hover preview while a tool is active ----

  function attachHoverPreview() {
    if (!state.map || state.map._uxHoverArmed) return;
    state.map._uxHoverArmed = true;
    state.map.on('mousemove', (e) => {
      const t = activeTool();
      if (!t || t === 'select' || t === 'remove' || state.dragging || state.pickingUp) {
        if (state.lastPreview) clearPreview();
        return;
      }
      setPreview([e.lngLat.lng, e.lngLat.lat], t);
    });
    state.map.on('mouseout', () => clearPreview());
    state.map.on('click', (e) => {
      const t = activeTool();
      if (!t || t === 'select') return;
      // The dashboard's own click handler does the actual placement; we
      // just fire the ripple animation centred on the click point.
      fireRipple([e.lngLat.lng, e.lngLat.lat], t);
    });
  }

  // ---- Keyboard shortcuts ----

  function attachKeyboard() {
    if (window._mapUxKeyboardArmed) return;
    window._mapUxKeyboardArmed = true;
    document.addEventListener('keydown', (e) => {
      // Ignore when typing in an input/textarea/select
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.target && e.target.isContentEditable) return;

      // Esc → cancel any active tool
      if (e.key === 'Escape') {
        const d = dash();
        if (d && d.state && d.state.activeTool) {
          d.state.activeTool = null;
          if (typeof d.renderModify === 'function') d.renderModify();
          clearPreview();
          refreshCursor();
        }
        return;
      }
      // Cmd/Ctrl+Z → undo last add
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        const last = state.history.pop();
        if (last && last.type === 'add') {
          const d = dash();
          if (d && typeof d.removeItem === 'function') {
            d.removeItem(last.itemId);
            e.preventDefault();
          }
        }
        return;
      }
      // 1-6 / b/r/p/e/d/s — route through the toolbar button so it picks
      // up all the same guards the click handler enforces (e.g. road tool
      // requires an armed road planner).
      const k = e.key.toLowerCase();
      const tool = TOOL_SHORTCUTS[k];
      if (tool) {
        const btn = Array.from(document.querySelectorAll('#modifyList .tool-btn, #modifyList .modify-btn'))
          .find(b => b.getAttribute('data-tool') === tool);
        if (btn) {
          btn.click();
          e.preventDefault();
        }
      }
    });
  }

  // ---- Public API / init ----

  function init(opts) {
    state.map = (opts && opts.map) || (dash() && dash().state && dash().state.map);
    if (!state.map) return;
    if (state.initialised) {
      // Just rebind the toolbar drag — the toolbar may have been re-rendered.
      attachToolbarDrag();
      return;
    }
    state.initialised = true;
    // Wait for the map to be ready before adding sources/layers.
    if (state.map.isStyleLoaded && state.map.isStyleLoaded()) {
      ensureLayers();
    } else {
      state.map.on('load', ensureLayers);
    }
    attachMapDropZone();
    attachHoverPreview();
    attachItemDrag();
    attachToolbarDrag();
    attachKeyboard();
    // Keep the cursor in sync when the active tool changes from the toolbar
    // — dashboard.js calls renderModify which we hook into via DOM polling.
    // Lightweight: poll every 200ms for activeTool changes.
    let lastTool = null;
    setInterval(() => {
      const t = activeTool();
      if (t !== lastTool) {
        lastTool = t;
        if (!t || t === 'select') clearPreview();
        refreshCursor();
      }
    }, 200);
  }

  window.MapUX = {
    init: init,
    refreshCursor: refreshCursor,
    attachToolbarDrag: attachToolbarDrag,
    fireRipple: fireRipple,
    clearPreview: clearPreview,
  };
})();
