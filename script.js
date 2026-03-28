import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  arrayUnion,
  collection,
  doc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC5tCamhw8qGI4apSurMZpXimwsMP4D9AI",
  authDomain: "minijiratask.firebaseapp.com",
  projectId: "minijiratask",
  storageBucket: "minijiratask.firebasestorage.app",
  messagingSenderId: "378857537733",
  appId: "1:378857537733:web:0cf3cac222a9951c3fb0ac"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const topbar = document.querySelector(".topbar");
const appShell = $("app-shell");
const sidebarToggle = $("sidebar-toggle");
const sidebarOverlay = $("sidebar-overlay");
const accountImage = $("account-image");
const logoutBtn = $("logout-btn");
const createProjectBtn = $("create-space-btn");
const createTaskBtn = $("create-task-btn");
const projectCount = $("space-count");
const projectList = $("space-list");
const workspaceTitle = $("board-title");
const workspaceMeta = $("board-meta");
const workspaceCode = $("board-key");
const workspaceContent = $("workspace-content");
const projectModal = $("space-modal");
const closeProjectModalBtn = $("close-space-modal");
const cancelProjectBtn = $("cancel-space");
const projectForm = $("space-form");
const projectNameInput = $("project-name");
const projectCodeInput = $("project-key");
const submitProjectBtn = $("submit-space");
const taskModal = $("task-modal");
const closeTaskModalBtn = $("close-task-modal");
const cancelTaskBtn = $("cancel-task");
const taskForm = $("task-form");
const taskTitleInput = $("task-name");
const taskDescriptionInput = $("task-description");
const taskStatusInput = $("task-status");
const taskAssigneeInput = $("task-assignee");
const taskAssigneeStatus = $("task-assignee-status");
const submitTaskBtn = $("submit-task");
const toast = $("toast");
const boardNavButtons = [...document.querySelectorAll("[data-board-section]")];
const laneDefs = [
  { key: "todo", title: "TODO" },
  { key: "progress", title: "PROGRESS" },
  { key: "done", title: "DONE" }
];

let currentUser = null;
let projects = [];
let ownedProjects = [];
let memberProjects = [];
let tasks = [];
let selectedProjectId = null;
let activeBoardSection = "board";
let ownedProjectsUnsub = null;
let memberProjectsUnsub = null;
let tasksUnsub = null;
let laneRefs = null;
let toastTimer = null;
let lookupTimer = null;
let lookupToken = 0;
let lastMembershipAdd = { projectId: null, userId: null };

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 2400);
}

function syncTopbarHeight() {
  if (topbar) {
    document.documentElement.style.setProperty("--topbar-height", `${topbar.offsetHeight}px`);
  }
}

function isMobile() {
  return window.matchMedia("(max-width: 920px)").matches;
}

function setSidebarOpen(open) {
  const on = open && isMobile();
  appShell?.classList.toggle("sidebar-open", on);
  document.body.classList.toggle("no-scroll", on);
  if (sidebarOverlay) sidebarOverlay.hidden = !on;
  if (sidebarToggle) sidebarToggle.setAttribute("aria-expanded", String(on));
}

function closeSidebar() {
  setSidebarOpen(false);
}

function toggleSidebar() {
  setSidebarOpen(!appShell?.classList.contains("sidebar-open"));
}

function handleResize() {
  syncTopbarHeight();
  if (!isMobile()) closeSidebar();
}

