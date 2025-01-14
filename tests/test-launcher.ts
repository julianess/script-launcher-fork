import * as launcher from '../src/launch';
import { ConsoleInterceptor, IIntercepted } from './console-interceptor';
import * as fs from 'fs';
import * as path from 'path';
import { MarkdownParser, SectionType } from './markdown-parser';
import { IConfig } from '../src/config-loader';
import { version } from '../src/package.json';

export interface ITests {
  id: string;
  name: string;
  error?: string;
  arguments: string[];
  processArgv: string[];
  files: string[];
  lifecycle?: string;
  result?: string[];
  restore: boolean;
  empty?: boolean;
}

interface ITestsConfigFile {
  name: string;
  error?: string;
  arguments: string[] | string;
  processArgv: string[] | string;
  files: string[] | string;
  lifecycle?: string;
  restore?: boolean;
  result: string[];
}

export type TransformCallback = (name: string, config: IConfig) => IConfig;

export interface ITestConfig {
  id: string;
  sanitize: boolean;
  name: string;
  type: SectionType;
  transformer?: string;
  files: { [name: string]: IConfig };
  tests: ITests[];
}

export class TestLauncher {
  private readonly _configs: { [name: string]: ITestConfig[] };

  public get configs(): Array<[string, ITestConfig[]]> {
    return Object.entries(this._configs);
  }

  public constructor(private readonly tempPath: string, private readonly excludes: string[] = []) {
    this._configs = {};

    fs.mkdirSync(tempPath, {
      recursive: true
    });

    for (const directory of fs.readdirSync(tempPath)) {
      const fullDirectoryName = path.join(tempPath, directory);

      for (const file of fs.readdirSync(fullDirectoryName)) {
        const fullFileName = path.join(fullDirectoryName, file);
        fs.unlinkSync(fullFileName);
      }
    }
  }

  public async launch(directory: string, processArgv: string[], envVariables: { [key: string]: string }): Promise<IIntercepted> {
    const testDirectory = path.join(this.tempPath, directory).replace(process.cwd(), '.');
    const interceptor = new ConsoleInterceptor(this.excludes);

    // Expanding environment variables to use
    envVariables = {
      ...envVariables,
      'npm_config_directory': testDirectory
    };

    try {
      await launcher.main(processArgv, envVariables, true);

      // await promisify(setImmediate)(); // Process all events in event queue, to flush the out streams.
      // await promisify(setTimeout)(10);
      // await promisify(setImmediate)();
    } finally {
      interceptor.close();
    }

    return interceptor;
  }

  public loadConfig(testFiles: string): void {
    const files = fs.readdirSync(testFiles);
    const result = this._configs;
    let autoId = 0;

    for (const file of files) {
      if (file.endsWith('.test.json') && !file.endsWith('launcher-config.json')) {
        const fileName = path.join(testFiles, file);
        const content = fs.readFileSync(fileName);
        const configs = JSON.parse(content.toString()) as { [name: string]: ITestConfig[] };

        // update and add auto id's
        for (const testConfigs of Object.values(configs)) {
          for (let configIndex = 0; configIndex < testConfigs.length; configIndex++) {
            testConfigs[configIndex] = {
              ...{ id: '0000' },
              ...testConfigs[configIndex]
            };

            const testConfig = testConfigs[configIndex];

            testConfig.id = (autoId++).toString().padStart(4, '0');

            for (let testIndex = 0; testIndex < testConfig.tests.length; testIndex++) {
              testConfig.tests[testIndex] = {
                ...{ id: '0000' },
                ...testConfig.tests[testIndex]
              };

              testConfig.tests[testIndex].id = testConfig.id + '-' + testIndex.toString().padStart(2, '0');
            }
          }
        }

        fs.writeFileSync(fileName, JSON.stringify(configs, null, 2) + '\n');

        for (const [name, testConfigs] of Object.entries(configs)) {
          if (result[name] === undefined) result[name] = [];

          for (const testConfig of testConfigs) {
            if (testConfig.tests === undefined) testConfig.tests = [];

            for (const test of testConfig.tests as ITestsConfigFile[]) {
              if (test.arguments === undefined) test.arguments = [];
              if (test.processArgv === undefined) test.processArgv = [];
              if (test.files === undefined) test.files = [];
              if (test.restore === undefined) test.restore = false;

              if (!Array.isArray(test.arguments)) test.arguments = [test.arguments];
              if (!Array.isArray(test.processArgv)) test.processArgv = [test.processArgv];
              if (!Array.isArray(test.files)) test.files = [test.files];

              if (test.files.length > 0) {
                if (test.lifecycle !== undefined) test.error = 'files and lifecycle can not be combined';
                if (test.arguments.length > 0) test.error = 'files and arguments can not be combined';
                if (test.processArgv.length > 0) test.error = 'files and processArgs can not be combined';
              }

              // Preparing name of the test case
              if (!test.name) {
                // Concat the launch command with the processArgv given
                test.name = 'npx launch ' + test.processArgv.join(' ');

                // Concat any additional arguments to the name itself (e.g. --dry, --params, ...)
                if (test.arguments.length > 0) {
                  test.name += ' ' + test.arguments.join(' ');
                }

                if (test.lifecycle) {
                  test.name = 'npm ';

                  if (test.lifecycle !== 'start') test.name += 'run   ';

                  test.name += (test.lifecycle + ' ' + test.processArgv.join(' ')).trim();
                }

                if (test.files.length > 0) {
                  test.name = 'files ' + test.files.join(' ');
                }
              }
            }
          }

          result[name].push(...testConfigs);
        }
      }
    }
  }

