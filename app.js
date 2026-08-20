import { initializeApp }
from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  onSnapshot,
  collection,
  addDoc,
  query,
  orderBy,
  where,
  limitToLast,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD9XAlpeDn4UFp-0taUmCvUm86XkPTNboM",
  authDomain: "our-status-a9535.firebaseapp.com",
  projectId: "our-status-a9535",
  storageBucket: "our-status-a9535.firebasestorage.app",
  messagingSenderId: "402776687762",
  appId: "1:402776687762:web:556c3e1449e3fc9e58924b"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const azureBaseUrl = "https://ourheartfunctions2026.azurewebsites.net/api";
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let recordingPointerId = null;
let recordingStartX = 0;
let recordingStarting = false;
let recordingStopRequested = false;
let recordingStopHandled = false;
let recordingStartTime = 0;
let recordingTimer = null;
let recordingCancelled = false;
let recordingSwipeDistance = 0;
let activeRecordingSession = null;
let typingStopTimer = null;
let typingStateSent = false;
const useAzurePresence = true;
const pendingLocalMessages = new Map();
const messageStore = new Map();
const deletedMessageIds = new Set();
let markSeenInFlight = false;
const visibleMessageIds = new Set();
let messageVisibilityObserver = null;
const longPressDelayMs = 700;
const longPressMoveThresholdPx = 10;
const replySwipeStartThresholdPx = 6;
const replySwipeTriggerDistancePx = 34;
let pressTimer = null;
let pressState = null;
let selectionToolbarElement = null;
const selectedMessageIds = new Set();
let selectionLongPressMessageId = "";
let replyTarget = null;
let swipeState = null;
const sendQueue = [];
let sendQueueProcessing = false;
let activeMediaPickerType = "sticker";
let mediaSearchTimer = null;
let chatHasLoaded = false;
let newMessagesPending = false;
const knownServerMessageIds = new Set();
let latestServerMessageTime = 0;
let latestSeenUpdateTime = 0;
let fastMessagePollInFlight = false;
let suppressMessageClickUntil = 0;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeMessageId(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function normalizeMessage(message) {
  if (!message) return null;

  const id = normalizeMessageId(message.id);
  if (!id) return null;

  return {
    ...message,
    id,
    type: message.messageType === "sticker" || message.messageType === "gif" || message.voiceUrl
      ? (message.messageType === "sticker" || message.messageType === "gif" ? message.messageType : "voice")
      : "text",
    replyToMessageId: message.replyToMessageId
      ? normalizeMessageId(message.replyToMessageId)
      : ""
  };
}

function getMessageReplyDescriptor(message) {
  message = normalizeMessage(message);
  if (!message) return { type: "text", text: "Original message" };
  if (message.type === "voice" || message.voiceUrl) return { type: "voice", text: "", previewText: "🎤 Voice message" };
  if (message.type === "sticker" || message.stickerUrl) return { type: "sticker", text: "", previewText: "🖼 Sticker" };
  if (message.type === "gif" || message.gifUrl) return { type: "gif", text: "", previewText: "GIF" };
  return { type: "text", text: message.text || "", previewText: message.text ? `"${message.text}"` : "Original message" };
}

function formatAudioTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const wholeSeconds = Math.floor(seconds);
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

function getReplyPreviewText(message) {
  if (message.replyToType === "voice" || message.replyToVoice || message.replyToVoiceUrl) return "🎤 Voice message";
  if (message.replyToType === "sticker") return "🖼 Sticker";
  if (message.replyToType === "gif") return "GIF";
  return message.replyToText ? `"${message.replyToText}"` : "Original message";
}

function buildReplyQuoteHtml(msg) {
  const replyId = normalizeMessageId(msg.replyToMessageId);
  if (!replyId) return "";
  const originalDeleted = deletedMessageIds.has(replyId);

  return `
    <button class="replyQuote" type="button" data-reply-target="${escapeHtml(replyId)}" aria-label="Reply to ${escapeHtml(msg.replyToSender || "original message")}">
      <span class="replyQuoteBar" aria-hidden="true"></span>
      <span class="replyQuoteContent"${originalDeleted ? " hidden" : ""}>
        <strong>${escapeHtml(msg.replyToSender || "Unknown")}</strong>
        <span>${escapeHtml(getReplyPreviewText(msg))}</span>
      </span>
      <span class="replyQuoteDeleted"${originalDeleted ? "" : " hidden"}>Original message deleted</span>
    </button>
  `;
}

function buildMessageHtml(msg) {
  msg = normalizeMessage(msg);
  if (!msg) return "";

  const checkMark = msg.seen ? "✓✓ Seen" : "✓ Delivered";
  const cls = msg.sender === currentUser ? "message me" : "message her";
  const content = msg.type === "sticker" && msg.stickerUrl
    ? `<img class="stickerMessageImage" src="${escapeHtml(msg.stickerUrl)}" alt="Sticker" loading="lazy">`
    : msg.type === "gif" && msg.gifUrl
      ? `<img class="gifMessageImage" src="${escapeHtml(msg.gifUrl)}" alt="GIF" loading="lazy">`
      : msg.voiceUrl
    ? `
      <div class="voiceMessage">
        <button class="voicePlayButton" type="button" aria-label="Play voice message" aria-pressed="false">▶</button>
        <div class="voiceTrack">
          <input class="voiceProgress" type="range" min="0" max="100" value="0" step="0.1" aria-label="Voice message progress">
          <div class="voiceTimes"><span class="voiceCurrentTime">0:00</span><span class="voiceDuration">0:00</span></div>
          <span class="voiceError" hidden>Unable to play voice <button class="voiceRetry" type="button">Retry</button></span>
        </div>
        <audio class="voiceAudio" preload="metadata">
          <source src="${escapeHtml(msg.voiceUrl)}" type="audio/webm">
        </audio>
      </div>
    `
    : escapeHtml(msg.text);

  return `
    <div class="message-row ${msg.sender === currentUser ? "outgoing" : "incoming"}" data-message-id="${escapeHtml(msg.id)}" data-sender="${escapeHtml(msg.sender)}" aria-selected="false">
      <div class="message ${cls}">
      <button class="replyAction" type="button" aria-label="Reply to this message" onclick="startReply('${escapeHtml(msg.id)}')">↩</button>
      ${buildReplyQuoteHtml(msg)}
      <div class="messageContent">${content}</div>
      <small class="messageMeta">
        <span>${escapeHtml(msg.sender)}</span>
        <span>${new Date(msg.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        <span>${checkMark}</span>
      </small>
      <div class="reaction">${escapeHtml(msg.reaction || "")}</div>
      <div class="reactionButtons" aria-label="Message reactions">
        <button onclick="reactMessage('${msg.id}','❤️')">❤️</button>
        <button onclick="reactMessage('${msg.id}','😂')">😂</button>
        <button onclick="reactMessage('${msg.id}','🫂')">🫂</button>
        <button onclick="reactMessage('${msg.id}','🥺')">🥺</button>
      </div>
      </div>
    </div>
  `;
}

function setReplyTarget(message) {
  if (!message || !message.id) return;

  const descriptor = getMessageReplyDescriptor(message);
  replyTarget = {
    id: message.id,
    sender: message.sender || "Unknown",
    text: descriptor.text,
    previewText: descriptor.previewText,
    type: descriptor.type,
    voice: descriptor.type === "voice"
  };

  const preview = document.getElementById("replyPreview");
  if (!preview) return;

  preview.hidden = false;
  preview.querySelector(".replyPreviewSender").textContent = replyTarget.sender;
  preview.querySelector(".replyPreviewText").textContent = replyTarget.previewText;
  preview.dataset.replyTarget = normalizeMessageId(replyTarget.id);
  preview.dataset.replyType = replyTarget.type;
  document.getElementById("messageInput")?.focus();
}

window.startReply = function (messageId) {
  const message = pendingLocalMessages.get(messageId) || window.chatMessages?.find((item) => item.id === messageId);
  const element = document.querySelector(`[data-message-id="${CSS.escape(normalizeMessageId(messageId))}"]`);

  if (message) {
    setReplyTarget(message);
  } else if (element) {
    const isVoiceMessage = !!element.querySelector("audio");
    setReplyTarget({
      id: messageId,
      sender: element.dataset.sender,
      text: element.querySelector(".messageContent")?.textContent.trim() || "",
      previewText: isVoiceMessage ? "🎤 Voice message" : element.querySelector(".messageContent")?.textContent.trim() || "Original message",
      type: isVoiceMessage ? "voice" : "text",
      voiceUrl: isVoiceMessage ? "pending" : ""
    });
  }
};

window.cancelReply = function () {
  replyTarget = null;
  const preview = document.getElementById("replyPreview");
  if (preview) {
    preview.hidden = true;
    preview.querySelector(".replyPreviewSender").textContent = "";
    preview.querySelector(".replyPreviewText").textContent = "";
    delete preview.dataset.replyTarget;
    delete preview.dataset.replyType;
  }
  document.getElementById("messageInput")?.focus();
};

function scrollToOriginal(messageId, quoteElement) {
  const normalizedId = normalizeMessageId(messageId);
  const original = document.querySelector(`[data-message-id="${CSS.escape(normalizedId)}"]`);
  if (original) {
    original.scrollIntoView({ behavior: "smooth", block: "center" });
    original.classList.add("message-highlight");
    setTimeout(() => original.classList.remove("message-highlight"), 1200);
    return;
  }

  const deletedState = quoteElement.querySelector(".replyQuoteDeleted");
  const content = quoteElement.querySelector(".replyQuoteContent");
  if (deletedState && content) {
    content.hidden = true;
    deletedState.hidden = false;
  }
}

function renderLocalMessage(message) {
  message = normalizeMessage(message);
  if (!message) return;

  const messageId = message.id;

  if (deletedMessageIds.has(messageId)) return;

  messageStore.set(messageId, message);
  pendingLocalMessages.set(messageId, message);
  knownServerMessageIds.add(messageId);
  window.chatMessages = (window.chatMessages || []).filter((item) => normalizeMessageId(item.id) !== messageId);
  window.chatMessages.push(message);

  const chatBox = document.getElementById("chatBox");

  if (!chatBox) return;

  const existingMessages = chatBox.querySelectorAll(
    `[data-message-id="${CSS.escape(messageId)}"]`
  );

  existingMessages.forEach((element) => element.remove());
  chatBox.insertAdjacentHTML("beforeend", buildMessageHtml(message));
  observeVisibleMessages();

  chatBox.scrollTop = chatBox.scrollHeight;
}

function observeVisibleMessages() {
  const chatBox = document.getElementById("chatBox");
  if (!chatBox || !window.IntersectionObserver) return;

  if (!messageVisibilityObserver) {
    messageVisibilityObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const messageId = entry.target.dataset.messageId;
        if (entry.isIntersecting) visibleMessageIds.add(messageId);
        else visibleMessageIds.delete(messageId);
      });
      markVisibleMessagesSeen();
    }, { root: chatBox, threshold: 0.55 });
  }

  chatBox.querySelectorAll("[data-message-id]").forEach((messageElement) => {
    messageVisibilityObserver.observe(messageElement);
  });
}

