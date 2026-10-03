# Android UI、国际化、主题与 8-bit 视觉

Last updated: 2026-07-26

本页定义 UI、国际化和主题的产品规则。候选版本号、APK 摘要和运行证据统一记录在 [最终功能测评](final-functional-assessment.md) 与 [质量与个人分发](quality-release.md)，避免历史 APK 数字在多个页面漂移。

## 当前状态

| 能力 | 源码状态 | 当前证据与缺口 |
| --- | --- | --- |
| 中文/英文 | 已实现 | 默认中文，设置可切 English；核心及次级业务页有显式词条，用户数据原样显示。仍缺当前全路由 API 36 巡检、动态错误和原生资源检查。 |
| 三档主题 | 已实现 | 默认浅色，支持浅色/深色/跟随系统并持久化；只解析应用内 palette，不调用 `Appearance.setColorScheme(...)`。候选自动化覆盖切换和进程重启；系统变化与真机仍需验收。 |
| 8-bit-inspired UI | 已实现，局部运行验证 | 登录/注册、列表、详情和编辑器等页面使用像素标记、状态块、2dp 边框、硬投影和紧凑圆角；当前只取得编辑页黄金路径，尚未完成全路由视觉/无障碍验收。 |
| 字体 | 已实现，待全页验收 | 霞鹜文楷用于中文可读正文；机器值保留等宽字体。需检查英文、数字、fallback、字重和动态字体。 |
| 图标 | 已实现，待全页验收 | 功能图标使用 Expo Symbols；需验证 Android 映射、对齐、选中态和 TalkBack。 |
| App 图标/启动 | 已实现，待真机验收 | icon、adaptive icon、native splash 淡出和 RN 品牌加载存在；需验证 launcher mask、冷/慢启动、深浅背景和无白闪。 |
| 恢复码复制 | 已实现 | 显式复制、反馈、30 秒清理请求和后台清屏；系统剪贴板历史不受 App 完全控制。 |
| 路由 header | 已实现 | tab 容器 header 隐藏，不应再显示 `(tabs)` 或英文 route slug；仍需逐路由巡检。 |
| 截图 | 开发期有意允许 | 未设置 `FLAG_SECURE`，便于反馈；最终个人日常使用候选是否恢复敏感页限制仍需产品决定。 |

## 国际化规则

1. 首次启动确定性使用中文；用户可在设置中手动切换中文或 English，选择持久化。
2. 所有可见文本、placeholder、Alert、空状态、错误、无障碍 label/hint 和日期均经过语言层。
3. 新增中文键时同步增加英文；未知键回退不能被当作英文覆盖完成。
4. route segment、枚举、服务端英文 message 和内部错误码不得直接显示给用户。
5. 恢复码、用户名、URL、邮箱、密码、备注、卡片数据、自定义字段和指纹等用户/协议数据不得翻译。
6. 日期按当前应用语言使用 `zh-CN` 或 `en-US`。
7. 切换语言后当前 RN 页面立即重绘，重启保持；保存失败必须显示本地化反馈。

### RN 与 Android 系统界面

RN 页面服从应用内语言设置。Android 拥有的生物识别、系统设置、文件选择器、安装器和 Autofill/Credential 选择器继续服从系统 locale。Kotlin 自有界面必须维护对应 `strings.xml` 资源。在完成 per-app locale 和真机巡检前，不得声称所有系统界面随应用内语言切换。

## 主题规则

- `light` 是无历史偏好时的默认值。
- `dark` 强制深色色板。
- `system` 只读取 Android 当前 scheme，并在系统配置变化时重算有效 palette。
- 主题选择不得调用 `Appearance.setColorScheme(...)`；这可能触发 Activity 重建、后台锁库并打断异步持久化。
- 保存失败时恢复最后一个已持久化偏好并给出反馈，不能静默保留一个只在内存生效的选择。
- 背景、表面、正文、次级文字、边框、主操作、成功、警告和错误只能取自语义 token。
- 页面不得硬编码只适用于一种主题的颜色，也不得把 Android `@color` 动态解析结果固定为 RN 模块级 StyleSheet 常量。
- status bar、navigation bar、native splash、RN loading、tab bar 和页面表面应连续，避免白闪/黑闪。

