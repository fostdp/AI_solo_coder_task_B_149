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

function assertFinite(v, name) {
    assert(Number.isFinite(v), name, "value=" + v);
}

function approxEq(a, b, eps) {
    eps = eps || 1e-6;
    return Math.abs(a - b) < eps;
}

function approxZero(v, eps) {
    eps = eps || 1e-3;
    return Math.abs(v) < eps;
}

global.window = global;
global.document = {
    createElement: function() { return { getContext: function() { return null; } }; }
};

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

var TP = (typeof TrebuchetPhysics !== "undefined") ? TrebuchetPhysics : null;
assert(TP !== null, "TrebuchetPhysics loaded");

function makeParams(overrides) {
    var base = {
        torsionAngleDeg: 120,
        massKg: 10,
        launchAngleDeg: 45,
        wireDiameterMm: 20,
        meanDiameterMm: 150,
        activeCoils: 12
    };
    for (var k in overrides) { base[k] = overrides[k]; }
    return base;
}

// =====================================================================
// Category 1: Material Comparison - Energy Storage Density
// =====================================================================

function test_seven_materials_all_computed() {
    var results = TP.compareMaterials(makeParams());
    assert(results.length === 7, "7 materials returned", "got " + results.length);
}

function test_modern_higher_energy_than_ancient() {
    var results = TP.compareMaterials(makeParams());
    var modernSum = 0, ancientSum = 0, modernN = 0, ancientN = 0;
    results.forEach(function(r) {
        if (r.era === "modern") { modernSum += r.storedEnergy; modernN++; }
        else { ancientSum += r.storedEnergy; ancientN++; }
    });
    assert(modernN > 0 && ancientN > 0, "both eras present");
    assert(modernSum / modernN > ancientSum / ancientN,
           "modern avg energy > ancient avg",
           "modern=" + (modernSum/modernN).toFixed(1) + " ancient=" + (ancientSum/ancientN).toFixed(1));
}

function test_era_field_correct() {
    var ancientIds = ["sinew_ox", "hemp_rope", "ox_tendon"];
    var modernIds = ["steel65mn", "steel50crva", "modern_synthetic", "modern_steel_alloy"];
    var results = TP.compareMaterials(makeParams());
    results.forEach(function(r) {
        if (ancientIds.indexOf(r.materialId) >= 0) {
            assert(r.era === "ancient", r.materialId + " era=ancient", "got " + r.era);
        } else if (modernIds.indexOf(r.materialId) >= 0) {
            assert(r.era === "modern", r.materialId + " era=modern", "got " + r.era);
        }
    });
}

function test_ranking_sorted_by_range() {
    var results = TP.compareMaterials(makeParams());
    for (var i = 1; i < results.length; i++) {
        assert(results[i].predictedRange <= results[i-1].predictedRange + 0.1,
               "ranking[" + i + "] <= ranking[" + (i-1) + "]",
               results[i].predictedRange.toFixed(2) + " vs " + results[i-1].predictedRange.toFixed(2));
    }
    assert(results[0].rangeRanking === 1, "top ranked = 1", "got " + results[0].rangeRanking);
}

function test_modern_steel_top_two() {
    var results = TP.compareMaterials(makeParams());
    var top2ids = [results[0].materialId, results[1].materialId];
    var steelInTop = top2ids.indexOf("steel65mn") >= 0 || top2ids.indexOf("modern_steel_alloy") >= 0;
    assert(steelInTop, "steel65mn or modern_steel_alloy in top 2", top2ids.join(","));
}

function test_energy_proportional_to_shear_modulus() {
    var p = makeParams();
    var rSinew = TP.compareMaterials(Object.assign({}, p, { materialId: "sinew_ox" }));
    var allResults = TP.compareMaterials(p);
    var sinewE = 0, steelE = 0;
    allResults.forEach(function(r) {
        if (r.materialId === "sinew_ox") sinewE = r.storedEnergy;
        if (r.materialId === "steel65mn") steelE = r.storedEnergy;
    });
    assert(sinewE < steelE, "sinew_ox(G=1.2GPa) < steel65mn(G=79.3GPa)",
           sinewE.toFixed(2) + " vs " + steelE.toFixed(2));
}

