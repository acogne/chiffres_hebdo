const SHEET_ID = '1o9ar5X8tV9SDfqKTOx958SGg0Hx_8Suw04a2l1s88Rs';
const SHEET_TABS = ['SiteWeb', 'SearchConsole', 'Social', 'TopPages', 'TopPosts'];
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'openid',
  'email',
  'profile'
];

let token = null;
let tokenClient = null;
let currentRadio = 'One FM';
let currentWeekCode = null;
let rawData = {};
let sheetErrors = {};
let userProfile = null;

const alertContainer = document.getElementById('alertContainer');
const dashboardContent = document.getElementById('dashboardContent');
const googleSignIn = document.getElementById('googleSignIn');
const googleSignInCenter = document.getElementById('googleSignInCenter');
const downloadPdf = document.getElementById('downloadPdf');
const userInfo = document.getElementById('userInfo');
const weekSelect = document.getElementById('weekSelect');
const loginScreen = document.getElementById('loginScreen');
const dashboardWrapper = document.getElementById('dashboardWrapper');

function showAlert(message) {
  alertContainer.innerHTML = `<div class="alert">${message}</div>`;
}

function clearAlert() {
  alertContainer.innerHTML = '';
}

function updateStatus() {
  userInfo.textContent = token && userProfile ? `${userProfile.name || userProfile.email || ''}` : '';
  if (token) {
    googleSignIn.textContent = 'Connecté';
    if (googleSignInCenter) {
      googleSignInCenter.textContent = 'Connecté';
      googleSignInCenter.disabled = true;
    }
    console.debug('updateStatus: token present, userProfile=', userProfile);
  }
}

function showDashboard() {
  console.debug('showDashboard called, token=', token);
  try {
    if (loginScreen) {
      loginScreen.classList.add('hidden');
      loginScreen.style.display = 'none';
    }
    if (dashboardWrapper) {
      dashboardWrapper.classList.remove('hidden');
      dashboardWrapper.style.display = '';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    console.error('showDashboard error', e);
  }
}

function showLoginScreen() {
  if (loginScreen) loginScreen.classList.remove('hidden');
  if (dashboardWrapper) dashboardWrapper.classList.add('hidden');
}

function getQueryUrl(tab) {
  const range = encodeURIComponent(`${tab}!A:Z`);
  return `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;
}

async function fetchSheet(tab) {
  console.debug('fetchSheet start for tab', tab);
  const url = getQueryUrl(tab);
  console.debug('fetchSheet url', url);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const error = await response.json();
      message = error.error?.message || message;
    } catch (e) {
      // ignore parse error
    }

    if (response.status === 401 || response.status === 403) {
      console.error('fetchSheet unauthorized', tab, response.status, message);
      throw new Error('Accès non autorisé');
    }

    console.error('fetchSheet error', tab, response.status, message);
    throw new Error(message || 'Erreur Google Sheets');
  }

  const result = await response.json();
  console.debug('fetchSheet result for', tab, result?.values?.length || 0);
  return result.values || [];
}

function parseValues(values) {
  if (!values.length) return [];
  const headers = values[0].map(header => header.trim());
  return values.slice(1).map(row => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = row[index] !== undefined ? row[index] : '';
    });
    return record;
  });
}

function getLatestWeekCode(siteData) {
  const codes = [...new Set(siteData.map(row => row['Code semaine']).filter(Boolean))];
  codes.sort();
  return codes.pop() || null;
}

function getLatestWeekCodeFromAll() {
  const codes = SHEET_TABS.flatMap(tab => (rawData[tab] || []).map(row => row['Code semaine']).filter(Boolean));
  return [...new Set(codes)].sort().pop() || null;
}

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function filterByRadioAndWeek(data, radio) {
  if (!Array.isArray(data)) return [];
  const targetRadio = normalizeText(radio);
  const targetWeek = normalizeText(currentWeekCode);

  return data.filter(row => {
    const rowRadio = normalizeText(row['Radio']);
    const rowWeek = normalizeText(row['Code semaine']);
    return rowRadio === targetRadio && rowWeek === targetWeek;
  });
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePercent(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = value.toString().trim().replace('%', '').replace(/\s+/g, '');
  const normalized = s.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '-';
  return new Intl.NumberFormat('fr-FR').format(value);
}

function renderKpiCard(label, value, detail = '') {
  return `<div class="kpi-card"><strong>${formatNumber(value)}</strong><span>${label}</span>${detail ? `<div class="small-caption">${detail}</div>` : ''}</div>`;
}

function renderTable(title, headers, rows) {
  const thead = headers.map(h => `<th>${h}</th>`).join('');
  const tbody = rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('');
  return `<div class="section-card table-block"><div class="section-title"><h2>${title}</h2></div><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function waitForImages(element) {
  const images = Array.from(element?.querySelectorAll('img') || []);
  if (!images.length) return Promise.resolve();

  return Promise.all(images.map(img => {
    if (img.complete && img.naturalWidth > 0) {
      return Promise.resolve();
    }

    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
        resolve();
      };
      const onLoad = () => finish();
      const onError = () => finish();
      img.addEventListener('load', onLoad);
      img.addEventListener('error', onError);
      setTimeout(finish, 15000);
    });
  }));
}

