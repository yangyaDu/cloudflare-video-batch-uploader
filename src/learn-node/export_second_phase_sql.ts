import { dirname, resolve } from 'node:path'

type Leaf = {
  title: string
  refId: string
  nodeUuid: string
}

type SubChapter = {
  subChapterTitle: string
  nodeUuid: string
  video: Leaf & { videoUid: string }
  drill: Leaf
}

type Chapter = {
  chapterTitle: string
  nodeUuid: string
  subChapters: SubChapter[]
}

type CreatedCurriculum = {
  courseTitle: string
  nodeUuid: string
  chapters: Chapter[]
}

type SqlNode = {
  nodeUuid: string
  type: 2 | 3 | 4
  parentNodeUuid: string
  path: string
  level: 2 | 3 | 4
  refId: string | null
  passCondition: Record<string, unknown>
  title: string
  sortOrder: number
}

const sqlString = (value: string) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
const sqlNullableString = (value: string | null) => (value === null ? 'NULL' : sqlString(value))

function collectNodes(created: CreatedCurriculum): SqlNode[] {
  const nodes: SqlNode[] = []
  const rootPath = `/${created.nodeUuid}/`

  created.chapters.forEach((chapter, chapterIndex) => {
    nodes.push({
      nodeUuid: chapter.nodeUuid,
      type: 2,
      parentNodeUuid: created.nodeUuid,
      path: rootPath,
      level: 2,
      refId: null,
      passCondition: { type: 'all_children_passed' },
      title: chapter.chapterTitle,
      sortOrder: (chapterIndex + 9) * 10,
    })

    chapter.subChapters.forEach((subChapter, subChapterIndex) => {
      const chapterPath = `${rootPath}${chapter.nodeUuid}/`
      const leafPath = `${chapterPath}${subChapter.nodeUuid}/`

      nodes.push({
        nodeUuid: subChapter.nodeUuid,
        type: 2,
        parentNodeUuid: chapter.nodeUuid,
        path: chapterPath,
        level: 3,
        refId: null,
        passCondition: { type: 'all_children_passed' },
        title: subChapter.subChapterTitle,
        sortOrder: (subChapterIndex + 1) * 10,
      })
      nodes.push({
        nodeUuid: subChapter.video.nodeUuid,
        type: 3,
        parentNodeUuid: subChapter.nodeUuid,
        path: leafPath,
        level: 4,
        refId: subChapter.video.refId,
        passCondition: { type: 'video_progress', ratio: 0.9 },
        title: subChapter.video.title,
        sortOrder: 10,
      })
      nodes.push({
        nodeUuid: subChapter.drill.nodeUuid,
        type: 4,
        parentNodeUuid: subChapter.nodeUuid,
        path: leafPath,
        level: 4,
        refId: subChapter.drill.refId,
        passCondition: { type: 'drill_result', minAccuracy: 0 },
        title: subChapter.drill.title,
        sortOrder: 20,
      })
    })
  })

  return nodes
}

function indentList(values: readonly string[]): string {
  return values.map((value) => `  ${sqlString(value)}`).join(',\n')
}

