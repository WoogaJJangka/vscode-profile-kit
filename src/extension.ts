/**
 * Thin VS Code UI over src/core (structure A, docs/PLAN.md section 6).
 * For now: show what a preset file declares. Calls into the `code` CLI come after Phase 2.
 */
import * as vscode from 'vscode';

import { parsePresetText, PresetError, profileNames, resolveProfile } from './core';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Profile Kit');
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('profileKit.showPlan', async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'Profile Kit preset': ['json'] },
        openLabel: 'Show plan',
      });
      if (!picked?.[0]) return;
      try {
        const bytes = await vscode.workspace.fs.readFile(picked[0]);
        const preset = parsePresetText(new TextDecoder().decode(bytes));
        output.clear();
        for (const name of profileNames(preset)) {
          const ids = resolveProfile(preset, name);
          output.appendLine(`== ${name} (${ids.length}) ==`);
          for (const id of ids) output.appendLine(`  ${id}`);
        }
        output.show(true);
      } catch (error) {
        const message = error instanceof PresetError || error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Profile Kit: ${message}`);
      }
    }),
  );
}

export function deactivate(): void {
  // nothing to clean up: everything is in context.subscriptions
}
