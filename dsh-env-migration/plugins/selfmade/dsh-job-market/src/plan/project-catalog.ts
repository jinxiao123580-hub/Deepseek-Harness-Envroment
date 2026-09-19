/**
 * project-catalog —— 项目驱动模板（需求 §十二）
 *
 * 设计约束（对应需求 §十一「禁止不可验收目标」）：
 *  - 一个「学 ROS2」式的目标无法验收，但「让移动机器人从 MCU 一路跑到 Nav2 自主导航」
 *    可以验收。因此这里把技能学习全部挂到 **真实可构建的机器人项目** 上，
 *    每个模板都是一条有序的、可逐阶段验证的建造链。
 *  - 模板只是「建造顺序 + 每阶段练哪些技能」，不含任何统计数字；
 *    所有覆盖率数字都由 `instantiateProject` 基于真实快照计算，避免出现假数字。
 *  - `covered_skill_ids` 只统计 **本次快照里真的出现过岗位** 的技能：
 *    没有市场数据的技能不算覆盖，否则覆盖率会被虚高。
 */

import type { ProjectPlan, ProjectStage } from '../shared/types.js';
import { roundTo, uniquePreserveOrder } from '../shared/text.js';

/** 项目模板：阶段有序，每阶段声明它训练的技能 ID。 */
export interface ProjectTemplate {
    project_id: string;
    name: string;
    description: string;
    /** Ordered build stages; each stage names the skills it exercises. */
    stages: { name: string; detail: string; skill_ids: string[] }[];
}

/**
 * 项目模板目录，按「边际学习成本递增」排序（最便宜/最基础在前）：
 *  1. mobile-robot            全栈主线，复用最通用的 ROS2/嵌入式技能
 *  2. embedded-motion-control 底层运动控制，硬件在环但技能面窄
 *  3. ros2-arm                机械臂 + MoveIt2，需要运动学与轨迹规划
 *  4. slam-navigation         激光 SLAM 与导航，需要后端优化与概率论
 *  5. vision-perception       视觉感知，需要标定与深度学习
 *  6. rl-embodied             仿真 + 强化学习 + sim2real，前期成本最高
 */
