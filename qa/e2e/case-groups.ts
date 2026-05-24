import { loadQaCases, type QaCase, type QaCasePath } from './manifest';

export type QaCaseGroup =
  | 'product-color'
  | 'product-geometry'
  | 'product-feedback'
  | 'product-surface'
  | 'operator-color'
  | 'operator-geometry'
  | 'operator-feedback'
  | 'source-coverage';

const PRODUCT_SURFACE_IDS = new Set(['video-cello2-color-smoke']);
const OPERATOR_FEEDBACK_IDS = new Set(['procedural-osc-smoke']);

function matchesPath(qaCase: QaCase, path: QaCasePath): boolean {
  return qaCase.audit?.path === path;
}

function matchesFamily(qaCase: QaCase, family: string): boolean {
  return qaCase.audit?.family === family;
}

function selectQaCaseGroup(qaCase: QaCase, group: QaCaseGroup): boolean {
  switch (group) {
    case 'product-color':
      return matchesPath(qaCase, 'product') && matchesFamily(qaCase, 'color-tonal');
    case 'product-geometry':
      return matchesPath(qaCase, 'product') && matchesFamily(qaCase, 'geometry-spatial');
    case 'product-feedback':
      return matchesPath(qaCase, 'product') && matchesFamily(qaCase, 'feedback-composition');
    case 'product-surface':
      return (
        matchesPath(qaCase, 'product') &&
        (matchesFamily(qaCase, 'programs') ||
          matchesFamily(qaCase, 'finishes') ||
          matchesFamily(qaCase, 'output-buses') ||
          matchesFamily(qaCase, 'sources') ||
          PRODUCT_SURFACE_IDS.has(qaCase.id))
      );
    case 'operator-color':
      return matchesPath(qaCase, 'operator-regression') && matchesFamily(qaCase, 'color-tonal');
    case 'operator-geometry':
      return (
        matchesPath(qaCase, 'operator-regression') && matchesFamily(qaCase, 'geometry-spatial')
      );
    case 'operator-feedback':
      return (
        matchesPath(qaCase, 'operator-regression') &&
        (matchesFamily(qaCase, 'feedback-composition') || OPERATOR_FEEDBACK_IDS.has(qaCase.id))
      );
    case 'source-coverage':
      return matchesPath(qaCase, 'source-coverage') && matchesFamily(qaCase, 'sources');
  }
}

export function loadQaCaseGroup(group: QaCaseGroup): QaCase[] {
  const qaCases = loadQaCases().filter((qaCase) => selectQaCaseGroup(qaCase, group));
  if (!qaCases.length) {
    throw new Error(`No QA cases matched group "${group}"`);
  }
  return qaCases;
}
