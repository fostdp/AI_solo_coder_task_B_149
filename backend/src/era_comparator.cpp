#include "era_comparator.h"
#include <algorithm>

namespace trebuchet {
namespace modules {

EraComparator::EraComparator() = default;

void EraComparator::addTrebuchetType(const TrebuchetTypeSpec& spec) {
    types_.push_back(spec);
}

void EraComparator::clearTypes() {
    types_.clear();
}

std::vector<EraComparisonEntry> EraComparator::compare(
    double base_release_velocity,
    const physics::ProjectileConfig& base_projectile,
    double launch_angle_deg
) {
    std::vector<EraComparisonEntry> results;
    results.reserve(types_.size());

    for (const auto& t : types_) {
        double adjusted_vel = base_release_velocity * t.velocity_boost * t.efficiency_multiplier;
        adjusted_vel = std::max(0.0, adjusted_vel);

        double adjusted_mass = base_projectile.mass * t.mass_multiplier;
        adjusted_mass = std::max(1e-9, adjusted_mass);

        physics::ProjectileConfig proj_copy = base_projectile;
        proj_copy.mass = adjusted_mass;

        physics::RangePredictionResult traj_res = physics::predictTrajectoryRange(
            proj_copy, adjusted_vel, launch_angle_deg
        );

        EraComparisonEntry item;
        item.type_id = t.type_id;
        item.type_name = t.name;
        item.era = t.era;
        item.reference = t.reference;
        item.adjusted_velocity = adjusted_vel;
        item.adjusted_mass_kg = adjusted_mass;
        item.efficiency = t.efficiency_multiplier;
        item.predicted_range_m = traj_res.predicted_range;
        item.max_height_m = traj_res.max_height;
        item.flight_time_s = traj_res.flight_time;
        item.max_mach = traj_res.max_mach;
        item.impact_velocity = traj_res.impact_velocity;
        item.range_ranking = 0;
        results.push_back(item);
    }

    auto sorted = sortByRange(results, false);
    for (size_t i = 0; i < sorted.size(); ++i) {
        for (auto& r : results) {
            if (r.type_id == sorted[i].type_id) {
                r.range_ranking = static_cast<int>(i + 1);
                break;
            }
        }
    }

    return results;
}

std::vector<TrebuchetTypeSpec> EraComparator::getTypes() const {
    return types_;
}

std::vector<EraComparisonEntry> EraComparator::sortByRange(
    std::vector<EraComparisonEntry> entries,
    bool ascending
) {
    std::sort(entries.begin(), entries.end(),
        [ascending](const EraComparisonEntry& a, const EraComparisonEntry& b) {
            return ascending
                ? a.predicted_range_m < b.predicted_range_m
                : a.predicted_range_m > b.predicted_range_m;
        }
    );
    return entries;
}

std::vector<TrebuchetTypeSpec> EraComparator::getDefaultTypes() {
    return {
        {
            "ancient_traction",
            "古代人力牵引式",
            "ancient",
            "Marsden 1969, 'Greek and Roman Artillery: Technical Treatises'",
            1.0, 0.60, 1.0,
            55.0, 400.0, 1.5,
            "利用数十至上百人牵引绳索释放"
        },
        {
            "ancient_torsion",
            "古代扭力弹簧式",
            "ancient",
            "Schramm 1918, 'Die Geschütze der Griechen und Römer'",
            1.0, 0.85, 1.0,
            27.0, 375.0, 0.9,
            "利用扭绞的绳束/肌腱储能，罗马 scorpio 核心技术"
        },
        {
            "ancient_counterweight",
            "古代配重式 trebuchet",
            "ancient",
            "Chevedden P.E. 1995, 'The Trebuchet'",
            1.0, 0.75, 0.3,
            90.0, 250.0, 2.0,
            "中世纪 trebuchet，重型配重臂带动投射"
        },
        {
            "modern_carriage_catapult",
            "现代车载电磁弹射器",
            "modern",
            "US Army EMALS-U Ground Test 2022, General Atomics",
            3.2, 0.92, 0.05,
            15.0, 5000.0, 25.0,
            "电磁线性电机驱动，无人机和靶机发射"
        },
        {
            "modern_aircraft_catapult",
            "现代航母电磁弹射器 EMALS",
            "modern",
            "US Navy EMALS Program 2023, Gerald R. Ford-class CVN-78",
            4.8, 0.95, 0.008,
            20000.0, 10000.0, 91.0,
            "航母舰载机使用，几十吨级短距起飞"
        }
    };
}

}
}
