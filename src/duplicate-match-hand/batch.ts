import { BackendClient } from '../backend'
import { loadBackendConfig } from '../config'
import { loadDataServicesConfig } from '../config'
import { DataServicesHandsClient } from './data-services-client'
import { GameHandHistoryClient } from './game-hand-history-client'
import { fetchGameHandHistoryResults, fetchHandDataServicesResults } from './result-fetcher'
import { readHandTableIdCsv } from './table-id-store'
import { uploadDuplicateMatchHandCases } from './uploader'
import { readDuplicateMatchHandCaseFile, resolveDuplicateMatchHandPaths } from './workspace'

/** 读取已生成的 Case 文件，并使用管理端接口完成手牌和活动发布。 */
export async function uploadGeneratedDuplicateMatchHandCases(workDir: string) {
  const manifest = await readDuplicateMatchHandCaseFile(workDir)
  const paths = resolveDuplicateMatchHandPaths(workDir)
  const result = await uploadDuplicateMatchHandCases(
    manifest.cases,
    new BackendClient(loadBackendConfig()),
    { statePath: paths.statePath }
  )
  return { ...result, casesPath: paths.casesPath, statePath: paths.statePath }
}

/** 读取 tableId CSV，批量下载 Data Services 原始响应并按 caseId 保存。 */
export async function fetchGeneratedHandResults(workDir: string) {
  const manifest = await readDuplicateMatchHandCaseFile(workDir)
  const paths = resolveDuplicateMatchHandPaths(workDir)
  const rows = await readHandTableIdCsv(paths.tableIdsPath)
  const config = loadDataServicesConfig()
  const gameHandHistory = await fetchGameHandHistoryResults(
    rows,
    manifest.cases,
    new GameHandHistoryClient(config),
    { resultsDir: paths.gameHandHistoryResultsDir }
  )
  const dataServices = await fetchHandDataServicesResults(
    rows,
    manifest.cases,
    new DataServicesHandsClient(config),
    { resultsDir: paths.dataServicesResultsDir }
  )
  return {
    gameHandHistory,
    dataServices,
    gameHandHistoryResultsDir: paths.gameHandHistoryResultsDir,
    dataServicesResultsDir: paths.dataServicesResultsDir,
  }
}