export const PROJECT_CATALOG: ProjectTemplate[] = [
    {
        project_id: 'mobile-robot',
        name: '移动机器人全栈项目',
        description:
            '从 MCU 底层一路做到 ROS2 自主导航：STM32/ESP32 采集电机、编码器、IMU → micro-ROS 接入 ROS2 → ' +
            'TF/Odom 与 EKF 融合 → LiDAR + SLAM 建图 → Nav2 自主导航 → RViz 可视化验收。' +
            '一条链覆盖机器人软件岗位最核心的技能栈，且每一环都能独立跑起来验证。',
        stages: [
            {
                name: 'STM32/ESP32',
                detail: '点亮开发板并跑通串口、定时器与中断，建立后续所有底层实验的最小固件工程。',
                skill_ids: ['stm32', 'esp32', 'embedded', 'cpp', 'c'],
            },
            {
                name: '电机 + 编码器 + IMU',
                detail: '驱动直流/无刷电机，正交解码读编码器，读 IMU 并做零偏标定，形成可读的传感器数据流。',
                skill_ids: ['motor', 'encoder', 'imu', 'sensor-fusion', 'state-estimation'],
            },
            {
                name: 'micro-ROS',
                detail: '在 MCU 上跑 micro-ROS 节点，通过串口/UDP 与主机 ROS2 图连通，把底层数据发布成标准话题。',
                skill_ids: ['micro-ros', 'ros2', 'qos', 'uart'],
            },
            {
                name: 'ROS2',
                detail: '在主机侧建立 ROS2 工作区，用节点/话题/服务/参数/launch 组织整车软件。',
                skill_ids: ['ros2', 'ament', 'colcon', 'cmake', 'python', 'linux', 'git'],
            },
            {
                name: 'TF / Odom',
                detail: '由轮速推出里程计并广播 map→odom→base_link→laser 的完整 TF 链。',
                skill_ids: ['tf2', 'odometry', 'urdf', 'rviz'],
            },
            {
                name: 'EKF',
                detail: '用 EKF 融合轮式里程计与 IMU，给出协方差并对比融合前后的轨迹误差。',
                skill_ids: ['ekf', 'kalman-filter', 'state-estimation', 'sensor-fusion'],
            },
            {
                name: 'LiDAR',
                detail: '接入激光雷达，标定外参，去除运动畸变，把点云正确投到 laser 坐标系。',
                skill_ids: ['lidar', 'point-cloud', 'calibration', 'tf2'],
            },
            {
                name: 'SLAM',
                detail: '用 Cartographer/ LIO-SAM 建图，检查回环与地图闭合误差，输出占据栅格地图。',
                skill_ids: ['slam', 'cartographer', 'lio-sam', 'icp', 'g2o', 'ceres'],
            },
            {
                name: 'Nav2',
                detail: '配置 costmap 与规划器/控制器插件，让机器人在建好的地图上完成点到点自主导航。',
                skill_ids: ['nav2', 'motion-planning', 'costmap', 'localization', 'behavior-tree'],
            },
            {
                name: 'RViz',
                detail: '配置可复现的 RViz 视图，同时显示 TF、激光、代价地图与规划路径，作为最终验收证据。',
                skill_ids: ['rviz', 'tf2', 'rosbag'],
            },
        ],
    },
    {
        project_id: 'embedded-motion-control',
        name: '嵌入式运动控制项目',
        description:
            '用一颗 MCU 完成一台电机的闭环控制：FOC 电流环 → 速度环 → 位置环，PID 整定、CAN 通信与实时性保障，' +
            '最终能用上位机指令让电机稳定跟踪位置/速度曲线。',
        stages: [
            {
                name: '硬件与最小系统',
                detail: '完成供电、驱动板接线与最小固件，验证 GPIO/定时器/PWM 与 SWD 调试。',
                skill_ids: ['stm32', 'embedded', 'motor', 'pwm'],
            },
            {
                name: '编码器与传感器',
                detail: '读正交编码器与电流采样，标定零点，验证计数与电流读数与实际一致。',
                skill_ids: ['encoder', 'adc', 'imu', 'sensor-fusion'],
            },
            {
                name: 'FOC 与电流环',
                detail: '实现 Clarke/Park 变换与 SVPWM，把电流环跑通并做电角度对齐。',
                skill_ids: ['foc', 'control', 'current-loop', 'pid'],
            },
            {
                name: '速度环与位置环',
                detail: '串级 PID 整定速度环/位置环，给出阶跃响应曲线（超调、调节时间）。',
                skill_ids: ['pid', 'velocity-loop', 'position-loop', 'control', 'matlab'],
            },
            {
                name: 'CAN 通信',
                detail: '用 CAN/CANopen 接收上位机指令并回传状态，总线周期稳定、无丢帧。',
                skill_ids: ['can-bus', 'canopen', 'modbus', 'uart'],
            },
            {
                name: 'RTOS 与实时性',
                detail: '把控制、通信、日志拆到不同优先级任务，测量周期抖动并给出最坏执行时间。',
                skill_ids: ['rtos', 'real-time', 'embedded', 'linux'],
            },
        ],
    },
    {
        project_id: 'ros2-arm',
        name: 'ROS2 机械臂控制项目',
        description:
            '从 URDF 建模到 MoveIt2 规划执行：正逆运动学、轨迹规划、ros2_control 硬件接口与力控，' +
            '最终让机械臂完成一次抓取-放置并给出可复现的演示记录。',
        stages: [
            {
                name: 'URDF 建模',
                detail: '写出机械臂 URDF/Xacro（含惯性参数与碰撞体），check_urdf 通过且 RViz 与 TF 一致。',
                skill_ids: ['urdf', 'tf2', 'rviz', 'ros2'],
            },
            {
                name: '运动学',
                detail: '实现正/逆运动学并分析雅可比与奇异位形，与实机/仿真位姿核对误差。',
                skill_ids: ['kinematics', 'eigen', 'cpp', 'python'],
            },
            {
                name: 'MoveIt2 与轨迹规划',
                detail: '配置 SRDF 与规划组，用 OMPL 规划出无碰撞轨迹并在 RViz 中可视化。',
                skill_ids: ['moveit2', 'motion-planning', 'trajectory-optimization', 'ros2'],
            },
            {
                name: 'ros2_control 与执行',
                detail: '编写控制器与硬件接口，让规划出的轨迹真正在关节上执行并跟踪误差。',
                skill_ids: ['ros2-control', 'ros2', 'control', 'real-time'],
            },
            {
                name: '力控与抓取',
                detail: '接入力/力矩传感器做阻抗控制，完成一次抓取-放置并量化接触稳定性。',
                skill_ids: ['force-control', 'pid', 'control', 'state-estimation'],
            },
        ],
    },
    {
        project_id: 'slam-navigation',
        name: '激光 SLAM 与自主导航项目',
        description:
            '用激光雷达（可选 IMU）做建图、定位与自主导航：Cartographer/LIO-SAM 建图、回环与后端优化、' +
            'AMCL 定位、全局/局部规划与 costmap 调参，最终在大场景中完成长距离自主导航。',
        stages: [
            {
                name: '传感器与 TF',
                detail: '标定雷达/IMU 外参，建立一致 TF 链，去运动畸变，把数据正确投到统一坐标系。',
                skill_ids: ['lidar', 'imu', 'tf2', 'calibration', 'odometry'],
            },
            {
                name: '前端里程计',
                detail: '实现/调通 ICP 或 NDT 前端里程计，在公开数据集上给出轨迹与误差指标。',
                skill_ids: ['icp', 'ndt', 'odometry', 'eigen', 'cpp'],
            },
            {
                name: '建图（Cartographer/LIO-SAM）',
                detail: '跑通 Cartographer 或 LIO-SAM，产出占据栅格/点云地图并核对环境尺寸。',
                skill_ids: ['cartographer', 'lio-sam', 'slam', 'point-cloud'],
            },
            {
                name: '后端优化与回环',
                detail: '用 g2o/Ceres/GTSAM 做位姿图优化与回环检测，展示优化前后残差与闭合误差变化。',
                skill_ids: ['g2o', 'ceres', 'gtsam', 'slam', 'optimization'],
            },
            {
                name: '定位（AMCL）',
                detail: '在建好的地图上用 AMCL 定位，评估定位精度并实现丢失后的重定位。',
                skill_ids: ['localization', 'slam', 'kalman-filter', 'rviz'],
            },
            {
                name: '导航与 costmap',
                detail: '配置 costmap 与全局/局部规划器，完成动态障碍下的自主导航与恢复行为。',
                skill_ids: ['nav2', 'costmap', 'motion-planning', 'behavior-tree', 'localization'],
            },
        ],
    },
    {
        project_id: 'vision-perception',
        name: '视觉感知流水线项目',
        description:
            '搭建一条真实的视觉流水线：相机标定 → 图像处理 → 特征/检测 → 点云处理 → 手眼标定，' +
            '最终让机械臂或机器人依据视觉结果完成一次闭环抓取/对位。',
        stages: [
            {
                name: '相机标定',
                detail: '用棋盘格完成内参标定，重投影误差 < 0.5px，并输出可复现的标定报告。',
                skill_ids: ['camera-calibration', 'opencv', 'calibration', 'perception'],
            },
            {
                name: '图像处理',
                detail: '用 OpenCV 完成滤波/阈值/形态学与轮廓处理，给出参数依据与前后对比图。',
                skill_ids: ['opencv', 'perception', 'python', 'cpp'],
            },
            {
                name: '特征与检测',
                detail: '实现特征匹配（含误匹配剔除）并训练/微调一个检测模型，给出 mAP 与可视化结果。',
                skill_ids: ['opencv', 'yolo', 'object-detection', 'pytorch', 'perception'],
            },
            {
                name: '点云与三维',
                detail: '用 PCL 做点云滤波、分割与配准，把深度信息与图像对齐，得到目标三维位姿。',
                skill_ids: ['pcl', 'point-cloud', '3d-vision', 'icp', 'perception'],
            },
            {
                name: '手眼标定与闭环',
                detail: '完成 eye-in-hand 手眼标定，让机械臂依据视觉结果完成一次抓取，误差 < 5mm。',
                skill_ids: ['hand-eye-calibration', 'calibration', 'kinematics', 'perception'],
            },
        ],
    },
    {
        project_id: 'rl-embodied',
        name: '强化学习与具身智能项目',
        description:
            '在 MuJoCo/Isaac 里训练一个连续控制策略：MDP 建模 → PPO/SAC 训练 → 域随机化 sim2real → ' +
            'TensorRT/Jetson 部署，最终让真实或仿真机器人跑出可复现的成功率。',
        stages: [
            {
                name: '仿真环境',
                detail: '在 MuJoCo/Isaac Sim 里搭出任务环境，配好观测、动作与奖励，跑通随机策略基线。',
                skill_ids: ['mujoco', 'isaac-sim', 'python', 'gazebo'],
            },
            {
                name: '算法实现（PPO/SAC）',
                detail: '从零实现 PPO 或 SAC，画出训练曲线并复现论文量级的回报。',
                skill_ids: ['ppo', 'sac', 'reinforcement-learning', 'pytorch'],
            },
            {
                name: '训练与评估协议',
                detail: '固定随机种子与评估协议，做多组对照实验并统计成功率与方差。',
                skill_ids: ['reinforcement-learning', 'pytorch', 'experiment'],
            },
            {
                name: 'sim2real',
                detail: '用域随机化与动力学参数辨识缩小仿真-实机落差，量化迁移前后的成功率差。',
                skill_ids: ['sim2real', 'reinforcement-learning', 'state-estimation'],
            },
            {
                name: '部署',
                detail: '把策略导出 ONNX/TensorRT 并部署到 Jetson，实测端到端时延与成功率。',
                skill_ids: ['onnx', 'tensorrt', 'jetson', 'python', 'cpp'],
            },
        ],
    },
];

