"use strict";

const get = id => document.getElementById(id);
const format = (value, digits = 2) => new Intl.NumberFormat("nb-NO", { maximumFractionDigits: digits }).format(value);
const money = (value, currency) => `${format(value, value !== 0 && Math.abs(value) < 0.01 ? 6 : 2)} ${currency}`;
const percent = value => `${format(value * 100, 1)} %`;
const dateLabel = date => date ? date.split("-").reverse().join(".") : "–";
const directions = { buy: "Kjøpssignal", sell: "Salgssignal", hold: "Avvent", warmup: "For lite historikk" };
const storageKey = "finansradar.simulation.v1";
const columnNames = ["date", "symbol", "open", "high", "low", "close", "currency"];
const symbolPattern = /^[A-Z0-9.^=/_-]{1,30}$/;

function storedLedger() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function persist(ledger) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(ledger));
    return true;
  } catch {
    return false;
  }
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function status(id, text) {
  get(id).textContent = text;
  get(id).hidden = !text;
}

function row(values) {
  const tr = element("tr");
  for (const value of values) {
    const td = element("td");
    td.append(value);
    tr.append(td);
  }
  return tr;
}

function validDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const stamp = Date.parse(date);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === date;
}

function validatedData(input, source) {
  if (!input || !Array.isArray(input.series) || input.series.length < 1 || input.series.length > 30) {
    throw new Error("Filen må inneholde mellom 1 og 30 instrumenter.");
  }
  const symbols = new Set();
  const series = input.series.map(item => {
    if (!item || typeof item.symbol !== "string" || typeof item.currency !== "string"
        || !symbolPattern.test(item.symbol) || !/^[A-Z]{3}$/.test(item.currency)
        || symbols.has(item.symbol) || !Array.isArray(item.bars)
        || !item.bars.length || item.bars.length > 6000) {
      throw new Error("Kontroller symbol, valuta og antall kursdager. Hvert symbol må være unikt.");
    }
    symbols.add(item.symbol);
    const bars = item.bars.map(values => {
      if (!Array.isArray(values) || values.length !== 5 || !validDate(values[0])
          || !values.slice(1).every(value => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1e12)) {
        throw new Error(`Ugyldig dato eller pris for ${item.symbol}.`);
      }
      const [date, open, high, low, close] = values;
      if (low > Math.min(open, close) || high < Math.max(open, close)) {
        throw new Error(`Høyeste eller laveste kurs stemmer ikke for ${item.symbol} ${date}.`);
      }
      return { date, open, high, low, close };
    }).sort((left, right) => left.date.localeCompare(right.date));
    if (bars.some((bar, index) => bar.date === bars[index - 1]?.date)) {
      throw new Error(`Filen har flere kurser for samme dato for ${item.symbol}.`);
    }
    return { symbol: item.symbol, name: String(item.name || item.symbol).slice(0, 90), currency: item.currency, bars };
  });
  return {
    source,
    fetched: validDate(input.fetched) ? input.fetched : "",
    warnings: Array.isArray(input.warnings) ? input.warnings.slice(0, 30).map(value => String(value).slice(0, 200)) : [],
    series,
  };
}

function csvData(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const separator = lines[0].includes(";") ? ";" : ",";
  const cells = line => line.split(separator).map(value => value.trim().replace(/^"|"$/g, "").trim());
  const header = cells(lines[0]).map(value => value.toLowerCase());
  const index = Object.fromEntries(columnNames.map(name => [name, header.indexOf(name)]));
  if (Object.values(index).includes(-1)) {
    throw new Error("CSV må ha kolonnene date, symbol, open, high, low, close og currency.");
  }
  const groups = new Map();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const values = cells(line);
    const symbol = (values[index.symbol] ?? "").toUpperCase();
    const currency = (values[index.currency] ?? "").toUpperCase();
    if (!groups.has(symbol)) groups.set(symbol, { symbol, currency, bars: [] });
    const group = groups.get(symbol);
    if (group.currency !== currency) throw new Error(`Ulike valutaer for ${symbol}.`);
    const prices = ["open", "high", "low", "close"].map(name => Number((values[index[name]] ?? "").replace(",", ".")));
    group.bars.push([values[index.date], ...prices]);
  }
  return { series: [...groups.values()] };
}

