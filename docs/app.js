// Initialize Maplibre GL JS Map
const DEFAULT_CENTER = [-71.254, -29.908]; // La Serena, Chile
const DEFAULT_ZOOM = 15.2;
const DEFAULT_PITCH = 50;

if (typeof CONFIG !== 'undefined') {
    mapboxgl.accessToken = CONFIG.MAPBOX_ACCESS_TOKEN;
} else {
    console.error("config.js missing! Mapbox features may fail.");
    mapboxgl.accessToken = 'YOUR_MAPBOX_ACCESS_TOKEN_HERE';
}
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12', // Mapbox Streets style
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    pitch: DEFAULT_PITCH,
    bearing: -15,
    antialias: true
});

// Expose map globally for street_view_overlay.js
window.map = map;

// Add Navigation Control (Zoom, Rotate)
map.addControl(new mapboxgl.NavigationControl(), 'top-right');

// Initialize Mapbox GL Draw
const draw = new MapboxDraw({
    displayControlsDefault: false,
    defaultMode: 'simple_select'
});
map.addControl(draw, 'top-right');

// Drawing Toolbar Logic
let currentDrawType = null;
const drawBtns = document.querySelectorAll('.draw-btn');
drawBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const id = btn.id;
        if (id === 'btn-draw-trash') {
            draw.trash();
            return;
        }
        
        drawBtns.forEach(b => b.classList.remove('active'));
        
        if (id === 'btn-draw-subcatchment') {
            currentDrawType = 'SUBCATCHMENTS';
            draw.changeMode('draw_polygon');
            btn.classList.add('active');
        } else if (id === 'btn-draw-raingage') {
            currentDrawType = 'RAINGAGES';
            draw.changeMode('draw_point');
            btn.classList.add('active');
        } else if (id === 'btn-draw-junction') {
            currentDrawType = 'JUNCTIONS';
            draw.changeMode('draw_point');
            btn.classList.add('active');
        } else if (id === 'btn-draw-conduit') {
            currentDrawType = 'CONDUITS';
            draw.changeMode('draw_line_string');
            btn.classList.add('active');
        } else if (id === 'btn-draw-outfall') {
            currentDrawType = 'OUTFALLS';
            draw.changeMode('draw_point');
            btn.classList.add('active');
        }
    });
});

map.on('draw.modechange', (e) => {
    if (e.mode === 'simple_select' || e.mode === 'direct_select') {
        drawBtns.forEach(b => b.classList.remove('active'));
        currentDrawType = null;
    }
});

// Mapbox Draw Events
map.on('draw.selectionchange', (e) => {
    if (e.features.length > 0) {
        openPropertiesEditor(e.features[0], true);
    } else {
        closePropertiesEditor();
    }
});
map.on('draw.create', (e) => {
    console.log('Feature created:', e.features);
    if (!window.swmmData) {
        window.swmmData = {
            title: "New Project",
            options: { FLOW_UNITS: "CMS", INFILTRATION: "HORTON", ROUTING_MODEL: "KINWAVE" },
            raingages: [], subcatchments: [], junctions: [], outfalls: [], conduits: [], coordinates: [], polygons: []
        };
    }
    
    e.features.forEach(f => {
        let newId = generateNextId(currentDrawType || 'UNKNOWN');
        f.id = newId;
        f.properties = f.properties || {};
        f.properties.id = newId;
        f.properties.type = currentDrawType;
        
        if (currentDrawType === 'SUBCATCHMENTS') {
            window.swmmData.subcatchments.push({
                Name: newId, RainGage: "", Outlet: "", Area: 10, PercImperv: 25, Width: 100, PercSlope: 0.5, CurbLength: 0, SnowPack: ""
            });
            window.swmmData.polygons.push({
                Subcatchment: newId, 
                coords: f.geometry.coordinates[0].map(c => ({x: c[0], y: c[1]}))
            });
        } else if (currentDrawType === 'RAINGAGES') {
            window.swmmData.raingages.push({
                Name: newId, Format: "INTENSITY", Interval: "1:00", SCF: 1.0, Source: "TIMESERIES", SeriesName: ""
            });
            window.swmmData.coordinates.push({ Node: newId, x: f.geometry.coordinates[0], y: f.geometry.coordinates[1] });
        } else if (currentDrawType === 'JUNCTIONS') {
            window.swmmData.junctions.push({
                Name: newId, Elevation: 100, MaxDepth: 0, InitDepth: 0, SurDepth: 0, Aponded: 0
            });
            window.swmmData.coordinates.push({ Node: newId, x: f.geometry.coordinates[0], y: f.geometry.coordinates[1] });
        } else if (currentDrawType === 'OUTFALLS') {
            window.swmmData.outfalls.push({
                Name: newId, Elevation: 90, Type: "FREE", StageData: "", Gated: "NO", RouteTo: ""
            });
            window.swmmData.coordinates.push({ Node: newId, x: f.geometry.coordinates[0], y: f.geometry.coordinates[1] });
        } else if (currentDrawType === 'CONDUITS') {
            let coords = f.geometry.coordinates;
            // Generate temporary nodes for the ends if needed, or prompt user. For now, empty InNode/OutNode.
            window.swmmData.conduits.push({
                Name: newId, InNode: "", OutNode: "", Length: 100, Roughness: 0.01, InOffset: 0, OutOffset: 0, InitFlow: 0, MaxFlow: 0
            });
        }
    });
    
    // Refresh UI
    updateUIFromData(window.swmmData);
    if (typeof renderProjectBrowser === 'function') renderProjectBrowser();
});

function generateNextId(category) {
    if (!window.swmmData) return 'NEW-1';
    let prefix = 'N-';
    let arr = [];
    if (category === 'SUBCATCHMENTS') { prefix = 'S-'; arr = window.swmmData.subcatchments; }
    if (category === 'JUNCTIONS') { prefix = 'J-'; arr = window.swmmData.junctions; }
    if (category === 'CONDUITS') { prefix = 'C-'; arr = window.swmmData.conduits; }
    if (category === 'RAINGAGES') { prefix = 'RG-'; arr = window.swmmData.raingages; }
    if (category === 'OUTFALLS') { prefix = 'OUT-'; arr = window.swmmData.outfalls; }
    
    let nextNum = 1;
    if (arr && arr.length > 0) {
        nextNum = arr.length + 1;
    }
    return prefix + nextNum;
}
map.on('draw.delete', (e) => {
    console.log('Feature deleted:', e.features);
    closePropertiesEditor();
});

// DOM Elements
const pitchVal = document.getElementById('val-pitch');
const bearingVal = document.getElementById('val-bearing');
const zoomVal = document.getElementById('val-zoom');
const coordsVal = document.getElementById('val-coords');
const btnImport = document.getElementById('btn-import');
const btnLoadSample = document.getElementById('btn-load-sample');
const fileInput = document.getElementById('file-input');
const dropOverlay = document.getElementById('drop-overlay');
const selectBasemap = document.getElementById('select-basemap');
const btnPegman = document.getElementById('btn-pegman');
const btnCloseSV = document.getElementById('btn-close-sv');
const svWrapper = document.getElementById('street-view-wrapper');

// Native Mapbox Popup
const mapPopup = new mapboxgl.Popup({
    closeButton: true,
    closeOnClick: true,
    className: 'glassmorphic-popup',
    maxWidth: '300px'
});

// Toggle Elements
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
const mainSidebar = document.getElementById('main-sidebar');
const iconChevron = document.getElementById('icon-chevron');

btnToggleSidebar.addEventListener('click', () => {
    mainSidebar.classList.toggle('collapsed');
    if (mainSidebar.classList.contains('collapsed')) {
        iconChevron.style.transform = 'rotate(180deg)';
    } else {
        iconChevron.style.transform = 'rotate(0deg)';
    }
});

// Map State
let selectedFeatureId = null;
window.mapLayers = {};
const boundLayers = new Set();

// Track Camera / Map Status
map.on('move', () => {
    const center = map.getCenter();
    const zoom = map.getZoom();
    const pitch = map.getPitch();
    const bearing = map.getBearing();

    coordsVal.innerText = `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`;
    zoomVal.innerText = zoom.toFixed(1);
    pitchVal.innerText = `${Math.round(pitch)}°`;
    bearingVal.innerText = `${Math.round(bearing)}°`;
});

// Street View Logic
let isStreetViewActive = false;

btnPegman.addEventListener('click', () => {
    isStreetViewActive = !isStreetViewActive;
    if (isStreetViewActive) {
        btnPegman.classList.add('active');
        svWrapper.classList.remove('hidden');
        if (window.StreetViewOverlay) window.StreetViewOverlay.init();
        setTimeout(() => map.resize(), 50); // Map size changed
    } else {
        closeStreetView();
    }
});

btnCloseSV.addEventListener('click', closeStreetView);

function closeStreetView() {
    isStreetViewActive = false;
    btnPegman.classList.remove('active');
    svWrapper.classList.add('hidden');
    if (window.StreetViewOverlay) window.StreetViewOverlay.destroy();
    setTimeout(() => map.resize(), 50);
}

