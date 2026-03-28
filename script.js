import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
  collection,
  addDoc,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  query,
  setDoc,
  serverTimestamp,
  where
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

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

const appShell = document.getElementById("app-shell");
const topbar = document.querySelector(".topbar");
const sidebarToggle = document.getElementById("sidebar-toggle");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const accountImage = document.getElementById("account-image");
const logoutBtn = document.getElementById("logout-btn");
const createSpaceBtn = document.getElementById("create-space-btn");
const createTaskBtn = document.getElementById("create-task-btn");
const spaceCount = document.getElementById("space-count");
const spaceList = document.getElementById("space-list");
const boardTitle = document.getElementById("board-title");
const boardMeta = document.getElementById("board-meta");
const boardKey = document.getElementById("board-key");
const workspaceContent = document.getElementById("workspace-content");
const spaceModal = document.getElementById("space-modal");
const closeSpaceModalBtn = document.getElementById("close-space-modal");
const cancelSpace = document.getElementById("cancel-space");
const spaceForm = document.getElementById("space-form");
const projectNameInput = document.getElementById("project-name");
const projectKeyInput = document.getElementById("project-key");
const submitSpace = document.getElementById("submit-space");
const taskModal = document.getElementById("task-modal");
const closeTaskModalBtn = document.getElementById("close-task-modal");
const cancelTask = document.getElementById("cancel-task");
const taskForm = document.getElementById("task-form");
const taskDescriptionInput = document.getElementById("task-description");
const taskNameInput = document.getElementById("task-name");
const taskSpaceInput = document.getElementById("task-space");
const taskIssueTagInput = document.getElementById("task-issue-tag");
const taskPriorityInput = document.getElementById("task-priority");
const taskStatusInput = document.getElementById("task-status");
const taskAssigneeInput = document.getElementById("task-assignee");
const submitTask = document.getElementById("submit-task");
const toast = document.getElementById("toast");
const boardNavButtons = Array.from(document.querySelectorAll("[data-board-section]"));

const taskLaneDefinitions = [
  { key: "todo", title: "TODO" },
  { key: "in-progress", title: "IN PROGRESS" },
  { key: "review", title: "REVIEW" },
  { key: "done", title: "DONE" }
];

let currentUser = null;
let nestedSpacesUnsubscribe = null;
let tasksUnsubscribe = null;
let nestedSpaces = [];
let spaces = [];
let tasks = [];
let selectedSpaceKey = null;
let currentTasksSpaceKey = null;
let activeBoardSection = "board";
let toastTimer = null;
let taskLaneRefs = null;

function showToast(message) {
  if (!toast) {
    return;
  }

  toast.textContent = message;
  toast.hidden = false;

  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }

  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2400);
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 920px)").matches;
}

function syncTopbarHeight() {
  if (!topbar) {
    return;
  }

  document.documentElement.style.setProperty("--topbar-height", `${topbar.offsetHeight}px`);
}

function setSidebarOpen(open) {
  const shouldOpen = open && isMobileLayout();

  if (appShell) {
    appShell.classList.toggle("sidebar-open", shouldOpen);
  }

  if (sidebarOverlay) {
    sidebarOverlay.hidden = !shouldOpen;
  }

  if (sidebarToggle) {
    sidebarToggle.setAttribute("aria-expanded", String(shouldOpen));
  }

  document.body.classList.toggle("no-scroll", shouldOpen);
}

function closeSidebar() {
  setSidebarOpen(false);
}

function toggleSidebar() {
  if (!appShell) {
    return;
  }

  setSidebarOpen(!appShell.classList.contains("sidebar-open"));
}

function setActiveBoardSection(section) {
  activeBoardSection = section;

  for (const button of boardNavButtons) {
    const isActive = button.dataset.boardSection === section;
    button.classList.toggle("active", isActive);

    if (isActive) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  }
}

function generateKey() {
  const value = Math.floor(Math.random() * 1000000);
  return String(value).padStart(6, "0");
}

function closeSpaceModal() {
  if (spaceModal) {
    spaceModal.hidden = true;
  }

  if (spaceForm) {
    spaceForm.reset();
  }
}

function openSpaceModal() {
  closeTaskModal();
  closeSidebar();

  if (!spaceForm || !spaceModal) {
    return;
  }

  spaceForm.reset();
  projectKeyInput.value = generateKey();
  spaceModal.hidden = false;
  window.setTimeout(() => projectNameInput.focus(), 0);
}

