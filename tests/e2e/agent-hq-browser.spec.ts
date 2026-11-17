import { test, expect, Page } from '@playwright/test';

interface ErrorTrap {
  consoleErrors: string[];
  pageErrors: string[];
  failedResponses: string[];
}

function attachErrorTraps(page: Page): ErrorTrap {
  const trap: ErrorTrap = {
    consoleErrors: [],
    pageErrors: [],
    failedResponses: [],
  };

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      trap.consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    trap.pageErrors.push(err.message || String(err));
  });

  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().includes('favicon.ico')) {
      trap.failedResponses.push(`${res.status()} ${res.url()}`);
    }
  });

  return trap;
}

function assertNoErrors(trap: ErrorTrap) {
  expect(trap.consoleErrors, `Console errors: ${trap.consoleErrors.join('; ')}`).toHaveLength(0);
  expect(trap.pageErrors, `Uncaught page errors: ${trap.pageErrors.join('; ')}`).toHaveLength(0);
  expect(trap.failedResponses, `Failed HTTP responses: ${trap.failedResponses.join('; ')}`).toHaveLength(0);
}

async function selectLuxuryOption(page: Page, testId: string, optionValue: string) {
  await page.getByTestId(testId).click();
  await page.getByTestId(`${testId}-menu`).waitFor({ state: 'visible' });
  await page.getByTestId(`${testId}-option-${optionValue}`).click();
}

async function assertZeroNativeSelects(page: Page, contextLabel: string) {
  const count = await page.locator('select').count();
  expect(count, `Expected 0 native <select> elements in ${contextLabel}, found ${count}`).toBe(0);
}

async function assertTopNavTabsUnclipped(page: Page, contextLabel: string) {
  const check = await page.evaluate(() => {
    const header = document.querySelector('[data-testid="top-hud-header"]') as HTMLElement | null;
    const tablist = header?.querySelector('[role="tablist"]') as HTMLElement | null;
    const tabs = Array.from(document.querySelectorAll('[data-testid^="nav-tab-"]')) as HTMLElement[];
    const vw = window.innerWidth;
    const clippedTabs = tabs
      .filter((t) => {
        const r = t.getBoundingClientRect();
        return r.width <= 0 || r.left < 0 || r.right > vw + 1;
      })
      .map((t) => t.getAttribute('data-testid'));
    return {
      vw,
      headerScrollWidth: header ? header.scrollWidth : 0,
      headerClientWidth: header ? header.clientWidth : 0,
      tablistScrollWidth: tablist ? tablist.scrollWidth : 0,
      tablistClientWidth: tablist ? tablist.clientWidth : 0,
      tabCount: tabs.length,
      clippedTabs,
    };
  });
  expect(check.tabCount, `Expected 4 nav tabs in ${contextLabel}`).toBe(4);
  expect(
    check.tablistScrollWidth,
    `Tablist clipped in ${contextLabel} (${check.tablistScrollWidth} > ${check.tablistClientWidth})`
  ).toBeLessThanOrEqual(check.tablistClientWidth + 1);
  expect(
    check.headerScrollWidth,
    `Header overflowed in ${contextLabel} (${check.headerScrollWidth} > ${check.vw})`
  ).toBeLessThanOrEqual(check.vw + 1);
  expect(check.clippedTabs, `Clipped tabs in ${contextLabel}: ${check.clippedTabs.join(',')}`).toHaveLength(0);
}

async function assertNoHeadingOverlap(page: Page, contextLabel: string) {
  const overlaps = await page.evaluate(() => {
    const issues: string[] = [];
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'));
    for (const h of headings) {
      const hRect = h.getBoundingClientRect();
      if (hRect.width === 0 || hRect.height === 0) continue;
      const next = h.nextElementSibling;
      if (!next) continue;
      const tag = next.tagName.toLowerCase();
      if (tag === 'p' || tag === 'span' || tag === 'div') {
        const nRect = next.getBoundingClientRect();
        if (nRect.width === 0 || nRect.height === 0) continue;
        // Check vertical overlap when stacked in same column
        const horizontalOverlap =
          Math.min(hRect.right, nRect.right) - Math.max(hRect.left, nRect.left) > 4;
        if (horizontalOverlap && hRect.bottom > nRect.top + 2 && hRect.top < nRect.top) {
          issues.push(
            `"${(h.textContent || '').trim().slice(0, 30)}" overlaps "${(next.textContent || '')
              .trim()
              .slice(0, 30)}"`
          );
        }
      }
    }
    return issues;
  });
  expect(overlaps, `Heading overlaps in ${contextLabel}: ${overlaps.join('; ')}`).toHaveLength(0);
}

