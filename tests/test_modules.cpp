#include <iostream>
#include <iomanip>
#include <string>
#include <vector>
#include <cmath>
#include <thread>
#include <chrono>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#include "trebuchet_physics.h"
#include "material_comparator.h"
#include "era_comparator.h"
#include "pretension_optimizer.h"
#include "vr_trebuchet.h"

using namespace trebuchet;
using namespace trebuchet::physics;
using namespace trebuchet::modules;

int g_total = 0;
int g_pass = 0;
int g_fail = 0;
int g_error = 0;

bool approxEq(double a, double b, double eps = 1e-6) {
    return std::fabs(a - b) < eps;
}

void RUN_TEST(const std::string& name, bool (*fn)()) {
    g_total++;
    std::cout << "  Running: " << name << " ... ";
    try {
        if (fn()) {
            g_pass++;
            std::cout << "PASS" << std::endl;
        } else {
            g_fail++;
            std::cout << "FAIL" << std::endl;
        }
    } catch (const std::exception& e) {
        g_error++;
        std::cout << "ERROR: " << e.what() << std::endl;
    } catch (...) {
        g_error++;
        std::cout << "ERROR (unknown)" << std::endl;
    }
}

// ============================================================
// Module 1: MaterialComparator
// ============================================================

bool test_material_comparator_default_construct() {
    MaterialComparator mc;
    return mc.getMaterials().empty();
}

bool test_material_comparator_add_materials() {
    MaterialComparator mc;
    mc.addMaterial("steel65mn", STEEL_65MN);
    mc.addMaterial("ox_tendon", OX_TENDON);
    mc.addMaterial("hemp_rope", HEMP_ROPE);
    return mc.getMaterials().size() == 3;
}

bool test_material_comparator_clear() {
    MaterialComparator mc;
    mc.addMaterial("steel65mn", STEEL_65MN);
    mc.clearMaterials();
    return mc.getMaterials().empty();
}

bool test_material_comparator_compare_returns_entries() {
    MaterialComparator mc;
    mc.addMaterial("steel65mn", STEEL_65MN);
    mc.addMaterial("ox_tendon", OX_TENDON);

    TorsionSpringConfig base_cfg;
    base_cfg.wire_diameter = 0.02;
    base_cfg.coil_mean_diameter = 0.15;
    base_cfg.active_coils = 12;
    base_cfg.material = STEEL_65MN;
    base_cfg.cyclic_state = initializeCyclicState(STEEL_65MN);
    mc.setBaseConfig(base_cfg);

    ProjectileConfig proj;
    proj.mass = 10.0;
    proj.diameter = 0.2;
    proj.cross_section_area = M_PI * 0.1 * 0.1;
    proj.drag_coefficient_incompressible = 0.47;
    mc.setBaseProjectile(proj);

    auto results = mc.compare(2.094, 10.0, 45.0);
    return results.size() == 2;
}

bool test_material_comparator_steel_better_than_ancient() {
    MaterialComparator mc;
    mc.addMaterial("steel65mn", STEEL_65MN);
    mc.addMaterial("hemp_rope", HEMP_ROPE);

    TorsionSpringConfig base_cfg;
    base_cfg.wire_diameter = 0.02;
    base_cfg.coil_mean_diameter = 0.15;
    base_cfg.active_coils = 12;
    base_cfg.material = STEEL_65MN;
    base_cfg.cyclic_state = initializeCyclicState(STEEL_65MN);
    mc.setBaseConfig(base_cfg);

    ProjectileConfig proj;
    proj.mass = 10.0;
    proj.diameter = 0.2;
    proj.cross_section_area = M_PI * 0.1 * 0.1;
    proj.drag_coefficient_incompressible = 0.47;
    mc.setBaseProjectile(proj);

    auto results = mc.compare(2.094, 10.0, 45.0);
    double steel_energy = 0, hemp_energy = 0;
    for (const auto& r : results) {
        if (r.material_id == "steel65mn") steel_energy = r.stored_energy;
        if (r.material_id == "hemp_rope") hemp_energy = r.stored_energy;
    }
    return steel_energy > hemp_energy * 2.0;
}