function removeMessageLocally(messageId) {
  messageId = normalizeMessageId(messageId);
  if (!messageId) return;

  const chatBox = document.getElementById("chatBox");
  const previousScrollTop = chatBox?.scrollTop || 0;
  const previousScrollHeight = chatBox?.scrollHeight || 0;
  const wasNearBottom = chatBox
    ? previousScrollHeight - chatBox.clientHeight - previousScrollTop <= 64
    : false;
  const messageElement = chatBox?.querySelector(
    `[data-message-id="${CSS.escape(messageId)}"]`
  );
  const messageTop = messageElement?.offsetTop ?? Number.POSITIVE_INFINITY;

  deletedMessageIds.add(messageId);
  messageStore.delete(messageId);
  pendingLocalMessages.delete(messageId);
  selectedMessageIds.delete(messageId);

  document.querySelectorAll(
    `[data-message-id="${CSS.escape(messageId)}"]`
  ).forEach((element) => element.remove());

  window.chatMessages = (window.chatMessages || []).filter(
    (message) => normalizeMessageId(message.id) !== messageId
  );

  if (chatBox) {
    const scrollAdjustment = !wasNearBottom && messageTop < previousScrollTop
      ? chatBox.scrollHeight - previousScrollHeight
      : 0;
    chatBox.scrollTop = wasNearBottom
      ? Math.max(0, chatBox.scrollHeight - chatBox.clientHeight)
      : Math.max(0, previousScrollTop + scrollAdjustment);
  }
  updateSelectionUi();
}

function showDeleteError() {
  function showRecordingError(message = "Voice recording is unavailable") {
    let notice = document.getElementById("chatErrorNotice");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "chatErrorNotice";
      notice.className = "chatErrorNotice";
      document.body.appendChild(notice);
    }

    notice.textContent = message;
    notice.hidden = false;
    clearTimeout(showRecordingError.timeout);
    showRecordingError.timeout = setTimeout(() => {
      notice.hidden = true;
    }, 2800);
  }
  let notice = document.getElementById("chatErrorNotice");
  if (!notice) {
    notice = document.createElement("div");
    notice.id = "chatErrorNotice";
    notice.className = "chatErrorNotice";
    document.body.appendChild(notice);
  }

  notice.textContent = "Could not delete message";
  notice.hidden = false;
  clearTimeout(showDeleteError.timeout);
  showDeleteError.timeout = setTimeout(() => {
    notice.hidden = true;
  }, 2400);
}

function showNewMessagesIndicator() {
  const indicator = document.getElementById("newMessagesIndicator");
  if (!indicator) return;

  newMessagesPending = true;
  indicator.hidden = false;
}

function clearNewMessagesIndicator() {
  const indicator = document.getElementById("newMessagesIndicator");
  newMessagesPending = false;
  if (indicator) indicator.hidden = true;
}

function scrollChatToLatest() {
  const chatBox = document.getElementById("chatBox");
  if (!chatBox) return;

  chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: "smooth" });
  clearNewMessagesIndicator();
}

function getSelectedOwnMessageIds() {
  return [...selectedMessageIds].filter((messageId) => {
    const message = messageStore.get(messageId) || window.chatMessages?.find((item) => normalizeMessageId(item.id) === messageId);
    return message?.sender === currentUser;
  });
}

function updateSelectionUi() {
  document.querySelectorAll(".message-row[data-message-id]").forEach((element) => {
    const isSelected = selectedMessageIds.has(element.dataset.messageId);
    element.classList.toggle("selection-selected", isSelected);
    element.setAttribute("aria-selected", String(isSelected));
  });

  if (!selectionToolbarElement) return;
  const count = selectedMessageIds.size;
  const ownCount = getSelectedOwnMessageIds().length;
  selectionToolbarElement.querySelector(".selectionCount").textContent = `${count} selected`;
  selectionToolbarElement.querySelector(".selectionDelete").hidden = ownCount === 0;
  selectionToolbarElement.hidden = count === 0;
}

