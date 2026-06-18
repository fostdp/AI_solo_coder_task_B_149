const EraCompare = (function () {
    "use strict";

    let debounceTimer = null;
    let chartAnimationId = null;
    let chartCanvas = null;
    let chartResults = null;
    let chartTime = 0;

    function init() {
        try {
            bindEvents();
            initCanvas();
            const params = readParams();
            calculateWithBackend(params);
        } catch (e) {
            console.error('[EraCompare] init error:', e);
            showError('模块初始化失败: ' + e.message);
        }
    }

    function bindEvents() {
        const inputs = ['ec-velocity', 'ec-mass', 'ec-angle', 'ec-diameter'];

        inputs.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', onParamChange);
            el.addEventListener('change', onParamChange);
        });

        const angleSlider = document.getElementById('ec-angle');
        const angleValue = document.getElementById('ec-angle-value');
        if (angleSlider && angleValue) {
            angleSlider.addEventListener('input', () => {
                angleValue.textContent = angleSlider.value + '°';
            });
        }

        const calcBtn = document.getElementById('ec-calc');
        if (calcBtn) {
            calcBtn.addEventListener('click', () => {
                const params = readParams();
                calculateWithBackend(params);
            });
        }

        const calcLocalBtn = document.getElementById('ec-calc-local');
        if (calcLocalBtn) {
            calcLocalBtn.addEventListener('click', () => {
                const params = readParams();
                calculateWithLocal(params);
            });
        }

        window.addEventListener('resize', () => {
            resizeCanvas();
            if (chartResults) {
                drawBarChart(chartCanvas, chartResults);
            }
        });
    }

    function initCanvas() {
        chartCanvas = document.getElementById('era-chart-canvas');
        if (!chartCanvas) return;
        resizeCanvas();
    }

    function resizeCanvas() {
        if (!chartCanvas) return;
        const parent = chartCanvas.parentElement;
        if (!parent) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = parent.getBoundingClientRect();
        chartCanvas.width = rect.width * dpr;
        chartCanvas.height = rect.height * dpr;
        chartCanvas.style.width = rect.width + 'px';
        chartCanvas.style.height = rect.height + 'px';
        const ctx = chartCanvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function onParamChange() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            try {
                const params = readParams();
                calculateWithBackend(params);
            } catch (e) {
                console.error('[EraCompare] param change error:', e);
            }
        }, 300);
    }

    function readParams() {
        const getNum = (id, def) => {
            const el = document.getElementById(id);
            if (!el) return def;
            const v = parseFloat(el.value);
            return isNaN(v) ? def : v;
        };

        return {
            baseVelocity: getNum('ec-velocity', 35),
            massKg: getNum('ec-mass', 10),
            launchAngleDeg: getNum('ec-angle', 45),
            diameterM: getNum('ec-diameter', 0.2)
        };
    }

    async function calculateWithBackend(params) {
        try {
            showLoading();
            if (window.ApiClient && typeof ApiClient.compareTrebuchets === 'function') {
                const timeout = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('请求超时')), 5000)
                );
                const data = await Promise.race([
                    ApiClient.compareTrebuchets(params),
                    timeout
                ]);
                if (data && (data.trebuchets || (Array.isArray(data) && data.length > 0) || data.data)) {
                    render(data);
                    return;
                }
            }
            console.warn('[EraCompare] 后端不可用，降级到本地计算');
            calculateWithLocal(params);
        } catch (e) {
            console.warn('[EraCompare] 后端计算失败，降级到本地:', e);
            try {
                calculateWithLocal(params);
            } catch (e2) {
                console.error('[EraCompare] 本地计算也失败:', e2);
                showError('计算失败: ' + e2.message);
            }
        }
    }

    function calculateWithLocal(params) {
        try {
            showLoading();
            if (!window.TrebuchetPhysics || typeof TrebuchetPhysics.compareTrebuchetTypes !== 'function') {
                throw new Error('物理引擎未加载');
            }
            const results = TrebuchetPhysics.compareTrebuchetTypes(params);
            const data = { trebuchets: results };
            render(data);
        } catch (e) {
            console.error('[EraCompare] calculateWithLocal error:', e);
            showError('本地计算失败: ' + e.message);
        }
    }

    function normalizeField(item, camel, snake) {
        if (item[camel] !== undefined) return item[camel];
        if (item[snake] !== undefined) return item[snake];
        return undefined;
    }

    function normalizeItem(item) {
        return {
            typeId: normalizeField(item, 'typeId', 'type_id'),
            name: normalizeField(item, 'name', 'type_name'),
            era: item.era,
            description: item.description,
            adjustedVelocity: normalizeField(item, 'adjustedVelocity', 'adjusted_velocity'),
            adjustedMass: normalizeField(item, 'adjustedMass', 'adjusted_mass'),
            efficiency: item.efficiency,
            predictedRange: normalizeField(item, 'predictedRange', 'predicted_range_m'),
            maxHeight: normalizeField(item, 'maxHeight', 'max_height_m'),
            flightTime: normalizeField(item, 'flightTime', 'flight_time_s'),
            maxMach: normalizeField(item, 'maxMach', 'max_mach'),
            impactVelocity: normalizeField(item, 'impactVelocity', 'impact_velocity'),
            rangeRanking: normalizeField(item, 'rangeRanking', 'range_ranking')
        };
    }

    function extractResults(data) {
        if (Array.isArray(data)) return data;
        if (data && Array.isArray(data.trebuchets)) return data.trebuchets;
        if (data && Array.isArray(data.data)) return data.data;
        if (data && data.result && Array.isArray(data.result)) return data.result;
        return [];
    }

    function render(data) {
        try {
            const container = document.getElementById('ec-cards-wrap');
            if (!container) return;

            const rawResults = extractResults(data);
            if (!rawResults || rawResults.length === 0) {
                container.innerHTML = '<div class="loading">无数据</div>';
                updateCount(0);
                chartResults = null;
                return;
            }

            const results = rawResults.map(normalizeItem);

            let hasRanking = results.some(r => r.rangeRanking !== undefined && r.rangeRanking !== null);
            if (!hasRanking) {
                results.sort((a, b) => (b.predictedRange || 0) - (a.predictedRange || 0));
                results.forEach((r, idx) => { r.rangeRanking = idx + 1; });
            } else {
                results.sort((a, b) => (a.rangeRanking || 999) - (b.rangeRanking || 999));
            }

            updateCount(results.length);
            chartResults = results;

            let html = '';
            results.forEach(r => {
                const rank = r.rangeRanking || 0;
                const eraClass = r.era === 'modern' ? 'modern' : 'ancient';
                const eraText = r.era === 'modern' ? 'MODERN' : 'ANCIENT';

                const rangeHighlight = rank <= 3 ? ' style="color:#ffb347;font-weight:700;"' : '';

                html += `<div class="trebuchet-card">
                    <div class="title-row">
                        <span class="card-title">${escapeHtml(r.name || '-')}</span>
                        <span class="era-badge ${eraClass}">${eraText}</span>
                    </div>
                    <div class="card-desc">${escapeHtml(r.description || '')}</div>
                    <div class="stat-row">
                        <span class="stat-label">调整后速度</span>
                        <span class="stat-value">${(r.adjustedVelocity || 0).toFixed(2)} m/s</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">调整后质量</span>
                        <span class="stat-value">${(r.adjustedMass || 0).toFixed(2)} kg</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">效率</span>
                        <span class="stat-value">${((r.efficiency || 0) * 100).toFixed(1)}%</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">射程</span>
                        <span class="stat-value"${rangeHighlight}>${(r.predictedRange || 0).toFixed(2)} m</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">最大高度</span>
                        <span class="stat-value">${(r.maxHeight || 0).toFixed(2)} m</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">飞行时间</span>
                        <span class="stat-value">${(r.flightTime || 0).toFixed(2)} s</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">最大马赫数</span>
                        <span class="stat-value">${(r.maxMach || 0).toFixed(3)} Ma</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">落地速度</span>
                        <span class="stat-value">${(r.impactVelocity || 0).toFixed(2)} m/s</span>
                    </div>
                </div>`;
            });

            container.innerHTML = html;

            if (chartCanvas) {
                resizeCanvas();
                startChartAnimation();
            }
        } catch (e) {
            console.error('[EraCompare] render error:', e);
            showError('渲染失败: ' + e.message);
        }
    }

    function startChartAnimation() {
        if (chartAnimationId) {
            cancelAnimationFrame(chartAnimationId);
        }
        function animate() {
            chartTime += 0.05;
            drawBarChart(chartCanvas, chartResults);
            chartAnimationId = requestAnimationFrame(animate);
        }
        animate();
    }

    function drawBarChart(canvas, results) {
        if (!canvas || !results || results.length === 0) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const cssWidth = canvas.width / dpr;
        const cssHeight = canvas.height / dpr;

        ctx.fillStyle = '#0a0e1a';
        ctx.fillRect(0, 0, cssWidth, cssHeight);

        const padding = { top: 40, right: 80, bottom: 40, left: 170 };
        const chartWidth = cssWidth - padding.left - padding.right;
        const chartHeight = cssHeight - padding.top - padding.bottom;

        if (chartWidth <= 0 || chartHeight <= 0) return;

        const n = results.length;
        const gap = 8;
        const barHeight = n > 0 ? (chartHeight - gap * (n - 1)) / n : 0;

        let maxRange = 0;
        results.forEach(r => { maxRange = Math.max(maxRange, r.predictedRange || 0); });
        if (maxRange <= 0) maxRange = 1;

        const scaleRatio = 0.9;

        ctx.font = 'bold 14px "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#ffb347';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('跨时代弹射器射程对比 (m)', cssWidth / 2, 10);

        drawLegend(ctx, cssWidth - padding.right, 10);

        ctx.font = '11px "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#8aa';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let i = 0; i <= 4; i++) {
            const value = (maxRange / 4) * i;
            const x = padding.left + (chartWidth * scaleRatio) * (i / 4);
            ctx.fillText(value.toFixed(0), x, padding.top + chartHeight + 8);

            ctx.strokeStyle = 'rgba(136, 170, 170, 0.15)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, padding.top);
            ctx.lineTo(x, padding.top + chartHeight);
            ctx.stroke();
        }

        results.forEach((r, idx) => {
            const y = padding.top + idx * (barHeight + gap);
            const range = r.predictedRange || 0;
            const barWidth = maxRange > 0 ? (chartWidth * scaleRatio) * (range / maxRange) : 0;

            ctx.font = '12px "Microsoft YaHei", sans-serif';
            ctx.fillStyle = '#ccd';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            const labelText = truncateText(r.name || '-', 14);
            ctx.fillText(labelText, padding.left - 10, y + barHeight / 2);

            const rank = r.rangeRanking || (idx + 1);
            const isTop3 = rank <= 3;

            let baseAlpha = 1.0;
            if (isTop3) {
                baseAlpha = 0.75 + 0.25 * Math.sin(chartTime + idx * 0.8);
            }

            const colorStart = r.era === 'modern' ? '#c9ff9e' : '#9ecfff';
            const colorEnd = r.era === 'modern' ? '#7ac94a' : '#4a8ac9';

            const gradient = ctx.createLinearGradient(padding.left, y, padding.left + barWidth, y);
            gradient.addColorStop(0, hexToRgba(colorStart, baseAlpha));
            gradient.addColorStop(1, hexToRgba(colorEnd, baseAlpha * 0.85));

            ctx.fillStyle = gradient;
            roundRect(ctx, padding.left, y, Math.max(barWidth, 2), barHeight, 4, true, false);

            if (isTop3) {
                const glowAlpha = (0.3 + 0.3 * Math.sin(chartTime * 1.5 + idx)) * baseAlpha;
                ctx.shadowColor = 'rgba(255, 200, 80, ' + glowAlpha + ')';
                ctx.shadowBlur = 12;
                ctx.fillStyle = gradient;
                roundRect(ctx, padding.left, y, Math.max(barWidth, 2), barHeight, 4, true, false);
                ctx.shadowBlur = 0;
            }

            ctx.font = '11px "Microsoft YaHei", sans-serif';
            ctx.fillStyle = isTop3 ? '#ffd700' : '#e0e0e0';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(range.toFixed(2) + ' m', padding.left + barWidth + 8, y + barHeight / 2);

            if (isTop3) {
                const medalColors = ['#ffd700', '#c0c0c0', '#cd7f32'];
                const medalColor = medalColors[rank - 1] || '#ffd700';
                ctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
                ctx.fillStyle = medalColor;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.globalAlpha = baseAlpha;
                ctx.fillText('#' + rank, padding.left + 20, y + barHeight / 2);
                ctx.globalAlpha = 1.0;
            }
        });

        ctx.strokeStyle = 'rgba(136, 170, 170, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding.left, padding.top + chartHeight);
        ctx.lineTo(padding.left + chartWidth * scaleRatio, padding.top + chartHeight);
        ctx.stroke();
    }

    function drawLegend(ctx, x, y) {
        const items = [
            { label: 'Ancient', color: '#9ecfff' },
            { label: 'Modern', color: '#c9ff9e' }
        ];
        let currentX = x - 10;
        ctx.font = '11px "Microsoft YaHei", sans-serif';
        ctx.textBaseline = 'middle';
        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            ctx.textAlign = 'right';
            ctx.fillStyle = '#ccd';
            ctx.fillText(item.label, currentX, y + 6);
            currentX -= 8;
            const boxW = 16, boxH = 10;
            const grad = ctx.createLinearGradient(currentX - boxW, y, currentX, y);
            grad.addColorStop(0, item.color);
            grad.addColorStop(1, shadeColor(item.color, -30));
            ctx.fillStyle = grad;
            roundRect(ctx, currentX - boxW, y + 1, boxW, boxH, 2, true, false);
            currentX -= boxW + 18;
        }
    }

    function roundRect(ctx, x, y, w, h, r, fill, stroke) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        if (fill) ctx.fill();
        if (stroke) ctx.stroke();
    }

    function truncateText(text, maxLen) {
        if (!text) return '';
        const s = String(text);
        return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
    }

    function hexToRgba(hex, alpha) {
        const h = hex.replace('#', '');
        const bigint = parseInt(h.length === 3
            ? h.split('').map(c => c + c).join('')
            : h, 16);
        const r = (bigint >> 16) & 255;
        const g = (bigint >> 8) & 255;
        const b = bigint & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function shadeColor(color, percent) {
        const f = parseInt(color.slice(1), 16);
        const t = percent < 0 ? 0 : 255;
        const p = Math.abs(percent) / 100;
        const R = f >> 16;
        const G = (f >> 8) & 0x00FF;
        const B = f & 0x0000FF;
        return '#' + (
            0x1000000 +
            (Math.round((t - R) * p) + R) * 0x10000 +
            (Math.round((t - G) * p) + G) * 0x100 +
            (Math.round((t - B) * p) + B)
        ).toString(16).slice(1);
    }

    function showLoading() {
        const container = document.getElementById('ec-cards-wrap');
        if (container) {
            container.innerHTML = '<div class="loading">计算中...</div>';
        }
    }

    function showError(msg) {
        const container = document.getElementById('ec-cards-wrap');
        if (container) {
            container.innerHTML = `<div class="mc-error">${escapeHtml(msg)}</div>`;
        }
    }

    function updateCount(n) {
        const countEl = document.getElementById('ec-count');
        if (countEl) {
            countEl.textContent = '共 ' + n + ' 种弹射器';
        }
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    return { init };
})();
