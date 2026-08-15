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
let typingStopTimer = null;
let typingStateSent = false;
const useAzurePresence = true;
const pendingLocalMessages = new Map();
const deletedMessageIds = new Set();
const longPressDelayMs = 700;
const longPressMoveThresholdPx = 10;
let pressTimer = null;
let pressState = null;
let deleteMenuElement = null;
let deleteMenuMessageId = null;

function buildMessageHtml(msg) {
  const checkMark =
    msg.seen
      ? "✓✓ Seen"
      : "✓ Delivered";

  const cls =
    msg.sender === currentUser
      ? "message me"
      : "message her";

  return `
    <div class="message ${cls}" data-message-id="${msg.id}" data-sender="${msg.sender}">

      <div>
        ${
          msg.voiceUrl
            ? `
              <audio controls>
                <source src="${msg.voiceUrl}">
              </audio>
            `
            : (msg.text || "")
        }
      </div>

      <small>
        ${msg.sender}
        -
        ${new Date(msg.time).toLocaleTimeString()}
        <br>
        ${checkMark}
      </small>

      <div class="reaction">
        ${msg.reaction || ""}
      </div>

      <div class="reactionButtons">

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

function renderLocalMessage(message) {
  if (!message || !message.id) return;

  if (deletedMessageIds.has(message.id)) return;

  pendingLocalMessages.set(message.id, message);

  const chatBox = document.getElementById("chatBox");

  if (!chatBox) return;

  const existingMessage = chatBox.querySelector(
    `[data-message-id="${message.id}"]`
  );

  if (!existingMessage) {
    chatBox.insertAdjacentHTML("beforeend", buildMessageHtml(message));
  }

  chatBox.scrollTop = chatBox.scrollHeight;
}

function removeMessageLocally(messageId) {
  if (!messageId) return;

  deletedMessageIds.add(messageId);
  pendingLocalMessages.delete(messageId);

  const messageElement = document.querySelector(
    `[data-message-id="${messageId}"]`
  );

  if (messageElement) {
    messageElement.remove();
  }

  const chatBox = document.getElementById("chatBox");

  if (chatBox) {
    chatBox.scrollTop = chatBox.scrollHeight;
  }
}

function ensureDeleteMenu() {
  if (deleteMenuElement) return deleteMenuElement;

  deleteMenuElement = document.createElement("div");
  deleteMenuElement.id = "messageDeleteMenu";
  deleteMenuElement.style.position = "fixed";
  deleteMenuElement.style.zIndex = "3000";
  deleteMenuElement.style.display = "none";
  deleteMenuElement.style.padding = "6px";
  deleteMenuElement.style.borderRadius = "12px";
  deleteMenuElement.style.background = "rgba(15, 23, 42, 0.98)";
  deleteMenuElement.style.border = "1px solid rgba(255, 255, 255, 0.12)";
  deleteMenuElement.style.boxShadow = "0 10px 30px rgba(0, 0, 0, 0.35)";

  deleteMenuElement.innerHTML = `
    <button
      id="messageDeleteMenuButton"
      style="
        width: 100%;
        padding: 10px 14px;
        border: none;
        border-radius: 10px;
        background: #ef4444;
        color: white;
        font-size: 14px;
        cursor: pointer;
      "
    >
      Delete
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
    deleteMenuElement.style.display = "none";
  }
}

function positionDeleteMenu(messageElement) {
  const menu = ensureDeleteMenu();
  const rect = messageElement.getBoundingClientRect();
  const menuWidth = 120;
  const menuHeight = 44;
  const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth));
  const top = Math.max(8, Math.min(window.innerHeight - menuHeight - 8, rect.top - menuHeight - 4));

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.display = "block";
}

function openDeleteMenu(messageElement) {
  if (!messageElement) return;

  const sender = messageElement.dataset.sender || "";

  if (sender !== currentUser) {
    return;
  }

  deleteMenuMessageId = messageElement.dataset.messageId || "";
  positionDeleteMenu(messageElement);
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

  const sender = messageElement.dataset.sender || "";

  if (sender !== currentUser) {
    return;
  }

  clearMessagePressTimer();

  pressState = {
    messageElement,
    startX: event.clientX,
    startY: event.clientY,
    pointerId: event.pointerId,
    longPressed: false
  };

  pressTimer = setTimeout(() => {
    if (!pressState || pressState.longPressed) return;

    pressState.longPressed = true;
    openDeleteMenu(pressState.messageElement);
  }, longPressDelayMs);
}