function test_zero_torsion_angle() {
    var results = TP.compareMaterials(makeParams({ torsionAngleDeg: 0 }));
    results.forEach(function(r) {
        assert(approxZero(r.storedEnergy, 10), r.materialId + " energy ~0 at 0deg",
               "E=" + r.storedEnergy.toFixed(6));
    });
}

function test_very_small_mass() {
    var results = TP.compareMaterials(makeParams({ massKg: 0.001 }));
    results.forEach(function(r) {
        assertFinite(r.storedEnergy, r.materialId + " energy finite");
        assertFinite(r.predictedRange, r.materialId + " range finite");
    });
}

function test_very_large_angle() {
    var results = TP.compareMaterials(makeParams({ torsionAngleDeg: 720 }));
    results.forEach(function(r) {
        assertFinite(r.storedEnergy, r.materialId + " energy finite at 720deg");
        assertFinite(r.predictedRange, r.materialId + " range finite at 720deg");
    });
}

function test_negative_torsion_angle() {
    var results = TP.compareMaterials(makeParams({ torsionAngleDeg: -10 }));
    assert(results.length === 7, "7 results despite negative angle");
    results.forEach(function(r) {
        assertFinite(r.storedEnergy, r.materialId + " finite on negative angle");
    });
}

function test_missing_params_no_crash() {
    var results = TP.compareMaterials({ torsionAngleDeg: 120, massKg: 10, launchAngleDeg: 45 });
    assert(results.length === 7, "works with minimal params");
}

// =====================================================================
// Category 2: Cross-era Trebuchet Comparison
// =====================================================================

function test_five_types_all_computed() {
    var results = TP.compareTrebuchetTypes({
        baseVelocity: 35, massKg: 10, launchAngleDeg: 45
    });
    assert(results.length === 5, "5 types returned", "got " + results.length);
}

function test_modern_outranges_ancient() {
    var results = TP.compareTrebuchetTypes({
        baseVelocity: 35, massKg: 10, launchAngleDeg: 45, diameterM: 0.02, dragCd: 0.2
    });
    var modernMaxV = 0, ancientMaxV = 0;
    var modernMaxR = 0, ancientMaxR = 0;
    results.forEach(function(r) {
        if (r.era === "modern") {
            modernMaxV = Math.max(modernMaxV, r.adjustedVelocity);
            modernMaxR = Math.max(modernMaxR, r.predictedRange);
        } else {
            ancientMaxV = Math.max(ancientMaxV, r.adjustedVelocity);
            ancientMaxR = Math.max(ancientMaxR, r.predictedRange);
        }
    });
    assert(modernMaxV > ancientMaxV, "modern release velocity > ancient",
           "modernV=" + modernMaxV.toFixed(1) + " ancientV=" + ancientMaxV.toFixed(1));
    assert(modernMaxR > ancientMaxR, "modern range > ancient (small diameter)",
           "modernR=" + modernMaxR.toFixed(1) + " ancientR=" + ancientMaxR.toFixed(1));
}

function test_aircraft_catapult_highest_range() {
    var results = TP.compareTrebuchetTypes({
        baseVelocity: 35, massKg: 10, launchAngleDeg: 45, diameterM: 0.01, dragCd: 0.2
    });
    assert(results[0].typeId === "modern_aircraft_catapult",
           "aircraft_catapult is #1",
           "got " + results[0].typeId);
}

