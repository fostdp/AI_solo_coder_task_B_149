#ifndef TREBUCHET_PHYSICS_H
#define TREBUCHET_PHYSICS_H

#include <cmath>
#include <string>
#include <vector>

namespace trebuchet {
namespace physics {

struct SpringMaterial {
    double shear_modulus;
    double yield_strength;
    double density;
    double fatigue_ductility_coefficient;
    double fatigue_ductility_exponent;
    double cyclic_strength_coefficient;
    double cyclic_strength_exponent;
    double effective_fiber_area_ratio;
    double twist_strand_count;
    double moisture_content_pct;
    double relaxation_time_constant_sec;
    std::string name;
    std::string era;
    std::string data_source;
};

struct CyclicSofteningState {
    int cycle_count;
    double accumulated_plastic_strain;
    double degraded_shear_modulus;
    double degraded_yield_strength;
    double back_stress;
    double kinematic_hardening;
    double current_damage_parameter;
};

struct TorsionSpringConfig {
    double wire_diameter;
    double coil_mean_diameter;
    int active_coils;
    SpringMaterial material;
    CyclicSofteningState cyclic_state;
    double preload_angle_rad;
};

struct SpringEnergyResult {
    double stored_energy;
    double spring_constant;
    double shear_stress;
    double elastic_stress;
    double plastic_strain;
    double efficiency;
    double yield_strength_ratio;
    double cyclic_damage_ratio;
    double modulus_reduction;
    double back_stress_pa;
    double degraded_yield_strength_pa;
    int cycle_count;
    bool fracture_risk;
    bool fatigue_risk;
};

struct ProjectileConfig {
    double mass;
    double drag_coefficient_incompressible;
    double cross_section_area;
    double diameter;
};

struct TrajectoryResult {
    double predicted_range;
    double max_height;
    double flight_time;
    double impact_velocity;
    double impact_mach;
    double launch_angle_optimal;
    double max_mach;
    std::vector<std::pair<double, double>> trajectory_points;
    std::vector<std::pair<double, double>> mach_profile;
};

struct RangePredictionResult {
    double predicted_range;
    double max_height;
    double flight_time;
    double air_resistance_factor;
    double max_mach;
    double compressibility_correction;
    double impact_velocity;
    double impact_mach;
    double optimal_launch_angle_deg;
    double avg_compressibility_correction;
    double temperature_k;
    bool insufficient_range;
};

const SpringMaterial STEEL_65MN = {
    79.3e9,
    785e6,
    7850.0,
    0.42,
    -0.58,
    1300e6,
    -0.10,
    1.0,
    0.0,
    0.0,
    0.0,
    "65Mn弹簧钢",
    "modern",
    "GB/T 1222-2007 65Mn弹簧钢, ASTM A228 琴钢丝等效"
};

const SpringMaterial STEEL_50CRVA = {
    78.5e9,
    1080e6,
    7800.0,
    0.38,
    -0.55,
    1650e6,
    -0.08,
    1.0,
    0.0,
    0.0,
    0.0,
    "50CrVA弹簧钢",
    "modern",
    "GB/T 1222-2007 50CrVA, ASTM A231 铬钒弹簧钢"
};

const SpringMaterial SINEW_OX = {
    0.55e9,
    62e6,
    1180.0,
    2.4,
    -0.75,
    220e6,
    -0.15,
    0.72,
    12.0,
    12.0,
    1800.0,
    "黄牛肌腱(实验测定)",
    "ancient",
    "Marsden M.W. 1969 'Greek and Roman Artillery' + 现代生物力学肌腱测试"
};

const SpringMaterial HEMP_ROPE = {
    0.18e9,
    28e6,
    920.0,
    1.6,
    -0.68,
    120e6,
    -0.13,
    0.58,
    3.0,
    8.0,
    3600.0,
    "麻绳(实验测定)",
    "ancient",
    "ISO 2307:2010 纤维绳索测定 + 大英博物馆古罗马绳索分析"
};

const SpringMaterial OX_TENDON = {
    0.72e9,
    88e6,
    1150.0,
    2.8,
    -0.78,
    310e6,
    -0.14,
    0.78,
    16.0,
    10.0,
    2400.0,
    "牛筋(腱)(实验测定)",
    "ancient",
    "Schramm E. 1918 罗马弩炮修复实验 + 牛津大学考古系 2018 扭力材料对比"
};

const SpringMaterial MODERN_SYNTHETIC = {
    18e9,
    3600e6,
    1440.0,
    0.08,
    -0.40,
    5200e6,
    -0.05,
    0.95,
    0.0,
    0.0,
    0.0,
    "现代合成纤维(芳纶/Kevlar KM2)",
    "modern",
    "DuPont Kevlar® KM2 Technical Datasheet 2023, ASTM D7269/D885"
};

const SpringMaterial MODERN_STEEL_ALLOY = {
    82e9,
    2200e6,
    7830.0,
    0.35,
    -0.52,
    3200e6,
    -0.06,
    1.0,
    0.0,
    0.0,
    0.0,
    "现代合金钢弹簧(SAE 9254)",
    "modern",
    "SAE J408-2013 弹簧钢标准, ASTM A401/A877 铬硅弹簧钢丝"
};

const std::string ERA_ANCIENT = "ancient";
const std::string ERA_MODERN = "modern";

constexpr double GRAVITY = 9.80665;
constexpr double AIR_DENSITY = 1.225;
constexpr double OPTIMAL_RANGE_PERCENT = 0.85;
constexpr double SPEED_OF_SOUND = 343.2;
constexpr double SUTHERLAND_T0 = 273.15;
constexpr double SUTHERLAND_MU0 = 1.716e-5;
constexpr double SUTHERLAND_S = 110.4;

double calculateViscosity(double temperature_k);

double calculateMachNumber(double velocity, double temperature_k = 288.15);

double calculateCompressibleDragCoefficient(
    double mach_number,
    double incompressible_cd,
    double reynolds_number = 1e6
);

double calculatePrandtlGlauertCorrection(double mach_number);

double calculateTransonicWaveDrag(double mach_number);

double calculateSupersonicNewtonianDrag(double mach_number);

CyclicSofteningState initializeCyclicState(const SpringMaterial& material);

void updateCyclicSoftening(
    TorsionSpringConfig& config,
    double torsion_angle_rad,
    double shear_stress_amplitude
);

double calculateCoffinMansonLife(
    const SpringMaterial& material,
    double plastic_strain_amplitude
);

double calculateMinerDamage(
    CyclicSofteningState& state,
    double plastic_strain_amplitude,
    const SpringMaterial& material
);

SpringEnergyResult calculateSpringEnergy(
    TorsionSpringConfig& config,
    double torsion_angle_rad
);

double calculateSpringConstant(const TorsionSpringConfig& config);

double calculateShearStress(
    const TorsionSpringConfig& config,
    double torsion_angle_rad
);

double calculateSpringEfficiency(
    const TorsionSpringConfig& config,
    double torsion_angle_rad
);

RangePredictionResult predictTrajectoryRange(
    const ProjectileConfig& projectile,
    double release_velocity,
    double launch_angle_deg,
    double air_resistance_factor = 1.0,
    double temperature_k = 288.15
);

TrajectoryResult calculateFullTrajectory(
    const ProjectileConfig& projectile,
    double release_velocity,
    double launch_angle_deg,
    double air_resistance_factor = 1.0,
    double time_step = 0.01,
    double temperature_k = 288.15
);

double findOptimalLaunchAngle(
    const ProjectileConfig& projectile,
    double release_velocity,
    double air_resistance_factor = 1.0,
    double temperature_k = 288.15
);

double convertDegToRad(double deg);
double convertRadToDeg(double rad);

SpringEnergyResult calculateSpringEnergyWithPreload(TorsionSpringConfig& config, double torsion_angle_rad, double preload_angle_rad);

struct MaterialComparisonResult {
    std::string material_id;
    std::string material_name;
    std::string era;
    double stored_energy;
    double spring_constant;
    double shear_stress_mpa;
    double efficiency;
    double cyclic_damage_ratio;
    double predicted_range_m;
    double predicted_height_m;
    double flight_time_s;
};

std::vector<MaterialComparisonResult> compareMaterials(const TorsionSpringConfig& base_config, const std::vector<std::pair<std::string, SpringMaterial>>& materials, double torsion_angle_rad, double projectile_mass_kg, double launch_angle_deg, ProjectileConfig base_projectile);

struct TrebuchetComparisonResult {
    std::string type_id;
    std::string type_name;
    std::string era;
    double release_velocity;
    double predicted_range_m;
    double max_height_m;
    double flight_time_s;
    double max_mach;
    double impact_velocity;
    double projectile_mass_kg;
    double efficiency;
};

std::vector<TrebuchetComparisonResult> compareTrebuchetTypes(const ProjectileConfig& base_projectile, double base_release_velocity, double launch_angle_deg);

std::vector<std::pair<double, double>> analyzePreloadEffect(const TorsionSpringConfig& config, double torsion_angle_deg, double max_preload_angle_deg, double projectile_mass_kg, double launch_angle_deg, const ProjectileConfig& base_projectile, int steps = 20);

struct TensioningStage {
    int stage_index;
    double angle_deg;
    double hold_time_sec;
    double stress_mpa;
    double creep_settlement_pct;
    double residual_energy_j;
};

struct TensioningResult {
    double target_preload_angle_deg;
    double final_settled_angle_deg;
    double initial_preload_energy_j;
    double final_preload_energy_j;
    double efficiency_after_tensioning;
    double total_creep_deg;
    double overpull_deg;
    std::vector<TensioningStage> stages;
};

TensioningResult simulatePreloadTensioning(
    TorsionSpringConfig& config,
    double target_preload_angle_deg,
    int tensioning_stages = 4,
    double stage_hold_time_sec = 5.0,
    double overpull_deg = 5.0
);

}
}

#endif