// Function to add 3D building extrusion dynamically to styles that don't have it (or style existing ones)
function add3DBuildingsBaseLayer() {
    const bldgCheckbox = document.getElementById('layer-buildings');
    const visibility = bldgCheckbox && bldgCheckbox.checked ? 'visible' : 'none';
    const isDark = selectBasemap && selectBasemap.value.includes('dark');
    const defaultColor = isDark ? '#2d3748' : '#e2e8f0';

    // If building-3d already exists in the style (e.g., in Bright/Liberty style)
    if (map.getLayer('building-3d')) {
        map.setLayoutProperty('building-3d', 'visibility', visibility);
        
        // Fix missing heights: provide a fallback height of 15m (approx 4-5 floors) for buildings with no height data
        map.setPaintProperty('building-3d', 'fill-extrusion-height', [
            'coalesce',
            ['get', 'render_height'],
            ['get', 'height'],
            15
        ]);

        // Add selection and hover highlights to the base map buildings
        map.setPaintProperty('building-3d', 'fill-extrusion-color', [
            'case',
            ['boolean', ['feature-state', 'selected'], false], '#6366f1',
            ['boolean', ['feature-state', 'hovered'], false], '#818cf8',
            'hsl(35,8%,85%)' // Keep original Liberty/Bright style color
        ]);

        setupInteraction('building-3d', 'composite');
        return;
    }

    if (map.getLayer('3d-buildings-base')) {
        map.setLayoutProperty('3d-buildings-base', 'visibility', visibility);
        
        // Update color dynamically based on basemap theme
        map.setPaintProperty('3d-buildings-base', 'fill-extrusion-color', [
            'case',
            ['boolean', ['feature-state', 'selected'], false], '#6366f1',
            ['boolean', ['feature-state', 'hovered'], false], '#818cf8',
            defaultColor
        ]);

        setupInteraction('3d-buildings-base', 'composite');
        return;
    }

    // Otherwise, check if composite vector source is present and add a custom 3D building layer
    if (!map.getSource('composite')) {
        console.warn("Base map style does not support 'composite' vector building heights.");
        return;
    }

    // Find the first symbol layer to insert the 3D buildings beneath it, keeping labels legible
    const layers = map.getStyle().layers;
    let labelLayerId = null;
    for (let i = 0; i < layers.length; i++) {
        if (layers[i].type === 'symbol' && layers[i].layout && layers[i].layout['text-field']) {
            labelLayerId = layers[i].id;
            break;
        }
    }

    map.addLayer({
        'id': '3d-buildings-base',
        'source': 'composite',
        'source-layer': 'building',
        'filter': ['==', 'extrude', 'true'],
        'type': 'fill-extrusion',
        'minzoom': 14,
        'layout': {
            'visibility': visibility
        },
        'paint': {
            'fill-extrusion-color': [
                'case',
                ['boolean', ['feature-state', 'selected'], false], '#6366f1',
                ['boolean', ['feature-state', 'hovered'], false], '#818cf8',
                defaultColor
            ],
            'fill-extrusion-height': [
                'coalesce',
                ['get', 'render_height'],
                ['get', 'height'],
                15
            ],
            'fill-extrusion-opacity': 0.8
        }
    }, labelLayerId);
    
    setupInteraction('3d-buildings-base', 'composite');
}

// Map Style Load/Changed Event (Fired initially and on map.setStyle)
map.on('style.load', () => {
    console.log("Map style loaded/changed.");
    
    // 1. Add base 3D buildings extrusion
    add3DBuildingsBaseLayer();
    
    // 2. Load 3D terrain if checked
    const terrainCheckbox = document.getElementById('layer-terrain');
    if (terrainCheckbox && terrainCheckbox.checked) {
        if (!map.getSource('terrain')) {
            map.addSource('terrain', {
                type: 'raster-dem',
                url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
                tileSize: 512,
                maxzoom: 14
            });
        }
        map.setTerrain({ source: 'terrain', exaggeration: 1.5 });
    }

    // 3. Re-inject user imported GIS features if loaded
    if (window.mapLayers) {
        Object.keys(window.mapLayers).forEach(layerId => {
            const layer = window.mapLayers[layerId];
            const visibility = layer.visible ? 'visible' : 'none';
            
            // Re-add source
            if (!map.getSource(layerId)) {
                map.addSource(layerId, { type: 'geojson', data: layer.geojson });
            }

            // Points
            if (!map.getLayer(layerId + '-points')) {
                map.addLayer({
                    'id': layerId + '-points',
                    'type': 'circle',
                    'source': layerId,
                    'filter': ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
                    'layout': { 'visibility': visibility },
                    'paint': {
                        'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 8, ['boolean', ['feature-state', 'hovered'], false], 7, 5],
                        'circle-color': layer.color,
                        'circle-stroke-width': 1,
                        'circle-stroke-color': '#fff'
                    }
                });
                setupInteraction(layerId + '-points', layerId);
            }

            // Lines
            if (!map.getLayer(layerId + '-lines')) {
                map.addLayer({
                    'id': layerId + '-lines',
                    'type': 'line',
                    'source': layerId,
                    'filter': ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
                    'layout': { 'line-join': 'round', 'line-cap': 'round', 'visibility': visibility },
                    'paint': {
                        'line-color': layer.color,
                        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 6, ['boolean', ['feature-state', 'hovered'], false], 5, 3]
                    }
                });
                setupInteraction(layerId + '-lines', layerId);
            }

            // Polygons
            if (!map.getLayer(layerId + '-polygons')) {
                map.addLayer({
                    'id': layerId + '-polygons',
                    'type': 'fill',
                    'source': layerId,
                    'filter': ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
                    'layout': { 'visibility': visibility },
                    'paint': {
                        'fill-color': layer.color,
                        'fill-opacity': 0.4,
                        'fill-outline-color': layer.color
                    }
                });
                setupInteraction(layerId + '-polygons', layerId);
            }
        });
    }
});
// Basemap Style Select Listener
document.querySelectorAll('.leaflet-control-layers-base input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        if(e.target.checked) map.setStyle(e.target.value);
    });
});

// Import trigger button
btnImport.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
});

// Drag and drop events
window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dropOverlay.classList.add('active');
});

dropOverlay.addEventListener('dragover', (e) => {
    e.preventDefault();
});

dropOverlay.addEventListener('dragleave', (e) => {
    e.preventDefault();
    // Only hide if we drag outside window
    if (e.relatedTarget === null) {
        dropOverlay.classList.remove('active');
    }
});

dropOverlay.addEventListener('drop', (e) => {
    e.preventDefault();
    dropOverlay.classList.remove('active');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
});

// Load file and parse GeoJSON
function handleFile(file) {
    const fileName = file.name || "Imported Layer";
    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            const geojson = JSON.parse(event.target.result);
            if (false /* Do not merge anymore */) {
                // Append new features to the existing ones
                window.currentGeoJSON.features = window.currentGeoJSON.features.concat(geojson.features);
                processAndLoadGeoJSON(window.currentGeoJSON, true);
            } else {
                processAndLoadGeoJSON(geojson, true, fileName);
            }
        } catch (err) {
            alert("Error parsing GeoJSON file: " + err.message);
        }
    };
    reader.readAsText(file);
}

// Process and Load GeoJSON onto map
function processAndLoadGeoJSON(geojson, fitBounds = true, fileName = 'Imported Layer') {
    // Generate a unique ID for this layer
    const layerId = 'lyr-' + Math.random().toString(36).substr(2, 9);
    
    // Determine color
    let layerColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    // Simple heuristic to grab color from first feature if it exists
    if (geojson.features && geojson.features.length > 0) {
        const props = geojson.features[0].properties || {};
        if (props.stroke) layerColor = props.stroke;
        else if (props['marker-color']) layerColor = props['marker-color'];
        else if (props.fill) layerColor = props.fill;
    }

    // Save to global state
    window.mapLayers[layerId] = {
        name: fileName,
        geojson: geojson,
        color: layerColor,
        visible: true
    };
    window.userLayerIds = window.userLayerIds || [];
    window.userLayerIds.unshift(layerId);

    // Add source
    map.addSource(layerId, { type: 'geojson', data: geojson });

    // Add layer to mapbox based on geometry types
    // Since a GeoJSON can have mixed geometries, we will create a line layer and a circle layer, and a fill layer.
    
    // Points
    map.addLayer({
        'id': layerId + '-points',
        'type': 'circle',
        'source': layerId,
        'filter': ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
        'paint': {
            'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 8, ['boolean', ['feature-state', 'hovered'], false], 7, 5],
            'circle-color': layerColor,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#fff'
        }
    });
    setupInteraction(layerId + '-points', layerId);

    // Lines
    map.addLayer({
        'id': layerId + '-lines',
        'type': 'line',
        'source': layerId,
        'filter': ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
        'layout': { 'line-join': 'round', 'line-cap': 'round' },
        'paint': {
            'line-color': layerColor,
            'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 6, ['boolean', ['feature-state', 'hovered'], false], 5, 3]
        }
    });
    setupInteraction(layerId + '-lines', layerId);

    // Polygons
    map.addLayer({
        'id': layerId + '-polygons',
        'type': 'fill-extrusion',
        'source': layerId,
        'filter': ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
        'paint': {
            'fill-extrusion-color': layerColor,
            'fill-extrusion-height': 0,
            'fill-extrusion-opacity': 0.4
        }
    });
    setupInteraction(layerId + '-polygons', layerId);

    // Add UI Toggle
    addLayerToControl(layerId, fileName, layerColor);

    if (fitBounds) {
        fitMapBounds(geojson);
    }
}