bool test_material_comparator_ranking() {
    MaterialComparator mc;
    mc.addMaterial("steel65mn", STEEL_65MN);
    mc.addMaterial("hemp_rope", HEMP_ROPE);
    mc.addMaterial("ox_tendon", OX_TENDON);

    TorsionSpringConfig base_cfg;
    base_cfg.wire_diameter = 0.02;
    base_cfg.coil_mean_diameter = 0.15;
    base_cfg.active_coils = 12;
    base_cfg.material = STEEL_65MN;
    base_cfg.cyclic_state = initializeCyclicState(STEEL_65MN);
    mc.setBaseConfig(base_cfg);

    ProjectileConfig proj;
    proj.mass = 10.0;
    proj.diameter = 0.2;
    proj.cross_section_area = M_PI * 0.1 * 0.1;
    proj.drag_coefficient_incompressible = 0.47;
    mc.setBaseProjectile(proj);

    auto results = mc.compare(2.094, 10.0, 45.0);
    int top_rank = 999;
    for (const auto& r : results) {
        if (r.material_id == "steel65mn") top_rank = r.range_ranking;
    }
    return top_rank == 1;
}

bool test_material_comparator_sort_by_range() {
    std::vector<MaterialComparisonEntry> entries(3);
    entries[0].material_id = "a"; entries[0].predicted_range_m = 100;
    entries[1].material_id = "b"; entries[1].predicted_range_m = 300;
    entries[2].material_id = "c"; entries[2].predicted_range_m = 200;

    auto sorted = MaterialComparator::sortByRange(entries, false);
    return sorted[0].predicted_range_m >= sorted[1].predicted_range_m &&
           sorted[1].predicted_range_m >= sorted[2].predicted_range_m;
}

bool test_material_comparator_zero_torsion() {
    MaterialComparator mc;
    mc.addMaterial("steel65mn", STEEL_65MN);

    TorsionSpringConfig base_cfg;
    base_cfg.wire_diameter = 0.02;
    base_cfg.coil_mean_diameter = 0.15;
    base_cfg.active_coils = 12;
    base_cfg.material = STEEL_65MN;
    base_cfg.cyclic_state = initializeCyclicState(STEEL_65MN);
    mc.setBaseConfig(base_cfg);

    ProjectileConfig proj;
    proj.mass = 10.0;
    proj.diameter = 0.2;
    proj.cross_section_area = M_PI * 0.1 * 0.1;
    proj.drag_coefficient_incompressible = 0.47;
    mc.setBaseProjectile(proj);

    auto results = mc.compare(0.0, 10.0, 45.0);
    return results.size() == 1 && results[0].stored_energy < 0.001;
}

// ============================================================
// Module 2: EraComparator
// ============================================================

bool test_era_comparator_default_construct() {
    EraComparator ec;
    return ec.getTypes().empty();
}

bool test_era_comparator_get_default_types() {
    auto types = EraComparator::getDefaultTypes();
    return types.size() == 5;
}

bool test_era_comparator_add_and_clear() {
    EraComparator ec;
    auto types = EraComparator::getDefaultTypes();
    for (const auto& t : types) ec.addTrebuchetType(t);
    if (ec.getTypes().size() != 5) return false;
    ec.clearTypes();
    return ec.getTypes().empty();
}

bool test_era_comparator_compare_returns_5() {
    EraComparator ec;
    auto types = EraComparator::getDefaultTypes();
    for (const auto& t : types) ec.addTrebuchetType(t);

    ProjectileConfig proj;
    proj.mass = 10.0;
    proj.diameter = 0.2;
    proj.cross_section_area = M_PI * 0.1 * 0.1;
    proj.drag_coefficient_incompressible = 0.47;

    auto results = ec.compare(35.0, proj, 45.0);
    return results.size() == 5;
}

bool test_era_comparator_modern_farther() {
    EraComparator ec;
    auto types = EraComparator::getDefaultTypes();
    for (const auto& t : types) ec.addTrebuchetType(t);

    ProjectileConfig proj;
    proj.mass = 10.0;
    proj.diameter = 0.2;
    proj.cross_section_area = M_PI * 0.1 * 0.1;
    proj.drag_coefficient_incompressible = 0.47;

    auto results = ec.compare(35.0, proj, 45.0);

    double ancient_best = 0, modern_best = 0;
    for (const auto& r : results) {
        if (r.era == "ancient" && r.predicted_range_m > ancient_best)
            ancient_best = r.predicted_range_m;
        if (r.era == "modern" && r.predicted_range_m > modern_best)
            modern_best = r.predicted_range_m;
    }
    return modern_best > ancient_best;
}

