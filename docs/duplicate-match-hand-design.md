# Data Services 场景验证手牌批量工具

## 目标

使用固定的 6 人桌数据生成可复现的复式手牌，将每条行动线停在 Hero 决策点，批量完成：

```text
新增手牌 -> 发布手牌 -> 新增单手活动 -> 发布活动
```

每个活动只引用一手牌，活动名称与手牌名称相同；开始时间取创建活动时的当前时间，结束时间为开始时间后 7 天。

## 数据文件

```text
workdir/duplicate-match-hand/
├─ cases.json         # Case、请求体和本地期望值
├─ table-ids.csv      # Case、handId、activityUuid 与打牌后 tableId 的对应关系
├─ game-hand-history-results/
│  └─ <caseId>.json   # get_hand_history 返回的原始牌局
├─ data-services-results/
│  └─ <caseId>.json   # Data Services 返回的解析结果
└─ upload-state.json  # 远端 handId/activityUuid 及各发布阶段
```

`cases.json` 中的 `expected` 仅供验证 Data Services 返回结果，不会发送给后端。发送给后端的内容只有 `request.title` 和 `request.drillInfo`。

`table-ids.csv` 固定包含 `caseId,title,handId,activityUuid,tableId` 五列。`handId` 和 32 位 `activityUuid` 从新增接口响应自动同步；每完成一个活动中的牌局，将牌桌 ID 填入对应 Case 的 `tableId`。再次生成 Case 时会按 `caseId` 保留已填写的值，不会覆盖。旧三列表头会在下次同步时自动升级。

后续查询解析结果时使用：

```text
GET /api/hands-review/data-services/hands?page=1&pageSize=1&filter=table_id:eq:<tableId>
```

填写 CSV 后执行：

```powershell
bun run hand:fetch-results
```

命令会使用相同的 tableId 分别请求：

```text
POST /api/game_client/get_hand_history
GET  /api/hands-review/data-services/hands?page=1&pageSize=1&filter=table_id:eq:<tableId>
```

两类结果 JSON 都包含 `caseId`、`title`、`tableId`、实际请求信息、抓取时间和完整 `response`，以此与 CSV 行一一对应。同一个 tableId 不允许关联两个 Case；每个接口已经保存相同 Case 和 tableId 的结果时各自跳过，任一接口未就绪时不影响另一份已成功结果。该命令通过 `BACKEND_WEB_TOKEN` 访问 Web 接口。

## 默认牌桌

- 6 人桌，BTN/SB/BB/UTG/HJ/CO 对应座位 0～5；
- stack=200、big_blind=2、ante=1；
- dealer=0、SB=1、BB=2、无 straddle；
- 所有玩家使用互不冲突的固定底牌；
- Flop/Turn/River 分别使用 `8c2s4s`、`7d`、`6h`；
- Hero 位置变化时同步交换 Hero 名称和底牌。

## Case 覆盖

当前共生成 35 条 Case：

- 翻前：同一 Spot 按 Hero 是否已行动、前序活跃对手数和行动顺序拆分；
- 翻后：Flop/Turn/River 分别覆盖 FTA、面对 Check、面对 Bet、面对 Raise；
- Hero 位置：BTN、SB、BB、UTG、HJ、CO；
- 入池人数：2、3、4、5、6；
- 相对位置：oop、ip、sandwiched；
- 底池类型：limped、srp、3bp、4bp+；
- 主动权：aggressor、caller_or_checker。

行动数量用于选择 Case 类型，但生成器输出的是经过下注顺序、金额和 Hero 节点约束校验的完整行动线，不会机械拼接任意 action。

### 翻前 Case 颗粒度

| Spot                  | Case                | Hero 决策前行动结构                          | 活跃对手数 |
| --------------------- | ------------------- | -------------------------------------------- | ---------: |
| `preflop_rfi`         | 首位 RFI            | Hero 前无行动                                |          0 |
| `preflop_rfi`         | 后位 RFI            | 多人 fold → Hero                             |          0 |
| `preflop_vs_limp`     | 单个 Limp           | call → fold → fold → Hero                    |          1 |
| `preflop_vs_limp`     | 多个 Limp           | call → call → call → Hero                    |          3 |
| `preflop_vs_raise`    | Limp 后 Raise       | call → raise → fold → Hero                   |          2 |
| `preflop_vs_raise`    | Raise 后 Call       | raise → call → fold → Hero                   |          2 |
| `preflop_vs_threebet` | Hero 尚未行动       | raise → raise → fold → Hero                  |          2 |
| `preflop_vs_threebet` | Hero 为开池者，单挑 | Hero raise → 其余 fold → BB raise → Hero     |          1 |
| `preflop_vs_threebet` | Hero 为开池者，多人 | Hero raise → call → raise → 其余 fold → Hero |          2 |
| `preflop_vs_fourbet`  | 连续 3/4/5 次加注   | 多名玩家依次 raise → Hero                    |       3～5 |

`Hero raise → opponent call` 后翻前轮次已经结束，不能直接再次轮到 Hero。因此“Hero 已行动后再次面对 3Bet”的合法多人结构使用 `Hero raise → call → re-raise → Hero`。

## 活动请求

每个活动使用以下固定规则：

```json
{
  "title": "与手牌名称相同",
  "description": "Data Services 场景参数验证：<手牌名称>",
  "playHandCount": 1,
  "playCount": 6,
  "handList": [{ "handId": 1, "itemType": 1, "sortNo": 1 }],
  "startTime": 1800000000000,
  "endTime": 1800604800000
}
```

活动新增前必须先发布手牌，否则后端的活动手牌引用校验不会通过。

## 恢复规则

每个远端步骤成功后立即原子更新 `upload-state.json`：

1. 保存 `handId`；
2. 标记 `handPublished`；
3. 保存 `activityUuid`；
4. 标记 `activityPublished` 并完成。

某一步失败后会保留此前成功结果。再次执行上传时从缺失的下一步继续，不重复调用已持久化成功的步骤。

后端接口目前没有幂等键。如果远端新增成功但进程在状态文件落盘前被强制终止，或者人为删除状态文件后重跑，仍可能产生同名记录。

## 重建活动

`bun run hand:rebuild-activities` 只处理当前 `cases.json` 与 `upload-state.json` 中 caseId、title 一致且已保存 `activityUuid` 的记录：先取消发布、删除旧活动，立即清空本地 `activityUuid`，再复用 `handId` 创建并发布新活动。它不会使用标题查询后端，因此不会误删状态文件外的同名活动。

## 命令

```powershell
# 只生成并人工检查 JSON
bun run hand:generate

# 上传已生成的 Case
bun run hand:upload

# 生成并立即上传
bun run hand:all
```

管理端 Token 必须同时拥有：

- `SYS_DUPLICATE_MATCH_HAND`；
- `SYS_DUPLICATE_MATCH_ACTIVITY`。