/* ============================================================================
 * 实例化：把模板对上真实市场快照
 * ==========================================================================*/

/** 快照里单条技能的统计形状（`SkillFrequency` 的结构子集）。 */
type SkillFrequencyLike = { job_count: number; job_ratio: number; job_ids: readonly string[] };

/** 默认取 TOP20：按岗位数降序，同数按技能 ID 升序（保证确定性）。 */
const topSkillsByJobCount = (skillFrequencies: ReadonlyMap<string, SkillFrequencyLike>, size: number): string[] =>
    [...skillFrequencies.entries()]
        .sort((a, b) => {
            const diff = (b[1]?.job_count ?? 0) - (a[1]?.job_count ?? 0);
            if (diff !== 0) return diff;
            return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
        })
        .slice(0, size)
        .map(([skillId]) => skillId);

/**
 * 把项目模板实例化成可交付的 `ProjectPlan`。
 *
 *  - `stages[].skill_ids` 保留模板声明的完整技能清单（建造计划不该被统计数据删掉）；
 *  - `covered_skill_ids` 只包含 **快照里真有岗位** 的技能（覆盖数字必须可回溯）；
 *  - `market_job_count` = 这些技能 `job_ids` 的并集大小（不是简单相加，避免重复计岗位）；
 *  - `market_coverage` = `market_job_count / totalJobs`，`totalJobs <= 0` 时记 0；
 *  - `top20_covered` 统计覆盖了目标 TOP 技能中的几项，`top20_total` 为清单长度。
 */
