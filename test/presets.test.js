// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { loadPresets, savePreset, deletePreset } from '../src/presets.js';
import { cloneDefaults } from '../src/defaults.js';

beforeEach(() => localStorage.clear());

describe('presets', () => {
  it('returns an empty object when nothing is stored', () => {
    expect(loadPresets()).toEqual({});
  });
  it('saves and loads a preset round-trip', () => {
    const params = cloneDefaults();
    params.opacityG = 0.25;
    savePreset('moody', params);
    expect(loadPresets()['moody'].opacityG).toBe(0.25);
  });
  it('overwrites a preset with the same name', () => {
    savePreset('x', { ...cloneDefaults(), opacityG: 0.1 });
    savePreset('x', { ...cloneDefaults(), opacityG: 0.9 });
    expect(loadPresets()['x'].opacityG).toBe(0.9);
  });
  it('rejects an empty or whitespace name', () => {
    expect(() => savePreset('', cloneDefaults())).toThrow('Preset name required');
    expect(() => savePreset('   ', cloneDefaults())).toThrow('Preset name required');
  });
  it('deletes a preset', () => {
    savePreset('gone', cloneDefaults());
    deletePreset('gone');
    expect(loadPresets()['gone']).toBeUndefined();
  });
  it('returns an empty object for malformed stored data', () => {
    localStorage.setItem('ir-converter-presets', '{not json');
    expect(loadPresets()).toEqual({});
  });
});