function ensureSelectionToolbar() {
  if (selectionToolbarElement) return selectionToolbarElement;

  selectionToolbarElement = document.createElement("div");
  selectionToolbarElement.id = "selectionToolbar";
  selectionToolbarElement.className = "selectionToolbar";
  selectionToolbarElement.hidden = true;
  selectionToolbarElement.innerHTML = `
    <button class="selectionClose" type="button" aria-label="Close selection">×</button>
    <strong class="selectionCount">0 selected</strong>
    <button class="selectionDelete" type="button" aria-label="Delete selected messages">🗑</button>
    <button class="selectionReply" type="button" aria-label="Reply to selected message">↩</button>
    <button class="selectionReact" type="button" aria-label="React to selected message">♥</button>
  `;
  document.body.appendChild(selectionToolbarElement);

  selectionToolbarElement.querySelector(".selectionClose").onclick = clearSelectionMode;
  selectionToolbarElement.querySelector(".selectionDelete").onclick = deleteSelectedMessages;
  selectionToolbarElement.querySelector(".selectionReply").onclick = () => {
    const messageId = [...selectedMessageIds][0];
    if (selectedMessageIds.size === 1 && messageId) {
      window.startReply(messageId);
      clearSelectionMode();
    }
  };
  selectionToolbarElement.querySelector(".selectionReact").onclick = () => {
    const messageId = [...selectedMessageIds][0];
    const messageElement = messageId && document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (selectedMessageIds.size === 1 && messageElement) {
      clearSelectionMode();
      messageElement.classList.add("show-reactions");
    }
  };
  return selectionToolbarElement;
}

function enterSelectionMode(messageId) {
  if (!messageId) return;
  ensureSelectionToolbar();
  selectedMessageIds.add(normalizeMessageId(messageId));
  selectionLongPressMessageId = normalizeMessageId(messageId);
  updateSelectionUi();
}

function toggleMessageSelection(messageId) {
  messageId = normalizeMessageId(messageId);
  if (!messageId) return;
  if (selectedMessageIds.has(messageId)) selectedMessageIds.delete(messageId);
  else selectedMessageIds.add(messageId);
  updateSelectionUi();
  if (!selectedMessageIds.size) clearSelectionMode();
}

function clearSelectionMode() {
  selectedMessageIds.clear();
  selectionLongPressMessageId = "";
  updateSelectionUi();
}

async function deleteSelectedMessages() {
  const messageIds = getSelectedOwnMessageIds();
  if (!messageIds.length) return;

  const previousSelection = [...messageIds];
  clearSelectionMode();
  const results = await Promise.all(messageIds.map(async (messageId) => {
    try {
      const response = await fetch(`${azureBaseUrl}/deleteChat`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, user: currentUser })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Delete message failed");
      removeMessageLocally(messageId);
      return true;
    } catch (error) {
      console.error(`Delete message ${messageId} failed:`, error);
      return false;
    }
  }));

  if (results.some((deleted) => !deleted)) {
    previousSelection.forEach((messageId, index) => {
      if (!results[index]) selectedMessageIds.add(messageId);
    });
    updateSelectionUi();
    showDeleteError();
  }
}

function updateVoiceControls(audio) {
  const voiceMessage = audio.closest(".voiceMessage");
  if (!voiceMessage) return;

  const progress = voiceMessage.querySelector(".voiceProgress");
  const currentTime = voiceMessage.querySelector(".voiceCurrentTime");
  const duration = voiceMessage.querySelector(".voiceDuration");
  const playButton = voiceMessage.querySelector(".voicePlayButton");
  const errorMessage = voiceMessage.querySelector(".voiceError");
  const ratio = audio.duration > 0 ? (audio.currentTime / audio.duration) * 100 : 0;

  if (progress) progress.value = String(ratio);
  if (currentTime) currentTime.textContent = formatAudioTime(audio.currentTime);
  if (duration) duration.textContent = formatAudioTime(audio.duration);
  if (playButton) {
    playButton.textContent = audio.paused ? "▶" : "❚❚";
    playButton.setAttribute("aria-label", audio.paused ? "Play voice message" : "Pause voice message");
    playButton.setAttribute("aria-pressed", String(!audio.paused));
  }
  if (errorMessage && !audio.error) errorMessage.hidden = true;
}

function showVoiceError(audio) {
  const voiceMessage = audio.closest(".voiceMessage");
  const errorMessage = voiceMessage?.querySelector(".voiceError");
  if (errorMessage) errorMessage.hidden = false;
  console.error("Voice playback failed:", audio.error?.code, audio.error?.message || "unknown audio error");
  updateVoiceControls(audio);
}

function stopOtherVoiceMessages(activeAudio) {
  document.querySelectorAll(".voiceAudio").forEach((audio) => {
    if (audio !== activeAudio && !audio.paused) {
      audio.pause();
      updateVoiceControls(audio);
    }
  });
}

function isInteractiveMessageTarget(target) {
  return !!target.closest(
    "button, audio, source, .reactionButtons, .reaction, input, textarea, select, label, a"
  );
}

function clearMessagePressTimer() {
  if (pressTimer) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }

  pressState = null;
}

function handleChatBoxPointerDown(event) {
  const messageRow = event.target.closest(".message-row[data-message-id]");
  const messageElement = messageRow?.querySelector(".message");

  if (!messageRow || isInteractiveMessageTarget(event.target)) {
    return;
  }

  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }

  clearMessagePressTimer();

  if (selectedMessageIds.size) {
    pressState = {
      messageElement,
      messageRow,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
      longPressed: true,
      selectionTap: true
    };
    return;
  }

  pressState = {
    messageElement,
    messageRow,
    startX: event.clientX,
    startY: event.clientY,
    pointerId: event.pointerId,
    longPressed: false,
    selectionTap: false
  };

  swipeState = {
    messageElement,
    messageRow,
    startX: event.clientX,
    startY: event.clientY,
    pointerId: event.pointerId,
    distance: 0,
    directionLocked: false,
    engaged: false
  };

  pressTimer = setTimeout(() => {
    if (!pressState || pressState.longPressed) return;

    pressState.longPressed = true;
    suppressMessageClickUntil = Date.now() + 650;
    swipeState = null;
    enterSelectionMode(pressState.messageRow.dataset.messageId);
    try { event.preventDefault(); } catch {}
  }, longPressDelayMs);
}

