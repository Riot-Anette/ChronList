"use strict";

function newTaskId() {
  return crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
}
const STORAGE_KEY = "chronlist.tasks.v1";
const SOUND_STORAGE_KEY = "chronlist.soundEnabled.v1";
const REMINDER_CHECK_INTERVAL = 15000;
const FILTER_TITLES = {
  all: "All tasks",
  today: "Today",
  upcoming: "Upcoming",
  weekly: "Weekly plan",
  monthly: "Monthly plan",
  completed: "Completed",
};

const taskList = document.querySelector("#task-list");
const taskDialog = document.querySelector("#task-dialog");
const taskForm = document.querySelector("#task-form");
const searchInput = document.querySelector("#search-input");
const alarmOverlay = document.querySelector("#alarm-overlay");
let activeFilter = "all";
let weekStart = startOfWeek(new Date());
let monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
let editingTaskId = null;
let sortByDueDate = true;
let alarmAudioContext = null;
let ringingOscillators = [];
let alarmSequenceTimeout = null;
let reminderQueue = [];
let reminderQueueTotal = 0;
let soundEnabled = loadSoundPreference();

let tasks = [];
let dataReady = false;
let busy = false;

function showDataError(error) {
  document.querySelector("#sync-status").textContent = error.message || "Could not save. Check your connection and try again.";
  showToast(error.message || "Could not save changes.");
}

async function mutate(action) {
  if (busy || !dataReady) return false;
  busy = true;
  taskList.setAttribute("aria-busy", "true");
  document.querySelector("#save-task-button").disabled = true;
  try { await action(); return true; }
  catch (error) { showDataError(error); return false; }
  finally { busy = false; taskList.removeAttribute("aria-busy"); document.querySelector("#save-task-button").disabled = false; render(); }
}

function loadSoundPreference() {
  try {
    return localStorage.getItem(SOUND_STORAGE_KEY) === "true";
  } catch (error) {
    console.error("Could not load the ChronList sound preference.", error);
    return false;
  }
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function shiftWeek(amount) {
  weekStart.setDate(weekStart.getDate() + amount * 7);
  render();
}

function shiftMonth(amount) {
  monthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() + amount, 1, 12);
  render();
}

function formatWeekRange(start, end) {
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startText = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endText = end.toLocaleDateString(undefined, {
    month: sameMonth ? undefined : "short",
    day: "numeric",
    year: start.getFullYear() === end.getFullYear() ? undefined : "numeric",
  });
  return `${startText} – ${endText}`;
}

function formatDate(dateString) {
  if (!dateString) return "";
  const date = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  if (dateString === localDateKey()) return "Today";
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dateString === localDateKey(tomorrow)) return "Tomorrow";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTime(timeString) {
  if (!timeString) return "";
  const [hours, minutes] = timeString.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return timeString;
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatCompletionTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return `Completed ${date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function taskDateTime(task) {
  if (!task.date || !task.time) return null;
  const date = new Date(`${task.date}T${task.time}:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function showToast(message) {
  const region = document.querySelector("#toast-region");
  if (!region) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 4500);
}

function updateHeader() {
  const now = new Date();
  const hour = now.getHours();
  document.querySelector("#greeting").textContent =
    hour < 12 ? "GOOD MORNING" : hour < 18 ? "GOOD AFTERNOON" : "GOOD EVENING";
  document.querySelector("#today-label").textContent =
    now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  document.querySelector("#sidebar-date").textContent =
    now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  document.querySelector("#view-title").textContent = FILTER_TITLES[activeFilter];
  document.querySelector("#overview-grid").hidden = activeFilter === "weekly" || activeFilter === "monthly";
  document.querySelector("#task-section-heading").hidden = activeFilter === "weekly";
  taskList.hidden = activeFilter === "weekly" || activeFilter === "monthly";
  document.querySelector("#weekly-view").hidden = activeFilter !== "weekly";
  document.querySelector("#monthly-view").hidden = activeFilter !== "monthly";
  document.querySelector("#task-list-heading").textContent =
    activeFilter === "today" ? "Today's tasks" : activeFilter === "upcoming" ? "Coming up" : activeFilter === "completed" ? "Completed tasks" : "Your tasks";
  document.querySelector("#page-heading").innerHTML =
    activeFilter === "today" ? "Your day, <span>your pace.</span>" :
      activeFilter === "upcoming" ? "A little <span>look ahead.</span>" :
        activeFilter === "weekly" ? "Make a plan, <span>make it yours.</span>" :
      activeFilter === "monthly" ? "Think bigger, <span>plan ahead.</span>" :
      activeFilter === "completed" ? "Look how far <span>you've come.</span>" : "Your day, <span>your pace.</span>";
  document.querySelector("#page-subheading").textContent =
    activeFilter === "today" ? "A clear mind starts with a clear list." :
      activeFilter === "upcoming" ? "See what's ahead and make a little space." :
        activeFilter === "weekly" ? "See the week ahead and find a rhythm that works." :
        activeFilter === "monthly" ? "Get the bigger picture and make space for your priorities." :
        activeFilter === "completed" ? "Every finished task is a step forward." : "A clear mind starts with a clear list.";
}