function chart(canvas, points, series, axisLabel) {
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height || !points.length) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.scale(ratio, ratio);
  context.font = "11px system-ui, sans-serif";

  const values = points.flatMap(point => series.map(line => point[line.key])).filter(value => value != null);
  const lower = Math.min(...values);
  const upper = Math.max(...values);
  const padding = (upper - lower || Math.max(1, Math.abs(upper) * 0.03)) * 0.08;
  const minimum = lower - padding;
  const maximum = upper + padding;
  const left = 10 + Math.ceil(context.measureText(axisLabel(maximum)).width);
  const right = width - 11;
  const top = 9;
  const bottom = height - 25;
  const x = index => left + (right - left) * (points.length === 1 ? 0.5 : index / (points.length - 1));
  const y = value => bottom - (bottom - top) * (value - minimum) / (maximum - minimum);
  const ticks = width < 450 ? 3 : 5;

  context.fillStyle = "#a8b9ce";
  context.lineWidth = 1;
  context.textBaseline = "middle";
  for (let line = 0; line < 5; line++) {
    const value = minimum + (maximum - minimum) * line / 4;
    const position = y(value);
    context.beginPath();
    context.strokeStyle = "#2c4056";
    context.moveTo(left, position);
    context.lineTo(right, position);
    context.stroke();
    context.textAlign = "left";
    context.fillText(axisLabel(value), 0, position);
  }

  context.textBaseline = "top";
  const tickCount = Math.min(ticks, points.length);
  for (let tick = 0; tick < tickCount; tick++) {
    const index = Math.round(tick * (points.length - 1) / Math.max(1, tickCount - 1));
    context.textAlign = tick === 0 ? "left" : tick === tickCount - 1 ? "right" : "center";
    context.fillText(dateLabel(points[index].date), x(index), bottom + 8);
  }

  for (const line of series) {
    context.strokeStyle = line.color;
    context.fillStyle = line.color;
    context.lineWidth = line.width;
    context.beginPath();
    let count = 0;
    let lastIndex = 0;
    points.forEach((point, index) => {
      if (point[line.key] == null) return;
      const value = point[line.key];
      if (count) context.lineTo(x(index), y(value));
      else context.moveTo(x(index), y(value));
      count++;
      lastIndex = index;
    });
    context.stroke();
    if (count === 1) {
      context.beginPath();
      context.arc(x(lastIndex), y(points[lastIndex][line.key]), 2.5, 0, Math.PI * 2);
      context.fill();
    }
  }
}

const demo = validatedData(JSON.parse(get("demo-data").textContent), "demo");
const embedded = JSON.parse(get("market-data").textContent);
let data = embedded ? validatedData(embedded, "market") : demo;
let selected = data.series[0].symbol;
let settings = { ...Strategy.defaults };
let ledger = storedLedger();
let studies = [];
let currentResult;

function selectedStudy() {
  return studies.find(item => item.symbol === selected);
}

function metrics(id, entries) {
  get(id).replaceChildren(...entries.map(([label, value, tone]) => {
    const node = element("div", null, "metric");
    node.append(element("span", label), element("strong", value, tone));
    return node;
  }));
}

function redrawCharts() {
  const study = selectedStudy();
  if (!study) return;
  const days = Number(get("chart-window").value);
  const cutoff = new Date(Date.parse(study.bars.at(-1).date) - days * 86400000).toISOString().slice(0, 10);
  const bars = days ? study.bars.filter(bar => bar.date >= cutoff) : study.bars;
  chart(get("price-chart"), bars, [
    { key: "slow", color: "#efbd79", width: 1.4 },
    { key: "fast", color: "#9ab5ff", width: 1.5 },
    { key: "close", color: "#64e6c1", width: 2 },
  ], value => format(value, value !== 0 && Math.abs(value) < 0.1 ? 5 : 2));
  if (currentResult) {
    chart(get("equity-chart"), currentResult.equity, [
      { key: "benchmark", color: "#efbd79", width: 1.5 },
      { key: "value", color: "#64e6c1", width: 2 },
    ], value => format(value, 1));
  }
}

function renderMarket() {
  const sourceLabel = {
    demo: "Eksempeldata · fiktive kurser",
    market: "Yahoo Finance · dagskurser",
    imported: "Importerte dagskurser",
  }[data.source];
  get("source-label").textContent = [sourceLabel, data.fetched ? `Hentet ${dateLabel(data.fetched)}` : ""].filter(Boolean).join(" · ");
  get("demo").hidden = data.source === "demo";
  const buys = studies.filter(item => item.bars.at(-1).signal === "buy").length;
  get("signal-count").textContent = `${buys} kjøpssignal${buys === 1 ? "" : "er"} · ${studies.length} instrument${studies.length === 1 ? "" : "er"}`;
  get("market-rows").replaceChildren(...studies.map(item => {
    const last = item.bars.at(-1);
    const button = element("button", item.symbol, "instrument");
    button.type = "button";
    button.setAttribute("aria-pressed", String(selected === item.symbol));
    button.append(element("span", item.name));
    button.addEventListener("click", () => {
      select(item.symbol);
      get("market-rows").querySelector('[aria-pressed="true"]').focus();
    });
    const tr = row([
      button, money(last.close, item.currency), element("span", directions[last.signal], `signal ${last.signal}`),
      dateLabel(last.date),
      last.rsi == null ? "–" : format(last.rsi, 1),
    ]);
    tr.classList.toggle("selected", selected === item.symbol);
    tr.addEventListener("click", event => {
      if (!button.contains(event.target)) select(item.symbol);
    });
    return tr;
  }));
}

