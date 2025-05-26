import fs from 'fs/promises'
import arg from 'arg'
import inquirer from 'inquirer'
import chalk from 'chalk'

import pkg from '../package.json'
import { envLoader, awsManager }  from './index'

interface Options {
  outfile?: string
  infile?: string
  oldprefix?: string
  newprefix?: string
  service?: string
  overwrite?: boolean
  encrypt?: boolean
  env?: string
  folder?: string
  help?: boolean
  command?: string
  commandFunc?: (options: any) => Promise<void> | void
  basepath?: string
  [key: string]: any
}

function parseArgumentsIntoOptions(rawArgs: string[]): Options {
  const args = arg({
    '--outfile': String,
    '--infile': String,
    '--oldprefix': String,
    '--newprefix': String,
    '--env': String,
    '--folder': String,
    '--service': String,
    '--overwrite': Boolean,
    '--encrypt': Boolean,
    '--help': Boolean,
    '--basepath': String,
    '-o': '--outfile',
    '-i': '--infile',
    '-e': '--env',
    '-f': '--folder',
    '-s': '--service',
    '-h': '--help',
    '-b': '--basepath'
   },{
    argv: rawArgs.slice(2),
    permissive: true
   }
  )

  return {
    outfile: args['--outfile'] || '',
    infile: args['--infile'] || '',
    oldprefix: args['--oldprefix'] || '',
    newprefix: args['--newprefix'] || '',
    service: args['--service'],
    overwrite: args['--overwrite'] || false,
    encrypt: args['--encrypt'] || false,
    env: args['--env'],
    folder: args['--folder'] || '',
    help: args['--help'] || false,
    command: args._[0] || '',
    basepath: args['--basepath'] || '',
  }
}

function displayHelp(): void {
  console.log(chalk.green.bgRed.bold('HJAAALP!'))
/*
{underline.green loadParamsIntoEnv:} load up parameters into the current process environment as env vars
    {bold.blue * --source:} aws || filename (default: aws)
*/
  console.log(chalk`
{bold.red COMMANDS:}
{underline.green remapKeysInEnv:} take {italic.red existing env vars} and remap them to {italic.red new env vars}. ie: {italic.blue DEV_AWS_ACCESS_KEY_ID} -> {italic.blue AWS_ACCESS_KEY_ID}
    {bold.blue * --outfile} file to save the new env vars to
    {bold.blue * --oldprefix} prefix to be replaced
    {bold.blue * --newprefix} prefix to replace with
    {bold.blue * --basepath} optional base path for parameter operations
{underline.green saveParamsFile:} save params to a file so that they can be loaded in another process via {italic.blue source} command
    {bold.blue * --outfile} file to save the aws env vars to
    {bold.blue * --env} aws application environment
    {bold.blue * --service} aws application service
    {bold.blue * --basepath} optional base path for parameter operations
{underline.green putToAWSFromFile:} save params from an env var file into AWS Parameter Store
    {bold.blue * --infile} file to read the env vars from
    {bold.blue * --env} aws application environment
    {bold.blue * --service} aws application service
    {bold.blue * --overwrite} optional flag to overwrite existing parameters
    {bold.blue * --encrypt} optional flag to encrypt the parameters
    {bold.blue * --basepath} optional base path for parameter operations
{underline.green exportAllParams:} export all parameters from AWS Parameter Store to hierarchical folders
    {bold.blue * --folder} folder to save parameters to
    {bold.blue * --env} optional aws application environment
    {bold.blue * --basepath} optional base path for parameter operations
`)
}

async function remapKeysInEnv(config: Options): Promise<void> {
  if (config.basepath) {
    awsManager.setBasePath(config.basepath)
  }
  console.log(chalk.green('Remapping keys in env'))
  const params = envLoader.remapKeysInEnv(config.oldprefix ?? '', config.newprefix ?? '')
  console.log(chalk.green(`Saving ${params.length} parameters to ${config.outfile}`))
  await envLoader.paramsToSourceFile(params, config.outfile ?? '.env')
  console.log(chalk.green(`Saved ${params.length} parameters to ${config.outfile}`))
}

async function saveParamsFile(config: Options): Promise<void> {
  if (config.basepath) {
    awsManager.setBasePath(config.basepath)
  }
  console.log(chalk.green('Saving params file'))
  const path = awsManager.constructParamPath(config.env ?? '', config.service ?? '')
  console.log(chalk.green(`saving '${path}' out to ${config.outfile}`))
  const results = await awsManager.getParametersByService(config.env ?? '', config.service ?? '', true)

  if (Object.keys(results)?.length > 0) {
    const params = Object.keys(results).map((key) => {
      const param = results[key]
      return { key: param.name, value: param.value }
    })

    await envLoader.paramsToSourceFile(params, config.outfile ?? '.env')
    console.log(chalk.green(`Saved ${Object.keys(results).length} parameters to ${config.outfile}`))
  } else {
    console.log(chalk.red('No parameters found'))
    throw new Error(chalk.red('No parameters found'))
  }
}

