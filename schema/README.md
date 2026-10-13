# CG Scene Package 1.1.0

这是播放器与游戏导出器之间的通用交换格式。导出器负责理解游戏资源和脚本；播放器只读取标准场景、页面、画面、声音和选项字段。数据包可以复制到另一台机器，不依赖原游戏安装目录。

解析器是独立项目，负责将来源文件转换为本格式；黄鹂播放器只消费标准数据包。字段约束以本页及 [JSON Schema](./cgscene-package.schema.json) 为准。

播放器兼容 `1.0.0` 与 `1.1.0`。1.0 的场景默认按页面 `order` 阅读；1.1 为每页提供明确后继，适合存储顺序与实际段落连接不同的场景。下面保留可直接使用的 1.0 最小示例；需要连接图时按 1.1 约定扩展。

## 1.1 显式连接

- `scenes[].entryPageId` 可指定阅读入口；省略时从首个存储页开始。
- 1.1 每页必须有 `next`；`order` 仍用于列表、页码及手动定位，推进按 `next` 执行。
- 转移对象为 `{targetSceneId?,targetPageId,status?,audioEvents?}`。`targetPageId` 是页面 ID；跨场景目标同时写 `targetSceneId`。`next=null` 也可表示终止，绝不自动落入下一存储页。
- `status="resolved"` 表示已解析连接；`end` 配合空目标表示结束，`unresolved` 配合空目标表示暂停待核对；`choice` 配合空目标表示等待本页选项。
- 转移 `audioEvents` 在离开本页、进入目标页之前执行。选择页先执行 `next.audioEvents`，再执行所选 `choices[].audioEvents`，最后进入目标页。终点/未解析转移仍执行已确认的声音效果。
- 选项可带 `status` 与 `audioEvents`；明确结束的选项允许 `targetPageId=null,status="end"`。待核对选项禁用。
- 声音事件 `onceKey` 表示一次性动作键；在当前场景阅读会话内记录，跨明确连接保持，重新选场景重置。它不表示整个数据包永久只播放一次。
- `seekAudioState` 保存直接跳页用的声音基线，包含 BGM、辅助 `buses` 和已发生的 `onceKeys`；连续阅读只沿事件保持声音，不把此基线当作逐页重置指令。适配器应在 `source` 说明基线是否受分支歧义影响。

```json
{
  "next": {
    "targetSceneId": "scene:next",
    "targetPageId": "scene:next:page:0",
    "status": "resolved",
    "audioEvents": [{"action": "stop", "bus": "sfx:loop"}]
  }
}
```

显式连接只执行适配器已经解析的目标和声音动作；游戏变量、条件表达式和任意脚本仍在范围之外。上一页优先沿阅读历史返回；手动页码和进度条可访问存储页。

## 1.0 范围

1.0 适合静态视觉小说和按页预览的 CG 场景：每页一张最终合成画面、一段纯文本对白、页面进入时触发的声音事件，以及可选的明确分支。

1.0 不表达背景与立绘的实时图层合成、富文本排版、游戏变量求值、任意脚本状态机、逐毫秒演出时间轴或动画播放。适配器可将图层预合成为每页画面；无法准确还原的部分应保留来源信息，并使用未解析或特殊演出状态，不应伪造精确映射。

用于资源核对时，适配器可提供明确关联的事件基础图：`visual.role="event-cg"`，`source.visualState.previewMode="event-cg-base"`，并在 `source.visualState.limitations` 列出未还原的演出。播放器必须标明这是基础图预览，不能将它声称为完整合成画面。立绘差分、转场遮罩和仅供画廊解锁的资源不能因此当成事件 CG。

场景的可选 `source.eventCg={pageCount,firstPageId,firstPageOrder,resourceCount}` 用于核对统计，`firstPageOrder` 从 0 起。页级明确角色优先于统计字段；`source.catalog=true` 的资源目录不参与剧情事件 CG 筛选。

音频按页进入时执行有序的 `audioEvents`：`play` 播放，`stop` 停止，`volume` 只调整已播放通道的音量。`volume` 在 0–1 之间，`fadeMs` 可指定淡变时长。主配音使用 `bus="voice"`，每次翻页停止上一句，仅播放本页的配音事件；无配音的页不继承语音。辅助声音可使用独立通道，例如 `voice:51`，与主配音并行。