function getTopRankedPages(pages) {
  return [...pages]
    .filter(page => page && (page['Classement'] || page['Classement'] === 0))
    .sort((a, b) => {
      const aRank = Number(a['Classement']);
      const bRank = Number(b['Classement']);
      if (!Number.isFinite(aRank) && !Number.isFinite(bRank)) return 0;
      if (!Number.isFinite(aRank)) return 1;
      if (!Number.isFinite(bRank)) return -1;
      return aRank - bRank;
    })
    .slice(0, 3);
}

function getArticleLinkUrl(page, radio) {
  const rawUrl = [
    page['URL page'],
    page['URL'],
    page['URL article'],
    page['Lien'],
    page['Lien article'],
    page['Link']
  ].find(value => Boolean(value));

  const normalizedRadio = normalizeText(radio);
  if (!rawUrl || rawUrl === '#') return rawUrl || '#';

  const targetHost = normalizedRadio === 'radio lac' ? 'radiolac.ch' : 'onefm.ch';
  const rewrittenUrl = String(rawUrl).replace(/https?:\/\/acogne\.github\.io/gi, `https://${targetHost}`);

  if (rewrittenUrl !== rawUrl) {
    return rewrittenUrl;
  }

  try {
    const url = new URL(rawUrl);
    if (url.host.toLowerCase().includes('acogne.github.io')) {
      url.host = targetHost;
      return url.toString();
    }
  } catch (e) {
    // ignore and return original string
  }

  return rawUrl;
}

function renderTopPagesCards(pages, radio) {
  const rankedPages = getTopRankedPages(pages);
  if (!rankedPages.length) return '<p>Aucun top page disponible pour cette semaine.</p>';

  const cards = rankedPages.map((page, index) => {
    const rank = page['Classement'] || index + 1;
    const title = page['Titre page'] || 'Titre indisponible';
    const author = normalizeText(page['Auteur']) === 'par rédaction' && normalizeText(radio) === 'radio lac'
      ? 'Par ATS-Keystone'
      : (page['Auteur'] || '-');
    const imageUrl = page['Image URL'] || '';
    const linkUrl = getArticleLinkUrl(page, radio);
    const views = formatNumber(safeNumber(page['Pages vues']));
    const imageMarkup = imageUrl
      ? `<a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" class="top-page-image" crossorigin="anonymous"></a>`
      : `<a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer" class="top-page-image-placeholder">Aucune image</a>`;

    return `
      <article class="top-page-card">
        <div class="top-page-rank">#${escapeHtml(rank)}</div>
        <div class="top-page-image-wrap">${imageMarkup}</div>
        <div class="top-page-content">
          <h3>${escapeHtml(title)}</h3>
          <p class="top-page-author">${escapeHtml(author)}</p>
          <p class="top-page-views">${escapeHtml(views)} vues</p>
        </div>
      </article>
    `;
  }).join('');

  return `<div class="top-pages-grid">${cards}</div>`;
}

function renderSection(title, content) {
  return `<section class="section-card"><div class="section-title"><h2>${title}</h2></div>${content}</section>`;
}

function renderSectionError(title, message) {
  return `<section class="section-card"><div class="section-title"><h2>${title}</h2></div><div class="alert">${message}</div></section>`;
}

