    // =========================================================================
    // 7B. CHILD CAMERA & VIRTUAL PHOTO SCENE ENGINE (SINGLE-SHOT PHOTO MODE)
    // =========================================================================
    let activeCameraStream = null;
    let activeCameraScene = 'photo_pisa'; // 'live_cam' | 'photo_pisa' | 'photo_dino' | 'photo_truck' | 'photo_cat'
    let isTakingPhoto = false;

    const VIRTUAL_CAMERA_SCENES = {
      photo_pisa: {
        title: 'Пізанська вежа (Італія)',
        shortLabel: '🗼 Пізанська вежа',
        autoPrompt: 'Дитина щойно сфотографувала Пізанську вежу в Італії! Подивися на це фото, назви що на ньому зображено (знаменита похила Пізанська вежа), і цікаво, весело та просто розкажи дитині, чому вона так кумедно нахилилася і не падає!'
      },
      photo_dino: {
        title: 'Добрий Динозавр',
        shortLabel: '🦖 Динозавр',
        autoPrompt: 'Дитина щойно сфотографувала великого доброго динозавра! Подивися на це фото, скажи хто на ньому зображений, і цікаво та просто розкажи дитині про динозаврів!'
      },
      photo_truck: {
        title: 'Червона пожежна машина',
        shortLabel: '🚒 Пожежна машина',
        autoPrompt: 'Дитина щойно сфотографувала велику червону пожежну машину з драбиною! Подивися на це фото і цікаво та просто розкажи дитині, як працює пожежна машина і навіщо їй сирена та довга драбина!'
      },
      photo_cat: {
        title: 'Пухнастий рудий котик',
        shortLabel: '🐱 Котик',
        autoPrompt: 'Дитина щойно сфотографувала милого пухнастого котика з клубочком! Подивися на це фото і тепло та цікаво розкажи дитині про котиків, чому вони муркочуть і люблять гратися!'
      }
    };

    function stopCameraVideoStream() {
      if (activeCameraStream) {
        try {
          activeCameraStream.getTracks().forEach(track => track.stop());
        } catch (e) {}
        activeCameraStream = null;
      }
      const videoEl = document.getElementById('cameraVideoEl');
      if (videoEl) {
        try {
          videoEl.pause();
          videoEl.srcObject = null;
        } catch (e) {}
      }
    }

    function updateCameraSceneButtonsUI() {
      document.querySelectorAll('.camera-scene-btn').forEach(btn => {
        const sceneKey = btn.getAttribute('data-scene');
        const isActive = sceneKey === activeCameraScene;
        btn.classList.toggle('camera-scene-active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });

      const captionEl = document.getElementById('cameraSceneCaption');
      if (captionEl) {
        if (activeCameraScene === 'live_cam') {
          captionEl.textContent = '📷 Режим: Справжня камера пристрою — наведи на предмет і тисни кнопку!';
        } else {
          const info = VIRTUAL_CAMERA_SCENES[activeCameraScene] || VIRTUAL_CAMERA_SCENES.photo_pisa;
          captionEl.textContent = `🖼️ Віртуальний кадр: ${info.title} — натисни кнопку, щоб сфотографувати!`;
        }
      }
    }

    function drawVirtualSceneToCanvas(sceneKey, canvas) {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (sceneKey === 'photo_pisa') {
        // Sky gradient
        const sky = ctx.createLinearGradient(0, 0, 0, h * 0.75);
        sky.addColorStop(0, '#38bdf8');
        sky.addColorStop(1, '#bae6fd');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);

        // Warm sun
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.arc(110, 85, 42, 0, Math.PI * 2);
        ctx.fill();

        // Fluffy clouds
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        const drawCloud = (cx, cy, s) => {
          ctx.beginPath();
          ctx.arc(cx, cy, 24 * s, 0, Math.PI * 2);
          ctx.arc(cx + 22 * s, cy - 8 * s, 28 * s, 0, Math.PI * 2);
          ctx.arc(cx + 48 * s, cy, 22 * s, 0, Math.PI * 2);
          ctx.fill();
        };
        drawCloud(450, 80, 1.1);
        drawCloud(180, 145, 0.85);

        // Green lawn (Piazza dei Miracoli)
        const grass = ctx.createLinearGradient(0, h * 0.72, 0, h);
        grass.addColorStop(0, '#22c55e');
        grass.addColorStop(1, '#15803d');
        ctx.fillStyle = grass;
        ctx.fillRect(0, h * 0.72, w, h * 0.28);

        // Leaning Tower of Pisa (tilted ~10 degrees to the right)
        ctx.save();
        ctx.translate(w * 0.5, h * 0.74);
        ctx.rotate((9.5 * Math.PI) / 180);

        const towerW = 116;
        const tiers = 6;
        const tierH = 36;

        // Base foundation shadow
        ctx.fillStyle = 'rgba(15, 23, 42, 0.22)';
        ctx.beginPath();
        ctx.ellipse(12, 6, 78, 12, 0, 0, Math.PI * 2);
        ctx.fill();

        // Ground level entrance tier
        ctx.fillStyle = '#f8fafc';
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.fillRect(-towerW / 2, -48, towerW, 48);
        ctx.strokeRect(-towerW / 2, -48, towerW, 48);

        // Entrance arch
        ctx.fillStyle = '#475569';
        ctx.beginPath();
        ctx.arc(0, -18, 16, Math.PI, 0, false);
        ctx.lineTo(16, 0);
        ctx.lineTo(-16, 0);
        ctx.closePath();
        ctx.fill();

        // 6 Colonnade galleries
        for (let t = 0; t < tiers; t++) {
          const yTop = -48 - (t + 1) * tierH;
          ctx.fillStyle = t % 2 === 0 ? '#f1f5f9' : '#f8fafc';
          ctx.fillRect(-towerW / 2, yTop, towerW, tierH);
          ctx.strokeStyle = '#94a3b8';
          ctx.strokeRect(-towerW / 2, yTop, towerW, tierH);

          // Decorative cornice ledge
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(-towerW / 2 - 4, yTop - 3, towerW + 8, 5);

          // Arches & columns inside each tier
          const cols = 5;
          const colStep = towerW / cols;
          for (let c = 0; c < cols; c++) {
            const ax = -towerW / 2 + c * colStep + colStep / 2;
            ctx.fillStyle = '#64748b';
            ctx.beginPath();
            ctx.arc(ax, yTop + 14, 6, Math.PI, 0, false);
            ctx.lineTo(ax + 6, yTop + tierH - 4);
            ctx.lineTo(ax - 6, yTop + tierH - 4);
            ctx.closePath();
            ctx.fill();
          }
        }

        // Top belfry chamber (narrower top crown)
        const belfryY = -48 - tiers * tierH - 34;
        const belfryW = 84;
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(-belfryW / 2, belfryY, belfryW, 34);
        ctx.strokeStyle = '#94a3b8';
        ctx.strokeRect(-belfryW / 2, belfryY, belfryW, 34);

        // Bell arch in top chamber
        ctx.fillStyle = '#334155';
        ctx.beginPath();
        ctx.arc(0, belfryY + 15, 11, Math.PI, 0, false);
        ctx.lineTo(11, belfryY + 32);
        ctx.lineTo(-11, belfryY + 32);
        ctx.closePath();
        ctx.fill();

        // Little golden bell
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(0, belfryY + 18, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        // Label banner for clarity
        drawCanvasSceneBadge(ctx, w, h, '🗼 ПІЗАНСЬКА ВЕЖА • TOWER OF PISA (ITALY)');
        return;
      }

      if (sceneKey === 'photo_dino') {
        // Prehistoric warm sky
        const sky = ctx.createLinearGradient(0, 0, 0, h * 0.72);
        sky.addColorStop(0, '#6ee7b7');
        sky.addColorStop(1, '#fef08a');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);

        // Ground
        ctx.fillStyle = '#65a30d';
        ctx.fillRect(0, h * 0.72, w, h * 0.28);

        // Friendly Green Dinosaur
        ctx.fillStyle = '#16a34a';
        // Tail
        ctx.beginPath();
        ctx.moveTo(220, 320);
        ctx.quadraticCurveTo(110, 335, 95, 285);
        ctx.quadraticCurveTo(135, 290, 220, 280);
        ctx.closePath();
        ctx.fill();

        // Body
        ctx.beginPath();
        ctx.ellipse(295, 290, 88, 62, 0, 0, Math.PI * 2);
        ctx.fill();

        // Belly patch
        ctx.fillStyle = '#bef264';
        ctx.beginPath();
        ctx.ellipse(315, 298, 55, 42, 0, 0, Math.PI * 2);
        ctx.fill();

        // Neck & Head
        ctx.fillStyle = '#16a34a';
        ctx.fillRect(340, 145, 48, 125);
        ctx.beginPath();
        ctx.ellipse(390, 145, 52, 36, 0, 0, Math.PI * 2);
        ctx.fill();

        // Legs
        ctx.fillRect(240, 335, 34, 52);
        ctx.fillRect(320, 335, 34, 52);

        // Cute plates along back
        ctx.fillStyle = '#f59e0b';
        [[215, 250], [255, 232], [295, 226], [338, 195], [344, 155]].forEach(([px, py]) => {
          ctx.beginPath();
          ctx.arc(px, py, 12, 0, Math.PI * 2);
          ctx.fill();
        });

        // Eye & Big Smile
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(405, 134, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(408, 134, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#064e3b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(402, 150, 20, 0.15 * Math.PI, 0.75 * Math.PI);
        ctx.stroke();

        drawCanvasSceneBadge(ctx, w, h, '🦖 ДОБРИЙ ДИНОЗАВР • FRIENDLY DINOSAUR');
        return;
      }

      if (sceneKey === 'photo_truck') {
        // City sky
        const sky = ctx.createLinearGradient(0, 0, 0, h * 0.72);
        sky.addColorStop(0, '#60a5fa');
        sky.addColorStop(1, '#dbeafe');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);

        // Asphalt road
        ctx.fillStyle = '#334155';
        ctx.fillRect(0, h * 0.72, w, h * 0.28);
        ctx.fillStyle = '#facc15';
        for (let rx = 30; rx < w; rx += 95) {
          ctx.fillRect(rx, h * 0.85, 52, 8);
        }

        // White extension ladder on roof
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 6;
        ctx.strokeRect(150, 148, 255, 26);
        for (let lx = 175; lx < 395; lx += 32) {
          ctx.beginPath();
          ctx.moveTo(lx, 148);
          ctx.lineTo(lx, 174);
          ctx.stroke();
        }

        // Red Truck Body
        ctx.fillStyle = '#dc2626';
        ctx.fillRect(125, 180, 285, 145);
        // Cabin
        ctx.fillRect(410, 210, 105, 115);

        // Windshield window
        ctx.fillStyle = '#bae6fd';
        ctx.fillRect(435, 224, 68, 48);

        // White stripe
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(125, 268, 390, 16);

        // Flashing blue siren beacon
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(455, 198, 14, Math.PI, 0, false);
        ctx.fill();

        // Wheels
        const drawWheel = (wx) => {
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.arc(wx, 330, 36, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#cbd5e1';
          ctx.beginPath();
          ctx.arc(wx, 330, 16, 0, Math.PI * 2);
          ctx.fill();
        };
        drawWheel(205);
        drawWheel(445);

        drawCanvasSceneBadge(ctx, w, h, '🚒 ПОЖЕЖНА МАШИНА • RED FIRE TRUCK');
        return;
      }

      // Default / photo_cat: Cute Orange Cat
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#fef3c7');
      bg.addColorStop(1, '#fde68a');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Cozy rug
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.ellipse(w * 0.5, 360, 220, 48, 0, 0, Math.PI * 2);
      ctx.fill();

      // Cat Body
      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.ellipse(305, 295, 76, 56, 0, 0, Math.PI * 2);
      ctx.fill();

      // Tail
      ctx.strokeStyle = '#fb923c';
      ctx.lineWidth = 20;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(235, 305);
      ctx.quadraticCurveTo(165, 260, 190, 200);
      ctx.stroke();

      // Ears
      ctx.fillStyle = '#ea580c';
      ctx.beginPath();
      ctx.moveTo(265, 165);
      ctx.lineTo(282, 112);
      ctx.lineTo(315, 152);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(375, 165);
      ctx.lineTo(358, 112);
      ctx.lineTo(325, 152);
      ctx.closePath();
      ctx.fill();

      // Cat Head
      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.arc(320, 195, 62, 0, Math.PI * 2);
      ctx.fill();

      // Eyes
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(296, 185, 11, 0, Math.PI * 2);
      ctx.arc(344, 185, 11, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(296, 185, 5, 0, Math.PI * 2);
      ctx.arc(344, 185, 5, 0, Math.PI * 2);
      ctx.fill();

      // Pink nose & whiskers
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(320, 204, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#7c2d12';
      ctx.lineWidth = 2.5;
      [[-1, -6], [-1, 4], [1, -6], [1, 4]].forEach(([dir, dy]) => {
        ctx.beginPath();
        ctx.moveTo(320 + dir * 18, 206);
        ctx.lineTo(320 + dir * 58, 206 + dy);
        ctx.stroke();
      });

      // Blue yarn ball
      ctx.fillStyle = '#0ea5e9';
      ctx.beginPath();
      ctx.arc(430, 332, 30, 0, Math.PI * 2);
      ctx.fill();

      drawCanvasSceneBadge(ctx, w, h, '🐱 ПУХНАСТИЙ КОТИК • CUTE FLUFFY CAT');
    }

    function drawCanvasSceneBadge(ctx, w, h, text) {
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.fillRect(0, h - 42, w, 42);
      ctx.fillStyle = '#fde047';
      ctx.font = 'bold 18px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h - 21);
      ctx.restore();
    }

    async function selectCameraScene(sceneKey) {
      activeCameraScene = sceneKey;
      const videoEl = document.getElementById('cameraVideoEl');
      const canvasEl = document.getElementById('cameraSceneCanvas');
      updateCameraSceneButtonsUI();

      if (sceneKey === 'live_cam') {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          try {
            stopCameraVideoStream();
            const stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
              audio: false
            });
            activeCameraStream = stream;
            if (videoEl) {
              videoEl.srcObject = stream;
              videoEl.classList.remove('hidden');
              await videoEl.play().catch(() => {});
            }
            if (canvasEl) canvasEl.classList.add('hidden');
            updateCameraSceneButtonsUI();
            return;
          } catch (err) {
            showToast('Камера недоступна — увімкнено віртуальний кадр «Пізанська вежа»!');
          }
        } else {
          showToast('Браузер без камери — увімкнено віртуальний кадр «Пізанська вежа»!');
        }
        // Fallback to Tower of Pisa virtual scene
        activeCameraScene = 'photo_pisa';
      }

      stopCameraVideoStream();
      if (videoEl) videoEl.classList.add('hidden');
      if (canvasEl) {
        canvasEl.classList.remove('hidden');
        drawVirtualSceneToCanvas(activeCameraScene, canvasEl);
      }
      updateCameraSceneButtonsUI();
    }

    async function openChildCameraModal(initialScene = 'photo_pisa') {
      if (isRecording || isStartingMic || isProcessingTurn || isActionLocked('camera')) return;

      ensureAudioCtx();
      if (appPhase === 'speaking') {
        stopAllSpeech();
      }

      const modal = document.getElementById('cameraModal');
      if (!modal) return;
      modal.classList.remove('hidden');

      await selectCameraScene(initialScene);
    }

    function closeChildCameraModal() {
      stopCameraVideoStream();
      const modal = document.getElementById('cameraModal');
      if (modal) modal.classList.add('hidden');
    }

    async function takeCameraPhoto() {
      if (isTakingPhoto || isProcessingTurn) return;
      isTakingPhoto = true;

      try {
        ensureAudioCtx();
        if (typeof sfxCameraShutter === 'function') {
          sfxCameraShutter();
        }

        // Brief visual shutter flash
        const flashEl = document.getElementById('cameraFlashOverlay');
        if (flashEl) {
          flashEl.classList.remove('hidden');
          await new Promise(r => setTimeout(r, 140));
          flashEl.classList.add('hidden');
        }

        const videoEl = document.getElementById('cameraVideoEl');
        const canvasEl = document.getElementById('cameraSceneCanvas');
        const captureCanvas = document.createElement('canvas');
        captureCanvas.width = 640;
        captureCanvas.height = 480;
        const ctx = captureCanvas.getContext('2d');

        let autoPrompt = '';
        let presetKey = null;

        if (activeCameraScene === 'live_cam' && videoEl && activeCameraStream && videoEl.readyState >= 2) {
          ctx.drawImage(videoEl, 0, 0, captureCanvas.width, captureCanvas.height);
          autoPrompt = 'Дитина щойно зробила фотографію на свою дитячу камеру! Подивися уважно на це фото, назви що на ньому зображено, і цікаво, просто та захопливо розкажи про це дитині!';
          presetKey = 'photo_camera';
        } else {
          const sceneId = VIRTUAL_CAMERA_SCENES[activeCameraScene] ? activeCameraScene : 'photo_pisa';
          drawVirtualSceneToCanvas(sceneId, canvasEl || captureCanvas);
          if (canvasEl) {
            ctx.drawImage(canvasEl, 0, 0, captureCanvas.width, captureCanvas.height);
          }
          const sceneInfo = VIRTUAL_CAMERA_SCENES[sceneId];
          autoPrompt = sceneInfo.autoPrompt;
          presetKey = sceneId;
        }

        const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.86);
        const base64Image = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';

        closeChildCameraModal();

        await processChildTurn({
          base64Image: base64Image || null,
          imageMimeType: 'image/jpeg',
          photoPreviewDataUrl: dataUrl,
          textInput: autoPrompt,
          presetKey
        });
      } finally {
        isTakingPhoto = false;
      }
    }