function test_ancient_traction_lowest_ancient() {
    var results = TP.compareTrebuchetTypes({
        baseVelocity: 35, massKg: 10, launchAngleDeg: 45
    });
    var ancientMin = Infinity, tractionRange = 0;
    results.forEach(function(r) {
        if (r.era === "ancient") {
            ancientMin = Math.min(ancientMin, r.predictedRange);
            if (r.typeId === "ancient_traction") tractionRange = r.predictedRange;
        }
    });
    assert(approxEq(tractionRange, ancientMin, 1.0),
           "ancient_traction lowest among ancient",
           "traction=" + tractionRange.toFixed(1) + " min=" + ancientMin.toFixed(1));
}

function test_velocity_boost_effective() {
    var results = TP.compareTrebuchetTypes({
        baseVelocity: 35, massKg: 10, launchAngleDeg: 45
    });
    var aircraftVel = 0;
    results.forEach(function(r) {
        if (r.typeId === "modern_aircraft_catapult") aircraftVel = r.adjustedVelocity;
    });
    var expected = 35 * 5.0 * 0.98;
    assert(approxEq(aircraftVel, expected, 1.0),
           "aircraft adjustedVelocity = 35*5.0*0.98",
           "got " + aircraftVel.toFixed(2) + " expected " + expected.toFixed(2));
}

function test_mass_multiplier_effective() {
    var results = TP.compareTrebuchetTypes({
        baseVelocity: 35, massKg: 10, launchAngleDeg: 45
    });
    var cwMass = 0;
    results.forEach(function(r) {
        if (r.typeId === "ancient_counterweight") cwMass = r.adjustedMass;
    });
    assert(approxEq(cwMass, 3.0, 0.01),
           "counterweight adjustedMass = 10*0.3",
           "got " + cwMass);
}

function test_zero_base_velocity() {
    var results = TP.compareTrebuchetTypes({
        baseVelocity: 0, massKg: 10, launchAngleDeg: 45
    });
    results.forEach(function(r) {
        assert(r.predictedRange < 1.0, r.typeId + " range ~0 at v=0",
               "range=" + r.predictedRange.toFixed(4));
    });
}

function test_very_high_velocity() {
    var results = TP.compareTrebuchetTypes({
        baseVelocity: 300, massKg: 10, launchAngleDeg: 45
    });
    results.forEach(function(r) {
        assertFinite(r.predictedRange, r.typeId + " range finite at v=300");
    });
}

function test_very_small_diameter() {
    var results = TP.compareTrebuchetTypes({
        baseVelocity: 35, massKg: 10, launchAngleDeg: 45, diameterM: 0.01
    });
    assert(results.length === 5, "5 results with small diameter");
}

function test_negative_velocity() {
    var results = TP.compareTrebuchetTypes({
        baseVelocity: -10, massKg: 10, launchAngleDeg: 45
    });
    assert(results.length === 5, "5 results despite negative velocity");
    results.forEach(function(r) {
        assertFinite(r.predictedRange, r.typeId + " finite on negative v");
    });
}

function test_missing_optional_params() {
    var results = TP.compareTrebuchetTypes({
        baseVelocity: 35, massKg: 10, launchAngleDeg: 45
    });
    assert(results.length === 5, "works without optional diameterM/dragCd");
}

// =====================================================================
// Category 3: Preload Optimization - Range Maximization
// =====================================================================

function test_baseline_at_zero_preload() {
    var result = TP.analyzePreloadEffect({
        maxPreloadAngleDeg: 120, totalTorsionAngleDeg: 360,
        massKg: 10, launchAngleDeg: 45,
        wireDiameterMm: 20, meanDiameterMm: 150, activeCoils: 12,
        materialId: "steel65mn", steps: 20
    });
    assert(result.points.length > 0, "has points");
    assert(approxEq(result.points[0].preloadAngleDeg, 0, 0.01),
           "first point preload=0",
           "got " + result.points[0].preloadAngleDeg);
    assert(approxEq(result.points[0].rangeM, result.baselineRangeM, 1.0),
           "first point range = baseline",
           "point=" + result.points[0].rangeM.toFixed(2) + " base=" + result.baselineRangeM.toFixed(2));
}

