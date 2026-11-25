"use strict";

const Strategy = (() => {
  const defaults = {
    fast: 20, slow: 50, rsiPeriod: 14, rsiMin: 50, rsiMax: 70,
    atrPeriod: 14, atrMultiplier: 2, riskPercent: 1, feePercent: 0.1,
    capital: 100000, start: "", end: "",
  };

  function movingAverage(values, period) {
    let sum = 0;
    return values.map((value, index) => {
      sum += value;
      if (index >= period) sum -= values[index - period];
      return index >= period - 1 ? sum / period : null;
    });
  }

  function wilder(values, period) {
    let average = 0;
    return values.map((value, index) => {
      if (index < period) {
        average += value / period;
        return index === period - 1 ? average : null;
      }
      average += (value - average) / period;
      return average;
    });
  }

  function indicators(bars, settings) {
    const closes = bars.map(bar => bar.close);
    const fast = movingAverage(closes, settings.fast);
    const slow = movingAverage(closes, settings.slow);
    const changes = closes.slice(1).map((close, index) => close - closes[index]);
    const gains = wilder(changes.map(change => Math.max(change, 0)), settings.rsiPeriod);
    const losses = wilder(changes.map(change => Math.max(-change, 0)), settings.rsiPeriod);
    const ranges = bars.map((bar, index) => {
      const previousClose = index ? closes[index - 1] : bar.open;
      return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
    });
    const atr = wilder(ranges, settings.atrPeriod);

    return bars.map((bar, index) => {
      const gain = gains[index - 1];
      const loss = losses[index - 1];
      const rsi = gain == null ? null : loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
      const ready = slow[index] != null && slow[index - 1] != null && rsi != null && atr[index] != null;
      let signal = "warmup";
      if (ready) {
        const above = fast[index] > slow[index];
        const crossedUp = above && fast[index - 1] <= slow[index - 1];
        const crossedDown = fast[index] < slow[index] && fast[index - 1] >= slow[index - 1];
        signal = "hold";
        if (crossedDown) signal = "sell";
        if (crossedUp && rsi >= settings.rsiMin && rsi <= settings.rsiMax && atr[index] > 0) signal = "buy";
      }
      return { ...bar, fast: fast[index], slow: slow[index], rsi, atr: atr[index], signal };
    });
  }

  function backtest(enriched, settings) {
    const { start, end, capital, atrMultiplier, riskPercent, feePercent } = settings;
    const feeRate = feePercent / 100;
    const bars = enriched.filter(bar => (!start || bar.date >= start) && (!end || bar.date <= end));
    const first = bars.findIndex(bar => bar.signal !== "warmup");
    if (first === -1) return null;
    const eligible = bars.slice(first);
    // First benchmark entry uses the same first tradable open as the strategy.
    const benchmarkOpen = eligible[1]?.open ?? eligible[0].close;
    const benchmarkQuantity = capital / (benchmarkOpen * (1 + feeRate));
    let cash = capital;
    let position = null;
    let peak = capital;
    let drawdown = 0;
    const trades = [];
    const equity = [];

    function closePosition(bar, price, reason) {
      const proceeds = price * position.quantity * (1 - feeRate);
      cash += proceeds;
      trades.push({
        ...position, exitDate: bar.date, exitPrice: price, reason,
        profit: proceeds - position.cost,
      });
      position = null;
    }

    eligible.forEach((bar, index) => {
      const previous = eligible[index - 1];
      if (position && bar.open <= position.stop) {
        closePosition(bar, bar.open, "Stop ved åpning");
      } else if (position && previous?.signal === "sell") {
        closePosition(bar, bar.open, "Salgssignal");
      } else if (!position && previous?.signal === "buy") {
        const distance = previous.atr * atrMultiplier;
        const stop = Math.max(0, bar.open - distance);
        const costPerUnit = bar.open * (1 + feeRate);
        const riskPerUnit = costPerUnit - stop * (1 - feeRate);
        const quantity = Math.min(cash / costPerUnit, capital * riskPercent / 100 / riskPerUnit);
        if (quantity > 0) {
          const cost = quantity * costPerUnit;
          cash -= cost;
          position = { entryDate: bar.date, entryPrice: bar.open, quantity, stop, cost };
        }
      }
      if (position && bar.low <= position.stop) closePosition(bar, position.stop, "ATR-stop");

      const value = cash + (position ? position.quantity * bar.close * (1 - feeRate) : 0);
      peak = Math.max(peak, value);
      drawdown = Math.max(drawdown, (peak - value) / peak);
      equity.push({
        date: bar.date, value,
        benchmark: index === 0 ? capital : benchmarkQuantity * bar.close * (1 - feeRate),
      });
    });

    const final = equity.at(-1);
    return {
      equity, trades, drawdown, position,
      returnRate: final.value / capital - 1,
      benchmarkReturn: final.benchmark / capital - 1,
    };
  }

  function paperAccount(orders, currency, capital, quotes) {
    const holdings = new Map();
    let cash = capital;
    for (const order of orders) {
      if (order.currency !== currency) continue;
      const previous = holdings.get(order.symbol) ?? { quantity: 0, price: order.price };
      const amount = order.price * order.quantity;
      const sign = order.side === "buy" ? 1 : -1;
      cash -= sign * amount + order.fee;
      const quantity = previous.quantity + sign * order.quantity;
      if (quantity > 1e-9) holdings.set(order.symbol, { quantity, price: order.price });
      else holdings.delete(order.symbol);
    }
    let value = cash;
    for (const [symbol, holding] of holdings) {
      const quote = quotes.get(symbol);
      const price = quote?.currency === currency ? quote.price : holding.price;
      value += price * holding.quantity;
    }
    return { cash, holdings, value };
  }

  return { defaults, indicators, backtest, paperAccount };
})();
if (typeof module !== "undefined") module.exports = Strategy;