async function main() {
  const createdPath = resolve(
    process.argv[2] ?? './workdir/learn-node/0914-second-phase-created.json'
  )
  const videoSqlPath = resolve(
    process.argv[3] ?? './workdir/learn-node/export_curriculum_pure_numeric.sql'
  )
  const outputPath = resolve(
    process.argv[4] ?? './workdir/learn-node/0914-second-phase-release.sql'
  )

  const createdFile = (await Bun.file(createdPath).json()) as
    CreatedCurriculum | CreatedCurriculum[]
  const created = Array.isArray(createdFile) ? createdFile[0] : createdFile
  if (!created) {
    throw new Error('创建结果为空')
  }
  const nodes = collectNodes(created)
  const expectedVideoCrossIds = new Set(
    created.chapters.flatMap((chapter) =>
      chapter.subChapters.map((subChapter) => subChapter.video.refId)
    )
  )
  const sourceVideoSql = await Bun.file(videoSqlPath).text()
  const videoInserts = sourceVideoSql
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('INSERT INTO `tb_video`'))
    .filter((line) => {
      const crossId = line.match(/VALUES \('([0-9]+)'/)?.[1]
      return crossId !== undefined && expectedVideoCrossIds.has(crossId)
    })

  if (created.chapters.length !== 6 || nodes.length !== 90) {
    throw new Error(`节点数量异常: chapters=${created.chapters.length}, nodes=${nodes.length}`)
  }
  if (videoInserts.length !== 28 || expectedVideoCrossIds.size !== 28) {
    throw new Error(
      `视频数量异常: inserts=${videoInserts.length}, crossIds=${expectedVideoCrossIds.size}`
    )
  }

  const idempotentVideoInserts = videoInserts.map((line) => {
    const insert = line.replace(/;\s*$/, '')
    return `${insert}\nON DUPLICATE KEY UPDATE\n  title=VALUES(title),\n  language=VALUES(language),\n  title_description=VALUES(title_description),\n  cover_id=VALUES(cover_id),\n  cover_url=VALUES(cover_url),\n  difficulty=VALUES(difficulty),\n  is_deleted=0,\n  primary_tags=VALUES(primary_tags),\n  secondary_tags=VALUES(secondary_tags),\n  video_duration=VALUES(video_duration),\n  video_size=VALUES(video_size),\n  video_uid=VALUES(video_uid),\n  updated_by_uuid=@actor_uuid;`
  })

  const nodeValues = nodes
    .map(
      (node) =>
        `(${sqlString(node.nodeUuid)},${node.type},${sqlString(node.parentNodeUuid)},${sqlString(node.path)},${node.level},${sqlNullableString(node.refId)},${sqlString(JSON.stringify(node.passCondition))},${sqlString(node.title)},'',1,0,0,${node.sortOrder},@actor_uuid,@published_at,0,@actor_uuid,@actor_uuid,@migration_time,@migration_time)`
    )
    .join(',\n')

  const nodeUuids = nodes.map((node) => node.nodeUuid)
  const videoCrossIds = [...expectedVideoCrossIds]
  const sql = `-- 核心决策训练：第二期（第 9～14 章）发布 SQL
-- 内容：28 个视频、90 个新增学习节点；不修改第一期节点。
-- 生成依据：${createdPath.replaceAll('\\', '/')}
-- 前置条件：课程根节点 ${created.nodeUuid} 及第一期节点已存在。
-- SQL 可重复执行；视频和学习节点均按唯一键更新，不会重复插入。

USE db_coach;

SET @course_root_uuid = ${sqlString(created.nodeUuid)};
SET @actor_uuid = '90362b6ba50f11f18d671ade68172c8f';
SET @published_at = FROM_UNIXTIME(1789454938);
SET @migration_time = CURRENT_TIMESTAMP;

START TRANSACTION;

-- 一、本期 28 个视频。重复执行时按 uk_cross_id 更新素材信息。
${idempotentVideoInserts.join('\n\n')}

-- 发布学习树要求视频资源处于可用状态。
UPDATE tb_video
SET status = 1,
    is_deleted = 0,
    published_by_uuid = COALESCE(NULLIF(published_by_uuid, ''), @actor_uuid),
    published_at = COALESCE(published_at, @published_at),
    updated_by_uuid = @actor_uuid
WHERE uk_cross_id IN (
${indentList(videoCrossIds)}
);

-- 二、新增并发布第 9～14 章的 90 个学习节点。
--     本 SQL 新增的 28 个 Drill 统一使用 {"type":"drill_result","minAccuracy":0}。
INSERT INTO tb_learn_node
  (node_uuid, type, parent_node_uuid, path, level, ref_id, pass_condition, title,
   description, status, explore_enabled, search_enabled, sort_order,
   published_by_uuid, published_at, is_deleted, created_by_uuid, updated_by_uuid,
   gmt_create, gmt_modified)
VALUES
${nodeValues}
ON DUPLICATE KEY UPDATE
  type=VALUES(type),
  parent_node_uuid=VALUES(parent_node_uuid),
  path=VALUES(path),
  level=VALUES(level),
  ref_id=VALUES(ref_id),
  pass_condition=VALUES(pass_condition),
  title=VALUES(title),
  description=VALUES(description),
  status=1,
  explore_enabled=VALUES(explore_enabled),
  search_enabled=VALUES(search_enabled),
  sort_order=VALUES(sort_order),
  published_by_uuid=@actor_uuid,
  published_at=@published_at,
  is_deleted=0,
  updated_by_uuid=@actor_uuid,
  gmt_modified=@migration_time;

COMMIT;

-- 三、执行后校验：依次应返回 1、28/28/28、90/90/90。
SELECT COUNT(*) AS course_root_count
FROM tb_learn_node
WHERE node_uuid = @course_root_uuid AND type = 1 AND is_deleted = 0;

SELECT COUNT(*) AS phase2_video_count,
       SUM(status = 1 AND is_deleted = 0) AS available_video_count,
       COUNT(DISTINCT video_uid) AS distinct_video_uid_count
FROM tb_video
WHERE uk_cross_id IN (
${indentList(videoCrossIds)}
);

SELECT COUNT(*) AS phase2_node_count,
       SUM(status = 1 AND is_deleted = 0) AS published_node_count,
       COUNT(DISTINCT node_uuid) AS distinct_node_uuid_count
FROM tb_learn_node
WHERE node_uuid IN (
${indentList(nodeUuids)}
);
`

  await Bun.write(outputPath, sql)
  console.log(
    JSON.stringify(
      {
        outputPath,
        courseRootUuid: created.nodeUuid,
        chapterCount: created.chapters.length,
        videoCount: videoInserts.length,
        nodeCount: nodes.length,
      },
      null,
      2
    )
  )
}

await main()
