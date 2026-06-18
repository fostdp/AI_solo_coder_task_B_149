#include "material_comparator.h"
#include <algorithm>

namespace trebuchet {
namespace modules {

MaterialComparator::MaterialComparator() {
    base_config_ = {};
    base_projectile_ = {};
}

void MaterialComparator::setBaseConfig(const physics::TorsionSpringConfig& base) {
    base_config_ = base;
}

void MaterialComparator::setBaseProjectile(const physics::ProjectileConfig& proj) {
    base_projectile_ = proj;
}

void MaterialComparator::addMaterial(const std::string& id, const physics::SpringMaterial& mat) {
    materials_.emplace_back(id, mat);
}

void MaterialComparator::clearMaterials() {
    materials_.clear();
}

std::vector<MaterialComparisonEntry> MaterialComparator::compare(
    double torsion_angle_rad,
    double projectile_mass_kg,
    double launch_angle_deg
) {
    std::vector<MaterialComparisonEntry> results;
    results.reserve(materials_.size());

    for (size_t i = 0; i < materials_.size(); ++i) {
        physics::TorsionSpringConfig config_copy = base_config_;
        config_copy.material = materials_[i].second;
        config_copy.cyclic_state = physics::initializeCyclicState(materials_[i].second);

        physics::SpringEnergyResult energy_res = physics::calculateSpringEnergy(
            config_copy, torsion_angle_rad
        );

        double safe_mass = std::max(1e-9, projectile_mass_kg);
        double effective_energy = energy_res.stored_energy * energy_res.efficiency;
        double v_release = 0.0;
        if (effective_energy > 0.0) {
            v_release = std::sqrt(2.0 * effective_energy / safe_mass);
        }
        v_release = std::max(0.0, v_release);

        physics::ProjectileConfig proj_copy = base_projectile_;
        proj_copy.mass = safe_mass;
        physics::RangePredictionResult traj_res = physics::predictTrajectoryRange(
            proj_copy, v_release, launch_angle_deg
        );

        MaterialComparisonEntry item;
        item.material_id = materials_[i].first;
        item.material_name = materials_[i].second.name;
        item.era = materials_[i].second.era;
        item.data_source = materials_[i].second.data_source;
        item.stored_energy = energy_res.stored_energy;
        item.spring_constant = energy_res.spring_constant;
        item.shear_stress_mpa = energy_res.shear_stress / 1e6;
        item.efficiency = energy_res.efficiency;
        item.cyclic_damage_ratio = energy_res.cyclic_damage_ratio;
        item.predicted_range_m = traj_res.predicted_range;
        item.predicted_height_m = traj_res.max_height;
        item.flight_time_s = traj_res.flight_time;
        item.range_ranking = 0;
        results.push_back(item);
    }

    auto sorted = sortByRange(results, false);
    for (size_t i = 0; i < sorted.size(); ++i) {
        for (auto& r : results) {
            if (r.material_id == sorted[i].material_id) {
                r.range_ranking = static_cast<int>(i + 1);
                break;
            }
        }
    }

    return results;
}

std::vector<std::pair<std::string, physics::SpringMaterial>> MaterialComparator::getMaterials() const {
    return materials_;
}

std::vector<MaterialComparisonEntry> MaterialComparator::sortByRange(
    std::vector<MaterialComparisonEntry> entries,
    bool ascending
) {
    std::sort(entries.begin(), entries.end(),
        [ascending](const MaterialComparisonEntry& a, const MaterialComparisonEntry& b) {
            return ascending
                ? a.predicted_range_m < b.predicted_range_m
                : a.predicted_range_m > b.predicted_range_m;
        }
    );
    return entries;
}

}
}