test.describe('Agent-HQ Developer Studio E2E Verification', () => {
  test('1. Default Workspace & Boss IDE (Tab 1), File Explorer, Upload, Code/Diff, Console & Boss Chat', async ({ page }) => {
    const trap = attachErrorTraps(page);
    await page.goto('/');

    const root = page.getByTestId('agent-hq-root');
    await expect(root).toBeVisible();
    await expect(page.getByTestId('top-hud-header')).toBeVisible();

    // Default active tab is Workspace & Boss IDE
    await expect(page.getByTestId('workspace-ide-view')).toBeVisible();
    await assertZeroNativeSelects(page, 'Workspace & Boss IDE');
    await assertNoHeadingOverlap(page, 'Workspace & Boss IDE');

    // Left File Explorer & Search
    const explorer = page.getByTestId('ide-file-explorer');
    await expect(explorer).toBeVisible();
    await expect(explorer.getByTestId('ide-tree-file-page.tsx')).toBeVisible();
    await expect(explorer.getByTestId('ide-tree-file-schema.prisma')).toBeVisible();
    await expect(explorer.getByTestId('ide-tree-file-api.ts')).toBeVisible();
    await expect(explorer.getByTestId('ide-tree-file-Architecture.md')).toBeVisible();

    await page.getByTestId('ide-file-search').fill('schema');
    await expect(explorer.getByTestId('ide-tree-file-schema.prisma')).toBeVisible();
    await page.getByTestId('ide-file-search').fill('');

    // Multi-Tab Code Editor & Diff toggle
    await expect(page.getByTestId('ide-editor-tabs')).toBeVisible();
    await page.getByTestId('ide-tab-schema.prisma').click();
    await page.getByTestId('ide-tab-api.ts').click();
    await page.getByTestId('ide-tab-Architecture.md').click();
    await page.getByTestId('ide-tab-page.tsx').click();
    await expect(page.getByTestId('ide-code-editor')).toBeVisible();

    await page.getByTestId('ide-editor-mode-diff').click();
    await page.getByTestId('ide-editor-mode-code').click();

    // File upload / Attach Sample Spec -> opens feature-spec.md & sends to Boss
    await page.getByTestId('ide-attach-sample-btn').click();
    await expect(explorer.getByTestId('ide-tree-file-feature-spec.md')).toBeVisible();
    await expect(page.getByTestId('ide-tab-feature-spec.md')).toBeVisible();
    await expect(page.getByTestId('boss-chat-messages')).toContainText(/feature-spec\.md/i);

    // Real file input upload via setInputFiles
    await page.getByTestId('ide-file-upload-input').setInputFiles({
      name: 'edge-gateway.ts',
      mimeType: 'text/typescript',
      buffer: Buffer.from('export const gatewayVersion = "2.5.0";\n'),
    });
    await expect(explorer.getByTestId('ide-tree-file-edge-gateway.ts')).toBeVisible();

    // Bottom Console Tabs
    await expect(page.getByTestId('ide-bottom-console')).toBeVisible();
    await page.getByTestId('ide-console-tab-logs').click();
    await page.getByTestId('ide-console-tab-problems').click();
    await page.getByTestId('ide-console-tab-terminal').click();

    // Boss Chat & Boss Model Selector (LuxurySelect)
    await expect(page.getByTestId('ide-boss-chat-pane')).toBeVisible();
    await selectLuxuryOption(page, 'boss-model-select', 'claude-opus-5-5');
    await expect(page.getByTestId('boss-model-select')).toContainText('Claude Opus 5.5');
    await page.getByTestId('boss-chat-input').fill('Review edge-gateway.ts and summarize squad dependencies');
    await page.getByTestId('boss-chat-send').click();
    await expect(page.getByTestId('boss-chat-messages')).toContainText(/edge-gateway\.ts/i);

    assertNoErrors(trap);
  });

  test('2. Studio Dark/Light Theme Toggle, 4 Top-Nav Tabs, Spatial Office & Split-Screen', async ({ page }) => {
    const trap = attachErrorTraps(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    const root = page.getByTestId('agent-hq-root');
    await expect(root).toBeVisible();

    // Dark Studio (#09090B) -> Light Studio (#F8FAFC) -> Dark Studio (#09090B)
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
    expect(await root.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(9, 9, 11)');

    await page.getByTestId('theme-toggle-btn').click();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
    expect(await root.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(248, 250, 252)');
    await assertNoHeadingOverlap(page, 'Light Mode Workspace');

    await page.getByTestId('theme-toggle-btn').click();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');

    // Tab 2: Team & Neural Map (Hierarchy Map + Spatial Office sub-mode)
    await page.getByTestId('nav-tab-canvas').click();
    await expect(page.getByTestId('neural-canvas-view')).toBeVisible();
    await expect(page.getByTestId('canvas-node-agent-manager')).toBeVisible();
    await expect(page.getByTestId('canvas-node-agent-architect')).toBeVisible();
    await expect(page.getByTestId('canvas-node-agent-frontend')).toBeVisible();
    await expect(page.getByTestId('canvas-node-agent-backend')).toBeVisible();
    await expect(page.getByTestId('canvas-node-agent-qa')).toBeVisible();
    await expect(page.getByTestId('canvas-minimap')).toBeVisible();
    await assertNoHeadingOverlap(page, 'Neural Canvas');

    await page.getByTestId('neural-submode-office').click();
    await expect(page.getByTestId('cyber-office-view')).toBeVisible();
    await expect(page.getByTestId('office-room-Executive Suite')).toBeVisible();
    await expect(page.getByTestId('office-room-Architecture Lab')).toBeVisible();
    await expect(page.getByTestId('office-room-Dev Bay')).toBeVisible();
    await expect(page.getByTestId('office-room-QA Vault')).toBeVisible();
    await expect(page.getByTestId('office-room-Incubator Pod')).toBeVisible();
    await page.getByTestId('office-mode-blueprint').click();
    await page.getByTestId('office-mode-isometric').click();
    await page.getByTestId('neural-submode-canvas').click();
    await expect(page.getByTestId('neural-canvas-view')).toBeVisible();

    // Tab 3: Tasks & Kanban Board + Strict Equal-Height Bottom Cards Alignment
    await page.getByTestId('nav-tab-kanban').click();
    await expect(page.getByTestId('kanban-view')).toBeVisible();
    await expect(page.getByTestId('sop-stage-timeline')).toBeVisible();
    await expect(page.getByTestId('kanban-col-briefing')).toBeVisible();
    await expect(page.getByTestId('kanban-col-architecture')).toBeVisible();
    await expect(page.getByTestId('kanban-col-implementation')).toBeVisible();
    await expect(page.getByTestId('kanban-col-qa_review')).toBeVisible();
    await expect(page.getByTestId('kanban-col-shipped')).toBeVisible();
    await assertNoHeadingOverlap(page, 'Kanban View');

    const kLeft = await page.getByTestId('kanban-bottom-left-card').boundingBox();
    const kRight = await page.getByTestId('kanban-bottom-right-card').boundingBox();
    expect(kLeft).not.toBeNull();
    expect(kRight).not.toBeNull();
    if (kLeft && kRight) {
      const kDiff = Math.abs((kLeft.y + kLeft.height) - (kRight.y + kRight.height));
      expect(kDiff, `Kanban bottom card alignment diff=${kDiff}px`).toBeLessThanOrEqual(2);
    }

    // Tab 4: Executive Report + Strict Equal-Height Bottom Cards Alignment
    await page.getByTestId('nav-tab-boardroom').click();
    await expect(page.getByTestId('boardroom-view')).toBeVisible();
    await expect(page.getByTestId('boardroom-manager-desk')).toBeVisible();
    await expect(page.getByTestId('boardroom-mission-launcher')).toBeVisible();
    await expect(page.getByTestId('boardroom-source-browser')).toBeVisible();
    await expect(page.getByTestId('boardroom-qa-card')).toBeVisible();
    await assertNoHeadingOverlap(page, 'Boardroom View');

    const bLeft = await page.getByTestId('boardroom-source-browser').boundingBox();
    const bRight = await page.getByTestId('boardroom-qa-card').boundingBox();
    expect(bLeft).not.toBeNull();
    expect(bRight).not.toBeNull();
    if (bLeft && bRight) {
      const bDiff = Math.abs((bLeft.y + bLeft.height) - (bRight.y + bRight.height));
      expect(bDiff, `Boardroom bottom card alignment diff=${bDiff}px`).toBeLessThanOrEqual(2);
    }

    // Split-Screen Mode with LuxurySelect
    await page.getByTestId('header-split-toggle').click();
    await expect(page.getByTestId('split-screen-container')).toBeVisible();
    await assertZeroNativeSelects(page, 'Split-Screen Container');

    const leftPane = page.getByTestId('split-pane-left');
    const rightPane = page.getByTestId('split-pane-right');
    await selectLuxuryOption(page, 'split-left-select', 'workspace');
    await selectLuxuryOption(page, 'split-right-select', 'canvas');
    await expect(leftPane.getByTestId('workspace-ide-view')).toBeVisible();
    await expect(rightPane.getByTestId('neural-canvas-view')).toBeVisible();

    const leftBox = await leftPane.boundingBox();
    const rightBox = await rightPane.boundingBox();
    expect(leftBox).not.toBeNull();
    expect(rightBox).not.toBeNull();
    if (leftBox && rightBox) {
      expect(leftBox.x + leftBox.width).toBeLessThanOrEqual(rightBox.x + 2);
    }

    await page.getByTestId('close-split-screen').click();
    await expect(page.getByTestId('split-screen-container')).toBeHidden();

    // Verify 1440x900, 1655x930, and 1008x760 header nav tabs unclipped + compact equal-height cards
    await assertTopNavTabsUnclipped(page, '1440x900');

    await page.setViewportSize({ width: 1655, height: 930 });
    await assertTopNavTabsUnclipped(page, '1655x930');

    await page.setViewportSize({ width: 1008, height: 760 });
    await assertTopNavTabsUnclipped(page, '1008x760');
    await page.getByTestId('nav-tab-workspace').click();
    await expect(page.getByTestId('workspace-ide-view')).toBeVisible();
    await expect(page.getByTestId('ide-editor-mode-code')).toBeVisible();
    await expect(page.getByTestId('ide-send-current-file-btn')).toBeVisible();

    await page.getByTestId('nav-tab-boardroom').click();
    const bLeftCompact = await page.getByTestId('boardroom-source-browser').boundingBox();
    const bRightCompact = await page.getByTestId('boardroom-qa-card').boundingBox();
    expect(bLeftCompact).not.toBeNull();
    expect(bRightCompact).not.toBeNull();
    if (bLeftCompact && bRightCompact) {
      const compactDiff = Math.abs(
        bLeftCompact.y + bLeftCompact.height - (bRightCompact.y + bRightCompact.height)
      );
      expect(compactDiff, `Boardroom 1008px bottom diff=${compactDiff}px`).toBeLessThanOrEqual(2);
    }

    assertNoErrors(trap);
  });

  test('3. Company Roster, Agent Inspector Drawer & Dynamic Model Routing via LuxurySelect', async ({ page }) => {
    const trap = attachErrorTraps(page);
    await page.goto('/');
    await page.getByTestId('nav-tab-canvas').click();

    await page.getByTestId('open-roster-btn').click();
    const roster = page.getByTestId('roster-drawer');
    await expect(roster).toBeVisible();
    await assertZeroNativeSelects(page, 'Roster Drawer');
    await expect(roster.getByTestId('roster-card-agent-manager')).toBeVisible();

    await selectLuxuryOption(page, 'roster-model-agent-manager', 'claude-opus-5-5');
    await expect(page.getByTestId('canvas-node-agent-manager')).toContainText('Opus 5.5');

    await page.getByRole('button', { name: 'Close roster' }).click();
    await page.getByTestId('canvas-node-agent-manager').click();

    const inspector = page.getByTestId('agent-inspector');
    await expect(inspector).toBeVisible();
    await assertZeroNativeSelects(page, 'Agent Inspector Drawer');
    await expect(inspector.getByTestId('model-select')).toContainText('Claude Opus 5.5');

    await page.getByTestId('model-select').click();
    const modelMenu = page.getByTestId('model-select-menu');
    await expect(modelMenu).toBeVisible();
    const menuMetrics = await modelMenu.evaluate((el) => {
      const inner = el.firstElementChild as HTMLElement | null;
      return {
        offsetWidth: el.offsetWidth,
        overflowY: inner ? inner.scrollHeight - inner.clientHeight : 0,
      };
    });
    expect(menuMetrics.offsetWidth).toBeGreaterThanOrEqual(240);
    expect(menuMetrics.overflowY).toBeLessThanOrEqual(2);
    await page.getByTestId('model-select-option-gpt-5-4-pro').click();
    await expect(page.getByTestId('canvas-node-agent-manager')).toContainText('GPT-5.4 Pro');

    await selectLuxuryOption(page, 'model-select', 'gemini-4-argon');
    await expect(page.getByTestId('canvas-node-agent-manager')).toContainText('Gemini 4 Argon');

    await page.getByTestId('close-inspector').click();

    await page.getByTestId('model-routing-btn').click();
    await expect(page.getByTestId('model-routing-popover')).toBeVisible();
    await page.getByTestId('model-routing-popover').getByText('Sovereign').click();
    await expect(page.getByTestId('model-selector-modal')).toBeVisible();
    await assertZeroNativeSelects(page, 'Model Selector Modal');
    await page.getByTestId('model-option-claude-opus-5-5').click();
    await expect(page.getByTestId('canvas-node-agent-manager')).toContainText('Opus 5.5');

    assertNoErrors(trap);
  });

  test('4. AI Ecosystem, Subscriptions, CLI Bridges & MCP Integrations Hub', async ({ page }) => {
    const trap = attachErrorTraps(page);
    await page.goto('/');

    const openBtn = page.getByTestId('open-integrations-btn');
    await openBtn.click();

    const modal = page.getByTestId('integrations-modal');
    await expect(modal).toBeVisible();
    await assertZeroNativeSelects(page, 'Integrations Hub Modal');

    await modal.getByTestId('scan-local-clis-btn').click();
    await modal.getByTestId('connect-subscription-anthropic').click();
    await expect(modal.getByTestId('provider-status-anthropic')).toContainText('Connected');

    await modal.getByTestId('connect-subscription-openai').click();
    await expect(modal.getByTestId('provider-status-openai')).toContainText('Connected');

    const mcpToggle = modal.getByTestId('mcp-toggle-mcp-github');
    const beforeMcpText = (await mcpToggle.textContent()) || '';
    await mcpToggle.click();
    const afterMcpText = (await mcpToggle.textContent()) || '';
    expect(afterMcpText).not.toBe(beforeMcpText);

    await modal.getByTestId('close-integrations-modal').click();
    await expect(modal).toBeHidden();

    assertNoErrors(trap);
  });

  test('5. Internship Growth, Onboarding (LuxurySelect) & Graduation', async ({ page }) => {
    const trap = attachErrorTraps(page);
    await page.goto('/');

    await page.getByTestId('onboard-intern-btn').click();
    const modal = page.getByTestId('intern-modal');
    await expect(modal).toBeVisible();
    await assertZeroNativeSelects(page, 'Intern Growth Modal');

    await modal.getByTestId('intern-name').fill('Spark');
    await modal.getByTestId('intern-specialty-Backend').click();
    await selectLuxuryOption(page, 'intern-mentor', 'agent-backend');
    await selectLuxuryOption(page, 'intern-model', 'claude-sonnet-5-5');
    await modal.getByTestId('confirm-onboard-intern').click();
    await expect(modal).toContainText('Spark');

    await modal.getByTestId('graduate-agent-intern-2').click();
    await expect(modal.getByTestId('intern-card-agent-intern-2')).toContainText(/Graduated/i);

    await modal.getByRole('button', { name: 'Close' }).click();
    await page.getByTestId('nav-tab-canvas').click();
    await expect(page.getByTestId('neural-canvas-view')).toContainText('Spark');

    assertNoErrors(trap);
  });

  test('6. Admin Studio, Mission Execution, N+1 Review, QA Loopback & Equal-Height Dossier', async ({ page }) => {
    const trap = attachErrorTraps(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');

    await page.getByTestId('speed-5x').click();

    await page.getByTestId('open-admin-btn').click();
    const adminModal = page.getByTestId('admin-modal');
    await expect(adminModal).toBeVisible();
    await assertZeroNativeSelects(page, 'Admin Studio');

    // Add Custom Agent with auto model routing
    await adminModal.getByTestId('admin-tab-add_agent').click();
    await adminModal.getByTestId('new-agent-name').fill('Kestrel');
    await selectLuxuryOption(page, 'new-agent-role', 'backend');
    await adminModal.getByTestId('new-agent-title').fill('Distributed Telemetry Engineer');
    await selectLuxuryOption(page, 'new-agent-model', 'auto');
    await adminModal.getByTestId('confirm-add-agent').click();
    await expect(adminModal.getByTestId('agent-created-banner')).toBeVisible();

    // Configure Email Alerts + Send Test Email
    await adminModal.getByTestId('admin-tab-email_alerts').click();
    await adminModal.getByTestId('manager-email-input').fill('cto@agent-hq.io');
    await adminModal.getByTestId('save-email-config-btn').click();
    await expect(adminModal.getByTestId('email-saved-banner')).toBeVisible();
    await adminModal.getByTestId('send-test-email-btn').click();
    await expect(adminModal.getByTestId('email-outbox-list')).toContainText('cto@agent-hq.io');

    // Manager Chat Auto-Assemble & Launch Mission
    await adminModal.getByTestId('admin-tab-manager_chat').click();
    await adminModal.getByTestId('manager-chat-input').fill('Build a FinTech Crypto Trading Platform');
    await adminModal.getByTestId('manager-auto-launch-btn').click();
    await expect(adminModal.getByTestId('manager-chat-thread')).toContainText(/Launched|FinTech|Mission/i);
    await adminModal.getByTestId('close-admin-modal').click();

    // Switch to Kanban (Tab 3) & wait for completion
    await page.getByTestId('nav-tab-kanban').click();
    await expect(page.getByTestId('kanban-view')).toBeVisible();
    await expect(page.getByTestId('header-mission-status')).toContainText('MISSION VERIFIED', {
      timeout: 45_000,
    });

    await expect(page.getByTestId('kanban-qa-loop-badge')).toBeVisible();
    await expect(page.getByTestId('kanban-n1-review-badge').first()).toBeVisible();
    await expect(page.getByTestId('kanban-waiting-badge').first()).toBeVisible();
    await expect(page.getByTestId('kanban-commit-log')).toContainText(/[0-9a-f]{7}/);

    // Check strict equal-height bottom cards in Kanban at 1280x800
    const kLeft = await page.getByTestId('kanban-bottom-left-card').boundingBox();
    const kRight = await page.getByTestId('kanban-bottom-right-card').boundingBox();
    expect(kLeft).not.toBeNull();
    expect(kRight).not.toBeNull();
    if (kLeft && kRight) {
      const kDiff = Math.abs((kLeft.y + kLeft.height) - (kRight.y + kRight.height));
      expect(kDiff, `Kanban 1280x800 bottom diff=${kDiff}px`).toBeLessThanOrEqual(2);
    }

    // Switch to Executive Report (Tab 4) & verify Dossier + Equal-Height Bottom Cards
    await page.getByTestId('nav-tab-boardroom').click();
    await expect(page.getByTestId('executive-metrics')).toBeVisible();
    await expect(page.getByTestId('mermaid-viewer')).toBeVisible();
    await expect(page.getByTestId('mermaid-svg')).toBeVisible();

    const sourceBrowser = page.getByTestId('boardroom-source-browser');
    await expect(sourceBrowser).toBeVisible();
    await sourceBrowser.getByTestId('file-tree-item').first().click();
    await expect(sourceBrowser.getByTestId('diff-viewer')).toBeVisible();
    await sourceBrowser.getByRole('button', { name: 'Source' }).click();
    await expect(sourceBrowser.getByTestId('source-viewer')).toBeVisible();

    await expect(page.getByTestId('qa-certificate')).toBeVisible();
    await expect(page.getByTestId('qa-approval-stamp')).toBeVisible();
    await expect(page.getByTestId('qa-certificate-hash')).toBeVisible();

    const bLeft = await page.getByTestId('boardroom-source-browser').boundingBox();
    const bRight = await page.getByTestId('boardroom-qa-card').boundingBox();
    expect(bLeft).not.toBeNull();
    expect(bRight).not.toBeNull();
    if (bLeft && bRight) {
      const bDiff = Math.abs((bLeft.y + bLeft.height) - (bRight.y + bRight.height));
      expect(bDiff, `Boardroom 1280x800 bottom diff=${bDiff}px`).toBeLessThanOrEqual(2);
    }

    assertNoErrors(trap);
  });

  test('7. Live Vite Workspace, Upload, LLM, Integrations & Notifications Endpoints', async ({ request }) => {
    const filesRes = await request.get('/api/workspace/files');
    expect(filesRes.ok()).toBeTruthy();
    expect((await filesRes.json()).ok).toBe(true);

    const uploadRes = await request.post('/api/workspace/upload', {
      data: {
        files: [{ name: 'e2e-upload.md', path: 'uploads/e2e-upload.md', content: '# E2E Upload' }],
      },
    });
    expect(uploadRes.ok()).toBeTruthy();
    const uploadJson = await uploadRes.json();
    expect(uploadJson.ok).toBe(true);
    expect(uploadJson.count).toBe(1);

    const execRes = await request.post('/api/workspace/execute', {
      data: { command: 'node -v' },
    });
    expect(execRes.ok()).toBeTruthy();
    expect((await execRes.json()).exitCode).toBe(0);

    const llmRes = await request.post('/api/llm/stream', {
      data: { model: 'claude-opus-5-5', prompt: 'Verify E2E stream' },
    });
    expect(llmRes.ok()).toBeTruthy();
    expect(await llmRes.text()).toContain('"type":"done"');

    const simRes = await request.get('/api/simulation?mission=fintech-crypto');
    expect(simRes.ok()).toBeTruthy();
    expect((await simRes.json()).stages).toHaveLength(5);

    const intStatusRes = await request.get('/api/integrations/status');
    expect(intStatusRes.ok()).toBeTruthy();
    expect((await intStatusRes.json()).ok).toBe(true);

    const cliDetectRes = await request.get('/api/integrations/cli-detect');
    expect(cliDetectRes.ok()).toBeTruthy();
    expect((await cliDetectRes.json()).ok).toBe(true);

    const emailSendRes = await request.post('/api/notifications/email', {
      data: {
        to: 'e2e@agent-hq.io',
        subject: 'E2E Executive Dossier Test',
        missionTitle: 'FinTech E2E',
        certificateHash: 'abc123def456',
      },
    });
    expect(emailSendRes.ok()).toBeTruthy();

    const outboxRes = await request.get('/api/notifications/outbox');
    expect(outboxRes.ok()).toBeTruthy();
    const outboxJson = await outboxRes.json();
    expect(outboxJson.ok).toBe(true);
    expect(Array.isArray(outboxJson.emails)).toBe(true);
    expect(outboxJson.emails.length).toBeGreaterThan(0);
  });
});
