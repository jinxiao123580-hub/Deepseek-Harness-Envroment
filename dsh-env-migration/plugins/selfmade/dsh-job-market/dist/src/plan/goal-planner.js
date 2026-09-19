/**
 * goal-planner —— 可验收学习目标生成（需求 §十一）
 *
 * 绝对规则：**禁止产出「学习 C++」「学习 ROS2」「学习 SLAM」这类不可验收的目标**。
 * 因此本模块做三件事：
 *  1. `CAPABILITY_BREAKDOWN`：把每个技能 ID 展开成具体能力点（长周期拆解）；
 *  2. 每条能力点生成 **一条可观察的验收标准**（能跑出结果、能看到输出、能拿出截图/日志）；
 *  3. `canCompleteGoal`：只有全部验收标准都被满足（并提交了证据串）才允许标记 done。
 *
 * 数据真实性：`market_coverage` / `market_job_count` / `market_job_ids` 全部来自
 * `MarketSnapshot.skill_frequencies`（真实岗位统计），可以直接回溯到具体岗位。
 * 快照里没有真实岗位数据的技能 **不生成目标**，否则目标本身就无法被市场验证。
 *
 * 纯函数：无 I/O、无随机、无隐式时间依赖。
 */
import { clamp, roundTo } from '../shared/text.js';
/* ============================================================================
 * 一、能力点拆解表（技能 ID → 具体能力点）
 * ==========================================================================*/
/** 未登记技能使用的通用拆解：保证永不返回空列表。 */
const GENERIC_BREAKDOWN = [
    '核心概念与术语',
    '最小可运行示例',
    '在项目中独立应用',
    '常见问题排查',
    '性能与最佳实践',
];
/**
 * 技能 → 具体能力点。
 * 「掌握 ROS2」不可验收，「能搭出 map→odom→base_link→laser 的 TF tree」才可验收，
 * 这张表就是这条规则的可执行版本。
 */