function getVisibleTasks() {
  const query = searchInput.value.trim().toLocaleLowerCase();
  let visible = tasks.filter((task) => {
    if (activeFilter === "today" && task.date !== localDateKey()) return false;
    if (activeFilter === "upcoming" && (task.completed || !task.date || task.date <= localDateKey())) return false;
    if (activeFilter === "completed" && !task.completed) return false;
    if (activeFilter === "all" && task.completed) return false;
    const searchable = `${task.title} ${task.notes}`.toLocaleLowerCase();
    return !query || searchable.includes(query);
  });
  const priorityOrder = { high: 0, normal: 1, low: 2 };
  visible.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (sortByDueDate) {
      const dateA = a.date ? `${a.date}T${a.time || "23:59"}` : "9999-12-31";
      const dateB = b.date ? `${b.date}T${b.time || "23:59"}` : "9999-12-31";
      if (dateA !== dateB) return dateA.localeCompare(dateB);
    }
    return priorityOrder[a.priority] - priorityOrder[b.priority] ||
      a.createdAt.localeCompare(b.createdAt);
  });
  return visible;
}

function renderTask(task) {
  const row = document.createElement("article");
  row.className = `task-row${task.completed ? " completed" : ""}`;
  const checkbox = document.createElement("input");
  checkbox.className = "task-check";
  checkbox.type = "checkbox";
  checkbox.checked = task.completed;
  checkbox.setAttribute("aria-label", `Mark "${task.title}" ${task.completed ? "incomplete" : "complete"}`);
  checkbox.addEventListener("change", () => toggleTask(task.id));

  const main = document.createElement("div");
  main.className = "task-main";
  const title = document.createElement("p");
  title.className = "task-title";
  title.textContent = task.title;
  main.append(title);
  if (task.notes) {
    const notes = document.createElement("p");
    notes.className = "task-notes";
    notes.textContent = task.notes;
    main.append(notes);
  }

  const meta = document.createElement("div");
  meta.className = "task-meta";
  if (task.date) {
    const due = document.createElement("span");
    due.className = "task-due";
    const dueDate = taskDateTime(task);
    if (!task.completed && dueDate && dueDate < new Date()) due.classList.add("overdue");
    else if (!task.completed && dueDate && dueDate.getTime() - Date.now() < 3600000) due.classList.add("soon");
    due.textContent = `${formatDate(task.date)}${task.time ? ` · ${formatTime(task.time)}` : ""}`;
    meta.append(due);
  }
  if (task.reminder && !task.completed) {
    const reminder = document.createElement("span");
    reminder.className = "reminder-indicator";
    reminder.title = "Alarm set";
    reminder.setAttribute("aria-label", "Alarm set");
    reminder.textContent = "◷";
    meta.append(reminder);
  }
  if (task.completed && task.completedAt) {
    const completedAt = document.createElement("time");
    completedAt.className = "task-completed-at";
    completedAt.textContent = formatCompletionTimestamp(task.completedAt);
    completedAt.dateTime = task.completedAt;
    meta.append(completedAt);
  }
  const priority = document.createElement("span");
  priority.className = `priority${task.priority === "normal" ? "" : ` ${task.priority}`}`;
  priority.textContent = `${task.priority === "high" ? "↑ " : ""}${task.priority[0].toUpperCase()}${task.priority.slice(1)}`;
  meta.append(priority);

  const actions = document.createElement("div");
  actions.className = "task-actions";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.title = "Edit task";
  edit.setAttribute("aria-label", `Edit ${task.title}`);
  edit.textContent = "✎";
  edit.addEventListener("click", () => openTaskForm(task));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.title = "Delete task";
  remove.setAttribute("aria-label", `Delete ${task.title}`);
  remove.textContent = "×";
  remove.addEventListener("click", () => deleteTask(task.id));
  actions.append(edit, remove);
  row.append(checkbox, main, meta, actions);
  return row;
}

