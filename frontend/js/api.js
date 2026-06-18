const ApiClient = (function () {
    const DEFAULT_BASE = 'http://127.0.0.1:8080';
    let baseUrl = DEFAULT_BASE;

    function setBaseUrl(url) { baseUrl = url; }

    async function request(path, options = {}) {
        const url = baseUrl + path;
        const defaultOptions = {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        };
        const finalOptions = { ...defaultOptions, ...options };
        try {
            const response = await fetch(url, finalOptions);
            const text = await response.text();
            try { return JSON.parse(text); }
            catch { return text; }
        } catch (e) {
            console.error('API请求失败:', e);
            return null;
        }
    }

    async function health() { return request('/api/health'); }

    async function predictRange(params = {}) {
        const query = Object.entries(params)
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
            .join('&');
        return request(`/api/predict-range?${query}`);
    }

    async function springEnergy(angle) {
        return request(`/api/spring-energy?angle=${encodeURIComponent(angle)}`);
    }

    async function getSensorData(machineId = '', limit = 100) {
        const query = [];
        if (machineId) query.push(`machine_id=${encodeURIComponent(machineId)}`);
        query.push(`limit=${limit}`);
        return request(`/api/sensor-data?${query.join('&')}`);
    }

    async function getAlerts(machineId = '', limit = 50) {
        const query = [];
        if (machineId) query.push(`machine_id=${encodeURIComponent(machineId)}`);
        query.push(`limit=${limit}`);
        return request(`/api/alerts?${query.join('&')}`);
    }

    async function getMachineStatus() {
        return request('/api/machine-status');
    }

    async function getMaterials() {
        return request('/api/materials');
    }

    async function compareMaterials(params = {}) {
        const mapping = {
            angleDeg: 'angle_deg',
            massKg: 'mass_kg',
            launchAngleDeg: 'launch_angle_deg',
            wireMm: 'wire_mm',
            meanMm: 'mean_mm',
            coils: 'coils'
        };
        const query = Object.entries(params)
            .map(([k, v]) => `${mapping[k] || k}=${encodeURIComponent(v)}`)
            .join('&');
        return request(`/api/compare-materials?${query}`);
    }

    async function compareTrebuchets(params = {}) {
        const mapping = {
            baseVelocity: 'base_velocity',
            massKg: 'mass_kg',
            launchAngleDeg: 'launch_angle_deg',
            diameterM: 'diameter_m'
        };
        const query = Object.entries(params)
            .map(([k, v]) => `${mapping[k] || k}=${encodeURIComponent(v)}`)
            .join('&');
        return request(`/api/compare-trebuchets?${query}`);
    }

    async function analyzePreload(params = {}) {
        const mapping = {
            maxAngleDeg: 'max_angle_deg',
            totalAngleDeg: 'total_angle_deg',
            massKg: 'mass_kg',
            launchAngleDeg: 'launch_angle_deg',
            wireMm: 'wire_mm',
            meanMm: 'mean_mm',
            coils: 'coils',
            material: 'material',
            steps: 'steps'
        };
        const query = Object.entries(params)
            .map(([k, v]) => `${mapping[k] || k}=${encodeURIComponent(v)}`)
            .join('&');
        return request(`/api/analyze-preload?${query}`);
    }

    async function virtualLaunch(params = {}) {
        const mapping = {
            torsionAngleDeg: 'torsion_angle_deg',
            preloadDeg: 'preload_deg',
            massKg: 'mass_kg',
            launchAngleDeg: 'launch_angle_deg',
            wireMm: 'wire_mm',
            meanMm: 'mean_mm',
            coils: 'coils',
            material: 'material'
        };
        const query = Object.entries(params)
            .map(([k, v]) => `${mapping[k] || k}=${encodeURIComponent(v)}`)
            .join('&');
        return request(`/api/virtual-launch?${query}`);
    }

    async function getTrebuchetTypes() {
        return request('/api/trebuchet-types');
    }

    async function simulateTensioning(params = {}) {
        const mapping = {
            targetPreloadAngleDeg: 'target_preload_deg',
            wireDiameterMm: 'wire_mm',
            meanDiameterMm: 'mean_mm',
            activeCoils: 'coils',
            materialId: 'material',
            tensioningStages: 'stages',
            stageHoldTimeSec: 'hold_sec',
            overpullDeg: 'overpull_deg'
        };
        const query = Object.entries(params)
            .map(([k, v]) => `${mapping[k] || k}=${encodeURIComponent(v)}`)
            .join('&');
        return request(`/api/preload-tensioning?${query}`);
    }

    return {
        setBaseUrl,
        health,
        predictRange,
        springEnergy,
        getSensorData,
        getAlerts,
        getMachineStatus,
        getMaterials,
        compareMaterials,
        compareTrebuchets,
        analyzePreload,
        virtualLaunch,
        getTrebuchetTypes,
        simulateTensioning
    };
})();
