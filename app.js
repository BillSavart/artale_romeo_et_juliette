// 【修改點】移除了 import Peer from "peerjs";

// 【修改點】新增 STUN 伺服器設定，大幅提高 P2P 穿透成功率
const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" } // 多加一個 Twilio 的備用，增加穩定性
    ]
  }
};

const PLAYER_META = {
  1: { color: "#ff2d55" },
  2: { color: "#00a6fb" },
  3: { color: "#16db65" },
  4: { color: "#ffbe0b" }
};

const LEVELS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
const HEARTBEAT_MS = 5000;
const SEAT_STALE_MS = 15000;

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

let uid = getOrCreateClientId();
let mySeat = null;
let activeRoomId = null;
let peer = null;
let isHost = false;
let hostPeerId = null;
let hostConnection = null;
let clients = new Map();
let heartbeatTimer = null;
let staleCleanupTimer = null;
let latestSnapshot = createEmptySnapshot();
let myDisplayName = "未命名玩家";

initializeUi();

function initializeUi() {
  const savedName = localStorage.getItem("board-nickname") || "";
  nameInput.value = savedName;
  roomInput.value = "";
  applySavedTheme();

  renderSeatButtons();
  renderBoard();

  joinBtn.addEventListener("click", joinRoom);
  leaveBtn.addEventListener("click", leaveRoom);
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
  
  // 【彩蛋補充】把我們剛剛討論的「死路標記（紅X）」補回來給你，使用右鍵觸發！
  board.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const button = event.target.closest("button.cell");
    if (!button || !activeRoomId) return;
    
    // 改變按鈕的背景色為灰色，代表死路 (僅限本機視覺)
    if (button.style.backgroundColor === "gray") {
      button.style.backgroundColor = "";
      button.textContent = "";
    } else {
      button.style.backgroundColor = "gray";
      button.textContent = "X";
    }
  });

  setStatus("請先創建房間，再按加入房間。");
}

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
    button.type = "button";
    button.className = "seat-btn";
    button.dataset.seat = String(seat);

    if (mySeat === seat) {
      button.classList.add("selected");
    }
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
      button.type = "button";
      button.className = "cell";
      button.dataset.level = String(level);
      button.dataset.seat = String(seat);
      button.title = `第 ${level} 層 - 第 ${seat} 欄`;

      if (markerSeat) {
        button.classList.add("active");
        button.style.backgroundColor = PLAYER_META[markerSeat].color;
        button.textContent = getSeatDisplayName(markerSeat, seatsState[markerSeat]);
      } else {
        button.textContent = "";
      }

      button.disabled = !activeRoomId;
      row.appendChild(button);
    });

    board.appendChild(row);
  });
}

async function joinRoom() {
  const roomId = roomInput.value.trim();
  if (!roomId) {
    setStatus("請先點擊創建房間。");
    return;
  }

  const name = (nameInput.value || "未命名玩家").trim().slice(0, 20) || "未命名玩家";
  localStorage.setItem("board-nickname", name);

  if (activeRoomId) {
    await leaveRoom();
  }

  activeRoomId = roomId;
  myDisplayName = name;
  hostPeerId = makeHostPeerId(roomId);

  joinBtn.disabled = true;
  leaveBtn.disabled = true;
  resetBtn.disabled = true;
  generateRoomBtn.disabled = true;

  setStatus(`正在加入房間 ${roomId}...`);

  try {
    await connectAsHostOrClient(roomId, name);
  } catch (error) {
    setStatus(`加入失敗：${error?.message || "未知錯誤"}`);
    await leaveRoom(true);
    return;
  }

  leaveBtn.disabled = false;
  resetBtn.disabled = false;
  setStatus(`已加入房間 ${roomId}，目前玩家：${mySeat ? `玩家 ${mySeat}` : "尚未分配"}。`);
}

async function copyRoomId() {
  const roomId = roomInput.value.trim();
  if (!roomId) {
    setStatus("目前沒有可複製的房號，請先創建房間。");
    return;
  }

  try {
    await navigator.clipboard.writeText(roomId);
    setStatus("房號已複製。");
  } catch {
    roomInput.focus();
    roomInput.select();
    const copied = document.execCommand("copy");
    setStatus(copied ? "房號已複製。" : "複製失敗，請手動複製房號。");
  }
}

