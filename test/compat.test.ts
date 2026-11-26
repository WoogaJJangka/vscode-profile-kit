import { describe, expect, it } from 'vitest';

import {
  cliProfileNotFound,
  COMPAT_CHECKED_VERSION,
  PRIVATE_DEPENDENCIES,
  profileEntryCommand,
} from '../src/core/compat';

describe('compat', () => {
  it('names every private VS Code behavior once, with where it is used (review P9)', () => {
    expect(PRIVATE_DEPENDENCIES).toHaveLength(12);
    for (const d of PRIVATE_DEPENDENCIES) expect(d.usedIn).toMatch(/^(core|host|ui)\//);
    expect(COMPAT_CHECKED_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('builds the per-profile switch command and reads "profile not found"', () => {
    expect(profileEntryCommand('-6a5b1c2d')).toBe('workbench.profiles.actions.profileEntry.-6a5b1c2d');
    expect(cliProfileNotFound("Profile 'Core' not found.")).toBe(true);
    expect(cliProfileNotFound('ms-python.python')).toBe(false);
  });
});
