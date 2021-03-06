/* Copyright (C) 2020 Julian Valentin, LTeX Development Community
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import * as Code from 'vscode';
import * as Fs from 'fs';
import * as Os from 'os';
import * as Path from 'path';
import * as Querystring from 'querystring';

import Dependencies from './Dependencies';
import {i18n} from './I18n';
import Logger from './Logger';

export default class BugReporter {
  private _context: Code.ExtensionContext;
  private _dependencies: Dependencies;

  private static readonly _maxNumberOfDocumentLines: number = 200;
  private static readonly _maxNumberOfConfigLines: number = 1000;
  private static readonly _maxNumberOfServerLogLines: number = 100;
  private static readonly _maxNumberOfClientLogLines: number = 1000;
  private static readonly _reportBugUrl: string = 'https://github.com/valentjn/vscode-ltex/' +
      'issues/new?assignees=&labels=1-bug%2C+2-unconfirmed&title=&body=';

  public constructor(context: Code.ExtensionContext, dependencies: Dependencies) {
    this._context = context;
    this._dependencies = dependencies;
  }

  private createReport(): string {
    const templatePath: string = Path.resolve(
        this._context.extensionPath, '.github', 'ISSUE_TEMPLATE', 'bug-report.md');
    let bugReport: string = Fs.readFileSync(templatePath, {encoding: 'utf-8'});
    let pos: number;

    pos = bugReport.indexOf('---');

    if (pos > -1) {
      pos = bugReport.indexOf('---', pos + 3);

      if (pos > -1) {
        pos = bugReport.indexOf('**', pos + 3);
        if (pos > -1) bugReport = bugReport.substring(pos);
      }
    }

    if (Code.window.activeTextEditor != null) {
      const document: Code.TextDocument = Code.window.activeTextEditor.document;
      let codeLanguage: string;

      switch (document.languageId) {
        case 'latex': {
          codeLanguage = 'latex';
          break;
        }
        case 'markdown': {
          codeLanguage = 'markdown';
          break;
        }
        default: {
          codeLanguage = 'plaintext';
          break;
        }
      }

      pos = bugReport.indexOf('REPLACE_THIS_WITH_SAMPLE_DOCUMENT');

      if (pos > -1) {
        pos = bugReport.lastIndexOf('```', pos);

        if (pos > -1) {
          bugReport = bugReport.substring(0, pos + 3) + codeLanguage + bugReport.substring(pos + 3);
        }
      }

      const documentText: string = BugReporter.truncateStringAtEnd(
          document.getText(), BugReporter._maxNumberOfDocumentLines);
      bugReport = bugReport.replace('REPLACE_THIS_WITH_SAMPLE_DOCUMENT', documentText);
    }

    const config: any = JSON.parse(JSON.stringify(Code.workspace.getConfiguration('ltex')));

    for (const name in config) {
      if (!Object.prototype.hasOwnProperty.call(config, name)) continue;

      if ((config[name] != null) &&
            (Object.prototype.hasOwnProperty.call(config[name], 'dictionary')) &&
            (Object.prototype.hasOwnProperty.call(config[name], 'disabledRules')) &&
            (Object.prototype.hasOwnProperty.call(config[name], 'enabledRules')) &&
            (JSON.stringify(config[name].dictionary) === '[]') &&
            (JSON.stringify(config[name].disabledRules) === '[]') &&
            (JSON.stringify(config[name].enabledRules) === '[]')) {
        delete config[name];
      }
    }

    let configJson: string = JSON.stringify(config, null, 2);
    configJson = BugReporter.truncateStringAtEnd(configJson, BugReporter._maxNumberOfConfigLines);
    bugReport = bugReport.replace('REPLACE_THIS_WITH_LTEX_CONFIGURATION', configJson);

    const serverLog: string = BugReporter.truncateStringAtStart(
        Logger.serverOutputChannel.getContents(), BugReporter._maxNumberOfServerLogLines);
    bugReport = bugReport.replace('REPLACE_THIS_WITH_LTEX_LANGUAGE_SERVER_LOG', serverLog);

    let clientLog: string = Logger.clientOutputChannel.getContents();
    clientLog = clientLog.replace(new RegExp(/"[A-Za-z0-9\-_]+": \{\s*/.source +
        /"dictionary": \[\],\s*"enabledRules": \[\],\s*/.source +
        /"disabledRules": \[\]\s*\},?[\r\n]*/.source, 'g'), '');
    clientLog = BugReporter.truncateStringAtStart(
        clientLog, BugReporter._maxNumberOfClientLogLines);
    bugReport = bugReport.replace('REPLACE_THIS_WITH_LTEX_LANGUAGE_CLIENT_LOG', clientLog);

    const platform: string = `${Os.type} (${Os.platform}), ${Os.arch}, ${Os.release}`;
    bugReport = bugReport.replace(/^- Operating system: .*$/m, `- Operating system: ${platform}`);

    bugReport = bugReport.replace(/^- VS Code: .*$/m, `- VS Code: ${Code.version}`);

    const extension: Code.Extension<any> | undefined =
        Code.extensions.getExtension('valentjn.vscode-ltex');

    if (extension != null) {
      bugReport = bugReport.replace(/^- vscode-ltex: .*$/m,
          `- vscode-ltex: ${extension.packageJSON.version}`);
    }

    if (this._dependencies != null) {
      const ltexLsVersion: string | null = this._dependencies.ltexLsVersion;

      if (ltexLsVersion != null) {
        bugReport = bugReport.replace(/^- ltex-ls: .*$/m, `- ltex-ls: ${ltexLsVersion}`);
      }

      const javaVersion: string | null = this._dependencies.javaVersion;

      if (javaVersion != null) {
        bugReport = bugReport.replace(/^- Java: .*$/m, `- Java: ${javaVersion}`);
      }
    }

    return bugReport;
  }

  private static truncateStringAtStart(str: string, maxNumberOfLines: number): string {
    const lines: string[] = str.split('\n');
    return ((lines.length > maxNumberOfLines) ?
        ('[... truncated]\n' + lines.slice(-maxNumberOfLines).join('\n')) : str);
  }

  private static truncateStringAtEnd(str: string, maxNumberOfLines: number): string {
    const lines: string[] = str.split('\n');
    return ((lines.length > maxNumberOfLines) ?
        (lines.slice(0, maxNumberOfLines).join('\n') + '\n[... truncated]') : str);
  }

  public report(): void {
    Logger.log(i18n('creatingBugReport'));
    const bugReport: string = this.createReport();

    Code.window.showInformationMessage(i18n('thanksForHelpingToImproveLtex'),
          i18n('copyReportAndCreateIssue')).then(async (selectedItem: string | undefined) => {
      if (selectedItem == i18n('copyReportAndCreateIssue')) {
        Code.env.clipboard.writeText(bugReport);
        Code.env.openExternal(Code.Uri.parse(BugReporter._reportBugUrl +
            Querystring.escape(i18n('enterSummaryOfIssueInTitleFieldAndReplaceSentence'))));
      }
    });
  }
}