function setActiveBoardSection(section) {
  activeBoardSection = section;
  for (const btn of boardNavButtons) {
    const active = btn.dataset.boardSection === section;
    btn.classList.toggle("active", active);
    if (active) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return emailRe.test(String(email || "").trim());
}

function normalizeStatus(value) {
  const status = String(value || "todo").toLowerCase().replace(/\s+/g, "-");
  if (status === "done") return "done";
  if (status === "progress" || status === "in-progress" || status === "review") return "progress";
  return "todo";
}

function getTaskStatusValue() {
  return taskStatusInput?.value || "todo";
}

function setAssigneeStatus(message = "", tone = "neutral") {
  if (!taskAssigneeStatus) return;
  taskAssigneeStatus.textContent = message;
  taskAssigneeStatus.dataset.tone = tone;
}

function clearLookupState() {
  lookupToken += 1;
  lastMembershipAdd = { projectId: null, userId: null };
  setAssigneeStatus("");
}

function clearListeners() {
  ownedProjectsUnsub?.();
  memberProjectsUnsub?.();
  tasksUnsub?.();
  ownedProjectsUnsub = null;
  memberProjectsUnsub = null;
  tasksUnsub = null;
}

function getSelectedProject() {
  return projects.find((p) => p.projectId === selectedProjectId) || null;
}

function closeProjectModal() {
  projectModal && (projectModal.hidden = true);
  projectForm?.reset();
}

function openProjectModal() {
  closeTaskModal();
  closeSidebar();
  if (!projectModal || !projectForm) return;
  projectForm.reset();
  projectCodeInput.value = generateProjectCode();
  projectModal.hidden = false;
  window.setTimeout(() => projectNameInput.focus(), 0);
}

function closeTaskModal() {
  taskModal && (taskModal.hidden = true);
  taskForm?.reset();
  clearLookupState();
}

function openTaskModal() {
  closeProjectModal();
  closeSidebar();
  if (!getSelectedProject()) {
    showToast("Create a project first.");
    return;
  }
  if (!taskModal || !taskForm) return;
  taskForm.reset();
  clearLookupState();
  if (taskStatusInput) taskStatusInput.value = "todo";
  taskModal.hidden = false;
  window.setTimeout(() => taskTitleInput?.focus(), 0);
}

function normalizeProjectDoc(docSnap) {
  const projectId = docSnap.projectId || docSnap.id;
  return {
    id: docSnap.id,
    projectId,
    name: docSnap.name || docSnap.projectName || "Untitled project",
    ownerId: docSnap.ownerId || docSnap.ownerUid || "",
    members: Array.isArray(docSnap.members)
      ? docSnap.members
      : Array.isArray(docSnap.memberUids)
        ? docSnap.memberUids
        : [],
    projectKey: docSnap.projectKey || "",
    clientCreatedAt: docSnap.clientCreatedAt || 0
  };
}

function renderProjectList() {
  if (!projectList || !projectCount) return;
  projectCount.textContent = String(projects.length);
  projectList.replaceChildren();
  if (!projects.length) {
    const empty = document.createElement("div");
    empty.className = "space-empty";
    empty.textContent = "No projects yet. Create your first project.";
    projectList.appendChild(empty);
    return;
  }
  for (const project of projects) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `space-item${project.projectId === selectedProjectId ? " active" : ""}`;
    const content = document.createElement("div");
    content.className = "space-item__content";
    const title = document.createElement("strong");
    title.textContent = project.name;
    const meta = document.createElement("span");
    const count = Array.isArray(project.members) ? project.members.length : 0;
    meta.textContent = project.projectKey
      ? `Code ${project.projectKey} · ${count} member${count === 1 ? "" : "s"}`
      : `${count} member${count === 1 ? "" : "s"}`;
    content.append(title, meta);
    btn.appendChild(content);
    btn.addEventListener("click", () => {
      selectedProjectId = project.projectId;
      renderWorkspace();
      closeSidebar();
    });
    projectList.appendChild(btn);
  }
}

function renderHeader(project) {
  if (!workspaceTitle || !workspaceMeta || !workspaceCode) return;
  if (!project) {
    workspaceTitle.textContent = "No Project";
    workspaceMeta.textContent = "Create a project to begin organizing work.";
    workspaceCode.textContent = "------";
    return;
  }
  workspaceTitle.textContent = project.name;
  workspaceMeta.textContent = `Project ${project.projectKey || project.projectId} is ready for collaborative work.`;
  workspaceCode.textContent = project.projectKey || project.projectId.slice(0, 6).toUpperCase();
}

function visibleTasks(project) {
  if (!project || !currentUser) return [];
  return tasks.filter((task) => task.visibility !== "owner" || project.ownerId === currentUser.uid);
}

function createSectionCard(kicker, title, copy) {
  const card = document.createElement("section");
  card.className = "section-card";
  const k = document.createElement("p");
  k.className = "section-card__kicker";
  k.textContent = kicker;
  const h = document.createElement("h2");
  h.className = "section-card__title";
  h.textContent = title;
  const p = document.createElement("p");
  p.className = "section-card__copy";
  p.textContent = copy;
  card.append(k, h, p);
  return card;
}

function createEmptyState(title, copy) {
  const wrap = document.createElement("section");
  wrap.className = "workspace-empty-state";
  const h = document.createElement("h2");
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = copy;
  wrap.append(h, p);
  return wrap;
}