function handleChatBoxPointerMove(event) {
  if (swipeState && event.pointerId === swipeState.pointerId) {
    const deltaX = event.clientX - swipeState.startX;
    const deltaY = event.clientY - swipeState.startY;
    const horizontalDistance = Math.abs(deltaX);
    const verticalDistance = Math.abs(deltaY);

    if (!swipeState.directionLocked && (horizontalDistance > replySwipeStartThresholdPx || verticalDistance > replySwipeStartThresholdPx)) {
      if (verticalDistance > horizontalDistance * 1.15) {
        swipeState.directionLocked = true;
        swipeState.engaged = false;
        swipeState.messageElement.classList.remove("is-swiping");
        swipeState.messageElement.style.removeProperty("--swipe-distance");
        swipeState = null;
        clearMessagePressTimer();
        return;
      }

      if (horizontalDistance >= verticalDistance) {
        swipeState.directionLocked = true;
        try {
          swipeState.messageElement.setPointerCapture?.(event.pointerId);
        } catch {}
      }
    }

    if (swipeState.directionLocked && deltaX > 0) {
      const distance = Math.min(deltaX, 72);
      clearMessagePressTimer();
      swipeState.engaged = true;
      swipeState.distance = Math.min(distance, 76);
      swipeState.messageElement.style.setProperty("--swipe-distance", `${swipeState.distance}px`);
      swipeState.messageElement.classList.add("is-swiping");
      swipeState.messageElement.querySelector(".replyAction")?.classList.toggle("is-ready", distance >= replySwipeTriggerDistancePx);
    } else if (swipeState.directionLocked && deltaX <= 0) {
      swipeState.distance = 0;
      swipeState.messageElement.style.removeProperty("--swipe-distance");
      swipeState.messageElement.classList.remove("is-swiping");
      swipeState.messageElement.querySelector(".replyAction")?.classList.remove("is-ready");
    }
  }

  if (!pressState || event.pointerId !== pressState.pointerId || pressState.longPressed) {
    return;
  }

  const deltaX = Math.abs(event.clientX - pressState.startX);
  const deltaY = Math.abs(event.clientY - pressState.startY);

  if (deltaX > longPressMoveThresholdPx || deltaY > longPressMoveThresholdPx) {
    clearMessagePressTimer();
  }
}

function handleChatBoxPointerEnd(event) {
  if (swipeState && (!event || event.pointerId === swipeState.pointerId)) {
    if (swipeState.engaged && swipeState.distance >= replySwipeTriggerDistancePx) {
      const message = window.chatMessages?.find((item) => item.id === swipeState.messageRow.dataset.messageId);
      if (message) setReplyTarget(message);
    }
    swipeState.messageElement.style.removeProperty("--swipe-distance");
    swipeState.messageElement.classList.remove("is-swiping");
    swipeState.messageElement.querySelector(".replyAction")?.classList.remove("is-ready");
    swipeState = null;
  }
  if (pressState?.selectionTap && event?.type === "pointerup") {
    const deltaX = Math.abs(event.clientX - pressState.startX);
    const deltaY = Math.abs(event.clientY - pressState.startY);
    if (deltaX <= longPressMoveThresholdPx && deltaY <= longPressMoveThresholdPx) {
      toggleMessageSelection(pressState.messageRow.dataset.messageId);
      suppressMessageClickUntil = Date.now() + 400;
      try { event.preventDefault(); } catch {}
    }
  }
  if (pressState?.longPressed) {
    try { event.preventDefault(); } catch {}
  }
  clearMessagePressTimer();
}

async function setTypingState(isTyping) {
  if (!currentUser) return;

  try {
    const response = await fetch(
      `${azureBaseUrl}/setTyping`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          user: currentUser,
          typing: isTyping
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Set typing failed");
    }

    syncPresenceStatus();

    return;
  } catch (error) {
    console.error("Azure typing update failed, fallback to Firebase:", error);
  }

  await setDoc(
    doc(db, "typing", currentUser),
    {
      typing: isTyping
    }
  );

  syncPresenceStatus();
}

function syncPresenceStatus() {
  if (currentUser === "Mohamed" || currentUser === "Yomna") {
    refreshPresenceFromAzure();
  }
}

function syncMessageReaction(messageId, emoji) {
  const messageElement = document.querySelector(
    `[data-message-id="${messageId}"]`
  );

  if (messageElement) {
    const reactionElement = messageElement.querySelector(".reaction");

    if (reactionElement) {
      reactionElement.textContent = emoji;
    }
  }

  const pendingMessage = pendingLocalMessages.get(messageId);

  if (pendingMessage) {
    pendingLocalMessages.set(messageId, {
      ...pendingMessage,
      reaction: emoji
    });
  }
}

window.updateOnlineStatus = async function(){
  if (!currentUser) return;

  try {
    const response = await fetch(
      `${azureBaseUrl}/setPresence`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          user: currentUser,
          online: true,
          lastSeen: Date.now()
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Set presence failed");
    }

    syncPresenceStatus();

    return;
  } catch (error) {
    console.error("Azure presence update failed, fallback to Firebase:", error);
  }

  await setDoc(
    doc(db,"online",currentUser),
    {
      lastSeen:Date.now()
    }
  );

  syncPresenceStatus();
}
setInterval(() => {

  updateOnlineStatus();

}, 10000);

window.typing = function(){
  if (!currentUser) return;

  if (!typingStateSent) {
    typingStateSent = true;
    setTypingState(true);
  }

  if (typingStopTimer) {
    clearTimeout(typingStopTimer);
  }

  typingStopTimer = setTimeout(() => {
    typingStateSent = false;
    setTypingState(false);
  }, 2000);
}


// اختيار المستخدم
let currentUser = localStorage.getItem("currentUser");
if (currentUser !== "Mohamed" && currentUser !== "Yomna") {
  currentUser = null;
  localStorage.removeItem("currentUser");
}

const mainApp = document.getElementById("mainApp");
const userSelector = document.getElementById("userSelector");

if (currentUser === "Mohamed" || currentUser === "Yomna") {

  mainApp.style.display = "block";
  userSelector.style.display = "none";
  updateOnlineStatus();

}

const chatBox = document.getElementById("chatBox");

if (chatBox) {
  chatBox.addEventListener("pointerdown", handleChatBoxPointerDown);
  chatBox.addEventListener("pointermove", handleChatBoxPointerMove);
  chatBox.addEventListener("pointerup", handleChatBoxPointerEnd);
  chatBox.addEventListener("pointercancel", handleChatBoxPointerEnd);
  chatBox.addEventListener("click", (event) => {
    if (Date.now() < suppressMessageClickUntil) {
      suppressMessageClickUntil = 0;
      return;
    }

    const quote = event.target.closest(".replyQuote");
    if (quote) scrollToOriginal(quote.dataset.replyTarget, quote);

    const voiceButton = event.target.closest(".voicePlayButton");
    if (voiceButton) {
      const audio = voiceButton.closest(".voiceMessage")?.querySelector(".voiceAudio");
      if (audio) {
        if (audio.paused) {
          stopOtherVoiceMessages(audio);
          audio.play().catch(() => showVoiceError(audio));
        } else {
          audio.pause();
        }
        updateVoiceControls(audio);
      }
      return;
    }

    const voiceRetry = event.target.closest(".voiceRetry");
    if (voiceRetry) {
      const audio = voiceRetry.closest(".voiceMessage")?.querySelector(".voiceAudio");
      if (audio) {
        audio.load();
        audio.play().catch(() => showVoiceError(audio));
      }
      return;
    }

    const reactionButton = event.target.closest(".reactionButtons button");
    if (reactionButton) {
      const reactionRow = reactionButton.closest(".message-row");
      reactionRow?.querySelector(".message")?.classList.remove("show-reactions");
      return;
    }

    const message = event.target.closest("[data-message-id]");
    if (message && !isInteractiveMessageTarget(event.target)) {
      document.querySelectorAll(".message.show-reactions").forEach((item) => {
        if (item !== message) item.classList.remove("show-reactions");
      });
      message.querySelector(".message")?.classList.toggle("show-reactions");
    }
  });
  chatBox.addEventListener("input", (event) => {
    const progress = event.target.closest(".voiceProgress");
    if (!progress) return;

    const audio = progress.closest(".voiceMessage")?.querySelector(".voiceAudio");
    if (audio && Number.isFinite(audio.duration)) {
      audio.currentTime = (Number(progress.value) / 100) * audio.duration;
      updateVoiceControls(audio);
    }
  });
  ["loadedmetadata", "timeupdate", "play", "pause", "ended", "error"].forEach((eventName) => {
    chatBox.addEventListener(eventName, (event) => {
      if (!event.target.matches(".voiceAudio")) return;
      if (eventName === "ended") event.target.currentTime = 0;
      if (eventName === "error") showVoiceError(event.target);
      else updateVoiceControls(event.target);
    });
  });
  chatBox.addEventListener("scroll", () => {
    if (chatBox.scrollHeight - chatBox.clientHeight - chatBox.scrollTop <= 64) {
      clearNewMessagesIndicator();
    }
  }, { passive: true });
}

