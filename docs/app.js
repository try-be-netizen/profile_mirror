const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const BOT_API_BASE = window.PROFILE_MIRROR_CONFIG?.botApi || 'https://YOUR-VM-DOMAIN-HERE';

let state = {
  profileText: '',
  result: null,
  userInfo: null,
  currentCardIndex: 0,
  totalCards: 5,
  processingTimer: null,
  bubbleIntervals: [],
  bubbleTimeouts: [],
  inputMode: 'text',
  selectedImages: [],
};

const RECRUITER_QUOTES = [
  'Специфичный опыт. Подойдёт для AI-ролей.',
  '«increased engagement» — на сколько?',
  'Видно, что доводит продукты до запуска.',
  'Будут сомнения по общим продуктовым ролям.',
  'Глубоко копала в speech-tech — это плюс.',
];
const COLLEAGUE_QUOTES = [
  '5 лет в Яндексе и свой проект — как успевает?',
  'Что её там удержало так надолго?',
  'Naumen Erudite VoiceOut — а что это вообще?',
  'Любит speech-tech, но не сказала почему.',
  'Хочется спросить про переход на агентные продукты.',
];

function rotateBubble(elId, quotes, intervalMs, startDelay) {
  const el = document.getElementById(elId);
  if (!el) return;
  let i = 0;
  const timeoutId = setTimeout(() => {
    const intervalId = setInterval(() => {
      i = (i + 1) % quotes.length;
      el.style.opacity = '0';
      setTimeout(() => {
        el.textContent = quotes[i];
        el.style.opacity = '1';
      }, 350);
    }, intervalMs);
    state.bubbleIntervals.push(intervalId);
  }, startDelay);
  state.bubbleTimeouts.push(timeoutId);
}

function startPreviewRotation() {
  rotateBubble('bubble-recruiter', RECRUITER_QUOTES, 3800, 1500);
  rotateBubble('bubble-colleague', COLLEAGUE_QUOTES, 4900, 3200);
}

function stopPreviewRotation() {
  state.bubbleIntervals.forEach(id => clearInterval(id));
  state.bubbleTimeouts.forEach(id => clearTimeout(id));
  state.bubbleIntervals = [];
  state.bubbleTimeouts = [];
}

document.addEventListener('DOMContentLoaded', () => {
  const r = document.getElementById('bubble-recruiter');
  const c = document.getElementById('bubble-colleague');
  if (r) r.style.transition = 'opacity 0.3s ease-out';
  if (c) c.style.transition = 'opacity 0.3s ease-out';
  startPreviewRotation();
});