function createSimpleItem(title, copy, badge) {
  const item = document.createElement("article");
  item.className = "simple-item";
  const content = document.createElement("div");
  content.className = "simple-item__content";
  const h = document.createElement("strong");
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = copy;
  content.append(h, p);
  item.append(content);
  if (badge) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = badge;
    item.append(chip);
  }
  return item;
}

function createList(tasksList, emptyText, showStatus = true) {
  const list = document.createElement("div");
  list.className = "simple-list";
  if (!tasksList.length) {
    const empty = document.createElement("div");
    empty.className = "tab-empty";
    empty.textContent = emptyText;
    list.appendChild(empty);
    return list;
  }
  for (const task of tasksList) {
    list.appendChild(
      createSimpleItem(
        task.title || "Untitled task",
        task.description || "No description added.",
        showStatus ? normalizeStatus(task.status).toUpperCase() : ""
      )
    );
  }
  return list;
}

function createMembersList(project) {
  const list = document.createElement("div");
  list.className = "simple-list";
  const members = Array.isArray(project.members) ? project.members : [];
  if (!members.length) {
    const empty = document.createElement("div");
    empty.className = "tab-empty";
    empty.textContent = "No members found for this project.";
    list.appendChild(empty);
    return list;
  }
  list.appendChild(
    createSimpleItem(
      "Owner",
      project.ownerId || "Unknown owner",
      project.ownerId === currentUser?.uid ? "You" : "Owner"
    )
  );
  for (const memberId of members) {
    if (memberId === project.ownerId) continue;
    list.appendChild(
      createSimpleItem(
        memberId === currentUser?.uid ? "You" : "Member",
        memberId,
        memberId === currentUser?.uid ? "Current" : "Member"
      )
    );
  }
  return list;
}

function createInfoList(rows) {
  const list = document.createElement("div");
  list.className = "info-list";
  for (const [label, value] of rows) {
    const row = document.createElement("article");
    row.className = "info-row";
    const s = document.createElement("span");
    s.textContent = label;
    const wrap = document.createElement("div");
    const b = document.createElement("strong");
    b.textContent = value;
    wrap.appendChild(b);
    row.append(s, wrap);
    list.appendChild(row);
  }
  return list;
}

function createWeekList() {
  const list = document.createElement("div");
  list.className = "simple-list";
  [["Plan", "Refine the top priorities and keep the weekly goal visible.", "Mon"], ["Build", "Pull active work through the board and keep the flow steady.", "Wed"], ["Review", "Check completed work, tighten loose ends, and prep the handoff.", "Fri"]]
    .forEach(([title, copy, badge]) => list.appendChild(createSimpleItem(title, copy, badge)));
  return list;
}

function createBoardView() {
  const board = document.createElement("div");
  board.className = "kanban";
  laneRefs = {};
  for (const def of laneDefs) {
    const lane = document.createElement("article");
    lane.className = "lane";
    const head = document.createElement("div");
    head.className = "lane-head";
    const title = document.createElement("h2");
    title.className = "lane-title";
    title.textContent = def.title;
    const count = document.createElement("span");
    count.className = "lane-count";
    count.textContent = "0";
    head.append(title, count);
    const list = document.createElement("div");
    list.className = "task-list";
    lane.append(head, list);
    board.appendChild(lane);
    laneRefs[def.key] = { list, count };
  }
  return board;
}

function renderBoardCards() {
  if (!laneRefs) return;
  const project = getSelectedProject();
  const grouped = { todo: [], progress: [], done: [] };
  for (const task of visibleTasks(project)) {
    grouped[normalizeStatus(task.status)].push(task);
  }
  for (const def of laneDefs) {
    const refs = laneRefs[def.key];
    if (!refs) continue;
    refs.count.textContent = String(grouped[def.key].length);
    refs.list.replaceChildren();
    if (!grouped[def.key].length) {
      refs.list.appendChild(document.createElement("div")).className = "lane-empty";
      refs.list.firstChild.textContent = "No tasks yet.";
      continue;
    }
    for (const task of grouped[def.key]) {
      const card = document.createElement("article");
      card.className = "task-card";
      const title = document.createElement("h3");
      title.className = "task-title";
      title.textContent = task.title || "Untitled task";
      const desc = document.createElement("p");
      desc.className = "task-description";
      desc.textContent = task.description || "No description added.";
      card.append(title, desc);
      refs.list.appendChild(card);
    }
  }
}

