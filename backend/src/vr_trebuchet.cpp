#include "vr_trebuchet.h"

namespace trebuchet {
namespace modules {

VrTrebuchet::VrTrebuchet()
    : running_(false),
      next_task_id_(1),
      completed_count_(0) {
}

VrTrebuchet::~VrTrebuchet() {
    stopWorkerThread();
}

void VrTrebuchet::startWorkerThread(int num_threads) {
    if (running_.load()) return;
    running_.store(true);
    completed_count_.store(0);
    int safe_threads = std::max(1, num_threads);
    for (int i = 0; i < safe_threads; ++i) {
        worker_threads_.emplace_back(&VrTrebuchet::workerLoop, this);
    }
}

void VrTrebuchet::stopWorkerThread() {
    running_.store(false);
    cv_.notify_all();
    for (auto& t : worker_threads_) {
        if (t.joinable()) t.join();
    }
    worker_threads_.clear();
}

bool VrTrebuchet::isRunning() const {
    return running_.load();
}

uint64_t VrTrebuchet::submitLaunch(const VrLaunchParams& params) {
    uint64_t id = next_task_id_.fetch_add(1);
    {
        std::lock_guard<std::mutex> lock(queue_mutex_);
        task_queue_.push({id, params});
    }
    cv_.notify_one();
    return id;
}

bool VrTrebuchet::isResultReady(uint64_t task_id) const {
    std::lock_guard<std::mutex> lock(result_mutex_);
    return results_.find(task_id) != results_.end();
}

VrLaunchResult VrTrebuchet::getResult(uint64_t task_id) {
    std::lock_guard<std::mutex> lock(result_mutex_);
    auto it = results_.find(task_id);
    if (it != results_.end()) {
        VrLaunchResult res = it->second;
        results_.erase(it);
        return res;
    }
    VrLaunchResult empty;
    empty.success = false;
    empty.error_message = "Task not found or not completed";
    empty.task_id = task_id;
    return empty;
}

VrLaunchResult VrTrebuchet::launchSync(const VrLaunchParams& params) {
    return computeLaunch(params);
}

int VrTrebuchet::pendingCount() const {
    std::lock_guard<std::mutex> lock(queue_mutex_);
    return static_cast<int>(task_queue_.size());
}

int VrTrebuchet::completedCount() const {
    return completed_count_.load();
}

void VrTrebuchet::setCompletionCallback(CallbackFn callback) {
    completion_callback_ = callback;
}

void VrTrebuchet::workerLoop() {
    while (running_.load()) {
        Task task;
        bool has_task = false;
        {
            std::unique_lock<std::mutex> lock(queue_mutex_);
            cv_.wait_for(lock, std::chrono::milliseconds(50),
                [this] { return !task_queue_.empty() || !running_.load(); });
            if (!running_.load() && task_queue_.empty()) break;
            if (!task_queue_.empty()) {
                task = task_queue_.front();
                task_queue_.pop();
                has_task = true;
            }
        }

        if (has_task) {
            VrLaunchResult result = computeLaunch(task.params);
            result.task_id = task.id;

            {
                std::lock_guard<std::mutex> lock(result_mutex_);
                results_[task.id] = result;
            }
            completed_count_.fetch_add(1);

            if (completion_callback_) {
                completion_callback_(task.id, result);
            }
        }
    }
}

VrLaunchResult VrTrebuchet::computeLaunch(const VrLaunchParams& params) {
    VrLaunchResult result;
    result.success = true;
    result.task_id = 0;
    result.release_velocity = 0.0;

    try {
        physics::SpringMaterial mat = getMaterialById(params.material_id);

        physics::TorsionSpringConfig spring_cfg;
        spring_cfg.wire_diameter = params.wire_diameter_mm / 1000.0;
        spring_cfg.coil_mean_diameter = params.mean_diameter_mm / 1000.0;
        spring_cfg.active_coils = params.active_coils;
        spring_cfg.material = mat;
        spring_cfg.preload_angle_rad = 0.0;
        spring_cfg.cyclic_state = physics::initializeCyclicState(mat);

        double torsion_rad = physics::convertDegToRad(params.torsion_angle_deg);
        double preload_rad = physics::convertDegToRad(params.preload_angle_deg);

        result.spring_energy = physics::calculateSpringEnergyWithPreload(
            spring_cfg, torsion_rad, preload_rad
        );

        double safe_mass = std::max(1e-9, params.projectile_mass_kg);
        double effective_energy = result.spring_energy.stored_energy * result.spring_energy.efficiency;
        if (effective_energy > 0.0) {
            result.release_velocity = std::sqrt(2.0 * effective_energy / safe_mass);
        }
        result.release_velocity = std::max(0.0, result.release_velocity);
        result.spring_constant = result.spring_energy.spring_constant;
        result.shear_stress_mpa = result.spring_energy.shear_stress / 1e6;
        result.efficiency = result.spring_energy.efficiency;

        physics::ProjectileConfig proj;
        proj.mass = safe_mass;
        double diameter = params.projectile_diameter_m > 0
            ? params.projectile_diameter_m
            : 0.2;
        proj.diameter = diameter;
        proj.cross_section_area = 3.14159265358979 * (diameter / 2.0) * (diameter / 2.0);
        proj.drag_coefficient_incompressible = 0.47;

        result.trajectory = physics::calculateFullTrajectory(
            proj, result.release_velocity, params.launch_angle_deg
        );
    } catch (const std::exception& e) {
        result.success = false;
        result.error_message = e.what();
    } catch (...) {
        result.success = false;
        result.error_message = "Unknown error";
    }

    return result;
}

physics::SpringMaterial VrTrebuchet::getMaterialById(const std::string& id) {
    if (id == "steel50crva") return physics::STEEL_50CRVA;
    if (id == "sinew_ox") return physics::SINEW_OX;
    if (id == "hemp_rope") return physics::HEMP_ROPE;
    if (id == "ox_tendon") return physics::OX_TENDON;
    if (id == "modern_synthetic") return physics::MODERN_SYNTHETIC;
    if (id == "modern_steel_alloy") return physics::MODERN_STEEL_ALLOY;
    return physics::STEEL_65MN;
}

}
}
