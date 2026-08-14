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
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
window.updateOnlineStatus = async function(){
  

await setDoc(
doc(db,"online",currentUser),
{
lastSeen:Date.now()
}
);

}
setInterval(() => {

  updateOnlineStatus();

}, 10000);

window.typing = async function(){

await setDoc(
doc(db,"typing",currentUser),
{
typing:true
}
);

setTimeout(async ()=>{

await setDoc(
doc(db,"typing",currentUser),
{
typing:false
}
);

},2000);

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

  await setDoc(
    doc(db, "status", person),
    {
      status: status,
      time: new Date().toLocaleString()
    }
  );

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

    console.log("Message sent:", result);

  } catch (error) {

    console.error("Failed to send message:", error);

  }

};


// حالة محمد
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


// حالة يمنى
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

    messages.forEach((msg) => {

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

      html += `
        <div class="message ${cls}">

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
    });
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

// تحديث الشات كل 9 ثواني
setInterval(loadChat, 9000);

window.reactMessage = async function(messageId, emoji){

  await updateDoc(
    doc(db, "chat", messageId),
    {
      reaction: emoji
    }
  );

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
window.addEventListener(

"beforeunload",

async ()=>{

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