function renderStudy() {
  const study = selectedStudy();
  const last = study.bars.at(-1);
  get("price-subtitle").textContent = `${study.name} · ${study.currency}`;
  get("fast-key").textContent = `SMA ${settings.fast}`;
  get("slow-key").textContent = `SMA ${settings.slow}`;
  const atr = last.signal === "buy" ? ` · ATR-stopavstand ${money(last.atr * settings.atrMultiplier, study.currency)}` : "";
  const rsi = last.rsi == null ? "" : ` · RSI ${format(last.rsi, 1)}`;
  get("signal-detail").textContent = `${directions[last.signal]} · ${dateLabel(last.date)}${rsi}${atr}`;
  get("test-subtitle").textContent = `${study.symbol} · dagskurser · ${study.currency}`;

  currentResult = Strategy.backtest(study.bars, settings);
  get("test-results").hidden = !currentResult;
  get("test-empty").hidden = Boolean(currentResult);
  if (currentResult) {
    const { returnRate, benchmarkReturn, drawdown, trades, position } = currentResult;
    metrics("results-metrics", [
      ["Strategi", percent(returnRate), returnRate >= 0 ? "positive" : "negative"],
      ["Kjøp og behold", percent(benchmarkReturn), benchmarkReturn >= 0 ? "positive" : "negative"],
      ["Største fall fra topp", percent(drawdown)],
      ["Avsluttede handler", String(trades.length)],
    ]);
    get("backtest-empty").hidden = Boolean(trades.length);
    get("backtest-table").hidden = !trades.length;
    get("backtest-rows").replaceChildren(...trades.slice().reverse().map(trade => row([
      dateLabel(trade.entryDate), dateLabel(trade.exitDate), money(trade.entryPrice, study.currency),
      money(trade.exitPrice, study.currency), trade.reason, money(trade.profit, study.currency),
    ])));
    get("open-position").hidden = !position;
    if (position) get("open-position").textContent = `Åpen posisjon ved periodens slutt · inngang ${dateLabel(position.entryDate)} · stop ${money(position.stop, study.currency)}.`;
  }
  requestAnimationFrame(redrawCharts);
}

function simulation() {
  const study = selectedStudy();
  const mode = data.source === "demo" ? "demo" : "market";
  const key = `${mode}:${study.currency}`;
  const account = ledger[key] ?? { capital: settings.capital, orders: [] };
  const quotes = new Map(studies.map(item => [item.symbol, { ...item.bars.at(-1), currency: item.currency, price: item.bars.at(-1).close }]));
  // An imported history can be older than an existing simulated trade.
  for (const order of account.orders) {
    const quote = quotes.get(order.symbol);
    if (quote && quote.date < order.date) quotes.delete(order.symbol);
  }
  const summary = Strategy.paperAccount(account.orders, study.currency, account.capital, quotes);
  return { study, key, account, summary };
}

function renderPaper() {
  const { study, account, summary } = simulation();
  const quote = study.bars.at(-1);
  const quantity = summary.holdings.get(study.symbol)?.quantity ?? 0;
  const modeLabel = data.source === "demo" ? "Eksempelkonto" : "Simulert konto";
  get("paper-currency").textContent = `${modeLabel} · ${study.currency}`;
  get("paper-description").textContent = `${study.symbol} · simulert kurs ${money(quote.close, study.currency)} fra ${dateLabel(quote.date)}.`;
  metrics("paper-metrics", [
    ["Tilgjengelig", money(summary.cash, study.currency)],
    ["Kontoverdi", money(summary.value, study.currency)],
    [`Beholdning · ${study.symbol}`, format(quantity, 8)],
  ]);
  get("paper-empty").hidden = Boolean(account.orders.length);
  get("paper-table").hidden = !account.orders.length;
  get("paper-reset").hidden = !account.orders.length;
  get("paper-rows").replaceChildren(...account.orders.slice().reverse().map(order => row([
    dateLabel(order.date), order.symbol, order.side === "buy" ? "Kjøp" : "Salg",
    format(order.quantity, 8), money(order.price, study.currency), money(order.fee, study.currency),
  ])));
}

function refresh() {
  studies = data.series.map(item => ({ ...item, bars: Strategy.indicators(item.bars, settings) }));
  renderMarket();
  renderStudy();
  renderPaper();
}

