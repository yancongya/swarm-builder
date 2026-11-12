# Blender UI 模拟页素材

此目录服务于 `demos/blender.html` 的非官方界面演示，不代表 Blender Foundation 发布的产品。`tests/blender-simulator.html` 仅保留跳转入口。

| 本地文件 | 来源 | 用途 |
| --- | --- | --- |
| `splash.webp` | [Blender 4.2 LTS 新闻页](https://www.blender.org/press/blender-4-2-lts-release/)引用的 Blender Studio 启动画面 | 启动窗口上半部；保留原图中的 Blender 标志与 `studio.blender.org` 字样 |
| `viewport-reference.webp` | [Blender 4.2 手册的默认启动界面截图](https://docs.blender.org/manual/en/4.2/interface/window_system/introduction.html) | 从官方文档截图裁出 3D 视口；左侧工具按钮也从这张截图取对应区域显示 |
| `blender.svg`、`file_blend.svg`、`outliner_ob_*.svg`、`tool_settings.svg`、`output.svg`、`scene_data.svg`、`world_data.svg`、`object_data.svg`、`material.svg`、`texture.svg` | [Blender 项目图标源文件](https://projects.blender.org/blender/blender/src/branch/main/release/datafiles/icons_svg) | 顶栏、文件列表、大纲视图及属性栏图标 |

页面其余界面由 HTML/CSS 重建；时间轴播放、页签、选择与启动窗口开关是本地演示交互，不连接 Blender 本体。对外展示时应保持“非官方界面演示”的说明；Blender 标志的使用遵循[官方标志指南](https://www.blender.org/about/logo/)。
