/**
 * Compatibility check against a real VS Code build (review P9, stage D-2), run by `.github/workflows/compat.yml`.
 * It drives the downloaded VS Code's `code` CLI through Profile Kit's own host functions, in throwaway data folders,
 * and fails when one of the VS Code internals listed in src/core/compat.ts no longer behaves as expected.
 * Covered: the CLI location, "profile not found", creating a profile with --new-window and reading it back from
 * storage.json, batched installs and their output, --list-extensions, one folder with package.json per installed
 * extension, extensions applied to all profiles in extensions.json, the installed list read from VS Code's own
 * extensions.json files against --list-extensions (1.5), and VS Code's profile template list (stage C).
 * Not covered (needs a running window): the profile switch command and VS Code reading a profile's settings.json.
 * Also not covered: a profile that uses Default's extensions (it can only be made in the Profiles editor).
 *
 *   node out/compat.js --code <bin/code> --app-root <resources/app> --data <empty folder>
 */
import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';

import {
  COMPAT_CHECKED_VERSION,
  compareCodeUnits,
  createCodeRunner,
  listExtensionsArgs,
  parseListExtensions,
  type StoredProfile,
} from '../../src/core';
import { readStorage } from '../../src/host/apply';
import {
  fetchTemplates,
  readApplicationScoped,
  readExtensionRelations,
  readInstalledExtensions,
  readTemplatesUrl,
} from '../../src/host/builtins';
import { findCodeCli } from '../../src/host/codeLocator';
import { ensureProfile, installExtensions, listInstalled } from '../../src/host/installer';
import { userDataPaths } from '../../src/host/paths';