export const CAPABILITY_BREAKDOWN = {
    /* ---- 需求 §十一 明确要求给出的能力点 ---- */
    ros2: ['Node', 'Topic', 'Service', 'Action', 'Parameter', 'Launch', 'TF2', 'URDF', 'QoS', 'rosbag', 'RViz', 'Nav2'],
    cpp: ['RAII', '智能指针', 'STL 容器与算法', 'lambda 与函数对象', '移动语义与完美转发', '模板与泛型编程', '多线程与并发', 'CMake 构建'],
    'modern-cpp': ['C++11 特性', 'C++14 特性', 'C++17 特性', 'C++20 概念与协程', '编译期计算'],
    linux: ['Shell 与文件系统', '进程与线程模型', '权限与用户管理', '网络与端口排查', 'systemd 服务', '性能与日志排查'],
    slam: ['传感器模型', '坐标系与 TF', '前端里程计', '后端图优化', '回环检测', '地图表示'],
    'motion-planning': ['图搜索（A*/Dijkstra）', '采样规划（RRT*/PRM）', '轨迹优化', '代价地图', '局部避障'],
    control: ['PID 整定', '状态空间建模', 'LQR', 'MPC', '频域分析', '稳定性判据'],
    'kalman-filter': ['卡尔曼滤波推导', '扩展卡尔曼滤波(EKF)', '无迹卡尔曼滤波(UKF)', '传感器融合调参'],
    embedded: ['GPIO 与中断', '定时器与 PWM', 'ADC/DMA', '外设总线(I2C/SPI/UART)', 'RTOS 任务调度', '低功耗与启动流程'],
    perception: ['相机模型与标定', '图像处理基础', '特征提取与匹配', '目标检测', '点云处理', '手眼标定'],
    /* ---- 语言 / 工具链 / 工程化 ---- */
    c: ['指针与内存布局', '结构体与位运算', '宏与条件编译', '内存管理与泄漏排查', '嵌入式 C 编码规范'],
    cpp17: ['结构化绑定', 'std::optional 与 std::variant', 'if constexpr', 'std::filesystem', '并行算法'],
    python: ['虚拟环境与依赖管理', '类型注解与 dataclass', '迭代器与推导式', '异常与上下文管理器', 'NumPy 向量化', '打包与命令行入口'],
    git: ['分支模型（main/feature/hotfix）', '原子化提交', 'merge 与 rebase', '冲突解决', '.gitignore 与仓库卫生', 'Pull Request 评审'],
    cmake: ['工程目录与 target 划分', '静态库/动态库构建', 'find_package 与依赖管理', '编译选项与优化等级', '交叉编译工具链', 'CTest 接入'],
    colcon: ['工作区与 build/install/log', '构建与选择包', '测试与 lint 集成', 'overlay 混合工作区', '构建失败排查'],
    ament: ['包结构与 package.xml', 'ament_cmake 与 ament_python', '依赖声明与导出', 'ament_lint 与测试', '安装与导出接口'],
    docker: ['镜像与分层构建', 'Dockerfile 最佳实践', '卷与环境变量', 'docker compose 多服务', 'ROS2 容器内 DDS 网络', '镜像体积与安全'],
    gtest: ['测试用例与断言', '夹具与参数化测试', 'Mock 与依赖注入', '覆盖率统计', 'CI 集成'],
    gdb: ['断点与单步', '调用栈与变量查看', 'core dump 分析', '多线程调试', '与 IDE 集成'],
    sanitizer: ['AddressSanitizer 使用', 'ThreadSanitizer 检测数据竞争', '未定义行为检测', '误报甄别', 'CI 中常态化运行'],
    dds: ['DDS 发现机制', '域与分区', 'QoS 与 ROS2 映射', '跨网段通信', '抓包分析'],
    /* ---- ROS / 机器人中间件 ---- */
    ros: ['ROS1 架构（roscore）', '话题与服务', 'roslaunch', 'TF 与坐标', 'ROS1→ROS2 迁移要点'],
    tf2: ['坐标系与父子关系', '静态/动态广播', 'lookupTransform 与时间戳', 'TF tree 可视化与调试', '多传感器外参维护'],
    urdf: ['link/joint 建模', '惯性参数与碰撞体', 'xacro 宏与参数化', 'check_urdf 与 RViz 验证', '与 TF 的一致性'],
    qos: ['可靠性策略（reliable/best_effort）', '历史与深度', '持久性与租期', '不匹配排查', '多机/跨网场景选型'],
    rosbag: ['录制与回放', '话题筛选与切分', 'rosbag2 存储格式', '离线回放调试', '数据版本管理'],
    rviz: ['显示项与话题绑定', 'TF 与激光/点云显示', '插件与自定义显示', '配置保存与共享', '显示异常排查'],
    'micro-ros': ['micro-ROS 架构（agent/client）', 'MCU 侧节点与发布订阅', '串口/UDP 传输配置', '内存与 QoS 约束', '与主机 ROS2 图连通性验证'],
    'ros2-control': ['控制器管理器与硬件接口', 'ros2_control 配置（URDF）', '自定义控制器编写', '实时性与控制周期', '与 MoveIt2 对接'],
    'behavior-tree': ['BT 基本节点（序列/选择/装饰）', '黑板与数据流', 'Nav2 行为树结构', '自定义节点实现', '失败与恢复流程调试'],
    nav2: ['Nav2 架构与生命周期节点', 'costmap 配置', '全局规划器插件', '局部控制器（DWB/TEB）', '行为树导航流程', '恢复行为与失败排查'],
    costmap: ['分层结构与插件', '膨胀半径与代价', '传感器层与滚动窗口', '参数对规划的影响', '动态障碍处理'],
    localization: ['AMCL 粒子滤波定位', '初始位姿与重定位', '定位精度评估', '多传感器组合定位', '定位丢失恢复'],
    moveit2: ['SRDF 与规划组', '运动学求解器配置', 'OMPL 规划与可视化', '轨迹执行与控制器对接', '笛卡尔与力控接口'],
    kinematics: ['正运动学（DH/指数积）', '逆运动学解析与数值解', '雅可比与奇异位形', '工作空间分析', '与实机位姿一致性'],
    'force-control': ['力/力矩传感器标定', '阻抗与导纳控制', '力位混合控制', '接触稳定性', '装配任务验证'],
    /* ---- SLAM / 状态估计 ---- */
    odometry: ['轮式里程计模型', '差速/阿克曼运动学', '协方差与不确定度', '打滑与累积误差', '与 IMU/激光融合'],
    icp: ['最近点匹配与迭代', '初值敏感性', '点到点/点到面', '收敛判据与误差', '退化场景处理'],
    ndt: ['体素化与概率表示', 'NDT 配准流程', '分辨率与邻域调参', '与 ICP 的对比', '大场景建图应用'],
    cartographer: ['建图配置（lua）与传感器输入', '前端扫描匹配', '子图与回环', '地图输出与保存', '建图质量排查'],
    'lio-sam': ['激光-惯性紧耦合原理', 'IMU 预积分', '回环与位姿图', '参数调优', '大场景建图评估'],
    g2o: ['图优化建模（顶点/边）', '信息矩阵设置', '求解器与迭代策略', '位姿图 SLAM 落地', '残差与收敛诊断'],
    ceres: ['CostFunctor 与自动求导', '损失函数与鲁棒核', '求解配置与收敛', 'BA 与位姿图实例', '性能与稀疏性'],
    gtsam: ['因子图与 Key', 'ISAM2 增量优化', '回环与位姿图', '噪声模型选择', '结果评估与调试'],
    optimization: ['最小二乘与非线性优化', '雅可比与 Hessian', '鲁棒核函数', '稀疏性与求解效率', '收敛失败排查'],
    ekf: ['状态与协方差定义', '预测与更新实现', '雅可比推导', '噪声参数整定', '与 UKF 的取舍'],
    'state-estimation': ['状态定义与可观测性', '滤波与优化两种范式', '传感器噪声建模', '估计精度评估', '实机调参'],
    'sensor-fusion': ['多传感器时间同步', '观测模型与坐标系统一', '滤波 vs 优化融合', '外参标定', '融合前后指标对比'],
    /* ---- 控制 ---- */
    pid: ['P/I/D 作用与耦合', '整定方法（Ziegler-Nichols 等）', '抗积分饱和', '微分滤波与噪声抑制', '阶跃响应指标评估'],
    lqr: ['线性化与状态空间', 'Q/R 权重选择', 'Riccati 方程求解', '闭环极点与稳定裕度', '与 PID 的对比'],
    mpc: ['预测模型与离散化', '代价函数与约束', 'QP 求解与实时性', '滚动时域实现', '跟踪精度与鲁棒性'],
    foc: ['FOC 原理（Clarke/Park）', '电流采样与相电流重构', 'SVPWM 实现', '电角度与编码器对齐', '力矩控制验证'],
    /* ---- 嵌入式 ---- */
    stm32: ['时钟树与最小系统', 'HAL/LL 库与外设初始化', 'GPIO/中断/定时器', '串口与调试（SWD）', '固件结构与版本管理'],
    esp32: ['开发环境（ESP-IDF/Arduino）', 'WiFi 与 UDP/TCP 通信', 'FreeRTOS 任务', '外设与 ADC/PWM', 'OTA 与低功耗'],
    rtos: ['任务与优先级', '信号量/队列/互斥量', '中断与临界区', '栈与内存配置', '实时性与抖动测量'],
    'real-time': ['实时内核与抢占', '优先级反转与继承', '内存锁定与无锁队列', '周期任务抖动测量', '最坏执行时间分析'],
    motor: ['直流/无刷电机原理', '驱动器接线与供电', '方向与使能控制', '转速-电流关系', '堵转与过热保护'],
    encoder: ['增量式编码器接线', '正交解码与计数', '线数与分辨率换算', '速度估计与滤波', '丢计数排查'],
    imu: ['加速度计/陀螺仪原理', '零偏与噪声标定', '姿态解算（互补/Mahony）', '数据同步与时间戳', '振动与安装误差'],
    adc: ['采样率与分辨率', '参考电压与量程', 'DMA 连续采样', '软件滤波与去噪', '采样精度验证'],
    pwm: ['定时器与频率计算', '占空比与死区', '互补输出与刹车', '实测频率/占空比验证', '驱动电路匹配'],
    uart: ['波特率与帧格式', '中断/DMA 收发', '协议分包与校验', '丢包与粘包排查', '与上位机联调'],
    canopen: ['对象字典与 SDO', 'PDO 映射与同步周期', 'NMT 状态机', 'CiA402 驱动配置', '故障排查'],
    modbus: ['寄存器模型（线圈/输入/保持）', 'RTU 与 TCP 报文', '功能码与异常码', '主从轮询实现', '调试工具验证'],
    /* ---- 总线 / 硬件接口 ---- */
    'can-bus': ['CAN 帧格式与仲裁', 'SocketCAN 配置与抓包', '报文收发与周期任务', '总线负载与错误帧排查', '终端电阻与物理层'],
    ethercat: ['EtherCAT 拓扑与从站', 'PDO/SDO 映射', 'DC 分布式时钟', '实时主站（IgH/SOEM）', '周期抖动测量'],
    /* ---- 感知 ---- */
    lidar: ['机械/固态激光雷达原理', '点云数据格式与驱动', '内外参标定', '运动畸变去除', '反射率与盲区问题'],
    'point-cloud': ['点云格式与坐标系', '降采样与滤波', '分割与聚类', '配准与融合', '点云地图维护'],
    opencv: ['图像读写与色彩空间', '滤波与形态学', '边缘与轮廓', '相机标定接口', '特征与光流', '性能优化（ROI/并行）'],
    pcl: ['点云读写与可视化', '滤波（体素/统计）', '分割（RANSAC/欧式聚类）', '配准（ICP/NDT）', '法线与特征计算'],
    yolo: ['数据标注与格式转换', '训练配置与超参', 'mAP 评估', '导出 ONNX/TensorRT', '部署推理与后处理', '误检漏检分析'],
    'object-detection': ['数据集与标注', '检测模型训练', 'mAP/IoU 评估', '推理部署与加速', '误检漏检分析'],
    calibration: ['内参/外参模型', '标定数据采集', '标定求解与验证', '重投影误差评估', '漂移与在线补偿'],
    'camera-calibration': ['内参模型与畸变', '棋盘格/圆点标定流程', '重投影误差评估', '双目与深度标定', '在线标定与漂移'],
    'hand-eye-calibration': ['手眼标定模型（AX=XB）', '标定板与数据采集', '求解与验证', '误差来源分析', '在线误差补偿'],
    '3d-vision': ['深度相机模型', '点云-图像对齐', '三维重建基础', '位姿估计（PnP/ICP）', '三维目标检测'],
    /* ---- 仿真 / AI / 部署 ---- */
    gazebo: ['世界与模型文件（SDF/URDF）', '传感器插件（激光/IMU/相机）', '物理参数与实时因子', 'ros_gz 桥接', '仿真与实机一致性'],
    mujoco: ['MJCF 模型建模', '接触与执行器配置', '仿真步进与稳定性', 'Python 接口与渲染', '与真实动力学对比'],
    'isaac-sim': ['场景与资产导入', 'Python 脚本化环境', '并行仿真与域随机化', '传感器与数据采集', '与 RL 训练框架对接'],
    pytorch: ['张量与自动求导', 'Dataset/DataLoader', '模型定义与训练循环', 'GPU 训练与混合精度', '模型保存与导出', '训练问题排查'],
    'reinforcement-learning': ['MDP 与回报定义', '值函数与 Q-Learning', '策略梯度与 Actor-Critic', 'PPO 实现与调参', 'SAC 连续控制', '训练曲线与评估协议'],
    ppo: ['策略与价值网络', '优势估计（GAE）', '裁剪目标与更新', '超参与并行采样', '训练稳定性排查'],
    sac: ['最大熵目标', '双 Q 网络与目标网络', '自动温度调节', '连续控制任务实现', '样本效率评估'],
    sim2real: ['域随机化', '动力学参数辨识', '观测/动作空间一致性', '仿真到实机迁移实验', '性能落差量化'],
    onnx: ['导出与算子兼容', '图简化与检查', 'onnxruntime 推理', '动态 batch/尺寸', '跨框架精度对齐'],
    tensorrt: ['ONNX 导出与解析', 'FP16/INT8 精度模式', '校准与量化', '推理引擎构建', '端到端时延测量'],
    jetson: ['JetPack 与刷机', '功耗模式与散热', 'CUDA/cuDNN 环境', '摄像头与硬件编解码', '部署与性能基准'],
    eigen: ['矩阵/向量基本运算', '几何模块（旋转/四元数）', '分解与求解（LU/QR/SVD）', '稀疏矩阵使用', '避免临时对象与表达式模板'],
    open3d: ['点云读写与可视化', '体素与下采样', '配准与 ICP', '法线与聚类', '网格重建'],
};
/** 取某技能的能力点；未登记时退回通用拆解（永不为空）。 */
const breakdownFor = (skillId) => {
    const registered = CAPABILITY_BREAKDOWN[skillId];
    return registered !== undefined && registered.length > 0 ? [...registered] : [...GENERIC_BREAKDOWN];
};
/* ============================================================================
 * 二、验收标准生成（每条能力点 → 一条可观察的验收标准）
 * ==========================================================================*/