function test_preload_improves_range() {
    var result = TP.analyzePreloadEffect({
        maxPreloadAngleDeg: 120, totalTorsionAngleDeg: 360,
        massKg: 10, launchAngleDeg: 45,
        wireDiameterMm: 20, meanDiameterMm: 150, activeCoils: 12,
        materialId: "steel65mn", steps: 20
    });
    assert(result.maxRangeM >= result.baselineRangeM - 1.0,
           "maxRange >= baseline",
           "max=" + result.maxRangeM.toFixed(1) + " base=" + result.baselineRangeM.toFixed(1));
}

function test_points_count_matches_steps() {
    var result = TP.analyzePreloadEffect({
        maxPreloadAngleDeg: 120, totalTorsionAngleDeg: 360,
        massKg: 10, launchAngleDeg: 45,
        wireDiameterMm: 20, meanDiameterMm: 150, activeCoils: 12,
        materialId: "steel65mn", steps: 20
    });
    assert(result.points.length === 21, "21 points for steps=20",
           "got " + result.points.length);
}

function test_best_preload_within_range() {
    var result = TP.analyzePreloadEffect({
        maxPreloadAngleDeg: 120, totalTorsionAngleDeg: 360,
        massKg: 10, launchAngleDeg: 45,
        wireDiameterMm: 20, meanDiameterMm: 150, activeCoils: 12,
        materialId: "steel65mn", steps: 20
    });
    assert(result.bestPreloadAngleDeg >= -0.01,
           "bestPreload >= 0",
           "got " + result.bestPreloadAngleDeg);
    assert(result.bestPreloadAngleDeg <= 120.01,
           "bestPreload <= maxPreloadAngle",
           "got " + result.bestPreloadAngleDeg);
}

function test_improvement_percent_positive() {
    var result = TP.analyzePreloadEffect({
        maxPreloadAngleDeg: 120, totalTorsionAngleDeg: 360,
        massKg: 10, launchAngleDeg: 45,
        wireDiameterMm: 20, meanDiameterMm: 150, activeCoils: 12,
        materialId: "steel65mn", steps: 20
    });
    assert(result.improvementPercent >= -0.1,
           "improvement >= 0",
           "got " + result.improvementPercent.toFixed(2) + "%");
}

function test_efficiency_increases_with_preload() {
    var result = TP.analyzePreloadEffect({
        maxPreloadAngleDeg: 120, totalTorsionAngleDeg: 360,
        massKg: 10, launchAngleDeg: 45,
        wireDiameterMm: 20, meanDiameterMm: 150, activeCoils: 12,
        materialId: "steel65mn", steps: 20
    });
    var eff0 = result.points[0].efficiency;
    var effLast = result.points[result.points.length - 1].efficiency;
    assert(effLast >= eff0 - 0.001,
           "efficiency increases with preload",
           "eff0=" + eff0.toFixed(4) + " effLast=" + effLast.toFixed(4));
    assert(result.maxRangeM >= result.baselineRangeM - 1.0,
           "bestRange >= baseline (optimization works)",
           "best=" + result.maxRangeM.toFixed(1) + " base=" + result.baselineRangeM.toFixed(1));
    assert(result.bestPreloadAngleDeg > 0,
           "optimal preload > 0 (preload provides benefit)",
           "bestPreload=" + result.bestPreloadAngleDeg.toFixed(1));
}