function renderOverviewWeb(siteRows) {
  if (sheetErrors.SiteWeb) {
    return renderSectionError('Performance site web', sheetErrors.SiteWeb);
  }

  const row = siteRows[0] || {};
  const sessions = safeNumber(row['Sessions totales']);
  const variationPct = parsePercent(row['Variation sessions (%)']) ?? parsePercent(row['Variation sessions']) ;
  const variationNb = safeNumber(row['Variation session (nb)']) ?? safeNumber(row['Variation sessions (nb)']) ?? safeNumber(row['Variation sessions']);
  const users = safeNumber(row['Utilisateurs totaux']);
  const pageviews = safeNumber(row['Pages vues']);
  const avgSessionRaw = row['Durée moyenne de session'];
  const avgSession = avgSessionRaw === undefined || avgSessionRaw === '' || avgSessionRaw.toString().toLowerCase() === 'nan' ? '-' : avgSessionRaw;
  const organic = safeNumber(row['Trafic organique']);
  const socials = safeNumber(row['Trafic réseaux sociaux']);
  const direct = safeNumber(row['Trafic direct']);
  const referral = safeNumber(row['Trafic référent']);
  const newUsers = safeNumber(row['Nouveaux utilisateurs']);
  const returningUsers = safeNumber(row['Utilisateurs récurrents']);

  // Users variations (new naming in sheet)
  const usersVariationPct = parsePercent(row['Variation utilisateurs totaux (%)']) ?? parsePercent(row['Variation utilisateurs totaux']) ;
  const usersVariationNb = safeNumber(row['Variation utilisateurs totaux (nb)']) ?? safeNumber(row['Variation utilisateurs totaux']);

  // Pageviews variations
  const pagesVariationPct = parsePercent(row['Variation pages vues (%)']) ?? parsePercent(row['Variation pages vues']);
  const pagesVariationNb = safeNumber(row['Variation pages vues (nb)']) ?? safeNumber(row['Variation pages vues']);

  const content = `
    <div class="cards-grid">
      ${renderKpiCard('Sessions totales', sessions, (variationPct !== null || variationNb !== null) ? `Variation : ${variationPct !== null ? (variationPct > 0 ? '+' : '') + variationPct + '%' : ''}${(variationPct !== null && variationNb !== null) ? ' • ' : ''}${variationNb !== null ? formatNumber(variationNb) : ''}` : '')}
      ${renderKpiCard('Utilisateurs totaux', users, `Nouveaux : ${formatNumber(newUsers)} • Récurrents : ${formatNumber(returningUsers)}${usersVariationPct !== null ? ' • ' + (usersVariationPct > 0 ? '+' : '') + usersVariationPct + '%' : ''}${usersVariationNb !== null ? ' • ' + formatNumber(usersVariationNb) : ''}`)}
      ${renderKpiCard('Pages vues', pageviews)}
      ${renderKpiCard('Durée moyenne de session', avgSession)}
    </div>
    <div class="data-grid">
      <div class="section-card">
        <div class="section-title"><h2>Sources de trafic</h2></div>
        <div class="cards-grid">
          ${renderKpiCard('Organique', organic)}
          ${renderKpiCard('Réseaux sociaux', socials)}
          ${renderKpiCard('Direct', direct)}
          ${renderKpiCard('Référent', referral)}
        </div>
      </div>
    </div>
  `;
  return renderSection('Performance site web', content);
}

function renderSearchConsole(searchRows) {
  if (sheetErrors.SearchConsole) {
    return renderSectionError('Search Console', sheetErrors.SearchConsole);
  }

  const webRow = searchRows.find(r => r['SearchType'] === 'web') || {};
  const discoverRow = searchRows.find(r => r['SearchType'] === 'discover');

  const impressionsWeb = safeNumber(webRow['Impressions totales']);
  const positionWeb = safeNumber(webRow['Position moyenne']);
  const impressionsVariationPct = parsePercent(webRow['Variation impressions (%)']) ?? parsePercent(webRow['Variation impressions']);
  const impressionsVariationNb = safeNumber(webRow['Variation impressions (nb)']) ?? safeNumber(webRow['Variation impressions (nb)']);
  const positionVariationPct = parsePercent(webRow['Variation position (%)']) ?? parsePercent(webRow['Variation position']);
  const positionVariationNb = safeNumber(webRow['Variation position (nb)']) ?? safeNumber(webRow['Variation position (nb)']);
  const impressionsDiscover = discoverRow ? safeNumber(discoverRow['Impressions totales']) : null;

  const discoverContent = discoverRow
    ? `<div class="cards-grid">${renderKpiCard('Impressions Discover', impressionsDiscover)}<div class="small-caption">GSC Discover</div></div>`
    : '<div class="alert">Pas de données Discover cette semaine</div>';

  return renderSection('Search Console', `
    <div class="cards-grid">
      ${renderKpiCard('Impressions Search', impressionsWeb, impressionsVariationPct !== null ? `Variation : ${(impressionsVariationPct>0?'+':'')+impressionsVariationPct+'%'}` : (impressionsVariationNb !== null ? `Variation : ${formatNumber(impressionsVariationNb)}` : ''))}
      ${renderKpiCard('Position moyenne', positionWeb, positionVariationPct !== null ? `Variation : ${(positionVariationPct>0?'+':'')+positionVariationPct+'%'}` : (positionVariationNb !== null ? `Variation : ${formatNumber(positionVariationNb)}` : ''))}
    </div>
    ${discoverContent}
  `);
}