document.getElementById("newMessagesIndicator")?.addEventListener("click", scrollChatToLatest);

document.addEventListener("pointerdown", (event) => {
  const picker = document.getElementById("mediaPicker");
  if (picker && !picker.hidden && !event.target.closest("#mediaPicker, #stickerBtn, #gifBtn")) {
    closeMediaPicker();
  }
  if (selectedMessageIds.size && !event.target.closest("#selectionToolbar, [data-message-id]")) {
    clearSelectionMode();
  }
  if (!event.target.closest("[data-message-id]")) {
    document.querySelectorAll(".message.show-reactions").forEach((item) => item.classList.remove("show-reactions"));
  }
});

window.addEventListener("resize", clearSelectionMode);

document.getElementById("mohamedBtn").onclick = () => {

  currentUser = "Mohamed";

  localStorage.setItem(
    "currentUser",
    currentUser
  );

  location.reload();

};

document.getElementById("yomnaBtn").onclick = () => {

  currentUser = "Yomna";

  localStorage.setItem(
    "currentUser",
    currentUser
  );

  location.reload();

};


// تحديث الحالة
window.updateStatus = async function (person, status) {

  const statusElementId =
    person === "mohamed"
      ? "mohamedStatus"
      : "yomnaStatus";

  const renderStatusLocally = (timeText) => {
    const statusElement = document.getElementById(statusElementId);

    if (statusElement) {
      statusElement.textContent = `${status}\n${timeText}`;
    }
  };

  try {
    const response = await fetch(
      `${azureBaseUrl}/setStatus`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          person,
          status,
          time: new Date().toLocaleString()
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Set status failed");
    }

    renderStatusLocally(result.status?.time || new Date().toLocaleString());

    return;
  } catch (error) {
    console.error("Azure status update failed, fallback to Firebase:", error);
  }

  await setDoc(
    doc(db, "status", person),
    {
      status: status,
      time: new Date().toLocaleString()
    }
  );

  renderStatusLocally(new Date().toLocaleString());

};


// إرسال رسالة
async function processSendQueue() {
  if (sendQueueProcessing) return;

  sendQueueProcessing = true;
  try {
    while (sendQueue.length) {
      const queuedMessage = sendQueue.shift();

      try {
        const response = await fetch(
          "https://ourheartfunctions2026.azurewebsites.net/api/sendchat",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(queuedMessage)
          }
        );

        const result = await response.json();
        if (!response.ok) {
          console.error("Send message error:", result);
          continue;
        }

        if (result.message) {
          renderLocalMessage({ ...result.message, ...queuedMessage });
        }
      } catch (error) {
        console.error("Failed to send message:", error);
      }
    }
  } finally {
    sendQueueProcessing = false;
    if (sendQueue.length) processSendQueue();
  }
}

function closeMediaPicker() {
  const picker = document.getElementById("mediaPicker");
  if (picker) picker.hidden = true;
}

function getMediaPreviewMetadata() {
  return replyTarget ? {
    replyToMessageId: normalizeMessageId(replyTarget.id),
    replyToSender: replyTarget.sender,
    replyToText: replyTarget.text,
    replyToType: replyTarget.type,
    replyToVoice: replyTarget.voice
  } : {};
}

async function searchMedia(query) {
  const results = document.getElementById("mediaResults");
  const status = document.getElementById("mediaPickerStatus");
  if (!results || !status) return;
  results.replaceChildren();
  status.textContent = query ? "Searching..." : "Type a keyword to search";
  if (!query) return;

  try {
    const response = await fetch(`${azureBaseUrl}/mediaSearch?type=${encodeURIComponent(activeMediaPickerType)}&q=${encodeURIComponent(query)}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Media search failed");
    status.textContent = result.items?.length ? "" : "No results";
    result.items?.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mediaResult";
      button.setAttribute("role", "option");
      button.setAttribute("aria-label", item.name || activeMediaPickerType);
      const image = document.createElement("img");
      image.src = item.previewUrl || item.url;
      image.alt = item.name || activeMediaPickerType;
      image.loading = "lazy";
      button.appendChild(image);
      button.onclick = () => sendMediaMessage(activeMediaPickerType, item);
      results.appendChild(button);
    });
  } catch (error) {
    console.error("Media search failed:", error);
    status.textContent = "Search is unavailable right now";
  }
}

function openMediaPicker(type) {
  activeMediaPickerType = type;
  const picker = document.getElementById("mediaPicker");
  const title = document.getElementById("mediaPickerTitle");
  const input = document.getElementById("mediaSearchInput");
  if (!picker || !title || !input) return;
  title.textContent = type === "gif" ? "GIFs" : "Stickers";
  input.value = "";
  picker.hidden = false;
  document.getElementById("mediaResults")?.replaceChildren();
  document.getElementById("mediaPickerStatus").textContent = "Type a keyword to search";
  input.focus();
}

function sendMediaMessage(type, item) {
  const payload = {
    sender: currentUser,
    type,
    ...(type === "gif" ? { gifUrl: item.url, gifPreview: item.previewUrl || item.url, gifName: item.name || "GIF" } : { stickerUrl: item.url, stickerPack: item.pack || "", stickerName: item.name || "Sticker" }),
    ...getMediaPreviewMetadata()
  };
  closeMediaPicker();
  cancelReply();
  sendQueue.push(payload);
  processSendQueue();
}

window.sendMessage = function () {
  const input = document.getElementById("messageInput");
  const text = input.value.trim();
  if (text === "") return;

  const queuedMessage = {
    sender: currentUser,
    text,
    ...(replyTarget ? {
      replyToMessageId: normalizeMessageId(replyTarget.id),
      replyToSender: replyTarget.sender,
      replyToText: replyTarget.text,
      replyToType: replyTarget.type,
      replyToVoice: replyTarget.voice
    } : {})
  };

  input.value = "";
  cancelReply();
  sendQueue.push(queuedMessage);
  processSendQueue();
};

document.getElementById("stickerBtn")?.addEventListener("click", () => openMediaPicker("sticker"));
document.getElementById("gifBtn")?.addEventListener("click", () => openMediaPicker("gif"));
document.getElementById("mediaPickerClose")?.addEventListener("click", closeMediaPicker);
document.getElementById("mediaSearchInput")?.addEventListener("input", (event) => {
  clearTimeout(mediaSearchTimer);
  mediaSearchTimer = setTimeout(() => searchMedia(event.target.value.trim()), 320);
});

async function markVisibleMessagesSeen() {
  if (!currentUser || markSeenInFlight || !window.chatMessages?.length) return;

  const unseenMessages = window.chatMessages.filter(
    (message) => visibleMessageIds.has(normalizeMessageId(message.id)) && message.sender !== currentUser && !message.seen
  );

  if (!unseenMessages.length) return;

  markSeenInFlight = true;

  try {
    const response = await fetch(`${azureBaseUrl}/markSeen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: currentUser })
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Mark messages seen failed");
    }

    const seenIds = new Set((result.messageIds || []).map(normalizeMessageId));
    latestSeenUpdateTime = Math.max(latestSeenUpdateTime, Number(result.seenCursor) || 0);
    window.chatMessages = window.chatMessages.map((message) => (
      seenIds.has(normalizeMessageId(message.id))
        ? { ...message, seen: true }
        : message
    ));
    window.chatMessages.forEach((message) => {
      if (seenIds.has(normalizeMessageId(message.id))) {
        const updatedMessage = { ...message, seen: true, seenAt: Date.now() };
        messageStore.set(normalizeMessageId(message.id), updatedMessage);
        const messageElement = document.querySelector(
          `[data-message-id="${CSS.escape(normalizeMessageId(message.id))}"]`
        );
        const seenElement = messageElement?.querySelector(".messageMeta span:last-child");
        if (seenElement) {
          seenElement.textContent = "✓✓ Seen";
          seenElement.classList.add("seen-transition");
          window.setTimeout(() => seenElement.classList.remove("seen-transition"), 260);
        }
      }
    });
  } catch (error) {
    console.error("Azure seen update failed, fallback to Firebase:", error);

    await Promise.all(unseenMessages.map(async (message) => {
      try {
        const messageId = normalizeMessageId(message.id);
        await updateDoc(doc(db, "chat", messageId), { seen: true });
        const updatedMessage = { ...messageStore.get(messageId), seen: true, seenAt: Date.now() };
        messageStore.set(messageId, updatedMessage);
        window.chatMessages = (window.chatMessages || []).map((item) =>
          normalizeMessageId(item.id) === messageId ? updatedMessage : item
        );
      } catch (fallbackError) {
        console.error("Firebase seen update failed:", fallbackError);
      }
    }));
  } finally {
    markSeenInFlight = false;
  }
}


