(function () {
  "use strict";

  const KEY = "personalExpensePlanner.state.v1";
  const BACKUP_KEY = "personalExpensePlanner.backup.v1";
  const MAX_MONEY = 99999999999;
  const CAT_NAMES = [
    ["mortgage", "Ипотека"], ["credit", "Кредиты"], ["utilities", "Коммунальные услуги"],
    ["school", "Школа и питание"], ["activities", "Кружки и секции"], ["phone", "Связь"],
    ["food", "Продукты"], ["personal", "Личные нужды"], ["transport", "Транспорт"],
    ["health", "Здоровье"], ["other", "Другое"]
  ];

  class InputError extends Error {
    constructor(message, field) { super(message); this.name = "InputError"; this.field = field || null; }
  }
  function fail(message, field) { throw new InputError(message, field); }
  function assert(condition, message) { if (!condition) throw new Error(message || "Некорректные данные."); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function stamp() { return new Date().toISOString(); }
  function todayLocal() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split("-").map(Number);
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
    const test = new Date(Date.UTC(y, m - 1, d));
    return test.getUTCFullYear() === y && test.getUTCMonth() === m - 1 && test.getUTCDate() === d;
  }
  function validMonth(value) { return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 1900 && Number(value.slice(0, 4)) <= 2100; }
  function monthOf(date) { return date.slice(0, 7); }
  function monthShift(month, offset) {
    const [y, m] = month.split("-").map(Number), d = new Date(Date.UTC(y, m - 1 + offset, 1));
    return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
  }
  function monthEnd(month) {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }
  function dateForDay(month, day) {
    assert(validMonth(month) && Number.isInteger(day) && day >= 1 && day <= 31, "Неверный месяц или день.");
    return month + "-" + String(Math.min(day, Number(monthEnd(month).slice(8)))).padStart(2, "0");
  }
  function incomeDate(month, day) {
    const date = dateForDay(month, day), d = new Date(date + "T12:00:00Z"), w = d.getUTCDay();
    if (w === 6) d.setUTCDate(d.getUTCDate() - 1);
    if (w === 0) d.setUTCDate(d.getUTCDate() - 2);
    return d.toISOString().slice(0, 10);
  }
  function safeSum(values) {
    let total = 0;
    for (const value of values) { total += value; assert(Number.isSafeInteger(total), "Итоговая сумма слишком велика."); }
    return total;
  }
  function moneyValid(value, signed, positive) {
    return Number.isSafeInteger(value) && Math.abs(value) <= MAX_MONEY && (signed || value >= 0) && (!positive || value > 0);
  }
  function parseMoney(value, options) {
    const opts = options || {}, raw = String(value == null ? "" : value).replace(/[\s\u00a0\u202f]/g, "");
    if (!/^-?\d+(?:[.,]\d{1,2})?$/.test(raw)) fail("Введите сумму: например, 1 234,50.", opts.field);
    const negative = raw.startsWith("-"), parts = raw.replace(/^-/, "").split(/[.,]/);
    const amount = (Number(parts[0]) * 100 + Number((parts[1] || "").padEnd(2, "0"))) * (negative ? -1 : 1);
    if (!moneyValid(amount, !!opts.signed, !!opts.positive)) fail(opts.positive ? "Сумма должна быть больше нуля и не превышать 999 999 999,99 ₽." : "Сумма вне допустимого диапазона.", opts.field);
    return amount;
  }
  function text(value, name, max, field) {
    const result = String(value == null ? "" : value).trim();
    if (!result || result.length > max) fail(name + ": от 1 до " + max + " символов.", field);
    return result;
  }
  function note(value) { const v = String(value || "").trim(); if (v.length > 500) fail("Заметка — не больше 500 символов.", "note"); return v; }
  function readDate(value, field, today, factual) {
    if (!validDate(value)) fail("Выберите существующую дату.", field);
    if (factual && value > today) fail("Фактическая дата не может быть позже сегодня.", field);
    return value;
  }
  function readDay(value, field) { const v = Number(value); if (!/^\d{1,2}$/.test(String(value)) || !Number.isInteger(v) || v < 1 || v > 31) fail("Укажите день от 1 до 31.", field); return v; }
  function id(state) {
    const used = new Set(["categories", "incomeRules", "expenseTemplates", "incomes", "expenses", "operations", "lifeBudgetOverrides", "balanceCorrections"].flatMap(key => (state[key] || []).map(x => x.id)));
    let result;
    do {
      try { result = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : null; } catch (_) { result = null; }
      if (!result) result = "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
    } while (used.has(result));
    return result;
  }
  function createState(today) {
    const time = stamp();
    return {
      appId: "personal-expense-planner", schemaVersion: 1, revision: 0, createdAt: time, updatedAt: time,
      lastProcessedDate: today, onboarding: { completed: false, step: 1 },
      settings: { theme: "paper-plum", lifeAfterSalary: 0, lifeAfterAdvance: 0, lifeWithoutRegularIncome: 0, reserveTarget: 0 },
      balanceAnchor: null, balanceCorrections: [],
      categories: CAT_NAMES.map(([key, name]) => ({ id: "cat-" + key, name: name, active: true, systemKey: key, createdAt: time })),
      incomeRules: [
        { id: "rule-salary", kind: "salary", title: "Зарплата", day: 10, amount: null, active: true, createdAt: time },
        { id: "rule-advance", kind: "advance", title: "Аванс", day: 25, amount: null, active: true, createdAt: time }
      ],
      expenseTemplates: [], incomes: [], expenses: [], operations: [], lifeBudgetOverrides: [], monthCoverage: {}
    };
  }
  function operation(state, source) { return source.operationId ? state.operations.find(x => x.id === source.operationId && x.status === "active") || null : null; }
  function sources(state, type) { return type === "income" ? state.incomes : state.expenses; }
  function sourceById(state, type, sourceId) { const s = sources(state, type).find(x => x.id === sourceId); assert(s, "Запись не найдена."); return s; }
  function effectiveIncomeDate(state, income) { const op = operation(state, income); return op ? op.date : income.manualDate || income.plannedDate; }
  function actualBalance(state) {
    if (!state.balanceAnchor) return 0;
    const included = new Set(state.balanceAnchor.includedOperationIds);
    return safeSum([state.balanceAnchor.amount].concat(state.operations.filter(op => op.status === "active" && !included.has(op.id)).map(op => op.type === "income" ? op.amount : -op.amount)));
  }
  function monthlyFacts(state, month) {
    const ops = state.operations.filter(op => op.status === "active" && monthOf(op.date) === month);
    const income = safeSum(ops.filter(op => op.type === "income").map(op => op.amount));
    const expense = safeSum(ops.filter(op => op.type === "expense").map(op => op.amount));
    return { income: income, expense: expense, difference: income - expense };
  }
  function currentPeriod(state, today) {
    const month = monthOf(today), anchors = regularAnchors(state, today);
    const previous = anchors.filter(x => x.date <= today), start = previous.length ? previous[previous.length - 1].date : month + "-01";
    const group = previous.filter(x => x.date === start);
    const next = anchors.find(x => x.date > today);
    return { key: group.length ? group.map(x => x.id).sort().join("+") : "calendar/" + month, start: start, end: next ? next.date : monthShift(month, 1) + "-01", anchors: group };
  }
  function regularAnchors(state, today) {
    const anchors = [], month = monthOf(today);
    for (const rule of state.incomeRules.filter(r => r.active && r.amount !== null)) {
      const nominal = new Set([-2, -1, 0, 1, 2].map(n => monthShift(month, n)));
      for (const item of state.incomes.filter(x => x.ruleId === rule.id)) nominal.add(item.originMonth);
      for (const m of nominal) {
        const key = "income/" + rule.id + "/" + m, item = state.incomes.find(x => x.id === key);
        if (item && item.status === "canceled") continue;
        anchors.push({ id: key, date: item ? effectiveIncomeDate(state, item) : incomeDate(m, rule.day), kind: rule.kind,
          budget: rule.kind === "salary" ? state.settings.lifeAfterSalary : state.settings.lifeAfterAdvance });
      }
    }
    return anchors.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }
  function expenseOrder(a, b) {
    return a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  }
  function paymentDate(item, today) { const date = item.manualPayDate || item.dueDate; return date < today ? today : date; }
  function addDays(date, days) { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
  function setPaymentDate(state, sourceId, value, confirmedLate, today) {
    const item = sourceById(state, "expense", sourceId);
    assert(item.status === "pending", "Дату можно задать только неоплаченному расходу.");
    if (!value) { item.manualPayDate = null; item.updatedAt = stamp(); return; }
    const date = readDate(value, "manualPayDate", today, false);
    if (date < today || date > monthEnd(monthOf(today))) fail("Дата оплаты — от сегодня до конца текущего месяца.", "manualPayDate");
    if (date > item.dueDate && !confirmedLate) fail("Оплата будет позже срока. Подтвердите предупреждение.", "confirmedLate");
    item.manualPayDate = date; item.updatedAt = stamp();
  }
  function reconcileBudgets(state, today) {
    const anchors = regularAnchors(state, today), keys = new Set(anchors.map(a => a.id)), messages = [];
    state.lifeBudgetOverrides = state.lifeBudgetOverrides.filter(b => {
      const parts = budgetKeyParts(state, b.periodKey);
      if (parts.length < 2 || !parts.every(k => keys.has(k))) return true;
      const dates = parts.map(k => anchors.find(a => a.id === k).date);
      if (new Set(dates).size === 1) return true;
      messages.push("Общая граница поступлений разделилась: точка бюджета сброшена. Уточните оставшуюся сумму на жизнь.");
      return false;
    });
    for (const date of Array.from(new Set(anchors.map(a => a.date))).filter(d => d <= today)) {
      const group = anchors.filter(a => a.date === date);
      if (group.length < 2) continue;
      const key = group.map(a => a.id).sort().join("+");
      if (state.lifeBudgetOverrides.some(b => b.periodKey === key)) continue;
      const parts = group.map(a => ({ anchor: a, point: state.lifeBudgetOverrides.find(b => b.periodKey === a.id) }));
      const points = parts.filter(x => x.point).map(x => x.point);
      if (!points.length) continue;
      const coverage = points.map(b => b.coverageStartDate).sort()[0];
      state.lifeBudgetOverrides = state.lifeBudgetOverrides.filter(b => !group.some(a => b.periodKey === a.id));
      state.lifeBudgetOverrides.push({ id: id(state), periodKey: key, amount: safeSum(parts.map(x => x.point ? x.point.amount : x.anchor.budget)),
        coverageStartDate: coverage < date ? date : coverage,
        includedLivingOperationIds: Array.from(new Set(points.flatMap(b => b.includedLivingOperationIds))), createdAt: stamp() });
    }
    return messages;
  }
  function budgetPeriods(state, today, horizon, pending) {
    const anchors = regularAnchors(state, today), periods = [];
    if (!anchors.length) {
      for (let m = monthOf(today); m + "-01" < horizon; m = monthShift(m, 1))
        periods.push({ key: "calendar/" + m, start: m + "-01", end: monthShift(m, 1) + "-01", anchors: [], standard: state.settings.lifeWithoutRegularIncome });
    } else {
      const dates = Array.from(new Set(anchors.map(a => a.date))).sort();
      for (let i = 0; i < dates.length - 1; i++) {
        const start = dates[i], end = dates[i + 1];
        if (end <= today || start >= horizon) continue;
        const group = anchors.filter(a => a.date === start);
        periods.push({ key: group.map(a => a.id).sort().join("+"), start: start, end: end, anchors: group, standard: safeSum(group.map(a => a.budget)) });
      }
    }
    for (const p of periods) {
      const exact = state.lifeBudgetOverrides.find(b => b.periodKey === p.key);
      const parts = p.anchors.map(a => ({ anchor: a, point: state.lifeBudgetOverrides.find(b => b.periodKey === a.id) }));
      const points = exact ? [exact] : parts.filter(x => x.point).map(x => x.point);
      p.amount = exact ? exact.amount : points.length ? safeSum(parts.map(x => x.point ? x.point.amount : x.anchor.budget)) : p.standard;
      p.coverageStart = points.length ? points.map(b => b.coverageStartDate).sort()[0] : p.start;
      if (p.coverageStart < p.start) p.coverageStart = p.start;
      p.included = new Set(points.flatMap(b => b.includedLivingOperationIds));
      p.actual = safeSum(state.operations.filter(o => o.status === "active" && o.type === "expense" && o.isLiving && o.date >= p.coverageStart && o.date < p.end && !p.included.has(o.id)).map(o => o.amount));
      p.planned = safeSum(pending.filter(e => e.isLiving && paymentDate(e, today) >= p.coverageStart && paymentDate(e, today) < p.end).map(e => e.plannedAmount));
      p.remaining = Math.max(0, safeSum([p.amount, -p.actual]));
      p.unassigned = Math.max(0, safeSum([p.amount, -p.actual, -p.planned]));
      p.exceeded = Math.max(0, safeSum([p.actual, p.planned, -p.amount]));
      p.eventDate = p.coverageStart < today ? today : p.coverageStart;
      delete p.included;
    }
    return periods;
  }
  function forecast(balance, incomes, expenses, periods, today, horizon) {
    const events = [];
    const dates = Array.from(new Set(incomes.map(i => i.date))).sort();
    for (const date of dates) { const group = incomes.filter(i => i.date === date); events.push({ date: date, rank: 0, id: group.map(i => i.id).sort().join("+"), title: group.map(i => i.title).join(" + "), amount: safeSum(group.map(i => i.amount)), type: "income" }); }
    for (const p of periods) if (p.unassigned && p.eventDate < horizon) events.push({ date: p.eventDate, rank: 1, id: p.key, title: "Оставить на жизнь", amount: p.unassigned, type: "life" });
    for (const e of expenses) {
      const date = paymentDate(e, today);
      if (date >= horizon) continue;
      events.push({ date: date, rank: e.mandatory || e.isLiving ? 2 : e.manualPayDate ? 3 : 4, id: e.id, title: e.title, amount: e.plannedAmount, type: "expense", expense: e });
    }
    events.sort((a, b) => a.date.localeCompare(b.date) || a.rank - b.rank || (a.expense && b.expense ? expenseOrder(a.expense, b.expense) : a.id.localeCompare(b.id)));
    let cash = balance, protectedCash = balance, minCash = balance, minimum = balance;
    let cashGap = balance < 0 ? { date: today, amount: -balance, id: null } : null, livingGap = null;
    for (const event of events) {
      if (event.type === "income") { cash = safeSum([cash, event.amount]); protectedCash = safeSum([protectedCash, event.amount]); }
      else if (event.type === "life") protectedCash = safeSum([protectedCash, -event.amount]);
      else { cash = safeSum([cash, -event.amount]); protectedCash = safeSum([protectedCash, -event.amount]); }
      event.cash = cash; event.protected = protectedCash;
      minCash = Math.min(minCash, cash); minimum = Math.min(minimum, protectedCash);
      if (cash < 0 && (!cashGap || -cash > cashGap.amount)) cashGap = { date: event.date, amount: -cash, id: event.id };
      if (cash >= 0 && protectedCash < 0 && (!livingGap || -protectedCash > livingGap.amount)) livingGap = { date: event.date, amount: -protectedCash, id: event.id };
    }
    return { events: events, minCash: minCash, minimum: minimum, endCash: cash, endProtected: protectedCash, cashGap: cashGap, livingGap: livingGap };
  }
  function calculatePlan(state, today) {
    const month = monthOf(today), end = monthEnd(month), nextMonth = monthShift(month, 1), balance = actualBalance(state);
    const anchors = regularAnchors(state, today), nextBoundary = anchors.find(a => a.date > end);
    const horizon = nextBoundary ? nextBoundary.date : nextMonth + "-01";
    const incomes = state.incomes.filter(i => i.status === "expected" && effectiveIncomeDate(state, i) >= today && effectiveIncomeDate(state, i) < horizon)
      .map(i => ({ id: i.id, title: i.title, amount: i.plannedAmount, date: effectiveIncomeDate(state, i) }));
    // Future regular receipts inside the technical horizon are read-only rule projections.
    for (const a of anchors.filter(a => a.date >= today && a.date < horizon)) {
      if (state.incomes.some(i => i.id === a.id)) continue;
      const rule = state.incomeRules.find(r => a.id.startsWith("income/" + r.id + "/"));
      incomes.push({ id: a.id, title: rule.title, amount: rule.amount, date: a.date });
    }
    const pending = state.expenses.filter(e => e.status === "pending" && paymentDate(e, today) < horizon);
    const guard = [];
    for (const t of state.expenseTemplates.filter(t => t.active && !t.archived && (t.mandatory || t.isLiving))) {
      const key = "expense/" + t.id + "/" + nextMonth, existing = state.expenses.find(e => e.id === key);
      if (existing) continue;
      const due = dateForDay(nextMonth, t.dueDay);
      if (due >= horizon) continue;
      guard.push({ id: key, title: t.title, plannedAmount: t.amount, dueDate: due, originalDueDate: due, createdAt: t.createdAt, mandatory: true, isLiving: t.isLiving, manualPayDate: null, technical: true });
    }
    const all = pending.concat(guard), periods = budgetPeriods(state, today, horizon, all);
    const required = all.filter(e => e.mandatory || e.isLiving);
    const manual = all.filter(e => !e.mandatory && !e.isLiving && e.manualPayDate);
    const run = list => forecast(balance, incomes, list, periods, today, horizon);
    const base = run(required), initialReserve = Math.min(state.settings.reserveTarget, Math.max(0, base.minimum));
    const selected = required.concat(manual);
    let result = run(selected);
    const reserve = Math.min(state.settings.reserveTarget, Math.max(0, result.minimum)), declined = [];
    for (const item of all.filter(e => !e.mandatory && !e.isLiving && !e.manualPayDate).sort(expenseOrder)) {
      const candidate = run(selected.concat(item));
      if (result.minCash >= 0 && result.minimum >= 0 && candidate.minCash >= 0 && candidate.minimum >= reserve) { selected.push(item); result = candidate; }
      else declined.push(item);
    }
    const acceptedIds = new Set(selected.map(e => e.id)), declinedIds = new Set(declined.map(e => e.id));
    const groups = [{ id: "balance", date: today, title: "Из текущего остатка", incomes: [], expenses: [] }];
    for (const date of Array.from(new Set(incomes.map(i => i.date))).sort()) {
      const receipt = incomes.filter(i => i.date === date);
      groups.push({ id: receipt.map(i => i.id).sort().join("+"), date: date, title: "Из поступления: " + receipt.map(i => i.title).join(" + "), incomes: receipt, expenses: [] });
    }
    const cards = {};
    for (const e of pending) {
      const date = paymentDate(e, today), group = groups.filter(g => g.date <= date).slice(-1)[0];
      const event = result.events.find(v => v.id === e.id && v.type === "expense");
      cards[e.id] = { date: date, group: group.id, accepted: acceptedIds.has(e.id), declined: declinedIds.has(e.id), shortage: !!event && event.cash < 0, livingShortage: !!event && event.cash >= 0 && event.protected < 0 };
      if (acceptedIds.has(e.id)) group.expenses.push(e);
    }
    for (const g of groups) g.expenses.sort((a, b) => paymentDate(a, today).localeCompare(paymentDate(b, today)) || a.dueDate.localeCompare(b.dueDate) || Number(b.mandatory) - Number(a.mandatory) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const facts = monthlyFacts(state, month);
    const remainingIncome = safeSum(state.incomes.filter(i => i.status === "expected" && monthOf(effectiveIncomeDate(state, i)) === month).map(i => i.plannedAmount));
    const remainingExpense = safeSum(state.expenses.filter(e => e.status === "pending" && monthOf(paymentDate(e, today)) === month).map(e => e.plannedAmount));
    const incomePlan = safeSum([facts.income, remainingIncome]), expensePlan = safeSum([facts.expense, remainingExpense]);
    const upcoming = state.incomes.filter(i => i.status === "expected" && effectiveIncomeDate(state, i) >= today).map(i => ({ title: i.title, amount: i.plannedAmount, date: effectiveIncomeDate(state, i), projected: false }));
    for (const a of anchors.filter(a => a.date >= today && !state.incomes.some(i => i.id === a.id))) {
      const rule = state.incomeRules.find(r => a.id.startsWith("income/" + r.id + "/"));
      upcoming.push({ title: rule.title, amount: rule.amount, date: a.date, projected: true });
    }
    upcoming.sort((a, b) => a.date.localeCompare(b.date));
    return { today: today, horizon: horizon, balance: balance, incomes: incomes, periods: periods, currentBudget: periods.find(p => p.start <= today && p.end > today),
      nextIncome: upcoming[0] || null,
      reserve: reserve, reserveUsed: reserve < initialReserve, available: Math.max(0, safeSum([result.minimum, -reserve])), forecast: result, cards: cards, groups: groups, declined: declined,
      guard: selected.filter(e => paymentDate(e, today) > end), facts: facts, incomePlan: incomePlan, expensePlan: expensePlan, differencePlan: safeSum([incomePlan, -expensePlan]), remainingIncome: remainingIncome, remainingExpense: remainingExpense };
  }
  function setLifeBudget(state, amount, today) {
    const period = currentPeriod(state, today);
    const parts = budgetKeyParts(state, period.key);
    state.lifeBudgetOverrides = state.lifeBudgetOverrides.filter(x => !budgetKeyParts(state, x.periodKey).every(k => parts.includes(k)));
    state.lifeBudgetOverrides.push({
      id: id(state), periodKey: period.key, coverageStartDate: today, amount: amount,
      includedLivingOperationIds: state.operations.filter(x => x.status === "active" && x.type === "expense" && x.date <= today).map(x => x.id), createdAt: stamp()
    });
  }
  function correctBalance(state, amount, today, description) {
    const time = stamp();
    state.balanceAnchor = { date: today, amount: amount, includedOperationIds: state.operations.filter(op => op.status === "active" && op.date <= today).map(op => op.id), createdAt: time, note: description || "" };
    state.balanceCorrections.push({ id: id(state), date: today, amount: amount, createdAt: time, note: description || "" });
  }
  function syncInclusion(state, op, includeAnchor, includeLiving) {
    const anchor = state.balanceAnchor;
    if (anchor) {
      anchor.includedOperationIds = anchor.includedOperationIds.filter(x => x !== op.id);
      if (op.date < anchor.date || (op.date === anchor.date && includeAnchor)) anchor.includedOperationIds.push(op.id);
    }
    for (const b of state.lifeBudgetOverrides) {
      const wasIncluded = b.includedLivingOperationIds.includes(op.id);
      b.includedLivingOperationIds = b.includedLivingOperationIds.filter(x => x !== op.id);
      if (op.type === "expense" && (op.date < b.coverageStartDate || (op.date === b.coverageStartDate && includeLiving))) b.includedLivingOperationIds.push(op.id);
      else if (wasIncluded && op.date < b.coverageStartDate) b.includedLivingOperationIds.push(op.id);
    }
  }
  function settleSource(state, type, sourceId, data, today) {
    const source = sourceById(state, type, sourceId);
    if (source.status === "paid" || source.status === "received") return null;
    assert(source.status !== "canceled", "Отменённую запись нельзя отметить фактической.");
    const op = {
      id: id(state), type: type, sourceId: source.id,
      amount: data.amount == null ? source.plannedAmount : data.amount,
      date: data.date || today, title: source.title,
      categoryId: type === "expense" ? source.categoryId : null,
      incomeKind: type === "income" ? source.kind : null,
      isLiving: type === "expense" && source.isLiving,
      status: "active", createdAt: stamp(), updatedAt: stamp(), voidedAt: null
    };
    assert(moneyValid(op.amount, false, true) && validDate(op.date) && op.date <= today, "Неверная фактическая сумма или дата.");
    state.operations.push(op);
    source.operationId = op.id; source.status = type === "income" ? "received" : "paid"; source.updatedAt = stamp();
    syncInclusion(state, op, !!data.includeAnchor, !!data.includeLiving);
    if (!state.monthCoverage[monthOf(op.date)]) state.monthCoverage[monthOf(op.date)] = "partial";
    return op.id;
  }
  function voidOperation(state, type, sourceId) {
    const source = sourceById(state, type, sourceId), op = operation(state, source);
    if (!op) return false;
    op.status = "void"; op.voidedAt = stamp(); op.updatedAt = stamp();
    source.operationId = null; source.status = type === "income" ? "expected" : "pending"; source.updatedAt = stamp();
    return true;
  }
  function fixOperation(state, type, sourceId, data, today) {
    const source = sourceById(state, type, sourceId), op = operation(state, source);
    assert(op, "Фактическая операция не найдена.");
    op.amount = parseMoney(data.actualAmount, { positive: true, field: "actualAmount" });
    op.date = readDate(data.actualDate, "actualDate", today, true);
    op.title = source.title; op.categoryId = type === "expense" ? source.categoryId : null;
    op.incomeKind = type === "income" ? source.kind : null; op.isLiving = type === "expense" && source.isLiving; op.updatedAt = stamp();
    syncInclusion(state, op, !!data.includeAnchor, !!data.includeLiving);
    source.updatedAt = stamp();
    if (!state.monthCoverage[monthOf(op.date)]) state.monthCoverage[monthOf(op.date)] = "partial";
  }
  function cancelSource(state, type, sourceId) {
    const source = sourceById(state, type, sourceId);
    assert(!operation(state, source), "Сначала снимите фактическую отметку.");
    source.status = "canceled"; source.updatedAt = stamp();
    if (type === "expense") source.cancelReason = "user";
  }
  function categoryFor(state, categoryId, currentId) {
    const cat = state.categories.find(x => x.id === categoryId);
    if (!cat || (!cat.active && categoryId !== currentId)) fail("Выберите доступную категорию.", "categoryId");
    return cat;
  }
  function expenseInput(state, data, today, existing) {
    const category = categoryFor(state, data.categoryId, existing && existing.categoryId);
    const isLiving = !!data.isLiving, mandatory = isLiving || !!data.mandatory;
    const dueDate = readDate(data.dueDate, "dueDate", today, false);
    if (dueDate > monthEnd(monthOf(today))) fail("В первой версии планируем текущий месяц.", "dueDate");
    return {
      title: text(data.title, "Название", 100, "title"), categoryId: category.id,
      plannedAmount: parseMoney(data.amount, { positive: true, field: "amount" }), dueDate: dueDate,
      mandatory: mandatory, isLiving: isLiving, isUnplanned: !!data.isUnplanned,
      rolloverPolicy: mandatory ? "debt" : existing && existing.templateId ? existing.rolloverPolicy === "skip" ? "skip" : "carry" : "carry",
      note: note(data.note)
    };
  }
  function saveExpense(state, existingId, data, today) {
    const existing = existingId ? sourceById(state, "expense", existingId) : null;
    const values = expenseInput(state, data, today, existing), time = stamp();
    let source;
    if (existing) {
      assert(existing.status !== "canceled", "Запись отменена.");
      const savedPlan = existing.plannedAmount;
      Object.assign(existing, values, { updatedAt: time });
      source = existing;
      if (operation(state, source)) {
        source.plannedAmount = savedPlan;
        fixOperation(state, "expense", source.id, Object.assign({}, data, { actualAmount: data.amount }), today);
      }
    } else {
      source = Object.assign({
        id: id(state), templateId: null, originMonth: monthOf(values.dueDate), plannedMonth: monthOf(values.dueDate),
        originalDueDate: values.dueDate, manualPayDate: null, status: "pending", operationId: null,
        rolloverHistory: [], cancelReason: null, createdAt: time, updatedAt: time
      }, values);
      state.expenses.push(source);
    }
    if (source.status === "pending" && data.alreadyPaid) {
      const date = readDate(data.actualDate || today, "actualDate", today, true);
      settleSource(state, "expense", source.id, { amount: values.plannedAmount, date: date, includeAnchor: data.includeAnchor, includeLiving: data.includeLiving }, today);
    }
    return source.id;
  }
  function saveIncome(state, existingId, data, today) {
    const source = existingId ? sourceById(state, "income", existingId) : null;
    const titleValue = text(data.title, "Название", 100, "title");
    const amount = parseMoney(data.amount, { positive: true, field: "amount" });
    const date = readDate(data.plannedDate, "plannedDate", today, false), time = stamp();
    let item;
    if (source) {
      assert(source.status !== "canceled", "Запись отменена.");
      item = source; item.title = titleValue; item.note = note(data.note); item.updatedAt = time;
      if (operation(state, item)) {
        fixOperation(state, "income", item.id, Object.assign({}, data, { actualAmount: data.amount }), today);
      } else {
        item.plannedAmount = amount;
        if (item.ruleId) item.manualDate = date === item.plannedDate ? null : date;
        else item.plannedDate = date;
      }
    } else {
      item = { id: id(state), ruleId: null, originMonth: monthOf(date), kind: "extra", title: titleValue, plannedAmount: amount, plannedDate: date, manualDate: null, status: "expected", operationId: null, note: note(data.note), createdAt: time, updatedAt: time };
      state.incomes.push(item);
    }
    if (item.status === "expected" && data.alreadyReceived) settleSource(state, "income", item.id, { amount: amount, date: readDate(data.actualDate || today, "actualDate", today, true), includeAnchor: data.includeAnchor }, today);
    return item.id;
  }
  function generateCurrent(state, today) {
    const month = monthOf(today), time = stamp();
    for (const item of state.expenses.filter(x => x.status === "pending" && x.plannedMonth < month && !x.mandatory)) {
      if (item.rolloverPolicy === "skip") { item.status = "canceled"; item.cancelReason = "skip"; item.updatedAt = time; }
      else {
        const due = dateForDay(month, Number(item.originalDueDate.slice(8)));
        item.rolloverHistory.push({ fromMonth: item.plannedMonth, toMonth: month, previousDueDate: item.dueDate, newDueDate: due, processedAt: time });
        item.plannedMonth = month; item.dueDate = due; item.updatedAt = time;
      }
    }
    for (const rule of state.incomeRules.filter(r => r.active && r.amount !== null)) {
      for (const offset of [-1, 0, 1]) {
        const m = monthShift(month, offset), date = incomeDate(m, rule.day);
        if (m !== month && monthOf(date) !== month) continue;
        const key = "income/" + rule.id + "/" + m;
        if (!state.incomes.some(x => x.id === key)) state.incomes.push({ id: key, ruleId: rule.id, originMonth: m, kind: rule.kind, title: rule.title, plannedAmount: rule.amount, plannedDate: date, manualDate: null, status: "expected", operationId: null, note: "", createdAt: time, updatedAt: time });
      }
    }
    for (const template of state.expenseTemplates.filter(x => x.active && !x.archived)) {
      const key = "expense/" + template.id + "/" + month;
      if (state.expenses.some(x => x.id === key)) continue;
      const dueDate = dateForDay(month, template.dueDay);
      state.expenses.push({
        id: key, templateId: template.id, originMonth: month, plannedMonth: month, title: template.title,
        categoryId: template.categoryId, plannedAmount: template.amount, originalDueDate: dueDate, dueDate: dueDate,
        manualPayDate: null, mandatory: template.mandatory, isLiving: template.isLiving, isUnplanned: false,
        rolloverPolicy: template.rolloverPolicy, status: "pending", operationId: null, rolloverHistory: [],
        cancelReason: null, note: "", createdAt: time, updatedAt: time
      });
    }
    state.lastProcessedDate = today;
  }
  function saveTemplate(state, templateId, data, today) {
    const existing = templateId ? state.expenseTemplates.find(x => x.id === templateId) : null;
    if (templateId) assert(existing, "Статья не найдена.");
    const cat = categoryFor(state, data.categoryId, existing && existing.categoryId);
    const isLiving = !!data.isLiving, mandatory = isLiving || !!data.mandatory;
    const values = {
      title: text(data.title, "Название", 100, "title"), categoryId: cat.id,
      amount: parseMoney(data.amount, { positive: true, field: "amount" }), dueDay: readDay(data.dueDay, "dueDay"),
      mandatory: mandatory, isLiving: isLiving, rolloverPolicy: mandatory ? "debt" : data.rolloverPolicy === "skip" ? "skip" : "carry",
      active: !!data.active, archived: false, updatedAt: stamp()
    };
    let template = existing;
    if (existing) Object.assign(existing, values);
    else { template = Object.assign({ id: id(state), createdAt: stamp() }, values); state.expenseTemplates.push(template); }
    if (data.applyCurrent) {
      const current = state.expenses.find(x => x.templateId === template.id && x.originMonth === monthOf(today) && x.status === "pending");
      if (current) Object.assign(current, {
        title: values.title, categoryId: values.categoryId, plannedAmount: values.amount, dueDate: dateForDay(monthOf(today), values.dueDay),
        mandatory: values.mandatory, isLiving: values.isLiving, rolloverPolicy: values.rolloverPolicy, updatedAt: stamp()
      });
    }
    generateCurrent(state, today);
    return template.id;
  }
  function toggleTemplate(state, templateId, action, today) {
    const item = state.expenseTemplates.find(x => x.id === templateId); assert(item, "Статья не найдена.");
    if (action === "archive") { item.archived = true; item.active = false; }
    else if (action === "restore") { item.archived = false; item.active = true; }
    else item.active = !item.active;
    item.updatedAt = stamp(); generateCurrent(state, today);
  }
  function saveRules(state, data, today, applyCurrent) {
    for (const rule of state.incomeRules) {
      const enabled = !!data[rule.kind + "Active"], raw = String(data[rule.kind + "Amount"] || "").trim();
      const amount = enabled ? parseMoney(raw, { positive: true, field: rule.kind + "Amount" }) : raw ? parseMoney(raw, { positive: true, field: rule.kind + "Amount" }) : null;
      rule.active = enabled; rule.amount = amount; rule.day = readDay(data[rule.kind + "Day"], rule.kind + "Day");
      if (applyCurrent && enabled) {
        const current = state.incomes.filter(x => x.ruleId === rule.id && x.status === "expected" && (x.originMonth === monthOf(today) || monthOf(x.manualDate || x.plannedDate) === monthOf(today)));
        for (const item of current) { item.plannedAmount = amount; item.plannedDate = incomeDate(item.originMonth, rule.day); item.manualDate = null; item.updatedAt = stamp(); }
      }
    }
    generateCurrent(state, today);
  }
  function saveBudgets(state, data, today) {
    for (const key of ["lifeAfterSalary", "lifeAfterAdvance", "lifeWithoutRegularIncome", "reserveTarget"]) state.settings[key] = parseMoney(data[key], { field: key });
    setLifeBudget(state, parseMoney(data.lifeRemaining, { field: "lifeRemaining" }), today);
  }
  function saveCategory(state, categoryId, data) {
    const name = text(data.name, "Название категории", 40, "name");
    const normalized = name.toLocaleLowerCase("ru");
    const duplicate = state.categories.find(x => x.id !== categoryId && x.name.toLocaleLowerCase("ru") === normalized);
    if (duplicate) fail(duplicate.active ? "Такая категория уже есть." : "Такая категория в архиве. Восстановите её.", "name");
    if (categoryId) { const cat = state.categories.find(x => x.id === categoryId); assert(cat, "Категория не найдена."); cat.name = name; }
    else state.categories.push({ id: id(state), name: name, active: true, systemKey: null, createdAt: stamp() });
  }
  function toggleCategory(state, categoryId) {
    const cat = state.categories.find(x => x.id === categoryId); assert(cat, "Категория не найдена.");
    assert(cat.systemKey !== "other", "Категорию «Другое» нельзя архивировать.");
    cat.active = !cat.active;
  }
  function persistState(target, previousRaw, serialized) {
    const previousBackup = target.getItem(BACKUP_KEY);
    let warning = false;
    if (previousRaw !== null) {
      try { target.setItem(BACKUP_KEY, previousRaw); } catch (_) { warning = true; }
    }
    try { target.setItem(KEY, serialized); }
    catch (error) {
      // An optional cache must not consume space needed for the authoritative data.
      if (error.name !== "QuotaExceededError" || target.getItem(BACKUP_KEY) === null) throw error;
      target.removeItem(BACKUP_KEY); warning = true;
      try { target.setItem(KEY, serialized); }
      catch (retryError) {
        if (previousBackup !== null) { try { target.setItem(BACKUP_KEY, previousBackup); } catch (_) { /* The main object remains unchanged. */ } }
        throw retryError;
      }
    }
    return warning;
  }
  function validateState(state, today) {
    assert(state && typeof state === "object" && !Array.isArray(state), "Повреждён объект данных.");
    assert(state.appId === "personal-expense-planner", "Это данные другого приложения.");
    assert(state.schemaVersion === 1, "Версия данных не поддерживается. Исходные данные сохранены.");
    assert(Number.isSafeInteger(state.revision) && state.revision >= 0, "Повреждена ревизия.");
    const timestampValid = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
    assert(timestampValid(state.createdAt) && timestampValid(state.updatedAt), "Повреждено время создания данных.");
    assert(validDate(state.lastProcessedDate), "Повреждена дата обработки.");
    assert(state.onboarding && typeof state.onboarding.completed === "boolean" && Number.isInteger(state.onboarding.step) && state.onboarding.step >= 1 && state.onboarding.step <= 5, "Повреждена настройка первого запуска.");
    assert(state.settings && ["paper-plum", "ink-atlas"].includes(state.settings.theme), "Повреждены настройки оформления.");
    for (const key of ["lifeAfterSalary", "lifeAfterAdvance", "lifeWithoutRegularIncome", "reserveTarget"]) assert(moneyValid(state.settings[key], false, false), "Повреждена сумма бюджета.");
    const collections = ["categories", "incomeRules", "expenseTemplates", "incomes", "expenses", "operations", "lifeBudgetOverrides", "balanceCorrections"], allIds = new Set();
    for (const key of collections) {
      assert(Array.isArray(state[key]) && state[key].length <= 20000, "Повреждён перечень " + key + ".");
      for (const item of state[key]) {
        assert(item && typeof item === "object" && typeof item.id === "string" && /^[A-Za-z0-9/_+.\-]{1,200}$/.test(item.id), "Повреждён идентификатор.");
        assert(!allIds.has(item.id), "Повторный идентификатор."); allIds.add(item.id);
        assert(timestampValid(item.createdAt), "Повреждено время создания записи.");
        if (["expenseTemplates", "incomes", "expenses", "operations"].includes(key)) assert(timestampValid(item.updatedAt), "Повреждено время изменения записи.");
      }
    }
    const categories = new Map(state.categories.map(c => [c.id, c])), rules = new Map(state.incomeRules.map(r => [r.id, r])), templates = new Map(state.expenseTemplates.map(t => [t.id, t]));
    const names = new Set();
    for (const cat of state.categories) {
      assert(typeof cat.name === "string" && cat.name.trim().length >= 1 && cat.name.length <= 40 && typeof cat.active === "boolean", "Повреждена категория.");
      const lower = cat.name.toLocaleLowerCase("ru"); assert(!names.has(lower), "Повторная категория."); names.add(lower);
      assert(cat.systemKey === null || typeof cat.systemKey === "string", "Повреждён тип категории.");
    }
    assert(state.categories.some(c => c.systemKey === "other" && c.active), "Отсутствует категория «Другое».");
    assert(state.incomeRules.length === 2 && new Set(state.incomeRules.map(r => r.kind)).size === 2, "Повреждены правила доходов.");
    for (const r of state.incomeRules) {
      assert(["salary", "advance"].includes(r.kind) && typeof r.active === "boolean" && Number.isInteger(r.day) && r.day >= 1 && r.day <= 31, "Повреждено правило дохода.");
      assert(typeof r.title === "string" && r.title.trim().length > 0 && r.title.length <= 100, "Повреждено название дохода.");
      assert(r.amount === null || moneyValid(r.amount, false, true), "Повреждена сумма дохода.");
      assert(!r.active || r.amount !== null || (!state.onboarding.completed && state.onboarding.step <= 2), "Не указана сумма активного дохода.");
    }
    assert(state.expenseTemplates.filter(t => t.active).length <= 200, "Не больше 200 активных статей.");
    function policy(item) {
      assert(typeof item.mandatory === "boolean" && typeof item.isLiving === "boolean", "Повреждена обязательность.");
      assert(!item.isLiving || item.mandatory, "Расход на жизнь должен быть необходимым.");
      assert(item.mandatory ? item.rolloverPolicy === "debt" : ["carry", "skip"].includes(item.rolloverPolicy), "Повреждено правило переноса.");
    }
    for (const t of state.expenseTemplates) {
      assert(typeof t.title === "string" && t.title.trim().length && t.title.length <= 100 && moneyValid(t.amount, false, true) && categories.has(t.categoryId), "Повреждена регулярная статья.");
      assert(Number.isInteger(t.dueDay) && t.dueDay >= 1 && t.dueDay <= 31 && typeof t.active === "boolean" && typeof t.archived === "boolean" && (!t.archived || !t.active), "Повреждена настройка статьи."); policy(t);
    }
    const recurring = new Set(), sourceMap = new Map();
    for (const [type, items] of [["income", state.incomes], ["expense", state.expenses]]) {
      for (const s of items) {
        assert(typeof s.title === "string" && s.title.trim().length && s.title.length <= 100 && moneyValid(s.plannedAmount, false, true) && validMonth(s.originMonth), "Повреждена запись.");
        assert(typeof s.note === "string" && s.note.length <= 500, "Повреждена заметка.");
        const ruleId = type === "income" ? s.ruleId : s.templateId;
        if (ruleId !== null) {
          assert((type === "income" ? rules : templates).has(ruleId), "Потеряна связь с шаблоном.");
          const key = type + "/" + ruleId + "/" + s.originMonth;
          assert(s.id === key && !recurring.has(key), "Повторный регулярный экземпляр."); recurring.add(key);
        }
        if (type === "income") {
          assert(["salary", "advance", "extra"].includes(s.kind) && ["expected", "received", "canceled"].includes(s.status) && validDate(s.plannedDate) && (s.manualDate === null || validDate(s.manualDate)), "Повреждён доход.");
          if (s.ruleId !== null) assert(s.kind === rules.get(s.ruleId).kind, "Не совпадает тип регулярного дохода.");
        } else {
          assert(["pending", "paid", "canceled"].includes(s.status) && categories.has(s.categoryId) && validDate(s.dueDate) && validDate(s.originalDueDate) && validMonth(s.plannedMonth), "Повреждён расход.");
          assert(s.manualPayDate === null || validDate(s.manualPayDate), "Повреждена ручная дата.");
          assert(typeof s.isUnplanned === "boolean" && Array.isArray(s.rolloverHistory), "Повреждена история расхода."); policy(s);
          assert(s.cancelReason === null || typeof s.cancelReason === "string", "Повреждена причина отмены.");
          for (const event of s.rolloverHistory) assert(validMonth(event.fromMonth) && validMonth(event.toMonth) && validDate(event.previousDueDate) && validDate(event.newDueDate) && timestampValid(event.processedAt), "Повреждён перенос.");
        }
        assert(s.operationId === null || typeof s.operationId === "string", "Повреждена ссылка на факт.");
        sourceMap.set(type + ":" + s.id, s);
      }
    }
    const activeSources = new Set(), opMap = new Map(state.operations.map(op => [op.id, op]));
    for (const op of state.operations) {
      assert(["income", "expense"].includes(op.type) && ["active", "void"].includes(op.status) && moneyValid(op.amount, false, true) && validDate(op.date), "Повреждён факт или его дата.");
      assert(op.date <= today, "Есть фактические операции позже сегодняшнего дня. Проверьте дату телефона; история не обрезается.");
      assert(typeof op.title === "string" && op.title.trim().length && op.title.length <= 100 && typeof op.isLiving === "boolean", "Повреждены сведения операции.");
      assert(op.type === "expense" ? categories.has(op.categoryId) && op.incomeKind === null : op.categoryId === null && ["salary", "advance", "extra"].includes(op.incomeKind), "Повреждена категория факта.");
      assert(op.status === "active" ? op.voidedAt === null : timestampValid(op.voidedAt), "Повреждена отметка отмены факта.");
      const link = op.type + ":" + op.sourceId, s = sourceMap.get(link); assert(s, "Потеряна связь факта с записью.");
      if (op.status === "active") { assert(!activeSources.has(link) && s.operationId === op.id, "Двойной или неподключённый факт."); activeSources.add(link); }
    }
    for (const [key, s] of sourceMap) {
      const paid = ["paid", "received"].includes(s.status);
      if (paid) {
        const op = opMap.get(s.operationId); assert(op && op.status === "active" && op.type + ":" + op.sourceId === key, "Запись закрыта без факта.");
      } else assert(s.operationId === null && !activeSources.has(key), "У ожидаемой записи есть активный факт.");
    }
    if (state.balanceAnchor !== null) {
      const b = state.balanceAnchor;
      assert(validDate(b.date) && b.date <= today && moneyValid(b.amount, true, false) && Array.isArray(b.includedOperationIds), "Повреждён исходный остаток.");
      assert(timestampValid(b.createdAt) && typeof b.note === "string" && b.note.length <= 500, "Повреждены сведения об остатке.");
      assert(new Set(b.includedOperationIds).size === b.includedOperationIds.length && b.includedOperationIds.every(x => opMap.has(x)), "Повреждены учтённые операции.");
      for (const op of state.operations.filter(o => o.status === "active")) {
        assert(op.date >= b.date || b.includedOperationIds.includes(op.id), "Старый факт повторно влияет на остаток.");
        assert(!b.includedOperationIds.includes(op.id) || op.date <= b.date, "В остаток включён более поздний факт.");
      }
    } else assert(!state.onboarding.completed && state.onboarding.step === 1 && state.operations.length === 0, "Отсутствует исходный остаток.");
    const periodKeys = new Set();
    for (const b of state.lifeBudgetOverrides) {
      assert(typeof b.periodKey === "string" && !periodKeys.has(b.periodKey) && validDate(b.coverageStartDate) && b.coverageStartDate <= today && moneyValid(b.amount, false, false), "Повреждена точка бюджета.");
      assert(Array.isArray(b.includedLivingOperationIds) && new Set(b.includedLivingOperationIds).size === b.includedLivingOperationIds.length && b.includedLivingOperationIds.every(x => opMap.has(x) && opMap.get(x).type === "expense"), "Повреждены расходы точки бюджета.");
      periodKeys.add(b.periodKey);
    }
    for (const b of state.balanceCorrections) assert(validDate(b.date) && b.date <= today && moneyValid(b.amount, true, false) && typeof b.note === "string" && b.note.length <= 500, "Повреждена история остатка.");
    assert(state.monthCoverage && typeof state.monthCoverage === "object" && !Array.isArray(state.monthCoverage), "Повреждена полнота истории.");
    for (const [month, value] of Object.entries(state.monthCoverage)) assert(validMonth(month) && ["complete", "partial"].includes(value), "Повреждён месяц истории.");
    actualBalance(state); monthlyFacts(state, monthOf(today));
    return state;
  }

  const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
  function monthStatus(state, month, today) {
    if (month > monthOf(today)) return "future";
    if (state.monthCoverage[month] === "complete") return "complete";
    if (state.monthCoverage[month] === "partial") return "partial";
    return state.operations.some(o => o.status === "active" && monthOf(o.date) === month) ? "partial" : "empty";
  }
  function reportPeriod(state, period, today) {
    assert(validMonth(period) || /^\d{4}$/.test(period) && validMonth(period + "-01"), "Неверный период отчёта.");
    const ops = state.operations.filter(o => o.status === "active" && o.date.startsWith(period));
    const income = safeSum(ops.filter(o => o.type === "income").map(o => o.amount));
    const expense = safeSum(ops.filter(o => o.type === "expense").map(o => o.amount));
    const categories = state.categories.map(c => ({ id: c.id, name: c.name, amount: safeSum(ops.filter(o => o.type === "expense" && o.categoryId === c.id).map(o => o.amount)) }))
      .filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "ru"));
    for (const c of categories) c.percent = expense ? c.amount / expense * 100 : 0;
    const months = period.length === 4 ? Array.from({ length: 12 }, (_, i) => {
      const month = period + "-" + String(i + 1).padStart(2, "0");
      return { month: month, ...monthlyFacts(state, month), status: monthStatus(state, month, today) };
    }) : [];
    return { period: period, income: income, expense: expense, difference: safeSum([income, -expense]), operations: ops.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)),
      categories: categories, months: months, status: months.length ? months.every(m => m.status === "complete") ? "complete" : "partial" : monthStatus(state, period, today) };
  }
  function saveHistory(state, type, sourceId, data, today) {
    assert(["income", "expense"].includes(type), "Неверный тип операции.");
    const date = readDate(data.actualDate, "actualDate", today, true);
    if (sourceId) {
      const source = sourceById(state, type, sourceId);
      assert(operation(state, source), "Факт уже снят или изменён в другой вкладке.");
      source.title = text(data.title, "Название", 100, "title"); source.note = note(data.note);
      if (type === "expense") { source.categoryId = categoryFor(state, data.categoryId, source.categoryId).id; source.isLiving = !!data.isLiving; if (source.isLiving) { source.mandatory = true; source.rolloverPolicy = "debt"; } }
      fixOperation(state, type, sourceId, { ...data, actualAmount: data.amount }, today);
      return sourceId;
    }
    if (type === "income") return saveIncome(state, null, { ...data, plannedDate: date, alreadyReceived: true }, today);
    return saveExpense(state, null, { ...data, dueDate: date, mandatory: true, alreadyPaid: true }, today);
  }
  const SHAPES = {
    root: "appId schemaVersion revision createdAt updatedAt lastProcessedDate onboarding settings balanceAnchor balanceCorrections categories incomeRules expenseTemplates incomes expenses operations lifeBudgetOverrides monthCoverage",
    onboarding: "completed step", settings: "theme lifeAfterSalary lifeAfterAdvance lifeWithoutRegularIncome reserveTarget",
    balanceAnchor: "date amount includedOperationIds createdAt note", balanceCorrections: "id date amount createdAt note",
    categories: "id name active systemKey createdAt", incomeRules: "id kind title day amount active createdAt",
    expenseTemplates: "id title categoryId amount dueDay mandatory isLiving rolloverPolicy active archived createdAt updatedAt",
    incomes: "id ruleId originMonth kind title plannedAmount plannedDate manualDate status operationId note createdAt updatedAt",
    expenses: "id templateId originMonth plannedMonth title categoryId plannedAmount originalDueDate dueDate manualPayDate mandatory isLiving isUnplanned rolloverPolicy status operationId rolloverHistory cancelReason note createdAt updatedAt",
    operations: "id type sourceId amount date title categoryId incomeKind isLiving status createdAt updatedAt voidedAt",
    lifeBudgetOverrides: "id periodKey coverageStartDate amount includedLivingOperationIds createdAt",
    rolloverHistory: "fromMonth toMonth previousDueDate newDueDate processedAt"
  };
  function pickFields(input, shape) {
    assert(input && typeof input === "object" && !Array.isArray(input), "Отсутствует объект " + shape + ".");
    const result = {};
    for (const key of SHAPES[shape].split(" ")) { assert(Object.prototype.hasOwnProperty.call(input, key), "Отсутствует обязательное поле " + key + "."); result[key] = input[key]; }
    return result;
  }
  function budgetKeyParts(state, key) {
    assert(typeof key === "string", "Некорректный период бюджета.");
    if (key.startsWith("calendar/")) { assert(validMonth(key.slice(9)), "Некорректный период бюджета."); return [key]; }
    let remaining = key;
    const parts = [];
    while (remaining) {
      const candidates = state.incomeRules.map(rule => {
        const prefix = "income/" + rule.id + "/";
        if (!remaining.startsWith(prefix)) return null;
        const month = remaining.slice(prefix.length, prefix.length + 7), rest = remaining.slice(prefix.length + 7);
        return validMonth(month) && (!rest || rest.startsWith("+") && rest.length > 1) ? { key: prefix + month, rest: rest ? rest.slice(1) : "" } : null;
      }).filter(Boolean);
      assert(candidates.length === 1 && parts.length < 20000, "Неизвестная или неоднозначная граница бюджета.");
      parts.push(candidates[0].key); remaining = candidates[0].rest;
    }
    assert(parts.length && new Set(parts).size === parts.length && parts.slice().sort().join("+") === key, "Некорректная общая граница бюджета.");
    return parts;
  }
  function normalizeState(input, today) {
    const s = pickFields(input, "root");
    s.onboarding = pickFields(s.onboarding, "onboarding"); s.settings = pickFields(s.settings, "settings");
    if (s.balanceAnchor !== null) s.balanceAnchor = pickFields(s.balanceAnchor, "balanceAnchor");
    for (const key of ["balanceCorrections", "categories", "incomeRules", "expenseTemplates", "incomes", "expenses", "operations", "lifeBudgetOverrides"]) {
      assert(Array.isArray(s[key]) && s[key].length <= 20000, "Не больше 20 000 записей в " + key + ".");
      s[key] = s[key].map(item => pickFields(item, key));
    }
    for (const e of s.expenses) { assert(Array.isArray(e.rolloverHistory) && e.rolloverHistory.length <= 20000, "Повреждена история переноса."); e.rolloverHistory = e.rolloverHistory.map(h => pickFields(h, "rolloverHistory")); }
    assert(s.monthCoverage && typeof s.monthCoverage === "object" && !Array.isArray(s.monthCoverage), "Повреждена полнота истории.");
    const coverage = {};
    for (const [month, value] of Object.entries(s.monthCoverage)) { assert(validMonth(month), "Некорректный месяц истории."); coverage[month] = value; }
    s.monthCoverage = coverage;
    validateState(s, today);
    const operationMap = new Map(s.operations.map(o => [o.id, o]));
    for (const point of s.lifeBudgetOverrides) {
      budgetKeyParts(s, point.periodKey);
      assert(point.includedLivingOperationIds.every(key => operationMap.get(key).date <= point.coverageStartDate), "В точку бюджета включена более поздняя покупка.");
    }
    for (const op of s.operations.filter(o => o.status === "active")) {
      const source = sourceById(s, op.type, op.sourceId);
      assert(op.title === source.title && (op.type === "expense" ? op.categoryId === source.categoryId && op.isLiving === source.isLiving : op.incomeKind === source.kind), "Факт не соответствует связанной записи.");
    }
    // JSON cloning also detaches arrays and prevents imported object aliases.
    return clone(s);
  }
  function backupEnvelope(state, today) { return { appId: "personal-expense-planner", schemaVersion: 1, exportedAt: stamp(), state: normalizeState(state, today) }; }
  function parseBackup(raw, today) {
    assert(typeof raw === "string" && new TextEncoder().encode(raw).length <= MAX_IMPORT_BYTES, "Копия должна быть не больше 5 MiB.");
    let pack; try { pack = JSON.parse(raw); } catch (_) { throw new Error("Не удалось прочитать JSON. Проверьте файл или вставленный текст."); }
    assert(pack && pack.appId === "personal-expense-planner", "Это копия другого приложения.");
    assert(pack.schemaVersion === 1, "Версия копии не поддерживается. Текущие данные не изменены.");
    assert(typeof pack.exportedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(pack.exportedAt) && Number.isFinite(Date.parse(pack.exportedAt)), "Повреждена дата копии.");
    return { exportedAt: pack.exportedAt, state: normalizeState(pack.state, today) };
  }
  function prepareReplacement(imported, currentRevision, today) {
    const s = normalizeState(imported, today);
    if (s.onboarding.completed) { generateCurrent(s, today); reconcileBudgets(s, today); calculatePlan(s, today); }
    s.revision = Math.max(currentRevision, s.revision) + 1; s.updatedAt = stamp();
    assert(Number.isSafeInteger(s.revision), "Слишком большая ревизия данных.");
    return normalizeState(s, today);
  }
  function replaceStored(target, expectedRaw, candidate) {
    assert(target.getItem(KEY) === expectedRaw, "Данные изменились в другой вкладке. Проверьте копию заново.");
    return persistState(target, expectedRaw, JSON.stringify(candidate));
  }
  function clearStored(target, expectedRaw) {
    assert(target.getItem(KEY) === expectedRaw, "Данные изменились в другой вкладке. Очистка отменена.");
    const previousBackup = target.getItem(BACKUP_KEY);
    try { target.removeItem(BACKUP_KEY); target.removeItem(KEY); }
    catch (error) { if (previousBackup !== null) { try { target.setItem(BACKUP_KEY, previousBackup); } catch (_) { /* Report the storage failure without hiding it. */ } } throw error; }
  }
  const Core = { KEY, BACKUP_KEY, MAX_MONEY, InputError, clone, todayLocal, validDate, validMonth, monthOf, monthShift, monthEnd, dateForDay, incomeDate, safeSum, parseMoney, createState, operation, actualBalance, monthlyFacts, currentPeriod, correctBalance, setLifeBudget, settleSource, voidOperation, fixOperation, cancelSource, saveExpense, saveIncome, generateCurrent, saveTemplate, toggleTemplate, saveRules, saveBudgets, saveCategory, toggleCategory, persistState, validateState, regularAnchors, paymentDate, setPaymentDate, reconcileBudgets, budgetPeriods, forecast, calculatePlan, MAX_IMPORT_BYTES, monthStatus, reportPeriod, saveHistory, normalizeState, backupEnvelope, parseBackup, prepareReplacement, replaceStored, clearStored };
  function setTheme(state, theme) {
    if (!["paper-plum", "ink-atlas"].includes(theme)) fail("Выберите доступную тему.", "theme");
    state.settings.theme = theme;
  }
  Core.setTheme = setTheme;
  if (typeof module !== "undefined" && module.exports) module.exports = Core;
  if (typeof document === "undefined") return;

  // UI and storage are deliberately separate from the calculation functions.
  const app = document.getElementById("app"), editor = document.getElementById("editor"), confirmation = document.getElementById("confirmation"), toast = document.getElementById("toast");
  let state, storage, currentView = "plan", recordTab = "expense", saving = false, editorDirty = false, editorReturnFocus = null, editorReturnLabel = "", toastTimer = null, undoRecord = null, wizardInitial = "", backupWarning = false;
  const planFilters = { search: "", status: "all", mandatory: false, category: "" };
  let displayedPlan = null, budgetMessages = [], factReserveUsed = false;
  let reportMode = "month", reportMonth = monthOf(todayLocal()), reportYear = todayLocal().slice(0, 4), reportType = "all", reportCategory = "";
  let recoveryMode = false, recoveryMessage = "", recoveryRaw = null, failedDraft = null, editorSaveChange = null;
  const recentActions = new Map();
  const detailsOpen = {};
  const THEME_NAMES = { "paper-plum": "Бумага и баклажан", "ink-atlas": "Чернильный атлас" };
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.settings.theme);
    document.querySelector('meta[name="theme-color"]').setAttribute("content", state.settings.theme === "ink-atlas" ? "#171B35" : "#F4EBDD");
    const next = state.settings.theme === "paper-plum" ? "ink-atlas" : "paper-plum";
    for (const control of document.querySelectorAll("[data-theme-toggle]")) {
      control.setAttribute("aria-label", "Тема: " + THEME_NAMES[state.settings.theme] + ". Переключить на " + THEME_NAMES[next]);
      control.title = "Переключить на " + THEME_NAMES[next];
    }
    for (const label of document.querySelectorAll("[data-theme-name]")) label.textContent = THEME_NAMES[state.settings.theme];
  }
  function toggleTheme() {
    if (saving || recoveryMode || !state) return;
    saving = true;
    try {
      const previousRaw = storage.getItem(KEY), stored = previousRaw === null ? null : JSON.parse(previousRaw);
      assert((stored ? stored.revision : 0) === state.revision, "Данные изменились в другой вкладке. Обновите экран перед сменой темы.");
      const draft = clone(state);
      setTheme(draft, state.settings.theme === "paper-plum" ? "ink-atlas" : "paper-plum");
      draft.revision++; draft.updatedAt = stamp(); validateState(draft, todayLocal());
      const warning = persistState(storage, previousRaw, JSON.stringify(draft));
      if (undoRecord && undoRecord.revision === state.revision) undoRecord.revision = draft.revision;
      state = draft; backupWarning = warning; applyTheme();
      for (const form of document.querySelectorAll("form")) form.dispatchEvent(new CustomEvent("planner-theme-change", { detail: { previousRaw: previousRaw, nextRaw: JSON.stringify(draft) } }));
      const label = document.querySelector(".saved-label"); if (label) label.textContent = "Сохранено в браузере";
      if (warning) showToast("Тема сохранена. Предыдущая внутренняя копия не обновилась.", undoRecord, true);
    } catch (error) { showToast("Тема не сохранена. " + error.message, undoRecord, true); }
    finally { saving = false; }
  }
  function themeButton() {
    if (!state || recoveryMode) return null;
    const next = state.settings.theme === "paper-plum" ? "ink-atlas" : "paper-plum";
    return node("button", { type: "button", class: "icon-btn theme-toggle", "data-theme-toggle": "", "aria-label": "Тема: " + THEME_NAMES[state.settings.theme] + ". Переключить на " + THEME_NAMES[next], title: "Переключить на " + THEME_NAMES[next], onclick: toggleTheme }, icon("theme"));
  }
  function dialogHeading(title, close) {
    return node("div", { class: "dialog-head" }, node("h2", { id: "confirmation-title" }, title), node("div", { class: "dialog-head-actions" }, themeButton(), close || null));
  }

  function node(tag, attrs) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2), value);
      else if (["checked", "disabled", "hidden", "open", "readOnly"].includes(key)) element[key] = !!value;
      else if (key === "value") element.value = value;
      else element.setAttribute(key === "className" ? "class" : key, value === true ? "" : String(value));
    }
    for (const child of Array.prototype.slice.call(arguments, 2).flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      element.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return element;
  }
  function icon(name) {
    const paths = {
      plus: "M12 5v14M5 12h14", check: "m5 12 4 4L19 6", edit: "m16 3 5 5-12 12-6 1 1-6L16 3zM14 5l5 5",
      close: "m6 6 12 12M18 6 6 18", wallet: "M4 6h15v14H4V6zM4 6V4h13M15 12h6v5h-6v-5z",
      list: "M9 6h11M9 12h11M9 18h11M4 6h.1M4 12h.1M4 18h.1", settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
      arrowDown: "M12 4v16m-6-6 6 6 6-6", arrowUp: "M12 20V4m-6 6 6-6 6 6",
      pause: "M8 5v14M16 5v14", play: "m8 4 12 8-12 8V4z",
      archive: "M3 4h18v5H3V4zM5 9v11h14V9M10 13h4", restore: "M4 5v6h6M4 10a8 8 0 1 1 1 9",
      calendar: "M4 6h16v15H4V6zM8 3v6M16 3v6M4 11h16",
      theme: "M12 3a9 9 0 1 0 0 18V3zM12 3a9 9 0 0 1 0 18M12 7v10"
    };
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(key, value);
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", paths[name] || paths.list); svg.append(p); return svg;
  }
  function button(label, action, classes, name) {
    return node("button", { type: "button", class: classes || "btn btn-secondary", onclick: action, "aria-label": name || null }, label);
  }
  function iconButton(symbol, label, action) { return node("button", { type: "button", class: "icon-btn", "aria-label": label, title: label, onclick: action }, icon(symbol)); }
  function amountText(amount) { return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", minimumFractionDigits: amount % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(amount / 100); }
  function amountInput(amount) {
    if (amount === null || amount === undefined) return "";
    const a = Math.abs(amount), sign = amount < 0 ? "-" : "";
    return sign + Math.trunc(a / 100) + (a % 100 ? "," + String(a % 100).padStart(2, "0") : "");
  }
  function dateText(date, withYear) {
    if (!validDate(date)) return "";
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: withYear ? "numeric" : undefined, timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
  }
  function monthText(date) { return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(date + "T12:00:00Z")).replace(/\sг\.$/, ""); }
  function categoryName(categoryId) { const c = state.categories.find(x => x.id === categoryId); return c ? c.name : "Другое"; }
  function chip(label, style) { return node("span", { class: "chip " + (style || "plum") }, label); }
  function empty(title, description) { return node("div", { class: "empty" }, node("div", { class: "empty-symbol", "aria-hidden": "true" }, "↳"), node("h3", {}, title), node("p", {}, description)); }
  function detailsGroup(label, children, key) {
    const group = node("details", { class: "paid-group", open: !!detailsOpen[key] }, node("summary", {}, label), node("div", { class: "record-list" }, children));
    group.addEventListener("toggle", () => { if (group.isConnected) detailsOpen[key] = group.open; });
    return group;
  }
  function notice(message, kind) { return node("div", { class: "notice " + (kind || "neutral"), role: kind === "danger" ? "alert" : null }, message); }
  function collect(form) {
    const result = {};
    for (const field of form.querySelectorAll("input[name], select[name], textarea[name]")) result[field.name] = field.type === "checkbox" ? field.checked : field.value;
    return result;
  }
  function clearFormErrors(form) {
    for (const el of form.querySelectorAll(".field-error, .form-error")) el.textContent = "";
    for (const el of form.querySelectorAll('[aria-invalid="true"]')) el.removeAttribute("aria-invalid");
  }
  function formError(form, error) {
    clearFormErrors(form);
    let field = error.field;
    if (field === "actualAmount" && !form.elements.namedItem(field)) field = "amount";
    const input = field && form.elements.namedItem(field), fieldMessage = field && form.querySelector('[data-error-for="' + field + '"]');
    if (input && fieldMessage) { input.setAttribute("aria-invalid", "true"); fieldMessage.textContent = error.message; input.focus(); }
    else {
      let message = form.querySelector(".form-error");
      if (!message) { message = node("div", { class: "form-error", role: "alert" }); form.prepend(message); }
      message.textContent = error.message;
    }
  }
  function showToast(message, undo, isError) {
    clearTimeout(toastTimer); undoRecord = undo || null;
    toast.replaceChildren(node("span", {}, message)); toast.hidden = false;
    toast.setAttribute("role", isError ? "alert" : "status");
    if (undo) toast.append(button("Отменить", () => {
      if (!undoRecord || state.revision !== undoRecord.revision) return;
      const item = undoRecord;
      if (commit(draft => voidOperation(draft, item.type, item.sourceId))) showToast("Отметка отменена.");
    }, "", "Отменить последнюю отметку"));
    toastTimer = setTimeout(() => { toast.hidden = true; undoRecord = null; }, undo ? 8000 : isError ? 12000 : 5000);
  }
  function commit(change, form) {
    if (saving) return false;
    saving = true; backupWarning = false;
    const submit = form && form.querySelector('[type="submit"]'); if (submit) submit.disabled = true;
    let draft = null;
    try {
      assert(!recoveryMode, "Сначала восстановите доступ к сохранённым данным.");
      draft = clone(state); change(draft);
      failedDraft = null;
      const raw = storage.getItem(KEY), stored = raw === null ? null : JSON.parse(raw);
      if ((stored ? stored.revision : 0) !== state.revision) throw new Error("Данные изменились в другой вкладке. Не закрывайте заполненную форму; обновите данные после сохранения её значений.");
      if (stored) validateState(stored, todayLocal());
      let nextBudgetMessages = [];
      let nextFactReserveUsed = false;
      if (draft.onboarding.completed) {
        generateCurrent(draft, todayLocal());
        nextBudgetMessages = reconcileBudgets(draft, todayLocal());
        const nextPlan = calculatePlan(draft, todayLocal());
        const previousPlan = state.onboarding.completed ? calculatePlan(state, todayLocal()) : null;
        const previousDeclined = new Set(previousPlan ? previousPlan.declined.map(e => e.id) : []);
        if (nextPlan.declined.some(e => !previousDeclined.has(e.id))) detailsOpen.declined = true;
        const previousOperations = new Map(state.operations.map(op => [op.id, op]));
        const changedExpenseFact = draft.operations.some(op => {
          if (op.type !== "expense" || op.status !== "active") return false;
          const previous = previousOperations.get(op.id);
          return !previous || previous.status !== "active" || previous.amount !== op.amount || previous.date !== op.date || previous.isLiving !== op.isLiving;
        });
        nextFactReserveUsed = !!previousPlan && changedExpenseFact && nextPlan.reserve < previousPlan.reserve;
      }
      draft.revision = state.revision + 1; draft.updatedAt = stamp(); validateState(draft, todayLocal());
      const serialized = JSON.stringify(draft);
      backupWarning = persistState(storage, raw, serialized);
      const previousFacts = new Set(state.operations.filter(op => op.status === "active").map(op => op.id));
      for (const op of draft.operations.filter(op => op.status === "active" && !previousFacts.has(op.id))) detailsOpen["paid-" + op.type] = true;
      state = draft;
      budgetMessages = nextBudgetMessages;
      factReserveUsed = nextFactReserveUsed;
      if (undoRecord) { clearTimeout(toastTimer); toast.hidden = true; undoRecord = null; }
      render();
      return true;
    } catch (error) {
      const message = error instanceof InputError ? error : new Error(error.message && error.message.includes("вкладке") ? error.message : "Изменения не сохранены. " + (error.message || "Браузер не разрешил запись.") + " Введённые поля остались в форме.");
      if (form) formError(form, message); else showToast(message.message, null, true);
      if (!(error instanceof InputError) && draft) {
        try { failedDraft = normalizeState(draft, todayLocal()); } catch (_) { failedDraft = null; }
        if (form) {
          form.querySelector(".save-recovery")?.remove();
          const actions = node("div", { class: "save-recovery actions" });
          if (failedDraft) actions.append(button("Скачать несохранённый вариант", () => exportUnsavedForm(form), "btn btn-secondary"));
          if (message.message.includes("вкладке")) actions.append(button("Обновить из другой вкладки", refreshStored, "btn btn-secondary"));
          form.querySelector(".form-error").after(actions);
        }
      }
      return false;
    } finally { saving = false; if (submit) submit.disabled = false; }
  }
  function confirmAction(title, description, actionLabel, danger) {
    return new Promise(resolve => {
      confirmation.replaceChildren(dialogHeading(title), node("p", {}, description));
      function finish(value) { confirmation.close(); confirmation.oncancel = null; resolve(value); }
      confirmation.append(node("div", { class: "button-row" },
        button("Оставить как есть", () => finish(false), "btn btn-secondary"),
        button(actionLabel || "Подтвердить", () => finish(true), danger ? "btn btn-danger" : "btn btn-primary")));
      confirmation.oncancel = event => { event.preventDefault(); finish(false); };
      confirmation.showModal();
      confirmation.querySelector(".button-row button").focus();
    });
  }
  function keepDialogFocus(event) {
    if (event.key !== "Tab") return;
    const dialog = event.currentTarget;
    const controls = Array.from(dialog.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')).filter(control => !control.disabled && control.tabIndex >= 0 && control.getClientRects().length);
    if (!controls.length) { event.preventDefault(); dialog.focus(); return; }
    const first = controls[0], last = controls[controls.length - 1], active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (active === last || !dialog.contains(active))) { event.preventDefault(); first.focus(); }
  }
  editor.addEventListener("keydown", keepDialogFocus);
  confirmation.addEventListener("keydown", keepDialogFocus);
  async function requestCloseEditor() {
    if (editorDirty && !await confirmAction("Не сохранять изменения?", "Введённые значения не будут сохранены.", "Не сохранять", true)) return;
    editor.close(); editorDirty = false;
    if (editorReturnFocus && editorReturnFocus.isConnected) editorReturnFocus.focus();
  }
  function openEditor(title, build, onSave, submitLabel, onSubmit) {
    editorSaveChange = onSave;
    editorReturnFocus = document.activeElement; editorDirty = false;
    editorReturnLabel = editorReturnFocus ? editorReturnFocus.getAttribute("aria-label") || editorReturnFocus.textContent.trim() : "";
    const form = node("form", { novalidate: true, "data-editor-form": "" });
    const body = node("div", { class: "dialog-body" }, node("div", { class: "form-error", role: "alert" }));
    form.append(node("div", { class: "dialog-head" }, node("h2", { id: "editor-title" }, title), node("div", { class: "dialog-head-actions" }, themeButton(), iconButton("close", "Закрыть форму", requestCloseEditor))), body);
    build(body, form);
    form.append(node("div", { class: "dialog-footer" }, button("Отмена", requestCloseEditor, "btn btn-secondary"), node("button", { type: "submit", class: "btn btn-primary" }, submitLabel || "Сохранить")));
    form.addEventListener("input", () => { editorDirty = true; });
    form.addEventListener("change", () => { editorDirty = true; });
    form.addEventListener("submit", async event => {
      event.preventDefault(); clearFormErrors(form);
      const saved = onSubmit ? await onSubmit(collect(form), form) : commit(draft => onSave(draft, collect(form)), form);
      if (saved) { editorDirty = false; editor.close(); showToast(typeof saved === "string" ? saved : "Сохранено в этом браузере."); }
    });
    editor.replaceChildren(form); editor.showModal();
    requestAnimationFrame(() => { const first = form.querySelector("input:not([disabled]), select, textarea"); if (first) first.focus(); });
  }
  editor.addEventListener("cancel", event => { event.preventDefault(); requestCloseEditor(); });
  editor.addEventListener("close", () => {
    serviceDate();
    let target = editorReturnFocus && editorReturnFocus.isConnected && editorReturnFocus.getClientRects().length ? editorReturnFocus : null;
    if (!target) target = Array.from(app.querySelectorAll("button")).find(b => b.getClientRects().length && (b.getAttribute("aria-label") || b.textContent.trim()) === editorReturnLabel);
    if (!target) target = app.querySelector(".nav-btn.active");
    if (target) target.focus();
  });

  function field(parent, name, label, value, options) {
    const opts = options || {}, inputId = "field-" + name;
    const wrapper = node("div", { class: "field", hidden: opts.hidden || false });
    const input = opts.options ? node("select", { id: inputId, name: name }) : node(opts.multiline ? "textarea" : "input", {
      id: inputId, name: name, type: opts.type || "text", inputmode: opts.money ? "decimal" : opts.numeric ? "numeric" : null,
      autocomplete: "off", maxlength: opts.maxLength || null, min: opts.min || null, max: opts.max || null, disabled: opts.disabled || false
    });
    if (opts.options) {
      for (const option of opts.options) input.append(node("option", { value: option.value, disabled: option.disabled || false }, option.label));
    }
    input.value = value == null ? "" : value;
    const errorId = inputId + "-error";
    input.setAttribute("aria-describedby", errorId + (opts.help ? " " + inputId + "-help" : ""));
    wrapper.append(node("label", { for: inputId }, label), input, node("span", { id: errorId, class: "field-error", "data-error-for": name, "aria-live": "polite" }));
    if (opts.help) wrapper.append(node("p", { id: inputId + "-help", class: "help" }, opts.help));
    parent.append(wrapper); return input;
  }
  function check(parent, name, label, checked, help) {
    const input = node("input", { type: "checkbox", name: name, checked: checked, id: "check-" + name });
    parent.append(node("label", { class: "check-field", for: "check-" + name }, input, node("span", {}, label, help ? node("span", { class: "help" }, help) : null)));
    return input;
  }
  function categoriesOptions(currentId) { return state.categories.filter(c => c.active || c.id === currentId).map(c => ({ value: c.id, label: c.name + (!c.active ? " (архив)" : "") })); }
  function inclusionFields(parent, form, actualDateInput, existingOp, livingCheckbox, factEnabled) {
    const holder = node("div", { class: "dependent" }); parent.append(holder);
    const anchorBox = check(holder, "includeAnchor", "Уже учтено в введённом остатке", !!(existingOp && state.balanceAnchor.includedOperationIds.includes(existingOp.id)));
    const budgetBox = check(holder, "includeLiving", "Уже учтено в оставшемся бюджете на жизнь", !!(existingOp && state.lifeBudgetOverrides.some(b => b.includedLivingOperationIds.includes(existingOp.id))));
    const info = node("p", { class: "help" }); holder.append(info);
    const preview = node("p", { class: "help", "data-testid": "balance-preview" }); holder.append(preview);
    if (existingOp && state.balanceAnchor.includedOperationIds.includes(existingOp.id)) holder.append(notice("Изменится история. Если сумма денег сейчас другая, уточните остаток.", "warning"));
    function update() {
      const enabled = typeof factEnabled === "function" ? factEnabled() : true, date = actualDateInput.value;
      holder.hidden = !enabled;
      anchorBox.parentElement.hidden = !enabled || !state.balanceAnchor || date !== state.balanceAnchor.date;
      const living = livingCheckbox && livingCheckbox.checked;
      budgetBox.parentElement.hidden = !enabled || !living || !state.lifeBudgetOverrides.some(b => b.coverageStartDate === date);
      info.textContent = enabled && state.balanceAnchor && validDate(date) && date < state.balanceAnchor.date ? "Эта дата раньше введённого остатка. Запись попадёт в историю и не изменит деньги сейчас." : "";
      preview.textContent = "";
      const amountField = form.elements.namedItem("amount");
      if (enabled && state.balanceAnchor && amountField && validDate(date) && date <= todayLocal()) {
        try {
          const amount = parseMoney(amountField.value, { positive: true });
          const type = existingOp ? existingOp.type : livingCheckbox ? "expense" : "income", sign = type === "income" ? 1 : -1;
          const oldDelta = existingOp && !state.balanceAnchor.includedOperationIds.includes(existingOp.id) ? sign * existingOp.amount : 0;
          const included = date < state.balanceAnchor.date || (date === state.balanceAnchor.date && anchorBox.checked);
          const nextBalance = safeSum([actualBalance(state), -oldDelta, included ? 0 : sign * amount]);
          preview.textContent = "После записи денег сейчас: " + amountText(nextBalance);
        } catch (_) { /* Validation errors are shown when the user submits the form. */ }
      }
    }
    actualDateInput.addEventListener("input", update); actualDateInput.addEventListener("change", update);
    if (livingCheckbox) livingCheckbox.addEventListener("change", update);
    anchorBox.addEventListener("change", update);
    const amountField = form.elements.namedItem("amount");
    if (amountField) { amountField.addEventListener("input", update); amountField.addEventListener("change", update); }
    update(); return update;
  }
  function expenseForm(sourceId) {
    const source = sourceId ? state.expenses.find(x => x.id === sourceId) : null, op = source && operation(state, source), today = todayLocal();
    openEditor(source ? op ? "Исправить расход и оплату" : "Изменить расход" : "Добавить расход", (body, form) => {
      field(body, "title", "Название", source ? source.title : "", { maxLength: 100 });
      const grid = node("div", { class: "form-grid" }); body.append(grid);
      field(grid, "amount", op ? "Фактическая сумма, ₽" : "Сумма, ₽", amountInput(op ? op.amount : source ? source.plannedAmount : null), { money: true });
      const category = field(grid, "categoryId", "Категория", source ? source.categoryId : "cat-other", { options: categoriesOptions(source && source.categoryId) });
      field(body, "dueDate", "Оплатить до", source ? source.dueDate : today, { type: "date", max: monthEnd(monthOf(today)) });
      const mandatory = check(body, "mandatory", "Обязательный расход", source ? source.mandatory : true);
      const living = check(body, "isLiving", "Входит в бюджет на жизнь", source ? source.isLiving : false, "Продукты и личные нужды. Сумма не учитывается поверх того же бюджета.");
      check(body, "isUnplanned", "Внеплановый расход", source ? source.isUnplanned : false);
      function livingUpdate() { if (living.checked) { mandatory.checked = true; mandatory.disabled = true; } else mandatory.disabled = false; }
      living.addEventListener("change", livingUpdate);
      category.addEventListener("change", () => { const c = state.categories.find(x => x.id === category.value); living.checked = !!(c && ["food", "personal"].includes(c.systemKey)); livingUpdate(); });
      livingUpdate();
      let paidCheck = null;
      if (!op) paidCheck = check(body, "alreadyPaid", "Уже оплачено", false);
      const fact = node("div", { class: "dependent" }); body.append(fact);
      const actualDate = field(fact, "actualDate", "Дата фактической оплаты", op ? op.date : today, { type: "date", max: today });
      fact.append(node("p", { class: "help" }, "Указанная сумма — полная конечная стоимость. Частичные оплаты в этой версии не ведутся."));
      const updateInclusion = inclusionFields(fact, form, actualDate, op, living, () => !!op || paidCheck.checked);
      function updateFact() { fact.hidden = !op && !paidCheck.checked; updateInclusion(); }
      if (paidCheck) paidCheck.addEventListener("change", updateFact); updateFact();
      field(body, "note", "Заметка — необязательно", source ? source.note : "", { multiline: true, maxLength: 500 });
    }, (draft, values) => saveExpense(draft, sourceId || null, values, todayLocal()));
  }
  function incomeForm(sourceId) {
    const source = sourceId ? state.incomes.find(x => x.id === sourceId) : null, op = source && operation(state, source), today = todayLocal();
    openEditor(source ? op ? "Исправить доход и получение" : "Изменить доход" : "Добавить доход", (body, form) => {
      field(body, "title", "Название", source ? source.title : "Дополнительный доход", { maxLength: 100 });
      field(body, "amount", op ? "Фактическая сумма, ₽" : "Сумма, ₽", amountInput(op ? op.amount : source ? source.plannedAmount : null), { money: true });
      field(body, "plannedDate", "Ожидаемая дата", source ? source.manualDate || source.plannedDate : today, { type: "date", disabled: !!op });
      if (source && source.ruleId && !op) body.append(node("p", { class: "help" }, "Ручная дата относится только к этому поступлению. Для праздников измените её здесь."));
      let receivedCheck = null;
      if (!op) receivedCheck = check(body, "alreadyReceived", "Уже получен", false);
      const fact = node("div", { class: "dependent" }); body.append(fact);
      const actualDate = field(fact, "actualDate", "Дата фактического получения", op ? op.date : today, { type: "date", max: today });
      const updateInclusion = inclusionFields(fact, form, actualDate, op, null, () => !!op || receivedCheck.checked);
      function updateFact() { fact.hidden = !op && !receivedCheck.checked; updateInclusion(); }
      if (receivedCheck) receivedCheck.addEventListener("change", updateFact); updateFact();
      field(body, "note", "Заметка — необязательно", source ? source.note : "", { multiline: true, maxLength: 500 });
    }, (draft, values) => saveIncome(draft, sourceId || null, values, todayLocal()));
  }
  function templateForm(templateId) {
    const template = templateId ? state.expenseTemplates.find(x => x.id === templateId) : null;
    openEditor(template ? "Изменить регулярную статью" : "Регулярный расход", body => {
      field(body, "title", "Название", template ? template.title : "", { maxLength: 100 });
      const grid = node("div", { class: "form-grid" }); body.append(grid);
      field(grid, "amount", "Обычная сумма, ₽", amountInput(template ? template.amount : null), { money: true });
      field(grid, "dueDay", "Оплатить до числа", template ? template.dueDay : "", { numeric: true, maxLength: 2, help: "От 1 до 31. В коротком месяце — последний день." });
      const category = field(body, "categoryId", "Категория", template ? template.categoryId : "cat-other", { options: categoriesOptions(template && template.categoryId) });
      const mandatory = check(body, "mandatory", "Обязательный расход", template ? template.mandatory : true);
      const living = check(body, "isLiving", "Входит в бюджет на жизнь", template ? template.isLiving : false);
      const policy = field(body, "rolloverPolicy", "Если не оплачено к концу месяца", template && template.rolloverPolicy === "skip" ? "skip" : "carry", { options: [{ value: "carry", label: "Переносить отдельно от нового платежа" }, { value: "skip", label: "Пропускать старый платёж" }] });
      const policyInfo = node("p", { class: "help" }, "Обязательные неоплаченные расходы сохраняются как задолженность."); body.append(policyInfo);
      function updatePolicy() {
        if (living.checked) { mandatory.checked = true; mandatory.disabled = true; } else mandatory.disabled = false;
        policy.closest(".field").hidden = mandatory.checked; policyInfo.hidden = !mandatory.checked;
      }
      mandatory.addEventListener("change", updatePolicy); living.addEventListener("change", updatePolicy);
      category.addEventListener("change", () => { const c = state.categories.find(x => x.id === category.value); living.checked = !!(c && ["food", "personal"].includes(c.systemKey)); updatePolicy(); }); updatePolicy();
      check(body, "active", "Создавать каждый месяц", template ? template.active : true);
      if (template && state.expenses.some(x => x.templateId === template.id && x.originMonth === monthOf(todayLocal()) && x.status === "pending")) check(body, "applyCurrent", "Применить к неоплаченному расходу этого месяца", false, "Без этой отметки изменения относятся к будущим экземплярам.");
    }, (draft, values) => saveTemplate(draft, templateId || null, values, todayLocal()));
  }
  function rulesFields(body) {
    for (const rule of state.incomeRules) {
      const box = node("div", { class: "wizard-card" }); body.append(box);
      const enabled = check(box, rule.kind + "Active", rule.title, rule.active);
      const grid = node("div", { class: "form-grid" }); box.append(grid);
      const amount = field(grid, rule.kind + "Amount", "Сумма, ₽", amountInput(rule.amount), { money: true });
      const day = field(grid, rule.kind + "Day", "Обычный день", rule.day, { numeric: true, maxLength: 2 });
      const info = node("p", { class: "help" }); box.append(info);
      function update() {
        amount.disabled = !enabled.checked;
        const n = Number(day.value); info.textContent = n >= 1 && n <= 31 && Number.isInteger(n) ? "В этом месяце: " + dateText(incomeDate(monthOf(todayLocal()), n)) + ". Выходные перенесены на пятницу." : "Укажите день от 1 до 31.";
      }
      enabled.addEventListener("change", update); day.addEventListener("input", update); update();
    }
  }
  function rulesForm() {
    openEditor("Регулярные доходы", body => {
      body.append(node("p", { class: "help" }, "Изменения относятся к новым экземплярам. Дату конкретного поступления можно изменить в его карточке."));
      rulesFields(body);
      check(body, "applyCurrent", "Обновить ожидаемые доходы этого месяца", false, "Полученные и отменённые поступления не изменятся.");
    }, (draft, values) => saveRules(draft, values, todayLocal(), values.applyCurrent));
  }
  function budgetFields(body) {
    const grid = node("div", { class: "form-grid" }); body.append(grid);
    field(grid, "lifeAfterSalary", "После зарплаты, ₽", amountInput(state.settings.lifeAfterSalary), { money: true });
    field(grid, "lifeAfterAdvance", "После аванса, ₽", amountInput(state.settings.lifeAfterAdvance), { money: true });
    field(body, "lifeWithoutRegularIncome", "На месяц без регулярных доходов, ₽", amountInput(state.settings.lifeWithoutRegularIncome), { money: true });
    const budget = state.onboarding.completed ? calculatePlan(state, todayLocal()).currentBudget : null;
    field(body, "lifeRemaining", "Ещё нужно до следующего дохода, ₽", amountInput(budget ? budget.remaining : 0), { money: true, help: "Новая точка бюджета на сегодня. Уже внесённые покупки учтены; запланированные покупки входят в эту сумму." });
    field(body, "reserveTarget", "Желаемый резерв, ₽", amountInput(state.settings.reserveTarget), { money: true, help: "Сохранить из денег, оставшихся после необходимых расходов." });
  }
  function budgetsForm() { openEditor("Деньги на жизнь и резерв", budgetFields, (draft, values) => saveBudgets(draft, values, todayLocal())); }
  function balanceForm() {
    openEditor("Уточнить деньги сейчас", body => {
      body.append(notice("Введите реальную сумму на сегодня. Она уже включает все операции, внесённые к этому моменту.", "neutral"));
      field(body, "amount", "Текущий остаток, ₽", amountInput(actualBalance(state)), { money: true });
      field(body, "note", "Заметка — необязательно", "", { multiline: true, maxLength: 500 });
    }, (draft, values) => correctBalance(draft, parseMoney(values.amount, { signed: true, field: "amount" }), todayLocal(), note(values.note)));
  }
  function categoryForm(categoryId) {
    const cat = state.categories.find(x => x.id === categoryId);
    openEditor(cat ? "Название категории" : "Добавить категорию", body => field(body, "name", "Название", cat ? cat.name : "", { maxLength: 40 }), (draft, values) => saveCategory(draft, categoryId || null, values));
  }
  function topbar() {
    return node("header", { class: "topbar" },
      node("div", { class: "brand" }, node("span", { class: "brand-icon", "aria-hidden": "true" }, "₽"), "Мой план расходов"),
      node("div", { class: "topbar-tools" }, node("div", { class: "saved" }, node("span", { class: "saved-dot", "aria-hidden": "true" }), node("span", { class: "saved-label" }, state && state.revision > 0 ? "Сохранено в браузере" : "Только на вашем устройстве")), themeButton()));
  }
  function pageHeader(title, description) {
    return node("div", { class: "page-head" }, node("div", {}, node("p", { class: "eyebrow" }, monthText(todayLocal())), node("h1", {}, title), node("p", { class: "muted" }, description)), node("span", { class: "date-pill" }, dateText(todayLocal(), true)));
  }
  function settleClick(type, sourceId) {
    const key = type + ":" + sourceId, now = Date.now();
    if (recentActions.has(key) && now - recentActions.get(key) < 550) return;
    recentActions.set(key, now);
    const source = sourceById(state, type, sourceId);
    if (operation(state, source)) { unmarkClick(type, sourceId); return; }
    let opId = null;
    if (commit(draft => { opId = settleSource(draft, type, sourceId, {}, todayLocal()); }) && opId) showToast(type === "income" ? "Доход отмечен полученным." : "Расход отмечен оплаченным.", { type: type, sourceId: sourceId, revision: state.revision });
  }
  async function unmarkClick(type, sourceId) {
    const source = sourceById(state, type, sourceId), op = operation(state, source);
    if (!op) return;
    const included = state.balanceAnchor.includedOperationIds.includes(op.id);
    const message = included ? "Эта операция уже учтена в введённом остатке. Изменится история, а подтверждённая сумма денег останется прежней. Если деньги сейчас другие, уточните остаток." : "Запись вернётся в ожидаемые. Расчётный остаток будет пересчитан.";
    if (await confirmAction(type === "income" ? "Снять отметку получения?" : "Снять отметку оплаты?", message, "Снять отметку", false)) {
      if (commit(draft => voidOperation(draft, type, sourceId))) showToast("Отметка снята.");
    }
  }
  async function cancelClick(type, sourceId) {
    const source = sourceById(state, type, sourceId);
    if (await confirmAction("Отменить запись?", source.title + " будет исключён из текущих записей. Регулярный шаблон и история сохранятся.", "Отменить запись", true)) {
      if (commit(draft => cancelSource(draft, type, sourceId))) showToast("Запись отменена.");
    }
  }
  function paymentDateForm(sourceId) {
    const source = sourceById(state, "expense", sourceId);
    openEditor("Дата оплаты: " + source.title, body => {
      body.append(notice("Срок — " + dateText(source.dueDate, true) + ". Автоматическая рекомендация — оплатить к сроку; просроченное — сегодня."));
      const date = field(body, "manualPayDate", "Оплатить вручную", source.manualPayDate && source.manualPayDate >= todayLocal() ? source.manualPayDate : paymentDate(source, todayLocal()), { type: "date" });
      const auto = check(body, "automatic", "Вернуть автоматическую дату", false);
      const warning = node("div", {});
      const late = check(warning, "confirmedLate", "Подтверждаю: оплата будет позже срока", false);
      body.append(warning);
      const update = () => { date.disabled = auto.checked; warning.hidden = auto.checked || date.value <= source.dueDate; if (warning.hidden) late.checked = false; };
      date.addEventListener("input", update); auto.addEventListener("change", update); update();
    }, (draft, values) => setPaymentDate(draft, sourceId, values.automatic ? null : values.manualPayDate, values.confirmedLate, todayLocal()));
  }
  function recordCard(source, type) {
    const op = operation(state, source), paid = !!op, date = type === "expense" ? source.dueDate : effectiveIncomeDate(state, source), today = todayLocal();
    const sub = node("div", { class: "record-sub" });
    if (paid) sub.append(chip(type === "income" ? "Получен" : "Оплачен", "green"), node("span", {}, dateText(op.date, monthOf(op.date) !== monthOf(today))));
    else {
      sub.append(node("span", {}, type === "expense" ? "до " + dateText(date, monthOf(date) !== monthOf(today)) : dateText(date, monthOf(date) !== monthOf(today))));
      if (date < today) sub.append(chip(type === "expense" ? "Просрочен" : "Не подтверждено", type === "expense" ? "danger" : "warning"));
      else if (date === today) sub.append(chip(type === "expense" ? "Сегодня" : "Ожидается сегодня", "warning"));
    }
    if (type === "expense") {
      sub.append(node("span", {}, categoryName(source.categoryId)));
      if (!paid) sub.append(chip(source.mandatory ? "Обязательный" : "Можно перенести", source.mandatory ? "plum" : "warning"));
      if (source.isUnplanned) sub.append(chip("Внеплановый", "warning"));
      if (source.templateId) sub.append(node("span", {}, "Ежемесячно"));
      if (source.isLiving) sub.append(node("span", {}, "На жизнь"));
      if (source.isLiving && paid && displayedPlan && displayedPlan.periods.some(p => p.exceeded && op.date >= p.coverageStart && op.date < p.end)) sub.append(chip("Бюджет превышен", "warning"));
      if (source.rolloverHistory.length) sub.append(chip("Перенесён", "warning"), node("span", {}, "Из " + source.originMonth));
      else if (source.originMonth < monthOf(today)) sub.append(node("span", {}, "За " + source.originMonth));
      const info = displayedPlan && displayedPlan.cards[source.id];
      if (!paid && info) {
        if (source.dueDate >= today && source.dueDate <= addDays(today, 3)) sub.append(chip("Пора оплатить", "warning"));
        else if (info.accepted && source.dueDate >= today) sub.append(chip("Запланирован"));
        if (info.declined) sub.append(chip("Не помещается в план", "warning"));
        if (info.shortage) sub.append(chip("Не хватает денег", "danger"));
        if (info.livingShortage) sub.append(chip("Не хватает на жизнь", "warning"));
        sub.append(node("span", {}, "Оплатить " + dateText(info.date)));
        if (source.manualPayDate) sub.append(node("span", {}, "Ручная дата: " + dateText(source.manualPayDate, true)));
        if (source.manualPayDate && source.manualPayDate > source.dueDate) sub.append(chip("Позже срока", "warning"));
        const funding = displayedPlan.groups.find(g => g.id === info.group);
        if (funding) sub.append(node("span", {}, source.manualPayDate ? "Назначено вами · " + funding.title.toLocaleLowerCase("ru") : "К сроку · " + funding.title.toLocaleLowerCase("ru")));
        if (source.isLiving && displayedPlan.periods.some(p => p.exceeded && info.date >= p.coverageStart && info.date < p.end)) sub.append(chip("Бюджет превышен", "warning"));
      }
    } else {
      sub.append(node("span", {}, source.kind === "salary" ? "Зарплата" : source.kind === "advance" ? "Аванс" : "Дополнительный доход"));
      if (!paid && monthOf(date) !== monthOf(today)) sub.append(node("span", {}, "За пределами текущего месяца"));
    }
    const controls = node("div", { class: "record-controls" });
    controls.append(node("button", {
      type: "button", class: "pay-btn" + (paid ? " is-paid" : ""),
      "aria-label": (paid ? type === "income" ? "Снять получение: " : "Снять оплату: " : type === "income" ? "Отметить получение: " : "Отметить оплату: ") + source.title,
      "aria-pressed": String(paid), "data-action": "settle-" + type, onclick: () => settleClick(type, source.id)
    }, icon(paid ? "check" : type === "income" ? "arrowDown" : "check")));
    controls.append(iconButton("edit", "Изменить: " + source.title, () => currentView === "reports" && op ? historyForm(type, source.id) : type === "expense" ? expenseForm(source.id) : incomeForm(source.id)));
    if (type === "expense" && !paid) controls.append(iconButton("calendar", "Дата оплаты: " + source.title, () => paymentDateForm(source.id)));
    if (!paid) controls.append(iconButton("close", "Отменить: " + source.title, () => cancelClick(type, source.id)));
    return node("article", { class: "record" + (paid ? " paid" : ""), "data-record-id": source.id, "data-record-type": type },
      node("div", { class: "record-mark", "aria-hidden": "true" }, icon(type === "income" ? "arrowDown" : paid ? "check" : source.templateId ? "calendar" : "wallet")),
      node("div", { class: "record-copy" }, node("div", { class: "record-title" }, source.title), sub, source.note ? node("div", { class: "record-note" }, source.note) : null),
      node("div", { class: "record-right" }, node("div", { class: "record-amount" }, amountText(op ? op.amount : source.plannedAmount)), controls));
  }
  function renderPlan(main) {
    const today = todayLocal(), month = monthOf(today), plan = calculatePlan(state, today), facts = plan.facts, balance = plan.balance;
    displayedPlan = plan;
    main.append(pageHeader("Деньги под рукой.", "Оплаты по срокам. Деньги на жизнь — между поступлениями."));
    const card = node("section", { class: "balance-card", "aria-label": "Фактический остаток" },
      node("p", { class: "eyebrow" }, "Денег сейчас"),
      node("div", { class: "balance-value", "data-testid": "balance" }, amountText(balance)),
      node("p", { class: "caption" }, "Введённый остаток и фактические операции. Ожидаемые поступления сюда не входят."));
    const summary = node("section", { class: "summary-card", "aria-label": "Итоги текущего месяца" },
      node("div", { class: "summary-title" }, "В этом месяце · план / факт"),
      node("div", { class: "summary-grid" },
        node("div", { class: "stat incoming" }, node("div", { class: "stat-label" }, icon("arrowDown"), "Доходы · план"), node("div", { class: "stat-value", "data-testid": "income-plan" }, amountText(plan.incomePlan)), node("p", { class: "muted" }, "Получено: ", node("span", { "data-testid": "income-fact" }, amountText(facts.income)))),
        node("div", { class: "stat" }, node("div", { class: "stat-label" }, icon("arrowUp"), "Расходы · план"), node("div", { class: "stat-value", "data-testid": "expense-plan" }, amountText(plan.expensePlan)), node("p", { class: "muted" }, "Оплачено: ", node("span", { "data-testid": "expense-fact" }, amountText(facts.expense))))),
      node("div", { class: "difference" }, node("span", {}, "Разница плана"), node("strong", { "data-testid": "difference-plan" }, amountText(plan.differencePlan))),
      node("div", { class: "difference" }, node("span", {}, "Разница факта"), node("strong", { "data-testid": "difference-fact" }, amountText(facts.difference))),
      node("p", { class: "help" }, "Осталось получить " + amountText(plan.remainingIncome) + " · оплатить " + amountText(plan.remainingExpense) + ". В плане расходов есть и те покупки, которые пока не помещаются."));
    main.append(card);
    const budget = plan.currentBudget, nextIncome = plan.nextIncome;
    const metric = (label, value, test, help, action) => node("section", { class: "plan-metric" }, node("p", { class: "muted" }, label), node("strong", { "data-testid": test }, value), node("p", { class: "help" }, help), action || null);
    main.append(node("div", { class: "plan-metrics" },
      metric("Ближайшее поступление", nextIncome ? amountText(nextIncome.amount) : "Нет ожидаемых", "next-income", nextIncome ? nextIncome.title + " · " + dateText(nextIncome.date) + (nextIncome.projected ? " · по регулярному правилу" : "") : "Добавьте известный доход вручную."),
      metric("Осталось на жизнь", amountText(budget ? budget.remaining : 0), "life-remaining", budget ? "До " + dateText(budget.end) + " · без детализации " + amountText(budget.unassigned) + " · покупки в плане " + amountText(budget.planned) : "Бюджет периода не задан.", button("Уточнить бюджет", budgetsForm, "btn btn-secondary")),
      metric("Защищённый резерв", amountText(plan.reserve), "reserve", "Из желаемых " + amountText(state.settings.reserveTarget) + ". Не списывается из остатка."),
      metric("Можно потратить сейчас", amountText(plan.available), "available", "Сверх принятых платежей, жизни и резерва. Это не разница месяца.")));
    main.append(summary);
    if (plan.forecast.cashGap) main.append(planAlert("Кассовый разрыв: " + amountText(plan.forecast.cashGap.amount) + " к " + dateText(plan.forecast.cashGap.date) + ". Позднее поступление не покрывает ранний срок.", "danger", plan.forecast.cashGap.id));
    if (plan.forecast.livingGap) main.append(planAlert("Не хватает на бюджет жизни: " + amountText(plan.forecast.livingGap.amount) + " к " + dateText(plan.forecast.livingGap.date) + ". Это отдельная потребность сверх конкретных платежей.", "warning", plan.forecast.livingGap.id));
    if (plan.reserveUsed) main.append(notice("Ручной план использует часть резерва.", "warning"));
    if (factReserveUsed) main.append(notice("Фактическая трата использовала часть резерва. Его доступная сумма пересчитана.", "warning"));
    for (const p of plan.periods.filter(p => p.exceeded)) main.append(notice("Бюджет превышен на " + amountText(p.exceeded) + " в периоде " + dateText(p.start) + " — " + dateText(p.end) + ".", "warning"));
    for (const message of budgetMessages) main.append(notice(message, "warning"));
    if (!state.settings.lifeAfterSalary && !state.settings.lifeAfterAdvance && !state.settings.lifeWithoutRegularIncome && !state.settings.reserveTarget) main.append(node("div", { class: "notice neutral" }, "План учитывает введённые платежи. Можно отдельно задать деньги на жизнь и резерв.", button("Настроить бюджет", budgetsForm, "btn btn-secondary")));
    if (balance < 0) main.append(notice("Расчётный остаток отрицательный: " + amountText(balance) + ". Проверьте отметки поступлений и уточните деньги сейчас.", "danger"));
    const pendingExpenses = state.expenses.filter(x => x.status === "pending"), pendingIncomes = state.incomes.filter(x => x.status === "expected");
    const unconfirmed = pendingIncomes.filter(i => effectiveIncomeDate(state, i) < today);
    if (unconfirmed.length) main.append(node("div", { class: "notice warning" }, "Поступление не подтверждено: " + unconfirmed.map(i => i.title + " · " + dateText(effectiveIncomeDate(state, i))).join("; ") + ". Оно остаётся в месячном плане, но не финансирует платежи.", button("Проверить доходы", () => { recordTab = "income"; render(); }, "btn btn-secondary")));
    if (plan.forecast.cashGap || plan.forecast.livingGap) main.append(node("div", { class: "actions shortage-actions" },
      button("Проверить доходы", () => { recordTab = "income"; render(); }, "btn btn-secondary"),
      button("Уточнить деньги на жизнь", budgetsForm, "btn btn-secondary"),
      button("Добавить известный доход", () => incomeForm(), "btn btn-secondary")));
    main.append(node("div", { class: "section-header" }, node("div", {}, node("h2", {}, "Ваши записи"), node("p", { class: "muted" }, "Ожидаемые суммы и уже выполненные операции")),
      node("div", { class: "actions" },
        node("button", { type: "button", class: "btn btn-primary", onclick: () => expenseForm() }, icon("plus"), "Добавить расход"),
        node("button", { type: "button", class: "btn btn-secondary", onclick: () => incomeForm() }, icon("plus"), "Добавить доход"))));
    const tabs = node("div", { class: "tabs", role: "tablist", "aria-label": "Тип записей" });
    for (const [type, label, count] of [["expense", "Расходы", pendingExpenses.length], ["income", "Доходы", pendingIncomes.length]]) tabs.append(node("button", {
      type: "button", class: "tab", role: "tab", "aria-selected": String(recordTab === type),
      onclick: () => { recordTab = type; render(); }
    }, label, node("span", { class: "tab-count" }, count)));
    main.append(tabs);
    const filters = node("div", { class: "plan-filters", "aria-label": "Фильтры записей" });
    const search = field(filters, "planSearch", "Поиск по названию и заметке", planFilters.search, { type: "search", maxLength: 500 });
    search.addEventListener("input", () => { const caret = search.selectionStart; planFilters.search = search.value; render(); const next = app.querySelector('[name="planSearch"]'); next.focus(); if (caret !== null) next.setSelectionRange(caret, caret); });
    const status = field(filters, "planStatus", "Показать", planFilters.status, { options: [{ value: "all", label: "Все" }, { value: "unpaid", label: "Неоплаченные / ожидаемые" }, { value: "paid", label: "Оплаченные / полученные" }] });
    status.addEventListener("change", () => { planFilters.status = status.value; render(); });
    if (recordTab === "expense") {
      const category = field(filters, "planCategory", "Категория", planFilters.category, { options: [{ value: "", label: "Все категории" }].concat(state.categories.map(c => ({ value: c.id, label: c.name }))) });
      category.addEventListener("change", () => { planFilters.category = category.value; render(); });
      const mandatory = check(filters, "planMandatory", "Только обязательные", planFilters.mandatory);
      mandatory.addEventListener("change", () => { planFilters.mandatory = mandatory.checked; render(); });
    }
    main.append(filters);
    main.append(button("Сбросить фильтры", () => { Object.assign(planFilters, { search: "", status: "all", mandatory: false, category: "" }); render(); }, "btn btn-secondary"));
    const matches = s => (!planFilters.search || (s.title + " " + s.note).toLocaleLowerCase("ru").includes(planFilters.search.toLocaleLowerCase("ru"))) && (recordTab !== "expense" || ((!planFilters.mandatory || s.mandatory) && (!planFilters.category || s.categoryId === planFilters.category)));
    const pending = (recordTab === "expense" ? pendingExpenses : pendingIncomes).slice().sort((a, b) => {
      const ad = recordTab === "expense" ? paymentDate(a, today) : effectiveIncomeDate(state, a), bd = recordTab === "expense" ? paymentDate(b, today) : effectiveIncomeDate(state, b);
      return ad.localeCompare(bd) || (recordTab === "expense" ? a.dueDate.localeCompare(b.dueDate) || Number(b.mandatory) - Number(a.mandatory) : 0) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
    });
    const sourceMap = new Map(sources(state, recordTab).map(s => [s.id, s]));
    const paid = state.operations.filter(op => op.status === "active" && op.type === recordTab && monthOf(op.date) === month).map(op => sourceMap.get(op.sourceId)).filter(s => matches(s) && planFilters.status !== "unpaid").sort((a, b) => operation(state, b).date.localeCompare(operation(state, a).date) || a.id.localeCompare(b.id));
    const visible = pending.filter(s => matches(s) && planFilters.status !== "paid");
    const list = (title, records, description) => { if (records.length) main.append(node("section", { class: "funding-group" }, node("h3", {}, title), description ? node("p", { class: "help" }, description) : null, node("div", { class: "record-list" }, records.map(s => recordCard(s, recordTab))))); };
    if (recordTab === "income") {
      list("Ожидаемые поступления", visible, "Праздники учитываются изменением даты вручную. Доход за пределами месяца сохраняется и участвует только в подходящем горизонте.");
    } else {
      list("Просроченные оплаты", visible.filter(s => s.dueDate < today && !plan.cards[s.id]?.declined), "Исходные сроки сохранены. Без ручной даты рекомендуем оплатить сегодня; назначенная вами дата указана в карточке.");
      for (const group of plan.groups) list(group.title, group.expenses.filter(s => matches(s) && planFilters.status !== "paid" && s.dueDate >= today && monthOf(paymentDate(s, today)) === month), group.incomes.length ? dateText(group.date) + " · " + amountText(safeSum(group.incomes.map(i => i.amount))) + ". Оплатить к указанным срокам; группа использует общий накопленный остаток." : "Оплаты до ближайшего доступного поступления.");
      const rejected = visible.filter(s => plan.cards[s.id]?.declined);
      if (rejected.length) main.append(detailsGroup("Не помещается в план · " + rejected.length, [node("p", { class: "help" }, "После обязательств, денег на жизнь и резерва свободных средств недостаточно. Запись сохранена в желаемых расходах; можно изменить сумму или задать ручную дату."), rejected.map(s => recordCard(s, recordTab))], "declined"));
    }
    if (!visible.length && !paid.length) main.append(empty("Записей для выбранных условий нет", "Измените фильтры или добавьте запись."));
    if (paid.length) main.append(detailsGroup((recordTab === "expense" ? "Оплачено" : "Получено") + " в этом месяце · " + paid.length, paid.map(x => recordCard(x, recordTab)), "paid-" + recordTab));
    const canceled = sources(state, recordTab).filter(s => s.status === "canceled" && matches(s)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    if (canceled.length && planFilters.status === "all") main.append(detailsGroup("История отмен и пропусков · " + canceled.length, [
      node("p", { class: "help" }, "Сохранённые отменённые записи за все месяцы. Они не участвуют в плане и фактических итогах. Поиск и фильтры категории применяются к этой истории."),
      canceled.map(s => node("article", { class: "record", "data-canceled-id": s.id },
        node("div", { class: "record-copy" }, node("div", { class: "record-title" }, s.title),
          node("div", { class: "record-sub" }, chip("Отменён"), node("span", {}, "За " + s.originMonth),
            node("span", {}, recordTab === "expense" ? "Срок: " + dateText(s.dueDate, true) : "Ожидалось: " + dateText(effectiveIncomeDate(state, s), true)),
            node("span", {}, s.cancelReason === "skip" ? "Пропущен по правилу статьи" : "Отменён пользователем"))),
        node("div", { class: "record-amount" }, amountText(s.plannedAmount))))
    ], "canceled-" + recordTab));
    renderForecast(main, plan);
    main.append(node("p", { class: "footer-note" }, "Все отметки — записи о ваших действиях. Приложение не выполняет банковские платежи."));
  }
  function planAlert(message, kind, sourceId) {
    const box = notice(message, kind), item = state.expenses.find(e => e.id === sourceId);
    const template = state.expenseTemplates.find(t => sourceId && sourceId.startsWith("expense/" + t.id + "/"));
    if (item) box.append(button("Проверить: " + item.title, () => expenseForm(item.id), "btn btn-secondary"));
    else if (template) box.append(button("Проверить статью: " + template.title, () => templateForm(template.id), "btn btn-secondary"));
    else box.append(button("Проверить бюджет", budgetsForm, "btn btn-secondary"));
    return box;
  }
  function renderForecast(main, plan) {
    const end = monthEnd(monthOf(plan.today)), events = plan.forecast.events.filter(e => e.date <= end);
    const section = node("section", { class: "forecast-panel", "aria-label": "Прогноз остатка" }, node("h2", {}, "Прогноз по датам"),
      node("p", { class: "help" }, "Денежный — текущий остаток, ожидаемые доходы и плановые платежи. Защищённый — за вычетом нерасписанного бюджета на жизнь. Резерв отдельно: " + amountText(plan.reserve) + "."));
    const points = [{ date: plan.today, cash: plan.balance, protected: plan.balance }].concat(events);
    points.push({ date: end, cash: events.length ? events[events.length - 1].cash : plan.balance, protected: events.length ? events[events.length - 1].protected : plan.balance });
    const values = points.flatMap(p => [p.cash, p.protected]).concat(0), low = Math.min(...values), high = Math.max(...values), range = high - low || 100;
    const startMs = Date.parse(plan.today + "T12:00:00Z"), span = Math.max(86400000, Date.parse(end + "T12:00:00Z") - startMs);
    const x = p => 20 + (Date.parse(p.date + "T12:00:00Z") - startMs) / span * 660, y = value => 20 + (high - value) / range * 180;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 700 210"); svg.setAttribute("class", "forecast-chart"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Денежный и защищённый остаток. Точные значения приведены в списке событий ниже.");
    const svgElement = (tag, attrs) => { const el = document.createElementNS(svg.namespaceURI, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); svg.append(el); return el; };
    svgElement("line", { x1: 20, x2: 680, y1: y(0), y2: y(0), class: "forecast-zero" });
    for (const key of ["cash", "protected"]) {
      let path = "M " + x(points[0]) + " " + y(points[0][key]);
      for (let i = 1; i < points.length; i++) path += " H " + x(points[i]) + " V " + y(points[i][key]);
      svgElement("path", { d: path, class: "forecast-line " + key });
    }
    section.append(node("div", { class: "chart-legend" }, node("span", { class: "cash-key" }, "Денежный"), node("span", { class: "protected-key" }, "Защищённый")), svg, node("div", { class: "chart-dates" }, node("span", {}, dateText(plan.today)), node("span", {}, dateText(end))));
    const rows = list => list.map(e => node("li", { class: "forecast-event" }, node("div", {}, node("strong", {}, dateText(e.date) + " · " + e.title), node("p", { class: "help" }, (e.type === "income" ? "+" : "−") + amountText(e.amount) + (e.type === "life" ? " · только защита бюджета" : ""))), node("div", {}, "Деньги " + amountText(e.cash), node("p", { class: e.protected < 0 ? "danger-text" : "help" }, "Защищено " + amountText(e.protected)))));
    section.append(detailsGroup("События текущего месяца · " + events.length, node("ol", { class: "forecast-events" }, rows(events)), "forecast-events"));
    const crossing = plan.periods.filter(p => p.start <= end && p.end > end);
    const technicalEvents = plan.forecast.events.filter(e => e.date > end);
    const guardBody = node("div", {}, node("p", {}, "Расчёт до " + dateText(plan.horizon, true) + ", не включая этот день. Доход в этот день доступен до оплат."),
      node("p", {}, "Обязательства после конца месяца: " + amountText(safeSum(plan.guard.map(e => e.plannedAmount))) + "."),
      node("p", {}, "Нерасписанная жизнь пересекающего границу периода: " + amountText(safeSum(crossing.map(p => p.unassigned))) + ". Уже учтена в свободной сумме; второй бюджет не добавляется."),
      plan.guard.map(e => node("p", {}, dateText(paymentDate(e, plan.today)) + " · " + e.title + " · " + amountText(e.plannedAmount))),
      node("ol", { class: "forecast-events" }, rows(technicalEvents)),
      node("p", { class: "help" }, "Служебные обязательства не входят в расходы текущего месяца и не имеют галочки оплаты, пока не созданы экземпляры."));
    section.append(detailsGroup("Сохранить до следующей зарплаты", guardBody, "forecast-guard"));
    main.append(section);
  }
  function historyForm(type, sourceId) {
    const source = sourceId ? sourceById(state, type, sourceId) : null, op = source && operation(state, source);
    const initialDate = reportMonth > monthOf(todayLocal()) ? todayLocal() : reportMonth === monthOf(todayLocal()) ? todayLocal() : monthEnd(reportMonth);
    openEditor(source ? "Исправить фактическую операцию" : type === "income" ? "Внести фактический доход" : "Внести фактический расход", (body, form) => {
      body.append(notice("Это уже совершённая операция. Дата определяет месяц и год отчёта; регулярные записи за прошлый месяц не создаются."));
      field(body, "title", "Название", source ? source.title : "", { maxLength: 100 });
      field(body, "amount", "Фактическая сумма, ₽", amountInput(op ? op.amount : null), { money: true });
      const date = field(body, "actualDate", type === "income" ? "Дата фактического получения" : "Дата фактической оплаты", op ? op.date : initialDate, { type: "date", max: todayLocal() });
      let living = null;
      if (type === "expense") {
        const category = field(body, "categoryId", "Категория", source ? source.categoryId : "cat-other", { options: categoriesOptions(source && source.categoryId) });
        living = check(body, "isLiving", "Входит в бюджет на жизнь", source ? source.isLiving : false);
        category.addEventListener("change", () => { const c = state.categories.find(c => c.id === category.value); living.checked = ["food", "personal"].includes(c?.systemKey); living.dispatchEvent(new Event("change")); });
      }
      inclusionFields(body, form, date, op, living, () => true);
      if (op && state.balanceAnchor.includedOperationIds.includes(op.id)) body.append(notice("Изменится история. Если сумма денег сейчас другая, уточните остаток.", "warning"));
      field(body, "note", "Заметка — необязательно", source ? source.note : "", { multiline: true, maxLength: 500 });
    }, (draft, values) => {
      saveHistory(draft, type, sourceId || null, values, todayLocal());
      reportMonth = monthOf(values.actualDate); reportYear = reportMonth.slice(0, 4); reportMode = "month";
    });
  }
  const STATUS_TEXT = { complete: "Все операции внесены", partial: "Неполные данные", empty: "Нет данных", future: "Ещё не наступил" };
  function reportStats(report, title) {
    return node("section", { class: "summary-card report-summary" }, node("h2", {}, title),
      node("div", { class: "summary-grid" }, node("div", { class: "stat incoming" }, node("p", { class: "stat-label" }, "Доходы · факт"), node("strong", { class: "stat-value", "data-testid": "report-income" }, amountText(report.income))),
        node("div", { class: "stat" }, node("p", { class: "stat-label" }, "Расходы · факт"), node("strong", { class: "stat-value", "data-testid": "report-expense" }, amountText(report.expense)))),
      node("div", { class: "difference" }, node("span", {}, "Доходы минус расходы"), node("strong", { "data-testid": "report-difference" }, amountText(report.difference))));
  }
  function renderReports(main) {
    const today = todayLocal(), period = reportMode === "year" ? reportYear : reportMonth, report = reportPeriod(state, period, today);
    displayedPlan = null;
    main.append(pageHeader("Итоги", "Фактические доходы и расходы. Начальный остаток и резерв сюда не входят."));
    const mode = node("div", { class: "tabs", "aria-label": "Период итогов" });
    for (const [key, name] of [["month", "Месяц"], ["year", "Год"]]) mode.append(button(name, () => { reportMode = key; render(); }, "tab" + (reportMode === key ? " selected" : "")));
    main.append(mode);
    const controls = node("div", { class: "report-controls" }), yearValues = new Set([today.slice(0, 4), reportYear]);
    state.operations.forEach(o => yearValues.add(o.date.slice(0, 4))); Object.keys(state.monthCoverage).forEach(m => yearValues.add(m.slice(0, 4)));
    const year = field(controls, "reportYear", "Год отчёта", reportYear, { options: Array.from(yearValues).filter(y => y <= today.slice(0, 4)).sort().reverse().map(y => ({ value: y, label: y })) });
    year.addEventListener("change", () => { reportYear = year.value; reportMonth = reportYear + reportMonth.slice(4); render(); });
    if (reportMode === "month") {
      const month = field(controls, "reportMonth", "Месяц отчёта", reportMonth.slice(5), { options: Array.from({ length: 12 }, (_, i) => {
        const m = String(i + 1).padStart(2, "0");
        return { value: m, label: new Intl.DateTimeFormat("ru-RU", { month: "long", timeZone: "UTC" }).format(new Date(reportYear + "-" + m + "-01T12:00:00Z")) };
      }) });
      month.addEventListener("change", () => { reportMonth = reportYear + "-" + month.value; render(); });
    }
    main.append(controls, reportStats(report, reportMode === "year" ? "За " + reportYear + " год" : monthText(reportMonth + "-01")));
    if (reportMode === "year") {
      main.append(notice(report.status === "complete" ? "Полная история за год." : "Итоги по внесённым данным. Нулевое значение не означает отсутствие расходов, если история не подтверждена.", report.status === "complete" ? "neutral" : "warning"));
      renderYearChart(main, report);
    } else {
      main.append(notice(STATUS_TEXT[report.status] + (report.status === "partial" || report.status === "empty" ? ". Можно дополнить историю или подтвердить полноту." : "."), report.status === "partial" ? "warning" : "neutral"));
      if (report.status !== "future") {
        const completeness = check(main, "monthComplete", "Все операции месяца внесены", report.status === "complete");
        completeness.addEventListener("change", () => commit(draft => { draft.monthCoverage[reportMonth] = completeness.checked ? "complete" : "partial"; }));
        main.append(node("div", { class: "actions" }, button("Внести прошлый доход", () => historyForm("income"), "btn btn-secondary"), button("Внести прошлый расход", () => historyForm("expense"), "btn btn-primary")));
      }
      if (reportMonth === monthOf(today)) {
        const plan = calculatePlan(state, today);
        main.append(node("section", { class: "panel current-report-plan" }, node("h3", {}, "План текущего месяца"),
          node("p", { "data-testid": "report-current-plan" }, "Доходы " + amountText(plan.incomePlan) + " · расходы " + amountText(plan.expensePlan) + " · разница " + amountText(plan.differencePlan)),
          node("p", { class: "help" }, "Ожидаемые суммы не входят в фактические итоги. Первоначальные планы прошлых месяцев не сохраняются.")));
      }
    }
    const categoryPanel = node("section", { class: "panel report-categories" }, node("h2", {}, "Расходы по категориям"));
    if (!report.expense) categoryPanel.append(node("p", {}, "Расходов нет"));
    else for (const category of report.categories) categoryPanel.append(node("div", { class: "category-stat" },
      node("div", {}, node("strong", {}, category.name), node("span", {}, amountText(category.amount) + " · " + new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(category.percent) + "%")),
      node("div", { class: "category-track", "aria-hidden": "true" }, node("div", { style: "width:" + category.percent + "%" }))));
    main.append(categoryPanel);
    if (reportMode === "month") {
      main.append(node("h2", { class: "report-operations-title" }, "Операции месяца"));
      const filters = node("div", { class: "report-controls" });
      const type = field(filters, "reportType", "Тип операции", reportType, { options: [{ value: "all", label: "Доходы и расходы" }, { value: "income", label: "Доходы" }, { value: "expense", label: "Расходы" }] });
      type.addEventListener("change", () => { reportType = type.value; render(); });
      const category = field(filters, "reportCategory", "Категория операции", reportCategory, { options: [{ value: "", label: "Все категории" }].concat(state.categories.map(c => ({ value: c.id, label: c.name }))) });
      category.addEventListener("change", () => { reportCategory = category.value; render(); });
      main.append(filters, button("Сбросить фильтры операций", () => { reportType = "all"; reportCategory = ""; render(); }, "btn btn-secondary"));
      const ops = report.operations.filter(o => (reportType === "all" || o.type === reportType) && (!reportCategory || o.type === "expense" && o.categoryId === reportCategory));
      const incomeSources = new Map(state.incomes.map(s => [s.id, s])), expenseSources = new Map(state.expenses.map(s => [s.id, s]));
      main.append(ops.length ? node("div", { class: "record-list history-list" }, ops.map(o => recordCard((o.type === "income" ? incomeSources : expenseSources).get(o.sourceId), o.type))) : empty("По этим условиям ничего не найдено", "Измените фильтры или дополните историю."));
    }
  }
  function renderYearChart(main, report) {
    const section = node("section", { class: "panel year-chart" }, node("h2", {}, "Месяцы года"), node("div", { class: "chart-legend" }, node("span", { class: "protected-key" }, "Доходы"), node("span", { class: "cash-key" }, "Расходы")));
    const max = Math.max(1, ...report.months.flatMap(m => [m.income, m.expense]));
    for (const m of report.months) {
      const name = new Intl.DateTimeFormat("ru-RU", { month: "long", timeZone: "UTC" }).format(new Date(m.month + "-01T12:00:00Z"));
      const bars = node("div", { class: "year-bars", "aria-hidden": "true" }, node("div", { class: "year-bar income-bar", style: "width:" + m.income / max * 100 + "%" }), node("div", { class: "year-bar expense-bar", style: "width:" + m.expense / max * 100 + "%" }));
      section.append(node("div", { class: "year-row", "data-month": m.month },
        button(name, () => { reportMode = "month"; reportMonth = m.month; reportType = "all"; reportCategory = ""; render(); window.scrollTo(0, 0); }, "btn month-link"),
        node("div", {}, bars, node("div", { class: "year-values" }, node("span", {}, "Доходы " + amountText(m.income)), node("span", {}, "Расходы " + amountText(m.expense)), node("span", {}, "Разница " + amountText(m.difference))), node("p", { class: "help" }, STATUS_TEXT[m.status]))));
    }
    main.append(section);
  }
  function backupFilename() { const d = new Date(); return "planner-backup-" + todayLocal() + "-" + String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0") + ".json"; }
  function downloadText(raw, filename) {
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json;charset=utf-8" }));
    const link = node("a", { href: url, download: filename }); document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function exportDialog(exportState, raw, autoDownload) {
    let serialized;
    try { serialized = raw !== null ? raw : JSON.stringify(backupEnvelope(exportState, todayLocal()), null, 2); }
    catch (error) { showToast(error.message, null, true); return; }
    const area = node("textarea", { class: "backup-text", readOnly: true, "aria-label": "Текст резервной копии", spellcheck: "false" }); area.value = serialized;
    const info = node("p", { class: "help", role: "status" }, "Сохраните JSON. Если скачивание недоступно, скопируйте весь текст.");
    const save = () => { try { downloadText(serialized, backupFilename()); info.textContent = "Файл сформирован. Если браузер не сохранил его, используйте текст ниже."; } catch (_) { info.textContent = "Скачивание недоступно. Скопируйте весь текст ниже."; } };
    confirmation.replaceChildren(dialogHeading(raw !== null ? "Исходные данные" : "Резервная копия"), info, area,
      node("div", { class: "actions" }, button("Скачать JSON", save, "btn btn-primary"),
        button("Скопировать", async () => { try { assert(navigator.clipboard && navigator.clipboard.writeText, "Clipboard недоступен"); await navigator.clipboard.writeText(serialized); info.textContent = "Текст скопирован."; } catch (_) { area.focus(); area.select(); info.textContent = "Текст выделен. Скопируйте его вручную средствами браузера."; } }, "btn btn-secondary"),
        button("Закрыть копию", () => confirmation.close(), "btn btn-secondary")));
    confirmation.oncancel = () => { confirmation.oncancel = null; };
    confirmation.showModal(); if (autoDownload) save();
  }
  function replacementSummary(pack) {
    const s = pack.state, facts = s.operations.filter(o => o.status === "active"), dates = facts.map(o => o.date).sort();
    return node("section", { class: "import-summary" }, node("h3", {}, "Копия проверена"),
      node("p", {}, "Дата копии: " + new Date(pack.exportedAt).toLocaleString("ru-RU") + "."),
      node("p", {}, dates.length ? "История: " + dateText(dates[0], true) + " — " + dateText(dates[dates.length - 1], true) : "Фактической истории нет."),
      node("p", {}, "Доходов: " + s.incomes.length + " · расходов: " + s.expenses.length + " · активных фактов: " + facts.length + "."),
      node("p", {}, "Тема: " + (s.settings.theme === "ink-atlas" ? "Чернильный атлас" : "Бумага и баклажан") + "."),
      notice("Замена удалит текущие данные этого планировщика и восстановит всю копию. Автоматического объединения нет.", "warning"));
  }
  function applyReplacement(pack, expectedRaw) {
    const current = expectedRaw === null ? null : (() => { try { return JSON.parse(expectedRaw); } catch (_) { return null; } })();
    const revision = current && Number.isSafeInteger(current.revision) && current.revision >= 0 ? current.revision : 0;
    const prepared = prepareReplacement(pack.state, revision, todayLocal());
    backupWarning = replaceStored(storage, expectedRaw, prepared);
    state = prepared; recoveryMode = false; displayedPlan = null; budgetMessages = []; factReserveUsed = false; failedDraft = null; undoRecord = null; toast.hidden = true;
    currentView = "plan"; render();
  }
  function importDialog(prechecked) {
    let pending = prechecked || null, expectedRaw = null;
    openEditor("Восстановить из копии", (body, form) => {
      form.importCandidate = () => pending;
      form.addEventListener("planner-theme-change", event => { if (expectedRaw === event.detail.previousRaw) expectedRaw = event.detail.nextRaw; });
      body.append(notice("Выберите JSON или вставьте текст. Проверка не меняет данные; замена выполняется после подтверждения."));
      const file = field(body, "backupFile", "Файл резервной копии", null, { type: "file" }); file.accept = ".json,application/json";
      const area = field(body, "backupJson", "Или вставьте JSON", "", { multiline: true }); area.classList.add("backup-text"); area.spellcheck = false;
      const preview = node("div", { class: "import-preview" }); body.append(preview);
      let sourceVersion = 0;
      const invalidate = () => { sourceVersion++; pending = null; preview.replaceChildren(); form.querySelector('[type="submit"]').textContent = "Проверить копию"; };
      area.addEventListener("input", invalidate);
      file.addEventListener("change", async () => {
        invalidate(); area.value = ""; const selected = file.files[0], version = sourceVersion; if (!selected) return;
        try { assert(selected.size <= MAX_IMPORT_BYTES, "Файл должен быть не больше 5 MiB."); const text = await selected.text(); if (file.files[0] === selected && version === sourceVersion) area.value = text; }
        catch (error) { if (version === sourceVersion) formError(form, error); }
      });
      body.append(button("Скачать текущую копию", () => exportDialog(recoveryMode ? null : state, recoveryMode ? recoveryRaw : null, true), "btn btn-secondary"));
      if (prechecked) { expectedRaw = storage.getItem(KEY); preview.append(replacementSummary(prechecked)); }
    }, null, prechecked ? "Заменить данные" : "Проверить копию", async (values, form) => {
      const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
      try {
        if (!pending) {
          pending = parseBackup(values.backupJson, todayLocal()); expectedRaw = storage.getItem(KEY);
          form.querySelector(".import-preview").replaceChildren(replacementSummary(pending)); submit.textContent = "Заменить данные";
          return false;
        }
        if (!await confirmAction("Заменить все данные?", "Текущие записи будут заменены проверенной копией. Перед заменой можно скачать текущую копию.", "Заменить данные", true)) return false;
        applyReplacement(pending, expectedRaw); return "Копия восстановлена в этом браузере.";
      } catch (error) { formError(form, error); return false; }
      finally { submit.disabled = false; }
    });
  }
  function clearDialog() {
    let expected;
    try { expected = storage.getItem(KEY); } catch (error) { showToast("Очистка недоступна: " + error.message, null, true); return; }
    openEditor("Очистить данные", body => {
      body.append(notice("Сначала сохраните копию. Будут удалены только данные планировщика; данные других страниц сохранятся.", "warning"),
        button("Скачать копию перед очисткой", () => exportDialog(recoveryMode ? null : state, recoveryMode ? recoveryRaw : null, true), "btn btn-secondary"));
      field(body, "deleteWord", "Для удаления введите УДАЛИТЬ", "", { maxLength: 20 });
    }, null, "Очистить данные", (values, form) => {
      try {
        if (values.deleteWord !== "УДАЛИТЬ") fail("Введите слово УДАЛИТЬ точно, чтобы подтвердить очистку.", "deleteWord");
        clearStored(storage, expected); state = createState(todayLocal()); recoveryMode = false; currentView = "plan"; displayedPlan = null; failedDraft = null; undoRecord = null; toast.hidden = true; backupWarning = false; render();
        return "Данные планировщика удалены.";
      } catch (error) { formError(form, error); return false; }
    });
    editor.querySelector("form").addEventListener("planner-theme-change", event => { if (expected === event.detail.previousRaw) expected = event.detail.nextRaw; });
  }
  async function refreshStored() {
    const wizard = app.querySelector("[data-wizard-step]"), wizardChanged = wizard && JSON.stringify(collect(wizard)) !== wizardInitial;
    if ((editor.open && editorDirty || wizardChanged) && !await confirmAction("Обновить экран?", "Несохранённые изменения формы будут потеряны. Их можно предварительно скачать отдельной копией.", "Обновить экран", true)) return;
    try {
      saving = true; const raw = storage.getItem(KEY);
      const next = raw === null ? createState(todayLocal()) : normalizeState(JSON.parse(raw), todayLocal());
      state = next; recoveryMode = false; editorDirty = false; if (editor.open) editor.close(); failedDraft = null; undoRecord = null; render();
    } catch (error) { showToast(error.message, null, true); }
    finally { saving = false; serviceDate(); }
  }
  function exportUnsavedForm(form) {
    try {
      const jsonInput = form.elements.namedItem("backupJson");
      if (jsonInput) {
        if (jsonInput.value.trim()) exportDialog(null, jsonInput.value, true);
        else exportDialog(form.importCandidate?.()?.state || state, null, true);
        return;
      }
      const draft = clone(state), values = collect(form), today = todayLocal();
      if (form.hasAttribute("data-editor-form") && editorSaveChange) editorSaveChange(draft, values);
      else {
        const step = Number(form.getAttribute("data-wizard-step"));
        if (step === 1) correctBalance(draft, parseMoney(values.amount, { signed: true, field: "amount" }), today, "Начальный остаток");
        if (step === 2) saveRules(draft, values, today, true);
        if (step === 3) saveBudgets(draft, values, today);
      }
      exportDialog(normalizeState(draft, today), null, true);
    } catch (error) { formError(form, error); }
  }
  function templateCard(template) {
    const sub = node("div", { class: "record-sub" }, node("span", {}, "до " + template.dueDay + "-го"), node("span", {}, categoryName(template.categoryId)),
      chip(template.archived ? "В архиве" : template.active ? "Каждый месяц" : "Отключён", template.active ? "plum" : "warning"),
      node("span", {}, template.mandatory ? "Задолженность сохраняется" : template.rolloverPolicy === "skip" ? "Неоплаченное пропускается" : "Неоплаченное переносится"));
    const controls = node("div", { class: "record-controls" });
    if (template.archived) controls.append(iconButton("restore", "Восстановить статью: " + template.title, () => {
      if (commit(draft => toggleTemplate(draft, template.id, "restore", todayLocal()))) showToast("Статья восстановлена.");
    }));
    else {
      controls.append(iconButton(template.active ? "pause" : "play", (template.active ? "Отключить статью: " : "Включить статью: ") + template.title, () => {
        if (commit(draft => toggleTemplate(draft, template.id, "toggle", todayLocal()))) showToast(template.active ? "Статья отключена. Текущие расходы сохранены." : "Статья включена.");
      }));
      controls.append(iconButton("edit", "Изменить статью: " + template.title, () => templateForm(template.id)));
      controls.append(iconButton("archive", "Архивировать статью: " + template.title, async () => {
        if (await confirmAction("Архивировать статью?", "Новые экземпляры создаваться не будут. Существующие расходы и история останутся.", "Архивировать", false)) {
          if (commit(draft => toggleTemplate(draft, template.id, "archive", todayLocal()))) showToast("Статья в архиве.");
        }
      }));
    }
    return node("article", { class: "record", "data-template-id": template.id },
      node("div", { class: "record-mark" }, icon("calendar")), node("div", { class: "record-copy" }, node("div", { class: "record-title" }, template.title), sub),
      node("div", { class: "record-right" }, node("div", { class: "record-amount" }, amountText(template.amount)), controls));
  }
  function renderRegular(main) {
    main.append(pageHeader("Регулярные расходы", "Один раз настройте статьи — у каждого месяца будет свой платёж."));
    main.append(node("div", { class: "section-header" }, node("h2", {}, "Ваши статьи"), node("button", { type: "button", class: "btn btn-primary", onclick: () => templateForm() }, icon("plus"), "Добавить статью")));
    const active = state.expenseTemplates.filter(t => !t.archived), archived = state.expenseTemplates.filter(t => t.archived);
    main.append(active.length ? node("div", { class: "record-list" }, active.map(templateCard)) : empty("Начните с постоянных оплат", "Ипотека, коммунальные услуги, связь, школа или кружки. Суммы и сроки задаёте вы."));
    if (archived.length) main.append(detailsGroup("Архив · " + archived.length, archived.map(templateCard), "archive-templates"));
    main.append(notice("Изменение шаблона относится к будущим экземплярам. Чтобы поменять этот месяц, используйте отдельную отметку в форме.", "neutral"));
  }
  function settingRow(title, value, action, actionName) {
    return node("div", { class: "setting-row" }, node("div", {}, node("strong", {}, title), node("span", { class: "muted" }, value)), action ? iconButton("edit", actionName || "Изменить " + title, action) : null);
  }
  function renderSettings(main) {
    main.append(pageHeader("Настройки", "Ваши суммы, привычные поступления и категории."));
    const grid = node("div", { class: "settings-grid" });
    const balancePanel = node("section", { class: "panel" }, node("h2", {}, "Деньги сейчас"), node("p", { class: "help" }, "Уточнение суммы не становится доходом и не удаляет историю."),
      settingRow("Текущий остаток", amountText(actualBalance(state)), balanceForm, "Уточнить остаток"),
      settingRow("Введённая сумма", amountText(state.balanceAnchor.amount) + " · " + dateText(state.balanceAnchor.date), null));
    const incomePanel = node("section", { class: "panel" }, node("div", { class: "section-header" }, node("h2", {}, "Регулярные доходы"), iconButton("edit", "Настроить регулярные доходы", rulesForm)));
    for (const rule of state.incomeRules) incomePanel.append(settingRow(rule.title, rule.active ? amountText(rule.amount) + " · " + rule.day + "-го числа" : "Не учитывается", null));
    grid.append(balancePanel, incomePanel);
    const budget = state.lifeBudgetOverrides.find(b => b.periodKey === currentPeriod(state, todayLocal()).key);
    const budgetPanel = node("section", { class: "panel" }, node("div", { class: "section-header" }, node("h2", {}, "На жизнь и в запас"), iconButton("edit", "Настроить бюджет и резерв", budgetsForm)),
      node("p", { class: "help" }, "Сохранённые суммы для периодов между поступлениями."),
      settingRow("После зарплаты", amountText(state.settings.lifeAfterSalary), null),
      settingRow("После аванса", amountText(state.settings.lifeAfterAdvance), null),
      settingRow("Точка оставшегося бюджета", amountText(budget ? budget.amount : 0) + (budget ? " · " + dateText(budget.coverageStartDate) : ""), null),
      settingRow("Желаемый резерв", amountText(state.settings.reserveTarget), null));
    grid.append(budgetPanel);
    const storagePanel = node("section", { class: "panel" }, node("h2", {}, "Только в этом браузере"), node("p", { class: "help" }, "Записи сохраняются на вашем устройстве. Ожидаемые суммы не меняют фактический остаток."),
      node("p", { class: "help" }, "Используйте тот же браузер и папку. Очистка данных браузера может удалить записи."),
      node("div", { class: "setting-row" }, node("div", {}, node("strong", {}, "Оформление"), node("span", { class: "muted", "data-theme-name": "" }, THEME_NAMES[state.settings.theme])), themeButton()));
    const backupPanel = node("section", { class: "panel" }, node("h2", {}, "Резервная копия"), node("p", { class: "help" }, "Сохраняйте копию перед переносом файлов или очисткой браузера."),
      node("div", { class: "backup-actions" }, button("Скачать резервную копию", () => exportDialog(state, null, true), "btn btn-primary"), button("Показать JSON копии", () => exportDialog(state, null, false), "btn btn-secondary"), button("Восстановить из копии", () => importDialog(), "btn btn-secondary"), button("Очистить данные", clearDialog, "btn btn-danger")));
    grid.append(storagePanel, backupPanel, node("section", { class: "panel", "data-pwa-panel": "" })); main.append(grid);
    const categoriesPanel = node("section", { class: "panel", style: "margin-top:20px" }, node("div", { class: "section-header" }, node("h2", {}, "Категории"), button("Добавить", () => categoryForm(), "btn btn-secondary", "Добавить категорию")));
    const categoryList = node("div", { class: "category-list" });
    for (const cat of state.categories) {
      const row = node("div", { class: "category-row" + (cat.active ? "" : " archived"), "data-category-id": cat.id }, node("span", {}, cat.name, !cat.active ? " · архив" : ""),
        iconButton("edit", "Переименовать категорию: " + cat.name, () => categoryForm(cat.id)));
      if (cat.systemKey !== "other") row.append(iconButton(cat.active ? "archive" : "restore", (cat.active ? "Архивировать категорию: " : "Восстановить категорию: ") + cat.name, async () => {
        if (cat.active && !await confirmAction("Архивировать категорию?", "Категория останется в существующих статьях и истории, но не будет предлагаться для новых записей.", "Архивировать", false)) return;
        if (commit(draft => toggleCategory(draft, cat.id))) showToast(cat.active ? "Категория архивирована." : "Категория восстановлена.");
      }));
      categoryList.append(row);
    }
    categoriesPanel.append(categoryList); main.append(categoriesPanel);
  }
  function wizardBack(form) {
    (async () => {
      if (form && JSON.stringify(collect(form)) !== wizardInitial && !await confirmAction("Не сохранять изменения?", "Настройки этого шага не будут изменены.", "Не сохранять", true)) return;
      commit(draft => { draft.onboarding.step = Math.max(1, draft.onboarding.step - 1); });
    })();
  }
  function renderWizard(main) {
    const step = state.onboarding.step, layout = node("div", { class: "wizard-layout" });
    layout.append(node("div", { class: "wizard-intro" },
      node("p", { class: "eyebrow" }, "Личный финансовый журнал"),
      node("h1", {}, "Больше ясности.", node("br"), "Меньше суеты."),
      node("p", {}, "Начнём с денег, которые есть сейчас, и ваших обычных оплат. Настройки можно будет изменить."),
      node("div", { class: "intro-card" }, node("div", { class: "intro-number" }, "Ваш месяц. Ваш ритм."), node("p", {}, "Зарплата, аванс и повседневные расходы в одном месте."))));
    const panel = node("section", { class: "wizard-panel" });
    const steps = node("div", { class: "steps", "aria-label": "Шаг " + step + " из 5" });
    for (let i = 1; i <= 5; i++) { if (i > 1) steps.append(node("span", { class: "step-line", "aria-hidden": "true" })); steps.append(node("span", { class: "step-dot" + (i === step ? " current" : i < step ? " finished" : ""), "aria-current": i === step ? "step" : null }, i < step ? "✓" : i)); }
    panel.append(steps);
    const titles = ["", "Сколько денег сейчас?", "Когда приходят деньги?", "Оставим на повседневное", "Ваши постоянные оплаты", "Всё готово к началу"];
    const descriptions = ["", "Введите сумму всех доступных денег на сегодня. Это остаток, а не месячный доход.", "Укажите суммы отдельно. Если поступления нет, снимите отметку. Выходные учтём автоматически.", "Суммы задаются на период между доходами. Ноль допустим — настройки можно уточнить позже.", "Добавьте регулярные статьи с суммами и сроками. Можно пропустить и вернуться позже.", "Проверьте настройки. Реальные операции появятся после ваших отметок."];
    panel.append(node("h2", {}, titles[step]), node("p", {}, descriptions[step]));
    const form = node("form", { novalidate: true, "data-wizard-step": step }), body = node("div", {}, node("div", { class: "form-error", role: "alert" })); form.append(body);
    if (step === 1) field(body, "amount", "Остаток на сегодня, ₽", amountInput(state.balanceAnchor ? state.balanceAnchor.amount : null), { money: true, help: "Можно указать 0 или отрицательную сумму." });
    if (step === 2) rulesFields(body);
    if (step === 3) budgetFields(body);
    if (step === 4) {
      body.append(node("button", { type: "button", class: "btn btn-secondary", onclick: () => templateForm() }, icon("plus"), "Добавить статью"));
      const items = state.expenseTemplates.filter(t => !t.archived);
      if (items.length) body.append(node("div", { class: "record-list", style: "margin-top:16px" }, items.map(templateCard)));
      else body.append(node("p", { class: "help", style: "margin-top:17px" }, "Например: ипотека, коммунальные услуги, школа, кружки, телефон."));
    }
    if (step === 5) {
      body.append(settingRow("Начальный остаток", amountText(state.balanceAnchor.amount), null));
      for (const rule of state.incomeRules) body.append(settingRow(rule.title, rule.active ? amountText(rule.amount) + " · " + rule.day + "-го" : "Не учитывается", null));
      body.append(settingRow("Регулярные статьи", String(state.expenseTemplates.filter(t => t.active).length), null), settingRow("Желаемый резерв", amountText(state.settings.reserveTarget), null));
    }
    const actions = node("div", { class: "wizard-actions" });
    if (step > 1) actions.append(button("Назад", () => wizardBack(form), "btn btn-ghost"));
    actions.append(node("button", { type: "submit", class: "btn btn-primary" }, step === 5 ? "Начать планирование" : step === 4 && !state.expenseTemplates.length ? "Пока пропустить" : "Продолжить"));
    form.append(actions);
    form.addEventListener("submit", event => {
      event.preventDefault(); clearFormErrors(form); const values = collect(form);
      commit(draft => {
        const today = todayLocal();
        if (step === 1) correctBalance(draft, parseMoney(values.amount, { signed: true, field: "amount" }), today, "Начальный остаток");
        if (step === 2) saveRules(draft, values, today, true);
        if (step === 3) saveBudgets(draft, values, today);
        if (step === 5) { draft.onboarding.completed = true; generateCurrent(draft, today); if (!draft.monthCoverage[monthOf(today)]) draft.monthCoverage[monthOf(today)] = "partial"; }
        else draft.onboarding.step = step + 1;
      }, form);
    });
    panel.append(form, button("Восстановить из копии", () => importDialog(), "btn btn-secondary wizard-import")); layout.append(panel); main.append(layout);
    wizardInitial = JSON.stringify(collect(form));
  }
  function render() {
    if (recoveryMode) { fatal(recoveryMessage, recoveryRaw); return; }
    applyTheme();
    const wrap = node("div", { class: "wrap" }, topbar()), main = node("main", { id: "main-content" }); wrap.append(main);
    if (backupWarning) main.append(notice("Основные данные сохранены. Предыдущая внутренняя копия не обновилась: браузер не разрешил её запись.", "warning"));
    if (!state.onboarding.completed) {
      renderWizard(main);
      main.append(node("section", { class: "panel", "data-pwa-panel": "" }));
    }
    else {
      if (currentView === "plan") renderPlan(main);
      if (currentView === "reports") renderReports(main);
      if (currentView === "regular") renderRegular(main);
      if (currentView === "settings") renderSettings(main);
      const nav = node("nav", { class: "nav", "aria-label": "Разделы" });
      for (const [key, name, symbol] of [["plan", "План", "wallet"], ["reports", "Итоги", "list"], ["regular", "Регулярные", "calendar"], ["settings", "Настройки", "settings"]]) nav.append(node("button", {
        type: "button", class: "nav-btn" + (currentView === key ? " active" : ""), "aria-current": currentView === key ? "page" : null,
        onclick: () => { currentView = key; render(); window.scrollTo({ top: 0, behavior: "instant" }); }
      }, icon(symbol), name));
      wrap.append(nav);
    }
    app.replaceChildren(wrap);
    document.dispatchEvent(new Event("planner-view-change"));
  }
  function fatal(message, raw) {
    recoveryMode = true; recoveryMessage = message; recoveryRaw = raw;
    document.getElementById("boot-message").hidden = true;
    const wrap = node("div", { class: "wrap" }, topbar()), main = node("main", { class: "panel fatal" });
    main.append(node("p", { class: "eyebrow" }, "Данные не изменены"), node("h1", {}, "Не удалось открыть журнал"), notice(message, "danger"),
      node("p", { class: "help" }, "Редактирование заблокировано, чтобы не потерять записи. Проверьте настройки хранения и способ локального открытия файла."));
    if (raw != null) {
      const area = node("textarea", { readOnly: true, "aria-label": "Исходные сохранённые данные" }); area.value = raw;
      main.append(node("p", { class: "help" }, "Исходный текст можно выделить и скопировать. Автоматической очистки нет."), area);
      main.append(button("Скачать исходные данные", () => exportDialog(null, raw, true), "btn btn-secondary"));
    }
    let internal = null;
    try { const previous = storage.getItem(BACKUP_KEY); if (previous !== null) internal = normalizeState(JSON.parse(previous), todayLocal()); } catch (_) { /* A corrupt previous copy is never offered as valid. */ }
    if (internal) main.append(button("Восстановить внутреннюю копию", () => importDialog({ exportedAt: internal.updatedAt, state: internal }), "btn btn-primary"));
    main.append(button("Восстановить из копии", () => importDialog(), "btn btn-secondary"), button("Очистить данные", clearDialog, "btn btn-danger"));
    main.append(button("Повторить загрузку", () => window.location.reload(), "btn btn-secondary")); wrap.append(main); app.replaceChildren(wrap);
  }
  function boot() {
    let raw = null;
    try {
      storage = window.localStorage;
      const probe = KEY + ".probe-" + Date.now(); storage.setItem(probe, "ok"); assert(storage.getItem(probe) === "ok", "Браузер не сохраняет записи."); storage.removeItem(probe);
      raw = storage.getItem(KEY); state = raw === null ? createState(todayLocal()) : normalizeState(JSON.parse(raw), todayLocal()); recoveryMode = false;
      document.getElementById("boot-message").hidden = true;
      if (state.onboarding.completed) {
        const draft = clone(state); generateCurrent(draft, todayLocal());
        if (JSON.stringify(draft) !== JSON.stringify(state)) { if (!commit(next => generateCurrent(next, todayLocal()))) return; }
      }
      render();
    } catch (error) { if (raw === null) { try { raw = storage.getItem(KEY); } catch (_) { /* Storage may also deny reads. */ } } fatal(error.message || "localStorage недоступен в этом браузере.", raw); }
  }
  window.addEventListener("storage", event => {
    if (event.key !== KEY || saving) return;
    const wizard = app.querySelector("[data-wizard-step]");
    const wizardChanged = wizard && JSON.stringify(collect(wizard)) !== wizardInitial;
    if (editor.open && editorDirty || wizardChanged) {
      const form = editor.open ? editor.querySelector("form") : wizard;
      formError(form, new Error("Данные изменились в другой вкладке. Введённые значения сохранены на экране."));
      form.querySelector(".save-recovery")?.remove();
      const actions = node("div", { class: "save-recovery actions" });
      actions.append(button("Скачать текущий несохранённый вариант", () => exportUnsavedForm(form), "btn btn-secondary"), button("Обновить из другой вкладки", refreshStored, "btn btn-secondary"));
      form.querySelector(".form-error").after(actions);
      return;
    }
    try {
      const raw = storage.getItem(KEY);
      if (raw === null) { fatal("Сохранённые данные были удалены в другой вкладке.", null); return; }
      state = normalizeState(JSON.parse(raw), todayLocal()); recoveryMode = false; if (editor.open) editor.close(); render(); serviceDate();
    } catch (error) { fatal(error.message, storage.getItem(KEY)); }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") serviceDate();
  });
  function serviceDate() {
    if (!state || recoveryMode || !state.onboarding.completed || editor.open || saving || document.visibilityState !== "visible") return;
    if (state.lastProcessedDate !== todayLocal()) commit(draft => generateCurrent(draft, todayLocal()));
  }
  window.setInterval(serviceDate, 60000);
  boot();
})();