function renderWorkspaceSection(section, project) {
  if (!workspaceContent) return;
  workspaceContent.replaceChildren();
  laneRefs = null;
  if (!project) {
    workspaceContent.appendChild(createEmptyState("No project selected", "Create a project first, then open one of the tabs above to view the board, backlog, and team details."));
    return;
  }
  const tasksList = visibleTasks(project);
  if (section === "board") {
    workspaceContent.appendChild(createBoardView());
    renderBoardCards();
    return;
  }
  if (section === "backlog") {
    workspaceContent.append(createSectionCard("Workspace", "Backlog", "Open work waiting to be picked up in this project."), createList(tasksList.filter((t) => normalizeStatus(t.status) !== "done"), "No open work in the backlog yet."));
    return;
  }
  if (section === "sprint-week") {
    workspaceContent.append(createSectionCard("Workspace", "Sprint Week", "A clean weekly view for planning, progress, and review."), createWeekList());
    return;
  }
  if (section === "see-teams" || section === "members") {
    workspaceContent.append(createSectionCard("Workspace", section === "members" ? "Members" : "See Teams", "People currently collaborating in this project."), createMembersList(project));
    return;
  }
  if (section === "space-info") {
    workspaceContent.append(
      createSectionCard("Workspace", "Project Info", "Key details for the selected project."),
      createInfoList([
        ["Project name", project.name || "Untitled project"],
        ["Project code", project.projectKey || project.projectId.slice(0, 6).toUpperCase()],
        ["Owner", project.ownerId || "Unknown"],
        ["Members", `${Array.isArray(project.members) ? project.members.length : 0} member${Array.isArray(project.members) && project.members.length === 1 ? "" : "s"}`],
        ["Visible tasks", `${tasksList.length} task${tasksList.length === 1 ? "" : "s"}`]
      ])
    );
    return;
  }
  if (section === "see-all-work") {
    workspaceContent.append(createSectionCard("Workspace", "See All Work", "A combined list of every visible task in this project."), createList(tasksList, "No tasks have been created yet."));
    return;
  }
  workspaceContent.append(createSectionCard("Workspace", "Workspace", "Select a tab to view content for this project."));
}

function renderWorkspace() {
  renderProjectList();
  renderHeader(getSelectedProject());
  syncTasks();
}

function syncProjects() {
  const merged = new Map();
  for (const project of [...ownedProjects, ...memberProjects]) {
    merged.set(project.projectId, project);
  }
  const previous = selectedProjectId;
  projects = [...merged.values()].sort((a, b) => (b.clientCreatedAt || 0) - (a.clientCreatedAt || 0));
  if (projects.length && !projects.some((p) => p.projectId === selectedProjectId)) {
    selectedProjectId = projects[0].projectId;
  }
  if (!projects.length) selectedProjectId = null;
  if (previous !== selectedProjectId) currentTasksProjectId = null;
  renderWorkspace();
}

function loadUserProjects(uid) {
  clearListeners();
  ownedProjects = [];
  memberProjects = [];
  projects = [];
  tasks = [];
  selectedProjectId = null;
  currentTasksProjectId = null;
  renderWorkspace();
  ownedProjectsUnsub = onSnapshot(query(collection(db, "projects"), where("ownerId", "==", uid)), (snap) => {
    ownedProjects = snap.docs.map((d) => normalizeProjectDoc({ id: d.id, ...d.data() }));
    syncProjects();
  }, (err) => {
    console.error("Owned projects listener failed:", err);
    showToast("Could not load owned projects.");
  });
  memberProjectsUnsub = onSnapshot(query(collection(db, "projects"), where("members", "array-contains", uid)), (snap) => {
    memberProjects = snap.docs.map((d) => normalizeProjectDoc({ id: d.id, ...d.data() }));
    syncProjects();
  }, (err) => {
    console.error("Member projects listener failed:", err);
    showToast("Could not load shared projects.");
  });
}

