const cfg = window.BETS_PLAN_CONFIG || { mode: "pages", repo: "", branch: "master", pollMinutes: 15 };

const BRAND = {
  name: "bets·plan",
  mark: "◈",
  tagline: "analista conservador",
  mantra: "odd real · disciplina · filtro 0–10",
};

const VERDICT = {
  APOSTAR: { glyph: "◈", label: "ENTRADA", cls: "entrada" },
  APOSTAR_CONDICIONAL: { glyph: "◇", label: "CONDICIONAL", cls: "cond" },
  PULAR: { glyph: "○", label: "PULAR", cls: "pular" },
};

let lastAnalysisData = null;

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dataUrl(file) {
  if (cfg.mode === "raw" && cfg.repo) {
    return `https://raw.githubusercontent.com/${cfg.repo}/${cfg.branch}/mobile/pwa/${file}`;
  }
  return `./${file}`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch {
    return iso;
  }
}

function filterBar(score, width = 10) {
  const n = score == null ? 0 : Math.max(0, Math.min(width, Math.round((score / 10) * width)));
  return "▰".repeat(n) + "▱".repeat(width - n);
}

function verdictMeta(v) {
  return VERDICT[v] || { glyph: "○", label: v || "PULAR", cls: "pular" };
}

function conferirOddClient(rank, casa, oddCupom) {
  const list = lastAnalysisData?.candidatos || lastAnalysisData?.candidatos_ranking || [];
  const c = list[rank - 1];
  if (!c) return { ok: false, msg: "Rank inválido no ranking atual." };
  const casaL = String(casa).toLowerCase();
  const sistema = casaL === "superbet" ? c.superbet ?? c.odd : c.betano ?? c.odd;
  if (sistema == null) return { ok: false, msg: `Sem odd ${casa} no sistema para este rank.` };
  const delta = oddCupom - sistema;
  const tol = 0.03;
  if (Math.abs(delta) <= tol) {
    return { ok: true, msg: `◈ OK — cupom ${oddCupom.toFixed(2)} ≈ sistema ${sistema.toFixed(2)}` };
  }
  return {
    ok: false,
    msg: `○ Delta ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} (sistema ${sistema.toFixed(2)})`,
  };
}

function renderRanking(list) {
  if (!list.length) return '<p class="meta">Sem candidatos no filtro.</p>';
  const rows = list.slice(0, 8).map((c, i) => {
    const n = i + 1;
    const top = n <= 3 ? " top" : "";
    const hora = c.hora ? `<span class="hora">${esc(c.hora)}</span>` : "";
    return `<li class="rank-row">
      <span class="rank-num${top}">${String(n).padStart(2, "0")}</span>
      <div class="rank-main">
        <div class="jogo">${hora}${esc(c.jogo)}</div>
        <div class="mercado">${esc(c.mercado)}</div>
        <div class="meter">${filterBar(c.total)}</div>
      </div>
      <div class="rank-side">
        <span class="odd">@${c.odd?.toFixed(2) ?? "—"}</span>
        <span class="nota">${esc(c.total)}</span>
        ${c.confianca != null ? `<span class="conf">${esc(c.confianca)}%</span>` : ""}
      </div>
    </li>`;
  });
  return `<ul class="rank-list">${rows.join("")}</ul>`;
}

