
        // --- STATE ---
        const state = {
            img: null,
            filters: { brightness: 0, contrast: 0, saturation: 0, blur: 0, vignette: 0, noise: 0, red: 0, green: 0, blue: 0 },
            rotation: 0, flipH: 1, flipV: 1,
            layers: [], // {id, type, visible, opacity, ... }
            activeLayerIdx: null,
            strokes: [],
            zoom: 1, pan: { x: 0, y: 0 },
            activeTool: 'move',
            brush: { color: '#ffcc00', size: 5 },
            history: [], historyIndex: -1,
            aiMode: 'transparent',
            cropMode: false,
            cropRect: null
        };

        // --- SHORTCUTS ---
        document.addEventListener('keydown', e => {
            if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
                e.preventDefault(); undo();
            }
            if (e.ctrlKey && (e.key === 'y' || e.key === 'Y')) {
                e.preventDefault(); redo();
            }
            if (e.key === '[') {
                const s = Math.max(1, parseInt(document.getElementById('brushSize').value) - 2);
                document.getElementById('brushSize').value = s;
                state.brush.size = s;
                document.getElementById('val_brushSize').innerText = s;
            }
            if (e.key === ']') {
                const s = Math.min(50, parseInt(document.getElementById('brushSize').value) + 2);
                document.getElementById('brushSize').value = s;
                state.brush.size = s;
                document.getElementById('val_brushSize').innerText = s;
            }
        });

        // --- LAYERS ---
        let dragSrcIdx = null;

        function handleLayerDragStart(e, idx) {
            dragSrcIdx = idx;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', e.target.innerHTML);
            e.target.style.opacity = '0.4';
        }

        function handleLayerDragOver(e) {
            if (e.preventDefault) e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            return false;
        }

        function handleLayerDragEnter(e) {
            const item = e.target.closest('.layer-item');
            if (item) item.classList.add('border-blue-500', 'bg-gray-700');
        }

        function handleLayerDragLeave(e) {
            const item = e.target.closest('.layer-item');
            if (item) item.classList.remove('border-blue-500', 'bg-gray-700');
        }

        function handleLayerDrop(e, targetIdx) {
            e.stopPropagation();
            document.querySelectorAll('.layer-item').forEach(el => {
                el.classList.remove('border-blue-500', 'bg-gray-700');
                el.style.opacity = '1';
            });

            if (dragSrcIdx !== null && dragSrcIdx !== targetIdx) {
                // Determine insertion (handling array index shift)
                const movedLayer = state.layers[dragSrcIdx];
                state.layers.splice(dragSrcIdx, 1);
                state.layers.splice(targetIdx, 0, movedLayer);

                render();
                updateLayersUI();
                saveHistory();
            }
            dragSrcIdx = null;
            return false;
        }

        function handleLayerDragEnd(e) {
            document.querySelectorAll('.layer-item').forEach(el => {
                el.classList.remove('border-blue-500', 'bg-gray-700');
                el.style.opacity = '1';
            });
        }

        function updateLayersUI() {
            const list = document.getElementById('layersList');
            if (!list) return;
            list.innerHTML = '';

            // Reverse so top layer matches top UI element
            [...state.layers].reverse().forEach((l, idx) => {
                const realIdx = state.layers.length - 1 - idx;
                const isActive = state.activeLayerIdx === realIdx;

                const item = document.createElement('div');
                item.className = `layer-item cursor-move transition duration-200 flex flex-col gap-2 ${isActive ? 'border-blue-500 bg-gray-800' : ''}`;
                item.draggable = true;

                // Attach event listeners explicitly
                item.addEventListener('dragstart', (e) => handleLayerDragStart(e, realIdx));
                item.addEventListener('dragover', handleLayerDragOver);
                item.addEventListener('dragenter', handleLayerDragEnter);
                item.addEventListener('dragleave', handleLayerDragLeave);
                item.addEventListener('drop', (e) => handleLayerDrop(e, realIdx));
                item.addEventListener('dragend', handleLayerDragEnd);

                // Click to select
                item.onclick = (e) => {
                    // unexpected propagation might happen if dragging, handled by global logic usually but here simple
                    if (!dragSrcIdx) setActiveLayer(realIdx);
                };

                let content = `
                <div class="flex items-center justify-between w-full">
                    <div class="flex items-center gap-3 w-full overflow-hidden">
                        <i class="fa-solid fa-grip-lines text-gray-600 cursor-grab"></i>
                        <div class="flex items-center gap-2 pointer-events-none w-full">
                            <i class="fa-solid fa-${l.type === 'text' ? 'font' : 'image'} text-gray-400"></i>
                            <div class="flex flex-col overflow-hidden">
                                <span class="text-sm font-medium text-gray-200 truncate">${l.type === 'text' ? l.text : 'Image Layer'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="flex gap-2 ml-2" onmousedown="event.stopPropagation()">
                        <button class="text-gray-400 hover:text-white" onclick="toggleLayer(${realIdx}); event.stopPropagation()" title="Toggle Visibility">
                            <i class="fa-solid fa-${l.visible !== false ? 'eye' : 'eye-slash'}"></i>
                        </button>
                        <button class="text-red-400 hover:text-red-300" onclick="deleteLayer(${realIdx}); event.stopPropagation()" title="Delete Layer">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>`;

                if (isActive) {
                    content += `
                    <div class="flex items-center gap-2 mt-1 px-1 border-t border-gray-700 pt-2" onmousedown="event.stopPropagation()">
                        <span class="text-[10px] text-gray-500 uppercase font-bold">Opacity</span>
                        <input type="range" min="0" max="1" step="0.1" value="${l.opacity !== undefined ? l.opacity : 1}" 
                            class="h-1 flex-1 cursor-pointer" 
                            oninput="setLayerOpacity(${realIdx}, this.value)">
                        <span class="text-[10px] text-gray-400 w-6 text-right">${Math.round((l.opacity !== undefined ? l.opacity : 1) * 100)}%</span>
                        
                        <div class="w-px h-3 bg-gray-700 mx-1"></div>
                        <button class="${l.locked ? 'text-red-400' : 'text-gray-500'} hover:text-white" 
                            onclick="toggleLayerLock(${realIdx})" title="${l.locked ? 'Unlock Layer' : 'Lock Layer'}">
                            <i class="fa-solid fa-${l.locked ? 'lock' : 'lock-open'} text-xs"></i>
                        </button>
                    </div>`;
                }

                item.innerHTML = content;
                list.appendChild(item);
            });

            if (state.layers.length === 0) {
                list.innerHTML = '<div class="text-gray-500 text-sm text-center p-4 italic">No layers added</div>';
            }
        }

        function setActiveLayer(idx) {
            state.activeLayerIdx = idx;
            updateLayersUI();
        }

        function setLayerOpacity(idx, val) {
            state.layers[idx].opacity = parseFloat(val);
            render();
            // Don't save history on every slide event, maybe on change?
            // For now update UI text
            updateLayersUI();
        }

        function toggleLayer(idx) {
            state.layers[idx].visible = !state.layers[idx].visible;
            render();
            updateLayersUI();
            saveHistory();
        }

        function toggleLayerLock(idx) {
            state.layers[idx].locked = !state.layers[idx].locked;
            updateLayersUI();
            saveHistory();
        }

        function deleteLayer(idx) {
            if (state.layers[idx].locked) {
                alert("This layer is locked!");
                return;
            }
            state.layers.splice(idx, 1);
            if (state.activeLayerIdx === idx) state.activeLayerIdx = null;
            if (state.activeLayerIdx > idx) state.activeLayerIdx--; // Shift index

            render();
            updateLayersUI();
            saveHistory();
        }

        // --- FACE RETOUCH ---
        // Listener moved to init()


        async function runFaceAI() {
            if (!state.img) return alert("No image found!");
            const btn = document.getElementById('applyFaceBtn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...';
            btn.disabled = true;

            try {
                const faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
                faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

                faceMesh.onResults(results => {
                    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
                        alert("No face detected!");
                        btn.innerHTML = originalText;
                        btn.disabled = false;
                        return;
                    }
                    // Apply Blur (Smoothing)
                    saveHistory();

                    // 1. Draw original to temp canvas
                    const mCanvas = document.createElement('canvas');
                    mCanvas.width = state.img.width; mCanvas.height = state.img.height;
                    const mCtx = mCanvas.getContext('2d');
                    mCtx.drawImage(state.img, 0, 0);

                    // 2. Create Face Mask
                    const maskCanvas = document.createElement('canvas');
                    maskCanvas.width = mCanvas.width; maskCanvas.height = mCanvas.height;
                    const maskCtx = maskCanvas.getContext('2d');
                    maskCtx.fillStyle = 'black';
                    maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
                    maskCtx.fillStyle = 'white';

                    const landmarks = results.multiFaceLandmarks[0];

                    // Draw face hull (simplified for perf-cheek/chin area)
                    maskCtx.beginPath();
                    // Roughly face contour points from MediaPipe FaceMesh
                    const indices = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
                    indices.forEach((id, i) => {
                        const x = landmarks[id].x * maskCanvas.width;
                        const y = landmarks[id].y * maskCanvas.height;
                        if (i === 0) maskCtx.moveTo(x, y);
                        else maskCtx.lineTo(x, y);
                    });
                    maskCtx.closePath();
                    maskCtx.fill();
                    maskCtx.filter = 'blur(10px)'; // Feather mask

                    // 3. Create Blurred Face Skin
                    const blurCanvas = document.createElement('canvas');
                    blurCanvas.width = mCanvas.width; blurCanvas.height = mCanvas.height;
                    const bCtx = blurCanvas.getContext('2d');
                    bCtx.filter = 'blur(5px)'; // Skin smoothing amount
                    bCtx.drawImage(state.img, 0, 0);
                    bCtx.filter = 'none';

                    // 4. Composite: Draw blurred face ONLY where mask is white
                    bCtx.globalCompositeOperation = 'destination-in';
                    bCtx.drawImage(maskCanvas, 0, 0);

                    // 5. Draw smoothed face on top of original
                    mCtx.globalCompositeOperation = 'source-over';
                    mCtx.globalAlpha = 0.6; // Opacity of smoothing
                    mCtx.drawImage(blurCanvas, 0, 0);

                    // Done
                    const newImg = new Image();
                    newImg.src = mCanvas.toDataURL();
                    newImg.onload = () => {
                        state.img = newImg;
                        render();
                        saveHistory();
                        btn.innerHTML = originalText;
                        btn.disabled = false;
                    };
                });

                await faceMesh.send({ image: state.img });

            } catch (e) {
                alert("Face AI Error: " + e);
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }

        // --- INTERACTIVE CROP (Simplified for V2) ---
        // For now, we will add a 'custom crop' tool that just prompts for ratio or uses a visual overlay if time.
        // Let's stick to the crop(ratio) functionality but improve it to be safer?
        // Actually, let's implement the layer visibility check in render() now.

        // --- DOM ---
        const canvas = document.getElementById('canvas');
        const ctx = canvas.getContext('2d');
        const fileInput = document.getElementById('uploadInput');

        // ... (Init function remains same)

        // --- AI ---
        // Listener moved to init()

        async function runAI() {
            if (!state.img) return alert("Please upload an image first.");

            const btn = document.getElementById('removeBgBtn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
            btn.disabled = true;

            try {
                const selfieSegmentation = new SelfieSegmentation({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}` });
                selfieSegmentation.setOptions({ modelSelection: 1 });

                selfieSegmentation.onResults(res => {
                    const mCanvas = document.createElement('canvas');
                    mCanvas.width = state.img.width; mCanvas.height = state.img.height;
                    const mCtx = mCanvas.getContext('2d');

                    if (state.aiMode === 'color') {
                        mCtx.fillStyle = document.getElementById('aiBgColor').value;
                        mCtx.fillRect(0, 0, mCanvas.width, mCanvas.height);
                    }

                    // Draw original image
                    mCtx.drawImage(state.img, 0, 0);

                    // If transparent mode, we need to mask out background
                    // Use 'destination-in' with the mask
                    // BUT: MediaPipe returns white for person, black for bg.
                    // destination-in keeps content where mask is opaque (white).

                    if (state.aiMode === 'transparent') {
                        mCtx.globalCompositeOperation = 'destination-in';
                        mCtx.drawImage(res.segmentationMask, 0, 0, mCanvas.width, mCanvas.height);
                    } else {
                        // For color mode:
                        // 1. Draw solid color (done)
                        // 2. Draw person on top? No, we need to cut out the person from original and place on color.
                        // Better approach:
                        // 1. Create person cutout
                        const cutout = document.createElement('canvas');
                        cutout.width = mCanvas.width; cutout.height = mCanvas.height;
                        const cCtx = cutout.getContext('2d');
                        cCtx.drawImage(state.img, 0, 0);
                        cCtx.globalCompositeOperation = 'destination-in';
                        cCtx.drawImage(res.segmentationMask, 0, 0, mCanvas.width, mCanvas.height);

                        // 2. Clear main canvas, fill color
                        mCtx.globalCompositeOperation = 'source-over';
                        mCtx.fillStyle = document.getElementById('aiBgColor').value;
                        mCtx.fillRect(0, 0, mCanvas.width, mCanvas.height);

                        // 3. Draw cutout on top
                        mCtx.drawImage(cutout, 0, 0);
                    }

                    const newImg = new Image();
                    newImg.src = mCanvas.toDataURL();
                    newImg.onload = () => {
                        saveHistory(); // Save BEFORE changing state
                        state.img = newImg;
                        render();
                        saveHistory(); // Save AFTER

                        btn.innerHTML = originalText;
                        btn.disabled = false;
                    };
                });
                await selfieSegmentation.send({ image: state.img });
            } catch (e) {
                alert("AI Error: " + e);
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }

        // --- INIT ---
        function init() {
            // Event Listeners
            fileInput.addEventListener('change', handleUpload);

            // Tabs
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    btn.classList.add('active');
                    document.getElementById(btn.dataset.tab).classList.add('active');
                });
            });

            // Sliders
            document.querySelectorAll('input[type=range][data-filter]').forEach(slider => {
                slider.addEventListener('input', (e) => {
                    state.filters[e.target.dataset.filter] = parseFloat(e.target.value);
                    document.getElementById('val_' + e.target.dataset.filter).innerText = e.target.value;
                    render();
                });
                slider.addEventListener('change', saveHistory);
            });

            // Tools
            document.getElementById('btnMove').addEventListener('click', () => setTool('move'));
            document.getElementById('btnBrush').addEventListener('click', () => setTool('brush'));

            // Text
            document.getElementById('addTextBtn').addEventListener('click', addTextLayer);
            document.getElementById('textSize').addEventListener('input', (e) => document.getElementById('val_textSize').innerText = e.target.value);

            // Sticker
            document.getElementById('stickerInput').addEventListener('change', addStickerLayer);

            // Viewport Interaction
            const wrapper = document.getElementById('canvasWrapper');
            wrapper.addEventListener('wheel', handleWheel);
            wrapper.addEventListener('mousedown', handleMouseDown);
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);

            // Drag Drop
            const dropZone = document.getElementById('dropZone');
            dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-active'); });
            dropZone.addEventListener('dragleave', e => { e.preventDefault(); dropZone.classList.remove('drag-active'); });
            dropZone.addEventListener('drop', e => {
                e.preventDefault();
                dropZone.classList.remove('drag-active');
                if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
            });

            // AI
            document.getElementById('removeBgBtn').addEventListener('click', runAI);

            // Theme
            document.getElementById('themeToggle').addEventListener('click', () => document.body.classList.toggle('light-mode'));

            // Export
            document.getElementById('confirmExport').addEventListener('click', doExport);

            // Undo/Redo
            document.getElementById('undoBtn').addEventListener('click', undo);
            document.getElementById('redoBtn').addEventListener('click', redo);
        }

        // --- CORE LOGIC ---

        function handleUpload(e) { loadFile(e.target.files[0]); }

        function loadFile(file) {
            const reader = new FileReader();
            reader.onload = res => {
                const img = new Image();
                img.onload = () => {
                    state.img = img;
                    resetState();
                    canvas.width = img.width;
                    canvas.height = img.height;
                    fitZoom();
                    render();
                    saveHistory();
                };
                img.src = res.target.result;
            };
            reader.readAsDataURL(file);
        }

        function resetState() {
            state.filters = { brightness: 0, contrast: 0, saturation: 0, blur: 0, vignette: 0, noise: 0, red: 0, green: 0, blue: 0 };
            state.rotation = 0; state.flipH = 1; state.flipV = 1;
            state.layers = [];
            state.strokes = [];
            state.history = [];
            state.historyIndex = -1;
            // Reset UI sliders
            document.querySelectorAll('input[type=range][data-filter]').forEach(el => { el.value = 0; el.dispatchEvent(new Event('input')) });
        }

        function render() {
            if (!state.img) return;

            const w = canvas.width;
            const h = canvas.height;

            ctx.clearRect(0, 0, w, h);
            ctx.save();

            // 1. Basic Transforms
            ctx.translate(w / 2, h / 2);
            ctx.rotate(state.rotation * Math.PI / 180);
            ctx.scale(state.flipH, state.flipV);

            // 2. CSS Filters (Brightness, Contrast, Sat, Blur)
            const f = state.filters;
            // Convert simple -100..100 to css percent/value
            const bright = 100 + f.brightness;
            const cont = 100 + f.contrast;
            const sat = 100 + f.saturation;
            const blur = f.blur;
            ctx.filter = `brightness(${bright}%) contrast(${cont}%) saturate(${sat}%) blur(${blur}px)`;

            // Draw Base Image
            ctx.drawImage(state.img, -state.img.width / 2, -state.img.height / 2);

            // 3. RGB Balance (Composite)
            ctx.filter = 'none'; // Clear css filters for overlays
            if (f.red !== 0 || f.green !== 0 || f.blue !== 0) {
                ctx.save();
                // Use soft-light for a more subtle tint, or overlay with low opacity
                ctx.globalCompositeOperation = 'overlay';
                ctx.globalAlpha = 0.3; // Reduce strength to prevent washout
                ctx.fillStyle = `rgb(${128 + f.red * 2}, ${128 + f.green * 2}, ${128 + f.blue * 2})`;
                // We need to cover the entire potential area (rotated etc)
                // A massive rect is simple solution
                ctx.fillRect(-w * 5, -h * 5, w * 10, h * 10);
                ctx.restore();
            }
            ctx.globalCompositeOperation = 'source-over';

            // 4. Vignette
            if (f.vignette > 0) {
                const grad = ctx.createRadialGradient(0, 0, Math.min(w, h) / 3, 0, 0, Math.max(w, h));
                grad.addColorStop(0, 'rgba(0,0,0,0)');
                grad.addColorStop(1, `rgba(0,0,0,${f.vignette / 100})`);
                ctx.fillStyle = grad;
                ctx.fillRect(-w * 2, -h * 2, w * 4, h * 4);
            }

            ctx.restore();

            ctx.save();
            ctx.translate(w / 2, h / 2);
            ctx.rotate(state.rotation * Math.PI / 180);
            ctx.scale(state.flipH, state.flipV);
            ctx.translate(-state.img.width / 2, -state.img.height / 2);

            // 5. Brush Strokes
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            state.strokes.forEach(stroke => {
                ctx.strokeStyle = stroke.color;
                ctx.lineWidth = stroke.size;
                ctx.beginPath();
                stroke.points.forEach((p, i) => {
                    if (i === 0) ctx.moveTo(p.x, p.y);
                    else ctx.lineTo(p.x, p.y);
                });
                ctx.stroke();
            });

            // 6. Layers (Text, Stickers)
            // 6. Layers (Text, Stickers)
            state.layers.forEach(layer => {
                if (layer.visible === false) return;

                ctx.save();
                ctx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1;

                if (layer.type === 'text') {
                    ctx.font = `${layer.size}px ${layer.font}`;
                    ctx.fillStyle = layer.color;
                    ctx.shadowColor = 'rgba(0,0,0,0.5)';
                    ctx.shadowBlur = 4;
                    ctx.fillText(layer.text, layer.x, layer.y);
                } else if (layer.type === 'sticker') {
                    ctx.drawImage(layer.img, layer.x, layer.y, layer.w, layer.h);
                }
                ctx.restore();
            });

            ctx.restore();
        }

        // --- TOOLS ---

        function setTool(t) {
            state.activeTool = t;
            document.querySelectorAll('.icon-btn').forEach(b => b.classList.remove('active'));
            if (t === 'move') document.getElementById('btnMove').classList.add('active');
            if (t === 'brush') document.getElementById('btnBrush').classList.add('active');

            const wrapper = document.getElementById('canvasWrapper');
            if (t === 'move') wrapper.style.cursor = 'grab';
            if (t === 'brush') wrapper.style.cursor = 'crosshair';
        }

        function addTextLayer() {
            if (!state.img) return;
            const text = document.getElementById('textInput').value || 'Hello';
            const color = document.getElementById('textColor').value;
            const font = document.getElementById('textFont').value;
            const size = parseInt(document.getElementById('textSize').value);

            state.layers.push({
                type: 'text',
                text: text,
                color: color,
                font: font,
                size: size,
                x: state.img.width / 2 - 50,
                y: state.img.height / 2,
                opacity: 1,
                visible: true
            });
            state.activeLayerIdx = state.layers.length - 1; // Auto select new layer
            render();
            saveHistory();
        }

        function addStickerLayer(e) {
            if (!e.target.files.length || !state.img) return;
            const reader = new FileReader();
            reader.onload = r => {
                const sImg = new Image();
                sImg.onload = () => {
                    const aspect = sImg.width / sImg.height;
                    const w = 150;
                    const h = w / aspect;
                    state.layers.push({
                        type: 'sticker',
                        img: sImg,
                        x: state.img.width / 2 - w / 2,
                        y: state.img.height / 2 - h / 2,
                        w: w, h: h,
                        opacity: 1,
                        visible: true
                    });
                    state.activeLayerIdx = state.layers.length - 1;
                    render();
                    saveHistory();
                };
                sImg.src = r.target.result;
            };
            reader.readAsDataURL(e.target.files[0]);
        }

        // --- INTERACTION ---
        let isDragging = false;
        let lastPos = { x: 0, y: 0 };
        let currentStroke = null;

        function handleWheel(e) {
            if (e.ctrlKey) { e.preventDefault(); }
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            adjustZoom(delta);
        }

        function adjustZoom(delta) {
            state.zoom = Math.max(0.1, Math.min(5, state.zoom + delta));
            updateRefTransforms();
            document.getElementById('zoomVal').innerText = Math.round(state.zoom * 100) + '%';
        }

        function fitZoom() {
            if (!state.img) return;
            const wrapper = document.getElementById('canvasWrapper');
            const ratioW = (wrapper.clientWidth - 40) / canvas.width;
            const ratioH = (wrapper.clientHeight - 40) / canvas.height;
            state.zoom = Math.min(ratioW, ratioH);
            state.pan = { x: 0, y: 0 };
            updateRefTransforms();
            document.getElementById('zoomVal').innerText = Math.round(state.zoom * 100) + '%';
        }

        function updateRefTransforms() {
            canvas.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
        }

        function handleMouseDown(e) {
            isDragging = true;
            lastPos = { x: e.clientX, y: e.clientY };

            if (state.activeTool === 'brush' && state.img) {
                const pt = getImgCoords(e);
                currentStroke = {
                    color: document.getElementById('brushColor').value,
                    size: parseInt(document.getElementById('brushSize').value),
                    points: [pt]
                };
                state.strokes.push(currentStroke);
                render();
            }
        }

        function handleMouseMove(e) {
            if (!isDragging) return;

            if (state.activeTool === 'move') {
                const dx = e.clientX - lastPos.x;
                const dy = e.clientY - lastPos.y;
                state.pan.x += dx;
                state.pan.y += dy;
                updateRefTransforms();
                lastPos = { x: e.clientX, y: e.clientY };
            } else if (state.activeTool === 'brush' && currentStroke) {
                const pt = getImgCoords(e);
                currentStroke.points.push(pt);
                render();
            }
        }

        function handleMouseUp(e) {
            isDragging = false;
            if (state.activeTool === 'brush' && currentStroke) {
                saveHistory();
                currentStroke = null;
            }
        }

        function getImgCoords(e) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const relX = (e.clientX - rect.left);
            const relY = (e.clientY - rect.top);
            let x = relX * scaleX;
            let y = relY * scaleY;

            const cx = canvas.width / 2;
            const cy = canvas.height / 2;
            x -= cx; y -= cy;

            x /= state.flipH; y /= state.flipV;

            const rad = -state.rotation * Math.PI / 180;
            const rx = x * Math.cos(rad) - y * Math.sin(rad);
            const ry = x * Math.sin(rad) + y * Math.cos(rad);

            return { x: rx + cx, y: ry + cy };
        }

        // --- PRESETS ---
        function applyPreset(name) {
            // Check if current state is different from last history state before pushing 'before' state?
            // To ensure we don't spam duplicate states.
            // Simplified: Just push.
            saveHistory();

            state.filters = {
                brightness: 0, contrast: 0, saturation: 0,
                blur: 0, vignette: 0, noise: 0,
                red: 0, green: 0, blue: 0
            };

            if (!state.img) return;

            const f = state.filters;
            switch (name) {
                case 'vintage':
                    f.brightness = -10; f.contrast = 20; f.saturation = -30;
                    f.red = 30; f.blue = -20; f.vignette = 40; f.noise = 20;
                    break;
                case 'cinematic':
                    f.contrast = 15; f.saturation = -10;
                    f.red = -10; f.blue = 20; f.vignette = 20;
                    break;
                case 'drama':
                    f.saturation = -100; f.contrast = 40; f.brightness = -10; f.vignette = 50;
                    break;
                case 'warm':
                    f.red = 20; f.green = 10; f.saturation = 20;
                    break;
                case 'cyber':
                    f.saturation = 50; f.contrast = 30; f.red = -20; f.blue = 40; f.green = -10;
                    break;
            }
            render();
            Object.keys(f).forEach(k => {
                const el = document.querySelector(`input[data-filter="${k}"]`);
                if (el) { el.value = f[k]; el.dispatchEvent(new Event('input')); }
            });

            saveHistory();
        }

        // --- HISTORY ---
        function saveHistory() {
            const snapshot = JSON.parse(JSON.stringify({
                filters: state.filters,
                rotation: state.rotation,
                flipH: state.flipH,
                flipV: state.flipV,
                layers: state.layers,
                strokes: state.strokes
            }));

            // Only push if different from current tip? (Deep compare expensive).
            // Just standard push.

            if (state.historyIndex < state.history.length - 1) {
                state.history = state.history.slice(0, state.historyIndex + 1);
            }

            state.history.push(snapshot);
            if (state.history.length > 20) state.history.shift();
            else state.historyIndex++;
            updateUndoRedo();
        }

        function undo() {
            if (state.historyIndex > 0) {
                state.historyIndex--;
                restore(state.history[state.historyIndex]);
            }
        }

        function redo() {
            if (state.historyIndex < state.history.length - 1) {
                state.historyIndex++;
                restore(state.history[state.historyIndex]);
            }
        }

        function restore(snap) {
            state.filters = snap.filters;
            state.rotation = snap.rotation; state.flipH = snap.flipH; state.flipV = snap.flipV;
            state.layers = snap.layers;
            state.strokes = snap.strokes;
            render();
            updateUndoRedo();
            // Sync UI
            Object.keys(state.filters).forEach(k => {
                const el = document.querySelector(`input[data-filter="${k}"]`);
                if (el) {
                    el.value = state.filters[k];
                    document.getElementById('val_' + k).innerText = state.filters[k];
                }
            });
        }

        function updateUndoRedo() {
            document.getElementById('undoBtn').disabled = state.historyIndex <= 0;
            document.getElementById('redoBtn').disabled = state.historyIndex >= state.history.length - 1;
        }

        // --- EXPORT ---
        function openExport() {
            if (!state.img) return alert("No image to export");
            document.getElementById('exportModal').style.display = "flex";
        }
        function closeModal() {
            document.getElementById('exportModal').style.display = "none";
        }

        let exportFmt = 'image/png';
        document.querySelectorAll('.fmt-btn').forEach(b => b.addEventListener('click', e => {
            document.querySelectorAll('.fmt-btn').forEach(btn => btn.classList.remove('active', 'border-blue-500', 'text-blue-500'));
            b.classList.add('active', 'border-blue-500', 'text-blue-500');
            exportFmt = b.dataset.fmt;
        }));

        document.getElementById('quality').addEventListener('input', e => {
            document.getElementById('qualityVal').innerText = e.target.value + '%';
        });

        function doExport() {
            const quality = parseInt(document.getElementById('quality').value) / 100;
            render(); // ensure clean
            const url = canvas.toDataURL(exportFmt, quality);
            const a = document.createElement('a');
            const ext = exportFmt.split('/')[1];
            a.download = `editx_export.${ext}`;
            a.href = url;
            a.click();
            closeModal();
        }

        // --- HELPER --
        function rotate(deg) { state.rotation += deg; render(); saveHistory(); }
        function flip(dir) { if (dir === 'h') state.flipH *= -1; else state.flipV *= -1; render(); saveHistory(); }
        function crop(ratio) {
            // Cropping in this virtual rendering pipeline means adjusting the Base Image.
            // Implementation: Create new canvas, draw current view, set as new Base Image.
            // Reset transforms.
            const temp = document.createElement('canvas');
            temp.width = canvas.width;
            temp.height = canvas.height;
            const tctx = temp.getContext('2d');
            tctx.drawImage(canvas, 0, 0);

            // Math for ratio crop from center
            let w = temp.width;
            let h = temp.height;
            if (w / h > ratio) w = h * ratio;
            else h = w / ratio;

            const finalC = document.createElement('canvas');
            finalC.width = w; finalC.height = h;
            finalC.getContext('2d').drawImage(temp, (temp.width - w) / 2, (temp.height - h) / 2, w, h, 0, 0, w, h);

            const newImg = new Image();
            newImg.src = finalC.toDataURL();
            newImg.onload = () => {
                state.img = newImg;
                canvas.width = w; canvas.height = h;
                resetState(); // Resets filters as they are baked in
                render();
                fitZoom();
                saveHistory();
            };
        }



        // --- EVENT LAYERS ---
        // Re-attach listeners for export buttons (in case they were missed)
        document.querySelectorAll('.fmt-btn').forEach(b => b.addEventListener('click', e => {
            document.querySelectorAll('.fmt-btn').forEach(btn => btn.classList.remove('active', 'border-blue-500', 'text-blue-500'));
            b.classList.add('active', 'border-blue-500', 'text-blue-500');
            exportFmt = b.dataset.fmt;
        }));

        function resetAll() {
            if (confirm("Clear workspace?")) {
                state.img = null;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                resetState();
            }
        }

        // PWA Registration
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./service-worker.js').then(() => console.log('Service Worker Registered'));
        }

        init();
    
