import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

type JsonObject = Record<string, unknown>

const workDir = resolve(process.argv[2] ?? './workdir')
const rootDir = join(workDir, 'duplicate-match-hand')
const dataServicesDir = join(rootDir, 'data-services-results')
const outputPath = join(rootDir, '牌谱维度参数验证报告.html')
const streets = ['preflop', 'flop', 'turn', 'river']
const boardMarkers = ['8c2s4s', '7d', '6h']
const positionValues = ['UTG', 'UTG1', 'UTG2', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']
const spotTypeValues = [
  'preflop_rfi',
  'preflop_vs_limp',
  'preflop_vs_raise',
  'preflop_vs_threebet',
  'preflop_vs_fourbet',
  'postflop_fta',
  'postflop_vs_check',
  'postflop_vs_bet',
  'postflop_vs_raise',
]
const relationValues = ['oop', 'ip', 'sandwiched']
const playerCountValues = [2, 3, 4, 5, 6, 7, 8, 9]
const potFamilyValues = ['limped_pot', 'srp', '3bet_pot', '4bet_pot']
const initiativeValues = ['aggressor', 'caller_or_checker']
const streetLabels: Record<string, string> = {
  preflop: '翻前',
  flop: '翻牌圈',
  turn: '转牌圈',
  river: '河牌圈',
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('预期 JSON 对象')
  }
  return value as JsonObject
}

