# 课程内容发布操作手册

这是一份可直接照做的运行手册，适用于一次性发布新视频、翻后 Drill 和课程学习节点。执行人不需要了解脚本实现，但必须具备本文列出的账号权限。

## 0. 开始前先检查

### 0.1 需要的权限和工具

全部勾选后再开始：

- [ ] Windows PowerShell、Git、Bun、Git LFS 已安装。
- [ ] 能访问 GitHub、公司 Gitea、Cloudflare、管理端 API 和 QuintAce 接口。
- [ ] 已取得管理端 `BACKEND_ADMIN_TOKEN`。
- [ ] 已取得三方矩阵 `QUINTACE_API_TOKEN`。
- [ ] 有三个仓库的拉取和推送权限。
- [ ] 有测试环境或生产环境的部署、SQL 执行权限；没有时已确定交接人。

检查工具：

```powershell
git --version
git lfs version
bun --version
```

任何一条命令报错时先安装对应工具，不要继续发布。

### 0.2 固定仓库版本

以下版本已于 2026-09-16 核对：

| 用途                 | 仓库                                                              | 应使用的分支 / 提交                                  |
| -------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| 视频上传、视频 SQL   | `https://github.com/yangyaDu/cloudflare-video-batch-uploader.git` | `main` / `2992929`                                   |
| 学习节点             | 同上                                                              | `main` / `2992929`                                   |
| Drill 配表、矩阵跑数 | `http://10.10.1.100:3000/ZenithStrat/backend-framework`           | `feat/postflop-drill-select-hole-cards` / `11e040df` |
| Drill 范围数据       | `http://10.10.1.100:3000/ZenithStrat/preflop-range.git`           | `main` / `3234c34`                                   |

`cloudflare-video-batch-uploader/main` 已包含 `src/learn-node/`、示例 Manifest、文档和对应的 `learn:*` 命令，其他机器可直接拉取使用。

首次准备仓库：

```powershell
$projectRoot = 'E:\idea_project\ZenithStrat'
Set-Location $projectRoot

git clone https://github.com/yangyaDu/cloudflare-video-batch-uploader.git
git clone --branch feat/postflop-drill-select-hole-cards `
  http://10.10.1.100:3000/ZenithStrat/backend-framework
git clone http://10.10.1.100:3000/ZenithStrat/preflop-range.git

Set-Location "$projectRoot\preflop-range"
git lfs install
git lfs pull
```

仓库已经存在时不要重复 `clone`，改为拉取指定分支的最新代码。执行期间不要切换分支，也不要混入其他批次的改动。

## 1. 收到内容后，先整理一张总表

### 输入

内容团队可以交付任意目录结构，但必须给齐：

- 视频文件、最终视频标题和语言；有成品封面时一并提供。
- 课程标题、章节标题、小节标题及顺序。
- 每个小节对应的视频标题和 Drill 标题。
- 每个 Drill 的行动过程、公共牌变化和指定练习底牌。

### 整理结果

先制作课程对照表，每个小节只占一行：

| chapterTitle | subchapterTitle | videoTitle      | drillTitle  | drill_public_id |
| ------------ | --------------- | --------------- | ----------- | --------------- |
| 第九章……     | 9.1 节……        | 空气高张 Cbet…… | 3Bet 底池…… | lesson_xxx      |

规则：

- `chapterTitle`、`subchapterTitle` 相同的连续单元格可以合并，但不得改变行的对应关系。
- `drill_public_id` 由开发人员确定，发布后不得更换。
- 视频、Drill、学习节点全部以这张表为核对依据。

### 成功标准

- [ ] 每个小节恰好一行。
- [ ] 所有视频都有归属，没有重复标题。
- [ ] 每个 Drill 都有唯一的 `drill_public_id`。
- [ ] 标题、顺序、语言已经由内容负责人确认。

有任何一项不确定时停止，不要凭文件名猜测对应关系。

## 2. 整理并上传视频

执行仓库：`cloudflare-video-batch-uploader`。

### 2.1 把原始视频整理成脚本目录

保留原始交付不动，将视频复制到新批次目录。`<批次名>` 建议使用日期和用途，例如 `20260915_phase3`。

```text
cloudflare-video-batch-uploader/
└── workdir/<批次名>/
    └── video/
        ├── zh/
        └── en/