function syncTasks() {
  const project = getSelectedProject();
  const nextProjectId = project ? project.projectId : null;
  if (currentTasksProjectId !== nextProjectId) {
    tasksUnsub?.();
    tasksUnsub = null;
    currentTasksProjectId = nextProjectId;
    tasks = [];
    renderWorkspaceSection(activeBoardSection, project);
    if (!project) return;
    tasksUnsub = onSnapshot(collection(db, "projects", project.projectId, "tasks"), (snap) => {
      if (currentTasksProjectId !== project.projectId) return;
      tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.clientCreatedAt || 0) - (a.clientCreatedAt || 0));
      renderWorkspaceSection(activeBoardSection, getSelectedProject());
    }, (err) => {
      console.error("Task listener failed:", err);
      showToast("Could not load tasks for this project.");
    });
    return;
  }
  renderWorkspaceSection(activeBoardSection, project);
}

async function addMemberToProject(projectId, userId) {
  if (!projectId || !userId) return;
  await updateDoc(doc(db, "projects", projectId), { members: arrayUnion(userId), updatedAt: serverTimestamp() });
}

async function ensureProjectMembership(projectId, userId) {
  if (!projectId || !userId) return;
  if (lastMembershipAdd.projectId === projectId && lastMembershipAdd.userId === userId) return;
  await addMemberToProject(projectId, userId);
  lastMembershipAdd = { projectId, userId };
}

async function checkUserExists(email) {
  const rawEmail = String(email || "").trim();
  const normalized = normalizeEmail(rawEmail);
  if (!normalized) return null;
  const checks = [
    query(collection(db, "users"), where("emailLower", "==", normalized), limit(1)),
    query(collection(db, "users"), where("email", "==", rawEmail), limit(1)),
    query(collection(db, "users"), where("email", "==", normalized), limit(1))
  ];
  for (const q of checks) {
    const snap = await getDocs(q);
    if (!snap.empty) {
      const d = snap.docs[0].data() || {};
      return { userId: d.uid || snap.docs[0].id, email: d.email || rawEmail, displayName: d.displayName || "" };
    }
  }
  return null;
}

async function resolveAssigneeEmail(email, { autoAddMember = true } = {}) {
  const rawEmail = String(email || "").trim();
  if (!rawEmail) {
    clearLookupState();
    return { found: false, userId: null, email: "" };
  }
  if (!isValidEmail(rawEmail)) {
    setAssigneeStatus("Enter a valid email address.", "warning");
    return { found: false, userId: null, email: rawEmail, invalid: true };
  }
  const token = ++lookupToken;
  setAssigneeStatus("Checking user...", "neutral");
  const user = await checkUserExists(rawEmail);
  if (token !== lookupToken) return null;
  if (!user) {
    setAssigneeStatus("User not found, task assigned to owner only.", "warning");
    return { found: false, userId: null, email: normalizeEmail(rawEmail) };
  }
  if (autoAddMember && selectedProjectId) {
    await ensureProjectMembership(selectedProjectId, user.userId);
  }
  setAssigneeStatus("User found and added to project.", "success");
  return { found: true, userId: user.userId, email: normalizeEmail(rawEmail), displayName: user.displayName };
}

function queueAssigneeLookup() {
  window.clearTimeout(lookupTimer);
  const email = taskAssigneeInput?.value.trim() || "";
  if (!email) {
    clearLookupState();
    return;
  }
  lookupTimer = window.setTimeout(() => {
    void resolveAssigneeEmail(email, { autoAddMember: true });
  }, 350);
}

async function createTask(data) {
  const taskRef = doc(collection(db, "projects", data.projectId, "tasks"));
  const payload = {
    taskId: taskRef.id,
    projectId: data.projectId,
    title: data.title,
    description: data.description || "",
    status: normalizeStatus(data.status),
    assignedTo: data.assignedTo || null,
    createdBy: data.createdBy,
    visibility: data.visibility || "project",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    clientCreatedAt: Date.now()
  };
  await setDoc(taskRef, payload);
  return payload;
}

async function createProject(name, code) {
  const projectRef = doc(collection(db, "projects"));
  const payload = {
    projectId: projectRef.id,
    name,
    projectKey: code,
    ownerId: currentUser.uid,
    members: [currentUser.uid],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    clientCreatedAt: Date.now()
  };
  await setDoc(projectRef, payload);
  return payload;
}

function generateProjectCode() {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
}

function handleBoardNavClick(btn) {
  setActiveBoardSection(btn.dataset.boardSection || "board");
  renderWorkspaceSection(activeBoardSection, getSelectedProject());
}

