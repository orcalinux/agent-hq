import {
  CodeDiffFile,
  CodeDiffHunkLine,
  ExecutiveDossierData,
  GitCommitEntry,
  KanbanTaskCard,
  MissionPreset,
  QACertificateData,
  SimulationEvent,
  SOPStage,
} from '../types';

export function parseUnifiedDiffLines(unifiedDiff: string): CodeDiffHunkLine[] {
  const rawLines = unifiedDiff.split('\n');
  const parsed: CodeDiffHunkLine[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const line of rawLines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      continue;
    }
    if (line.startsWith('---') || line.startsWith('+++')) {
      continue;
    }
    if (line.startsWith('+')) {
      parsed.push({
        type: 'add',
        newLineNumber: newLine++,
        content: line.slice(1),
      });
    } else if (line.startsWith('-')) {
      parsed.push({
        type: 'del',
        oldLineNumber: oldLine++,
        content: line.slice(1),
      });
    } else {
      parsed.push({
        type: 'normal',
        oldLineNumber: oldLine++,
        newLineNumber: newLine++,
        content: line.startsWith(' ') ? line.slice(1) : line,
      });
    }
  }
  return parsed;
}

export const PRELOADED_MISSIONS: MissionPreset[] = [
  {
    id: 'fintech-crypto',
    title: 'Build a FinTech Crypto Trading Platform',
    subtitle: 'Sub-millisecond Rust matching engine, WebSocket L2 orderbook & zero-trust MPC custody',
    category: 'FinTech',
    prompt:
      'Architect and implement an institutional-grade FinTech Crypto Trading Platform featuring a lock-free limit order book (LOB) matching engine, real-time WebSocket L2 depth streaming, Replay-Protected Ed25519 order signing, and a high-frequency dark obsidian trading terminal.',
    complexity: 'Extreme',
    estimatedStages: 5,
    tags: ['Rust Engine', 'WebSocket L2', 'MPC Custody', 'Zero-Trust QA'],
    mermaidDiagram: `flowchart LR
  subgraph Client["Dark Obsidian Trading Terminal (React 19)"]
    UI["Orderbook Depth & Candlesticks"]
    Signer["Ed25519 Hardware Enclave Signer"]
  end
  subgraph Gateway["Zero-Trust API & WS Edge"]
    WSMux["WebSocket L2 Multiplexer"]
    RateGuard["Replay Nonce & Rate Guard"]
  end
  subgraph Core["Deterministic Matching Core"]
    LOB["Lock-Free Limit Order Book"]
    Risk["Pre-Trade Margin & VaR Engine"]
    Settlement["MPC Multi-Sig Settlement Vault"]
  end
  UI --> Signer
  Signer -->|Signed Order + Nonce| RateGuard
  RateGuard -->|Verified Frame| Risk
  Risk -->|Atomic Match| LOB
  LOB -->|Delta Stream <0.4ms| WSMux
  WSMux -->|60fps L2 Book| UI
  LOB -->|Batch Clear| Settlement`,
  },
  {
    id: 'ai-video-saas',
    title: 'Create an AI Video SaaS',
    subtitle: 'Multi-track WebGL timeline studio, distributed GPU diffusion worker pool & Stripe usage billing',
    category: 'AI SaaS',
    prompt:
      'Build a cloud-native AI Video Generation & Editing SaaS with a frame-accurate WebCodecs/Canvas timeline editor, Whisper ASR caption synchronization, distributed GPU diffusion queue with backpressure control, and Stripe metered token billing.',
    complexity: 'High',
    estimatedStages: 5,
    tags: ['WebCodecs', 'GPU Queue', 'Whisper ASR', 'Stripe Metered'],
    mermaidDiagram: `flowchart TD
  subgraph Studio["WebCodecs Non-Linear Editor"]
    Timeline["Multi-Track Keyframe Canvas"]
    Preview["60fps Shader Compositor"]
  end
  subgraph Orchestrator["Render & Billing Control Plane"]
    API["Idempotent Job Dispatcher"]
    Ledger["Stripe Credit & Quota Ledger"]
  end
  subgraph Workers["Distributed GPU Cluster"]
    Diffusion["Temporal Diffusion Pipeline"]
    Whisper["Whisper Timestamp Aligner"]
    FFmpeg["Hardware NVENC Muxer"]
  end
  Timeline --> Preview
  Timeline -->|Render Spec| API
  API -->|Reserve Credits| Ledger
  API -->|Dispatch Shards| Diffusion
  API -->|Audio Track| Whisper
  Diffusion --> FFmpeg
  Whisper --> FFmpeg
  FFmpeg -->|HLS Stream| Preview`,
  },
  {
    id: 'custom-mission',
    title: 'Custom Autonomous Engineering Mission',
    subtitle: 'Synthesize architecture, multi-file code diffs, and cryptographic QA verification from any specification',
    category: 'Custom',
    prompt:
      'Design and ship a fault-tolerant distributed multi-agent telemetry & orchestration platform with real-time event streaming, RBAC security boundaries, and automated verification.',
    complexity: 'Dynamic',
    estimatedStages: 5,
    tags: ['Custom Spec', 'Full-Stack', 'Auto-QA', 'Executive Dossier'],
    mermaidDiagram: `flowchart LR
  subgraph Edge["Client Command Surface"]
    App["Reactive Dashboard UI"]
    Stream["SSE Telemetry Consumer"]
  end
  subgraph Services["Autonomous Core Services"]
    Router["Dynamic Model & Task Router"]
    Worker["Transactional Execution Engine"]
    Audit["Cryptographic QA Verifier"]
  end
  App -->|Command Spec| Router
  Router -->|Dispatch| Worker
  Worker -->|Verify Diff| Audit
  Audit -->|Signed Artifact| Stream
  Stream --> App`,
  },
];

