const PreloadAnalysis = (function () {
    let canvas, ctx;
    let width, height;
    let debounceTimer = null;
    const DEBOUNCE_MS = 300;

    function init() {
        try {
            bindInputs();
            initCanvas();
            scheduleAutoCalc();
        } catch (e) {
            console.error('[PreloadAnalysis] init error:', e);
        }
    }

    function bindInputs() {
        const plAngle = document.getElementById('pl-angle');
        const plAngleValue = document.getElementById('pl-angle-value');
        if (plAngle && plAngleValue) {
            plAngle.addEventListener('input', () => {
                plAngleValue.textContent = plAngle.value + '°';
                onChange();
            });
        }

        const inputIds = ['pl-max', 'pl-total', 'pl-mass', 'pl-material', 'pl-wire', 'pl-mean', 'pl-coils', 'pl-steps'];
        inputIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', onChange);
        });

        const btnAnalyze = document.getElementById('pl-analyze');
        if (btnAnalyze) btnAnalyze.addEventListener('click', onAnalyzeClick);

        const btnAnalyzeLocal = document.getElementById('pl-analyze-local');
        if (btnAnalyzeLocal) btnAnalyzeLocal.addEventListener('click', onAnalyzeLocalClick);
    }

    function onChange() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            try {
                calculateWithBackend(readParams());
            } catch (e) {
                console.warn('[PreloadAnalysis] auto calc error:', e);
            }
        }, DEBOUNCE_MS);
    }

    function scheduleAutoCalc() {
        setTimeout(() => {
            try {
                calculateWithBackend(readParams());
            } catch (e) {
                console.warn('[PreloadAnalysis] initial calc error:', e);
            }
        }, 100);
    }

    function onAnalyzeClick() {
        try {
            calculateWithBackend(readParams());
        } catch (e) {
            console.error('[PreloadAnalysis] analyze click error:', e);
            fallbackToLocal();
        }
    }

    function onAnalyzeLocalClick() {
        try {
            calculateWithLocal(readParams());
        } catch (e) {
            console.error('[PreloadAnalysis] local analyze click error:', e);
        }
    }

    function fallbackToLocal() {
        try {
            calculateWithLocal(readParams());
        } catch (e2) {
            console.error('[PreloadAnalysis] fallback local error:', e2);
            showError('计算失败，请检查参数');
        }
    }

    function initCanvas() {
        canvas = document.getElementById('pl-chart-canvas');
        if (!canvas) return;
        ctx = canvas.getContext('2d');
        resize();
        window.addEventListener('resize', () => {
            resize();
            if (window._lastPreloadData) drawChartSafe(window._lastPreloadData);
        });
    }

    function resize() {
        if (!canvas || !canvas.parentElement) return;
        const rect = canvas.parentElement.getBoundingClientRect();
        width = rect.width;
        height = rect.height;
        if (width < 10 || height < 10) return;
        canvas.width = width * window.devicePixelRatio;
        canvas.height = height * window.devicePixelRatio;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    function readParams() {
        const getNum = (id, def) => {
            const el = document.getElementById(id);
            if (!el) return def;
            const v = parseFloat(el.value);
            return isNaN(v) ? def : v;
        };
        const getStr = (id, def) => {
            const el = document.getElementById(id);
            return el ? (el.value || def) : def;
        };
        return {
            maxAngleDeg: getNum('pl-max', 120),
            totalAngleDeg: getNum('pl-total', 360),
            massKg: getNum('pl-mass', 10),
            launchAngleDeg: getNum('pl-angle', 45),
            materialId: getStr('pl-material', 'steel65mn'),
            wireDiameterMm: getNum('pl-wire', 20),
            meanDiameterMm: getNum('pl-mean', 150),
            activeCoils: Math.floor(getNum('pl-coils', 12)),
            steps: Math.floor(getNum('pl-steps', 20))
        };
    }

    async function calculateWithBackend(params) {
        try {
            if (window.ApiClient && ApiClient.analyzePreload) {
                const backendParams = {
                    maxAngleDeg: params.maxAngleDeg,
                    totalAngleDeg: params.totalAngleDeg,
                    massKg: params.massKg,
                    launchAngleDeg: params.launchAngleDeg,
                    wireMm: params.wireDiameterMm,
                    meanMm: params.meanDiameterMm,
                    coils: params.activeCoils,
                    material: params.materialId,
                    steps: params.steps
                };
                const data = await ApiClient.analyzePreload(backendParams);
                if (data && (data.points || data.data || Array.isArray(data))) {
                    const normalized = normalizeApiResponse(data);
                    if (normalized) {
                        render(normalized);
                        return;
                    }
                }
            }
            fallbackToLocal();
        } catch (e) {
            console.warn('[PreloadAnalysis] backend failed, fallback to local:', e);
            fallbackToLocal();
        }
    }

    function normalizeApiResponse(data) {
        if (!data) return null;
        let points = null;
        if (data.points) points = data.points;
        else if (data.data && data.data.points) points = data.data.points;
        else if (Array.isArray(data)) points = data;

        if (!points) return null;
        return {
            points: points,
            bestPreloadAngleDeg: data.bestPreloadAngleDeg ?? data.best_preload_angle_deg ?? data.data?.bestPreloadAngleDeg,
            maxRangeM: data.maxRangeM ?? data.max_range_m ?? data.data?.maxRangeM,
            baselineRangeM: data.baselineRangeM ?? data.baseline_range_m ?? data.data?.baselineRangeM,
            improvementPercent: data.improvementPercent ?? data.improvement_percent ?? data.data?.improvementPercent
        };
    }

    function calculateWithLocal(params) {
        try {
            if (!window.TrebuchetPhysics || !TrebuchetPhysics.analyzePreloadEffect) {
                showError('物理模块不可用');
                return;
            }
            const localParams = {
                maxPreloadAngleDeg: params.maxAngleDeg,
                totalTorsionAngleDeg: params.totalAngleDeg,
                massKg: params.massKg,
                launchAngleDeg: params.launchAngleDeg,
                wireDiameterMm: params.wireDiameterMm,
                meanDiameterMm: params.meanDiameterMm,
                activeCoils: params.activeCoils,
                materialId: params.materialId,
                steps: params.steps
            };
            const data = TrebuchetPhysics.analyzePreloadEffect(localParams);
            render(data);
        } catch (e) {
            console.error('[PreloadAnalysis] local calc error:', e);
            showError('本地计算失败：' + (e.message || '未知错误'));
        }
    }

    function render(rawData) {
        try {
            const data = normalizeData(rawData);
            if (!data || !data.points || data.points.length === 0) {
                showError('无有效计算结果');
                return;
            }
            window._lastPreloadData = data;

            const baseline = data.baselineRangeM;
            const maxR = data.maxRangeM;
            const improve = data.improvementPercent;
            const best = data.bestPreloadAngleDeg;

            setCardText('pl-baseline', baseline.toFixed(2) + ' m');
            setSummaryCardText('pl-max', maxR.toFixed(2) + ' m');
            const improveText = improve >= 0
                ? '+' + improve.toFixed(1) + '%'
                : improve.toFixed(1) + '%';
            setCardText('pl-improve', improveText);
            setCardText('pl-best', best.toFixed(0) + '°');

            drawChartSafe(data);
        } catch (e) {
            console.error('[PreloadAnalysis] render error:', e);
            showError('渲染失败：' + (e.message || '未知错误'));
        }
    }

    function normalizeData(d) {
        if (!d) return null;
        const points = (d.points || []).map(p => ({
            preloadAngleDeg: p.preloadAngleDeg ?? p.preload_angle_deg ?? 0,
            rangeM: p.rangeM ?? p.range_m ?? 0,
            energyJ: p.energyJ ?? p.energy_j ?? 0,
            efficiency: p.efficiency ?? 0
        }));

        let bestPreloadAngleDeg = d.bestPreloadAngleDeg ?? d.best_preload_angle_deg;
        let maxRangeM = d.maxRangeM ?? d.max_range_m;
        let baselineRangeM = d.baselineRangeM ?? d.baseline_range_m;
        let improvementPercent = d.improvementPercent ?? d.improvement_percent;

        if (maxRangeM === undefined || maxRangeM === null) {
            maxRangeM = points.reduce((m, p) => Math.max(m, p.rangeM), 0);
        }
        if (bestPreloadAngleDeg === undefined || bestPreloadAngleDeg === null) {
            let bestIdx = 0;
            points.forEach((p, i) => { if (p.rangeM > points[bestIdx].rangeM) bestIdx = i; });
            bestPreloadAngleDeg = points[bestIdx]?.preloadAngleDeg ?? 0;
        }
        if (baselineRangeM === undefined || baselineRangeM === null) {
            baselineRangeM = points.find(p => Math.abs(p.preloadAngleDeg) < 0.001)?.rangeM ?? 0;
        }
        if (improvementPercent === undefined || improvementPercent === null) {
            improvementPercent = baselineRangeM > 0
                ? ((maxRangeM - baselineRangeM) / baselineRangeM) * 100
                : 0;
        }

        return { points, bestPreloadAngleDeg, maxRangeM, baselineRangeM, improvementPercent };
    }

    function setCardText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function setSummaryCardText(id, text) {
        const el = document.querySelector('.preload-optimization-summary #' + id)
            || document.querySelectorAll('#' + id)[1]
            || document.getElementById(id);
        if (el) el.textContent = text;
    }

    function showError(msg) {
        console.warn('[PreloadAnalysis]', msg);
        setCardText('pl-baseline', '--');
        setSummaryCardText('pl-max', '--');
        setCardText('pl-improve', '--');
        setCardText('pl-best', '--');
        if (ctx) {
            ctx.fillStyle = '#0a0e1a';
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = '#ff6b6b';
            ctx.font = '13px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(msg, width / 2, height / 2);
        }
    }

    function drawChartSafe(data) {
        try {
            drawChart(canvas, data.points, data.bestPreloadAngleDeg, data.baselineRangeM);
        } catch (e) {
            console.error('[PreloadAnalysis] drawChart error:', e);
        }
    }

    function scaleLinear(domainMin, domainMax, rangeMin, rangeMax) {
        const domainRange = domainMax - domainMin || 1;
        const rangeSpan = rangeMax - rangeMin;
        return function (v) {
            return rangeMin + ((v - domainMin) / domainRange) * rangeSpan;
        };
    }

    function drawChart(canvasEl, points, bestPreloadDeg, baselineM) {
        if (!canvasEl || !ctx || !points || points.length === 0) return;
        if (width < 50 || height < 50) return;

        const padding = { top: 30, right: 80, bottom: 50, left: 60 };
        const chartW = Math.max(10, width - padding.left - padding.right);
        const chartH = Math.max(10, height - padding.top - padding.bottom);

        ctx.clearRect(0, 0, width, height);

        const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
        bgGradient.addColorStop(0, '#050810');
        bgGradient.addColorStop(1, '#0a0e1a');
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, width, height);

        const minAngle = points.reduce((m, p) => Math.min(m, p.preloadAngleDeg), Infinity);
        const maxAngle = points.reduce((m, p) => Math.max(m, p.preloadAngleDeg), -Infinity);
        const minRangeRaw = points.reduce((m, p) => Math.min(m, p.rangeM), Infinity);
        const maxRangeRaw = points.reduce((m, p) => Math.max(m, p.rangeM), -Infinity);
        const minRange = Math.min(minRangeRaw, baselineM) * 0.95;
        const maxRange = Math.max(maxRangeRaw, baselineM) * 1.02;

        const xScale = scaleLinear(minAngle, maxAngle, padding.left, padding.left + chartW);
        const yScale = scaleLinear(minRange, maxRange, padding.top + chartH, padding.top);

        drawGrid(padding, chartW, chartH, minAngle, maxAngle, minRange, maxRange, xScale, yScale);
        drawBaseline(baselineM, xScale, yScale, minAngle, maxAngle, padding);
        drawCurve(points, xScale, yScale, minRange, maxRange);
        drawPoints(points, bestPreloadDeg, xScale, yScale);
        drawBestMark(bestPreloadDeg, points, xScale, yScale);
        drawAxes(padding, chartW, chartH, minAngle, maxAngle, minRange, maxRange, xScale, yScale);
        drawLegend(padding);
    }

    function drawGrid(padding, chartW, chartH, minAngle, maxAngle, minRange, maxRange, xScale, yScale) {
        ctx.strokeStyle = 'rgba(100, 120, 160, 0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);

        for (let i = 0; i <= 5; i++) {
            const y = padding.top + (i / 5) * chartH;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartW, y);
            ctx.stroke();
        }

        for (let i = 0; i <= 5; i++) {
            const angleVal = minAngle + (i / 5) * (maxAngle - minAngle);
            const x = xScale(angleVal);
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, padding.top + chartH);
            ctx.stroke();
        }

        ctx.setLineDash([]);
    }

    function drawBaseline(baselineM, xScale, yScale, minAngle, maxAngle, padding) {
        const y = yScale(baselineM);
        const xStart = xScale(minAngle);
        const xEnd = xScale(maxAngle);
        ctx.strokeStyle = '#ff9f43';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([8, 4]);
        ctx.beginPath();
        ctx.moveTo(xStart, y);
        ctx.lineTo(xEnd, y);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.fillStyle = '#ff9f43';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText('Baseline: ' + baselineM.toFixed(2) + ' m', Math.min(xEnd, width - padding.right + 50), y - 4);
    }

    function drawCurve(points, xScale, yScale, minRange, maxRange) {
        if (points.length < 2) return;

        const totalRange = maxRange - minRange || 1;
        const pts = points.map(p => ({
            x: xScale(p.preloadAngleDeg),
            y: yScale(p.rangeM),
            ratio: (p.rangeM - minRange) / totalRange
        }));

        const interpPts = [];
        for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[i - 1] || pts[i];
            const p1 = pts[i];
            const p2 = pts[i + 1];
            const p3 = pts[i + 2] || p2;

            const subCount = 8;
            for (let s = 0; s < subCount; s++) {
                const t = s / subCount;
                const cp1x = p1.x + (p2.x - p0.x) / 6;
                const cp1y = p1.y + (p2.y - p0.y) / 6;
                const cp2x = p2.x - (p3.x - p1.x) / 6;
                const cp2y = p2.y - (p3.y - p1.y) / 6;

                const mt = 1 - t;
                const x = mt * mt * mt * p1.x + 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t * p2.x;
                const y = mt * mt * mt * p1.y + 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t * p2.y;
                const ratio = p1.ratio + (p2.ratio - p1.ratio) * t;

                interpPts.push({ x, y, ratio });
            }
        }
        interpPts.push({ ...pts[pts.length - 1] });

        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let i = 1; i < interpPts.length; i++) {
            const prev = interpPts[i - 1];
            const curr = interpPts[i];
            const avgRatio = (prev.ratio + curr.ratio) / 2;
            ctx.strokeStyle = getRangeColor(avgRatio);
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(curr.x, curr.y);
            ctx.stroke();
        }
    }

    function getRangeColor(ratio) {
        const r = Math.max(0, Math.min(1, ratio));
        if (r < 0.5) {
            const t = r / 0.5;
            return lerpColor('#1e90ff', '#ff9f43', t);
        } else {
            const t = (r - 0.5) / 0.5;
            return lerpColor('#ff9f43', '#ff4757', t);
        }
    }

    function lerpColor(c1, c2, t) {
        const r1 = parseInt(c1.slice(1, 3), 16);
        const g1 = parseInt(c1.slice(3, 5), 16);
        const b1 = parseInt(c1.slice(5, 7), 16);
        const r2 = parseInt(c2.slice(1, 3), 16);
        const g2 = parseInt(c2.slice(3, 5), 16);
        const b2 = parseInt(c2.slice(5, 7), 16);
        const r = Math.round(r1 + (r2 - r1) * t);
        const g = Math.round(g1 + (g2 - g1) * t);
        const b = Math.round(b1 + (b2 - b1) * t);
        return `rgb(${r}, ${g}, ${b})`;
    }

    function drawPoints(points, bestPreloadDeg, xScale, yScale) {
        const bestP = points.reduce((best, p) =>
            Math.abs(p.preloadAngleDeg - bestPreloadDeg) < Math.abs(best.preloadAngleDeg - bestPreloadDeg) ? p : best
        , points[0]);

        points.forEach(p => {
            const x = xScale(p.preloadAngleDeg);
            const y = yScale(p.rangeM);
            const dist = Math.abs(p.preloadAngleDeg - bestPreloadDeg);
            const maxDist = Math.max(...points.map(pp => Math.abs(pp.preloadAngleDeg - bestPreloadDeg)), 1);
            const closeness = 1 - Math.min(1, dist / maxDist);
            const color = lerpColor('#6a7a95', '#2ed573', closeness);

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    function drawBestMark(bestPreloadDeg, points, xScale, yScale) {
        let bestP = points.find(p => Math.abs(p.preloadAngleDeg - bestPreloadDeg) < 0.5);
        if (!bestP) bestP = points.reduce((best, p) =>
            Math.abs(p.preloadAngleDeg - bestPreloadDeg) < Math.abs(best.preloadAngleDeg - bestPreloadDeg) ? p : best
        , points[0]);

        const x = xScale(bestP.preloadAngleDeg);
        const y = yScale(bestP.rangeM);
        const blinkAlpha = 0.5 + Math.random() * 0.5;

        ctx.strokeStyle = `rgba(46, 213, 115, ${blinkAlpha})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x - 9, y);
        ctx.lineTo(x + 9, y);
        ctx.moveTo(x, y - 9);
        ctx.lineTo(x, y + 9);
        ctx.stroke();

        ctx.fillStyle = '#2ed573';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText('最优: ' + bestPreloadDeg.toFixed(0) + '°', x + 12, y - 8);
    }

    function drawAxes(padding, chartW, chartH, minAngle, maxAngle, minRange, maxRange, xScale, yScale) {
        ctx.strokeStyle = 'rgba(140, 160, 200, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.moveTo(padding.left, padding.top + chartH);
        ctx.lineTo(padding.left + chartW, padding.top + chartH);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(padding.left, padding.top);
        ctx.lineTo(padding.left, padding.top + chartH);
        ctx.stroke();

        ctx.fillStyle = '#8a9ab5';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let i = 0; i <= 5; i++) {
            const angleVal = minAngle + (i / 5) * (maxAngle - minAngle);
            const x = xScale(angleVal);
            ctx.fillText(angleVal.toFixed(0), x, padding.top + chartH + 6);
        }

        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let i = 0; i <= 5; i++) {
            const rangeVal = maxRange - (i / 5) * (maxRange - minRange);
            const y = padding.top + (i / 5) * chartH;
            ctx.fillText(rangeVal.toFixed(1), padding.left - 8, y);
        }

        ctx.fillStyle = '#a8b8d0';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('预紧角 (°)', padding.left + chartW / 2, height - 8);

        ctx.save();
        ctx.translate(14, padding.top + chartH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('射程 (m)', 0, 0);
        ctx.restore();
    }

    function drawLegend(padding) {
        const items = [
            { color: '#ff9f43', label: 'Baseline', dash: true },
            { color: '#2ed573', label: '最优预紧角', dash: false, marker: 'cross' },
            { color: '#1e90ff', label: '射程曲线', dash: false, gradient: true }
        ];

        const startX = width - padding.right + 10;
        let startY = padding.top + 5;
        const boxW = 150;
        const boxH = items.length * 22 + 16;

        ctx.fillStyle = 'rgba(13, 20, 40, 0.85)';
        ctx.strokeStyle = 'rgba(74, 90, 122, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(startX - 8, startY - 8, boxW, boxH, 6);
        else {
            ctx.rect(startX - 8, startY - 8, boxW, boxH);
        }
        ctx.fill();
        ctx.stroke();

        items.forEach(item => {
            ctx.strokeStyle = item.color;
            ctx.fillStyle = item.color;
            ctx.lineWidth = 2;
            ctx.setLineDash(item.dash ? [6, 3] : []);

            if (item.marker === 'cross') {
                ctx.beginPath();
                ctx.moveTo(startX, startY - 4);
                ctx.lineTo(startX + 14, startY + 4);
                ctx.moveTo(startX + 14, startY - 4);
                ctx.lineTo(startX, startY + 4);
                ctx.stroke();
            } else if (item.gradient) {
                const grad = ctx.createLinearGradient(startX, startY, startX + 40, startY);
                grad.addColorStop(0, '#1e90ff');
                grad.addColorStop(0.5, '#ff9f43');
                grad.addColorStop(1, '#ff4757');
                ctx.strokeStyle = grad;
                ctx.beginPath();
                ctx.moveTo(startX, startY);
                ctx.lineTo(startX + 40, startY);
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.moveTo(startX, startY);
                ctx.lineTo(startX + 40, startY);
                ctx.stroke();
            }
            ctx.setLineDash([]);

            ctx.fillStyle = '#c8d0e0';
            ctx.font = '11px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(item.label, startX + 50, startY);

            startY += 22;
        });
    }

    return { init };
})();
