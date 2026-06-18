#include <iostream>
#include <cassert>
#include <cmath>
#include <vector>
#include <string>
#include <algorithm>
#include <chrono>
#include "../backend/include/trebuchet_physics.h"

using namespace trebuchet::physics;

static int g_pass = 0, g_fail = 0, g_error = 0;

#define TEST(name) void test_##name()

#define RUN_TEST(name)                                                         \
    do {                                                                        \
        std::cout << "  Running: " #name " ... ";                              \
        try {                                                                   \
            test_##name();                                                      \
            g_pass++;                                                           \
            std::cout << "PASS" << std::endl;                                   \
        } catch (const std::exception& e) {                                     \
            g_fail++;                                                           \
            std::cout << "FAIL (" << e.what() << ")" << std::endl;             \
        } catch (...) {                                                         \
            g_error++;                                                          \
            std::cout << "ERROR (unknown exception)" << std::endl;             \
        }                                                                       \
    } while (0)

static const double EPS = 1e-6;
static const double EPS_COARSE = 1e-3;
static const double EPS_RANGE = 1.0;

static bool approx_eq(double a, double b, double eps = EPS) {
    return std::abs(a - b) < eps;
}

static bool approx_zero(double v, double eps = EPS_COARSE) {
    return std::abs(v) < eps;
}

static TorsionSpringConfig makeDefaultConfig(const SpringMaterial& mat) {
    TorsionSpringConfig cfg{};
    cfg.wire_diameter = 0.01;
    cfg.coil_mean_diameter = 0.08;
    cfg.active_coils = 10;
    cfg.material = mat;
    cfg.cyclic_state = initializeCyclicState(mat);
    cfg.preload_angle_rad = 0.0;
    return cfg;
}

static ProjectileConfig makeDefaultProjectile(double mass = 10.0) {
    ProjectileConfig proj{};
    proj.mass = mass;
    proj.drag_coefficient_incompressible = 0.47;
    proj.cross_section_area = 0.005;
    proj.diameter = 0.08;
    return proj;
}

static ProjectileConfig makeSmallAreaProjectile(double mass = 10.0) {
    ProjectileConfig proj{};
    proj.mass = mass;
    proj.drag_coefficient_incompressible = 0.30;
    proj.cross_section_area = 0.001;
    proj.diameter = 0.04;
    return proj;
}

static std::vector<std::pair<std::string, SpringMaterial>> getAllMaterials() {
    return {
        {"steel65mn", STEEL_65MN},
        {"steel50crva", STEEL_50CRVA},
        {"sinew_ox", SINEW_OX},
        {"hemp_rope", HEMP_ROPE},
        {"ox_tendon", OX_TENDON},
        {"modern_synthetic", MODERN_SYNTHETIC},
        {"modern_steel_alloy", MODERN_STEEL_ALLOY}
    };
}

// =====================================================================
// Category 1: Material Comparison - Energy Storage Density
// =====================================================================

TEST(compare_materials_seven_entries) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto proj = makeDefaultProjectile();
    auto results = compareMaterials(cfg, getAllMaterials(), 1.0, 10.0, 45.0, proj);
    assert(results.size() == 7);
}

TEST(modern_era_higher_energy) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto proj = makeDefaultProjectile();
    auto results = compareMaterials(cfg, getAllMaterials(), 1.0, 10.0, 45.0, proj);

    double modern_sum = 0.0, ancient_sum = 0.0;
    int modern_count = 0, ancient_count = 0;
    for (const auto& r : results) {
        if (r.era == ERA_MODERN) {
            modern_sum += r.stored_energy;
            modern_count++;
        } else {
            ancient_sum += r.stored_energy;
            ancient_count++;
        }
    }
    assert(modern_count > 0 && ancient_count > 0);
    assert((modern_sum / modern_count) > (ancient_sum / ancient_count));
}

TEST(era_field_correct) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto proj = makeDefaultProjectile();
    auto materials = getAllMaterials();
    auto results = compareMaterials(cfg, materials, 1.0, 10.0, 45.0, proj);

    for (size_t i = 0; i < results.size(); ++i) {
        assert(results[i].era == materials[i].second.era);
    }
}

