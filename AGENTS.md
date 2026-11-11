# AGENTS.md — Fast Architecture & Codebase Map for «Чомучка-Рація»

> **Purpose**: Read this file first to avoid scanning the entire repository. It documents every file, global symbol, state flow, and styling rule so you only need to read the 1–2 files directly affected by a task.

---

## 1. Architecture Overview
- **Tech Stack**: Pure Vanilla HTML5 + CSS + ES2020 JavaScript (PWA). **No bundler, no npm build step, no module imports.**
- **Global Scope**: All `js/*.js` scripts run in global browser scope in the exact order listed at the bottom of `index.html`.
- **Styling**:
  - `css/utilities.css`: Pre-generated Tailwind v3.4.17 utility classes (static file, **no JIT compiler running**).
  - `css/styles.css`: Custom CSS rules, animations, font-face declarations, and component classes.
  - **Rule**: When adding UI elements, either reuse standard utility classes already present in `index.html` / `css/utilities.css` or add explicit rules in `css/styles.css`.
- **Offline / GitHub Pages / Self-Baked Export**:
  - System voice prompts (`./audio/*.wav`, 24 kHz 16-bit mono PCM) are loaded directly into `wavPcmBank24k` without IndexedDB.
  - The app can export itself as a single self-contained HTML file (`exportSelfBakedHtmlFile()` in `js/audio.js`) by inlining `APP_ASSET_PATHS`.

---

## 2. File & Global Symbol Map

| File | Load Order | Responsibility & Key Globals |
| :--- | :---: | :--- |
| `index.html` | — | Main layout: `#childView` (walkie screen), `#cameraModal` (child camera), `#parentGateModal` (math lock), `#parentView` (3 tabs: `logs`, `settings`, `guardrails`). |
| `js/state.js` | 1 | Persistent state (`state`, `loadStateSync()`, `saveState()`), API key helpers (`getActiveApiKey()`, `syncApiKeyInputs()`), `SYSTEM_PROMPT_TEXTS`, `SYSTEM_PROMPT_WAV_PATHS`, `wavPcmBank24k`, `appPhase` (`'idle' \| 'recording' \| 'finishing' \| 'thinking' \| 'speaking'`), `showToast()`, `setMainErrorBanner()`. |
| `js/audio.js` | 2 | Web Audio context (`audioCtx`, `ensureAudioCtx()`), SFX (`playTone()`, `sfxStartListening()`, `sfxStopListening()`, `sfxAnswerReady()`, `sfxClarificationNeeded()`, `sfxBusy()`, `sfxCameraShutter()`), 24 kHz PCM/WAV converters, `playSystemPrompt()`, `ensureSystemVoiceBankPopulated()`, and GitHub/PWA exporters (`APP_ASSET_PATHS`, `buildPwaServiceWorkerJsString()`, `exportSelfBakedHtmlFile()`). |
| `js/api.js` | 3 | Gemini API key verification & model discovery (`probeApiKeyAndModels()`, `getCandidateTtsConfigs()`, `discoveredTextModels`, `discoveredTtsModels`). |
| `js/tts.js` | 4 | Hybrid SSE streaming TTS pipeline (`speakText()`, `playGeminiTtsAudio()`, `fetchSegmentPcmWithStream()`, `stopAllSpeech()`, `stopActivePlayback()`, `updateDiagnosticsBar()`). |
| `js/gemini.js` | 5 | Multimodal Gemini request & age guardrails (`buildSystemInstruction()`, `callGeminiApi({ base64Audio, mimeType, base64Image, imageMimeType, textInput, signal })`, `simulateGuardrailPipeline()`). Returns JSON `{ heard_transcript, reconstructed_intent, detected_language, safety_status, flagged_word_or_reason, spoken_response }`. |
| `js/pipeline.js` | 6 | Walkie phase state machine & control locking (`ACTION_LOCKED_IN_PHASES`, `ACTION_CONTROL_SELECTORS`, `isActionLocked()`, `applyControlLocks()`, `setWalkieState()`, `cancelCurrentTurn()`), turn execution (`processChildTurn()`, `handleProcessedResult()`). |
| `js/recording.js` | 7 | Push-to-Talk microphone capture (`startRecording()`, `stopRecording()`, `cleanupMediaResources()`, `blobToBase64()`). |
| `js/camera.js` | 8 | Single-shot child photo camera & virtual canvas scenes (`VIRTUAL_CAMERA_SCENES`, `openChildCameraModal()`, `closeChildCameraModal()`, `selectCameraScene()`, `takeCameraPhoto()`, `drawVirtualSceneToCanvas()`). |
| `js/ui.js` | 9 | DOM rendering & `DOMContentLoaded` listeners (`renderStarsAndCounters()`, `renderLogsList()`, `switchParentTab()`, `escapeHtml()`). |
| `sw.js` | — | Service Worker caching `ASSETS_TO_CACHE` for offline PWA support. |
| `chrome_plugin/*` | — | Standalone Chrome Side Panel Extension (`manifest.json`, `background.js`, `sidepanel.html`, `sidepanel.css`, `tools.js`) for AI Proofreading & 4-Style Rewrite (`default`, `short`, `formal`, `corp`). |

