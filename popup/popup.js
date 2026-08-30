'use strict';

const $ = id => document.getElementById(id);

async function load() {
  const s = { ...OmniLib.DEFAULTS, ...(await chrome.storage.sync.get(null)) };
  $('autoRun').checked = !!s.autoRun;
  $('maxLanguages').value = s.maxLanguages;
  $('noveltyThreshold').value = s.noveltyThreshold;
  $('thVal').textContent = s.noveltyThreshold;
}

let savedTimer;
async function save() {
  $('thVal').textContent = $('noveltyThreshold').value;
  await chrome.storage.sync.set({
    autoRun: $('autoRun').checked,
    maxLanguages: Math.max(1, Math.min(10, Number($('maxLanguages').value) || 5)),
    noveltyThreshold: Number($('noveltyThreshold').value),
  });
  $('saved').style.visibility = 'visible';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { $('saved').style.visibility = 'hidden'; }, 1200);
}

for (const id of ['autoRun', 'maxLanguages', 'noveltyThreshold']) {
  $(id).addEventListener('input', save);
}

async function sendRun(force) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { type: 'omni-run', force }, () => chrome.runtime.lastError);
}

$('runNow').addEventListener('click', () => sendRun(false));
$('rerun').addEventListener('click', () => sendRun(true));
$('clearCache').addEventListener('click', async () => {
  await chrome.storage.local.clear();
  $('clearCache').textContent = 'Cache cleared';
  setTimeout(() => { $('clearCache').textContent = 'Clear cache'; }, 1200);
});

load();
