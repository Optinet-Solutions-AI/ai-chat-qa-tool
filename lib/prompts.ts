import type { PromptVersion } from './types';
import { generateId } from './utils';

const STORAGE_KEY = 'qa-prompts-v1';

export function loadPrompts(): PromptVersion[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as PromptVersion[];
  } catch {
    // ignore
  }
  return [];
}

export function savePrompts(prompts: PromptVersion[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
}

export function getActivePrompt(prompts: PromptVersion[]): PromptVersion | null {
  if (prompts.length === 0) return null;
  return prompts.find((p) => p.active) ?? prompts[0];
}

export function createNewVersion(content: string, existing: PromptVersion[]): PromptVersion[] {
  const updated = existing.map((p) => ({ ...p, active: false }));
  const newVersion: PromptVersion = {
    id: generateId(),
    content,
    createdAt: new Date().toISOString(),
    label: `v${updated.length + 1}`,
    active: true,
  };
  return [newVersion, ...updated];
}
