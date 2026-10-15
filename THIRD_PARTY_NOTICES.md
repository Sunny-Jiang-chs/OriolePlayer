# 第三方组件

黄鹂播放器使用以下随项目分发的第三方组件：

| 组件 | 版本 | 许可 | 随附许可文件 |
| --- | --- | --- | --- |
| [Lucide](https://lucide.dev/) 图标 | 0.468.0 | ISC；其中 Feather 来源部分为 MIT | [lucide-LICENSE](player/vendor/lucide-LICENSE) |

Android SDK、Gradle、Java、Node.js 和可选的 FFmpeg 由使用者单独安装，未打入播放器发行包。

`datasets/example` 是项目独立创作的示例，画面与声音由同目录的 Python 脚本合成，不包含游戏提取资源。
## Desktop Cubism runtime

`player/vendor/cubism/` is generated locally from Cubism SDK for Web 5-r.5.
Core and Framework retain their separate upstream licenses, copied into
`player/vendor/cubism/licenses/`. Local shader files are part of Framework.
The Wanko example is generated separately under the ignored datasets directory;
its use is subject to the SDK sample model terms. It is not original project artwork.