function render() {
  updateHeader();
  document.querySelector("#all-count").textContent = tasks.filter(t => !t.completed).length;
  document.querySelector("#today-count").textContent = tasks.filter(t => !t.completed && t.date === localDateKey()).length;
  if (activeFilter === "weekly") {
    renderWeeklyPlan();
    return;
  }
  if (activeFilter === "monthly") {
    renderMonthlyPlan();
    return;
  }
  taskList.replaceChildren();
  const visible = getVisibleTasks();
  if (visible.length) visible.forEach((task) => taskList.append(renderTask(task)));
  else {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const icon = document.createElement("span");
    icon.className = "empty-illustration";
    icon.textContent = activeFilter === "completed" ? "✓" : "✳";
    const heading = document.createElement("h3");
    heading.textContent = searchInput.value.trim() ? "No tasks found" :
      activeFilter === "completed" ? "Nothing completed just yet" :
        activeFilter === "today" ? "No tasks for today" :
          activeFilter === "upcoming" ? "Nothing coming up" : "Your list is a blank canvas";
    const description = document.createElement("p");
    description.textContent = searchInput.value.trim() ? "Try a different search." :
      activeFilter === "completed" ? "Check off a task when you're done." :
        activeFilter === "upcoming" ? "Tasks with a future due date will show here." :
          activeFilter === "today" ? "Enjoy the breathing room, or add a task for today." : "Add a task to get your day moving.";
    empty.append(icon, heading, description);
    taskList.append(empty);
  }
  const total = tasks.filter((task) => !task.completed).length;
  const todayTasks = tasks.filter((task) => !task.completed && task.date === localDateKey()).length;
  document.querySelector("#all-count").textContent = total;
  document.querySelector("#today-count").textContent = todayTasks;
  const completedToday = tasks.filter((task) => {
    if (!task.completed) return false;
    const completionDate = task.completedAt ? localDateKey(new Date(task.completedAt)) : null;
    return completionDate === localDateKey();
  }).length;
  const todayTotal = todayTasks + completedToday;
  const percent = todayTotal ? Math.round((completedToday / todayTotal) * 100) : 0;
  document.querySelector("#progress-percent").textContent = `${percent}%`;
  document.querySelector("#progress-summary").textContent = `${completedToday} of ${todayTotal} tasks done`;
  document.querySelector("#progress-fill").style.width = `${percent}%`;
  document.querySelector("#progress-message").textContent =
    percent === 100 && todayTotal ? "Look at you go. That's a wrap!" : percent ? "You're making lovely progress." : "Every checked box is a win.";
  updateNextTask();
}

function matchesSearch(task) { return `${task.title} ${task.notes}`.toLowerCase().includes(searchInput.value.trim().toLowerCase()); }

