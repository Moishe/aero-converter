const KEY = 'ir-converter-presets';

export function loadPresets(storage = localStorage) {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function savePreset(name, params, storage = localStorage) {
  if (!name || !name.trim()) throw new Error('Preset name required');
  const presets = loadPresets(storage);
  presets[name] = params;
  storage.setItem(KEY, JSON.stringify(presets));
  return presets;
}

export function deletePreset(name, storage = localStorage) {
  const presets = loadPresets(storage);
  delete presets[name];
  storage.setItem(KEY, JSON.stringify(presets));
  return presets;
}