`audioState` 保存导航所需的声音快照：`bgmAssetId`、可选 `bgmVolume` 和 `bgmLoop` 指定当前 BGM，同轨跨页连续播放。可选 `buses` 对象按通道名保存辅助循环的 `{assetId,volume,loop}`，空对象明确停止此前的辅助循环；其中不包含主配音和主 BGM。快照不得拿上一页主配音给无配音页补音。

自动阅读会等待非循环主配音实际结束，播放失败或停滞时解除等待。声音事件的 `wait` 保留适配器定义的等待信息；游戏脚本中的“异步播放”不意味着自动阅读应截断配音。手动翻页会立即切换主配音并继续已有自动模式。

## 数据包布局

```text
my-scene-package/
  package.json
  media/
    image-001.webp
    bgm-001.ogg
```

`package.json` 是入口清单。所有 `uri` 都相对于这个文件所在目录，使用正斜线；不得使用绝对路径、协议 URL 或越出数据包目录的 `..` 路径。复制整个目录即可迁移。`datasets/example` 是可直接打开的完整示例。

## 最小示例

```json
{
  "schemaVersion": "1.0.0",
  "project": {
    "id": "sample-project",
    "title": "Sample Project",
    "engine": "Example Engine",
    "locale": "zh-CN"
  },
  "assets": {
    "visuals": [
      {
        "id": "visual:opening",
        "uri": "media/image-001.webp",
        "mimeType": "image/webp",
        "width": 1920,
        "height": 1080,
        "status": "available"
      }
    ],
    "audio": [
      {
        "id": "audio:theme",
        "uri": "media/bgm-001.ogg",
        "mimeType": "audio/ogg",
        "name": "Opening Theme",
        "duration": 92.5,
        "volume": 1,
        "status": "available"
      }
    ]
  },
  "scenes": [
    {
      "id": "scene:opening",
      "title": "Opening",
      "category": "Main",
      "pages": [
        {
          "id": "scene:opening:page:0",
          "order": 0,
          "text": {
            "speaker": "",
            "body": "Sample dialogue."
          },
          "visual": {
            "assetId": "visual:opening",
            "status": "available",
            "sourceKind": "page"
          },
          "audioState": {
            "bgmAssetId": "audio:theme"
          },
          "audioEvents": [
            {
              "action": "play",
              "bus": "bgm",
              "assetId": "audio:theme",
              "loop": true,
              "wait": false,
              "volume": 1
            }
          ],
          "choices": []
        }
      ]
    }
  ],
  "source": {
    "adapter": "example-adapter",
    "adapterVersion": "1.0.0"
  }
}
```

完整字段约束见 [`cgscene-package.schema.json`](./cgscene-package.schema.json)。

## 字段约定

| 路径 | 必需 | 约定 |
| --- | --- | --- |
| `schemaVersion` | 是 | `1.0.0` 或 `1.1.0`；1.1 的每页必须有 `next`。不兼容变更需要新版本。 |
| `project` | 是 | `id` 与 `title` 必需；`engine`、`locale`、`description` 可选。 |
| `assets.visuals[]` | 是 | 逐页可引用的静态画面资源，包含唯一 `id`、包内相对 `uri` 和 `status`。可附 `mimeType`、尺寸、`decoder` 与 `source`。 |
| `assets.audio[]` | 是 | 声音资源，包含唯一 `id`、相对 `uri` 和 `status`。`duration` 单位秒，`volume` 范围为 0 到 1。 |
| `scenes[]` | 是 | 场景，包含唯一 `id` 和 `pages`；`title`、`category`、`source` 可选。 |
| `pages[]` | 是 | 场景内页面。每页 `id` 唯一，`order` 为唯一非负整数；列表按 `order` 排序，1.1 阅读按 `next` 推进。 |
| `pages[].text` | 是 | `speaker` 与 `body` 都是纯字符串。旁白的 `speaker` 用空字符串；换行原样保留。 |
| `pages[].visual` | 是 | `assetId` 引用一张合成画面；未映射时使用 `null`。`status` 为 `available`、`missing` 或 `unresolved`。 |
| `pages[].audioEvents` | 是 | 页面进入时按数组顺序处理；没有事件时使用 `[]`。 |
| `pages[].choices` | 是 | 页面选项；没有分支时使用 `[]`。目标通过场景和页面 ID 表达。 |
| `source` | 否 | 适配器可在项目、场景、页面、资源上保留原游戏 ID、命令名和映射依据；通用播放器不解释这些扩展字段。 |