function test_material_sensitivity() {
    var resultSteel = TP.analyzePreloadEffect({
        maxPreloadAngleDeg: 120, totalTorsionAngleDeg: 360,
        massKg: 10, launchAngleDeg: 45,
        wireDiameterMm: 20, meanDiameterMm: 150, activeCoils: 12,
        materialId: "steel65mn", steps: 10
    });
    var resultHemp = TP.analyzePreloadEffect({
        maxPreloadAngleDeg: 120, totalTorsionAngleDeg: 360,
        massKg: 10, launchAngleDeg: 45,
        wireDiameterMm: 20, meanDiameterMm: 150, activeCoils: 12,
        materialId: "hemp_rope", steps: 10
    });
    assert(resultSteel.baselineRangeM > resultHemp.baselineRangeM,
           "steel65mn baseline > hemp_rope",
           "steel=" + resultSteel.baselineRangeM.toFixed(1) + " hemp=" + resultHemp.baselineRangeM.toFixed(1));
}

function test_zero_max_preload() {
    var result = TP.analyzePreloadEffect({
        maxPreloadAngleDeg: 0, totalTorsionAngleDeg: 360,
        massKg: 10, launchAngleDeg: 45,
        wireDiameterMm: 20, meanDiameterMm: 150, activeCoils: 12,
        materialId: "steel65mn", steps: 20
    });
    assert(result.points.length >= 1, "at least 1 point");
    result.points.forEach(function(p) {
        assert(approxZero(p.preloadAngleDeg, 0.1), "preload ~0 when max=0");
    });
    assert(approxEq(result.maxRangeM, result.baselineRangeM, 1.0),
           "maxRange = baseline when maxPreload=0");
}

function test_preload_equals_total() {
    var result = TP.analyzePreloadEffect({
        maxPreloadAngleDeg: 360, totalTorsionAngleDeg: 360,
        massKg: 10, launchAngleDeg: 45,
        wireDiameterMm: 20, meanDiameterMm: 150, activeCoils: 12,
        materialId: "steel65mn", steps: 10
    });
    assert(result.points.length >= 2, "at least 2 points");
    result.points.forEach(function(p) {
        assertFinite(p.rangeM, "range finite at preload=" + p.preloadAngleDeg.toFixed(1));
    });
}

function test_single_step() {
    var result = TP.analyzePreloadEffect({
        maxPreloadAngleDeg: 90, totalTorsionAngleDeg: 360,
        massKg: 10, launchAngleDeg: 45,
        wireDiameterMm: 20, meanDiameterMm: 150, activeCoils: 12,
        materialId: "steel65mn", steps: 1
    });
    assert(result.points.length === 2, "2 points for steps=1",
           "got " + result.points.length);
}

function test_invalid_material_id() {
    var result = TP.analyzePreloadEffect({
        maxPreloadAngleDeg: 90, totalTorsionAngleDeg: 360,
        massKg: 10, launchAngleDeg: 45,
        wireDiameterMm: 20, meanDiameterMm: 150, activeCoils: 12,
        materialId: "nonexistent", steps: 5
    });
    assert(result.points.length > 0, "works with invalid materialId (degrades to steel65mn)");
}

function test_negative_max_preload() {
    var result = TP.analyzePreloadEffect({
        maxPreloadAngleDeg: -10, totalTorsionAngleDeg: 360,
        massKg: 10, launchAngleDeg: 45,
        wireDiameterMm: 20, meanDiameterMm: 150, activeCoils: 12,
        materialId: "steel65mn", steps: 5
    });
    assert(result.points.length >= 1, "at least 1 point with negative maxPreload");
}

// =====================================================================
// Category 4: Virtual Operation Strategy
// =====================================================================

function test_basic_launch() {
    var result = TP.virtualLaunch({
        torsionAngleDeg: 120, preloadAngleDeg: 0, massKg: 10,
        launchAngleDeg: 45, wireDiameterMm: 20, meanDiameterMm: 150,
        activeCoils: 12, materialId: "steel65mn"
    });
    assert(result.spring.storedEnergy > 0, "storedEnergy > 0", "got " + result.spring.storedEnergy);
    assert(result.releaseVelocity > 0, "releaseVelocity > 0", "got " + result.releaseVelocity);
    assert(result.trajectory.predictedRange > 0, "predictedRange > 0", "got " + result.trajectory.predictedRange);
}