function renderWeeklyPlan() {
  const grid = document.querySelector("#week-grid");
  grid.replaceChildren();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + index);
    return date;
  });
  const weekEnd = days[6];
  const weekTasks = tasks.filter(matchesSearch).filter((task) => task.date >= localDateKey(weekStart) && task.date <= localDateKey(weekEnd));
  const completedCount = weekTasks.filter((task) => task.completed).length;
  document.querySelector("#week-range").textContent = formatWeekRange(weekStart, weekEnd);
  document.querySelector("#week-summary").textContent =
    `${weekTasks.length} ${weekTasks.length === 1 ? "task" : "tasks"} planned · ${completedCount} completed`;

  days.forEach((date) => {
    const dateKey = localDateKey(date);
    const dayTasks = tasks.filter(matchesSearch).filter((task) => task.date === dateKey)
      .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
    const column = document.createElement("article");
    column.className = `week-day${dateKey === localDateKey() ? " is-today" : ""}`;

    const heading = document.createElement("div");
    heading.className = "week-day-heading";
    const dayName = document.createElement("span");
    dayName.className = "week-day-name";
    dayName.textContent = date.toLocaleDateString(undefined, { weekday: "short" });
    const dayNumber = document.createElement("span");
    dayNumber.className = "week-day-number";
    dayNumber.textContent = String(date.getDate());
    const dayCount = document.createElement("span");
    dayCount.className = "week-day-count";
    dayCount.textContent = `${dayTasks.length}`;
    dayCount.setAttribute("aria-label", `${dayTasks.length} tasks`);
    heading.append(dayName, dayNumber, dayCount);
    column.append(heading);

    const dayTaskList = document.createElement("div");
    dayTaskList.className = "week-day-tasks";
    dayTasks.forEach((task) => {
      const item = document.createElement("div");
      item.className = `week-task${task.completed ? " completed" : ""}`;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = task.completed;
      checkbox.setAttribute("aria-label", `Mark "${task.title}" ${task.completed ? "incomplete" : "complete"}`);
      checkbox.addEventListener("change", () => toggleTask(task.id));
      const details = document.createElement("button");
      details.type = "button";
      details.className = "week-task-details";
      details.setAttribute("aria-label", `Edit ${task.title}`);
      const title = document.createElement("span");
      title.className = "week-task-title";
      title.textContent = task.title;
      details.append(title);
      if (task.time) {
        const time = document.createElement("span");
        time.className = "week-task-time";
        time.textContent = formatTime(task.time);
        details.append(time);
      }
      details.addEventListener("click", () => openTaskForm(task));
      item.append(checkbox, details);
      dayTaskList.append(item);
    });
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "week-add-task";
    addButton.setAttribute("aria-label", `Add a task for ${date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`);
    addButton.textContent = "+ Add task";
    addButton.addEventListener("click", () => openTaskForm(null, dateKey));
    dayTaskList.append(addButton);
    column.append(dayTaskList);
    grid.append(column);
  });
}

function renderMonthlyPlan() {
  const grid = document.querySelector("#month-grid");
  grid.replaceChildren();
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstDay = new Date(year, month, 1, 12);
  const daysInMonth = new Date(year, month + 1, 0, 12).getDate();
  const offset = (firstDay.getDay() + 6) % 7;
  const cellCount = Math.ceil((offset + daysInMonth) / 7) * 7;
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthTasks = tasks.filter(matchesSearch).filter((task) => task.date.startsWith(`${monthPrefix}-`));
  const completedCount = monthTasks.filter((task) => task.completed).length;

  document.querySelector("#month-title").textContent =
    monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  document.querySelector("#month-summary").textContent =
    `${monthTasks.length} ${monthTasks.length === 1 ? "task" : "tasks"} planned · ${completedCount} completed`;

  ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach((day) => {
    const heading = document.createElement("div");
    heading.className = "month-weekday";
    heading.textContent = day;
    grid.append(heading);
  });

  for (let index = 0; index < cellCount; index += 1) {
    const dayNumber = index - offset + 1;
    const cell = document.createElement("article");
    if (dayNumber < 1 || dayNumber > daysInMonth) {
      cell.className = "month-day outside-month";
      cell.setAttribute("aria-hidden", "true");
      grid.append(cell);
      continue;
    }

    const date = new Date(year, month, dayNumber, 12);
    const dateKey = localDateKey(date);
    const dayTasks = tasks.filter(matchesSearch).filter((task) => task.date === dateKey)
      .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
    cell.className = `month-day${dateKey === localDateKey() ? " is-today" : ""}`;

    const header = document.createElement("div");
    header.className = "month-day-header";
    const dateButton = document.createElement("button");
    dateButton.type = "button";
    dateButton.className = "month-date";
    dateButton.textContent = String(dayNumber);
    dateButton.setAttribute("aria-label", `Add a task for ${date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`);
    dateButton.addEventListener("click", () => openTaskForm(null, dateKey));
    const count = document.createElement("span");
    count.className = "month-day-count";
    count.textContent = String(dayTasks.length);
    count.setAttribute("aria-label", `${dayTasks.length} tasks`);
    header.append(dateButton, count);
    cell.append(header);

    const dayTaskList = document.createElement("div");
    dayTaskList.className = "month-day-tasks";
    dayTasks.forEach((task) => {
      const item = document.createElement("div");
      item.className = `month-task${task.completed ? " completed" : ""}`;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = task.completed;
      checkbox.setAttribute("aria-label", `Mark "${task.title}" ${task.completed ? "incomplete" : "complete"}`);
      checkbox.addEventListener("change", () => toggleTask(task.id));
      const details = document.createElement("button");
      details.type = "button";
      details.className = "month-task-details";
      details.setAttribute("aria-label", `Edit ${task.title}`);
      const title = document.createElement("span");
      title.className = "month-task-title";
      title.textContent = task.title;
      details.append(title);
      if (task.time) {
        const time = document.createElement("span");
        time.className = "month-task-time";
        time.textContent = formatTime(task.time);
        details.append(time);
      }
      details.addEventListener("click", () => openTaskForm(task));
      item.append(checkbox, details);
      dayTaskList.append(item);
    });
    cell.append(dayTaskList);
    grid.append(cell);
  }
}

