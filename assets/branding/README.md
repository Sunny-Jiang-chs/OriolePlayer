# 黄鹂播放器图标

当前使用 `huangli-player-icon-v2.png`，是黄鹂播放器的 1024×1024 正方形母版。2026-10-13 通过用户配置的图像生成接口，以 `gpt-image-2` 高质量模式生成，2026-10-14 接入项目。完整提示词保存在 `huangli-player-icon-v2.prompt.txt`；第一版母版和提示词保留供追溯。

新版使用暖象牙背景、金色日轮、睁眼黄鸟与羽翼内的播放符号，和拾景的日轮叠片图标组成日光系列，也与夜莺、织声的月色系列对应。应用显示名称为「黄鹂播放器」。

Web 顶部标志使用 `player/branding/huangli-icon-192.png`，浏览器标签页另提供 `huangli-icon-32.png`；两者均由当前母版使用 Lanczos 缩放生成，再用四倍采样的圆角遮罩处理为 RGBA，圆角半径为边长的 20%，与夜莺、织声一致。原始母版仍保留完整正方形背景。网页发行包包含这两枚图标，引用带 `?v=3` 以更新旧图标缓存。

标题区采用「图标＋中文品牌＋功能名称」：26px 图标、15px 半粗「黄鹂」、12px 次要文字「播放器」，窄屏品牌字为 14px；图标与文字间距 9px，品牌与功能名间距 6px。与夜莺 Windows 的紧凑标题层级一致，窗口和安装名称仍为「黄鹂播放器」。

Android 自适应图标使用 `android/app/src/main/res/drawable-nodpi/huangli_launcher_canvas.png`，由母版缩小到 108dp 画布的 70%，四周延展背景。与夜莺统一为完整画布在背景层、前景层透明：`ic_launcher_background_image` 引用位图，`ic_launcher_foreground_empty` 使用透明填充。圆形与常规入口使用相同层级。避免直接将母版铺满自适应画布，否则桌面遮罩可能裁掉日轮、鸟喙或尾羽。应用 ID、安装名称及数据目录保持兼容。

图标适配工具位于本机 `D:\tools\player-branding\build_launcher_icon.py`。更换母版时重新生成适配位图，并在圆形及圆角方形遮罩预览中检查主体完整性。

```powershell
python D:\tools\player-branding\build_launcher_icon.py --source assets/branding/huangli-player-icon-v2.png --output android/app/src/main/res/drawable-nodpi/huangli_launcher_canvas.png --scale 0.70 --preview-dir tmp/branding-20261014/android --name huangli-v2
```