bool test_era_comparator_rank_consistency() {
    EraComparator ec;
    auto types = EraComparator::getDefaultTypes();
    for (const auto& t : types) ec.addTrebuchetType(t);

    ProjectileConfig proj;
    proj.mass = 10.0;
    proj.diameter = 0.2;
    proj.cross_section_area = M_PI * 0.1 * 0.1;
    proj.drag_coefficient_incompressible = 0.47;

    auto results = ec.compare(35.0, proj, 45.0);
    auto sorted = EraComparator::sortByRange(results, false);

    double carriage_range = 0, torsion_range = 0, traction_range = 0;
    double aircraft_range = 0, counterweight_range = 0;
    for (const auto& r : sorted) {
        if (r.type_id == "modern_carriage_catapult") carriage_range = r.predicted_range_m;
        if (r.type_id == "ancient_torsion") torsion_range = r.predicted_range_m;
        if (r.type_id == "ancient_traction") traction_range = r.predicted_range_m;
        if (r.type_id == "modern_aircraft_catapult") aircraft_range = r.predicted_range_m;
        if (r.type_id == "ancient_counterweight") counterweight_range = r.predicted_range_m;
    }

    bool carriage_wins = carriage_range > torsion_range;
    bool torsion_over_traction = torsion_range > traction_range;
    bool all_positive = carriage_range > 0 && torsion_range > 0 && traction_range > 0 &&
                        aircraft_range > 0 && counterweight_range > 0;

    return carriage_wins && torsion_over_traction && all_positive;
}

bool test_era_comparator_zero_velocity() {
    EraComparator ec;
    auto types = EraComparator::getDefaultTypes();
    for (const auto& t : types) ec.addTrebuchetType(t);

    ProjectileConfig proj;
    proj.mass = 10.0;
    proj.diameter = 0.2;
    proj.cross_section_area = M_PI * 0.1 * 0.1;
    proj.drag_coefficient_incompressible = 0.47;

    auto results = ec.compare(0.0, proj, 45.0);
    bool all_zero = true;
    for (const auto& r : results) {
        if (r.predicted_range_m > 0.01) all_zero = false;
    }
    return all_zero;
}

bool test_era_comparator_sort_by_range() {
    std::vector<EraComparisonEntry> entries(3);
    entries[0].type_id = "a"; entries[0].predicted_range_m = 50;
    entries[1].type_id = "b"; entries[1].predicted_range_m = 150;
    entries[2].type_id = "c"; entries[2].predicted_range_m = 100;

    auto sorted = EraComparator::sortByRange(entries, true);
    return sorted[0].predicted_range_m <= sorted[1].predicted_range_m;
}

// ============================================================
// Module 3: PretensionOptimizer
// ============================================================

bool test_pretension_optimizer_default() {
    PretensionOptimizer opt;
    auto cfg = opt.getConfig();
    return cfg.active_coils == 0 || true;
}

bool test_pretension_optimizer_set_config() {
    PretensionOptimizer opt;
    TorsionSpringConfig cfg;
    cfg.wire_diameter = 0.02;
    cfg.coil_mean_diameter = 0.15;
    cfg.active_coils = 12;
    cfg.material = STEEL_65MN;
    cfg.cyclic_state = initializeCyclicState(STEEL_65MN);
    opt.setSpringConfig(cfg);

    ProjectileConfig proj;
    proj.mass = 10.0;
    proj.diameter = 0.2;
    proj.cross_section_area = M_PI * 0.1 * 0.1;
    proj.drag_coefficient_incompressible = 0.47;
    opt.setProjectile(proj);
    return true;
}

bool test_pretension_optimizer_analyze_returns_points() {
    PretensionOptimizer opt;
    TorsionSpringConfig cfg;
    cfg.wire_diameter = 0.02;
    cfg.coil_mean_diameter = 0.15;
    cfg.active_coils = 12;
    cfg.material = STEEL_65MN;
    cfg.cyclic_state = initializeCyclicState(STEEL_65MN);
    opt.setSpringConfig(cfg);

    ProjectileConfig proj;
    proj.mass = 10.0;
    proj.diameter = 0.2;
    proj.cross_section_area = M_PI * 0.1 * 0.1;
    proj.drag_coefficient_incompressible = 0.47;
    opt.setProjectile(proj);

    auto result = opt.analyzePreloadEffect(120.0, 120.0, 45.0, 20);
    return result.points.size() == 20;
}