```

- 中文放 `zh`，英文放 `en`；没有某种语言可以不建该目录。
- `zh`、`en` 内可以继续保留子目录，脚本会递归查找。
- 文件名应对应最终标题。脚本会去掉开头的 `数字-` 和末尾的 `CN` / `EN` 标记。

### 2.2 配置环境变量

在上传器根目录创建或修改 `.env`：

```dotenv
BACKEND_BASE_URL=http://localhost:3000
BACKEND_ADMIN_TOKEN=<管理端 access token>
VIDEO_READY_POLL_INTERVAL_MS=5000
VIDEO_READY_TIMEOUT_MS=1800000
```

前两项必填。`SOURCE_DATABASE_URL` 只在导出已软删除视频，或管理端无法查询视频时使用。

不要把 `.env`、Token 或带 Token 的日志提交到 Git。

### 2.3 依次执行四条命令

```powershell
Set-Location 'E:\idea_project\ZenithStrat\cloudflare-video-batch-uploader'
$batch = '20260915_phase3' # 改成本批批次名

# 统计本批视频的文件数量、各语言时长和总时长，不会修改或上传文件
bun run src/cli.ts duration --work-dir ".\workdir\$batch"

# 扫描 video/zh 和 video/en，生成封面、videos.csv 和 upload-state.json，不会上传
bun run src/cli.ts scan --work-dir ".\workdir\$batch"

# 根据扫描结果上传尚未完成的视频和封面，并写入、发布后端 video 记录
# 中断后可重复执行；脚本会读取 upload-state.json，跳过已经完成的步骤
bun run src/cli.ts upload --work-dir ".\workdir\$batch"

# 根据本批已发布的视频生成可重复执行的标签 SQL 和视频 SQL
# 输出到 workdir/<批次名>/sql/tb_admin_tag.sql 和 tb_video.sql
bun run src/cli.ts export-sql --work-dir ".\workdir\$batch"
```

`scan` 会生成：

```text
workdir/<批次名>/
├── covers/en|zh/
├── doc/en|zh/videos.csv
├── doc/en|zh/upload-state.json
└── sql/
```

有成品封面时，必须在执行 `upload` 前替换 `covers/en|zh` 中对应的自动封面。脚本默认截取视频第 1 秒；只有截取失败时才回退到第一帧。仍需人工检查黑屏、转场和人物闭眼。

### 2.4 成功标准和失败处理

- [ ] `duration` 的文件数与收到的视频数相同，总时长合理。
- [ ] `videos.csv` 的标题、语言和文件路径与课程对照表一致。
- [ ] 所有封面均已打开检查。
- [ ] `upload-state.json` 中没有失败项。
- [ ] 管理端能按标题找到视频，且能正常播放。
- [ ] `sql/tb_video.sql` 已生成并留作发布记录。

上传中断或出现网络错误时，修复网络或后端后重新执行同一条 `upload` 命令。脚本会读取 `upload-state.json`，跳过已经完成的视频，不会重复上传。

如果视频已传到 Cloudflare，但失败在“等待视频转码并写入 video 表”，也应先重试同一批次，不要手工再传一个新视频。

后续学习节点使用 `tb_video.uk_cross_id`，**不能使用 Cloudflare Stream `videoUid`**。

## 3. 整理并发布 Drill

执行仓库：`backend-framework`；最终范围文件提交到 `preflop-range`。

### 3.1 配置 Drill 基本信息

修改：

```text
backend-framework/src/datasheet/data/drill_scenario_config.json
```

普通课程 Drill 使用连续编号。当前课程序号已到 `77`，下一条从 `78` 开始。`1001`～`1004` 是特殊配置，不能覆盖。

```json
{
  "drill_id": 78,
  "drill_public_id": "lesson_xxx",
  "drill_name": "Drill 标题",
  "strategy": "",
  "player_count": 0,
  "depth": -1,
  "except_card_list": []
}
```

检查本批次：`drill_id`、`drill_public_id`、`drill_name` 均不得重复，标题必须与课程对照表完全一致。

### 3.2 整理需要跑的行动线输入请求

在以下目录准备两个文件：

```text
backend-framework/scripts/third_party_strategy_grid/data/
├── drill_action_lines.json
└── drill_action_lines.select-hole-cards.json
```

`drill_action_lines.json` 用来列出本批需要跑数的 Drill 和行动线。每个 Drill 写一个对象；`drill_public_id` 必须与 Drill 配表一致，`action_lines` 填该 Drill 的全部行动线：

```json
[
  {
    "drill_public_id": "lesson_xxx",
    "action_lines": ["F-F-F-R2.5-F-C-As7h5h-X"]
  }
]
```

`drill_action_lines.select-hole-cards.json` 用来指定练习底牌。第一层键是 `drill_public_id`；`action_line` 必须与上一个文件中的行动线完全一致；`select_hole_cards` 填该行动线需要练习的底牌：

```json
{
  "lesson_xxx": [
    {
      "action_line": "F-F-F-R2.5-F-C-As7h5h-X",
      "select_hole_cards": ["KsQs", "KhQh"]
    }
  ]
}
```

同一个 Drill 有多种公共牌或行动过程时，在 `action_lines` 中分别写成多条记录，并在指定底牌文件中逐条对应。

### 3.3 先拉完整底表，再跑本批数据

```powershell
Set-Location 'E:\idea_project\ZenithStrat\backend-framework'