function closeTaskModal() {
  if (taskModal) {
    taskModal.hidden = true;
  }

  if (taskForm) {
    taskForm.reset();
  }
}

function openTaskModal() {
  closeSpaceModal();
  closeSidebar();

  if (!spaces.length) {
    showToast("Create a space first.");
    return;
  }

  if (!taskForm || !taskModal) {
    return;
  }

  taskForm.reset();
  renderTaskSpaceOptions();
  taskSpaceInput.value = selectedSpaceKey && spaces.some((space) => space.key === selectedSpaceKey)
    ? selectedSpaceKey
    : spaces[0].key;
  taskStatusInput.value = "todo";
  taskPriorityInput.value = "medium";
  taskModal.hidden = false;
  window.setTimeout(() => taskNameInput.focus(), 0);
}

function getSelectedSpace() {
  return spaces.find((space) => space.key === selectedSpaceKey) || null;
}

function spaceKeyFromDoc(spaceDoc, fallbackOwnerUid) {
  const ownerUid = spaceDoc.ownerUid || fallbackOwnerUid || "unknown";
  return `${ownerUid}:${spaceDoc.id}`;
}

function normalizeSpaceDoc(spaceDoc, fallbackOwnerUid) {
  const ownerUid = spaceDoc.ownerUid || fallbackOwnerUid || "unknown";

  return {
    ...spaceDoc,
    ownerUid,
    key: spaceKeyFromDoc(spaceDoc, ownerUid)
  };
}

function syncSpaces() {
  const merged = new Map();

  for (const space of nestedSpaces) {
    merged.set(space.key, space);
  }

  spaces = Array.from(merged.values()).sort(
    (a, b) => (b.clientCreatedAt || 0) - (a.clientCreatedAt || 0)
  );

  if (spaces.length && !spaces.some((space) => space.key === selectedSpaceKey)) {
    selectedSpaceKey = spaces[0].key;
  }

  if (!spaces.length) {
    selectedSpaceKey = null;
  }

  renderTaskSpaceOptions();
  renderWorkspace();
}

async function migrateLegacySpaces(uid) {
  try {
    const legacyQueryRef = query(
      collection(db, "spaces"),
      where("memberUids", "array-contains", uid)
    );
    const legacySnapshot = await getDocs(legacyQueryRef);

    for (const legacyDoc of legacySnapshot.docs) {
      const legacyData = legacyDoc.data();
      const ownerUid = legacyData.ownerUid || uid;

      if (ownerUid !== uid) {
        continue;
      }

      const nextSpaceRef = doc(db, "users", ownerUid, "spaces", legacyDoc.id);
      const nextSpaceSnap = await getDoc(nextSpaceRef);

      if (!nextSpaceSnap.exists()) {
        await setDoc(nextSpaceRef, legacyData);
      }

      const legacyTasksSnapshot = await getDocs(collection(db, "spaces", legacyDoc.id, "tasks"));

      for (const legacyTaskDoc of legacyTasksSnapshot.docs) {
        await setDoc(
          doc(db, "users", ownerUid, "spaces", legacyDoc.id, "tasks", legacyTaskDoc.id),
          legacyTaskDoc.data()
        );
        await deleteDoc(legacyTaskDoc.ref);
      }

      await deleteDoc(legacyDoc.ref);
    }
  } catch (error) {
    if (error?.code === "permission-denied") {
      return;
    }

    throw error;
  }
}

function normalizeTaskStatus(value) {
  const status = String(value || "todo")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/_/g, "-");

  if (status === "todo" || status === "in-progress" || status === "review" || status === "done") {
    return status;
  }

  return "todo";
}

function normalizeTaskPriority(value) {
  const priority = String(value || "medium").toLowerCase();

  if (priority === "low" || priority === "medium" || priority === "high") {
    return priority;
  }

  return "medium";
}

