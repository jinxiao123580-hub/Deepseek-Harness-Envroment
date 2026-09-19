<!-- 已脱敏的真实样例：项目名、路径、数值均已改写；保留的是"交接文档会怎么错"的形态。
     原件的 9 处问题见 ../README.md。 -->

# 交接：机械臂手眼标定 / 抓取 —— 卡在末端几何未实测

- **时间**：2026-09-19 11:14（11:45 按继任者自检修订）｜ **本目录**：`~/.handoff/0919-1114-arm-handeye-calib/`
- **上一个会话**：`session-xxxxxxxx`（404 请求，最大上下文 612k）｜ **继任自检**：`session-yyyyyyyy`（¥0.068 / 23 次工具调用）
- **继任**：新会话档位 `high` → 说 `读 ~/.handoff/0919-1114-arm-handeye-calib/INDEX.md，按它继续`
- **检索预算**：本轮 ≤15 次工具调用、网页 ≤2 次；超预算先问用户

## 1. 目标

推进课程第 1–6 节：手眼自动采集与抓取要过门禁。唯一硬阻塞：**末端碰撞几何是占位值**。
（本次交接只交代了第 1、2 节；第 3–6 节状态见 `~/proj/HANDOVER.md` 顶部 `0A`。）

## 2. 已完成（结果 → 证据路径）

- [有效] 力标定结案：2 倍质量矛盾＝"忽略常量力偏置"的假象，m = 2.98 kg → `outputs/ft_calib/mass-scale-diagnosis-20260918.json`
- [有效] 视觉子任务：`√(30²+30²)=42.43` 的猜测被差向量否证（真因＝判向符号错 40 mm）；`measure_target_geometry.py` **离线**自检 **6/6** → `outputs/vision/measure-target-offline-selftest-20260918.json`
- [已否证] 旧版 INDEX 写的"新工具**现场** **7/7** 通过"是张冠李戴：7/7 属 `pose_advisor.py --self-test`（点动导航自检），见 `experiments/2026-09-18-标定问题汇总.md:101`
- [有效] 状态读取器（真机验证）→ `scripts/read_arm_state.py`
- [有效] 09-19 采到 1 个有效样本（角点 54/54、重投影 **RMS** 0.21 px，max 0.53）→ `outputs/handeye/eye-in-hand-20260919.json`
- [有效] 成本治理：spill 8 KB + 压缩 0.35 已生效
- [已否证] 旧版写的"effort medium 生效"是错的：仍是 `high`；`medium` 对该适配器非法（只接受 `off`/`high`/`max`）

## 3. 未决

- 几何全未实测（`config/tool_attachments.yaml`：`camera_housing 180×180×140`、`margin 40`）→ 门禁 21 槽**全 FAIL**，当前位姿报相机与大臂间隙 **−5.1 mm**（`outputs/vision/gate-wrist-20260919.json`）。
- **不止"几何占位"一个轴**：槽级 21/21 `feasible=false`，`note: "unreachable after deferral retries as well"`，已试 2 种顺序 × 4 个间隙高度 × 15 个 roll 偏置 → **改完几何未必就可行**。
- [存疑] 门禁 `worst` 采样可疑：40 个 segment 里 `worst` **只有 2 种形态**，疑似只反映起点（当前位姿）那次采样而非逐槽位姿 → "重跑看是否通过"的判读可能被掩盖。
- 待用户导出装配体 STL（`config/attachments/` 为空）。
- 仓库 **118 个文件未提交**。

## 4. 下一步

1. 用户导出 STL 到 `~/proj/config/attachments/`，告知**单位**与**坐标原点**（理想＝法兰面中心；否则用"夹爪同轴 + 相机中心＝手眼值"反解）。
2. yaml 加 `mesh_attachments`；`self_collision.py` 的 `pin.hppfcl.Box`（行 67/98/124）→ STL 网格；校验包围盒中心落在 `[0.046,0.252,0.202] m` 附近。
   - [存疑] `MeshLoader().load(path,scale)` → `BVHModelOBBRSS` 全仓库 grep **零命中**："已实测可用"只是交互式探针结论，**无落盘证据**，先写个最小复现再依赖它。
3. 重跑门禁；通过则 `run_plan.py --collect` 自动采集。

## 5. 硬约束

- [有效] **禁止电脑端流式 IK 真机运动**（曾触发 `C153A0`）；`movel`（30002）是允许路径。
- [有效] 力传感器重力补偿全 `valid:false`，不得用于力控/碰撞停止/抓取判定；只用 `/ft_sensor/wrench_raw`。
- [有效] 相机 2D 传感器为**单色**（硬件规格），bgr8 三通道由 SDK 按 `B=G=R=Gray` 复制。
- [有效] 有线网卡掉 IP：`nmcli con up "Wired Connection 1"`（免密码）。
- [有效] **沙箱内跑 ROS 必须设环境变量 `FASTDDS_BUILTIN_TRANSPORTS=UDPv4`**，否则话题能列但收不到数据；改脚本时**不要把它硬编码进脚本**。
- [有效] 门禁方向正确：用户现场确认"相机确实快贴上大臂"，非误报。
- [存疑] 抓取点距 tool0 约 **275 mm**（由 09-17 成功点位 Z 反推，未直测）—— 不得当前提推导。
- [存疑] 力偏置 ~30 N 来源未定；逐批漂移 11 N，标定不可长期复用。

## 6. 验证方式

- 几何：STL 载入后相机外壳中心须落在 `[0.046,0.252,0.202] m ± 30 mm`，否则单位/坐标系错。
- 门禁：`check_plan.py --plan outputs/handeye/plan-wrist-20260919.json --clearance-z 0.55` 期望 `passed=true`
  （注意文件名是 `plan-wrist-…`，**没有** `pose-` 前缀；门禁 JSON 在 `outputs/vision/`）。
- 采集：54/54 角点、重投影 **RMS** < 0.5 px、运动 ≤ 0.5 mm。

## 7. 指针

- 权威状态：`~/proj/HANDOVER.md` 顶部 `0A`
- 课程方案：`~/proj/experiments/2026-09-18-课程实施计划草案.md`
- 标定全过程：`~/proj/experiments/2026-09-18-眼在手棋盘格重标定.md`
