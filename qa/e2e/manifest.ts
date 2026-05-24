import fs from 'node:fs';
import path from 'node:path';

export interface QaCaseSource {
  kind: string;
  fixture?: string;
}

export interface QaCaseTransport {
  start?: boolean;
  settleMs?: number;
}

export interface QaCaseRecording {
  filename?: string;
  tailMs?: number;
}

export interface QaCaseExpectations {
  sourceKind?: string;
  minVideoAdvanceSeconds?: number;
  videoFeaturesActive?: boolean;
  audioActive?: boolean;
  allowConsoleErrors?: string[];
  metricComparisons?: QaMetricComparison[];
}

export type QaCasePath = 'product' | 'operator-regression' | 'source-coverage';

export interface QaCaseAudit {
  family?: string;
  operator?: string;
  kind?: 'baseline' | 'sweep' | 'edge' | 'cross-source';
  path?: QaCasePath;
  expectedVideo?: string[];
  expectedAudio?: string[];
  manualChecks?: string[];
}

export interface QaMetricComparison {
  from: string;
  to: string;
  domain: 'audio' | 'video';
  metric: string;
  op: '>' | '>=' | '<' | '<=';
  delta?: number;
  description?: string;
  source?: 'live' | 'exported-audio';
  segmentPaddingMs?: number;
}

export interface SetOperatorParamStep {
  type: 'set-operator-param';
  op: string;
  opIndex?: number;
  paramId: string;
  value: number;
  screenshot?: string;
}

export interface AddBlendNodeStep {
  type: 'add-blend-node';
  op: string;
  screenshot?: string;
}

export interface SetSourceParamStep {
  type: 'set-source-param';
  paramId: string;
  value: number;
  screenshot?: string;
}

export interface SetNodeBusStep {
  type: 'set-node-bus';
  op: string;
  opIndex?: number;
  bus: 0 | 1 | 2 | 3;
  screenshot?: string;
}

export interface SetNodePrimaryInputStep {
  type: 'set-node-primary-input';
  op: string;
  opIndex?: number;
  input: string;
  screenshot?: string;
}

export interface SetNodeSecondaryInputStep {
  type: 'set-node-secondary-input';
  op: string;
  opIndex?: number;
  input: string;
  screenshot?: string;
}

export interface AddNodeInputStep {
  type: 'add-node-input';
  op: string;
  opIndex?: number;
  input: string;
  screenshot?: string;
}

export interface SetMonitorBusStep {
  type: 'set-monitor-bus';
  bus: 0 | 1 | 2 | 3;
  screenshot?: string;
}

export interface SetPreviewModeStep {
  type: 'set-preview-mode';
  mode: 'single' | 'quad';
  screenshot?: string;
}

export interface WaitStep {
  type: 'wait';
  ms: number;
  screenshot?: string;
}

export interface ApplyProgramStep {
  type: 'apply-program';
  name: string;
  screenshot?: string;
}

export interface SetPresentationFinishStep {
  type: 'set-presentation-finish';
  look?: string;
  quality?: string;
  lut?: string;
  postPreset?: string;
  lensDirt?: string;
  screenshot?: string;
}

export interface LoadImportedLutStep {
  type: 'load-imported-lut';
  url: string;
  label?: string;
  screenshot?: string;
}

export type QaCaseStep =
  | SetOperatorParamStep
  | AddBlendNodeStep
  | SetSourceParamStep
  | SetNodeBusStep
  | SetNodePrimaryInputStep
  | SetNodeSecondaryInputStep
  | AddNodeInputStep
  | SetMonitorBusStep
  | SetPreviewModeStep
  | WaitStep
  | ApplyProgramStep
  | SetPresentationFinishStep
  | LoadImportedLutStep;

export interface QaCase {
  id: string;
  title?: string;
  source: QaCaseSource;
  transport?: QaCaseTransport;
  recording?: QaCaseRecording;
  referenceVideo?: string;
  expectations?: QaCaseExpectations;
  audit?: QaCaseAudit;
  steps?: QaCaseStep[];
}

const CASES_DIR = path.resolve(process.cwd(), 'qa/cases');

export function loadQaCases(): QaCase[] {
  return fs
    .readdirSync(CASES_DIR)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => {
      const raw = fs.readFileSync(path.join(CASES_DIR, entry), 'utf8');
      return JSON.parse(raw) as QaCase;
    });
}

export function resolveFixturePath(fixture: string): string {
  return path.resolve(process.cwd(), fixture);
}