function formatStatusLabel(value) {
  return normalizeTaskStatus(value)
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderTaskSpaceOptions() {
  if (!taskSpaceInput) {
    return;
  }

  const desiredValue = taskSpaceInput.value || selectedSpaceKey || (spaces[0] && spaces[0].key) || "";

  taskSpaceInput.replaceChildren();

  if (!spaces.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Create a space first";
    option.selected = true;
    taskSpaceInput.appendChild(option);
    taskSpaceInput.disabled = true;
    return;
  }

  taskSpaceInput.disabled = false;

  for (const space of spaces) {
    const option = document.createElement("option");
    option.value = space.key;
    option.textContent = `${space.projectName || "Untitled space"}${space.projectKey ? ` - ${space.projectKey}` : ""}`;
    taskSpaceInput.appendChild(option);
  }

  if (spaces.some((space) => space.key === desiredValue)) {
    taskSpaceInput.value = desiredValue;
  } else {
    taskSpaceInput.value = spaces[0].key;
  }
}

function renderWorkspaceHeader(space) {
  if (!boardTitle || !boardMeta || !boardKey) {
    return;
  }

  if (!space) {
    boardTitle.textContent = "No Space";
    boardMeta.textContent = "Create a space to begin organizing tasks.";
    boardKey.textContent = "------";
    return;
  }

  boardTitle.textContent = space.projectName || "Untitled space";
  boardMeta.textContent = `Project key ${space.projectKey || "------"} keeps work organized across the board.`;
  boardKey.textContent = space.projectKey || "------";
}

function createEmptyState(title, copy) {
  const panel = document.createElement("section");
  panel.className = "workspace-empty-state";

  const heading = document.createElement("h2");
  heading.textContent = title;

  const paragraph = document.createElement("p");
  paragraph.textContent = copy;

  panel.append(heading, paragraph);
  return panel;
}

function createSectionCard(kicker, title, copy) {
  const card = document.createElement("section");
  card.className = "section-card";

  const kickerEl = document.createElement("p");
  kickerEl.className = "section-card__kicker";
  kickerEl.textContent = kicker;

  const heading = document.createElement("h2");
  heading.className = "section-card__title";
  heading.textContent = title;

  const paragraph = document.createElement("p");
  paragraph.className = "section-card__copy";
  paragraph.textContent = copy;

  card.append(kickerEl, heading, paragraph);
  return card;
}

function createSimpleItem(titleText, descriptionText, badgeText) {
  const item = document.createElement("article");
  item.className = "simple-item";

  const content = document.createElement("div");
  content.className = "simple-item__content";

  const title = document.createElement("strong");
  title.textContent = titleText;

  const description = document.createElement("p");
  description.textContent = descriptionText;

  content.append(title, description);
  item.append(content);

  if (badgeText) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = badgeText;
    item.appendChild(chip);
  }

  return item;
}

function createTaskSummaryList(items, emptyText) {
  const list = document.createElement("div");
  list.className = "simple-list";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "tab-empty";
    empty.textContent = emptyText;
    list.appendChild(empty);
    return list;
  }

  for (const task of items) {
    list.appendChild(
      createSimpleItem(
        task.taskName || "Untitled task",
        task.description || "No description added.",
        formatStatusLabel(task.status)
      )
    );
  }

  return list;
}

function createMemberList(memberUids) {
  const list = document.createElement("div");
  list.className = "simple-list";

  if (!memberUids.length) {
    const empty = document.createElement("div");
    empty.className = "tab-empty";
    empty.textContent = "No members have joined this space yet.";
    list.appendChild(empty);
    return list;
  }

  for (const memberUid of memberUids) {
    list.appendChild(
      createSimpleItem(
        memberUid === currentUser?.uid ? "You" : "Member",
        memberUid,
        memberUid === currentUser?.uid ? "Current" : "Member"
      )
    );
  }

  return list;
}

function createInfoList(rows) {
  const list = document.createElement("div");
  list.className = "info-list";

  for (const [labelText, valueText] of rows) {
    const row = document.createElement("article");
    row.className = "info-row";

    const label = document.createElement("span");
    label.textContent = labelText;

    const valueWrap = document.createElement("div");
    const value = document.createElement("strong");
    value.textContent = valueText;
    valueWrap.appendChild(value);

    row.append(label, valueWrap);
    list.appendChild(row);
  }

  return list;
}

function createSprintWeekList() {
  const list = document.createElement("div");
  list.className = "simple-list";

  const checkpoints = [
    ["Plan", "Refine the top priorities and keep the weekly goal visible.", "Mon"],
    ["Build", "Pull active work through the board and keep the flow steady.", "Wed"],
    ["Review", "Check completed work, tighten loose ends, and prep the handoff.", "Fri"]
  ];

  for (const [title, description, badge] of checkpoints) {
    list.appendChild(createSimpleItem(title, description, badge));
  }

  return list;
}

