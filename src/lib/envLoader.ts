import events from 'events'
import fs from 'fs'
import fsp from 'fs/promises'
import readline from 'readline'

export interface EnvParam {
  key: string
  value: string
  [key: string]: any
  isEncrypted?: boolean 
}

export async function readEnvFile(filename: string): Promise<EnvParam[]> {
  const aParams: EnvParam[] = []

  const rl = readline.createInterface({
    input: fs.createReadStream(filename),
  })

  rl.on('line', (line: string) => {
    const aLine = line.split('=')
    if (aLine.length === 2) {
      const key = aLine[0].trim()
      const valuePortion = aLine[1].split('#')
      const value = valuePortion[0].trim() // Remove comments if any
      const isEncrypted = valuePortion[1] ? valuePortion[1].trim().toLowerCase() === 'encrypted' : false
      aParams.push({
        key,
        value,
        isEncrypted
      })
    }
  })

  await events.once(rl, 'close')

  return aParams
}

export function loadParamsIntoEnv(params: EnvParam[]): void {
  params.forEach((param) => {
    process.env[param.key] = param.value
  })
}

export function remapKeys(params: EnvParam[], prefix: string, newPrefix: string): EnvParam[] {
  const aParams: EnvParam[] = []

  for (let i = 0; i < params.length; i++) {
    const param = params[i]
    let key = param.key

    if (key.startsWith(prefix)) {
      key = newPrefix + key.slice(prefix.length)
    }

    aParams.push({
      key: key,
      value: param.value
    })
  }

  return aParams
}

export function remapKeysInEnv(prefix: string, newPrefix: string, params?: EnvParam[]): EnvParam[] {
  if (!params) {
    params = []
    console.log('loading params from current env')
    for (const key in process.env) {
      params.push({
        key: key,
        value: process.env[key] as string
      })
    }
  }
  const newParams = remapKeys(params, prefix, newPrefix)
  loadParamsIntoEnv(newParams)
  return newParams
}

export async function loadFileIntoEnv(filename: string): Promise<void> {
  const params = await readEnvFile(filename)
  loadParamsIntoEnv(params)
}

export async function paramsToSourceFile(params: EnvParam[], filename: string): Promise<string> {
  const aParams: string[] = []

  params.forEach((param) => {
    aParams.push(`${param.key}=${param.value}${param.isEncrypted ? ' # encrypted' : ''}`)
  })

  const paramsToString = aParams.join('\n')
  await fsp.writeFile(filename, paramsToString)
  return paramsToString
}