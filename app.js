const SHEET_ID = '1o9ar5X8tV9SDfqKTOx958SGg0Hx_8Suw04a2l1s88Rs';
const SHEET_TABS = ['SiteWeb', 'SearchConsole', 'Social', 'TopPages', 'TopPosts'];
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly'
];

let token = null;
let tokenClient = null;
let currentRadio = 'One FM';
let currentWeekCode = null;
let rawData = {};
let sheetErrors = {};

const authStatus = document.getElementById('authStatus');
const sheetStatus = document.getElementById('sheetStatus');
const currentWeek = document.getElementById('currentWeek');
const alertContainer = document.getElementById('alertContainer');
const dashboardContent = document.getElementById('dashboardContent');
const googleSignIn = document.getElementById('googleSignIn');
const downloadPdf = document.getElementById('downloadPdf');

function showAlert(message) {
  alertContainer.innerHTML = `<div class="alert">${message}</div>`;
}

function clearAlert() {
  alertContainer.innerHTML = '';
}

function updateStatus() {
  authStatus.textContent = token ? 'Connecté' : 'Non connecté';
  currentWeek.textContent = currentWeekCode ? `Semaine sélectionnée : ${currentWeekCode}` : 'Semaine sélectionnée : -';
}

function getQueryUrl(tab) {
  const range = encodeURIComponent(`${tab}!A:Z`);
  return `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;
}

async function fetchSheet(tab) {
  const response = await fetch(getQueryUrl(tab), {
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
      throw new Error('Accès non autorisé');
    }

    throw new Error(message || 'Erreur Google Sheets');
  }

  const result = await response.json();
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

function filterByRadioAndWeek(data, radio) {
  return data.filter(row => row['Radio'] === radio && row['Code semaine'] === currentWeekCode);
}

function safeNumber(value) {
  const parsed = Number(value);
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
  const variation = safeNumber(row['Variation sessions']);
  const users = safeNumber(row['Utilisateurs totaux']);
  const pageviews = safeNumber(row['Pages vues']);
  const avgSession = row['Durée moyenne de session'] || '-';
  const organic = safeNumber(row['Trafic organique']);
  const socials = safeNumber(row['Trafic réseaux sociaux']);
  const direct = safeNumber(row['Trafic direct']);
  const referral = safeNumber(row['Trafic référent']);
  const newUsers = safeNumber(row['Nouveaux utilisateurs']);
  const returningUsers = safeNumber(row['Utilisateurs récurrents']);

  const content = `
    <div class="cards-grid">
      ${renderKpiCard('Sessions totales', sessions, variation !== null ? `Variation : ${variation > 0 ? '+' : ''}${variation}` : '')}
      ${renderKpiCard('Utilisateurs totaux', users, `Nouveaux : ${formatNumber(newUsers)} • Récurrents : ${formatNumber(returningUsers)}`)}
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
  const impressionsDiscover = discoverRow ? safeNumber(discoverRow['Impressions totales']) : null;

  const discoverContent = discoverRow
    ? `<div class="cards-grid">${renderKpiCard('Impressions Discover', impressionsDiscover)}<div class="small-caption">GSC Discover</div></div>`
    : '<div class="alert">Pas de données Discover cette semaine</div>';

  return renderSection('Search Console', `
    <div class="cards-grid">
      ${renderKpiCard('Impressions Search', impressionsWeb)}
      ${renderKpiCard('Position moyenne', positionWeb)}
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
    const followers = safeNumber(row['Abonnés totaux']);
    const variation = safeNumber(row['Variation abonnés']);
    const impressions = safeNumber(row['Impressions totales']);
    const reach = safeNumber(row['Portée totale']);
    const engagementRate = row['Taux d’engagement moyen'] || '-';
    const engagementTotal = safeNumber(row['Engagements totaux']);
    const posts = safeNumber(row['Nombre de publications']);
    const clicks = safeNumber(row['Clics vers le site web']);

    const topTable = topRows.length
      ? renderTable('Top 3 posts', ['Classement', 'Aperçu', 'Impressions', 'Engagements', 'Taux d’engagement', 'Clics'], topRows.map(post => [
          post['Classement'],
          post['Aperçu légende'] || post['ID post/URL'] || '-',
          formatNumber(safeNumber(post['Impressions'])),
          formatNumber(safeNumber(post['Engagements'])),
          post['Taux d’engagement'] || '-',
          formatNumber(safeNumber(post['Clics vers le site web']))
        ]))
      : '<p>Aucun top post disponible pour ce réseau cette semaine.</p>';

    return renderSection(network, `
      <div class="cards-grid">
        ${renderKpiCard('Abonnés', followers, variation !== null ? `Variation : ${variation > 0 ? '+' : ''}${variation}` : '')}
        ${renderKpiCard('Impressions', impressions)}
        ${renderKpiCard('Portée', reach)}
        ${renderKpiCard('Taux d’engagement', engagementRate)}
        ${renderKpiCard('Engagements', engagementTotal)}
        ${renderKpiCard('Publications', posts, clicks !== null ? `Clics site : ${formatNumber(clicks)}` : '')}
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

  const topPagesTable = sheetErrors.TopPages
    ? renderSectionError('Top 5 pages de la semaine', sheetErrors.TopPages)
    : topPages.length
      ? renderTable('Top 5 pages de la semaine', ['Classement', 'URL page', 'Titre page', 'Sessions', 'Pages vues', 'Durée moyenne de session'], topPages.map(page => [
          page['Classement'],
          page['URL page'],
          page['Titre page'],
          formatNumber(safeNumber(page['Sessions'])),
          formatNumber(safeNumber(page['Pages vues'])),
          page['Durée moyenne de session'] || '-'
        ]))
      : '<p>Aucun top page disponible pour cette semaine.</p>';

  const topPostsError = sheetErrors.TopPosts ? renderSectionError('Top posts', sheetErrors.TopPosts) : '';

  dashboardContent.innerHTML = `
    ${renderOverviewWeb(webRows)}
    ${topPagesTable}
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
      renderDashboard();
    });
  });
}

async function loadAllSheets() {
  const requests = SHEET_TABS.map(async tab => {
    try {
      const values = await fetchSheet(tab);
      rawData[tab] = parseValues(values);
      sheetErrors[tab] = null;
    } catch (error) {
      rawData[tab] = [];
      sheetErrors[tab] = error.message;
    }
  });

  await Promise.all(requests);

  const latestWeek = getLatestWeekCodeFromAll();
  if (!latestWeek) {
    throw new Error('Aucune donnée trouvée pour la semaine la plus récente.');
  }
  currentWeekCode = latestWeek;
  updateStatus();
  renderDashboard();
}

async function handleGoogleSignIn() {
  clearAlert();
  if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
    showAlert('Impossible de charger Google Identity Services.');
    return;
  }

  if (!tokenClient) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: '476748970851-jfaraub4h66nvht8isqkf66nfks9g5qs.apps.googleusercontent.com',
      scope: SCOPES.join(' '),
      callback: async response => {
        if (response.error) {
          showAlert(`Erreur d'authentification Google : ${response.error}`);
          return;
        }
        token = response.access_token;
        updateStatus();
        try {
          await loadAllSheets();
        } catch (error) {
          showAlert(error.message);
        }
      }
    });
  }

  tokenClient.requestAccessToken();
}

function init() {
  updateStatus();
  enableTabs();
  googleSignIn.addEventListener('click', handleGoogleSignIn);
  downloadPdf.addEventListener('click', () => showAlert('Fonction PDF non implémentée pour l’instant'));
  dashboardContent.innerHTML = '<p>Connectez-vous avec Google pour charger les données.</p>';
}

init();