function createBoardView() {
  const board = document.createElement("div");
  board.className = "kanban";

  const refs = {};

  for (const laneDefinition of taskLaneDefinitions) {
    const lane = document.createElement("article");
    lane.className = "lane";

    const head = document.createElement("div");
    head.className = "lane-head";

    const title = document.createElement("h2");
    title.className = "lane-title";
    title.textContent = laneDefinition.title;

    const count = document.createElement("span");
    count.className = "lane-count";
    count.textContent = "0";

    head.append(title, count);

    const list = document.createElement("div");
    list.className = "task-list";

    lane.append(head, list);
    board.appendChild(lane);

    refs[laneDefinition.key] = { list, count };
  }

  taskLaneRefs = refs;
  return board;
}

function createLaneEmpty(message) {
  const empty = document.createElement("div");
  empty.className = "lane-empty";
  empty.textContent = message;
  return empty;
}

function renderTasks() {
  if (!taskLaneRefs) {
    return;
  }

  const grouped = {
    todo: [],
    "in-progress": [],
    review: [],
    done: []
  };

  for (const task of tasks) {
    grouped[normalizeTaskStatus(task.status)].push(task);
  }

  for (const laneDefinition of taskLaneDefinitions) {
    const refs = taskLaneRefs[laneDefinition.key];

    if (!refs) {
      continue;
    }

    const laneTasks = grouped[laneDefinition.key];
    refs.count.textContent = String(laneTasks.length);
    refs.list.replaceChildren();

    if (!laneTasks.length) {
      refs.list.appendChild(createLaneEmpty("No tasks yet."));
      continue;
    }

    for (const task of laneTasks) {
      const card = document.createElement("article");
      const normalizedPriority = normalizeTaskPriority(task.priority);
      card.className = `task-card priority-${normalizedPriority}`;

      const dot = document.createElement("span");
      dot.className = "task-dot";
      dot.setAttribute("aria-hidden", "true");

      const title = document.createElement("h3");
      title.className = "task-title";
      title.textContent = task.taskName || "Untitled task";

      const description = document.createElement("p");
      description.className = "task-description";
      description.textContent = task.description || "No description added.";

      card.append(dot, title, description);
      refs.list.appendChild(card);
    }
  }
}

function renderWorkspaceSection(section, space) {
  if (!workspaceContent) {
    return;
  }

  workspaceContent.replaceChildren();
  taskLaneRefs = null;

  if (!space) {
    workspaceContent.appendChild(
      createEmptyState(
        "No space selected",
        "Create a space first, then open one of the tabs above to view the board, backlog, and team details."
      )
    );
    return;
  }

  if (section === "board") {
    workspaceContent.appendChild(createBoardView());
    renderTasks();
    return;
  }

  if (section === "backlog") {
    workspaceContent.append(
      createSectionCard("Workspace", "Backlog", "Open work waiting to be picked up in this space."),
      createTaskSummaryList(
        tasks.filter((task) => normalizeTaskStatus(task.status) !== "done"),
        "No open work in the backlog yet."
      )
    );
    return;
  }

  if (section === "sprint-week") {
    workspaceContent.append(
      createSectionCard("Workspace", "Sprint Week", "A clean weekly view for planning, progress, and review."),
      createSprintWeekList()
    );
    return;
  }

  if (section === "see-teams" || section === "members") {
    const memberUids = Array.isArray(space.memberUids) ? space.memberUids : [];

    workspaceContent.append(
      createSectionCard(
        "Workspace",
        section === "members" ? "Members" : "See Teams",
        "People currently collaborating in this space."
      ),
      createMemberList(memberUids)
    );
    return;
  }

  if (section === "space-info") {
    const memberUids = Array.isArray(space.memberUids) ? space.memberUids : [];

    workspaceContent.append(
      createSectionCard("Workspace", "Space Info", "Key project details for the selected space."),
      createInfoList([
        ["Project name", space.projectName || "Untitled space"],
        ["Project key", space.projectKey || "------"],
        ["Members", `${memberUids.length} member${memberUids.length === 1 ? "" : "s"}`],
        ["Tasks", `${tasks.length} task${tasks.length === 1 ? "" : "s"}`]
      ])
    );
    return;
  }

  if (section === "see-all-work") {
    workspaceContent.append(
      createSectionCard("Workspace", "See All Work", "A combined list of every task in this space."),
      createTaskSummaryList(tasks, "No tasks have been created yet.")
    );
    return;
  }

  workspaceContent.append(
    createSectionCard("Workspace", "Workspace", "Select a tab to view content for this space.")
  );
}

