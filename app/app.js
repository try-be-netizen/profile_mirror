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
};

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
  animateSteps();
  try {
    const result = await callBot(text);
    state.result = result;
    renderResult();
    setTimeout(() => showScreen('screen-result'), 500);
  } catch (err) {
    console.error(err);
    alert('Что-то пошло не так. Попробуйте ещё раз через минуту.');
    showScreen('screen-input');
  }
}

function animateSteps() {
  const steps = document.querySelectorAll('.step');
  steps.forEach(s => s.classList.remove('step--active', 'step--done'));
  let i = 0;
  steps[0].classList.add('step--active');
  const interval = setInterval(() => {
    if (i >= steps.length) {
      clearInterval(interval);
      return;
    }
    if (i > 0) {
      steps[i - 1].classList.remove('step--active');
      steps[i - 1].classList.add('step--done');
    }
    if (i < steps.length) {
      steps[i].classList.add('step--active');
    }
    i++;
  }, 2200);
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
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return await response.json();
}

function renderResult() {
  const { recruiter, colleague } = state.result;
  document.getElementById('recruiter-overview').textContent = recruiter.overview;
  document.getElementById('recruiter-strengths').textContent = formatList(recruiter.strengths);
  document.getElementById('recruiter-weaknesses').textContent = formatList(recruiter.weaknesses);
  document.getElementById('recruiter-recommendations').textContent = formatList(recruiter.recommendations);
  document.getElementById('colleague-overview').textContent = colleague.overview;
  document.getElementById('colleague-strengths').textContent = formatList(colleague.strengths);
  document.getElementById('colleague-weaknesses').textContent = formatList(colleague.weaknesses);
  document.getElementById('colleague-recommendations').textContent = formatList(colleague.recommendations);
}

function formatList(arr) {
  if (!arr || !arr.length) return '—';
  return arr.map(item => `• ${item}`).join('\n');
}

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('tab--active'));
  document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add('tab--active');
  document.getElementById('result-recruiter').hidden = tabName !== 'recruiter';
  document.getElementById('result-colleague').hidden = tabName !== 'colleague';
}

function goToResult() {
  showScreen('screen-result');
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
    buildBadgeCard('strong', recruiter.strengths?.[0] || colleague.strengths?.[0] || '—', name),
    buildBadgeCard('weak', recruiter.weaknesses?.[0] || colleague.weaknesses?.[0] || '—', name),
  ];
  state.totalCards = cards.length;
  swiper.innerHTML = `<div class="swiper__track" id="swiper-track">${cards.join('')}</div>`;
  const dots = document.getElementById('dots');
  dots.innerHTML = cards.map((_, i) => `<div class="dot${i === 0 ? ' dot--active' : ''}"></div>`).join('');
  attachSwipeHandlers();
}

function buildPosterCard(recruiter, colleague, name) {
  return `
    <div class="share-card" data-card-type="poster">
      <div class="share-card__brand">LinkedIn глазами других</div>
      <div class="share-card__block">
        <div class="share-card__role">
          <i class="ti ti-zoom-question" aria-hidden="true"></i>
          <span class="share-card__role-name">РЕКРУТЕР</span>
        </div>
        <p class="share-card__quote">${escapeHtml(recruiter.overview)}</p>
      </div>
      <div class="share-card__block">
        <div class="share-card__role">
          <i class="ti ti-coffee" aria-hidden="true"></i>
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
  const icon = role === 'recruiter' ? 'ti-zoom-question' : 'ti-coffee';
  const label = role === 'recruiter' ? 'ВЗГЛЯД РЕКРУТЕРА' : 'ВЗГЛЯД КОЛЛЕГИ';
  return `
    <div class="share-card" data-card-type="${role}">
      <div class="share-card__role" style="margin-bottom: 22px;">
        <i class="ti ${icon}" aria-hidden="true"></i>
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
}

function attachSwipeHandlers() {
  const swiper = document.getElementById('swiper');
  let startX = 0;
  let currentX = 0;
  let isDragging = false;

  swiper.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    isDragging = true;
  });
  swiper.addEventListener('touchmove', e => {
    if (!isDragging) return;
    currentX = e.touches[0].clientX;
  });
  swiper.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    const dx = currentX - startX;
    if (Math.abs(dx) > 50) {
      if (dx < 0 && state.currentCardIndex < state.totalCards - 1) {
        state.currentCardIndex++;
      } else if (dx > 0 && state.currentCardIndex > 0) {
        state.currentCardIndex--;
      }
      updateSwiperPosition();
    }
  });
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