function test_preload_enhances_launch() {
    var r0 = TP.virtualLaunch({
        torsionAngleDeg: 120, preloadAngleDeg: 0, massKg: 10,
        launchAngleDeg: 45, wireDiameterMm: 20, meanDiameterMm: 150,
        activeCoils: 12, materialId: "steel65mn"
    });
    var r30 = TP.virtualLaunch({
        torsionAngleDeg: 120, preloadAngleDeg: 30, massKg: 10,
        launchAngleDeg: 45, wireDiameterMm: 20, meanDiameterMm: 150,
        activeCoils: 12, materialId: "steel65mn"
    });
    assert(r30.spring.storedEnergy > r0.spring.storedEnergy,
           "preload=30 energy > preload=0",
           "e30=" + r30.spring.storedEnergy.toFixed(2) + " e0=" + r0.spring.storedEnergy.toFixed(2));
}

function test_heavier_projectile_shorter_range() {
    var r10 = TP.virtualLaunch({
        torsionAngleDeg: 120, preloadAngleDeg: 0, massKg: 10,
        launchAngleDeg: 45, wireDiameterMm: 20, meanDiameterMm: 150,
        activeCoils: 12, materialId: "steel65mn"
    });
    var r50 = TP.virtualLaunch({
        torsionAngleDeg: 120, preloadAngleDeg: 0, massKg: 50,
        launchAngleDeg: 45, wireDiameterMm: 20, meanDiameterMm: 150,
        activeCoils: 12, materialId: "steel65mn"
    });
    assert(r50.trajectory.predictedRange < r10.trajectory.predictedRange,
           "mass=50 range < mass=10",
           "r50=" + r50.trajectory.predictedRange.toFixed(1) + " r10=" + r10.trajectory.predictedRange.toFixed(1));
}

function test_optimal_angle_around_45() {
    var optAngle = TP.findOptimalLaunchAngle(
        { mass: 10, diameter: 0.2, crossSectionArea: 0.0314, dragCoefficientIncompressible: 0.47 },
        50, 1.0, 288.15
    );
    assert(optAngle >= 30 && optAngle <= 50,
           "optimal angle in [30, 50]",
           "got " + optAngle);
}

function test_ancient_material_shorter_range() {
    var rSteel = TP.virtualLaunch({
        torsionAngleDeg: 120, preloadAngleDeg: 0, massKg: 10,
        launchAngleDeg: 45, wireDiameterMm: 20, meanDiameterMm: 150,
        activeCoils: 12, materialId: "steel65mn"
    });
    var rHemp = TP.virtualLaunch({
        torsionAngleDeg: 120, preloadAngleDeg: 0, massKg: 10,
        launchAngleDeg: 45, wireDiameterMm: 20, meanDiameterMm: 150,
        activeCoils: 12, materialId: "hemp_rope"
    });
    assert(rHemp.trajectory.predictedRange < rSteel.trajectory.predictedRange,
           "hemp_rope range < steel65mn",
           "hemp=" + rHemp.trajectory.predictedRange.toFixed(1) + " steel=" + rSteel.trajectory.predictedRange.toFixed(1));
}

function test_trajectory_points_nonempty() {
    var result = TP.virtualLaunch({
        torsionAngleDeg: 120, preloadAngleDeg: 0, massKg: 10,
        launchAngleDeg: 45, wireDiameterMm: 20, meanDiameterMm: 150,
        activeCoils: 12, materialId: "steel65mn"
    });
    assert(result.trajectoryPoints.length > 0, "trajectoryPoints nonempty");
    assert(result.trajectoryMachPoints.length > 0, "trajectoryMachPoints nonempty");
}