function syncWorkspaceForSelectedSpace() {
  const space = getSelectedSpace();
  const nextSpaceKey = space ? space.key : null;

  if (currentTasksSpaceKey !== nextSpaceKey) {
    if (tasksUnsubscribe) {
      tasksUnsubscribe();
      tasksUnsubscribe = null;
    }

    currentTasksSpaceKey = nextSpaceKey;
    tasks = [];
    renderWorkspaceSection(activeBoardSection, space);

    if (!space || !currentUser) {
      return;
    }

    const taskRef = collection(db, "users", currentUser.uid, "spaces", space.id, "tasks");
    tasksUnsubscribe = onSnapshot(
      taskRef,
      (snapshot) => {
        if (currentTasksSpaceKey !== nextSpaceKey) {
          return;
        }

        tasks = snapshot.docs
          .map((taskDoc) => ({ id: taskDoc.id, ...taskDoc.data() }))
          .sort((a, b) => (b.clientCreatedAt || 0) - (a.clientCreatedAt || 0));

        renderWorkspaceSection(activeBoardSection, getSelectedSpace());
      },
      (error) => {
        console.error("Task listener failed:", error);
        showToast("Could not load tasks from Firebase.");
      }
    );

    return;
  }

  renderWorkspaceSection(activeBoardSection, space);
}

function renderSpaces() {
  if (!spaceCount || !spaceList) {
    return;
  }

  spaceCount.textContent = String(spaces.length);
  spaceList.replaceChildren();

  if (!spaces.length) {
    const empty = document.createElement("div");
    empty.className = "space-empty";
    empty.textContent = "No spaces yet. Create your first space.";
    spaceList.appendChild(empty);
    return;
  }

  for (const space of spaces) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `space-item${space.key === selectedSpaceKey ? " active" : ""}`;

    const content = document.createElement("div");
    content.className = "space-item__content";

    const title = document.createElement("strong");
    title.textContent = space.projectName || "Untitled space";

    const key = document.createElement("span");
    key.textContent = space.projectKey ? `Key ${space.projectKey}` : "No key";

    content.append(title, key);
    item.append(content);
    item.addEventListener("click", () => {
      selectedSpaceKey = space.key;
      renderWorkspace();
      closeSidebar();
    });

    spaceList.appendChild(item);
  }
}

function renderWorkspace() {
  renderSpaces();
  renderWorkspaceHeader(getSelectedSpace());
  syncWorkspaceForSelectedSpace();
}

async function createSpace(projectName, projectKey) {
  const payload = {
    projectName,
    projectKey,
    ownerUid: currentUser.uid,
    memberUids: [currentUser.uid],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    clientCreatedAt: Date.now()
  };

  const ref = await addDoc(collection(db, "users", currentUser.uid, "spaces"), payload);

  return {
    id: ref.id,
    path: ref.path,
    key: `${currentUser.uid}:${ref.id}`,
    ...payload
  };
}

function startSpacesListener(uid) {
  if (nestedSpacesUnsubscribe) {
    nestedSpacesUnsubscribe();
    nestedSpacesUnsubscribe = null;
  }

  nestedSpaces = [];
  syncSpaces();

  const nestedQueryRef = collection(db, "users", uid, "spaces");
  nestedSpacesUnsubscribe = onSnapshot(
    nestedQueryRef,
    (snapshot) => {
      const nextSpaces = snapshot.docs
        .map((spaceDoc) =>
          normalizeSpaceDoc(
            {
              id: spaceDoc.id,
              path: spaceDoc.ref.path,
              ...spaceDoc.data()
            },
            uid
          )
        )
        .sort((a, b) => (b.clientCreatedAt || 0) - (a.clientCreatedAt || 0));

      nestedSpaces = nextSpaces;
      syncSpaces();
    },
    (error) => {
      console.error("Space listener failed:", error);
      showToast("Could not load spaces from Firebase.");
    }
  );
}

function handleBoardNavClick(button) {
  setActiveBoardSection(button.dataset.boardSection || "board");
  renderWorkspaceSection(activeBoardSection, getSelectedSpace());
}

syncTopbarHeight();
window.requestAnimationFrame(syncTopbarHeight);

function handleResize() {
  syncTopbarHeight();

  if (!isMobileLayout()) {
    closeSidebar();
  }
}

window.addEventListener("resize", handleResize);

if (sidebarToggle) {
  sidebarToggle.addEventListener("click", toggleSidebar);
}

