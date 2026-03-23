// ====== 引入 Firebase 核心套件 ======
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getDatabase, ref, set, get, onValue, update, remove, onDisconnect, off } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-database.js";

// ====== Firebase 設定 (使用你的專屬金鑰) ======
const firebaseConfig = {
  apiKey: "AIzaSyAmfHGNhM-qLI_i772aT5Sh-VdrYIJNks0",
  authDomain: "artale-romeo-et-juliette.firebaseapp.com",
  databaseURL: "https://artale-romeo-et-juliette-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "artale-romeo-et-juliette",
  storageBucket: "artale-romeo-et-juliette.firebasestorage.app",
  messagingSenderId: "984532908971",
  appId: "1:984532908971:web:45ebb6bedce192039770ee",
  measurementId: "G-RXZ7YHJ5F5"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ====== 遊戲常數與 DOM 元素 ======
const PLAYER_META = {
  1: { color: "#ff2d55" },
  2: { color: "#00a6fb" },
  3: { color: "#16db65" },
  4: { color: "#ffbe0b" }
};

const LEVELS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

const roomInput = document.querySelector("#roomInput");
const generateRoomBtn = document.querySelector("#generateRoomBtn");
const copyRoomBtn = document.querySelector("#copyRoomBtn");
const nameInput = document.querySelector("#nameInput");
const seatPicker = document.querySelector("#seatPicker");
const joinBtn = document.querySelector("#joinBtn");
const leaveBtn = document.querySelector("#leaveBtn");
const resetBtn = document.querySelector("#resetBtn");
const statusText = document.querySelector("#statusText");
const board = document.querySelector("#board");
const themeToggleBtn = document.querySelector("#themeToggleBtn");

// ====== 全局狀態變數 ======
let uid = getOrCreateClientId();
let mySeat = null;
let mySeatRef = null;
let activeRoomId = null;
let latestSnapshot = createEmptySnapshot();
let myDisplayName = "未命名玩家";

// ====== 啟動 ======
initializeUi();

function initializeUi() {
  const savedName = localStorage.getItem("board-nickname") || "";
  nameInput.value = savedName;
  roomInput.value = "";
  applySavedTheme();

  renderSeatButtons();
  renderBoard();

  joinBtn.addEventListener("click", joinRoom);
  leaveBtn.addEventListener("click", () => leaveRoom(false));
  resetBtn.addEventListener("click", resetBoard);
  generateRoomBtn.addEventListener("click", () => {
    if (activeRoomId) {
      setStatus("若要創建新房間，請先離開目前房間。");
      return;
    }
    roomInput.value = createRoomId();
    setStatus("已創建房號，按下加入房間即可進入。");
  });
  copyRoomBtn.addEventListener("click", copyRoomId);
  themeToggleBtn.addEventListener("click", toggleTheme);
  board.addEventListener("click", handleBoardClick);

  setStatus("可輸入房號加入，或先創建房間再加入。");
}

/* --- 主題與外觀 --- */
function applySavedTheme() {
  const savedTheme = localStorage.getItem("board-theme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const mode = savedTheme || (prefersDark ? "dark" : "light");
  const isDark = mode === "dark";
  document.body.classList.toggle("dark", isDark);
  updateThemeToggleIcon(isDark);
}

function toggleTheme() {
  const isDark = document.body.classList.toggle("dark");
  localStorage.setItem("board-theme", isDark ? "dark" : "light");
  updateThemeToggleIcon(isDark);
  playThemeToggleAnimation();
}

function updateThemeToggleIcon(isDark) {
  themeToggleBtn.textContent = isDark ? "☀️" : "🌙";
  const label = isDark ? "切換為淺色模式" : "切換為深色模式";
  themeToggleBtn.setAttribute("aria-label", label);
  themeToggleBtn.setAttribute("title", label);
}

function playThemeToggleAnimation() {
  themeToggleBtn.classList.remove("theme-bounce");
  void themeToggleBtn.offsetWidth;
  themeToggleBtn.classList.add("theme-bounce");
}

function renderSeatButtons(seatsState = {}) {
  seatPicker.innerHTML = "";
  [1, 2, 3, 4].forEach((seat) => {
    const seatData = seatsState[seat];
    const button = document.createElement("button");
    button.className = "seat-btn";
    if (mySeat === seat) button.classList.add("selected");
    button.disabled = true;

    const seatName = getSeatDisplayName(seat, seatData);
    const seatState = seatData ? `已由 ${escapeHtml(seatData.name || "未命名玩家")} 使用` : "";

    button.innerHTML = `
      <span class="chip" style="background:${PLAYER_META[seat].color}"></span>
      <span class="label">${seatName}</span>
      ${seatState ? `<span class="seat-state">${seatState}</span>` : ""}
    `;
    seatPicker.appendChild(button);
  });
}

function renderBoard(gridState = {}, seatsState = {}) {
  board.innerHTML = "";
  LEVELS.forEach((level) => {
    const row = document.createElement("div");
    row.className = "board-row";

    const label = document.createElement("div");
    label.className = "level-label";
    label.textContent = String(level);
    row.appendChild(label);

    [1, 2, 3, 4].forEach((seat) => {
      const key = `L${level}-${seat}`;
      const markerSeat = gridState[key] || null;
      const button = document.createElement("button");
      button.className = "cell";
      button.dataset.level = String(level);
      button.dataset.seat = String(seat);

      if (markerSeat) {
        button.classList.add("active");
        button.style.backgroundColor = PLAYER_META[markerSeat].color;
        button.textContent = getSeatDisplayName(markerSeat, seatsState[markerSeat]);
      }
      button.disabled = !activeRoomId;
      row.appendChild(button);
    });
    board.appendChild(row);
  });
}

/* --- Firebase 核心連線邏輯 --- */
async function joinRoom() {
  const roomId = sanitizeRoomId(roomInput.value);
  if (!roomId) {
    setStatus("請輸入有效房號，或先點擊創建房間。");
    return;
  }
  
  const name = (nameInput.value || "未命名玩家").trim().slice(0, 20);
  localStorage.setItem("board-nickname", name);

  if (activeRoomId) await leaveRoom(true);

  activeRoomId = roomId;
  myDisplayName = name;

  joinBtn.disabled = true;
  leaveBtn.disabled = true;
  resetBtn.disabled = true;
  generateRoomBtn.disabled = true;
  setStatus(`正在加入房間 ${roomId}...`);

  try {
    const roomRef = ref(db, `rooms/${activeRoomId}`);
    const seatsRef = ref(db, `rooms/${activeRoomId}/seats`);
    
    // 1. 抓取目前座位狀況
    const snapshot = await get(seatsRef);
    const currentSeats = snapshot.val() || {};

    // 2. 尋找座位 (優先找自己原本的，沒有的話找空位)
    let targetSeat = null;
    for (let i = 1; i <= 4; i++) {
      if (currentSeats[i] && currentSeats[i].uid === uid) {
        targetSeat = i; break;
      }
    }
    if (!targetSeat) {
      for (let i = 1; i <= 4; i++) {
        if (!currentSeats[i]) {
          targetSeat = i; break;
        }
      }
    }

    if (!targetSeat) {
      setStatus("房間已滿（4/4），請稍後再試。");
      await leaveRoom(true);
      return;
    }

    // 3. 佔據座位並設定斷線自動離開
    mySeat = targetSeat;
    mySeatRef = ref(db, `rooms/${activeRoomId}/seats/${mySeat}`);
    await set(mySeatRef, { uid, name: myDisplayName });
    onDisconnect(mySeatRef).remove(); // 斷線時 Firebase 會自動清空這格

    // 4. 開始即時監聽房間變化
    onValue(roomRef, (roomSnapshot) => {
      const data = roomSnapshot.val() || { seats: {}, grid: {} };
      latestSnapshot.seats = data.seats || {};
      latestSnapshot.grid = data.grid || {};

      // 檢查：如果有其他玩家斷線遺留了標記，順手幫忙清掉
      autoCleanupOrphanedGrid(latestSnapshot.seats, latestSnapshot.grid);

      renderSeatButtons(latestSnapshot.seats);
      renderBoard(latestSnapshot.grid, latestSnapshot.seats);
      setStatus(`連線狀態：已連線，房內 ${Object.keys(latestSnapshot.seats).length} 人`);
    });

    leaveBtn.disabled = false;
    resetBtn.disabled = false;

  } catch (error) {
    console.error(error);
    setStatus(`加入失敗：檢查網路或資料庫權限。`);
    await leaveRoom(true);
  }
}

function handleBoardClick(event) {
  const button = event.target.closest("button.cell");
  if (!button || !activeRoomId || !mySeat) return;

  const clickedColumn = Number(button.dataset.seat);
  const level = Number(button.dataset.level);

  // 準備一包更新資料：把同一層的舊位置清空，並設定新位置
  const updates = {};
  [1, 2, 3, 4].forEach(col => {
    if (latestSnapshot.grid[`L${level}-${col}`] === mySeat) {
      updates[`L${level}-${col}`] = null;
    }
  });
  updates[`L${level}-${clickedColumn}`] = mySeat;

  // 一次性推送給 Firebase
  update(ref(db, `rooms/${activeRoomId}/grid`), updates);
}

function resetBoard() {
  if (!activeRoomId || !mySeat) return;
  // 直接清空整個網格資料
  remove(ref(db, `rooms/${activeRoomId}/grid`));
}

async function leaveRoom(silent = false) {
  if (activeRoomId) {
    // 停止監聽資料庫
    off(ref(db, `rooms/${activeRoomId}`));
    
    // 離開時，清除自己留在地圖上的格子
    const myGridUpdates = {};
    Object.keys(latestSnapshot.grid).forEach(key => {
      if (latestSnapshot.grid[key] === mySeat) {
        myGridUpdates[key] = null;
      }
    });
    if (Object.keys(myGridUpdates).length > 0) {
      update(ref(db, `rooms/${activeRoomId}/grid`), myGridUpdates);
    }

    // 讓出座位
    if (mySeatRef) {
      onDisconnect(mySeatRef).cancel();
      await remove(mySeatRef);
      mySeatRef = null;
    }
  }

  activeRoomId = null;
  mySeat = null;
  latestSnapshot = createEmptySnapshot();

  joinBtn.disabled = false;
  leaveBtn.disabled = true;
  resetBtn.disabled = true;
  generateRoomBtn.disabled = false;

  renderSeatButtons();
  renderBoard();

  if (!silent) setStatus("已離開房間。");
}

/* --- 自動清理斷線玩家遺留的標記 --- */
function autoCleanupOrphanedGrid(currentSeats, currentGrid) {
  if (!mySeat) return; // 只有在房間裡的人需要幫忙清
  
  const updates = {};
  let needsCleanup = false;
  
  Object.keys(currentGrid).forEach(key => {
    const ownerSeat = currentGrid[key];
    if (!currentSeats[ownerSeat]) {
      updates[key] = null;
      needsCleanup = true;
    }
  });

  if (needsCleanup) {
    update(ref(db, `rooms/${activeRoomId}/grid`), updates);
  }
}

/* --- 工具函式 --- */
function createEmptySnapshot() {
  return { seats: {}, grid: {} };
}

function createRoomId() {
  const arr = new Uint32Array(2);
  crypto.getRandomValues(arr);
  return `${arr[0].toString(36)}-${arr[1].toString(36)}`.slice(0, 11);
}

function sanitizeRoomId(input) {
  return String(input).trim().toLowerCase().replace(/[^a-z0-9-_]/g, "").slice(0, 32);
}

function getOrCreateClientId() {
  const key = "board-client-id";
  const cached = sessionStorage.getItem(key);
  if (cached) return cached;
  const id = `u-${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem(key, id);
  return id;
}

function getSeatDisplayName(seat, seatData) {
  if (seatData?.name && seatData.name.trim()) return escapeHtml(seatData.name.trim());
  return `玩家 ${seat}`;
}

function setStatus(message) {
  statusText.textContent = message;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function copyRoomId() {
  const roomId = roomInput.value.trim();
  if (!roomId) return setStatus("目前沒有可複製的房號。");
  try {
    await navigator.clipboard.writeText(roomId);
    setStatus("房號已複製。");
  } catch {
    roomInput.focus();
    roomInput.select();
    document.execCommand("copy");
    setStatus("房號已複製。");
  }
}

window.addEventListener("beforeunload", () => leaveRoom(true));