/** 通用验收标准模板：必须有可运行产物 + 可观察证据。 */
const GENERIC_CRITERION = (sub) => `提交一个可运行的「${sub}」最小工程：代码入库 + 运行日志或截图，并书面说明关键参数与踩坑点`;
/**
 * 具体技能的「可观察验收标准」表（skill_id → 能力点 → 验收标准）。
 * 写法要求：能跑出结果、能看到输出、能拿出证据（截图/日志/示波器/误差数字）。
 * 未在此表登记的能力点走 `GENERIC_CRITERION`。
 */
const CONCRETE_CRITERIA = {
    ros2: {
        Node: '用 C++/Python 写出一个节点，ros2 node list 能看到它，且 Ctrl+C 退出后无残留进程',
        Topic: '实现发布/订阅一对节点，ros2 topic hz 显示稳定频率且 ros2 topic echo 内容正确',
        Service: '实现 Service 服务端与客户端，ros2 service call 一次请求-响应返回正确结果',
        Action: '实现 Action 服务端与客户端，能收到 feedback 并成功取消一次长任务',
        Parameter: '用 ros2 param set/get 运行时改参数，节点行为随之改变且无需重启',
        Launch: '用 launch 文件一条命令启动 ≥3 个节点并传入参数，可重复复现',
        TF2: '独立搭建 map → odom → base_link → laser 的 TF tree，并在 RViz 中正确显示',
        URDF: '写出机器人 URDF/Xacro，check_urdf 通过且 RViz 中模型与 TF 一致',
        QoS: '对比 reliable 与 best_effort 两种 QoS，展示丢包/阻塞差异并说明选型理由',
        rosbag: '用 rosbag2 录制一段数据并回放，回放时下游节点行为与实时一致',
        RViz: '保存一份 .rviz 配置，能同时显示 TF、激光与代价地图',
        Nav2: '用 Nav2 让仿真机器人在含障碍地图中完成一次点到点自主导航',
    },
    cpp: {
        RAII: '用 RAII 封装一个资源（文件/锁/socket），异常路径下资源仍被释放（ASan 无泄漏）',
        智能指针: '用 unique_ptr/shared_ptr/weak_ptr 解决一次真实的所有权问题，并用 ASan 证明无泄漏、无悬垂',
        'STL 容器与算法': '用 STL 容器 + 算法重写一段裸数组代码，附复杂度与可读性对比说明',
        'lambda 与函数对象': '用 lambda + std::function 实现可配置回调/比较器，并说明捕获方式的生命周期风险',
        移动语义与完美转发: '实现一个支持移动语义的类，用测试程序证明拷贝次数下降（打印拷贝/移动次数）',
        模板与泛型编程: '写出一个带约束（concept 或 SFINAE）的模板函数/类，通过 ≥3 种类型的实例化测试',
        多线程与并发: '用 thread/mutex/condition_variable 实现生产者-消费者，TSan 运行无数据竞争告警',
        'CMake 构建': '用 CMake 组织多目录工程，一条命令构建出库 + 可执行 + 单测',
    },
    'modern-cpp': {
        'C++11 特性': '用 auto/范围 for/lambda/右值引用改造一段旧代码，逐处说明收益',
        'C++14 特性': '用泛型 lambda 与 make_unique 改造代码，编译通过并给出改动说明',
        'C++17 特性': '用 optional/variant/string_view/结构化绑定写一个解析函数并覆盖边界用例',
        'C++20 概念与协程': '用 concept 约束一个模板接口，并用一个协程函数跑通可运行示例',
        编译期计算: '用 constexpr/consteval/if constexpr 把一段运行期计算移到编译期，并用 static_assert 验证',
    },
    linux: {
        'Shell 与文件系统': '写一个 Shell 脚本完成日志清理/备份，连跑两次结果一致（幂等）',
        '进程与线程模型': '用 ps/top/pstree/strace 定位一个进程的 CPU 占用来源并写出排查记录',
        '权限与用户管理': '用 chmod/chown/umask/sudo 配置只允许特定用户读写的目录，并验证越权失败',
        '网络与端口排查': '用 ss/tcpdump/curl 排查一次端口不通，给出证据链与结论',
        'systemd 服务': '把自研程序做成 systemd 服务（开机自启、崩溃重启），systemctl status 验证',
        '性能与日志排查': '用 iostat/perf/journalctl 定位一次性能或崩溃问题并输出可复现报告',
    },
    slam: {
        传感器模型: '写出激光/IMU 观测模型与噪声参数，用真实数据验证残差分布合理',
        '坐标系与 TF': '独立搭建 map → odom → base_link → laser 的 TF tree，并在 RViz 中正确显示',
        前端里程计: '调通一个前端里程计（ICP/NDT/特征法），在公开数据集上给出轨迹与误差指标',
        后端图优化: '用 g2o/Ceres/GTSAM 搭建位姿图优化，展示优化前后轨迹与残差下降',
        回环检测: '实现一次回环检测（扫描匹配/描述子），展示回环后地图闭合误差下降',
        地图表示: '输出占据栅格/点云地图并在 RViz 中加载，与真实环境尺寸误差 < 5cm',
    },
    'motion-planning': {
        '图搜索（A*/Dijkstra）': '自己实现 A*/Dijkstra，在栅格地图上对比路径长度与耗时（附结果表）',
        '采样规划（RRT*/PRM）': '实现 RRT* 或 PRM，在含障碍环境中给出成功率与规划时间统计',
        轨迹优化: '把一条折线路径优化为满足速度/加速度约束的轨迹，并画出速度/加速度曲线',
        代价地图: '配置 costmap（膨胀半径、层），说明参数如何改变一次避障结果',
        局部避障: '让移动机器人在动态障碍下完成一次局部避障（DWA/TEB），附 rosbag 回放',
    },
    control: {
        'PID 整定': '对真实/仿真被控对象整定 PID，给出阶跃响应曲线（超调、调节时间）与整定过程记录',
        状态空间建模: '把被控对象写成状态空间形式，用仿真验证模型输出与实测一致',
        LQR: '设计 LQR 控制器（含 Q/R 选择依据），仿真证明指标优于手工 PID',
        MPC: '搭建带约束的 MPC 完成一次轨迹跟踪，附预测时域与单步求解耗时',
        频域分析: '画出被控对象 Bode 图，给出增益/相位裕度并据此判断闭环稳定性',
        稳定性判据: '用 Routh/Hurwitz 或 Lyapunov 方法证明一个闭环系统的稳定性，写出推导过程',
    },
    'kalman-filter': {
        卡尔曼滤波推导: '从高斯假设推导 KF 五步公式，并手算一次一维预测-更新数值',
        '扩展卡尔曼滤波(EKF)': '实现 EKF 融合 IMU 与里程计，给出融合前后轨迹误差对比',
        '无迹卡尔曼滤波(UKF)': '实现 UKF 并在同一数据集上与 EKF 对比精度与耗时',
        传感器融合调参: '调整 Q/R 使融合结果在实测数据上误差下降，记录调参前后指标',
    },
    embedded: {
        'GPIO 与中断': '用中断方式读取按键/编码器信号，示波器或计数器验证无丢脉冲',
        '定时器与 PWM': '用定时器输出 PWM 控制电机/LED，实测频率与占空比误差 < 1%',
        'ADC/DMA': '用 ADC+DMA 连续采样一路模拟量并画出波形，说明采样率与噪声水平',
        '外设总线(I2C/SPI/UART)': '用 I2C/SPI/UART 读取一颗真实传感器，附逻辑分析仪波形或寄存器读数',
        'RTOS 任务调度': '在 RTOS 上创建 ≥3 个不同优先级任务，用串口日志证明调度符合预期',
        低功耗与启动流程: '实现一次低功耗模式唤醒并测量电流下降，说明启动流程与恢复点',
    },
    perception: {
        相机模型与标定: '用棋盘格完成相机内参标定，重投影误差 < 0.5px 并输出标定报告',
        图像处理基础: '用 OpenCV 完成滤波/阈值/形态学处理，给出前后对比图与参数依据',
        特征提取与匹配: '实现 ORB/SIFT 特征匹配并用 RANSAC 剔除误匹配，给出内点数统计',
        目标检测: '训练/微调一个检测模型，给出 mAP 与在自采图片上的可视化结果',
        点云处理: '用 PCL 完成点云滤波/分割/配准，给出分割结果与配准残差',
        手眼标定: '完成 eye-in-hand 手眼标定，抓取误差 < 5mm 并附验证过程',
    },
    tf2: {
        '坐标系与父子关系': '独立搭建 map → odom → base_link → laser 的 TF tree，并在 RViz 中正确显示',
        '静态/动态广播': '分别用 static_transform_publisher 与代码广播 TF，ros2 run tf2_tools view_frames 能导出完整树',
        'lookupTransform 与时间戳': '用 lookupTransform 查询两个坐标系变换并说明时间戳容差的作用',
        'TF tree 可视化与调试': '用 view_frames + RViz 定位一次 TF 断裂（如无 odom→base_link）并修复',
        '多传感器外参维护': '为激光与 IMU 维护外参 TF，并验证点云/IMU 数据在 base_link 下对齐',
    },
    urdf: {
        'link/joint 建模': '写出机器人 URDF（≥5 个 link），check_urdf 通过且 RViz 显示模型正确',
        '惯性参数与碰撞体': '为各 link 填写质量/惯量与碰撞体，仿真中不出现抖动或穿透',
        'xacro 宏与参数化': '用 xacro 宏参数化尺寸，改一处参数即可生成不同规格模型',
        'check_urdf 与 RViz 验证': '用 check_urdf 与 RViz 验证模型：关节轴向、限位与 TF 一致',
        '与 TF 的一致性': '证明 URDF 中 link 名与 TF 树完全一致（无悬空或缺失坐标系）',
    },
    nav2: {
        'Nav2 架构与生命周期节点': '说清 Nav2 各节点职责，并用 ros2 lifecycle 命令手动完成一次 configure→activate',
        'costmap 配置': '配置 global/local costmap（层与膨胀半径），展示参数变化对路径的影响',
        '全局规划器插件': '切换两种全局规划器插件，对比路径长度与耗时',
        '局部控制器（DWB/TEB）': '调好局部控制器参数，让机器人在窄通道中不碰撞地通过',
        '行为树导航流程': '读懂并修改 Nav2 行为树，让机器人失败后执行恢复行为并重新导航成功',
        '恢复行为与失败排查': '复现一次导航失败，定位原因（定位丢失/代价地图/传感器）并写出修复记录',
    },
    moveit2: {
        'SRDF 与规划组': '配置 SRDF 规划组与禁用碰撞对，MoveIt2 中可对规划组做一次规划',
        '运动学求解器配置': '配置 KDL/trac_ik 求解器，给出逆解成功率与耗时统计',
        'OMPL 规划与可视化': '用 OMPL 规划出无碰撞轨迹并在 RViz 中可视化执行',
        '轨迹执行与控制器对接': '把规划轨迹交给 ros2_control 执行，附关节跟踪误差曲线',
        '笛卡尔与力控接口': '用笛卡尔空间接口走一条直线轨迹，并接入一次力控/柔顺动作',
    },
    'micro-ros': {
        'micro-ROS 架构（agent/client）': '画出 micro-ROS agent/client 数据通路，并解释各环节作用',
        'MCU 侧节点与发布订阅': '在 MCU 上创建节点并发布一个话题，主机 ros2 topic echo 能看到数据',
        '串口/UDP 传输配置': '分别用串口与 UDP 建立连接，比较带宽与延迟',
        '内存与 QoS 约束': '给出 MCU 侧内存占用实测值，并说明 QoS 深度选择的依据',
        '与主机 ROS2 图连通性验证': '用 ros2 node list/topic list 验证 MCU 节点完整出现在主机 ROS2 图中',
    },
    opencv: {
        '图像读写与色彩空间': '读取图片/视频并完成 BGR↔HSV↔Gray 转换，输出对比图',
        '滤波与形态学': '对比高斯/中值滤波与开闭运算效果，说明参数选择依据',
        '边缘与轮廓': '用 Canny + 轮廓提取定位一个目标，给出像素坐标与稳定性统计',
        '相机标定接口': '调用 OpenCV 标定接口完成内参标定，重投影误差 < 0.5px',
        '特征与光流': '实现特征匹配或光流跟踪，给出匹配内点率与帧率',
        '性能优化（ROI/并行）': '用 ROI/降采样/并行把处理帧率提升 ≥2 倍，附前后 benchmark',
    },
    pcl: {
        '点云读写与可视化': '读取 PCD 并在可视化器中显示，说明字段与坐标系',
        '滤波（体素/统计）': '对比体素下采样与统计滤波效果，给出点数与耗时变化',
        '分割（RANSAC/欧式聚类）': '用 RANSAC 提取平面并聚类出目标物体，给出分割结果图',
        '配准（ICP/NDT）': '完成两帧配准，给出迭代次数、耗时与最终残差',
        '法线与特征计算': '计算法线与 FPFH 特征并用它做一次粗配准',
    },
    pid: {
        'P/I/D 作用与耦合': '用同一被控对象分别只加 P、PI、PID，展示三种响应差异',
        '整定方法（Ziegler-Nichols 等）': '按 Ziegler-Nichols 步骤整定一次并给出整定过程数据',
        '抗积分饱和': '复现一次积分饱和，加入抗饱和措施后超调明显下降（附曲线）',
        '微分滤波与噪声抑制': '在有噪声的反馈信号上加入微分滤波，展示噪声放大被抑制',
        '阶跃响应指标评估': '给出阶跃响应的超调量、上升时间、调节时间与稳态误差数值',
    },
    'can-bus': {
        'CAN 帧格式与仲裁': '用 candump 抓包并解释一帧的 ID/DLC/数据字段含义',
        'SocketCAN 配置与抓包': '配置 SocketCAN（bitrate）并完成一次收发验证',
        '报文收发与周期任务': '实现周期报文发送（≥100Hz），统计抖动与丢帧',
        '总线负载与错误帧排查': '制造一次错误帧（如无终端电阻）并定位到物理层原因',
        '终端电阻与物理层': '用示波器/万用表验证终端电阻与信号质量，说明对通信的影响',
    },
    'reinforcement-learning': {
        'MDP 与回报定义': '为一个控制任务写出 MDP（状态/动作/奖励/终止）并说明奖励设计理由',
        '值函数与 Q-Learning': '在离散环境实现 Q-Learning 并收敛到已知最优策略',
        '策略梯度与 Actor-Critic': '实现策略梯度或 Actor-Critic，给出学习曲线与基线对比',
        'PPO 实现与调参': '从零实现 PPO 并在 Gym/MuJoCo 任务上复现论文量级回报',
        'SAC 连续控制': '实现 SAC 完成一个连续控制任务，给出成功率与样本效率',
        '训练曲线与评估协议': '固定随机种子做 ≥3 组重复实验，给出均值±方差与评估协议说明',
    },
    docker: {
        '镜像与分层构建': '写出多阶段 Dockerfile 使镜像体积下降（附前后体积对比）',
        'Dockerfile 最佳实践': '按最佳实践重写 Dockerfile（缓存友好、非 root、精简基础镜像）',
        '卷与环境变量': '用卷持久化数据、用环境变量注入配置，验证容器重建后数据仍在',
        'docker compose 多服务': '用 compose 一次启动 ≥2 个互相通信的服务',
        'ROS2 容器内 DDS 网络': '用 host 或 DDS 配置让容器内外 ROS2 节点互相发现',
        '镜像体积与安全': '扫描镜像漏洞并给出修复/收敛体积的具体措施',
    },
    pytorch: {
        '张量与自动求导': '手写一段利用 autograd 的梯度计算并与数值梯度对齐（误差 < 1e-5）',
        'Dataset/DataLoader': '实现自定义 Dataset + DataLoader（含增强）并验证吞吐',
        '模型定义与训练循环': '完整实现训练循环（含验证与 checkpoint），给出 loss 曲线',
        'GPU 训练与混合精度': '用 AMP 训练并给出显存占用与每轮耗时对比',
        '模型保存与导出': '导出 ONNX 并用 onnxruntime 推理，与 PyTorch 输出误差 < 1e-3',
        '训练问题排查': '复现一次不收敛/过拟合并定位原因（数据/学习率/正则）',
    },
    gazebo: {
        '世界与模型文件（SDF/URDF）': '搭一个含障碍的 world 并在其中加载自己的机器人模型',
        '传感器插件（激光/IMU/相机）': '接入激光/IMU/相机插件，话题数据与 RViz 显示一致',
        '物理参数与实时因子': '给出实时因子与步长设置，说明对仿真稳定性/速度的影响',
        'ros_gz 桥接': '用 ros_gz 桥接让 Gazebo 话题在 ROS2 中可见并可下发指令',
        '仿真与实机一致性': '对比仿真与实机同一动作的结果差异并量化',
    },
    foc: {
        'FOC 原理（Clarke/Park）': '手写 Clarke/Park 变换推导并用代码验证变换前后幅值一致',
        '电流采样与相电流重构': '实现相电流采样与重构，与电流钳实测值误差 < 5%',
        'SVPWM 实现': '实现 SVPWM，示波器验证相电压波形与调制比',
        '电角度与编码器对齐': '完成电角度对齐，使电机在低速下力矩平稳无明显抖动',
        '力矩控制验证': '给出力矩指令-实测力矩的线性度曲线与误差',
    },
    rtos: {
        '任务与优先级': '创建 ≥3 个不同优先级任务，串口日志证明高优先级任务优先获得 CPU',
        '信号量/队列/互斥量': '用队列传递数据、用互斥量保护共享资源，证明无数据竞争',
        '中断与临界区': '对比临界区加锁前后的中断延迟测量值',
        '栈与内存配置': '用栈水位检测给出各任务栈占用，并据此调到安全值',
        '实时性与抖动测量': '测量周期任务的抖动（如 1kHz 任务）并给出最大抖动数值',
    },
    'behavior-tree': {
        'BT 基本节点（序列/选择/装饰）': '手写一棵行为树（含序列/选择/装饰节点）并在测试中跑通成功与失败分支',
        '黑板与数据流': '用黑板在节点间传递数据，并说明键的生命周期',
        'Nav2 行为树结构': '画出 Nav2 默认行为树结构，标注各子树职责',
        '自定义节点实现': '实现一个自定义 BT 节点并接入 Nav2 实际生效',
        '失败与恢复流程调试': '制造一次失败（如目标不可达），展示恢复行为被触发并记录日志',
    },
    dds: {
        'DDS 发现机制': '抓包展示一次 DDS 发现过程并解释参与者/端点',
        '域与分区': '用 domain id 与 partition 隔离两组节点，验证互不可见',
        'QoS 与 ROS2 映射': '把 ROS2 QoS 映射到 DDS QoS 并验证 reliability 差异',
        '跨网段通信': '配置跨网段/多网卡通信成功，说明配置项与限制',
        '抓包分析': '用抓包定位一次通信异常（如 MTU/组播被拦截）',
    },
};
/** 技能展示名 → 标题里的能力描述（未登记时用能力点自动拼接）。 */
const SKILL_FOCUS = {
    ros2: '节点通信、TF2 与 Nav2 集成',
    cpp: '内存与所有权管理、泛型编程与工程化构建',
    'modern-cpp': '现代特性运用与编译期计算',
    linux: '系统排查与工程环境维护',
    slam: '前端里程计、后端优化与闭环建图',
    'motion-planning': '搜索/采样规划与代价地图避障',
    control: '控制器设计、整定与稳定性分析',
    'kalman-filter': '状态估计推导与多传感器融合调参',
    embedded: '外设驱动、中断与实时调度',
    perception: '标定、检测与三维感知流水线',
    tf2: '坐标系变换与树维护',
    nav2: '导航栈配置与自主导航调优',
    moveit2: '规划组配置与轨迹执行',
    urdf: '机器人模型建模与验证',
    'micro-ros': 'MCU 接入 ROS2 的通信链路',
    opencv: '图像处理与视觉算法实现',
    pcl: '点云滤波、分割与配准',
    pid: '闭环整定与响应指标优化',
    'can-bus': '总线通信与报文调试',
    'reinforcement-learning': '策略学习与训练评估',
    docker: '可复现的容器化工程环境',
    pytorch: '训练循环与模型部署链路',
    gazebo: '仿真环境搭建与传感器接入',
    foc: '电流环实现与力矩控制',
    rtos: '任务调度与实时性保障',
    'behavior-tree': '行为树编排与恢复流程',
    dds: '通信中间件配置与排查',
};
/** 从能力点推标题里的能力描述（兜底路径）。 */
const focusFor = (skillId, subSkills) => {
    const registered = SKILL_FOCUS[skillId];
    if (registered !== undefined && registered !== '')
        return registered;
    const head = subSkills.slice(0, 3).join('、');
    return `${head} 等 ${subSkills.length} 项核心能力`;
};
/** 一条能力点 → 一条可观察的验收标准。 */
const criterionFor = (skillId, sub) => {
    const concrete = CONCRETE_CRITERIA[skillId];
    const text = concrete !== undefined ? concrete[sub] : undefined;
    return text !== undefined && text.trim() !== '' ? text : GENERIC_CRITERION(sub);
};
/** 验收标准数量上限：多了没人看得完，少了无法验收。 */
const MAX_CRITERIA = 5;
/** 由能力点列表生成验收标准（每条关键能力点一条，最多 5 条，且至少 2 条）。 */
const acceptanceFor = (skillId, subSkills) => {
    const criteria = [];
    for (const sub of subSkills.slice(0, MAX_CRITERIA)) {
        const criterion = criterionFor(skillId, sub);
        if (!criteria.includes(criterion))
            criteria.push(criterion);
    }
    // 兜底：任何情况下都不允许出现「少于 2 条验收标准」的目标。
    for (const sub of subSkills) {
        if (criteria.length >= 2)
            break;
        const criterion = criterionFor(skillId, sub);
        if (!criteria.includes(criterion))
            criteria.push(criterion);
    }
    while (criteria.length < 2) {
        const criterion = GENERIC_CRITERION(subSkills[criteria.length] ?? skillId);
        if (!criteria.includes(criterion))
            criteria.push(criterion);
        else
            break;
    }
    return criteria;
};
/* ============================================================================
 * 三、数值工具
 * ==========================================================================*/
