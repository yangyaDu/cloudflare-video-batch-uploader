# Cloudflare 视频批量上传工具

配合 `backend-framework` 的 Bun/TypeScript 命令行工具。它会递归扫描本地视频、把文件名作为标题、根据标题识别中英文、提取第一帧作为封面，并复用管理端的 Cloudflare Stream / Images 直传与视频入库链路。

每个关键步骤都会立即更新 `videos.csv` 和 `upload-state.json`。上传源路径、Stream TUS 上传地址和入库进度保存在状态文件中；CSV 的表头严格对应 `/video/add` 的 9 个请求字段。

## 上传链路

脚本不持有 Cloudflare Account ID 或 API Token，也不经由后端中转文件字节：

1. 调用后端 `/api/adminimda/video/resumableUpload`，得到 Stream 的 `uid` 和 TUS `uploadUrl`。
2. 使用该 `uploadUrl` 直接向 Cloudflare Stream 分片上传视频；中断后在直传 URL 有效期内可从远端 offset 续传。
3. 调用后端 `/api/adminimda/image/upload`，得到 Images 的 `id`、直传 `uploadUrl` 和 `visitUrl`，再直接上传首帧封面。
4. 调用后端 `/api/adminimda/video/add`。视频仍在转码时后端返回 `1107/1108`，脚本持续轮询；转码 ready 后，后端校验视频和封面并将 `videoUid`、`coverId`、`coverUrl`、实际 `videoSize`、`videoDuration` 写入 `tb_video`。
5. 使用 `/api/adminimda/video/add` 返回的数据库主键 `id` 调用 `/api/adminimda/video/publish`，将视频状态更新为已发布。

因此，最终 CSV 中的 `videoUid`、`coverId`、`coverUrl` 与实际入库记录对应；后端返回的 `videoId`、`videoDuration`、`videoSize` 会保存到对应语言的 `upload-state.json`，CSV 仍只保留 `/video/add` 的请求字段。

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

## 手动上传到导出 SQL

以下命令都在项目根目录执行：

```powershell
cd E:\idea_project\ZenithStrat\cloudflare-video-batch-uploader
```

| 步骤          | 需要准备                                                   | 放置位置/生成结果                                                                                | 执行命令                   |
| ------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------- |
| 1. 配置后端   | 后端地址、拥有 `SYS_VIDEO` 权限的管理端 token              | 写入项目根目录 `.env` 的 `BACKEND_BASE_URL`、`BACKEND_ADMIN_TOKEN`                               | 无                         |
| 2. 放置素材   | 本地视频文件                                               | 英文放 `workdir/update_video_no_tags/video/en/`，中文放 `workdir/update_video_no_tags/video/zh/` | 无                         |
| 3. 扫描       | 第 2 步的视频                                              | 首帧封面生成到批次的 `covers/en/`、`covers/zh/`；CSV 和状态生成到 `doc/en/`、`doc/zh/`           | `bun run video-no-tags:scan` |
| 4. 人工检查   | `doc/en/videos.csv`、`doc/zh/videos.csv`                   | 检查标题、语言、难度和标签；`coverId`、`coverUrl`、`videoUid` 不要手填                           | 无                         |
| 5. 上传并发布 | 后端已配置 Cloudflare Stream、Images                       | 视频和封面直传 Cloudflare，随后调用 `/video/add` 和 `/video/publish`；结果回填 CSV 和状态文件    | `bun run video-no-tags:upload` |
| 6. 导出 SQL   | 所有状态均为 `videoRegistered=true`、`videoPublished=true` | `workdir/update_video_no_tags/sql/tb_video.sql`                                                  | `bun run video:export-sql` |

上传中断时重复执行 `bun run video-no-tags:upload`，脚本会从状态文件继续，不重复已经完成的步骤。

正常情况下，第 6 步通过管理端 `/video/list` 读取最终入库字段。如果源视频已经被下架或软删除，列表接口不会返回该记录，需要在 `.env` 增加只读源库连接后重新导出：

```dotenv
SOURCE_DATABASE_URL=mysql://只读用户:密码@数据库地址:3306/数据库名
```

该数据库账号只需要 `tb_video` 的 `SELECT` 权限。导出脚本只生成 SQL 文件，不会执行 SQL，也不会写入源库或目标库。

导出文件不包含自增 `pk_id`；`created_by`、`updated_by`、`published_by` 固定为 `1`；`language` 按标题是否包含 `[一-鿿]` 计算。导入目标库前需先完成 `language` 字段迁移，并确认目标环境使用同一套 Cloudflare 资源。

## 详细执行与恢复说明

当前视频命令的默认工作目录是 `workdir/update_video_no_tags`。将素材按语言放入：

```text
workdir/
└── update_video_no_tags/
    ├── video/
    │   ├── en/              # 英文视频，可包含子目录
    │   └── zh/              # 中文视频，可包含子目录
    ├── covers/              # scan 自动生成
    │   ├── en/
    │   └── zh/
    └── doc/                 # scan 自动生成
        ├── en/
        │   ├── videos.csv
        │   └── upload-state.json
        └── zh/
            ├── videos.csv
            └── upload-state.json
```

语言以 `video/en`、`video/zh` 目录名为准。扫描并生成 CSV 和封面：

```powershell
bun run video-no-tags:scan
```

扫描结果：

```text
workdir/update_video_no_tags/
├── covers/en|zh/         # 每个视频的第一帧 JPG
└── doc/en|zh/            # 各自语言的 videos.csv、upload-state.json
```

这时可以先人工检查或编辑 `videos.csv`，再执行上传：

