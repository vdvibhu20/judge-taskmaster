import config = require('../../../config.js')
import { cat, ls, mkdir, exec } from 'shelljs'
import { SubmitJob } from 'tasks/job'
import { SubmissionResult } from 'types/result'
import * as path from 'path'
import * as fs from 'fs'
import { Scenario } from 'tasks/scenario'
import { download } from 'utils/request'

export default class SubmissionScenario extends Scenario {
  setup(currentJobDir: string, job: SubmitJob) {
    const LANG_CONFIG = config.LANGS[job.lang]

    fs.writeFileSync(path.join(currentJobDir, LANG_CONFIG.SOURCE_FILE),
      (new Buffer(job.source, 'base64')).toString('ascii'))
    const testCasesDir = path.join(currentJobDir, 'testcases')
    mkdir('-p', testCasesDir)

    return Promise.all(job.testcases.map(testcase => {
      const rootDir = path.join(testCasesDir, '' + testcase.id)
      mkdir('-p', rootDir)      
      return download(testcase.input, path.join(rootDir, 'stdin'))
    }))
  }

  async result(currentJobDir: string, job: SubmitJob): Promise<SubmissionResult> {
    // Check for compile_stderr if can't find a stdout file ; stdout can be ''
    const compile_stderr = cat(path.join(currentJobDir, 'compile.stderr')).toString()

    if (compile_stderr) {
      return {
        id: job.id,
        stderr: (new Buffer(compile_stderr)).toString('base64'),
        testcases: []
      }
    }

    await Promise.all(job.testcases.map(async testcase => {
      const rootDir = path.join(currentJobDir, 'testcases', '' + testcase.id)
      return download(testcase.output, path.join(rootDir, 'stdout'))
    }))

    const testcases = ls(path.join(currentJobDir, 'testcases')).map(testcase => {
      const currentTestcasePath = path.join(currentJobDir, 'testcases', testcase)

      const stderr = cat(path.join(currentTestcasePath, 'run.stderr')).toString()
      const time = cat(path.join(currentTestcasePath, 'runguard.time')).toString().trim()
      const code = cat(path.join(currentTestcasePath, 'runguard.code')).toString()

      const runOutputFile = path.join(currentTestcasePath, 'run.stdout')
      const expectedOutputFile = path.join(currentTestcasePath, 'stdout')

      const diff = exec(`
        diff -b -a ${runOutputFile} ${expectedOutputFile}
      `)
      const score = diff.code === 0 ? 100 : 0

      const result = new Array(
        +code === 143 && "TLE",
        +code === 137 && "MLE",
        +code !== 0 && "Run Error",
        +code === 0 && score === 0 && "Wrong Answer",
        +code === 0 && "Success"
      ).reduce((acc, cur) => acc || cur)

      return {
        id: +testcase,
        time,
        result,
        score
      }
    })

    return {
      id: job.id,
      stderr: (new Buffer(compile_stderr)).toString('base64'),
      testcases
    }
  }
}
