/**
 * Starter presets shipped with Profile Kit, and which one fits this PC best.
 * A starter is a complete preset (a small general core, a `Core` profile, one or more language profiles with `match`)
 * that the user copies to a file and edits from there. Unlike presets/example.json, the lists are general purpose.
 *
 * Signals, per language profile of a starter (summed over the starter's profiles):
 * - extensions: each of the profile's own extensions already installed in this window's profile, EXTENSION_POINTS
 * - files: the profile's `match.files` at the top of an open folder (workspace.ts: exact name 2, wildcard 1)
 * - languages: the profile's `match.languages` among the open files' language IDs, LANGUAGE_POINTS each
 * A starter with several language profiles (All Languages) only counts profiles with at least STRONG_PROFILE points,
 * and needs two of them: one Python project with a stray `*.js` file is still a Python setup.
 */
import { normalizeId, ownExtensions, type Preset, type ProfileSpec, profileNames } from './preset';
import { recommendForFolder } from './workspace';

export interface Starter {
  /** Stable ID (command arguments, `profileKit.recommendedStarter`). */
  id: string;
  /** English title; the UI translates it. */
  title: string;
  /** English one-line description; the UI translates it. */
  description: string;
  preset: Preset;
}

export interface StarterMatch {
  /** Installed extensions of the starter's language profiles. */
  extensions: string[];
  /** `match.files` patterns that matched. */
  files: string[];
  /** `match.languages` among the open files. */
  languages: string[];
}

export interface StarterRecommendation {
  id: string;
  score: number;
  matched: StarterMatch;
}

export interface StarterSignals {
  /** Extension IDs installed in this window's profile. */
  extensions: readonly string[];
  /** File and folder names at the top of the open folders. */
  files: readonly string[];
  /** Language IDs of the open files. */
  languages: readonly string[];
}

export const EXTENSION_POINTS = 1;
export const LANGUAGE_POINTS = 2;
export const STRONG_PROFILE = 3;

/** Every starter has these, and a `Core` profile with only them (the profile for new windows). */
const STARTER_CORE = [
  'editorconfig.editorconfig',
  'usernamehw.errorlens',
  'eamodio.gitlens',
  'streetsidesoftware.code-spell-checker',
];

interface LanguageProfile {
  group: string;
  extensions: string[];
  match: Required<NonNullable<ProfileSpec['match']>>;
}

/** Language profiles, by profile name. The group of the same extensions is `group`. */
const LANGUAGE_PROFILES: Record<string, LanguageProfile> = {
  'Python-Data': {
    group: 'python-data',
    extensions: [
      'ms-python.python',
      'ms-python.vscode-pylance',
      'ms-python.debugpy',
      'charliermarsh.ruff',
      'ms-toolsai.jupyter',
      'ms-toolsai.datawrangler',
      'mechatroner.rainbow-csv',
    ],
    match: {
      languages: ['python', 'jupyter'],
      files: [
        'pyproject.toml',
        'requirements.txt',
        'setup.py',
        'setup.cfg',
        'Pipfile',
        'environment.yml',
        '*.py',
        '*.ipynb',
      ],
      keywords: ['python', 'jupyter', 'notebook', 'data science', 'pandas'],
    },
  },
  'Web-JS': {
    group: 'web-js',
    extensions: [
      'dbaeumer.vscode-eslint',
      'esbenp.prettier-vscode',
      'christian-kohler.npm-intellisense',
      'christian-kohler.path-intellisense',
      'ecmel.vscode-html-css',
      'ritwickdey.liveserver',
    ],
    match: {
      languages: ['javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'html', 'css', 'vue', 'svelte'],
      files: ['package.json', 'tsconfig.json', 'vite.config.ts', 'next.config.js', '*.js', '*.ts', '*.html'],
      keywords: ['javascript', 'typescript', 'node', 'html', 'css', 'react'],
    },
  },
  Java: {
    group: 'java',
    extensions: [
      'vscjava.vscode-java-pack',
      'redhat.java',
      'vscjava.vscode-java-debug',
      'vscjava.vscode-java-test',
      'vscjava.vscode-maven',
      'vscjava.vscode-gradle',
    ],
    match: {
      languages: ['java'],
      files: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'gradlew', '*.java'],
      keywords: ['java', 'maven', 'gradle', 'spring'],
    },
  },
  'C-Cpp': {
    group: 'c-cpp',
    extensions: [
      'ms-vscode.cpptools',
      'ms-vscode.cpptools-extension-pack',
      'ms-vscode.cmake-tools',
      'vadimcn.vscode-lldb',
    ],
    match: {
      languages: ['c', 'cpp', 'cuda-cpp'],
      files: ['CMakeLists.txt', 'meson.build', 'Makefile', '*.c', '*.cpp', '*.cc', '*.h', '*.hpp'],
      keywords: ['c', 'c++', 'cpp', 'cmake'],
    },
  },
  CSharp: {
    group: 'csharp',
    extensions: ['ms-dotnettools.csdevkit', 'ms-dotnettools.csharp', 'ms-dotnettools.vscode-dotnet-runtime'],
    match: {
      languages: ['csharp'],
      files: ['*.sln', '*.slnx', '*.csproj', 'global.json', '*.cs'],
      keywords: ['c#', 'csharp', 'dotnet', '.net'],
    },
  },
  Go: {
    group: 'go',
    extensions: ['golang.go'],
    match: {
      languages: ['go', 'go.mod'],
      files: ['go.mod', 'go.work', '*.go'],
      keywords: ['go', 'golang'],
    },
  },
  Rust: {
    group: 'rust',
    extensions: ['rust-lang.rust-analyzer', 'tamasfe.even-better-toml', 'vadimcn.vscode-lldb'],
    match: {
      languages: ['rust'],
      files: ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', '*.rs'],
      keywords: ['rust', 'cargo'],
    },
  },
  'Docker-Infra': {
    group: 'docker-infra',
    extensions: ['ms-azuretools.vscode-containers', 'ms-vscode-remote.remote-containers', 'redhat.vscode-yaml'],
    match: {
      languages: ['dockerfile', 'dockercompose'],
      files: [
        'Dockerfile',
        'compose.yaml',
        'compose.yml',
        'docker-compose.yml',
        'docker-compose.yaml',
        '*.dockerfile',
        '.devcontainer',
      ],
      keywords: ['docker', 'containers', 'devcontainer', 'kubernetes'],
    },
  },
};

