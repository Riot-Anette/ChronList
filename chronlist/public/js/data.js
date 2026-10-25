"use strict";
(() => {
  const LEGACY = "chronlist.tasks.v1";
  let mode = "loading", owner = null;
  function status(message) { document.querySelector("#sync-status").textContent = message; }
  function guestTasks() {
    const value = JSON.parse(localStorage.getItem(LEGACY) || "[]");
    if (!Array.isArray(value)) throw new Error("Your browser tasks are unreadable. Do not clear browser storage.");
    return value.filter(t => t && typeof t.id === "string" && typeof t.title === "string").map(t => ({ ...t, notes: t.notes || "", date: t.date || "", time: t.time || "", priority: ["high", "normal", "low"].includes(t.priority) ? t.priority : "normal", completedAt: t.completedAt || null, createdAt: t.createdAt || new Date().toISOString() }));
  }
  function endpoint() {
    const base = window.CHRONLIST_CONFIG.apiBaseUrl;
    if (!base) throw new Error("Cloud setup is incomplete. The owner must connect the AWS API. Guest tasks are unchanged.");
    if (new URL(base).protocol !== "https:") throw new Error("The API URL must use HTTPS.");
    return base.replace(/\/$/, "");
  }
  async function request(path, options = {}) {
    const session = window.ChronListAuth.getSession();
    if (!session || session.user.id !== owner) throw new Error("Sign in again before accessing cloud tasks.");
    const response = await fetch(endpoint() + path, { ...options, signal: AbortSignal.timeout(15000), cache: "no-store", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessToken}` } });
    if (response.status === 401 || response.status === 403) { window.ChronListAuth.expire(); throw new Error("Your session ended. Sign in again."); }
    const body = response.status === 204 ? null : await response.json();
    if (!response.ok) {
      const error = new Error(response.status === 409 ? "This task changed on another device. Sync, then review your edit before saving again." : body?.error || "Cloud request failed. Try again.");
      error.status = response.status; throw error;
    }
    if (!owner || window.ChronListAuth.getSession()?.user.id !== owner) throw new Error("Your session changed. Sign in again.");
    return body;
  }
  async function listCloud() {
    const all = []; let cursor = "";
    do { const page = await request("/tasks" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : "")); all.push(...page.tasks); cursor = page.nextCursor || ""; } while (cursor);
    status("Cloud connected · syncs every 30 seconds while open");
    return all.map(withReceipt);
  }
  function receiptKey() { return "chronlist.reminders.v2." + (owner || "guest"); }
  function receipt(task) { return [task.id, task.date, task.time, task.reminder].join("|"); }
  function withReceipt(task) {
    let receipts = {}; try { receipts = JSON.parse(localStorage.getItem(receiptKey()) || "{}"); } catch { /* empty */ }
    return { ...task, alarmed: Boolean(receipts[receipt(task)]) };
  }
  function recordReminder(task) {
    try {
      const receipts = JSON.parse(localStorage.getItem(receiptKey()) || "{}"); receipts[receipt(task)] = Date.now();
      localStorage.setItem(receiptKey(), JSON.stringify(Object.fromEntries(Object.entries(receipts).sort((a,b) => b[1] - a[1]).slice(0, 2000))));
    } catch { status("Reminder state could not be saved on this device."); }
  }
  window.ChronListData = {
    get mode() { return mode; },
    async initialize() {
      await window.ChronListAuth.ready;
      const session = window.ChronListAuth.getSession();
      if (session) { document.querySelector("#account-status").textContent = `Signed in as ${session.user.email || "your account"}. Guest tasks stay separate.`; owner = session.user.id; mode = "cloud"; status("Connecting to your cloud tasks…"); return listCloud(); }
      owner = null; mode = "guest"; status("Guest mode · saved only in this browser"); return guestTasks().map(withReceipt);
    },
    async list() { return mode === "cloud" ? listCloud() : mode === "guest" ? guestTasks().map(withReceipt) : []; },
    async put(task, currentTasks) {
      if (mode === "cloud") {
        const saved = await request("/tasks/" + encodeURIComponent(task.id), { method: "PUT", body: JSON.stringify({ task, expectedVersion: task.version || 0 }) });
        status("Saved to cloud"); return withReceipt(saved.task);
      }
      if (mode !== "guest") throw new Error("Tasks are not ready yet.");
      const next = currentTasks.some(t => t.id === task.id) ? currentTasks.map(t => t.id === task.id ? task : t) : [...currentTasks, task];
      localStorage.setItem(LEGACY, JSON.stringify(next)); return task;
    },
    async remove(task, currentTasks) {
      if (mode === "cloud") await request("/tasks/" + encodeURIComponent(task.id), { method: "DELETE", body: JSON.stringify({ expectedVersion: task.version }) });
      else if (mode === "guest") localStorage.setItem(LEGACY, JSON.stringify(currentTasks.filter(t => t.id !== task.id)));
      else throw new Error("Tasks are not ready yet.");
    },
    validateBackup(value) {
      if (!value || value.format !== "chronlist-backup-v1" || !Array.isArray(value.tasks) || value.tasks.length > 1000) throw new Error("Choose a ChronList backup with at most 1,000 tasks.");
      return value.tasks.map(task => {
        if (!task || typeof task.title !== "string" || !task.title.trim() || task.title.length > 120 || typeof task.notes !== "string" || task.notes.length > 4000) throw new Error("The backup contains an invalid name or notes field.");
        if (typeof task.date !== "string" || (task.date && !/^\d{4}-\d{2}-\d{2}$/.test(task.date)) || typeof task.time !== "string" || (task.time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(task.time))) throw new Error("The backup contains an invalid date or time.");
        if (task.date && (Number.isNaN(Date.parse(task.date + "T12:00:00Z")) || new Date(task.date + "T12:00:00Z").toISOString().slice(0,10) !== task.date)) throw new Error("The backup contains an invalid date.");
        if (task.time && !task.date) throw new Error("A task time needs a date.");
        if (!["high", "normal", "low"].includes(task.priority) || typeof task.completed !== "boolean" || typeof task.reminder !== "boolean") throw new Error("The backup contains invalid task settings.");
        if (task.reminder && (!task.date || !task.time)) throw new Error("A reminder needs a date and time.");
        if (task.completedAt != null && (typeof task.completedAt !== "string" || !Number.isFinite(Date.parse(task.completedAt)))) throw new Error("The backup contains an invalid completion timestamp.");
        return { title: task.title.trim(), notes: task.notes, date: task.date, time: task.time, priority: task.priority, completed: task.completed, reminder: task.reminder, completedAt: task.completed ? task.completedAt || null : null };
      });
    },
    async importGuest() {
      if (mode !== "cloud") throw new Error("Sign in and connect cloud storage first.");
      let imported = 0, skipped = 0;
      for (const task of guestTasks()) {
        try { await request("/tasks/" + encodeURIComponent(task.id), { method: "PUT", body: JSON.stringify({ task, expectedVersion: 0 }) }); imported++; }
        catch (error) { if (error.status === 409) skipped++; else throw new Error(`Imported ${imported} tasks before stopping. ${error.message} Browser originals are unchanged; retry to continue.`); }
      }
      return { imported, skipped };
    },
    lock() { mode = "locked"; owner = null; }, recordReminder
  };
})();