function getUserInfo() {
  if (tg?.initDataUnsafe?.user) {
    const u = tg.initDataUnsafe.user;
    return {
      name: [u.first_name, u.last_name].filter(Boolean).join(' '),
      username: u.username || '',
    };
  }
  return { name: 'Anonymous', username: '' };
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

function goToInput() {
  stopPreviewRotation();
  showScreen('screen-input');
}

function switchInputMode(mode) {
  state.inputMode = mode;
  document.querySelectorAll('.input-toggle__btn').forEach(b => {
    b.classList.toggle('input-toggle__btn--active', b.dataset.mode === mode);
  });
  document.getElementById('input-mode-text').hidden = mode !== 'text';
  document.getElementById('input-mode-images').hidden = mode !== 'images';
}

async function handleImageSelect(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  const room = 5 - state.selectedImages.length;
  const toProcess = files.slice(0, room);
  for (const file of toProcess) {
    try {
      const compressed = await compressImage(file);
      state.selectedImages.push(compressed);
    } catch (err) {
      console.error('Не удалось обработать картинку', err);
    }
  }
  renderImagePreviews();
  event.target.value = '';
}

function compressImage(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read_error'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('image_error'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderImagePreviews() {
  const container = document.getElementById('image-previews');
  if (!container) return;
  container.innerHTML = state.selectedImages.map((dataUrl, i) => `
    <div class="image-preview">
      <img src="${dataUrl}" alt="Скрин ${i + 1}">
      <button class="image-preview__remove" onclick="removeImage(${i})" aria-label="Удалить">×</button>
    </div>
  `).join('');
}

function removeImage(index) {
  state.selectedImages.splice(index, 1);
  renderImagePreviews();
}

async function goToProcessing() {
  if (state.inputMode === 'text') {
    const text = document.getElementById('profile-input').value.trim();
    if (text.length < 50) {
      alert('Пожалуйста, вставьте больше текста — хотя бы 50 символов.');
      return;
    }
    state.profileText = text;
    showScreen('screen-processing');
    animateProgress();
    try {
      const result = await callBot(text);
      state.result = result;
      renderResult();
      setTimeout(() => showScreen('screen-result'), 600);
    } catch (err) {
      console.error(err);
      alert('Что-то пошло не так. Попробуйте ещё раз через минуту.');
      showScreen('screen-input');
    }
  } else {
    if (state.selectedImages.length === 0) {
      alert('Загрузите хотя бы один скриншот.');
      return;
    }
    showScreen('screen-processing');
    animateProgress();
    try {
      const result = await callBotWithImages(state.selectedImages);
      state.result = result;
      renderResult();
      setTimeout(() => showScreen('screen-result'), 600);
    } catch (err) {
      console.error(err);
      alert('Не получилось распознать текст. Попробуйте ещё раз или вставьте текстом.');
      showScreen('screen-input');
    }
  }
}

async function callBotWithImages(imagesBase64) {
  const userInfo = getUserInfo();
  state.userInfo = userInfo;
  const response = await fetch(`${BOT_API_BASE}/analyze_images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      images: imagesBase64,
      init_data: tg?.initData || '',
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

function animateProgress() {
  if (state.processingTimer) clearInterval(state.processingTimer);
  const steps = document.querySelectorAll('.progress__step');
  const fill = document.getElementById('progress-fill');
  steps.forEach(s => s.classList.remove('is-active', 'is-done'));
  fill.style.height = '0%';
  steps[0].classList.add('is-active');
  fill.style.height = '12%';
  let i = 0;
  state.processingTimer = setInterval(() => {
    if (i >= steps.length - 1) {
      clearInterval(state.processingTimer);
      state.processingTimer = null;
      return;
    }
    steps[i].classList.remove('is-active');
    steps[i].classList.add('is-done');
    i++;
    steps[i].classList.add('is-active');
    const progress = ((i + 0.5) / steps.length) * 100;
    fill.style.height = progress + '%';
  }, 2500);
}

async function callBot(profileText) {
  const userInfo = getUserInfo();
  state.userInfo = userInfo;
  const response = await fetch(`${BOT_API_BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile_text: profileText,
      init_data: tg?.initData || '',
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

function isNonEmpty(val) {
  if (!val) return false;
  if (typeof val === 'string') return val.trim().length > 0 && val.trim() !== '—';
  if (Array.isArray(val)) return val.filter(v => isNonEmpty(v)).length > 0;
  return true;
}

function setBlockText(elId, text, blockSelector) {
  const el = document.getElementById(elId);
  if (!el) return;
  const block = blockSelector ? document.querySelector(blockSelector) : el.closest('.block');
  if (isNonEmpty(text)) {
    el.textContent = text;
    if (block) block.hidden = false;
  } else {
    if (block) block.hidden = true;
  }
}

function setBlockList(elId, items) {
  const el = document.getElementById(elId);
  if (!el) return;
  const block = el.closest('.block');
  if (!isNonEmpty(items)) {
    if (block) block.hidden = true;
    return;
  }
  if (block) block.hidden = false;
  el.innerHTML = items.filter(isNonEmpty).map(item => `<li>${escapeHtml(item)}</li>`).join('');
}

function renderResult() {
  const { recruiter, colleague } = state.result;
  // Рекрутер
  setBlockText('recruiter-overview', recruiter.overview);
  setBlockList('recruiter-strengths', recruiter.strengths);
  setBlockList('recruiter-weaknesses', recruiter.weaknesses);
  setBlockList('recruiter-recommendations', recruiter.recommendations);
  // Коллега
  setBlockText('colleague-overview', colleague.overview);
  setBlockList('colleague-thoughts', colleague.thoughts);
  setBlockList('colleague-observations', colleague.observations);
}

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('tab--active'));
  document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add('tab--active');
  document.getElementById('result-recruiter').hidden = tabName !== 'recruiter';
  document.getElementById('result-colleague').hidden = tabName !== 'colleague';
  // прокрутить наверх
  const body = document.querySelector('#screen-result .screen__body');
  if (body) body.scrollTop = 0;
}

function goToResult() { showScreen('screen-result'); }

function trackDiscoveryClick(source) {
  // Логируем для аналитики: какой вкладкой пользовался когда кликнул
  console.log('[discovery] click from:', source);
  // Опционально — если хочется отправить событие в Telegram
  if (tg?.HapticFeedback) {
    try { tg.HapticFeedback.impactOccurred('light'); } catch (e) {}
  }
}

function goToSwiper() {
  buildCards();
  showScreen('screen-swiper');
  state.currentCardIndex = 0;
  updateSwiperPosition();
}

function buildCards() {
  const { recruiter, colleague } = state.result;
  const userInfo = state.userInfo || getUserInfo();
  const name = userInfo.name || 'Anonymous';
  const swiper = document.getElementById('swiper');
  const cards = [
    buildPosterCard(recruiter, colleague, name),
    buildRoleCard('recruiter', recruiter.overview, name),
    buildRoleCard('colleague', colleague.overview, name),
    buildBadgeCard('strong', firstItem(recruiter.strengths) || '—', name),
    buildBadgeCard('weak', firstItem(recruiter.weaknesses) || '—', name),
  ];
  state.totalCards = cards.length;
  swiper.innerHTML = `<div class="swiper__track" id="swiper-track">${cards.join('')}</div>`;
  const dots = document.getElementById('dots');
  dots.innerHTML = cards.map((_, i) => `<div class="dot${i === 0 ? ' dot--active' : ''}"></div>`).join('');
  attachSwipeHandlers();
}

function firstItem(arr) {
  if (!arr || !arr.length) return null;
  return arr[0];
}

const ICON_RECRUITER_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="6"/><path d="M21 21l-6-6"/><path d="M10 8v4M8 10h4"/></svg>';
const ICON_COLLEAGUE_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14c.83.642 2.077 1.017 3.5 1.017s2.67-.375 3.5-1.017c.83-.642 2.077-1.017 3.5-1.017s2.67.375 3.5 1.017"/><path d="M8 3a2.4 2.4 0 0 0-1 2 2.4 2.4 0 0 0 1 2"/><path d="M12 3a2.4 2.4 0 0 0-1 2 2.4 2.4 0 0 0 1 2"/><path d="M3 10h14v5a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6v-5z"/><path d="M16.746 16.726a3 3 0 1 0 .252-5.555"/></svg>';

function buildPosterCard(recruiter, colleague, name) {
  return `
    <div class="share-card" data-card-type="poster">
      <div class="share-card__brand">LinkedIn глазами других</div>
      <div class="share-card__block">
        <div class="share-card__role">
          ${ICON_RECRUITER_SVG}
          <span class="share-card__role-name">РЕКРУТЕР</span>
        </div>
        <p class="share-card__quote">${escapeHtml(recruiter.overview || '')}</p>
      </div>
      <div class="share-card__block">
        <div class="share-card__role">
          <span style="color: var(--text-muted);">${ICON_COLLEAGUE_SVG}</span>
          <span class="share-card__role-name share-card__role-name--muted">КОЛЛЕГА</span>
        </div>
        <p class="share-card__quote">${escapeHtml(colleague.overview || '')}</p>
      </div>
      <div class="share-card__footer">
        <div class="share-card__attribution">
          <div class="share-card__name">${escapeHtml(name)}<br><span class="share-card__role-line">по профилю в LinkedIn</span></div>
          <div class="share-card__bot">@profile_mirror_bot</div>
        </div>
      </div>
    </div>
  `;
}

function buildRoleCard(role, text, name) {
  const iconSvg = role === 'recruiter' ? ICON_RECRUITER_SVG : ICON_COLLEAGUE_SVG;
  const label = role === 'recruiter' ? 'ВЗГЛЯД РЕКРУТЕРА' : 'ВЗГЛЯД КОЛЛЕГИ';
  const iconStyle = role === 'colleague' ? 'color: var(--text-muted);' : '';
  const labelClass = role === 'colleague' ? ' share-card__role-name--muted' : '';
  return `
    <div class="share-card" data-card-type="${role}">
      <div class="share-card__role" style="margin-bottom: 22px;">
        <span style="${iconStyle}">${iconSvg}</span>
        <span class="share-card__role-name${labelClass}">${label}</span>
      </div>
      <p class="share-card__quote share-card__quote--big">«${escapeHtml(text || '')}»</p>
      <div class="share-card__footer">
        <div class="share-card__attribution">
          <div class="share-card__name">${escapeHtml(name)}<br><span class="share-card__role-line">по профилю в LinkedIn</span></div>
          <div class="share-card__bot">@profile_mirror_bot</div>
        </div>
      </div>
    </div>
  `;
}

function buildBadgeCard(kind, text, name) {
  const badge = kind === 'strong' ? '+ СИЛЬНОЕ' : '− СЛАБОЕ';
  const cls = kind === 'strong' ? 'green' : 'red';
  return `
    <div class="share-card" data-card-type="${kind}">
      <div class="share-card__role--badge ${cls}">
        <span class="share-card__role-name">${badge}</span>
      </div>
      <p class="share-card__quote share-card__quote--big">«${escapeHtml(text || '')}»</p>
      <div class="share-card__footer">
        <div class="share-card__attribution">
          <div class="share-card__name">${escapeHtml(name)}<br><span class="share-card__role-line">по профилю в LinkedIn</span></div>
          <div class="share-card__bot">@profile_mirror_bot</div>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function updateSwiperPosition() {
  const track = document.getElementById('swiper-track');
  if (!track) return;
  track.style.transform = `translateX(-${state.currentCardIndex * 100}%)`;
  document.querySelectorAll('.dot').forEach((d, i) => {
    d.classList.toggle('dot--active', i === state.currentCardIndex);
  });
  const prevBtn = document.querySelector('.swiper-arrow--prev');
  const nextBtn = document.querySelector('.swiper-arrow--next');
  if (prevBtn) prevBtn.disabled = state.currentCardIndex === 0;
  if (nextBtn) nextBtn.disabled = state.currentCardIndex === state.totalCards - 1;
}

function prevCard() {
  if (state.currentCardIndex > 0) {
    state.currentCardIndex--;
    updateSwiperPosition();
  }
}

function nextCard() {
  if (state.currentCardIndex < state.totalCards - 1) {
    state.currentCardIndex++;
    updateSwiperPosition();
  }
}

function attachSwipeHandlers() {
  const swiper = document.getElementById('swiper');
  let startX = 0;
  let currentX = 0;
  let isDragging = false;

  const onStart = (clientX) => { startX = clientX; currentX = clientX; isDragging = true; };
  const onMove = (clientX) => { if (isDragging) currentX = clientX; };
  const onEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    const dx = currentX - startX;
    if (Math.abs(dx) > 50) { if (dx < 0) nextCard(); else if (dx > 0) prevCard(); }
  };

  swiper.addEventListener('touchstart', e => onStart(e.touches[0].clientX), { passive: true });
  swiper.addEventListener('touchmove', e => onMove(e.touches[0].clientX), { passive: true });
  swiper.addEventListener('touchend', onEnd);

  swiper.addEventListener('mousedown', e => { e.preventDefault(); onStart(e.clientX); });
  swiper.addEventListener('mousemove', e => onMove(e.clientX));
  swiper.addEventListener('mouseup', onEnd);
  swiper.addEventListener('mouseleave', onEnd);
}

async function renderCurrentCardToImage() {
  const cards = document.querySelectorAll('.share-card');
  const card = cards[state.currentCardIndex];
  if (!card) return null;
  const renderArea = document.getElementById('card-render-area');
  const clone = card.cloneNode(true);
  clone.style.width = '480px';
  clone.style.minHeight = '600px';
  renderArea.innerHTML = '';
  renderArea.appendChild(clone);
  const canvas = await html2canvas(clone, {
    backgroundColor: '#FFFFFF',
    scale: 2,
    useCORS: true,
  });
  return canvas;
}

async function downloadCard() {
  // Сохраняем функцию на случай если позже захотим вернуть как fallback
  const canvas = await renderCurrentCardToImage();
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = `linkedin-mirror-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

async function shareCard() {
  const btn = document.getElementById('share-btn');
  if (!btn) return;
  if (btn.dataset.busy === '1') return; // защита от двойных кликов
  btn.dataset.busy = '1';
  const originalContent = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="btn__spinner" aria-hidden="true"></span>Готовлю карточку…';

  try {
    const canvas = await renderCurrentCardToImage();
    if (!canvas) throw new Error('render_failed');

    if (!tg) {
      // Запасной путь: если Mini App открыт вне Telegram — просто скачать
      const link = document.createElement('a');
      link.download = `linkedin-mirror-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      btn.innerHTML = '✓ Сохранено';
      setTimeout(() => { btn.innerHTML = originalContent; btn.disabled = false; btn.dataset.busy = ''; }, 1500);
      return;
    }

    const dataUrl = canvas.toDataURL('image/png');
    btn.innerHTML = '<span class="btn__spinner" aria-hidden="true"></span>Отправляю в чат…';

    const response = await fetch(`${BOT_API_BASE}/send_card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_data: dataUrl,
        init_data: tg.initData || '',
      }),
    });

    if (!response.ok) throw new Error(`server_${response.status}`);

    // Тактильный feedback на iOS
    try { tg.HapticFeedback?.notificationOccurred('success'); } catch (e) {}

    btn.innerHTML = '✓ Отправлено в чат';
    setTimeout(() => {
      try { tg.close(); } catch (e) {}
    }, 800);
  } catch (err) {
    console.error('shareCard error', err);
    try { tg?.HapticFeedback?.notificationOccurred('error'); } catch (e) {}
    btn.innerHTML = originalContent;
    btn.disabled = false;
    btn.dataset.busy = '';
    alert('Не получилось отправить. Попробуйте ещё раз через минуту.');
  }
}