bun run range-postflop-drill:pull
Copy-Item `
  .\range-db\postflop-drill\postflop-drill-data.json `
  .\scripts\third_party_strategy_grid\data\postflop-drill-data.json

$env:QUINTACE_API_TOKEN = '<token>'
bun run scripts/third_party_strategy_grid/run-scene-range-third-party.ts `
  scripts/third_party_strategy_grid/data/drill_action_lines.json `
  --select-hole-cards scripts/third_party_strategy_grid/data/drill_action_lines.select-hole-cards.json `
  -o scripts/third_party_strategy_grid/data/postflop-drill-data.json
```

`QUINTACE_API_TOKEN` 必填。只有需要覆盖默认 staging 地址时才设置 `QUINTACE_MATRIX_URL`。没有缓存的 Gitea 登录凭据时，拉取底表前临时设置 `GITEA_TOKEN`。

### 3.4 检查并提交完整范围文件

先检查：

- [ ] 本批次 Drill 数量、行动线数量与输入一致，失败数为 `0`。
- [ ] 每条行动线都有 `hero` 和 `opponent`。
- [ ] 每个 `select_hole_cards` 都能在对应 Hero 范围中找到。
- [ ] 本批次没有两个学习节点误绑同一个 `drill_public_id`。
- [ ] 旧 Drill 仍在输出文件中；输出不是只有本批次的小文件。

然后复制完整输出：

```powershell
Copy-Item `
  'E:\idea_project\ZenithStrat\backend-framework\scripts\third_party_strategy_grid\data\postflop-drill-data.json' `
  'E:\idea_project\ZenithStrat\preflop-range\range-db\postflop-drill\postflop-drill-data.json'
```

在 `preflop-range` 中确认 Git LFS 已接管该文件，再提交并推送 `main`。后端部署会从 `preflop-range/main` 拉取它。

### 3.5 Drill 成功标准

- [ ] `drill_scenario_config.json` 已提交到后端发布分支。
- [ ] 完整 `postflop-drill-data.json` 已提交到 `preflop-range/main`。
- [ ] 后端已部署对应 Drill 配置和最新范围数据。
- [ ] 每个新增 Drill 都能建桌，指定底牌、公共牌和决策点正确。

任何一个 Drill 建桌失败时，停止创建课程节点，先修复 Drill 配置或范围数据。

## 4. 创建并发布学习节点

执行仓库：`cloudflare-video-batch-uploader/main`，最低版本为 `2992929`。

### 4.1 准备 Manifest

参考模板：

```text
docs/examples/learn-node-manifest.json
```

本批文件建议放在：

```text
workdir/learn-node/<批次名>-manifest.json
```

结构固定为 `course → chapter → subchapter → video / drill`：

```json
[
  {
    "courseTitle": "课程标题",
    "chapters": [
      {
        "chapterTitle": "第九章……",
        "subChapters": [
          {
            "subChapterTitle": "9.1 节……",
            "video": {
              "title": "视频标题",
              "refId": "tb_video.uk_cross_id"
            },
            "drill": {
              "title": "Drill 标题",
              "refId": "lesson_xxx"
            }
          }
        ]
      }
    ]
  }
]
```

- 视频 `refId` = `tb_video.uk_cross_id`。
- Drill `refId` = `drill_scenario_config.drill_public_id`。
- Drill 通关条件保持 `{"type":"drill_result","minAccuracy":0}`，不使用 `0.9`。
- Manifest 的标题和顺序必须逐行对照第 1 节的课程总表。

### 4.2 先预览，再实际创建

沿用上传器 `.env` 中的 `BACKEND_BASE_URL` 和 `BACKEND_ADMIN_TOKEN`：

```powershell
Set-Location 'E:\idea_project\ZenithStrat\cloudflare-video-batch-uploader'
$manifest = '.\workdir\learn-node\20260915_phase3-manifest.json'
$created = '.\workdir\learn-node\20260915_phase3-created.json'

bun run learn:build --manifest $manifest --dry-run
bun run learn:build --manifest $manifest --output $created
```

实际创建前必须人工检查 Dry Run 的课程、章节、小节、视频和 Drill 数量。

脚本每创建一个节点就把 `nodeUuid` 写入 `$created`。中断后只能用 `$created` 继续：

```powershell
bun run learn:build --manifest $created --output $created
```

不要再次用不带 `nodeUuid` 的原始 Manifest 执行，否则可能重复创建节点。

### 4.3 查看并发布课程树