function buildPreset(profiles: string[]): Preset {
  const groups: Record<string, string[]> = {};
  const specs: Record<string, ProfileSpec> = { Core: {} };
  for (const name of profiles) {
    const p = LANGUAGE_PROFILES[name];
    groups[p.group] = [...p.extensions];
    specs[name] = {
      groups: [p.group],
      match: { languages: [...p.match.languages], files: [...p.match.files], keywords: [...p.match.keywords] },
    };
  }
  return { core: [...STARTER_CORE], groups, settings: {}, profiles: specs };
}

const starter = (id: string, title: string, description: string, profiles: string[]): Starter => ({
  id,
  title,
  description,
  preset: buildPreset(profiles),
});

/** In the order the UI lists them when nothing is recommended. */
export const STARTERS: readonly Starter[] = [
  starter('python-data', 'Python · Data', 'Python, Jupyter notebooks and data files', ['Python-Data']),
  starter('web-js', 'Web · JavaScript', 'JavaScript, TypeScript, HTML and CSS', ['Web-JS']),
  starter('java', 'Java', 'Java with Maven or Gradle', ['Java']),
  starter('c-cpp', 'C · C++', 'C and C++ with CMake', ['C-Cpp']),
  starter('csharp', 'C# · .NET', 'C# and .NET', ['CSharp']),
  starter('go', 'Go', 'Go modules', ['Go']),
  starter('rust', 'Rust', 'Rust with Cargo', ['Rust']),
  starter('docker-infra', 'Docker · Infra', 'Containers, Dev Containers and YAML', ['Docker-Infra']),
  starter(
    'all-languages',
    'All Languages',
    'One profile per language above, for a PC used for several kinds of projects',
    Object.keys(LANGUAGE_PROFILES),
  ),
];

export function findStarter(id: string): Starter | undefined {
  return STARTERS.find((s) => s.id === id);
}

/** The file Profile Kit writes for a starter: the preset as JSON (validated by `*.profile-kit.json` in package.json). */
export function starterPresetText(s: Starter): string {
  return `${JSON.stringify(s.preset, null, 2)}\n`;
}

function languageProfiles(preset: Preset): string[] {
  return profileNames(preset).filter((n) => preset.profiles[n].match);
}

const unique = (list: string[]) => [...new Set(list)];

/**
 * Rank every starter for this PC, best first. A score above 0 means "recommended"; on a tie, a starter with fewer
 * profiles comes first (it is the more specific fit), then STARTERS order.
 */
export function recommendStarters(
  signals: StarterSignals,
  starters: readonly Starter[] = STARTERS,
): StarterRecommendation[] {
  const installed = new Set(signals.extensions.map(normalizeId));
  const openLanguages = new Set(signals.languages.map((l) => l.trim().toLowerCase()));

  const scored = starters.map((s) => {
    const names = languageProfiles(s.preset);
    const folder = new Map(recommendForFolder(s.preset, signals.files).map((r) => [r.profile, r]));
    const perProfile = names.map((name) => {
      const extensions = ownExtensions(s.preset, name).filter((id) => installed.has(id));
      const files = folder.get(name)?.matched ?? [];
      const languages = (s.preset.profiles[name].match?.languages ?? []).filter((l) =>
        openLanguages.has(l.toLowerCase()),
      );
      const score =
        extensions.length * EXTENSION_POINTS + (folder.get(name)?.score ?? 0) + languages.length * LANGUAGE_POINTS;
      return { score, extensions, files, languages };
    });
    let counted = perProfile;
    if (names.length > 1) {
      counted = perProfile.filter((p) => p.score >= STRONG_PROFILE);
      if (counted.length < 2) counted = [];
    }
    const matched: StarterMatch = {
      extensions: unique(counted.flatMap((p) => p.extensions)),
      files: unique(counted.flatMap((p) => p.files)),
      languages: unique(counted.flatMap((p) => p.languages)),
    };
    return { id: s.id, score: counted.reduce((sum, p) => sum + p.score, 0), matched, size: names.length };
  });

  // Array.prototype.sort is stable, so ties of the same size keep STARTERS order
  return scored
    .sort((a, b) => b.score - a.score || a.size - b.size)
    .map(({ id, score, matched }) => ({ id, score, matched }));
}

/** The recommended starter, or undefined when no signal points anywhere. */
export function bestStarter(list: readonly StarterRecommendation[]): StarterRecommendation | undefined {
  return list[0] && list[0].score > 0 ? list[0] : undefined;
}
