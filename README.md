# 黄鹂播放器

面向 CG 创作者与视觉小说作者的本地预览工具。把每页的画面、对白、配音、背景音乐和选项组织为 **CGScene Package**，即可在桌面浏览器或 Android 手机上阅读与核对。

播放器与解析器已拆分：本仓库只提供播放器、数据格式、标准包打包工具和独立创作的示例。游戏专属解析器单独维护，不随本次发布提供；发布内容不含本地游戏数据、提取素材或私人核对报告。

## 下载与开始使用

在 [Releases](https://github.com/Sunny-Jiang-chs/huangli-player/releases) 页面下载：

| 文件 | 使用方式 |
| --- | --- |
| `HuangliPlayer-0.2.0-release.apk` | 安装到 Android 手机，导入自己的标准数据包 |
| `HuangliPlayer-0.2.0-web.zip` | 解压后在电脑启动本地网页播放器 |

两种版本均内置小型创作者示例。自己的作品作为独立数据包导入，不需要重新编译播放器。

### Android

支持 Android 8.0（API 26）及以上，当前目标版本为 Android 16（API 36）。

1. 安装 APK 并打开 **黄鹂播放器**。
2. 点顶部文件夹按钮，选择 **导入 ZIP 数据包**，或 **打开已解压的文件夹**。
3. ZIP 根目录或所选文件夹中应有 `package.json` 以及它引用的媒体文件。
4. 选择场景，点击声音按钮开启音频。可旋转手机或进入沉浸全屏阅读。

数据包保存在手机本地，预览无需电脑运行服务。ZIP 导入会保存一份解压副本；选择文件夹则直接访问授权目录。详细操作与构建方法见 [Android 说明](docs/ANDROID.md)。

### 桌面浏览器

安装 Node.js 后，Windows 用户双击 `Start.cmd`，即可启动本地服务并打开浏览器。默认端口为 8768；自动启动脚本遇到端口占用时会寻找后续可用端口，重复启动可复用当前项目的服务。

也可以在解压目录或仓库根目录执行，无需安装 npm 依赖：

```sh
npm start
# 或
node server.mjs
```

打开 `http://127.0.0.1:8768/`，用文件夹按钮选择完整数据包目录。目录访问功能取决于浏览器，建议使用较新的 Chrome 或 Edge。也可将自己的包放到 `datasets/my-project/`，通过下列地址打开：

```text
http://127.0.0.1:8768/?package=./datasets/my-project/package.json
```

## 阅读与预览

- **逐页阅读**：点击画面、方向键或滚轮切页；页码和进度条用于直接定位。
- **自动推进**：自动模式下点击画面会继续自动计时；手动定位进度会暂停自动。非循环主配音播放时，自动阅读等待其结束。
- **沉浸全屏**：隐藏工具栏和底部进度条，画面按原比例最大化，对白叠在画面底部。右上角按钮、桌面 Esc 或 Android 返回键退出。
- **声音控制**：支持逐页配音、音效与跨页 BGM，分别调整 BGM 和其他音频音量，并在本机记住设置。
- **场景查找**：搜索、分类、画面筛选和当前场景定位；侧栏独立滚动，手机使用抽屉布局。
- **明确的占位**：数据包标记为特殊演出或未解析的页面显示对应提示，避免把上一页画面误当成当前画面。

切到 Android 后台会停止声音和自动推进。回到应用后由用户继续阅读与启用声音。

## 数据格式与解析器边界

播放器兼容 **CGScene Package 1.0 / 1.1**。入口是 `package.json`，媒体 URI 相对于该文件；复制整个目录即可迁移。

```text
my-scene-package/
  package.json
  media/
    opening.webp
    voice-001.ogg
    theme.ogg
```

每页的 `text` 保存说话人与对白，`visual` 引用画面资源，`audioEvents` 定义有序声音动作。1.0 默认顺序阅读；1.1 可通过 `entryPageId`、`next` 和 `choices` 表达明确的段落连接与分支。直接跳页的声音基线也由标准字段提供。

完整字段定义见 [格式说明](schema/README.md)，可运行的创作模板见 [示例数据包](datasets/example/package.json)。新作品可直接使用标准图像与音频编写数据包。需要接入其他引擎时，由独立解析器把资源及脚本引用转换成同一结构；播放器不需要理解原始引擎文件。

当前重点是静态 CG 与按页视觉小说预览。任意游戏脚本、游戏变量、复杂互动状态机、实时立绘合成及精确演出时间轴不属于现有格式的完整还原范围。解析器应明确标记缺失与未确认内容；播放器只能呈现数据包实际提供的信息。

## 打包自己的作品

`scripts/package-dataset.py` 将已经符合标准的数据包打成可导入的 ZIP，它不负责解析游戏。需要 Python 3.10 或以上：

```sh
python scripts/package-dataset.py --input datasets/my-project --output dist/packages/my-project.cgscene.zip
```

默认保留原媒体文件。可选 `--audio-format ogg --ffmpeg <ffmpeg可执行文件>` 生成更小的有损音频副本，源数据包保持不变；音质与循环衔接需由作者确认。

## 项目结构与开发

| 路径 | 内容 |
| --- | --- |
| `player/` | 通用网页播放器、数据加载器和图像解码插件 |
| `android/` | Android WebView 容器、系统文件选择和本地包管理 |
| `schema/` | 版本化数据格式说明与 JSON Schema |
| `datasets/example/` | 独立创作的示例文本、画面和声音 |
| `scripts/package-dataset.py` | 标准数据包 ZIP 打包工具 |
| `docs/ANDROID.md` | 手机端安装、构建和使用说明 |

修改网页后可直接重新加载桌面预览；Android 版需重新构建。Windows 双击 `Build-Android.cmd`，或使用 `build-android.ps1`。`Start-Android.cmd` 用于已配置 Android SDK 与 AVD 的开发电脑：启动模拟器、安装已有 APK 并打开播放器，不代替构建。

第三方组件及其许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本次 APK 沿用本地开发签名与应用标识，方便已有安装覆盖升级；它不是应用商店发布签名配置。