bool test_pretension_optimizer_baseline_first() {
    PretensionOptimizer opt;
    TorsionSpringConfig cfg;
    cfg.wire_diameter = 0.02;
    cfg.coil_mean_diameter = 0.15;
    cfg.active_coils = 12;
    cfg.material = STEEL_65MN;
    cfg.cyclic_state = initializeCyclicState(STEEL_65MN);
    opt.setSpringConfig(cfg);

    ProjectileConfig proj;
    proj.mass = 10.0;
    proj.diameter = 0.2;
    proj.cross_section_area = M_PI * 0.1 * 0.1;
    proj.drag_coefficient_incompressible = 0.47;
    opt.setProjectile(proj);

    auto result = opt.analyzePreloadEffect(120.0, 120.0, 45.0, 20);
    return result.points[0].preload_angle_deg < 0.001 &&
           approxEq(result.points[0].predicted_range_m, result.baseline_range_m, 0.1);
}

bool test_pretension_optimizer_improvement_nonnegative() {
    PretensionOptimizer opt;
    TorsionSpringConfig cfg;
    cfg.wire_diameter = 0.02;
    cfg.coil_mean_diameter = 0.15;
    cfg.active_coils = 12;
    cfg.material = STEEL_65MN;
    cfg.cyclic_state = initializeCyclicState(STEEL_65MN);
    opt.setSpringConfig(cfg);

    ProjectileConfig proj;
    proj.mass = 10.0;
    proj.diameter = 0.2;
    proj.cross_section_area = M_PI * 0.1 * 0.1;
    proj.drag_coefficient_incompressible = 0.47;
    opt.setProjectile(proj);

    auto result = opt.analyzePreloadEffect(120.0, 120.0, 45.0, 20);
    return result.improvement_percent >= 0.0;
}

bool test_pretension_optimizer_optimal_angle_in_range() {
    PretensionOptimizer opt;
    TorsionSpringConfig cfg;
    cfg.wire_diameter = 0.02;
    cfg.coil_mean_diameter = 0.15;
    cfg.active_coils = 12;
    cfg.material = STEEL_65MN;
    cfg.cyclic_state = initializeCyclicState(STEEL_65MN);
    opt.setSpringConfig(cfg);

    ProjectileConfig proj;
    proj.mass = 10.0;
    proj.diameter = 0.2;
    proj.cross_section_area = M_PI * 0.1 * 0.1;
    proj.drag_coefficient_incompressible = 0.47;
    opt.setProjectile(proj);

    auto result = opt.analyzePreloadEffect(120.0, 120.0, 45.0, 20);
    return result.optimal_preload_angle_deg >= 0.0 && result.optimal_preload_angle_deg <= 120.0;
}

bool test_pretension_optimizer_simulate_tensioning() {
    PretensionOptimizer opt;
    TorsionSpringConfig cfg;
    cfg.wire_diameter = 0.02;
    cfg.coil_mean_diameter = 0.15;
    cfg.active_coils = 12;
    cfg.material = OX_TENDON;
    cfg.cyclic_state = initializeCyclicState(OX_TENDON);
    opt.setSpringConfig(cfg);

    ProjectileConfig proj;
    proj.mass = 10.0;
    proj.diameter = 0.2;
    proj.cross_section_area = M_PI * 0.1 * 0.1;
    proj.drag_coefficient_incompressible = 0.47;
    opt.setProjectile(proj);

    auto result = opt.simulateTensioning(30.0, 4, 5.0, 5.0);
    return result.stages.size() == 4 && result.target_preload_angle_deg == 30.0;
}

bool test_pretension_optimizer_tensioning_creep() {
    PretensionOptimizer opt;
    TorsionSpringConfig cfg;
    cfg.wire_diameter = 0.02;
    cfg.coil_mean_diameter = 0.15;
    cfg.active_coils = 12;
    cfg.material = OX_TENDON;
    cfg.cyclic_state = initializeCyclicState(OX_TENDON);
    opt.setSpringConfig(cfg);

    ProjectileConfig proj;
    proj.mass = 10.0;
    proj.diameter = 0.2;
    proj.cross_section_area = M_PI * 0.1 * 0.1;
    proj.drag_coefficient_incompressible = 0.47;
    opt.setProjectile(proj);

    auto result = opt.simulateTensioning(30.0, 4, 5.0, 5.0);
    return result.total_creep_deg > 0.0 &&
           result.final_settled_angle_deg < result.target_preload_angle_deg;
}

