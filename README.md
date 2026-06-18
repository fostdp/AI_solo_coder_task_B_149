# 古代霹雳车扭力弹簧储能仿真与射程预测系统

Torque Spring Trebuchet Simulation & Range Prediction System — v2.0

## 目录

- [系统架构](#系统架构)
- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [Docker 部署](#docker-部署)
- [本地开发](#本地开发)
- [传感器模拟器](#传感器模拟器)
- [API 文档](#api-文档)
- [指标监控](#指标监控)
- [配置说明](#配置说明)
- [ClickHouse 存储架构](#clickhouse-存储架构)
- [目录结构](#目录结构)

## 系统架构

```mermaid
flowchart TD
    subgraph 采集层
        SIM[霹雳车传感器模拟器<br/>(Python)]
    end

    subgraph 消息传输层
        UDP[UDP 9000<br/>数据采集]
        MQTT[MQTT Broker<br/>告警推送]
    end

    subgraph C++ 后端 模块化架构
        UDPR[udp_receiver<br/>数据采集校验]
        SPRING[spring_simulator<br/>扭簧储能释放]
        RANGE[range_predictor<br/>抛体动力学弹道]
        ALARM[alarm_mqtt<br/>告警推送]
    end

    subgraph 消息总线
        BUS[(Boost.Lockfree<br/>无锁队列)]
    end

    subgraph 存储层
        CH[(ClickHouse<br/>MergeTree + TTL)]
        CH_VIEW[物化视图<br/>1m/1h 降采样]
        CH_TTL[TTL 保留策略<br/>7d→30d→365d]
    end

    subgraph 监控层
        PROM[(Prometheus<br/>:8081/metrics)]
        GRAFANA[Grafana 仪表盘]
    end

    subgraph 前端展示
        WEB[Web 前端<br/>Three.js 3D + Canvas]
        API[HTTP API :8080]
    end

    %% Data Flow
    SIM --UDP 9000--> UDPR
    UDPR --SENSOR_TO_SPRING--> BUS
    BUS --SpringResult--> SPRING
    BUS --RangeResult--> RANGE
    BUS --AlertTrigger--> ALARM

    SPRING --SpringResult--> BUS
    SPRING --SpringAlert--> BUS
    RANGE --RangeResult--> BUS
    RANGE --RangeAlert--> BUS
    ALARM --MQTT 1883--> MQTT
    ALARM --ALARM_TO_STORAGE--> BUS

    BUS --SENSOR/SPRING/RANGE/ALARM--> CH
    CH --Materialized View--> CH_VIEW
    CH --TTL Expiration--> CH_TTL

    API --/api/*--> 后端模块
    API --/metrics--> PROM
    API --/health--> HEALTH[/health 健康检查]
    API --静态资源 gzip--> WEB
    PROM --Scrape 8081--> PROM_TARGET[backend:8081/metrics]
```

### 模块职责

| 模块 | 职责 | 输入队列 | 输出队列 |
|---|---|---|---|
| **udp_receiver** | UDP 9000 数据采集、格式解析、范围校验、XOR 校验 | 网络 | `SENSOR_TO_SPRING` |
| **spring_simulator** | 扭簧储能计算、Chaboche 循环软化、断裂/疲劳检测 | `SENSOR_TO_SPRING` | `SPRING_TO_RANGE`<br/>`SPRING_TO_ALARM`<br/>`SPRING_TO_STORAGE` |
| **range_predictor** | 四段式 Cd(Ma) 可压缩流弹道积分、最优仰角搜索 | `SPRING_TO_RANGE` | `RANGE_TO_ALARM`<br/>`RANGE_TO_STORAGE` |
| **alarm_mqtt** | 30s 窗口去重、MQTT PUBLISH (QoS=1) | `SPRING_TO_ALARM`<br/>`RANGE_TO_ALARM` | `ALARM_TO_STORAGE`<br/>MQTT Broker |

## 功能特性

✅ **物理模型**
- 扭力弹簧储能公式：`E = ½ · k · θ²`，Wahl 系数修正
- Chaboche 随动硬化 + 各向同性软化循环模型
- Coffin-Manson 寿命方程 + Miner 线性损伤累积
- 四段式可压缩流阻力系数：不可压缩→Karman-Tsien→跨音速波阻→牛顿律

✅ **工程化特性**
- C++ 模块化架构，Boost.Lockfree 无锁队列通信
- spdlog 结构化日志（控制台 + 滚动文件）
- Prometheus 指标采集（/metrics 端点）
- ClickHouse MergeTree + TTL 保留策略 + 降采样物化视图
- 前端静态资源 gzip 压缩（-9 级别）
- Docker Compose 一键编排
- HTTP API + 健康检查

## 技术栈

| 层级 | 技术 |
|---|---|
| **后端** | C++17, Boost.Lockfree, spdlog, prometheus-cpp, Winsock2/POSIX sockets |
| **存储** | ClickHouse 24.3 (MergeTree, TTL, Materialized Views) |
| **消息** | Eclipse Mosquitto MQTT 3.1.1 |
| **前端** | Three.js r160, WebGL ShaderMaterial, Canvas 2D |
| **模拟器** | Python 3.11+ |
| **编排** | Docker Compose, tini |
| **监控** | Prometheus, Grafana |

## 快速开始

### 前置要求

- Docker ≥ 24.0
- Docker Compose ≥ 2.20
- 端口开放：8080 (HTTP), 8081 (Metrics), 9000 (UDP), 8123 (ClickHouse), 1883 (MQTT)

### 一键启动

```bash
docker compose up -d --build
```

### 验证服务

```bash
# 健康检查
curl http://localhost:8080/health

# 查看指标
curl http://localhost:8081/metrics | head -30

# 查看 ClickHouse 表
curl 'http://localhost:8123/?query=SHOW+TABLES+FROM+trebuchet_sim'
```

### 停止服务

```bash
docker compose down

# 持久化数据保留
docker compose down -v  # ⚠️ 删除所有数据卷
```

## Docker 部署

### 服务构成

```yaml
services:
  clickhouse:       # ClickHouse 数据库 (带 TTL 配置)
  mqtt-broker:      # Eclipse Mosquitto MQTT Broker
  backend:          # C++ 后端服务 (主服务)
  simulator:        # 霹雳车传感器模拟器
```

### 数据卷

| 卷名 | 用途 | 容量建议 |
|---|---|---|
| `trebuchet_clickhouse_data` | ClickHouse 原始数据 | ≥ 20GB |
| `trebuchet_clickhouse_logs` | ClickHouse 运行日志 | ≥ 2GB |
| `trebuchet_mqtt_data` | MQTT 持久化数据 | ≥ 500MB |
| `trebuchet_backend_logs` | 后端运行日志 | ≥ 5GB |
| `trebuchet_simulator_logs` | 模拟器运行日志 | ≥ 1GB |

### 自定义启动参数

```bash
# 只启动后端 + 数据库
docker compose up -d clickhouse mqtt-broker backend

# 指定模拟器参数
docker compose run --rm simulator \
  --mass-kg 15.0 \
  --launch-angle-deg 45 \
  --interval-ms 30000 \
  --material 50crva
```

## 本地开发

### 环境要求

- GCC ≥ 12 / Clang ≥ 16 / MSVC ≥ 2022
- CMake ≥ 3.18
- Python ≥ 3.11
- Node.js ≥ 16 (前端 gzip 压缩可选)
- Boost ≥ 1.74 (可选，用于 Lockfree 队列)

### 编译后端

```bash
# 创建构建目录
mkdir -p build && cd build

# 配置 CMake (自动探测 Boost/spdlog/prometheus)
cmake ../backend \
  -DCMAKE_BUILD_TYPE=Release \
  -DUSE_BOOST_LOCKFREE=ON \
  -DUSE_SPDLOG=ON \
  -DUSE_PROMETHEUS=ON

# 编译
cmake --build . -j$(nproc)

# 运行
./trebuchet_backend \
  --udp-port 9000 \
  --http-port 8080 \
  --spring-config ../config/spring_params.json \
  --traj-config ../config/trajectory_params.json
```

### CMake 选项

| 选项 | 默认 | 说明 |
|---|---|---|
| `USE_BOOST_LOCKFREE` | ON | 启用 Boost.Lockfree 无锁队列，关闭则降级为 mutex stub |
| `USE_SPDLOG` | ON | 启用 spdlog 结构化日志 |
| `USE_PROMETHEUS` | ON | 启用 Prometheus 指标采集 |
| `BUILD_FRONTEND` | ON | 启用前端静态资源 gzip 压缩 |

### 前端构建

```bash
# 安装依赖 (可选，仅用于 gzip 压缩)
npm install

# 前端静态检查
npm run lint

# gzip 压缩
npm run gzip
```

### 传感器模拟器

```bash
cd simulator

# 安装依赖
pip install -r requirements.txt

# 基础用法
python trebuchet_sensor_simulator.py

# 指定参数
python trebuchet_sensor_simulator.py \
  --host 127.0.0.1 \
  --port 9000 \
  --machines 5 \
  --mass-kg 12.5 \
  --launch-angle-deg 42 \
  --interval-ms 30000 \
  --wire-diameter-mm 22 \
  --coil-mean-diameter-mm 160 \
  --active-coils 10 \
  --material 50crva

# 随机模式
python trebuchet_sensor_simulator.py \
  --machines 10 \
  --randomize-mass \
  --randomize-interval
```

### 模拟器 CLI 参数

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `--host` | string | 127.0.0.1 | 后端服务器地址 |
| `--port` | int | 9000 | 后端 UDP 端口 |
| `--machines` | int | 3 | 模拟霹雳车数量 |
| **`--mass-kg`** | float | 10.0 | **弹丸重量 (kg)** |
| **`--launch-angle-deg`** | float | None | **固定发射仰角 (°)，不设则随机波动** |
| **`--interval-ms`** | int | 60000 | **上报间隔 (毫秒)** |
| `--wire-diameter-mm` | float | 20.0 | 弹簧线径 (mm) |
| `--coil-mean-diameter-mm` | float | 150.0 | 弹簧中径 (mm) |
| `--active-coils` | int | 12 | 弹簧有效圈数 |
| `--material` | choice | 65mn | 弹簧材料 (65mn / 50crva) |
| `--randomize-mass` | flag | - | 弹丸重量每台随机 ±2kg |
| `--randomize-angle` | flag | - | 每台独立随机仰角 |
| `--randomize-interval` | flag | - | 上报间隔每台随机 ±5s |

### 使用示例

```bash
# 场景1：固定 15kg 弹丸 + 45° 仰角，每秒上报一次
python trebuchet_sensor_simulator.py \
  --mass-kg 15.0 --launch-angle-deg 45 --interval-ms 1000

# 场景2：50CrVA 高强度弹簧，22mm 线径，3 台模拟器
python trebuchet_sensor_simulator.py \
  --machines 3 --material 50crva --wire-diameter-mm 22

# 场景3：10 台设备混合参数（不同重量/间隔随机波动）
python trebuchet_sensor_simulator.py \
  --machines 10 --randomize-mass --randomize-interval
```

## API 文档

### 基础

| 端点 | 方法 | 说明 |
|---|---|---|
| `/health` | GET | 健康检查 |
| `/metrics` | GET | Prometheus 指标（端口 8081） |

### 业务 API

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/config/spring` | GET | 获取当前弹簧参数配置 |
| `/api/config/spring` | POST | 更新弹簧参数 |
| `/api/config/trajectory` | GET | 获取当前弹道参数配置 |
| `/api/config/trajectory` | POST | 更新弹道参数 |
| `/api/sensor/latest?machine_id=TREB-001` | GET | 获取指定设备最新传感器数据 |
| `/api/sensor/history?machine_id=TREB-001&hours=24` | GET | 获取设备历史数据 |
| `/api/alerts?limit=100` | GET | 获取告警记录 |
| `/api/range/predict` | POST | 射程预测 |
| `/api/range/optimal` | POST | 最优仰角搜索 |
| `/api/spring/energy` | POST | 弹簧储能计算 |
| `/api/stats/summary` | GET | 系统统计摘要 |
| `/api/stats/throughput` | GET | 吞吐量统计 |

### 请求示例

```bash
# 健康检查
curl http://localhost:8080/health
# {"status":"ok","timestamp":1718765432,"version":"2.0.0"}

# 射程预测
curl -X POST http://localhost:8080/api/range/predict \
  -H "Content-Type: application/json" \
  -d '{
    "mass_kg": 10.0,
    "launch_angle_deg": 45,
    "release_velocity": 85.5,
    "temperature_k": 288.15
  }'

# 最优仰角搜索
curl -X POST http://localhost:8080/api/range/optimal \
  -H "Content-Type: application/json" \
  -d '{
    "mass_kg": 15.0,
    "release_velocity": 92.0,
    "min_angle": 10,
    "max_angle": 80
  }'
```

## 指标监控

Prometheus 指标在 `:8081/metrics` 暴露。

### 核心指标

| 指标 | 类型 | 说明 |
|---|---|---|
| `trebuchet_udp_packets_total` | Counter | UDP 接收包数（按 valid/invalid 标签区分） |
| `trebuchet_alerts_total` | Counter | 告警总数（按 type/level 标签区分） |
| `trebuchet_predictions_total` | Counter | 射程预测总数 |
| `trebuchet_spring_stored_energy_joules` | Gauge | 弹簧储能 (J) |
| `trebuchet_spring_release_efficiency` | Gauge | 能量释放效率 |
| `trebuchet_spring_modulus_reduction_ratio` | Gauge | 剪切模量退化比 |
| `trebuchet_range_predicted_meters` | Gauge | 预测射程 (m)，带 machine_id/material/active_coils 标签 |
| `trebuchet_range_actual_meters` | Gauge | 实际射程 (m) |
| `trebuchet_optimal_launch_angle_degrees` | Gauge | 最优发射仰角 (°) |
| `trebuchet_projectile_mach_number` | Gauge | 最大马赫数 |
| `trebuchet_spring_shear_stress_pa` | Gauge | 弹簧剪应力 (Pa) |
| `trebuchet_spring_cycle_count` | Gauge | 循环次数 |
| `trebuchet_spring_cyclic_damage_ratio` | Gauge | 循环损伤比 (Miner) |
| `trebuchet_operation_latency_seconds` | Histogram | 操作延迟直方图（0.1ms ~ 10s 分桶） |

### Grafana 仪表盘配置

导入 `docker/grafana/dashboard.json` 获得预置仪表盘：
- 系统吞吐量实时监控
- 弹簧状态热力图（按设备）
- 射程预测 vs 实际散点图
- 马赫数分布直方图
- 告警分布饼图
- 循环损伤累积趋势

## 配置说明

### 弹簧参数 `config/spring_params.json`

```json
{
  "wireDiameterMm": 20.0,
  "coilMeanDiameterMm": 150.0,
  "activeCoils": 12,
  "materialKey": "65mn",
  "material": {
    "shearModulusPa": 79.3e9,
    "yieldStrengthPa": 785e6,
    "density": 7850.0,
    "fatigueDuctilityCoeff": 0.42,
    "fatigueDuctilityExp": -0.58,
    "cyclicStrengthCoeffPa": 1300e6,
    "cyclicStrengthExp": -0.10
  },
  "cyclicSoftening": {
    "c1KinematicGPa": 40.0,
    "d1Kinematic": 200.0,
    "qSatSofteningMPa": 120.0,
    "bSoftening": 30.0
  },
  "efficiencyStages": [
    {"maxThetaRad": 1.0, "efficiency": 0.6},
    {"maxThetaRad": 1.5, "efficiency": 0.75},
    {"maxThetaRad": 2.5, "efficiency": 0.85},
    {"maxThetaRad": 4.0, "efficiency": 0.78}
  ],
  "thresholds": {
    "fractureRiskYieldRatio": 0.9,
    "fatigueDamageWarning": 0.5,
    "fatigueDamageCritical": 0.8
  }
}
```

### 弹道参数 `config/trajectory_params.json`

```json
{
  "projectileMassKg": 10.0,
  "projectileDiameterM": 0.2,
  "dragCoefficientIncompressible": 0.47,
  "atmosphere": {
    "gravity": 9.80665,
    "airDensityKgm3": 1.225,
    "speedOfSoundMs": 343.2,
    "temperatureK": 288.15
  },
  "compressibleFlow": {
    "incompressibleMach": 0.3,
    "criticalMach": 0.75,
    "transonicStartMach": 0.75,
    "transonicEndMach": 1.3,
    "supersonicStartMach": 1.2,
    "waveDragPeak": 0.35
  },
  "integration": {
    "dtPredict": 0.001,
    "dtSimulate": 0.002
  },
  "rangeInsufficientFactor": 0.85
}
```

## ClickHouse 存储架构

### 数据表 TTL 策略

| 表名 | 原始保留 | 降采样 | 长期保留 |
|---|---|---|---|
| `sensor_data` | 7 天 (hot) | 1min → `sensor_data_1m` | 365 天 |
| `spring_energy_data` | 90 天 | - | 90 天 |
| `range_predictions` | 90 天 | - | 90 天 |
| `alerts` | 365 天 | - | 365 天 |
| `cyclic_fatigue_log` | 730 天 | - | 730 天 |
| `sensor_data_1m` | - | 1min 聚合 | 365 天 |
| `sensor_data_1h` | - | 1h 聚合 | 730 天 |
| `latest_machine_status` | 30 天 | ReplacingMergeTree | 30 天 |

### 物化视图

1. **`sensor_data_1m_mv`**：分钟级聚合（avg/max/min 扭力角、储能、效率等 15 项指标）
2. **`sensor_data_1h_mv`**：小时级聚合（从 1min 表上卷）
3. **`latest_machine_status_mv`**：最新设备状态（ReplacingMergeTree 自动去重）

### 常用查询

```sql
-- 某设备过去 24 小时分钟级数据
SELECT
    timestamp,
    avg_torsion_angle,
    avg_stored_energy,
    avg_actual_range,
    max_risk_level
FROM sensor_data_1m
WHERE machine_id = 'TREB-001'
  AND timestamp >= now() - INTERVAL 24 HOUR
ORDER BY timestamp;

-- 所有设备最新状态
SELECT
    machine_id,
    last_seen,
    last_stored_energy,
    last_risk_level,
    cycle_count,
    cyclic_damage_ratio,
    remaining_life_cycles
FROM latest_machine_status
FINAL
ORDER BY last_seen DESC;

-- 告警统计（按类型）
SELECT
    alert_type,
    alert_level,
    count() as cnt
FROM alerts
WHERE timestamp >= now() - INTERVAL 24 HOUR
GROUP BY alert_type, alert_level
ORDER BY cnt DESC;
```

## 目录结构

```
.
├── backend/                    # C++ 后端
│   ├── CMakeLists.txt
│   ├── cmake/
│   │   └── gzip_frontend.cmake # 前端 gzip 构建脚本
│   ├── include/                # 头文件
│   │   ├── message_bus.h       # 消息总线 + 队列
│   │   ├── udp_receiver_module.h
│   │   ├── spring_simulator_module.h
│   │   ├── range_predictor_module.h
│   │   ├── alarm_mqtt_module.h
│   │   ├── metrics_collector.h # Prometheus 指标
│   │   ├── logger.h            # spdlog 封装
│   │   └── ...
│   └── src/                    # 源文件
├── config/                     # 外置 JSON 配置
│   ├── spring_params.json
│   └── trajectory_params.json
├── frontend/                   # 前端
│   ├── index.html
│   ├── js/
│   │   ├── physics.js          # 物理模型
│   │   ├── app.js              # 应用入口
│   │   ├── traction_trebuchet_3d.js  # 3D 渲染模块
│   │   └── range_panel.js      # 弹道面板模块
│   └── config/                 # 前端同步配置
├── simulator/                  # Python 传感器模拟器
│   ├── trebuchet_sensor_simulator.py
│   └── requirements.txt
├── docker/                     # Docker 相关
│   ├── backend/Dockerfile
│   ├── clickhouse/
│   │   ├── Dockerfile
│   │   ├── config.xml          # ClickHouse 配置（TTL + 压缩）
│   │   ├── users.xml
│   │   └── init/001_schema.sql  # 建表 + 物化视图
│   ├── mqtt/
│   │   ├── Dockerfile
│   │   └── mosquitto.conf
│   ├── simulator/Dockerfile
│   └── prometheus/prometheus.yml
├── scripts/
│   └── gzip_frontend.js        # Node.js gzip 压缩脚本
├── docker-compose.yml          # 一键编排
├── package.json                # 前端构建脚本
└── README.md
```

## 故障排查

### 后端服务无法启动

```bash
# 查看日志
docker logs trebuchet-backend

# 检查端口占用
netstat -tulpn | grep -E '8080|8081|9000'
```

### ClickHouse 连接失败

```bash
# 检查服务状态
docker exec trebuchet-clickhouse clickhouse-client -q "SELECT version()"

# 查看连接数
docker exec trebuchet-clickhouse clickhouse-client -q \
  "SELECT count() FROM system.processes"
```

### MQTT 告警未推送

```bash
# 监听告警主题
docker exec trebuchet-mqtt mosquitto_sub -v -t 'trebuchet/alerts/#'

# 查看连接状态
docker exec trebuchet-mqtt mosquitto_pub -t 'test' -m 'hello'
```

## License

军事史研究用途，非商业开源。