function renderSocialBlocks(socialRows, topPostsRows) {
  if (sheetErrors.Social) {
    return renderSectionError('Réseaux sociaux', sheetErrors.Social);
  }

  const networks = [...new Set(socialRows.map(row => row['Réseau']).filter(Boolean))];
  if (!networks.length) return renderSection('Réseaux sociaux', '<p>Aucune donnée sociale disponible pour cette semaine.</p>');

  return networks.map(network => {
    const row = socialRows.find(r => r['Réseau'] === network) || {};
    const topRows = topPostsRows.filter(post => post['Réseau'] === network).sort((a, b) => Number(a['Classement'] || 0) - Number(b['Classement'] || 0)).slice(0, 3);

    const followers = safeNumber(row['Abonnés totaux'] ?? row['Abonnés']);
    const variationFollowersNb = safeNumber(row['Variation abonnés nb'] ?? row['Variation abonnés (nb)']);
    const variationFollowersPct = parsePercent(row['Variation abonnés %'] ?? row['Variation abonnés (%)'] ?? row['Variation abonnés']);

    const impressions = safeNumber(row['Impressions totales'] ?? row['Impressions']);
    const impressionsVariationNb = safeNumber(row['Variation impressions nb'] ?? row['Variation impressions (nb)']);
    const impressionsVariationPct = parsePercent(row['Variation impression %'] ?? row['Variation impressions %'] ?? row['Variation impressions']);

    const engagementTotal = safeNumber(row['Engagements totaux'] ?? row['Engagements']);
    const engagementVariationNb = safeNumber(row['Variation engagements nb'] ?? row['Variation engagements (nb)']);
    const engagementVariationPct = parsePercent(row['Variation engagements %'] ?? row['Variation engagements (%)']);

    const posts = safeNumber(row['Nombre de publications']);
    const postsVariation = safeNumber(row['Variation nombre de publication'] ?? row['Variation nombre de publications']);

    const topTable = topRows.length
      ? renderTable('Top 3 posts', ['Classement', 'Aperçu', 'Impressions', 'Engagements', 'Taux d’engagement', 'Clics'], topRows.map(post => [
          post['Classement'],
          post['Aperçu légende'] || post['ID post/URL'] || '-',
          formatNumber(safeNumber(post['Impressions'] ?? post['Impressions totales'])),
          formatNumber(safeNumber(post['Engagements'] ?? post['Engagements totaux'])),
          post['Taux d’engagement'] || post['Taux d’engagement moyen'] || '-',
          formatNumber(safeNumber(post['Clics vers le site web'] ?? post['Clics']))
        ]))
      : '<p>Aucun top post disponible pour ce réseau cette semaine.</p>';

    return renderSection(network, `
      <div class="cards-grid">
        ${renderKpiCard('Abonnés', followers, (variationFollowersPct !== null || variationFollowersNb !== null) ? `Variation : ${variationFollowersPct !== null ? (variationFollowersPct>0?'+':'')+variationFollowersPct+'%' : ''}${(variationFollowersPct !== null && variationFollowersNb !== null) ? ' • ' : ''}${variationFollowersNb !== null ? formatNumber(variationFollowersNb) : ''}` : '')}
        ${renderKpiCard('Impressions', impressions, (impressionsVariationPct !== null || impressionsVariationNb !== null) ? `Variation : ${impressionsVariationPct !== null ? (impressionsVariationPct>0?'+':'')+impressionsVariationPct+'%' : ''}${(impressionsVariationPct !== null && impressionsVariationNb !== null) ? ' • ' : ''}${impressionsVariationNb !== null ? formatNumber(impressionsVariationNb) : ''}` : '')}
        ${renderKpiCard('Engagements', engagementTotal, (engagementVariationPct !== null || engagementVariationNb !== null) ? `Variation : ${engagementVariationPct !== null ? (engagementVariationPct>0?'+':'')+engagementVariationPct+'%' : ''}${(engagementVariationPct !== null && engagementVariationNb !== null) ? ' • ' : ''}${engagementVariationNb !== null ? formatNumber(engagementVariationNb) : ''}` : '')}
        ${renderKpiCard('Publications', posts, postsVariation !== null ? `Variation : ${formatNumber(postsVariation)}` : '')}
      </div>
      ${topTable}
    `);
  }).join('');
}