export interface BuiltMissionPlan {
  preset: MissionPreset;
  initialTasks: KanbanTaskCard[];
  events: SimulationEvent[];
  files: CodeDiffFile[];
  commits: GitCommitEntry[];
  certificate: QACertificateData;
  dossier: ExecutiveDossierData;
}

export function buildMissionPlan(
  missionIdOrCustom: string,
  customPromptText?: string
): BuiltMissionPlan {
  const baseMatch =
    PRELOADED_MISSIONS.find(
      (p) =>
        p.id === missionIdOrCustom ||
        p.title.toLowerCase() === missionIdOrCustom.toLowerCase()
    ) ||
    (missionIdOrCustom.toLowerCase().includes('video')
      ? PRELOADED_MISSIONS[1]
      : missionIdOrCustom.toLowerCase().includes('fintech') ||
          missionIdOrCustom.toLowerCase().includes('crypto')
        ? PRELOADED_MISSIONS[0]
        : PRELOADED_MISSIONS[2]);

  const matchedPreset: MissionPreset =
    customPromptText && customPromptText.trim().length > 0
      ? {
          ...baseMatch,
          title: customPromptText.trim().slice(0, 64),
          prompt: customPromptText.trim(),
        }
      : baseMatch.id === 'custom-mission' && missionIdOrCustom !== 'custom-mission'
        ? {
            ...baseMatch,
            title: missionIdOrCustom.trim().slice(0, 64),
            prompt: missionIdOrCustom.trim(),
          }
        : baseMatch;

  const isFinTech = matchedPreset.id === 'fintech-crypto';
  const isVideo = matchedPreset.id === 'ai-video-saas';
  const now = Date.now();

  const initialTasks: KanbanTaskCard[] = [
    {
      id: 'task-1',
      title: isFinTech
        ? 'Deconstruct Matching SLA & Custody Threat Model'
        : isVideo
          ? 'Scope WebCodecs Timeline & GPU Credit Economics'
          : 'Deconstruct Executive Spec & Acceptance Gates',
      description:
        'Break down prompt into deterministic engineering milestones, latency budgets, and security invariants.',
      stage: 'briefing',
      assignedAgentId: 'agent-manager',
      status: 'in_progress',
      priority: 'critical',
      progress: 15,
      tags: ['SLA', 'Scope', 'Executive'],
      updatedAt: now,
    },
    {
      id: 'task-2',
      title: isFinTech
        ? 'Synthesize Lock-Free Orderbook ADR & Mermaid Topology'
        : isVideo
          ? 'Design Temporal Diffusion Pipeline & Frame Graph'
          : 'Synthesize System Architecture & API Contracts',
      description:
        'Author Mermaid system topology, zero-trust boundary schemas, and backpressure state machine contracts.',
      stage: 'briefing',
      assignedAgentId: 'agent-architect',
      status: 'pending',
      priority: 'critical',
      progress: 0,
      tags: ['ADR-001', 'Mermaid', 'Contracts'],
      dependsOnAgentName: 'Sovereign (Executive Manager)',
      waitingReason: 'Waiting on Executive Manager SLA brief',
      updatedAt: now,
    },
    {
      id: 'task-3',
      title: isFinTech
        ? 'Build L2 Depth Canvas & Order Ticket UI'
        : isVideo
          ? 'Implement Multi-Track Keyframe Timeline Editor'
          : 'Build Reactive Telemetry Command Surface',
      description:
        'Implement 60fps dark obsidian frontend components with streaming WebSocket/SSE delta hydration & N+1 Intern Review.',
      stage: 'briefing',
      assignedAgentId: 'agent-frontend',
      status: 'pending',
      priority: 'high',
      progress: 0,
      tags: ['React 19', 'TypeScript', 'N+1 Review'],
      dependsOnAgentName: 'Aegis (Chief Architect)',
      waitingReason: 'Waiting on Chief Architect ADR-001 & UI schema',
      n1ReviewerId: 'agent-frontend',
      n1ReviewerName: 'Pulse (Senior Frontend)',
      n1ReviewStatus: 'approved',
      n1ReviewNote: 'N+1 Mentor Pulse verified & patched intern reactive hook before QA gate',
      updatedAt: now,
    },
    {
      id: 'task-4',
      title: isFinTech
        ? 'Implement Matching Core & Ed25519 Nonce Guard'
        : isVideo
          ? 'Build Distributed GPU Worker & Stripe Credit Ledger'
          : 'Implement Core Transactional Execution Service',
      description:
        'Write high-throughput backend engine with atomic state transitions, replay protection, and telemetry.',
      stage: 'briefing',
      assignedAgentId: 'agent-backend',
      status: 'pending',
      priority: 'critical',
      progress: 0,
      tags: ['Concurrency', 'Security', 'Engine'],
      dependsOnAgentName: 'Aegis (Chief Architect)',
      waitingReason: 'Waiting on Chief Architect ADR-001 contracts',
      updatedAt: now,
    },
    {
      id: 'task-5',
      title: 'Adversarial Security Audit, Fuzzing & Cryptographic Sign-Off',
      description:
        'Execute automated test matrix, verify replay/race-condition resistance, and issue SHA-256 QA Certificate.',
      stage: 'briefing',
      assignedAgentId: 'agent-qa',
      status: 'pending',
      priority: 'critical',
      progress: 0,
      tags: ['Security', 'Fuzzing', 'SHA-256'],
      dependsOnAgentName: 'Pulse & Titan (Senior Devs)',
      waitingReason: 'Waiting on Senior Devs multi-file code diffs',
      updatedAt: now,
    },
  ];

  const file1Diff = isFinTech
    ? `--- a/src/engine/orderbookMatcher.ts
+++ b/src/engine/orderbookMatcher.ts
@@ -1,6 +1,34 @@
-// Initial orderbook stub
-export class OrderBook {}
+export interface SignedLimitOrder {
+  orderId: string;
+  accountId: string;
+  side: 'BUY' | 'SELL';
+  priceMicros: bigint;
+  quantityLots: bigint;
+  nonce: number;
+  signatureHex: string;
+}
+
+export class DeterministicOrderBook {
+  private bids: SignedLimitOrder[] = [];
+  private asks: SignedLimitOrder[] = [];
+
+  public submitOrder(order: SignedLimitOrder): { matchedLots: bigint; latencyUs: number } {
+    const start = performance.now();
+    if (order.quantityLots <= 0n) {
+      throw new Error('INVALID_LOT_SIZE');
+    }
+    if (order.side === 'BUY') {
+      this.bids.push(order);
+      this.bids.sort((a, b) => Number(b.priceMicros - a.priceMicros));
+    } else {
+      this.asks.push(order);
+      this.asks.sort((a, b) => Number(a.priceMicros - b.priceMicros));
+    }
+    return {
+      matchedLots: order.quantityLots,
+      latencyUs: Math.round((performance.now() - start) * 1000),
+    };
+  }
+}`
    : `--- a/src/engine/renderPipeline.ts
+++ b/src/engine/renderPipeline.ts
@@ -1,4 +1,31 @@
-export const renderQueue = [];
+export interface VideoRenderJob {
+  jobId: string;
+  workspaceId: string;
+  fps: 30 | 60;
+  resolution: '1080p' | '4K';
+  prompt: string;
+  idempotencyKey: string;
+}
+
+export class TemporalRenderScheduler {
+  private activeJobs = new Map<string, VideoRenderJob>();
+
+  public enqueueRender(job: VideoRenderJob): { accepted: boolean; estimatedSec: number } {
+    if (!job.prompt.trim()) {
+      throw new Error('EMPTY_DIFFUSION_PROMPT');
+    }
+    this.activeJobs.set(job.jobId, job);
+    return {
+      accepted: true,
+      estimatedSec: job.resolution === '4K' ? 14 : 6,
+    };
+  }
+}`;

  const file2Diff = isFinTech
    ? `--- a/src/components/TradingDepthCanvas.tsx
+++ b/src/components/TradingDepthCanvas.tsx
@@ -1,3 +1,26 @@
-export default function TradingDepthCanvas() { return null; }
+import React from 'react';
+
+export interface DepthLevel {
+  price: number;
+  size: number;
+  cumulative: number;
+}
+
+export const TradingDepthCanvas: React.FC<{ bids: DepthLevel[]; asks: DepthLevel[] }> = ({
+  bids,
+  asks,
+}) => {
+  return (
+    <section className="rounded-xl bg-[#080811] border border-cyan-500/20 p-4 font-mono">
+      <header className="flex justify-between text-xs text-cyan-300 mb-3">
+        <span>L2 ORDERBOOK // SUB-MS STREAM</span>
+        <span>SPREAD: 0.01 BPS</span>
+      </header>
+      <div className="grid grid-cols-2 gap-4 text-xs">
+        <div className="text-emerald-400">BIDS: {bids.length} ACTIVE LEVELS</div>
+        <div className="text-rose-400">ASKS: {asks.length} ACTIVE LEVELS</div>
+      </div>
+    </section>
+  );
+};`
    : `--- a/src/components/TimelineTrackCanvas.tsx
+++ b/src/components/TimelineTrackCanvas.tsx
@@ -1,3 +1,24 @@
-export default function TimelineTrackCanvas() { return null; }
+import React from 'react';
+
+export interface KeyframeClip {
+  id: string;
+  label: string;
+  startFrame: number;
+  durationFrames: number;
+}
+
+export const TimelineTrackCanvas: React.FC<{ clips: KeyframeClip[]; playhead: number }> = ({
+  clips,
+  playhead,
+}) => {
+  return (
+    <section className="rounded-xl bg-[#080811] border border-purple-500/20 p-4 font-mono">
+      <header className="flex justify-between text-xs text-purple-300 mb-3">
+        <span>WEBCODECS NLE TIMELINE // 60 FPS</span>
+        <span>FRAME: {playhead}</span>
+      </header>
+      <div className="text-xs text-emerald-400">{clips.length} SYNCHRONIZED TRACK CLIPS</div>
+    </section>
+  );
+};`;

  const file3PatchDiff = isFinTech
    ? `--- a/src/security/replayNonceGuard.ts
+++ b/src/security/replayNonceGuard.ts
@@ -4,7 +4,22 @@
 export class ReplayNonceGuard {
-  public verifyNonce(accountId: string, nonce: number): boolean {
-    // TODO: enforce monotonic sliding window
-    return nonce > 0;
-  }
+  private lastNonceByAccount = new Map<string, number>();
+
+  public verifyAndCommitNonce(accountId: string, nonce: number, signatureHex: string): boolean {
+    if (!signatureHex || signatureHex.length < 64) {
+      throw new Error('UNSIGNED_ORDER_REJECTED');
+    }
+    const prev = this.lastNonceByAccount.get(accountId) ?? 0;
+    if (nonce <= prev) {
+      throw new Error(\`REPLAY_ATTACK_DETECTED: nonce \${nonce} <= \${prev}\`);
+    }
+    this.lastNonceByAccount.set(accountId, nonce);
+    return true;
+  }
 }`
    : `--- a/src/security/creditIdempotencyGuard.ts
+++ b/src/security/creditIdempotencyGuard.ts
@@ -3,6 +3,21 @@
 export class CreditIdempotencyGuard {
-  public reserveCredits(workspaceId: string, tokens: number): boolean {
-    return tokens > 0;
-  }
+  private seenKeys = new Set<string>();
+
+  public reserveCreditsAtomic(
+    workspaceId: string,
+    idempotencyKey: string,
+    credits: number
+  ): { reserved: boolean; deduplicated: boolean } {
+    const composite = \`\${workspaceId}:\${idempotencyKey}\`;
+    if (this.seenKeys.has(composite)) {
+      return { reserved: false, deduplicated: true };
+    }
+    if (credits <= 0 || credits > 10_000) {
+      throw new Error('QUOTA_BOUNDS_VIOLATION');
+    }
+    this.seenKeys.add(composite);
+    return { reserved: true, deduplicated: false };
+  }
 }`;

  const files: CodeDiffFile[] = [
    {
      id: 'diff-1',
      filePath: isFinTech ? 'src/engine/orderbookMatcher.ts' : 'src/engine/renderPipeline.ts',
      language: 'typescript',
      agentId: 'agent-backend',
      stage: 'implementation',
      additions: 28,
      deletions: 2,
      status: 'added',
      unifiedDiff: file1Diff,
      fullContent: file1Diff
        .split('\n')
        .filter((l) => !l.startsWith('---') && !l.startsWith('+++') && !l.startsWith('@@') && !l.startsWith('-'))
        .map((l) => (l.startsWith('+') ? l.slice(1) : l))
        .join('\n'),
      lines: parseUnifiedDiffLines(file1Diff),
      timestamp: now + 2000,
    },
    {
      id: 'diff-2',
      filePath: isFinTech
        ? 'src/components/TradingDepthCanvas.tsx'
        : 'src/components/TimelineTrackCanvas.tsx',
      language: 'tsx',
      agentId: 'agent-frontend',
      stage: 'implementation',
      additions: 24,
      deletions: 1,
      status: 'added',
      unifiedDiff: file2Diff,
      fullContent: file2Diff
        .split('\n')
        .filter((l) => !l.startsWith('---') && !l.startsWith('+++') && !l.startsWith('@@') && !l.startsWith('-'))
        .map((l) => (l.startsWith('+') ? l.slice(1) : l))
        .join('\n'),
      lines: parseUnifiedDiffLines(file2Diff),
      timestamp: now + 3000,
    },
    {
      id: 'diff-3',
      filePath: isFinTech
        ? 'src/security/replayNonceGuard.ts'
        : 'src/security/creditIdempotencyGuard.ts',
      language: 'typescript',
      agentId: 'agent-backend',
      stage: 'qa_review',
      additions: 16,
      deletions: 4,
      status: 'patched',
      unifiedDiff: file3PatchDiff,
      fullContent: file3PatchDiff
        .split('\n')
        .filter((l) => !l.startsWith('---') && !l.startsWith('+++') && !l.startsWith('@@') && !l.startsWith('-'))
        .map((l) => (l.startsWith('+') ? l.slice(1) : l))
        .join('\n'),
      lines: parseUnifiedDiffLines(file3PatchDiff),
      timestamp: now + 5000,
    },
  ];

  const commits: GitCommitEntry[] = [
    {
      id: 'commit-1',
      hash: '9f3c1a8',
      message: isFinTech
        ? 'docs(arch): ADR-001 lock-free LOB topology & Ed25519 custody boundaries'
        : 'docs(arch): ADR-001 WebCodecs NLE pipeline & GPU shard backpressure',
      authorAgentId: 'agent-architect',
      authorName: 'Aegis (Chief Architect)',
      stage: 'architecture',
      timestamp: now + 1500,
      additions: 142,
      deletions: 0,
      filesChanged: ['docs/architecture/ADR-001.md', 'schemas/contracts.ts'],
    },
    {
      id: 'commit-2',
      hash: '4b7e2d9',
      message: isFinTech
        ? 'feat(engine): deterministic price-time priority orderbook & L2 depth UI'
        : 'feat(studio): 60fps keyframe timeline canvas & GPU render dispatcher',
      authorAgentId: 'agent-backend',
      authorName: 'Titan (Senior Backend)',
      stage: 'implementation',
      timestamp: now + 3200,
      additions: 318,
      deletions: 14,
      filesChanged: [files[0].filePath, files[1].filePath],
    },
    {
      id: 'commit-3',
      hash: 'e81a5c4',
      message: isFinTech
        ? 'fix(security): enforce monotonic Ed25519 replay nonce window on order ingress'
        : 'fix(billing): enforce atomic composite idempotency key on GPU credit reserve',
      authorAgentId: 'agent-backend',
      authorName: 'Titan (Senior Backend)',
      stage: 'qa_review',
      timestamp: now + 5200,
      additions: 48,
      deletions: 6,
      filesChanged: [files[2].filePath],
      isPatch: true,
    },
  ];

  const certificate: QACertificateData = {
    certificateId: `CERT-${matchedPreset.id.toUpperCase()}-2026`,
    missionId: matchedPreset.id,
    missionTitle: matchedPreset.title,
    signedByAgentId: 'agent-qa',
    signedByName: 'Sentinel (QA & Security Director)',
    signedByModel: 'gemini-3-8-flash',
    sha256Hash:
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    timestamp: new Date().toISOString(),
    securityScore: 99.8,
    testsPassed: 148,
    testsTotal: 148,
    vulnerabilitiesFound: 1,
    vulnerabilitiesPatched: 1,
    zeroRegressionsCertified: true,
    summaryNotes: isFinTech
      ? 'Verified 148/148 invariants. Initial replay nonce gap identified during Stage 4 QA Debate and resolved in commit e81a5c4 with monotonic sliding-window guard. Sub-millisecond p99 latency confirmed.'
      : 'Verified 148/148 invariants. Initial duplicate webhook credit deduction race resolved in commit e81a5c4 via atomic composite idempotency lock. Zero memory leaks in 60fps WebCodecs canvas.',
  };

  const stageDurationsSec: Record<SOPStage, number> = {
    briefing: 12,
    architecture: 19,
    implementation: 34,
    qa_review: 23,
    shipped: 8,
  };

  const dossier: ExecutiveDossierData = {
    missionId: matchedPreset.id,
    missionTitle: matchedPreset.title,
    completedAt: new Date().toISOString(),
    durationSeconds: 96,
    totalTokensUsed: 48_920,
    totalCostUSD: 0.842,
    filesCreated: files.length,
    linesOfCode: 512,
    testsPassed: 148,
    testsTotal: 148,
    architectureScore: 99.4,
    velocityTps: 146,
    qaRejectionsResolved: 1,
    executiveSummary: `Autonomous execution of "${matchedPreset.title}" completed across all 5 SOP stages. Architecture synthesized via ADR-001 with full Mermaid topology. Implementation produced ${files.length} verified production modules. During Stage 4 Code Review & QA Debate, Sentinel flagged 1 critical security invariant which was autonomously patched in commit e81a5c4 and re-verified with 148/148 passing tests.`,
    mermaidDiagram: matchedPreset.mermaidDiagram,
    stageDurationsSec,
    modelDistribution: [
      {
        modelId: 'gemini-4-argon',
        modelName: 'Gemini 4 Argon',
        percentage: 22,
        tokens: 10_762,
        costUSD: 0.215,
      },
      {
        modelId: 'claude-opus-5-5',
        modelName: 'Claude Opus 5.5',
        percentage: 28,
        tokens: 13_698,
        costUSD: 0.412,
      },
      {
        modelId: 'claude-sonnet-5-5',
        modelName: 'Claude Sonnet 5.5',
        percentage: 24,
        tokens: 11_740,
        costUSD: 0.128,
      },
      {
        modelId: 'gemini-4-hydrogen',
        modelName: 'Gemini 4 Hydrogen',
        percentage: 18,
        tokens: 8_805,
        costUSD: 0.072,
      },
      {
        modelId: 'gemini-3-8-flash',
        modelName: 'Gemini 3.8 Flash',
        percentage: 8,
        tokens: 3_915,
        costUSD: 0.015,
      },
    ],
    internGrowthSummary: [
      {
        internId: 'agent-intern-1',
        name: 'Nova (AI Intern)',
        xpGained: 150,
        newLevel: 5,
        graduated: false,
      },
    ],
    certificate,
    generatedFiles: files,
  };

  const events: SimulationEvent[] = [
    // STAGE 1: BRIEFING
    {
      type: 'STEP_START',
      stage: 'briefing',
      agentId: 'agent-manager',
      description: `Deconstructing mission directive: "${matchedPreset.title}"`,
      progress: 10,
    },
    {
      type: 'AGENT_STATUS_CHANGED',
      agentId: 'agent-manager',
      status: 'thinking',
      currentTask: 'Synthesizing Executive Brief & SLA Gates',
      taskProgress: 45,
      waitingFor: null,
    },
    {
      type: 'AGENT_STATUS_CHANGED',
      agentId: 'agent-architect',
      status: 'idle',
      currentTask: 'Waiting on Executive Manager SLA brief',
      taskProgress: 0,
      waitingFor: {
        agentId: 'agent-manager',
        agentName: 'Sovereign',
        reason: 'Waiting on Executive Manager SLA brief',
      },
    },
    {
      type: 'SPEECH_BUBBLE',
      agentId: 'agent-manager',
      text: `Initializing SOP Stage 1: Deconstructing "${matchedPreset.title}" into verifiable milestones.`,
      bubbleType: 'speech',
    },
    {
      type: 'THOUGHT_CHUNK',
      agentId: 'agent-manager',
      thought: `Parsed mission constraints. Assigning ADR & Mermaid blueprint to Chief Architect (Aegis), UI surface to Nova-FE (Pulse), and core engine to Titan.`,
      tokensDelta: { prompt: 1850, completion: 920 },
    },
    {
      type: 'TERMINAL_LOG',
      level: 'info',
      agentId: 'agent-manager',
      stage: 'briefing',
      text: `[BRIEFING] Mission "${matchedPreset.title}" initialized. Target SLA: <1ms p99, 100% QA gate.`,
    },
    {
      type: 'BEAM_FIRED',
      beam: {
        fromAgentId: 'agent-manager',
        toAgentId: 'agent-architect',
        type: 'prompt',
        label: 'SPEC_DIRECTIVE',
        color: '#F59E0B',
      },
    },
    {
      type: 'TASK_UPDATED',
      task: {
        id: 'task-1',
        stage: 'briefing',
        status: 'completed',
        progress: 100,
      },
    },
    {
      type: 'INTERN_XP_GAINED',
      internId: 'agent-intern-1',
      xpDelta: 15,
      reason: 'Shadowed Executive Manager mission deconstruction & SLA scoping',
      skillUnlocked: 'Executive Spec Synthesis',
      seniorAgentId: 'agent-manager',
    },

    // STAGE 2: ARCHITECTURE
    {
      type: 'STEP_START',
      stage: 'architecture',
      agentId: 'agent-architect',
      description: 'Synthesizing System Architecture ADR-001 & Mermaid Topology',
      progress: 28,
    },
    {
      type: 'AGENT_STATUS_CHANGED',
      agentId: 'agent-manager',
      status: 'idle',
      currentTask: 'Monitoring Architecture Phase',
      taskProgress: 100,
    },
    {
      type: 'AGENT_STATUS_CHANGED',
      agentId: 'agent-architect',
      status: 'thinking',
      currentTask: 'Generating Mermaid Topology & Zero-Trust Contracts',
      taskProgress: 60,
      waitingFor: null,
    },
    {
      type: 'AGENT_STATUS_CHANGED',
      agentId: 'agent-frontend',
      status: 'idle',
      currentTask: 'Waiting on Chief Architect ADR-001 & UI schema',
      taskProgress: 0,
      waitingFor: {
        agentId: 'agent-architect',
        agentName: 'Aegis',
        reason: 'Waiting on Chief Architect ADR-001',
      },
    },
    {
      type: 'AGENT_STATUS_CHANGED',
      agentId: 'agent-backend',
      status: 'idle',
      currentTask: 'Waiting on Chief Architect ADR-001 contracts',
      taskProgress: 0,
      waitingFor: {
        agentId: 'agent-architect',
        agentName: 'Aegis',
        reason: 'Waiting on Chief Architect ADR-001',
      },
    },
    {
      type: 'TASK_UPDATED',
      task: {
        id: 'task-2',
        stage: 'architecture',
        status: 'in_progress',
        progress: 65,
      },
    },
    {
      type: 'SPEECH_BUBBLE',
      agentId: 'agent-architect',
      text: 'Synthesizing Mermaid system topology & strict TypeScript domain contracts.',
      bubbleType: 'thought',
    },
    {
      type: 'THOUGHT_CHUNK',
      agentId: 'agent-architect',
      thought: `Generated Mermaid graph and strict boundary contracts. Enforcing cryptographic signature verification before state mutation.`,
      tokensDelta: { prompt: 3400, completion: 2150 },
    },
    {
      type: 'MERMAID_UPDATED',
      mermaidDiagram: matchedPreset.mermaidDiagram,
    },
    {
      type: 'COMMIT_CREATED',
      commit: commits[0],
    },
    {
      type: 'TERMINAL_LOG',
      level: 'info',
      agentId: 'agent-architect',
      stage: 'architecture',
      text: `[ARCHITECT] Committed ${commits[0].hash}: ${commits[0].message}`,
    },
    {
      type: 'BEAM_FIRED',
      beam: {
        fromAgentId: 'agent-architect',
        toAgentId: 'agent-backend',
        type: 'architecture',
        label: 'ADR_CONTRACTS',
        color: '#A855F7',
      },
    },
    {
      type: 'BEAM_FIRED',
      beam: {
        fromAgentId: 'agent-architect',
        toAgentId: 'agent-frontend',
        type: 'architecture',
        label: 'UI_SCHEMA',
        color: '#00F0FF',
      },
    },
    {
      type: 'TASK_UPDATED',
      task: {
        id: 'task-2',
        stage: 'architecture',
        status: 'completed',
        progress: 100,
        commitHash: commits[0].hash,
      },
    },
    {
      type: 'INTERN_XP_GAINED',
      internId: 'agent-intern-1',
      xpDelta: 25,
      reason: 'Observed Chief System Architect ADR & Mermaid topology synthesis',
      skillUnlocked: 'System Blueprinting & ADRs',
      seniorAgentId: 'agent-architect',
    },

    // STAGE 3: IMPLEMENTATION
    {
      type: 'STEP_START',
      stage: 'implementation',
      agentId: 'agent-backend',
      description: 'Multi-File Production Implementation & Compiler Verification',
      progress: 52,
    },
    {
      type: 'AGENT_STATUS_CHANGED',
      agentId: 'agent-architect',
      status: 'idle',
      currentTask: 'ADR-001 Signed Off',
      taskProgress: 100,
    },
    {
      type: 'AGENT_STATUS_CHANGED',
      agentId: 'agent-backend',
      status: 'coding',
      currentTask: `Implementing ${files[0].filePath}`,
      taskProgress: 50,
      waitingFor: null,
    },
    {
      type: 'AGENT_STATUS_CHANGED',
      agentId: 'agent-frontend',
      status: 'coding',
      currentTask: `Implementing ${files[1].filePath} + N+1 Intern Review`,
      taskProgress: 55,
      waitingFor: null,
    },
    {
      type: 'AGENT_STATUS_CHANGED',
      agentId: 'agent-qa',
      status: 'idle',
      currentTask: 'Waiting on Senior Devs multi-file code diffs',
      taskProgress: 0,
      waitingFor: {
        agentId: 'agent-backend',
        agentName: 'Pulse & Titan',
        reason: 'Waiting on Senior Devs code diffs',
      },
    },
    {
      type: 'TASK_UPDATED',
      task: {
        id: 'task-3',
        stage: 'implementation',
        status: 'in_progress',
        progress: 60,
        n1ReviewStatus: 'reviewing',
        n1ReviewNote: 'N+1 Senior Mentor Pulse reviewing Intern Nova reactive stream hook...',
      },
    },
    {
      type: 'TERMINAL_LOG',
      level: 'warn',
      agentId: 'agent-frontend',
      stage: 'implementation',
      text: `[N+1 MENTOR REVIEW] Senior Mentor Pulse inspected Intern Nova's draft hook -> Caught stale frame closure bug & co-authored fix!`,
    },
    {
      type: 'BEAM_FIRED',
      beam: {
        fromAgentId: 'agent-frontend',
        toAgentId: 'agent-intern-1',
        type: 'mentorship',
        label: 'N+1_BUG_FIX_VERIFIED',
        color: '#38BDF8',
      },
    },
    {
      type: 'TASK_UPDATED',
      task: {
        id: 'task-3',
        stage: 'implementation',
        status: 'in_progress',
        progress: 85,
        n1ReviewStatus: 'bug_fixed',
        n1ReviewNote: 'N+1 Mentor Pulse fixed stale closure bug in Nova draft & approved promotion to QA',
      },
    },
    {
      type: 'TASK_UPDATED',
      task: {
        id: 'task-4',
        stage: 'implementation',
        status: 'in_progress',
        progress: 70,
      },
    },
    {
      type: 'SPEECH_BUBBLE',
      agentId: 'agent-backend',
      text: `Writing deterministic core in ${files[0].filePath} with zero heap allocations on hot path.`,
      bubbleType: 'speech',
    },
    {
      type: 'CODE_DIFF_READY',
      file: files[0],
    },
    {
      type: 'THOUGHT_CHUNK',
      agentId: 'agent-frontend',
      thought: `Hydrating 60fps dark obsidian component ${files[1].filePath} with zero layout shift.`,
      tokensDelta: { prompt: 4100, completion: 2890 },
    },
    {
      type: 'SPEECH_BUBBLE',
      agentId: 'agent-frontend',
      text: `Mounted ${files[1].filePath} with hardware-accelerated stream rendering.`,
      bubbleType: 'speech',
    },
    {
      type: 'CODE_DIFF_READY',
      file: files[1],
    },
    {
      type: 'TERMINAL_LOG',
      level: 'cmd',
      agentId: 'agent-backend',
      stage: 'implementation',
      text: `$ npx tsc --noEmit && vite build --mode production`,
    },
    {
      type: 'TERMINAL_LOG',
      level: 'info',
      agentId: 'agent-backend',
      stage: 'implementation',
      text: `[COMPILER] TypeScript 5.8.3 check passed (0 errors). Bundle size: 184.2 kB gzipped.`,
    },
    {
      type: 'COMMIT_CREATED',
      commit: commits[1],
    },
    {
      type: 'BEAM_FIRED',
      beam: {
        fromAgentId: 'agent-backend',
        toAgentId: 'agent-qa',
        type: 'code_diff',
        label: 'DIFF_FOR_AUDIT',
        color: '#10B981',
      },
    },
    {
      type: 'TASK_UPDATED',
      task: {
        id: 'task-3',
        stage: 'implementation',
        status: 'completed',
        progress: 100,
        commitHash: commits[1].hash,
        n1ReviewStatus: 'approved',
        n1ReviewNote: 'N+1 Mentor Pulse approved Intern Nova contribution after bug fix',
      },
    },
    {
      type: 'TASK_UPDATED',
      task: {
        id: 'task-4',
        stage: 'implementation',
        status: 'completed',
        progress: 100,
        commitHash: commits[1].hash,
      },
    },
    {
      type: 'INTERN_XP_GAINED',
      internId: 'agent-intern-1',
      xpDelta: 50,
      reason: 'Assisted Senior Engineers on multi-file code diffs & build verification',
      skillUnlocked: 'Production Code Diff Generation',
      seniorAgentId: 'agent-frontend',
    },

    // STAGE 4: CODE REVIEW & QA DEBATE (WITH REJECT LOOPBACK -> PATCH -> APPROVAL)
    {
      type: 'STEP_START',
      stage: 'qa_review',
      agentId: 'agent-qa',
      description: 'Adversarial Security Fuzzing & QA Debate Loop',
      progress: 72,
    },
    {
      type: 'AGENT_STATUS_CHANGED',
      agentId: 'agent-frontend',
      status: 'idle',
      currentTask: 'Waiting on QA & Security Director sign-off',
      taskProgress: 100,
      waitingFor: {
        agentId: 'agent-qa',
        agentName: 'Sentinel',
        reason: 'Waiting on Tester security sign-off',
      },
    },
    {
      type: 'AGENT_STATUS_CHANGED',
      agentId: 'agent-qa',
      status: 'reviewing',
      currentTask: 'Running adversarial security fuzzing & invariant suite',
      taskProgress: 50,
      waitingFor: null,
    },
    {
      type: 'TASK_UPDATED',
      task: {
        id: 'task-5',
        stage: 'qa_review',
        status: 'in_progress',
        progress: 45,
      },
    },
    {
      type: 'TERMINAL_LOG',
      level: 'cmd',
      agentId: 'agent-qa',
      stage: 'qa_review',
      text: `$ vitest run --reporter=verbose && sentinel-fuzz --target=${files[0].filePath}`,
    },
    {
      type: 'QA_DEBATE_MESSAGE',
      debate: {
        id: 'debate-1',
        agentId: 'agent-qa',
        agentName: 'Sentinel (QA Director)',
        role: 'qa',
        verdict: 'reject',
        message: isFinTech
          ? 'HOLD RELEASE: Replay fuzzer detected non-monotonic nonce acceptance in ingress guard. An attacker replaying a signed packet could duplicate fills.'
          : 'HOLD RELEASE: Concurrency fuzzer detected duplicate Stripe credit deduction when retry webhooks arrive within 5ms window.',
        timestamp: now + 4500,
        targetFile: files[2].filePath,
      },
    },
    {
      type: 'QA_REJECT_LOOPBACK',
      reason: isFinTech
        ? 'Missing monotonic sliding-window nonce verification in replayNonceGuard.ts'
        : 'Missing composite idempotency key lock in creditIdempotencyGuard.ts',
      returnToStage: 'implementation',
      patchCommitNeeded: true,
      fromAgentId: 'agent-qa',
      toAgentId: 'agent-backend',
    },
    {
      type: 'SPEECH_BUBBLE',
      agentId: 'agent-qa',
      text: '🚨 QA REJECT LOOPBACK: Security invariant violation detected! Looping back to Dev Bay for hotfix.',
      bubbleType: 'alert',
    },
    {
      type: 'TERMINAL_LOG',
      level: 'qa_reject',
      agentId: 'agent-qa',
      stage: 'qa_review',
      text: `[QA REJECT] Security audit blocked release: ${files[2].filePath} failed replay invariant check. Triggering loopback to Senior Backend.`,
    },
    {
      type: 'AGENT_STATUS_CHANGED',
      agentId: 'agent-backend',
      status: 'coding',
      currentTask: `Patching security invariant in ${files[2].filePath}`,
      taskProgress: 85,
    },
    {
      type: 'SPEECH_BUBBLE',
      agentId: 'agent-backend',
      text: `Applying atomic security patch in ${files[2].filePath} & pushing hotfix commit.`,
      bubbleType: 'speech',
    },
    {
      type: 'CODE_DIFF_READY',
      file: files[2],
    },
    {
      type: 'COMMIT_CREATED',
      commit: commits[2],
    },
    {
      type: 'QA_DEBATE_MESSAGE',
      debate: {
        id: 'debate-2',
        agentId: 'agent-backend',
        agentName: 'Titan (Senior Backend)',
        role: 'backend',
        verdict: 'patch',
        message: `Pushed hotfix commit ${commits[2].hash} (${files[2].filePath}). Enforced strict monotonic guard & signature length check.`,
        timestamp: now + 5100,
        targetFile: files[2].filePath,
      },
    },
    {
      type: 'BEAM_FIRED',
      beam: {
        fromAgentId: 'agent-backend',
        toAgentId: 'agent-qa',
        type: 'code_diff',
        label: 'HOTFIX_PATCH_e81a5c4',
        color: '#00F0FF',
      },
    },
    {
      type: 'TERMINAL_LOG',
      level: 'qa_pass',
      agentId: 'agent-qa',
      stage: 'qa_review',
      text: `[QA PASS] Re-ran 148/148 test suites + adversarial fuzzing on commit ${commits[2].hash}: ZERO vulnerabilities, 0 regressions.`,
    },
    {
      type: 'QA_DEBATE_MESSAGE',
      debate: {
        id: 'debate-3',
        agentId: 'agent-qa',
        agentName: 'Sentinel (QA Director)',
        role: 'qa',
        verdict: 'approve',
        message:
          '148/148 tests green. Replay vector mitigated. Issuing cryptographic SHA-256 QA Sign-Off Certificate.',
        timestamp: now + 5600,
        targetFile: files[2].filePath,
      },
    },
    {
      type: 'QA_APPROVAL_PULSE',
      certificate,
    },
    {
      type: 'SPEECH_BUBBLE',
      agentId: 'agent-qa',
      text: '✅ QA APPROVED! 148/148 tests passed. Cryptographic SHA-256 certificate issued.',
      bubbleType: 'approval',
    },
    {
      type: 'TASK_UPDATED',
      task: {
        id: 'task-5',
        stage: 'qa_review',
        status: 'completed',
        progress: 100,
        commitHash: commits[2].hash,
      },
    },
    {
      type: 'INTERN_XP_GAINED',
      internId: 'agent-intern-1',
      xpDelta: 35,
      reason: 'Observed QA & Security Director vulnerability audit & patch verification',
      skillUnlocked: 'Security Audit & Loopback Resolution',
      seniorAgentId: 'agent-qa',
    },

    // STAGE 5: SHIPPED & EXECUTIVE DOSSIER
    {
      type: 'STEP_START',
      stage: 'shipped',
      agentId: 'agent-manager',
      description: 'Production Release Shipped & Executive Dossier Compiled',
      progress: 100,
    },
    {
      type: 'BEAM_FIRED',
      beam: {
        fromAgentId: 'agent-qa',
        toAgentId: 'agent-manager',
        type: 'qa_approve',
        label: 'QA_CERTIFIED_SHA256',
        color: '#10B981',
      },
    },
    {
      type: 'INTERN_XP_GAINED',
      internId: 'agent-intern-1',
      xpDelta: 25,
      reason: 'Participated in final release packaging & Executive Dossier attestation',
      skillUnlocked: 'Zero-Defect Release Governance',
      seniorAgentId: 'agent-manager',
    },
    {
      type: 'TERMINAL_LOG',
      level: 'qa_pass',
      agentId: 'agent-manager',
      stage: 'shipped',
      text: `[SHIPPED] Executive Dossier compiled for "${matchedPreset.title}". All 5 SOP stages complete.`,
    },
    {
      type: 'SPEECH_BUBBLE',
      agentId: 'agent-manager',
      text: `Mission "${matchedPreset.title}" shipped! Executive Dossier & QA Certificate ready for inspection.`,
      bubbleType: 'approval',
    },
    {
      type: 'MISSION_COMPLETE',
      dossier,
    },
  ];

  return {
    preset: matchedPreset,
    initialTasks,
    events,
    files,
    commits,
    certificate,
    dossier,
  };
}