```powershell
bun run video-no-tags:upload
```

网络中断或个别文件失败后，重复执行同一条 `video-no-tags:upload` 命令即可。脚本根据状态文件确认是否已完成入库和发布；对于已创建且仍有效的 TUS 会话，会先 `HEAD` 查询远端 offset 后继续上传。视频、封面、入库和发布均成功后才会标记为完成。

后续把新视频放入 `video/en` 或 `video/zh` 后，再次执行 `bun run video-no-tags:scan`。脚本按语言目录内的相对路径识别新文件，只会向对应 CSV 和状态文件追加新记录、生成新封面；随后运行 `video-no-tags:upload` 即只处理这些未完成的新记录。

也可以使用语义更明确的恢复命令：

```powershell
bun run resume
```

恢复规则：视频会从 Stream 返回的 TUS offset 继续；封面会复用已保存的 Images 直传会话；已成功调用 `/video/add` 的记录只补调用 `/video/publish`。如果发布请求已经成功但本地状态尚未写入，后端返回“已发布”也按成功处理。若临时直传 URL 已过期，命令会保留错误信息在对应语言的 `upload-state.json`，方便重新创建该条任务。

也可以一步完成：

```powershell
bun run video-no-tags:all
```

当前批次全部发布后可导出目标环境 SQL：

```powershell
bun run video:export-sql
```

默认输出到 `workdir/update_video_no_tags/sql/tb_video.sql`。SQL 不包含 `pk_id`，三个操作人字段固定为 `1`，语言按标题是否包含 `[一-鿿]` 重新计算，并使用 `uk_cross_id` 保证重复执行时更新同一条视频。

如果源视频已经被软删除，管理端列表不会返回它。此时在 `.env` 中配置只读源库连接 `SOURCE_DATABASE_URL` 后再运行命令；导出会保留原 `uk_cross_id` 和业务字段，并在目标 SQL 中恢复为已发布、未删除。数据库账号只需要 `tb_video` 的 `SELECT` 权限。

### 按知识点配置清单上传英文视频

`workdir/update_video_tags` 批次可以只保留 `video/en`。配置清单中只要填写了 `介绍视频EN` 或 `漏洞视频EN`，就必须填写 `介绍视频标签`；已填写的英文视频会映射到该标签，另一个视频列可留空：

```text
介绍视频EN -> primaryTags: [介绍视频标签]
漏洞视频EN -> primaryTags: [介绍视频标签]
```

视频文件名（忽略常见视频扩展名和英文大小写）必须与 `介绍视频EN` 或 `漏洞视频EN` 一一对应。建议先只扫描并检查生成的 `doc/en/videos.csv`：

```powershell
bun run video-tags:scan
```

执行上传前，脚本会读取 CSV 的 `primaryTags` 和 `secondaryTags`，查询后台标签表并仅创建不存在的标签；同名标签在一个批次内只处理一次。

确认标题和 `primaryTags` 后，执行完整的 Stream 上传、封面上传、`/video/add` 和 `/video/publish`：

```powershell
bun run video-tags:upload
```

也可一步完成扫描和上传：

```powershell
bun run video-tags:all
```

扫描开始前会校验配置是否完整、名称是否重复、每个本地视频是否存在配置以及每个已配置视频是否存在本地文件。任何一项不满足都会停止，不生成可上传的半批次。两个英文视频列都为空的行视为不属于本次上传批次。

需要使用其他根目录时，传入 `--work-dir "E:\素材工作目录"`；也可用 `--input "E:\视频根目录"` 覆盖默认的 `<work-dir>/video`。当前不传参数时使用 `workdir/update_video_no_tags`。旧版 21 列 CSV 与当前 9 列接口 CSV 不兼容，升级后需要重新 `scan`；已上传到 Cloudflare 的资源不会被该参数删除，所以开始上传后不要随意强制重建状态。

## 字段规则

- `title`：视频文件名去掉扩展名，最多 128 个字符。
- `language`：标题包含任意汉字时为 `zh`，否则为 `en`。
- `difficulty`：默认 `10`；可改为 `10`、`20` 或 `30`。
- `titleDescription`：默认空字符串；提交 `/video/add` 时自动转换为单个空格，以满足后端最小长度限制。
- `primaryTags`、`secondaryTags`：默认 `[]`，为 JSON 字符串数组，元素不能包含首尾空格；传入 `--tag-config` 时，英文视频的 `primaryTags` 由知识点配置清单生成。
- `coverId`、`coverUrl`：后端签发 Images 直传地址时返回的图片 ID 和访问地址；仅在直传成功后写入。
- `videoUid`：后端创建 Stream TUS 会话时返回的 UID；会先写入以支持上传续跑。
- `videoPublished`：保存在 `upload-state.json` 中，表示 `/video/publish` 已成功；CSV 仍不增加该字段。

CSV 只承载新增视频接口所需字段。视频时长、大小和审计字段由后端 `/video/add` 业务层生成，发布状态由 `/video/publish` 更新。上传链路不会直接连接数据库；仅在配置 `SOURCE_DATABASE_URL` 导出软删除记录时只读查询 `tb_video`。脚本不会执行生成的 SQL。

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

完整规则见 [Data Services 场景验证手牌批量工具](docs/duplicate-match-hand-design.md)。

参考资料：

- [Stream TUS 分片上传](https://developers.cloudflare.com/stream/uploading-videos/resumable-uploads/)
- [Images 上传 API](https://developers.cloudflare.com/api/resources/images/subresources/v1/methods/create/)
