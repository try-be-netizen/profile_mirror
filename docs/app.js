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
  previewRotationTimer: null,
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
  if (!el) return null;
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
  state.bubbleIntervals = [];
  state.bubbleTimeouts = [];
  rotateBubble('bubble-recruiter', RECRUITER_QUOTES, 3800, 1500);
  rotateBubble('bubble-colleague', COLLEAGUE_QUOTES, 4900, 3200);
}

function stopPreviewRotation() {
  (state.bubbleIntervals || []).forEach(id => clearInterval(id));
  (state.bubbleTimeouts || []).forEach(id => clearTimeout(id));
  state.bubbleIntervals = [];
  state.bubbleTimeouts = [];
}

document.addEventListener('DOMContentLoaded', () => {
  const recruiterBubble = document.getElementById('bubble-recruiter');
  const colleagueBubble = document.getElementById('bubble-colleague');
  if (recruiterBubble) recruiterBubble.style.transition = 'opacity 0.3s ease-out';
  if (colleagueBubble) colleagueBubble.style.transition = 'opacity 0.3s ease-out';
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

async function goToProcessing() {
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

function renderResult() {
  const { recruiter, colleague } = state.result;
  document.getElementById('recruiter-overview').textContent = recruiter.overview;
  renderList('recruiter-strengths', recruiter.strengths);
  renderList('recruiter-weaknesses', recruiter.weaknesses);
  renderList('recruiter-recommendations', recruiter.recommendations);
  document.getElementById('colleague-overview').textContent = colleague.overview;
  renderList('colleague-strengths', colleague.strengths);
  renderList('colleague-weaknesses', colleague.weaknesses);
  renderList('colleague-recommendations', colleague.recommendations);
}

function renderList(elId, items) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = '<li>—</li>';
    return;
  }
  el.innerHTML = items.map(item => `<li>${escapeHtml(item)}</li>`).join('');
}

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('tab--active'));
  document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add('tab--active');
  document.getElementById('result-recruiter').hidden = tabName !== 'recruiter';
  document.getElementById('result-colleague').hidden = tabName !== 'colleague';
}

function goToResult() { showScreen('screen-result'); }

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
    buildBadgeCard('strong', firstItem(recruiter.strengths) || firstItem(colleague.strengths) || '—', name),
    buildBadgeCard('weak', firstItem(recruiter.weaknesses) || firstItem(colleague.weaknesses) || '—', name),
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

function buildPosterCard(recruiter, colleague, name) {
  return `
    <div class="share-card" data-card-type="poster">
      <div class="share-card__brand">LinkedIn глазами других</div>
      <div class="share-card__block">
        <div class="share-card__role">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="6"/><path d="M21 21l-6-6"/><path d="M10 8v4M8 10h4"/></svg>
          <span class="share-card__role-name">РЕКРУТЕР</span>
        </div>
        <p class="share-card__quote">${escapeHtml(recruiter.overview)}</p>
      </div>
      <div class="share-card__block">
        <div class="share-card__role">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14c.83.642 2.077 1.017 3.5 1.017s2.67-.375 3.5-1.017c.83-.642 2.077-1.017 3.5-1.017s2.67.375 3.5 1.017"/><path d="M8 3a2.4 2.4 0 0 0-1 2 2.4 2.4 0 0 0 1 2"/><path d="M12 3a2.4 2.4 0 0 0-1 2 2.4 2.4 0 0 0 1 2"/><path d="M3 10h14v5a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6v-5z"/><path d="M16.746 16.726a3 3 0 1 0 .252-5.555"/></svg>
          <span class="share-card__role-name">КОЛЛЕГА</span>
        </div>
        <p class="share-card__quote">${escapeHtml(colleague.overview)}</p>
      </div>
      <div class="share-card__footer">
        <div class="share-card__divider"></div>
        <div class="share-card__attribution">
          <div class="share-card__name">${escapeHtml(name)}<br><span class="share-card__role-line">по профилю в LinkedIn</span></div>
          <div class="share-card__bot">@profile_mirror_bot</div>
        </div>
      </div>
    </div>
  `;
}

function buildRoleCard(role, text, name) {
  const iconSvg = role === 'recruiter'
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="6"/><path d="M21 21l-6-6"/><path d="M10 8v4M8 10h4"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14c.83.642 2.077 1.017 3.5 1.017s2.67-.375 3.5-1.017c.83-.642 2.077-1.017 3.5-1.017s2.67.375 3.5 1.017"/><path d="M8 3a2.4 2.4 0 0 0-1 2 2.4 2.4 0 0 0 1 2"/><path d="M12 3a2.4 2.4 0 0 0-1 2 2.4 2.4 0 0 0 1 2"/><path d="M3 10h14v5a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6v-5z"/><path d="M16.746 16.726a3 3 0 1 0 .252-5.555"/></svg>';
  const label = role === 'recruiter' ? 'ВЗГЛЯД РЕКРУТЕРА' : 'ВЗГЛЯД КОЛЛЕГИ';
  return `
    <div class="share-card" data-card-type="${role}">
      <div class="share-card__role" style="margin-bottom: 22px;">
        ${iconSvg}
        <span class="share-card__role-name">${label}</span>
      </div>
      <p class="share-card__quote share-card__quote--big">«${escapeHtml(text)}»</p>
      <div class="share-card__footer">
        <div class="share-card__divider"></div>
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
      <p class="share-card__quote share-card__quote--big">«${escapeHtml(text)}»</p>
      <div class="share-card__footer">
        <div class="share-card__divider"></div>
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

  const onStart = (clientX) => {
    startX = clientX;
    currentX = clientX;
    isDragging = true;
  };
  const onMove = (clientX) => {
    if (!isDragging) return;
    currentX = clientX;
  };
  const onEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    const dx = currentX - startX;
    if (Math.abs(dx) > 50) {
      if (dx < 0) nextCard();
      else if (dx > 0) prevCard();
    }
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
    backgroundColor: null,
    scale: 2,
    useCORS: true,
  });
  return canvas;
}

async function downloadCard() {
  const canvas = await renderCurrentCardToImage();
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = `linkedin-mirror-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

async function shareCard() {
  const canvas = await renderCurrentCardToImage();
  if (!canvas) return;
  const dataUrl = canvas.toDataURL('image/png');
  if (tg) {
    try {
      const response = await fetch(`${BOT_API_BASE}/send_card`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_data: dataUrl,
          init_data: tg.initData || '',
        }),
      });
      if (response.ok) {
        tg.close();
      }
    } catch (err) {
      console.error(err);
      alert('Не получилось отправить. Попробуйте «Скачать».');
    }
  }
}
