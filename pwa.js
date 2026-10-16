"use strict";
(() => {
  let registration = null, installPrompt = null, ready = false, checking = false, failure = "", updateReady = false, updateMessage = "";
  const supported = window.isSecureContext && /^(https?:)$/.test(location.protocol) && "serviceWorker" in navigator;
  const installed = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  function element(tag, text, classes) {
    const item = document.createElement(tag); if (text) item.textContent = text; if (classes) item.className = classes; return item;
  }
  function render() {
    for (const panel of document.querySelectorAll("[data-pwa-panel]")) {
      panel.replaceChildren(element("h2", "Приложение на телефоне"));
      const status = element("p", !supported ? "Для установки и работы без интернета откройте планировщик по HTTPS-ссылке." :
        failure || (ready ? "Готово к работе без интернета" : "Подготавливаем приложение для работы без интернета…"), "help");
      status.setAttribute("role", "status"); panel.append(status);
      if (updateMessage) panel.append(element("p", updateMessage, "help"));
      if (supported) {
        panel.append(element("p", installed() ? "Приложение установлено. Запускайте его значком с главного экрана." :
          "В Chrome откройте меню ⋮ → «Добавить на главный экран» или «Установить приложение». Если доступна кнопка ниже, можно установить сразу.", "help"));
        if (installPrompt && !installed()) {
          const install = element("button", "Установить приложение", "btn btn-primary"); install.type = "button";
          install.addEventListener("click", async () => {
            const prompt = installPrompt; if (!prompt) return;
            installPrompt = null; install.disabled = true;
            try { await prompt.prompt(); await prompt.userChoice; }
            catch (_) { /* The browser menu remains available if the prompt is dismissed or rejected. */ }
            render();
          }); panel.append(install);
        }
        if (updateReady) panel.append(element("p", "Обновление готово. Сохраните изменения и закройте все окна планировщика. При следующем запуске откроется новая версия.", "notice neutral"));
        const check = element("button", checking ? "Проверяем…" : ready ? "Проверить обновления" : "Подготовить офлайн-версию", "btn btn-secondary");
        check.type = "button"; check.disabled = checking;
        check.addEventListener("click", async () => {
          checking = true; failure = ""; updateMessage = ""; render();
          try {
            if (healthCheck) await healthCheck;
            // Refresh a registration object that Chrome may have replaced since launch.
            registration = await navigator.serviceWorker.getRegistration("./") || registration;
            if (!registration || !registration.active) await register();
            await navigator.serviceWorker.ready;
            const repair = await askWorker("planner-offline-repair");
            ready = repair.complete === true;
            const published = await publishedVersion();
            if (ready && repair.version === published) {
              updateMessage = "Установлена актуальная версия.";
            } else {
              try { await registration.update(); }
              catch (_) {
                // Retry through the browser's registration API rather than a stale object.
                const workerURL = new URL("./sw.js", location.href); workerURL.searchParams.set("release", published);
                registration = await navigator.serviceWorker.register(workerURL.href, { scope: "./", updateViaCache: "none" });
                watch(registration.installing);
              }
              await waitForUpdate(registration);
              updateReady = !!registration.waiting;
              if (!updateReady) {
                const current = await askWorker("planner-offline-check");
                if (current.version !== published || !current.complete) throw new Error("update-incomplete");
                ready = true; updateMessage = "Установлена актуальная версия.";
              } else if (!ready) {
                failure = "Новая версия готова. Сохраните поля, закройте все окна планировщика и откройте его с сетью для подготовки офлайн-файлов.";
              }
            }
          }
          catch (error) {
            if (error.message === "site-access") failure = "Для обновления нужен вход на сайт. Откройте ссылку планировщика в Chrome, войдите в свой аккаунт и повторите проверку.";
            else failure = ready ? "Не удалось получить сведения или файлы обновления. Проверьте подключение и повторите проверку. Сохранённая версия доступна без интернета." :
              "Не удалось подготовить офлайн-файлы. Подключитесь к интернету и повторите подготовку.";
          }
          finally { checking = false; render(); }
        }); panel.append(check);
      }
      panel.append(element("p", "Доходы и расходы хранятся только в этом браузере. При переходе с другой ссылки или локального файла перенесите записи через JSON-копию. Сохраняйте копию перед очисткой данных браузера.", "help"));
    }
  }
  async function publishedVersion() {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch(new URL("./sw.js", location.href), { cache: "no-store", credentials: "same-origin", redirect: "error", signal: abort.signal });
      if (response.status === 401 || response.status === 403) throw new Error("site-access");
      if (!response.ok) throw new Error("site-unavailable");
      if (!/(?:javascript|ecmascript)/i.test(response.headers.get("content-type") || "")) throw new Error("site-access");
      const match = (await response.text()).match(/const VERSION\s*=\s*"([^"]+)";/);
      if (!match) throw new Error("invalid-version");
      return match[1];
    } finally { clearTimeout(timer); }
  }
  function waitForUpdate(reg) {
    const worker = reg.installing || reg.waiting;
    if (!worker || worker.state === "installed" || worker.state === "activated") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("update-timeout")), 20000);
      function finish(error) { clearTimeout(timer); worker.removeEventListener("statechange", changed); error ? reject(error) : resolve(); }
      function changed() {
        if (worker.state === "installed" || worker.state === "activated") finish();
        else if (worker.state === "redundant") finish(new Error("update-incomplete"));
      }
      worker.addEventListener("statechange", changed); changed();
    });
  }
  let healthCheck = null;
  function askWorker(type) {
    return new Promise((resolve, reject) => {
      const worker = navigator.serviceWorker.controller || (registration && registration.active);
      if (!worker) { reject(new Error("No active worker")); return; }
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error("Offline check timeout")); }, type === "planner-offline-repair" ? 20000 : 5000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
      worker.postMessage({ type: type }, [channel.port2]);
    });
  }
  async function verifyOffline() {
    if (!supported || checking || !registration || !registration.active) return healthCheck;
    if (!healthCheck) healthCheck = (async () => {
      try {
        const result = await askWorker("planner-offline-check");
        ready = result.complete === true;
        failure = ready ? "" : "Офлайн-файлы сохранены не полностью. Подключитесь к интернету и нажмите «Подготовить офлайн-версию».";
      } catch (_) { ready = false; failure = "Не удалось подтвердить готовность без интернета. Подключитесь к сети и повторите подготовку."; }
      finally { healthCheck = null; render(); }
    })();
    return healthCheck;
  }
  function watch(worker) {
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && registration.active) updateReady = true;
      if (worker.state === "redundant" && !ready) failure = "Не удалось подготовить офлайн-версию. Подключитесь к интернету и повторите проверку.";
      render();
    });
  }
  async function register() {
    const existing = await navigator.serviceWorker.getRegistration("./");
    const workerURL = existing && existing.active ? existing.active.scriptURL : "./sw.js";
    registration = await navigator.serviceWorker.register(workerURL, { scope: "./", updateViaCache: "none" });
    updateReady = !!registration.waiting; watch(registration.installing);
    registration.addEventListener("updatefound", () => watch(registration.installing));
    navigator.serviceWorker.ready.then(() => verifyOffline());
    render();
  }
  window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); installPrompt = event; render(); });
  window.addEventListener("appinstalled", () => { installPrompt = null; render(); });
  window.matchMedia("(display-mode: standalone)").addEventListener("change", render);
  document.addEventListener("planner-view-change", () => { render(); if (!checking) verifyOffline(); });
  navigator.serviceWorker && navigator.serviceWorker.addEventListener("controllerchange", () => verifyOffline());
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !checking) verifyOffline(); });
  render();
  if (supported) register().catch(() => { failure = "Не удалось подготовить офлайн-версию. Подключитесь к интернету и повторите проверку."; render(); });
})();
