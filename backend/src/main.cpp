#include <iostream>
#include <string>
#include <memory>
#include <thread>
#include <chrono>
#include <csignal>
#include <atomic>
#include <mutex>
#include <algorithm>
#include <cmath>
#include <sstream>
#include <vector>
#include <map>

#include "message_bus.h"
#include "udp_receiver_module.h"
#include "spring_simulator_module.h"
#include "range_predictor_module.h"
#include "alarm_mqtt_module.h"
#include "trebuchet_physics.h"
#include "clickhouse_client.h"
#include "udp_sensor_receiver.h"
#include "mqtt_alert_manager.h"
#include "http_api_server.h"
#include "logger.h"
#include "metrics_collector.h"

namespace physics_ns = trebuchet::physics;
namespace alert_ns = trebuchet::alert;
namespace http_ns = trebuchet::http;
namespace storage_ns = trebuchet::storage;

using trebuchet::physics::TorsionSpringConfig;
using trebuchet::physics::ProjectileConfig;
using trebuchet::physics::SpringMaterial;
using trebuchet::physics::CyclicSofteningState;
using trebuchet::physics::STEEL_65MN;
using trebuchet::physics::initializeCyclicState;

static std::atomic<bool> g_running{true};
static std::mutex g_stdout_mutex;

static void signalHandler(int) { g_running = false; }

static constexpr double PI_VAL = 3.14159265358979323846;

static void printBanner() {
    std::lock_guard<std::mutex> lock(g_stdout_mutex);
    std::cout << "\n"
              << "  _______________________________  \n"
              << " / __/__  ____  ____ ___  _____  /__\n"
              << "/ _// _ \\/ __ `/ __ `/ _ \\/ ___/ __/  \n"
              << "\\__/\\___/_/ /_/\\__,_/\\___/_/    \\__/ \n"
              << "  Torque Spring Trebuchet Engine v2  \n"
              << std::endl;
}

static TorsionSpringConfig makeDefaultSpringConfig() {
    TorsionSpringConfig cfg;
    cfg.wire_diameter = 0.020;
    cfg.coil_mean_diameter = 0.150;
    cfg.active_coils = 12;
    cfg.material = STEEL_65MN;
    cfg.cyclic_state = initializeCyclicState(cfg.material);
    return cfg;
}

static ProjectileConfig makeDefaultProjectileConfig() {
    ProjectileConfig cfg;
    cfg.mass = 10.0;
    cfg.drag_coefficient_incompressible = 0.47;
    cfg.diameter = 0.2;
    cfg.cross_section_area = PI_VAL * (cfg.diameter / 2.0) * (cfg.diameter / 2.0);
    return cfg;
}

