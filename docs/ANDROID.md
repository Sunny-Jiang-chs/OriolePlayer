# 黄鹂播放器 Android 版

Android 版复用通用网页播放器与 CGScene Package 数据格式。APK 只内置独立创作的示例，用户作品通过 ZIP 或文件夹单独导入；不包含游戏解析器或本地游戏素材。手机预览无需电脑服务。

支持 Android 8.0（API 26）及以上，编译与目标版本为 Android 16（API 36）。应用没有原生 ABI 依赖，可用于 ARM64 手机和 x86_64 模拟器；媒体格式与实际内存表现还取决于设备的系统 WebView。

## 安装与导入

正式版本在 [Releases](https://github.com/Sunny-Jiang-chs/huangli-player/releases) 下载；当前源码构建输出 `HuangliPlayer-0.2.5-release.apk`，复制到手机后安装。

1. 打开 **黄鹂播放器**，首次进入显示内置创作者示例。
2. 点击顶部 **目录**，选择 **浏览目录（含隐藏）**、**系统目录选择器** 或 **导入 ZIP 数据包**。
3. ZIP 根目录或所选目录必须包含 `package.json`，并保留其引用媒体的相对路径。
4. 等待载入后选择场景，配音、BGM 与音效默认开启，声音按钮用于静音或取消静音。

支持 CGScene Package 1.0 / 1.1。三种方式的区别：

| 入口 | 访问方式 |
| --- | --- |
| 浏览目录（含隐藏） | 浏览手机主共享存储，显示以点开头的隐藏目录；进入含 `package.json` 的作品目录后点“打开作品”。直接读取原文件，无需复制。 |
| 系统目录选择器 | 由 Android 授予所选目录的访问权限，适合系统文件服务或不希望开启广泛文件访问的情况。 |
| 导入 ZIP 数据包 | 在应用私有存储中保留解压副本，导入时应留出相应空间。 |

内置浏览器会记住上次浏览位置，显示当前目录的作品名称、场景数与页数。仅在选择“浏览目录（含隐藏）”时申请权限：Android 11 及以上进入“所有文件访问权限”设置，Android 8–10 请求存储读取权限。取消授权后仍可使用系统目录选择器。内置浏览器当前以主共享存储为根，不包含其他应用的私有目录；外接存储可尝试系统目录选择器。

应用记住上次选中的数据包。导入后的 ZIP 副本由应用管理；文件夹方式依赖原目录与授权持续有效。卸载应用会清除应用私有存储中的导入包与设置。

## 手机阅读

- 点击画面翻页；自动模式下手动翻页继续自动阅读。
- 全屏自动切换横屏并隐藏顶部工具栏和底部进度条，画面按原比例最大化，对白叠在底部；退出后恢复原方向策略。
- 长按画面或对白区约 0.45 秒可快速翻页，松开停止，遇到选项或段落终点停止。
- “阅读设置”提供对白框透明度调节，同时显示实际安装的版本号及 Debug / Release 类型，方便确认是否安装了新版。
- 右上角退出按钮或 Android 返回键可退出全屏。
- 音量面板分别控制 BGM 与其他音频，并记住本机设置；同时显示 BGM 的实际播放、暂停、静音、零音量或加载失败状态，可用“重试 BGM”重新加载当前音乐。
- 界面使用深灰背景与黄鹂暖黄色强调。手机竖屏上方预览、下方场景列表独立滚动，横屏保留场景抽屉。
- 切到后台暂停声音与自动推进；返回后声音从原位置继续，保留手动静音状态，自动翻页需手动继续。

特殊演出占位、未解析声音或连接等提示来自数据包。封装为 Android 应用不会补全解析器尚未提供的信息。

手机资源通过应用拦截的本地地址加载，不需要远端媒体服务；首次导入大型包的时间取决于设备存储速度。

## 制作可迁移数据包

通用打包脚本仅处理已经符合标准的包，不解析游戏。需要 Python 3.10 或以上：

```sh
python scripts/package-dataset.py --input datasets/my-project --output dist/packages/my-project.cgscene.zip
```

默认保留原始音频。若需要压缩音频并已安装 FFmpeg，可运行：

```sh
python scripts/package-dataset.py --input datasets/my-project --output dist/packages/my-project-mobile.cgscene.zip --audio-format ogg --ffmpeg /path/to/ffmpeg
```

OGG 模式使用 Vorbis q4 有损压缩，只生成副本，不修改源包；画面仍复制原有编码文件。打包工具会检查可用资源的 URI 和文件是否齐全，并生成本地报告。压缩后的音质、循环衔接与设备支持情况需本地确认。重新生成时使用新的输出文件名。

## 从源码构建

需要 JDK 17、Gradle 8.13、Android SDK 36、Build Tools 36.1.0。项目使用 Android Gradle Plugin 8.13.2。Windows 可双击 `Build-Android.cmd`，或在仓库根目录执行：

```powershell
.\build-android.ps1
# 只构建安装版：
.\build-android.ps1 -Variant Release
```

构建脚本支持 `-SdkPath`、`-JdkPath`、`-GradlePath` 和 `-GradleCachePath` 配置本机工具路径。`-GradlePath` 指向 Gradle 的 `bin\gradle.bat`。默认使用现有缓存离线编译；首次准备 Maven 依赖时可加 `-Online`。请按本机环境配置路径，不要求使用原开发者的目录。

构建使用 SDK 自带的 `aapt2`，将播放器和 `datasets/example` 复制到生成的 assets，不扫描或打包其他数据包。修改网页后重新构建即可更新手机播放器。当前构建关闭自动 Release Lint；工具齐全后可单独执行 Gradle `lint`。

构建需要 Python 3.10+ 与 Git，用于记录源码和检查安装包；输出在 `dist/latest/`：

| 文件 | 用途 |
| --- | --- |
| `HuangliPlayer-0.2.5-debug.apk` | 可连接 WebView 调试器的调试版 |
| `HuangliPlayer-0.2.5-release.apk` | 关闭调试的安装版 |
| `*.sha256` | 对应 APK 的 SHA-256 校验值 |
| `*.build.json` | Git 提交号、源码指纹、构建时间及文件校验值 |

旧产物自动归档至 `dist/archive/<版本>/<构建ID>/`。`-SkipBuild` 会检查当前源码和 APK 校验值，不再按文件时间选择安装包。完整规则见 [版本与构建管理](VERSIONS.md)。

当前两种配置沿用本机 Android 开发签名。应用标识继续使用 `com.cgscenestudio.player`，以兼容已有安装；应用显示名称为 **黄鹂播放器**。版本号为 0.2.5。Release APK 可直接安装，但该签名配置不属于应用商店发布方案；自行构建与已有安装签名不同时，Android 不允许直接覆盖。

## 模拟器与本地验证

准备 Android SDK、系统镜像和 AVD 后，双击 `Start-Android.cmd` 会先增量构建最新 debug APK，再启动模拟器、覆盖安装并打开播放器；原有应用数据会保留。日志位于 `tmp/`。可通过 `start-android.ps1` 的 `-SdkPath`、`-AvdPath`、`-AvdName` 指定本机模拟器配置，或用 `-SkipBuild` 在确认 APK 已更新时直接安装。

也可使用已加入 PATH 的 adb 安装：

```powershell
adb install -r .\dist\latest\HuangliPlayer-0.2.5-debug.apk
```

日常修改先用内置示例检查载入、翻页、自动推进、对白、音量、全屏及横竖屏布局，再导入自己的作品核对素材与声音。Android 模拟器的结构性检查不能代替实体手机的触控体验与实际声音试听。
