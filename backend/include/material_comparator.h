#ifndef MATERIAL_COMPARATOR_H
#define MATERIAL_COMPARATOR_H

#include <string>
#include <vector>
#include <utility>
#include "trebuchet_physics.h"

namespace trebuchet {
namespace modules {

struct MaterialComparisonEntry {
    std::string material_id;
    std::string material_name;
    std::string era;
    std::string data_source;
    double stored_energy;
    double spring_constant;
    double shear_stress_mpa;
    double efficiency;
    double cyclic_damage_ratio;
    double predicted_range_m;
    double predicted_height_m;
    double flight_time_s;
    int range_ranking;
};

class MaterialComparator {
public:
    MaterialComparator();

    void setBaseConfig(const physics::TorsionSpringConfig& base);
    void setBaseProjectile(const physics::ProjectileConfig& proj);

    void addMaterial(const std::string& id, const physics::SpringMaterial& mat);
    void clearMaterials();

    std::vector<MaterialComparisonEntry> compare(
        double torsion_angle_rad,
        double projectile_mass_kg,
        double launch_angle_deg
    );

    std::vector<std::pair<std::string, physics::SpringMaterial>> getMaterials() const;

    static std::vector<MaterialComparisonEntry> sortByRange(
        std::vector<MaterialComparisonEntry> entries,
        bool ascending = false
    );

private:
    physics::TorsionSpringConfig base_config_;
    physics::ProjectileConfig base_projectile_;
    std::vector<std::pair<std::string, physics::SpringMaterial>> materials_;
};

}
}

#endif