async function putToAWSFromFile(config: Options): Promise<void> {
  if (config.basepath) {
    awsManager.setBasePath(config.basepath)
  }
  const { env, service, overwrite, encrypt } = config
  const infile = config?.infile || '.env'
  console.log(chalk.green(`Reading params from file: ${infile}`))
  const params = await envLoader.readEnvFile(infile)
  params.forEach((param) => {
    param.canOverwrite = overwrite
    param.isEncrypted = encrypt
  })
  console.log(chalk.green(`Saving ${params.length} parameters to AWS for "/${env ?? ''}/${service ?? ''}"`))
  const results = await awsManager.setParametersByService(params, env ?? '', service ?? '')
  console.log(chalk.green(`Saved ${results.length} parameters to AWS for "/${env ?? ''}/${service ?? ''}"`))
}

async function exportAllParams(config: Options): Promise<void> {
  if (config.basepath) {
    awsManager.setBasePath(config.basepath)
  }
  const rootFolder = config?.folder || './params'
  await fs.mkdir(rootFolder, { recursive: true })
  let params: { [key: string]: any } = {}
  const allParams: { [key: string]: any } = await awsManager.getAllOrgParams(true)

  if (config?.env) {
    Object.keys(allParams).forEach((key) => {
      if (key === config.env) {
        console.log(`adding params for: ${key}`)
        params[key] = allParams[key]
      }
    })
  } else {
    params = allParams
  }

  // console.log(params)
  const envs = Object.keys(params)

  for (let i = 0; i < envs.length; ++i) {
    const env = envs[i]
    await fs.mkdir(`${rootFolder}/${env}`)
    const services = Object.keys(params[env])

    for (let j = 0; j < services.length; ++j) { 
      const service = services[j]
      const aEnvVars = []
      const vars = Object.keys(params[env][service])

      for (let k = 0; k < vars.length; ++k) {
        const key = vars[k]
        const param = params[env][service][key]
        aEnvVars.push(`${key}=${param.value}`)
      }

      console.log(`writing ${aEnvVars.length} params for ${env}/${service} to ${rootFolder}/${env}/${service}.env`)
      await fs.writeFile(`${rootFolder}/${env}/${service}.env`, aEnvVars.join('\n'))
    }
  }
 }

async function promptForMissingOptions(options: Options): Promise<Options> {
  let commandFunc = null

  const questions = []

  switch (options.command) {
    case 'remapKeysInEnv': {
      commandFunc = remapKeysInEnv

      if (!options.outfile) {
        questions.push({
          type: 'input',
          name: 'outfile',
          message: 'Output file: ',
          default: '.env',
        })
      }

      if (!options.oldprefix) {
        questions.push({
          type: 'input',
          name: 'oldprefix',
          message: 'Prefix to replace: ',
          default: 'DEV_',
        })
      }

      if (!options.newprefix) {
        questions.push({
          type: 'input',
          name: 'newprefix',
          message: 'Replacing previx (can be blank): ',
          default: '',
        })
      }

      if (!options.basepath) {
        questions.push({
          type: 'input',
          name: 'basepath',
          message: 'Base path (optional): ',
          default: '',
        })
      }
      break
    }
    case 'saveParamsFile': {
      commandFunc = saveParamsFile
      if (!options.outfile) {
        questions.push({
          type: 'input',
          name: 'outfile',
          message: 'Output file: ',
          default: '.env',
        })
      }
  
      if (!options.env) {
        questions.push({
          type: 'input',
          name: 'env',
          message: 'Environment: ',
          default: 'dev',
        })
      }

      if (!options.service) {
        questions.push({
          type: 'input',
          name: 'service',
          message: 'Service: ',
          default: '',
        })
      }

      if (!options.basepath) {
        questions.push({
          type: 'input',
          name: 'basepath',
          message: 'Base path (optional): ',
          default: '',
        })
      }
      break
    }
    case 'putToAWSFromFile': {
      commandFunc = putToAWSFromFile
      if (!options.infile) {
        questions.push({
          type: 'input',
          name: 'infile',
          message: 'Input file: ',
          default: '.env',
        })
      }

      if (!options.env) {
        questions.push({
          type: 'input',
          name: 'env',
          message: 'Environment: ',
          default: 'dev',
        })
      }

      if (!options.service) {
        questions.push({
          type: 'input',
          name: 'service',
          message: 'Service: ',
          default: '',
        })
      }

      if (!options.basepath) {
        questions.push({
          type: 'input',
          name: 'basepath',
          message: 'Base path (optional): ',
          default: '',
        })
      }
      break
    }
    case 'exportAllParams': {
      commandFunc = exportAllParams
      if (!options.folder) {
        questions.push({
          type: 'input',
          name: 'folder',
          message: 'Folder: ',
          default: './params',
        })
      }

      if (!options.basepath) {
        questions.push({
          type: 'input',
          name: 'basepath',
          message: 'Base path (optional): ',
          default: '',
        })
      }
      break
    }
    default: {
      commandFunc = displayHelp
      return { commandFunc }
    }
  }

  const answers = await inquirer.prompt(questions)
  return {
    ...options,
    outfile: options.outfile || answers.outfile,
    infile: options.infile || answers.infile,
    oldprefix: options.oldprefix || answers.oldprefix,
    newprefix: options.newprefix || answers.newprefix,
    source: options.source || answers.source,
    service: options.service || answers.service,
    env: options.env || answers.env,
    basepath: options.basepath || answers.basepath,
    commandFunc
  }
}

export async function cli(args: string[]): Promise<void> {
  console.log(chalk.green(`\n${pkg.name} v${pkg.version}`))
  let options = parseArgumentsIntoOptions(args)
  options = await promptForMissingOptions(options)

  if (options && typeof options.commandFunc === 'function') {
    await options.commandFunc(options)
  }
}