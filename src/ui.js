import { createRenderer } from './webgl.js';
import { cloneDefaults } from './defaults.js';
import { loadPresets, savePreset, deletePreset } from './presets.js';

const CONTROLS = [
  { group: 'Red output (IR)', items: [
    { path: 'curveR.gain', label: 'Gain', min: 0, max: 2, step: 0.01 },
    { path: 'curveR.gamma', label: 'Gamma', min: 0.2, max: 5, step: 0.01 },
    { path: 'curveR.offset', label: 'Offset', min: -0.5, max: 0.5, step: 0.01 },
  ] },
  { group: 'Green output (red − IR)', items: [
    { path: 'opacityG', label: 'IR opacity', min: 0, max: 1, step: 0.01 },
    { path: 'curveG.gain', label: 'Gain', min: 0, max: 2, step: 0.01 },
    { path: 'curveG.gamma', label: 'Gamma', min: 0.2, max: 5, step: 0.01 },
    { path: 'curveG.offset', label: 'Offset', min: -0.5, max: 0.5, step: 0.01 },
  ] },
  { group: 'Blue output (green − IR)', items: [
    { path: 'opacityB', label: 'IR opacity', min: 0, max: 1, step: 0.01 },
    { path: 'curveB.gain', label: 'Gain', min: 0, max: 2, step: 0.01 },
    { path: 'curveB.gamma', label: 'Gamma', min: 0.2, max: 5, step: 0.01 },
    { path: 'curveB.offset', label: 'Offset', min: -0.5, max: 0.5, step: 0.01 },
  ] },
  { group: 'Highlights', items: [
    { path: 'highlight.amount', label: 'Amount', min: 0, max: 1, step: 0.01 },
    { path: 'highlight.threshold', label: 'Threshold', min: 0, max: 1, step: 0.01 },
  ] },
];

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o[k], obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

export function init() {
  const $ = (id) => document.getElementById(id);
  const errorEl = $('error');
  const resultCanvas = $('result-canvas');
  const sourceCanvas = $('source-canvas');
  const exportBtn = $('export');

  let renderer;
  try {
    renderer = createRenderer(resultCanvas);
  } catch (e) {
    errorEl.hidden = false;
    errorEl.textContent = 'WebGL is not available in this browser.';
    return;
  }

  let params = cloneDefaults();
  let hasImage = false;

  function showError(msg) {
    errorEl.hidden = false;
    errorEl.textContent = msg;
  }
  function clearError() {
    errorEl.hidden = true;
    errorEl.textContent = '';
  }

  function render() {
    if (hasImage) renderer.render(params);
  }

  // --- Build control sliders ---
  const inputsByPath = new Map();
  const outputsByPath = new Map();
  const groupsEl = $('control-groups');
  for (const group of CONTROLS) {
    const groupEl = document.createElement('div');
    groupEl.className = 'group';
    const title = document.createElement('h2');
    title.textContent = group.group;
    groupEl.appendChild(title);
    for (const item of group.items) {
      const row = document.createElement('label');
      row.className = 'control';
      const name = document.createElement('span');
      name.textContent = item.label;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = item.min; input.max = item.max; input.step = item.step;
      const out = document.createElement('output');
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        setPath(params, item.path, v);
        out.textContent = v.toFixed(2);
        render();
      });
      row.append(name, input, out);
      groupEl.appendChild(row);
      inputsByPath.set(item.path, input);
      outputsByPath.set(item.path, out);
    }
    groupsEl.appendChild(groupEl);
  }

  function syncControlsFromParams() {
    for (const [path, input] of inputsByPath) {
      const v = getPath(params, path);
      input.value = v;
      outputsByPath.get(path).textContent = Number(v).toFixed(2);
    }
  }
  syncControlsFromParams();

  // --- Image loading ---
  async function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      showError('Please choose an image file.');
      return;
    }
    clearError();
    try {
      const bitmap = await createImageBitmap(file);
      renderer.setImage(bitmap);
      sourceCanvas.width = bitmap.width;
      sourceCanvas.height = bitmap.height;
      sourceCanvas.getContext('2d').drawImage(bitmap, 0, 0);
      hasImage = true;
      exportBtn.disabled = false;
      render();
    } catch (e) {
      showError('Could not load that image.');
    }
  }

  $('file-input').addEventListener('change', (e) => loadFile(e.target.files[0]));

  const dropZone = $('drop-zone');
  ['dragover', 'dragenter'].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); }));
  dropZone.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

  // --- Reset ---
  $('reset').addEventListener('click', () => {
    params = cloneDefaults();
    syncControlsFromParams();
    render();
  });

  // --- Export ---
  exportBtn.addEventListener('click', () => {
    render(); // ensure current frame is in the buffer
    resultCanvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'irg.png';
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  });

  // --- Presets ---
  const presetList = $('preset-list');
  function refreshPresetList() {
    const presets = loadPresets();
    presetList.innerHTML = '<option value="">Load preset…</option>';
    for (const name of Object.keys(presets)) {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      presetList.appendChild(opt);
    }
  }
  refreshPresetList();

  $('preset-save').addEventListener('click', () => {
    const name = $('preset-name').value;
    try {
      savePreset(name, structuredClone(params));
      clearError();
      refreshPresetList();
    } catch (e) {
      showError(e.message);
    }
  });

  presetList.addEventListener('change', () => {
    const name = presetList.value;
    if (!name) return;
    const preset = loadPresets()[name];
    if (preset) {
      params = structuredClone(preset);
      syncControlsFromParams();
      render();
    }
  });

  $('preset-delete').addEventListener('click', () => {
    const name = presetList.value || $('preset-name').value;
    if (!name) return;
    deletePreset(name);
    refreshPresetList();
  });
}

if (typeof document !== 'undefined') {
  init();
}