async function connectAsHostOrClient(roomId, name) {
  try {
    const hostPeer = await openPeerWithId(hostPeerId);
    peer = hostPeer;
    isHost = true;
    becomeHost(name);
    claimSeatOnHost(uid, name, peer.id);
    startTimers();
    publishSnapshot();
    return;
  } catch (error) {
    if (!String(error?.message || "").includes("ID") && !String(error?.type || "").includes("unavailable")) {
      throw error;
    }
  }

  peer = await openPeerRandom();
  isHost = false;

  peer.on("connection", (incoming) => {
    incoming.on("open", () => {
      incoming.close();
    });
  });

  hostConnection = peer.connect(hostPeerId, {
    reliable: true,
    serialization: "json"
  });

  await waitForConnectionOpen(hostConnection, 8000);
  setupHostConnectionListeners(hostConnection);

  hostConnection.send({
    type: "hello",
    payload: { uid, name, peerId: peer.id }
  });

  hostConnection.send({
    type: "claim-seat",
    payload: { uid, name, peerId: peer.id }
  });

  startTimers();
}

function becomeHost(name) {
  latestSnapshot = createEmptySnapshot();
  peer.on("connection", (conn) => setupClientConnection(conn));
  setStatus(`你是房主，正在分發房間 ${activeRoomId} 狀態。`);
  claimSeatOnHost(uid, name, peer.id);
}

function setupClientConnection(conn) {
  conn.on("open", () => {
    clients.set(conn.peer, conn);
    conn.on("data", (message) => handleClientMessage(conn, message));
    conn.on("close", () => {
      clients.delete(conn.peer);
      releaseSeatByPeerId(conn.peer);
      publishSnapshot();
    });
    conn.on("error", () => {
      clients.delete(conn.peer);
      releaseSeatByPeerId(conn.peer);
      publishSnapshot();
    });
    publishSnapshotTo(conn);
  });
}

function setupHostConnectionListeners(conn) {
  conn.on("data", (message) => {
    if (!message || typeof message !== "object") return;

    if (message.type === "snapshot") {
      applySnapshot(message.payload);
      return;
    }
    if (message.type === "room-full") {
      setStatus("房間已滿（4/4），請稍後再試。");
      return;
    }
    if (message.type === "host-closing") {
      setStatus("房主已離線，請重新加入房間。\n");
    }
  });

  conn.on("close", () => {
    if (activeRoomId) {
      setStatus("與房主中斷連線，請重新加入房間。");
      leaveRoom(true);
    }
  });

  conn.on("error", () => {
    if (activeRoomId) {
      setStatus("連線異常，請重新加入房間。");
      leaveRoom(true);
    }
  });
}

function handleClientMessage(conn, message) {
  if (!message || typeof message !== "object") return;
  const payload = message.payload || {};

  if (message.type === "hello") {
    claimSeatOnHost(payload.uid, payload.name, payload.peerId || conn.peer, false);
    publishSnapshot();
  } else if (message.type === "claim-seat") {
    const seat = claimSeatOnHost(payload.uid, payload.name, payload.peerId || conn.peer, true);
    if (seat === null) safeSend(conn, { type: "room-full" });
    publishSnapshot();
  } else if (message.type === "heartbeat") {
    updateSeatHeartbeat(payload.uid, payload.name, payload.peerId || conn.peer);
    publishSnapshot();
  } else if (message.type === "set-cell") {
    applySetCellFromUser(payload.uid, payload.level, payload.seat);
    publishSnapshot();
  } else if (message.type === "reset") {
    applyResetFromUser(payload.uid);
    publishSnapshot();
  } else if (message.type === "leave") {
    releaseSeatByUid(payload.uid);
    publishSnapshot();
  }
}

function claimSeatOnHost(targetUid, targetName, targetPeerId, strictCapacity = false) {
  if (!isHost) return null;

  const existingSeat = getSeatByUid(targetUid, latestSnapshot.seats);
  if (existingSeat) {
    const seatData = latestSnapshot.seats[existingSeat];
    latestSnapshot.seats[existingSeat] = {
      ...seatData,
      name: (targetName || seatData.name || "未命名玩家").slice(0, 20),
      peerId: targetPeerId || seatData.peerId,
      lastSeen: Date.now()
    };
    if (targetUid === uid) mySeat = existingSeat;
    return existingSeat;
  }

  const openSeat = [1, 2, 3, 4].find((seat) => !latestSnapshot.seats[seat]);
  if (!openSeat) return strictCapacity ? null : existingSeat;

  latestSnapshot.seats[openSeat] = {
    uid: targetUid,
    name: (targetName || "未命名玩家").slice(0, 20),
    peerId: targetPeerId,
    color: PLAYER_META[openSeat].color,
    seat: openSeat,
    lastSeen: Date.now()
  };

  if (targetUid === uid) mySeat = openSeat;
  return openSeat;
}

