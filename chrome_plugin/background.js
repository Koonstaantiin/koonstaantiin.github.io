// =========================================================================
// CHROME SIDE PANEL & CONTEXT MENU SERVICE WORKER (MANIFEST V3)
// Audited against GoogleChrome/modern-web-guidance (chrome-extensions skill)
// =========================================================================

chrome.runtime.onInstalled.addListener(async () => {
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id: 'chomuchka_proofread_selection',
      title: '🔍 Виправити виділений текст у ШІ-редакторі',
      contexts: ['selection']
    });
  } catch (err) {
    console.error('Extension initialization error:', err);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'chomuchka_proofread_selection') return;
  const selectedText = (info.selectionText || '').trim();
  if (!selectedText) return;

  try {
    // Rule #20: Trigger sidePanel.open() synchronously BEFORE any await so the user gesture is preserved
    const openPromise = (tab?.windowId && chrome.sidePanel?.open)
      ? chrome.sidePanel.open({ windowId: tab.windowId })
      : Promise.resolve();

    await chrome.storage.local.set({ pendingProofreadText: selectedText });
    await openPromise;

    try {
      await chrome.runtime.sendMessage({
        type: 'PROOFREAD_SELECTION',
        text: selectedText
      });
    } catch {
      // Side panel may still be loading its DOM; it will read pendingProofreadText from chrome.storage.local on startup
    }
  } catch (err) {
    console.error('Context menu proofread error:', err);
  }
});
