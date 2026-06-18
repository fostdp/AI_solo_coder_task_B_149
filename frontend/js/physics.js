const TrebuchetPhysics = (function () {
    const GRAVITY = 9.80665;
    const AIR_DENSITY = 1.225;
    const SPEED_OF_SOUND = 343.2;
    const SUTHERLAND_T0 = 273.15;
    const SUTHERLAND_MU0 = 1.716e-5;
    const SUTHERLAND_S = 110.4;
    const GAMMA = 1.4;

    const MATERIALS = {
        steel65mn: {
            shearModulus: 79.3e9,
            yieldStrength: 785e6,
            density: 7850,
            fatigueDuctilityCoeff: 0.42,
            fatigueDuctilityExp: -0.58,
            cyclicStrengthCoeff: 1300e6,
            cyclicStrengthExp: -0.10,
            name: "65Mn弹簧钢"
        },
        steel50crva: {
            shearModulus: 78.5e9,
            yieldStrength: 1080e6,
            density: 7800,
            fatigueDuctilityCoeff: 0.38,
            fatigueDuctilityExp: -0.55,
            cyclicStrengthCoeff: 1650e6,
            cyclicStrengthExp: -0.08,
            name: "50CrVA弹簧钢"
        }
    };

    function createCyclicState(material) {
        return {
            cycleCount: 0,
            accumulatedPlasticStrain: 0,
            degradedShearModulus: material.shearModulus,
            degradedYieldStrength: material.yieldStrength,
            backStress: 0,
            kinematicHardening: material.yieldStrength * 0.05,
            currentDamageParameter: 0
        };
    }

    function degToRad(deg) { return deg * Math.PI / 180.0; }
    function radToDeg(rad) { return rad * 180.0 / Math.PI; }

    function calculateViscosity(temperatureK) {
        return SUTHERLAND_MU0 * Math.pow(temperatureK / SUTHERLAND_T0, 1.5)
            * (SUTHERLAND_T0 + SUTHERLAND_S) / (temperatureK + SUTHERLAND_S);
    }

    function calculateMachNumber(velocity, temperatureK = 288.15) {
        const R = 287.058;
        const c = Math.sqrt(GAMMA * R * temperatureK);
        return velocity / c;
    }

    function calculatePrandtlGlauertCorrection(mach) {
        if (mach >= 1.0) mach = 0.999;
        const beta = Math.sqrt(1.0 - mach * mach);
        const karmanTsien = 1.0 / beta
            + (mach * mach) / (2.0 * beta * beta * beta)
            * (1.0 + (GAMMA - 1.0) / 2.0 * beta * beta);
        return Math.min(karmanTsien, 1.0 / beta * 1.5);
    }

    function smoothstep(t) { return t * t * (3 - 2 * t); }

    function calculateTransonicWaveDrag(mach) {
        const mcrit = 0.75;
        if (mach <= mcrit) return 0.0;
        if (mach > 1.2) {
            const t = Math.min(1, (mach - 1.2) / 0.3);
            return 0.35 * (1.0 - smoothstep(t));
        }
        const t = Math.min(1, (mach - mcrit) / (1.05 - mcrit));
        return 0.35 * smoothstep(t);
    }

    function calculateSupersonicNewtonianDrag(mach) {
        if (mach <= 1.0) return 0.0;
        const beta = Math.sqrt(mach * mach - 1.0);
        const cdNewtonian = 2.0 / (GAMMA * mach * mach)
            * (1.0 + 0.5 * GAMMA * beta * beta);
        const cdCone = 0.7;
        const blend = Math.min(1, (mach - 1.2) / 1.5);
        return cdCone * (1.0 - blend) + cdNewtonian * blend;
    }

    function calculateCompressibleDragCoefficient(mach, incompressibleCd, reynoldsNumber = 1e6) {
        if (mach < 0) mach = 0;
        let cdViscous = incompressibleCd;
        if (reynoldsNumber > 0 && reynoldsNumber < 5e5) {
            cdViscous *= 1.0 + 0.3 * Math.exp(-reynoldsNumber / 1e5);
        }
        if (mach < 0.3) return cdViscous;
        if (mach < 0.8) {
            const pg = calculatePrandtlGlauertCorrection(mach);
            return cdViscous * Math.min(pg, 2.5);
        }
        if (mach <= 1.2) {
            const pg = calculatePrandtlGlauertCorrection(Math.min(mach, 0.79));
            const cdSub = cdViscous * Math.min(pg, 2.5);
            const cdWave = calculateTransonicWaveDrag(mach);
            const reFactor = mach > 0.95 ? 1.0 + 2.0 * (mach - 0.95) : 1.0;
            return (cdSub + cdWave) * reFactor;
        }
        const cdWaveSuper = calculateSupersonicNewtonianDrag(mach);
        const cdFriction = cdViscous * 1.15 / Math.sqrt(Math.max(1, mach));
        return cdFriction + cdWaveSuper;
    }

    function calculateCoffinMansonLife(material, plasticStrainAmp) {
        if (plasticStrainAmp <= 0) return 1e12;
        const NfElastic = Math.pow(
            material.cyclicStrengthCoeff
            / (material.shearModulus * plasticStrainAmp * Math.sqrt(3)),
            1.0 / material.cyclicStrengthExp
        );
        const NfPlastic = Math.pow(
            plasticStrainAmp / material.fatigueDuctilityCoeff,
            1.0 / material.fatigueDuctilityExp
        );
        return 1.0 / (1.0 / Math.max(NfElastic, 1) + 1.0 / Math.max(NfPlastic, 1));
    }

    function updateCyclicSoftening(config, torsionAngleRad, shearStressAmp) {
        const mat = config.material;
        const state = config.cyclicState;
        state.cycleCount++;

        const tauY = state.degradedYieldStrength;
        const tauEff = Math.abs(shearStressAmp - state.backStress);
        let plasticInc = 0;

        if (tauEff > tauY) {
            const excess = tauEff - tauY;
            const G = state.degradedShearModulus;
            plasticInc = excess / G;
            state.accumulatedPlasticStrain += plasticInc;

            const C1 = 3500, D1 = 120;
            state.backStress += C1 * plasticInc - D1 * state.backStress * Math.abs(plasticInc);

            const Qsat = mat.yieldStrength * 0.15;
            const b = 18;
            const isoInc = Qsat * (1 - Math.exp(-b * plasticInc));
            state.degradedYieldStrength -= isoInc * 0.3;

            const softeningFactor = Math.exp(
                -0.15 * state.accumulatedPlasticStrain / mat.yieldStrength * mat.shearModulus
            );
            state.degradedShearModulus = mat.shearModulus * Math.max(0.55, softeningFactor);
            state.degradedYieldStrength = Math.max(
                mat.yieldStrength * 0.5,
                state.degradedYieldStrength
            );

            if (plasticInc > 1e-10) {
                const Nf = calculateCoffinMansonLife(mat, plasticInc);
                state.currentDamageParameter = Math.min(1, state.currentDamageParameter + 1 / Math.max(Nf, 1));
            }
        }

        if (state.cycleCount % 10 === 0 && state.accumulatedPlasticStrain > 0) {
            const fatigueLife = calculateCoffinMansonLife(
                mat, state.accumulatedPlasticStrain / state.cycleCount
            );
            state.currentDamageParameter = Math.min(
                1, state.cycleCount / Math.max(fatigueLife, 1)
            );
        }
    }

    function calculateSpringConstant(config) {
        const { wireDiameter, coilMeanDiameter, activeCoils } = config;
        const G = config.cyclicState.degradedShearModulus;
        return (G * Math.pow(wireDiameter, 4)) / (32.0 * coilMeanDiameter * activeCoils);
    }

    function calculateShearStress(config, torsionAngleRad) {
        const { wireDiameter: d, coilMeanDiameter: D } = config;
        const K = (4.0 * D - d) / (4.0 * (D - d)) + 0.615 * d / D;
        const k = calculateSpringConstant(config);
        const T = k * torsionAngleRad;
        return K * (16.0 * T) / (Math.PI * Math.pow(d, 3));
    }

    function calculateSpringEfficiency(config, torsionAngleRad) {
        const stress = calculateShearStress(config, torsionAngleRad);
        const yieldRatio = stress / config.cyclicState.degradedYieldStrength;
        const damage = config.cyclicState.currentDamageParameter;
        let efficiency;
        if (yieldRatio < 0.3) efficiency = 0.75 + 0.1 * yieldRatio / 0.3;
        else if (yieldRatio < 0.6) efficiency = 0.85 + 0.08 * (yieldRatio - 0.3) / 0.3;
        else if (yieldRatio < 0.85) efficiency = 0.93 - 0.13 * (yieldRatio - 0.6) / 0.25;
        else efficiency = 0.80 - 0.5 * (yieldRatio - 0.85);
        efficiency *= Math.max(0.5, 1.0 - damage * 0.6);
        return Math.max(0, Math.min(1, efficiency));
    }

    function calculateSpringEnergy(config, torsionAngleRad) {
        if (!config.cyclicState || config.cyclicState.cycleCount === 0) {
            config.cyclicState = createCyclicState(config.material);
        }

        const springConstant = calculateSpringConstant(config);
        const Gcurr = config.cyclicState.degradedShearModulus;
        const Gorg = config.material.shearModulus;
        const modulusReduction = Gcurr / Gorg;

        const stressAmplitude = calculateShearStress(config, torsionAngleRad);
        updateCyclicSoftening(config, torsionAngleRad, stressAmplitude);

        const storedEnergy = 0.5 * springConstant * torsionAngleRad * torsionAngleRad * modulusReduction;
        const efficiency = calculateSpringEfficiency(config, torsionAngleRad);
        const yieldRatio = stressAmplitude / config.material.yieldStrength;
        const damage = config.cyclicState.currentDamageParameter;

        const elasticStress = Math.min(stressAmplitude, config.cyclicState.degradedYieldStrength);
        const tauDiff = Math.max(0, stressAmplitude - config.cyclicState.degradedYieldStrength);
        const plasticStrain = tauDiff / Gcurr;

        let riskLevel = "normal";
        if (yieldRatio > 0.85 || damage > 0.7) riskLevel = "critical";
        else if (yieldRatio > 0.70 || damage > 0.4) riskLevel = "warning";

        return {
            springConstant,
            storedEnergy,
            shearStress: stressAmplitude,
            elasticStress,
            plasticStrain,
            efficiency,
            yieldStrengthRatio: yieldRatio,
            cyclicDamageRatio: damage,
            cycleCount: config.cyclicState.cycleCount,
            fractureRisk: yieldRatio > 0.85,
            fatigueRisk: damage > 0.5,
            riskLevel,
            modulusReduction
        };
    }

    function predictTrajectoryRange(projectile, releaseVelocity, launchAngleDeg,
                                     airFactor = 1.0, temperatureK = 288.15) {
        const theta = degToRad(launchAngleDeg);
        const v0x = releaseVelocity * Math.cos(theta);
        const v0y = releaseVelocity * Math.sin(theta);
        const Cd0 = projectile.dragCoefficientIncompressible || projectile.drag_coefficient || 0.47;
        const A = projectile.crossSectionArea || projectile.cross_section_area || 0.0314;
        const m = projectile.mass;
        const diameter = projectile.diameter || 0.2;
        const mu = calculateViscosity(temperatureK);

        const idealRange = (releaseVelocity * releaseVelocity * Math.sin(2 * theta)) / GRAVITY;
        const dt = 0.001;
        let x = 0, y = 0, vx = v0x, vy = v0y, maxH = 0, t = 0;
        let maxMach = 0, avgCorr = 0, steps = 0;

        while (y >= 0 && t < 100) {
            const vMag = Math.sqrt(vx * vx + vy * vy);
            const localTemp = temperatureK - y * 0.0065;
            const mach = calculateMachNumber(vMag, localTemp);
            maxMach = Math.max(maxMach, mach);
            const Re = vMag > 0 ? AIR_DENSITY * vMag * diameter / mu : 0;
            const Cd = calculateCompressibleDragCoefficient(mach, Cd0, Re) * airFactor;
            const CdIncomp = Cd0 * airFactor;
            avgCorr += Cd / Math.max(CdIncomp, 0.01);
            steps++;
            const drag = 0.5 * AIR_DENSITY * Cd * A / m;
            vx += -drag * vMag * vx * dt;
            vy += (-GRAVITY - drag * vMag * vy) * dt;
            x += vx * dt;
            y += vy * dt;
            maxH = Math.max(maxH, y);
            t += dt;
            if (y < 0) {
                const xPrev = x - vx * dt, yPrev = y - vy * dt;
                if (Math.abs(vy) > 1e-9) x = xPrev + (-yPrev) * vx / vy;
                else x = xPrev;
                break;
            }
        }

        return {
            predictedRange: Math.max(0, x),
            maxHeight: maxH,
            flightTime: t,
            airResistanceFactor: airFactor,
            maxMach,
            compressibilityCorrection: steps > 0 ? avgCorr / steps : 1.0,
            insufficientRange: Math.max(0, x) < idealRange * 0.85
        };
    }

    function calculateFullTrajectory(projectile, releaseVelocity, launchAngleDeg,
                                      airFactor = 1.0, timeStep = 0.01, temperatureK = 288.15) {
        const theta = degToRad(launchAngleDeg);
        const v0x = releaseVelocity * Math.cos(theta);
        const v0y = releaseVelocity * Math.sin(theta);
        const Cd0 = projectile.dragCoefficientIncompressible || projectile.drag_coefficient || 0.47;
        const A = projectile.crossSectionArea || projectile.cross_section_area || 0.0314;
        const m = projectile.mass;
        const diameter = projectile.diameter || 0.2;
        const mu = calculateViscosity(temperatureK);

        const dt = timeStep;
        let x = 0, y = 0, vx = v0x, vy = v0y, maxH = 0, t = 0, maxMach = 0;
        const points = [{ x: 0, y: 0 }];
        const machProfile = [{ x: 0, mach: calculateMachNumber(releaseVelocity, temperatureK) }];

        while (y >= 0 && t < 100) {
            const vMag = Math.sqrt(vx * vx + vy * vy);
            const localTemp = temperatureK - y * 0.0065;
            const mach = calculateMachNumber(vMag, localTemp);
            maxMach = Math.max(maxMach, mach);
            const Re = vMag > 0 ? AIR_DENSITY * vMag * diameter / mu : 0;
            const Cd = calculateCompressibleDragCoefficient(mach, Cd0, Re) * airFactor;
            const drag = 0.5 * AIR_DENSITY * Cd * A / m;
            vx += -drag * vMag * vx * dt;
            vy += (-GRAVITY - drag * vMag * vy) * dt;
            x += vx * dt;
            y += vy * dt;
            maxH = Math.max(maxH, y);
            t += dt;
            points.push({ x: Math.max(0, x), y: Math.max(0, y) });
            machProfile.push({ x: Math.max(0, x), mach });
            if (y < 0) break;
        }

        const impactVel = Math.sqrt(vx * vx + vy * vy);
        return {
            predictedRange: Math.max(0, x),
            maxHeight: maxH,
            flightTime: t,
            impactVelocity: impactVel,
            impactMach: calculateMachNumber(impactVel, temperatureK),
            maxMach,
            launchAngleOptimal: findOptimalLaunchAngle(projectile, releaseVelocity, airFactor, temperatureK),
            trajectoryPoints: points,
            machProfile
        };
    }

    function findOptimalLaunchAngle(projectile, releaseVelocity, airFactor = 1.0, temperatureK = 288.15) {
        let bestAngle = 45, bestRange = 0;
        for (let angle = 10; angle <= 80; angle += 1) {
            const r = predictTrajectoryRange(projectile, releaseVelocity, angle, airFactor, temperatureK);
            if (r.predictedRange > bestRange) { bestRange = r.predictedRange; bestAngle = angle; }
        }
        return bestAngle;
    }

    function calculateReleaseVelocity(springEnergy, projectileMass, efficiency) {
        return Math.sqrt(2.0 * springEnergy * efficiency / projectileMass);
    }

    MATERIALS.steel65mn.era = "modern";
    MATERIALS.steel50crva.era = "modern";
    Object.assign(MATERIALS, {
        sinew_ox: {
            shearModulus: 0.55e9,
            yieldStrength: 62e6,
            density: 1180,
            fatigueDuctilityCoeff: 2.4,
            fatigueDuctilityExp: -0.75,
            cyclicStrengthCoeff: 220e6,
            cyclicStrengthExp: -0.15,
            effectiveFiberAreaRatio: 0.72,
            twistStrandCount: 12,
            moistureContentPct: 12,
            relaxationTimeConstantSec: 1800,
            name: "黄牛肌腱(实验测定)",
            era: "ancient",
            dataSource: "Marsden M.W. 1969 'Greek and Roman Artillery' + 现代生物力学肌腱测试"
        },
        hemp_rope: {
            shearModulus: 0.18e9,
            yieldStrength: 28e6,
            density: 920,
            fatigueDuctilityCoeff: 1.6,
            fatigueDuctilityExp: -0.68,
            cyclicStrengthCoeff: 120e6,
            cyclicStrengthExp: -0.13,
            effectiveFiberAreaRatio: 0.58,
            twistStrandCount: 3,
            moistureContentPct: 8,
            relaxationTimeConstantSec: 3600,
            name: "麻绳(实验测定)",
            era: "ancient",
            dataSource: "ISO 2307:2010 纤维绳索测定 + 大英博物馆古罗马绳索分析"
        },
        ox_tendon: {
            shearModulus: 0.72e9,
            yieldStrength: 88e6,
            density: 1150,
            fatigueDuctilityCoeff: 2.8,
            fatigueDuctilityExp: -0.78,
            cyclicStrengthCoeff: 310e6,
            cyclicStrengthExp: -0.14,
            effectiveFiberAreaRatio: 0.78,
            twistStrandCount: 16,
            moistureContentPct: 10,
            relaxationTimeConstantSec: 2400,
            name: "牛筋(腱)(实验测定)",
            era: "ancient",
            dataSource: "Schramm E. 1918 罗马弩炮修复实验 + 牛津大学考古系 2018 扭力材料对比"
        },
        modern_synthetic: {
            shearModulus: 18e9,
            yieldStrength: 3600e6,
            density: 1440,
            fatigueDuctilityCoeff: 0.08,
            fatigueDuctilityExp: -0.40,
            cyclicStrengthCoeff: 5200e6,
            cyclicStrengthExp: -0.05,
            effectiveFiberAreaRatio: 0.95,
            twistStrandCount: 0,
            moistureContentPct: 0,
            relaxationTimeConstantSec: 0,
            name: "现代合成纤维(芳纶/Kevlar KM2)",
            era: "modern",
            dataSource: "DuPont Kevlar® KM2 Technical Datasheet 2023, ASTM D7269/D885"
        },
        modern_steel_alloy: {
            shearModulus: 82e9,
            yieldStrength: 2200e6,
            density: 7830,
            fatigueDuctilityCoeff: 0.35,
            fatigueDuctilityExp: -0.52,
            cyclicStrengthCoeff: 3200e6,
            cyclicStrengthExp: -0.06,
            effectiveFiberAreaRatio: 1.0,
            twistStrandCount: 0,
            moistureContentPct: 0,
            relaxationTimeConstantSec: 0,
            name: "现代合金钢弹簧(SAE 9254)",
            era: "modern",
            dataSource: "SAE J408-2013 弹簧钢标准, ASTM A401/A877 铬硅弹簧钢丝"
        }
    });

    const TREBUCHET_TYPES = {
        ancient_traction: {
            name: "古代人力牵引式",
            era: "ancient",
            reference: "Marsden 1969, 'Greek and Roman Artillery: Technical Treatises'",
            velocityBoost: 1.0,
            efficiency: 0.60,
            massMult: 1.0,
            typicalProjectileMassKg: 55,
            typicalRangeM: 400,
            maxDrawDistanceM: 1.5,
            description: "利用数十至上百人牵引绳索释放，组织复杂但材料需求最低"
        },
        ancient_torsion: {
            name: "古代扭力弹簧式",
            era: "ancient",
            reference: "Schramm 1918, 'Die Geschütze der Griechen und Römer'",
            velocityBoost: 1.0,
            efficiency: 0.85,
            massMult: 1.0,
            typicalProjectileMassKg: 27,
            typicalRangeM: 375,
            maxDrawDistanceM: 0.9,
            description: "利用扭绞的绳束/肌腱储能，是罗马 scorpio 和 onager 采用的核心技术"
        },
        ancient_counterweight: {
            name: "古代配重式 trebuchet",
            era: "ancient",
            reference: "Chevedden P.E. 1995, 'The Trebuchet'",
            velocityBoost: 1.0,
            efficiency: 0.75,
            massMult: 0.3,
            typicalProjectileMassKg: 90,
            typicalRangeM: 250,
            maxDrawDistanceM: 2.0,
            description: "中世纪 trebuchet 典型结构，利用重型配重臂下落带动投射"
        },
        modern_carriage_catapult: {
            name: "现代车载电磁弹射器",
            era: "modern",
            reference: "US Army EMALS-U Ground Test 2022, General Atomics",
            velocityBoost: 3.2,
            efficiency: 0.92,
            massMult: 0.05,
            typicalProjectileMassKg: 15,
            typicalRangeM: 5000,
            maxDrawDistanceM: 25.0,
            description: "现代电磁线性电机驱动，用于无人机和靶机发射"
        },
        modern_aircraft_catapult: {
            name: "现代航母电磁弹射器 EMALS",
            era: "modern",
            reference: "US Navy EMALS Program 2023, Gerald R. Ford-class CVN-78",
            velocityBoost: 4.8,
            efficiency: 0.95,
            massMult: 0.008,
            typicalProjectileMassKg: 20000,
            typicalRangeM: 10000,
            maxDrawDistanceM: 91.0,
            description: "航母舰载机使用，几十吨级飞行器短距离加速起飞"
        }
    };

    function deepCloneConfig(config) {
        return {
            material: config.material,
            wireDiameter: config.wireDiameter,
            coilMeanDiameter: config.coilMeanDiameter,
            activeCoils: config.activeCoils,
            cyclicState: createCyclicState(config.material)
        };
    }

    function calculateSpringEnergyWithPreload(config, torsionAngleRad, preloadAngleRad) {
        const tempConfig = deepCloneConfig(config);
        const thetaTotal = preloadAngleRad + torsionAngleRad;
        const springConstant = calculateSpringConstant(tempConfig);
        const Gcurr = tempConfig.cyclicState.degradedShearModulus;
        const Gorg = tempConfig.material.shearModulus;
        const modulusReduction = Gcurr / Gorg;

        const stressAmplitude = calculateShearStress(tempConfig, thetaTotal);
        updateCyclicSoftening(tempConfig, thetaTotal, stressAmplitude);

        const storedEnergy = 0.5 * springConstant
            * (thetaTotal * thetaTotal - preloadAngleRad * preloadAngleRad)
            * modulusReduction;

        const preloadFactor = preloadAngleRad / Math.max(preloadAngleRad + torsionAngleRad, 1e-9);
        const baseEfficiency = calculateSpringEfficiency(tempConfig, torsionAngleRad);
        const efficiency = baseEfficiency * (1.0 + preloadFactor * 0.08);
        const clampedEfficiency = Math.max(0, Math.min(1, efficiency));

        const yieldRatio = stressAmplitude / tempConfig.material.yieldStrength;
        const damage = tempConfig.cyclicState.currentDamageParameter;
        const elasticStress = Math.min(stressAmplitude, tempConfig.cyclicState.degradedYieldStrength);
        const tauDiff = Math.max(0, stressAmplitude - tempConfig.cyclicState.degradedYieldStrength);
        const plasticStrain = tauDiff / Gcurr;

        let riskLevel = "normal";
        if (yieldRatio > 0.85 || damage > 0.7) riskLevel = "critical";
        else if (yieldRatio > 0.70 || damage > 0.4) riskLevel = "warning";

        return {
            springConstant,
            storedEnergy,
            shearStress: stressAmplitude,
            elasticStress,
            plasticStrain,
            efficiency: clampedEfficiency,
            yieldStrengthRatio: yieldRatio,
            cyclicDamageRatio: damage,
            cycleCount: tempConfig.cyclicState.cycleCount,
            fractureRisk: yieldRatio > 0.85,
            fatigueRisk: damage > 0.5,
            riskLevel,
            modulusReduction,
            preloadAngleDeg: radToDeg(preloadAngleRad)
        };
    }

    function buildConfigFromParams(params, material) {
        return {
            material: material,
            wireDiameter: params.wireDiameterMm / 1000,
            coilMeanDiameter: params.meanDiameterMm / 1000,
            activeCoils: params.activeCoils,
            cyclicState: createCyclicState(material)
        };
    }

    function compareMaterials(params) {
        const { torsionAngleDeg, massKg, launchAngleDeg } = params;
        const torsionAngleRad = degToRad(torsionAngleDeg);
        const materialIds = Object.keys(MATERIALS);
        const results = [];

        for (const materialId of materialIds) {
            const material = MATERIALS[materialId];
            const config = buildConfigFromParams(params, material);
            const spring = calculateSpringEnergy(config, torsionAngleRad);
            const v = Math.sqrt(2 * spring.storedEnergy * spring.efficiency / Math.max(massKg, 1e-9));
            const projectile = {
                mass: massKg,
                diameter: 0.2,
                crossSectionArea: Math.PI * 0.1 * 0.1,
                dragCoefficientIncompressible: 0.47
            };
            const traj = predictTrajectoryRange(projectile, v, launchAngleDeg);

            results.push({
                materialId: materialId,
                name: material.name,
                era: material.era,
                storedEnergy: spring.storedEnergy,
                springConstant: spring.springConstant,
                shearStressMpa: spring.shearStress / 1e6,
                efficiency: spring.efficiency,
                cyclicDamageRatio: spring.cyclicDamageRatio,
                predictedRange: traj.predictedRange,
                maxHeight: traj.maxHeight,
                flightTime: traj.flightTime
            });
        }

        results.sort((a, b) => b.predictedRange - a.predictedRange);
        results.forEach((r, idx) => { r.rangeRanking = idx + 1; });
        return results;
    }

    function compareTrebuchetTypes(params) {
        const { baseVelocity, massKg, launchAngleDeg, diameterM = 0.2, dragCd = 0.47 } = params;
        const radius = diameterM / 2;
        const crossSectionArea = Math.PI * radius * radius;
        const typeIds = Object.keys(TREBUCHET_TYPES);
        const results = [];

        for (const typeId of typeIds) {
            const type = TREBUCHET_TYPES[typeId];
            const adjustedMass = massKg * type.massMult;
            const adjustedVelocity = baseVelocity * type.velocityBoost * type.efficiency;
            const projectile = {
                mass: adjustedMass,
                diameter: diameterM,
                crossSectionArea: crossSectionArea,
                dragCoefficientIncompressible: dragCd
            };
            const fullTraj = calculateFullTrajectory(projectile, adjustedVelocity, launchAngleDeg);

            results.push({
                typeId: typeId,
                name: type.name,
                era: type.era,
                description: type.description,
                adjustedVelocity: adjustedVelocity,
                adjustedMass: adjustedMass,
                efficiency: type.efficiency,
                predictedRange: fullTraj.predictedRange,
                maxHeight: fullTraj.maxHeight,
                flightTime: fullTraj.flightTime,
                maxMach: fullTraj.maxMach,
                impactVelocity: fullTraj.impactVelocity
            });
        }

        results.sort((a, b) => b.predictedRange - a.predictedRange);
        results.forEach((r, idx) => { r.rangeRanking = idx + 1; });
        return results;
    }

    function analyzePreloadEffect(params) {
        const {
            maxPreloadAngleDeg,
            totalTorsionAngleDeg = 360,
            massKg = 10,
            launchAngleDeg = 45,
            wireDiameterMm = 20,
            meanDiameterMm = 150,
            activeCoils = 12,
            materialId = 'steel65mn',
            steps = 20
        } = params;

        const material = MATERIALS[materialId] || MATERIALS.steel65mn;
        const baseConfig = {
            material: material,
            wireDiameter: wireDiameterMm / 1000,
            coilMeanDiameter: meanDiameterMm / 1000,
            activeCoils: activeCoils
        };

        const diameterM = 0.2;
        const crossSectionArea = Math.PI * 0.1 * 0.1;
        const projectile = {
            mass: massKg,
            diameter: diameterM,
            crossSectionArea: crossSectionArea,
            dragCoefficientIncompressible: 0.47
        };

        const totalTorsionRad = degToRad(totalTorsionAngleDeg);
        const baselineConfig = deepCloneConfig(baseConfig);
        const baselineSpring = calculateSpringEnergyWithPreload(baselineConfig, totalTorsionRad, 0);
        const baselineV = Math.sqrt(2 * baselineSpring.storedEnergy * baselineSpring.efficiency / Math.max(massKg, 1e-9));
        const baselineTraj = predictTrajectoryRange(projectile, baselineV, launchAngleDeg);
        const baselineRangeM = baselineTraj.predictedRange;

        const points = [];
        let maxRangeM = baselineRangeM;
        let bestPreloadAngleDeg = 0;

        const stepSize = maxPreloadAngleDeg / Math.max(steps, 1);
        for (let i = 0; i <= steps; i++) {
            const preloadAngleDeg = i * stepSize;
            const preloadAngleRad = degToRad(preloadAngleDeg);
            const torsionAngleRad = degToRad(totalTorsionAngleDeg - preloadAngleDeg);

            const config = deepCloneConfig(baseConfig);
            const spring = calculateSpringEnergyWithPreload(config, torsionAngleRad, preloadAngleRad);
            const v = Math.sqrt(2 * spring.storedEnergy * spring.efficiency / Math.max(massKg, 1e-9));
            const traj = predictTrajectoryRange(projectile, v, launchAngleDeg);

            points.push({
                preloadAngleDeg: preloadAngleDeg,
                rangeM: traj.predictedRange,
                energyJ: spring.storedEnergy,
                efficiency: spring.efficiency
            });

            if (traj.predictedRange > maxRangeM) {
                maxRangeM = traj.predictedRange;
                bestPreloadAngleDeg = preloadAngleDeg;
            }
        }

        const improvementPercent = baselineRangeM > 0
            ? ((maxRangeM - baselineRangeM) / baselineRangeM) * 100
            : 0;

        return {
            points: points,
            bestPreloadAngleDeg: bestPreloadAngleDeg,
            maxRangeM: maxRangeM,
            baselineRangeM: baselineRangeM,
            improvementPercent: improvementPercent
        };
    }

    function virtualLaunch(params) {
        const {
            torsionAngleDeg,
            preloadAngleDeg,
            massKg,
            launchAngleDeg,
            wireDiameterMm,
            meanDiameterMm,
            activeCoils,
            materialId,
            diameterM = 0.2,
            dragCd = 0.47
        } = params;

        const material = MATERIALS[materialId] || MATERIALS.steel65mn;
        const config = {
            material: material,
            wireDiameter: wireDiameterMm / 1000,
            coilMeanDiameter: meanDiameterMm / 1000,
            activeCoils: activeCoils,
            cyclicState: createCyclicState(material)
        };

        const torsionAngleRad = degToRad(torsionAngleDeg);
        const preloadAngleRad = degToRad(preloadAngleDeg);
        const spring = calculateSpringEnergyWithPreload(config, torsionAngleRad, preloadAngleRad);

        const releaseVelocity = Math.sqrt(
            2 * spring.storedEnergy * spring.efficiency / Math.max(massKg, 1e-9)
        );

        const radius = diameterM / 2;
        const crossSectionArea = Math.PI * radius * radius;
        const projectile = {
            mass: massKg,
            diameter: diameterM,
            crossSectionArea: crossSectionArea,
            dragCoefficientIncompressible: dragCd
        };

        const trajectory = calculateFullTrajectory(projectile, releaseVelocity, launchAngleDeg);
        const trajectoryPoints = trajectory.trajectoryPoints.map(p => [p.x, p.y]);
        const trajectoryMachPoints = trajectory.machProfile.map(m => [m.x, m.mach]);

        return {
            spring: spring,
            releaseVelocity: releaseVelocity,
            trajectory: trajectory,
            trajectoryPoints: trajectoryPoints,
            trajectoryMachPoints: trajectoryMachPoints
        };
    }

    function simulatePreloadTensioning(config, targetPreloadAngleDeg, tensioningStages, stageHoldTimeSec, overpullDeg) {
        tensioningStages = tensioningStages || 4;
        stageHoldTimeSec = stageHoldTimeSec || 5;
        overpullDeg = overpullDeg || 5;

        const result = {
            targetPreloadAngleDeg: targetPreloadAngleDeg,
            finalSettledAngleDeg: 0,
            initialPreloadEnergyJ: 0,
            finalPreloadEnergyJ: 0,
            efficiencyAfterTensioning: 0,
            totalCreepDeg: 0,
            overpullDeg: overpullDeg,
            stages: []
        };

        const safeStages = Math.max(1, tensioningStages);
        const safeTarget = Math.max(0, targetPreloadAngleDeg);
        const safeOverpull = Math.max(0, overpullDeg);
        const safeHold = Math.max(0.1, stageHoldTimeSec);

        const totalPretensionDeg = safeTarget + safeOverpull;
        const degPerStage = totalPretensionDeg / safeStages;

        const relaxationTau = config.material.relaxationTimeConstantSec || 1800;
        const fiberRatio = config.material.effectiveFiberAreaRatio > 0 ? config.material.effectiveFiberAreaRatio : 1.0;
        const creepFactorPerStage = fiberRatio > 0
            ? 0.02 * (1.0 - fiberRatio)
            : 0.005;

        let currentAngleDeg = 0;
        let accumulatedCreepDeg = 0;

        const configCopy = deepCloneConfig(config);

        for (let i = 0; i < safeStages; i++) {
            const stage = {
                stageIndex: i + 1,
                angleDeg: 0,
                holdTimeSec: safeHold,
                stressMpa: 0,
                creepSettlementPct: 0,
                residualEnergyJ: 0
            };

            const targetStageDeg = degPerStage * (i + 1);
            let pullDeg = targetStageDeg - currentAngleDeg;
            pullDeg = Math.max(0, pullDeg);

            currentAngleDeg += pullDeg;
            stage.angleDeg = currentAngleDeg;

            const currentRad = degToRad(currentAngleDeg);
            const energyRes = calculateSpringEnergyWithPreload(configCopy, 0, currentRad);

            stage.stressMpa = energyRes.shearStress / 1e6;

            const creepSettlement = pullDeg * creepFactorPerStage *
                (1.0 - Math.exp(-safeHold / relaxationTau));
            const stageFactor = 1.0 + 0.5 * (i / safeStages);

            const settlement = creepSettlement * stageFactor;
            stage.creepSettlementPct = pullDeg > 0 ? (settlement / pullDeg) * 100 : 0;

            accumulatedCreepDeg += settlement;
            currentAngleDeg = Math.max(0, currentAngleDeg - settlement);

            const residualRad = degToRad(currentAngleDeg);
            const residualRes = calculateSpringEnergyWithPreload(configCopy, 0, residualRad);
            stage.residualEnergyJ = residualRes.storedEnergy;

            result.stages.push(stage);
        }

        const overpullSettlement = safeOverpull * creepFactorPerStage * 0.8;
        accumulatedCreepDeg += overpullSettlement;

        result.totalCreepDeg = accumulatedCreepDeg;
        result.finalSettledAngleDeg = Math.max(0, safeTarget - accumulatedCreepDeg * 0.6);

        const initialRad = degToRad(safeTarget);
        const initialRes = calculateSpringEnergyWithPreload(configCopy, 0, initialRad);
        result.initialPreloadEnergyJ = initialRes.storedEnergy;

        const finalRad = degToRad(result.finalSettledAngleDeg);
        const finalRes = calculateSpringEnergyWithPreload(configCopy, 0, finalRad);
        result.finalPreloadEnergyJ = finalRes.storedEnergy;
        result.efficiencyAfterTensioning = finalRes.efficiency;

        return result;
    }

    return {
        GRAVITY,
        AIR_DENSITY,
        SPEED_OF_SOUND,
        GAMMA,
        MATERIALS,
        TREBUCHET_TYPES,
        degToRad,
        radToDeg,
        createCyclicState,
        calculateViscosity,
        calculateMachNumber,
        calculateCompressibleDragCoefficient,
        calculateCoffinMansonLife,
        updateCyclicSoftening,
        calculateSpringConstant,
        calculateShearStress,
        calculateSpringEfficiency,
        calculateSpringEnergy,
        calculateSpringEnergyWithPreload,
        predictTrajectoryRange,
        calculateFullTrajectory,
        findOptimalLaunchAngle,
        calculateReleaseVelocity,
        compareMaterials,
        compareTrebuchetTypes,
        analyzePreloadEffect,
        virtualLaunch,
        simulatePreloadTensioning
    };
})();