function updateNextTask() {
  const next = tasks.filter((task) => !task.completed && task.reminder && taskDateTime(task) && taskDateTime(task) > new Date())
    .sort((a, b) => taskDateTime(a) - taskDateTime(b))[0];
  document.querySelector("#next-task-title").textContent = next ? next.title : "Nothing on the clock";
  document.querySelector("#next-task-time").textContent = next ?
    `${formatDate(next.date)}${next.time ? ` · ${formatTime(next.time)}` : ""}` : "Add a reminder to stay on track.";
}

async function toggleTask(id) {
  const original = tasks.find(t => t.id === id);
  if (!original) return;
  await mutate(async () => {
    const task = { ...original, completed: !original.completed, completedAt: !original.completed ? new Date().toISOString() : null };
    const saved = await window.ChronListData.put(task, tasks);
    tasks = tasks.map(t => t.id === id ? saved : t);
  });
}

async function deleteTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task || busy || !dataReady) return;
  if (!confirm(`Delete “${task.title}”? Export a backup first if you need to keep it.`)) return;
  await mutate(async () => {
    await window.ChronListData.remove(task, tasks);
    tasks = tasks.filter(t => t.id !== id);
    showToast("Task deleted.");
  });
}

function openTaskForm(task = null, defaultDate = "") {
  if (!dataReady || busy) { showToast("Wait for your tasks to connect, then try again."); return; }
  editingTaskId = task ? task.id : null;
  taskForm.reset();
  document.querySelector("#dialog-title").textContent = task ? "Edit task" : "Add a task";
  document.querySelector("#save-task-button").textContent = task ? "Save changes" : "Save task";
  if (defaultDate) document.querySelector("#task-date").value = defaultDate;
  if (task) {
    document.querySelector("#task-title").value = task.title;
    document.querySelector("#task-notes").value = task.notes;
    document.querySelector("#task-date").value = task.date;
    document.querySelector("#task-time").value = task.time;
    document.querySelector("#task-priority").value = task.priority;
    document.querySelector("#task-reminder").checked = task.reminder;
  }
  taskDialog.showModal();
  window.setTimeout(() => document.querySelector("#task-title").focus(), 0);
}

async function saveTask(event) {
  // The modal stays open if saving fails, preserving your input.
  event.preventDefault();
  const formData = new FormData(taskForm);
  const title = String(formData.get("title") || "").trim();
  if (!title) return;
  const date = String(formData.get("date") || "");
  const time = String(formData.get("time") || "");
  const reminder = formData.get("reminder") === "on";
  if (reminder && (!date || !time)) {
    showToast("Choose a due date and time to set an alarm.");
    (date ? document.querySelector("#task-time") : document.querySelector("#task-date")).focus();
    return;
  }
  const dueDateTime = date && time ? new Date(`${date}T${time}:00`) : null;
  const previous = editingTaskId ? tasks.find(t => t.id === editingTaskId) : null;
  const unchangedReminder = previous && previous.date === date && previous.time === time && previous.reminder === reminder;
  if (reminder && dueDateTime <= new Date() && !unchangedReminder) {
    showToast("Choose a future date and time for your alarm.");
    document.querySelector("#task-time").focus();
    return;
  }
  const existing = editingTaskId ? tasks.find((task) => task.id === editingTaskId) : null;
  if (editingTaskId && !existing) { showToast("This task was removed on another device. Cancel and add a new task."); return; }
  const task = {
    version: existing?.version || 0,
    id: existing ? existing.id : newTaskId(),
    title,
    notes: String(formData.get("notes") || "").trim(),
    date,
    time,
    priority: String(formData.get("priority") || "normal"),
    reminder,
    completed: existing ? existing.completed : false,
    completedAt: existing ? existing.completedAt : null,
    alarmed: existing && existing.date === date && existing.time === time && existing.reminder === reminder ? existing.alarmed : false,
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
  };
  await mutate(async () => {
    const saved = await window.ChronListData.put(task, tasks);
    if (existing) tasks = tasks.map(item => item.id === saved.id ? saved : item);
    else tasks.push(saved);
    taskDialog.close();
    showToast(existing ? "Task updated." : "Task added.");
  });
}

