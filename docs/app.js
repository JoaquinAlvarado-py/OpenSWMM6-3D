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
        'type': 'fill',
        'source': layerId,
        'filter': ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
        'paint': {
            'fill-color': layerColor,
            'fill-opacity': 0.4,
            'fill-outline-color': layerColor
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
        <input type="checkbox" class="leaflet-control-layers-selector" checked>
        <input type="color" class="layer-color-picker" value="${validHex}" style="width: 20px; height: 20px; padding: 0; border: none; border-radius: 3px; cursor: pointer; margin-right: 8px; background: none; flex-shrink: 0;" title="Change Layer Color">
        <span>${name}</span>
    `;
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    
    container.appendChild(label);

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
            map.setPaintProperty(layerId + '-polygons', 'fill-color', newColor);
            map.setPaintProperty(layerId + '-polygons', 'fill-outline-color', newColor);
        }
    });
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

if (btnSwmmOptions && swmmOptionsPanel && btnCloseOptions) {
    btnSwmmOptions.addEventListener('click', () => {
        swmmOptionsPanel.classList.add('active');
    });
    btnCloseOptions.addEventListener('click', () => {
        swmmOptionsPanel.classList.remove('active');
    });
}

// Draggable Floating Panel
const fpHeader = document.getElementById('swmm-options-header');
if (fpHeader && swmmOptionsPanel) {
    let isDragging = false;
    let startX, startY, initialX, initialY;

    fpHeader.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        // Get the current translation values
        const style = window.getComputedStyle(swmmOptionsPanel);
        // Fallback for browsers not supporting DOMMatrixReadOnly easily
        let matrix;
        try {
            matrix = new DOMMatrixReadOnly(style.transform);
            initialX = matrix.m41;
            initialY = matrix.m42;
        } catch(err) {
            // fallback if transform is "none" or invalid
            initialX = -200; // rough width / 2
            initialY = -250; // rough height / 2
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        swmmOptionsPanel.style.transform = `translate(${initialX + dx}px, ${initialY + dy}px)`;
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
    createModule().then(Module => {
        swmmModule = Module;
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
            swmmModule.FS.writeFile('/in.inp', pendingInpText);

            console.log("Running SWMM simulation...");
            btnRunSimulation.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg> Running...';
            btnRunSimulation.disabled = true;

            // setTimeout ensures the UI updates to show "Running..." before blocking the main thread
            setTimeout(() => {
                try {
                    // Provide the command line arguments for the SWMM entry point
                    swmmModule.arguments = ['/in.inp', '/rpt.rpt', '/out.out'];

                    // Try run or callMain depending on what Emscripten exported
                    if (swmmModule.run) {
                        swmmModule.run();
                        console.log("Simulation finished via swmmModule.run()");
                    } else if (swmmModule.callMain) {
                        swmmModule.callMain(['/in.inp', '/rpt.rpt', '/out.out']);
                        console.log("Simulation finished via callMain.");
                    } else {
                        throw new Error("No entry point found in SWMM WebAssembly Module.");
                    }

                    let rpt = "";
                    try {
                        rpt = swmmModule.FS.readFile('/rpt.rpt', { encoding: 'utf8' });
                        alert("Simulation Complete! Check console for Report.");
                        console.log(rpt);
                    } catch(err) {
                        console.warn("Could not read report file.");
                        alert("Simulation failed or crashed. No report generated.");
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