function renderDashboard() {
  if (!rawData.SiteWeb || !rawData.SearchConsole || !rawData.Social || !rawData.TopPages || !rawData.TopPosts) {
    dashboardContent.innerHTML = '<p>Chargement des données…</p>';
    return;
  }

  const webRows = filterByRadioAndWeek(rawData.SiteWeb, currentRadio);
  const searchRows = filterByRadioAndWeek(rawData.SearchConsole, currentRadio);
  const socialRows = filterByRadioAndWeek(rawData.Social, currentRadio);
  const topPages = filterByRadioAndWeek(rawData.TopPages, currentRadio);
  const topPosts = filterByRadioAndWeek(rawData.TopPosts, currentRadio);

  const topPagesSection = sheetErrors.TopPages
    ? renderSectionError('Top 3 de la semaine', sheetErrors.TopPages)
    : topPages.length
      ? renderSection('Top 3 de la semaine', renderTopPagesCards(topPages, currentRadio))
      : renderSection('Top 3 de la semaine', '<p>Aucun top page disponible pour cette semaine.</p>');

  const topPostsError = sheetErrors.TopPosts ? renderSectionError('Top posts', sheetErrors.TopPosts) : '';

  dashboardContent.innerHTML = `
    ${renderOverviewWeb(webRows)}
    ${topPagesSection}
    ${renderSearchConsole(searchRows)}
    ${topPostsError}
    ${renderSocialBlocks(socialRows, topPosts)}
  `;
}

function enableTabs() {
  document.querySelectorAll('.radio-tab').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.radio-tab').forEach(tab => tab.classList.remove('active'));
      button.classList.add('active');
      currentRadio = button.dataset.radio;
      setAccentForRadio();
      renderDashboard();
    });
  });
}

function setAccentForRadio() {
  const body = document.body;
  const logo = document.getElementById('brandLogo');
  if (currentRadio === 'One FM') {
    body.classList.add('accent-onefm');
    body.classList.remove('accent-radiolac');
    logo.src = 'images/One FM.png';
    logo.alt = 'Logo One FM';
  } else {
    body.classList.add('accent-radiolac');
    body.classList.remove('accent-onefm');
    logo.src = 'images/Radio Lac.png';
    logo.alt = 'Logo Radio Lac';
  }
}

async function loadAllSheets() {
  console.debug('loadAllSheets start');
  const requests = SHEET_TABS.map(async tab => {
    try {
      const values = await fetchSheet(tab);
      rawData[tab] = parseValues(values);
      sheetErrors[tab] = null;
      console.debug('loadAllSheets: parsed', tab, rawData[tab].length);
    } catch (error) {
      rawData[tab] = [];
      sheetErrors[tab] = error.message;
      console.error('loadAllSheets error for', tab, error);
    }
  });

  try {
    await Promise.all(requests);
  } catch (e) {
    console.error('loadAllSheets Promise.all error', e);
  }

  console.debug('loadAllSheets completed, sheetErrors=', sheetErrors);
  const latestWeek = getLatestWeekCodeFromAll();
  if (!latestWeek) {
    console.warn('loadAllSheets: no latestWeek found — proceeding without week selection');
    currentWeekCode = null;
    populateWeekSelect();
    updateStatus();
    return;
  }
  currentWeekCode = latestWeek;
  populateWeekSelect();
  updateStatus();
}

function populateWeekSelect() {
  const weeks = [...new Set(SHEET_TABS.flatMap(tab => (rawData[tab] || []).map(row => row['Code semaine']).filter(Boolean)))].sort();
  if (!weeks.length) {
    weekSelect.innerHTML = '<option>Aucune semaine disponible</option>';
    weekSelect.disabled = true;
    return;
  }
  weekSelect.innerHTML = weeks.map(week => `<option value="${week}"${week === currentWeekCode ? ' selected' : ''}>${week}</option>`).join('');
  weekSelect.disabled = false;
}

async function fetchUserProfile() {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error('Impossible de récupérer le profil utilisateur');
    }
    userProfile = await response.json();
    updateStatus();
  } catch (error) {
    console.warn('User profile fetch failed', error);
  }
}