function objects(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(object) : []
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function displayAction(action: JsonObject, heroRole: string): string {
  const role = String(action.role ?? '')
  const name = String(action.action ?? '')
  return `${role === heroRole ? '【Hero】' : ''}${role} ${name}`.trim()
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function deriveSpotType(
  street: string,
  actions: JsonObject[],
  decisionIndex: number
): string | null {
  const prior = actions.slice(0, decisionIndex).filter((action) => action.action !== 'fold')
  if (street === 'preflop') {
    const raises = prior.filter(
      (action) => action.action === 'raise' || action.action === 'allin'
    ).length
    if (raises === 0) return prior.length === 0 ? 'preflop_rfi' : 'preflop_vs_limp'
    if (raises === 1) return 'preflop_vs_raise'
    if (raises === 2) return 'preflop_vs_threebet'
    return 'preflop_vs_fourbet'
  }
  const latest = prior.at(-1)?.action
  if (!latest) return 'postflop_fta'
  if (latest === 'check') return 'postflop_vs_check'
  if (latest === 'bet') return 'postflop_vs_bet'
  if (latest === 'raise' || latest === 'allin') return 'postflop_vs_raise'
  return null
}

function deriveVillainPosition(actions: JsonObject[], decisionIndex: number): string | null {
  const aggressor = actions
    .slice(0, decisionIndex)
    .filter(
      (action) => action.action === 'bet' || action.action === 'raise' || action.action === 'allin'
    )
    .at(-1)
  return aggressor ? String(aggressor.role) : null
}

function derivePotFamily(preflopActions: JsonObject[]): string {
  const raises = preflopActions.filter(
    (action) => action.action === 'raise' || action.action === 'allin'
  ).length
  if (raises === 0) return 'limped_pot'
  if (raises === 1) return 'srp'
  if (raises === 2) return '3bet_pot'
  return '4bet_pot'
}

function deriveInitiative(preflopActions: JsonObject[], heroSeat: number): string | null {
  const lastHeroAction = preflopActions
    .filter((action) => action.seatNo === heroSeat && action.action !== 'fold')
    .at(-1)?.action
  if (!lastHeroAction) return null
  return lastHeroAction === 'raise' || lastHeroAction === 'allin'
    ? 'aggressor'
    : 'caller_or_checker'
}

function sourceLink(caseId: string, tableType: string): string {
  return `${tableType}/data-services-results/${caseId}.json`
}

interface ReportCase {
  caseId: string
  title: string
  tableType: string
  phase: 'preflop-ended' | 'postflop'
  status: 'passed' | 'issue' | 'pending'
  fields: string[]
  actual: JsonObject
  expected: JsonObject
  actionLine: string[]
  postflopLines: Array<{ street: string; actions: string[] }>
  sourcePath: string
}

async function readJson(path: string): Promise<JsonObject> {
  return object(JSON.parse(await readFile(path, 'utf8')))
}

async function buildCasesFromRoot(casesRoot: string, tableType: string): Promise<ReportCase[]> {
  const manifest = await readJson(join(casesRoot, 'cases.json'))
  const resultsDir = join(casesRoot, 'data-services-results')
  const cases = objects(manifest.cases)
  const reportCases: ReportCase[] = []

  for (const handCase of cases) {
    const caseId = String(handCase.caseId)
    const title = String(handCase.title)
    const expected = object(handCase.expected)
    const request = object(handCase.request)
    const drillInfo = object(request.drillInfo)
    const inputActions = objects(drillInfo.actions)
    const saved = await readJson(join(resultsDir, `${caseId}.json`))
    const response = object(saved.response)
    const data = object(response.data)
    const card = object(objects(data.data)[0])
    const players = objects(card.players)
    const hero = players.find((player) => player.hand_cards === card.hole_cards)
    if (!hero) throw new Error(`${caseId} 无法识别 Hero`)

    const targetStreet = String(expected.street)
    const streetIndex = streets.indexOf(targetStreet)
    if (streetIndex < 0) throw new Error(`${caseId} 不支持的目标街道: ${targetStreet}`)
    let targetInputStart = 0
    if (streetIndex > 0) {
      for (const [index, action] of inputActions.entries()) {
        if (action.action === boardMarkers[streetIndex - 1]) targetInputStart = index + 1
      }
    }
    const heroActionsBeforeTarget = inputActions
      .slice(targetInputStart)
      .filter((action) => action.seat_no === hero.seat_no).length

    const handHistory = objects(card.hand_history)
    const street = handHistory.find((item) => item.type === targetStreet)
    if (!street) throw new Error(`${caseId} 缺少 ${targetStreet} 行动线`)
    const actions = objects(street.actions)
    const heroDecisions = actions.filter(
      (action) => action.seatNo === hero.seat_no && action.situation
    )
    const decision = heroDecisions[heroActionsBeforeTarget]
    if (!decision) throw new Error(`${caseId} 缺少目标 Hero 决策`)
    const decisionIndex = actions.indexOf(decision)
    const situation = object(decision.situation)
    const heroRole = String(hero.position)
    const preflop = handHistory.find((item) => item.type === 'preflop')
    if (!preflop) throw new Error(`${caseId} 缺少 preflop 行动线`)
    const heroReachedPostflop = handHistory.some(
      (item) =>
        item.type !== 'preflop' &&
        objects(item.actions).some((action) => action.seatNo === hero.seat_no)
    )
    const activeSeatsAtStreetStart = new Set(players.map((player) => Number(player.seat_no)))
    for (const item of handHistory) {
      if (item.type === targetStreet) break
      for (const action of objects(item.actions)) {
        if (action.action === 'fold') activeSeatsAtStreetStart.delete(Number(action.seatNo))
      }
    }
    const activeSeats = new Set(activeSeatsAtStreetStart)
    for (const action of actions.slice(0, decisionIndex)) {
      if (action.action === 'fold') activeSeats.delete(Number(action.seatNo))
    }
    const priorActiveRoles = unique(
      actions
        .slice(0, decisionIndex)
        .filter(
          (action) =>
            action.action !== 'fold' && typeof action.role === 'string' && action.role !== heroRole
        )
        .map((action) => String(action.role))
    )
    const activeRoles = players
      .filter((player) => activeSeats.has(Number(player.seat_no)))
      .map((player) => String(player.position))
    const remainingAfterHero = activeRoles.filter(
      (role) => role !== heroRole && !priorActiveRoles.includes(role)
    )
    const derivedRelation =
      priorActiveRoles.length === 0 ? 'oop' : remainingAfterHero.length === 0 ? 'ip' : 'sandwiched'
    const actualVillainPosition = situation.villain_position ?? null
    const actual: JsonObject = {
      street: street.type,
      hero_position: card.player_position,
      spot_type: situation.situation,
      active_players: street.active_players,
      position_relation: street.relative_position,
      hero_initiative: card.hero_initiative,
      villain_position: actualVillainPosition,
    }

    const expectedOutput: JsonObject = {
      street: targetStreet,
      hero_position: heroRole,
      spot_type: deriveSpotType(targetStreet, actions, decisionIndex),
      active_players: activeSeatsAtStreetStart.size,
      position_relation: derivedRelation,
      hero_initiative: deriveInitiative(objects(preflop.actions), Number(hero.seat_no)),
      villain_position: deriveVillainPosition(actions, decisionIndex),
    }
    if (targetStreet !== 'preflop') {
      actual.pot_family = card.pot_type
      expectedOutput.pot_family = derivePotFamily(objects(preflop.actions))
    }
    if (!heroReachedPostflop) {
      // 翻前结束的牌局没有翻后位置关系或主动权可验证，因此不在短 JSON 中展示。
      delete actual.position_relation
      delete actual.hero_initiative
      delete expectedOutput.position_relation
      delete expectedOutput.hero_initiative
    }

    const fields: string[] = []
    const comparableFields = [
      'street',
      'hero_position',
      'pot_family',
      'spot_type',
      'active_players',
      'position_relation',
      'villain_position',
    ].filter((field) => heroReachedPostflop || field !== 'position_relation')
    for (const field of comparableFields) {
      if (JSON.stringify(actual[field]) !== JSON.stringify(expectedOutput[field])) {
        fields.push(field)
      }
    }
    const initiativePending =
      heroReachedPostflop && (card.hero_initiative === null || card.hero_initiative === undefined)
    if (initiativePending) fields.push('hero_initiative（未返回）')

    reportCases.push({
      caseId,
      title,
      tableType,
      phase: heroReachedPostflop ? 'postflop' : 'preflop-ended',
      status:
        fields.some((field) => field.includes('未返回')) && fields.length === 1
          ? 'pending'
          : fields.length > 0
            ? 'issue'
            : 'passed',
      fields,
      actual,
      expected: expectedOutput,
      // 报告只展示当前 Hero 决策的行动前缀；决策后的自动续局不属于该节点证据。
      actionLine: actions
        .slice(0, decisionIndex + 1)
        .map((action) => displayAction(action, heroRole)),
      // 进入翻后时，从翻前开始完整展示前序街道；当前 Hero 决策街只展示到 Hero 的这一手。
      postflopLines: handHistory
        .filter((item) => streets.slice(0, streetIndex + 1).includes(String(item.type)))
        .map((item) => {
          const isTargetStreet = item.type === targetStreet
          const streetActions = objects(item.actions)
          return {
            street: String(item.type),
            actions: (isTargetStreet
              ? streetActions.slice(0, decisionIndex + 1)
              : streetActions
            ).map((action) => displayAction(action, heroRole)),
          }
        }),
      sourcePath: sourceLink(caseId, tableType),
    })
  }
  return reportCases
}

/** 保持测试与单桌型报告使用的六人桌数据集。 */
export async function buildCases(): Promise<ReportCase[]> {
  return buildCasesFromRoot(rootDir, '6人桌')
}

async function buildCombinedCases(): Promise<ReportCase[]> {
  const sixMaxCases = await buildCases()
  const nineMaxRoot = join(workDir, '9max', 'duplicate-match-hand')
  try {
    const nineMaxCases = await buildCasesFromRoot(nineMaxRoot, '9人桌')
    return [...sixMaxCases, ...nineMaxCases]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return sixMaxCases
    throw error
  }
}

function mismatchFieldNames(fields: readonly string[]): Set<string> {
  return new Set(fields.map((field) => field.replace(/（.*$/, '')))
}

function renderJson(
  value: JsonObject,
  highlightedFields: ReadonlySet<string>,
  variant: 'actual' | 'expected'
): string {
  const entries = Object.entries(value)
  const lines = entries.map(([key, item], index) => {
    const highlighted = highlightedFields.has(key)
    const className = variant === 'actual' ? 'actual-bad' : 'expected-good'
    const renderedValue = escapeHtml(JSON.stringify(item) ?? '"（字段缺失）"')
    const rendered = highlighted
      ? `<span class="${className}">${renderedValue}</span>`
      : renderedValue
    return `  ${JSON.stringify(key)}: ${rendered}${index === entries.length - 1 ? '' : ','}`
  })
  return `{\n${lines.join('\n')}\n}`
}

function renderActionLines(item: ReportCase): string {
  if (item.phase === 'preflop-ended' || item.postflopLines.length === 0) {
    return escapeHtml(item.actionLine.join(' → '))
  }
  return item.postflopLines
    .map(({ street, actions }) => {
      const suffix = street === item.actual.street ? '（当前 Hero 决策）' : ''
      return `<span class="street-line"><strong>${escapeHtml(streetLabels[street] ?? street)}${suffix}：</strong>${actions.map(escapeHtml).join(' → ')}</span>`
    })
    .join('')
}

function renderCase(item: ReportCase): string {
  const label = item.status === 'passed' ? '通过' : item.status === 'pending' ? '待确认' : '异常'
  const phaseLabel = item.phase === 'preflop-ended' ? '翻前结束' : '进入翻后'
  const highlightedFields = mismatchFieldNames(item.fields)
  return `
<details class="case ${item.status}">
  <summary><span>${escapeHtml(item.caseId)} · ${escapeHtml(item.title)}</span><span class="badges"><span class="phase-badge">${escapeHtml(item.tableType)}</span><span class="phase-badge">${phaseLabel}</span><span class="badge">${label}</span></span></summary>
  <p class="line">${renderActionLines(item)}</p>
  <p class="diff">${item.fields.length > 0 ? `关注字段：${escapeHtml(item.fields.join('、'))}` : '所有字段与行动线推导一致。'}</p>
  <div class="compare">
    <section><h4>Data Services 实际输出</h4><pre>${renderJson(item.actual, highlightedFields, 'actual')}</pre></section>
    <section><h4>期望的 Data Services 输出</h4><pre>${renderJson(item.expected, highlightedFields, 'expected')}</pre></section>
  </div>
  <p class="source">原始响应：<code>${escapeHtml(item.sourcePath)}</code></p>
</details>`
}

function parameterMismatch(item: ReportCase, field: string): boolean {
  return JSON.stringify(item.actual[field]) !== JSON.stringify(item.expected[field])
}

function representativeCases(cases: readonly ReportCase[], field: string): ReportCase[] {
  const matched = cases.find((item) => !parameterMismatch(item, field))
  const mismatched = cases.find((item) => parameterMismatch(item, field))
  if (matched && mismatched) return [matched, mismatched]
  return [matched ?? mismatched].filter((item): item is ReportCase => item !== undefined)
}

function renderParameterCase(item: ReportCase, field: string): string {
  const actualValue = item.actual[field]
  const expectedValue = item.expected[field]
  const mismatch = JSON.stringify(actualValue) !== JSON.stringify(expectedValue)
  const actualHighlights = mismatch ? new Set([field]) : new Set<string>()
  const expectedHighlights = new Set([field])
  const actualTitle =
    field === 'active_players' ? 'Data Services 实际输出（街道开始时）' : 'Data Services 实际输出'
  const expectedTitle =
    field === 'active_players'
      ? '期望的 Data Services 输出（街道开始时）'
      : '期望的 Data Services 输出'
  return `
<details class="case ${mismatch ? 'issue' : 'passed'}">
  <summary><span>${escapeHtml(item.caseId)} · ${escapeHtml(item.title)}</span><span class="badges"><span class="phase-badge">${escapeHtml(item.tableType)}</span><span class="badge">${mismatch ? '异常' : '符合'}</span></span></summary>
  <p class="line">${renderActionLines(item)}</p>
  <div class="compare">
    <section><h4>${actualTitle}</h4><pre>${renderJson({ [field]: actualValue }, actualHighlights, 'actual')}</pre></section>
    <section><h4>${expectedTitle}</h4><pre>${renderJson({ [field]: expectedValue }, expectedHighlights, 'expected')}</pre></section>
  </div>
  <p class="source">原始响应：<code>${escapeHtml(item.sourcePath)}</code></p>
</details>`
}

interface ParameterCaseGroup {
  label: string
  cases: ReportCase[]
}

function groupsByExpectedValues(
  cases: readonly ReportCase[],
  field: string,
  values: readonly unknown[]
): ParameterCaseGroup[] {
  return values
    .map((value) => ({
      label: String(value),
      cases: cases.filter((item) => JSON.stringify(item.expected[field]) === JSON.stringify(value)),
    }))
    .filter((group) => group.cases.length > 0)
}

function renderParameterGroups(field: string, groups: readonly ParameterCaseGroup[]): string {
  return groups
    .map(({ label, cases }) => {
      const examples = representativeCases(cases, field)
      return `
  <section class="enum-group">
    <h4><code>${escapeHtml(label)}</code><span>共 ${cases.length} 个 Case，展示 ${examples.length} 个代表案例</span></h4>
    ${examples.map((item) => renderParameterCase(item, field)).join('\n')}
  </section>`
    })
    .join('\n')
}

function renderSimpleParameterSection(
  index: number,
  field: string,
  rows: ReadonlyArray<[string, string]>,
  groups: readonly ParameterCaseGroup[]
): string {
  return `
  <h2>${index}. <code>${field}</code></h2>
  <h3>推导结论</h3>
  <table class="rule-table"><tbody>
    <tr><th>项目规则</th><th>内容</th></tr>
    ${rows.map(([name, value]) => `<tr><td>${name}</td><td>${value}</td></tr>`).join('\n')}
  </tbody></table>
  <h3><code>${field}</code> Case</h3>
  ${renderParameterGroups(field, groups)}`
}

function renderSpotTypeSection(cases: readonly ReportCase[]): string {
  const groups = spotTypeValues
    .map((spotType) => ({
      spotType,
      cases: cases.filter((item) => item.expected.spot_type === spotType),
    }))
    .filter((group) => group.cases.length > 0)

  return `
  <h2>1. <code>spot_type</code></h2>
  <h3>推导结论</h3>
  <table class="rule-table"><tbody>
    <tr><th>项目规则</th><th>内容</th></tr>
    <tr><td>适用街道</td><td><code>preflop</code>、<code>flop</code>、<code>turn</code>、<code>river</code></td></tr>
    <tr><td>推导输入</td><td>Hero 当前 action 之前的行动子串；翻前统计 <code>raise/allin/call/fold</code>，翻后只统计当前街道的 <code>bet/raise/allin/check/fold</code></td></tr>
    <tr><td>返回字段</td><td><code>Hero decision.situation.situation</code></td></tr>
  </tbody></table>

  <h3>翻前当前行动前缀</h3>
  <table class="rule-table"><thead><tr><th>行动前缀规则</th><th>期望 <code>spot_type</code></th></tr></thead><tbody>
    <tr><td><code>raise/allin</code> 次数为 0，<code>call</code> 次数为 0；前缀为空或仅 <code>fold</code></td><td><code>preflop_rfi</code></td></tr>
    <tr><td><code>raise/allin</code> 次数为 0，且至少一次 <code>call</code></td><td><code>preflop_vs_limp</code></td></tr>
    <tr><td><code>raise/allin</code> 次数为 1</td><td><code>preflop_vs_raise</code></td></tr>
    <tr><td><code>raise/allin</code> 次数为 2</td><td><code>preflop_vs_threebet</code></td></tr>
    <tr><td><code>raise/allin</code> 次数大于等于 3</td><td><code>preflop_vs_fourbet</code></td></tr>
  </tbody></table>

  <h3>翻后当前街道行动前缀</h3>
  <table class="rule-table"><thead><tr><th>行动前缀规则</th><th>期望 <code>spot_type</code></th></tr></thead><tbody>
    <tr><td>空或仅 <code>fold</code></td><td><code>postflop_fta</code></td></tr>
    <tr><td>仅 <code>fold/check</code> 且至少一个 <code>check</code></td><td><code>postflop_vs_check</code></td></tr>
    <tr><td><code>bet/raise/allin</code> 次数为 1</td><td><code>postflop_vs_bet</code></td></tr>
    <tr><td><code>bet/raise/allin</code> 次数大于等于 2</td><td><code>postflop_vs_raise</code></td></tr>
  </tbody></table>
  <p class="note">补充：<code>fold</code> 不计数；翻前 <code>call</code> 只在没有 <code>raise/allin</code> 时区分 RFI/Limp；翻后 <code>check</code> 用于区分 FTA/VS Check，<code>call</code> 不增加下注次数。</p>

  <h3><code>spot_type</code> Case</h3>
  ${groups
    .map(({ spotType, cases: groupedCases }) => {
      const examples = groupedCases.slice(0, 2)
      return `
  <section class="enum-group">
    <h4><code>${spotType}</code><span>共 ${groupedCases.length} 个 Case，展示 ${examples.length} 个代表案例</span></h4>
    ${examples.map((item) => renderParameterCase(item, 'spot_type')).join('\n')}
  </section>`
    })
    .join('\n')}`
}

function renderOtherParameterSections(cases: readonly ReportCase[]): string {
  const positionCases = cases.filter((item) => 'position_relation' in item.expected)
  const initiativeCases = cases.filter((item) => 'hero_initiative' in item.expected)
  const villainGroups = groupsByExpectedValues(cases, 'villain_position', [null, ...positionValues])

  return [
    renderSimpleParameterSection(
      2,
      'street',
      [
        [
          '适用范围',
          '<code>preflop</code>、<code>flop</code>、<code>turn</code>、<code>river</code>',
        ],
        ['推导输入', '当前 Hero 决策所在的 <code>hand_history[].type</code>'],
        ['值规则', '公共牌数量 <code>0 / 3 / 4 / 5</code> 分别对应四条街道'],
        ['返回字段', '<code>hand_history[].type</code>'],
      ],
      groupsByExpectedValues(cases, 'street', streets)
    ),
    renderSimpleParameterSection(
      3,
      'hero_position',
      [
        [
          '适用街道',
          '<code>preflop</code>、<code>flop</code>、<code>turn</code>、<code>river</code>',
        ],
        ['推导输入', 'Hero 座位、庄位以及当前桌型的位置顺序（支持六人桌和九人桌）'],
        ['值范围', formatValues(positionValues)],
        ['返回字段', '<code>player_position</code>'],
      ],
      groupsByExpectedValues(cases, 'hero_position', positionValues)
    ),
    renderSimpleParameterSection(
      4,
      'villain_position',
      [
        [
          '适用街道',
          '<code>preflop</code>、<code>flop</code>、<code>turn</code>、<code>river</code>',
        ],
        ['推导输入', 'Hero 当前决策前同一街道的 <code>bet/raise/allin</code> 动作'],
        ['值范围', formatValues(positionValues)],
        [
          '值规则',
          'Hero 面对下注或加注时，返回最后一次有效进攻动作的主要进攻者位置；未面对下注或加注时返回 <code>null</code>',
        ],
        ['返回字段', '<code>Hero decision.situation.villain_position</code>'],
      ],
      villainGroups
    ),
    renderSimpleParameterSection(
      5,
      'position_relation',
      [
        ['适用范围', 'Hero 进入翻后的决策节点；翻前结束不生成'],
        ['推导输入', 'Hero 位置、当前街道有效玩家和当前街道行动顺序'],
        [
          '值规则',
          '第一位为 <code>oop</code>；最后一位为 <code>ip</code>；中间位置为 <code>sandwiched</code>',
        ],
        ['返回字段', '<code>hand_history[].relative_position</code>'],
      ],
      groupsByExpectedValues(positionCases, 'position_relation', relationValues)
    ),
    renderSimpleParameterSection(
      6,
      'active_players',
      [
        [
          '适用街道',
          '<code>preflop</code>、<code>flop</code>、<code>turn</code>、<code>river</code>',
        ],
        ['返回字段', '<code>hand_history[].active_players</code>'],
        ['期望推导口径', '当前街道开始时仍在牌局中的玩家总数，包含 Hero；不随本街道后续 fold 改变'],
        ['对照说明', '按旧接口文档的街道级语义校验，不按 Hero 当前决策点重新计数'],
        ['值范围', formatValues(playerCountValues)],
      ],
      groupsByExpectedValues(cases, 'active_players', playerCountValues)
    ),
    renderSimpleParameterSection(
      7,
      'pot_family',
      [
        ['适用范围', '由完整翻前行动确定，同一手牌的后续街道沿用'],
        ['推导输入', '完整翻前行动中的 <code>raise/allin</code> 次数'],
        [
          '值规则',
          '<code>0 → limped_pot</code>；<code>1 → srp</code>；<code>2 → 3bet_pot</code>；<code>≥3 → 4bet_pot</code>',
        ],
        ['返回字段', '<code>pot_type</code>'],
      ],
      groupsByExpectedValues(cases, 'pot_family', potFamilyValues)
    ),
    renderSimpleParameterSection(
      8,
      'hero_initiative',
      [
        ['适用范围', 'Hero 进入翻后的牌局；翻前结束不生成'],
        ['推导输入', 'Hero 在完整翻前行动中的最后一次有效动作'],
        [
          '值规则',
          '<code>raise/allin → aggressor</code>；<code>call/check → caller_or_checker</code>',
        ],
        ['返回字段', '<code>hero_initiative</code>'],
      ],
      groupsByExpectedValues(initiativeCases, 'hero_initiative', initiativeValues)
    ),
  ].join('\n')
}

function formatValues(values: readonly unknown[]): string {
  return values.map((value) => `<code>${escapeHtml(String(value))}</code>`).join('、')
}

function expectedValues(
  cases: readonly ReportCase[],
  field: string,
  orderedRange: readonly unknown[]
): unknown[] {
  const observed = new Map<string, unknown>()
  for (const item of cases) {
    const value = item.expected[field]
    const values = Array.isArray(value) ? value : [value]
    for (const entry of values) {
      if (entry !== undefined && entry !== null) observed.set(JSON.stringify(entry), entry)
    }
  }
  const ordered = orderedRange.filter((value) => observed.delete(JSON.stringify(value)))
  return [...ordered, ...observed.values()]
}

function parameterRow(
  name: string,
  range: readonly unknown[],
  rule: string,
  expected: readonly unknown[]
): string {
  return `<tr><td><code>${name}</code></td><td>${formatValues(range)}</td><td>${rule}</td><td>${formatValues(expected)}</td></tr>`
}

async function main(): Promise<void> {
  const cases = await buildCombinedCases()
  const issues = cases.filter((item) => item.status === 'issue')
  const pending = cases.filter((item) => item.status === 'pending')
  const passed = cases.filter((item) => item.status === 'passed')
  const preflopEnded = cases.filter((item) => item.phase === 'preflop-ended')
  const postflop = cases.filter((item) => item.phase === 'postflop')
  const sixMaxCount = cases.filter((item) => item.tableType === '6人桌').length
  const nineMaxCount = cases.filter((item) => item.tableType === '9人桌').length

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>牌谱维度参数验证报告</title>
<style>
  :root { color-scheme: dark; font-family: "Microsoft YaHei", system-ui, sans-serif; background:#101827; color:#e5e7eb; }
  body { max-width:1200px; margin:0 auto; padding:36px 24px 64px; }
  h1 { margin:0 0 8px; font-size:30px; } h2 { margin-top:42px; font-size:20px; } h3 { margin:26px 0 10px; font-size:16px; color:#cbd5e1; }
  .muted { color:#94a3b8; } .summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin:24px 0; }
  .card, .case, table { background:#182235; border:1px solid #2d3b53; border-radius:10px; }
  .card { padding:16px; } .card strong { display:block; font-size:26px; color:#f8fafc; margin-bottom:4px; }
  table { width:100%; border-collapse:separate; border-spacing:0; overflow:hidden; } th,td { text-align:left; padding:12px; border-bottom:1px solid #2d3b53; vertical-align:top; } tr:last-child td { border-bottom:0; } th { color:#93c5fd; }
  code, pre { font-family:Consolas, monospace; } code { color:#bfdbfe; } .case { margin:12px 0; overflow:hidden; }
  summary { cursor:pointer; padding:15px 16px; display:flex; justify-content:space-between; gap:12px; } .case[open] summary { border-bottom:1px solid #2d3b53; }
  .badges { display:flex; gap:6px; align-items:center; }.badge,.phase-badge { padding:2px 8px; border-radius:999px; font-size:12px; background:#334155; white-space:nowrap; }.phase-badge { background:#1e3a5f; color:#bfdbfe; }.issue .badge { background:#7f1d1d; color:#fecaca; }.pending .badge { background:#78350f; color:#fde68a; }.passed .badge { background:#14532d; color:#bbf7d0; }
  .line,.diff,.source { margin:14px 16px; line-height:1.7; }.line { color:#e2e8f0; }.street-line { display:block; }.street-line strong { color:#93c5fd; margin-right:4px; }.diff { color:#fbbf24; }
  .legend { color:#cbd5e1; margin:10px 0 16px; }.actual-bad { background:#7f1d1d; color:#fee2e2; padding:1px 3px; border-radius:3px; }.expected-good { background:#14532d; color:#dcfce7; padding:1px 3px; border-radius:3px; }
  .compare { display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:0 16px 4px; }.compare section { min-width:0; }.compare h4 { margin:8px 0; color:#cbd5e1; } pre { margin:0; padding:14px; overflow:auto; border-radius:8px; background:#0b1220; color:#dbeafe; font-size:12px; line-height:1.55; }
  .rule-table { margin:10px 0 18px; }.rule-table th:first-child { width:38%; }.note { color:#cbd5e1; line-height:1.7; }.enum-group { margin-top:28px; }.enum-group > h4 { display:flex; justify-content:space-between; align-items:center; margin:0 0 10px; padding:10px 12px; border-left:4px solid #3b82f6; background:#162033; border-radius:6px; }.enum-group > h4 span { color:#94a3b8; font-size:12px; font-weight:normal; }
  @media (max-width:760px) { .summary,.compare { grid-template-columns:1fr; } }
</style>
</head>
<body>
  <h1>牌谱维度参数验证报告</h1>
  <p class="muted">本报告合并六人桌与九人桌 Case。翻前结束 Case 展示当前 Hero 决策前缀；进入翻后 Case 从翻前开始，按翻牌、转牌、河牌展示轨迹，当前决策街只展示到 Hero 的这一手。</p>
  <section class="summary">
    <article class="card"><strong>8</strong>验证参数</article>
    <article class="card"><strong>${cases.length}</strong>目标 Hero 决策</article>
    <article class="card"><strong>${sixMaxCount}</strong>六人桌 Case</article>
    <article class="card"><strong>${nineMaxCount}</strong>九人桌 Case</article>
    <article class="card"><strong>${preflopEnded.length}</strong>翻前结束</article>
    <article class="card"><strong>${postflop.length}</strong>进入翻后</article>
    <article class="card"><strong>≤ 2</strong>每个枚举代表 Case</article>
  </section>
  <h2>阅读说明</h2>
  <p class="muted">每个参数均按照“推导结论 → 枚举值 → 代表 Case”展示。每个枚举优先展示一个符合案例和一个异常案例；没有对照差异时只展示一个典型案例。</p>
  <p class="legend">Case 左侧是 Data Services 实际输出，右侧是期望输出；<span class="actual-bad">红色</span> 为实际值不一致或字段缺失，<span class="expected-good">绿色</span> 为期望值。</p>
  ${renderSpotTypeSection(cases)}
  ${renderOtherParameterSections(cases)}
</body></html>`

  await mkdir(rootDir, { recursive: true })
  await writeFile(outputPath, html, 'utf8')
  console.log(`报告已生成：${outputPath}`)
  console.log(
    `目标节点 ${cases.length}；异常 ${issues.length}；待确认 ${pending.length}；通过 ${passed.length}`
  )
  console.log(`翻前结束 ${preflopEnded.length}；进入翻后 ${postflop.length}`)
}

if (import.meta.main) await main()
