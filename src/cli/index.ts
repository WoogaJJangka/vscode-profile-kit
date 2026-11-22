/**
 * profile-kit CLI: the batch side of Profile Kit (new PC, CI checks). Day-to-day work is in the extension's GUI.
 * <preset.json> may be left out: then the preset Profile Kit uses is read from Default's settings.json (the synced
 * `profileKit.preset`, else the file named by `profileKit.presetPath`).
 *   profile-kit plan   <preset.json> [--profile <name>]           what each profile should contain (no VS Code calls)
 *   profile-kit verify <preset.json> [--profile <name>]           declared vs installed (read-only)
 *   profile-kit apply  <preset.json> [--profile <name>] [--yes]   create profiles, install, write settings
 *   profile-kit export <preset.json> [--profile <name>] --out <dir>   one .code-profile per profile (VS Code import)
 * `apply` only previews unless `--yes` is given. Nothing is uninstalled and the Default profile is never changed.
 */
import { parseArgs } from 'node:util';

import {
  cliProfileNotFound,
  createCodeRunner,
  diffExtensions,
  explainExtras,
  extraNote,
  formatPlan,
  listExtensionsArgs,
  parseListExtensions,
  planIsEmpty,
  type Preset,
  PresetError,
  PROFILE_KIT_ID,
  profileNames,
  resolveProfile,
} from '../core';
import { buildPlans, executePlans, reportOk } from '../host/apply';
import {
  exportCodeProfiles,
  readApplicationScoped,
  readExtensionRelations,
  SYNC_NOTE,
  syncedBefore,
} from '../host/builtins';
import { installSucceeded } from '../host/installer';
import { loadCliPreset } from '../host/presetLoader';
import { defaultExtensionsDir, defaultUserDataDir, userDataPaths } from '../host/paths';

