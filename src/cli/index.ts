/**
 * profile-kit CLI.
 *   profile-kit plan   <preset.json> [--profile <name>]   what each profile should contain (no VS Code calls)
 *   profile-kit verify <preset.json> [--profile <name>]   declared vs installed, via `code --list-extensions` (read-only)
 * `apply` (create profiles + install) comes after Phase 2 (docs/PLAN.md).
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import {
  createCodeRunner,
  diffExtensions,
  listExtensionsArgs,
  parseListExtensions,
  parsePresetText,
  type Preset,
  PresetError,
  profileNames,
  resolveProfile,
} from '../core';

const USAGE = `Usage:
  profile-kit plan   <preset.json> [--profile <name>]
  profile-kit verify <preset.json> [--profile <name>] [--code <path to code CLI>]`;

function loadPreset(path: string): Preset {
  return parsePresetText(readFileSync(path, 'utf8'));
}

function selectProfiles(preset: Preset, only?: string): string[] {
  if (!only) return profileNames(preset);
  if (!(only in preset.profiles)) throw new Error(`Profile "${only}" is not in the preset`);
  return [only];
}

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      profile: { type: 'string' },
      code: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, presetPath] = positionals;
  if (values.help || !command || !presetPath) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }

  const preset = loadPreset(presetPath);
  const names = selectProfiles(preset, values.profile);

  if (command === 'plan') {
    for (const name of names) {
      const ids = resolveProfile(preset, name);
      console.log(`== ${name} (${ids.length}) ==`);
      for (const id of ids) console.log(`  ${id}`);
    }
    return 0;
  }

  if (command === 'verify') {
    const run = createCodeRunner(values.code);
    let missingTotal = 0;
    for (const name of names) {
      const result = await run(listExtensionsArgs(name));
      const output = `${result.stdout}\n${result.stderr}`;
      if (/profile '.*' not found/i.test(output)) {
        console.log(`== ${name}: profile does not exist ==`);
        missingTotal += resolveProfile(preset, name).length;
        continue;
      }
      const diff = diffExtensions(resolveProfile(preset, name), parseListExtensions(result.stdout));
      missingTotal += diff.missing.length;
      console.log(
        `== ${name}: ${diff.present.length} ok, ${diff.missing.length} missing, ${diff.extra.length} extra ==`,
      );
      for (const id of diff.missing) console.log(`  - missing ${id}`);
      for (const id of diff.extra) console.log(`  + extra   ${id}`);
    }
    return missingTotal === 0 ? 0 : 1;
  }

  console.error(`Unknown command "${command}"\n${USAGE}`);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof PresetError || error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  },
);
