class InpParser {
    constructor() {
        this.sections = {};
    }

    parse(text) {
        const lines = text.split(/\r?\n/);
        let currentSection = null;

        for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith(';')) continue;

            if (line.startsWith('[') && line.endsWith(']')) {
                currentSection = line.substring(1, line.length - 1).toUpperCase();
                if (!this.sections[currentSection]) {
                    this.sections[currentSection] = [];
                }
            } else if (currentSection) {
                // Split by spaces/tabs but handle potential quotes if necessary
                const tokens = line.split(/\s+/);
                this.sections[currentSection].push(tokens);
            }
        }
        
        return this.extractFeatures();
    }

    serialize(sections = this.sections) {
        let out = "";
        for (const [sectionName, rows] of Object.entries(sections)) {
            out += `[${sectionName}]\n`;
            for (const row of rows) {
                out += row.join(" ") + "\n";
            }
            out += "\n";
        }
        return out;
    }

    extractFeatures() {
        const features = {
            nodes: {},      // Store node data to lookup coordinates
            links: [],      // Store link data
            subcatchments: {} // Store subcatchment data
        };

        const nodesGeoJSON = { type: "FeatureCollection", features: [] };
        const linksGeoJSON = { type: "FeatureCollection", features: [] };
        const subcatchmentsGeoJSON = { type: "FeatureCollection", features: [] };

        const counts = {
            raingages: 0,
            subcatchments: 0,
            junctions: 0,
            outfalls: 0,
            storage: 0,
            dividers: 0,
            conduits: 0
        };

        // 1. Extract Coordinates
        if (this.sections['COORDINATES']) {
            for (let row of this.sections['COORDINATES']) {
                if (row.length >= 3) {
                    features.nodes[row[0]] = { x: parseFloat(row[1]), y: parseFloat(row[2]) };
                }
            }
        }

        // 2. Identify Node Types and Counts
        const nodeTypes = ['JUNCTIONS', 'OUTFALLS', 'STORAGE', 'DIVIDERS'];
        for (let type of nodeTypes) {
            if (this.sections[type]) {
                counts[type.toLowerCase()] = this.sections[type].length;
                for (let row of this.sections[type]) {
                    const id = row[0];
                    if (features.nodes[id]) {
                        features.nodes[id].type = type;
                        // Add to nodes GeoJSON
                        nodesGeoJSON.features.push({
                            type: "Feature",
                            properties: { id: id, type: type },
                            geometry: { type: "Point", coordinates: [features.nodes[id].x, features.nodes[id].y] }
                        });
                    }
                }
            }
        }

        // 3. Extract Links (Conduits, Pumps, Orifices, Weirs)
        const linkTypes = ['CONDUITS', 'PUMPS', 'ORIFICES', 'WEIRS'];
        for (let type of linkTypes) {
            if (this.sections[type]) {
                if (type === 'CONDUITS') counts.conduits = this.sections[type].length;
                for (let row of this.sections[type]) {
                    const id = row[0];
                    const fromNode = row[1];
                    const toNode = row[2];
                    
                    if (features.nodes[fromNode] && features.nodes[toNode]) {
                        features.links.push({ id, fromNode, toNode, type });
                        linksGeoJSON.features.push({
                            type: "Feature",
                            properties: { id: id, type: type },
                            geometry: {
                                type: "LineString",
                                coordinates: [
                                    [features.nodes[fromNode].x, features.nodes[fromNode].y],
                                    [features.nodes[toNode].x, features.nodes[toNode].y]
                                ]
                            }
                        });
                    }
                }
            }
        }

        // 4. Polygons & Subcatchments
        if (this.sections['SUBCATCHMENTS']) {
            counts.subcatchments = this.sections['SUBCATCHMENTS'].length;
        }

        if (this.sections['POLYGONS']) {
            for (let row of this.sections['POLYGONS']) {
                const id = row[0];
                if (!features.subcatchments[id]) {
                    features.subcatchments[id] = [];
                }
                features.subcatchments[id].push([parseFloat(row[1]), parseFloat(row[2])]);
            }
        }

        if (this.sections['SUBCATCHMENTS']) {
            for (let row of this.sections['SUBCATCHMENTS']) {
                const id = row[0];
                if (features.subcatchments[id] && features.subcatchments[id].length >= 3) {
                    // Close the polygon
                    const ring = [...features.subcatchments[id]];
                    if (ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]) {
                        ring.push([...ring[0]]);
                    }
                    
                    subcatchmentsGeoJSON.features.push({
                        type: "Feature",
                        properties: { id: id },
                        geometry: { type: "Polygon", coordinates: [ring] }
                    });
                }
            }
        }

        if (this.sections['RAINGAGES']) {
            counts.raingages = this.sections['RAINGAGES'].length;
        }

        return {
            nodes: nodesGeoJSON,
            links: linksGeoJSON,
            subcatchments: subcatchmentsGeoJSON,
            counts: counts,
            rawSections: this.sections
        };
    }
}

// Global instance
window.inpParser = new InpParser();