function addLayerToControl(layerId, name, color) {
    const container = document.getElementById('overlay-layers-container');
    const label = document.createElement('label');
    
    // Basic color validation: fallback to #666666 if the color is not a valid hex for the color picker
    const validHex = /^#[0-9A-F]{6}$/i.test(color) ? color : '#666666';

    label.innerHTML = `
        <div style="display:flex; align-items:center; width:100%; justify-content:space-between; gap: 8px;">
            <div style="display:flex; align-items:center;">
                <input type="checkbox" class="leaflet-control-layers-selector" checked>
                <input type="color" class="layer-color-picker" value="${validHex}" style="width: 20px; height: 20px; padding: 0; border: none; border-radius: 3px; cursor: pointer; margin-right: 8px; background: none; flex-shrink: 0;" title="Change Layer Color">
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100px;" title="${name}">${name}</span>
            </div>
            <div class="layer-controls-actions" style="display:flex; align-items:center; gap:4px;">
                <button type="button" class="layer-height-toggle" title="Toggle 3D Height">3D</button>
                <input type="range" class="layer-opacity-slider" min="0" max="100" value="100" style="width: 40px;" title="Opacity">
                <div style="display:flex; flex-direction:column; gap:2px;">
                    <button type="button" class="btn-layer-up" style="background:none;border:none;color:white;cursor:pointer;padding:0;line-height:0.8;font-size:10px;" title="Move Up">▲</button>
                    <button type="button" class="btn-layer-down" style="background:none;border:none;color:white;cursor:pointer;padding:0;line-height:0.8;font-size:10px;" title="Move Down">▼</button>
                </div>
            </div>
        </div>
    `;
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.width = '100%';
    label.dataset.layerId = layerId;
    
    const firstUserLayer = container.children[2];
    if (firstUserLayer) {
        container.insertBefore(label, firstUserLayer);
    } else {
        container.appendChild(label);
    }

    const checkbox = label.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', (e) => {
        const visibility = e.target.checked ? 'visible' : 'none';
        window.mapLayers[layerId].visible = e.target.checked;
        if (map.getLayer(layerId + '-points')) map.setLayoutProperty(layerId + '-points', 'visibility', visibility);
        if (map.getLayer(layerId + '-lines')) map.setLayoutProperty(layerId + '-lines', 'visibility', visibility);
        if (map.getLayer(layerId + '-polygons')) map.setLayoutProperty(layerId + '-polygons', 'visibility', visibility);
    });

    const colorPicker = label.querySelector('input[type="color"]');
    colorPicker.addEventListener('input', (e) => {
        const newColor = e.target.value;
        window.mapLayers[layerId].color = newColor;
        
        if (map.getLayer(layerId + '-points')) map.setPaintProperty(layerId + '-points', 'circle-color', newColor);
        if (map.getLayer(layerId + '-lines')) map.setPaintProperty(layerId + '-lines', 'line-color', newColor);
        if (map.getLayer(layerId + '-polygons')) {
            map.setPaintProperty(layerId + '-polygons', 'fill-extrusion-color', newColor);
        }
    });

    const opacitySlider = label.querySelector('.layer-opacity-slider');
    opacitySlider.addEventListener('input', (e) => {
        const opacity = parseInt(e.target.value) / 100;
        if (map.getLayer(layerId + '-points')) map.setPaintProperty(layerId + '-points', 'circle-opacity', opacity);
        if (map.getLayer(layerId + '-lines')) map.setPaintProperty(layerId + '-lines', 'line-opacity', opacity);
        if (map.getLayer(layerId + '-polygons')) map.setPaintProperty(layerId + '-polygons', 'fill-extrusion-opacity', opacity * 0.4);
    });

    const heightToggle = label.querySelector('.layer-height-toggle');
    heightToggle.addEventListener('click', (e) => {
        e.target.classList.toggle('active');
        const is3D = e.target.classList.contains('active');
        if (map.getLayer(layerId + '-polygons')) {
            if (is3D) {
                map.setPaintProperty(layerId + '-polygons', 'fill-extrusion-height', ['coalesce', ['get', 'height'], ['get', 'elevation'], 15]);
            } else {
                map.setPaintProperty(layerId + '-polygons', 'fill-extrusion-height', 0);
            }
        }
    });

    const btnUp = label.querySelector('.btn-layer-up');
    const btnDown = label.querySelector('.btn-layer-down');
    btnUp.addEventListener('click', () => moveLayerUi(layerId, -1, label));
    btnDown.addEventListener('click', () => moveLayerUi(layerId, 1, label));
}

// Fit camera view to bounding box of GeoJSON
function fitMapBounds(geojson) {
    const coordinates = [];
    geojson.features.forEach(f => {
        const geom = f.geometry;
        if (!geom) return;
        
        if (geom.type === "Point") {
            coordinates.push(geom.coordinates);
        } else if (geom.type === "MultiPoint") {
            geom.coordinates.forEach(c => coordinates.push(c));
        } else if (geom.type === "LineString") {
            geom.coordinates.forEach(c => coordinates.push(c));
        } else if (geom.type === "MultiLineString") {
            geom.coordinates.forEach(ls => ls.forEach(c => coordinates.push(c)));
        } else if (geom.type === "Polygon") {
            geom.coordinates.forEach(ring => ring.forEach(c => coordinates.push(c)));
        } else if (geom.type === "MultiPolygon") {
            geom.coordinates.forEach(poly => poly.forEach(ring => ring.forEach(c => coordinates.push(c))));
        }
    });

    if (coordinates.length === 0) return;

    // Fit bounds to network
    const bounds = coordinates.reduce(function (bounds, coord) {
        return bounds.extend(coord);
    }, new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]));

    map.fitBounds(bounds, { padding: 80, duration: 1500, maxZoom: 18 });
}

// Remove previously added GIS sources & layers
function removeGISLayers() {
    Object.keys(window.mapLayers).forEach(layerId => {
        if (map.getLayer(layerId + '-points')) map.removeLayer(layerId + '-points');
        if (map.getLayer(layerId + '-lines')) map.removeLayer(layerId + '-lines');
        if (map.getLayer(layerId + '-polygons')) map.removeLayer(layerId + '-polygons');
        if (map.getSource(layerId)) map.removeSource(layerId);
    });
    window.mapLayers = {};
    clearSelection();
    
    // Also remove the toggles from UI
    const container = document.getElementById('overlay-layers-container');
    // Keep the first two (buildings and terrain)
    const children = Array.from(container.children);
    for (let i = 2; i < children.length; i++) {
        container.removeChild(children[i]);
    }
}

// Setup click and hover interaction for map elements
let hoveredFeature = null;

function setupInteraction(layerId, sourceId) {
    if (boundLayers.has(layerId)) return;
    boundLayers.add(layerId);

    // Click
    map.on('click', layerId, (e) => {
        if (e.features.length === 0) return;

        // Reset previous selection
        if (selectedFeatureId !== null && map.getLayer(layerId)) {
            map.setFeatureState(
                { source: sourceId, id: selectedFeatureId },
                { selected: false }
            );
        }

        const feature = e.features[0];
        selectedFeatureId = feature.id;

        map.setFeatureState(
            { source: sourceId, id: selectedFeatureId },
            { selected: true }
        );

        showAttributes(feature, e.lngLat);
        openPropertiesEditor(feature, false, sourceId);
    });

    // Hover effect
    map.on('mousemove', layerId, (e) => {
        if (e.features.length > 0) {
            map.getCanvas().style.cursor = 'pointer';
            
            if (hoveredFeature && hoveredFeature.id !== e.features[0].id) {
                map.setFeatureState(
                    { source: sourceId, id: hoveredFeature.id },
                    { hovered: false }
                );
            }
            
            hoveredFeature = e.features[0];
            map.setFeatureState(
                { source: sourceId, id: hoveredFeature.id },
                { hovered: true }
            );
        }
    });

    map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = '';
        if (hoveredFeature) {
            map.setFeatureState(
                { source: sourceId, id: hoveredFeature.id },
                { hovered: false }
            );
            hoveredFeature = null;
        }
    });
}