function select(symbol) {
  selected = symbol;
  status("paper-status", "");
  renderMarket();
  renderStudy();
  renderPaper();
}

function useData(next, message) {
  data = next;
  selected = next.series[0].symbol;
  settings = { ...settings, start: "", end: "" };
  get("dates-form").reset();
  status("dates-status", "");
  status("paper-status", "");
  status("data-status", [message, ...next.warnings].filter(Boolean).join(" · "));
  refresh();
}

const strategyForm = get("strategy-form");
for (const control of strategyForm.querySelectorAll("input")) control.value = settings[control.name];

strategyForm.addEventListener("submit", event => {
  event.preventDefault();
  const values = Object.fromEntries([...new FormData(strategyForm)].map(([key, value]) => [key, Number(value)]));
  if (values.fast >= values.slow || values.rsiMin > values.rsiMax) {
    status("strategy-status", "Kort SMA må være lavere enn lang SMA, og RSI fra må være lavere enn eller lik RSI til.");
    return;
  }
  settings = { ...settings, ...values };
  status("strategy-status", "");
  refresh();
});

get("dates-form").addEventListener("submit", event => {
  event.preventDefault();
  const { start, end } = Object.fromEntries(new FormData(event.currentTarget));
  if (start && end && start > end) {
    status("dates-status", "Startdatoen må komme før eller på sluttdatoen.");
    return;
  }
  settings = { ...settings, start, end };
  status("dates-status", "");
  renderStudy();
});

get("chart-window").addEventListener("change", redrawCharts);
const chartObserver = new ResizeObserver(redrawCharts);
chartObserver.observe(get("price-chart"));
chartObserver.observe(get("equity-chart"));
window.addEventListener("storage", event => {
  if (event.key !== storageKey && event.key !== null) return;
  ledger = storedLedger();
  renderPaper();
});

get("paper-form").addEventListener("submit", event => {
  event.preventDefault();
  const side = event.submitter?.value ?? "buy";
  const quantity = Number(new FormData(event.currentTarget).get("quantity"));
  const { study, key, account, summary } = simulation();
  const quote = study.bars.at(-1);
  const amount = quantity * quote.close;
  const fee = amount * settings.feePercent / 100;
  const available = summary.holdings.get(study.symbol)?.quantity ?? 0;
  if (account.orders.length >= 2000) {
    status("paper-status", "Ordreloggen har nådd 2 000 handler i denne kontoen.");
    return;
  }
  if (account.orders.at(-1)?.date > quote.date) {
    status("paper-status", "Kursdatoen er eldre enn den siste handelen i denne kontoen.");
    return;
  }
  if ((side === "buy" && amount + fee > summary.cash + 1e-8) || (side === "sell" && quantity > available + 1e-9)) {
    status("paper-status", side === "buy" ? "For lite disponibelt beløp til kjøp og kurtasje." : "Du har for få enheter til å simulere dette salget.");
    return;
  }
  const order = { date: quote.date, symbol: study.symbol, currency: study.currency, side, quantity, price: quote.close, fee };
  ledger = { ...ledger, [key]: { ...account, orders: [...account.orders, order] } };
  const saved = persist(ledger);
  status("paper-status", saved ? (side === "buy" ? "Kjøpet er simulert." : "Salget er simulert.") : "Handelen er simulert for denne økten. Nettleseren kunne ikke lagre den.");
  renderPaper();
});

get("paper-reset").addEventListener("click", () => {
  const { study, key } = simulation();
  if (!window.confirm(`Nullstille den simulerte kontoen i ${study.currency} og slette ordreloggen?`)) return;
  delete ledger[key];
  const saved = persist(ledger);
  status("paper-status", saved ? "Den simulerte kontoen er nullstilt." : "Kontoen er nullstilt for denne økten.");
  renderPaper();
});

get("demo").addEventListener("click", () => useData(demo, ""));
get("import").addEventListener("click", () => get("data-file").click());
get("data-file").addEventListener("change", async event => {
  const file = event.currentTarget.files[0];
  event.currentTarget.value = "";
  if (!file) return;
  try {
    if (file.size > 18 * 1024 * 1024) throw new Error("Filen er større enn 18 MB.");
    const content = await file.text();
    const input = file.name.toLowerCase().endsWith(".csv") ? csvData(content) : JSON.parse(content);
    const source = input?.source === "demo" ? "demo" : input?.source === "market" ? "market" : "imported";
    useData(validatedData(input, source), `${file.name} er lest inn.`);
  } catch (error) {
    status("data-status", `Kunne ikke lese kursdata. ${error instanceof SyntaxError ? "JSON-filen har ugyldig format." : error.message}`);
  }
});

status("data-status", data.warnings.join(" · "));
refresh();