TEST(ranking_by_range) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto proj = makeDefaultProjectile();
    auto results = compareMaterials(cfg, getAllMaterials(), 1.0, 10.0, 45.0, proj);

    auto sorted = results;
    std::sort(sorted.begin(), sorted.end(),
              [](const MaterialComparisonResult& a, const MaterialComparisonResult& b) {
                  return a.predicted_range_m > b.predicted_range_m;
              });

    for (size_t i = 1; i < sorted.size(); ++i) {
        assert(sorted[i - 1].predicted_range_m >= sorted[i].predicted_range_m - EPS_RANGE);
    }
}

TEST(energy_proportional_to_G) {
    auto cfg_sinew = makeDefaultConfig(SINEW_OX);
    auto cfg_steel = makeDefaultConfig(STEEL_65MN);

    auto res_sinew = calculateSpringEnergy(cfg_sinew, 1.0);
    auto res_steel = calculateSpringEnergy(cfg_steel, 1.0);

    assert(res_sinew.stored_energy < res_steel.stored_energy);
}

TEST(steel_alloy_highest_stress) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto proj = makeDefaultProjectile();
    auto results = compareMaterials(cfg, getAllMaterials(), 1.0, 10.0, 45.0, proj);

    double max_stress = 0.0;
    for (const auto& r : results) {
        max_stress = std::max(max_stress, r.shear_stress_mpa);
    }

    bool found = false;
    for (const auto& r : results) {
        if (r.material_id == "modern_steel_alloy") {
            assert(approx_eq(r.shear_stress_mpa, max_stress, 0.01));
            found = true;
        }
    }
    assert(found);
}

TEST(zero_torsion) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto proj = makeDefaultProjectile();
    auto results = compareMaterials(cfg, getAllMaterials(), 0.0, 10.0, 45.0, proj);

    for (const auto& r : results) {
        assert(approx_zero(r.stored_energy, EPS_COARSE));
    }
}

TEST(very_small_torsion) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto proj = makeDefaultProjectile();
    auto results = compareMaterials(cfg, getAllMaterials(), 0.001, 10.0, 45.0, proj);

    for (const auto& r : results) {
        assert(std::isfinite(r.stored_energy));
        assert(std::isfinite(r.predicted_range_m));
        assert(std::isfinite(r.shear_stress_mpa));
    }
}

TEST(empty_materials_vector) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto proj = makeDefaultProjectile();
    auto results = compareMaterials(cfg, {}, 1.0, 10.0, 45.0, proj);
    assert(results.empty());
}

TEST(negative_torsion) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto proj = makeDefaultProjectile();
    auto results = compareMaterials(cfg, getAllMaterials(), -1.0, 10.0, 45.0, proj);
    assert(results.size() == 7);
    for (const auto& r : results) {
        assert(std::isfinite(r.stored_energy));
    }
}

// =====================================================================
// Category 2: Cross-era Comparison - Range Improvement
// =====================================================================

TEST(compare_trebuchets_five_entries) {
    auto proj = makeSmallAreaProjectile(50.0);
    auto results = compareTrebuchetTypes(proj, 30.0, 45.0);
    assert(results.size() == 5);
}

TEST(modern_outranges_ancient) {
    auto proj = makeSmallAreaProjectile(50.0);
    auto results = compareTrebuchetTypes(proj, 30.0, 45.0);

    double ancient_max = 0.0;
    double modern_min = 1e18;
    for (const auto& r : results) {
        if (r.era == ERA_ANCIENT) {
            ancient_max = std::max(ancient_max, r.predicted_range_m);
        } else {
            modern_min = std::min(modern_min, r.predicted_range_m);
        }
    }
    assert(modern_min > ancient_max);
}

TEST(aircraft_catapult_highest) {
    ProjectileConfig proj{};
    proj.mass = 50.0;
    proj.drag_coefficient_incompressible = 0.20;
    proj.cross_section_area = 0.0001;
    proj.diameter = 0.0113;
    auto results = compareTrebuchetTypes(proj, 30.0, 45.0);

    double max_range = 0.0;
    std::string max_id;
    for (const auto& r : results) {
        if (r.predicted_range_m > max_range) {
            max_range = r.predicted_range_m;
            max_id = r.type_id;
        }
    }
    assert(max_id == "modern_aircraft_catapult");
}