主题验收覆盖：light→dark→system→light、快速连续切换、偏好写入失败、Activity/进程重建、冷启动、后台切换系统主题和真实设备导航栏。

## 8-bit-inspired 设计规范

这是品牌化视觉语法，不是把整个 App 做成低分辨率游戏。

### 形状与层级

- 采用 4/8dp 布局网格。
- 主要卡片、输入和按钮使用 2dp 清晰边框、方形或小圆角。
- 投影使用无模糊的硬偏移，不使用大面积柔和 blur。
- 像素 rail、signal pixel、status block 和短横块用于建立层级与状态节奏。
- 装饰密度保持克制，正文和表单优先；Android 系统页面保持原生外观。

### 字体与图标

- 霞鹜文楷继续用于标题、正文和控件文字，保证中文可读性。
- 恢复码、签名指纹、TOTP 秘钥和调试 ID 等机器值使用等宽字体。
- 不强制像素字体，也不把文字栅格化。
- 功能图标使用 Expo Symbols，并提供本地化可访问标签。
- 纯装饰像素块设为 `accessible={false}`；不能代替按钮文字或唯一状态提示。

### 色彩、动效与状态

- 所有像素元素也必须使用语义 palette，覆盖浅色、深色和跟随系统。
- 成功、警告、错误、选中和锁定不能只靠颜色；同时使用文字、图标、边框或形状。
- pressed、focused、disabled、loading、success、error 必须可分辨。
- 动效短促并尊重 reduced motion；启动呼吸动画不代表就绪，也不能掩盖初始化错误。

### 可用性约束

- 触控目标至少 48dp。
- 动态字体放大后不截断主操作，不让像素装饰挤压正文。
- 键盘打开、横竖屏、小屏和长英文下仍可完成表单。
- 密码、恢复码等敏感值不因 8-bit 效果降低可辨识性，也不在装饰层重复渲染。

## 图标与启动体验

界面功能图标统一使用 Expo SDK 57 的 [`expo-symbols`](https://docs.expo.dev/versions/latest/sdk/symbols/)。应用资源包括普通 launcher icon、Android adaptive icon 和 native/RN 共用的 splash 品牌标记。

启动分两段：native splash 覆盖进程创建，RN 品牌 loading 覆盖初始化。两段视觉可采用同一 8-bit 品牌标记，但初始化错误必须 fail closed 并显示可操作的本地化错误，不能无限播放动画。

## 恢复码与截图

恢复码复制旨在减少抄写错误，不代表剪贴板绝对安全。App 仅能请求 30 秒后清理；Android、厂商 ROM、输入法或其他获授权组件可能保留历史。

开发阶段允许截图/录屏。所有 UI 证据只能使用合成账户，并在保存前移除恢复码、密码、token、真实邮箱和真实 vault 内容。是否在个人日常使用候选恢复敏感页面 `FLAG_SECURE`，由项目所有者在最终验收单明确决定。

## API 36 验收矩阵

以下检查必须在 `campus-server` 的 API 36 环境执行：

1. 中文和英文分别遍历登录、注册、恢复码、解锁、列表、三类详情/编辑、搜索、同步、冲突、设备、恢复、备份、密码健康、账户和设置。
2. 每个关键页面覆盖浅色、深色、跟随系统；重启后语言/主题保持。
3. 验证 8-bit 边框、硬投影、像素 rail/status/signal 在三主题下对比度一致，且没有遮挡、截断、重复标题或 route slug。
4. 覆盖最大常用字体、TalkBack traversal/label、键盘、小屏、旋转、pressed/focused/disabled/loading/error。
5. 检查 icon/adaptive icon、launcher mask、native splash、RN loading、冷启动、慢启动和 reduced motion。
6. 验证恢复码复制、重复点击、30 秒清理请求、后台清屏和失败反馈；证据不保存值。

自动化黄金路径覆盖语言与主题切换、进程重启持久化、恢复码复制、编辑器和主要业务页面；动态字体、TalkBack、旋转、厂商启动器 mask 和真实设备系统栏仍由真机验收。任何构建或局部 UI 旅程都不能替代视觉与可访问性签收。
