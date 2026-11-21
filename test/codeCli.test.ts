import { describe, expect, it } from 'vitest';

import {
  classifyInstallOutput,
  createCodeRunner,
  installExtensionArgs,
  installExtensionsArgs,
  isTransient,
  listExtensionsArgs,
  parseListExtensions,
  saysAlreadyInstalled,
} from '../src/core/codeCli';

describe('classifyInstallOutput', () => {
  // shapes seen in install-log-*.txt / run-output*.txt of the PowerShell runs
  it.each([
    [
      "Installing extensions...\nInstalling extension 'golang.go'...\nExtension 'golang.go' v0.50.0 was successfully installed.",
      'installed',
    ],
    [
      "Installing extensions...\nExtension 'golang.go' v0.50.0 is already installed. Use '--force' option to update to latest version.",
      'already-installed',
    ],
    ["Profile 'Core' not found.", 'profile-not-found'],
    [
      'Installing extensions...\ngetaddrinfo ENOTFOUND marketplace.visualstudio.com\nError while installing extensions: getaddrinfo ENOTFOUND marketplace.visualstudio.com',
      'network',
    ],
    ['Installing extensions...\nError while installing extensions: AggregateError [ETIMEDOUT]:', 'network'],
    [
      "Installing extensions...\nError while installing extension anthropic.claude-code: Unable to write file 'c:\\Users\\me\\AppData\\Roaming\\Code\\CachedExtensionVSIXs\\.f72690aa-9e22-444a-affe-35a8ba788e41' (Error: aborted)\nFailed Installing Extensions: anthropic.claude-code",
      'network',
    ],
    ['Installing extensions...\nFailed Installing Extensions: anthropic.claude-code', 'unknown'],
    ['Installing extensions...', 'unknown'],
  ] as const)('%j -> %s', (output, expected) => {
    expect(classifyInstallOutput(output)).toBe(expected);
  });

  it('does not read an extension ID as an error (review P10)', () => {
    const output = 'Installing extensions...\nFailed Installing Extensions: acme.vpc-network';
    expect(classifyInstallOutput(output)).toBe('network');
    expect(classifyInstallOutput(output, ['acme.vpc-network'])).toBe('unknown');
    expect(classifyInstallOutput(`${output}\ngetaddrinfo ENOTFOUND x`, ['acme.vpc-network'])).toBe('network');
  });

  it('finds "already installed" per extension in a batch', () => {
    const output = "Extension 'A.b' v1 is already installed.\nExtension 'c.d' v1 was successfully installed.";
    expect(saysAlreadyInstalled(output, 'a.b')).toBe(true);
    expect(saysAlreadyInstalled(output, 'c.d')).toBe(false);
  });

  it('retries only network errors', () => {
    expect(isTransient('network')).toBe(true);
    expect(isTransient('unknown')).toBe(false);
    expect(isTransient('profile-not-found')).toBe(false);
  });
});

describe('parseListExtensions', () => {
  it('keeps only extension lines, with or without versions', () => {
    const output = 'Extensions installed on WSL:\r\nGolang.Go@0.50.0\r\nms-python.python\r\n\r\nsome warning text\n';
    expect(parseListExtensions(output)).toEqual(['golang.go', 'ms-python.python']);
  });
});

describe('argument builders', () => {
  it('builds code CLI arguments', () => {
    expect(listExtensionsArgs()).toEqual(['--list-extensions']);
    expect(listExtensionsArgs('Web-JS')).toEqual(['--profile', 'Web-JS', '--list-extensions']);
    expect(installExtensionArgs('Go', 'golang.go')).toEqual(['--profile', 'Go', '--install-extension', 'golang.go']);
    expect(installExtensionsArgs('Go', ['a.b', 'c.d'])).toEqual([
      '--profile',
      'Go',
      '--install-extension',
      'a.b',
      '--install-extension',
      'c.d',
    ]);
  });
});

describe('createCodeRunner timeout', () => {
  // On Windows the runner starts a shell; killing only the shell left the real process running and holding the
  // output open, so the call did not return until that process ended (review P2).
  it('ends the whole process tree and returns soon after the timeout', async () => {
    const run = createCodeRunner(process.execPath, { timeoutMs: 300 });
    const started = Date.now();
    const result = await run(['-e', 'setTimeout(() => {}, 30000)']);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.stderr).toContain('killed after 300 ms');
  }, 20_000);
});
