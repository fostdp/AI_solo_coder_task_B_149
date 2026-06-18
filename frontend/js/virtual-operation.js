const VirtualOperation = (function () {
    const PI = Math.PI;
    const GRAVITY = 9.80665;
    const AIR_DENSITY = 1.225;
    const FIRING_DURATION = 0.3;
    const LANDED_DURATION = 2.0;
    const MAX_TRAJECTORY_POINTS = 300;
    const ARM_LENGTH = 4.0;
    const ARM_SHORT_RATIO = 0.25;
    const ARM_LONG_RATIO = 0.75;
    const HINGE_HEIGHT = 1.5;
    const DEBOUNCE_DELAY = 100;

    let canvas, ctx, sceneWrap;
    let canvasWidth = 0, canvasHeight = 0;
    let lastFrameTime = 0;
    let animationId = null;
    let debounceTimer = null;
    let fireCount = 0;

    const sceneState = {
        armAngleRad: -PI / 5,
        isFiring: false,
        phase: 'idle',
        projectileX: 0,
        projectileY: 0,
        projectileVX: 0,
        projectileVY: 0,
        animationT: 0,
        trajectoryHistory: [],
        fireCount: 0,
        landedTimer: 0,
        armStartAngle: -PI / 5,
        armFireAngle: PI / 4,
        releaseVelocity: 0,
        launchAngleDeg: 45,
        impactX: 0,
        impactY: 0,
        explosionT: 0
    };

    const domRefs = {};

    function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    function drawRoundedRect(ctx, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    function degToRad(deg) {
        return deg * PI / 180.0;
    }

    function radToDeg(rad) {
        return rad * 180.0 / PI;
    }

    function readParams() {
        return {
            torsionAngleDeg: parseFloat(domRefs.torsion.value) || 0,
            preloadAngleDeg: parseFloat(domRefs.preload.value) || 0,
            massKg: parseFloat(domRefs.mass.value) || 10,
            launchAngleDeg: parseFloat(domRefs.angle.value) || 45,
            materialId: domRefs.material.value || 'steel65mn',
            wireDiameterMm: parseFloat(domRefs.wire.value) || 20,
            meanDiameterMm: parseFloat(domRefs.mean.value) || 150,
            activeCoils: parseInt(domRefs.coils.value) || 12
        };
    }

    function updateGauges() {
        try {
            const params = readParams();
            const material = TrebuchetPhysics.MATERIALS[params.materialId] || TrebuchetPhysics.MATERIALS.steel65mn;
            const config = {
                material: material,
                wireDiameter: params.wireDiameterMm / 1000,
                coilMeanDiameter: params.meanDiameterMm / 1000,
                activeCoils: params.activeCoils,
                cyclicState: TrebuchetPhysics.createCyclicState(material)
            };

            const torsionAngleRad = degToRad(params.torsionAngleDeg);
            const preloadAngleRad = degToRad(params.preloadAngleDeg);
            const spring = TrebuchetPhysics.calculateSpringEnergyWithPreload(
                config, torsionAngleRad, preloadAngleRad
            );

            const mass = Math.max(params.massKg, 1e-9);
            const v = Math.sqrt(2 * spring.storedEnergy * spring.efficiency / mass);

            const projectile = {
                mass: params.massKg,
                diameter: 0.2,
                crossSectionArea: PI * 0.1 * 0.1,
                dragCoefficientIncompressible: 0.47
            };

            const traj = TrebuchetPhysics.predictTrajectoryRange(
                projectile, v, params.launchAngleDeg
            );

            domRefs.energy.textContent = (spring.storedEnergy / 1000).toFixed(2);
            domRefs.eff.textContent = (spring.efficiency * 100).toFixed(1);
            domRefs.vel.textContent = v.toFixed(2);
            domRefs.range.textContent = traj.predictedRange.toFixed(2);
            domRefs.hudVel.textContent = v.toFixed(1);
            domRefs.hudRange.textContent = traj.predictedRange.toFixed(0);
        } catch (e) {
            console.warn('[VirtualOperation] updateGauges error:', e);
        }
    }

    function scheduleGaugeUpdate() {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(updateGauges, DEBOUNCE_DELAY);
    }

    function virtualLaunch() {
        const params = readParams();
        const result = TrebuchetPhysics.virtualLaunch(params);
        return {
            ...result,
            params: params
        };
    }

    function setReadinessClass(className) {
        const el = domRefs.readiness;
        el.classList.remove('ready', 'firing', 'complete');
        el.classList.add(className);
    }

    function setStatusText(text, color) {
        domRefs.status.textContent = text;
        if (color) {
            domRefs.status.style.color = color;
        } else {
            domRefs.status.style.color = '';
        }
    }

    function fireLaunch() {
        if (sceneState.phase !== 'idle') return;

        try {
            const launchResult = virtualLaunch();
            const params = launchResult.params;

            sceneState.isFiring = true;
            sceneState.phase = 'firing';
            sceneState.animationT = 0;
            sceneState.trajectoryHistory = [];
            sceneState.releaseVelocity = launchResult.releaseVelocity;
            sceneState.launchAngleDeg = params.launchAngleDeg;

            const totalTorsionRad = degToRad(params.torsionAngleDeg + params.preloadAngleDeg);
            sceneState.armStartAngle = -PI / 5 - Math.min(totalTorsionRad * 0.3, PI / 3);
            sceneState.armFireAngle = degToRad(params.launchAngleDeg) - PI / 2;
            sceneState.armAngleRad = sceneState.armStartAngle;

            const armEnd = getArmEndpoint(sceneState.armStartAngle);
            sceneState.projectileX = armEnd.x;
            sceneState.projectileY = armEnd.y;

            fireCount++;
            sceneState.fireCount = fireCount;
            domRefs.fired.textContent = fireCount.toString();

            setReadinessClass('firing');
            setStatusText('发射中...', '#ffb347');
        } catch (e) {
            console.warn('[VirtualOperation] fireLaunch error:', e);
            setStatusText('发射失败', '#ff6b6b');
            sceneState.phase = 'idle';
            sceneState.isFiring = false;
        }
    }

    function resetScene() {
        sceneState.armAngleRad = -PI / 5;
        sceneState.isFiring = false;
        sceneState.phase = 'idle';
        sceneState.projectileX = 0;
        sceneState.projectileY = 0;
        sceneState.projectileVX = 0;
        sceneState.projectileVY = 0;
        sceneState.animationT = 0;
        sceneState.trajectoryHistory = [];
        sceneState.landedTimer = 0;
        sceneState.explosionT = 0;

        setReadinessClass('ready');
        setStatusText('待命中', '#c9ff9e');
    }

    function getArmEndpoint(angleRad) {
        const armLong = ARM_LENGTH * ARM_LONG_RATIO;
        return {
            x: Math.cos(angleRad) * armLong,
            y: HINGE_HEIGHT + Math.sin(angleRad) * armLong
        };
    }

    function updateFiringPhase(dt) {
        sceneState.animationT += dt / FIRING_DURATION;
        const t = Math.min(1, Math.max(0, sceneState.animationT));
        const easedT = easeOutCubic(t);

        sceneState.armAngleRad = sceneState.armStartAngle +
            (sceneState.armFireAngle - sceneState.armStartAngle) * easedT;

        const armEnd = getArmEndpoint(sceneState.armAngleRad);
        sceneState.projectileX = armEnd.x;
        sceneState.projectileY = armEnd.y;

        if (t >= 1) {
            sceneState.phase = 'releasing';
            sceneState.animationT = 0;

            const launchRad = degToRad(sceneState.launchAngleDeg);
            const v = sceneState.releaseVelocity;
            sceneState.projectileVX = v * Math.cos(launchRad);
            sceneState.projectileVY = v * Math.sin(launchRad);

            sceneState.trajectoryHistory.push({
                x: sceneState.projectileX,
                y: sceneState.projectileY
            });
        }
    }

    function updateReleasingPhase(dt) {
        const diameter = 0.2;
        const Cd0 = 0.47;
        const A = PI * 0.1 * 0.1;
        const m = readParams().massKg;
        const mu = TrebuchetPhysics.calculateViscosity(288.15);

        const subSteps = 4;
        const subDt = dt / subSteps;

        for (let i = 0; i < subSteps; i++) {
            const vMag = Math.sqrt(
                sceneState.projectileVX * sceneState.projectileVX +
                sceneState.projectileVY * sceneState.projectileVY
            );
            const mach = vMag > 0 ? TrebuchetPhysics.calculateMachNumber(vMag, 288.15) : 0;
            const Re = vMag > 0 ? AIR_DENSITY * vMag * diameter / mu : 0;
            const Cd = TrebuchetPhysics.calculateCompressibleDragCoefficient(mach, Cd0, Re);
            const drag = 0.5 * AIR_DENSITY * Cd * A / Math.max(m, 1e-9);

            sceneState.projectileVX += -drag * vMag * sceneState.projectileVX * subDt;
            sceneState.projectileVY += (-GRAVITY - drag * vMag * sceneState.projectileVY) * subDt;
            sceneState.projectileX += sceneState.projectileVX * subDt;
            sceneState.projectileY += sceneState.projectileVY * subDt;
        }

        const lastPt = sceneState.trajectoryHistory[sceneState.trajectoryHistory.length - 1];
        if (!lastPt ||
            Math.abs(lastPt.x - sceneState.projectileX) > 0.05 ||
            Math.abs(lastPt.y - sceneState.projectileY) > 0.05) {
            sceneState.trajectoryHistory.push({
                x: sceneState.projectileX,
                y: sceneState.projectileY
            });
            if (sceneState.trajectoryHistory.length > MAX_TRAJECTORY_POINTS) {
                sceneState.trajectoryHistory.shift();
            }
        }

        if (sceneState.projectileY <= 0) {
            sceneState.projectileY = 0;
            sceneState.impactX = sceneState.projectileX;
            sceneState.impactY = 0;
            sceneState.phase = 'landed';
            sceneState.landedTimer = 0;
            sceneState.explosionT = 0;
            setReadinessClass('complete');
            setStatusText('命中! 射程 ' + sceneState.impactX.toFixed(1) + ' m', '#ff6b6b');
        }
    }

    function updateLandedPhase(dt) {
        sceneState.landedTimer += dt;
        sceneState.explosionT = Math.min(1, sceneState.explosionT + dt * 2.5);

        if (sceneState.landedTimer >= LANDED_DURATION) {
            resetScene();
        }
    }

    function updateScene(dt) {
        switch (sceneState.phase) {
            case 'firing':
                updateFiringPhase(dt);
                break;
            case 'releasing':
                updateReleasingPhase(dt);
                break;
            case 'landed':
                updateLandedPhase(dt);
                break;
            case 'idle':
            default:
                const idleAngle = -PI / 5;
                const targetAngle = idleAngle;
                sceneState.armAngleRad += (targetAngle - sceneState.armAngleRad) * Math.min(1, dt * 5);
                if (sceneState.armAngleRad !== targetAngle) {
                    const armEnd = getArmEndpoint(sceneState.armAngleRad);
                    sceneState.projectileX = armEnd.x;
                    sceneState.projectileY = armEnd.y;
                }
                break;
        }
    }

    function drawBackground(ctx, W, H) {
        const skyGradient = ctx.createLinearGradient(0, 0, 0, H * 0.85);
        skyGradient.addColorStop(0, '#0a1628');
        skyGradient.addColorStop(0.5, '#1a3458');
        skyGradient.addColorStop(0.85, '#d4845a');
        skyGradient.addColorStop(1, '#f0c090');
        ctx.fillStyle = skyGradient;
        ctx.fillRect(0, 0, W, H);

        drawClouds(ctx, W, H);
        drawMountains(ctx, W, H);
        drawWindFlag(ctx, W, H);
    }

    function drawClouds(ctx, W, H) {
        const clouds = [
            { x: W * 0.15, y: H * 0.15, scale: 1.0 },
            { x: W * 0.45, y: H * 0.08, scale: 0.8 },
            { x: W * 0.75, y: H * 0.2, scale: 1.2 },
            { x: W * 0.9, y: H * 0.12, scale: 0.6 }
        ];

        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        clouds.forEach(c => {
            ctx.beginPath();
            const r = 25 * c.scale;
            ctx.ellipse(c.x, c.y, r * 2, r * 0.7, 0, 0, PI * 2);
            ctx.ellipse(c.x + r * 1.2, c.y + r * 0.1, r * 1.5, r * 0.6, 0, 0, PI * 2);
            ctx.ellipse(c.x - r * 1.2, c.y + r * 0.1, r * 1.3, r * 0.55, 0, 0, PI * 2);
            ctx.fill();
        });
    }

    function drawMountains(ctx, W, H) {
        const groundY = H * 0.85;

        ctx.fillStyle = '#2a3a52';
        ctx.beginPath();
        ctx.moveTo(0, groundY);
        ctx.lineTo(0, groundY - 40);
        ctx.lineTo(W * 0.12, groundY - 90);
        ctx.lineTo(W * 0.22, groundY - 55);
        ctx.lineTo(W * 0.35, groundY - 120);
        ctx.lineTo(W * 0.48, groundY - 70);
        ctx.lineTo(W * 0.6, groundY - 100);
        ctx.lineTo(W * 0.75, groundY - 60);
        ctx.lineTo(W * 0.88, groundY - 85);
        ctx.lineTo(W, groundY - 45);
        ctx.lineTo(W, groundY);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#1e2c42';
        ctx.beginPath();
        ctx.moveTo(0, groundY);
        ctx.lineTo(0, groundY - 20);
        ctx.lineTo(W * 0.08, groundY - 50);
        ctx.lineTo(W * 0.18, groundY - 30);
        ctx.lineTo(W * 0.3, groundY - 65);
        ctx.lineTo(W * 0.42, groundY - 40);
        ctx.lineTo(W * 0.55, groundY - 55);
        ctx.lineTo(W * 0.68, groundY - 35);
        ctx.lineTo(W * 0.82, groundY - 50);
        ctx.lineTo(W, groundY - 25);
        ctx.lineTo(W, groundY);
        ctx.closePath();
        ctx.fill();
    }

    function drawWindFlag(ctx, W, H) {
        const poleX = W - 60;
        const poleY = 50;
        const poleH = 80;

        ctx.strokeStyle = '#5a4a3a';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(poleX, poleY);
        ctx.lineTo(poleX, poleY + poleH);
        ctx.stroke();

        ctx.fillStyle = '#c9ff9e';
        ctx.beginPath();
        ctx.moveTo(poleX, poleY + 5);
        ctx.quadraticCurveTo(poleX + 25, poleY + 10, poleX + 40, poleY + 15);
        ctx.quadraticCurveTo(poleX + 25, poleY + 25, poleX, poleY + 30);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '10px sans-serif';
        ctx.fillText('→ 风', poleX - 8, poleY + poleH + 15);
    }

    function drawGround(ctx, W, H, scale) {
        const groundY = H * 0.85;

        const grassGradient = ctx.createLinearGradient(0, groundY, 0, H);
        grassGradient.addColorStop(0, '#3d6b2a');
        grassGradient.addColorStop(0.3, '#2d5520');
        grassGradient.addColorStop(1, '#1a3a12');
        ctx.fillStyle = grassGradient;
        ctx.fillRect(0, groundY, W, H - groundY);

        ctx.strokeStyle = 'rgba(60, 100, 40, 0.4)';
        ctx.lineWidth = 1;
        for (let i = 0; i < W; i += 15) {
            const h = 3 + Math.random() * 5;
            ctx.beginPath();
            ctx.moveTo(i, groundY);
            ctx.lineTo(i + 2, groundY - h);
            ctx.stroke();
        }

        const dirtGradient = ctx.createLinearGradient(0, groundY - 2, 0, groundY + 8);
        dirtGradient.addColorStop(0, '#5a4530');
        dirtGradient.addColorStop(1, '#3a2a1a');
        ctx.fillStyle = dirtGradient;
        ctx.fillRect(0, groundY - 1, W, 8);

        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, groundY);
        ctx.lineTo(W, groundY);
        ctx.stroke();

        ctx.save();
        ctx.translate(W / 2, groundY);
        ctx.scale(1, -1);

        ctx.strokeStyle = 'rgba(255, 179, 71, 0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        for (let d = 10; d <= 200; d += 10) {
            const x1 = d * scale;
            ctx.beginPath();
            ctx.moveTo(x1, 0);
            ctx.lineTo(x1, 2);
            ctx.stroke();
            if (d % 50 === 0) {
                ctx.save();
                ctx.scale(1, -1);
                ctx.fillStyle = 'rgba(255, 179, 71, 0.5)';
                ctx.font = '9px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(d + 'm', x1, 14);
                ctx.restore();
            }
        }
        ctx.setLineDash([]);
        ctx.restore();
    }

    function drawTrebuchetStructure(ctx, W, H, scale) {
        const cx = W / 2;
        const cy = H * 0.85;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, -scale);

        const baseWidth = 2.8;
        const baseDepth = 0.3;
        const legHeight = 0.6;

        ctx.fillStyle = '#4a3520';
        ctx.strokeStyle = '#2a1a0a';
        ctx.lineWidth = 2 / scale;

        ctx.beginPath();
        ctx.moveTo(-baseWidth / 2, 0);
        ctx.lineTo(-baseWidth / 2, legHeight);
        ctx.lineTo(-baseWidth / 2 + baseDepth, legHeight + 0.05);
        ctx.lineTo(-baseWidth / 2 + baseDepth, 0.05);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(baseWidth / 2, 0);
        ctx.lineTo(baseWidth / 2, legHeight);
        ctx.lineTo(baseWidth / 2 - baseDepth, legHeight + 0.05);
        ctx.lineTo(baseWidth / 2 - baseDepth, 0.05);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        const beamY = legHeight + 0.05;
        const beamH = 0.15;
        ctx.fillStyle = '#5a4028';
        ctx.fillRect(-baseWidth / 2, beamY, baseWidth, beamH);
        ctx.strokeRect(-baseWidth / 2, beamY, baseWidth, beamH);

        const axleBaseY = beamY + beamH;
        const spread = 0.6;
        const topSpread = 0.08;

        ctx.strokeStyle = '#3a2818';
        ctx.lineWidth = 0.15;
        ctx.lineCap = 'round';

        ctx.beginPath();
        ctx.moveTo(-spread, axleBaseY);
        ctx.lineTo(-topSpread, HINGE_HEIGHT + 0.1);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(spread, axleBaseY);
        ctx.lineTo(topSpread, HINGE_HEIGHT + 0.1);
        ctx.stroke();

        ctx.lineWidth = 0.1;
        ctx.beginPath();
        ctx.moveTo(-spread * 0.7, axleBaseY + (HINGE_HEIGHT + 0.1 - axleBaseY) * 0.5);
        ctx.lineTo(spread * 0.7, axleBaseY + (HINGE_HEIGHT + 0.1 - axleBaseY) * 0.5);
        ctx.stroke();

        ctx.fillStyle = '#8a6a4a';
        ctx.beginPath();
        ctx.arc(0, HINGE_HEIGHT, 0.12, 0, PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#4a3020';
        ctx.lineWidth = 0.03;
        ctx.stroke();

        ctx.fillStyle = '#6a5030';
        ctx.beginPath();
        ctx.arc(0, HINGE_HEIGHT, 0.06, 0, PI * 2);
        ctx.fill();

        ctx.restore();
    }

    function drawArm(ctx, W, H, scale, angleRad) {
        const cx = W / 2;
        const cy = H * 0.85;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, -scale);
        ctx.translate(0, HINGE_HEIGHT);
        ctx.rotate(angleRad);

        const armLong = ARM_LENGTH * ARM_LONG_RATIO;
        const armShort = ARM_LENGTH * ARM_SHORT_RATIO;

        ctx.fillStyle = '#c4a068';
        ctx.strokeStyle = '#6a4020';
        ctx.lineWidth = 2 / scale;

        drawRoundedRect(ctx, -armShort, -0.08, ARM_LENGTH, 0.16, 0.03);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = 'rgba(100, 70, 30, 0.3)';
        ctx.lineWidth = 1 / scale;
        for (let i = -armShort + 0.2; i < armLong - 0.1; i += 0.3) {
            ctx.beginPath();
            ctx.moveTo(i, -0.05);
            ctx.lineTo(i + 0.15, 0.05);
            ctx.stroke();
        }

        ctx.fillStyle = '#1a1a1a';
        ctx.strokeStyle = '#0a0a0a';
        ctx.lineWidth = 2 / scale;
        const cwW = 0.5, cwH = 0.45;
        ctx.fillRect(-armShort - cwW - 0.02, -cwH / 2, cwW, cwH);
        ctx.strokeRect(-armShort - cwW - 0.02, -cwH / 2, cwW, cwH);

        ctx.fillStyle = '#333';
        ctx.fillRect(-armShort - cwW + 0.05, -cwH / 2 + 0.05, cwW - 0.1, 0.08);
        ctx.fillRect(-armShort - cwW + 0.05, -0.04, cwW - 0.1, 0.08);
        ctx.fillRect(-armShort - cwW + 0.05, cwH / 2 - 0.13, cwW - 0.1, 0.08);

        ctx.fillStyle = '#8a5a28';
        ctx.strokeStyle = '#5a3010';
        ctx.lineWidth = 2 / scale;
        ctx.beginPath();
        ctx.moveTo(armLong - 0.15, -0.25);
        ctx.lineTo(armLong + 0.2, -0.15);
        ctx.lineTo(armLong + 0.2, 0.15);
        ctx.lineTo(armLong - 0.15, 0.25);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();
    }

    function drawSpring(ctx, W, H, scale, torsionDeg) {
        const cx = W / 2;
        const cy = H * 0.85;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, -scale);

        const baseAnchorX = -0.8;
        const baseAnchorY = 0.7;
        const armAnchorAngle = sceneState.armAngleRad;
        const armLong = ARM_LENGTH * ARM_LONG_RATIO;

        const springAnchorArmX = Math.cos(armAnchorAngle) * (armLong * 0.55);
        const springAnchorArmY = HINGE_HEIGHT + Math.sin(armAnchorAngle) * (armLong * 0.55);

        const coils = 10;
        const startX = baseAnchorX;
        const startY = baseAnchorY;
        const endX = springAnchorArmX;
        const endY = springAnchorArmY;

        const dx = endX - startX;
        const dy = endY - startY;
        const len = Math.sqrt(dx * dx + dy * dy);
        const ang = Math.atan2(dy, dx);

        ctx.save();
        ctx.translate(startX, startY);
        ctx.rotate(ang);

        const amplitude = 0.08 + Math.min(torsionDeg / 720, 0.5) * 0.1;
        const segments = coils * 16;

        ctx.strokeStyle = '#7a8a9a';
        ctx.lineWidth = 0.04;
        ctx.lineCap = 'round';
        ctx.beginPath();

        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const x = t * len;
            const y = Math.sin(t * coils * PI * 2) * amplitude;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        ctx.strokeStyle = 'rgba(200, 210, 220, 0.4)';
        ctx.lineWidth = 0.015;
        ctx.stroke();

        ctx.restore();

        ctx.fillStyle = '#5a4020';
        ctx.beginPath();
        ctx.arc(baseAnchorX, baseAnchorY, 0.06, 0, PI * 2);
        ctx.fill();

        ctx.restore();
    }

    function drawProjectile(ctx, W, H, scale) {
        const cx = W / 2;
        const cy = H * 0.85;
        const px = cx + sceneState.projectileX * scale;
        const py = cy - sceneState.projectileY * scale;

        if (sceneState.phase === 'landed') {
            drawExplosion(ctx, W, H, scale);
            return;
        }

        const glowR = 18;
        const glow = ctx.createRadialGradient(px, py, 2, px, py, glowR);
        glow.addColorStop(0, 'rgba(255, 120, 80, 0.8)');
        glow.addColorStop(0.4, 'rgba(255, 80, 50, 0.35)');
        glow.addColorStop(1, 'rgba(255, 50, 30, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(px, py, glowR, 0, PI * 2);
        ctx.fill();

        const ballR = 8;
        const ballGrad = ctx.createRadialGradient(px - 2, py - 2, 1, px, py, ballR);
        ballGrad.addColorStop(0, '#ff8060');
        ballGrad.addColorStop(0.5, '#e04030');
        ballGrad.addColorStop(1, '#801010');
        ctx.fillStyle = ballGrad;
        ctx.beginPath();
        ctx.arc(px, py, ballR, 0, PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 220, 200, 0.6)';
        ctx.beginPath();
        ctx.arc(px - 2, py - 2, 2.5, 0, PI * 2);
        ctx.fill();

        if (sceneState.phase === 'releasing') {
            drawProjectileTrail(ctx, px, py, scale);
        }
    }

    function drawProjectileTrail(ctx, px, py, scale) {
        const vx = sceneState.projectileVX;
        const vy = sceneState.projectileVY;
        const speed = Math.sqrt(vx * vx + vy * vy);
        if (speed < 1) return;

        const normX = -vx / speed;
        const normY = vy / speed;
        const trailLen = Math.min(speed * 0.8, 40);

        const trailGrad = ctx.createLinearGradient(
            px, py,
            px + normX * trailLen, py + normY * trailLen
        );
        trailGrad.addColorStop(0, 'rgba(255, 180, 100, 0.8)');
        trailGrad.addColorStop(0.5, 'rgba(255, 120, 60, 0.4)');
        trailGrad.addColorStop(1, 'rgba(255, 80, 40, 0)');

        ctx.strokeStyle = trailGrad;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + normX * trailLen, py + normY * trailLen);
        ctx.stroke();
    }

    function drawExplosion(ctx, W, H, scale) {
        const cx = W / 2;
        const cy = H * 0.85;
        const ex = cx + sceneState.impactX * scale;
        const ey = cy - sceneState.impactY * scale;
        const t = sceneState.explosionT;

        const maxR = 45;
        const r = maxR * (0.3 + t * 0.7);
        const alpha = 1 - t * 0.7;

        const outerGlow = ctx.createRadialGradient(ex, ey, 0, ex, ey, r * 1.8);
        outerGlow.addColorStop(0, `rgba(255, 220, 100, ${alpha * 0.7})`);
        outerGlow.addColorStop(0.4, `rgba(255, 150, 60, ${alpha * 0.4})`);
        outerGlow.addColorStop(1, `rgba(255, 80, 40, 0)`);
        ctx.fillStyle = outerGlow;
        ctx.beginPath();
        ctx.arc(ex, ey, r * 1.8, 0, PI * 2);
        ctx.fill();

        const mainExp = ctx.createRadialGradient(ex, ey, 2, ex, ey, r);
        mainExp.addColorStop(0, `rgba(255, 255, 220, ${alpha})`);
        mainExp.addColorStop(0.2, `rgba(255, 220, 100, ${alpha * 0.9})`);
        mainExp.addColorStop(0.5, `rgba(255, 140, 50, ${alpha * 0.7})`);
        mainExp.addColorStop(1, `rgba(200, 60, 30, 0)`);
        ctx.fillStyle = mainExp;
        ctx.beginPath();
        ctx.arc(ex, ey, r, 0, PI * 2);
        ctx.fill();

        const particleCount = 12;
        const particleR = r * 0.8;
        for (let i = 0; i < particleCount; i++) {
            const ang = (i / particleCount) * PI * 2 + t * 0.5;
            const dist = particleR * (0.5 + (i % 3) * 0.25);
            const ppx = ex + Math.cos(ang) * dist;
            const ppy = ey + Math.sin(ang) * dist;
            const pr = (3 + (i % 4)) * (1 - t * 0.5);

            ctx.fillStyle = `rgba(255, ${140 + (i % 3) * 40}, ${60 + i * 10}, ${alpha * 0.8})`;
            ctx.beginPath();
            ctx.arc(ppx, ppy, pr, 0, PI * 2);
            ctx.fill();
        }

        const dustR = r * 1.2;
        ctx.fillStyle = `rgba(100, 80, 60, ${alpha * 0.35 * (1 - t * 0.3)})`;
        ctx.beginPath();
        ctx.ellipse(ex, ey + 3, dustR, dustR * 0.35, 0, 0, PI * 2);
        ctx.fill();
    }

    function drawTrajectory(ctx, W, H, scale) {
        if (sceneState.trajectoryHistory.length < 2) return;
        if (sceneState.phase !== 'releasing' && sceneState.phase !== 'landed') return;

        const cx = W / 2;
        const cy = H * 0.85;
        const pts = sceneState.trajectoryHistory;

        for (let i = 1; i < pts.length; i++) {
            const t = i / pts.length;
            const p0 = pts[i - 1];
            const p1 = pts[i];

            const x0 = cx + p0.x * scale;
            const y0 = cy - p0.y * scale;
            const x1 = cx + p1.x * scale;
            const y1 = cy - p1.y * scale;

            const r = Math.floor(255);
            const g = Math.floor(120 + (1 - t) * 80);
            const b = Math.floor(40 + (1 - t) * 40);
            const a = 0.3 + t * 0.6;

            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
            ctx.lineWidth = 2 + t * 2;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
        }
    }

    function drawHUDMarks(ctx, W, H) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 179, 71, 0.15)';
        ctx.lineWidth = 1;

        ctx.beginPath();
        ctx.moveTo(12, 12);
        ctx.lineTo(12, 45);
        ctx.moveTo(12, 12);
        ctx.lineTo(45, 12);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(W - 12, 12);
        ctx.lineTo(W - 12, 45);
        ctx.moveTo(W - 12, 12);
        ctx.lineTo(W - 45, 12);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(12, H - 12);
        ctx.lineTo(12, H - 45);
        ctx.moveTo(12, H - 12);
        ctx.lineTo(45, H - 12);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(W - 12, H - 12);
        ctx.lineTo(W - 12, H - 45);
        ctx.moveTo(W - 12, H - 12);
        ctx.lineTo(W - 45, H - 12);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 179, 71, 0.25)';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText('VIRTUAL-CANVAS v1.0', W - 16, H - 16);
        ctx.restore();
    }

    function drawTrebuchet(ctx, W, H) {
        try {
            ctx.save();

            drawBackground(ctx, W, H);

            const refMeters = 100;
            const availW = W * 0.9;
            const availH = H * 0.65;
            const scaleW = availW / refMeters;
            const scaleH = availH / 50;
            const scale = Math.min(scaleW, scaleH);

            drawGround(ctx, W, H, scale);
            drawTrajectory(ctx, W, H, scale);
            drawTrebuchetStructure(ctx, W, H, scale);

            const params = readParams();
            drawSpring(ctx, W, H, scale, params.torsionAngleDeg + params.preloadAngleDeg);

            drawArm(ctx, W, H, scale, sceneState.armAngleRad);
            drawProjectile(ctx, W, H, scale);

            drawHUDMarks(ctx, W, H);

            ctx.restore();
        } catch (e) {
            console.warn('[VirtualOperation] drawTrebuchet error:', e);
            drawFallback(ctx, W, H);
        }
    }

    function drawFallback(ctx, W, H) {
        ctx.fillStyle = '#0a1628';
        ctx.fillRect(0, 0, W, H);

        ctx.fillStyle = '#ffb347';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('⚠ 渲染异常，已回退显示', W / 2, H / 2 - 10);

        ctx.fillStyle = '#c9ff9e';
        ctx.font = '12px sans-serif';
        ctx.fillText('请刷新页面恢复渲染', W / 2, H / 2 + 15);
    }

    function resizeCanvas() {
        if (!canvas || !sceneWrap) return;

        const rect = sceneWrap.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        canvasWidth = rect.width;
        canvasHeight = rect.height;

        canvas.width = canvasWidth * dpr;
        canvas.height = canvasHeight * dpr;
        canvas.style.width = canvasWidth + 'px';
        canvas.style.height = canvasHeight + 'px';

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function renderLoop(timestamp) {
        if (!ctx) return;

        const dt = lastFrameTime ? Math.min((timestamp - lastFrameTime) / 1000, 0.05) : 0.016;
        lastFrameTime = timestamp;

        try {
            updateScene(dt);
        } catch (e) {
            console.warn('[VirtualOperation] updateScene error:', e);
        }

        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        drawTrebuchet(ctx, canvasWidth, canvasHeight);

        animationId = requestAnimationFrame(renderLoop);
    }

    function cacheDomRefs() {
        domRefs.canvas = document.getElementById('virt-canvas');
        domRefs.sceneWrap = document.getElementById('virt-scene-wrap');
        domRefs.material = document.getElementById('virt-material');
        domRefs.preload = document.getElementById('virt-preload');
        domRefs.preloadValue = document.getElementById('virt-preload-value');
        domRefs.torsion = document.getElementById('virt-torsion');
        domRefs.torsionValue = document.getElementById('virt-torsion-value');
        domRefs.angle = document.getElementById('virt-angle');
        domRefs.angleValue = document.getElementById('virt-angle-value');
        domRefs.mass = document.getElementById('virt-mass');
        domRefs.wire = document.getElementById('virt-wire');
        domRefs.mean = document.getElementById('virt-mean');
        domRefs.coils = document.getElementById('virt-coils');
        domRefs.fire = document.getElementById('virt-fire');
        domRefs.reset = document.getElementById('virt-reset');
        domRefs.energy = document.getElementById('virt-energy');
        domRefs.eff = document.getElementById('virt-eff');
        domRefs.vel = document.getElementById('virt-vel');
        domRefs.range = document.getElementById('virt-range');
        domRefs.hudVel = document.getElementById('virt-hud-vel');
        domRefs.hudRange = document.getElementById('virt-hud-range');
        domRefs.status = document.getElementById('virt-status');
        domRefs.readiness = document.getElementById('virt-readiness');
        domRefs.fired = document.getElementById('virt-fired');
    }

    function bindInputEvents() {
        const sliderUpdate = (slider, valueEl, suffix) => () => {
            if (valueEl) valueEl.textContent = slider.value + suffix;
            scheduleGaugeUpdate();
        };

        domRefs.preload.addEventListener('input', sliderUpdate(domRefs.preload, domRefs.preloadValue, '°'));
        domRefs.torsion.addEventListener('input', sliderUpdate(domRefs.torsion, domRefs.torsionValue, '°'));
        domRefs.angle.addEventListener('input', sliderUpdate(domRefs.angle, domRefs.angleValue, '°'));

        domRefs.material.addEventListener('change', scheduleGaugeUpdate);
        domRefs.mass.addEventListener('input', scheduleGaugeUpdate);
        domRefs.wire.addEventListener('input', scheduleGaugeUpdate);
        domRefs.mean.addEventListener('input', scheduleGaugeUpdate);
        domRefs.coils.addEventListener('input', scheduleGaugeUpdate);

        domRefs.fire.addEventListener('click', fireLaunch);
        domRefs.reset.addEventListener('click', resetScene);

        window.addEventListener('resize', () => {
            resizeCanvas();
        });
    }

    function initValues() {
        if (domRefs.preload && domRefs.preloadValue) {
            domRefs.preloadValue.textContent = domRefs.preload.value + '°';
        }
        if (domRefs.torsion && domRefs.torsionValue) {
            domRefs.torsionValue.textContent = domRefs.torsion.value + '°';
        }
        if (domRefs.angle && domRefs.angleValue) {
            domRefs.angleValue.textContent = domRefs.angle.value + '°';
        }

        resetScene();
        updateGauges();

        const armEnd = getArmEndpoint(sceneState.armAngleRad);
        sceneState.projectileX = armEnd.x;
        sceneState.projectileY = armEnd.y;
    }

    function init() {
        try {
            cacheDomRefs();

            canvas = domRefs.canvas;
            sceneWrap = domRefs.sceneWrap;

            if (!canvas || !sceneWrap) {
                console.warn('[VirtualOperation] required DOM elements not found');
                return;
            }

            ctx = canvas.getContext('2d');
            if (!ctx) {
                console.warn('[VirtualOperation] Canvas 2D context not available');
                return;
            }

            resizeCanvas();
            bindInputEvents();
            initValues();

            lastFrameTime = 0;
            animationId = requestAnimationFrame(renderLoop);

            console.log('[VirtualOperation] initialized successfully');
        } catch (e) {
            console.error('[VirtualOperation] init failed:', e);
        }
    }

    return {
        init
    };
})();