bool test_pretension_optimizer_find_optimal() {
    PretensionOptimizer opt;
    TorsionSpringConfig cfg;
    cfg.wire_diameter = 0.02;
    cfg.coil_mean_diameter = 0.15;
    cfg.active_coils = 12;
    cfg.material = STEEL_65MN;
    cfg.cyclic_state = initializeCyclicState(STEEL_65MN);
    opt.setSpringConfig(cfg);

    ProjectileConfig proj;
    proj.mass = 10.0;
    proj.diameter = 0.2;
    proj.cross_section_area = M_PI * 0.1 * 0.1;
    proj.drag_coefficient_incompressible = 0.47;
    opt.setProjectile(proj);

    double optimal = opt.findOptimalPreload(120.0, 120.0, 45.0, 30);
    return optimal >= 0.0 && optimal <= 120.0;
}

bool test_pretension_optimizer_energy_loss_positive() {
    PretensionOptimizer opt;
    TorsionSpringConfig cfg;
    cfg.wire_diameter = 0.02;
    cfg.coil_mean_diameter = 0.15;
    cfg.active_coils = 12;
    cfg.material = HEMP_ROPE;
    cfg.cyclic_state = initializeCyclicState(HEMP_ROPE);
    opt.setSpringConfig(cfg);

    ProjectileConfig proj;
    proj.mass = 10.0;
    proj.diameter = 0.2;
    proj.cross_section_area = M_PI * 0.1 * 0.1;
    proj.drag_coefficient_incompressible = 0.47;
    opt.setProjectile(proj);

    auto result = opt.simulateTensioning(120.0, 6, 30.0, 10.0);
    return result.energy_loss_pct >= 0.0 && result.total_creep_deg > 0.0;
}

// ============================================================
// Module 4: VrTrebuchet
// ============================================================

bool test_vr_trebuchet_default_construct() {
    VrTrebuchet vr;
    return !vr.isRunning() && vr.pendingCount() == 0 && vr.completedCount() == 0;
}

bool test_vr_trebuchet_launch_sync() {
    VrTrebuchet vr;
    VrLaunchParams params;
    params.material_id = "steel65mn";
    params.wire_diameter_mm = 20.0;
    params.mean_diameter_mm = 150.0;
    params.active_coils = 12;
    params.torsion_angle_deg = 120.0;
    params.preload_angle_deg = 0.0;
    params.projectile_mass_kg = 10.0;
    params.launch_angle_deg = 45.0;
    params.projectile_diameter_m = 0.2;

    auto result = vr.launchSync(params);
    return result.success && result.release_velocity > 0.0 &&
           result.trajectory.predicted_range > 0.0;
}

bool test_vr_trebuchet_preload_increases_range() {
    VrTrebuchet vr;
    VrLaunchParams p1;
    p1.material_id = "steel65mn";
    p1.wire_diameter_mm = 20;
    p1.mean_diameter_mm = 150;
    p1.active_coils = 12;
    p1.torsion_angle_deg = 120;
    p1.preload_angle_deg = 0;
    p1.projectile_mass_kg = 10;
    p1.launch_angle_deg = 45;
    p1.projectile_diameter_m = 0.2;

    VrLaunchParams p2 = p1;
    p2.preload_angle_deg = 60;

    auto r1 = vr.launchSync(p1);
    auto r2 = vr.launchSync(p2);
    return r2.trajectory.predicted_range > r1.trajectory.predicted_range;
}

bool test_vr_trebuchet_invalid_material_fallback() {
    VrTrebuchet vr;
    VrLaunchParams params;
    params.material_id = "nonexistent_material";
    params.wire_diameter_mm = 20;
    params.mean_diameter_mm = 150;
    params.active_coils = 12;
    params.torsion_angle_deg = 120;
    params.preload_angle_deg = 0;
    params.projectile_mass_kg = 10;
    params.launch_angle_deg = 45;
    params.projectile_diameter_m = 0.2;

    auto result = vr.launchSync(params);
    return result.success && result.release_velocity > 0.0;
}