  public prepareTests(): void {
    for (const testConfigs of Object.values(this._configs)) {
      for (const testConfig of testConfigs) {
        if (testConfig.tests === undefined) testConfig.tests = [];

        for (const test of testConfig.tests as ITestsConfigFile[]) {
          if (test.result) {
            let result = test.result;

            if (test['result:' + process.platform] !== undefined) result = test['result:' + process.platform];

            if (!Array.isArray(result) && result !== undefined) result = [result];

            for (let index = 0; index < result.length; index++) {
              (result as string[])[index] = TestLauncher.expandEnvironment(result[index], {
                id: testConfig.id,
                version: version,
                node_version: process.version.replace(/^v/, ''),
                platform: process.platform
              });
            }

            test.result = result;
          }
        }
      }
    }
  }

  public loadMarkdown(testFiles: string, category: string, exclude: string[] = []): void {
    const markdownParser = new MarkdownParser(testFiles, exclude);
    const sections = markdownParser.getSectionTests();
    const emptyTest: ITests = {
      id: '9999',
      name: 'empty',
      processArgv: [],
      arguments: [],
      files: [],
      restore: false,
      empty: true
    };
    let configs = this._configs[category];

    if (configs === undefined) {
      configs = [];
      this._configs[category] = configs;
    }

    for (const section of sections) {
      let config = configs.find(config => config.name === section.title);

      if (config === undefined) {
        config = {
          id: '9999',
          sanitize: false,
          name: section.title,
          type: section.type,
          files: {},
          tests: []
        };

        configs.push(config);
      }

      config.type = section.type;

      if (section.commands.length === 0) {
        config.tests = [
          {
            ...emptyTest,
            name: 'Missing command',
            error: 'Markdown section is missing test commands!'
          }
        ];
        continue;
      }

      if (section.error) {
        config.tests = [];
        for (const command of section.commands) {
          config.tests.push({
            ...emptyTest,
            name: command,
            error: section.error
          });
        }
        continue;
      }

      if (config.tests.filter(item => !item.empty).length > 0) {
        let testIndex = 0;

        for (const command of section.commands) {
          const test = config.tests.find(test => test.name === command);

          if (!test) {
            config.tests.push({
              ...emptyTest,
              name: command,
              error: 'Markdown example is missing test command: ' + command
            });
          } else {
            if (section.result !== null) {
              if (test.result) {
                test.error = 'This markdown test should not have result content!';
                continue;
              }
              test.result = section.result[testIndex];

              if (testIndex < section.result.length - 1) testIndex++;
            }
          }
        }
      } else {
        for (const command of section.commands) {
          config.tests.push({
            ...emptyTest,
            name: command
          });
        }
      }

      if (config.files !== undefined && config.files['launcher-config'] !== undefined && section.config !== null) {
        for (const test of config.tests) {
          test.error = 'This markdown test should not have "launcher-config" file content!';
        }
        continue;
      }

      config.files = { ...config.files };

      if (section.config) config.files['launcher-config'] = section.config;
    }
  }

  public transformConfigs(transforms: { [name: string]: TransformCallback }): void {
    for (const [name, configs] of Object.entries(this._configs)) {
      for (const testConfig of configs) {
        if (testConfig.transformer) {
          const transform = transforms[testConfig.transformer];

          if (!transform) {
            for (const test of testConfig.tests) {
              if (!test.error) test.error = 'Transform not found: ' + testConfig.transformer;
            }
            continue;
          }

          if (!testConfig.files) {
            for (const test of testConfig.tests) {
              if (!test.error) test.error = 'No files to transform: ' + testConfig.transformer;
            }
            continue;
          }

          for (const [name, config] of Object.entries(testConfig.files)) {
            try {
              transform(name, config);
            } catch (error) {
              for (const test of testConfig.tests) {
                if (!test.error) test.error = 'Transform error: ' + error.message;
              }
              break;
            }
          }
        }
      }
    }
  }

  public create(directory: string, files: { [name: string]: IConfig }): void {
    const testDirectory = path.join(this.tempPath, directory);

    fs.mkdirSync(testDirectory, {
      recursive: true
    });

    this.deleteFiles(testDirectory, 'json$');

    for (const [name, content] of Object.entries(files)) {
      const fileName = path.join(testDirectory, name + '.json');

      fs.writeFileSync(fileName, JSON.stringify(content));
    }
  }

  private static expandEnvironment(text: string, environment: { [name: string]: string }, remove: boolean = false): string {
    let previousText: string;

    do {
      previousText = text;

      for (const [name, value] of Object.entries(environment)) {
        text = text.replace(new RegExp('(.|^)\\$' + name + '([^\\w]|$)', 'g'), '$1' + value + '$2');
        text = text.replace(new RegExp('(.|^)\\$\\{' + name + '\\}', 'g'), '$1' + value);

        if (text.match(/([^\\]|^)\$/) === null) break;
      }
    } while (text.match(/([^\\]|^)\$/) !== null && text !== previousText);

    if (!remove) return text;

    text = text.replace(/([^\\]|^)\$\w+/g, '$1');
    text = text.replace(/([^\\]|^)\$\{\w+}/g, '$1');

    return text;
  }

  private deleteFiles(directory: string, pattern: string): void {
    const expression = new RegExp(pattern);

    for (const fileName of fs.readdirSync(directory)) {
      if (fileName.match(expression)) {
        const filePath = path.join(directory, fileName);

        fs.unlinkSync(filePath);
      }
    }
  }
}
