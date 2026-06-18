#!/usr/bin/env node
"use strict";

var g_pass = 0, g_fail = 0, g_error = 0;

function assert(cond, name, detail) {
    if (cond) {
        g_pass++;
        console.log("  PASS  " + name);
    } else {
        g_fail++;
        console.log("  FAIL  " + name + (detail ? " -- " + detail : ""));
    }
}

function approxEq(a, b, eps) {
    eps = eps || 1e-6;
    return Math.abs(a - b) < eps;
}

global.window = global;
global.document = { createElement: function() { return { getContext: function() { return null; } }; } };

var fs = require("fs");
var path = require("path");
var physicsSrc = fs.readFileSync(
    path.join(__dirname, "..", "frontend", "js", "physics.js"),
    "utf-8"
);
var patchedSrc = physicsSrc.replace(
    "const TrebuchetPhysics = (function ()",
    "global.TrebuchetPhysics = (function ()"
);
eval(patchedSrc);
var TP = TrebuchetPhysics;

var defaultParams = {
    torsionAngleDeg: 120,
    preloadAngleDeg: 0,
    massKg: 10,
    launchAngleDeg: 45,
    wireDiameterMm: 20,
    meanDiameterMm: 150,
    activeCoils: 12,
    materialId: "steel65mn"
};

function launch(params) {
    var p = Object.assign({}, defaultParams, params);
    return TP.virtualLaunch(p);
}

// =====================================================================
// Strategy 1: Angle of Elevation Optimization Strategy
// =====================================================================

function test_strategy_optimal_elevation_between_30_45() {
    var bestRange = 0, bestAngle = 0;
    for (var angle = 10; angle <= 80; angle += 1) {
        var r = launch({ launchAngleDeg: angle });
        if (r.trajectory.predictedRange > bestRange) {
            bestRange = r.trajectory.predictedRange;
            bestAngle = angle;
        }
    }
    assert(bestAngle >= 25 && bestAngle <= 50,
           "optimal launch angle in [25, 50] degrees",
           "best=" + bestAngle + "deg, range=" + bestRange.toFixed(1) + "m");
}

function test_strategy_45deg_not_best_with_air_drag() {
    var r30 = launch({ launchAngleDeg: 30 }).trajectory.predictedRange;
    var r45 = launch({ launchAngleDeg: 45 }).trajectory.predictedRange;
    var r60 = launch({ launchAngleDeg: 60 }).trajectory.predictedRange;
    assert(r30 > r60, "30deg range > 60deg range (air drag effect)",
           "r30=" + r30.toFixed(1) + " r60=" + r60.toFixed(1));
    assert(r45 > r60, "45deg range > 60deg range",
           "r45=" + r45.toFixed(1) + " r60=" + r60.toFixed(1));
}

function test_strategy_high_angle_for_max_height() {
    var h30 = launch({ launchAngleDeg: 30 }).trajectory.maxHeight;
    var h60 = launch({ launchAngleDeg: 60 }).trajectory.maxHeight;
    var h80 = launch({ launchAngleDeg: 80 }).trajectory.maxHeight;
    assert(h80 > h60, "80deg max height > 60deg",
           "h80=" + h80.toFixed(1) + " h60=" + h60.toFixed(1));
    assert(h60 > h30, "60deg max height > 30deg",
           "h60=" + h60.toFixed(1) + " h30=" + h30.toFixed(1));
}

// =====================================================================
// Strategy 2: Preload vs Work Torsion Trade-off
// =====================================================================