const USAGE = `Usage:
  profile-kit plan   [<preset.json>] [--profile <name>]
  profile-kit verify [<preset.json>] [--profile <name>] [VS Code options]
  profile-kit apply  [<preset.json>] [--profile <name>] [--yes] [--no-create] [VS Code options]
  profile-kit export [<preset.json>] [--profile <name>] --out <dir> [--offline]

Without <preset.json>, the preset Profile Kit uses in VS Code: the one stored in Settings (profileKit.preset,
carried by Settings Sync), else the file in profileKit.presetPath. They are read from Default's settings.json
(under --user-data-dir when given).

apply previews the changes; add --yes to carry them out.
  --no-create   do not create missing profiles (creating one opens a VS Code window)

export writes <profile>.code-profile files for VS Code's Profiles editor (drop a file on it, or New Profile >
Import). Import each as a NEW profile: importing into an existing one uninstalls what the file does not list.
  --offline     do not ask the Marketplace for extension GUIDs (VS Code then matches extensions by ID)

VS Code options:
  --code <path>              code CLI to call (default: code on PATH)
  --user-data-dir <dir>      passed to code, and where settings.json / storage.json are read
  --extensions-dir <dir>     passed to code
  --shared-data-dir <dir>    passed to code`;

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
      'user-data-dir': { type: 'string' },
      'extensions-dir': { type: 'string' },
      'shared-data-dir': { type: 'string' },
      yes: { type: 'boolean', short: 'y' },
      'no-create': { type: 'boolean' },
      out: { type: 'string' },
      offline: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, presetPath] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }

  const { preset } = loadCliPreset(presetPath, values['user-data-dir'] ?? defaultUserDataDir(), console.log);
  const names = selectProfiles(preset, values.profile);

  if (command === 'plan') {
    for (const name of names) {
      const ids = resolveProfile(preset, name);
      console.log(`== ${name} (${ids.length}) ==`);
      for (const id of ids) console.log(`  ${id}`);
    }
    return 0;
  }

  if (command === 'export') {
    if (!values.out) throw new Error('export needs --out <dir>');
    const { files, withoutUuids } = await exportCodeProfiles(preset, names, values.out, { lookup: !values.offline });
    for (const f of files) console.log(`wrote ${f}`);
    if (withoutUuids) console.log('(no extension GUIDs: the Marketplace was not asked or did not answer)');
    console.log(
      'Import each file as a new profile in VS Code (Profiles editor). Importing into an existing profile uninstalls the extensions the file does not list.',
    );
    return 0;
  }

  const baseArgs = [
    ...(values['user-data-dir'] ? ['--user-data-dir', values['user-data-dir']] : []),
    ...(values['extensions-dir'] ? ['--extensions-dir', values['extensions-dir']] : []),
    ...(values['shared-data-dir'] ? ['--shared-data-dir', values['shared-data-dir']] : []),
  ];

  if (command === 'verify') {
    const run = createCodeRunner(values.code, { baseArgs });
    // Say why an extra is there instead of a bare "extra": VS Code shows extensions applied to all profiles in every
    // profile's list, and installs dependencies and extension pack members along with the extension that names them
    const extensionsDir = values['extensions-dir'] ?? defaultExtensionsDir();
    const scoped = readApplicationScoped(extensionsDir);
    if (scoped.problem) console.log(`! ${scoped.problem}`);
    const allProfiles = new Set(scoped.ids);
    const relations = await readExtensionRelations(extensionsDir);
    let missingTotal = 0;
    for (const name of names) {
      const result = await run(listExtensionsArgs(name));
      const output = `${result.stdout}\n${result.stderr}`;
      if (cliProfileNotFound(output)) {
        console.log(`== ${name}: profile does not exist ==`);
        missingTotal += resolveProfile(preset, name).length;
        continue;
      }
      const installed = parseListExtensions(result.stdout);
      const diff = diffExtensions(resolveProfile(preset, name), installed, { ignoreExtra: [PROFILE_KIT_ID] });
      const reasons = explainExtras(diff.extra, installed, relations);
      missingTotal += diff.missing.length;
      console.log(
        `== ${name}: ${diff.present.length} ok, ${diff.missing.length} missing, ${diff.extra.length} extra ==`,
      );
      for (const id of diff.missing) console.log(`  - missing ${id}`);
      for (const id of diff.extra) console.log(`  + extra   ${id}${extraNote(reasons.get(id), allProfiles.has(id))}`);
    }
    return missingTotal === 0 ? 0 : 1;
  }

  if (command === 'apply') {
    // a hung install must not hang the whole run
    const env = {
      run: createCodeRunner(values.code, { baseArgs, timeoutMs: 5 * 60_000 }),
      paths: userDataPaths(values['user-data-dir'] ?? defaultUserDataDir()),
    };
    const { plans, problems } = await buildPlans(env, preset, names);
    for (const p of problems) console.log(`! ${p}`);
    for (const line of formatPlan(plans)) console.log(line);
    const todo = plans.filter((p) => !planIsEmpty(p));
    if (todo.length === 0) {
      console.log('\nNothing to do.');
      return 0;
    }
    if (syncedBefore(env.paths))
      console.log(`
! ${SYNC_NOTE}`);
    if (!values.yes) {
      console.log('\nPreview only. Run again with --yes to apply.');
      return 0;
    }
    console.log('');
    // A window call joins the running VS Code only when it names the same data folders; with --user-data-dir but no
    // --shared-data-dir it would start a VS Code on the default shared data (sign-ins), so do not open windows then.
    const unsafeWindows = !!values['user-data-dir'] && !values['shared-data-dir'];
    const reports = await executePlans(env, preset, todo, {
      createProfiles: !values['no-create'] && !unsafeWindows,
      ...(unsafeWindows
        ? { createBlockedReason: 'with --user-data-dir, also pass --shared-data-dir to let apply open windows' }
        : {}),
      onEvent: (m) => console.log(m),
    });
    console.log('\n== Result ==');
    for (const r of reports) {
      const ok = r.installs.filter((i) => installSucceeded(i.outcome)).length;
      const failed = r.installs.filter((i) => !installSucceeded(i.outcome));
      console.log(
        `${reportOk(r) ? 'ok  ' : 'FAIL'} ${r.name}: ${r.created ? 'created, ' : ''}${ok}/${r.installs.length} installed, ${r.settingsChanged} setting(s)${r.backup ? `, backup ${r.backup}` : ''}`,
      );
      for (const f of failed)
        console.log(`     ${f.id}: ${f.outcome} after ${f.attempts} tr${f.attempts === 1 ? 'y' : 'ies'}`);
      for (const p of r.problems) console.log(`     ${p}`);
    }
    return reports.every(reportOk) ? 0 : 1;
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