function updateSeatHeartbeat(targetUid, targetName, targetPeerId) {
  if (!isHost) return;
  const seat = getSeatByUid(targetUid, latestSnapshot.seats);
  if (!seat) {
    claimSeatOnHost(targetUid, targetName, targetPeerId, false);
    return;
  }
  latestSnapshot.seats[seat] = {
    ...latestSnapshot.seats[seat],
    name: (targetName || latestSnapshot.seats[seat].name || "未命名玩家").slice(0, 20),
    peerId: targetPeerId || latestSnapshot.seats[seat].peerId,
    lastSeen: Date.now()
  };
}

function applySetCellFromUser(targetUid, level, seat) {
  const targetSeat = getSeatByUid(targetUid, latestSnapshot.seats);
  if (!targetSeat) return;
  const targetColumn = Number(seat);
  const targetLevel = Number(level);
  if (!LEVELS.includes(targetLevel)) return;
  if (![1, 2, 3, 4].includes(targetColumn)) return;

  // 同一層只保留該玩家一個格子：先移除舊位置，再設為新位置。
  [1, 2, 3, 4].forEach((column) => {
    const key = `L${targetLevel}-${column}`;
    if (Number(latestSnapshot.grid[key]) === targetSeat) {
      delete latestSnapshot.grid[key];
    }
  });

  latestSnapshot.grid[`L${targetLevel}-${targetColumn}`] = targetSeat;
}

function applyResetFromUser(targetUid) {
  if (!getSeatByUid(targetUid, latestSnapshot.seats)) return;
  latestSnapshot.grid = {};
}

function applySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return;

  latestSnapshot = {
    seats: { ...(snapshot.seats || {}) },
    grid: { ...(snapshot.grid || {}) },
    hostPeerId: snapshot.hostPeerId || hostPeerId || "",
    ts: Number(snapshot.ts) || Date.now()
  };

  mySeat = getSeatByUid(uid, latestSnapshot.seats) || null;

  renderSeatButtons(latestSnapshot.seats);
  renderBoard(latestSnapshot.grid, latestSnapshot.seats);

  const roleText = isHost ? "房主" : "玩家";
  const connectedPlayers = Object.keys(latestSnapshot.seats).length;
  setStatus(`連線狀態：${roleText}，房內 ${connectedPlayers} 人`);
}

function publishSnapshot() {
  if (!isHost) return;
  latestSnapshot.hostPeerId = hostPeerId;
  latestSnapshot.ts = Date.now();
  cleanupStaleSeats();
  applySnapshot(latestSnapshot);
  clients.forEach((conn) => publishSnapshotTo(conn));
}

function publishSnapshotTo(conn) {
  safeSend(conn, { type: "snapshot", payload: latestSnapshot });
}

function safeSend(conn, message) {
  if (!conn || !conn.open) return;
  try {
    conn.send(message);
  } catch {}
}

function cleanupStaleSeats() {
  const now = Date.now();
  [1, 2, 3, 4].forEach((seat) => {
    const seatData = latestSnapshot.seats[seat];
    if (seatData && now - seatData.lastSeen > SEAT_STALE_MS) {
      delete latestSnapshot.seats[seat];
      clearGridBySeat(seat);
    }
  });
}

function clearGridBySeat(seat) {
  Object.keys(latestSnapshot.grid).forEach((key) => {
    if (Number(latestSnapshot.grid[key]) === Number(seat)) {
      delete latestSnapshot.grid[key];
    }
  });
}

function releaseSeatByUid(targetUid) {
  const seat = getSeatByUid(targetUid, latestSnapshot.seats);
  if (seat) {
    delete latestSnapshot.seats[seat];
    clearGridBySeat(seat);
  }
}

function releaseSeatByPeerId(targetPeerId) {
  const seat = [1, 2, 3, 4].find((candidate) => latestSnapshot.seats[candidate]?.peerId === targetPeerId);
  if (seat) {
    delete latestSnapshot.seats[seat];
    clearGridBySeat(seat);
  }
}