// Show selected feature attributes in a native Mapbox Popup
function showAttributes(feature, lngLat) {
    const props = feature.properties || {};
    const table = document.createElement('table');
    table.className = 'qgis2web-table';

    let html = `<tr><th>Field</th><th>Value</th></tr>`;
    
    // Injected properties
    html += `<tr><td><i>Feature ID</i></td><td>${feature.id || 'N/A'}</td></tr>`;

    // Standard properties
    Object.entries(props).forEach(([key, val]) => {
        const valStr = typeof val === 'object' ? JSON.stringify(val) : String(val);
        // Only show if not empty like qgis2web
        if (valStr.trim() !== '') {
            html += `<tr><td>${key}</td><td>${valStr}</td></tr>`;
        }
    });

    table.innerHTML = html;

    // Display Popup on the map
    mapPopup.setLngLat(lngLat)
        .setDOMContent(table)
        .addTo(map);

    mapPopup.once('close', () => {
        clearSelection();
    });
}

// Clear Selection
function clearSelection() {
    selectedFeatureId = null;
    mapPopup.remove();
}

// Layer visibility toggles for base maps
document.getElementById('layer-buildings').addEventListener('change', (e) => {
    const visibility = e.target.checked ? 'visible' : 'none';
    if (map.getLayer('3d-buildings-base')) map.setLayoutProperty('3d-buildings-base', 'visibility', visibility);
});

document.getElementById('layer-terrain').addEventListener('change', (e) => {
    if (e.target.checked) {
        if (!map.getSource('terrain')) {
            map.addSource('terrain', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
        }
        map.setTerrain({ source: 'terrain', exaggeration: 1.5 });
    } else {
        map.setTerrain(null);
    }
});

// Load Sample Network Event
btnLoadSample.addEventListener('click', () => {
    // Generate a beautiful sample network around La Serena
    const centerLng = DEFAULT_CENTER[0];
    const centerLat = DEFAULT_CENTER[1];

    const sampleGeoJSON = {
        type: "FeatureCollection",
        features: [
            // Nodes (Junctions)
            {
                type: "Feature",
                id: 101,
                geometry: { type: "Point", coordinates: [centerLng, centerLat] },
                properties: { name: "Junction_1", elevation: "12.4m", type: "Storage" }
            },
            {
                type: "Feature",
                id: 102,
                geometry: { type: "Point", coordinates: [centerLng + 0.003, centerLat + 0.002] },
                properties: { name: "Junction_2", elevation: "14.1m", type: "Junction" }
            },
            {
                type: "Feature",
                id: 103,
                geometry: { type: "Point", coordinates: [centerLng - 0.002, centerLat + 0.003] },
                properties: { name: "Junction_3", elevation: "15.0m", type: "Junction" }
            },
            {
                type: "Feature",
                id: 104,
                geometry: { type: "Point", coordinates: [centerLng + 0.001, centerLat - 0.003] },
                properties: { name: "Outfall_1", elevation: "9.2m", type: "Outfall" }
            },
            
            // Conduits (Pipes)
            {
                type: "Feature",
                id: 201,
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [centerLng, centerLat],
                        [centerLng + 0.003, centerLat + 0.002]
                    ]
                },
                properties: { name: "Pipe_1", length: "340m", diameter: "600mm", material: "Concrete" }
            },
            {
                type: "Feature",
                id: 202,
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [centerLng, centerLat],
                        [centerLng - 0.002, centerLat + 0.003]
                    ]
                },
                properties: { name: "Pipe_2", length: "420m", diameter: "450mm", material: "PVC" }
            },
            {
                type: "Feature",
                id: 203,
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [centerLng - 0.002, centerLat + 0.003],
                        [centerLng + 0.001, centerLat - 0.003]
                    ]
                },
                properties: { name: "Pipe_3", length: "720m", diameter: "800mm", material: "Concrete" }
            },

            // 3D Buildings
            {
                type: "Feature",
                id: 301,
                geometry: {
                    type: "Polygon",
                    coordinates: [[
                        [centerLng + 0.0005, centerLat + 0.0005],
                        [centerLng + 0.0012, centerLat + 0.0005],
                        [centerLng + 0.0012, centerLat + 0.0010],
                        [centerLng + 0.0005, centerLat + 0.0010],
                        [centerLng + 0.0005, centerLat + 0.0005]
                    ]]
                },
                properties: { name: "NEER Office HQ", height: 28, building: "office", levels: 8 }
            },
            {
                type: "Feature",
                id: 302,
                geometry: {
                    type: "Polygon",
                    coordinates: [[
                        [centerLng - 0.0008, centerLat - 0.0008],
                        [centerLng - 0.0015, centerLat - 0.0008],
                        [centerLng - 0.0015, centerLat - 0.0015],
                        [centerLng - 0.0008, centerLat - 0.0015],
                        [centerLng - 0.0008, centerLat - 0.0008]
                    ]]
                },
                properties: { name: "Urban Apartments", height: 42, building: "residential", levels: 14 }
            },
            {
                type: "Feature",
                id: 303,
                geometry: {
                    type: "Polygon",
                    coordinates: [[
                        [centerLng + 0.002, centerLat - 0.001],
                        [centerLng + 0.0028, centerLat - 0.001],
                        [centerLng + 0.0028, centerLat - 0.0018],
                        [centerLng + 0.002, centerLat - 0.0018],
                        [centerLng + 0.002, centerLat - 0.001]
                    ]]
                },
                properties: { name: "Commercial Mall", height: 15, building: "commercial", levels: 3 }
            }
        ]
    };

    processAndLoadGeoJSON(sampleGeoJSON, true, "Sample Network");
});

// --- SWMM UI Logic ---
const btnSwmmOptions = document.getElementById('btn-swmm-options');
const swmmOptionsPanel = document.getElementById('swmm-options-panel');
const btnCloseOptions = document.getElementById('btn-close-options');

const OPTIONS_MAPPING = {
    'END_DATE': 'opt-end-date',
    'END_TIME': 'opt-end-time',
    'REPORT_START_DATE': 'opt-report-start-date',
    'REPORT_START_TIME': 'opt-report-start-time',
    'SWEEP_START': 'opt-sweep-start',
    'SWEEP_END': 'opt-sweep-end',
    'DRY_DAYS': 'opt-dry-days',
    'REPORT_STEP': 'opt-report-step',
    'DRY_STEP': 'opt-dry-step',
    'WET_STEP': 'opt-wet-step',
    'CONTROL_STEP': 'opt-control-step',
    'ROUTING_STEP': 'opt-routing-step',
    'SKIP_STEADY_STATE': 'opt-skip-steady-state',
    'SYS_FLOW_TOL': 'opt-sys-flow-tol',
    'LAT_FLOW_TOL': 'opt-lat-flow-tol'
};

function populateOptionsPanel() {
    if (!window.swmmData || !window.swmmData['OPTIONS']) return;
    const options = window.swmmData['OPTIONS'];
    options.forEach(row => {
        if (row.length >= 2) {
            const key = row[0].toUpperCase();
            const val = row[1];
            if (OPTIONS_MAPPING[key]) {
                const el = document.getElementById(OPTIONS_MAPPING[key]);
                if (el) el.value = val;
            }
        }
    });
}

function saveOptionsPanel() {
    if (!window.swmmData) window.swmmData = {};
    if (!window.swmmData['OPTIONS']) window.swmmData['OPTIONS'] = [];
    
    // Create a map of existing options
    const optMap = {};
    window.swmmData['OPTIONS'].forEach((row, index) => {
        if(row.length > 0) optMap[row[0].toUpperCase()] = index;
    });

    for (const [key, id] of Object.entries(OPTIONS_MAPPING)) {
        const el = document.getElementById(id);
        if (el) {
            if (optMap[key] !== undefined) {
                window.swmmData['OPTIONS'][optMap[key]][1] = el.value;
            } else {
                window.swmmData['OPTIONS'].push([key, el.value]);
            }
        }
    }
}

// Bind inputs to save on change
Object.values(OPTIONS_MAPPING).forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('change', saveOptionsPanel);
    }
});

if (btnSwmmOptions && swmmOptionsPanel && btnCloseOptions) {
    btnSwmmOptions.addEventListener('click', () => {
        populateOptionsPanel();
        swmmOptionsPanel.classList.add('active');
    });
    btnCloseOptions.addEventListener('click', () => {
        saveOptionsPanel();
        swmmOptionsPanel.classList.remove('active');
    });
}

