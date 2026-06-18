#ifndef PRETENSION_OPTIMIZER_H
#define PRETENSION_OPTIMIZER_H

#include <vector>
#include <utility>
#include <string>
#include "trebuchet_physics.h"

namespace trebuchet {
namespace modules {

struct PreloadAnalysisPoint {
    double preload_angle_deg;
    double preload_angle_rad;
    double stored_energy_j;
    double efficiency;
    double release_velocity;
    double predicted_range_m;
    double max_height_m;
    double flight_time_s;
    double shear_stress_mpa;
    double yield_ratio;
};

struct PreloadOptimizationResult {
    std::vector<PreloadAnalysisPoint> points;
    double baseline_range_m;
    double max_range_m;
    double optimal_preload_angle_deg;
    double optimal_preload_angle_rad;
    double improvement_percent;
    double baseline_efficiency;
    double optimal_efficiency;
};

struct TensioningStageDetail {
    int stage_index;
    double target_angle_deg;
    double actual_angle_deg;
    double hold_time_sec;
    double stress_mpa;
    double creep_settlement_deg;
    double creep_settlement_pct;
    double residual_energy_j;
    double cumulative_creep_deg;
};

struct TensioningSimulationResult {
    double target_preload_angle_deg;
    double final_settled_angle_deg;
    double initial_preload_energy_j;
    double final_preload_energy_j;
    double efficiency_after_tensioning;
    double total_creep_deg;
    double overpull_deg;
    double energy_loss_pct;
    std::vector<TensioningStageDetail> stages;
};

class PretensionOptimizer {
public:
    PretensionOptimizer();

    void setSpringConfig(const physics::TorsionSpringConfig& config);
    void setProjectile(const physics::ProjectileConfig& projectile);

    PreloadOptimizationResult analyzePreloadEffect(
        double torsion_angle_deg,
        double max_preload_angle_deg,
        double launch_angle_deg,
        int steps = 20
    );

    TensioningSimulationResult simulateTensioning(
        double target_preload_angle_deg,
        int tensioning_stages = 4,
        double stage_hold_time_sec = 5.0,
        double overpull_deg = 5.0
    );

    double findOptimalPreload(
        double torsion_angle_deg,
        double max_preload_angle_deg,
        double launch_angle_deg,
        int search_steps = 50
    );

    physics::TorsionSpringConfig getConfig() const;

private:
    physics::TorsionSpringConfig spring_config_;
    physics::ProjectileConfig projectile_;

    double computeEffectiveMass(double base_mass_kg) const;
};

}
}

#endif
