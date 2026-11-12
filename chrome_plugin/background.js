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
    chrome.contextMenus.create({
      id: 'chomuchka_ask_page_ai_selection',
      title: '🌐 Запитати Page AI про виділений текст',
      contexts: ['selection']
    });
  } catch (err) {
    console.error('Extension initialization error:', err);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const isProofread = info.menuItemId === 'chomuchka_proofread_selection';
  const isPageAi = info.menuItemId === 'chomuchka_ask_page_ai_selection';
  if (!isProofread && !isPageAi) return;

  const selectedText = (info.selectionText || '').trim();
  if (!selectedText) return;

  try {
    // Rule #20: Trigger sidePanel.open() synchronously BEFORE any await so the user gesture is preserved
    const openPromise = (tab?.windowId && chrome.sidePanel?.open)
      ? chrome.sidePanel.open({ windowId: tab.windowId })
      : Promise.resolve();

    if (isPageAi) {
      await chrome.storage.local.set({ pendingPageAiSelection: selectedText });
    } else {
      await chrome.storage.local.set({ pendingProofreadText: selectedText });
    }
    await openPromise;

    try {
      await chrome.runtime.sendMessage({
        type: isPageAi ? 'PAGE_AI_SELECTION' : 'PROOFREAD_SELECTION',
        text: selectedText
      });
    } catch {
      // Side panel may still be loading its DOM; it will read pending state from chrome.storage.local on startup
    }
  } catch (err) {
    console.error('Context menu action error:', err);
  }
});
