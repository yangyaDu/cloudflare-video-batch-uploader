# 学习节点脚本

从提供的 learn_node 脚本接入，源码位于 src/learn-node，使用 Bun 和项目现有依赖。
在项目根目录执行命令，API 使用 .env 中的 BACKEND_BASE_URL 和 BACKEND_ADMIN_TOKEN。
管理员须有学习节点接口权限；无需原脚本的登录工具或 HOST/PORT 配置。

## 单节点操作

| 命令                                                                   | 功能                               |
| ---------------------------------------------------------------------- | ---------------------------------- |
| bun run learn:list                                                     | 查询课程根节点                     |
| bun run learn:tree <UUID>                                              | 查看节点树，支持 --raw、--no-color |
| bun run learn:detail <UUID>                                            | 查看节点详情                       |
| bun run learn:create --type course --title "核心决策训练"              | 创建课程                           |
| bun run learn:create --type chapter --title "翻前基础" --parent <UUID> | 创建子章节                         |
| bun run learn:update <UUID> --ref-id <资源标识>                        | 绑定资源                           |
| bun run learn:move <UUID> --help                                       | 查看移动及排序参数                 |
| bun run learn:publish <UUID>                                           | 发布节点树                         |
| bun run learn:unpublish <UUID>                                         | 下架节点树                         |
| bun run learn:delete <UUID>                                            | 删除节点，限制以服务端校验为准     |

每个命令都支持 --help。资源 refId 使用后端要求的业务标识，不是 Cloudflare Stream videoUid。

## 批量创建

参考 docs/examples/learn-node-manifest.json，支持课程→章节→视频/练习，
以及课程→章节→子章节→视频/练习。
示例不包含真实资源标识，发布前应补齐绑定。

```powershell
bun run learn:build --manifest docs/examples/learn-node-manifest.json --dry-run
bun run learn:build --manifest ./curriculum_manifest.json --output ./workdir/learn-node/result.json
```

每创建一个节点立即保存 nodeUuid。中断后，用结果文件作为输入继续：

```powershell
bun run learn:build --manifest ./workdir/learn-node/result.json --output ./workdir/learn-node/result.json
```

已有 nodeUuid 的节点会复用，资源绑定会重新尝试。不要用不含 UUID 的原始清单重复创建。
远端创建成功但本地尚未保存时中断，仍需人工核对，接口没有客户端幂等键。
构建命令不自动发布；绑定失败会返回非零退出码。

## 课程整理与视频引用同步

```powershell
bun run learn:sync-videos --manifest ./curriculum_manifest.json --upload-results ./workdir/update_video_no_tags/doc/en/videos.csv --dry-run
bun run learn:restructure --input ./curriculum_manifest.json --output ./single_course.json --backup ./curriculum_manifest.backup.json
bun run learn:visualize --help
```

从视频 SQL、Drill 配表和课次 Markdown 提取课程资源草稿：

```powershell
bun run learn:extract-resources
```

脚本按 `docs/examples/second-phase-curriculum-structure.json` 中已经确认的第 9–14 章结构，
通过视频标题精确匹配 SQL，通过课号精确匹配 `lesson_0914_xx` Drill。输出：

- `workdir/learn-node/0914-second-phase-manifest.json`：可供 `learn:build` 使用；
- `workdir/learn-node/0914-second-phase-audit.json`：来源、数量及未纳入课程的新增 Drill。

默认视频 SQL 为 `workdir/learn-node/export_curriculum_pure_numeric.sql`。审计报告还会列出
`status != 1` 的未发布视频；这些视频可以先绑定草稿节点，但发布课程树前必须发布。

同步支持原 upload_results.json 数组和本项目 videos.csv，按标题查上传 UID，再按 UID
精确匹配后端全部分页的视频 crossId。去掉 --dry-run 才写回清单；不会修改远端节点。
清单已携带 videoUid 时可直接同步。

restructure 用于原三层清单转四层单课程结构，不要对已转换清单重复运行。
visualize 保留原脚本的终端及 Markdown 对比报告功能，需提供课程清单、章节 Markdown、
行动线 Markdown 和 NAS 目录；当前对比逻辑按三层清单读取。
本次附件只有脚本，没有这些业务数据，需使用实际文件路径。
