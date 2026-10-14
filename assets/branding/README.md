# 黄鹂播放器图标

`huangli-player-icon-v1.png` 是黄鹂播放器的 1024×1024 正方形母版。以用户提供的夜莺播放器图标为系列风格参考，通过配置的图像生成接口、`gpt-image-2` 图像编辑模式生成；原始参考图未复制到本项目。生成提示词保存在 `huangli-player-icon-v1.prompt.txt`，方便复现或进一步迭代。

构图以金黄色黄鹂、日轮和羽翼里的播放符号呼应夜莺播放器的青色鸟、月牙和播放符号。Web 页面使用 `player/branding/huangli-icon-192.png`；Android 自适应图标使用单独带安全留白的位图，避免桌面遮罩裁掉日轮、鸟喙或尾羽。不要直接将母版铺满 Android 的 108dp 自适应画布。

图标适配工具位于本机 `D:\tools\player-branding\build_launcher_icon.py`。更换母版时重新生成适配位图，并在圆形及圆角方形遮罩预览中检查主体完整性。