if (sidebarOverlay) {
  sidebarOverlay.addEventListener("click", closeSidebar);
}

if (createSpaceBtn) {
  createSpaceBtn.addEventListener("click", openSpaceModal);
}

if (createTaskBtn) {
  createTaskBtn.addEventListener("click", openTaskModal);
}

for (const button of boardNavButtons) {
  button.addEventListener("click", () => {
    handleBoardNavClick(button);
  });
}

if (closeSpaceModalBtn) {
  closeSpaceModalBtn.addEventListener("click", closeSpaceModal);
}

if (cancelSpace) {
  cancelSpace.addEventListener("click", closeSpaceModal);
}

if (closeTaskModalBtn) {
  closeTaskModalBtn.addEventListener("click", closeTaskModal);
}

if (cancelTask) {
  cancelTask.addEventListener("click", closeTaskModal);
}

if (spaceModal) {
  spaceModal.addEventListener("click", (event) => {
    if (event.target === spaceModal) {
      closeSpaceModal();
    }
  });
}

if (taskModal) {
  taskModal.addEventListener("click", (event) => {
    if (event.target === taskModal) {
      closeTaskModal();
    }
  });
}

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  if (spaceModal && !spaceModal.hidden) {
    closeSpaceModal();
  }

  if (taskModal && !taskModal.hidden) {
    closeTaskModal();
  }

  if (appShell && appShell.classList.contains("sidebar-open")) {
    closeSidebar();
  }
});

if (spaceForm) {
  spaceForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentUser) {
      return;
    }

    const projectName = projectNameInput.value.trim();

    if (!projectName) {
      showToast("Please enter a project name.");
      projectNameInput.focus();
      return;
    }

    submitSpace.disabled = true;

    try {
      const projectKey = projectKeyInput.value || generateKey();
      projectKeyInput.value = projectKey;
      const createdSpace = await createSpace(projectName, projectKey);

      selectedSpaceKey = createdSpace.key;
      nestedSpaces = [
        createdSpace,
        ...nestedSpaces.filter((space) => space.key !== createdSpace.key)
      ];
      syncSpaces();
      closeSpaceModal();
      showToast(`Space "${projectName}" created.`);
    } catch (error) {
      console.error(error);
      showToast("Could not create this space right now.");
    } finally {
      submitSpace.disabled = false;
    }
  });
}

if (taskForm) {
  taskForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentUser) {
      return;
    }

    const taskSpace = spaces.find((space) => space.key === taskSpaceInput.value) || null;

    if (!taskSpace) {
      showToast("Select a space first.");
      return;
    }

    const taskName = taskNameInput.value.trim();

    if (!taskName) {
      showToast("Please enter a task name.");
      taskNameInput.focus();
      return;
    }

    const payload = {
      taskName,
      description: taskDescriptionInput.value.trim(),
      spaceId: taskSpace.id,
      spaceKey: taskSpace.projectKey || "",
      spaceName: taskSpace.projectName || "",
      spaceOwnerUid: currentUser.uid,
      issueTag: taskIssueTagInput.value,
      priority: taskPriorityInput.value,
      status: normalizeTaskStatus(taskStatusInput.value),
      assignee: taskAssigneeInput.value.trim(),
      ownerUid: currentUser.uid,
      createdByUid: currentUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      clientCreatedAt: Date.now()
    };

    submitTask.disabled = true;

    try {
      await addDoc(collection(db, "users", currentUser.uid, "spaces", taskSpace.id, "tasks"), payload);
      selectedSpaceKey = taskSpace.key;
      renderWorkspace();
      closeTaskModal();
      showToast(`Task "${taskName}" created.`);
    } catch (error) {
      console.error(error);
      showToast(
        error?.code === "permission-denied"
          ? "Firebase rules are still blocking task save. Publish the updated Firestore rules."
          : "Could not create this task right now."
      );
    } finally {
      submitTask.disabled = false;
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
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
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.replace("index.html");
    return;
  }

  currentUser = user;
  if (accountImage) {
    accountImage.src = user.photoURL || "user.png";
    accountImage.alt = user.displayName ? `${user.displayName} account image` : "User account";
  }

  startSpacesListener(user.uid);
  void migrateLegacySpaces(user.uid).catch((error) => {
    console.warn("Legacy space migration skipped:", error);
  });
});

setActiveBoardSection("board");
setSidebarOpen(false);
renderWorkspace();
