#ifndef ERA_COMPARATOR_H
#define ERA_COMPARATOR_H

#include <string>
#include <vector>
#include "trebuchet_physics.h"

namespace trebuchet {
namespace modules {

struct TrebuchetTypeSpec {
    std::string type_id;
    std::string name;
    std::string era;
    std::string reference;
    double velocity_boost;
    double efficiency_multiplier;
    double mass_multiplier;
    double typical_projectile_mass_kg;
    double typical_range_m;
    double max_draw_distance_m;
    std::string description;
};

struct EraComparisonEntry {
    std::string type_id;
    std::string type_name;
    std::string era;
    std::string reference;
    double adjusted_velocity;
    double adjusted_mass_kg;
    double efficiency;
    double predicted_range_m;
    double max_height_m;
    double flight_time_s;
    double max_mach;
    double impact_velocity;
    int range_ranking;
};

class EraComparator {
public:
    EraComparator();

    void addTrebuchetType(const TrebuchetTypeSpec& spec);
    void clearTypes();

    std::vector<EraComparisonEntry> compare(
        double base_release_velocity,
        const physics::ProjectileConfig& base_projectile,
        double launch_angle_deg
    );

    std::vector<TrebuchetTypeSpec> getTypes() const;

    static std::vector<EraComparisonEntry> sortByRange(
        std::vector<EraComparisonEntry> entries,
        bool ascending = false
    );

    static std::vector<TrebuchetTypeSpec> getDefaultTypes();

private:
    std::vector<TrebuchetTypeSpec> types_;
};

}
}

#endif