async function playAlarm() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      showToast("Audio isn't supported in this browser.");
      return false;
    }
    alarmAudioContext ||= new AudioContext();
    if (alarmAudioContext.state === "closed") alarmAudioContext = new AudioContext();
    if (alarmAudioContext.state === "suspended") await alarmAudioContext.resume();
    stopAlarm();
    const playNote = (frequency, start, duration) => {
      const oscillator = alarmAudioContext.createOscillator();
      const gain = alarmAudioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.13, start + 0.04);
      gain.gain.setValueAtTime(0.13, start + duration - 0.05);
      gain.gain.linearRampToValueAtTime(0, start + duration);
      oscillator.connect(gain);
      gain.connect(alarmAudioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + duration);
      ringingOscillators.push(oscillator);
    };
    const start = alarmAudioContext.currentTime;
    [880, 660, 880].forEach((frequency, index) => playNote(frequency, start + index * 0.38, 0.28));
    alarmSequenceTimeout = window.setTimeout(() => {
      ringingOscillators = [];
      alarmSequenceTimeout = null;
    }, 1450);
    return true;
  } catch (error) {
    console.error("Could not play the ChronList alarm.", error);
    showToast("Could not play alarm audio. Check your browser's sound settings.");
    return false;
  }
}

function stopAlarm(cancelSequence = true) {
  if (cancelSequence && alarmSequenceTimeout !== null) {
    window.clearTimeout(alarmSequenceTimeout);
    alarmSequenceTimeout = null;
  }
  ringingOscillators.forEach((oscillator) => {
    try { oscillator.stop(); } catch { /* Oscillator may have ended already. */ }
  });
  ringingOscillators = [];
}

function checkReminders() {
  if (!dataReady) return;
  const now = new Date();
  const dueTasks = tasks.filter((task) => task.reminder && !task.completed && !task.alarmed && taskDateTime(task) && taskDateTime(task) <= now);
  if (!dueTasks.length) return;
  const queueWasEmpty = reminderQueue.length === 0;
  dueTasks.forEach((task) => { task.alarmed = true; });
  const orderedDueTasks = dueTasks.sort((a, b) => taskDateTime(a) - taskDateTime(b));
  reminderQueue.push(...orderedDueTasks.map((task) => task.id));
  reminderQueueTotal += orderedDueTasks.length;
  // Reminder receipts are device-local; cloud tasks are not rewritten.
  dueTasks.forEach(task => window.ChronListData.recordReminder(task));
  if (queueWasEmpty) showQueuedReminder(true);
  else updateReminderQueueStatus();
  if ("Notification" in window && Notification.permission === "granted") {
    dueTasks.forEach((dueTask) => {
      try {
      const notification = new Notification("ChronList reminder", {
        body: dueTask.title,
        tag: `chronlist-${dueTask.id}`,
      });
      notification.onclick = () => { window.focus(); notification.close(); };
      } catch { showToast("A reminder is due. Browser notifications are unavailable; use the in-app reminder."); }
    });
  }
  if (dueTasks.length > 1) showToast(`${dueTasks.length} reminders added to your alarm queue.`);
  render();
}

function updateReminderQueueStatus() {
  const remaining = reminderQueue.length;
  const handled = reminderQueueTotal - remaining;
  const position = handled + 1;
  document.querySelector("#alarm-queue-status").textContent =
    remaining > 1 ? `${position} of ${reminderQueueTotal} · ${remaining - 1} more after this` : "";
  document.querySelector("#dismiss-alarm").textContent = remaining > 1 ? "Dismiss & next" : "Got it";
}

function showQueuedReminder(playSound) {
  while (reminderQueue.length) {
    const task = tasks.find((item) => item.id === reminderQueue[0] && !item.completed);
    if (task) {
      document.querySelector("#alarm-task").textContent = task.title;
      if (!alarmOverlay.open) alarmOverlay.showModal();
      updateReminderQueueStatus();
      if (playSound && soundEnabled) playAlarm();
      document.querySelector("#dismiss-alarm").focus();
      return;
    }
    reminderQueue.shift();
    reminderQueueTotal = Math.max(reminderQueueTotal - 1, 0);
  }
  reminderQueueTotal = 0;
  document.querySelector("#alarm-queue-status").textContent = "";
  if (alarmOverlay.open) alarmOverlay.close();
  stopAlarm();
}