function handleChatBoxPointerMove(event) {
  if (!pressState || event.pointerId !== pressState.pointerId || pressState.longPressed) {
    return;
  }

  const deltaX = Math.abs(event.clientX - pressState.startX);
  const deltaY = Math.abs(event.clientY - pressState.startY);

  if (deltaX > longPressMoveThresholdPx || deltaY > longPressMoveThresholdPx) {
    clearMessagePressTimer();
  }
}

function handleChatBoxPointerEnd() {
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
}

document.addEventListener("pointerdown", (event) => {
  if (!deleteMenuElement || deleteMenuElement.style.display === "none") return;

  if (event.target.closest("#messageDeleteMenu") || event.target.closest("[data-message-id]")) {
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

  if (text === "") return;

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
          text: text
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("Send message error:", result);
      return;
    }

    input.value = "";

    if (result.message) {
      renderLocalMessage(result.message);
    }

    console.log("Message sent:", result);

  } catch (error) {

    console.error("Failed to send message:", error);

  }

};


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


// الشات - Cosmos DB
async function loadChat() {
  try {

    const response = await fetch(
      "https://ourheartfunctions2026.azurewebsites.net/api/getchat"
    );

    const messages = await response.json();

    if (!response.ok) {
      console.error("Get chat error:", messages);
      return;
    }

    let html = "";
  const serverMessageIds = new Set();

    messages.forEach((msg) => {

      if (deletedMessageIds.has(msg.id)) {
        return;
      }

      if (
        Date.now() - msg.time >=
        48 * 60 * 60 * 1000
      ) {
        return;
      }

      const checkMark =
        msg.seen
          ? "✓✓ Seen"
          : "✓ Delivered";

      const cls =
        msg.sender === currentUser
          ? "message me"
          : "message her";

      serverMessageIds.add(msg.id);
      html += buildMessageHtml(msg);
    });

    for (const [messageId, message] of pendingLocalMessages) {
      if (serverMessageIds.has(messageId)) {
        pendingLocalMessages.delete(messageId);
        continue;
      }

      if (deletedMessageIds.has(messageId)) {
        pendingLocalMessages.delete(messageId);
        continue;
      }

      if (Date.now() - message.time >= 48 * 60 * 60 * 1000) {
        pendingLocalMessages.delete(messageId);
        continue;
      }

      html += buildMessageHtml(message);
    }

   const chatBox = document.getElementById("chatBox");

const audioIsPlaying = [...chatBox.querySelectorAll("audio")]
  .some(audio => !audio.paused && !audio.ended);

if (audioIsPlaying) {
  return;
}

chatBox.innerHTML = html;

chatBox.scrollTop = chatBox.scrollHeight;

  } catch (error) {

    console.error("Failed to load chat:", error);

  }
}

// تحميل أول مرة
loadChat();

// تحديث الشات كل 5 ثواني
setInterval(loadChat, 5000);

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
window.toggleRecording = async function () {

  if (!isRecording) {

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });

    mediaRecorder = new MediaRecorder(stream);

    audioChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {

      const audioBlob = new Blob(audioChunks, {
        type: "audio/webm"
      });

      const formData = new FormData();

      formData.append(
        "file",
        audioBlob,
        "voice.webm"
      );

      const response = await fetch(
        "https://ourheartfunctions2026.azurewebsites.net/api/uploadVoice",
        {
          method: "POST",
          body: formData
        }
      );

      const result = await response.json();

      console.log("Voice uploaded:", result);

      if (!result.url) {
        console.error("No voice URL returned");
        return;
      }

      const chatResponse = await fetch(
        "https://ourheartfunctions2026.azurewebsites.net/api/sendchat",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            sender: currentUser,
            voiceUrl: result.url
          })
        }
      );

      const chatResult = await chatResponse.json();

      if (!chatResponse.ok) {
        console.error("Voice message save error:", chatResult);
        return;
      }

      if (chatResult.message) {
        renderLocalMessage(chatResult.message);
      }

      console.log("Voice message saved:", chatResult);
    };

    mediaRecorder.start();

    isRecording = true;

    document.getElementById(
      "recordBtn"
    ).innerHTML = "⏹️ إيقاف";

  } else {

    mediaRecorder.stop();

    isRecording = false;

    document.getElementById(
      "recordBtn"
    ).innerHTML = "🎤 تسجيل صوت";
  }

};