// Draggable Floating Panel
const fpHeader = document.getElementById('swmm-options-header');
if (fpHeader && swmmOptionsPanel) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    fpHeader.addEventListener('mousedown', (e) => {
        if(e.target.closest('.fp-close') || e.target.closest('button') || e.target.closest('input')) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        const rect = swmmOptionsPanel.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        
        swmmOptionsPanel.style.transform = 'none';
        swmmOptionsPanel.style.right = 'auto';
        swmmOptionsPanel.style.bottom = 'auto';
        swmmOptionsPanel.style.margin = '0';
        swmmOptionsPanel.style.left = initialLeft + 'px';
        swmmOptionsPanel.style.top = initialTop + 'px';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        swmmOptionsPanel.style.left = (initialLeft + dx) + 'px';
        swmmOptionsPanel.style.top = (initialTop + dy) + 'px';
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

// ============================================
// .inp File Upload & Parsing Logic
// ============================================
const btnUploadInp = document.getElementById('btn-upload-inp');
const inpFileInput = document.getElementById('inp-file-input');
const projectionModal = document.getElementById('projection-modal');
const btnCancelProj = document.getElementById('btn-cancel-proj');
const btnConfirmProj = document.getElementById('btn-confirm-proj');
const utmOptions = document.getElementById('utm-options');
const localOptions = document.getElementById('local-options');
const radioCoordTypes = document.querySelectorAll('input[name="coord-type"]');
const epsgCodeInput = document.getElementById('epsg-code-input');

let pendingInpText = "";

if (btnUploadInp && inpFileInput) {
    btnUploadInp.addEventListener('click', () => {
        inpFileInput.click();
    });

    inpFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            pendingInpText = e.target.result;
            if (projectionModal) projectionModal.style.display = 'flex'; // Show modal
        };
        reader.readAsText(file);
    });
}

if (projectionModal) {
    radioCoordTypes.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'utm') {
                utmOptions.style.display = 'block';
                localOptions.style.display = 'none';
            } else {
                utmOptions.style.display = 'none';
                localOptions.style.display = 'block';
            }
        });
    });

    btnCancelProj.addEventListener('click', () => {
        projectionModal.style.display = 'none';
        inpFileInput.value = ''; // Reset
    });

    btnConfirmProj.addEventListener('click', async () => {
        projectionModal.style.display = 'none';
        const coordType = document.querySelector('input[name="coord-type"]:checked').value;
        const isUtm = coordType === 'utm';
        const epsgCode = epsgCodeInput.value.trim() || 'EPSG:32719';
        
        await loadInpData(pendingInpText, isUtm, epsgCode);
        inpFileInput.value = ''; // Reset
    });
}

async function fetchProjDef(epsgCode) {
    const code = epsgCode.split(':')[1];
    if (!code) return null;
    try {
        const res = await fetch(`https://epsg.io/${code}.proj4`);
        if (res.ok) {
            return await res.text();
        }
    } catch(err) {
        console.warn("Failed to fetch proj4 definition", err);
    }
    return null;
}

function normalizeLocalCoords(parsed) {
    // Mapbox requires lat/lon bounds. Local coordinates can exceed -180/180.
    // We scale them down and center at [0,0].
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    parsed.nodes.features.forEach(f => {
        const c = f.geometry.coordinates;
        if(c[0] < minX) minX = c[0];
        if(c[0] > maxX) maxX = c[0];
        if(c[1] < minY) minY = c[1];
        if(c[1] > maxY) maxY = c[1];
    });

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const maxRange = Math.max(rangeX, rangeY);
    const scale = 0.05 / maxRange; // Fit within ~0.05 degrees
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const transform = (x, y) => {
        return [(x - cx) * scale, (y - cy) * scale];
    };

    parsed.nodes.features.forEach(f => {
        const c = f.geometry.coordinates;
        f.geometry.coordinates = transform(c[0], c[1]);
    });
    parsed.links.features.forEach(f => {
        const c = f.geometry.coordinates;
        f.geometry.coordinates = [ transform(c[0][0], c[0][1]), transform(c[1][0], c[1][1]) ];
    });
    parsed.subcatchments.features.forEach(f => {
        const ring = f.geometry.coordinates[0];
        f.geometry.coordinates[0] = ring.map(pt => transform(pt[0], pt[1]));
    });
}

async function loadInpData(text, isUtm, epsgCode) {
    if (isUtm && window.proj4) {
        const projDef = await fetchProjDef(epsgCode);
        if (projDef) {
            proj4.defs(epsgCode, projDef);
        }
    }

    const parsed = window.inpParser.parse(text);
    
    // Store all non-spatial data
    window.swmmData = parsed.rawSections;
    console.log("Loaded SWMM Data Hierarchy:", Object.keys(window.swmmData));
    
    // Attempt to render the tree view if it exists
    if (typeof renderProjectBrowser === 'function') {
        renderProjectBrowser();
    }

    const transformCoord = (x, y) => {
        if (!isUtm) return [x, y];
        if (!window.proj4) return [x, y];
        try {
            return proj4(epsgCode, 'EPSG:4326', [x, y]);
        } catch(e) {
            return [x, y];
        }
    };

    if (isUtm) {
        parsed.nodes.features.forEach(f => {
            const coord = f.geometry.coordinates;
            f.geometry.coordinates = transformCoord(coord[0], coord[1]);
        });
        parsed.links.features.forEach(f => {
            const coords = f.geometry.coordinates;
            f.geometry.coordinates = [ transformCoord(coords[0][0], coords[0][1]), transformCoord(coords[1][0], coords[1][1]) ];
        });
        parsed.subcatchments.features.forEach(f => {
            const ring = f.geometry.coordinates[0];
            f.geometry.coordinates[0] = ring.map(pt => transformCoord(pt[0], pt[1]));
        });
        
        map.setStyle('mapbox://styles/mapbox/dark-v11');
    } else {
        normalizeLocalCoords(parsed);
        // Change to blank canvas
        map.setStyle({
            version: 8,
            sources: {},
            layers: [{
                id: 'background',
                type: 'background',
                paint: { 'background-color': '#1e293b' } // Use a dark slate blank canvas instead of white to match the theme
            }]
        });
    }

    // Wait for style load to add sources
    const onStyleLoad = () => {
        updateMapSources(parsed);
        
        // Fit Bounds
        if (parsed.nodes.features.length > 0) {
            const bounds = new mapboxgl.LngLatBounds();
            parsed.nodes.features.forEach(f => {
                bounds.extend(f.geometry.coordinates);
            });
            map.fitBounds(bounds, { padding: 50, maxZoom: 18 });
        }
    };

    if (!map.isStyleLoaded()) {
        map.once('style.load', onStyleLoad);
    } else {
        // If we switched to the same style or it's already loaded
        setTimeout(onStyleLoad, 200);
    }

    // Update Sidebar Counts
    const cards = document.querySelectorAll('.swmm-card');
    const updateCard = (title, count) => {
        cards.forEach(card => {
            if (card.querySelector('.swmm-card-title').innerText.trim().toLowerCase().includes(title.toLowerCase())) {
                const badge = card.querySelector('.swmm-card-badge');
                badge.innerText = count;
                badge.classList.remove('empty');
                if (count === 0) badge.classList.add('empty');
            }
        });
    };

    updateCard('Rain Gages', parsed.counts.raingages);
    updateCard('Subcatchments', parsed.counts.subcatchments);
    updateCard('Junctions', parsed.counts.junctions);
    updateCard('Outfalls', parsed.counts.outfalls);
    updateCard('Storage', parsed.counts.storage);
    updateCard('Dividers', parsed.counts.dividers);
    updateCard('Conduits', parsed.counts.conduits);
    
    // Show run button
    const btnRunSimulation = document.getElementById('btn-run-simulation');
    if (btnRunSimulation) {
        btnRunSimulation.style.display = 'flex';
    }
}