const finiteOr = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
/** 学习成本 1..5 → 难度 1..5（夹取并四舍五入）。 */
const difficultyFor = (entry) => clamp(Math.round(finiteOr(entry.learning_cost, 3)), 1, 5);
/** 覆盖率：优先用快照的 job_ratio，缺失时用 job_count / 总岗位数。 */
const coverageOf = (frequency, totalJobs) => {
    const ratio = finiteOr(frequency.job_ratio, Number.NaN);
    if (Number.isFinite(ratio))
        return clamp(ratio, 0, 1);
    const count = finiteOr(frequency.job_count, 0);
    return totalJobs > 0 ? clamp(count / totalJobs, 0, 1) : 0;
};
/** 排序：rank 升序 → priority 降序 → skill_id 字母序（完全不依赖输入顺序）。 */
const compareEntries = (a, b) => {
    const rankDiff = finiteOr(a.rank, Number.MAX_SAFE_INTEGER) - finiteOr(b.rank, Number.MAX_SAFE_INTEGER);
    if (rankDiff !== 0)
        return rankDiff;
    const priorityDiff = finiteOr(b.priority, 0) - finiteOr(a.priority, 0);
    if (priorityDiff !== 0)
        return priorityDiff;
    const left = typeof a.skill_id === 'string' ? a.skill_id : '';
    const right = typeof b.skill_id === 'string' ? b.skill_id : '';
    return left < right ? -1 : left > right ? 1 : 0;
};
/* ============================================================================
 * 四、主入口
 * ==========================================================================*/
