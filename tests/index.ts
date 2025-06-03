import fs from 'fs/promises'
import { envLoader, awsManager } from '../src/index'
const envFile = './tests/.env'

describe('envLoader', () => {
  const params = [
    { key: 'key01', value: 'value01' },
    { key: 'key02', value: 'value02' },
    { key: 'key03', value: 'value03', isEncrypted: true }
  ]

  describe('paramsToSourceFile', () => {
    it('should save array to file', async () => {
      const parmsToString = await envLoader.paramsToSourceFile(params, envFile)
      const fileData = await fs.readFile(envFile, 'utf8')
      expect(fileData).toEqual(parmsToString)
      const aParams = fileData.split('\n')

      for (let i = 0; i < aParams.length; i++) {
        const aLine = aParams[i].split('=')
        expect(aLine[0]).toEqual(params[i].key)
        expect(aLine[1]).toEqual(params[i].value)
      }
    })
  })

  describe('readEnvFile', () => {
    it('should read a file and return array of values', async () => {
      const fileParams = await envLoader.readEnvFile(envFile)
      expect(fileParams).toEqual(params)
    })
  })

  describe('loadParamsIntoEnv', () => {
    it('should load array into process.env ', () => {
      for (let i = 0; i < params.length; i++) {
        expect(process.env).not.toHaveProperty(params[i].key)
      }

      envLoader.loadParamsIntoEnv(params)

      for (let i = 0; i < params.length; i++) {
        expect(process.env[params[i].key]).toEqual(params[i].value)
      }
    })
  })

  describe('remapKeys', () => {
    it('should remap keys', () => {
      const testParams = [
        { key: 'new_key_01', value: 'value01' },
        { key: 'new_key_02', value: 'value02' },
        { key: 'new_key_03', value: 'value03' }
      ]
      const remapped = envLoader.remapKeys(params, 'key', 'new_key_')
      expect(remapped).toEqual(testParams)
    })
  })

  describe('remapKeysInEnv', () => {
    it('should remap keys in the env', () => {
      const testParams = [
        { key: 'new_key_01', value: 'value01' },
        { key: 'new_key_02', value: 'value02' },
        { key: 'new_key_03', value: 'value03' }
      ]
      const testParams2 = [
        { key: 'key_01', value: 'value01' },
        { key: 'key_02', value: 'value02' },
        { key: 'key_03', value: 'value03' }
      ]

      const remapped = envLoader.remapKeysInEnv('key', 'new_key_', params)
      expect(remapped).toEqual(testParams)

      for (let i = 0; i < testParams.length; i++) {
        expect(process.env[testParams[i].key]).toEqual(testParams[i].value)
      }

      envLoader.remapKeysInEnv('new_', '')
      for (let i = 0; i < testParams2.length; i++) {
        expect(process.env[testParams2[i].key]).toEqual(testParams2[i].value)
      }
    })
  })

  describe('loadFileIntoEnv', () => {
    it('should read & load a file into process.env', async () => {
      await envLoader.loadFileIntoEnv(envFile)

      for (let i = 0; i < params.length; i++) {
        expect(process.env[params[i].key]).toEqual(params[i].value)
      }
    })
  })
})

describe('awsManager', () => {
  const env = 'test'
  const service = 'config-wrapper'
  const aParams = [
    { key: 'testParam01', value: 'value01', canOverwrite: true },
    { key: 'testParam02', value: 'value02' },
    { key: 'secretParam01', value: 'secretValue01', isEncrypted: true }
  ]

  describe('setParameter', () => {
    it('should set a parameter', async () => {
      aParams.push({ key: 'testParam03', value: 'value03' })
      const param = await awsManager.setParameter(aParams[3], env, service, false, true)
      expect(param.Tier).toEqual('Standard')
      expect(param.Version).toBeGreaterThanOrEqual(1)
    })
  })

  describe('setParametersByService', () => { 
    it('should set parameters by service', async () => {
      const params = await awsManager.setParametersByService(aParams, env, service)
      expect(params).toHaveLength(aParams.length)
    })
  })

  describe('getParameter', () => {
    it('should get a parameter from AWS', async () => {
      const param = await awsManager.getParameter(env, service, aParams[0].key)
      expect(param.value).toEqual(aParams[0].value)
    })
  })

  describe('getParameter with secret', () => {
    it('should get a secret parameter from AWS', async () => {
      const param = await awsManager.getParameter(env, service, aParams[2].key, true)
      expect(param.value).toEqual(aParams[2].value)
    })
  })

  describe('getParametersByService', () => {
    it('should get all the parameters by env and service', async () => {
      const params = await awsManager.getParametersByService(env, service, true)
      console.log(params)
      for (let i = 0; i < aParams.length; i++) {
        const found = params[aParams[i].key]

        expect(found).toBeDefined()
        expect(found.value).toEqual(aParams[i].value)
      }
    })
  })

  describe('getEnvironments', () => {
    it('should get all the environments', async () => {
      const envs = await awsManager.getEnvironments()
      console.log(envs)
      expect(envs.test).toBeDefined()
      expect(envs.test).toEqual(4)
    })
  })

  describe('getServicesForEnvironment', () => {
    it('should get all the services in an environment', async () => {
      const svcs = await awsManager.getServicesForEnvironment('test')
      console.log(svcs)
      expect(svcs['config-wrapper']).toBeDefined()
      expect(svcs['config-wrapper']).toEqual(4)
    })
  })

  describe('getAllOrgParams', () => {
    it('should get all the org parameters', async () => {
      const params = await awsManager.getAllOrgParams()
      console.log(params)
      expect(params.test).toBeDefined()
      expect(params.test['config-wrapper']).toBeDefined()
      expect(Object.keys(params.test['config-wrapper'])).toHaveLength(4)
      expect(params.test['config-wrapper']).toHaveProperty('testParam01')
      expect(params.test['config-wrapper']).toHaveProperty('secretParam01')
    })
  })
})

afterAll(() => {
  console.log('afterAll called')
  fs.unlink(envFile)
})
