#ifndef VR_TREBUCHET_H
#define VR_TREBUCHET_H

#include <atomic>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <queue>
#include <functional>
#include <string>
#include <vector>
#include <utility>
#include <unordered_map>
#include "trebuchet_physics.h"

namespace trebuchet {
namespace modules {

struct VrLaunchParams {
    std::string material_id;
    double wire_diameter_mm;
    double mean_diameter_mm;
    int active_coils;
    double torsion_angle_deg;
    double preload_angle_deg;
    double projectile_mass_kg;
    double launch_angle_deg;
    double projectile_diameter_m;
};

struct VrLaunchResult {
    bool success;
    std::string error_message;
    uint64_t task_id;
    physics::SpringEnergyResult spring_energy;
    double release_velocity;
    physics::TrajectoryResult trajectory;
    double spring_constant;
    double shear_stress_mpa;
    double efficiency;
};

struct TrajectoryPoint {
    double t;
    double x;
    double y;
    double vx;
    double vy;
    double mach;
};

class VrTrebuchet {
public:
    VrTrebuchet();
    ~VrTrebuchet();

    void startWorkerThread(int num_threads = 1);
    void stopWorkerThread();
    bool isRunning() const;

    uint64_t submitLaunch(const VrLaunchParams& params);

    bool isResultReady(uint64_t task_id) const;
    VrLaunchResult getResult(uint64_t task_id);

    VrLaunchResult launchSync(const VrLaunchParams& params);

    int pendingCount() const;
    int completedCount() const;

    using CallbackFn = std::function<void(uint64_t, const VrLaunchResult&)>;
    void setCompletionCallback(CallbackFn callback);

private:
    struct Task {
        uint64_t id;
        VrLaunchParams params;
    };

    mutable std::mutex queue_mutex_;
    mutable std::mutex result_mutex_;
    std::condition_variable cv_;
    std::atomic<bool> running_;
    std::atomic<uint64_t> next_task_id_;
    std::atomic<int> completed_count_;

    std::vector<std::thread> worker_threads_;
    std::queue<Task> task_queue_;
    std::unordered_map<uint64_t, VrLaunchResult> results_;

    CallbackFn completion_callback_;

    void workerLoop();
    VrLaunchResult computeLaunch(const VrLaunchParams& params);

    physics::SpringMaterial getMaterialById(const std::string& id);
};

}
}

#endif