function test_landing_point_positive_x() {
    var result = TP.virtualLaunch({
        torsionAngleDeg: 120, preloadAngleDeg: 0, massKg: 10,
        launchAngleDeg: 45, wireDiameterMm: 20, meanDiameterMm: 150,
        activeCoils: 12, materialId: "steel65mn"
    });
    var last = result.trajectoryPoints[result.trajectoryPoints.length - 1];
    assert(last[0] > 0, "landing x > 0", "got " + last[0]);
}

function test_spring_constant_varies_by_material() {
    var rSteel = TP.virtualLaunch({
        torsionAngleDeg: 120, preloadAngleDeg: 0, massKg: 10,
        launchAngleDeg: 45, wireDiameterMm: 20, meanDiameterMm: 150,
        activeCoils: 12, materialId: "steel65mn"
    });
    var rHemp = TP.virtualLaunch({
        torsionAngleDeg: 120, preloadAngleDeg: 0, massKg: 10,
        launchAngleDeg: 45, wireDiameterMm: 20, meanDiameterMm: 150,
        activeCoils: 12, materialId: "hemp_rope"
    });
    assert(rSteel.spring.springConstant !== rHemp.spring.springConstant,
           "springConstant differs by material",
           "steel=" + rSteel.spring.springConstant + " hemp=" + rHemp.spring.springConstant);
}

function test_stress_increases_with_angle() {
    var r90 = TP.virtualLaunch({
        torsionAngleDeg: 90, preloadAngleDeg: 0, massKg: 10,
        launchAngleDeg: 45, wireDiameterMm: 20, meanDiameterMm: 150,
        activeCoils: 12, materialId: "steel65mn"
    });
    var r180 = TP.virtualLaunch({
        torsionAngleDeg: 180, preloadAngleDeg: 0, massKg: 10,
        launchAngleDeg: 45, wireDiameterMm: 20, meanDiameterMm: 150,
        activeCoils: 12, materialId: "steel65mn"
    });
    assert(r180.spring.shearStress > r90.spring.shearStress,
           "180deg stress > 90deg stress",
           "s180=" + r180.spring.shearStress.toFixed(1) + " s90=" + r90.spring.shearStress.toFixed(1));
}

function test_zero_preload_zero_torsion() {
    var result = TP.virtualLaunch({
        torsionAngleDeg: 0, preloadAngleDeg: 0, massKg: 10,
        launchAngleDeg: 45, wireDiameterMm: 20, meanDiameterMm: 150,
        activeCoils: 12, materialId: "steel65mn"
    });
    assert(approxZero(result.spring.storedEnergy, 10), "storedEnergy ~0", "got " + result.spring.storedEnergy);
    assert(result.releaseVelocity < 1.0, "releaseVelocity ~0", "got " + result.releaseVelocity);
}

function test_very_light_projectile() {
    var result = TP.virtualLaunch({
        torsionAngleDeg: 120, preloadAngleDeg: 0, massKg: 0.01,
        launchAngleDeg: 45, wireDiameterMm: 20, meanDiameterMm: 150,
        activeCoils: 12, materialId: "steel65mn"
    });
    assertFinite(result.trajectory.predictedRange, "range finite for m=0.01");
}

function test_extreme_angle() {
    var result = TP.virtualLaunch({
        torsionAngleDeg: 120, preloadAngleDeg: 0, massKg: 10,
        launchAngleDeg: 85, wireDiameterMm: 20, meanDiameterMm: 150,
        activeCoils: 12, materialId: "steel65mn"
    });
    assertFinite(result.trajectory.predictedRange, "range finite at 85deg launch");
}

function test_minimal_spring() {
    var result = TP.virtualLaunch({
        torsionAngleDeg: 120, preloadAngleDeg: 0, massKg: 10,
        launchAngleDeg: 45, wireDiameterMm: 1, meanDiameterMm: 10,
        activeCoils: 1, materialId: "steel65mn"
    });
    assertFinite(result.spring.storedEnergy, "energy finite for minimal spring");
}