// حالة محمد
// حالة يمنى
if (!useAzurePresence) {
  onSnapshot(
    doc(db, "status", "mohamed"),
    (docSnap) => {

      if (docSnap.exists()) {

        document.getElementById("mohamedStatus").textContent =
          `${docSnap.data().status}\n${docSnap.data().time}`;

      }

    }
  );


  onSnapshot(
    doc(db, "status", "yomna"),
    (docSnap) => {

      if (docSnap.exists()) {

        document.getElementById("yomnaStatus").textContent =
          `${docSnap.data().status}\n${docSnap.data().time}`;

      }

    }
  );
}


async function pollNewMessages() {
  if (document.hidden) return;
  if (fastMessagePollInFlight) return;

  const chatBox = document.getElementById("chatBox");
  if (!chatBox || !chatHasLoaded || !latestServerMessageTime) return;

  fastMessagePollInFlight = true;

  try {
    const params = new URLSearchParams({
      after: String(latestServerMessageTime),
      seenAfter: String(latestSeenUpdateTime),
      user: currentUser
    });

    const response = await fetch(
      `${azureBaseUrl}/getNewMessages?${params.toString()}`,
      { cache: "no-store" }
    );

    const messages = await response.json();

    if (!response.ok || !Array.isArray(messages)) {
      return;
    }

    const incoming = [];

    for (const rawMessage of messages) {
      const message = normalizeMessage(rawMessage);
      if (!message) continue;

      latestServerMessageTime = Math.max(
        latestServerMessageTime,
        Number(message.time) || 0
      );
      latestSeenUpdateTime = Math.max(
        latestSeenUpdateTime,
        Number(message.seenAt) || 0
      );

      if (deletedMessageIds.has(message.id)) continue;

      if (Date.now() - message.time >= 48 * 60 * 60 * 1000) continue;

      if (knownServerMessageIds.has(message.id)) {
        const existing = messageStore.get(message.id);
        if (existing && (existing.seen !== message.seen || (Number(existing.seenAt) || 0) !== (Number(message.seenAt) || 0))) {
          messageStore.set(message.id, message);
          window.chatMessages = (window.chatMessages || []).map(item =>
            normalizeMessageId(item.id) === message.id ? message : item
          );

          const messageElement = chatBox.querySelector(
            `[data-message-id="${CSS.escape(message.id)}"]`
          );
          const seenElement = messageElement?.querySelector(".messageMeta span:last-child");
          if (seenElement && message.seen) {
            seenElement.textContent = "✓✓ Seen";
            seenElement.classList.add("seen-transition");
            window.setTimeout(() => seenElement.classList.remove("seen-transition"), 260);
          }
        }
        continue;
      }

      knownServerMessageIds.add(message.id);
      messageStore.set(message.id, message);

      const existingPending = pendingLocalMessages.get(message.id);
      if (existingPending) {
        pendingLocalMessages.delete(message.id);
      }

      incoming.push(message);
    }

    if (!incoming.length) return;

    const wasNearBottom =
      chatBox.scrollHeight - chatBox.clientHeight - chatBox.scrollTop <= 64;

    const currentMessages = new Map(
      (window.chatMessages || []).map(message => {
        const normalized = normalizeMessage(message);
        return [normalized.id, normalized];
      })
    );

    for (const message of incoming) {
      currentMessages.set(message.id, message);
    }

    window.chatMessages = [...currentMessages.values()]
      .sort((a, b) => Number(a.time) - Number(b.time));

    for (const message of incoming) {
      const existingElement = chatBox.querySelector(
        `[data-message-id="${CSS.escape(message.id)}"]`
      );

      if (existingElement) continue;

      chatBox.insertAdjacentHTML("beforeend", buildMessageHtml(message));
    }

    if (wasNearBottom) {
      chatBox.scrollTop = chatBox.scrollHeight;
      clearNewMessagesIndicator();
    } else {
      showNewMessagesIndicator();
    }

    observeVisibleMessages();
    markVisibleMessagesSeen();
  } catch (error) {
    console.error("Fast new-message poll failed:", error);
  } finally {
    fastMessagePollInFlight = false;
  }
}