function acknowledgeQueuedReminder() {
  if (reminderQueue.length) reminderQueue.shift();
  showQueuedReminder(true);
}

document.querySelector("#open-task-form").addEventListener("click", () => openTaskForm());
taskForm.addEventListener("submit", saveTask);
document.querySelectorAll(".close-dialog").forEach((button) =>
  button.addEventListener("click", () => taskDialog.close())
);
taskDialog.addEventListener("click", (event) => {
  if (event.target === taskDialog) taskDialog.close();
});
document.querySelector("#dismiss-alarm").addEventListener("click", () => {
  acknowledgeQueuedReminder();
});
alarmOverlay.addEventListener("cancel", event => { event.preventDefault(); acknowledgeQueuedReminder(); });
const soundEnabledInput = document.querySelector("#sound-enabled");
const testAlarmButton = document.querySelector("#test-alarm");
soundEnabledInput.checked = soundEnabled;
soundEnabledInput.addEventListener("change", () => {
  soundEnabled = soundEnabledInput.checked;
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, String(soundEnabled));
  } catch (error) {
    console.error("Could not save the ChronList sound preference.", error);
    showToast("Your sound preference couldn't be saved.");
  }
  if (soundEnabled) {
    showToast("Alarm sound enabled.");
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        showToast("Audio isn't supported in this browser. Test alarm to check.");
        return;
      }
      alarmAudioContext ||= new AudioContext();
      if (alarmAudioContext.state === "suspended") {
        alarmAudioContext.resume().catch((error) => {
          console.error("Could not enable ChronList alarm audio.", error);
          showToast("Could not enable alarm audio. Check your browser's sound settings.");
        });
      }
    } catch (error) {
      console.error("Could not enable ChronList alarm audio.", error);
      showToast("Could not enable alarm audio. Check your browser's sound settings.");
    }
  } else {
    stopAlarm();
    showToast("Alarm sound disabled. In-app reminders will still appear.");
  }
});
testAlarmButton.addEventListener("click", async () => {
  testAlarmButton.disabled = true;
  const originalLabel = testAlarmButton.innerHTML;
  testAlarmButton.innerHTML = "♪ <span>Playing…</span>";
  try {
    const played = await playAlarm();
    if (played) {
      soundEnabled = true; soundEnabledInput.checked = true;
      try { localStorage.setItem(SOUND_STORAGE_KEY, "true"); } catch { /* session audio still works */ }
      showToast("Alarm sound enabled for this page. Test again after reloading.");
    }
  } finally {
    window.setTimeout(() => {
      testAlarmButton.disabled = false;
      testAlarmButton.innerHTML = originalLabel;
    }, 1500);
  }
});
document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    searchInput.value = "";
    document.querySelectorAll(".nav-item").forEach((item) => { item.classList.toggle("active", item === button); if (item === button) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current"); });
    render();
  });
});
document.querySelector("#week-previous").addEventListener("click", () => shiftWeek(-1));
document.querySelector("#week-next").addEventListener("click", () => shiftWeek(1));
document.querySelector("#week-today").addEventListener("click", () => {
  weekStart = startOfWeek(new Date());
  render();
});
document.querySelector("#month-previous").addEventListener("click", () => shiftMonth(-1));
document.querySelector("#month-next").addEventListener("click", () => shiftMonth(1));
document.querySelector("#month-today").addEventListener("click", () => {
  const now = new Date();
  monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 12);
  render();
});
searchInput.addEventListener("input", render);
document.querySelector("#sort-button").addEventListener("click", () => {
  sortByDueDate = !sortByDueDate;
  document.querySelector("#sort-button").setAttribute("aria-label", sortByDueDate ? "Sort by priority" : "Sort by due date");
  showToast(sortByDueDate ? "Sorted by due date" : "Sorted by priority");
  render();
});
document.querySelector("#notification-setting").addEventListener("click", async () => {
  if (!("Notification" in window)) {
    showToast("Browser notifications are not supported here. In-app alarms still work while ChronList is open.");
    return;
  }
  if (Notification.permission === "granted") {
    showToast("Browser notifications are enabled for ChronList.");
    return;
  }
  if (Notification.permission === "denied") {
    showToast("Notifications are blocked. Allow them in your browser's site settings.");
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    updateNotificationStatus();
    showToast(permission === "granted" ? "Notifications enabled. You're all set." : "Notifications weren't enabled. In-app alarms still work.");
  } catch (error) {
    console.error("Could not request notification permission.", error);
    showToast("The browser couldn't enable notifications.");
  }
});