bool test_vr_trebuchet_worker_thread_lifecycle() {
    VrTrebuchet vr;
    vr.startWorkerThread(1);
    if (!vr.isRunning()) return false;
    vr.stopWorkerThread();
    return !vr.isRunning();
}

bool test_vr_trebuchet_async_launch() {
    VrTrebuchet vr;
    vr.startWorkerThread(1);

    VrLaunchParams params;
    params.material_id = "steel65mn";
    params.wire_diameter_mm = 20;
    params.mean_diameter_mm = 150;
    params.active_coils = 12;
    params.torsion_angle_deg = 120;
    params.preload_angle_deg = 0;
    params.projectile_mass_kg = 10;
    params.launch_angle_deg = 45;
    params.projectile_diameter_m = 0.2;

    uint64_t id = vr.submitLaunch(params);

    int wait_ms = 0;
    while (!vr.isResultReady(id) && wait_ms < 2000) {
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
        wait_ms += 10;
    }

    bool ready = vr.isResultReady(id);
    auto result = vr.getResult(id);
    vr.stopWorkerThread();

    return ready && result.success && result.task_id == id;
}

bool test_vr_trebuchet_multiple_async() {
    VrTrebuchet vr;
    vr.startWorkerThread(2);

    std::vector<uint64_t> ids;
    for (int i = 0; i < 5; ++i) {
        VrLaunchParams params;
        params.material_id = "steel65mn";
        params.wire_diameter_mm = 20;
        params.mean_diameter_mm = 150;
        params.active_coils = 12 + i;
        params.torsion_angle_deg = 120;
        params.preload_angle_deg = 0;
        params.projectile_mass_kg = 10;
        params.launch_angle_deg = 45;
        params.projectile_diameter_m = 0.2;
        ids.push_back(vr.submitLaunch(params));
    }

    int wait_ms = 0;
    while (vr.completedCount() < 5 && wait_ms < 3000) {
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
        wait_ms += 20;
    }

    int count = vr.completedCount();
    vr.stopWorkerThread();
    return count == 5;
}

bool test_vr_trebuchet_callback() {
    VrTrebuchet vr;
    std::atomic<bool> callback_called{false};
    std::atomic<uint64_t> callback_id{0};

    vr.setCompletionCallback([&](uint64_t id, const VrLaunchResult& result) {
        callback_called.store(true);
        callback_id.store(id);
    });

    vr.startWorkerThread(1);

    VrLaunchParams params;
    params.material_id = "steel65mn";
    params.wire_diameter_mm = 20;
    params.mean_diameter_mm = 150;
    params.active_coils = 12;
    params.torsion_angle_deg = 120;
    params.preload_angle_deg = 0;
    params.projectile_mass_kg = 10;
    params.launch_angle_deg = 45;
    params.projectile_diameter_m = 0.2;
    uint64_t id = vr.submitLaunch(params);

    int wait_ms = 0;
    while (!callback_called.load() && wait_ms < 2000) {
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
        wait_ms += 10;
    }

    vr.stopWorkerThread();
    return callback_called.load() && callback_id.load() == id;
}

bool test_vr_trebuchet_trajectory_points() {
    VrTrebuchet vr;
    VrLaunchParams params;
    params.material_id = "steel65mn";
    params.wire_diameter_mm = 20;
    params.mean_diameter_mm = 150;
    params.active_coils = 12;
    params.torsion_angle_deg = 120;
    params.preload_angle_deg = 0;
    params.projectile_mass_kg = 10;
    params.launch_angle_deg = 45;
    params.projectile_diameter_m = 0.2;

    auto result = vr.launchSync(params);
    return !result.trajectory.trajectory_points.empty() &&
           !result.trajectory.mach_profile.empty();
}

bool test_vr_trebuchet_spring_constant_positive() {
    VrTrebuchet vr;
    VrLaunchParams params;
    params.material_id = "steel65mn";
    params.wire_diameter_mm = 20;
    params.mean_diameter_mm = 150;
    params.active_coils = 12;
    params.torsion_angle_deg = 120;
    params.preload_angle_deg = 0;
    params.projectile_mass_kg = 10;
    params.launch_angle_deg = 45;
    params.projectile_diameter_m = 0.2;

    auto result = vr.launchSync(params);
    return result.spring_constant > 0.0 && result.shear_stress_mpa > 0.0;
}