static void periodicStatusLogger(
    trebuchet::modules::UdpReceiverModule* udp,
    trebuchet::modules::SpringSimulatorModule* spr,
    trebuchet::modules::RangePredictorModule* rng,
    trebuchet::modules::AlarmMqttModule* alm,
    trebuchet::bus::MessageBus* bus) {
    while (g_running) {
        for (int i = 0; i < 600; i++) {
            if (!g_running) return;
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        LOG_INFO("status", "udp recv={} ok={} drop={} | spring proc={} alerts={} to_storage={} | range preds={} | mqtt ok={} fail={} dedup={} | bus_dropped={}",
                 udp->totalReceived(), udp->totalValidatedOk(), udp->totalDroppedInvalid(),
                 spr->messagesProcessed(), spr->alertsEmitted(), spr->storageDispatches(),
                 rng->predictionsMade(),
                 alm->alertsPublishedOk(), alm->alertsPublishFailed(), alm->alertsDeduped(),
                 udp->totalBusDropped() + bus->dropped());
    }
}

int main(int argc, char* argv[]) {
    using namespace trebuchet::modules;
    using namespace trebuchet::bus;
    using namespace trebuchet::metrics;
    using namespace trebuchet;

    signal(SIGINT, signalHandler);
    signal(SIGTERM, signalHandler);

    Logger::init("logs", "trebuchet.log",
                 LogLevel::INFO, LogLevel::DEBUG);
    MetricsCollector::instance().init(8081, "0.0.0.0");

    printBanner();

    int udp_port = 9000;
    int http_port = 8080;
    std::string mqtt_host = "127.0.0.1";
    int mqtt_port = 1883;
    std::string clickhouse_host = "127.0.0.1";
    int clickhouse_port = 8123;
    std::string spring_config_path = "";
    std::string traj_config_path = "";

    for (int i = 1; i < argc - 1; i += 2) {
        const std::string k = argv[i];
        const std::string v = argv[i + 1];
        if (k == "--udp-port") udp_port = std::atoi(v.c_str());
        else if (k == "--http-port") http_port = std::atoi(v.c_str());
        else if (k == "--mqtt-host") mqtt_host = v;
        else if (k == "--mqtt-port") mqtt_port = std::atoi(v.c_str());
        else if (k == "--ch-host") clickhouse_host = v;
        else if (k == "--ch-port") clickhouse_port = std::atoi(v.c_str());
        else if (k == "--spring-config") spring_config_path = v;
        else if (k == "--traj-config") traj_config_path = v;
    }

    LOG_INFO("main", "Starting Trebuchet Sim Backend v2");
    LOG_INFO("main", "UDP port={}, HTTP port={}, Metrics port=8081", udp_port, http_port);
    LOG_INFO("main", "MQTT broker={}:{}, ClickHouse={}:{}",
             mqtt_host, mqtt_port, clickhouse_host, clickhouse_port);

    auto spring_cfg = makeDefaultSpringConfig();
    auto proj_cfg = makeDefaultProjectileConfig();

    MessageBus bus;

    UdpReceiverModule::Config udp_cfg;
    udp_cfg.port = udp_port;
    UdpReceiverModule udp_mod(udp_cfg, &bus);
    if (!spring_config_path.empty()) {
        spring_cfg = makeDefaultSpringConfig();
        LOG_INFO("main", "--spring-config file provided; loading via module API");
    }
    SpringSimulatorModule::Config spring_cfg_mod;
    SpringSimulatorModule spring_mod(spring_cfg_mod, spring_cfg, &bus);
    if (!spring_config_path.empty()) {
        bool ok = spring_mod.loadSpringParamsFromJson(spring_config_path);
        if (ok) {
            LOG_INFO("main", "spring config load OK: {}", spring_config_path);
        } else {
            LOG_ERROR("main", "spring config load FAILED: {}", spring_config_path);
        }
    }

    RangePredictorModule::Config range_cfg;
    RangePredictorModule range_mod(range_cfg, proj_cfg, &bus);
    if (!traj_config_path.empty()) {
        bool ok = range_mod.loadTrajectoryParamsFromJson(traj_config_path);
        if (ok) {
            LOG_INFO("main", "trajectory config load OK: {}", traj_config_path);
        } else {
            LOG_ERROR("main", "trajectory config load FAILED: {}", traj_config_path);
        }
    }

    AlarmMqttModule::Config alarm_cfg;
    alarm_cfg.mqtt_host = mqtt_host;
    alarm_cfg.mqtt_port = mqtt_port;
    AlarmMqttModule alarm_mod(alarm_cfg, &bus);

    LOG_INFO("main", "starting modules...");
    if (!udp_mod.start()) {
        LOG_CRITICAL("main", "UDP receiver failed to bind port {}", udp_port);
        return 1;
    }
    LOG_INFO("main", "  UDP receiver on : {} OK", udp_port);

    spring_mod.start();
    LOG_INFO("main", "  Spring simulator OK");

    range_mod.start();
    LOG_INFO("main", "  Range predictor OK");

    bool mqtt_ok = alarm_mod.start();
    LOG_INFO("main", "  MQTT alarm module: {}", (mqtt_ok ? "connected" : "standalone (no broker)"));

    auto status_cfg = spring_mod.getSpringConfig();
    auto proj_cfg_out = range_mod.getProjectileConfig();
    LOG_INFO("main", "spring: d={}mm D={}mm Na={} G={}GPa",
             status_cfg.wire_diameter * 1000,
             status_cfg.coil_mean_diameter * 1000,
             status_cfg.active_coils,
             status_cfg.material.shear_modulus * 1e-9);
    LOG_INFO("main", "projectile: m={}kg Cd0={} A={}m2",
             proj_cfg_out.mass,
             proj_cfg_out.drag_coefficient_incompressible,
             proj_cfg_out.cross_section_area);

    std::thread status_thread(periodicStatusLogger,
                              &udp_mod, &spring_mod, &range_mod, &alarm_mod, &bus);

    LOG_INFO("main", "all modules online. press Ctrl+C to stop.");

    udp_mod.setPacketHandler([](const SensorRawMessage& msg, bool valid) {
        if (!valid) return;
        if (msg.cycle_count > 0 && (msg.cycle_count % 50 == 0)) {
            LOG_INFO("sensor", "{} cycle={} theta={} rad, E={} J, damage={}, Ma_max={}",
                     msg.getMachineId(), msg.cycle_count, msg.torsion_angle_rad,
                     msg.stored_energy_j, msg.cyclic_damage_ratio, msg.max_mach);
        }
    });

    http_ns::HttpApiServer::Config http_cfg;
    http_cfg.port = http_port;
    http_cfg.static_files_dir = "frontend";
    http_ns::HttpApiServer http_srv(http_cfg);
    if (http_srv.start()) {
        LOG_INFO("main", "HTTP API server on : {}", http_port);

        auto getQueryDouble = [](const http_ns::HttpRequest& req, const std::string& key, double def) {
            auto it = req.query_params.find(key);
            if (it == req.query_params.end() || it->second.empty()) return def;
            try { return std::stod(it->second); } catch (...) { return def; }
        };
        auto getQueryInt = [](const http_ns::HttpRequest& req, const std::string& key, int def) {
            auto it = req.query_params.find(key);
            if (it == req.query_params.end() || it->second.empty()) return def;
            try { return std::stoi(it->second); } catch (...) { return def; }
        };
        auto getQueryStr = [](const http_ns::HttpRequest& req, const std::string& key, const std::string& def) {
            auto it = req.query_params.find(key);
            if (it == req.query_params.end() || it->second.empty()) return def;
            return it->second;
        };

        auto escapeJsonStr = [](const std::string& s) {
            std::string out;
            out.reserve(s.size() + 2);
            for (char c : s) {
                if (c == '"') out += "\\\"";
                else if (c == '\\') out += "\\\\";
                else if (c == '\n') out += "\\n";
                else if (c == '\r') out += "\\r";
                else if (c == '\t') out += "\\t";
                else out += c;
            }
            return out;
        };

        http_srv.addGetRoute("/api/materials", [&](const http_ns::HttpRequest& req) -> http_ns::HttpResponse {
            try {
                using physics_ns::STEEL_65MN;
                using physics_ns::STEEL_50CRVA;
                using physics_ns::SINEW_OX;
                using physics_ns::HEMP_ROPE;
                using physics_ns::OX_TENDON;
                using physics_ns::MODERN_SYNTHETIC;
                using physics_ns::MODERN_STEEL_ALLOY;

                struct MatDef { const char* id; const SpringMaterial& ref; };
                MatDef mats[] = {
                    {"steel65mn", STEEL_65MN},
                    {"steel50crva", STEEL_50CRVA},
                    {"sinew_ox", SINEW_OX},
                    {"hemp_rope", HEMP_ROPE},
                    {"ox_tendon", OX_TENDON},
                    {"modern_synthetic", MODERN_SYNTHETIC},
                    {"modern_steel_alloy", MODERN_STEEL_ALLOY}
                };

                std::ostringstream json;
                json << "{\"materials\":[";
                for (int i = 0; i < 7; ++i) {
                    if (i > 0) json << ",";
                    const auto& m = mats[i].ref;
                    json << "{"
                         << "\"id\":\"" << mats[i].id << "\","
                         << "\"name\":\"" << escapeJsonStr(m.name) << "\","
                         << "\"era\":\"" << m.era << "\","
                         << "\"shearModulusGpa\":" << (m.shear_modulus / 1e9) << ","
                         << "\"yieldStrengthMpa\":" << (m.yield_strength / 1e6) << ","
                         << "\"density\":" << m.density << ","
                         << "\"parameters\":{"
                         << "\"fatigueDuctilityCoefficient\":" << m.fatigue_ductility_coefficient << ","
                         << "\"fatigueDuctilityExponent\":" << m.fatigue_ductility_exponent << ","
                         << "\"cyclicStrengthCoefficient\":" << (m.cyclic_strength_coefficient / 1e6) << ","
                         << "\"cyclicStrengthExponent\":" << m.cyclic_strength_exponent
                         << "}}";
                }
                json << "]}";
                return http_ns::HttpResponse::json(200, json.str());
            } catch (const std::exception& e) {
                return http_ns::HttpResponse::error(500, std::string("Internal error: ") + e.what());
            } catch (...) {
                return http_ns::HttpResponse::error(500, "Unknown internal error");
            }
        });

        http_srv.addGetRoute("/api/compare-materials", [&](const http_ns::HttpRequest& req) -> http_ns::HttpResponse {
            try {
                using physics_ns::STEEL_65MN;
                using physics_ns::STEEL_50CRVA;
                using physics_ns::SINEW_OX;
                using physics_ns::HEMP_ROPE;
                using physics_ns::OX_TENDON;
                using physics_ns::MODERN_SYNTHETIC;
                using physics_ns::MODERN_STEEL_ALLOY;

                double angle_deg = getQueryDouble(req, "angle_deg", 120.0);
                double mass_kg = getQueryDouble(req, "mass_kg", 10.0);
                double launch_angle_deg = getQueryDouble(req, "launch_angle_deg", 45.0);
                double wire_mm = getQueryDouble(req, "wire_mm", 20.0);
                double mean_mm = getQueryDouble(req, "mean_mm", 150.0);
                int coils = getQueryInt(req, "coils", 12);

                if (mass_kg <= 0) return http_ns::HttpResponse::error(400, "mass_kg must be positive");
                if (coils <= 0) return http_ns::HttpResponse::error(400, "coils must be positive");
                if (wire_mm <= 0) return http_ns::HttpResponse::error(400, "wire_mm must be positive");
                if (mean_mm <= 0) return http_ns::HttpResponse::error(400, "mean_mm must be positive");

                TorsionSpringConfig base_config;
                base_config.wire_diameter = wire_mm / 1000.0;
                base_config.coil_mean_diameter = mean_mm / 1000.0;
                base_config.active_coils = coils;
                base_config.material = STEEL_65MN;
                base_config.cyclic_state = physics_ns::initializeCyclicState(STEEL_65MN);
                base_config.preload_angle_rad = 0.0;

                ProjectileConfig base_projectile;
                base_projectile.mass = mass_kg;
                base_projectile.drag_coefficient_incompressible = 0.47;
                base_projectile.diameter = 0.2;
                base_projectile.cross_section_area = PI_VAL * 0.1 * 0.1;

                std::vector<std::pair<std::string, SpringMaterial>> all_materials = {
                    {"steel65mn", STEEL_65MN},
                    {"steel50crva", STEEL_50CRVA},
                    {"sinew_ox", SINEW_OX},
                    {"hemp_rope", HEMP_ROPE},
                    {"ox_tendon", OX_TENDON},
                    {"modern_synthetic", MODERN_SYNTHETIC},
                    {"modern_steel_alloy", MODERN_STEEL_ALLOY}
                };

                double torsion_rad = physics_ns::convertDegToRad(angle_deg);
                auto results = physics_ns::compareMaterials(base_config, all_materials, torsion_rad, mass_kg, launch_angle_deg, base_projectile);

                std::vector<int> indices(results.size());
                for (size_t i = 0; i < results.size(); ++i) indices[i] = static_cast<int>(i);
                std::sort(indices.begin(), indices.end(), [&](int a, int b) {
                    return results[a].predicted_range_m > results[b].predicted_range_m;
                });
                std::vector<int> rankings(results.size(), 0);
                for (size_t rank = 0; rank < indices.size(); ++rank) {
                    rankings[indices[rank]] = static_cast<int>(rank) + 1;
                }

                std::ostringstream json;
                json << "{\"results\":[";
                for (size_t i = 0; i < results.size(); ++i) {
                    if (i > 0) json << ",";
                    const auto& r = results[i];
                    json << "{"
                         << "\"material_id\":\"" << r.material_id << "\","
                         << "\"material_name\":\"" << escapeJsonStr(r.material_name) << "\","
                         << "\"era\":\"" << r.era << "\","
                         << "\"stored_energy\":" << r.stored_energy << ","
                         << "\"spring_constant\":" << r.spring_constant << ","
                         << "\"shear_stress_mpa\":" << r.shear_stress_mpa << ","
                         << "\"efficiency\":" << r.efficiency << ","
                         << "\"cyclic_damage_ratio\":" << r.cyclic_damage_ratio << ","
                         << "\"predicted_range_m\":" << r.predicted_range_m << ","
                         << "\"predicted_height_m\":" << r.predicted_height_m << ","
                         << "\"flight_time_s\":" << r.flight_time_s << ","
                         << "\"range_ranking\":" << rankings[i]
                         << "}";
                }
                json << "]}";
                return http_ns::HttpResponse::json(200, json.str());
            } catch (const std::exception& e) {
                return http_ns::HttpResponse::error(500, std::string("Internal error: ") + e.what());
            } catch (...) {
                return http_ns::HttpResponse::error(500, "Unknown internal error");
            }
        });

        http_srv.addGetRoute("/api/compare-trebuchets", [&](const http_ns::HttpRequest& req) -> http_ns::HttpResponse {
            try {
                double base_velocity = getQueryDouble(req, "base_velocity", 35.0);
                double mass_kg = getQueryDouble(req, "mass_kg", 10.0);
                double launch_angle_deg = getQueryDouble(req, "launch_angle_deg", 45.0);
                double diameter_m = getQueryDouble(req, "diameter_m", 0.2);

                if (mass_kg <= 0) return http_ns::HttpResponse::error(400, "mass_kg must be positive");
                if (diameter_m <= 0) return http_ns::HttpResponse::error(400, "diameter_m must be positive");
                if (base_velocity < 0) return http_ns::HttpResponse::error(400, "base_velocity must be non-negative");

                ProjectileConfig base_projectile;
                base_projectile.mass = mass_kg;
                base_projectile.drag_coefficient_incompressible = 0.47;
                base_projectile.diameter = diameter_m;
                double r = diameter_m / 2.0;
                base_projectile.cross_section_area = PI_VAL * r * r;

                auto results = physics_ns::compareTrebuchetTypes(base_projectile, base_velocity, launch_angle_deg);

                std::vector<int> indices(results.size());
                for (size_t i = 0; i < results.size(); ++i) indices[i] = static_cast<int>(i);
                std::sort(indices.begin(), indices.end(), [&](int a, int b) {
                    return results[a].predicted_range_m > results[b].predicted_range_m;
                });
                std::vector<int> rankings(results.size(), 0);
                for (size_t rank = 0; rank < indices.size(); ++rank) {
                    rankings[indices[rank]] = static_cast<int>(rank) + 1;
                }

                std::ostringstream json;
                json << "{\"results\":[";
                for (size_t i = 0; i < results.size(); ++i) {
                    if (i > 0) json << ",";
                    const auto& r = results[i];
                    json << "{"
                         << "\"type_id\":\"" << r.type_id << "\","
                         << "\"type_name\":\"" << escapeJsonStr(r.type_name) << "\","
                         << "\"era\":\"" << r.era << "\","
                         << "\"release_velocity\":" << r.release_velocity << ","
                         << "\"predicted_range_m\":" << r.predicted_range_m << ","
                         << "\"max_height_m\":" << r.max_height_m << ","
                         << "\"flight_time_s\":" << r.flight_time_s << ","
                         << "\"max_mach\":" << r.max_mach << ","
                         << "\"impact_velocity\":" << r.impact_velocity << ","
                         << "\"projectile_mass_kg\":" << r.projectile_mass_kg << ","
                         << "\"efficiency\":" << r.efficiency << ","
                         << "\"range_ranking\":" << rankings[i]
                         << "}";
                }
                json << "]}";
                return http_ns::HttpResponse::json(200, json.str());
            } catch (const std::exception& e) {
                return http_ns::HttpResponse::error(500, std::string("Internal error: ") + e.what());
            } catch (...) {
                return http_ns::HttpResponse::error(500, "Unknown internal error");
            }
        });

        http_srv.addGetRoute("/api/preload-analysis", [&](const http_ns::HttpRequest& req) -> http_ns::HttpResponse {
            try {
                using physics_ns::STEEL_65MN;
                using physics_ns::STEEL_50CRVA;
                using physics_ns::SINEW_OX;
                using physics_ns::HEMP_ROPE;
                using physics_ns::OX_TENDON;
                using physics_ns::MODERN_SYNTHETIC;
                using physics_ns::MODERN_STEEL_ALLOY;

                double max_angle_deg = getQueryDouble(req, "max_angle_deg", 120.0);
                double total_angle_deg = getQueryDouble(req, "total_angle_deg", 360.0);
                double mass_kg = getQueryDouble(req, "mass_kg", 10.0);
                double launch_angle_deg = getQueryDouble(req, "launch_angle_deg", 45.0);
                double wire_mm = getQueryDouble(req, "wire_mm", 20.0);
                double mean_mm = getQueryDouble(req, "mean_mm", 150.0);
                int coils = getQueryInt(req, "coils", 12);
                std::string mat_id = getQueryStr(req, "material", "steel65mn");
                int steps = getQueryInt(req, "steps", 20);

                if (mass_kg <= 0) return http_ns::HttpResponse::error(400, "mass_kg must be positive");
                if (coils <= 0) return http_ns::HttpResponse::error(400, "coils must be positive");
                if (wire_mm <= 0) return http_ns::HttpResponse::error(400, "wire_mm must be positive");
                if (mean_mm <= 0) return http_ns::HttpResponse::error(400, "mean_mm must be positive");
                if (steps < 2) steps = 2;

                SpringMaterial chosen_mat = STEEL_65MN;
                if (mat_id == "steel50crva") chosen_mat = STEEL_50CRVA;
                else if (mat_id == "sinew_ox") chosen_mat = SINEW_OX;
                else if (mat_id == "hemp_rope") chosen_mat = HEMP_ROPE;
                else if (mat_id == "ox_tendon") chosen_mat = OX_TENDON;
                else if (mat_id == "modern_synthetic") chosen_mat = MODERN_SYNTHETIC;
                else if (mat_id == "modern_steel_alloy") chosen_mat = MODERN_STEEL_ALLOY;

                TorsionSpringConfig config;
                config.wire_diameter = wire_mm / 1000.0;
                config.coil_mean_diameter = mean_mm / 1000.0;
                config.active_coils = coils;
                config.material = chosen_mat;
                config.cyclic_state = physics_ns::initializeCyclicState(chosen_mat);
                config.preload_angle_rad = 0.0;

                ProjectileConfig base_projectile;
                base_projectile.mass = mass_kg;
                base_projectile.drag_coefficient_incompressible = 0.47;
                base_projectile.diameter = 0.2;
                base_projectile.cross_section_area = PI_VAL * 0.1 * 0.1;

                auto data = physics_ns::analyzePreloadEffect(config, max_angle_deg, total_angle_deg, mass_kg, launch_angle_deg, base_projectile, steps);

                double best_preload = 0.0;
                double max_range = 0.0;
                double base_range = 0.0;
                for (size_t i = 0; i < data.size(); ++i) {
                    if (data[i].second > max_range) {
                        max_range = data[i].second;
                        best_preload = data[i].first;
                    }
                    if (std::abs(data[i].first) < 1e-9) base_range = data[i].second;
                }
                double improvement_pct = 0.0;
                if (base_range > 1e-9) {
                    improvement_pct = (max_range - base_range) / base_range * 100.0;
                }

                std::ostringstream json;
                json << "{"
                     << "\"bestPreloadDeg\":" << best_preload << ","
                     << "\"maxRangeM\":" << max_range << ","
                     << "\"baseRangeM\":" << base_range << ","
                     << "\"improvementPercent\":" << improvement_pct << ","
                     << "\"data\":[";
                for (size_t i = 0; i < data.size(); ++i) {
                    if (i > 0) json << ",";
                    json << "[" << data[i].first << "," << data[i].second << "]";
                }
                json << "]}";
                return http_ns::HttpResponse::json(200, json.str());
            } catch (const std::exception& e) {
                return http_ns::HttpResponse::error(500, std::string("Internal error: ") + e.what());
            } catch (...) {
                return http_ns::HttpResponse::error(500, "Unknown internal error");
            }
        });

        http_srv.addGetRoute("/api/virtual-launch", [&](const http_ns::HttpRequest& req) -> http_ns::HttpResponse {
            try {
                using physics_ns::STEEL_65MN;
                using physics_ns::STEEL_50CRVA;
                using physics_ns::SINEW_OX;
                using physics_ns::HEMP_ROPE;
                using physics_ns::OX_TENDON;
                using physics_ns::MODERN_SYNTHETIC;
                using physics_ns::MODERN_STEEL_ALLOY;

                double torsion_angle_deg = getQueryDouble(req, "torsion_angle_deg", 120.0);
                double preload_deg = getQueryDouble(req, "preload_deg", 0.0);
                double mass_kg = getQueryDouble(req, "mass_kg", 10.0);
                double launch_angle_deg = getQueryDouble(req, "launch_angle_deg", 45.0);
                double wire_mm = getQueryDouble(req, "wire_mm", 20.0);
                double mean_mm = getQueryDouble(req, "mean_mm", 150.0);
                int coils = getQueryInt(req, "coils", 12);
                std::string mat_id = getQueryStr(req, "material", "steel65mn");

                if (mass_kg <= 0) return http_ns::HttpResponse::error(400, "mass_kg must be positive");
                if (coils <= 0) return http_ns::HttpResponse::error(400, "coils must be positive");
                if (wire_mm <= 0) return http_ns::HttpResponse::error(400, "wire_mm must be positive");
                if (mean_mm <= 0) return http_ns::HttpResponse::error(400, "mean_mm must be positive");

                SpringMaterial chosen_mat = STEEL_65MN;
                if (mat_id == "steel50crva") chosen_mat = STEEL_50CRVA;
                else if (mat_id == "sinew_ox") chosen_mat = SINEW_OX;
                else if (mat_id == "hemp_rope") chosen_mat = HEMP_ROPE;
                else if (mat_id == "ox_tendon") chosen_mat = OX_TENDON;
                else if (mat_id == "modern_synthetic") chosen_mat = MODERN_SYNTHETIC;
                else if (mat_id == "modern_steel_alloy") chosen_mat = MODERN_STEEL_ALLOY;

                TorsionSpringConfig config;
                config.wire_diameter = wire_mm / 1000.0;
                config.coil_mean_diameter = mean_mm / 1000.0;
                config.active_coils = coils;
                config.material = chosen_mat;
                config.cyclic_state = physics_ns::initializeCyclicState(chosen_mat);
                config.preload_angle_rad = 0.0;

                ProjectileConfig projectile;
                projectile.mass = mass_kg;
                projectile.drag_coefficient_incompressible = 0.47;
                projectile.diameter = 0.2;
                projectile.cross_section_area = PI_VAL * 0.1 * 0.1;

                double torsion_rad = physics_ns::convertDegToRad(torsion_angle_deg);
                double preload_rad = physics_ns::convertDegToRad(preload_deg);
                auto spring_res = physics_ns::calculateSpringEnergyWithPreload(config, torsion_rad, preload_rad);

                double eff_energy = spring_res.stored_energy * spring_res.efficiency;
                double release_velocity = 0.0;
                if (eff_energy > 0.0 && mass_kg > 0.0) {
                    release_velocity = std::sqrt(2.0 * eff_energy / mass_kg);
                }
                release_velocity = std::max(0.0, release_velocity);

                auto traj = physics_ns::calculateFullTrajectory(projectile, release_velocity, launch_angle_deg);

                std::ostringstream json;
                json << "{\"spring\":{"
                     << "\"storedEnergy\":" << spring_res.stored_energy << ","
                     << "\"efficiency\":" << spring_res.efficiency << ","
                     << "\"springConstant\":" << spring_res.spring_constant << ","
                     << "\"shearStressMpa\":" << (spring_res.shear_stress / 1e6) << ","
                     << "\"elasticStressMpa\":" << (spring_res.elastic_stress / 1e6) << ","
                     << "\"plasticStrain\":" << spring_res.plastic_strain << ","
                     << "\"yieldStrengthRatio\":" << spring_res.yield_strength_ratio << ","
                     << "\"cyclicDamageRatio\":" << spring_res.cyclic_damage_ratio << ","
                     << "\"modulusReduction\":" << spring_res.modulus_reduction << ","
                     << "\"backStressPa\":" << spring_res.back_stress_pa << ","
                     << "\"degradedYieldStrengthPa\":" << spring_res.degraded_yield_strength_pa << ","
                     << "\"cycleCount\":" << spring_res.cycle_count << ","
                     << "\"fractureRisk\":" << (spring_res.fracture_risk ? "true" : "false") << ","
                     << "\"fatigueRisk\":" << (spring_res.fatigue_risk ? "true" : "false")
                     << "},\"trajectory\":{"
                     << "\"range\":" << traj.predicted_range << ","
                     << "\"maxHeight\":" << traj.max_height << ","
                     << "\"flightTime\":" << traj.flight_time << ","
                     << "\"impactVelocity\":" << traj.impact_velocity << ","
                     << "\"impactMach\":" << traj.impact_mach << ","
                     << "\"launchAngleOptimal\":" << traj.launch_angle_optimal << ","
                     << "\"maxMach\":" << traj.max_mach
                     << "},\"trajectoryPoints\":[";
                for (size_t i = 0; i < traj.trajectory_points.size(); ++i) {
                    if (i > 0) json << ",";
                    json << "[" << traj.trajectory_points[i].first << "," << traj.trajectory_points[i].second << "]";
                }
                json << "],\"trajectoryMachPoints\":[";
                for (size_t i = 0; i < traj.mach_profile.size(); ++i) {
                    if (i > 0) json << ",";
                    json << "[" << traj.mach_profile[i].first << "," << traj.mach_profile[i].second << "]";
                }
                json << "],\"releaseVelocity\":" << release_velocity << "}";
                return http_ns::HttpResponse::json(200, json.str());
            } catch (const std::exception& e) {
                return http_ns::HttpResponse::error(500, std::string("Internal error: ") + e.what());
            } catch (...) {
                return http_ns::HttpResponse::error(500, "Unknown internal error");
            }
        });

        http_srv.addGetRoute("/api/trebuchet-types", [&](const http_ns::HttpRequest& req) -> http_ns::HttpResponse {
            try {
                struct TypeDef {
                    const char* id; const char* name; const char* era; const char* desc;
                    double velocityBoost; double efficiencyMultiplier; double massMultiplier;
                };
                TypeDef types[] = {
                    {"ancient_traction", "Ancient Traction", "ancient",
                     "人力牵引式投石机，依靠多人同时拉拽绳索提供动力，结构简单但能量密度较低。",
                     1.0, 0.60, 1.0},
                    {"ancient_torsion", "Ancient Torsion", "ancient",
                     "扭力弹簧式投石机（如希腊/罗马 Ballista、Onager），利用肌腱或麻绳扭绞储能，是古代效率最高的投石机类型。",
                     1.0, 0.85, 1.0},
                    {"ancient_counterweight", "Ancient Counterweight", "ancient",
                     "配重式投石机（Trebuchet），中世纪欧洲攻城利器，依靠重锤下落驱动抛臂，能量巨大但释放速度低。",
                     1.0, 0.75, 1.0},
                    {"modern_carriage_catapult", "Modern Carriage Catapult", "modern",
                     "现代舰载机弹射器早期的蒸汽/液压弹射原型，利用高压气缸驱动滑车，效率接近机械极限。",
                     2.5, 0.95, 0.02},
                    {"modern_aircraft_catapult", "Modern Aircraft Catapult", "modern",
                     "现代电磁弹射器（EMALS），利用线性同步电动机，能量转换效率极高、推力可控，是当代弹射技术巅峰。",
                     5.0, 0.98, 0.001}
                };

                std::ostringstream json;
                json << "{\"types\":[";
                for (int i = 0; i < 5; ++i) {
                    if (i > 0) json << ",";
                    json << "{"
                         << "\"id\":\"" << types[i].id << "\","
                         << "\"name\":\"" << types[i].name << "\","
                         << "\"era\":\"" << types[i].era << "\","
                         << "\"description\":\"" << escapeJsonStr(types[i].desc) << "\","
                         << "\"velocityBoost\":" << types[i].velocityBoost << ","
                         << "\"efficiencyMultiplier\":" << types[i].efficiencyMultiplier << ","
                         << "\"massMultiplier\":" << types[i].massMultiplier
                         << "}";
                }
                json << "]}";
                return http_ns::HttpResponse::json(200, json.str());
            } catch (const std::exception& e) {
                return http_ns::HttpResponse::error(500, std::string("Internal error: ") + e.what());
            } catch (...) {
                return http_ns::HttpResponse::error(500, "Unknown internal error");
            }
        });

        http_srv.addGetRoute("/api/preload-tensioning", [&](const http_ns::HttpRequest& req) -> http_ns::HttpResponse {
            try {
                double target_preload_deg = getQueryDouble(req, "target_preload_deg", 30.0);
                double wire_mm = getQueryDouble(req, "wire_mm", 20.0);
                double mean_mm = getQueryDouble(req, "mean_mm", 150.0);
                int coils = getQueryInt(req, "coils", 12);
                std::string mat_id = getQueryStr(req, "material", "steel65mn");
                int stages = getQueryInt(req, "stages", 4);
                double hold_sec = getQueryDouble(req, "hold_sec", 5.0);
                double overpull_deg = getQueryDouble(req, "overpull_deg", 5.0);

                physics_ns::SpringMaterial mat = physics_ns::STEEL_65MN;
                if (mat_id == "steel50crva") mat = physics_ns::STEEL_50CRVA;
                else if (mat_id == "sinew_ox") mat = physics_ns::SINEW_OX;
                else if (mat_id == "hemp_rope") mat = physics_ns::HEMP_ROPE;
                else if (mat_id == "ox_tendon") mat = physics_ns::OX_TENDON;
                else if (mat_id == "modern_synthetic") mat = physics_ns::MODERN_SYNTHETIC;
                else if (mat_id == "modern_steel_alloy") mat = physics_ns::MODERN_STEEL_ALLOY;

                physics_ns::TorsionSpringConfig cfg;
                cfg.wire_diameter = wire_mm / 1000.0;
                cfg.coil_mean_diameter = mean_mm / 1000.0;
                cfg.active_coils = coils;
                cfg.material = mat;
                cfg.preload_angle_rad = 0.0;
                cfg.cyclic_state = physics_ns::initializeCyclicState(mat);

                physics_ns::TensioningResult res = physics_ns::simulatePreloadTensioning(
                    cfg, target_preload_deg, stages, hold_sec, overpull_deg
                );

                std::ostringstream stages_json;
                stages_json << "[";
                for (size_t i = 0; i < res.stages.size(); ++i) {
                    if (i > 0) stages_json << ",";
                    stages_json << "{"
                                 << "\"stage_index\":" << res.stages[i].stage_index << ","
                                 << "\"angle_deg\":" << std::fixed << std::setprecision(3) << res.stages[i].angle_deg << ","
                                 << "\"hold_time_sec\":" << res.stages[i].hold_time_sec << ","
                                 << "\"stress_mpa\":" << res.stages[i].stress_mpa << ","
                                 << "\"creep_settlement_pct\":" << res.stages[i].creep_settlement_pct << ","
                                 << "\"residual_energy_j\":" << res.stages[i].residual_energy_j
                                 << "}";
                }
                stages_json << "]";

                std::ostringstream resp;
                resp << "{"
                     << "\"target_preload_angle_deg\":" << res.target_preload_angle_deg << ","
                     << "\"final_settled_angle_deg\":" << std::fixed << std::setprecision(3) << res.final_settled_angle_deg << ","
                     << "\"initial_preload_energy_j\":" << res.initial_preload_energy_j << ","
                     << "\"final_preload_energy_j\":" << res.final_preload_energy_j << ","
                     << "\"efficiency_after_tensioning\":" << std::fixed << std::setprecision(4) << res.efficiency_after_tensioning << ","
                     << "\"total_creep_deg\":" << res.total_creep_deg << ","
                     << "\"overpull_deg\":" << res.overpull_deg << ","
                     << "\"stages\":" << stages_json.str()
                     << "}";

                return http_ns::HttpResponse::json(resp.str());
            } catch (const std::exception& e) {
                return http_ns::HttpResponse::error(500, std::string("Internal error: ") + e.what());
            } catch (...) {
                return http_ns::HttpResponse::error(500, "Unknown internal error");
            }
        });

    } else {
        LOG_WARN("main", "HTTP API server failed to start");
    }

    try {
        storage_ns::ClickHouseClient::Config ch_cfg;
        ch_cfg.host = clickhouse_host;
        ch_cfg.port = clickhouse_port;
        storage_ns::ClickHouseClient ch(ch_cfg);
        if (ch.connect()) {
            LOG_INFO("main", "ClickHouse OK at {}:{}", clickhouse_host, clickhouse_port);
        } else {
            LOG_WARN("main", "ClickHouse unavailable at {}:{}", clickhouse_host, clickhouse_port);
        }
    } catch (...) {
        LOG_WARN("main", "ClickHouse client exception");
    }

    while (g_running) {
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }

    LOG_INFO("main", "signal received, stopping modules...");

    udp_mod.stop();
    LOG_INFO("main", "  UDP stopped");
    spring_mod.stop();
    LOG_INFO("main", "  Spring stopped");
    range_mod.stop();
    LOG_INFO("main", "  Range stopped");
    alarm_mod.stop();
    LOG_INFO("main", "  Alarm stopped");
    http_srv.stop();
    LOG_INFO("main", "  HTTP stopped");
    MetricsCollector::instance().shutdown();
    Logger::flush();

    if (status_thread.joinable()) status_thread.join();

    LOG_INFO("main", "good-bye.");
    return 0;
}
