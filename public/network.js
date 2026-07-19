// network.js — Project state, undo/redo, persistence
// Single source of truth for the SWMM network being edited.
//
// Performance notes:
// - _nodeMap/_linkMap/_subMap give O(1) id lookups (getNode/getLink/…).
// - GeoJSON FeatureCollections are cached and invalidated on mutation;
//   moveNode patches the cached features in place instead of rebuilding.
// - Undo/redo is command-based: each edit stores a small delta op instead
//   of a full JSON.stringify snapshot. Bulk ops (load/merge/clear) store a
//   full snapshot, and a checkpoint snapshot is inserted every 25 commands
//   so history can be trimmed and restored cheaply.

(function () {
    'use strict';

    const NODE_TYPES = ['JUNCTION', 'OUTFALL', 'STORAGE', 'DIVIDER', 'RAINGAGE'];
    const LINK_TYPES = ['CONDUIT', 'PUMP', 'WEIR', 'ORIFICE', 'OUTLET'];

    const ID_PREFIX = {
        JUNCTION: 'J', OUTFALL: 'O', STORAGE: 'ST', DIVIDER: 'D', RAINGAGE: 'RG',
        CONDUIT: 'C', PUMP: 'P', WEIR: 'W', ORIFICE: 'OR', OUTLET: 'OL', SUBCATCHMENT: 'S'
    };

    const HISTORY_LIMIT = 100;
    const SNAPSHOT_EVERY = 25; // checkpoint snapshot every N delta commands

    function defaultNodeProps(type) {
        switch (type) {
            case 'JUNCTION': return { invertEl: 0, maxDepth: 2, initDepth: 0, surDepth: 0, aponded: 0 };
            case 'OUTFALL': return { invertEl: 0, outfallType: 'FREE', stageData: '', gated: 'NO' };
            case 'STORAGE': return { invertEl: 0, maxDepth: 5, initDepth: 0, shape: 'FUNCTIONAL', curveName: '', coeff: 1000, exponent: 0, constant: 0 };
            case 'DIVIDER': return { invertEl: 0, divertedLink: '', dividerType: 'CUTOFF', param: 0, maxDepth: 2 };
            case 'RAINGAGE': return { format: 'INTENSITY', interval: '1:00', scf: 1.0, sourceType: 'TIMESERIES', sourceName: 'TS1' };
            default: return {};
        }
    }

    function defaultLinkProps(type) {
        switch (type) {
            case 'CONDUIT': return { length: 0, autoLength: true, roughness: 0.013, inOffset: 0, outOffset: 0, initFlow: 0, maxFlow: 0, xShape: 'CIRCULAR', geom1: 1.0, geom2: 0, geom3: 0, geom4: 0, barrels: 1 };
            case 'PUMP': return { pumpCurve: '*', status: 'ON', startup: 0, shutoff: 0 };
            case 'WEIR': return { weirType: 'TRANSVERSE', crestHt: 0, qCoeff: 3.33, gated: 'NO', xShape: 'RECT_OPEN', geom1: 1.0, geom2: 1.0, geom3: 0, geom4: 0 };
            case 'ORIFICE': return { orificeType: 'SIDE', offset: 0, qCoeff: 0.65, gated: 'NO', xShape: 'CIRCULAR', geom1: 1.0, geom2: 0, geom3: 0, geom4: 0 };
            case 'OUTLET': return { offset: 0, outletType: 'FUNCTIONAL/DEPTH', qCoeff: 10, qExpon: 0.5, curveName: '', gated: 'NO' };
            default: return {};
        }
    }

    function defaultSubcatchProps() {
        return { raingage: 'RG1', outlet: '', area: 0, autoArea: true, imperv: 50, width: 500, slope: 0.5, curbLen: 0 };
    }

    function defaultOptions() {
        return {
            infiltration: 'HORTON',
            flowRouting: 'KINWAVE',
            startDate: '01/01/2026', startTime: '00:00:00',
            endDate: '01/01/2026', endTime: '12:00:00',
            reportStep: '00:15:00', wetStep: '00:05:00',
            dryStep: '01:00:00', routingStep: '00:00:30'
        };
    }

    function deepCopy(v) { return JSON.parse(JSON.stringify(v)); }

    // --- Geometry helpers (WGS84) ---
    const R_EARTH = 6371008.8;
    function haversine(a, b) {
        const dLat = (b[1] - a[1]) * Math.PI / 180;
        const dLng = (b[0] - a[0]) * Math.PI / 180;
        const la1 = a[1] * Math.PI / 180, la2 = b[1] * Math.PI / 180;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
        return 2 * R_EARTH * Math.asin(Math.sqrt(h));
    }

    function pathLengthMeters(coords) {
        let d = 0;
        for (let i = 1; i < coords.length; i++) d += haversine(coords[i - 1], coords[i]);
        return d;
    }

    // Approximate geodesic ring area in m² (shoelace on projected coords)
    function ringAreaM2(ring) {
        if (ring.length < 3) return 0;
        const lat0 = ring[0][1] * Math.PI / 180;
        const mPerDegX = 111320 * Math.cos(lat0);
        const mPerDegY = 110540;
        let area = 0;
        for (let i = 0; i < ring.length; i++) {
            const j = (i + 1) % ring.length;
            const xi = ring[i][0] * mPerDegX, yi = ring[i][1] * mPerDegY;
            const xj = ring[j][0] * mPerDegX, yj = ring[j][1] * mPerDegY;
            area += xi * yj - xj * yi;
        }
        return Math.abs(area / 2);
    }

    class Network {
        constructor() {
            this.listeners = [];
            this._saveTimer = null;
            this.reset(false);
            // history entries: { t:'snap', json } — full state after a bulk op
            //                  { t:'cmd', op, snapAfter? } — a small delta
            // history[0] is always state-bearing.
            this.history = [{ t: 'snap', json: JSON.stringify(this.serialize()) }];
            this.hIndex = 0;
            this._cmdsSinceSnap = 0;
        }

        reset(notify = true) {
            this.nodes = [];
            this.links = [];
            this.subcatchments = [];
            this.mesh2D = []; // Added for 2D mesh
            this.options = defaultOptions();
            this.units = 'SI';
            this.title = 'Untitled SWMM Project';
            this.counters = {};
            this.rawSections = {};
            this.rebuildIndexes();
            if (notify) this.emit('bulk');
        }

        // ---------- id index maps (O(1) lookups) ----------
        rebuildIndexes() {
            this._nodeMap = new Map();
            this._linkMap = new Map();
            this._subMap = new Map();
            this.nodes.forEach(n => this._nodeMap.set(n.id, n));
            this.links.forEach(l => this._linkMap.set(l.id, l));
            this.subcatchments.forEach(s => this._subMap.set(s.id, s));
            this._realNodes = null;
            this._invalidateGeo();
        }

        _invalidateGeo() {
            this._geoNodes = null;
            this._geoLinks = null;
            this._geoSubs = null;
            this._geoMesh = null;
            this._geoNodeFeat = null; // id -> cached node Feature
            this._geoLinkFeat = null; // id -> cached link Feature
        }

        // ---------- events ----------
        onChange(fn) { this.listeners.push(fn); }
        // evt: { type: 'add'|'delete'|'move'|'props'|'rename'|'bulk'|'change', ... }
        emit(type = 'change', detail = null) {
            const evt = Object.assign({ type }, detail || {});
            this.listeners.forEach(fn => { try { fn(this, evt); } catch (e) { console.error(e); } });
            this.scheduleAutosave();
        }

        // ---------- id generation ----------
        nextId(type) {
            const prefix = ID_PREFIX[type] || 'X';
            if (!this.counters[type]) this.counters[type] = 0;
            let id;
            do {
                this.counters[type]++;
                id = prefix + this.counters[type];
            } while (this.findAny(id)); // O(1) per check via index maps
            return id;
        }

        findAny(id) {
            return this._nodeMap.get(id) || this._linkMap.get(id) || this._subMap.get(id) || null;
        }

        // ---------- accessors ----------
        getNode(id) { return this._nodeMap.get(id); }
        getLink(id) { return this._linkMap.get(id); }
        getSubcatchment(id) { return this._subMap.get(id); }
        get realNodes() {
            if (!this._realNodes) this._realNodes = this.nodes.filter(n => n.type !== 'RAINGAGE'); // rain gages aren't hydraulic nodes
            return this._realNodes;
        }
        get nodeCount() { return this.realNodes.length; }
        get linkCount() { return this.links.length; }

        // ---------- mutations (each records a delta command) ----------
        addNode(type, lngLat) {
            const node = {
                id: this.nextId(type),
                type: type,
                lngLat: [lngLat[0], lngLat[1]],
                props: defaultNodeProps(type)
            };
            this.nodes.push(node);
            this._nodeMap.set(node.id, node);
            this._realNodes = null;
            this._invalidateGeo();
            this._record({ t: 'add', nodes: [node] });
            this.emit('add', { id: node.id });
            return node;
        }

        addLink(type, fromId, toId, vertices) {
            const link = {
                id: this.nextId(type),
                type: type,
                from: fromId,
                to: toId,
                vertices: vertices || [], // intermediate points only
                props: defaultLinkProps(type)
            };
            if (type === 'CONDUIT') this.updateConduitLength(link);
            this.links.push(link);
            this._linkMap.set(link.id, link);
            this._invalidateGeo();
            this._record({ t: 'add', links: [link] });
            this.emit('add', { id: link.id });
            return link;
        }

        addSubcatchment(ring) {
            const sub = {
                id: this.nextId('SUBCATCHMENT'),
                ring: ring.map(c => [c[0], c[1]]), // open ring (no closing dup)
                props: defaultSubcatchProps()
            };
            // auto-compute area in hectares (SI) / acres (US)
            const m2 = ringAreaM2(sub.ring);
            sub.props.area = this.units === 'US'
                ? +(m2 / 4046.86).toFixed(3)
                : +(m2 / 10000).toFixed(3);
            // default raingage: first gage placed, else RG1
            const gage = this.nodes.find(n => n.type === 'RAINGAGE');
            if (gage) sub.props.raingage = gage.id;
            // default outlet: nearest hydraulic node to centroid
            const c = this.ringCentroid(sub.ring);
            const nearest = this.nearestNode(c, Infinity);
            if (nearest) sub.props.outlet = nearest.id;
            this.subcatchments.push(sub);
            this._subMap.set(sub.id, sub);
            this._invalidateGeo();
            this._record({ t: 'add', subs: [sub] });
            this.emit('add', { id: sub.id });
            return sub;
        }

        ringCentroid(ring) {
            let x = 0, y = 0;
            ring.forEach(p => { x += p[0]; y += p[1]; });
            return [x / ring.length, y / ring.length];
        }

        nearestNode(lngLat, maxMeters) {
            let best = null, bestD = Infinity;
            this.realNodes.forEach(n => {
                const d = haversine(lngLat, n.lngLat);
                if (d < bestD) { bestD = d; best = n; }
            });
            return (best && bestD <= maxMeters) ? best : null;
        }

        linkPathCoords(link) {
            const from = this.getNode(link.from);
            const to = this.getNode(link.to);
            if (!from || !to) return null;
            return [from.lngLat, ...(link.vertices || []), to.lngLat];
        }

        updateConduitLength(link) {
            if (link.type !== 'CONDUIT' || !link.props.autoLength) return;
            const path = this.linkPathCoords(link);
            if (!path) return;
            const m = pathLengthMeters(path);
            link.props.length = this.units === 'US' ? +(m * 3.28084).toFixed(2) : +m.toFixed(2);
        }

        // Move a node; commit=false while dragging (record the command once
        // via commitMove() on drag end for a single undo step).
        moveNode(id, lngLat, commit = true) {
            const node = this.getNode(id);
            if (!node) return;
            const from = node.lngLat;
            node.lngLat = [lngLat[0], lngLat[1]];
            const touched = this._refreshLinksAt(id);
            this._patchGeoForMove(node, touched);
            if (commit) this._record({ t: 'move', id, from: [from[0], from[1]], to: [lngLat[0], lngLat[1]] });
            this.emit('move', { id, links: touched });
        }

        // Record a single move command for a completed drag.
        commitMove(id, fromLngLat) {
            const node = this.getNode(id);
            if (!node || !fromLngLat) return;
            if (fromLngLat[0] === node.lngLat[0] && fromLngLat[1] === node.lngLat[1]) return;
            this._record({ t: 'move', id, from: [fromLngLat[0], fromLngLat[1]], to: [node.lngLat[0], node.lngLat[1]] });
            this.emit('commit', { id }); // refresh undo/redo button state
        }

        _refreshLinksAt(nodeId) {
            const touched = [];
            this.links.forEach(l => {
                if (l.from === nodeId || l.to === nodeId) {
                    this.updateConduitLength(l);
                    touched.push(l.id);
                }
            });
            return touched;
        }

        // Patch cached GeoJSON in place for a node move (avoids full rebuild)
        _patchGeoForMove(node, touchedLinkIds) {
            if (this._geoNodeFeat) {
                const nf = this._geoNodeFeat.get(node.id);
                if (nf) nf.geometry.coordinates = node.lngLat;
            }
            if (this._geoLinkFeat) {
                touchedLinkIds.forEach(id => {
                    const lf = this._geoLinkFeat.get(id);
                    const l = this.getLink(id);
                    if (lf && l) {
                        const path = this.linkPathCoords(l);
                        if (path) lf.geometry.coordinates = path;
                    }
                });
            }
        }

        updateProps(id, updates) {
            const el = this.findAny(id);
            if (!el) return;
            const before = {}, after = {};
            Object.keys(updates).forEach(k => { before[k] = el.props[k]; after[k] = updates[k]; });
            const lenBefore = el.props.length;
            Object.assign(el.props, updates);
            if (el.type === 'CONDUIT') this.updateConduitLength(el);
            // capture derived length change (e.g. re-enabling autoLength)
            if (el.type === 'CONDUIT' && el.props.length !== lenBefore && !('length' in after)) {
                before.length = lenBefore;
                after.length = el.props.length;
            }
            if (Object.keys(after).length) this._record({ t: 'props', id, before, after });
            this.emit('props', { id });
        }

        renameElement(oldId, newId) {
            newId = String(newId).trim().replace(/\s+/g, '_');
            if (!newId || newId === oldId) return oldId;
            if (this.findAny(newId)) return oldId; // must stay unique
            if (!this.findAny(oldId)) return oldId;
            this._applyRename(oldId, newId);
            this._record({ t: 'rename', from: oldId, to: newId });
            this.emit('rename', { from: oldId, to: newId });
            return newId;
        }

        _applyRename(oldId, newId) {
            const el = this.findAny(oldId);
            if (!el) return;
            el.id = newId;
            if (this._nodeMap.delete(oldId)) this._nodeMap.set(newId, el);
            if (this._linkMap.delete(oldId)) this._linkMap.set(newId, el);
            if (this._subMap.delete(oldId)) this._subMap.set(newId, el);
            // fix references
            this.links.forEach(l => {
                if (l.from === oldId) l.from = newId;
                if (l.to === oldId) l.to = newId;
            });
            this.subcatchments.forEach(s => {
                if (s.props.outlet === oldId) s.props.outlet = newId;
                if (s.props.raingage === oldId) s.props.raingage = newId;
            });
            this._invalidateGeo();
        }

        deleteElements(ids) {
            const idSet = new Set(ids);
            // cascade: links attached to deleted nodes
            this.links.forEach(l => {
                if (idSet.has(l.from) || idSet.has(l.to)) idSet.add(l.id);
            });
            const remNodes = this.nodes.filter(n => idSet.has(n.id));
            const remLinks = this.links.filter(l => idSet.has(l.id));
            const remSubs = this.subcatchments.filter(s => idSet.has(s.id));
            if (!remNodes.length && !remLinks.length && !remSubs.length) return;

            this.nodes = this.nodes.filter(n => !idSet.has(n.id));
            this.links = this.links.filter(l => !idSet.has(l.id));
            this.subcatchments = this.subcatchments.filter(s => !idSet.has(s.id));
            remNodes.forEach(n => this._nodeMap.delete(n.id));
            remLinks.forEach(l => this._linkMap.delete(l.id));
            remSubs.forEach(s => this._subMap.delete(s.id));

            // clear dangling outlet refs (recorded so undo restores them)
            const subPatches = [];
            this.subcatchments.forEach(s => {
                const before = {}, after = {};
                if (s.props.outlet && idSet.has(s.props.outlet)) {
                    before.outlet = s.props.outlet; after.outlet = '';
                    s.props.outlet = '';
                }
                if (s.props.raingage && idSet.has(s.props.raingage)) {
                    before.raingage = s.props.raingage; after.raingage = 'RG1';
                    s.props.raingage = 'RG1';
                }
                if (Object.keys(before).length) subPatches.push({ id: s.id, before, after });
            });

            this._realNodes = null;
            this._invalidateGeo();
            this._record({ t: 'del', nodes: remNodes, links: remLinks, subs: remSubs, subPatches });
            this.emit('delete', { ids: [...idSet] });
        }

        setUnits(units) {
            units = units === 'US' ? 'US' : 'SI';
            if (units === this.units) return;
            const before = this.units;
            this.units = units;
            // recompute auto lengths in the new unit system
            this.links.forEach(l => this.updateConduitLength(l));
            this._record({ t: 'units', before, after: units });
            this.emit('bulk');
        }

        // ---------- undo / redo (command pattern with checkpoints) ----------
        serialize() {
            return {
                version: 1,
                title: this.title,
                units: this.units,
                options: this.options,
                counters: this.counters,
                nodes: this.nodes,
                links: this.links,
                subcatchments: this.subcatchments,
                mesh2D: this.mesh2D, // Added for 2D mesh
                rawSections: this.rawSections
            };
        }

        loadState(state, resetHistory = false, notify = true) {
            this.title = state.title || 'Untitled SWMM Project';
            this.units = state.units || 'SI';
            this.options = Object.assign(defaultOptions(), state.options || {});
            this.counters = state.counters || {};
            this.nodes = state.nodes || [];
            this.links = state.links || [];
            this.subcatchments = state.subcatchments || [];
            this.mesh2D = state.mesh2D || []; // Added for 2D mesh
            this.rawSections = state.rawSections || {};
            this.rebuildIndexes();
            if (resetHistory) {
                this.history = [{ t: 'snap', json: JSON.stringify(this.serialize()) }];
                this.hIndex = 0;
                this._cmdsSinceSnap = 0;
            }
            if (notify) this.emit('bulk');
        }

        // Bulk commit: pushes a full snapshot of the CURRENT state.
        // Use after direct bulk mutation (merge import, clear, …).
        commit() {
            this.history = this.history.slice(0, this.hIndex + 1);
            this.history.push({ t: 'snap', json: JSON.stringify(this.serialize()) });
            this.hIndex = this.history.length - 1;
            this._cmdsSinceSnap = 0;
            this._trimHistory();
            // external bulk mutations bypassed the index bookkeeping
            this.rebuildIndexes();
        }

        _record(op) {
            this.history = this.history.slice(0, this.hIndex + 1);
            const entry = { t: 'cmd', op };
            if (++this._cmdsSinceSnap >= SNAPSHOT_EVERY) {
                entry.snapAfter = JSON.stringify(this.serialize());
                this._cmdsSinceSnap = 0;
            }
            this.history.push(entry);
            this.hIndex = this.history.length - 1;
            this._trimHistory();
        }

        _trimHistory() {
            while (this.history.length > HISTORY_LIMIT) {
                // drop oldest entries up to the next state-bearing entry
                let j = -1;
                for (let i = 1; i < this.history.length; i++) {
                    const e = this.history[i];
                    if (e.t === 'snap' || e.snapAfter) { j = i; break; }
                }
                if (j <= 0 || j > this.hIndex) break; // nothing safely trimmable
                const e = this.history[j];
                if (e.t !== 'snap') this.history[j] = { t: 'snap', json: e.snapAfter };
                this.history = this.history.slice(j);
                this.hIndex -= j;
            }
        }

        get canUndo() { return this.hIndex > 0; }
        get canRedo() { return this.hIndex < this.history.length - 1; }

        undo() {
            if (!this.canUndo) return;
            const entry = this.history[this.hIndex];
            if (entry.t === 'cmd') {
                this._applyOp(entry.op, true);
                this.hIndex--;
            } else {
                // snapshot entry — restore the state at the previous position
                this.hIndex--;
                this._restoreTo(this.hIndex);
            }
            this.emit('bulk');
        }

        redo() {
            if (!this.canRedo) return;
            this.hIndex++;
            const entry = this.history[this.hIndex];
            if (entry.t === 'cmd') this._applyOp(entry.op, false);
            else this.loadState(JSON.parse(entry.json), false, false);
            this.emit('bulk');
        }

        // Restore state at history position pos: load nearest checkpoint ≤ pos,
        // then replay commands forward.
        _restoreTo(pos) {
            let j = pos;
            while (j > 0 && this.history[j].t !== 'snap' && !this.history[j].snapAfter) j--;
            const e = this.history[j];
            this.loadState(JSON.parse(e.t === 'snap' ? e.json : e.snapAfter), false, false);
            for (let k = j + 1; k <= pos; k++) {
                this._applyOp(this.history[k].op, false);
            }
        }

        _insertElements(op) {
            (op.nodes || []).forEach(n => {
                const copy = deepCopy(n);
                this.nodes.push(copy);
                this._nodeMap.set(copy.id, copy);
            });
            (op.links || []).forEach(l => {
                const copy = deepCopy(l);
                this.links.push(copy);
                this._linkMap.set(copy.id, copy);
            });
            (op.subs || []).forEach(s => {
                const copy = deepCopy(s);
                this.subcatchments.push(copy);
                this._subMap.set(copy.id, copy);
            });
            this._realNodes = null;
        }

        _removeElements(op) {
            const ids = new Set([
                ...(op.nodes || []).map(n => n.id),
                ...(op.links || []).map(l => l.id),
                ...(op.subs || []).map(s => s.id)
            ]);
            this.nodes = this.nodes.filter(n => !ids.has(n.id));
            this.links = this.links.filter(l => !ids.has(l.id));
            this.subcatchments = this.subcatchments.filter(s => !ids.has(s.id));
            ids.forEach(id => {
                this._nodeMap.delete(id);
                this._linkMap.delete(id);
                this._subMap.delete(id);
            });
            this._realNodes = null;
        }

        _applyOp(op, inv) {
            switch (op.t) {
                case 'add':
                    inv ? this._removeElements(op) : this._insertElements(op);
                    break;
                case 'del':
                    inv ? this._insertElements(op) : this._removeElements(op);
                    (op.subPatches || []).forEach(p => {
                        const s = this.getSubcatchment(p.id);
                        if (s) Object.assign(s.props, inv ? p.before : p.after);
                    });
                    break;
                case 'move': {
                    const n = this.getNode(op.id);
                    if (n) {
                        const c = inv ? op.from : op.to;
                        n.lngLat = [c[0], c[1]];
                        this._refreshLinksAt(op.id);
                    }
                    break;
                }
                case 'props': {
                    const el = this.findAny(op.id);
                    if (el) {
                        Object.assign(el.props, inv ? op.before : op.after);
                        if (el.type === 'CONDUIT') this.updateConduitLength(el);
                    }
                    break;
                }
                case 'rename':
                    this._applyRename(inv ? op.to : op.from, inv ? op.from : op.to);
                    break;
                case 'units':
                    this.units = inv ? op.before : op.after;
                    this.links.forEach(l => this.updateConduitLength(l));
                    break;
            }
            this._invalidateGeo();
        }

        // ---------- persistence ----------
        scheduleAutosave() {
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => {
                let json;
                try {
                    json = JSON.stringify(this.serialize());
                    localStorage.setItem('openswmm3d.project', json);
                } catch (e) {
                    // storage full/unavailable — fall back to IndexedDB (no ~5MB cap)
                    if (json) this._saveToIndexedDB(json);
                }
            }, 2000);
        }

        _idb() {
            return new Promise((resolve, reject) => {
                if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
                const req = indexedDB.open('openswmm3d', 1);
                req.onupgradeneeded = () => req.result.createObjectStore('kv');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }

        async _saveToIndexedDB(json) {
            try {
                const db = await this._idb();
                db.transaction('kv', 'readwrite').objectStore('kv').put(json, 'project');
            } catch (e) { /* give up silently, same as before */ }
        }

        loadFromLocalStorage() {
            try {
                const raw = localStorage.getItem('openswmm3d.project');
                if (!raw) return false;
                const state = JSON.parse(raw);
                if (!state.nodes || !state.nodes.length) {
                    if (!state.links || !state.links.length) return false;
                }
                this.loadState(state, true);
                return true;
            } catch (e) {
                return false;
            }
        }

        // Async fallback for models too large for localStorage
        async loadFromIndexedDB() {
            try {
                const db = await this._idb();
                return await new Promise((resolve) => {
                    const rq = db.transaction('kv').objectStore('kv').get('project');
                    rq.onsuccess = () => {
                        try {
                            const state = rq.result ? JSON.parse(rq.result) : null;
                            if (!state || !state.nodes || !state.nodes.length) return resolve(false);
                            this.loadState(state, true);
                            resolve(true);
                        } catch (e) { resolve(false); }
                    };
                    rq.onerror = () => resolve(false);
                });
            } catch (e) {
                return false;
            }
        }

        downloadProject() {
            const blob = new Blob([JSON.stringify(this.serialize(), null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = (this.title.replace(/\s+/g, '_') || 'network') + '.oswmm.json';
            a.click();
            URL.revokeObjectURL(a.href);
        }

        // ---------- GeoJSON for map rendering (cached) ----------
        nodesGeoJSON() {
            if (!this._geoNodes) {
                this._geoNodeFeat = new Map();
                this._geoNodes = {
                    type: 'FeatureCollection',
                    features: this.nodes.map(n => {
                        const f = {
                            type: 'Feature',
                            id: n.id,
                            properties: { id: n.id, type: n.type },
                            geometry: { type: 'Point', coordinates: n.lngLat }
                        };
                        this._geoNodeFeat.set(n.id, f);
                        return f;
                    })
                };
            }
            return this._geoNodes;
        }

        linksGeoJSON() {
            if (!this._geoLinks) {
                this._geoLinkFeat = new Map();
                const feats = [];
                this.links.forEach(l => {
                    const path = this.linkPathCoords(l); // O(1) node lookups
                    if (!path) return;
                    const f = {
                        type: 'Feature',
                        id: l.id,
                        properties: { id: l.id, type: l.type },
                        geometry: { type: 'LineString', coordinates: path }
                    };
                    this._geoLinkFeat.set(l.id, f);
                    feats.push(f);
                });
                this._geoLinks = { type: 'FeatureCollection', features: feats };
            }
            return this._geoLinks;
        }

        subcatchmentsGeoJSON() {
            if (!this._geoSubs) {
                this._geoSubs = {
                    type: 'FeatureCollection',
                    features: this.subcatchments.map(s => {
                        const ring = [...s.ring];
                        if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
                            ring.push([...ring[0]]);
                        }
                        return {
                            type: 'Feature',
                            id: s.id,
                            properties: { id: s.id, type: 'SUBCATCHMENT' },
                            geometry: { type: 'Polygon', coordinates: [ring] }
                        };
                    })
                };
            }
            return this._geoSubs;
        }

        mesh2DGeoJSON() {
            if (!this._geoMesh) {
                this._geoMesh = {
                    type: 'FeatureCollection',
                    features: this.mesh2D.map(m => {
                        const ring = [...m.ring];
                        if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
                            ring.push([...ring[0]]);
                        }
                        return {
                            type: 'Feature',
                            id: m.id, // For feature-state binding
                            properties: { id: m.id, type: 'MESH2D' },
                            geometry: { type: 'Polygon', coordinates: [ring] }
                        };
                    })
                };
            }
            return this._geoMesh;
        }

        bounds() {
            const coords = [];
            this.nodes.forEach(n => coords.push(n.lngLat));
            this.links.forEach(l => { if (l.vertices) l.vertices.forEach(v => coords.push(v)); });
            this.subcatchments.forEach(s => s.ring.forEach(v => coords.push(v)));
            this.mesh2D.forEach(m => m.ring.forEach(c => coords.push(c))); // Included mesh in bounds
            if (!coords.length) return null;
            return coords;
        }
    }

    window.Net = new Network();
    window.NetworkGeom = { haversine, pathLengthMeters, ringAreaM2 };
    window.NET_NODE_TYPES = NODE_TYPES;
    window.NET_LINK_TYPES = LINK_TYPES;
})();