const { values } = parseArgs({
  options: { code: { type: 'string' }, 'app-root': { type: 'string' }, data: { type: 'string' } },
});
if (!values.code || !values['app-root'] || !values.data) {
  console.error('usage: compat.js --code <bin/code> --app-root <resources/app> --data <empty folder>');
  process.exit(2);
}
const code = path.resolve(values.code);
const data = path.resolve(values.data);
const dirs = ['u', 'x', 's'].map((d) => path.join(data, d));
for (const d of dirs) mkdirSync(d, { recursive: true });
const [userData, extensionsDir, sharedDataDir] = dirs;
// all three data folders, so no window of the runner's own VS Code is involved (CLAUDE.md, docs/PLAN.md section 8 #8)
const run = createCodeRunner(code, {
  baseArgs: ['--user-data-dir', userData, '--extensions-dir', extensionsDir, '--shared-data-dir', sharedDataDir],
  timeoutMs: 120_000,
});
const paths = userDataPaths(userData);

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`,
  );
  if (!ok) failed++;
}

/**
 * Profile Kit reads what is installed from VS Code's own lists (1.5, host/builtins.ts readInstalledExtensions).
 * That must be exactly what `code --list-extensions` prints for the profile (`profile` left out: Default).
 */
async function listsAgree(name: string, profile?: StoredProfile): Promise<void> {
  const files = readInstalledExtensions(paths, extensionsDir, profile);
  // the same order as the list read from the files (core/extensionsJson.ts sorts with compareCodeUnits)
  const cli = parseListExtensions((await run(listExtensionsArgs(profile?.name))).stdout).sort(compareCodeUnits);
  check(name, !!files.ids && files.ids.join() === cli.join(), { files: files.ids ?? files.problem, cli });
}

const PROFILE = 'Compat';
const GOOD = ['editorconfig.editorconfig', 'ms-vscode.wordcount'];
const BAD = 'profile-kit.does-not-exist';
const LANGUAGE_PACK = 'ms-ceintl.vscode-language-pack-ko';
const appRoot = path.resolve(values['app-root']);

async function main(): Promise<void> {
  const version = await run(['--version']);
  console.log(
    `VS Code ${version.stdout.split(/\r?\n/)[0]} (internals last checked by hand on ${COMPAT_CHECKED_VERSION})`,
  );

  const found = findCodeCli(appRoot);
  check('code CLI is found from appRoot', !!found && path.resolve(found) === code, { found, code });

  check('"profile not found" is recognized', (await listInstalled(run, 'No Such Profile')) === undefined);

  const ensured = await ensureProfile(run, PROFILE, () => readStorage(paths).profiles, {
    timeoutMs: 120_000,
    intervalMs: 2000,
  });
  check('code --profile X --new-window creates X (seen in storage.json)', ensured.status === 'created', ensured);
  const storage = readStorage(paths);
  check('storage.json is understood', storage.problems.length === 0, storage.problems);
  check(
    'the new profile has a location',
    !!storage.profiles.find((p) => p.name === PROFILE)?.location,
    storage.profiles,
  );
  const profile = storage.profiles.find((p) => p.name === PROFILE);
  if (profile) await listsAgree('a new profile: the list read from files is its --list-extensions', profile);

  const first = await installExtensions(run, PROFILE, [...GOOD, BAD], { sleep: () => Promise.resolve() });
  const outcome = (id: string) => first.find((r) => r.id === id)?.outcome;
  check(
    'batched install: good IDs are installed',
    GOOD.every((id) => outcome(id) === 'installed'),
    first,
  );
  check('batched install: a missing ID is not taken as installed', outcome(BAD) === 'unknown', first);

  const again = await installExtensions(run, PROFILE, GOOD);
  check(
    'batched install again: "already installed" per extension',
    again.every((r) => r.outcome === 'already-installed'),
    again,
  );

  const list = await listInstalled(run, PROFILE);
  check('--list-extensions shows the installed extensions', !!list && GOOD.every((id) => list.includes(id)), list);

  // why an extra is installed (dependency / extension pack) is read from each extension folder's package.json
  const relations = await readExtensionRelations(extensionsDir);
  check(
    'each installed extension has a folder with its package.json in the extensions folder',
    GOOD.every((id) => relations.has(id)),
    { known: [...relations.keys()] },
  );

  // stage C-2: VS Code applies language packs to all profiles. Installed into Default, one is marked
  // isApplicationScoped in the extensions folder's extensions.json and shows up in the other profile's list.
  // Failure details below are summaries (IDs, counts, error kinds), not file or download contents.
  const install = await run(['--install-extension', LANGUAGE_PACK]);
  const scoped = readApplicationScoped(extensionsDir);
  check('extensions.json marks extensions applied to all profiles', scoped.ids.includes(LANGUAGE_PACK), {
    applicationScoped: scoped.ids,
    readProblem: !!scoped.problem,
    installExitCode: install.exitCode,
  });
  const listed = await listInstalled(run, PROFILE);
  check('an extension applied to all profiles is listed in every profile', !!listed?.includes(LANGUAGE_PACK), listed);

  // 1.5: the same two facts from the files alone, without a `code` process per profile
  if (profile)
    await listsAgree(
      "a profile's extensions.json plus what Default applies to all profiles is its --list-extensions",
      profile,
    );
  await listsAgree("the extensions folder's extensions.json is Default's --list-extensions");

  // stage C-4: the template list VS Code shows under New Profile, and each template in the .code-profile format
  const url = readTemplatesUrl(appRoot);
  check('product.json has profileTemplatesUrl', !!url);
  if (url) {
    let templates: Awaited<ReturnType<typeof fetchTemplates>> | undefined;
    try {
      templates = await fetchTemplates(url, { downloadAttempts: 2 });
    } catch {
      // The list is on VS Code's own CDN; older builds name a host that no longer answers (seen on 1.95.0:
      // "fetch failed"). VS Code's New Profile > template list is then empty too, and Profile Kit only shows no
      // suggestions. The error text is not logged: it comes from the download (SonarQube S8689).
      console.log("SKIP  profile templates: the list in this build's product.json could not be downloaded or read");
    }
    if (templates) {
      // A template that could not be downloaded (twice) says nothing about its format. Seen once: 2026-11-23, one
      // template of seven in one job, while another job read it at the same time. Only downloaded ones are checked.
      const notDownloaded = templates.filter((x) => x.failure?.stage === 'download');
      const downloaded = templates.filter((x) => x.failure?.stage !== 'download');
      if (notDownloaded.length)
        console.log(
          `SKIP  profile templates not downloaded after 2 tries: ${notDownloaded.map((x) => `${x.name} (${x.failure?.reason})`).join(', ')}`,
        );
      if (downloaded.length || !templates.length)
        check(
          'profile templates are .code-profile files Profile Kit can read',
          templates.length > 0 && downloaded.every((x) => !!x.profile?.extensions.length),
          downloaded.map((x) => ({
            name: x.name,
            extensions: x.profile?.extensions.length ?? 0,
            ...(x.failure ? { notRead: x.failure.reason } : {}),
          })),
        );
    }
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    failed++;
  })
  .finally(() => {
    console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
    process.exitCode = failed ? 1 : 0;
  });