// الشات - Cosmos DB
async function loadChat() {
  if (document.hidden) return;
  try {

    const chatBox = document.getElementById("chatBox");
    if (!chatBox) return;

    const previousScrollTop = chatBox.scrollTop;
    const previousScrollHeight = chatBox.scrollHeight;
    const wasNearBottom = previousScrollHeight - chatBox.clientHeight - previousScrollTop <= 64;
    const response = await fetch(
      "https://ourheartfunctions2026.azurewebsites.net/api/getchat"
    );

    const messages = await response.json();

    if (!response.ok) {
      console.error("Get chat error:", messages);
      return;
    }

    const serverMessages = messages
      .map(normalizeMessage)
      .filter(Boolean);

    if (serverMessages.length) {
      latestServerMessageTime = Math.max(
        latestServerMessageTime,
        ...serverMessages.map(message => Number(message.time) || 0)
      );
      const serverSeenTimes = serverMessages
        .map(message => Number(message.seenAt) || 0)
        .filter(Boolean);
      latestSeenUpdateTime = Math.max(
        latestSeenUpdateTime,
        ...(serverSeenTimes.length ? serverSeenTimes : [0])
      );
    }

    const mergedMessages = new Map();
    const newIncomingMessageIds = new Set();

    serverMessages.forEach((msg) => {

      if (deletedMessageIds.has(msg.id)) {
        return;
      }

      if (
        Date.now() - msg.time >=
        48 * 60 * 60 * 1000
      ) {
        return;
      }

      if (
        chatHasLoaded &&
        !knownServerMessageIds.has(msg.id) &&
        msg.sender !== currentUser
      ) {
        newIncomingMessageIds.add(msg.id);
      }

      knownServerMessageIds.add(msg.id);
      messageStore.set(msg.id, msg);
      mergedMessages.set(msg.id, msg);
    });

    for (const [messageId, pendingMessage] of pendingLocalMessages) {
      const normalizedId = normalizeMessageId(messageId);
      const message = normalizeMessage(pendingMessage);

      if (!message || deletedMessageIds.has(normalizedId)) {
        pendingLocalMessages.delete(messageId);
        continue;
      }

      if (mergedMessages.has(normalizedId)) {
        messageStore.set(normalizedId, mergedMessages.get(normalizedId));
        pendingLocalMessages.delete(messageId);
        continue;
      }

      if (deletedMessageIds.has(normalizedId)) {
        pendingLocalMessages.delete(messageId);
        continue;
      }

      if (Date.now() - message.time >= 48 * 60 * 60 * 1000) {
        pendingLocalMessages.delete(messageId);
        continue;
      }

      mergedMessages.set(normalizedId, message);
      messageStore.set(normalizedId, message);
    }

    const html = [...mergedMessages.values()]
      .sort((first, second) => Number(first.time) - Number(second.time))
      .map(buildMessageHtml)
      .join("");

    window.chatMessages = [...mergedMessages.values()];

    const audioIsPlaying = [...chatBox.querySelectorAll("audio")]
  .some(audio => !audio.paused && !audio.ended);

if (audioIsPlaying) {
  if (wasNearBottom) {
    clearNewMessagesIndicator();
  } else if (newIncomingMessageIds.size > 0) {
    showNewMessagesIndicator();
  }
  chatHasLoaded = true;
  return;
}

chatBox.innerHTML = html;
  visibleMessageIds.clear();
  observeVisibleMessages();
  updateSelectionUi();

    const hasNewIncomingMessages = newIncomingMessageIds.size > 0;

    if (wasNearBottom) {
      chatBox.scrollTop = chatBox.scrollHeight;
      clearNewMessagesIndicator();
    } else {
      chatBox.scrollTop = Math.min(previousScrollTop, Math.max(0, chatBox.scrollHeight - chatBox.clientHeight));
      if (hasNewIncomingMessages) showNewMessagesIndicator();
    }

    chatHasLoaded = true;
  markVisibleMessagesSeen();

  } catch (error) {

    console.error("Failed to load chat:", error);

  }
}

// Private chat synchronization starts only after account selection.
if (currentUser) {
  loadChat();

  // مزامنة كاملة كل 5 ثواني
  setInterval(loadChat, 5000);

  // مزامنة خفيفة للرسائل الجديدة فقط كل 1.5 ثانية
  setInterval(pollNewMessages, 900);
}