// ============================================
// WebAssembly SWMM Engine Logic
// ============================================
let swmmModule = null;
if (typeof createModule !== 'undefined') {
    createModule().then(mod => {
        swmmModule = mod;
        console.log('SWMM WASM Engine Loaded');
    });
}
const btnRunSimulation = document.getElementById('btn-run-simulation');
if (btnRunSimulation) {
    btnRunSimulation.addEventListener('click', () => {
        if (!swmmModule) {
            alert("SWMM Engine is still loading...");
            return;
        }
        if (!pendingInpText) {
            alert("No .inp data loaded.");
            return;
        }

        try {
            console.log("Preparing virtual file system...");
            
            // Re-serialize the SWMM data to string before running to capture any UI changes
            if (window.inpParser && typeof window.inpParser.serialize === 'function' && window.swmmData) {
                pendingInpText = window.inpParser.serialize(window.swmmData);
            }
            
            swmmModule.FS.writeFile('/in.inp', pendingInpText);

            console.log("Running SWMM simulation...");
            btnRunSimulation.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg> Running...';
            btnRunSimulation.disabled = true;

            // setTimeout ensures the UI updates to show "Running..." before blocking the main thread
            setTimeout(() => {
                try {
                    // Execute simulation through our wrapper C function
                    if (swmmModule._run_swmm_wasm) {
                        console.log("Calling _run_swmm_wasm");
                        let exitCode = swmmModule._run_swmm_wasm();
                        console.log("Simulation finished with exit code:", exitCode);
                    } else {
                        throw new Error("No entry point found in SWMM WebAssembly Module. Did _run_swmm_wasm export correctly?");
                    }

                    console.log("Files in /:", swmmModule.FS.readdir('/'));

                    let rpt = "";
                    try {
                        rpt = swmmModule.FS.readFile('/rpt.rpt', { encoding: 'utf8' });
                        console.log("Report generated successfully.");
                    } catch(err) {
                        console.warn("Could not read /rpt.rpt. Trying rpt.rpt");
                        try {
                            rpt = swmmModule.FS.readFile('rpt.rpt', { encoding: 'utf8' });
                        } catch (err2) {
                            alert("Simulation failed or crashed. No report generated.");
                            throw new Error("No report generated.");
                        }
                    }

                    // Parse binary out.out
                    let outBuf = null;
                    try {
                        let outArray = swmmModule.FS.readFile('/out.out', { encoding: 'binary' });
                        outBuf = outArray.buffer.slice(outArray.byteOffset, outArray.byteOffset + outArray.byteLength);
                    } catch (err) {
                        console.warn("Could not read /out.out. Binary results not available.");
                    }

                    if (outBuf) {
                        window.swmmResults = new window.SWMMOutParser(outBuf);
                        if (window.swmmResults.parse()) {
                            console.log("Successfully parsed binary results with", window.swmmResults.numPeriods, "time steps.");
                            if (typeof initAnimationControls === 'function') initAnimationControls();
                        } else {
                            window.swmmResults = null;
                        }
                    }

                    // Update UI with results
                    const resultsContent = document.getElementById('results-content');
                    const resultsModal = document.getElementById('results-modal');
                    const btnViewResults = document.getElementById('btn-view-results');
                    
                    if (resultsContent && resultsModal) {
                        resultsContent.textContent = rpt;
                        resultsModal.style.display = 'flex';
                    }
                    
                    if (btnViewResults) {
                        btnViewResults.style.opacity = '1';
                        btnViewResults.style.pointerEvents = 'auto';
                        btnViewResults.textContent = "View Results";
                    }

                } catch(e) {
                    console.error("SWMM crash:", e);
                    const keys = Object.keys(swmmModule).filter(k => typeof swmmModule[k] === 'function').join(', ');
                    alert("Crash Error: " + e.message + "\n\nAvailable functions: " + keys.substring(0, 500));
                } finally {
                    btnRunSimulation.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8 5v14l11-7z"/></svg> Run Simulation';
                    btnRunSimulation.disabled = false;
                }
            }, 50);

        } catch (err) {
            console.error("Setup error:", err);
            alert("Failed to prepare simulation.");
            btnRunSimulation.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M8 5v14l11-7z"/></svg> Run Simulation';
            btnRunSimulation.disabled = false;
        }
    });
}

function updateMapSources(parsed) {
    if (map.getSource('swmm-nodes')) {
        map.getSource('swmm-nodes').setData(parsed.nodes);
    } else {
        map.addSource('swmm-nodes', { type: 'geojson', data: parsed.nodes });
        map.addLayer({
            id: 'swmm-nodes-layer',
            type: 'circle',
            source: 'swmm-nodes',
            paint: {
                'circle-radius': 5,
                'circle-color': [
                    'match', ['get', 'type'],
                    'OUTFALLS', '#2dd4bf',
                    'STORAGE', '#65a30d',
                    'DIVIDERS', '#eab308',
                    '#fde047' // default JUNCTIONS
                ],
                'circle-stroke-width': 1,
                'circle-stroke-color': '#000'
            }
        });
    }

    if (map.getSource('swmm-links')) {
        map.getSource('swmm-links').setData(parsed.links);
    } else {
        map.addSource('swmm-links', { type: 'geojson', data: parsed.links });
        map.addLayer({
            id: 'swmm-links-layer',
            type: 'line',
            source: 'swmm-links',
            paint: {
                'line-color': '#3b82f6',
                'line-width': 3
            }
        });
    }

    if (map.getSource('swmm-subcatchments')) {
        map.getSource('swmm-subcatchments').setData(parsed.subcatchments);
    } else {
        map.addSource('swmm-subcatchments', { type: 'geojson', data: parsed.subcatchments });
        map.addLayer({
            id: 'swmm-subcatchments-layer',
            type: 'fill',
            source: 'swmm-subcatchments',
            paint: {
                'fill-color': '#4ade80',
                'fill-opacity': 0.3,
                'fill-outline-color': '#22c55e'
            }
        }, 'swmm-links-layer'); 
    }
}

// Reordering logic
function moveLayerUi(layerId, direction, labelElement) {
    const idx = window.userLayerIds.indexOf(layerId);
    if (idx < 0) return;
    
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= window.userLayerIds.length) return;
    
    // Swap in array
    const targetLayerId = window.userLayerIds[targetIdx];
    window.userLayerIds[idx] = targetLayerId;
    window.userLayerIds[targetIdx] = layerId;
    
    // Move in UI
    const container = document.getElementById('overlay-layers-container');
    if (direction === -1) {
        // Move up (before the previous element)
        container.insertBefore(labelElement, labelElement.previousElementSibling);
    } else {
        // Move down (after the next element)
        container.insertBefore(labelElement.nextElementSibling, labelElement);
    }
    
    // Move in Mapbox
    // Higher in UI list means rendered on top, which means added AFTER in Mapbox.
    // We can just iterate through userLayerIds in reverse and use map.moveLayer
    // Because index 0 is top of UI, it should be drawn LAST.
    // The layer at the end of userLayerIds should be drawn FIRST (bottom of UI).
    for (let i = window.userLayerIds.length - 1; i >= 0; i--) {
        const lId = window.userLayerIds[i];
        if (map.getLayer(lId + '-polygons')) map.moveLayer(lId + '-polygons');
        if (map.getLayer(lId + '-lines')) map.moveLayer(lId + '-lines');
        if (map.getLayer(lId + '-points')) map.moveLayer(lId + '-points');
    }
}

// Data Table Logic
let tableCurrentPage = 1;
const TABLE_PAGE_SIZE = 50;

const btnDataTable = document.getElementById('btn-data-table');
const dataTablePanel = document.getElementById('data-table-panel');
const btnCloseDataTable = document.getElementById('btn-close-data-table');
const layerSelect = document.getElementById('data-table-layer-select');
const tableContainer = document.getElementById('data-table-container');
const paginationContainer = document.getElementById('data-table-pagination');
const btnSaveGeojson = document.getElementById('btn-save-geojson');

if (btnDataTable && dataTablePanel) {
    btnDataTable.addEventListener('click', () => {
        dataTablePanel.classList.remove('hidden');
        populateTableLayerSelect();
    });
    
    btnCloseDataTable.addEventListener('click', () => {
        dataTablePanel.classList.add('hidden');
    });
    
    layerSelect.addEventListener('change', (e) => {
        tableCurrentPage = 1;
        renderDataTable(e.target.value, tableCurrentPage);
    });

    if (btnSaveGeojson) {
        btnSaveGeojson.addEventListener('click', () => {
            const layerId = layerSelect.value;
            if (!layerId || !window.mapLayers[layerId]) return;
            
            const geojson = window.mapLayers[layerId].geojson;
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(geojson));
            const dlAnchorElem = document.createElement('a');
            dlAnchorElem.setAttribute("href", dataStr);
            dlAnchorElem.setAttribute("download", window.mapLayers[layerId].name + "_modified.geojson");
            dlAnchorElem.click();
        });
    }
}

function populateTableLayerSelect() {
    layerSelect.innerHTML = '';
    const layerIds = Object.keys(window.mapLayers);
    if (layerIds.length === 0) {
        layerSelect.innerHTML = '<option disabled selected>No layers imported</option>';
        tableContainer.innerHTML = '<p style="color: #aaa; text-align: center; margin-top: 20px;">No data to display.</p>';
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }
    layerIds.forEach(id => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = window.mapLayers[id].name;
        layerSelect.appendChild(option);
    });
    tableCurrentPage = 1;
    renderDataTable(layerSelect.value, tableCurrentPage);
}

function updatePaginationUI(totalItems, currentPage) {
    if (!paginationContainer) return;
    
    const totalPages = Math.ceil(totalItems / TABLE_PAGE_SIZE);
    
    if (totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }
    
    paginationContainer.innerHTML = `
        <button id="btn-page-prev" class="btn-secondary" style="padding: 4px 10px; font-size: 12px; width: auto;" ${currentPage === 1 ? 'disabled' : ''}>Prev</button>
        <span style="color: white; font-size: 12px;">Page ${currentPage} of ${totalPages}</span>
        <button id="btn-page-next" class="btn-secondary" style="padding: 4px 10px; font-size: 12px; width: auto;" ${currentPage === totalPages ? 'disabled' : ''}>Next</button>
    `;
    
    const btnPrev = document.getElementById('btn-page-prev');
    const btnNext = document.getElementById('btn-page-next');
    
    if (btnPrev) {
        btnPrev.addEventListener('click', () => {
            if (tableCurrentPage > 1) {
                tableCurrentPage--;
                renderDataTable(layerSelect.value, tableCurrentPage);
            }
        });
    }
    
    if (btnNext) {
        btnNext.addEventListener('click', () => {
            if (tableCurrentPage < totalPages) {
                tableCurrentPage++;
                renderDataTable(layerSelect.value, tableCurrentPage);
            }
        });
    }
}