function updateNotificationStatus() {
  const status = document.querySelector("#notification-status");
  if (!("Notification" in window)) status.textContent = "In-app alarms only";
  else if (Notification.permission === "granted") status.textContent = "Notifications are on";
  else if (Notification.permission === "denied") status.textContent = "Blocked in browser settings";
  else status.textContent = "Turn on notifications";
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkReminders();
});

async function syncTasks(initial = false) {
  if (busy || (!initial && taskDialog.open)) return;
  busy = true;
  document.querySelector("#sync-now").disabled = true;
  try {
    const next = initial ? await window.ChronListData.initialize() : await window.ChronListData.list();
    if (window.ChronListData.mode === "locked") return;
    tasks = next; dataReady = true;
    document.querySelector("#import-guest").hidden = window.ChronListData.mode !== "cloud";
    render(); checkReminders();
  } catch (error) { showDataError(error); }
  finally { busy = false; document.querySelector("#sync-now").disabled = false; }
}

window.addEventListener("chronlist:session-ended", () => {
  window.ChronListData.lock(); dataReady = false; tasks = []; reminderQueue = []; reminderQueueTotal = 0;
  if (taskDialog.open) taskDialog.close();
  if (alarmOverlay.open) alarmOverlay.close();
  stopAlarm(); render();
  document.querySelector("#import-guest").hidden = true;
  document.querySelector("#sync-status").textContent = "Signed out · reload to return to guest mode";
});
document.querySelector("#sync-now").addEventListener("click", () => syncTasks(!dataReady));
document.querySelector("#export-tasks").addEventListener("click", () => {
  if (!dataReady) { showToast("Connect your tasks before exporting."); return; }
  const blob = new Blob([JSON.stringify({ format: "chronlist-backup-v1", exportedAt: new Date().toISOString(), tasks: tasks.map(({alarmed, ...task}) => task) }, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = `chronlist-backup-${localDateKey()}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.querySelector("#import-guest").addEventListener("click", async () => {
  if (!confirm("Copy this browser’s guest tasks into your signed-in account? Use this only for your own tasks on a trusted device. Browser originals will be kept.")) return;
  await mutate(async () => {
    const result = await window.ChronListData.importGuest();
    tasks = await window.ChronListData.list();
    showToast(`Copied ${result.imported} tasks; ${result.skipped} existing tasks left unchanged.`);
  });
});
document.querySelector("#restore-backup").addEventListener("click", () => {
  if (!dataReady || busy) { showToast("Connect your tasks before restoring a backup."); return; }
  document.querySelector("#backup-file").click();
});
document.querySelector("#backup-file").addEventListener("change", async event => {
  const file = event.target.files[0]; event.target.value = "";
  if (!file) return;
  try {
    if (file.size > 2000000) throw new Error("Choose a backup smaller than 2 MB.");
    const imported = window.ChronListData.validateBackup(JSON.parse(await file.text()));
    if (!confirm(`Add ${imported.length} tasks from this backup to ${window.ChronListData.mode === "cloud" ? "your signed-in account" : "this browser"}? Existing tasks stay unchanged. Restoring twice creates duplicates.`)) return;
    await mutate(async () => {
      let count = 0;
      for (const task of imported) {
        const saved = await window.ChronListData.put({ ...task, id: newTaskId(), version: 0, createdAt: new Date().toISOString(), alarmed: false }, tasks);
        tasks.push(saved); count++;
        document.querySelector("#sync-status").textContent = `Restored ${count} of ${imported.length} tasks`;
      }
      showToast(`Restored ${count} tasks. Past-due reminders may appear now.`);
    });
    checkReminders();
  } catch (error) { showDataError(error); }
});
window.addEventListener("online", () => syncTasks());
window.addEventListener("storage", event => { if (event.key === STORAGE_KEY && window.ChronListData.mode === "guest") syncTasks(); });
updateNotificationStatus(); render(); syncTasks(true);
window.setInterval(checkReminders, REMINDER_CHECK_INTERVAL);
window.setInterval(() => {
  if (!document.hidden && dataReady && window.ChronListData.mode === "cloud") syncTasks();
  else if (!document.hidden && !taskDialog.open) render();
}, 30000);
