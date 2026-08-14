# Cloudflare 视频批量上传工具

配合 `backend-framework` 的 Bun/TypeScript 命令行工具。它会递归扫描本地视频、把文件名作为标题、根据标题识别中英文、提取第一帧作为封面，并复用管理端的 Cloudflare Stream / Images 直传与视频入库链路。

每个关键步骤都会立即更新 `videos.csv` 和 `upload-state.json`。上传源路径、Stream TUS 上传地址和入库进度保存在状态文件中；CSV 的表头严格对应 `/video/add` 的 9 个请求字段。

## 上传链路

脚本不持有 Cloudflare Account ID 或 API Token，也不经由后端中转文件字节：

1. 调用后端 `/api/adminimda/video/resumableUpload`，得到 Stream 的 `uid` 和 TUS `uploadUrl`。
2. 使用该 `uploadUrl` 直接向 Cloudflare Stream 分片上传视频；中断后在直传 URL 有效期内可从远端 offset 续传。
3. 调用后端 `/api/adminimda/image/upload`，得到 Images 的 `id`、直传 `uploadUrl` 和 `visitUrl`，再直接上传首帧封面。
4. 调用后端 `/api/adminimda/video/add`。视频仍在转码时后端返回 `1107/1108`，脚本持续轮询；转码 ready 后，后端校验视频和封面并将 `videoUid`、`coverId`、`coverUrl`、实际 `videoSize`、`videoDuration` 写入 `tb_video`。

因此，最终 CSV 中的 `videoUid`、`coverId`、`coverUrl` 与实际入库记录对应；`videoDuration`、`videoSize` 仅由后端写入数据库。

## 环境要求