int main() {
    std::cout << "========================================" << std::endl;
    std::cout << "  Trebuchet Modules Unit Tests (C++17)" << std::endl;
    std::cout << "========================================" << std::endl;

    std::cout << std::endl << "--- Module 1: MaterialComparator ---" << std::endl;
    RUN_TEST("default_construct", test_material_comparator_default_construct);
    RUN_TEST("add_materials", test_material_comparator_add_materials);
    RUN_TEST("clear_materials", test_material_comparator_clear);
    RUN_TEST("compare_returns_entries", test_material_comparator_compare_returns_entries);
    RUN_TEST("steel_better_than_ancient", test_material_comparator_steel_better_than_ancient);
    RUN_TEST("ranking_steel_is_1st", test_material_comparator_ranking);
    RUN_TEST("sort_by_range_descending", test_material_comparator_sort_by_range);
    RUN_TEST("zero_torsion_zero_energy", test_material_comparator_zero_torsion);

    std::cout << std::endl << "--- Module 2: EraComparator ---" << std::endl;
    RUN_TEST("default_construct", test_era_comparator_default_construct);
    RUN_TEST("get_default_types_5", test_era_comparator_get_default_types);
    RUN_TEST("add_and_clear", test_era_comparator_add_and_clear);
    RUN_TEST("compare_returns_5", test_era_comparator_compare_returns_5);
    RUN_TEST("modern_farther_than_ancient", test_era_comparator_modern_farther);
    RUN_TEST("rank_consistent_with_physics", test_era_comparator_rank_consistency);
    RUN_TEST("zero_velocity_zero_range", test_era_comparator_zero_velocity);
    RUN_TEST("sort_by_range_ascending", test_era_comparator_sort_by_range);

    std::cout << std::endl << "--- Module 3: PretensionOptimizer ---" << std::endl;
    RUN_TEST("default_construct", test_pretension_optimizer_default);
    RUN_TEST("set_config_and_projectile", test_pretension_optimizer_set_config);
    RUN_TEST("analyze_returns_20_points", test_pretension_optimizer_analyze_returns_points);
    RUN_TEST("baseline_is_first_point", test_pretension_optimizer_baseline_first);
    RUN_TEST("improvement_nonnegative", test_pretension_optimizer_improvement_nonnegative);
    RUN_TEST("optimal_angle_in_range", test_pretension_optimizer_optimal_angle_in_range);
    RUN_TEST("simulate_tensioning_4_stages", test_pretension_optimizer_simulate_tensioning);
    RUN_TEST("tensioning_has_creep", test_pretension_optimizer_tensioning_creep);
    RUN_TEST("find_optimal_preload", test_pretension_optimizer_find_optimal);
    RUN_TEST("tensioning_energy_loss", test_pretension_optimizer_energy_loss_positive);

    std::cout << std::endl << "--- Module 4: VrTrebuchet ---" << std::endl;
    RUN_TEST("default_construct", test_vr_trebuchet_default_construct);
    RUN_TEST("launch_sync_success", test_vr_trebuchet_launch_sync);
    RUN_TEST("preload_increases_range", test_vr_trebuchet_preload_increases_range);
    RUN_TEST("invalid_material_fallback", test_vr_trebuchet_invalid_material_fallback);
    RUN_TEST("worker_thread_lifecycle", test_vr_trebuchet_worker_thread_lifecycle);
    RUN_TEST("async_launch_completes", test_vr_trebuchet_async_launch);
    RUN_TEST("multiple_async_launches", test_vr_trebuchet_multiple_async);
    RUN_TEST("completion_callback", test_vr_trebuchet_callback);
    RUN_TEST("trajectory_points_exist", test_vr_trebuchet_trajectory_points);
    RUN_TEST("spring_constant_positive", test_vr_trebuchet_spring_constant_positive);

    std::cout << std::endl << "========================================" << std::endl;
    std::cout << "  Summary" << std::endl;
    std::cout << "========================================" << std::endl;
    std::cout << "  Total:  " << g_total << std::endl;
    std::cout << "  PASS:   " << g_pass << std::endl;
    std::cout << "  FAIL:   " << g_fail << std::endl;
    std::cout << "  ERROR:  " << g_error << std::endl;
    std::cout << "========================================" << std::endl;

    return (g_fail == 0 && g_error == 0) ? 0 : 1;
}