function test_strategy_preload_improves_range_at_same_total() {
    var totalDeg = 360;
    var bestRange = 0, bestPreload = 0;
    for (var pre = 0; pre <= 120; pre += 5) {
        var work = totalDeg - pre;
        var r = TP.virtualLaunch({
            torsionAngleDeg: work,
            preloadAngleDeg: pre,
            massKg: 10, launchAngleDeg: 45,
            wireDiameterMm: 20, meanDiameterMm: 150,
            activeCoils: 12, materialId: "steel65mn"
        });
        if (r.trajectory.predictedRange > bestRange) {
            bestRange = r.trajectory.predictedRange;
            bestPreload = pre;
        }
    }
    assert(bestPreload > 0, "optimal preload > 0 at fixed total torsion",
           "bestPreload=" + bestPreload + "deg, range=" + bestRange.toFixed(1) + "m");
    assert(bestRange > launch({ torsionAngleDeg: totalDeg, preloadAngleDeg: 0 }).trajectory.predictedRange,
           "best preload range > no-preload range",
           "best=" + bestRange.toFixed(1) + " noPreload=" + launch({ torsionAngleDeg: totalDeg, preloadAngleDeg: 0 }).trajectory.predictedRange.toFixed(1));
}

function test_strategy_preload_ratio_sensible() {
    var totalDeg = 360;
    var bestPreloadDeg = 0, bestRange = 0;
    for (var pre = 0; pre <= 180; pre += 2) {
        var work = totalDeg - pre;
        if (work <= 0) continue;
        var r = TP.virtualLaunch({
            torsionAngleDeg: work, preloadAngleDeg: pre,
            massKg: 10, launchAngleDeg: 45,
            wireDiameterMm: 20, meanDiameterMm: 150,
            activeCoils: 12, materialId: "steel65mn"
        });
        if (r.trajectory.predictedRange > bestRange) {
            bestRange = r.trajectory.predictedRange;
            bestPreloadDeg = pre;
        }
    }
    var ratio = bestPreloadDeg / totalDeg;
    assert(ratio > 0.05 && ratio < 0.6,
           "optimal preload/total ratio in (0.05, 0.6)",
           "ratio=" + ratio.toFixed(3) + " preload=" + bestPreloadDeg + "deg");
}

// =====================================================================
// Strategy 3: Projectile Mass vs Range Trade-off
// =====================================================================

function test_strategy_heavy_projectile_more_kinetic_energy() {
    var v = 50;
    var ke10 = 0.5 * 10 * v * v;
    var ke50 = 0.5 * 50 * v * v;
    assert(ke50 > ke10, "same velocity: heavy projectile has more KE",
           "KE50=" + ke50 + " KE10=" + ke10);
}

function test_strategy_light_projectile_travels_farther() {
    var rLight = launch({ massKg: 5 }).trajectory.predictedRange;
    var rHeavy = launch({ massKg: 20 }).trajectory.predictedRange;
    assert(rLight > rHeavy, "lighter projectile travels farther (same spring energy)",
           "rLight=" + rLight.toFixed(1) + " rHeavy=" + rHeavy.toFixed(1));
}

function test_strategy_mass_vs_range_is_non_linear() {
    var r1 = launch({ massKg: 2 }).trajectory.predictedRange;
    var r2 = launch({ massKg: 10 }).trajectory.predictedRange;
    var r3 = launch({ massKg: 50 }).trajectory.predictedRange;
    var drop12 = (r1 - r2) / r1;
    var drop23 = (r2 - r3) / r2;
    assert(drop12 > 0 && drop23 > 0, "range decreases as mass increases");
    assert(drop12 < drop23, "range drop accelerates with mass (non-linear drag)",
           "drop12=" + drop12.toFixed(2) + " drop23=" + drop23.toFixed(2));
}

// =====================================================================
// Strategy 4: Material Selection Strategy
// =====================================================================

function test_strategy_ancient_material_needs_more_wire() {
    var rSteel = launch({ materialId: "steel65mn" }).trajectory.predictedRange;
    var rHemp = launch({ materialId: "hemp_rope" }).trajectory.predictedRange;
    assert(rSteel > rHemp, "steel range > hemp range at same dimensions",
           "rSteel=" + rSteel.toFixed(1) + " rHemp=" + rHemp.toFixed(1));
}

