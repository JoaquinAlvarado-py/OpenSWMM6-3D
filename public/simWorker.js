// simWorker.js — Runs the SWMM WASM engine off the main thread.
// Receives: { type: 'run', inpText, files? }   files: { name: string|ArrayBuffer }
// Sends:    { type: 'ready' } once the engine binary is compiled
//           { type: 'log', text } / { type: 'err', text }
//           { type: 'done', rpt, outBuffer } (outBuffer transferred)
//           { type: 'error', message }
//
// The worker persists across runs: the .wasm binary is fetched and compiled
// once, then each run instantiates a fresh engine (fresh memory + FS) from the
// cached compiled module via Emscripten's instantiateWasm hook. A fresh
// instance per run is required — repeated callMain on one instance fails on
// some builds — but re-instantiating a compiled module costs only ~10-50 ms.

'use strict';

importScripts('swmm6wasm.js');

let compiledWasmPromise = null;
function getCompiledWasm() {
    if (!compiledWasmPromise) {
        compiledWasmPromise = (async () => {
            const resp = await fetch('swmm6wasm.wasm');
            try {
                return await WebAssembly.compileStreaming(resp.clone());
            } catch (e) {
                // server sent a wrong MIME type — compile from bytes instead
                return WebAssembly.compile(await resp.arrayBuffer());
            }
        })();
        compiledWasmPromise.then(
            () => self.postMessage({ type: 'ready' }),
            () => { compiledWasmPromise = null; }
        );
    }
    return compiledWasmPromise;
}
getCompiledWasm(); // pre-warm: compile while the user is still editing

async function createEngine() {
    const opts = {
        noInitialRun: true,
        print: (text) => self.postMessage({ type: 'log', text }),
        printErr: (text) => self.postMessage({ type: 'err', text })
    };
    try {
        const wasmModule = await getCompiledWasm();
        return await createModule({
            ...opts,
            instantiateWasm: (imports, onSuccess) => {
                WebAssembly.instantiate(wasmModule, imports)
                    .then(instance => onSuccess(instance, wasmModule))
                    .catch(err => self.postMessage({ type: 'err', text: 'WASM instantiate failed: ' + err.message }));
                return {}; // async instantiation
            }
        });
    } catch (e) {
        // glue without instantiateWasm support, or compile failure — let
        // Emscripten fetch and instantiate the binary itself
        return createModule(opts);
    }
}

let busy = false;

self.onmessage = async (e) => {
    const msg = e.data || {};
    if (msg.type !== 'run') return;
    if (busy) {
        self.postMessage({ type: 'error', message: 'A simulation is already running.' });
        return;
    }
    busy = true;
    try {
        const Module = await createEngine();
        Module.FS.writeFile('/in.inp', msg.inpText);

        // auxiliary inputs, e.g. rain files referenced by FILE-based gauges
        if (msg.files) {
            for (const [name, data] of Object.entries(msg.files)) {
                Module.FS.writeFile('/' + name.replace(/^\/+/, ''),
                    data instanceof ArrayBuffer ? new Uint8Array(data) : data);
            }
        }

        try {
            let ran = false;
            // Try callMain first since it's the standard Emscripten way now
            if (typeof Module.callMain === 'function') {
                Module.callMain(['/in.inp', '/rpt.rpt', '/out.out']);
                ran = true;
            } else {
                // Safely check for ccall to avoid getter aborts in newer Emscripten
                let hasCCall = false;
                try { hasCCall = typeof Module.ccall === 'function'; } catch (err) { }
                if (hasCCall && typeof Module._swmm_run === 'function') {
                    Module.ccall('swmm_run', 'number', ['string', 'string', 'string'], ['/in.inp', '/rpt.rpt', '/out.out']);
                    ran = true;
                } else if (typeof Module.run === 'function') {
                    Module.run(['/in.inp', '/rpt.rpt', '/out.out']);
                    ran = true;
                }
            }
            if (!ran) throw new Error('No entry point found in SWMM WebAssembly module.');
        } catch (err) {
            // Emscripten's exit() throws — a report may still exist
            self.postMessage({ type: 'err', text: 'SWMM engine exit: ' + (err.message || err) });
        }

        let rpt = '';
        try {
            rpt = Module.FS.readFile('/rpt.rpt', { encoding: 'utf8' });
        } catch (err) {
            throw new Error('Simulation produced no report file.');
        }

        let outBuffer = null;
        try {
            const outBytes = Module.FS.readFile('/out.out'); // Uint8Array on WASM heap
            outBuffer = outBytes.buffer.slice(outBytes.byteOffset, outBytes.byteOffset + outBytes.byteLength);
        } catch (err) {
            self.postMessage({ type: 'err', text: 'Simulation produced no binary .out file.' });
        }

        busy = false;
        if (outBuffer) {
            self.postMessage({ type: 'done', rpt, outBuffer }, [outBuffer]);
        } else {
            self.postMessage({ type: 'done', rpt, outBuffer: null });
        }
    } catch (err) {
        busy = false;
        self.postMessage({ type: 'error', message: err.message || String(err) });
    }
};