async function leaveRoom(silent = false) {
  if (activeRoomId) {
    if (isHost) {
      clients.forEach((conn) => {
        safeSend(conn, { type: "host-closing" });
        conn.close();
      });
      clients.clear();
    } else if (hostConnection?.open) {
      safeSend(hostConnection, { type: "leave", payload: { uid } });
      hostConnection.close();
    }
  }

  stopTimers();
  if (peer) peer.destroy();

  peer = null;
  hostConnection = null;
  activeRoomId = null;
  isHost = false;
  hostPeerId = null;
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

function stopTimers() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (staleCleanupTimer) clearInterval(staleCleanupTimer);
  heartbeatTimer = null;
  staleCleanupTimer = null;
}

function startTimers() {
  stopTimers();
  heartbeatTimer = setInterval(() => {
    if (!activeRoomId) return;
    if (isHost) {
      updateSeatHeartbeat(uid, myDisplayName, peer?.id);
      publishSnapshot();
    } else if (hostConnection?.open) {
      safeSend(hostConnection, {
        type: "heartbeat",
        payload: { uid, name: myDisplayName, peerId: peer?.id }
      });
    }
  }, HEARTBEAT_MS);

  if (isHost) {
    staleCleanupTimer = setInterval(() => {
      if (!activeRoomId) return;
      cleanupStaleSeats();
      publishSnapshot();
    }, HEARTBEAT_MS);
  }
}

function resetBoard() {
  if (!activeRoomId || !mySeat) {
    setStatus("請先加入房間。");
    return;
  }
  if (isHost) {
    applyResetFromUser(uid);
    publishSnapshot();
    setStatus("已重置。");
  } else if (hostConnection?.open) {
    safeSend(hostConnection, { type: "reset", payload: { uid } });
    setStatus("已送出重置請求。");
  }
}

function handleBoardClick(event) {
  const button = event.target.closest("button.cell");
  if (!button || !activeRoomId || !mySeat) return;

  const clickedSeat = Number(button.dataset.seat);
  const level = Number(button.dataset.level);

  if (isHost) {
    applySetCellFromUser(uid, level, clickedSeat);
    publishSnapshot();
  } else if (hostConnection?.open) {
    safeSend(hostConnection, {
      type: "set-cell",
      payload: { uid, level, seat: clickedSeat }
    });
  }
}

function getSeatByUid(targetUid, seats = latestSnapshot.seats) {
  for (const seat of [1, 2, 3, 4]) {
    if (seats[seat]?.uid === targetUid) return seat;
  }
  return null;
}

function createEmptySnapshot() {
  return { seats: {}, grid: {}, hostPeerId: "", ts: Date.now() };
}

function createRoomId() {
  const arr = new Uint32Array(4);
  crypto.getRandomValues(arr);
  return `${arr[0].toString(36)}-${arr[1].toString(36)}-${arr[2].toString(36)}-${arr[3].toString(36)}`;
}

function getOrCreateClientId() {
  const key = "board-client-id";
  const cached = sessionStorage.getItem(key);
  if (cached) return cached;
  const id = `u-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  sessionStorage.setItem(key, id);
  return id;
}

function makeHostPeerId(roomId) {
  return `room-${roomId}-host`;
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
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function waitForConnectionOpen(conn, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error("連線逾時，找不到房主。"));
    }, timeoutMs);

    conn.on("open", () => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      resolve();
    });

    conn.on("error", (error) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      reject(error || new Error("房間連線失敗。"));
    });
  });
}

// 【修改點】把 PEER_CONFIG 放進來套用 STUN Server
function openPeerWithId(id) {
  return new Promise((resolve, reject) => {
    const instance = new Peer(id, PEER_CONFIG);
    let resolved = false;

    instance.on("open", () => {
      resolved = true;
      resolve(instance);
    });

    instance.on("error", (error) => {
      if (resolved) return;
      instance.destroy();
      reject(error || new Error("Peer 初始化失敗"));
    });
  });
}

// 【修改點】把 PEER_CONFIG 放進來套用 STUN Server
function openPeerRandom() {
  return new Promise((resolve, reject) => {
    const instance = new Peer(PEER_CONFIG);
    let resolved = false;

    instance.on("open", () => {
      resolved = true;
      resolve(instance);
    });

    instance.on("error", (error) => {
      if (resolved) return;
      instance.destroy();
      reject(error || new Error("Peer 初始化失敗"));
    });
  });
}

window.addEventListener("beforeunload", () => leaveRoom(true));