window.reactMessage = async function(messageId, emoji){

  try {
    const response = await fetch(
      `${azureBaseUrl}/reactMessage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messageId,
          emoji
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "React message failed");
    }

    syncMessageReaction(messageId, emoji);

    return;
  } catch (error) {
    console.error("Azure reaction failed, fallback to Firebase:", error);
  }

  await updateDoc(
    doc(db, "chat", messageId),
    {
      reaction: emoji
    }
  );

  syncMessageReaction(messageId, emoji);

}
window.changeUser = function(){

localStorage.removeItem("currentUser");

location.reload();

}
let otherUser =
currentUser === "Mohamed"
?
"Yomna"
:
"Mohamed";

async function refreshPresenceFromAzure() {
  if (!currentUser || document.hidden) return;

  try {
    const response = await fetch(`${azureBaseUrl}/getPresence`);
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Get presence failed");
    }

    const mohamedStatus = data.status?.mohamed;
    const yomnaStatus = data.status?.yomna;

    if (mohamedStatus) {
      document.getElementById("mohamedStatus").textContent =
        `${mohamedStatus.status}\n${mohamedStatus.time}`;
    }

    if (yomnaStatus) {
      document.getElementById("yomnaStatus").textContent =
        `${yomnaStatus.status}\n${yomnaStatus.time}`;
    }

    const typingData = data.typing?.[otherUser];

    if (typingData?.typing) {
      document.getElementById("typingStatus").textContent =
        "✍️ " + otherUser + " is typing...";
    } else {
      document.getElementById("typingStatus").textContent = "";
    }

    const onlineData = data.presence?.[otherUser];

    if (onlineData?.lastSeen) {
      if (
        onlineData.online !== false &&
        Date.now() - onlineData.lastSeen < 30000
      ) {
        document.getElementById("onlineStatus").textContent = "🟢 Online";
      } else {
        document.getElementById("onlineStatus").textContent =
          "Last seen " +
          new Date(onlineData.lastSeen).toLocaleTimeString();
      }
    }
  } catch (error) {
    console.error("Azure getpresence failed, fallback listeners remain active:", error);
  }
}

if (useAzurePresence && (currentUser === "Mohamed" || currentUser === "Yomna")) {
  refreshPresenceFromAzure();
  setInterval(refreshPresenceFromAzure, 9000);
}


if (!useAzurePresence) {
  onSnapshot(

  doc(
  db,
  "typing",
  otherUser
  ),

  (docSnap)=>{

  if(

  docSnap.exists()

  &&

  docSnap.data().typing

  ){

  document.getElementById(

  "typingStatus"

  ).textContent =

  "✍️ " +

  otherUser +

  " is typing...";

  }

  else{

  document.getElementById(

  "typingStatus"

  ).textContent = "";

  }

  }

  );
  onSnapshot(

  doc(
  db,
  "online",
  otherUser
  ),

  (docSnap)=>{

  if(docSnap.exists()){

  let data = docSnap.data();

  if (Date.now() - data.lastSeen < 30000) {

    document.getElementById(
      "onlineStatus"
    ).textContent = "🟢 Online";

  }
  else {

  document.getElementById(
  "onlineStatus"
  ).textContent =

  "Last seen " +

  new Date(
  data.lastSeen
  ).toLocaleTimeString();

  }

  }

  }

  );
}
window.addEventListener(

"beforeunload",

async ()=>{

if (!currentUser) return;

try {
  const response = await fetch(
    `${azureBaseUrl}/setPresence`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        user: currentUser,
        online: false,
        lastSeen: Date.now()
      })
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Set offline presence failed");
  }

  return;
} catch (error) {
  console.error("Azure offline presence failed, fallback to Firebase:", error);
}

await setDoc(

doc(
db,
"online",
currentUser
),

{

online:false,

lastSeen:Date.now()

}

);

}

);
function updateRecordingUi() {
  const button = document.getElementById("recordBtn");
  const timer = document.getElementById("recordingTimer");
  const hint = document.getElementById("recordingCancelHint");
  const overlay = document.getElementById("recordingOverlay");
  const overlayTimer = document.getElementById("recordingOverlayTimer");
  const overlayHint = document.getElementById("recordingOverlayHint");
  if (!button || !timer || !hint) return;

  button.classList.toggle("is-recording", isRecording);
  button.classList.toggle("is-canceling", recordingSwipeDistance >= 70);
  timer.hidden = !isRecording;
  hint.hidden = !isRecording;
  hint.textContent = recordingSwipeDistance >= 70
    ? "Release to cancel"
    : "Slide left to cancel";
  if (overlay) overlay.hidden = !isRecording;
  if (overlayTimer) overlayTimer.textContent = timer.textContent;
  if (overlayHint) overlayHint.textContent = recordingSwipeDistance >= 70
    ? "Release to cancel"
    : "Slide left to cancel";
}

function updateRecordingTimer() {
  const timer = document.getElementById("recordingTimer");
  if (!timer || !isRecording) return;

  const elapsedSeconds = Math.floor((Date.now() - recordingStartTime) / 1000);
  timer.textContent = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
  const overlayTimer = document.getElementById("recordingOverlayTimer");
  if (overlayTimer) overlayTimer.textContent = timer.textContent;
}

async function startVoiceRecording(event) {
  if (isRecording || recordingStarting || (event.pointerType === "mouse" && event.button !== 0)) return;

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    showRecordingError("Voice recording is not supported in this browser");
    return;
  }

  event.preventDefault();
  recordingPointerId = event.pointerId;
  recordingStartX = event.clientX;
  recordingStarting = true;
  recordingStopRequested = false;
  recordingStopHandled = false;
  recordingStartTime = Date.now();
  recordingCancelled = false;
  recordingSwipeDistance = 0;
  const session = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    stopRequested: false,
    finalized: false,
    saveStarted: false,
    cancelled: false,
    failed: false,
    recorder: null
  };
  activeRecordingSession = session;
  const voiceReplyMetadata = replyTarget ? {
    replyToMessageId: normalizeMessageId(replyTarget.id),
    replyToSender: replyTarget.sender,
    replyToText: replyTarget.text,
    replyToType: replyTarget.type,
    replyToVoice: replyTarget.voice
  } : {};

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    recordingStarting = false;
    recordingPointerId = null;
    console.error("Voice recording could not start:", error);
    showRecordingError("Microphone permission is unavailable");
    return;
  }
  if (recordingStopRequested || session.cancelled) {
    stream.getTracks().forEach((track) => track.stop());
    if (activeRecordingSession === session) activeRecordingSession = null;
    recordingStarting = false;
    recordingPointerId = null;
    return;
  }

  try {
    mediaRecorder = new MediaRecorder(stream);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    recordingStarting = false;
    recordingPointerId = null;
    if (activeRecordingSession === session) activeRecordingSession = null;
    console.error("MediaRecorder could not be created:", error);
    showRecordingError("Voice recording could not start");
    return;
  }
  session.recorder = mediaRecorder;
  audioChunks = [];

  mediaRecorder.ondataavailable = (dataEvent) => {
    if (dataEvent.data?.size) audioChunks.push(dataEvent.data);
  };

  mediaRecorder.onerror = (errorEvent) => {
    session.failed = true;
    console.error("MediaRecorder error:", errorEvent.error || errorEvent);
    try {
      if (session.recorder?.state !== "inactive") session.recorder.stop();
    } catch {}
  };

  mediaRecorder.onstop = async () => {
    if (session.finalized || session.saveStarted) return;
    session.finalized = true;
    recordingStopHandled = true;

    stream.getTracks().forEach((track) => track.stop());
    clearInterval(recordingTimer);
    recordingTimer = null;
    isRecording = false;
    mediaRecorder = null;
    recordingPointerId = null;
    updateRecordingUi();

    if (recordingCancelled || session.cancelled || session.failed) {
      audioChunks = [];
      if (activeRecordingSession === session) activeRecordingSession = null;
      if (session.failed) showRecordingError("Voice recording failed");
      return;
    }

    session.saveStarted = true;

    const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
    audioChunks = [];
    if (!audioBlob.size) {
      if (activeRecordingSession === session) activeRecordingSession = null;
      showRecordingError("No voice data was recorded");
      return;
    }
    const formData = new FormData();
    formData.append("file", audioBlob, "voice.webm");

    try {
      const response = await fetch(
        "https://ourheartfunctions2026.azurewebsites.net/api/uploadVoice",
        { method: "POST", body: formData }
      );
      const result = await response.json();

      if (!response.ok || !result.url) {
        throw new Error(result.error || "No voice URL returned");
      }

      const chatResponse = await fetch(
        "https://ourheartfunctions2026.azurewebsites.net/api/sendchat",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sender: currentUser,
            voiceUrl: result.url,
            ...voiceReplyMetadata
          })
        }
      );
      const chatResult = await chatResponse.json();

      if (!chatResponse.ok) {
        console.error("Voice message save error:", chatResult);
        if (activeRecordingSession === session) activeRecordingSession = null;
        showRecordingError("Voice message could not be saved");
        return;
      }

      if (chatResult.message) {
        renderLocalMessage({ ...chatResult.message, ...voiceReplyMetadata });
      }
      cancelReply();
      if (activeRecordingSession === session) activeRecordingSession = null;
    } catch (error) {
      console.error("Voice message upload failed:", error);
      showRecordingError("Voice message could not be uploaded");
      if (activeRecordingSession === session) activeRecordingSession = null;
    }
  };

  try {
    mediaRecorder.start();
  } catch (error) {
    session.failed = true;
    stream.getTracks().forEach((track) => track.stop());
    mediaRecorder = null;
    recordingStarting = false;
    recordingPointerId = null;
    if (activeRecordingSession === session) activeRecordingSession = null;
    console.error("MediaRecorder.start failed:", error);
    showRecordingError("Voice recording could not start");
    return;
  }
  recordingStarting = false;
  isRecording = true;
  updateRecordingUi();
  updateRecordingTimer();
  recordingTimer = setInterval(updateRecordingTimer, 1000);
}

function finishVoiceRecording(cancel) {
  if (recordingStarting) {
    recordingStopRequested = true;
    recordingCancelled = true;
    activeRecordingSession && (activeRecordingSession.cancelled = true);
    return;
  }

  if (!isRecording || !mediaRecorder) return;
  if (recordingStopRequested || recordingStopHandled) return;

  const session = activeRecordingSession;
  if (!session || session.stopRequested || session.finalized) return;

  recordingCancelled = cancel;
    session.cancelled = cancel;
  recordingStopRequested = true;
  session.stopRequested = true;
  recordingPointerId = null;
  recordingSwipeDistance = 0;
  session.recorder.stop();
}

function handleRecordingPointerMove(event) {
  if (!isRecording || event.pointerId !== recordingPointerId) return;

  recordingSwipeDistance = Math.max(0, recordingStartX - event.clientX);
  const button = document.getElementById("recordBtn");
  if (button) button.style.setProperty("--recording-swipe", `${Math.min(recordingSwipeDistance, 110)}px`);
  updateRecordingUi();
}

window.toggleRecording = function () {
  if (isRecording) finishVoiceRecording(false);
};

const recordButton = document.getElementById("recordBtn");
if (recordButton) {
  recordButton.addEventListener("pointerdown", (event) => {
    try {
      recordButton.setPointerCapture?.(event.pointerId);
    } catch {}
    startVoiceRecording(event);
  });
  recordButton.addEventListener("pointermove", handleRecordingPointerMove);
  recordButton.addEventListener("pointerup", (event) => {
    if (event.pointerId !== recordingPointerId && !recordingStarting) return;
    finishVoiceRecording(recordingSwipeDistance >= 70);
    recordButton.style.removeProperty("--recording-swipe");
  });
  recordButton.addEventListener("pointercancel", () => {
    finishVoiceRecording(true);
    recordButton.style.removeProperty("--recording-swipe");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && (isRecording || recordingStarting)) {
      finishVoiceRecording(true);
      recordButton.style.removeProperty("--recording-swipe");
    }
  });
}

document.getElementById("messageInput")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});