function test_invalid_material() {
    var result = TP.virtualLaunch({
        torsionAngleDeg: 120, preloadAngleDeg: 0, massKg: 10,
        launchAngleDeg: 45, wireDiameterMm: 20, meanDiameterMm: 150,
        activeCoils: 12, materialId: "unknown"
    });
    assertFinite(result.spring.storedEnergy, "energy finite with invalid material (degrade)");
}

function test_zero_mass() {
    var result = TP.virtualLaunch({
        torsionAngleDeg: 120, preloadAngleDeg: 0, massKg: 0,
        launchAngleDeg: 45, wireDiameterMm: 20, meanDiameterMm: 150,
        activeCoils: 12, materialId: "steel65mn"
    });
    assert(true, "no crash with mass=0 (div-by-zero protection)");
}

function test_negative_angle() {
    var result = TP.virtualLaunch({
        torsionAngleDeg: 120, preloadAngleDeg: 0, massKg: 10,
        launchAngleDeg: -5, wireDiameterMm: 20, meanDiameterMm: 150,
        activeCoils: 12, materialId: "steel65mn"
    });
    assertFinite(result.spring.storedEnergy, "energy finite with negative launch angle");
}

// =====================================================================
// Run all tests
// =====================================================================

var categories = [
    {
        name: "一、材料对比验证储能密度",
        tests: [
            test_seven_materials_all_computed,
            test_modern_higher_energy_than_ancient,
            test_era_field_correct,
            test_ranking_sorted_by_range,
            test_modern_steel_top_two,
            test_energy_proportional_to_shear_modulus,
            test_zero_torsion_angle,
            test_very_small_mass,
            test_very_large_angle,
            test_negative_torsion_angle,
            test_missing_params_no_crash
        ]
    },
    {
        name: "二、跨时代对比验证射程提升",
        tests: [
            test_five_types_all_computed,
            test_modern_outranges_ancient,
            test_aircraft_catapult_highest_range,
            test_ancient_traction_lowest_ancient,
            test_velocity_boost_effective,
            test_mass_multiplier_effective,
            test_zero_base_velocity,
            test_very_high_velocity,
            test_very_small_diameter,
            test_negative_velocity,
            test_missing_optional_params
        ]
    },
    {
        name: "三、预紧力优化验证射程最大化",
        tests: [
            test_baseline_at_zero_preload,
            test_preload_improves_range,
            test_points_count_matches_steps,
            test_best_preload_within_range,
            test_improvement_percent_positive,
            test_efficiency_increases_with_preload,
            test_material_sensitivity,
            test_zero_max_preload,
            test_preload_equals_total,
            test_single_step,
            test_invalid_material_id,
            test_negative_max_preload
        ]
    },
    {
        name: "四、虚拟操作策略性测试",
        tests: [
            test_basic_launch,
            test_preload_enhances_launch,
            test_heavier_projectile_shorter_range,
            test_optimal_angle_around_45,
            test_ancient_material_shorter_range,
            test_trajectory_points_nonempty,
            test_landing_point_positive_x,
            test_spring_constant_varies_by_material,
            test_stress_increases_with_angle,
            test_zero_preload_zero_torsion,
            test_very_light_projectile,
            test_extreme_angle,
            test_minimal_spring,
            test_invalid_material,
            test_zero_mass,
            test_negative_angle
        ]
    }
];

var startTime = Date.now();

console.log("========================================");
console.log("  Trebuchet Physics Unit Tests (JS)");
console.log("========================================");

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

console.log("\n========================================");
console.log("  Summary");
console.log("========================================");
console.log("  Total:  " + total);
console.log("  PASS:   " + g_pass);
console.log("  FAIL:   " + g_fail);
console.log("  ERROR:  " + g_error);
console.log("  Time:   " + elapsed + " ms");
console.log("========================================");

if (g_fail + g_error > 0) process.exit(1);
