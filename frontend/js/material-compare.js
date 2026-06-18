const MaterialCompare = (function () {
    "use strict";

    let debounceTimer = null;

    function init() {
        try {
            bindEvents();
            const params = readParams();
            calculateWithBackend(params);
        } catch (e) {
            console.error('[MaterialCompare] init error:', e);
            showError('模块初始化失败: ' + e.message);
        }
    }

    function bindEvents() {
        const inputs = [
            'mc-torsion',
            'mc-mass',
            'mc-angle',
            'mc-wire',
            'mc-mean',
            'mc-coils'
        ];

        inputs.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', onParamChange);
            el.addEventListener('change', onParamChange);
        });

        const angleSlider = document.getElementById('mc-angle');
        const angleValue = document.getElementById('mc-angle-value');
        if (angleSlider && angleValue) {
            angleSlider.addEventListener('input', () => {
                angleValue.textContent = angleSlider.value + '°';
            });
        }

        const calcBtn = document.getElementById('mc-calc');
        if (calcBtn) {
            calcBtn.addEventListener('click', () => {
                const params = readParams();
                calculateWithBackend(params);
            });
        }

        const calcLocalBtn = document.getElementById('mc-calc-local');
        if (calcLocalBtn) {
            calcLocalBtn.addEventListener('click', () => {
                const params = readParams();
                calculateWithLocal(params);
            });
        }
    }

    function onParamChange() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            try {
                const params = readParams();
                calculateWithBackend(params);
            } catch (e) {
                console.error('[MaterialCompare] param change error:', e);
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
        const getInt = (id, def) => {
            const el = document.getElementById(id);
            if (!el) return def;
            const v = parseInt(el.value);
            return isNaN(v) ? def : v;
        };

        return {
            torsionAngleDeg: getNum('mc-torsion', 120),
            massKg: getNum('mc-mass', 10),
            launchAngleDeg: getNum('mc-angle', 45),
            wireDiameterMm: getNum('mc-wire', 20),
            meanDiameterMm: getNum('mc-mean', 150),
            activeCoils: getInt('mc-coils', 12)
        };
    }

    async function calculateWithBackend(params) {
        try {
            showLoading();
            if (window.ApiClient && typeof ApiClient.compareMaterials === 'function') {
                const timeout = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('请求超时')), 5000)
                );
                const data = await Promise.race([
                    ApiClient.compareMaterials(params),
                    timeout
                ]);
                if (data && (data.materials || (Array.isArray(data) && data.length > 0) || data.data)) {
                    render(data);
                    return;
                }
            }
            console.warn('[MaterialCompare] 后端不可用，降级到本地计算');
            calculateWithLocal(params);
        } catch (e) {
            console.warn('[MaterialCompare] 后端计算失败，降级到本地:', e);
            try {
                calculateWithLocal(params);
            } catch (e2) {
                console.error('[MaterialCompare] 本地计算也失败:', e2);
                showError('计算失败: ' + e2.message);
            }
        }
    }

    function calculateWithLocal(params) {
        try {
            showLoading();
            if (!window.TrebuchetPhysics || typeof TrebuchetPhysics.compareMaterials !== 'function') {
                throw new Error('物理引擎未加载');
            }
            const results = TrebuchetPhysics.compareMaterials(params);
            const data = { materials: results };
            render(data);
        } catch (e) {
            console.error('[MaterialCompare] calculateWithLocal error:', e);
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
            materialId: normalizeField(item, 'materialId', 'material_id'),
            name: normalizeField(item, 'name', 'material_name'),
            era: item.era,
            storedEnergy: normalizeField(item, 'storedEnergy', 'stored_energy'),
            springConstant: normalizeField(item, 'springConstant', 'spring_constant'),
            shearStressMpa: normalizeField(item, 'shearStressMpa', 'shear_stress_mpa'),
            efficiency: item.efficiency,
            cyclicDamageRatio: normalizeField(item, 'cyclicDamageRatio', 'cyclic_damage_ratio'),
            predictedRange: normalizeField(item, 'predictedRange', 'predicted_range_m'),
            maxHeight: normalizeField(item, 'maxHeight', 'max_height_m'),
            flightTime: normalizeField(item, 'flightTime', 'flight_time_s'),
            rangeRanking: normalizeField(item, 'rangeRanking', 'range_ranking')
        };
    }

    function extractResults(data) {
        if (Array.isArray(data)) return data;
        if (data && Array.isArray(data.materials)) return data.materials;
        if (data && Array.isArray(data.data)) return data.data;
        if (data && data.result && Array.isArray(data.result)) return data.result;
        return [];
    }

    function render(data) {
        try {
            const container = document.getElementById('mc-results');
            if (!container) return;

            const rawResults = extractResults(data);
            if (!rawResults || rawResults.length === 0) {
                container.innerHTML = '<div class="loading">无数据</div>';
                updateCount(0);
                return;
            }

            const results = rawResults.map(normalizeItem);

            let hasRanking = results.some(r => r.rangeRanking !== undefined && r.rangeRanking !== null);
            if (!hasRanking) {
                results.sort((a, b) => (b.predictedRange || 0) - (a.predictedRange || 0));
                results.forEach((r, idx) => { r.rangeRanking = idx + 1; });
            }

            const maxEnergy = results.reduce((max, r) =>
                Math.max(max, r.storedEnergy || 0), 0
            );

            const countEl = document.getElementById('mc-count');
            if (countEl) {
                countEl.textContent = '共 ' + results.length + ' 种材料';
            }

            let html = '<table class="mc-table">';
            html += '<thead><tr>';
            html += '<th>排名</th>';
            html += '<th>材料名称</th>';
            html += '<th>时代</th>';
            html += '<th>储能(kJ)</th>';
            html += '<th>效率</th>';
            html += '<th>剪应力(MPa)</th>';
            html += '<th>射程(m)</th>';
            html += '<th>最大高度(m)</th>';
            html += '<th>飞行时间(s)</th>';
            html += '<th>循环损伤</th>';
            html += '</tr></thead><tbody>';

            results.forEach(r => {
                const rank = r.rangeRanking || 0;
                const rankClass = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : '';
                const rankText = formatRank(rank);

                const eraClass = r.era === 'ancient' ? 'era-ancient' : 'era-modern';
                const eraText = r.era === 'ancient' ? '古代' : '现代';

                const energyKj = ((r.storedEnergy || 0) / 1000).toFixed(2);
                const energyPct = maxEnergy > 0
                    ? Math.min(100, ((r.storedEnergy || 0) / maxEnergy) * 100).toFixed(1)
                    : 0;

                const effPct = ((r.efficiency || 0) * 100).toFixed(1);
                const shear = (r.shearStressMpa || 0).toFixed(1);
                const range = (r.predictedRange || 0).toFixed(2);
                const height = (r.maxHeight || 0).toFixed(2);
                const time = (r.flightTime || 0).toFixed(2);
                const damagePct = ((r.cyclicDamageRatio || 0) * 100).toFixed(2);

                const rangeBold = rank <= 3 ? ' style="font-weight:700;color:#ffb347;"' : '';

                html += '<tr>';
                html += `<td class="mc-rank ${rankClass}">${rankText}</td>`;
                html += `<td class="mc-name">${escapeHtml(r.name || '-')}</td>`;
                html += `<td class="mc-era ${eraClass}">${eraText}</td>`;
                html += `<td class="mc-energy">
                    <div class="mc-energy-value">${energyKj}</div>
                    <div class="energy-bar"><div class="energy-bar-fill" style="width:${energyPct}%"></div></div>
                </td>`;
                html += `<td class="mc-efficiency">${effPct}%</td>`;
                html += `<td class="mc-shear">${shear}</td>`;
                html += `<td class="mc-range"${rangeBold}>${range}</td>`;
                html += `<td class="mc-height">${height}</td>`;
                html += `<td class="mc-time">${time}</td>`;
                html += `<td class="mc-damage">${damagePct}%</td>`;
                html += '</tr>';
            });

            html += '</tbody></table>';
            container.innerHTML = html;
        } catch (e) {
            console.error('[MaterialCompare] render error:', e);
            showError('渲染失败: ' + e.message);
        }
    }

    function formatRank(n) {
        if (!n || n <= 0) return '-';
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    function showLoading() {
        const container = document.getElementById('mc-results');
        if (container) {
            container.innerHTML = '<div class="loading">计算中...</div>';
        }
    }

    function showError(msg) {
        const container = document.getElementById('mc-results');
        if (container) {
            container.innerHTML = `<div class="mc-error">${escapeHtml(msg)}</div>`;
        }
    }

    function updateCount(n) {
        const countEl = document.getElementById('mc-count');
        if (countEl) {
            countEl.textContent = '共 ' + n + ' 种材料';
        }
    }

    return { init };
})();
