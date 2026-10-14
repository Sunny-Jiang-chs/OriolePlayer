# 源码与安装包管理

Git 保存源码；`dist` 保存被 Git 忽略的构建产物。修改版本号并不等于已有对应提交，也不等于 GitHub 已发布该版本。

## 目录

```text
dist/
  latest/                 当前源码对应的安装入口
    HuangliPlayer-0.2.5-release.apk
    HuangliPlayer-0.2.5-debug.apk
    HuangliPlayer-0.2.5-web.zip
    *.sha256 / *-SHA256SUMS.txt
    *.build.json          各产物的源码、时间和校验记录
  archive/
    0.2.3/
      legacy-<时间>-<ID>/   迁入的旧产物，来源提交未记录
    0.2.5/
      build-<时间>-<ID>/    被后续构建替换的产物及其记录
  packages/               用户自己的数据包，不参与本整理流程
```

`latest` 中可以只有 Debug：这表示当前源码尚未构建 Release。不同源码状态的包不会并列冒充同一次构建。改过源码后，仅构建 Debug 会归档以前的 Release 和网页 ZIP；要准备手机安装包，使用 `-Variant Both` 或 `Release`。

## 日常操作

1. 修改代码并完成必要检查，确认后提交；不把游戏资源、APK、签名或配置密钥加入 Git。
2. `build-android.ps1 -Variant Both` 构建手机 Release 与模拟器 Debug。`Start-Android.cmd` 默认只构建 Debug。
3. 需要桌面 ZIP 时，执行 `python scripts/package-release.py`。脚本要求当前 Release 的源码记录和 SHA256 均匹配。
4. 完整构建成功后，可给提交添加版本标签；GitHub Release 和 push 是另外的发布操作。

构建脚本需要 Python 3.10+、Git 与文档中列出的 Android 工具。`Start-Android.cmd -SkipBuild` 只允许安装与当前源码一致、校验值正确的 Debug，不再按文件修改时间猜测最新版本。

## 构建记录

`*.build.json` 记录版本号、完整 Git 提交号、分支、构建时间（UTC）、是否存在未提交修改、源码指纹，以及每个产物的大小与 SHA256。源码指纹覆盖 Git 跟踪文件及未忽略的新文件；忽略的本地资源不参与计算。构建前后源码不一致时拒绝把产物放进 `latest`。

历史包的版本名不足以证明来源提交。迁入的包保留原字节、原修改时间与 SHA256，来源提交及 dirty 状态标为未知。归档只移动文件，不删除旧包。同版本重复构建也进入带唯一 ID 的归档目录，避免覆盖历史。

`python scripts/artifact_store.py migrate` 可将旧 `dist/android` 和 `dist/release` 下的已知播放器产物移入归档；重复执行安全，不处理 `dist/packages`。旧目录清空后可以移入回收站。

## 检查

`python scripts/artifact_store_test.py` 检查归档保留、重复迁移、源码变更拒绝、校验篡改和目录边界。测试文件仅写入项目 `tmp`。本流程不需要启动游戏、模拟器或查看作品素材。
