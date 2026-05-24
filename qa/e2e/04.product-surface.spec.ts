import { test } from '@playwright/test';

import { loadQaCaseGroup } from './case-groups';
import { runQaCase } from './smoke-harness';

for (const qaCase of loadQaCaseGroup('product-surface')) {
  test(qaCase.id, async ({ page }, testInfo) => {
    await runQaCase(qaCase, page, testInfo);
  });
}