function syncUiForAuth() {
  if (!currentUser || !accountImage) return;
  accountImage.src = currentUser.photoURL || "user.png";
  accountImage.alt = currentUser.displayName ? `${currentUser.displayName} account image` : "User account";
}

syncTopbarHeight();
window.requestAnimationFrame(syncTopbarHeight);
window.addEventListener("resize", handleResize);

sidebarToggle?.addEventListener("click", toggleSidebar);
sidebarOverlay?.addEventListener("click", closeSidebar);
createProjectBtn?.addEventListener("click", openProjectModal);
createTaskBtn?.addEventListener("click", openTaskModal);
closeProjectModalBtn?.addEventListener("click", closeProjectModal);
cancelProjectBtn?.addEventListener("click", closeProjectModal);
closeTaskModalBtn?.addEventListener("click", closeTaskModal);
cancelTaskBtn?.addEventListener("click", closeTaskModal);
boardNavButtons.forEach((btn) => btn.addEventListener("click", () => handleBoardNavClick(btn)));

projectModal?.addEventListener("click", (event) => {
  if (event.target === projectModal) closeProjectModal();
});
taskModal?.addEventListener("click", (event) => {
  if (event.target === taskModal) closeTaskModal();
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (projectModal && !projectModal.hidden) closeProjectModal();
  if (taskModal && !taskModal.hidden) closeTaskModal();
  if (appShell?.classList.contains("sidebar-open")) closeSidebar();
});

taskAssigneeInput?.addEventListener("input", queueAssigneeLookup);
taskAssigneeInput?.addEventListener("blur", queueAssigneeLookup);

projectForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;
  const name = projectNameInput.value.trim();
  if (!name) {
    showToast("Please enter a project name.");
    projectNameInput.focus();
    return;
  }
  submitProjectBtn.disabled = true;
  try {
    const code = projectCodeInput.value || generateProjectCode();
    const created = await createProject(name, code);
    selectedProjectId = created.projectId;
    syncProjects();
    closeProjectModal();
    showToast(`Project "${name}" created.`);
  } catch (error) {
    console.error(error);
    showToast("Could not create this project right now.");
  } finally {
    submitProjectBtn.disabled = false;
  }
});

taskForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;
  const project = getSelectedProject();
  if (!project) {
    showToast("Create a project first.");
    return;
  }
  const title = (taskTitleInput?.value || "").trim();
  if (!title) {
    showToast("Please enter a task title.");
    taskTitleInput?.focus();
    return;
  }

  const email = (taskAssigneeInput?.value || "").trim();
  let assignedTo = null;
  let visibility = "project";
  let message = "Task created.";

  submitTaskBtn.disabled = true;
  try {
    if (email) {
      if (!isValidEmail(email)) {
        showToast("Enter a valid email address.");
        taskAssigneeInput.focus();
        return;
      }
      const result = await resolveAssigneeEmail(email, { autoAddMember: true });
      if (result?.invalid) {
        showToast("Enter a valid email address.");
        return;
      }
      if (result?.found) {
        assignedTo = result.userId;
        visibility = "project";
        message = "User found and added to project";
      } else {
        assignedTo = null;
        visibility = "owner";
        message = "User not found, task assigned to owner only";
      }
    } else {
      clearLookupState();
    }

    await createTask({
      projectId: project.projectId,
      title,
      description: (taskDescriptionInput?.value || "").trim(),
      status: getTaskStatusValue(),
      assignedTo,
      createdBy: currentUser.uid,
      visibility
    });

    selectedProjectId = project.projectId;
    syncProjects();
    closeTaskModal();
    showToast(message);
  } catch (error) {
    console.error(error);
    showToast(error?.code === "permission-denied" ? "Firebase rules are blocking this write. Publish the updated Firestore rules." : "Could not create this task right now.");
  } finally {
    submitTaskBtn.disabled = false;
  }
});

logoutBtn?.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  try {
    await signOut(auth);
    window.location.replace("index.html");
  } catch (error) {
    console.error(error);
    showToast("Could not sign out right now.");
    logoutBtn.disabled = false;
  }
});

onAuthStateChanged(auth, (user) => {
  if (!user) {
    clearListeners();
    window.location.replace("index.html");
    return;
  }
  currentUser = user;
  syncUiForAuth();
  loadUserProjects(user.uid);
  setActiveBoardSection("board");
});

setSidebarOpen(false);
renderWorkspace();
