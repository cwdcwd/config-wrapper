import fs from 'fs/promises'
import { envLoader, awsManager } from '../src/index'
const envFile = './__tests__/.env'

// Mock AWS SSM so tests run without real AWS credentials
jest.mock('aws-sdk', () => {
  // Store the params passed to each SSM method so .promise() can use them
  let lastGetParamArgs: any = null;
  let lastGetByPathArgs: any = null;
  let lastPutParamArgs: any = null;

  const mockSSM = {
    getParameter: jest.fn().mockImplementation((...args: any[]) => {
      lastGetParamArgs = args[0];
      return { promise: () => mockSSM._resolveGetParameter() };
    }),
    getParametersByPath: jest.fn().mockImplementation((...args: any[]) => {
      lastGetByPathArgs = args[0];
      return { promise: () => mockSSM._resolveGetParametersByPath() };
    }),
    putParameter: jest.fn().mockImplementation((...args: any[]) => {
      lastPutParamArgs = args[0];
      return { promise: () => mockSSM._resolvePutParameter() };
    }),
    // Internal resolvers — will be configured in setupSSMMocks
    _resolveGetParameter: jest.fn(),
    _resolveGetParametersByPath: jest.fn(),
    _resolvePutParameter: jest.fn(),
    // Expose last captured args for assertions
    _lastGetParamArgs: () => lastGetParamArgs,
    _lastGetByPathArgs: () => lastGetByPathArgs,
    _lastPutParamArgs: () => lastPutParamArgs,
  };

  return {
    SSM: jest.fn().mockImplementation(() => mockSSM),
    _mockSSM: mockSSM,
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { _mockSSM } = require('aws-sdk') as any;

const testBasePath = 'testorg'

function makeSSMParam(name: string, value: string, type: string = 'String') {
  return {
    Name: `/${testBasePath}/test/config-wrapper/${name}`,
    Value: value,
    Version: 1,
    LastModifiedDate: new Date(),
    Type: type,
  };
}

const ssmParams = [
  makeSSMParam('testParam01', 'value01'),
  makeSSMParam('testParam02', 'value02'),
  makeSSMParam('secretParam01', 'secretValue01', 'SecureString'),
  makeSSMParam('testParam03', 'value03'),
];

function setupSSMMocks() {
  awsManager.setBasePath(testBasePath)

  _mockSSM._resolveGetParameter.mockImplementation(() => {
    const params = _mockSSM._lastGetParamArgs();
    const found = ssmParams.find(p => p.Name === params.Name);
    if (found) {
      return Promise.resolve({ Parameter: found });
    }
    return Promise.reject(new Error(`Parameter not found: ${params.Name}`));
  });

  _mockSSM._resolveGetParametersByPath.mockImplementation(() => {
    const params = _mockSSM._lastGetByPathArgs();
    const path = params.Path;
    // Normalize: ensure leading / for consistent matching
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    let filtered: any[];

    if (normalizedPath === `/${testBasePath}` || normalizedPath === '/') {
      filtered = ssmParams;
    } else {
      filtered = ssmParams.filter(p => p.Name.startsWith(normalizedPath));
    }

    return Promise.resolve({ Parameters: filtered, NextToken: undefined });
  });

  _mockSSM._resolvePutParameter.mockResolvedValue({
    Tier: 'Standard',
    Version: 1,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  awsManager.clearCache();
  setupSSMMocks();
});

describe('envLoader', () => {
  const params = [
    { key: 'key01', value: 'value01', isEncrypted: false },
    { key: 'key02', value: 'value02', isEncrypted: false },
    { key: 'key03', value: 'value03', isEncrypted: true }
  ]

  describe('paramsToSourceFile', () => {
    it('should save array to file in sorted order', async () => {
      const parmsToString = await envLoader.paramsToSourceFile(params, envFile)
      const fileData = await fs.readFile(envFile, 'utf8')
      expect(fileData).toEqual(parmsToString)
      const aParams = fileData.split('\n')

      // Assert alphabetical order by key
      const sortedKeys = [...params].sort((a, b) => a.key.localeCompare(b.key, 'en'))
      for (let i = 0; i < aParams.length; i++) {
        const aLine = aParams[i].split('=')
        expect(aLine[0]).toEqual(sortedKeys[i].key)
        // Value portion may include '# encrypted' comment — compare only the value part
        const valuePortion = aLine.slice(1).join('=').split('#')
        expect(valuePortion[0].trim()).toEqual(sortedKeys[i].value)
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

  describe('sortParams', () => {
    it('should sort params alphabetically by key', () => {
      const unsortedParams = [
        { key: 'ZEBRA', value: 'z' },
        { key: 'ALPHA', value: 'a' },
        { key: 'MIDDLE', value: 'm' }
      ]
      const sorted = envLoader.sortParams(unsortedParams)
      expect(sorted[0].key).toEqual('ALPHA')
      expect(sorted[1].key).toEqual('MIDDLE')
      expect(sorted[2].key).toEqual('ZEBRA')
    })

    it('should sort by value as secondary criterion when keys are equal', () => {
      const duplicateKeyParams = [
        { key: 'SAME', value: 'charlie' },
        { key: 'SAME', value: 'alpha' },
        { key: 'SAME', value: 'bravo' }
      ]
      const sorted = envLoader.sortParams(duplicateKeyParams)
      expect(sorted[0].value).toEqual('alpha')
      expect(sorted[1].value).toEqual('bravo')
      expect(sorted[2].value).toEqual('charlie')
    })

    it('should not mutate the original array', () => {
      const original = [
        { key: 'Z', value: 'z' },
        { key: 'A', value: 'a' }
      ]
      const sorted = envLoader.sortParams(original)
      expect(original[0].key).toEqual('Z')
      expect(sorted[0].key).toEqual('A')
    })

    it('should preserve isEncrypted flag after sorting', () => {
      const mixedParams = [
        { key: 'Z_KEY', value: 'z', isEncrypted: true },
        { key: 'A_KEY', value: 'a' },
        { key: 'M_KEY', value: 'm', isEncrypted: true }
      ]
      const sorted = envLoader.sortParams(mixedParams)
      expect(sorted[0]).toEqual({ key: 'A_KEY', value: 'a' })
      expect(sorted[1]).toEqual({ key: 'M_KEY', value: 'm', isEncrypted: true })
      expect(sorted[2]).toEqual({ key: 'Z_KEY', value: 'z', isEncrypted: true })
    })
  })

  describe('paramsToSourceFile sorting', () => {
    it('should sort params alphabetically by key before writing', async () => {
      const unsortedParams = [
        { key: 'ZEBRA', value: 'z' },
        { key: 'ALPHA', value: 'a' },
        { key: 'MIDDLE', value: 'm' }
      ]
      const result = await envLoader.paramsToSourceFile(unsortedParams, envFile)
      const lines = result.split('\n')
      expect(lines[0]).toEqual('ALPHA=a')
      expect(lines[1]).toEqual('MIDDLE=m')
      expect(lines[2]).toEqual('ZEBRA=z')
    })

    it('should sort by value as secondary criterion when keys are equal', async () => {
      const duplicateKeyParams = [
        { key: 'SAME', value: 'charlie' },
        { key: 'SAME', value: 'alpha' },
        { key: 'SAME', value: 'bravo' }
      ]
      const result = await envLoader.paramsToSourceFile(duplicateKeyParams, envFile)
      const lines = result.split('\n')
      expect(lines[0]).toEqual('SAME=alpha')
      expect(lines[1]).toEqual('SAME=bravo')
      expect(lines[2]).toEqual('SAME=charlie')
    })

    it('should preserve isEncrypted flag after sorting', async () => {
      const mixedParams = [
        { key: 'Z_KEY', value: 'z', isEncrypted: true },
        { key: 'A_KEY', value: 'a' },
        { key: 'M_KEY', value: 'm', isEncrypted: true }
      ]
      const result = await envLoader.paramsToSourceFile(mixedParams, envFile)
      const lines = result.split('\n')
      expect(lines[0]).toEqual('A_KEY=a')
      expect(lines[1]).toEqual('M_KEY=m # encrypted')
      expect(lines[2]).toEqual('Z_KEY=z # encrypted')
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
    { key: 'secretParam01', value: 'secretValue01', isEncrypted: true },
    { key: 'testParam03', value: 'value03' },
  ]

  describe('setParameter', () => {
    it('should set a parameter', async () => {
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
      expect(envs.test).toBeDefined()
      expect(envs.test).toEqual(ssmParams.length)
    })
  })

  describe('getServicesForEnvironment', () => {
    it('should get all the services in an environment', async () => {
      const svcs = await awsManager.getServicesForEnvironment('test')
      expect(svcs['config-wrapper']).toBeDefined()
      expect(svcs['config-wrapper']).toEqual(ssmParams.length)
    })
  })

  describe('getAllOrgParams', () => {
    it('should get all the org parameters', async () => {
      const params = await awsManager.getAllOrgParams()
      expect(params.test).toBeDefined()
      expect(params.test['config-wrapper']).toBeDefined()
      expect(Object.keys(params.test['config-wrapper'])).toHaveLength(ssmParams.length)
      expect(params.test['config-wrapper']).toHaveProperty('testParam01')
      expect(params.test['config-wrapper']).toHaveProperty('secretParam01')
    })
  })
})

afterAll(() => {
  console.log('afterAll called')
  fs.unlink(envFile)
})