TEST(ancient_traction_lowest_among_ancient) {
    auto proj = makeSmallAreaProjectile(50.0);
    auto results = compareTrebuchetTypes(proj, 30.0, 45.0);

    double traction_range = 0.0;
    double ancient_min = 1e18;
    for (const auto& r : results) {
        if (r.era == ERA_ANCIENT) {
            ancient_min = std::min(ancient_min, r.predicted_range_m);
            if (r.type_id == "ancient_traction") {
                traction_range = r.predicted_range_m;
            }
        }
    }
    assert(approx_eq(traction_range, ancient_min, EPS_RANGE));
}

TEST(release_velocity_multiplier) {
    double base_vel = 30.0;
    auto proj = makeSmallAreaProjectile(50.0);
    auto results = compareTrebuchetTypes(proj, base_vel, 45.0);

    bool found = false;
    for (const auto& r : results) {
        if (r.type_id == "modern_aircraft_catapult") {
            double expected_vel = base_vel * 5.0 * 0.98;
            assert(approx_eq(r.release_velocity, expected_vel, EPS_COARSE));
            found = true;
        }
    }
    assert(found);
}

TEST(zero_base_velocity) {
    auto proj = makeSmallAreaProjectile(50.0);
    auto results = compareTrebuchetTypes(proj, 0.0, 45.0);

    for (const auto& r : results) {
        assert(r.predicted_range_m < EPS_RANGE);
    }
}

TEST(large_velocity) {
    auto proj = makeSmallAreaProjectile(50.0);
    auto results = compareTrebuchetTypes(proj, 200.0, 45.0);
    assert(results.size() == 5);
    for (const auto& r : results) {
        assert(std::isfinite(r.predicted_range_m));
    }
}

TEST(negative_velocity) {
    auto proj = makeSmallAreaProjectile(50.0);
    auto results = compareTrebuchetTypes(proj, -1.0, 45.0);
    assert(results.size() == 5);
    for (const auto& r : results) {
        assert(std::isfinite(r.predicted_range_m));
    }
}

// =====================================================================
// Category 3: Preload Optimization - Range Maximization
// =====================================================================

TEST(analyze_preload_returns_steps_plus_one) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto proj = makeDefaultProjectile();
    auto results = analyzePreloadEffect(cfg, 180.0, 90.0, 10.0, 45.0, proj, 20);
    assert(results.size() == 20);
}

TEST(first_point_is_baseline) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto proj = makeDefaultProjectile();
    auto results = analyzePreloadEffect(cfg, 180.0, 90.0, 10.0, 45.0, proj, 20);
    assert(!results.empty());
    assert(approx_zero(results.front().first, EPS_COARSE));
}

TEST(preload_effect_non_negative) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto proj = makeDefaultProjectile();
    auto results = analyzePreloadEffect(cfg, 180.0, 90.0, 10.0, 45.0, proj, 20);

    int non_negative_count = 0;
    for (const auto& pt : results) {
        if (pt.second >= -EPS_COARSE) non_negative_count++;
    }
    assert(non_negative_count >= static_cast<int>(results.size()) - 1);
}

TEST(optimal_preload_within_range) {
    double max_preload_deg = 90.0;
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto proj = makeDefaultProjectile();
    auto results = analyzePreloadEffect(cfg, 180.0, max_preload_deg, 10.0, 45.0, proj, 20);

    double best_range = -1e18;
    double best_preload = 0.0;
    for (const auto& pt : results) {
        if (pt.second > best_range) {
            best_range = pt.second;
            best_preload = pt.first;
        }
    }
    assert(best_preload >= -EPS_COARSE);
    assert(best_preload <= max_preload_deg + EPS_COARSE);
}

TEST(steel_vs_hemp_preload) {
    auto cfg_steel = makeDefaultConfig(STEEL_65MN);
    auto cfg_hemp = makeDefaultConfig(HEMP_ROPE);
    auto proj = makeDefaultProjectile();

    auto res_steel = analyzePreloadEffect(cfg_steel, 180.0, 90.0, 10.0, 45.0, proj, 20);
    auto res_hemp = analyzePreloadEffect(cfg_hemp, 180.0, 90.0, 10.0, 45.0, proj, 20);

    double steel_max = 0.0, hemp_max = 0.0;
    for (const auto& pt : res_steel) steel_max = std::max(steel_max, pt.second);
    for (const auto& pt : res_hemp) hemp_max = std::max(hemp_max, pt.second);

    assert(steel_max > hemp_max);
}

