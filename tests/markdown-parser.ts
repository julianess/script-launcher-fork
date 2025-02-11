import * as fs from 'fs';
import { IConfig } from '../src/config-loader';

export enum SectionType {
  unknown,
  json,
  bash
}

export interface ISectionTest {
  title: string;
  type: SectionType;
  config: IConfig;
  result: string[][];
  commands: string[];
  error?: string;
}

export class MarkdownParser {
  private readonly sections: Map<string, string[]>;

  public constructor(fileName: string, exclude: string[] = []) {
    const buffer = fs.readFileSync(fileName);
    const fileContent = buffer.toString().split('\n');

    this.sections = new Map();

    try {
      const sections = MarkdownParser.getSections(fileContent, '^(###|##) (.*)');

      for (const [key, value] of sections) {
        if (exclude.includes(key)) continue;

        if (value.length !== 1) throw new Error('Invalid markdown section: ' + key);

        this.sections.set(key, value[0]);
      }
    } catch (error) {
      console.error('Error loading "' + fileName + '" markdown file ', error.message);
    }
  }

  public getSectionTests(): ISectionTest[] {
    const sectionTests: ISectionTest[] = [];

    for (const [title, content] of this.sections) {
      const commands = MarkdownParser.getCommands(content, '^\\*\\*Run\\*\\*\\: ');
      const sections = MarkdownParser.getSections(content, '^\\s*```(.*)');

      sectionTests.push(...MarkdownParser.parseSectionJSONTests(sections, title, commands));
      sectionTests.push(...MarkdownParser.parseSectionBashTests(sections, title, commands));
    }

    return sectionTests;
  }

  private static parseSectionJSONTests(sections: Map<string, string[][]>, title: string, commands: string[]): ISectionTest[] {
    const result: ISectionTest[] = [];
    const content = sections.get('json');
    const output = sections.get('text') || [];

    if (content) {
      let config: IConfig = {} as any;
      let sectionError: string = null;

      for (const item of content) {
        try {
          config = JSON.parse(item ? item.join('\n') : '{}');
        } catch (error) {
          sectionError = 'Unable to load markdown example: ' + error.message;
        }

        let outputResult: string[][] = null;

        if (output[result.length]) {
          outputResult = output.map(item => item.map(item => item.replace(/\r$/, '')));
        }

        result.push({
          title: title,
          config: config,
          result: outputResult,
          type: SectionType.json,
          commands: commands,
          error: sectionError
        });
      }
    }

    return result;
  }

  private static parseSectionBashTests(sections: Map<string, string[][]>, title: string, commands: string[]): ISectionTest[] {
    const parsedTests: ISectionTest[] = [];
    const content = sections.get('bash');
    let index = 0;

    if (content) {
      for (const item of content) {
        parsedTests.push({
          title: title,
          config: null,
          result: [item.map(row => row.replace('\r', ''))],
          type: SectionType.bash,
          commands: [commands[index++]],
          error: null
        });
      }
    }

    return parsedTests;
  }

  private static getCommands(content: string[], pattern: string): string[] {
    const result: string[] = [];
    const expression = new RegExp(pattern);

    for (const line of content) {
      if (line.match(expression) !== null) {
        const expression = /`(.*?)`/g;
        let match: RegExpExecArray;

        while ((match = expression.exec(line)) != null) {
          result.push(match[1]);
        }
      }
    }

    return result;
  }

  private static getSections(content: string[], pattern: string): Map<string, string[][]> {
    const result: Map<string, string[][]> = new Map();
    const expression = new RegExp(pattern);
    let block = [];

    for (const line of content) {
      const matches = line.match(expression);

      if (matches !== null) {
        const key = matches[matches.length - 1].trim();

        block = [];

        let section = result.get(key);

        if (!section) {
          section = [];
          result.set(key, section);
        }

        section.push(block);
      } else {
        block.push(line);
      }
    }

    return result;
  }
}
