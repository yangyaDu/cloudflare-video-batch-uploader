# 设计说明

## 数据流

```text
视频目录
  ├─ video/en/ -> 英文批次（可单独存在）
  ├─ video/zh/ -> 中文批次（可单独存在）
  └─ scan（每种语言独立执行）
      ├─ 文件名 -> title
      ├─ 目录名 -> language
      ├─ 可选知识点配置 CSV -> 英文视频 primaryTags
      ├─ ffmpeg 第一帧 -> covers/en|zh/*.jpg
      ├─ /video/add 字段/default -> doc/en|zh/videos.csv
      └─ 路径/行号/阶段 -> doc/en|zh/upload-state.json

doc/en|zh/videos.csv + upload-state.json
  └─ upload（先 en，后 zh；每个批次逐条执行）
      ├─ 后端 /video/resumableUpload -> Stream uid + TUS uploadUrl
      ├─ TUS HEAD/PATCH 直传 Stream -> videoUid
      ├─ 后端 /image/upload -> Images id + uploadUrl + visitUrl
      ├─ FormData 直传 Images -> coverId/coverUrl
      ├─ 后端 /video/add（转码中则轮询）-> tb_video 记录及 videoDuration/videoSize
      ├─ 后端 /video/publish（使用 video/add 返回的主键 id）-> status=1
      └─ 每个关键成功点之后原子改写 CSV 和状态
```

## 关键选择

1. 按语言分批：`video/en`、`video/zh` 是唯一的语言来源；每个语言目录拥有独立 CSV 与状态文件，避免两种语言的行号和恢复状态相互干扰。
2. 增量扫描：同一语言目录内以相对路径识别视频。重复执行 `scan` 时只追加新路径及其封面，不重置既有 CSV、TUS 会话或已入库标记；`--force` 才会重建该语言批次。
3. CSV 与运行状态分离：CSV 严格保留 `/video/add` 的 9 个字段；本地绝对路径、TUS 上传 URL、错误和是否已入库保存在状态文件，不会成为数据库伪字段。
4. 默认串行上传：100 个、单个不超过 100MB 的一次性任务更看重可追踪与限流安全。并发上传可以作为后续性能优化增加。
5. 后端签发、文件直传：脚本仅持有管理端 access token。后端负责权限校验、创建 Cloudflare 直传会话和最终入库；视频、图片字节不流经后端，也无需把 Cloudflare 管理密钥放到脚本环境中。
6. TUS 文件级恢复：后端返回 UID 和 resource URL 后立即落盘。重跑时先对该 URL 执行 `HEAD` 并按 `Upload-Offset` 继续 `PATCH`；直传 URL 失效时不会自动创建新 UID，以免悄然让 CSV 与已上传视频脱钩。
7. Images 会话恢复：后端下发的图片 ID、访问 URL、直传 URL 会在上传图片字节前写入状态文件。重跑时优先使用同一会话，不会重复申请图片 ID。
8. 入库和发布分阶段落盘：`/video/add` 在 Stream 未 ready 时返回业务码 `1107/1108`；脚本只对这两个状态轮询，成功后由后端保存实际时长和大小。入库成功会先保存 `videoRegistered` 和 `videoId`，再调用 `/video/publish`，成功后保存 `videoPublished`。CSV 中空的 `titleDescription` 在提交时转为单个空格，以满足现有接口的最小长度限制。
9. 发布接口按幂等方式恢复：后端已经发布时返回业务码 `1106`，脚本将其视为成功，避免在发布请求成功但本地状态尚未落盘的窗口中卡住。
10. 不自动回滚远端资源：一次直传成功但本地落盘前进程被强制终止，可能形成孤立 Cloudflare 资源。自动删除会有更高误删风险，所以由 Cloudflare 控制台人工核查。
11. 配置标签先校验后落盘：传入知识点配置 CSV 时，同一行已填写的 `介绍视频EN` 和 `漏洞视频EN` 共用 `介绍视频标签`，任一视频列均可留空。扫描器要求已配置名称和本地英文视频一一对应，校验通过后才生成 CSV、状态和封面，避免错误标签进入上传链路。

## 一致性边界

`videos.csv` 和 `upload-state.json` 分别以临时文件 + rename 原子写入，但两份文件无法组成跨文件事务。状态文件中的 `videoRegistered` 表示 `/video/add` 已成功，`videoPublished` 表示 `/video/publish` 已成功；仅有 CSV 中的 UID 或封面 ID 不等于已完成入库和发布。