TEST(zero_max_preload) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto proj = makeDefaultProjectile();
    auto results = analyzePreloadEffect(cfg, 180.0, 0.0, 10.0, 45.0, proj, 20);
    assert(results.size() >= 1);
    for (const auto& pt : results) {
        assert(approx_zero(pt.first, EPS_COARSE));
    }
}

TEST(steps_one) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto proj = makeDefaultProjectile();
    auto results = analyzePreloadEffect(cfg, 180.0, 90.0, 10.0, 45.0, proj, 1);
    assert(results.size() == 2);
}

TEST(preload_exceeds_total) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto proj = makeDefaultProjectile();
    auto results = analyzePreloadEffect(cfg, 360.0, 400.0, 10.0, 45.0, proj, 20);
    assert(results.size() >= 2);
    for (const auto& pt : results) {
        assert(std::isfinite(pt.second));
    }
}

TEST(zero_steps) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto proj = makeDefaultProjectile();
    auto results = analyzePreloadEffect(cfg, 180.0, 90.0, 10.0, 45.0, proj, 0);
    assert(results.size() >= 1);
}

TEST(negative_max_preload) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto proj = makeDefaultProjectile();
    auto results = analyzePreloadEffect(cfg, 180.0, -10.0, 10.0, 45.0, proj, 20);
    assert(results.size() >= 1);
    for (const auto& pt : results) {
        assert(std::isfinite(pt.second));
    }
}

// =====================================================================
// Category 4: Virtual Operation Strategy
// =====================================================================

TEST(calculate_spring_energy_with_preload) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto result = calculateSpringEnergyWithPreload(cfg, 1.0, 0.5);
    assert(result.stored_energy > 0.0);
}

TEST(preload_increases_energy) {
    auto cfg1 = makeDefaultConfig(STEEL_65MN);
    auto cfg2 = makeDefaultConfig(STEEL_65MN);

    auto res_no_preload = calculateSpringEnergyWithPreload(cfg1, 1.0, 0.0);
    auto res_with_preload = calculateSpringEnergyWithPreload(cfg2, 1.0, 0.5);

    assert(res_with_preload.stored_energy > res_no_preload.stored_energy);
}

TEST(preload_boost_efficiency) {
    auto cfg1 = makeDefaultConfig(STEEL_65MN);
    auto cfg2 = makeDefaultConfig(STEEL_65MN);

    auto res_no_preload = calculateSpringEnergyWithPreload(cfg1, 1.0, 0.0);
    auto res_with_preload = calculateSpringEnergyWithPreload(cfg2, 1.0, 0.5);

    assert(res_with_preload.efficiency >= res_no_preload.efficiency - EPS_COARSE);
}

TEST(heavier_mass_shorter_range) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto result = calculateSpringEnergy(cfg, 1.0);
    double effective_energy = result.stored_energy * result.efficiency;

    double v_release = 0.0;
    if (effective_energy > 0.0) {
        double v10 = std::sqrt(2.0 * effective_energy / 10.0);
        double v50 = std::sqrt(2.0 * effective_energy / 50.0);

        auto proj10 = makeDefaultProjectile(10.0);
        auto proj50 = makeDefaultProjectile(50.0);

        auto range10 = predictTrajectoryRange(proj10, v10, 45.0);
        auto range50 = predictTrajectoryRange(proj50, v50, 45.0);

        assert(range50.predicted_range < range10.predicted_range);
    }
}

TEST(optimal_angle_near_45) {
    auto proj = makeDefaultProjectile();
    double angle = findOptimalLaunchAngle(proj, 50.0);
    assert(angle >= 30.0 && angle <= 50.0);
}

TEST(ancient_material_lower_energy) {
    auto cfg_sinew = makeDefaultConfig(SINEW_OX);
    auto cfg_steel = makeDefaultConfig(STEEL_65MN);

    auto res_sinew = calculateSpringEnergy(cfg_sinew, 1.0);
    auto res_steel = calculateSpringEnergy(cfg_steel, 1.0);

    assert(res_sinew.stored_energy < res_steel.stored_energy);
}