function renderDataTable(layerId, page = 1) {
    if (!layerId || !window.mapLayers[layerId]) {
        tableContainer.innerHTML = '';
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }
    
    const geojson = window.mapLayers[layerId].geojson;
    const features = geojson.features;
    if (!features || features.length === 0) {
        tableContainer.innerHTML = '<p style="color: #aaa; text-align: center; margin-top: 20px;">No features found.</p>';
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }
    
    updatePaginationUI(features.length, page);
    
    // Extract all unique property keys
    const keys = new Set();
    features.forEach(f => {
        if (f.properties) {
            Object.keys(f.properties).forEach(k => keys.add(k));
        }
    });
    
    const columns = Array.from(keys);
    
    let html = '<table><thead><tr>';
    html += '<th>ID / Index</th>';
    columns.forEach(col => {
        html += `<th>${col}</th>`;
    });
    html += '</tr></thead><tbody>';
    
    const startIndex = (page - 1) * TABLE_PAGE_SIZE;
    const endIndex = Math.min(startIndex + TABLE_PAGE_SIZE, features.length);
    const paginatedFeatures = features.slice(startIndex, endIndex);
    
    paginatedFeatures.forEach((f, idxInPage) => {
        const actualIdx = startIndex + idxInPage;
        html += `<tr>`;
        html += `<td>${f.id !== undefined ? f.id : actualIdx}</td>`;
        columns.forEach(col => {
            const val = f.properties && f.properties[col] !== undefined ? f.properties[col] : '';
            html += `<td><input type="text" class="table-input" data-layer="${layerId}" data-feat-idx="${actualIdx}" data-prop="${col}" value="${val}"></td>`;
        });
        html += `</tr>`;
    });
    html += '</tbody></table>';
    
    tableContainer.innerHTML = html;
    
    // Attach change event listeners to inputs to modify GeoJSON and update Map
    const inputs = tableContainer.querySelectorAll('.table-input');
    inputs.forEach(input => {
        input.addEventListener('change', (e) => {
            const lId = e.target.getAttribute('data-layer');
            const fIdx = parseInt(e.target.getAttribute('data-feat-idx'), 10);
            const prop = e.target.getAttribute('data-prop');
            const newVal = e.target.value;
            
            const feature = window.mapLayers[lId].geojson.features[fIdx];
            if (!feature.properties) feature.properties = {};
            
            // Try parsing number if applicable
            const parsedNum = parseFloat(newVal);
            if (!isNaN(parsedNum) && parsedNum.toString() === newVal) {
                feature.properties[prop] = parsedNum;
            } else {
                feature.properties[prop] = newVal;
            }
            
            // Update source
            if (map.getSource(lId)) {
                map.getSource(lId).setData(window.mapLayers[lId].geojson);
            }
        });
    });
}

// ==========================================
// Results Modal UI Events
// ==========================================
const btnViewResults = document.getElementById('btn-view-results');
const btnCloseResults = document.getElementById('btn-close-results');
const resultsModal = document.getElementById('results-modal');

if (btnViewResults && resultsModal) {
    btnViewResults.addEventListener('click', () => {
        resultsModal.style.display = 'flex';
    });
}

if (btnCloseResults && resultsModal) {
    btnCloseResults.addEventListener('click', () => {
        resultsModal.style.display = 'none';
    });
}

// ==========================================
// Properties Editor
// ==========================================
const propertiesSidebar = document.getElementById('properties-sidebar');
const propertiesContent = document.getElementById('properties-content');
const btnCloseProperties = document.getElementById('btn-close-properties');

let currentEditingFeature = null;
let currentEditingIsDraw = false;
let currentEditingLayerId = null; // For native map features

if (btnCloseProperties) {
    btnCloseProperties.addEventListener('click', closePropertiesEditor);
}

function closePropertiesEditor() {
    propertiesSidebar.classList.add('hidden');
    currentEditingFeature = null;
    currentEditingIsDraw = false;
    currentEditingLayerId = null;
    
    // Deselect from Mapbox Draw
    if (typeof draw !== 'undefined' && draw) {
        draw.changeMode('simple_select');
    }
}

function openPropertiesEditor(feature, isDrawFeature, layerId = null) {
    currentEditingFeature = feature;
    currentEditingIsDraw = isDrawFeature;
    currentEditingLayerId = layerId;
    
    propertiesSidebar.classList.remove('hidden');
    
    let html = '';
    const props = feature.properties || {};
    
    // Auto-generate input fields for each property
    Object.keys(props).forEach(key => {
        html += `
            <div class="prop-row">
                <span class="prop-label">${key}</span>
                <input type="text" class="prop-input" data-key="${key}" value="${props[key]}">
            </div>
        `;
    });
    
    // If no properties exist, show a message and allow adding new ones
    if (Object.keys(props).length === 0) {
        html = '<p style="color: #aaa; font-size: 13px;">No properties defined for this element.</p>';
    }
    html += `
        <div class="prop-row" style="margin-top: 16px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 16px;">
            <span class="prop-label">New Property (e.g. Elevation)</span>
            <input type="text" id="new-prop-key" class="prop-input" placeholder="Property Name" style="margin-bottom: 8px;">
            <input type="text" id="new-prop-val" class="prop-input" placeholder="Value">
            <button id="btn-add-prop" class="btn-primary" style="margin-top: 8px; width: 100%;">Add Property</button>
        </div>
    `;
    
    propertiesContent.innerHTML = html;
    
    // Wire up property change events
    const inputs = propertiesContent.querySelectorAll('input.prop-input[data-key]');
    inputs.forEach(input => {
        input.addEventListener('change', (e) => {
            const key = e.target.getAttribute('data-key');
            let val = e.target.value;
            
            // Try parsing as number
            const numVal = parseFloat(val);
            if (!isNaN(numVal) && numVal.toString() === val) {
                val = numVal;
            }
            
            currentEditingFeature.properties[key] = val;
            
            // Update source
            if (currentEditingIsDraw && typeof draw !== 'undefined') {
                draw.add(currentEditingFeature);
            } else if (currentEditingLayerId && window.mapLayers[currentEditingLayerId]) {
                const geojson = window.mapLayers[currentEditingLayerId].geojson;
                // Find and update the feature
                const featIndex = geojson.features.findIndex(f => 
                    (f.id === currentEditingFeature.id) || 
                    (f.properties && f.properties.Name === currentEditingFeature.properties.Name)
                );
                
                if (featIndex !== -1) {
                    geojson.features[featIndex].properties[key] = val;
                    if (map.getSource(currentEditingLayerId)) {
                        map.getSource(currentEditingLayerId).setData(geojson);
                    }
                }
            }
        });
    });
    
    const btnAddProp = document.getElementById('btn-add-prop');
    if (btnAddProp) {
        btnAddProp.addEventListener('click', () => {
            const k = document.getElementById('new-prop-key').value.trim();
            const v = document.getElementById('new-prop-val').value.trim();
            if (k && v) {
                if (!currentEditingFeature.properties) currentEditingFeature.properties = {};
                currentEditingFeature.properties[k] = v;
                
                if (currentEditingIsDraw && typeof draw !== 'undefined') {
                    draw.add(currentEditingFeature);
                }
                openPropertiesEditor(currentEditingFeature, currentEditingIsDraw, currentEditingLayerId);
            }
        });
    }

    // Attempt to show chart if results are available
    if (window.swmmResults && window.swmmResults.parsed) {
        let swmmType = null;
        let swmmIndex = -1;
        
        if (props.type === 'SUBCATCHMENTS' || (props.id && props.Area !== undefined)) {
            swmmType = 'SUBCATCHMENT';
            swmmIndex = window.swmmResults.names.subcatchments.indexOf(props.id);
        } else if (props.type === 'NODES' || props.type === 'JUNCTIONS' || props.type === 'OUTFALLS' || (props.id && props.InvertElev !== undefined)) {
            swmmType = 'NODE';
            swmmIndex = window.swmmResults.names.nodes.indexOf(props.id);
        } else if (props.type === 'CONDUITS' || props.type === 'LINKS' || (props.id && props.Node1 !== undefined)) {
            swmmType = 'LINK';
            swmmIndex = window.swmmResults.names.links.indexOf(props.id);
        }
        
        if (swmmType && swmmIndex >= 0) {
            window.showPropertiesChart(swmmType, props.id, swmmIndex);
        } else {
            document.getElementById('properties-chart-container').style.display = 'none';
        }
    } else {
        document.getElementById('properties-chart-container').style.display = 'none';
    }
}

