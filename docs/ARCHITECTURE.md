# 两个工具与共享模块

`CGSceneStudio` 是播放器，`CGSceneParsers` 是导出工具（含 Agent 提取与人工整理），`CGSceneKit` 是双方复用的源码包。三个目录各自拥有明确职责；共享包没有服务、媒体或游戏适配器。

```text
CGSceneKit                 格式、纯数据模型与引用工具
   ├─ 同步固定版本 → CGSceneStudio/player/vendor/cgscene + schema
   └─ 同步固定版本 → CGSceneParsers/vendor/cgscene + schema

CGSceneParsers             完整提取 → 整场景筛选 → 新标准包
   └─ 标准数据包 → CGSceneStudio
```

## 运行边界

- 播放器的 `player/app.js` 管理显示、声音、阅读与交互；`package-loader.js` 仅处理浏览器数据加载，数据标准化调用共享模型。
- 整理器的分类、选择方案、连接修复和导出策略属于 `CGSceneParsers/organizer`。它通过共享模型及引用工具理解标准包，不导入播放器代码。
- `CGSceneKit/src/package-model.js` 保留既有标准化行为，包括索引与页面排序；调用方需要保留原对象时先克隆。`package-utils.js` 提供包内路径与页面媒体引用工具。
- 整理器对待修复连接使用较宽松的业务校验，播放器需要可播放的连接。这些策略分别保留，不能为复用而混成同一种行为。完整格式约束仍以共享 JSON Schema 为准。

播放器服务可按路径挂载相邻导出工具的 `organizer/` 和 `vendor/`，保持本地桌面的统一入口。挂载是可选开发集成，发布内容不包含导出工具。独立导出工具在 8780 启动；两个服务无需互相启动。

## 修改公共代码

权威源码是 `CGSceneKit/src` 与 `CGSceneKit/schema`。消费者的副本用相对路径加载，因此解压即可运行，不依赖 npm 安装、软链接或相邻工作区。

从本目录执行：

```powershell
node ..\CGSceneKit\scripts\sync-consumer.mjs --consumer studio --check
node ..\CGSceneKit\scripts\sync-consumer.mjs --consumer studio
node ..\CGSceneKit\scripts\sync-consumer.mjs --consumer parsers
```

先修改共享源并提升共享包版本，再同步消费项目；`shared-lock.json` 记录当前版本和摘要。不要直接修改生成的快照。代码包版本与标准数据包的 `schemaVersion` 分开管理：当前 CGSceneKit 0.2.1 支持数据格式 1.0 / 1.1 / 1.2，1.2 增加完整图层快照及 image/video/live2d 资源。具体契约以 Kit 的 Schema 和格式说明为准。

## 提交与发布边界

公共模块改动归 Kit；整理、提取、导出 UI 改动归 Parsers；播放和手机改动归 Studio。消费者同步时，把共享快照与对应 `shared-lock.json` 放在同一个依赖更新提交中。跨项目功能分别提交，各自说明需要的共享版本，避免把游戏适配器或筛选逻辑混进播放器提交。

Studio、Parsers 与 Kit 均已建立独立 Git 仓库，各自维护源码与版本。工作区中的未提交改动需要按实际功能和依赖关系分别核对；目录归并或共享模块同步不代表这些改动已提交或发布。

桌面发行脚本只打包播放器及其共享快照；Android 的既有 `player/**` 规则自然包含共享 JS，不增加整理功能。运行版无需共享源码项目，完整提取和人工选择也不依赖安装播放器。