TEST(zero_preload_zero_torsion) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto result = calculateSpringEnergyWithPreload(cfg, 0.0, 0.0);
    assert(approx_zero(result.stored_energy, EPS_COARSE));
}

TEST(very_large_torsion) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto result = calculateSpringEnergyWithPreload(cfg, 6.28, 0.0);
    assert(std::isfinite(result.stored_energy));
    assert(std::isfinite(result.efficiency));
}

TEST(extreme_preload) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto result = calculateSpringEnergyWithPreload(cfg, 1.0, 2.0);
    assert(std::isfinite(result.stored_energy));
    assert(std::isfinite(result.efficiency));
}

TEST(negative_torsion_with_preload) {
    auto cfg = makeDefaultConfig(STEEL_65MN);
    auto result = calculateSpringEnergyWithPreload(cfg, -1.0, 0.5);
    assert(std::isfinite(result.stored_energy));
}

// =====================================================================
// Main
// =====================================================================

int main() {
    auto start = std::chrono::high_resolution_clock::now();

    std::cout << "========================================" << std::endl;
    std::cout << "  Trebuchet Physics Unit Tests (C++17)" << std::endl;
    std::cout << "========================================" << std::endl;

    std::cout << "\n--- Category 1: Material Comparison ---" << std::endl;
    RUN_TEST(compare_materials_seven_entries);
    RUN_TEST(modern_era_higher_energy);
    RUN_TEST(era_field_correct);
    RUN_TEST(ranking_by_range);
    RUN_TEST(energy_proportional_to_G);
    RUN_TEST(steel_alloy_highest_stress);
    RUN_TEST(zero_torsion);
    RUN_TEST(very_small_torsion);
    RUN_TEST(empty_materials_vector);
    RUN_TEST(negative_torsion);

    std::cout << "\n--- Category 2: Cross-era Trebuchet Comparison ---" << std::endl;
    RUN_TEST(compare_trebuchets_five_entries);
    RUN_TEST(modern_outranges_ancient);
    RUN_TEST(aircraft_catapult_highest);
    RUN_TEST(ancient_traction_lowest_among_ancient);
    RUN_TEST(release_velocity_multiplier);
    RUN_TEST(zero_base_velocity);
    RUN_TEST(large_velocity);
    RUN_TEST(negative_velocity);

    std::cout << "\n--- Category 3: Preload Optimization ---" << std::endl;
    RUN_TEST(analyze_preload_returns_steps_plus_one);
    RUN_TEST(first_point_is_baseline);
    RUN_TEST(preload_effect_non_negative);
    RUN_TEST(optimal_preload_within_range);
    RUN_TEST(steel_vs_hemp_preload);
    RUN_TEST(zero_max_preload);
    RUN_TEST(steps_one);
    RUN_TEST(preload_exceeds_total);
    RUN_TEST(zero_steps);
    RUN_TEST(negative_max_preload);

    std::cout << "\n--- Category 4: Virtual Operation Strategy ---" << std::endl;
    RUN_TEST(calculate_spring_energy_with_preload);
    RUN_TEST(preload_increases_energy);
    RUN_TEST(preload_boost_efficiency);
    RUN_TEST(heavier_mass_shorter_range);
    RUN_TEST(optimal_angle_near_45);
    RUN_TEST(ancient_material_lower_energy);
    RUN_TEST(zero_preload_zero_torsion);
    RUN_TEST(very_large_torsion);
    RUN_TEST(extreme_preload);
    RUN_TEST(negative_torsion_with_preload);

    auto end = std::chrono::high_resolution_clock::now();
    double elapsed_ms = std::chrono::duration<double, std::milli>(end - start).count();

    int total = g_pass + g_fail + g_error;
    std::cout << "\n========================================" << std::endl;
    std::cout << "  Summary" << std::endl;
    std::cout << "========================================" << std::endl;
    std::cout << "  Total:  " << total << std::endl;
    std::cout << "  PASS:   " << g_pass << std::endl;
    std::cout << "  FAIL:   " << g_fail << std::endl;
    std::cout << "  ERROR:  " << g_error << std::endl;
    std::cout << "  Time:   " << elapsed_ms << " ms" << std::endl;
    std::cout << "========================================" << std::endl;

    return (g_fail + g_error > 0) ? 1 : 0;
}