export const instantiateProject = (
    template: ProjectTemplate,
    skillFrequencies: ReadonlyMap<string, SkillFrequencyLike>,
    totalJobs: number,
    opts?: { topSkillIds?: readonly string[] },
): ProjectPlan => {
    const stages: ProjectStage[] = [];
    const coveredSkillIds: string[] = [];
    const coveredJobIds = new Set<string>();

    for (const stage of template.stages) {
        const declared = Array.isArray(stage.skill_ids) ? [...stage.skill_ids] : [];
        for (const skillId of declared) {
            const frequency = skillFrequencies.get(skillId);
            // 快照里没有该技能 = 没有真实岗位支撑 → 不计入覆盖。
            if (frequency === undefined) continue;
            if (!coveredSkillIds.includes(skillId)) coveredSkillIds.push(skillId);
            for (const jobId of frequency.job_ids ?? []) coveredJobIds.add(jobId);
        }
        stages.push({ name: stage.name, detail: stage.detail, skill_ids: declared });
    }

    const covered = uniquePreserveOrder(coveredSkillIds);
    const coveredSet = new Set(covered);

    const explicitTop =
        opts?.topSkillIds !== undefined && opts.topSkillIds.length > 0
            ? uniquePreserveOrder([...opts.topSkillIds])
            : topSkillsByJobCount(skillFrequencies, 20);

    const marketJobCount = coveredJobIds.size;
    const total = typeof totalJobs === 'number' && Number.isFinite(totalJobs) && totalJobs > 0 ? totalJobs : 0;

    return {
        project_id: template.project_id,
        name: template.name,
        description: template.description,
        stages,
        covered_skill_ids: covered,
        top20_covered: explicitTop.filter((skillId) => coveredSet.has(skillId)).length,
        top20_total: explicitTop.length,
        market_coverage: total > 0 ? roundTo(marketJobCount / total, 3) : 0,
        market_job_count: marketJobCount,
    };
};
