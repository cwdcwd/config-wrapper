import AWS from 'aws-sdk'
import { EnvParam } from './envLoader'

let ssm: AWS.SSM

let BASE_PATH: string | undefined = undefined

export function setBasePath(path: string) {
  BASE_PATH = path
}

const cachedParams: { [key: string]: any } = {}

function initializeSSM(): void {
  if (!ssm) {
    ssm = new AWS.SSM();
  }
}

export function constructParamPath(env?: string, service?: string, paramName?: string): string {
  const aPath: string[] = []

  if(BASE_PATH) {
    aPath.push(BASE_PATH)
  }

  if (env) {
    aPath.push(env)
  }

  if (service) {
    aPath.push(service)
  }

  const path = aPath.join('/')
// console.log(`Constructed parameter path: /${path}`)
  return `/${path}${paramName ? '/' + paramName : ''}`
}

function restructureParam(param: AWS.SSM.Parameter): any {
  const newParam = { 
    name: param.Name!.split('/').pop(), 
    fullName: param.Name,
    value: param.Value,
    version: param.Version,
    lastModifiedDate: param.LastModifiedDate,
    type: param.Type,
    isEncrypted: param.Type === 'SecureString',
  }
  return newParam
}

export async function getParameter(
  env: string,
  service: string,
  paramName: string,
  isEncrypted?: boolean
): Promise<any> {
  const Name = constructParamPath(env, service, paramName)
  const params = {
    Name,
    WithDecryption: isEncrypted
  };

  initializeSSM()

  const data = await ssm.getParameter(params).promise()
  return restructureParam(data?.Parameter!)
}

export async function getParametersByService(
  env: string,
  service: string,
  isEncrypted?: boolean
): Promise<{ [key: string]: any }> {
  const Path = constructParamPath(env, service)
  console.log(`Getting parameters from ${Path}`)

  if (cachedParams[Path]) {
    console.log('Found parameters in cache. Returning...')
    return cachedParams[Path]
  }

  const config: AWS.SSM.GetParametersByPathRequest = {
    Path,
    Recursive: true,
    WithDecryption: isEncrypted
  };

  const convertedParams: { [key: string]: any } = {}
  let nextToken: string | undefined = undefined

  initializeSSM()

  do {
    let params = await ssm.getParametersByPath(config).promise()

    for (let i = 0; i < params.Parameters!.length; i++) {
      const param = restructureParam(params.Parameters![i])
      convertedParams[param.name] = param
    }

    nextToken = params.NextToken
    config.NextToken = nextToken
  } while (nextToken)

  cachedParams[Path] = convertedParams

  return convertedParams
}

export async function setParameter(
  param: EnvParam,
  env: string,
  service: string,
  isEncrypted?: boolean,
  canOverwrite?: boolean
): Promise<AWS.SSM.PutParameterResult> {
  const Name = constructParamPath(env, service, param.key)
  const Value = param.value
  const params: AWS.SSM.PutParameterRequest = {
    Name,
    Value,
    Type: isEncrypted ? 'SecureString' : 'String',
    Overwrite: canOverwrite
  };
  initializeSSM()

  const data = await ssm.putParameter(params).promise()
  console.log(data)
  return data
}

export async function setParametersByService(
  params: EnvParam[],
  env: string,
  service: string
): Promise<any[]> {
  const data: any[] = [] 

  for (let i = 0; i < params.length; i++) {
    const result = setParameter(params[i], env, service, params[i]?.isEncrypted, params[i]?.canOverwrite)
    data.push(result)
  }

  return data
}

export async function getEnvironments(): Promise<{ [env: string]: number }> {
  console.log(`Getting environments descending from ${BASE_PATH}`)
  const config: AWS.SSM.GetParametersByPathRequest = {
    Path: BASE_PATH ?? '/',
    Recursive: true
  };

  const envs: { [env: string]: number } = {}
  let nextToken: string | undefined = undefined

  initializeSSM()

  do {
    let params = await ssm.getParametersByPath(config).promise()

    for (let i = 0; i < params.Parameters!.length; i++) {
      const param = params.Parameters![i]
      const name = param.Name!.split('/')
      const env = name[2]
      envs[env] = envs[env] ? envs[env] + 1 : 1
    }

    nextToken = params.NextToken
    config.NextToken = nextToken
  } while (nextToken)

  return envs
}

export async function getServicesForEnvironment(env: string): Promise<{ [svc: string]: number }> {
  const Path = BASE_PATH + '/' + env
  console.log(`Getting services descending from the environment ${Path}`)
  const config: AWS.SSM.GetParametersByPathRequest = {
    Path,
    Recursive: true
  };

  const svcs: { [svc: string]: number } = {}
  let nextToken: string | undefined = undefined

  initializeSSM()

  do {
    let params = await ssm.getParametersByPath(config).promise()

    for (let i = 0; i < params.Parameters!.length; i++) {
      const param = params.Parameters![i]
      const name = param.Name!.split('/')
      const svc = name[3]
      svcs[svc] = svcs[svc] ? svcs[svc] + 1 : 1
    }

    nextToken = params.NextToken
    config.NextToken = nextToken
  } while (nextToken)

  return svcs
}

export async function getAllOrgParams(isEncrypted?: boolean): Promise<any> {
  console.log(`Getting all parameters under ${BASE_PATH}`)
  const config: AWS.SSM.GetParametersByPathRequest = {
    Path: BASE_PATH ?? '/',
    Recursive: true,
    WithDecryption: isEncrypted
  };

  const convertedParams: any = {}
  let nextToken: string | undefined = undefined

  initializeSSM()

  do {
    let params = await ssm.getParametersByPath(config).promise()

    for (let i = 0; i < params.Parameters!.length; i++) {
      const param = restructureParam(params.Parameters![i])
      const name = params.Parameters![i].Name!.split('/')

      if (!convertedParams[name[2]]) {
        convertedParams[name[2]] = {}
      }

      if (!convertedParams[name[2]][name[3]]) {
        convertedParams[name[2]][name[3]] = {}
      }

      convertedParams[name[2]][name[3]][param.name] = param
    }

    nextToken = params.NextToken
    config.NextToken = nextToken
  } while (nextToken)

  return convertedParams
}