/**
 * 由 Gap 报告生成可验收学习目标。
 *
 * 生成规则：
 *  - 只处理 `gap.entries` 中排名靠前的技能（`limit` 控制数量，默认 12）；
 *  - 技能必须能在快照中找到真实统计，且覆盖率 ≥ `minCoverage`（默认 0.05），
 *    否则不生成目标 —— 没有任何岗位要求的能力不该占据学习计划；
 *  - 每个目标都带 ≥2 条可观察验收标准，`status` 一律为 `pending`；
 *  - `goal_id` 固定为 `goal-<skill_id>`，可重复执行得到完全一致的结果；
 *  - 传入 `project` 时，覆盖该技能的阶段会把 `recommended_project_id` 挂上，
 *    让「学这个技能」直接落到一个可建造的项目阶段上。
 */
export const planGoals = (input) => {
    const { gap, snapshot } = input;
    const rawLimit = finiteOr(input.limit, 12);
    const limit = rawLimit > 0 ? Math.floor(rawLimit) : 12;
    const minCoverage = clamp(finiteOr(input.minCoverage, 0.05), 0, 1);
    const totalJobs = finiteOr(snapshot.job_count, 0);
    // 同一技能出现多条统计时取第一条，保证确定性。
    const frequencyBySkill = new Map();
    for (const frequency of snapshot.skill_frequencies ?? []) {
        if (frequency === undefined || frequency === null)
            continue;
        if (!frequencyBySkill.has(frequency.skill_id))
            frequencyBySkill.set(frequency.skill_id, frequency);
    }
    const projectSkillIds = new Set(input.project !== undefined && Array.isArray(input.project.covered_skill_ids)
        ? input.project.covered_skill_ids
        : []);
    const entries = [...(gap.entries ?? [])].sort(compareEntries);
    const goals = [];
    for (const entry of entries) {
        if (goals.length >= limit)
            break;
        const skillId = typeof entry.skill_id === 'string' ? entry.skill_id.trim() : '';
        if (skillId === '')
            continue;
        const frequency = frequencyBySkill.get(skillId);
        // 没有真实市场统计 → 目标无法被市场验证，直接跳过。
        if (frequency === undefined)
            continue;
        const coverage = coverageOf(frequency, totalJobs);
        if (coverage < minCoverage)
            continue;
        const skillName = typeof frequency.skill === 'string' && frequency.skill.trim() !== ''
            ? frequency.skill.trim()
            : typeof entry.skill === 'string' && entry.skill.trim() !== ''
                ? entry.skill.trim()
                : skillId;
        const subSkills = breakdownFor(skillId);
        const acceptance = acceptanceFor(skillId, subSkills);
        const jobIds = Array.isArray(frequency.job_ids) ? [...frequency.job_ids] : [];
        const goal = {
            goal_id: `goal-${skillId}`,
            skill_id: skillId,
            skill: skillName,
            // 标题必须是「具体能力」而不是「学习 X」：掌握 ROS2（节点通信、TF2 与 Nav2 集成）。
            title: `掌握 ${skillName}（${focusFor(skillId, subSkills)}）`,
            sub_skills: subSkills,
            learning_content: subSkills.map((sub) => `${sub}：原理速览 + 最小可运行实验 + 结论记录`),
            difficulty: difficultyFor(entry),
            market_coverage: roundTo(coverage, 3),
            market_job_count: finiteOr(frequency.job_count, jobIds.length),
            market_job_ids: jobIds,
            acceptance_criteria: acceptance,
            status: 'pending',
        };
        if (input.project !== undefined && projectSkillIds.has(skillId)) {
            goal.recommended_project_id = input.project.project_id;
        }
        goals.push(goal);
    }
    return goals;
};
/* ============================================================================
 * 五、验收校验（需求 §十一：只有验收标准全部满足才可标记 done）
 * ==========================================================================*/