// ==========================================
// Project Browser Tree View & Data Editor
// ==========================================
function renderProjectBrowser() {
    const treeNodes = document.querySelectorAll('.tree-expandable');
    treeNodes.forEach(node => {
        // Prevent multiple listeners
        node.replaceWith(node.cloneNode(true));
    });
    
    document.querySelectorAll('.tree-expandable').forEach(node => {
        node.addEventListener('click', (e) => {
            if (e.target !== node && !node.contains(e.target)) return;
            node.classList.toggle('expanded');
            const branch = node.nextElementSibling;
            if (branch && branch.classList.contains('tree-branch')) {
                branch.classList.toggle('hidden');
            }
        });
    });

    const treeLeaves = document.querySelectorAll('.tree-leaf');
    treeLeaves.forEach(leaf => {
        leaf.replaceWith(leaf.cloneNode(true));
    });
    
    document.querySelectorAll('.tree-leaf').forEach(leaf => {
        leaf.addEventListener('click', (e) => {
            const category = leaf.getAttribute('data-category');
            if (category === 'OPTIONS') {
                const optionsPanel = document.getElementById('swmm-options-panel');
                if (optionsPanel) {
                    populateOptionsPanel();
                    optionsPanel.classList.add('active');
                }

            } else if (category) {
                openDataEditor(category);
            }
        });
    });
}

const dataEditorModal = document.getElementById('data-editor-modal');
const btnCloseDataEditor = document.getElementById('btn-close-data-editor');
const btnCancelDataEditor = document.getElementById('btn-data-editor-cancel');
const btnSaveDataEditor = document.getElementById('btn-data-editor-save');
const dataEditorBody = document.getElementById('data-editor-body');
const dataEditorTitle = document.getElementById('data-editor-title');
let currentEditorCategory = null;

function renderDataEditorRows(lines) {
    if (!lines || lines.length === 0) {
        if (dataEditorBody) dataEditorBody.innerHTML = '<table class="data-table-grid"><tbody></tbody></table><p style="color: #8b949e; text-align: center; margin-top: 10px;" id="empty-editor-msg">No entries found. Click "+ Add Row" to create one.</p>';
    } else {
        let html = '<table class="data-table-grid"><tbody>';
        lines.forEach((line, index) => {
            const safeLine = line.replace(/"/g, '&quot;');
            html += `<tr>
                <td style="width: 40px; color: #8b949e; text-align: center;">${index + 1}</td>
                <td><input type="text" value="${safeLine}" data-index="${index}" class="editor-row-input"></td>
            </tr>`;
        });
        html += '</tbody></table>';
        if (dataEditorBody) dataEditorBody.innerHTML = html;
    }
}

function openDataEditor(category) {
    if (!window.swmmData) {
        window.swmmData = {};
    }
    if (!window.swmmData[category]) {
        window.swmmData[category] = [];
    }
    
    currentEditorCategory = category;
    if (dataEditorTitle) dataEditorTitle.innerText = `Data Editor: ${category}`;
    
    renderDataEditorRows(window.swmmData[category]);
    
    if (dataEditorModal) dataEditorModal.style.display = 'flex';
}

function closeDataEditor() {
    if (dataEditorModal) dataEditorModal.style.display = 'none';
    currentEditorCategory = null;
}

if (btnCloseDataEditor) btnCloseDataEditor.addEventListener('click', closeDataEditor);
if (btnCancelDataEditor) btnCancelDataEditor.addEventListener('click', closeDataEditor);

if (btnSaveDataEditor) {
    btnSaveDataEditor.addEventListener('click', () => {
        if (!currentEditorCategory || !window.swmmData || !window.swmmData[currentEditorCategory]) return;
        
        const inputs = dataEditorBody.querySelectorAll('.editor-row-input');
        const newData = [];
        inputs.forEach(input => {
            const val = input.value.trim();
            if (val) newData.push(val);
        });
        
        window.swmmData[currentEditorCategory] = newData;
        console.log(`Updated ${currentEditorCategory} with ${newData.length} lines.`);
        closeDataEditor();
        
        // Reflect these changes to the pendingInpText if possible
        if (window.inpParser && typeof window.inpParser.serialize === 'function') {
            // we will need a serialize method. For now, it just saves in memory.
            console.log("To fully serialize back, implement inpParser.serialize().");
        }
    });
}

const btnAddRowDataEditor = document.getElementById('btn-data-editor-add-row');
if (btnAddRowDataEditor) {
    btnAddRowDataEditor.addEventListener('click', () => {
        if (!currentEditorCategory || !window.swmmData) return;
        if (!window.swmmData[currentEditorCategory]) window.swmmData[currentEditorCategory] = [];
        
        // Grab existing inputs so we don't lose typed data
        const inputs = dataEditorBody.querySelectorAll('.editor-row-input');
        const newData = [];
        inputs.forEach(input => {
            newData.push(input.value);
        });
        
        // Add one empty row
        newData.push('');
        window.swmmData[currentEditorCategory] = newData;
        
        // Re-render
        renderDataEditorRows(newData);
    });
}

// Initial binding
renderProjectBrowser();


// ==============================================
// Animation & Chart Logic
// ==============================================
let animInterval = null;
let animStep = 0;
let isPlaying = false;
let propertiesChart = null;
let currentChartType = null;
let currentChartId = null;

window.initAnimationControls = function() {
    if (!window.swmmResults || !window.swmmResults.parsed) return;
    
    const toolbar = document.getElementById('animation-toolbar');
    toolbar.classList.remove('hidden');
    
    const slider = document.getElementById('anim-slider');
    slider.max = window.swmmResults.numPeriods - 1;
    slider.value = 0;
    
    const playBtn = document.getElementById('btn-anim-play');
    playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    
    const updateTimeLabel = () => {
        const timeDays = window.swmmResults.results.times[animStep];
        if (timeDays === undefined) return;
        // SWMM time is decimal days since 12/30/1899
        // Approximation for label (relative to day 1)
        const days = Math.floor(timeDays);
        const fraction = timeDays - days;
        const hours = Math.floor(fraction * 24);
        const mins = Math.floor((fraction * 24 - hours) * 60);
        const secs = Math.floor(((fraction * 24 - hours) * 60 - mins) * 60);
        document.getElementById('anim-time-label').innerText = `Day ${days} ${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    };
    
    const updateMapColors = () => {
        // Here we could update Mapbox / Cesium features based on current step
        // For example, conduit flow (varIndex = 0 for flow)
        if (window.swmmResults.counts.links > 0 && map.getSource('conduits')) {
            const flows = window.swmmResults.getStepData('LINK', animStep, 0); // 0 = flow
            // Optional: apply these flows as line-color or line-width in mapbox
            // Currently left as a hook for Cesium or advanced 2D Mapbox
        }
    };
    
    const stepAnimation = () => {
        if (animStep < window.swmmResults.numPeriods - 1) {
            animStep++;
        } else {
            animStep = 0;
            togglePlay(); // stop at end
        }
        slider.value = animStep;
        updateTimeLabel();
        updateMapColors();
    };
    
    const togglePlay = () => {
        isPlaying = !isPlaying;
        if (isPlaying) {
            playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>'; // pause icon
            if (animStep >= window.swmmResults.numPeriods - 1) animStep = 0;
            animInterval = setInterval(stepAnimation, 100);
        } else {
            playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'; // play icon
            clearInterval(animInterval);
        }
    };
    
    playBtn.onclick = togglePlay;
    slider.oninput = (e) => {
        animStep = parseInt(e.target.value);
        updateTimeLabel();
        updateMapColors();
    };
    
    updateTimeLabel();
};

window.showPropertiesChart = function(type, id, swmmIndex) {
    if (!window.swmmResults || !window.swmmResults.parsed) return;
    
    currentChartType = type;
    currentChartId = id;
    
    const container = document.getElementById('properties-chart-container');
    container.style.display = 'block';
    
    const select = document.getElementById('chart-variable-select');
    select.innerHTML = '';
    
    let varNames = [];
    if (type === 'SUBCATCHMENT') {
        varNames = ['Precipitation', 'SnowDepth', 'Evaporation', 'Infiltration', 'Runoff', 'GW Flow', 'GW Elev', 'Soil Moisture'];
    } else if (type === 'NODE') {
        varNames = ['Depth', 'Head', 'Volume', 'Lateral Inflow', 'Total Inflow', 'Flooding'];
    } else if (type === 'LINK') {
        varNames = ['Flow', 'Depth', 'Velocity', 'Volume', 'Capacity'];
    }
    
    varNames.forEach((name, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.innerText = name;
        select.appendChild(opt);
    });
    
    select.onchange = () => updateChart(type, swmmIndex, parseInt(select.value));
    updateChart(type, swmmIndex, 0);
};

function updateChart(type, swmmIndex, varIndex) {
    const series = window.swmmResults.getTimeSeries(type, swmmIndex, varIndex);
    const labels = Array.from({length: series.length}, (_, i) => i);
    
    const ctx = document.getElementById('properties-chart').getContext('2d');
    if (propertiesChart) {
        propertiesChart.destroy();
    }
    
    propertiesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: document.getElementById('chart-variable-select').options[varIndex].text,
                data: Array.from(series),
                borderColor: '#10b981',
                borderWidth: 1,
                pointRadius: 0,
                fill: false,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { display: false },
                y: { grid: { color: '#30363d' }, ticks: { color: '#8b949e', font: {size: 10} } }
            },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: true }
            }
        }
    });
}