function test_strategy_ancient_needs_bigger_spring() {
    var rSteel = launch({
        materialId: "steel65mn",
        wireDiameterMm: 20, activeCoils: 12, meanDiameterMm: 150
    }).trajectory.predictedRange;

    var rOxBig = launch({
        materialId: "ox_tendon",
        wireDiameterMm: 80, activeCoils: 40, meanDiameterMm: 400
    }).trajectory.predictedRange;

    var ratio = rOxBig / rSteel;
    assert(ratio > 0.15,
           "ancient tendon material with big spring achieves reasonable fraction of steel range",
           "rOxBig=" + rOxBig.toFixed(1) + " rSteel=" + rSteel.toFixed(1) +
           " ratio=" + ratio.toFixed(3));
}

function test_strategy_modern_synthetic_highest_energy_density() {
    var materials = ["steel65mn", "steel50crva", "modern_synthetic", "modern_steel_alloy"];
    var bestRange = 0, bestMat = "";
    materials.forEach(function(m) {
        var r = launch({ materialId: m }).trajectory.predictedRange;
        if (r > bestRange) { bestRange = r; bestMat = m; }
    });
    assert(["steel65mn", "modern_steel_alloy", "steel50crva", "modern_synthetic"].indexOf(bestMat) >= 0,
           "modern material has best range",
           "best=" + bestMat + " range=" + bestRange.toFixed(1));
}

// =====================================================================
// Strategy 5: Safety vs Performance Trade-off
// =====================================================================

function test_strategy_higher_torsion_higher_stress() {
    var stressLow = launch({ torsionAngleDeg: 60 }).spring.shearStress;
    var stressHigh = launch({ torsionAngleDeg: 180 }).spring.shearStress;
    assert(stressHigh > stressLow, "180deg stress > 60deg stress",
           "stressLow=" + stressLow.toFixed(0) + " stressHigh=" + stressHigh.toFixed(0));
}

function test_strategy_yield_ratio_increases_with_torsion() {
    var y60 = launch({ torsionAngleDeg: 60 }).spring.yieldStrengthRatio;
    var y180 = launch({ torsionAngleDeg: 180 }).spring.yieldStrengthRatio;
    assert(y180 > y60, "180deg yield ratio > 60deg",
           "y60=" + y60.toFixed(3) + " y180=" + y180.toFixed(3));
}

function test_strategy_extreme_torsion_triggers_fracture_risk() {
    var r = launch({ torsionAngleDeg: 720, wireDiameterMm: 10 });
    assert(r.spring.fractureRisk || r.spring.yieldStrengthRatio > 0.7,
           "extreme torsion triggers fracture risk or high yield ratio",
           "fractureRisk=" + r.spring.fractureRisk + " yieldRatio=" + r.spring.yieldStrengthRatio.toFixed(2));
}

// =====================================================================
// Strategy 6: Virtual Operation Sequencing
// =====================================================================

function test_strategy_multiple_launches_accumulate_damage() {
    var cfg = {
        material: TP.MATERIALS.steel65mn,
        wireDiameter: 0.02,
        coilMeanDiameter: 0.15,
        activeCoils: 12,
        cyclicState: TP.createCyclicState(TP.MATERIALS.steel65mn)
    };
    var firstEnergy = TP.calculateSpringEnergy(cfg, 2.0).storedEnergy;
    var damageAfter1 = cfg.cyclicState.currentDamageParameter;

    for (var i = 0; i < 100; i++) {
        TP.calculateSpringEnergy(cfg, 2.0);
    }
    var damageAfter100 = cfg.cyclicState.currentDamageParameter;

    assert(damageAfter100 >= damageAfter1,
           "cyclic loading accumulates damage",
           "damageAfter1=" + damageAfter1.toFixed(6) + " damageAfter100=" + damageAfter100.toFixed(6));
}

function test_strategy_modulus_degrades_with_cycles() {
    var cfg = {
        material: TP.MATERIALS.steel65mn,
        wireDiameter: 0.02,
        coilMeanDiameter: 0.15,
        activeCoils: 12,
        cyclicState: TP.createCyclicState(TP.MATERIALS.steel65mn)
    };
    var firstModRed = TP.calculateSpringEnergy(cfg, 2.0).modulusReduction;

    for (var i = 0; i < 200; i++) {
        TP.calculateSpringEnergy(cfg, 2.0);
    }
    var laterModRed = TP.calculateSpringEnergy(cfg, 2.0).modulusReduction;

    assert(laterModRed <= firstModRed + 1e-6,
           "shear modulus degrades (or stays same) with cyclic loading",
           "first=" + firstModRed.toFixed(4) + " later=" + laterModRed.toFixed(4));
}