/**
 * 校验目标是否可以被标记为 done。
 *
 * 规则：
 *  - 目标必须有 `acceptance_criteria`；**空验收标准一律不允许完成**
 *    （这正是「学习 C++」这类不可验收目标不能被勾掉的技术保障）；
 *  - 提交的 `completedCriteria` 去空白后，要么与某条验收标准完全一致，
 *    要么被该条验收标准包含（允许用户写更短的证据描述）；
 *  - 任一验收标准缺失即 `ok: false`，并如实列出缺失项与缺口数量无关的原文。
 */
export const canCompleteGoal = (goal, completedCriteria) => {
    const criteria = Array.isArray(goal?.acceptance_criteria) ? goal.acceptance_criteria : [];
    if (criteria.length === 0) {
        return { ok: false, missing: ['该目标缺少验收标准，禁止标记完成（需求 §十一）'] };
    }
    const submitted = (Array.isArray(completedCriteria) ? completedCriteria : [])
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item !== '');
    const missing = [];
    for (const criterion of criteria) {
        const target = typeof criterion === 'string' ? criterion.trim() : '';
        if (target === '') {
            missing.push('（空验收标准）');
            continue;
        }
        const satisfied = submitted.some((item) => item === target || target.includes(item));
        if (!satisfied)
            missing.push(target);
    }
    return { ok: missing.length === 0, missing };
};
//# sourceMappingURL=goal-planner.js.map