所有 ID 大小写敏感。`assets.visuals` 与 `assets.audio` 各自独立编号；`targetPageId` 在目标场景内解析。媒体路径只允许指向数据包内资源。`available` 表示资源已解析且包内有文件，`missing` 表示已知目标文件但文件未导出，`unresolved` 表示来源引用尚未映射到可播放资源。缺失或无法解析的素材可以保留在来源信息中，但不能伪装成可用资源。

页面 `visual.status` 使用同一组状态描述页面画面映射结果。`sourceRef` 可保留原游戏画面 key；它不等于一个已解析的资源 ID。

### 画面与特殊演出

`visual.sourceKind` 是可选来源标记：

- `page`：本页明确指定的画面。
- `inherited`：原始数据沿用此前明确指定的画面；只有来源语义确认时才使用。
- `scene-preview`：只有场景级预览图，没有本页画面。此时 `visual.assetId` 必须为 `null`，并设置 `presentation: { "mode": "special", "status": "unresolved" }`。播放器以黑屏和特殊演出标识显示，不把预览图冒充成本页 CG。

`presentation` 优先于普通画面显示，即使同页另有 `visual.assetId`，特殊占位也会隐藏该画面。`reason` 可附简短的未还原原因。普通缺图不自动等同特殊演出：只有导出器能确认演出类型，或来源字段明确表示该状态时，才使用该字段；其他缺图保留 `visual.status` 并供核对。

### 声音

`audioEvents` 的标准 `bus` 为 `bgm`、`voice`、`sfx`，辅助声音可带通道后缀；`action` 为 `play`、`stop` 或 `volume`。播放事件可带 `assetId`、`loop`、`wait`、0 到 1 的 `volume` 及 `fadeMs`。适配器应尽量显式写出 `loop`；播放器在缺省时把 BGM 视为循环，把其他通道视为单次播放。

`audioState.bgmAssetId` 是手动跳页时恢复背景音乐用的页面快照：省略该字段表示延续前页，设为 `null` 表示停止 BGM，字符串表示此页应有的 BGM。它不代替 `audioEvents`。自动翻页会等待实际主配音结束；辅助循环不会阻塞阅读。`sourceTiming` 保留原始时机值，不是通用播放器的定时执行命令。

### 分支

每个选项包含 `label` 与 `enabled`。适配器负责在导出时决定该选项是否可用；播放器不会运行游戏条件表达式。简单条件可放在 `condition` 供查看，原始条件和命令放在 `source`。

同场景目标可省略 `targetSceneId`，跨场景目标必须同时写 `targetSceneId` 与 `targetPageId`。只有页面顺序的场景按 `order` 线性前进；没有显式选项的复杂跳转、变量条件或游戏状态逻辑不属于 1.0 的通用执行范围。

## 适配器要求

每款游戏各自实现 exporter，将原始脚本与资源引用转换为本格式；不要求改造通用播放器。适配器应：

1. 为场景、页面和资源生成稳定、唯一的 ID。
2. 按游戏真实显示状态拆分页面，不把场景缩略图或场景预览图当作逐页画面。
3. 为每页输出合成静态画面；如果资源由背景和立绘组成，在导出时合成，或将无法表达的层级关系留在 `source` 并标记待还原。
4. 把对白、可解析的音频事件和明确分支转成标准字段；无法解析的命令保留在 `source`，不猜测执行结果。
5. 仅在原始格式需要时提供自定义 `decoder`。decoder 必须在播放器注册；未知格式显示待核对状态。

验证数据结构时使用 JSON Schema；网页加载器还会检查 ID、页面顺序、相对路径和资源/分支引用。选取数据包目录时，所选根目录必须直接包含 `package.json`。URL 加载使用 `?package=相对路径/package.json`。

## 扩展规则

普通线性视觉小说仍可用 1.0；需要明确段落连接时使用 1.1。只有真实样本要求分层画面、富文本或精确声音时间轴时，再设计兼容字段或提升版本；游戏专属元数据继续放在 `source`，避免把单一引擎概念写进通用核心。