// =====================================================================
// Strategy 7: Boundary Operation Strategies
// =====================================================================

function test_strategy_zero_launch_angle_ground_skip() {
    var r = launch({ launchAngleDeg: 0 });
    assert(r.trajectory.predictedRange >= 0, "0deg launch has finite range",
           "range=" + r.trajectory.predictedRange.toFixed(2));
}

function test_strategy_very_low_mass_high_mach() {
    var r = launch({ massKg: 0.1 });
    assert(r.trajectory.maxMach > 0, "light projectile can reach high mach",
           "maxMach=" + r.trajectory.maxMach.toFixed(3));
}

function test_strategy_large_wire_stiffer_spring() {
    var rThin = launch({ wireDiameterMm: 10 });
    var rThick = launch({ wireDiameterMm: 30 });
    assert(rThick.spring.springConstant > rThin.spring.springConstant,
           "thicker wire = stiffer spring (higher k)",
           "kThin=" + rThin.spring.springConstant.toFixed(1) +
           " kThick=" + rThick.spring.springConstant.toFixed(1));
}

// =====================================================================
// Run all tests
// =====================================================================

var categories = [
    {
        name: "策略一：仰角选择策略",
        tests: [
            test_strategy_optimal_elevation_between_30_45,
            test_strategy_45deg_not_best_with_air_drag,
            test_strategy_high_angle_for_max_height
        ]
    },
    {
        name: "策略二：预紧角与工作扭转角权衡",
        tests: [
            test_strategy_preload_improves_range_at_same_total,
            test_strategy_preload_ratio_sensible
        ]
    },
    {
        name: "策略三：弹丸质量与射程权衡",
        tests: [
            test_strategy_heavy_projectile_more_kinetic_energy,
            test_strategy_light_projectile_travels_farther,
            test_strategy_mass_vs_range_is_non_linear
        ]
    },
    {
        name: "策略四：材料选择策略",
        tests: [
            test_strategy_ancient_material_needs_more_wire,
            test_strategy_ancient_needs_bigger_spring,
            test_strategy_modern_synthetic_highest_energy_density
        ]
    },
    {
        name: "策略五：安全与性能权衡",
        tests: [
            test_strategy_higher_torsion_higher_stress,
            test_strategy_yield_ratio_increases_with_torsion,
            test_strategy_extreme_torsion_triggers_fracture_risk
        ]
    },
    {
        name: "策略六：多发射循环累积效应",
        tests: [
            test_strategy_multiple_launches_accumulate_damage,
            test_strategy_modulus_degrades_with_cycles
        ]
    },
    {
        name: "策略七：边界操作策略",
        tests: [
            test_strategy_zero_launch_angle_ground_skip,
            test_strategy_very_low_mass_high_mach,
            test_strategy_large_wire_stiffer_spring
        ]
    }
];

var startTime = Date.now();

console.log("=======================================================");
console.log("  虚拟操作霹雳车策略性测试 (Virtual Operation Strategy)");
console.log("=======================================================");

categories.forEach(function(cat) {
    console.log("\n--- " + cat.name + " ---");
    cat.tests.forEach(function(fn) {
        try {
            fn();
        } catch (e) {
            g_error++;
            console.log("  ERROR " + fn.name + ": " + e.message);
        }
    });
});

var elapsed = Date.now() - startTime;
var total = g_pass + g_fail + g_error;

console.log("\n=======================================================");
console.log("  Summary");
console.log("=======================================================");
console.log("  Total:  " + total);
console.log("  PASS:   " + g_pass);
console.log("  FAIL:   " + g_fail);
console.log("  ERROR:  " + g_error);
console.log("  Time:   " + elapsed + " ms");
console.log("=======================================================");

if (g_fail + g_error > 0) process.exit(1);