- [Bun](https://bun.sh/) 1.2 或更新版本
- 运行中的 `backend-framework`，且其 Cloudflare Stream、Images 与数据库配置正确
- 一个拥有 `SYS_VIDEO` 权限的管理端 access token

`ffmpeg` 由 `ffmpeg-static` 随项目安装，不要求系统单独安装。

## 初始化

```powershell
cd E:\idea_project\ZenithStrat\cloudflare-video-batch-uploader
bun install
Copy-Item .env.example .env
```

编辑 `.env`：

```dotenv
BACKEND_BASE_URL=http://localhost:3000
BACKEND_ADMIN_TOKEN=管理端登录获得的access_token
VIDEO_READY_POLL_INTERVAL_MS=5000
VIDEO_READY_TIMEOUT_MS=1800000
```

脚本会在每个后端请求中发送 `x-adminimda-token: Bearer <BACKEND_ADMIN_TOKEN>`。Cloudflare 账号、API Token 与 Stream 播放密钥只配置在后端 `backend-framework/.env.web`；脚本通过后端签发的临时直传地址上传文件。不要把 `.env` 提交到 Git。

## 推荐执行流程

将素材按语言放入默认工作目录：

```text
workdir/
├── video/
│   ├── en/              # 英文视频，可包含子目录
│   └── zh/              # 中文视频，可包含子目录
├── covers/               # scan 自动生成，和 video 同级
│   ├── en/
│   └── zh/
└── doc/                  # scan 自动生成，和 video 同级
    ├── en/
    │   ├── videos.csv
    │   └── upload-state.json
    └── zh/
        ├── videos.csv
        └── upload-state.json
```

语言以 `video/en`、`video/zh` 目录名为准。扫描并生成 CSV 和封面：

```powershell
bun run scan
```

扫描结果：

```text
workdir/
├── covers/en|zh/         # 每个视频的第一帧 JPG
└── doc/en|zh/            # 各自语言的 videos.csv、upload-state.json
```

这时可以先人工检查或编辑 `videos.csv`，再执行上传：

```powershell
bun run upload
```

网络中断或个别文件失败后，重复执行同一条 `upload` 命令即可。脚本根据状态文件确认是否已完成入库；对于已创建且仍有效的 TUS 会话，会先 `HEAD` 查询远端 offset 后继续上传。视频、封面和入库均成功后才会标记为完成。

后续把新视频放入 `video/en` 或 `video/zh` 后，再次执行 `bun run scan`。脚本按语言目录内的相对路径识别新文件，只会向对应 CSV 和状态文件追加新记录、生成新封面；随后运行 `upload` 或 `resume` 即只处理这些未完成的新记录。

也可以使用语义更明确的恢复命令：

```powershell
bun run resume
```

恢复规则：视频会从 Stream 返回的 TUS offset 继续；封面会复用已保存的 Images 直传会话；已成功调用 `/video/add` 的记录会跳过。若临时直传 URL 已过期，命令会保留错误信息在对应语言的 `upload-state.json`，方便重新创建该条任务。

也可以一步完成：

```powershell
bun run all
```

需要使用其他根目录时，传入 `--work-dir "E:\素材工作目录"`；也可用 `--input "E:\视频根目录"` 覆盖默认的 `<work-dir>/video`。旧版 21 列 CSV 与当前 9 列接口 CSV 不兼容，升级后需要重新 `scan`；已上传到 Cloudflare 的资源不会被该参数删除，所以开始上传后不要随意强制重建状态。

## 字段规则

- `title`：视频文件名去掉扩展名，最多 128 个字符。
- `language`：标题包含任意汉字时为 `zh`，否则为 `en`。
- `difficulty`：默认 `10`；可改为 `10`、`20` 或 `30`。
- `titleDescription`：默认空字符串；提交 `/video/add` 时自动转换为单个空格，以满足后端最小长度限制。
- `primaryTags`、`secondaryTags`：默认 `[]`，为 JSON 字符串数组，元素不能包含首尾空格。
- `coverId`、`coverUrl`：后端签发 Images 直传地址时返回的图片 ID 和访问地址；仅在直传成功后写入。
- `videoUid`：后端创建 Stream TUS 会话时返回的 UID；会先写入以支持上传续跑。

CSV 只承载新增视频接口所需字段。视频时长、大小、发布和审计字段均由后端 `/video/add` 业务层生成，脚本不会直接连接数据库或执行 SQL。

## 故障定位

- 单条失败原因：查看终端输出或 `work/upload-state.json` 中的 `lastError`。
- 封面提取失败：通常是视频损坏或编码不被本地 ffmpeg 支持。
- 后端返回 401/403：检查 `BACKEND_ADMIN_TOKEN` 是否过期，以及该管理员是否拥有 `SYS_VIDEO` 权限。
- TUS 上传失败：确认网络和 Stream 直传 URL 是否仍有效；URL 过期后应重新扫描该文件或清理该条未完成状态再新建会话。
- 视频一直处于转码状态：默认最多等待 30 分钟，可调整 `VIDEO_READY_TIMEOUT_MS`。

## 开发检查

```powershell
bun run check
```

## Data Services 场景验证手牌

本项目同时提供复式手牌 Case 批量工具。它使用固定的 6 人桌骨架生成合法行动线，并为每条 Case 依次新增、发布手牌，再创建并发布一个同名的七天单手活动。

```powershell
# 先生成 workdir/duplicate-match-hand/cases.json 供人工检查
bun run hand:generate

# 按状态文件逐条新增并发布手牌和活动
bun run hand:upload

# 一步执行
bun run hand:all
```

上传进度保存在 `workdir/duplicate-match-hand/upload-state.json`。失败后重复执行 `hand:upload` 会从已保存的下一阶段继续。该命令要求管理端 Token 同时拥有 `SYS_DUPLICATE_MATCH_HAND` 和 `SYS_DUPLICATE_MATCH_ACTIVITY` 权限。

完整规则见 [Data Services 场景验证手牌批量工具](docs/duplicate-match-hand-design.md)。

参考资料：

- [Stream TUS 分片上传](https://developers.cloudflare.com/stream/uploading-videos/resumable-uploads/)
- [Images 上传 API](https://developers.cloudflare.com/api/resources/images/subresources/v1/methods/create/)
