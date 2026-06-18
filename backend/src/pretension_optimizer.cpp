#include "pretension_optimizer.h"
#include <algorithm>
#include <cmath>

namespace trebuchet {
namespace modules {

PretensionOptimizer::PretensionOptimizer() = default;

void PretensionOptimizer::setSpringConfig(const physics::TorsionSpringConfig& config) {
    spring_config_ = config;
}

void PretensionOptimizer::setProjectile(const physics::ProjectileConfig& projectile) {
    projectile_ = projectile;
}

PreloadOptimizationResult PretensionOptimizer::analyzePreloadEffect(
    double torsion_angle_deg,
    double max_preload_angle_deg,
    double launch_angle_deg,
    int steps
) {
    PreloadOptimizationResult result;

    int safe_steps = std::max(2, steps);
    result.points.reserve(safe_steps);

    double torsion_rad = physics::convertDegToRad(torsion_angle_deg);
    torsion_rad = std::max(0.0, torsion_rad);

    double max_preload_rad = physics::convertDegToRad(max_preload_angle_deg);
    max_preload_rad = std::max(0.0, max_preload_rad);

    double safe_mass = std::max(1e-9, projectile_.mass);

    double max_range = 0.0;
    double best_preload_deg = 0.0;
    double baseline_range = 0.0;
    double baseline_eff = 0.0;
    double best_eff = 0.0;

    for (int i = 0; i < safe_steps; ++i) {
        double t = static_cast<double>(i) / static_cast<double>(safe_steps - 1);
        double preload_rad = t * max_preload_rad;

        physics::TorsionSpringConfig config_copy = spring_config_;
        config_copy.cyclic_state = physics::initializeCyclicState(spring_config_.material);

        physics::SpringEnergyResult energy_res = physics::calculateSpringEnergyWithPreload(
            config_copy, torsion_rad, preload_rad
        );

        double effective_energy = energy_res.stored_energy * energy_res.efficiency;
        double v_release = 0.0;
        if (effective_energy > 0.0) {
            v_release = std::sqrt(2.0 * effective_energy / safe_mass);
        }
        v_release = std::max(0.0, v_release);

        physics::ProjectileConfig proj_copy = projectile_;
        proj_copy.mass = safe_mass;
        physics::RangePredictionResult traj_res = physics::predictTrajectoryRange(
            proj_copy, v_release, launch_angle_deg
        );

        double preload_deg = physics::convertRadToDeg(preload_rad);

        PreloadAnalysisPoint point;
        point.preload_angle_deg = preload_deg;
        point.preload_angle_rad = preload_rad;
        point.stored_energy_j = energy_res.stored_energy;
        point.efficiency = energy_res.efficiency;
        point.release_velocity = v_release;
        point.predicted_range_m = traj_res.predicted_range;
        point.max_height_m = traj_res.max_height;
        point.flight_time_s = traj_res.flight_time;
        point.shear_stress_mpa = energy_res.shear_stress / 1e6;
        point.yield_ratio = energy_res.yield_strength_ratio;
        result.points.push_back(point);

        if (i == 0) {
            baseline_range = traj_res.predicted_range;
            baseline_eff = energy_res.efficiency;
        }
        if (traj_res.predicted_range > max_range) {
            max_range = traj_res.predicted_range;
            best_preload_deg = preload_deg;
            best_eff = energy_res.efficiency;
        }
    }

    result.baseline_range_m = baseline_range;
    result.max_range_m = max_range;
    result.optimal_preload_angle_deg = best_preload_deg;
    result.optimal_preload_angle_rad = physics::convertDegToRad(best_preload_deg);
    result.improvement_percent = baseline_range > 0.0
        ? ((max_range - baseline_range) / baseline_range) * 100.0
        : 0.0;
    result.baseline_efficiency = baseline_eff;
    result.optimal_efficiency = best_eff;

    return result;
}

TensioningSimulationResult PretensionOptimizer::simulateTensioning(
    double target_preload_angle_deg,
    int tensioning_stages,
    double stage_hold_time_sec,
    double overpull_deg
) {
    TensioningSimulationResult result;
    result.target_preload_angle_deg = target_preload_angle_deg;
    result.overpull_deg = overpull_deg;
    result.total_creep_deg = 0.0;

    int safe_stages = std::max(1, tensioning_stages);
    double safe_target = std::max(0.0, target_preload_angle_deg);
    double safe_overpull = std::max(0.0, overpull_deg);
    double safe_hold = std::max(0.1, stage_hold_time_sec);

    double total_pretension_deg = safe_target + safe_overpull;
    double deg_per_stage = total_pretension_deg / safe_stages;

    double relaxation_tau = spring_config_.material.relaxation_time_constant_sec;
    if (relaxation_tau <= 0.0) relaxation_tau = 1800.0;

    double creep_factor = spring_config_.material.effective_fiber_area_ratio > 0
        ? 0.02 * (1.0 - spring_config_.material.effective_fiber_area_ratio)
        : 0.005;

    double current_angle_deg = 0.0;
    double accumulated_creep_deg = 0.0;

    physics::TorsionSpringConfig config_copy = spring_config_;
    config_copy.cyclic_state = physics::initializeCyclicState(spring_config_.material);

    for (int i = 0; i < safe_stages; ++i) {
        TensioningStageDetail stage;
        stage.stage_index = i + 1;
        stage.hold_time_sec = safe_hold;
        stage.cumulative_creep_deg = accumulated_creep_deg;

        double target_stage_deg = deg_per_stage * (i + 1);
        stage.target_angle_deg = target_stage_deg;
        double pull_deg = target_stage_deg - current_angle_deg;
        pull_deg = std::max(0.0, pull_deg);

        current_angle_deg += pull_deg;
        stage.actual_angle_deg = current_angle_deg;

        double current_rad = physics::convertDegToRad(current_angle_deg);
        physics::SpringEnergyResult energy_res = physics::calculateSpringEnergyWithPreload(
            config_copy, 0.0, current_rad
        );

        stage.stress_mpa = energy_res.shear_stress / 1e6;

        double creep_settlement = pull_deg * creep_factor *
            (1.0 - std::exp(-safe_hold / relaxation_tau));
        creep_settlement *= (1.0 + 0.5 * static_cast<double>(i) / safe_stages);
        stage.creep_settlement_deg = creep_settlement;
        stage.creep_settlement_pct = (pull_deg > 0) ? (creep_settlement / pull_deg) * 100.0 : 0.0;

        accumulated_creep_deg += creep_settlement;
        stage.cumulative_creep_deg = accumulated_creep_deg;

        current_angle_deg -= creep_settlement;
        current_angle_deg = std::max(0.0, current_angle_deg);

        double residual_rad = physics::convertDegToRad(current_angle_deg);
        physics::SpringEnergyResult residual_res = physics::calculateSpringEnergyWithPreload(
            config_copy, 0.0, residual_rad
        );
        stage.residual_energy_j = residual_res.stored_energy;

        result.stages.push_back(stage);
    }

    double overpull_settlement = safe_overpull * creep_factor * 0.8;
    accumulated_creep_deg += overpull_settlement;

    result.total_creep_deg = accumulated_creep_deg;
    result.final_settled_angle_deg = std::max(0.0, safe_target - accumulated_creep_deg * 0.6);

    double initial_rad = physics::convertDegToRad(safe_target);
    physics::SpringEnergyResult initial_res = physics::calculateSpringEnergyWithPreload(
        config_copy, 0.0, initial_rad
    );
    result.initial_preload_energy_j = initial_res.stored_energy;

    double final_rad = physics::convertDegToRad(result.final_settled_angle_deg);
    physics::SpringEnergyResult final_res = physics::calculateSpringEnergyWithPreload(
        config_copy, 0.0, final_rad
    );
    result.final_preload_energy_j = final_res.stored_energy;
    result.efficiency_after_tensioning = final_res.efficiency;
    result.energy_loss_pct = result.initial_preload_energy_j > 0.0
        ? ((result.initial_preload_energy_j - result.final_preload_energy_j) / result.initial_preload_energy_j) * 100.0
        : 0.0;

    return result;
}

double PretensionOptimizer::findOptimalPreload(
    double torsion_angle_deg,
    double max_preload_angle_deg,
    double launch_angle_deg,
    int search_steps
) {
    auto result = analyzePreloadEffect(
        torsion_angle_deg, max_preload_angle_deg, launch_angle_deg, search_steps
    );
    return result.optimal_preload_angle_deg;
}

physics::TorsionSpringConfig PretensionOptimizer::getConfig() const {
    return spring_config_;
}

double PretensionOptimizer::computeEffectiveMass(double base_mass_kg) const {
    return std::max(1e-9, base_mass_kg);
}

}
}