async function handleGoogleSignIn() {
  clearAlert();
  if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
    showAlert('Impossible de charger Google Identity Services.');
    return;
  }

  if (token && dashboardWrapper && dashboardWrapper.classList.contains('hidden')) {
    console.debug('handleGoogleSignIn: token already present, rendering dashboard');
    renderDashboard();
    showDashboard();
    return;
  }

  if (!tokenClient) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: '476748970851-jfaraub4h66nvht8isqkf66nfks9g5qs.apps.googleusercontent.com',
      scope: SCOPES.join(' '),
      callback: async response => {
        if (response.error) {
          showAlert(`Erreur d'authentification Google : ${response.error}`);
          console.warn('tokenClient callback error', response.error);
          return;
        }
        console.debug('tokenClient callback response', response);
        token = response.access_token;
        await fetchUserProfile();
        try {
          // show a quick loading state
          dashboardContent.innerHTML = '<p>Chargement des données…</p>';
          console.debug('Loading sheets with token present...');
          await loadAllSheets();
          console.debug('Sheets loaded, rendering dashboard');
          renderDashboard();
          // Force hide the login block in case CSS/class manipulation failed
          showDashboard();
          if (loginScreen) {
            loginScreen.style.display = 'none';
            loginScreen.classList.add('hidden');
          }
          if (dashboardWrapper) {
            dashboardWrapper.style.display = '';
            dashboardWrapper.classList.remove('hidden');
          }
          if (googleSignIn) googleSignIn.disabled = true;
          if (googleSignInCenter) googleSignInCenter.disabled = true;
        } catch (error) {
          console.error('Error loading sheets after auth', error);
          showAlert(error.message);
        }
      }
    });
  }

  tokenClient.requestAccessToken();
}

async function downloadDashboardPdf() {
  clearAlert();
  const button = downloadPdf;
  if (!button) return;
  button.disabled = true;
  button.textContent = 'Génération PDF…';

  const element = document.querySelector('#dashboardWrapper');
  const canvasLib = window.html2canvas;
  const jsPDFNamespace = window.jspdf || window.jsPDF;
  const jsPDFClass = jsPDFNamespace?.jsPDF || jsPDFNamespace;

  if (!element || !canvasLib || !jsPDFClass) {
    showAlert('Impossible de générer le PDF pour le moment.');
    button.disabled = false;
    button.textContent = 'Télécharger en PDF';
    return;
  }

  try {
    await waitForImages(element);
    const canvas = await canvasLib(element, {
      scale: 2,
      backgroundColor: '#f6f7f8',
      scrollY: -window.scrollY,
      useCORS: true,
      allowTaint: true,
      imageTimeout: 15000,
      logging: false
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const pdf = new jsPDFClass({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    pdf.save(`${currentRadio.replace(/\s+/g, '_')}_${currentWeekCode || 'rapport'}.pdf`);
  } catch (error) {
    console.error(error);
    showAlert('Échec de la génération du PDF.');
  } finally {
    button.disabled = false;
    button.textContent = 'Télécharger en PDF';
  }
}

function init() {
  updateStatus();
  enableTabs();
  setAccentForRadio();
  // Primary sign-in buttons: if already authenticated, ensure dashboard shows; otherwise start auth
  googleSignIn.addEventListener('click', () => {
    if (token) {
      ensureDashboardVisible();
    } else {
      handleGoogleSignIn();
    }
  });
  if (googleSignInCenter) {
    googleSignInCenter.addEventListener('click', () => {
      if (token) {
        ensureDashboardVisible();
      } else {
        handleGoogleSignIn();
      }
    });
  }
  downloadPdf.addEventListener('click', downloadDashboardPdf);
  weekSelect.addEventListener('change', event => {
    currentWeekCode = event.target.value;
    renderDashboard();
  });
  showLoginScreen();
  dashboardContent.innerHTML = '<p>Connectez-vous avec Google pour charger les données.</p>';
}

init();

// Ensure dashboard will be rendered and shown when token is available
async function ensureDashboardVisible() {
  try {
    console.debug('ensureDashboardVisible called, token=', token);
    if (!token) return;
    // If data not loaded yet, load sheets first
    const hasData = SHEET_TABS.every(tab => Array.isArray(rawData[tab]) && rawData[tab].length > 0);
    if (!hasData) {
      dashboardContent.innerHTML = '<p>Chargement des données…</p>';
      await loadAllSheets();
    }
    renderDashboard();
    showDashboard();
  } catch (e) {
    console.error('ensureDashboardVisible error', e);
    showAlert('Impossible d’afficher le dashboard pour le moment.');
  }
}