---

## 3. Core Data Flows

### Voice Turn Flow
1. Child taps `#btnPushToTalk` → `startRecording()` (`js/recording.js`) starts `MediaRecorder`, sets phase to `'listening'` (`appPhase = 'recording'`).
2. Child taps `#btnPushToTalk` again → `stopRecording()` sets phase to `'finishing'`, converts audio blob to Base64, and calls `processChildTurn({ base64Audio, mimeType, textInput })` (`js/pipeline.js`).
3. `processChildTurn()` sets phase to `'thinking'`, plays `THINKING_FILLER` (`./audio/thinking_filler.wav`), and calls `callGeminiApi()` (`js/gemini.js`) with a 24s watchdog fallback to `simulateGuardrailPipeline()`.
4. `handleProcessedResult()` updates `state.usedToday`, prepends to `state.logs`, updates `#lastChildText` / `#lastAiText`, and calls `speakText(resultObj.spoken_response, ...)` (`js/tts.js`).

### Photo Camera Turn Flow (Single-Shot, Non-Live)
1. Child taps `#btnOpenCamera` → `openChildCameraModal()` (`js/camera.js`) opens `#cameraModal`.
2. Child picks either a virtual scene (`photo_pisa`, `photo_dino`, `photo_truck`, `photo_cat`) rendered onto `#cameraSceneCanvas` or real camera (`live_cam`) on `#cameraVideoEl`.
3. Child taps `#btnTakePhoto` → `takeCameraPhoto()` plays `sfxCameraShutter()`, captures a `640×480` JPEG Base64 image + `dataUrl`, closes `#cameraModal`, and calls `processChildTurn({ base64Image, imageMimeType: 'image/jpeg', photoPreviewDataUrl, textInput: autoPrompt, presetKey })`.
4. `processChildTurn()` displays the photo preview in `#lastPhotoPreviewWrap`, sends the image + automatic description prompt to `callGeminiApi()`, and speaks the answer via `speakText()`.

---

## 4. Mandatory Checklists for Common Edits

### When Adding a New `js/*.js` or `css/*.css` File
Update all **4** locations so PWA caching and single-file HTML export continue working:
1. `index.html`: Add `<script src="./js/newfile.js"></script>` (before `js/ui.js`).
2. `js/audio.js`: Add `'js/newfile.js'` to `APP_ASSET_PATHS`.
3. `js/audio.js`: Add `'./js/newfile.js'` to `ASSETS_TO_CACHE` inside `buildPwaServiceWorkerJsString()`.
4. `sw.js`: Add `'./js/newfile.js'` to `ASSETS_TO_CACHE`.

### When Adding a New Child-Facing Interactive Button
Register the action in `js/pipeline.js`:
1. Add action key to `ACTION_LOCKED_IN_PHASES` (e.g., `['recording', 'finishing', 'thinking', 'speaking']`).
2. Add selector to `ACTION_CONTROL_SELECTORS`.
3. In the click handler in `js/ui.js`, guard with `if (rejectIfLocked('actionKey')) return;`.

