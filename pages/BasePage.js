// TEMPLATE — edit this file to update the scaffold for all future projects.
// Self-healing: use heal_click/heal_fill/heal_select instead of direct locator calls.
// Tier 1: timing retry (free) → Tier 2: selector fallback (rules) → Tier 3: LLM (Phase 3+)

import { appendHealEvent } from './heal-audit-log.js';

class HealingEngine {
  constructor(page, options = {}) {
    this.page = page;
    this.cache = new Map();
    this.log = [];
    this.options = {
      timingRetries: options.timingRetries ?? 2,
      timingDelay: options.timingDelay ?? 1500,
      confidenceThreshold: options.confidenceThreshold
        ?? parseFloat(process.env.HEAL_CONFIDENCE_THRESHOLD ?? '0.80'),
    };
  }

  // TIER 1: adaptive wait retry — free, no LLM
  async tier1(locator, action, args) {
    for (let i = 0; i < this.options.timingRetries; i++) {
      try {
        return await action(locator, ...args);
      } catch {
        await this.page.waitForTimeout(this.options.timingDelay);
      }
    }
    return null;
  }

  // TIER 2: selector fallback by rules — no LLM
  // Tries role, label, testId variants of the original selector
  async tier2(originalLocator, action, args) {
    const fallbacks = this._buildFallbacks(originalLocator);
    for (const fb of fallbacks) {
      try {
        const el = this.page.locator(fb);
        await el.waitFor({ state: 'visible', timeout: 3000 });
        this._logHeal({ tier: 2, original: originalLocator, healed: fb, confidence: 0.85 });
        return await action(el, ...args);
      } catch {
        continue;
      }
    }
    return null;
  }

  // TIER 3: LLM via accessibility snapshot — called only if tier1+tier2 fail
  async tier3(originalLocator, action, args, context) {
    // Gets accessibility snapshot and asks LLM for candidate locator
    // Returns { locator, confidence } or null
    const snapshot = await this.page.accessibility.snapshot();
    const candidate = await this._askLLM(originalLocator, snapshot, context);
    if (!candidate || candidate.confidence < this.options.confidenceThreshold) {
      this._logHeal({
        tier: 3,
        original: originalLocator,
        healed: null,
        confidence: candidate?.confidence ?? 0,
        status: 'low-confidence',
      });
      return null;
    }
    this._logHeal({
      tier: 3,
      original: originalLocator,
      healed: candidate.locator,
      confidence: candidate.confidence,
      status: 'applied',
    });
    this.cache.set(originalLocator, candidate);
    return await action(this.page.locator(candidate.locator), ...args);
  }

  _buildFallbacks(locator) {
    // Extract text hint from locator string and build alternatives
    const text = locator.replace(/.*["'](.+)["'].*/, '$1');
    return [
      `[data-testid="${text}"]`,
      `role=button[name="${text}"]`,
      `text="${text}"`,
      `[aria-label="${text}"]`,
    ].filter((fb) => fb !== locator);
  }

  async _askLLM(originalLocator, snapshot, context) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn('[HealingEngine] ANTHROPIC_API_KEY not set — Tier 3 disabled');
      return null;
    }

    const prompt = [
      `A Playwright test failed trying to locate this element:`,
      `Locator: ${originalLocator}`,
      `Action: ${context}`,
      ``,
      `Here is the current accessibility snapshot of the page:`,
      JSON.stringify(snapshot, null, 2).slice(0, 4000),
      ``,
      `Return a JSON object with exactly these fields:`,
      `{ "locator": "<the best Playwright locator string>", "confidence": <0.0-1.0> }`,
      `Confidence should reflect how certain you are this locator will find the right element.`,
      `Return ONLY the JSON object, no explanation.`,
    ].join('\n');

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 256,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!res.ok) {
        console.warn(`[HealingEngine] Anthropic API error: ${res.status}`);
        return null;
      }

      const data = await res.json();
      const text = data.content?.[0]?.text ?? '';
      const parsed = JSON.parse(text.trim());

      if (typeof parsed.locator !== 'string' || typeof parsed.confidence !== 'number') {
        return null;
      }
      return parsed;
    } catch (err) {
      console.warn('[HealingEngine] _askLLM failed:', err.message);
      return null;
    }
  }

  _logHeal(entry) {
    this.log.push({ ...entry, timestamp: new Date().toISOString() });
    appendHealEvent(entry);
  }

  getLog() {
    return this.log;
  }

  clearLog() {
    this.log = [];
  }
}

/**
 * BasePage — shared foundation for all page objects.
 * Centralizes common navigation, waiting, and utility patterns.
 */
export class BasePage {
  constructor(page) {
    this.page = page;
    this.healer = new HealingEngine(page);
  }

  async navigate(path = '') {
    await this.page.goto(path, { waitUntil: 'commit' });
  }

  async waitForPageReady() {
    await this.page.waitForLoadState('domcontentloaded');
  }

  /** Prefer data-testid selectors for resilience against UI refactors. */
  getByTestId(testId) {
    return this.page.getByTestId(testId);
  }

  async takeScreenshot(name) {
    await this.page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
  }

  async heal_click(locator, options = {}) {
    const el = this.page.locator(locator);
    if (this.healer.cache.has(locator)) {
      return await this.page.locator(this.healer.cache.get(locator).locator).click(options);
    }
    try {
      return await el.click(options);
    } catch {
      const r1 = await this.healer.tier1(el, (l) => l.click(options), []);
      if (r1 !== null) return r1;
      const r2 = await this.healer.tier2(locator, (l) => l.click(options), []);
      if (r2 !== null) return r2;
      const r3 = await this.healer.tier3(locator, (l) => l.click(options), [], 'click');
      if (r3 !== null) return r3;
      throw new Error(`heal_click: all tiers failed for locator: ${locator}`);
    }
  }

  async heal_fill(locator, value, options = {}) {
    const el = this.page.locator(locator);
    if (this.healer.cache.has(locator)) {
      return await this.page.locator(this.healer.cache.get(locator).locator).fill(value, options);
    }
    try {
      return await el.fill(value, options);
    } catch {
      const r1 = await this.healer.tier1(el, (l, v) => l.fill(v, options), [value]);
      if (r1 !== null) return r1;
      const r2 = await this.healer.tier2(locator, (l, v) => l.fill(v, options), [value]);
      if (r2 !== null) return r2;
      const r3 = await this.healer.tier3(locator, (l, v) => l.fill(v, options), [value], 'fill');
      if (r3 !== null) return r3;
      throw new Error(`heal_fill: all tiers failed for locator: ${locator}`);
    }
  }

  async heal_select(locator, value, options = {}) {
    const el = this.page.locator(locator);
    if (this.healer.cache.has(locator)) {
      return await this.page
        .locator(this.healer.cache.get(locator).locator)
        .selectOption(value, options);
    }
    try {
      return await el.selectOption(value, options);
    } catch {
      const r1 = await this.healer.tier1(el, (l, v) => l.selectOption(v, options), [value]);
      if (r1 !== null) return r1;
      const r2 = await this.healer.tier2(locator, (l, v) => l.selectOption(v, options), [value]);
      if (r2 !== null) return r2;
      const r3 = await this.healer.tier3(
        locator,
        (l, v) => l.selectOption(v, options),
        [value],
        'select'
      );
      if (r3 !== null) return r3;
      throw new Error(`heal_select: all tiers failed for locator: ${locator}`);
    }
  }

  getHealLog() {
    return this.healer.getLog();
  }
}