function horaSortKey(hora) {
  if (!hora || hora === "—") return 99999;
  const m = String(hora).match(/(\d{1,2}):(\d{2})/);
  if (!m) return 99998;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function renderCard(jogos) {
  const list = (jogos || [])
    .filter((j) => j.no_plano !== false)
    .sort((a, b) => horaSortKey(a.hora) - horaSortKey(b.hora));
  if (!list.length) return "";
  const rows = list
    .slice(0, 8)
    .map(
      (j) =>
        `<li class="card-row"><span class="hora">${esc(j.hora || "—")}</span><span class="nome">${esc(j.jogo)}</span><span class="perfil">${esc(j.perfil || "")}</span></li>`
    )
    .join("");
  return `<section class="card">
      <h2>Card do dia · ${list.length} jogos</h2>
      <ul class="day-card">${rows}</ul>
    </section>`;
}

function render(data) {
  lastAnalysisData = data;
  const panel = document.getElementById("conferir-panel");
  if (panel) panel.hidden = false;

  const d = data.decisao_dia || {};
  const b = data.bankroll || {};
  const el = document.getElementById("app");
  const vm = verdictMeta(d.veredito);
  const pontuacao = d.pontuacao;
  const confianca = d.confianca;

  const m = data.metricas || {};
  const metricsHtml =
    m.hit_rate_mes_pct != null
      ? `<section class="card">
      <h2>Métricas · feedback</h2>
      <div class="grid">
        <div class="cell"><span>Hit rate</span><strong>${esc(m.hit_rate_mes_pct)}%</strong></div>
        <div class="cell"><span>ROI mês</span><strong>${esc(m.roi_mes_pct)}%</strong></div>
        <div class="cell"><span>Filtro ≥8</span><strong>${m.filtro_nota8_hit_pct != null ? esc(m.filtro_nota8_hit_pct) + "%" : "—"}</strong></div>
        <div class="cell"><span>Apostas</span><strong>${esc(m.apostas_mes ?? "—")}</strong></div>
      </div>
    </section>`
      : "";

  const meterHtml =
    pontuacao != null
      ? `<div class="filter-meter">
          <span class="bar">${filterBar(pontuacao)}</span>
          <span class="score">${esc(pontuacao)}/10</span>
          ${confianca != null ? `<span class="conf">conf ${esc(confianca)}%</span>` : ""}
        </div>`
      : "";

  const pickHtml =
    d.jogo && d.veredito !== "PULAR"
      ? `<div class="pick-line">
          ${d.hora ? `<span class="hora">${esc(d.hora)}</span> · ` : ""}
          ${esc(d.jogo)}<br/>
          ${esc(d.mercado || "")} · <span class="odd">@${esc(d.odd ?? "—")}</span> · ${esc(d.casa || "—")}
        </div>`
      : "";

  const ranking = renderRanking(data.candidatos || data.candidatos_ranking || []);
  const cardHtml = renderCard(data.jogos_status);

  el.innerHTML = `
    <section class="card meta-card">
      <p class="meta">Atualizado ${esc(fmtDate(data.gerado_em))}</p>
      <p class="meta motor">${esc(data.motor || "")}</p>
    </section>

    <section class="card verdict-hero ${vm.cls}">
      <div class="verdict-glyph">${vm.glyph}</div>
      <div class="verdict-label">Veredito</div>
      <div class="verdict-value">${esc(vm.label)}</div>
      ${meterHtml}
      ${pickHtml}
      <p class="motivo">${esc(d.motivo || "")}</p>
    </section>

    <section class="card">
      <h2>Banca · status</h2>
      <p class="meta">Pendentes ${b.pendentes ?? 0} · Apostas hoje ${b.apostas_hoje ?? 0} · Stop ${b.stop_atingido ? "ativo" : "ok"}${b.excesso_apostas ? " · excesso hoje" : ""}${b.multipla_hoje ? " · múltipla hoje" : ""}</p>
    </section>

    ${cardHtml}

    ${metricsHtml}

    <section class="card">
      <h2>Ranking · filtro 0–10</h2>
      ${ranking}
    </section>
  `;
}

async function fetchJson(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}

async function loadAnalysis() {
  if (typeof window.fetchAppData !== "function") {
    throw new Error("locked");
  }
  return window.fetchAppData();
}

async function refresh(showToast) {
  const badge = document.getElementById("update-badge");
  const statusEl = document.getElementById("status");
  try {
    const [version, data] = await Promise.all([
      fetchJson(dataUrl("version.json")),
      loadAnalysis(),
    ]);

    const last = localStorage.getItem("bets_plan_data_version");
    const isNew = last && version.data && last !== version.data;
    if (version.data) localStorage.setItem("bets_plan_data_version", version.data);

    render(data);
    badge.hidden = !isNew;
    if (isNew && showToast) {
      document.getElementById("toast").classList.add("show");
      setTimeout(() => document.getElementById("toast").classList.remove("show"), 4000);
    }
    statusEl.textContent = "online";
    statusEl.classList.add("online");
  } catch (e) {
    if (String(e.message) === "locked") {
      statusEl.textContent = "bloqueado";
      return;
    }
    const decryptFail = e.code === "decrypt_failed" || e.name === "OperationError";
    if (decryptFail && typeof window.invalidateSession === "function") {
      window.invalidateSession("Sessão expirada — digite o PIN novamente.");
      statusEl.textContent = "sessão expirada";
      return;
    }
    statusEl.textContent = "erro";
    statusEl.classList.remove("online");
    const el = document.getElementById("app");
    if (el) {
      el.innerHTML = `<section class="card"><p class="motivo">Não foi possível carregar a análise. Toque em Atualizar ou digite o PIN de novo.</p></section>`;
    }
    console.error(e);
  }
}

let pollTimer;
let appStarted = false;

function startBetsApp() {
  if (appStarted) {
    refresh(true);
    return;
  }
  appStarted = true;
  document.getElementById("btn-refresh")?.addEventListener("click", () => refresh(false));
  document.getElementById("btn-compact")?.addEventListener("click", () => {
    document.body.classList.toggle("compact-mode");
  });
  document.getElementById("btn-conferir")?.addEventListener("click", () => {
    const rank = parseInt(document.getElementById("cf-rank")?.value || "1", 10);
    const casa = document.getElementById("cf-casa")?.value || "Betano";
    const odd = parseFloat(document.getElementById("cf-odd")?.value || "");
    const el = document.getElementById("cf-result");
    if (!el || Number.isNaN(odd)) {
      if (el) el.textContent = "Informe a odd do cupom.";
      return;
    }
    const r = conferirOddClient(rank, casa, odd);
    el.textContent = r.msg;
    el.className = "meta " + (r.ok ? "ok" : "fail");
  });

  refresh(true);
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => refresh(true), (cfg.pollMinutes || 15) * 60 * 1000);
}

window.startBetsApp = startBetsApp;
window.BETS_BRAND = BRAND;

if (typeof window.initBetsAuth === "function") {
  window.initBetsAuth();
}
