import { BackendClient } from '../backend'
import { loadBackendConfig } from '../config'
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
