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
const longPressDelayMs = 700;
const longPressMoveThresholdPx = 10;
const replySwipeStartThresholdPx = 6;
const replySwipeTriggerDistancePx = 34;
let pressTimer = null;
let pressState = null;
let deleteMenuElement = null;
let deleteMenuMessageId = null;
let selectedMessageElement = null;
let replyTarget = null;
let swipeState = null;
let sendInFlight = false;
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
    replyToMessageId: message.replyToMessageId
      ? normalizeMessageId(message.replyToMessageId)
      : ""
  };
}

function getReplyPreviewText(message) {
  if (message.replyToType === "voice" || message.replyToVoice || message.replyToVoiceUrl) {
    return "🎤 Voice message";
  }

  return message.replyToText ? `"${message.replyToText}"` : "Original message";
}

function buildReplyQuoteHtml(msg) {
  const replyId = normalizeMessageId(msg.replyToMessageId);
  if (!replyId) return "";

  return `
    <button class="replyQuote" type="button" data-reply-target="${escapeHtml(replyId)}" aria-label="Reply to ${escapeHtml(msg.replyToSender || "original message")}">
      <span class="replyQuoteBar" aria-hidden="true"></span>
      <span class="replyQuoteContent">
        <strong>${escapeHtml(msg.replyToSender || "Unknown")}</strong>
        <span>${escapeHtml(getReplyPreviewText(msg))}</span>
      </span>
      <span class="replyQuoteDeleted" hidden>Original message deleted</span>
    </button>
  `;
}

function buildMessageHtml(msg) {
  msg = normalizeMessage(msg);
  if (!msg) return "";

  const checkMark =
    msg.seen
      ? "✓✓ Seen"
      : "✓ Delivered";

  const cls =
    msg.sender === currentUser
      ? "message me"
      : "message her";

  return `
    <div class="message ${cls}" data-message-id="${escapeHtml(msg.id)}" data-sender="${escapeHtml(msg.sender)}">

      <button class="replyAction" type="button" aria-label="Reply to this message" onclick="startReply('${escapeHtml(msg.id)}')">↩</button>

      ${buildReplyQuoteHtml(msg)}

      <div class="messageContent">
        ${
          msg.voiceUrl
            ? `
              <audio controls>
                <source src="${escapeHtml(msg.voiceUrl)}">
              </audio>
            `
            : escapeHtml(msg.text)
        }
      </div>

      <small class="messageMeta">
        <span>${escapeHtml(msg.sender)}</span>
        <span>${new Date(msg.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        <span>${checkMark}</span>
      </small>

      <div class="reaction">
        ${msg.reaction || ""}
      </div>

      <div class="reactionButtons" aria-label="Message reactions">

        <button onclick="reactMessage('${msg.id}','❤️')">
          ❤️
        </button>

        <button onclick="reactMessage('${msg.id}','😂')">
          😂
        </button>

        <button onclick="reactMessage('${msg.id}','🫂')">
          🫂
        </button>

        <button onclick="reactMessage('${msg.id}','🥺')">
          🥺
        </button>

      </div>

    </div>
  `;
}

function setReplyTarget(message) {
  if (!message || !message.id) return;

  replyTarget = {
    id: message.id,
    sender: message.sender || "Unknown",
    text: message.text || "",
    type: message.voiceUrl ? "voice" : "text",
    voice: !!message.voiceUrl
  };

  const preview = document.getElementById("replyPreview");
  if (!preview) return;

  preview.hidden = false;
  preview.querySelector(".replyPreviewSender").textContent = replyTarget.sender;
  preview.querySelector(".replyPreviewText").textContent = replyTarget.voice
    ? "🎤 Voice message"
    : replyTarget.text || "Original message";
  document.getElementById("messageInput")?.focus();
}