从 `$created` 取得课程根节点 `nodeUuid`：

```powershell
bun run learn:tree <课程根节点UUID> --no-color
bun run learn:publish <课程根节点UUID>
```

`learn:build` 只创建和绑定，不会自动发布。只有树结构和资源绑定全部核对通过后才能执行 `learn:publish`。

### 4.4 学习节点成功标准

- [ ] 章节和小节数量、标题、排序与课程对照表一致。
- [ ] 每个视频节点都绑定正确的 `uk_cross_id`，视频可播放。
- [ ] 每个 Drill 节点都绑定正确的 `drill_public_id`，能正常建桌。
- [ ] 所有本批 Drill 的 `minAccuracy` 都为 `0`。
- [ ] 根课程及其子节点均已发布。
- [ ] `$created` 已保存，作为节点 UUID 和断点续跑记录。

## 5. 整理本次发布的新增 SQL

学习节点创建并确认无误后，将本批新增内容整理成独立的 SQL 发布包：

```text
workdir/<批次名>/release-sql/
├── 01_tb_admin_tag.sql
├── 02_tb_video.sql
├── 03_tb_learn_node.sql
└── 99_verify.sql
```

### 5.1 整理 SQL 文件

先建立发布目录并复制视频脚本生成的两个 SQL：

```powershell
Set-Location 'E:\idea_project\ZenithStrat\cloudflare-video-batch-uploader'
$batch = '20260915_phase3' # 改成本批批次名
$releaseSql = ".\workdir\$batch\release-sql"

New-Item -ItemType Directory -Force $releaseSql
Copy-Item ".\workdir\$batch\sql\tb_admin_tag.sql" "$releaseSql\01_tb_admin_tag.sql"
Copy-Item ".\workdir\$batch\sql\tb_video.sql" "$releaseSql\02_tb_video.sql"
```

- `01_tb_admin_tag.sql`：复制本批 `export-sql` 生成的 `sql/tb_admin_tag.sql`。
- `02_tb_video.sql`：复制本批 `export-sql` 生成的 `sql/tb_video.sql`。
- `03_tb_learn_node.sql`：根据最终 `$created` 文件整理本批新增的章节、小节、视频和 Drill 节点 SQL。
- `99_verify.sql`：查询本批视频和节点的总数、发布状态、唯一资源数，执行结果必须与课程对照表一致。

整理要求：

- 只包含本批新增的视频和学习节点，不夹带历史批次或无关修正。
- 视频按 `uk_cross_id` 幂等写入，学习节点按 `node_uuid` 幂等写入，SQL 重复执行不能产生重复数据。
- 视频和学习节点发布状态均为已发布，Drill 的 `minAccuracy` 保持 `0`。
- 视频节点 `ref_id` 使用 `tb_video.uk_cross_id`，Drill 节点 `ref_id` 使用 `drill_public_id`。
- `drill_scenario_config.json` 和 `postflop-drill-data.json` 通过代码仓库发布，不放进 SQL。

### 5.2 SQL 核对结果

- [ ] SQL 文件按 `01 → 02 → 03 → 99` 的顺序执行无报错。
- [ ] 本批视频数、节点数和唯一资源数正确。
- [ ] 没有重复的 `uk_cross_id`、`video_uid`、`node_uuid` 或错误复用的 `drill_public_id`。
- [ ] SQL 中没有 Token、开发环境地址或与本批无关的数据。

## 6. 发布顺序

必须按以下顺序，不能倒置：

1. 上传视频，并确认管理端可播放。
2. 发布 `preflop-range` 的完整 Drill 范围数据。
3. 发布并部署 `backend-framework` 的 Drill 配置。
4. Dry Run 学习节点 Manifest。
5. 创建学习节点，检查整棵树。
6. 整理本批新增 SQL，并按顺序测试执行和核对数量。
7. 发布课程根节点。
8. 在实际学习端完成一次视频播放和 Drill 建桌验收。

发布记录还要保存后端 Drill 配置提交号、`preflop-range` 数据提交号、课程对照表和最终验收记录。

## 7. 最终交接清单

发布人完成后，把下面的结果一次性交给复核人：

- [ ] 批次名、环境和发布时间。
- [ ] 视频数量、总时长、失败数和视频 SQL 路径。
- [ ] 本批 `release-sql` 目录及 SQL 验证结果。
- [ ] Drill 数量、行动线数量、失败数及两个仓库提交号。
- [ ] 课程根节点 UUID、节点数量和 `$created` 文件路径。
- [ ] 视频播放、Drill 建桌、章节顺序和资源绑定的验收结果。
- [ ] 所有 Token 已从终端共享记录和交付文件中移除。

只有以上项目全部完成，才算本批课程发布结束。