window.startReply = function (messageId) {
  const message = pendingLocalMessages.get(messageId) || window.chatMessages?.find((item) => item.id === messageId);
  const element = document.querySelector(`[data-message-id="${messageId}"]`);

  if (message) {
    setReplyTarget(message);
  } else if (element) {
    const isVoiceMessage = !!element.querySelector("audio");
    setReplyTarget({
      id: messageId,
      sender: element.dataset.sender,
      text: element.querySelector(".messageContent")?.textContent.trim() || "",
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
  }
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

  chatBox.scrollTop = chatBox.scrollHeight;
}

function removeMessageLocally(messageId) {
  messageId = normalizeMessageId(messageId);
  if (!messageId) return;

  const chatBox = document.getElementById("chatBox");
  const previousScrollTop = chatBox?.scrollTop || 0;
  const previousScrollHeight = chatBox?.scrollHeight || 0;
  const wasNearBottom = chatBox
    ? previousScrollHeight - chatBox.clientHeight - previousScrollTop <= 64
    : true;

  deletedMessageIds.add(messageId);
  messageStore.delete(messageId);
  pendingLocalMessages.delete(messageId);

  document.querySelectorAll(
    `[data-message-id="${CSS.escape(messageId)}"]`
  ).forEach((messageElement) => messageElement.remove());

  if (chatBox) {
    if (wasNearBottom) {
      chatBox.scrollTop = chatBox.scrollHeight;
    } else {
      chatBox.scrollTop = Math.min(
        previousScrollTop,
        Math.max(0, chatBox.scrollHeight - chatBox.clientHeight)
      );
    }
  }
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

function ensureDeleteMenu() {
  if (deleteMenuElement) return deleteMenuElement;

  deleteMenuElement = document.createElement("div");
  deleteMenuElement.id = "messageDeleteMenu";
  deleteMenuElement.className = "messageDeleteMenu";

  deleteMenuElement.innerHTML = `
    <button
      id="messageDeleteMenuButton"
      class="messageDeleteMenuButton"
      type="button"
      aria-label="Delete message"
    >
      <span class="deleteIcon" aria-hidden="true">🗑</span>
      <span>Delete</span>
    </button>
  `;

  document.body.appendChild(deleteMenuElement);

  deleteMenuElement.querySelector("button").onclick = async () => {
    if (!deleteMenuMessageId) return;

    const messageId = deleteMenuMessageId;
    hideDeleteMenu();

    try {
      const response = await fetch(
        `${azureBaseUrl}/deleteChat`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messageId,
            user: currentUser
          })
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Delete message failed");
      }

      removeMessageLocally(messageId);
    } catch (error) {
      console.error("Delete message failed:", error);
    }
  };

  return deleteMenuElement;
}

function hideDeleteMenu() {
  deleteMenuMessageId = null;

  if (deleteMenuElement) {
    deleteMenuElement.classList.remove("is-open");
    window.setTimeout(() => {
      if (deleteMenuElement && !deleteMenuElement.classList.contains("is-open")) {
        deleteMenuElement.style.display = "none";
      }
    }, 140);
  }

  if (selectedMessageElement) {
    selectedMessageElement.classList.remove("context-selected", "reaction-above");
    selectedMessageElement = null;
  }
}

function positionDeleteMenu(messageElement) {
  const menu = ensureDeleteMenu();
  const rect = messageElement.getBoundingClientRect();
  const menuWidth = 132;
  const menuHeight = 48;
  const gutter = 8;

  const left = Math.max(
    gutter,
    Math.min(window.innerWidth - menuWidth - gutter, rect.right - menuWidth)
  );

  let top = rect.top - menuHeight - 6;
  if (top < gutter) {
    top = Math.min(
      window.innerHeight - menuHeight - gutter,
      rect.bottom + 6
    );
  }

  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(gutter, top)}px`;
  menu.style.display = "block";
  requestAnimationFrame(() => menu.classList.add("is-open"));
}

function openDeleteMenu(messageElement) {
  if (!messageElement) return;

  const sender = messageElement.dataset.sender || "";

  if (sender !== currentUser) {
    return;
  }

  if (selectedMessageElement !== messageElement) {
    selectMessageContext(messageElement);
  }
  deleteMenuMessageId = messageElement.dataset.messageId || "";
  positionDeleteMenu(messageElement);
}

function selectMessageContext(messageElement) {
  document.querySelectorAll(".message.context-selected").forEach((item) => {
    if (item !== messageElement) item.classList.remove("context-selected", "reaction-above", "show-reactions");
  });

  selectedMessageElement = messageElement;
  messageElement.classList.add("context-selected", "show-reactions");

  const chatBox = document.getElementById("chatBox");
  const reactionPicker = messageElement.querySelector(".reactionButtons");
  if (!chatBox || !reactionPicker) return;

  messageElement.classList.remove("reaction-above");
  requestAnimationFrame(() => {
    const messageRect = messageElement.getBoundingClientRect();
    const pickerHeight = reactionPicker.getBoundingClientRect().height || 44;
    const chatRect = chatBox.getBoundingClientRect();

    if (messageRect.bottom + pickerHeight + 12 > chatRect.bottom) {
      messageElement.classList.add("reaction-above");
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
  const messageElement = event.target.closest("[data-message-id]");

  if (!messageElement || isInteractiveMessageTarget(event.target)) {
    return;
  }

  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }

  clearMessagePressTimer();

  document.querySelectorAll(".message.context-selected").forEach((item) => {
    if (item !== messageElement) item.classList.remove("context-selected", "reaction-above", "show-reactions");
  });

  pressState = {
    messageElement,
    startX: event.clientX,
    startY: event.clientY,
    pointerId: event.pointerId,
    longPressed: false,
    messageElement
  };

  swipeState = {
    messageElement,
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
    if (pressState.messageElement.dataset.sender !== currentUser) {
      hideDeleteMenu();
    }
    selectMessageContext(pressState.messageElement);
    openDeleteMenu(pressState.messageElement);
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
      const message = window.chatMessages?.find((item) => item.id === swipeState.messageElement.dataset.messageId);
      if (message) setReplyTarget(message);
    }
    swipeState.messageElement.style.removeProperty("--swipe-distance");
    swipeState.messageElement.classList.remove("is-swiping");
    swipeState.messageElement.querySelector(".replyAction")?.classList.remove("is-ready");
    swipeState = null;
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
      reactionElement.innerHTML = emoji;
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
  chatBox.addEventListener("pointerleave", handleChatBoxPointerEnd);
  chatBox.addEventListener("click", (event) => {
    if (Date.now() < suppressMessageClickUntil) {
      suppressMessageClickUntil = 0;
      return;
    }

    const quote = event.target.closest(".replyQuote");
    if (quote) scrollToOriginal(quote.dataset.replyTarget, quote);

    const reactionButton = event.target.closest(".reactionButtons button");
    if (reactionButton) {
      const reactionMessage = reactionButton.closest("[data-message-id]");
      reactionMessage?.classList.remove("show-reactions", "context-selected", "reaction-above");
      if (selectedMessageElement === reactionMessage) selectedMessageElement = null;
      return;
    }

    const message = event.target.closest("[data-message-id]");
    if (message && !isInteractiveMessageTarget(event.target)) {
      document.querySelectorAll(".message.show-reactions").forEach((item) => {
        if (item !== message) item.classList.remove("show-reactions");
      });
      message.classList.toggle("show-reactions");
    }
  });
  chatBox.addEventListener("scroll", () => {
    if (chatBox.scrollHeight - chatBox.clientHeight - chatBox.scrollTop <= 64) {
      clearNewMessagesIndicator();
    }
  }, { passive: true });
}

document.getElementById("newMessagesIndicator")?.addEventListener("click", scrollChatToLatest);

document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("[data-message-id]")) {
    document.querySelectorAll(".message.show-reactions").forEach((item) => item.classList.remove("show-reactions"));
  }

  if (!deleteMenuElement || deleteMenuElement.style.display === "none") return;

  const messageTarget = event.target.closest("[data-message-id]");
  if (messageTarget && selectedMessageElement && !selectedMessageElement.contains(messageTarget)) {
    hideDeleteMenu();
    return;
  }

  if (event.target.closest("#messageDeleteMenu") || messageTarget) {
    return;
  }

  hideDeleteMenu();
});

window.addEventListener("scroll", hideDeleteMenu, true);
window.addEventListener("resize", hideDeleteMenu);

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
      statusElement.innerHTML =
        status +
        "<br>" +
        timeText;
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
window.sendMessage = async function () {

  const input = document.getElementById("messageInput");

  const text = input.value.trim();
  const replyMetadata = replyTarget ? {
    replyToMessageId: normalizeMessageId(replyTarget.id),
    replyToSender: replyTarget.sender,
    replyToText: replyTarget.text,
    replyToType: replyTarget.type,
    replyToVoice: replyTarget.voice
  } : {};

  if (text === "") return;
  if (sendInFlight) return;

  sendInFlight = true;

  try {

    const response = await fetch(
      "https://ourheartfunctions2026.azurewebsites.net/api/sendchat",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sender: currentUser,
          text: text,
          ...replyMetadata
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("Send message error:", result);
      return;
    }

    input.value = "";
    cancelReply();

    if (result.message) {
      renderLocalMessage({ ...result.message, ...replyMetadata });
    }

    console.log("Message sent:", result);

  } catch (error) {

    console.error("Failed to send message:", error);

  } finally {
    sendInFlight = false;
  }

};

async function markVisibleMessagesSeen() {
  if (!currentUser || markSeenInFlight || !window.chatMessages?.length) return;

  const unseenMessages = window.chatMessages.filter(
    (message) => message.sender !== currentUser && !message.seen
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
        await updateDoc(doc(db, "chat", normalizeMessageId(message.id)), { seen: true });
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

        document.getElementById("mohamedStatus").innerHTML =
          docSnap.data().status +
          "<br>" +
          docSnap.data().time;

      }

    }
  );


  onSnapshot(
    doc(db, "status", "yomna"),
    (docSnap) => {

      if (docSnap.exists()) {

        document.getElementById("yomnaStatus").innerHTML =
          docSnap.data().status +
          "<br>" +
          docSnap.data().time;

      }

    }
  );
}


async function pollNewMessages() {
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

    markVisibleMessagesSeen();
  } catch (error) {
    console.error("Fast new-message poll failed:", error);
  } finally {
    fastMessagePollInFlight = false;
  }
}

// الشات - Cosmos DB
async function loadChat() {
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
        ...(serverSeenTimes.length ? serverSeenTimes : [Date.now()])
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

// تحميل أول مرة
loadChat();

// مزامنة كاملة كل 5 ثواني
setInterval(loadChat, 5000);

// مزامنة خفيفة للرسائل الجديدة فقط كل 1.5 ثانية
setInterval(pollNewMessages, 900);

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
  if (!currentUser) return;

  try {
    const response = await fetch(`${azureBaseUrl}/getPresence`);
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Get presence failed");
    }

    const mohamedStatus = data.status?.mohamed;
    const yomnaStatus = data.status?.yomna;

    if (mohamedStatus) {
      document.getElementById("mohamedStatus").innerHTML =
        mohamedStatus.status +
        "<br>" +
        mohamedStatus.time;
    }

    if (yomnaStatus) {
      document.getElementById("yomnaStatus").innerHTML =
        yomnaStatus.status +
        "<br>" +
        yomnaStatus.time;
    }

    const typingData = data.typing?.[otherUser];

    if (typingData?.typing) {
      document.getElementById("typingStatus").innerHTML =
        "✍️ " + otherUser + " is typing...";
    } else {
      document.getElementById("typingStatus").innerHTML = "";
    }

    const onlineData = data.presence?.[otherUser];

    if (onlineData?.lastSeen) {
      if (
        onlineData.online !== false &&
        Date.now() - onlineData.lastSeen < 30000
      ) {
        document.getElementById("onlineStatus").innerHTML = "🟢 Online";
      } else {
        document.getElementById("onlineStatus").innerHTML =
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

  ).innerHTML =

  "✍️ " +

  otherUser +

  " is typing...";

  }

  else{

  document.getElementById(

  "typingStatus"

  ).innerHTML = "";

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
    ).innerHTML = "🟢 Online";

  }
  else {

  document.getElementById(
  "onlineStatus"
  ).innerHTML =

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
  if (!button || !timer || !hint) return;

  button.classList.toggle("is-recording", isRecording);
  button.classList.toggle("is-canceling", recordingSwipeDistance >= 70);
  timer.hidden = !isRecording;
  hint.hidden = !isRecording;
  hint.textContent = recordingSwipeDistance >= 70
    ? "Release to cancel"
    : "Slide left to cancel";
}

function updateRecordingTimer() {
  const timer = document.getElementById("recordingTimer");
  if (!timer || !isRecording) return;

  const elapsedSeconds = Math.floor((Date.now() - recordingStartTime) / 1000);
  timer.textContent = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
}

async function startVoiceRecording(event) {
  if (isRecording || recordingStarting || (event.pointerType === "mouse" && event.button !== 0)) return;

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
    return;
  }
  if (recordingStopRequested) {
    stream.getTracks().forEach((track) => track.stop());
    if (activeRecordingSession === session) activeRecordingSession = null;
    recordingStarting = false;
    recordingPointerId = null;
    return;
  }

  mediaRecorder = new MediaRecorder(stream);
  session.recorder = mediaRecorder;
  audioChunks = [];

  mediaRecorder.ondataavailable = (dataEvent) => {
    audioChunks.push(dataEvent.data);
  };

  mediaRecorder.onstop = async () => {
    if (session.finalized || session.saveStarted) return;
    session.finalized = true;
    recordingStopHandled = true;

    stream.getTracks().forEach((track) => track.stop());
    clearInterval(recordingTimer);
    recordingTimer = null;
    isRecording = false;
    updateRecordingUi();

    if (recordingCancelled) {
      audioChunks = [];
      if (activeRecordingSession === session) activeRecordingSession = null;
      return;
    }

    session.saveStarted = true;

    const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
    const formData = new FormData();
    formData.append("file", audioBlob, "voice.webm");

    try {
      const response = await fetch(
        "https://ourheartfunctions2026.azurewebsites.net/api/uploadVoice",
        { method: "POST", body: formData }
      );
      const result = await response.json();

      if (!result.url) {
        console.error("No voice URL returned");
        if (activeRecordingSession === session) activeRecordingSession = null;
        return;
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
        return;
      }

      if (chatResult.message) {
        renderLocalMessage({ ...chatResult.message, ...voiceReplyMetadata });
      }
      cancelReply();
      if (activeRecordingSession === session) activeRecordingSession = null;
    } catch (error) {
      console.error("Voice message upload failed:", error);
      if (activeRecordingSession === session) activeRecordingSession = null;
    }
  };

  mediaRecorder.start();
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
    return;
  }

  if (!isRecording || !mediaRecorder) return;
  if (recordingStopRequested || recordingStopHandled) return;

  const session = activeRecordingSession;
  if (!session || session.stopRequested || session.finalized) return;

  recordingCancelled = cancel;
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
}

document.getElementById("messageInput")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});